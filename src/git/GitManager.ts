import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import type { ExperimentCategory } from '../types/analytics.js';
import type { OracleResult, RollbackResult } from '../types/domain.js';
import { applyHunksToContent, normalizeRejectedDiff, ParsedFileDiff, parseFileDiffs, validatePatchStructure } from './UnifiedDiff.js';
import { resolveRepositoryPath } from '../security/RepositoryPathPolicy.js';


const execFileAsync = promisify(execFile);

export type PatchApplyMode =
  | 'GIT'
  | 'FUZZY'
  | 'NOT_APPLICABLE';

export interface PatchScope {
  readonly category: ExperimentCategory;
  readonly targetFiles: readonly string[];
  readonly testFiles: readonly string[];
}

interface ApplicabilityProbe {
  readonly applicable: boolean;
  readonly executionError?: string;
}

interface FuzzyUpdate {
  readonly relativePath: string;
  readonly content: string;
  readonly allowMissing: boolean;
}

export type FuzzyWriteFile =
  (
    filePath: string,
    content: string,
    encoding: BufferEncoding
  ) => Promise<void>;

export class GitManager {
  private static readonly FIXTURE_IGNORED_ARTIFACTS =
    Object.freeze([
      '__pycache__',
      '.pytest_cache',
      '.coverage',
      'coverage.xml',
      'htmlcov'
    ] as const);

  constructor(
    private readonly repoRoot: string,

    private readonly fuzzyWriteFile:
      FuzzyWriteFile =
      async (
        filePath,
        content,
        encoding
      ) => {
        await fs.writeFile(
          filePath,
          content,
          encoding
        );
      }
  ) { }

  public computePatchHash(unifiedDiff: string): string {
    const normalizedDiff = unifiedDiff.replace(/\r\n/g, '\n').trim();
    return crypto.createHash('sha256').update(normalizedDiff).digest('hex');
  }

  public async normalizeRejectedPatch(unifiedDiff: string, scope: PatchScope): Promise<string | null> {
    const fileDiffs =
      parseFileDiffs(unifiedDiff);

    try {
      this.validateParsedPatchScope(
        unifiedDiff,
        fileDiffs,
        scope
      );
    } catch {
      return null;
    }

    if (fileDiffs.length === 0) {
      return null;
    }

    const sources: Record<string, string> = {};

    for (const fileDiff of fileDiffs) {
      if (fileDiff.isNewFile) {
        continue;
      }

      const normalizedPath =
        this.normalizeRelativePath(
          fileDiff.file
        );

      this.assertPathInsideRepository(
        normalizedPath
      );

      let resolvedSource:
        Awaited<
          ReturnType<
            typeof resolveRepositoryPath
          >
        >;

      try {
        resolvedSource =
          await resolveRepositoryPath({
            repositoryRoot:
              this.repoRoot,
            relativePath:
              normalizedPath
          });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.warn(
          `[GitManager] Normalizzazione patch rifiutata ` +
          `per ${normalizedPath}: ${message}`
        );

        return null;
      }

      try {
        sources[fileDiff.file] =
          await fs.readFile(
            resolvedSource.absolutePath,
            'utf-8'
          );
      } catch (error: unknown) {
        const fileError =
          error as NodeJS.ErrnoException;

        if (
          fileError.code === 'ENOENT' ||
          fileError.code === 'ENOTDIR'
        ) {
          return null;
        }

        throw error;
      }
    }

    const normalization = normalizeRejectedDiff(unifiedDiff, sources);
    if (!normalization || !normalization.normalized) {
      return null;
    }

    try {
      this.validatePatchScope(normalization.diffText, scope);
    } catch {
      return null;
    }

    const originalHash = this.computePatchHash(unifiedDiff);
    const normalizedHash = this.computePatchHash(normalization.diffText);

    if (originalHash === normalizedHash) {
      return null;
    }

    console.info(`[GitManager] Patch normalizzata deterministicamente: ${normalization.repairedHunks} hunk riparati.`);
    return normalization.diffText;
  }

  public async evaluateApplicability(unifiedDiff: string, scope: PatchScope, required: boolean): Promise<OracleResult<'APPLICABILITY'>> {
    const startedAt = performance.now();
    const patchHash = this.computePatchHash(unifiedDiff);
    try {
      this.validatePatchScope(unifiedDiff, scope);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        oracle: 'APPLICABILITY',
        status: 'FAIL',
        required,
        durationMs: performance.now() - startedAt,
        summary: `La patch non supera i vincoli strutturali o di scope: ${reason}`,
        evidence: {
          applyMode: 'NOT_APPLICABLE',
          patchHash,
          reason
        }
      };
    }

