import {
    describe,
    expect,
    it
} from '@jest/globals';

import type {
    IterationRecord,
    ReviewerFeedbackPayload,
    WorkbenchSessionState
} from '../src/types/domain.js';

import {
    assertWorkbenchSessionInvariants,
    VerificationInvariantError
} from '../src/verification/VerificationInvariants.js';

const feedback:
    ReviewerFeedbackPayload = {
    rootCauseSummary:
        'La sorgente deve essere corretta.',

    violationsPrunedCount:
        0,

    targetRemediations: [
        {
            file:
                'src/target.py',

            lineRange: {
                start:
                    1,

                end:
                    1
            },

            rootCause:
                'Implementazione errata.',

            mandatoryCorrection:
                'Correggere il codice sorgente.'
        }
    ],

    securityPriorityStrict:
        true,

    flappingDetected:
        false
};

const createIteration =
    (
        overrides:
            Partial<IterationRecord> = {}
    ): IterationRecord => ({
        iteration:
            1,

        patchDiff:
            '',

        patchHash:
            '',

        isApplicable:
            false,

        verification: {
            verified:
                false,

            oracleResults:
                [],

            sastFindings:
                [],

            testReport: {
                oracleStatus:
                    'NOT_AVAILABLE',

                command:
                    null,

                args:
                    [],

                cwd:
                    null,

                timeoutMs:
                    null,

                envAllowList:
                    [],

                oracleFilesExecuted:
                    [],

                implicitDiscoveryUsed:
                    false,

                expectedExitPolicy:
                    null,

                exitCode:
                    null,

                suitePassed:
                    false,

                timedOut:
                    false,

                oracleFailed:
                    false,

                totalTests:
                    0,

                passedTests:
                    0,

                failedTests:
                    0,

                skippedTests:
                    0,

                xfailedTests:
                    0,

                xpassedTests:
                    0,

                errorTests:
                    0,

                passRate:
                    0,

                durationMs:
                    0,

                failureDetails:
                    [],

                stdout:
                    '',

                stderr:
                    '',

                rawStdout:
                    '',

                rawStderr:
                    '',

                executionDurationMs:
                    0
            }
        },

        telemetry: {
            promptTokens:
                0,

            completionTokens:
                0,

            tokenUsageAvailable:
                true,

            inferenceDurationMs:
                0,

            oracleDurationMs:
                0,

            orchestrationOverheadMs:
                0,

            totalDurationMs:
                0,

            agentUsage: {
                CODER: {
                    promptTokens:
                        0,

                    completionTokens:
                        0,

                    tokenUsageAvailable:
                        true,

                    inferenceDurationMs:
                        0
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

        applyMode:
            'NOT_APPLICABLE',

        ...overrides
    });

const createState =
    (
        iteration:
            IterationRecord
    ): WorkbenchSessionState => ({
        taskId:
            'BE-P0-28-invariants',

        issueSpec:
            'Test provenance Reviewer.',

        category:
            'REPAIR',

        status:
            'FAILED',

        autonomousStatus:
            'FAILED',

        finalizationStatus:
            'NOT_FINALIZED',

        candidateVerified:
            false,

        autonomousRunSucceeded:
            false,

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

        iterations: [
            iteration
        ],

        cumulativeTelemetry:
            iteration.telemetry
    });

const captureInvariantError =
    (
        state:
            WorkbenchSessionState
    ): VerificationInvariantError => {
        try {
            assertWorkbenchSessionInvariants(
                state
            );
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
            'Era attesa una VerificationInvariantError.'
        );
    };

describe(
    'BE-P0-28 - Reviewer provenance invariants',
    () => {
        it(
            'accetta reviewerMode LLM senza fallbackReason',
            () => {
                const state =
                    createState(
                        createIteration({
                            reviewerFeedback:
                                feedback,

                            reviewerMode:
                                'LLM'
                        })
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
            'accetta un fallback deterministico con reason non vuota',
            () => {
                const state =
                    createState(
                        createIteration({
                            reviewerFeedback:
                                feedback,

                            reviewerMode:
                                'DETERMINISTIC_FALLBACK',

                            fallbackReason:
                                'Reviewer JSON parsing failure'
                        })
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
            'accetta una remediation prodotta dall orchestratore',
            () => {
                const state =
                    createState(
                        createIteration({
                            reviewerFeedback:
                                feedback,

                            reviewerMode:
                                'ORCHESTRATOR'
                        })
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
            'rifiuta reviewerFeedback privo di reviewerMode',
            () => {
                const error =
                    captureInvariantError(
                        createState(
                            createIteration({
                                reviewerFeedback:
                                    feedback
                            })
                        )
                    );

                expect(
                    error.violations
                ).toContain(
                    'iteration 1: reviewerFeedback presente senza reviewerMode'
                );
            }
        );

        it(
            'rifiuta reviewerMode privo di reviewerFeedback',
            () => {
                const error =
                    captureInvariantError(
                        createState(
                            createIteration({
                                reviewerMode:
                                    'LLM'
                            })
                        )
                    );

                expect(
                    error.violations
                ).toContain(
                    'iteration 1: reviewerMode presente senza reviewerFeedback'
                );
            }
        );

        it(
            'rifiuta fallback deterministico privo di fallbackReason',
            () => {
                const error =
                    captureInvariantError(
                        createState(
                            createIteration({
                                reviewerFeedback:
                                    feedback,

                                reviewerMode:
                                    'DETERMINISTIC_FALLBACK'
                            })
                        )
                    );

                expect(
                    error.violations
                ).toContain(
                    'iteration 1: reviewerMode=DETERMINISTIC_FALLBACK richiede fallbackReason non vuoto'
                );
            }
        );

        it(
            'rifiuta fallbackReason vuota',
            () => {
                const error =
                    captureInvariantError(
                        createState(
                            createIteration({
                                reviewerFeedback:
                                    feedback,

                                reviewerMode:
                                    'DETERMINISTIC_FALLBACK',

                                fallbackReason:
                                    '   '
                            })
                        )
                    );

                expect(
                    error.violations
                ).toContain(
                    'iteration 1: reviewerMode=DETERMINISTIC_FALLBACK richiede fallbackReason non vuoto'
                );
            }
        );

        it(
            'rifiuta fallbackReason con reviewerMode LLM',
            () => {
                const error =
                    captureInvariantError(
                        createState(
                            createIteration({
                                reviewerFeedback:
                                    feedback,

                                reviewerMode:
                                    'LLM',

                                fallbackReason:
                                    'reason non consentita'
                            })
                        )
                    );

                expect(
                    error.violations
                ).toContain(
                    'iteration 1: fallbackReason è consentito solo con reviewerMode=DETERMINISTIC_FALLBACK'
                );
            }
        );

        it(
            'rifiuta fallbackReason con reviewerMode ORCHESTRATOR',
            () => {
                const error =
                    captureInvariantError(
                        createState(
                            createIteration({
                                reviewerFeedback:
                                    feedback,

                                reviewerMode:
                                    'ORCHESTRATOR',

                                fallbackReason:
                                    'reason non consentita'
                            })
                        )
                    );

                expect(
                    error.violations
                ).toContain(
                    'iteration 1: fallbackReason è consentito solo con reviewerMode=DETERMINISTIC_FALLBACK'
                );
            }
        );
    }
);
