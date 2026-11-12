import {
    describe,
    expect,
    it
} from '@jest/globals';

import type {
    AgentRole,
    AgentUsage,
    ComputationalTelemetry,
    IterationRecord,
    TestExecutionReport,
    VerificationVerdict,
    WorkbenchSessionState
} from '../src/types/domain.js';

import {
    TelemetryTracker
} from '../src/telemetry/TelemetryTracker.js';

import {
    assertAgentUsageInvariants,
    assertComputationalTelemetryInvariants,
    assertWorkbenchSessionInvariants,
    VerificationInvariantError
} from '../src/verification/VerificationInvariants.js';

const createAgentUsage = (
    overrides: Partial<AgentUsage> = {}
): AgentUsage => ({
    promptTokens: 0,
    completionTokens: 0,
    tokenUsageAvailable: true,
    inferenceDurationMs: 0,
    ...overrides
});

const createAgentUsageRecord = (
    coderOverrides: Partial<AgentUsage> = {},
    reviewerOverrides: Partial<AgentUsage> = {}
): Readonly<Record<AgentRole, AgentUsage>> => ({
    CODER: createAgentUsage(
        coderOverrides
    ),

    REVIEWER: createAgentUsage(
        reviewerOverrides
    )
});

const createTelemetry = (
    overrides: Partial<ComputationalTelemetry> = {},
    coderOverrides: Partial<AgentUsage> = {},
    reviewerOverrides: Partial<AgentUsage> = {}
): ComputationalTelemetry => {
    const base: ComputationalTelemetry = {
        promptTokens: 0,
        completionTokens: 0,
        tokenUsageAvailable: true,
        inferenceDurationMs: 0,
        oracleDurationMs: 0,
        orchestrationOverheadMs: 0,
        totalDurationMs: 0,
        agentUsage: createAgentUsageRecord(
            coderOverrides,
            reviewerOverrides
        )
    };

    return {
        ...base,
        ...overrides
    };
};

const createNotAvailableReport =
    (): TestExecutionReport => ({
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
    });

const createEmptyVerdict =
    (): VerificationVerdict => ({
        verified: false,
        oracleResults: [],
        sastFindings: [],
        testReport: createNotAvailableReport()
    });

const createIteration = (
    telemetry: ComputationalTelemetry,
    agentUsage?:
        Readonly<Record<AgentRole, AgentUsage>>
): IterationRecord => {
    const base: IterationRecord = {
        iteration: 1,
        patchDiff: '',
        patchHash: 'hash-1',
        isApplicable: false,
        verification: createEmptyVerdict(),
        telemetry,
        applyMode: 'NOT_APPLICABLE'
    };

    if (
        agentUsage === undefined
    ) {
        return base;
    }

    return {
        ...base,
        agentUsage
    };
};

const createSession = (
    iterationTelemetry: ComputationalTelemetry,
    cumulativeTelemetry:
        ComputationalTelemetry = iterationTelemetry,
    iterationAgentUsage?:
        Readonly<Record<AgentRole, AgentUsage>>
): WorkbenchSessionState => ({
    taskId: 'task-be-p1-11',
    issueSpec: 'Telemetry invariant test.',
    category: 'REPAIR',
    status: 'UNRESOLVED',
    autonomousStatus: 'UNRESOLVED',
    finalizationStatus: 'NOT_FINALIZED',
    candidateVerified: false,
    autonomousRunSucceeded: false,
    targetFiles: [
        'src/target.py'
    ],
    testFiles: [
        'tests/test_target.py'
    ],
    currentIteration: 1,
    maxIterations: 3,
    iterations: [
        createIteration(
            iterationTelemetry,
            iterationAgentUsage
        )
    ],
    cumulativeTelemetry
});

const captureInvariant = (
    callback: () => void
): VerificationInvariantError => {
    try {
        callback();
    } catch (error: unknown) {
        expect(
            error
        ).toBeInstanceOf(
            VerificationInvariantError
        );

        return error as
            VerificationInvariantError;
    }

    throw new Error(
        'Il test attendeva una VerificationInvariantError.'
    );
};

