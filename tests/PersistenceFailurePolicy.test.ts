import {
    describe,
    expect,
    it
} from '@jest/globals';

import type {
    ExecutionFailure,
    WorkbenchSessionState
} from '../src/types/domain.js';

import {
    describeTerminalState,
    resolveTerminalState
} from '../src/orchestration/TerminalStatePolicy.js';

describe(
    'Persistence failure policy',
    () => {
        it(
            'classifica PERSISTENCE_FAILURE come INFRASTRUCTURE_ERROR',
            () => {
                const failure:
                    ExecutionFailure = {
                    phase:
                        'PERSISTENCE',

                    category:
                        'PERSISTENCE_FAILURE',

                    message:
                        'Artifact persistence failed.',

                    originalErrorName:
                        'ArtifactPersistenceInvariantError',

                    iteration:
                        2,

                    recoverable:
                        false
                };

                const resolution =
                    resolveTerminalState({
                        failure,

                        refinementBudgetExhausted:
                            true
                    });

                expect(resolution)
                    .toEqual({
                        status:
                            'INFRASTRUCTURE_ERROR',

                        reason:
                            'INFRASTRUCTURE_FAILURE'
                    });
            }
        );

        it(
            'preserva candidateVerified ma invalida autonomousRunSucceeded quando la persistenza fallisce',
            () => {
                const originalResult:
                    WorkbenchSessionState = {
                    taskId:
                        'persistence-failure-test',

                    issueSpec:
                        'Test persistence failure.',

                    category:
                        'REPAIR',

                    status:
                        'CONVERGED',

                    autonomousStatus:
                        'CONVERGED',

                    finalizationStatus:
                        'NOT_FINALIZED',

                    candidateVerified:
                        true,

                    autonomousRunSucceeded:
                        true,

                    targetFiles: [
                        'src/target.py'
                    ],

                    testFiles: [
                        'tests/test_target.py'
                    ],

                    currentIteration:
                        1,

                    maxIterations:
                        3,

                    iterations:
                        [],

                    cumulativeTelemetry: {
                        promptTokens:
                            100,

                        completionTokens:
                            20,

                        tokenUsageAvailable:
                            true,

                        inferenceDurationMs:
                            500,

                        oracleDurationMs:
                            100,

                        orchestrationOverheadMs:
                            10,

                        totalDurationMs:
                            610,

                        agentUsage: {
                            CODER: {
                                promptTokens:
                                    100,

                                completionTokens:
                                    20,

                                tokenUsageAvailable:
                                    true,

                                inferenceDurationMs:
                                    500
                            },

                            REVIEWER: {
                                promptTokens:
                                    0,

                                completionTokens:
                                    0,

                                tokenUsageAvailable:
                                    true,

                                inferenceDurationMs:
                                    0
                            }
                        }
                    },

                    isHumanAugmented:
                        false,

                    terminationReason:
                        'ALL_REQUIRED_GATES_PASSED'
                };

                const persistenceFailure:
                    ExecutionFailure = {
                    phase:
                        'PERSISTENCE',

                    category:
                        'PERSISTENCE_FAILURE',

                    message:
                        'Impossibile persistire artifact.',

                    originalErrorName:
                        'ArtifactPersistenceInvariantError',

                    iteration:
                        originalResult.currentIteration,

                    recoverable:
                        false
                };

                const resolution =
                    resolveTerminalState({
                        failure:
                            persistenceFailure,

                        refinementBudgetExhausted:
                            true
                    });

                const failedResult:
                    WorkbenchSessionState = {
                    ...originalResult,

                    status:
                        resolution.status,

                    autonomousStatus:
                        resolution.status,

                    finalizationStatus:
                        'NOT_FINALIZED',

                    candidateVerified:
                        originalResult.candidateVerified,

                    autonomousRunSucceeded:
                        false,

                    failure:
                        persistenceFailure,

                    terminationReason:
                        describeTerminalState(
                            resolution,
                            persistenceFailure
                        )
                };

                expect(
                    failedResult.status
                ).toBe(
                    'INFRASTRUCTURE_ERROR'
                );

                expect(
                    failedResult.autonomousStatus
                ).toBe(
                    'INFRASTRUCTURE_ERROR'
                );

                expect(
                    failedResult.finalizationStatus
                ).toBe(
                    'NOT_FINALIZED'
                );

                expect(
                    failedResult.candidateVerified
                ).toBe(true);

                expect(
                    failedResult.autonomousRunSucceeded
                ).toBe(false);

                expect(
                    failedResult.isHumanAugmented
                ).toBe(false);

                expect(
                    failedResult.failure
                ).toEqual(
                    persistenceFailure
                );

                expect(
                    failedResult.failure?.phase
                ).toBe(
                    'PERSISTENCE'
                );

                expect(
                    failedResult.failure?.category
                ).toBe(
                    'PERSISTENCE_FAILURE'
                );

                expect(
                    failedResult.failure?.recoverable
                ).toBe(false);

                expect(
                    failedResult.runId
                ).toBeUndefined();

                expect(
                    failedResult.terminationReason
                ).toContain(
                    'PERSISTENCE_FAILURE'
                );
            }
        );
    }
);
