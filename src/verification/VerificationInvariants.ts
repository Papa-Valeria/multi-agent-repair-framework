import type {
  AgentRole,
  AgentUsage,
  ComputationalTelemetry,
  OracleProfile,
  OracleResult,
  TestExecutionReport,
  VerificationVerdict,
  WorkbenchSessionState
} from '../types/domain.js';
import {
  DEFAULT_ORACLE_PROFILE,
  decideOracleResults
} from './OracleDecision.js';
import {
  isDeepStrictEqual
} from 'node:util';

export class VerificationInvariantError extends Error {
  constructor(
    message: string,
    readonly violations: readonly string[]
  ) {
    super(message);
    this.name = 'VerificationInvariantError';
  }
}

function assertNoViolations(
  context: string,
  violations: readonly string[]
): void {
  if (violations.length === 0) {
    return;
  }

  throw new VerificationInvariantError(
    `${context}: ${violations.join('; ')}`,
    violations
  );
}

function appendTokenUsageViolations(
  violations: string[],
  context: string,
  usage: {
    readonly promptTokens: number | null;
    readonly completionTokens: number | null;
    readonly tokenUsageAvailable: boolean;
  }
): void {
  if (usage.tokenUsageAvailable) {
    if (
      usage.promptTokens === null ||
      !Number.isInteger(
        usage.promptTokens
      ) ||
      usage.promptTokens < 0
    ) {
      violations.push(
        `${context}.promptTokens deve essere ` +
        `un intero non negativo quando ` +
        `tokenUsageAvailable=true`
      );
    }

    if (
      usage.completionTokens === null ||
      !Number.isInteger(
        usage.completionTokens
      ) ||
      usage.completionTokens < 0
    ) {
      violations.push(
        `${context}.completionTokens deve essere ` +
        `un intero non negativo quando ` +
        `tokenUsageAvailable=true`
      );
    }

    return;
  }

  if (
    usage.promptTokens !== null
  ) {
    violations.push(
      `${context}.promptTokens deve essere null ` +
      `quando tokenUsageAvailable=false`
    );
  }

  if (
    usage.completionTokens !== null
  ) {
    violations.push(
      `${context}.completionTokens deve essere null ` +
      `quando tokenUsageAvailable=false`
    );
  }
}

function appendFiniteNonNegativeViolation(
  violations: string[],
  fieldName: string,
  value: number
): void {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    violations.push(
      `${fieldName} deve essere finito e non negativo`
    );
  }
}

function appendBlockedResultViolations(
  violations: string[],
  result: OracleResult
): void {
  if (result.status === 'BLOCKED') {
    if (
      result.blockedBy === undefined
    ) {
      violations.push(
        `${result.oracle} BLOCKED richiede blockedBy`
      );
    }

    if (
      result.blockedReason === undefined ||
      result.blockedReason.trim().length === 0
    ) {
      violations.push(
        `${result.oracle} BLOCKED richiede ` +
        `blockedReason non vuoto`
      );
    }

    if (result.durationMs !== 0) {
      violations.push(
        `${result.oracle} BLOCKED richiede ` +
        `durationMs=0`
      );
    }

    return;
  }

  if (result.blockedBy !== undefined) {
    violations.push(
      `${result.oracle} con status=${result.status} ` +
      `non può dichiarare blockedBy`
    );
  }

  if (result.blockedReason !== undefined) {
    violations.push(
      `${result.oracle} con status=${result.status} ` +
      `non può dichiarare blockedReason`
    );
  }
}

function appendOracleDurationViolations(
  violations: string[],
  context: string,
  oracleDurationMs: number | null,
  oracleDurationAvailable: boolean
): void {
  if (
    typeof oracleDurationAvailable !==
    'boolean'
  ) {
    violations.push(
      `${context}.oracleDurationAvailable deve essere boolean`
    );

    return;
  }

  if (
    oracleDurationAvailable
  ) {
    if (
      oracleDurationMs === null
    ) {
      violations.push(
        `${context}.oracleDurationMs deve essere presente ` +
        `quando oracleDurationAvailable=true`
      );

      return;
    }

    appendFiniteNonNegativeViolation(
      violations,
      `${context}.oracleDurationMs`,
      oracleDurationMs
    );

    return;
  }

  if (
    oracleDurationMs !== null
  ) {
    violations.push(
      `${context}.oracleDurationMs deve essere null ` +
      `quando oracleDurationAvailable=false`
    );
  }
}

