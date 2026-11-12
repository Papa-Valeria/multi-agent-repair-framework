import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BuildOracleConfig } from '../inference/BuildOracleConfig.js';
import type {
    BuildSyntaxOracleEvidence,
    OracleResult
} from '../types/domain.js';
import { ProcessRunner } from './ProcessRunner.js';

export interface BuildSyntaxEvaluationParams {
    readonly config?: BuildOracleConfig;
    readonly required: boolean;
}

export class BuildSyntaxOracle {
    constructor(
        private readonly repoRoot: string
    ) { }

    public async evaluate(
        params: BuildSyntaxEvaluationParams
    ): Promise<OracleResult<'BUILD_SYNTAX'>> {
        const { config, required } = params;
        const startedAt = performance.now();

        if (config === undefined) {
            return {
                oracle: 'BUILD_SYNTAX',
                status: 'NOT_AVAILABLE',
                required,
                durationMs: performance.now() - startedAt,
                summary:
                    'Il task non definisce una configurazione per il Build/Syntax Oracle.',
                evidence: {
                    command: '',
                    args: [],
                    cwd: '',
                    timeoutMs: 0,
                    envAllowList: [],
                    exitCode: null,
                    timedOut: false,
                    stdout: '',
                    stderr: '',
                    stdoutTruncated: false,
                    stderrTruncated: false
                }
            };
        }

        const {
            command,
            args,
            timeoutMs,
            envAllowList
        } = config;

        let executionCwd: string;

        try {
            executionCwd = this.resolveExecutionCwd(
                config.cwd
            );
        } catch (error: unknown) {
            const executionError =
                this.errorMessage(error);

            return {
                oracle: 'BUILD_SYNTAX',
                status: 'EXECUTION_ERROR',
                required,
                durationMs: performance.now() - startedAt,
                summary:
                    `La directory di esecuzione del Build/Syntax Oracle ` +
                    `non è valida: ${executionError}`,
                evidence: {
                    command,
                    args,
                    cwd: config.cwd ?? '.',
                    timeoutMs,
                    envAllowList,
                    exitCode: null,
                    timedOut: false,
                    stdout: '',
                    stderr: '',
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    executionError
                }
            };
        }

        try {
            const result = await ProcessRunner.execute(
                command,
                args,
                {
                    cwd: executionCwd,
                    timeoutMs,
                    envAllowList
                }
            );

            const evidence: BuildSyntaxOracleEvidence = {
                command,
                args,
                cwd: executionCwd,
                timeoutMs,
                envAllowList,
                exitCode: result.exitCode,
                timedOut: result.timedOut,
                stdout: result.stdout,
                stderr: result.stderr,
                stdoutTruncated: result.stdoutTruncated,
                stderrTruncated: result.stderrTruncated,
                ...(result.executionError
                    ? { executionError: result.executionError }
                    : {})
            };

            if (result.timedOut) {
                return {
                    oracle: 'BUILD_SYNTAX',
                    status: 'EXECUTION_ERROR',
                    required,
                    durationMs:
                        performance.now() - startedAt,
                    summary:
                        `Il Build/Syntax Oracle ha superato ` +
                        `il timeout configurato di ${timeoutMs} ms.` +
                        (
                            result.executionError
                                ? ` ${result.executionError}`
                                : ''
                        ),
                    evidence
                };
            }

            if (result.executionError) {
                return {
                    oracle: 'BUILD_SYNTAX',
                    status: 'EXECUTION_ERROR',
                    required,
                    durationMs:
                        performance.now() - startedAt,
                    summary:
                        `Impossibile avviare o completare il ` +
                        `Build/Syntax Oracle: ` +
                        `${result.executionError}`,
                    evidence
                };
            }

            if (result.exitCode === null) {
                return {
                    oracle: 'BUILD_SYNTAX',
                    status: 'EXECUTION_ERROR',
                    required,
                    durationMs:
                        performance.now() - startedAt,
                    summary:
                        'Il Build/Syntax Oracle è terminato ' +
                        'senza un exit code valido.',
                    evidence
                };
            }

            if (result.exitCode !== 0) {
                const diagnostic =
                    result.stderr.trim() ||
                    result.stdout.trim();

                return {
                    oracle: 'BUILD_SYNTAX',
                    status: 'FAIL',
                    required,
                    durationMs:
                        performance.now() - startedAt,
                    summary: diagnostic
                        ? `Il controllo Build/Syntax non è stato ` +
                        `superato: ${diagnostic.slice(0, 500)}`
                        : `Il controllo Build/Syntax non è stato ` +
                        `superato, exit code ${result.exitCode}.`,
                    evidence
                };
            }

            return {
                oracle: 'BUILD_SYNTAX',
                status: 'PASS',
                required,
                durationMs:
                    performance.now() - startedAt,
                summary:
                    'Il controllo Build/Syntax configurato ' +
                    'dal task è stato superato.',
                evidence
            };
        } catch (error: unknown) {
            const executionError =
                this.errorMessage(error);

            return {
                oracle: 'BUILD_SYNTAX',
                status: 'EXECUTION_ERROR',
                required,
                durationMs:
                    performance.now() - startedAt,
                summary:
                    `Il Build/Syntax Oracle non ha completato ` +
                    `correttamente l’esecuzione: ${executionError}`,
                evidence: {
                    command,
                    args,
                    cwd: executionCwd,
                    timeoutMs,
                    envAllowList,
                    exitCode: null,
                    timedOut: false,
                    stdout: '',
                    stderr: '',
                    stdoutTruncated: false,
                    stderrTruncated: false,
                    executionError
                }
            };
        }
    }

