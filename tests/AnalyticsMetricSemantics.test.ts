import {
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import type {
    ExperimentMetadata,
    ModeAggregateMetrics,
    RunQualityMetrics,
    RunSummary,
    StoredRun
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

const createMetadata = (
    overrides:
        Partial<ExperimentMetadata> = {}
): ExperimentMetadata => ({
    runId:
        '00000000-0000-0000-0000-000000000001',

    taskId:
        'task-be-p1-12',

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
        100,

    inferenceDurationMs:
        50,

    oracleDurationMs:
        25,

    orchestrationOverheadMs:
        5,

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
        true,

    fuzzyFallbackUsed:
        false,

    patchGrounding: {
        hunks:
            0,

        ungroundedHunks:
            0,

        oldSideLines:
            0,

        ungroundedLines:
            0
    },

    ungroundedOldSideLineRatePct:
        null,

    ungroundedHunkRatePct:
        null,

    patchFlappingDetected:
        false,

    addedLines:
        0,

    deletedLines:
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
    metadataOverrides:
        Partial<ExperimentMetadata> = {},
    metricsOverrides:
        Partial<RunQualityMetrics> = {}
): RunSummary => {
    const metadata =
        createMetadata(
            metadataOverrides
        );

    return {
        metadata,

        metrics:
            createMetrics({
                candidateVerified:
                    metadata.candidateVerified,

                autonomousRunSucceeded:
                    metadata.autonomousRunSucceeded,

                resolutionVerified:
                    metadata.resolutionVerified,

                totalTokens:
                    metadata.totalTokens,

                inferenceDurationMs:
                    metadata.inferenceDurationMs,

                oracleDurationMs:
                    metadata.oracleDurationMs,

                ...metricsOverrides
            })
    };
};

const createSyntheticRun = (
    runId: string
): StoredRun => ({
    schemaVersion:
        1,

    metadata:
        createMetadata({
            runId
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

    session: {
        taskId:
            'task-be-p1-12',

        issueSpec:
            'Synthetic analytics run.',

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
            0,

        maxIterations:
            1,

        iterations:
            [],

        cumulativeTelemetry: {
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
        }
    },

    targetSources:
        {}
});

const accessStorage = (
    storage:
        TelemetryStorage
): TelemetryStorageTestAccess =>
    storage as unknown as
    TelemetryStorageTestAccess;

describe(
    'BE-P1-12 - Analytics metric semantics',
    () => {
        describe(
            'ungroundedOldSideLineRatePct',
            () => {
                it(
                    'calcola il pooled rate sulle old-side lines e non la media delle percentuali per-run',
                    () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const runs: readonly RunSummary[] = [
                            createSummary(
                                {},
                                {
                                    patchGrounding: {
                                        hunks:
                                            1,

                                        ungroundedHunks:
                                            1,

                                        oldSideLines:
                                            10,

                                        ungroundedLines:
                                            10
                                    },

                                    ungroundedOldSideLineRatePct:
                                        100,

                                    ungroundedHunkRatePct:
                                        100
                                }
                            ),

                            createSummary(
                                {
                                    runId:
                                        '00000000-0000-0000-0000-000000000002'
                                },
                                {
                                    patchGrounding: {
                                        hunks:
                                            9,

                                        ungroundedHunks:
                                            0,

                                        oldSideLines:
                                            90,

                                        ungroundedLines:
                                            0
                                    },

                                    ungroundedOldSideLineRatePct:
                                        0,

                                    ungroundedHunkRatePct:
                                        0
                                }
                            )
                        ];

                        const metrics =
                            access.aggregateMode(
                                runs
                            );

                        /*
                         * Pooled old-side line rate:
                         *
                         * (10 + 0) / (10 + 90) * 100 = 10
                         *
                         * La media non pesata delle percentuali per-run
                         * sarebbe invece (100 + 0) / 2 = 50.
                         */
                        expect(
                            metrics
                                .ungroundedOldSideLineRatePct
                        ).toBe(
                            10
                        );

                        expect(
                            metrics
                                .ungroundedOldSideLineRatePct
                        ).not.toBe(
                            50
                        );
                    }
                );

                it(
                    'restituisce null quando non esistono old-side lines',
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
                                .ungroundedOldSideLineRatePct
                        ).toBeNull();
                    }
                );

                it(
                    'mantiene distinta la metrica sugli hunk',
                    () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const runs: readonly RunSummary[] = [
                            createSummary(
                                {},
                                {
                                    patchGrounding: {
                                        hunks:
                                            4,

                                        ungroundedHunks:
                                            1,

                                        oldSideLines:
                                            20,

                                        ungroundedLines:
                                            10
                                    },

                                    ungroundedOldSideLineRatePct:
                                        50,

                                    ungroundedHunkRatePct:
                                        25
                                }
                            )
                        ];

                        const metrics =
                            access.aggregateMode(
                                runs
                            );

                        expect(
                            metrics
                                .ungroundedOldSideLineRatePct
                        ).toBe(
                            50
                        );

                        expect(
                            metrics
                                .ungroundedHunkRatePct
                        ).toBe(
                            25
                        );
                    }
                );
            }
        );

        describe(
            'averageTokensPerVerifiedRun',
            () => {
                it(
                    'considera le run candidateVerified e non le sole autonomousRunSucceeded',
                    async () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const syntheticRuns:
                            StoredRun[] = [
                                createSyntheticRun(
                                    '00000000-0000-0000-0000-000000000001'
                                ),

                                createSyntheticRun(
                                    '00000000-0000-0000-0000-000000000002'
                                ),

                                createSyntheticRun(
                                    '00000000-0000-0000-0000-000000000003'
                                )
                            ];

                        const summaries:
                            RunSummary[] = [
                                createSummary(
                                    {
                                        runId:
                                            syntheticRuns[0]!
                                                .metadata.runId,

                                        candidateVerified:
                                            true,

                                        autonomousRunSucceeded:
                                            false,

                                        totalTokens:
                                            100
                                    },
                                    {
                                        candidateVerified:
                                            true,

                                        autonomousRunSucceeded:
                                            false,

                                        totalTokens:
                                            100
                                    }
                                ),

                                createSummary(
                                    {
                                        runId:
                                            syntheticRuns[1]!
                                                .metadata.runId,

                                        candidateVerified:
                                            true,

                                        autonomousRunSucceeded:
                                            true,

                                        totalTokens:
                                            300
                                    },
                                    {
                                        candidateVerified:
                                            true,

                                        autonomousRunSucceeded:
                                            true,

                                        totalTokens:
                                            300
                                    }
                                ),

                                createSummary(
                                    {
                                        runId:
                                            syntheticRuns[2]!
                                                .metadata.runId,

                                        candidateVerified:
                                            false,

                                        autonomousRunSucceeded:
                                            true,

                                        totalTokens:
                                            1_000
                                    },
                                    {
                                        candidateVerified:
                                            false,

                                        autonomousRunSucceeded:
                                            true,

                                        totalTokens:
                                            1_000
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
                         * Sono candidateVerified soltanto:
                         *
                         * 100 token
                         * 300 token
                         *
                         * La run da 1000 token è esclusa anche se dichiara
                         * autonomousRunSucceeded=true.
                         */
                        expect(
                            report
                                .averageTokensPerVerifiedRun
                        ).toBe(
                            200
                        );
                    }
                );

                it(
                    'esclude dalla media le run verificate senza token disponibili',
                    async () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const syntheticRuns:
                            StoredRun[] = [
                                createSyntheticRun(
                                    '00000000-0000-0000-0000-000000000011'
                                ),

                                createSyntheticRun(
                                    '00000000-0000-0000-0000-000000000012'
                                ),

                                createSyntheticRun(
                                    '00000000-0000-0000-0000-000000000013'
                                )
                            ];

                        const summaries:
                            RunSummary[] = [
                                createSummary(
                                    {
                                        runId:
                                            syntheticRuns[0]!
                                                .metadata.runId,

                                        candidateVerified:
                                            true,

                                        totalTokens:
                                            100
                                    },
                                    {
                                        candidateVerified:
                                            true,

                                        totalTokens:
                                            100
                                    }
                                ),

                                createSummary(
                                    {
                                        runId:
                                            syntheticRuns[1]!
                                                .metadata.runId,

                                        candidateVerified:
                                            true,

                                        totalTokens:
                                            null,

                                        tokenUsageAvailable:
                                            false
                                    },
                                    {
                                        candidateVerified:
                                            true,

                                        totalTokens:
                                            null,

                                        tokenUsageAvailable:
                                            false,

                                        promptTokens:
                                            null,

                                        completionTokens:
                                            null
                                    }
                                ),

                                createSummary(
                                    {
                                        runId:
                                            syntheticRuns[2]!
                                                .metadata.runId,

                                        candidateVerified:
                                            true,

                                        totalTokens:
                                            300
                                    },
                                    {
                                        candidateVerified:
                                            true,

                                        totalTokens:
                                            300
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

                        expect(
                            report
                                .averageTokensPerVerifiedRun
                        ).toBe(
                            200
                        );
                    }
                );

                it(
                    'restituisce null quando non esistono run verificate con token disponibili',
                    async () => {
                        const storage =
                            new TelemetryStorage();

                        const access =
                            accessStorage(
                                storage
                            );

                        const syntheticRun =
                            createSyntheticRun(
                                '00000000-0000-0000-0000-000000000021'
                            );

                        const summary =
                            createSummary(
                                {
                                    runId:
                                        syntheticRun.metadata
                                            .runId,

                                    candidateVerified:
                                        false,

                                    totalTokens:
                                        500
                                },
                                {
                                    candidateVerified:
                                        false,

                                    totalTokens:
                                        500
                                }
                            );

                        jest.spyOn(
                            access,
                            'readRuns'
                        ).mockResolvedValue([
                            syntheticRun
                        ]);

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
                        ).mockReturnValue(
                            summary
                        );

                        const report =
                            await storage
                                .getAggregatedMetrics();

                        expect(
                            report
                                .averageTokensPerVerifiedRun
                        ).toBeNull();
                    }
                );
            }
        );
    }
);