function agentUsageViolations(
  usage: Readonly<Record<AgentRole, AgentUsage>>,
  context: string
): string[] {
  const violations: string[] = [];

  const roles: readonly AgentRole[] = [
    'CODER',
    'REVIEWER'
  ];

  for (const role of roles) {
    const agentUsage =
      usage[role];

    appendTokenUsageViolations(
      violations,
      `${context}.${role}`,
      agentUsage
    );

    appendFiniteNonNegativeViolation(
      violations,
      `${context}.${role}.inferenceDurationMs`,
      agentUsage.inferenceDurationMs
    );
  }

  return violations;
}

export function assertAgentUsageInvariants(
  usage: Readonly<Record<AgentRole, AgentUsage>>
): void {
  assertNoViolations(
    'AgentUsage incoerente',
    agentUsageViolations(
      usage,
      'agentUsage'
    )
  );
}

export function assertComputationalTelemetryInvariants(
  telemetry: ComputationalTelemetry
): void {
  const violations: string[] = [];

  appendTokenUsageViolations(
    violations,
    'telemetry',
    telemetry
  );

  appendFiniteNonNegativeViolation(
    violations,
    'telemetry.inferenceDurationMs',
    telemetry.inferenceDurationMs
  );

  appendOracleDurationViolations(
    violations,
    'telemetry',
    telemetry.oracleDurationMs,
    telemetry.oracleDurationAvailable
  );

  appendFiniteNonNegativeViolation(
    violations,
    'telemetry.orchestrationOverheadMs',
    telemetry.orchestrationOverheadMs
  );

  appendFiniteNonNegativeViolation(
    violations,
    'telemetry.totalDurationMs',
    telemetry.totalDurationMs
  );

  violations.push(
    ...agentUsageViolations(
      telemetry.agentUsage,
      'telemetry.agentUsage'
    )
  );

  assertNoViolations(
    'ComputationalTelemetry incoerente',
    violations
  );
}

