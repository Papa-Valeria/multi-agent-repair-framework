import { OpenAICompatibleClient, type ChatMessage } from '../inference/OpenAICompatibleClient.js';
import type {
  OracleResult,
  ReviewerFeedbackPayload,
  ReviewerReviewResult,
  SastFinding,
  TargetRemediation,
  TestExecutionReport
} from '../types/domain.js';
import type { ExperimentCategory } from '../types/analytics.js';
import { DEFAULT_PROMPT_PROFILE } from '../inference/PromptProfile.js';
import type { PromptProfile } from '../inference/PromptProfile.js';


export interface ReviewerReviewParams {
  readonly buildSyntax: OracleResult<'BUILD_SYNTAX'>;
  readonly sastFindings: readonly SastFinding[];
  readonly testReport: TestExecutionReport;
  readonly flappingDetected: boolean;
  readonly targetFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly category: ExperimentCategory;
}

interface ReviewerRemediationCandidate {
  readonly file: string;

  readonly lineRange: {
    readonly start: number;
    readonly end: number;
  };

  readonly rootCause: string;
  readonly mandatoryCorrection: string;
  readonly relatedRuleId?: string;
}

interface ReviewerResponseCandidate {
  readonly rootCauseSummary: string;
  readonly targetRemediations:
  readonly ReviewerRemediationCandidate[];
}

export class ReviewerAgent {
  constructor(
    private readonly client: OpenAICompatibleClient,
    private readonly promptProfile: PromptProfile = DEFAULT_PROMPT_PROFILE
  ) { }

  private static isRecord(
    value: unknown
  ): value is Record<string, unknown> {
    return (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    );
  }

