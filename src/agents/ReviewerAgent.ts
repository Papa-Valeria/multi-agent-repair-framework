import { OpenAICompatibleClient, ChatMessage } from '../inference/OpenAICompatibleClient.js';
import { SastFinding, TestExecutionReport, ReviewerFeedbackPayload } from '../types/domain.js';

type MutableRemediation = {
  readonly file: string;
  readonly lineRange: { readonly start: number; readonly end: number };
  readonly rootCause: string;
  readonly mandatoryCorrection: string;
  readonly relatedRuleId?: string;
};

export class ReviewerAgent {
  private static readonly SYSTEM_PROMPT =
`You are a specialized diagnostic review agent in an automated program repair pipeline.
Your role is to inspect the provided static analysis violations (Semgrep) and dynamic test failures, identifying the precise root cause of the regression.
Operational Constraints:
1. Output MUST strictly adhere to the defined JSON schema. Do not generate markdown explanations outside the JSON object.
2. Formulate targeted, line-specific corrective guidance for the Coder agent.
3. For each failure, indicate: (a) the root cause, (b) the target file and line range, (c) the minimal structural correction required.
4. Do not suggest complete rewrites; prescribe only the minimal diff necessary to satisfy deterministic oracles.`;

  constructor(private readonly client: OpenAICompatibleClient) {}

  /**
   * Diagnostic Pruning e aggregazione deterministica per prevenire dispersione attenzionale.
   */
  public pruneAndAggregate(
    sastFindings: readonly SastFinding[],
    testReport: TestExecutionReport
  ): {
    readonly criticalFindings: readonly SastFinding[];
    readonly conciseTestErrors: ReadonlyArray<{
      readonly test: string;
      readonly message: string;
      readonly actualExpected?: string | undefined;
    }>;
  } {
    // 1. Deduplicazione e prioritizzazione severità (Error > Warning)
    const errorTier = sastFindings.filter((f) => f.severity === 'ERROR');
    const criticalFindings = errorTier.length > 0 ? errorTier : sastFindings.slice(0, 5);

    // 2. Estrazione selettiva conforme a exactOptionalPropertyTypes
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

  public async review(
    sastFindings: readonly SastFinding[],
    testReport: TestExecutionReport,
    flappingDetected: boolean,
    targetFiles: readonly string[] = []
  ): Promise<ReviewerFeedbackPayload> {
    const { criticalFindings, conciseTestErrors } = this.pruneAndAggregate(sastFindings, testReport);

    const inputData = {
      flappingDetected,
      staticAnalysisErrors: criticalFindings.map((f) => ({
        rule: f.ruleId,
        path: f.path,
        lines: `${f.startLine}-${f.endLine}`,
        violation: f.message
      })),
      testFailures: conciseTestErrors
    };

    const messages: readonly ChatMessage[] = [
      { role: 'system', content: ReviewerAgent.SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Inspect violations and return ONLY valid JSON matching ReviewerFeedbackPayload schema:\n${JSON.stringify(inputData, null, 2)}`
      }
    ];

    try {
      const raw = await this.client.completeChat(messages, 'REVIEWER');

      // Estrazione del blocco JSON tollerando testo discorsivo o markdown
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Nessun blocco JSON individuato nella risposta del Reviewer.');
      }

      const rawParsed = JSON.parse(jsonMatch[0]) as any;
      const remediationsList = rawParsed.targetRemediations || rawParsed.remediations || rawParsed.target_remediations || [];
      const parsed: ReviewerFeedbackPayload = {
        rootCauseSummary: rawParsed.rootCauseSummary || rawParsed.summary || 'Analisi diagnostica del Reviewer completata.',
        violationsPrunedCount: rawParsed.violationsPrunedCount ?? 0,
        targetRemediations: Array.isArray(remediationsList) ? remediationsList : [],
        securityPriorityStrict: rawParsed.securityPriorityStrict ?? true,
        flappingDetected
      };

      if (parsed.targetRemediations.length === 0) {
        throw new Error('targetRemediations vuoto o non strutturato.');
      }

      return parsed;
    } catch (err: unknown) {
      console.warn('[ReviewerAgent] Errore inferenza o parsing JSON, attivazione fallback deterministico:', (err as Error)?.message);
      // Fallback uguale per ogni modello: riporta solo i risultati degli oracle, senza indicare la soluzione.
      const remediations: MutableRemediation[] = [];
      const fallbackFile = targetFiles[0] ?? 'unknown';

      for (const f of criticalFindings) {
        remediations.push({
          file: f.path,
          lineRange: { start: f.startLine, end: f.endLine },
          rootCause: `Violazione regola SAST ${f.ruleId}: ${f.message}`,
          mandatoryCorrection: `Eliminare la violazione ${f.ruleId} alle righe ${f.startLine}-${f.endLine} senza alterare il comportamento atteso dai test.`,
          relatedRuleId: f.ruleId
        });
      }

      if (!testReport.suitePassed) {
        const failure = testReport.failureDetails[0];
        const failureMsg = failure?.assertionMessage || 'Fallimento della suite di test';
        remediations.push({
          file: fallbackFile,
          lineRange: { start: 1, end: 1 },
          rootCause: `${failure?.testName ?? 'TestFailure'}: ${failureMsg}`,
          mandatoryCorrection: 'Correggere il codice sorgente target in modo che la suite di test passi, mantenendo sintassi valida e rispettando le asserzioni riportate.'
        });
      }

      const summary = !testReport.suitePassed && criticalFindings.length > 0
        ? 'Rilevate sia violazioni SAST sia fallimenti della suite di test.'
        : !testReport.suitePassed
          ? `Fallimento funzionale: ${testReport.failureDetails[0]?.assertionMessage || 'suite di test non superata'}`
          : 'Rilevate violazioni di sicurezza SAST.';

      return {
        rootCauseSummary: summary,
        violationsPrunedCount: Math.max(0, sastFindings.length - criticalFindings.length),
        targetRemediations: remediations,
        securityPriorityStrict: true,
        flappingDetected
      };
    }
  }
}