function reportStateViolations(
  report: TestExecutionReport
): string[] {
  const violations: string[] = [];

  const counters = [
    ['totalTests', report.totalTests],
    ['passedTests', report.passedTests],
    ['failedTests', report.failedTests],
    ['skippedTests', report.skippedTests],
    ['xfailedTests', report.xfailedTests],
    ['xpassedTests', report.xpassedTests],
    ['errorTests', report.errorTests]
  ] as const;

  for (const [name, value] of counters) {
    if (!Number.isInteger(value) || value < 0) {
      violations.push(`${name} deve essere un intero non negativo`);
    }
  }

  const expectedTotalTests =
    report.passedTests +
    report.failedTests +
    report.skippedTests +
    report.xfailedTests +
    report.xpassedTests +
    report.errorTests;

  if (report.totalTests !== expectedTotalTests) {
    violations.push(
      `totalTests=${report.totalTests} non coincide con ` +
      `la somma degli outcome=${expectedTotalTests}`
    );
  }

  const expectedPassRate =
    report.totalTests > 0
      ? report.passedTests / report.totalTests
      : 0;

  if (
    Number.isFinite(report.passRate) &&
    Math.abs(
      report.passRate - expectedPassRate
    ) > 1e-9
  ) {
    violations.push(
      `passRate=${report.passRate} non coincide con ` +
      `passedTests/totalTests=${expectedPassRate}`
    );
  }

  if (
    !Number.isFinite(report.passRate) ||
    report.passRate < 0 ||
    report.passRate > 1
  ) {
    violations.push('passRate deve essere compreso tra 0 e 1');
  }

  if (
    !Number.isFinite(report.durationMs) ||
    report.durationMs < 0
  ) {
    violations.push('durationMs deve essere finito e non negativo');
  }

  if (
    !Number.isFinite(report.executionDurationMs) ||
    report.executionDurationMs < 0
  ) {
    violations.push(
      'executionDurationMs deve essere finito e non negativo'
    );
  }

  switch (report.oracleStatus) {
    case 'PASS': {
      if (!report.suitePassed) {
        violations.push('PASS richiede suitePassed=true');
      }
      if (report.oracleFailed) {
        violations.push('PASS richiede oracleFailed=false');
      }
      if (report.timedOut) {
        violations.push('PASS richiede timedOut=false');
      }
      if (report.totalTests <= 0) {
        violations.push('PASS richiede almeno un test eseguito');
      }
      if (report.passedTests !== report.totalTests) {
        violations.push('PASS richiede passedTests=totalTests');
      }
      if (
        report.failedTests !== 0 ||
        report.skippedTests !== 0 ||
        report.xfailedTests !== 0 ||
        report.xpassedTests !== 0 ||
        report.errorTests !== 0
      ) {
        violations.push(
          'PASS richiede zero failed, skipped, xfailed, xpassed ed errors'
        );
      }
      if (report.passRate !== 1) {
        violations.push('PASS richiede passRate=1');
      }
      if (report.exitCode === null) {
        violations.push(
          'PASS richiede un exitCode valido'
        );
      }

      if (
        report.expectedExitPolicy === null
      ) {
        violations.push(
          'PASS richiede una expectedExitPolicy'
        );
      } else if (
        report.exitCode === null ||
        !report.expectedExitPolicy
          .passExitCodes
          .includes(report.exitCode)
      ) {
        violations.push(
          'PASS richiede un exitCode incluso nei passExitCodes'
        );
      }
      break;
    }

    case 'FAIL': {
      if (report.suitePassed) {
        violations.push(
          'FAIL richiede suitePassed=false'
        );
      }

      if (report.oracleFailed) {
        violations.push(
          'FAIL richiede oracleFailed=false'
        );
      }

      if (report.timedOut) {
        violations.push(
          'FAIL richiede timedOut=false'
        );
      }

      if (report.exitCode === null) {
        violations.push(
          'FAIL richiede un exitCode valido'
        );
      }

      if (report.expectedExitPolicy === null) {
        violations.push(
          'FAIL richiede una expectedExitPolicy'
        );

        break;
      }

      if (report.exitCode === null) {
        break;
      }

      const isExpectedPassExit =
        report.expectedExitPolicy
          .passExitCodes
          .includes(report.exitCode);

      const isExpectedFailExit =
        report.expectedExitPolicy
          .failExitCodes
          .includes(report.exitCode);

      const isExecutionErrorExit =
        report.expectedExitPolicy
          .executionErrorExitCodes
          .includes(report.exitCode);

      if (
        !isExpectedPassExit &&
        !isExpectedFailExit
      ) {
        violations.push(
          'FAIL richiede un exitCode incluso nei ' +
          'passExitCodes o nei failExitCodes'
        );
      }

      if (isExecutionErrorExit) {
        violations.push(
          'FAIL non consente un exitCode classificato ' +
          'come execution error'
        );
      }

      if (isExpectedFailExit) {
        const hasObservedTestFailure =
          report.failedTests > 0 ||
          report.errorTests > 0;

        if (!hasObservedTestFailure) {
          violations.push(
            'FAIL con exitCode di fallimento richiede ' +
            'almeno un failedTests o errorTests'
          );
        }
      }

      if (isExpectedPassExit) {
        const hasStrictPolicyViolation =
          report.skippedTests > 0 ||
          report.xfailedTests > 0 ||
          report.xpassedTests > 0;

        if (!hasStrictPolicyViolation) {
          violations.push(
            'FAIL con exitCode di successo richiede ' +
            'almeno uno skipped, xfailed o xpassed'
          );
        }

        if (
          report.failedTests > 0 ||
          report.errorTests > 0
        ) {
          violations.push(
            'FAIL con exitCode di successo non può ' +
            'contenere failedTests o errorTests'
          );
        }
      }

      break;
    }

    case 'NOT_AVAILABLE': {
      if (report.suitePassed) {
        violations.push('NOT_AVAILABLE richiede suitePassed=false');
      }
      if (report.oracleFailed) {
        violations.push('NOT_AVAILABLE richiede oracleFailed=false');
      }
      if (report.timedOut) {
        violations.push('NOT_AVAILABLE richiede timedOut=false');
      }
      if (report.exitCode !== null) {
        violations.push('NOT_AVAILABLE richiede exitCode=null');
      }
      if (
        report.totalTests !== 0 ||
        report.passedTests !== 0 ||
        report.failedTests !== 0 ||
        report.skippedTests !== 0 ||
        report.xfailedTests !== 0 ||
        report.xpassedTests !== 0 ||
        report.errorTests !== 0
      ) {
        violations.push('NOT_AVAILABLE richiede conteggi test pari a zero');
      }
      if (report.passRate !== 0) {
        violations.push('NOT_AVAILABLE richiede passRate=0');
      }
      break;
    }

    case 'EXECUTION_ERROR': {
      if (report.suitePassed) {
        violations.push('EXECUTION_ERROR richiede suitePassed=false');
      }
      if (!report.oracleFailed) {
        violations.push('EXECUTION_ERROR richiede oracleFailed=true');
      }
      break;
    }

    case 'BLOCKED': {
      if (report.suitePassed) {
        violations.push(
          'BLOCKED richiede suitePassed=false'
        );
      }

      if (report.oracleFailed) {
        violations.push(
          'BLOCKED richiede oracleFailed=false'
        );
      }

      if (report.timedOut) {
        violations.push(
          'BLOCKED richiede timedOut=false'
        );
      }

      if (report.exitCode !== null) {
        violations.push(
          'BLOCKED richiede exitCode=null'
        );
      }

      if (report.expectedExitPolicy !== null) {
        violations.push(
          'BLOCKED richiede expectedExitPolicy=null'
        );
      }

      if (
        report.command !== null ||
        report.cwd !== null ||
        report.timeoutMs !== null
      ) {
        violations.push(
          'BLOCKED non consente configurazione di ' +
          'esecuzione materializzata'
        );
      }

      if (
        report.args.length !== 0 ||
        report.envAllowList.length !== 0 ||
        report.oracleFilesExecuted.length !== 0
      ) {
        violations.push(
          'BLOCKED richiede args, envAllowList e ' +
          'oracleFilesExecuted vuoti'
        );
      }

      if (report.implicitDiscoveryUsed) {
        violations.push(
          'BLOCKED richiede implicitDiscoveryUsed=false'
        );
      }

      if (
        report.totalTests !== 0 ||
        report.passedTests !== 0 ||
        report.failedTests !== 0 ||
        report.skippedTests !== 0 ||
        report.xfailedTests !== 0 ||
        report.xpassedTests !== 0 ||
        report.errorTests !== 0
      ) {
        violations.push(
          'BLOCKED richiede conteggi test pari a zero'
        );
      }

      if (report.passRate !== 0) {
        violations.push(
          'BLOCKED richiede passRate=0'
        );
      }

      if (
        report.durationMs !== 0 ||
        report.executionDurationMs !== 0
      ) {
        violations.push(
          'BLOCKED richiede durationMs ed ' +
          'executionDurationMs pari a zero'
        );
      }

      if (report.failureDetails.length !== 0) {
        violations.push(
          'BLOCKED richiede failureDetails vuoto'
        );
      }

      if (
        report.stdout !== '' ||
        report.stderr !== '' ||
        report.rawStdout !== '' ||
        report.rawStderr !== ''
      ) {
        violations.push(
          'BLOCKED richiede output vuoti'
        );
      }

      break;
    }
  }

  return violations;
}

