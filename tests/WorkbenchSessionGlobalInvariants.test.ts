import {
  assertWorkbenchSessionInvariants,
  VerificationInvariantError
} from '../src/verification/VerificationInvariants.js';
import type {
  ComputationalTelemetry,
  IterationRecord,
  OracleResult,
  VerificationVerdict,
  WorkbenchSessionState
} from '../src/types/domain.js';

const TELEMETRY: ComputationalTelemetry = {
  promptTokens: null,
  completionTokens: null,
  tokenUsageAvailable: false,
  inferenceDurationMs: 0,
  oracleDurationMs: 0,
  orchestrationOverheadMs: 0,
  totalDurationMs: 0,
  agentUsage: {
    CODER: {
      promptTokens: null,
      completionTokens: null,
      tokenUsageAvailable: false,
      inferenceDurationMs: 0
    },
    REVIEWER: {
      promptTokens: null,
      completionTokens: null,
      tokenUsageAvailable: false,
      inferenceDurationMs: 0
    }
  }
};

const EMPTY_VERDICT: VerificationVerdict = {
  verified: false,
  oracleResults: [],
  sastFindings: [],
  testReport: {
    oracleStatus: 'NOT_AVAILABLE',
    command: null,
    args: [],
    cwd: null,
    timeoutMs: null,
    envAllowList: [],
    oracleFilesExecuted: [],
    implicitDiscoveryUsed: false,
    expectedExitPolicy: null,
    exitCode: null,
    suitePassed: false,
    timedOut: false,
    oracleFailed: false,
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    skippedTests: 0,
    xfailedTests: 0,
    xpassedTests: 0,
    errorTests: 0,
    passRate: 0,
    durationMs: 0,
    failureDetails: [],
    stdout: '',
    stderr: '',
    rawStdout: '',
    rawStderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    executionDurationMs: 0
  }
};

const APPLICABILITY_FAIL: OracleResult<'APPLICABILITY'> = {
  oracle: 'APPLICABILITY',
  status: 'FAIL',
  required: true,
  durationMs: 1,
  summary: 'Patch non applicabile.',
  evidence: {
    applyMode: 'NOT_APPLICABLE',
    patchHash: 'patch-hash',
    reason: 'Patch non applicabile.'
  }
};

const APPLICABILITY_VERDICT: VerificationVerdict = {
  ...EMPTY_VERDICT,
  oracleResults: [APPLICABILITY_FAIL]
};

function createIteration(
  overrides: Partial<IterationRecord> = {}
): IterationRecord {
  return {
    iteration: 1,
    patchDiff: '',
    patchHash: '',
    isApplicable: false,
    verification: EMPTY_VERDICT,
    telemetry: TELEMETRY,
    applyMode: 'NOT_APPLICABLE',
    fuzzyFallbackUsed: false,
    ...overrides
  };
}

function createTerminalSession(
  overrides: Partial<WorkbenchSessionState> = {}
): WorkbenchSessionState {
  const iterations = overrides.iterations ?? [createIteration()];

  return {
    taskId: 'BE-P1-23-test-task',
    issueSpec: 'Verificare le invarianti globali della sessione.',
    category: 'REPAIR',
    status: 'UNRESOLVED',
    autonomousStatus: 'UNRESOLVED',
    finalizationStatus: 'NOT_FINALIZED',
    candidateVerified: false,
    autonomousRunSucceeded: false,
    targetFiles: ['src/example.ts'],
    testFiles: ['tests/example.test.ts'],
    currentIteration: iterations.length,
    maxIterations: 3,
    iterations,
    cumulativeTelemetry: TELEMETRY,
    terminationReason: 'Budget di refinement esaurito.',
    ...overrides
  };
}

function expectInvariantViolation(
  action: () => void,
  expectedMessage: string
): void {
  try {
    action();
    throw new Error('Attesa VerificationInvariantError, ma nessun errore è stato sollevato.');
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(VerificationInvariantError);

    const invariantError = error as VerificationInvariantError;

    expect(
      invariantError.violations.some(
        (violation) => violation.includes(expectedMessage)
      )
    ).toBe(true);
  }
}