    private resolveExecutionCwd(
        configuredCwd?: string
    ): string {
        const repositoryRoot =
            path.resolve(this.repoRoot);

        if (
            configuredCwd &&
            (
                path.isAbsolute(configuredCwd) ||
                path.win32.isAbsolute(configuredCwd)
            )
        ) {
            throw new Error(
                'cwd deve essere un percorso relativo al repository.'
            );
        }

        const executionCwd = configuredCwd
            ? path.resolve(repositoryRoot, configuredCwd)
            : repositoryRoot;

        const relativePath = path.relative(
            repositoryRoot,
            executionCwd
        );

        const outsideRepository =
            relativePath === '..' ||
            relativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativePath);

        if (outsideRepository) {
            throw new Error(
                `cwd esce dal repository: ` +
                `${configuredCwd ?? '.'}`
            );
        }

        const segments = relativePath
            .replaceAll('\\', '/')
            .split('/')
            .filter((segment) => segment.length > 0);

        if (segments.some((segment) => segment.toLowerCase() === '.git')) {
            throw new Error(
                'cwd non può puntare alla directory .git.'
            );
        }

        const realRepositoryRoot =
            fs.realpathSync(repositoryRoot);

        const realExecutionCwd =
            fs.realpathSync(executionCwd);

        const realRelativePath = path.relative(
            realRepositoryRoot,
            realExecutionCwd
        );

        const resolvesOutsideRepository =
            realRelativePath === '..' ||
            realRelativePath.startsWith(`..${path.sep}`) ||
            path.isAbsolute(realRelativePath);

        if (resolvesOutsideRepository) {
            throw new Error(
                `cwd risolve fuori dal repository: ` +
                `${configuredCwd ?? '.'}`
            );
        }

        const realSegments = realRelativePath
            .replaceAll('\\', '/')
            .split('/')
            .filter((segment) => segment.length > 0);

        if (realSegments.some((segment) => segment.toLowerCase() === '.git')) {
            throw new Error(
                'cwd non può puntare alla directory .git (risolto).'
            );
        }

        const stats =
            fs.statSync(realExecutionCwd);

        if (!stats.isDirectory()) {
            throw new Error(
                `cwd non identifica una directory: ` +
                `${configuredCwd ?? '.'}`
            );
        }

        return realExecutionCwd;
    }

    private errorMessage(
        error: unknown
    ): string {
        return error instanceof Error
            ? error.message
            : String(error);
    }
}