export function assertTestExecutionReportInvariants(
  report: TestExecutionReport
): void {
  assertNoViolations(
    'TestExecutionReport incoerente',
    reportStateViolations(report)
  );
}

export function assertFunctionalTestResultInvariants(
  result: OracleResult<'FUNCTIONAL_TEST'>
): void {
  const violations = reportStateViolations(result.evidence.report);
  appendFiniteNonNegativeViolation(violations, 'durationMs', result.durationMs);
  appendBlockedResultViolations(
    violations,
    result
  );

  if (result.status !== result.evidence.report.oracleStatus) {
    violations.push(
      `OracleResult.status=${result.status} non coincide con ` +
      `report.oracleStatus=${result.evidence.report.oracleStatus}`
    );
  }

  assertNoViolations(
    'OracleResult FUNCTIONAL_TEST incoerente',
    violations
  );
}

export function assertApplicabilityResultInvariants(
  result: OracleResult<'APPLICABILITY'>
): void {
  const violations: string[] = [];

  appendFiniteNonNegativeViolation(
    violations,
    'durationMs',
    result.durationMs
  );

  const {
    applyMode,
    patchHash
  } = result.evidence;

  if (
    patchHash !== undefined &&
    !/^[a-f0-9]{64}$/i.test(
      patchHash
    )
  ) {
    violations.push(
      'patchHash deve essere un digest SHA-256 esadecimale'
    );
  }

  appendBlockedResultViolations(
    violations,
    result
  );

  switch (result.status) {
    case 'PASS': {
      if (
        applyMode !== 'GIT' &&
        applyMode !== 'FUZZY'
      ) {
        violations.push(
          'PASS richiede applyMode GIT o FUZZY'
        );
      }

      break;
    }

    case 'FAIL':
    case 'NOT_AVAILABLE':
    case 'EXECUTION_ERROR': {
      if (
        applyMode !== 'NOT_APPLICABLE'
      ) {
        violations.push(
          `${result.status} richiede applyMode NOT_APPLICABLE`
        );
      }

      break;
    }
    case 'BLOCKED': {
      violations.push(
        'APPLICABILITY non può avere status BLOCKED'
      );

      break;
    }

  }

  assertNoViolations(
    'OracleResult APPLICABILITY incoerente',
    violations
  );
}