describe('BE-P1-23 - WorkbenchSessionState global invariants', () => {
  it('accetta una sessione terminale coerente senza iterazioni', () => {
    const state = createTerminalSession({
      status: 'FAILED',
      autonomousStatus: 'FAILED',
      iterations: [],
      currentIteration: 0,
      maxIterations: 3,
      candidateVerified: false,
      autonomousRunSucceeded: false
    });

    expect(() =>
      assertWorkbenchSessionInvariants(state)
    ).not.toThrow();
  });

  it('rifiuta currentIteration superiore a maxIterations già al runtime boundary', () => {
    const iterations = [
      createIteration({ iteration: 1 }),
      createIteration({ iteration: 2 }),
      createIteration({ iteration: 3 })
    ];

    const state = createTerminalSession({
      iterations,
      currentIteration: 3,
      maxIterations: 2
    });

    expectInvariantViolation(
      () => assertWorkbenchSessionInvariants(state),
      'supera maxIterations'
    );
  });

  it('rifiuta currentIteration diverso dal numero di IterationRecord', () => {
    const state = createTerminalSession({
      iterations: [createIteration()],
      currentIteration: 0
    });

    expectInvariantViolation(
      () => assertWorkbenchSessionInvariants(state),
      'non coincide con iterations.length'
    );
  });

  it('rifiuta una sessione terminale senza autonomousStatus', () => {
    const validState = createTerminalSession();

    const {
      autonomousStatus: _autonomousStatus,
      ...stateWithoutAutonomousStatus
    } = validState;

    const state =
      stateWithoutAutonomousStatus as WorkbenchSessionState;

    expectInvariantViolation(
      () => assertWorkbenchSessionInvariants(state),
      'una sessione terminale richiede autonomousStatus'
    );
  });

  it('rifiuta autonomousStatus diverso dallo status terminale', () => {
    const state = createTerminalSession({
      status: 'FAILED',
      autonomousStatus: 'UNRESOLVED'
    });

    expectInvariantViolation(
      () => assertWorkbenchSessionInvariants(state),
      'non coincide con status'
    );
  });

  it('rifiuta autonomousStatus su una sessione non terminale', () => {
    const state = createTerminalSession({
      status: 'RUNNING',
      autonomousStatus: 'UNRESOLVED'
    });

    expectInvariantViolation(
      () => assertWorkbenchSessionInvariants(state),
      'una sessione non terminale non può dichiarare autonomousStatus'
    );
  });

  it('rifiuta candidateVerified incoerente con la verification finale', () => {
    const state = createTerminalSession({
      candidateVerified: true,
      autonomousRunSucceeded: false
    });

    expectInvariantViolation(
      () => assertWorkbenchSessionInvariants(state),
      'candidateVerified'
    );
  });

  it('rifiuta autonomousRunSucceeded incoerente con autonomousStatus e candidateVerified', () => {
    const state = createTerminalSession({
      autonomousRunSucceeded: true
    });

    expectInvariantViolation(
      () => assertWorkbenchSessionInvariants(state),
      'autonomousRunSucceeded'
    );
  });

  it('richiede technicalAttempts quando IterationRecord contiene APPLICABILITY', () => {
    const iteration = createIteration({
      verification: APPLICABILITY_VERDICT
    });

    const state = createTerminalSession({
      iterations: [iteration],
      currentIteration: 1
    });

    expectInvariantViolation(
      () => assertWorkbenchSessionInvariants(state),
      'technicalAttempts è obbligatorio quando è presente un risultato APPLICABILITY'
    );
  });

  it('rifiuta technicalAttempts quando non esiste alcun risultato APPLICABILITY', () => {
    const iteration = createIteration({
      technicalAttempts: 1
    });

    const state = createTerminalSession({
      iterations: [iteration],
      currentIteration: 1
    });

    expectInvariantViolation(
      () => assertWorkbenchSessionInvariants(state),
      'technicalAttempts non è consentito senza un risultato APPLICABILITY'
    );
  });

  it.each([0, -1, 1.5])(
    'rifiuta technicalAttempts=%s perché non è un intero positivo',
    (technicalAttempts) => {
      const iteration = createIteration({
        verification: APPLICABILITY_VERDICT,
        technicalAttempts
      });

      const state = createTerminalSession({
        iterations: [iteration],
        currentIteration: 1
      });

      expectInvariantViolation(
        () => assertWorkbenchSessionInvariants(state),
        'technicalAttempts deve essere un numero intero positivo'
      );
    }
  );

  it('accetta technicalAttempts positivo quando è presente APPLICABILITY', () => {
    const iteration = createIteration({
      verification: APPLICABILITY_VERDICT,
      technicalAttempts: 1
    });

    const state = createTerminalSession({
      iterations: [iteration],
      currentIteration: 1
    });

    expect(() =>
      assertWorkbenchSessionInvariants(state)
    ).not.toThrow();
  });
});