describe(
    'BE-P1-11 - Telemetry invariants',
    () => {
        describe(
            'TelemetryTracker fail-fast',
            () => {
                it(
                    'accetta durate finite e token interi non negativi',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        tracker.recordLLMUsage(
                            'CODER',
                            10,
                            5,
                            12.5
                        );

                        tracker.recordOracleDuration(
                            8.25
                        );

                        const snapshot =
                            tracker.getSnapshot();

                        expect(
                            snapshot.promptTokens
                        ).toBe(
                            10
                        );

                        expect(
                            snapshot.completionTokens
                        ).toBe(
                            5
                        );

                        expect(
                            snapshot.inferenceDurationMs
                        ).toBe(
                            12.5
                        );

                        expect(
                            snapshot.oracleDurationMs
                        ).toBe(
                            8.25
                        );

                        expect(
                            snapshot.agentUsage.CODER
                                .promptTokens
                        ).toBe(
                            10
                        );

                        expect(
                            snapshot.agentUsage.CODER
                                .completionTokens
                        ).toBe(
                            5
                        );

                        expect(
                            snapshot.agentUsage.CODER
                                .inferenceDurationMs
                        ).toBe(
                            12.5
                        );
                    }
                );

                it(
                    'rifiuta durationMs LLM NaN',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    10,
                                    5,
                                    Number.NaN
                                )
                        ).toThrow(
                            'durationMs deve essere finito e non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta durationMs LLM Infinity',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    10,
                                    5,
                                    Number.POSITIVE_INFINITY
                                )
                        ).toThrow(
                            'durationMs deve essere finito e non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta durationMs LLM negativa',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    10,
                                    5,
                                    -1
                                )
                        ).toThrow(
                            'durationMs deve essere finito e non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta promptTokens negativo',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    -1,
                                    5,
                                    10
                                )
                        ).toThrow(
                            'promptTokens deve essere un intero non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta promptTokens decimale',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    1.5,
                                    5,
                                    10
                                )
                        ).toThrow(
                            'promptTokens deve essere un intero non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta promptTokens NaN',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    Number.NaN,
                                    5,
                                    10
                                )
                        ).toThrow(
                            'promptTokens deve essere un intero non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta completionTokens negativo',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    10,
                                    -1,
                                    10
                                )
                        ).toThrow(
                            'completionTokens deve essere un intero non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta completionTokens decimale',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    10,
                                    2.5,
                                    10
                                )
                        ).toThrow(
                            'completionTokens deve essere un intero non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta completionTokens Infinity',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    10,
                                    Number.POSITIVE_INFINITY,
                                    10
                                )
                        ).toThrow(
                            'completionTokens deve essere un intero non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta oracleDurationMs NaN',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordOracleDuration(
                                    Number.NaN
                                )
                        ).toThrow(
                            'oracleDurationMs deve essere finito e non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta oracleDurationMs Infinity',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordOracleDuration(
                                    Number.POSITIVE_INFINITY
                                )
                        ).toThrow(
                            'oracleDurationMs deve essere finito e non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta oracleDurationMs negativa',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        expect(
                            () =>
                                tracker.recordOracleDuration(
                                    -1
                                )
                        ).toThrow(
                            'oracleDurationMs deve essere finito e non negativo.'
                        );
                    }
                );

                it(
                    'rifiuta input LLM invalidi prima di mutare gli accumulatori',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        tracker.recordLLMUsage(
                            'CODER',
                            10,
                            5,
                            20
                        );

                        const before =
                            tracker.getSnapshot();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'CODER',
                                    -1,
                                    50,
                                    100
                                )
                        ).toThrow();

                        const after =
                            tracker.getSnapshot();

                        expect(
                            after.promptTokens
                        ).toBe(
                            before.promptTokens
                        );

                        expect(
                            after.completionTokens
                        ).toBe(
                            before.completionTokens
                        );

                        expect(
                            after.inferenceDurationMs
                        ).toBe(
                            before.inferenceDurationMs
                        );

                        expect(
                            after.agentUsage.CODER
                                .promptTokens
                        ).toBe(
                            before.agentUsage.CODER
                                .promptTokens
                        );

                        expect(
                            after.agentUsage.CODER
                                .completionTokens
                        ).toBe(
                            before.agentUsage.CODER
                                .completionTokens
                        );

                        expect(
                            after.agentUsage.CODER
                                .inferenceDurationMs
                        ).toBe(
                            before.agentUsage.CODER
                                .inferenceDurationMs
                        );
                    }
                );

                it(
                    'non muta la durata LLM quando completionTokens è invalido',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        tracker.recordLLMUsage(
                            'REVIEWER',
                            10,
                            5,
                            20
                        );

                        const before =
                            tracker.getSnapshot();

                        expect(
                            () =>
                                tracker.recordLLMUsage(
                                    'REVIEWER',
                                    10,
                                    1.5,
                                    100
                                )
                        ).toThrow();

                        const after =
                            tracker.getSnapshot();

                        expect(
                            after.inferenceDurationMs
                        ).toBe(
                            before.inferenceDurationMs
                        );

                        expect(
                            after.agentUsage.REVIEWER
                                .inferenceDurationMs
                        ).toBe(
                            before.agentUsage.REVIEWER
                                .inferenceDurationMs
                        );
                    }
                );

                it(
                    'non contamina oracleDurationMs dopo un input invalido',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        tracker.recordOracleDuration(
                            15
                        );

                        const before =
                            tracker.getSnapshot();

                        expect(
                            () =>
                                tracker.recordOracleDuration(
                                    Number.NaN
                                )
                        ).toThrow();

                        const after =
                            tracker.getSnapshot();

                        expect(
                            after.oracleDurationMs
                        ).toBe(
                            before.oracleDurationMs
                        );
                    }
                );

                it(
                    'mantiene usage unavailable quando promptTokens è null',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        tracker.recordLLMUsage(
                            'CODER',
                            null,
                            5,
                            10
                        );

                        const snapshot =
                            tracker.getSnapshot();

                        expect(
                            snapshot.tokenUsageAvailable
                        ).toBe(
                            false
                        );

                        expect(
                            snapshot.promptTokens
                        ).toBeNull();

                        expect(
                            snapshot.completionTokens
                        ).toBeNull();

                        expect(
                            snapshot.agentUsage.CODER
                                .tokenUsageAvailable
                        ).toBe(
                            false
                        );

                        expect(
                            snapshot.agentUsage.CODER
                                .promptTokens
                        ).toBeNull();

                        expect(
                            snapshot.agentUsage.CODER
                                .completionTokens
                        ).toBeNull();

                        expect(
                            snapshot.inferenceDurationMs
                        ).toBe(
                            10
                        );
                    }
                );

                it(
                    'mantiene usage unavailable quando completionTokens è null',
                    () => {
                        const tracker =
                            new TelemetryTracker();

                        tracker.recordLLMUsage(
                            'REVIEWER',
                            10,
                            null,
                            7.5
                        );

                        const snapshot =
                            tracker.getSnapshot();

                        expect(
                            snapshot.tokenUsageAvailable
                        ).toBe(
                            false
                        );

                        expect(
                            snapshot.promptTokens
                        ).toBeNull();

                        expect(
                            snapshot.completionTokens
                        ).toBeNull();

                        expect(
                            snapshot.agentUsage.REVIEWER
                                .tokenUsageAvailable
                        ).toBe(
                            false
                        );

                        expect(
                            snapshot.agentUsage.REVIEWER
                                .promptTokens
                        ).toBeNull();

                        expect(
                            snapshot.agentUsage.REVIEWER
                                .completionTokens
                        ).toBeNull();

                        expect(
                            snapshot.inferenceDurationMs
                        ).toBe(
                            7.5
                        );
                    }
                );
            }
        );

        describe(
            'ComputationalTelemetry invariants',
            () => {
                it(
                    'accetta uno snapshot numericamente coerente',
                    () => {
                        const telemetry =
                            createTelemetry(
                                {
                                    promptTokens: 30,
                                    completionTokens: 15,
                                    inferenceDurationMs: 25.5,
                                    oracleDurationMs: 12.25,
                                    orchestrationOverheadMs: 4.5,
                                    totalDurationMs: 50
                                },
                                {
                                    promptTokens: 20,
                                    completionTokens: 10,
                                    inferenceDurationMs: 15
                                },
                                {
                                    promptTokens: 10,
                                    completionTokens: 5,
                                    inferenceDurationMs: 10.5
                                }
                            );

                        expect(
                            () =>
                                assertComputationalTelemetryInvariants(
                                    telemetry
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta inferenceDurationMs NaN',
                    () => {
                        const telemetry =
                            createTelemetry({
                                inferenceDurationMs:
                                    Number.NaN
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.inferenceDurationMs ' +
                            'deve essere finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta oracleDurationMs Infinity',
                    () => {
                        const telemetry =
                            createTelemetry({
                                oracleDurationMs:
                                    Number.POSITIVE_INFINITY
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.oracleDurationMs ' +
                            'deve essere finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta orchestrationOverheadMs negativo',
                    () => {
                        const telemetry =
                            createTelemetry({
                                orchestrationOverheadMs:
                                    -1
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.orchestrationOverheadMs ' +
                            'deve essere finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta totalDurationMs non finito',
                    () => {
                        const telemetry =
                            createTelemetry({
                                totalDurationMs:
                                    Number.NEGATIVE_INFINITY
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.totalDurationMs ' +
                            'deve essere finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta promptTokens top-level negativo',
                    () => {
                        const telemetry =
                            createTelemetry({
                                promptTokens:
                                    -1
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.promptTokens deve essere ' +
                            'un intero non negativo quando ' +
                            'tokenUsageAvailable=true'
                        );
                    }
                );

                it(
                    'rifiuta promptTokens top-level decimale',
                    () => {
                        const telemetry =
                            createTelemetry({
                                promptTokens:
                                    1.5
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.promptTokens deve essere ' +
                            'un intero non negativo quando ' +
                            'tokenUsageAvailable=true'
                        );
                    }
                );

                it(
                    'rifiuta completionTokens top-level NaN',
                    () => {
                        const telemetry =
                            createTelemetry({
                                completionTokens:
                                    Number.NaN
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.completionTokens deve essere ' +
                            'un intero non negativo quando ' +
                            'tokenUsageAvailable=true'
                        );
                    }
                );

                it(
                    'rifiuta promptTokens null quando usage è disponibile',
                    () => {
                        const telemetry =
                            createTelemetry({
                                promptTokens:
                                    null,

                                tokenUsageAvailable:
                                    true
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.promptTokens deve essere ' +
                            'un intero non negativo quando ' +
                            'tokenUsageAvailable=true'
                        );
                    }
                );

                it(
                    'rifiuta completionTokens null quando usage è disponibile',
                    () => {
                        const telemetry =
                            createTelemetry({
                                completionTokens:
                                    null,

                                tokenUsageAvailable:
                                    true
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.completionTokens deve essere ' +
                            'un intero non negativo quando ' +
                            'tokenUsageAvailable=true'
                        );
                    }
                );

                it(
                    'accetta token null quando usage non è disponibile',
                    () => {
                        const telemetry =
                            createTelemetry({
                                promptTokens:
                                    null,

                                completionTokens:
                                    null,

                                tokenUsageAvailable:
                                    false
                            });

                        expect(
                            () =>
                                assertComputationalTelemetryInvariants(
                                    telemetry
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta token numerici quando usage non è disponibile',
                    () => {
                        const telemetry =
                            createTelemetry({
                                promptTokens:
                                    10,

                                completionTokens:
                                    5,

                                tokenUsageAvailable:
                                    false
                            });

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.promptTokens deve essere null ' +
                            'quando tokenUsageAvailable=false'
                        );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.completionTokens deve essere null ' +
                            'quando tokenUsageAvailable=false'
                        );
                    }
                );

                it(
                    'rifiuta CODER inferenceDurationMs negativa',
                    () => {
                        const telemetry =
                            createTelemetry(
                                {},
                                {
                                    inferenceDurationMs:
                                        -1
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.agentUsage.CODER.' +
                            'inferenceDurationMs deve essere ' +
                            'finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta REVIEWER inferenceDurationMs NaN',
                    () => {
                        const telemetry =
                            createTelemetry(
                                {},
                                {},
                                {
                                    inferenceDurationMs:
                                        Number.NaN
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.agentUsage.REVIEWER.' +
                            'inferenceDurationMs deve essere ' +
                            'finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta REVIEWER promptTokens decimale',
                    () => {
                        const telemetry =
                            createTelemetry(
                                {},
                                {},
                                {
                                    promptTokens:
                                        1.5
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.agentUsage.REVIEWER.' +
                            'promptTokens deve essere un intero ' +
                            'non negativo quando ' +
                            'tokenUsageAvailable=true'
                        );
                    }
                );

                it(
                    'rifiuta CODER unavailable con token non-null',
                    () => {
                        const telemetry =
                            createTelemetry(
                                {},
                                {
                                    tokenUsageAvailable:
                                        false,

                                    promptTokens:
                                        10,

                                    completionTokens:
                                        5
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertComputationalTelemetryInvariants(
                                        telemetry
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.agentUsage.CODER.' +
                            'promptTokens deve essere null ' +
                            'quando tokenUsageAvailable=false'
                        );

                        expect(
                            error.violations
                        ).toContain(
                            'telemetry.agentUsage.CODER.' +
                            'completionTokens deve essere null ' +
                            'quando tokenUsageAvailable=false'
                        );
                    }
                );

                it(
                    'accetta agent usage unavailable coerente',
                    () => {
                        const telemetry =
                            createTelemetry(
                                {},
                                {},
                                {
                                    tokenUsageAvailable:
                                        false,

                                    promptTokens:
                                        null,

                                    completionTokens:
                                        null,

                                    inferenceDurationMs:
                                        5
                                }
                            );

                        expect(
                            () =>
                                assertComputationalTelemetryInvariants(
                                    telemetry
                                )
                        ).not.toThrow();
                    }
                );
            }
        );

        describe(
            'AgentUsage invariants',
            () => {
                it(
                    'accetta usage per-iteration coerente',
                    () => {
                        const usage =
                            createAgentUsageRecord(
                                {
                                    promptTokens:
                                        10,

                                    completionTokens:
                                        5,

                                    inferenceDurationMs:
                                        20
                                },
                                {
                                    promptTokens:
                                        null,

                                    completionTokens:
                                        null,

                                    tokenUsageAvailable:
                                        false,

                                    inferenceDurationMs:
                                        15
                                }
                            );

                        expect(
                            () =>
                                assertAgentUsageInvariants(
                                    usage
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta usage per-iteration con Infinity',
                    () => {
                        const usage =
                            createAgentUsageRecord(
                                {},
                                {
                                    inferenceDurationMs:
                                        Number.POSITIVE_INFINITY
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertAgentUsageInvariants(
                                        usage
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'agentUsage.REVIEWER.' +
                            'inferenceDurationMs deve essere ' +
                            'finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta usage per-iteration con token negativo',
                    () => {
                        const usage =
                            createAgentUsageRecord(
                                {
                                    completionTokens:
                                        -1
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertAgentUsageInvariants(
                                        usage
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'agentUsage.CODER.completionTokens ' +
                            'deve essere un intero non negativo quando ' +
                            'tokenUsageAvailable=true'
                        );
                    }
                );

                it(
                    'rifiuta usage unavailable con token valorizzati',
                    () => {
                        const usage =
                            createAgentUsageRecord(
                                {},
                                {
                                    tokenUsageAvailable:
                                        false,

                                    promptTokens:
                                        10,

                                    completionTokens:
                                        5
                                }
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertAgentUsageInvariants(
                                        usage
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'agentUsage.REVIEWER.promptTokens ' +
                            'deve essere null quando ' +
                            'tokenUsageAvailable=false'
                        );

                        expect(
                            error.violations
                        ).toContain(
                            'agentUsage.REVIEWER.completionTokens ' +
                            'deve essere null quando ' +
                            'tokenUsageAvailable=false'
                        );
                    }
                );
            }
        );

        describe(
            'WorkbenchSessionState integration',
            () => {
                it(
                    'accetta una sessione con snapshot coerenti',
                    () => {
                        const telemetry =
                            createTelemetry();

                        const state =
                            createSession(
                                telemetry,
                                telemetry,
                                createAgentUsageRecord()
                            );

                        expect(
                            () =>
                                assertWorkbenchSessionInvariants(
                                    state
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'rifiuta telemetry invalida nella singola iterazione',
                    () => {
                        const invalidIterationTelemetry =
                            createTelemetry({
                                totalDurationMs:
                                    Number.NaN
                            });

                        const state =
                            createSession(
                                invalidIterationTelemetry,
                                createTelemetry()
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertWorkbenchSessionInvariants(
                                        state
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'iteration 1.telemetry: ' +
                            'telemetry.totalDurationMs deve essere ' +
                            'finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta agentUsage per-iteration invalido',
                    () => {
                        const invalidUsage =
                            createAgentUsageRecord(
                                {
                                    promptTokens:
                                        -1
                                }
                            );

                        const state =
                            createSession(
                                createTelemetry(),
                                createTelemetry(),
                                invalidUsage
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertWorkbenchSessionInvariants(
                                        state
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'iteration 1.agentUsage: ' +
                            'agentUsage.CODER.promptTokens deve essere ' +
                            'un intero non negativo quando ' +
                            'tokenUsageAvailable=true'
                        );
                    }
                );

                it(
                    'rifiuta cumulativeTelemetry invalida',
                    () => {
                        const invalidCumulative =
                            createTelemetry({
                                oracleDurationMs:
                                    Number.POSITIVE_INFINITY
                            });

                        const state =
                            createSession(
                                createTelemetry(),
                                invalidCumulative
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertWorkbenchSessionInvariants(
                                        state
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'cumulativeTelemetry: ' +
                            'telemetry.oracleDurationMs deve essere ' +
                            'finito e non negativo'
                        );
                    }
                );

                it(
                    'rifiuta contemporaneamente errori iteration e cumulative',
                    () => {
                        const invalidIteration =
                            createTelemetry({
                                inferenceDurationMs:
                                    -1
                            });

                        const invalidCumulative =
                            createTelemetry({
                                totalDurationMs:
                                    Number.POSITIVE_INFINITY
                            });

                        const state =
                            createSession(
                                invalidIteration,
                                invalidCumulative
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertWorkbenchSessionInvariants(
                                        state
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'iteration 1.telemetry: ' +
                            'telemetry.inferenceDurationMs deve essere ' +
                            'finito e non negativo'
                        );

                        expect(
                            error.violations
                        ).toContain(
                            'cumulativeTelemetry: ' +
                            'telemetry.totalDurationMs deve essere ' +
                            'finito e non negativo'
                        );
                    }
                );

                it(
                    'valida agentUsage incorporato nella cumulativeTelemetry',
                    () => {
                        const invalidCumulative =
                            createTelemetry(
                                {},
                                {},
                                {
                                    inferenceDurationMs:
                                        Number.NaN
                                }
                            );

                        const state =
                            createSession(
                                createTelemetry(),
                                invalidCumulative
                            );

                        const error =
                            captureInvariant(
                                () =>
                                    assertWorkbenchSessionInvariants(
                                        state
                                    )
                            );

                        expect(
                            error.violations
                        ).toContain(
                            'cumulativeTelemetry: ' +
                            'telemetry.agentUsage.REVIEWER.' +
                            'inferenceDurationMs deve essere ' +
                            'finito e non negativo'
                        );
                    }
                );
            }
        );
    }
);