export function assertBuildSyntaxResultInvariants(
  result: OracleResult<'BUILD_SYNTAX'>
): void {
  const violations: string[] = [];

  const {
    exitCode,
    timedOut,
    executionError
  } = result.evidence;

  const hasExecutionError =
    executionError !== undefined &&
    executionError.trim().length > 0;

  if (
    !Number.isFinite(
      result.durationMs
    ) ||
    result.durationMs < 0
  ) {
    violations.push(
      'durationMs deve essere finito e non negativo'
    );
  }

  appendBlockedResultViolations(
    violations,
    result
  );

  switch (
  result.status
  ) {
    case 'PASS': {
      if (
        exitCode !== 0
      ) {
        violations.push(
          `PASS richiede exitCode=0, ricevuto ${exitCode}`
        );
      }

      if (
        timedOut
      ) {
        violations.push(
          'PASS richiede timedOut=false'
        );
      }

      if (
        hasExecutionError
      ) {
        violations.push(
          'PASS non consente executionError'
        );
      }

      break;
    }

    case 'FAIL': {
      if (
        exitCode === null
      ) {
        violations.push(
          'FAIL richiede un exitCode valido'
        );
      } else if (
        exitCode === 0
      ) {
        violations.push(
          'FAIL richiede exitCode diverso da 0'
        );
      }

      if (
        timedOut
      ) {
        violations.push(
          'FAIL richiede timedOut=false'
        );
      }

      if (
        hasExecutionError
      ) {
        violations.push(
          'FAIL non consente executionError'
        );
      }

      break;
    }

    case 'NOT_AVAILABLE': {
      if (
        exitCode !== null
      ) {
        violations.push(
          'NOT_AVAILABLE richiede exitCode=null'
        );
      }

      if (
        timedOut
      ) {
        violations.push(
          'NOT_AVAILABLE richiede timedOut=false'
        );
      }

      if (
        hasExecutionError
      ) {
        violations.push(
          'NOT_AVAILABLE non consente executionError'
        );
      }

      break;
    }

    case 'EXECUTION_ERROR': {
      const hasExecutionFailureEvidence =
        timedOut ||
        hasExecutionError ||
        exitCode === null;

      if (
        !hasExecutionFailureEvidence
      ) {
        violations.push(
          'EXECUTION_ERROR richiede timedOut=true, ' +
          'executionError non vuoto oppure exitCode=null'
        );
      }

      break;
    }

    case 'BLOCKED': {
      violations.push(
        'BUILD_SYNTAX non può avere status BLOCKED'
      );

      break;
    }
  }

  assertNoViolations(
    'OracleResult BUILD_SYNTAX incoerente',
    violations
  );
}

export function assertSemgrepResultInvariants(
  result: OracleResult<'SEMGREP'>
): void {
  const violations: string[] = [];

  const {
    findings,
    scannedFiles,
    executionError
  } = result.evidence;

  const hasExecutionError =
    executionError !== undefined &&
    executionError.trim().length > 0;

  if (
    !Number.isFinite(
      result.durationMs
    ) ||
    result.durationMs < 0
  ) {
    violations.push(
      'durationMs deve essere finito e non negativo'
    );
  }
  appendBlockedResultViolations(
    violations,
    result
  );
  switch (
  result.status
  ) {
    case 'PASS': {
      if (
        findings.length !== 0
      ) {
        violations.push(
          'PASS richiede findings vuoto'
        );
      }

      if (
        scannedFiles.length === 0
      ) {
        violations.push(
          'PASS richiede almeno un file analizzato'
        );
      }

      if (
        hasExecutionError
      ) {
        violations.push(
          'PASS non consente executionError'
        );
      }

      break;
    }

    case 'FAIL': {
      if (
        findings.length === 0
      ) {
        violations.push(
          'FAIL richiede almeno un finding'
        );
      }

      if (
        scannedFiles.length === 0
      ) {
        violations.push(
          'FAIL richiede almeno un file analizzato'
        );
      }

      if (
        hasExecutionError
      ) {
        violations.push(
          'FAIL non consente executionError'
        );
      }

      break;
    }

    case 'NOT_AVAILABLE': {
      if (
        findings.length !== 0
      ) {
        violations.push(
          'NOT_AVAILABLE richiede findings vuoto'
        );
      }

      if (
        scannedFiles.length !== 0
      ) {
        violations.push(
          'NOT_AVAILABLE richiede scannedFiles vuoto'
        );
      }

      if (
        hasExecutionError
      ) {
        violations.push(
          'NOT_AVAILABLE non consente executionError'
        );
      }

      break;
    }

    case 'EXECUTION_ERROR': {
      if (
        findings.length !== 0
      ) {
        violations.push(
          'EXECUTION_ERROR richiede findings vuoto'
        );
      }

      if (
        !hasExecutionError
      ) {
        violations.push(
          'EXECUTION_ERROR richiede executionError non vuoto'
        );
      }

      break;
    }
    case 'BLOCKED': {
      if (findings.length !== 0) {
        violations.push(
          'BLOCKED richiede findings vuoto'
        );
      }

      if (scannedFiles.length !== 0) {
        violations.push(
          'BLOCKED richiede scannedFiles vuoto'
        );
      }

      if (hasExecutionError) {
        violations.push(
          'BLOCKED non consente executionError'
        );
      }

      break;
    }
  }

  assertNoViolations(
    'OracleResult SEMGREP incoerente',
    violations
  );
}