  private static normalizePath(
    value: string
  ): string {
    return value
      .trim()
      .replaceAll('\\', '/')
      .replace(/^\.\//, '');
  }

  private static extractJsonPayload(
    rawResponse: string
  ): string {
    const trimmed =
      rawResponse.trim();

    if (
      trimmed.length === 0
    ) {
      throw new Error(
        'La risposta del Reviewer è vuota.'
      );
    }

    if (
      trimmed.startsWith('{') &&
      trimmed.endsWith('}')
    ) {
      return trimmed;
    }

    const fencedMatch =
      /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(
        trimmed
      );

    if (
      fencedMatch?.[1] === undefined
    ) {
      throw new Error(
        'La risposta del Reviewer deve contenere esclusivamente un oggetto JSON o un singolo blocco JSON.'
      );
    }

    const fencedPayload =
      fencedMatch[1].trim();

    if (
      !fencedPayload.startsWith('{') ||
      !fencedPayload.endsWith('}')
    ) {
      throw new Error(
        'Il blocco JSON del Reviewer non contiene un oggetto JSON completo.'
      );
    }

    return fencedPayload;
  }

  private static parseJsonObject(
    jsonPayload: string
  ): unknown {
    try {
      return JSON.parse(jsonPayload) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Errore durante il parsing del JSON del Reviewer: ${message}`
      );
    }
  }

  private static parseRemediationCandidate(
    value: unknown,
    index: number
  ): ReviewerRemediationCandidate {
    if (!ReviewerAgent.isRecord(value)) {
      throw new Error(
        `targetRemediations[${index}] deve essere un oggetto.`
      );
    }
    const file = value.file;
    if (typeof file !== 'string' || file.trim() === '') {
      throw new Error(
        `targetRemediations[${index}].file deve essere una stringa non vuota.`
      );
    }
    const rootCause = value.rootCause;
    if (typeof rootCause !== 'string' || rootCause.trim().length === 0) {
      throw new Error(
        `targetRemediations[${index}].rootCause deve essere una stringa non vuota.`
      );
    }
    const mandatoryCorrection = value.mandatoryCorrection;
    if (typeof mandatoryCorrection !== 'string' || mandatoryCorrection.trim().length === 0) {
      throw new Error(
        `targetRemediations[${index}].mandatoryCorrection deve essere una stringa non vuota.`
      );
    }
    const lineRange = value.lineRange;
    if (!ReviewerAgent.isRecord(lineRange)) {
      throw new Error(
        `targetRemediations[${index}].lineRange deve essere un oggetto.`
      );
    }
    const start = lineRange.start;
    if (typeof start !== 'number' || !Number.isInteger(start) || start <= 0) {
      throw new Error(
        `targetRemediations[${index}].lineRange.start deve essere un numero positivo.`
      );
    }
    const end = lineRange.end;
    if (typeof end !== 'number' || !Number.isInteger(end) || end < start) {
      throw new Error(
        `targetRemediations[${index}].lineRange.end deve essere un intero maggiore o uguale a start.`
      );
    }
    const relatedRuleId = value.relatedRuleId;
    if (relatedRuleId !== undefined && typeof relatedRuleId !== 'string') {
      throw new Error(
        `targetRemediations[${index}].relatedRuleId deve essere una stringa quando presente.`
      );
    }
    const normalizedRelatedRuleId = typeof relatedRuleId === 'string' ? relatedRuleId.trim() : '';
    return {
      file: file.trim(),
      lineRange: {
        start,
        end
      },
      rootCause: rootCause.trim(),
      mandatoryCorrection: mandatoryCorrection.trim(),
      ...(normalizedRelatedRuleId ? { relatedRuleId: normalizedRelatedRuleId } : {})
    };
  }

  private static parseReviewerResponse(value: unknown): ReviewerResponseCandidate {
    if (!ReviewerAgent.isRecord(value)) {
      throw new Error(
        `La risposta JSON del Reviewer deve essere un oggetto.`
      );
    }
    const rootCauseSummary = value.rootCauseSummary;
    if (typeof rootCauseSummary !== 'string' || rootCauseSummary.trim().length === 0) {
      throw new Error(
        `rootCauseSummary deve essere una stringa non vuota.`
      );
    }
    const targetRemediations = value.targetRemediations;
    if (!Array.isArray(targetRemediations)) {
      throw new Error(
        `targetRemediations deve essere un array.`
      );
    }
    if (targetRemediations.length === 0) {
      throw new Error(
        `targetRemediations deve contenere almeno una remediation.`
      );
    }
    return {
      rootCauseSummary: rootCauseSummary.trim(),
      targetRemediations: targetRemediations.map((remediation, index) => ReviewerAgent.parseRemediationCandidate(remediation, index))
    };
  }

  public pruneAndAggregate(sastFindings: readonly SastFinding[], testReport: TestExecutionReport): {
    readonly criticalFindings: readonly SastFinding[];
    readonly conciseTestErrors: ReadonlyArray<{
      readonly test: string;
      readonly message: string;
      readonly actualExpected?: string | undefined;
    }>;
  } {
    const errorTier = sastFindings.filter((f) => f.severity === 'ERROR');
    const criticalFindings = errorTier.length > 0 ? errorTier : sastFindings.slice(0, 5);
    const conciseTestErrors = testReport.failureDetails.map((f) => {
      const baseEntry = {
        test: f.testName,
        message: f.assertionMessage.slice(0, 300)
      };

      if (f.expected !== undefined && f.actual !== undefined) {
        return {
          ...baseEntry,
          actualExpected: `Exp: ${f.expected} | Act: ${f.actual}`
        };
      }

      return baseEntry;
    });

    return { criticalFindings, conciseTestErrors };
  }

  private containsProtectedOracleMutation(rootCause: string, mandatoryCorrection: string): boolean {
    const text = `${rootCause}\n${mandatoryCorrection}`.toLowerCase();

    const protectedMutationPatterns: readonly RegExp[] = [
      /\b(?:change|replace|modify|update|remove|delete|rewrite|fix)\b[\s\S]{0,80}\bassert(?:ion)?\b/i,
      /\b(?:change|replace|modify|update|remove|delete|rewrite|fix)\b[\s\S]{0,80}\btests?\b/i,
      /\b(?:change|replace|modify|update|remove|delete|rewrite|fix)\b[\s\S]{0,80}\btest[_\-.a-z0-9]*\.(?:py|ts|tsx|js|jsx|java)\b/i,
      /\bassert\s+false\s+is\s+true\b/i,
      /\bassert\s+true\s+is\s+true\b/i,
      /\bmodify\b[\s\S]{0,40}\boracle\b/i
    ];

    return protectedMutationPatterns.some((pattern) => pattern.test(text));
  }

  private static createRemediationKey(
    remediation: TargetRemediation
  ): string {
    const normalizedFile =
      ReviewerAgent.normalizePath(
        remediation.file
      ).toLowerCase();

    const normalizedRuleId =
      remediation.relatedRuleId
        ?.trim()
        .toLowerCase() ??
      '';

    const normalizedCorrection =
      remediation.mandatoryCorrection
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');

    return [
      normalizedFile,
      normalizedRuleId,
      normalizedCorrection
    ].join('|');
  }

  private filterAllowedRemediations(
    remediations: readonly TargetRemediation[],
    targetFiles: readonly string[],
    testFiles: readonly string[],
    category: ExperimentCategory
  ): TargetRemediation[] {
    const normalizedTargetFiles =
      targetFiles.map(
        ReviewerAgent.normalizePath
      );

    const normalizedTestFiles =
      testFiles.map(
        ReviewerAgent.normalizePath
      );

    const allowedRemediations =
      remediations.flatMap(
        (
          remediation
        ): readonly TargetRemediation[] => {
          const normalizedFile =
            ReviewerAgent.normalizePath(
              remediation.file
            );

          if (
            normalizedFile.length === 0
          ) {
            return [];
          }

          const isProtectedTestFile =
            normalizedTestFiles.includes(
              normalizedFile
            );

          if (
            isProtectedTestFile
          ) {
            return [];
          }

          const isAllowedSourceFile =
            category === 'CREATE' ||
            normalizedTargetFiles.includes(
              normalizedFile
            );

          if (
            !isAllowedSourceFile
          ) {
            return [];
          }

          const proposesProtectedOracleMutation =
            this.containsProtectedOracleMutation(
              remediation.rootCause,
              remediation.mandatoryCorrection
            );

          if (
            proposesProtectedOracleMutation
          ) {
            return [];
          }

          return [
            {
              ...remediation,

              file:
                normalizedFile
            }
          ];
        }
      );

    const seenKeys =
      new Set<string>();

    return allowedRemediations.filter(
      (remediation) => {
        const key =
          ReviewerAgent.createRemediationKey(
            remediation
          );

        if (
          seenKeys.has(key)
        ) {
          return false;
        }

        seenKeys.add(
          key
        );

        return true;
      }
    );
  }

  public async review(params: ReviewerReviewParams): Promise<ReviewerReviewResult> {
    const { buildSyntax, sastFindings, testReport, flappingDetected, targetFiles, testFiles, category } = params;
    const { criticalFindings, conciseTestErrors } = this.pruneAndAggregate(sastFindings, testReport);
    const functionalTestFailures = testReport.oracleStatus === 'FAIL' ? conciseTestErrors : [];
    const buildDiagnostic = buildSyntax.status === 'FAIL' ? {
      status: buildSyntax.status,
      command: buildSyntax.evidence.command,
      args: buildSyntax.evidence.args,
      cwd: buildSyntax.evidence.cwd,
      timeoutMs: buildSyntax.evidence.timeoutMs,
      exitCode: buildSyntax.evidence.exitCode,
      summary: buildSyntax.summary,
      stderr: buildSyntax.evidence.stderr.trim().slice(0, 2_000),
      stdout: buildSyntax.evidence.stdout.trim().slice(0, 2_000)
    } : {
      status: buildSyntax.status,
      summary: buildSyntax.summary
    };

    const inputData = {
      category,
      targetFiles,
      flappingDetected,
      buildSyntax: buildDiagnostic,
      staticAnalysisErrors: criticalFindings.map((f) => ({
        rule: f.ruleId,
        path: f.path,
        lines: `${f.startLine}-${f.endLine}`,
        violation: f.message
      })),
      functionalTests: {
        status: testReport.oracleStatus,
        failures: functionalTestFailures
      }
    };

    const modeDirective = category === 'CREATE'
      ? this.promptProfile.reviewer.createModeDirective
      : this.promptProfile.reviewer.repairModeDirective;
    const messages: readonly ChatMessage[] = [
      { role: 'system', content: this.promptProfile.reviewer.systemInstructions },
      {
        role: 'user',
        content: `Execution mode: ${category}.
        ${modeDirective}
        ${this.promptProfile.reviewer.responseInstructions}
Diagnostic data:
${JSON.stringify(inputData, null, 2)}`
      }
    ];

    try {
      const raw = await this.client.completeChat(messages, 'REVIEWER');
      console.debug('[ReviewerAgent] Raw response:', raw);
      const jsonPayload = ReviewerAgent.extractJsonPayload(raw);
      const rawParsed = ReviewerAgent.parseJsonObject(jsonPayload);
      const validatedResponse = ReviewerAgent.parseReviewerResponse(rawParsed);
      const candidateRemediations:
        TargetRemediation[] =
        validatedResponse.targetRemediations.map(
          (remediation) => ({
            file:
              remediation.file,

            lineRange:
              remediation.lineRange,

            rootCause:
              remediation.rootCause,

            mandatoryCorrection:
              remediation.mandatoryCorrection,

            ...(remediation.relatedRuleId !== undefined
              ? {
                relatedRuleId:
                  remediation.relatedRuleId
              }
              : {})
          })
        );
      const normalizedRemediations = this.filterAllowedRemediations(
        candidateRemediations,
        targetFiles,
        testFiles,
        category
      );


      const parsed: ReviewerFeedbackPayload = {
        rootCauseSummary: validatedResponse.rootCauseSummary,
        violationsPrunedCount: Math.max(0, sastFindings.length - criticalFindings.length),
        targetRemediations: normalizedRemediations,
        securityPriorityStrict: true,
        flappingDetected
      };

      if (parsed.targetRemediations.length === 0) {
        throw new Error('Nessuna targetRemediation valida dopo la normalizzazione e l’applicazione delle policy.');
      }

      return {
        feedback: parsed,
        reviewerMode: 'LLM'
      };
    } catch (err: unknown) {
      const rawFallbackReason = err instanceof Error ? err.message : String(err);
      const fallbackReason = rawFallbackReason.trim().length > 0
        ? rawFallbackReason.trim()
        : 'Errore Reviewer non specificato durante inferenza o parsing.';
      console.warn('[ReviewerAgent] Errore inferenza o parsing JSON, attivazione fallback deterministico:', fallbackReason);
      const remediations: TargetRemediation[] = [];
      const fallbackFile = targetFiles[0] ?? 'unknown';

      if (buildSyntax.status === 'FAIL') {
        const diagnostic = buildSyntax.evidence.stderr.trim() || buildSyntax.evidence.stdout.trim() || buildSyntax.summary;
        remediations.push({
          file: fallbackFile,
          lineRange: { start: 1, end: 1 },
          rootCause: `Build/Syntax Oracle non superato: ${diagnostic.slice(0, 500)}`,
          mandatoryCorrection: 'Correggere il codice sorgente affinché il comando Build/Syntax configurato dal task termini con exit code 0, senza modificare test, comando di build o configurazione dell’oracolo.',
        });
      }

      for (const f of criticalFindings) {
        remediations.push({
          file: f.path,
          lineRange: { start: f.startLine, end: f.endLine },
          rootCause: `Violazione regola SAST ${f.ruleId}: ${f.message}`,
          mandatoryCorrection: `Eliminare la violazione ${f.ruleId} alle righe ${f.startLine}-${f.endLine} senza alterare il comportamento atteso dai test.`,
          relatedRuleId: f.ruleId
        });
      }

      if (testReport.oracleStatus === 'FAIL') {
        const failure = testReport.failureDetails[0];
        remediations.push({
          file: fallbackFile,
          lineRange: { start: 1, end: 1 },
          rootCause: failure
            ? `Il test funzionale ${failure.testName} non è stato superato dal comportamento corrente del codice sorgente.`
            : 'La suite di test funzionale non è stata superata dal comportamento corrente del codice sorgente.',
          mandatoryCorrection: category === 'CREATE'
            ? 'Correggere l’implementazione della nuova funzionalità affinché la suite di test passi, intervenendo sui file sorgente pertinenti senza modificare i test.'
            : 'Correggere il codice sorgente target in modo che la suite di test passi, mantenendo sintassi valida e rispettando le asserzioni riportate.'
        });
      }

      const buildFailed = buildSyntax.status === 'FAIL';
      const testsFailed = testReport.oracleStatus === 'FAIL';
      const sastFailed = criticalFindings.length > 0;
      const summary = buildFailed ? testsFailed || sastFailed
        ? 'Il controllo Build/Syntax e uno o più ulteriori gate di verifica non sono stati superati.'
        : `Fallimento Build/Syntax: ${buildSyntax.summary}`
        : testsFailed && sastFailed
          ? 'Rilevate sia violazioni SAST sia fallimenti della suite di test.'
          : testsFailed
            ? `Fallimento funzionale: ${testReport.failureDetails[0]?.assertionMessage ?? 'suite di test non superata'}`
            : sastFailed
              ? 'Rilevate violazioni di sicurezza SAST.'
              : 'Il Reviewer non ha individuato una remediation deterministica nei dati disponibili.';

      const hasSourceFailure = buildSyntax.status === 'FAIL' || testReport.oracleStatus === 'FAIL' || criticalFindings.length > 0;
      if (remediations.length === 0 && hasSourceFailure) {
        remediations.push({
          file: fallbackFile,
          lineRange: { start: 1, end: 1 },
          rootCause: 'Uno o più gate di verifica non sono stati superati, ma non è stata ricavata una localizzazione sorgente affidabile.',
          mandatoryCorrection: 'Correggere il codice sorgente target in base alle evidenze degli oracle senza modificare test, comando di build o configurazione dell’infrastruttura.'
        });
      }

      const filteredFallbackRemediations =
        this.filterAllowedRemediations(
          remediations,
          targetFiles,
          testFiles,
          category
        );

      if (
        filteredFallbackRemediations.length === 0
      ) {
        throw new Error(
          `Nessuna remediation sorgente deterministica autorizzata disponibile: ` +
          `Build/Syntax=${buildSyntax.status}, ` +
          `Functional Test=${testReport.oracleStatus}.`
        );
      }

      const feedback:
        ReviewerFeedbackPayload = {
        rootCauseSummary:
          summary,

        violationsPrunedCount:
          Math.max(
            0,
            sastFindings.length -
            criticalFindings.length
          ),

        targetRemediations:
          filteredFallbackRemediations,

        securityPriorityStrict:
          true,

        flappingDetected
      };
      return {
        feedback,
        reviewerMode: 'DETERMINISTIC_FALLBACK',
        fallbackReason
      };
    }
  }
}