    const gitProbe = await this.probeGitApplicability(unifiedDiff);
    if (gitProbe.applicable) {
      return {
        oracle: 'APPLICABILITY',
        status: 'PASS',
        required,
        durationMs: performance.now() - startedAt,
        summary: 'La patch è applicabile tramite Git.',
        evidence: {
          applyMode: 'GIT',
          patchHash
        }
      };
    }

    let fuzzyApplicable: boolean;
    try {
      fuzzyApplicable = await this.canApplyFuzzy(unifiedDiff);
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        oracle: 'APPLICABILITY',
        status: 'EXECUTION_ERROR',
        required,
        durationMs: performance.now() - startedAt,
        summary: `La verifica FUZZY non è stata completata: ${reason}`,
        evidence: {
          applyMode: 'NOT_APPLICABLE',
          patchHash,
          reason
        }
      };
    }


    if (fuzzyApplicable) {
      return {
        oracle: 'APPLICABILITY',
        status: 'PASS',
        required,
        durationMs: performance.now() - startedAt,
        summary: 'La patch è applicabile tramite fallback FUZZY.',
        evidence: {
          applyMode: 'FUZZY',
          patchHash,
          ...(gitProbe.executionError ? {
            reason: `Git non disponibile: ${gitProbe.executionError}`
          } : {})
        }
      };
    }

    if (gitProbe.executionError) {
      return {
        oracle: 'APPLICABILITY',
        status: 'EXECUTION_ERROR',
        required,
        durationMs: performance.now() - startedAt,
        summary: `La verifica Git non è stata completata: ${gitProbe.executionError}`,
        evidence: {
          applyMode: 'NOT_APPLICABLE',
          patchHash,
          reason: gitProbe.executionError
        }
      };
    }

    return {
      oracle: 'APPLICABILITY',
      status: 'FAIL',
      required,
      durationMs: performance.now() - startedAt,
      summary: 'La patch non è applicabile né tramite Git né tramite fallback FUZZY.',
      evidence: {
        applyMode: 'NOT_APPLICABLE',
        patchHash,
        reason: 'Nessuna modalità di applicazione ha riconosciuto la patch come applicabile.'
      }
    };
  }

  public async applyPatch(unifiedDiff: string, scope: PatchScope, expectedMode: Exclude<PatchApplyMode, 'NOT_APPLICABLE'>): Promise<Exclude<PatchApplyMode, 'NOT_APPLICABLE'>> {
    this.validatePatchScope(unifiedDiff, scope);
    if (expectedMode === 'GIT') {
      await this.applyWithGit(unifiedDiff);
      return 'GIT';
    }
    const applied = await this.applyFuzzy(unifiedDiff);
    if (!applied) {
      throw new Error('La patch risultava applicabile in modalità FUZZY, ma l’applicazione è fallita.');
    }
    return 'FUZZY';
  }

  private validatePatchScope(unifiedDiff: string, scope: PatchScope): void {
    const structureValidation = validatePatchStructure(unifiedDiff);
    if (!structureValidation.valid) {
      const details = structureValidation.violations.map((violation) => {
        const location = [
          violation.file,
          violation.hunkIndex !== undefined ? `hunk ${violation.hunkIndex + 1}` : undefined
        ].filter((value): value is string => value !== undefined).join(', ');
        return location ? `[${violation.code}] ${location}: ${violation.message}` : `[${violation.code}] ${violation.message}`;
      }).join('\n');
      throw new Error(`La patch non supera la validazione strutturale:\n${details}`);
    }
    const fileDiffs = parseFileDiffs(unifiedDiff);
    this.validateParsedPatchScope(
      unifiedDiff,
      fileDiffs,
      scope
    );

    if (fileDiffs.length === 0) {
      throw new Error(
        'La patch non contiene modifiche a file riconoscibili.'
      );
    }

    const targetFiles = new Set(
      scope.targetFiles.map((file) =>
        this.normalizeRelativePath(file)
      )
    );

    const testFiles = new Set(
      scope.testFiles.map((file) =>
        this.normalizeRelativePath(file)
      )
    );

    const sourcePaths = unifiedDiff
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((line) => line.startsWith('--- '))
      .map((line) => line.substring(4).trim())
      .filter((filePath) => filePath !== '/dev/null')
      .map((filePath) =>
        this.normalizeRelativePath(filePath)
      );

    for (const sourcePath of sourcePaths) {
      this.assertPathInsideRepository(sourcePath);

      if (testFiles.has(sourcePath)) {
        throw new Error(
          `La patch tenta di modificare o rinominare un file di test/oracolo protetto: ${sourcePath}`
        );
      }

      if (
        scope.category === 'REPAIR' &&
        !targetFiles.has(sourcePath)
      ) {
        throw new Error(
          `REPAIR non può utilizzare file non dichiarati come target: ${sourcePath}`
        );
      }
    }

    for (const fileDiff of fileDiffs) {
      const targetPath =
        this.normalizeRelativePath(fileDiff.file);

      this.assertPathInsideRepository(targetPath);

      if (testFiles.has(targetPath)) {
        throw new Error(
          `La patch tenta di modificare un file di test/oracolo protetto: ${targetPath}`
        );
      }

      if (
        scope.category === 'REPAIR' &&
        !targetFiles.has(targetPath)
      ) {
        throw new Error(
          `REPAIR non può modificare file non dichiarati come target: ${targetPath}`
        );
      }
    }
  }

  private validateParsedPatchScope(
    unifiedDiff: string,
    fileDiffs: readonly ParsedFileDiff[],
    scope: PatchScope
  ): void {
    if (fileDiffs.length === 0) {
      throw new Error(
        'La patch non contiene modifiche ' +
        'a file riconoscibili.'
      );
    }

    const targetFiles =
      new Set(
        scope.targetFiles.map(
          (file) =>
            this.normalizeRelativePath(file)
        )
      );

    const testFiles =
      new Set(
        scope.testFiles.map(
          (file) =>
            this.normalizeRelativePath(file)
        )
      );

    const sourcePaths =
      unifiedDiff
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter(
          (line) =>
            line.startsWith('--- ')
        )
        .map(
          (line) =>
            line.substring(4)
              .trim()
              .split('\t')[0]!
        )
        .filter(
          (filePath) =>
            filePath !== '/dev/null'
        )
        .map(
          (filePath) =>
            this.normalizeRelativePath(
              filePath
            )
        );

    for (const sourcePath of sourcePaths) {
      this.assertPathInsideRepository(
        sourcePath
      );

      if (testFiles.has(sourcePath)) {
        throw new Error(
          `La patch tenta di modificare ` +
          `o rinominare un file di test/` +
          `oracolo protetto: ${sourcePath}`
        );
      }

      if (
        scope.category === 'REPAIR' &&
        !targetFiles.has(sourcePath)
      ) {
        throw new Error(
          `REPAIR non può utilizzare file ` +
          `non dichiarati come target: ` +
          `${sourcePath}`
        );
      }
    }

    for (const fileDiff of fileDiffs) {
      const targetPath =
        this.normalizeRelativePath(
          fileDiff.file
        );

      this.assertPathInsideRepository(
        targetPath
      );

      if (testFiles.has(targetPath)) {
        throw new Error(
          `La patch tenta di modificare un ` +
          `file di test/oracolo protetto: ` +
          `${targetPath}`
        );
      }

      if (
        scope.category === 'REPAIR' &&
        !targetFiles.has(targetPath)
      ) {
        throw new Error(
          `REPAIR non può modificare file ` +
          `non dichiarati come target: ` +
          `${targetPath}`
        );
      }
    }
  }

  private normalizeRelativePath(
    filePath: string
  ): string {
    let normalized = filePath
      .replaceAll('\\', '/')
      .trim();

    if (
      normalized.startsWith('a/') ||
      normalized.startsWith('b/')
    ) {
      normalized = normalized.substring(2);
    }

    while (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    normalized = path.posix.normalize(normalized);

    return process.platform === 'win32'
      ? normalized.toLowerCase()
      : normalized;
  }


  private assertPathInsideRepository(
    filePath: string
  ): void {
    if (!filePath) {
      throw new Error(
        'La patch contiene un percorso vuoto.'
      );
    }

    if (filePath.includes('\0')) {
      throw new Error(
        'La patch contiene un percorso non valido.'
      );
    }

    if (
      path.isAbsolute(filePath) ||
      path.win32.isAbsolute(filePath)
    ) {
      throw new Error(
        `La patch contiene un percorso assoluto non consentito: ${filePath}`
      );
    }

    const repositoryRoot =
      path.resolve(this.repoRoot);

    const absolutePath =
      path.resolve(repositoryRoot, filePath);

    const relativePath =
      path.relative(repositoryRoot, absolutePath);

    const isOutsideRepository =
      relativePath === '' ||
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath);

    if (isOutsideRepository) {
      throw new Error(
        `La patch tenta di accedere fuori dal repository: ${filePath}`
      );
    }

    const segments = relativePath
      .replaceAll('\\', '/')
      .split('/');

    if (segments.includes('.git')) {
      throw new Error(
        `La patch tenta di modificare la directory Git: ${filePath}`
      );
    }
  }

  private async probeGitApplicability(unifiedDiff: string): Promise<ApplicabilityProbe> {
    const tempPatchPath = this.createTempPatchPath('check');
    try {
      await this.writePatchFile(tempPatchPath, unifiedDiff);
      try {
        await execFileAsync(
          'git',
          [
            'apply',
            '--check',
            '-p1',
            '--unidiff-zero',
            '--ignore-space-change',
            '--ignore-whitespace',
            '--recount',
            tempPatchPath
          ],
          { cwd: this.repoRoot }
        );
        return {
          applicable: true
        };
      } catch (error: unknown) {
        const execError = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
        const message = execError.message ?? String(error);
        const stderr = execError.stderr?.trim() ?? '';
        console.warn(`[GitManager] git apply --check fallito:`, {
          message,
          stderr
        });
        if (typeof execError.code === 'string') {
          return {
            applicable: false,
            executionError: message || `Errore di esecuzione Git: ${execError.code}`
          };
        }
        return { applicable: false };
      }
    } catch (error: unknown) {
      return {
        applicable: false,
        executionError: error instanceof Error ? error.message : String(error)
      };
    } finally {
      try {
        await fs.rm(tempPatchPath, { force: true });
      } catch (error: unknown) {
        console.warn(`[GitManager] Impossibile eliminare il file temporaneo del probe Git:`, error instanceof Error ? error.message : String(error));
      }

    }
  }

  private async applyWithGit(unifiedDiff: string): Promise<void> {
    const tempPatchPath = this.createTempPatchPath('apply');
    try {
      await this.writePatchFile(tempPatchPath, unifiedDiff);
      await execFileAsync(
        'git',
        [
          'apply',
          '-p1',
          '--unidiff-zero',
          '--whitespace=nowarn',
          '--ignore-space-change',
          '--ignore-whitespace',
          '--recount',
          tempPatchPath
        ],
        { cwd: this.repoRoot }
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Errore durante l'applicazione della patch con Git: ${message}`);
    } finally {
      try {
        await fs.rm(tempPatchPath, { force: true });
      } catch (error: unknown) {
        console.warn('[GitManager] Impossibile eliminare il file temporaneo di applicazione:', error instanceof Error ? error.message : String(error));
      }
    }
  }

  private createTempPatchPath(operation: string): string {
    const uniqueSuffix = `${Date.now()}_${crypto.randomUUID()}`;
    return path.join(this.repoRoot, `.tmp_${operation}_${uniqueSuffix}.patch`);
  }

  private async writePatchFile(tempPatchPath: string, unifiedDiff: string): Promise<void> {
    const normalizedDiff = unifiedDiff.replace(/\r\n/g, '\n').trim() + '\n';
    await fs.writeFile(tempPatchPath, normalizedDiff, 'utf-8');
  }

  private async applyFuzzy(
    unifiedDiff: string
  ): Promise<boolean> {
    const updates =
      await this.computeFuzzyUpdates(
        unifiedDiff
      );

    if (!updates) {
      return false;
    }

    try {
      const preflightTargets =
        await Promise.all(
          [...updates.values()].map(
            async (update) => {
              const resolved =
                await resolveRepositoryPath({
                  repositoryRoot:
                    this.repoRoot,

                  relativePath:
                    update.relativePath,

                  allowMissing:
                    update.allowMissing
                });

              return {
                update,
                resolved
              };
            }
          )
        );

      for (
        const {
          resolved
        } of preflightTargets
      ) {
        await fs.mkdir(
          path.dirname(
            resolved.absolutePath
          ),
          {
            recursive:
              true
          }
        );
      }

      const writableTargets =
        await Promise.all(
          [...updates.values()].map(
            async (update) => {
              const resolved =
                await resolveRepositoryPath({
                  repositoryRoot:
                    this.repoRoot,

                  relativePath:
                    update.relativePath,

                  allowMissing:
                    update.allowMissing
                });

              return {
                update,
                resolved
              };
            }
          )
        );

      for (
        const {
          update,
          resolved
        } of writableTargets
      ) {
        await this.fuzzyWriteFile(
          resolved.absolutePath,
          update.content,
          'utf8'
        );
      }

      return true;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.warn(
        `[GitManager] applyFuzzy fallito: ${message}`
      );

      return false;
    }
  }

  private async canApplyFuzzy(unifiedDiff: string): Promise<boolean> {
    return (await this.computeFuzzyUpdates(unifiedDiff)) !== null;
  }

  private async computeFuzzyUpdates(
    unifiedDiff: string
  ): Promise<Map<string, FuzzyUpdate> | null> {
    const fileDiffs =
      parseFileDiffs(
        unifiedDiff
      );

    if (
      fileDiffs.length === 0
    ) {
      return null;
    }

    const updates =
      new Map<string, FuzzyUpdate>();

    for (
      const fileDiff of fileDiffs
    ) {
      const {
        file,
        hunks
      } = fileDiff;

      if (
        !file ||
        hunks.length === 0
      ) {
        return null;
      }

      const normalizedPath =
        this.normalizeRelativePath(
          file
        );
      this.assertPathInsideRepository(
        normalizedPath
      );

      const allowMissing =
        fileDiff.isNewFile;

      let resolvedTarget:
        Awaited<
          ReturnType<
            typeof resolveRepositoryPath
          >
        >;

      try {
        resolvedTarget =
          await resolveRepositoryPath({
            repositoryRoot:
              this.repoRoot,

            relativePath:
              normalizedPath,

            allowMissing
          });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.warn(
          `[GitManager] FUZZY rifiutato per ${normalizedPath}: ${message}`
        );

        return null;
      }
      let currentContent =
        updates.get(
          resolvedTarget.relativePath
        )?.content;

      if (
        currentContent === undefined
      ) {
        try {
          currentContent =
            await fs.readFile(
              resolvedTarget.absolutePath,
              'utf8'
            );
        } catch (error: unknown) {
          const fileError =
            error as NodeJS.ErrnoException;

          if (
            fileError.code === 'ENOENT' &&
            allowMissing
          ) {
            currentContent =
              '';
          } else {
            throw error;
          }
        }
      }

      const patchedContent =
        applyHunksToContent(
          currentContent,
          hunks
        );

      if (
        patchedContent === null
      ) {
        console.warn(
          `[GitManager] FUZZY non applicabile a ${normalizedPath}: ` +
          `gli hunk non corrispondono al contenuto corrente`
        );

        return null;
      }

      updates.set(
        resolvedTarget.relativePath,
        {
          relativePath:
            resolvedTarget.relativePath,

          content:
            patchedContent,

          allowMissing
        }
      );
    }

    return updates;
  }

  public async getHead(): Promise<string> {
    const result = await execFileAsync(
      'git',
      ['rev-parse', 'HEAD'],
      {
        cwd: this.repoRoot
      }
    );
    return result.stdout.trim();
  }

  public async getWorkingTreeStatus(): Promise<string> {
    const result = await execFileAsync(
      'git',
      ['status', '--porcelain'],
      {
        cwd: this.repoRoot
      }
    );
    return result.stdout.trim();
  }

  public async isWorkingTreeClean(): Promise<boolean> {
    const status = await this.getWorkingTreeStatus();
    return status.length === 0;
  }

  public async assertWorkingTreeClean(): Promise<void> {
    const status = await this.getWorkingTreeStatus();
    if (status.length > 0) {
      throw new Error(`Il repository non è clean prima dell'esecuzione:\n${status}`);
    }
  }

  private async cleanupFixtureArtifacts(): Promise<void> {
    const repositoryRoot =
      path.resolve(
        this.repoRoot
      );

    const artifactNames =
      new Set<string>(
        GitManager
          .FIXTURE_IGNORED_ARTIFACTS
      );
    const isIgnored =
      async (
        relativePath: string
      ): Promise<boolean> => {
        try {
          await execFileAsync(
            'git',
            [
              'check-ignore',
              '-q',
              '--',
              relativePath
            ],
            {
              cwd:
                repositoryRoot
            }
          );

          return true;
        } catch (error: unknown) {
          const gitError =
            error as {
              code?: number | string;
            };
          if (
            gitError.code === 1 ||
            gitError.code === '1'
          ) {
            return false;
          }

          throw error;
        }
      };

    const visit =
      async (
        directory: string
      ): Promise<void> => {
        const entries =
          await fs.readdir(
            directory,
            {
              withFileTypes:
                true
            }
          );

        for (
          const entry of entries
        ) {
          if (
            entry.name === '.git'
          ) {
            continue;
          }

          const candidate =
            path.join(
              directory,
              entry.name
            );

          const relativePath =
            path
              .relative(
                repositoryRoot,
                candidate
              )
              .replaceAll(
                '\\',
                '/'
              );

          if (
            artifactNames.has(
              entry.name
            )
          ) {
            if (
              !(await isIgnored(
                relativePath
              ))
            ) {
              continue;
            }
            if (
              entry.isSymbolicLink()
            ) {
              await fs.unlink(
                candidate
              );

              continue;
            }

            const resolved =
              await resolveRepositoryPath({
                repositoryRoot,

                relativePath,

                allowMissing:
                  true
              });

            await fs.rm(
              resolved.absolutePath,
              {
                recursive:
                  true,

                force:
                  true
              }
            );

            continue;
          }
          if (
            entry.isDirectory() &&
            !entry.isSymbolicLink()
          ) {
            await visit(
              candidate
            );
          }
        }
      };

    await visit(
      repositoryRoot
    );
  }

  private async resetFixtureFilesystem(targetRef: string): Promise<void> {
    await execFileAsync(
      'git',
      [
        'reset',
        '--hard',
        targetRef
      ],
      {
        cwd: this.repoRoot
      }
    );

    await execFileAsync(
      'git',
      [
        'clean',
        '-fd'
      ],
      {
        cwd: this.repoRoot
      }
    );
    await this.cleanupFixtureArtifacts();
  }


  public async hardReset(): Promise<void> {
    await this.resetFixtureFilesystem('HEAD');
  }

  public async commitChanges(
    message: string,
    files?: readonly string[]
  ): Promise<string> {
    if (files && files.length > 0) {
      await execFileAsync(
        'git',
        [
          'add',
          '--',
          ...files
        ],
        {
          cwd: this.repoRoot
        }
      );
    } else {
      await execFileAsync(
        'git',
        [
          'add',
          '-A'
        ],
        {
          cwd: this.repoRoot
        }
      );
    }

    await execFileAsync(
      'git',
      [
        'commit',
        '-m',
        message
      ],
      {
        cwd: this.repoRoot
      }
    );

    const result = await execFileAsync(
      'git',
      [
        'rev-parse',
        'HEAD'
      ],
      {
        cwd: this.repoRoot
      }
    );

    return result.stdout.trim();
  }

  public async rollback(initialHead: string): Promise<RollbackResult> {
    try {
      await this.resetFixtureFilesystem(initialHead);
      const finalHead = await this.getHead();
      const workingTreeStatus = await this.getWorkingTreeStatus();
      const repositoryClean = workingTreeStatus.length === 0;
      const headRestored = finalHead === initialHead;
      if (!headRestored) {
        return {
          status: 'FAILED',
          initialHead,
          finalHead,
          repositoryClean,
          workingTreeStatus,
          message: `Rollback incompleto: HEAD finale ${finalHead} diverso dall'HEAD iniziale ${initialHead}.`
        };
      }
      if (!repositoryClean) {
        return {
          status: 'FAILED',
          initialHead,
          finalHead,
          repositoryClean: false,
          workingTreeStatus,
          message: `Rollback incompleto: il repository non è clean dopo reset/clean.\n${workingTreeStatus}`
        };
      }
      return {
        status: 'SUCCESS',
        initialHead,
        finalHead,
        repositoryClean: true,
        workingTreeStatus: ''
      };
    } catch (error: unknown) {
      let finalHead: string | undefined;
      let workingTreeStatus = '';
      try {
        finalHead = await this.getHead();
      } catch { }
      try {
        workingTreeStatus = await this.getWorkingTreeStatus();
      } catch { }
      return {
        status: 'FAILED',
        initialHead,
        ...(finalHead !== undefined ? { finalHead } : {}),
        repositoryClean: workingTreeStatus.length === 0 && finalHead === initialHead,
        workingTreeStatus,
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