export function assertVerificationVerdictInvariants(
  verdict: VerificationVerdict,
  profile: OracleProfile =
    DEFAULT_ORACLE_PROFILE,
  requireCompleteVerification = false
): void {
  const violations: string[] = [];

  try {
    assertTestExecutionReportInvariants(
      verdict.testReport
    );
  } catch (error: unknown) {
    if (
      error instanceof VerificationInvariantError
    ) {
      violations.push(
        ...error.violations.map(
          (violation) =>
            `verdict.testReport: ${violation}`
        )
      );
    } else {
      throw error;
    }
  }

  const applicabilityResults =
    verdict.oracleResults.filter(
      (
        result
      ): result is OracleResult<'APPLICABILITY'> =>
        result.oracle === 'APPLICABILITY'
    );

  for (
    const result of applicabilityResults
  ) {
    try {
      assertApplicabilityResultInvariants(
        result
      );
    } catch (error: unknown) {
      if (
        error instanceof
        VerificationInvariantError
      ) {
        violations.push(
          ...error.violations.map(
            (violation) =>
              `APPLICABILITY: ${violation}`
          )
        );
      } else {
        throw error;
      }
    }
  }

  const buildSyntaxResults =
    verdict.oracleResults.filter(
      (
        result
      ): result is OracleResult<'BUILD_SYNTAX'> =>
        result.oracle === 'BUILD_SYNTAX'
    );

  for (
    const result of buildSyntaxResults
  ) {
    try {
      assertBuildSyntaxResultInvariants(
        result
      );
    } catch (error: unknown) {
      if (
        error instanceof
        VerificationInvariantError
      ) {
        violations.push(
          ...error.violations.map(
            (violation) =>
              `BUILD_SYNTAX: ${violation}`
          )
        );
      } else {
        throw error;
      }
    }
  }

  const functionalResults =
    verdict.oracleResults.filter(
      (
        result
      ): result is OracleResult<
        'FUNCTIONAL_TEST'
      > =>
        result.oracle ===
        'FUNCTIONAL_TEST'
    );

  for (const result of functionalResults) {
    try {
      assertFunctionalTestResultInvariants(
        result
      );
    } catch (error: unknown) {
      if (
        error instanceof
        VerificationInvariantError
      ) {
        violations.push(
          ...error.violations.map(
            (violation) =>
              `FUNCTIONAL_TEST: ${violation}`
          )
        );
      } else {
        throw error;
      }
    }
  }

  if (functionalResults.length === 1) {
    const functionalReport =
      functionalResults[0]!.evidence.report;

    if (
      !isDeepStrictEqual(
        verdict.testReport,
        functionalReport
      )
    ) {
      violations.push(
        'verdict.testReport non coincide ' +
        'strutturalmente con il report del ' +
        'FUNCTIONAL_TEST presente negli ' +
        'oracleResults'
      );
    }
  }

  const semgrepResults =
    verdict.oracleResults.filter(
      (
        result
      ): result is OracleResult<'SEMGREP'> =>
        result.oracle === 'SEMGREP'
    );

  if (semgrepResults.length === 1) {
    const semgrepResult =
      semgrepResults[0]!;

    try {
      assertSemgrepResultInvariants(
        semgrepResult
      );
    } catch (error: unknown) {
      if (
        error instanceof
        VerificationInvariantError
      ) {
        violations.push(
          ...error.violations.map(
            (violation) =>
              `SEMGREP: ${violation}`
          )
        );
      } else {
        throw error;
      }
    }

    if (
      !isDeepStrictEqual(
        verdict.sastFindings,
        semgrepResult.evidence.findings
      )
    ) {
      violations.push(
        'verdict.sastFindings non coincide ' +
        'strutturalmente con i finding del ' +
        'SEMGREP presente negli oracleResults'
      );
    }

    if (
      verdict.semgrepDurationMs !==
      semgrepResult.durationMs
    ) {
      violations.push(
        `verdict.semgrepDurationMs=` +
        `${verdict.semgrepDurationMs} non ` +
        `coincide con la durata del SEMGREP=` +
        `${semgrepResult.durationMs}`
      );
    }
  } else if (
    verdict.semgrepDurationMs !== undefined &&
    (
      !Number.isFinite(
        verdict.semgrepDurationMs
      ) ||
      verdict.semgrepDurationMs < 0
    )
  ) {
    violations.push(
      'semgrepDurationMs deve essere finito ' +
      'e non negativo'
    );
  }

  const blockedResults =
    verdict.oracleResults.filter(
      (result) =>
        result.status === 'BLOCKED'
    );

  for (const blockedResult of blockedResults) {
    const blocker =
      blockedResult.blockedBy;

    if (blocker === undefined) {
      continue;
    }

    if (
      blocker === blockedResult.oracle
    ) {
      violations.push(
        `${blockedResult.oracle} non può essere ` +
        `bloccato da sé stesso`
      );

      continue;
    }

    const blockingResults =
      verdict.oracleResults.filter(
        (result) =>
          result.oracle === blocker
      );

    if (blockingResults.length !== 1) {
      violations.push(
        `${blockedResult.oracle} BLOCKED dichiara ` +
        `blockedBy=${blocker}, ma nel verdetto ` +
        `non esiste un singolo risultato per il blocker`
      );

      continue;
    }

    if (
      blockingResults[0]?.status !== 'FAIL'
    ) {
      violations.push(
        `${blockedResult.oracle} BLOCKED richiede ` +
        `${blocker}=FAIL`
      );
    }
  }

  const decision = decideOracleResults(
    verdict.oracleResults,
    profile
  );

  if (requireCompleteVerification) {
    if (decision.hasInvariantViolation) {
      violations.push(
        'la verifica completa viola il ' +
        'profilo oracle dichiarato'
      );
    }

    if (
      verdict.verified !==
      decision.converged
    ) {
      violations.push(
        `verified=${verdict.verified} non ` +
        `coincide con ` +
        `OracleDecision.converged=` +
        `${decision.converged}`
      );
    }
  } else if (
    verdict.verified &&
    !decision.converged
  ) {
    violations.push(
      'verified=true non è consentito senza ' +
      'una decisione oracle convergente'
    );
  }

  assertNoViolations(
    'VerificationVerdict incoerente',
    violations
  );
}

