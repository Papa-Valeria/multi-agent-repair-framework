import {
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import type {
    ComputationalTelemetry,
    IterationRecord,
    TestExecutionReport,
    VerificationVerdict,
    WorkbenchSessionState
} from '../src/types/domain.js';

import type {
    ExperimentMetadata,
    ModeAggregateMetrics,
    RunQualityMetrics,
    RunSummary,
    StoredRun,
    StoredRunV1
} from '../src/types/analytics.js';

import {
    TelemetryStorage
} from '../src/telemetry/TelemetryStorage.js';

interface TelemetryStorageTestAccess {
    readRuns:
    () => Promise<StoredRun[]>;

    materializeRun:
    (
        run: StoredRun
    ) => StoredRun;

    toSummary:
    (
        run: StoredRun
    ) => RunSummary;

    aggregateMode:
    (
        runs: readonly RunSummary[]
    ) => ModeAggregateMetrics;
}

const createTelemetry =
    (): ComputationalTelemetry => ({
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
    });

const createReport =
    (): TestExecutionReport => ({
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

        stdoutTruncated:
            false,

        stderrTruncated:
            false,

        executionDurationMs:
            0
    });

const createVerdict =
    (): VerificationVerdict => ({
        verified:
            false,

        oracleResults:
            [],

        sastFindings:
            [],

        testReport:
            createReport()
    });

const createIteration = (
    iteration:
        number,
    addedLines:
        number,
    deletedLines:
        number
): IterationRecord => ({
    iteration,

    patchDiff:
        '',

    patchHash:
        `hash-${iteration}`,

    isApplicable:
        false,

    verification:
        createVerdict(),

    telemetry:
        createTelemetry(),

    patchChanges: {
        addedLines,
        deletedLines
    },

    applyMode:
        'NOT_APPLICABLE'
});

const createSession = (
    iterations:
        readonly IterationRecord[]
): WorkbenchSessionState => ({
    taskId:
        'task-be-p1-13',

    issueSpec:
        'Process versus final patch metrics.',

    category:
        'REPAIR',

    status:
        'UNRESOLVED',

    autonomousStatus:
        'UNRESOLVED',

    finalizationStatus:
        'NOT_FINALIZED',

    candidateVerified:
        false,

    autonomousRunSucceeded:
        false,

    targetFiles:
        [],

    testFiles:
        [],

    currentIteration:
        iterations.length,

    maxIterations:
        3,

    iterations,

    cumulativeTelemetry:
        createTelemetry()
});

const createMetadata = (
    overrides:
        Partial<ExperimentMetadata> = {}
): ExperimentMetadata => ({
    runId:
        '00000000-0000-0000-0000-000000000001',

    taskId:
        'task-be-p1-13',

    category:
        'REPAIR',

    mode:
        'BASELINE',

    apiBaseUrl:
        'http://localhost',

    modelName:
        'test-model',

    seed:
        42,

    temperature:
        0,

    topP:
        1,

    inferenceTimeoutMs:
        120_000,

    timestamp:
        '2026-10-29T08:00:00.000Z',

    status:
        'UNRESOLVED',

    autonomousStatus:
        'UNRESOLVED',

    finalizationStatus:
        'NOT_FINALIZED',

    candidateVerified:
        false,

    autonomousRunSucceeded:
        false,

    totalIterations:
        1,

    totalTokens:
        0,

    tokenUsageAvailable:
        true,

    totalDurationMs:
        0,

    inferenceDurationMs:
        0,

    oracleDurationMs:
        0,

    orchestrationOverheadMs:
        0,

    orchestrationOverheadBasis:
        'NODE_PROCESS_CPU',

    isHumanAugmented:
        false,

    resolutionVerified:
        false,

    ...overrides
});

const createMetrics = (
    overrides:
        Partial<RunQualityMetrics> = {}
): RunQualityMetrics => ({
    candidateVerified:
        false,

    autonomousRunSucceeded:
        false,

    resolutionVerified:
        false,

    testPassRatePct:
        null,

    testCounts: {
        total:
            0,

        passed:
            0,

        failed:
            0,

        skipped:
            0,

        xfailed:
            0,

        xpassed:
            0,

        errors:
            0
    },

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

    residualSastCount:
        0,

    sastErrors:
        0,

    sastWarnings:
        0,

    allPatchesApplicable:
        false,

    fuzzyFallbackUsed:
        false,

    processPatchGrounding: {
        hunks:
            0,

        ungroundedHunks:
            0,

        oldSideLines:
            0,

        ungroundedLines:
            0
    },

    processUngroundedOldSideLineRatePct:
        null,

    processUngroundedHunkRatePct:
        null,

    finalPatchGrounding: {
        hunks:
            0,

        ungroundedHunks:
            0,

        oldSideLines:
            0,

        ungroundedLines:
            0
    },

    finalUngroundedOldSideLineRatePct:
        null,

    finalUngroundedHunkRatePct:
        null,

    patchFlappingDetected:
        false,

    processAddedLines:
        0,

    processDeletedLines:
        0,

    finalAddedLines:
        0,

    finalDeletedLines:
        0,

    promptTokens:
        0,

    completionTokens:
        0,

    tokenUsageAvailable:
        true,

    coderPromptTokens:
        0,

    coderCompletionTokens:
        0,

    coderTokenUsageAvailable:
        true,

    reviewerPromptTokens:
        0,

    reviewerCompletionTokens:
        0,

    reviewerTokenUsageAvailable:
        true,

    totalTokens:
        0,

    inferenceDurationMs:
        0,

    oracleDurationMs:
        0,

    oracleDurationComparable:
        true,

    ...overrides
});

const createSummary = (
    metricsOverrides:
        Partial<RunQualityMetrics> = {},
    metadataOverrides:
        Partial<ExperimentMetadata> = {}
): RunSummary => ({
    metadata:
        createMetadata(
            metadataOverrides
        ),

    metrics:
        createMetrics(
            metricsOverrides
        )
});

const createStoredRun = (
    iterations:
        readonly IterationRecord[]
): StoredRunV1 => {
    const session =
        createSession(
            iterations
        );

    return {
        schemaVersion:
            1,

        metadata:
            createMetadata({
                totalIterations:
                    iterations.length
            }),

        modelConfig: {
            baseUrl:
                'http://localhost',

            modelName:
                'test-model',

            seed:
                42,

            temperature:
                0,

            topP:
                1,

            inferenceTimeoutMs:
                120_000
        },

        session,

        targetSources:
            {}
    };
};

const accessStorage = (
    storage:
        TelemetryStorage
): TelemetryStorageTestAccess =>
    storage as unknown as
    TelemetryStorageTestAccess;

describe(
    'BE-P1-13 - Process versus final patch metrics',
    () => {
        describe(
            'run-level churn semantics',
            () => {
                it(
                    'separa churn di processo e churn della candidata finale',
                    () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const run =
                            createStoredRun([
                                createIteration(
                                    1,
                                    10,
                                    4
                                ),

                                createIteration(
                                    2,
                                    3,
                                    1
                                )
                            ]);

                        const summary =
                            access.toSummary(
                                run
                            );

                        expect(
                            summary.metrics
                                .processAddedLines
                        ).toBe(
                            13
                        );

                        expect(
                            summary.metrics
                                .processDeletedLines
                        ).toBe(
                            5
                        );

                        expect(
                            summary.metrics
                                .finalAddedLines
                        ).toBe(
                            3
                        );

                        expect(
                            summary.metrics
                                .finalDeletedLines
                        ).toBe(
                            1
                        );
                    }
                );

                it(
                    'usa esclusivamente l ultima iterazione per il churn finale',
                    () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const run =
                            createStoredRun([
                                createIteration(
                                    1,
                                    100,
                                    50
                                ),

                                createIteration(
                                    2,
                                    20,
                                    10
                                ),

                                createIteration(
                                    3,
                                    2,
                                    1
                                )
                            ]);

                        const summary =
                            access.toSummary(
                                run
                            );

                        expect(
                            summary.metrics
                                .processAddedLines
                        ).toBe(
                            122
                        );

                        expect(
                            summary.metrics
                                .processDeletedLines
                        ).toBe(
                            61
                        );

                        expect(
                            summary.metrics
                                .finalAddedLines
                        ).toBe(
                            2
                        );

                        expect(
                            summary.metrics
                                .finalDeletedLines
                        ).toBe(
                            1
                        );
                    }
                );

                it(
                    'fa coincidere process e final churn con una sola iterazione',
                    () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const run =
                            createStoredRun([
                                createIteration(
                                    1,
                                    7,
                                    3
                                )
                            ]);

                        const summary =
                            access.toSummary(
                                run
                            );

                        expect(
                            summary.metrics
                                .processAddedLines
                        ).toBe(
                            7
                        );

                        expect(
                            summary.metrics
                                .processDeletedLines
                        ).toBe(
                            3
                        );

                        expect(
                            summary.metrics
                                .finalAddedLines
                        ).toBe(
                            7
                        );

                        expect(
                            summary.metrics
                                .finalDeletedLines
                        ).toBe(
                            3
                        );
                    }
                );

                it(
                    'produce churn zero quando non esistono iterazioni',
                    () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const run =
                            createStoredRun(
                                []
                            );

                        const summary =
                            access.toSummary(
                                run
                            );

                        expect(
                            summary.metrics
                                .processAddedLines
                        ).toBe(
                            0
                        );

                        expect(
                            summary.metrics
                                .processDeletedLines
                        ).toBe(
                            0
                        );

                        expect(
                            summary.metrics
                                .finalAddedLines
                        ).toBe(
                            0
                        );

                        expect(
                            summary.metrics
                                .finalDeletedLines
                        ).toBe(
                            0
                        );

                        expect(
                            summary.metrics
                                .processPatchGrounding
                        ).toEqual({
                            hunks:
                                0,

                            ungroundedHunks:
                                0,

                            oldSideLines:
                                0,

                            ungroundedLines:
                                0
                        });

                        expect(
                            summary.metrics
                                .finalPatchGrounding
                        ).toEqual({
                            hunks:
                                0,

                            ungroundedHunks:
                                0,

                            oldSideLines:
                                0,

                            ungroundedLines:
                                0
                        });

                        expect(
                            summary.metrics
                                .processUngroundedOldSideLineRatePct
                        ).toBeNull();

                        expect(
                            summary.metrics
                                .processUngroundedHunkRatePct
                        ).toBeNull();

                        expect(
                            summary.metrics
                                .finalUngroundedOldSideLineRatePct
                        ).toBeNull();

                        expect(
                            summary.metrics
                                .finalUngroundedHunkRatePct
                        ).toBeNull();
                    }
                );
            }
        );

        describe(
            'mode-level grounding semantics',
            () => {
                it(
                    'calcola separatamente pooled grounding process e final',
                    () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const runs:
                            readonly RunSummary[] = [
                                createSummary({
                                    processPatchGrounding: {
                                        hunks:
                                            4,

                                        ungroundedHunks:
                                            2,

                                        oldSideLines:
                                            20,

                                        ungroundedLines:
                                            10
                                    },

                                    finalPatchGrounding: {
                                        hunks:
                                            2,

                                        ungroundedHunks:
                                            0,

                                        oldSideLines:
                                            10,

                                        ungroundedLines:
                                            0
                                    },

                                    processAddedLines:
                                        20,

                                    processDeletedLines:
                                        10,

                                    finalAddedLines:
                                        5,

                                    finalDeletedLines:
                                        2
                                }),

                                createSummary(
                                    {
                                        processPatchGrounding: {
                                            hunks:
                                                6,

                                            ungroundedHunks:
                                                1,

                                            oldSideLines:
                                                80,

                                            ungroundedLines:
                                                10
                                        },

                                        finalPatchGrounding: {
                                            hunks:
                                                2,

                                            ungroundedHunks:
                                                1,

                                            oldSideLines:
                                                30,

                                            ungroundedLines:
                                                10
                                        },

                                        processAddedLines:
                                            40,

                                        processDeletedLines:
                                            20,

                                        finalAddedLines:
                                            10,

                                        finalDeletedLines:
                                            4
                                    },
                                    {
                                        runId:
                                            '00000000-0000-0000-0000-000000000002'
                                    }
                                )
                            ];

                        const metrics =
                            access.aggregateMode(
                                runs
                            );

                        /*
                         * Process old-side:
                         * (10 + 10) / (20 + 80) * 100 = 20
                         */
                        expect(
                            metrics
                                .processUngroundedOldSideLineRatePct
                        ).toBe(
                            20
                        );

                        /*
                         * Process hunks:
                         * (2 + 1) / (4 + 6) * 100 = 30
                         */
                        expect(
                            metrics
                                .processUngroundedHunkRatePct
                        ).toBe(
                            30
                        );

                        /*
                         * Final old-side:
                         * (0 + 10) / (10 + 30) * 100 = 25
                         */
                        expect(
                            metrics
                                .finalUngroundedOldSideLineRatePct
                        ).toBe(
                            25
                        );

                        /*
                         * Final hunks:
                         * (0 + 1) / (2 + 2) * 100 = 25
                         */
                        expect(
                            metrics
                                .finalUngroundedHunkRatePct
                        ).toBe(
                            25
                        );
                    }
                );

                it(
                    'calcola averageProcessAddedLines e averageProcessDeletedLines',
                    () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const metrics =
                            access.aggregateMode([
                                createSummary({
                                    processAddedLines:
                                        10,

                                    processDeletedLines:
                                        4
                                }),

                                createSummary(
                                    {
                                        processAddedLines:
                                            30,

                                        processDeletedLines:
                                            8
                                    },
                                    {
                                        runId:
                                            '00000000-0000-0000-0000-000000000003'
                                    }
                                )
                            ]);

                        expect(
                            metrics
                                .averageProcessAddedLines
                        ).toBe(
                            20
                        );

                        expect(
                            metrics
                                .averageProcessDeletedLines
                        ).toBe(
                            6
                        );
                    }
                );

                it(
                    'restituisce null per i rate senza denominatori',
                    () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const metrics =
                            access.aggregateMode([
                                createSummary()
                            ]);

                        expect(
                            metrics
                                .processUngroundedOldSideLineRatePct
                        ).toBeNull();

                        expect(
                            metrics
                                .processUngroundedHunkRatePct
                        ).toBeNull();

                        expect(
                            metrics
                                .finalUngroundedOldSideLineRatePct
                        ).toBeNull();

                        expect(
                            metrics
                                .finalUngroundedHunkRatePct
                        ).toBeNull();
                    }
                );
            }
        );

        describe(
            'AggregatedMetricsReport churn semantics',
            () => {
                it(
                    'mantiene separate le medie process e final code churn',
                    async () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const syntheticRuns:
                            StoredRun[] = [
                                createStoredRun(
                                    []
                                ),

                                {
                                    ...createStoredRun(
                                        []
                                    ),

                                    metadata:
                                        createMetadata({
                                            runId:
                                                '00000000-0000-0000-0000-000000000010'
                                        })
                                }
                            ];

                        const summaries:
                            RunSummary[] = [
                                createSummary({
                                    processAddedLines:
                                        10,

                                    processDeletedLines:
                                        4,

                                    finalAddedLines:
                                        3,

                                    finalDeletedLines:
                                        1
                                }),

                                createSummary(
                                    {
                                        processAddedLines:
                                            30,

                                        processDeletedLines:
                                            6,

                                        finalAddedLines:
                                            7,

                                        finalDeletedLines:
                                            1
                                    },
                                    {
                                        runId:
                                            '00000000-0000-0000-0000-000000000010'
                                    }
                                )
                            ];

                        jest.spyOn(
                            access,
                            'readRuns'
                        ).mockResolvedValue(
                            syntheticRuns
                        );

                        jest.spyOn(
                            access,
                            'materializeRun'
                        ).mockImplementation(
                            (run) =>
                                run
                        );

                        jest.spyOn(
                            access,
                            'toSummary'
                        ).mockImplementation(
                            (run) => {
                                const summary =
                                    summaries.find(
                                        (candidate) =>
                                            candidate.metadata.runId ===
                                            run.metadata.runId
                                    );

                                if (
                                    summary === undefined
                                ) {
                                    throw new Error(
                                        `Summary non trovata per ${run.metadata.runId}.`
                                    );
                                }

                                return summary;
                            }
                        );

                        const report =
                            await storage
                                .getAggregatedMetrics();

                        /*
                         * Process churn per run:
                         * 10 + 4 = 14
                         * 30 + 6 = 36
                         * media = 25
                         */
                        expect(
                            report
                                .averageProcessCodeChurnLines
                        ).toBe(
                            25
                        );

                        /*
                         * Final churn per run:
                         * 3 + 1 = 4
                         * 7 + 1 = 8
                         * media = 6
                         */
                        expect(
                            report
                                .averageFinalCodeChurnLines
                        ).toBe(
                            6
                        );

                        expect(
                            report
                                .averageProcessCodeChurnLines
                        ).not.toBe(
                            report
                                .averageFinalCodeChurnLines
                        );
                    }
                );
            }
        );
    }
);