export function assertWorkbenchSessionInvariants(
  state: WorkbenchSessionState,
  profile: OracleProfile = DEFAULT_ORACLE_PROFILE
): void {
  const violations: string[] = [];
  const finalIteration = state.iterations.at(-1);

  if (!Number.isInteger(state.maxIterations) || state.maxIterations <= 0) {
    violations.push(
      'maxIterations deve essere un intero positivo'
    );
  }
  if (!Number.isInteger(state.currentIteration) || state.currentIteration < 0) {
    violations.push(
      'currentIteration deve essere un intero non negativo'
    );
  }
  if (state.currentIteration !== state.iterations.length) {
    violations.push(
      `currentIteration = ${state.currentIteration} non coincide con iterations.length = ${state.iterations.length}`
    );
  }
  if (state.currentIteration > state.maxIterations) {
    violations.push(
      `currentIteration = ${state.currentIteration} supera maxIterations = ${state.maxIterations}`
    );
  }

  const terminalStatuses = new Set([
    'CONVERGED',
    'UNRESOLVED',
    'FAILED',
    'INFRASTRUCTURE_ERROR'] as const);

  const isTerminalStatus = terminalStatuses.has(state.status as
    | 'CONVERGED'
    | 'UNRESOLVED'
    | 'FAILED'
    | 'INFRASTRUCTURE_ERROR'
  );

  if (isTerminalStatus) {
    if (
      state.autonomousStatus === undefined
    ) {
      violations.push(
        'una sessione terminale richiede autonomousStatus'
      );
    } else if (
      state.autonomousStatus !== state.status
    ) {
      violations.push(
        `autonomousStatus=${state.autonomousStatus} ` +
        `non coincide con status=${state.status}`
      );
    }
  } else if (
    state.autonomousStatus !== undefined
  ) {
    violations.push(
      'una sessione non terminale non può dichiarare autonomousStatus'
    );
  }

  const expectedCandidateVerified = finalIteration?.verification.verified === true;
  if (state.candidateVerified !== expectedCandidateVerified) {
    violations.push(
      `candidateVerified = ${state.candidateVerified} non coincide con verification.verified dell'ultima iterazione = ${expectedCandidateVerified}`
    );
  }

  const expectedAutonomousRunSucceeded = state.autonomousStatus === 'CONVERGED' && state.candidateVerified;
  if (state.autonomousRunSucceeded !== expectedAutonomousRunSucceeded) {
    violations.push(`autonomousRunSucceeded = ${state.autonomousRunSucceeded} non è coerente con autonomousStatus e candidateVerified`);
  }

  for (
    const iteration of state.iterations
  ) {
    const context = `iteration ${iteration.iteration}`;
    const hasApplicabilityResult = iteration.verification.oracleResults.some((result) => result.oracle === 'APPLICABILITY');

    if (hasApplicabilityResult && iteration.technicalAttempts === undefined) {
      violations.push(
        `${context}: technicalAttempts è obbligatorio quando è presente un risultato APPLICABILITY`
      );
    }

    if (!hasApplicabilityResult && iteration.technicalAttempts !== undefined) {
      violations.push(
        `${context}: technicalAttempts non è consentito senza un risultato APPLICABILITY`
      );
    }

    if (iteration.technicalAttempts !== undefined && (!Number.isInteger(iteration.technicalAttempts) || iteration.technicalAttempts <= 0)) {
      violations.push(
        `${context}: technicalAttempts deve essere un numero intero positivo`
      );
    }

    try {
      assertComputationalTelemetryInvariants(
        iteration.telemetry
      );
    } catch (error: unknown) {
      if (
        error instanceof
        VerificationInvariantError
      ) {
        violations.push(
          ...error.violations.map(
            (violation) =>
              `${context}.telemetry: ${violation}`
          )
        );
      } else {
        throw error;
      }
    }

    if (
      iteration.agentUsage !== undefined
    ) {
      try {
        assertAgentUsageInvariants(
          iteration.agentUsage
        );
      } catch (error: unknown) {
        if (
          error instanceof
          VerificationInvariantError
        ) {
          violations.push(
            ...error.violations.map(
              (violation) =>
                `${context}.agentUsage: ${violation}`
            )
          );
        } else {
          throw error;
        }
      }
    }
    if (
      iteration.reviewerFeedback !== undefined &&
      iteration.reviewerMode === undefined
    ) {
      violations.push(
        `${context}: reviewerFeedback presente senza reviewerMode`
      );
    }

    if (
      iteration.reviewerFeedback === undefined &&
      iteration.reviewerMode !== undefined
    ) {
      violations.push(
        `${context}: reviewerMode presente senza reviewerFeedback`
      );
    }

    if (
      iteration.fallbackReason !== undefined &&
      iteration.reviewerMode !==
      'DETERMINISTIC_FALLBACK'
    ) {
      violations.push(
        `${context}: fallbackReason è consentito solo con ` +
        `reviewerMode=DETERMINISTIC_FALLBACK`
      );
    }

    if (
      iteration.reviewerMode ===
      'DETERMINISTIC_FALLBACK'
    ) {
      if (
        iteration.fallbackReason === undefined ||
        iteration.fallbackReason.trim().length === 0
      ) {
        violations.push(
          `${context}: reviewerMode=DETERMINISTIC_FALLBACK ` +
          `richiede fallbackReason non vuoto`
        );
      }
    }

    if (
      (
        iteration.reviewerMode === 'LLM' ||
        iteration.reviewerMode === 'ORCHESTRATOR'
      ) &&
      iteration.fallbackReason !== undefined
    ) {
      violations.push(
        `${context}: reviewerMode=${iteration.reviewerMode} ` +
        `non consente fallbackReason`
      );
    }
  }

  try {
    assertComputationalTelemetryInvariants(
      state.cumulativeTelemetry
    );
  } catch (error: unknown) {
    if (
      error instanceof
      VerificationInvariantError
    ) {
      violations.push(
        ...error.violations.map(
          (violation) =>
            `cumulativeTelemetry: ${violation}`
        )
      );
    } else {
      throw error;
    }
  }

  if (state.status === 'CONVERGED') {
    if (!finalIteration) {
      violations.push(
        'una sessione CONVERGED richiede almeno una iterazione'
      );
    } else {
      try {
        assertVerificationVerdictInvariants(
          finalIteration.verification,
          profile,
          true
        );
      } catch (error: unknown) {
        if (error instanceof VerificationInvariantError) {
          violations.push(...error.violations);
        } else {
          throw error;
        }
      }

      if (!finalIteration.verification.verified) {
        violations.push(
          'una sessione CONVERGED richiede verification.verified=true'
        );
      }
    }
  }

  assertNoViolations(
    'WorkbenchSessionState incoerente',
    violations
  );
}
