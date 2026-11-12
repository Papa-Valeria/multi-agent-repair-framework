import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    TelemetryStorage
} from '../src/telemetry/TelemetryStorage.js';

import type {
    StoredRunV1,
    StoredRunV2
} from '../src/types/analytics.js';

import type {
    AgentUsage,
    TestExecutionReport
} from '../src/types/domain.js';

const BASELINE_RUN_ID =
    '11111111-1111-4111-8111-111111111111';

const MULTI_RUN_ID =
    '22222222-2222-4222-8222-222222222222';

const V2_RUN_ID =
    '33333333-3333-4333-8333-333333333333';

const LEGACY_TASK_ID =
    'BE-P1-30-task';

const V2_TASK_ID =
    'BE-P1-30-v2-task';

const AGENT_USAGE:
    Readonly<
        Record<
            'CODER' | 'REVIEWER',
            AgentUsage
        >
    > = {
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
};

const V2_AGENT_USAGE:
    Readonly<
        Record<
            'CODER' | 'REVIEWER',
            AgentUsage
        >
    > = {
    CODER: {
        promptTokens: 15,
        completionTokens: 8,
        tokenUsageAvailable: true,
        inferenceDurationMs: 100
    },

    REVIEWER: {
        promptTokens: 5,
        completionTokens: 2,
        tokenUsageAvailable: true,
        inferenceDurationMs: 50
    }
};

const TEST_REPORT:
    TestExecutionReport = {
    oracleStatus: 'PASS',

    command: 'pytest',

    args: [
        'tests/test_example.py'
    ],

    cwd: '.',

    timeoutMs: 30_000,

    envAllowList: [],

    oracleFilesExecuted: [
        'tests/test_example.py'
    ],

    implicitDiscoveryUsed: false,

    expectedExitPolicy: {
        passExitCodes: [0],
        failExitCodes: [1],
        executionErrorExitCodes: []
    },

    exitCode: 0,

    suitePassed: true,

    timedOut: false,

    oracleFailed: false,

    totalTests: 1,

    passedTests: 1,

    failedTests: 0,

    skippedTests: 0,

    xfailedTests: 0,

    xpassedTests: 0,

    errorTests: 0,

    passRate: 1,

    durationMs: 10,

    failureDetails: [],

    stdout:
        '1 passed in 0.01s',

    stderr: '',

    rawStdout:
        '1 passed in 0.01s',

    rawStderr: '',

    stdoutTruncated: false,

    stderrTruncated: false,

    executionDurationMs: 10
};

const createLegacyRun = (
    runId: string,
    mode: 'BASELINE' | 'MULTI_AGENT'
): StoredRunV1 => ({
    schemaVersion: 1,

    metadata: {
        runId,

        taskId:
            LEGACY_TASK_ID,

        category:
            'REPAIR',

        mode,

        apiBaseUrl:
            'http://localhost:11434/v1',

        modelName:
            'legacy-model',

        seed: 42,

        temperature: 0,

        topP: 1,

        inferenceTimeoutMs:
            Number.NaN,

        timestamp:
            mode === 'BASELINE'
                ? '2026-10-30T10:00:00.000Z'
                : '2026-10-30T10:01:00.000Z',

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
            15,

        tokenUsageAvailable:
            true,

        totalDurationMs:
            100,

        inferenceDurationMs:
            80,

        oracleDurationMs:
            10,

        orchestrationOverheadMs:
            10,

        orchestrationOverheadBasis:
            'NODE_PROCESS_CPU',

        isHumanAugmented:
            false,

        resolutionVerified:
            false
    },

    modelConfig: {
        baseUrl:
            'http://localhost:11434/v1',

        modelName:
            'legacy-model',

        seed: 42,

        temperature: 0,

        topP: 1,

        inferenceTimeoutMs:
            Number.NaN
    },

    session: {
        taskId:
            LEGACY_TASK_ID,

        issueSpec:
            'Legacy telemetry comparability',

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

        targetFiles: [
            'src/example.py'
        ],

        testFiles: [
            'tests/test_example.py'
        ],

        currentIteration:
            1,

        maxIterations:
            3,

        iterations: [
            {
                iteration: 1,

                patchDiff: [
                    '--- a/src/example.py',
                    '+++ b/src/example.py',
                    '@@ -1 +1 @@',
                    '-value = 1',
                    '+value = 2'
                ].join('\n'),

                patchHash:
                    'legacy-hash',

                isApplicable:
                    true,

                verification: {
                    verified:
                        false,

                    oracleResults: [],

                    sastFindings: [],

                    testReport:
                        TEST_REPORT
                },

                telemetry: {
                    promptTokens:
                        10,

                    completionTokens:
                        5,

                    tokenUsageAvailable:
                        true,

                    inferenceDurationMs:
                        80,

                    oracleDurationMs:
                        10,

                    orchestrationOverheadMs:
                        10,

                    totalDurationMs:
                        100,

                    agentUsage:
                        AGENT_USAGE
                },

                agentUsage:
                    AGENT_USAGE,

                patchChanges: {
                    addedLines: 1,
                    deletedLines: 1
                },

                applyMode:
                    'GIT',

                fuzzyFallbackUsed:
                    false
            }
        ],

        cumulativeTelemetry: {
            promptTokens:
                10,

            completionTokens:
                5,

            tokenUsageAvailable:
                true,

            inferenceDurationMs:
                80,

            oracleDurationMs:
                10,

            orchestrationOverheadMs:
                10,

            totalDurationMs:
                100,

            agentUsage:
                AGENT_USAGE
        },

        terminationReason:
            'Legacy unresolved run'
    },

    targetSources: {
        'src/example.py':
            'value = 1\n'
    }
});

const createV2Run =
    (): StoredRunV2 => ({
        schemaVersion: 2,

        metadata: {
            runId:
                V2_RUN_ID,

            taskId:
                V2_TASK_ID,

            category:
                'REPAIR',

            mode:
                'BASELINE',

            apiBaseUrl:
                'http://localhost:11434/v1',

            modelName:
                'v2-model',

            seed: 42,
            temperature: 0,
            topP: 1,

            inferenceTimeoutMs:
                90_000,

            timestamp:
                '2026-10-30T11:00:00.000Z',

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
                30,

            tokenUsageAvailable:
                true,

            totalDurationMs:
                200,

            inferenceDurationMs:
                150,

            oracleDurationMs:
                30,

            orchestrationOverheadMs:
                20,

            orchestrationOverheadBasis:
                'NODE_PROCESS_CPU',

            isHumanAugmented:
                false,

            resolutionVerified:
                false
        },

        modelConfig: {
            baseUrl:
                'http://localhost:11434/v1',

            modelName:
                'v2-model',

            seed: 42,
            temperature: 0,
            topP: 1,

            inferenceTimeoutMs:
                90_000
        },

        experimentProfile: {
            oracleProfileId:
                'FULL_VERIFICATION_V1',

            promptProfileId:
                'prompt-profile-v3',

            semgrepProfileId:
                'semgrep-profile-v1',

            buildOracleConfig: {
                command:
                    'python',

                args: [
                    '-m',
                    'py_compile'
                ],

                cwd:
                    '.',

                timeoutMs:
                    30_000,

                envAllowList:
                    []
            },

            functionalTestOracleConfig: {
                command:
                    'pytest',

                args: [
                    'tests/test_example.py'
                ],

                cwd:
                    '.',

                timeoutMs:
                    30_000,

                envAllowList:
                    [],

                oracleFiles: [
                    'tests/test_example.py'
                ],

                expectedExitPolicy: {
                    passExitCodes: [0],
                    failExitCodes: [1],
                    executionErrorExitCodes: []
                },

                allowImplicitDiscovery:
                    false
            },

            semgrepConfig: {
                command:
                    'semgrep',

                timeoutMs:
                    30_000,

                envAllowList:
                    []
            },

            modelConfig: {
                baseUrl:
                    'http://localhost:11434/v1',

                modelName:
                    'v2-model',

                seed: 42,
                temperature: 0,
                topP: 1,

                inferenceTimeoutMs:
                    90_000
            },

            limits: {
                maxIterations: 3,
                maxTechnicalAttempts: 2
            },

            fixture: {
                id:
                    'fixture-v2',

                taskId:
                    V2_TASK_ID,

                category:
                    'REPAIR',

                targetFiles: [
                    'src/example.py'
                ],

                testFiles: [
                    'tests/test_example.py'
                ]
            }
        },

        session: {
            taskId:
                V2_TASK_ID,

            issueSpec:
                'V2 comparability control',

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

            targetFiles: [
                'src/example.py'
            ],

            testFiles: [
                'tests/test_example.py'
            ],

            currentIteration:
                1,

            maxIterations:
                3,

            iterations: [
                {
                    iteration: 1,

                    patchDiff: [
                        '--- a/src/example.py',
                        '+++ b/src/example.py',
                        '@@ -1 +1 @@',
                        '-value = 1',
                        '+value = 2'
                    ].join('\n'),

                    patchHash:
                        'v2-hash',

                    isApplicable:
                        true,

                    verification: {
                        verified:
                            false,

                        oracleResults: [],

                        sastFindings: [],

                        testReport:
                            TEST_REPORT
                    },

                    telemetry: {
                        promptTokens:
                            20,

                        completionTokens:
                            10,

                        tokenUsageAvailable:
                            true,

                        inferenceDurationMs:
                            150,

                        oracleDurationMs:
                            30,

                        orchestrationOverheadMs:
                            20,

                        totalDurationMs:
                            200,

                        agentUsage:
                            V2_AGENT_USAGE
                    },

                    agentUsage:
                        V2_AGENT_USAGE,

                    patchChanges: {
                        addedLines: 1,
                        deletedLines: 1
                    },

                    applyMode:
                        'GIT',

                    fuzzyFallbackUsed:
                        false,

                    technicalAttempts:
                        1
                }
            ],

            cumulativeTelemetry: {
                promptTokens:
                    20,

                completionTokens:
                    10,

                tokenUsageAvailable:
                    true,

                inferenceDurationMs:
                    150,

                oracleDurationMs:
                    30,

                orchestrationOverheadMs:
                    20,

                totalDurationMs:
                    200,

                agentUsage:
                    V2_AGENT_USAGE
            },

            terminationReason:
                'V2 unresolved run'
        },

        targetSources: {
            'src/example.py':
                'value = 1\n'
        }
    });

describe(
    'BE-P1-30 - legacy materialization and analytics comparability',
    () => {
        let storageDirectory:
            string;

        const writeArtifact =
            async (
                filename: string,
                value: unknown
            ): Promise<string> => {
                const destination =
                    path.join(
                        storageDirectory,
                        filename
                    );

                await fs.writeFile(
                    destination,
                    `${JSON.stringify(
                        value,
                        null,
                        2
                    )}\n`,
                    'utf8'
                );

                return destination;
            };

        const legacyArtifactWithoutDerivedProvenance =
            (
                run: StoredRunV1
            ): Record<string, unknown> => {
                const raw =
                    JSON.parse(
                        JSON.stringify(
                            run
                        )
                    ) as Record<
                        string,
                        any
                    >;

                /*
                 * Simuliamo il vero artifact legacy:
                 * nessun timeout osservato.
                 */
                delete raw
                    .modelConfig
                    .inferenceTimeoutMs;

                delete raw
                    .metadata
                    .inferenceTimeoutMs;

                /*
                 * Nessuna attribution per agente
                 * osservata nel legacy.
                 */
                delete raw
                    .session
                    .cumulativeTelemetry
                    .agentUsage;

                for (
                    const iteration of
                    raw.session.iterations
                ) {
                    delete iteration
                        .telemetry
                        .agentUsage;

                    delete iteration
                        .agentUsage;
                }

                return raw;
            };

        beforeEach(
            async () => {
                storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'be-p1-30-'
                        )
                    );
            }
        );

        afterEach(
            async () => {
                await fs.rm(
                    storageDirectory,
                    {
                        recursive: true,
                        force: true
                    }
                );
            }
        );

        it(
            'mantiene leggibile un V1 senza timeout e senza agent usage senza riscrivere il file originale',
            async () => {
                const legacy =
                    legacyArtifactWithoutDerivedProvenance(
                        createLegacyRun(
                            BASELINE_RUN_ID,
                            'BASELINE'
                        )
                    );

                const artifactPath =
                    await writeArtifact(
                        'legacy-baseline.json',
                        legacy
                    );

                const before =
                    await fs.readFile(
                        artifactPath,
                        'utf8'
                    );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const summaries =
                    await storage.listRuns();

                expect(
                    summaries
                ).toHaveLength(1);

                const after =
                    await fs.readFile(
                        artifactPath,
                        'utf8'
                    );

                expect(after).toBe(
                    before
                );
            }
        );

        it(
            'non espone attribution CODER o REVIEWER legacy mancante come provenance osservata',
            async () => {
                const legacy =
                    legacyArtifactWithoutDerivedProvenance(
                        createLegacyRun(
                            BASELINE_RUN_ID,
                            'BASELINE'
                        )
                    );

                await writeArtifact(
                    'legacy-baseline.json',
                    legacy
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const summaries =
                    await storage.listRuns();

                const summary =
                    summaries[0];

                expect(
                    summary
                ).toBeDefined();

                expect(
                    summary
                        ?.comparability
                        .agentUsageObserved
                ).toBe(false);

                expect(
                    summary
                        ?.metrics
                        .coderPromptTokens
                ).toBeNull();

                expect(
                    summary
                        ?.metrics
                        .coderCompletionTokens
                ).toBeNull();

                expect(
                    summary
                        ?.metrics
                        .coderTokenUsageAvailable
                ).toBe(false);

                expect(
                    summary
                        ?.metrics
                        .reviewerPromptTokens
                ).toBeNull();

                expect(
                    summary
                        ?.metrics
                        .reviewerCompletionTokens
                ).toBeNull();

                expect(
                    summary
                        ?.metrics
                        .reviewerTokenUsageAvailable
                ).toBe(false);
            }
        );

        it(
            'mantiene disponibili i token cumulativi realmente presenti nel V1',
            async () => {
                const legacy =
                    legacyArtifactWithoutDerivedProvenance(
                        createLegacyRun(
                            BASELINE_RUN_ID,
                            'BASELINE'
                        )
                    );

                await writeArtifact(
                    'legacy-baseline.json',
                    legacy
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const summaries =
                    await storage.listRuns();

                const summary =
                    summaries[0];

                expect(
                    summary
                        ?.metrics
                        .promptTokens
                ).toBe(10);

                expect(
                    summary
                        ?.metrics
                        .completionTokens
                ).toBe(5);

                expect(
                    summary
                        ?.metrics
                        .tokenUsageAvailable
                ).toBe(true);

                expect(
                    summary
                        ?.metrics
                        .totalTokens
                ).toBe(15);
            }
        );

        it(
            'materializza tecnicamente il timeout legacy ma lo marca come non osservato',
            async () => {
                const legacy =
                    legacyArtifactWithoutDerivedProvenance(
                        createLegacyRun(
                            BASELINE_RUN_ID,
                            'BASELINE'
                        )
                    );

                await writeArtifact(
                    'legacy-baseline.json',
                    legacy
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const summaries =
                    await storage.listRuns();

                const summary =
                    summaries[0];

                expect(
                    summary
                        ?.metadata
                        .inferenceTimeoutMs
                ).toBe(
                    120_000
                );

                expect(
                    summary
                        ?.comparability
                        .inferenceTimeoutObserved
                ).toBe(false);
            }
        );

        it(
            'non crea pairing sperimentale tra due V1 usando il timeout legacy materializzato',
            async () => {
                const baseline =
                    legacyArtifactWithoutDerivedProvenance(
                        createLegacyRun(
                            BASELINE_RUN_ID,
                            'BASELINE'
                        )
                    );

                const multi =
                    legacyArtifactWithoutDerivedProvenance(
                        createLegacyRun(
                            MULTI_RUN_ID,
                            'MULTI_AGENT'
                        )
                    );

                await writeArtifact(
                    'legacy-baseline.json',
                    baseline
                );

                await writeArtifact(
                    'legacy-multi.json',
                    multi
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const metrics =
                    await storage
                        .getAggregatedMetrics();

                expect(
                    metrics.pairedTasks
                ).toEqual([]);

                expect(
                    metrics
                        .autonomousRecoveryEligiblePairs
                ).toBe(0);
            }
        );

        it(
            'un filtro esplicito sul timeout non considera compatibile un V1 con fallback legacy',
            async () => {
                const baseline =
                    legacyArtifactWithoutDerivedProvenance(
                        createLegacyRun(
                            BASELINE_RUN_ID,
                            'BASELINE'
                        )
                    );

                const multi =
                    legacyArtifactWithoutDerivedProvenance(
                        createLegacyRun(
                            MULTI_RUN_ID,
                            'MULTI_AGENT'
                        )
                    );

                await writeArtifact(
                    'legacy-baseline.json',
                    baseline
                );

                await writeArtifact(
                    'legacy-multi.json',
                    multi
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const comparison =
                    await storage.compareTask(
                        LEGACY_TASK_ID,
                        {
                            inferenceTimeoutMs:
                                120_000
                        }
                    );

                expect(
                    comparison
                ).toEqual({
                    baseline: null,
                    multiAgent: null
                });
            }
        );

        it(
            'mantiene un V2 comparabile con timeout e agent attribution osservati',
            async () => {
                const v2 =
                    createV2Run();

                await writeArtifact(
                    'v2.json',
                    v2
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const summaries =
                    await storage.listRuns();

                const summary =
                    summaries[0];

                expect(
                    summary
                ).toBeDefined();

                expect(
                    summary
                        ?.comparability
                        .inferenceTimeoutObserved
                ).toBe(true);

                expect(
                    summary
                        ?.comparability
                        .agentUsageObserved
                ).toBe(true);

                expect(
                    summary
                        ?.metadata
                        .inferenceTimeoutMs
                ).toBe(
                    90_000
                );

                expect(
                    summary
                        ?.metrics
                        .coderPromptTokens
                ).toBe(15);

                expect(
                    summary
                        ?.metrics
                        .coderCompletionTokens
                ).toBe(8);

                expect(
                    summary
                        ?.metrics
                        .coderTokenUsageAvailable
                ).toBe(true);

                expect(
                    summary
                        ?.metrics
                        .reviewerPromptTokens
                ).toBe(5);

                expect(
                    summary
                        ?.metrics
                        .reviewerCompletionTokens
                ).toBe(2);

                expect(
                    summary
                        ?.metrics
                        .reviewerTokenUsageAvailable
                ).toBe(true);

                expect(
                    summary
                        ?.metrics
                        .oracleDurationComparable
                ).toBe(true);

                expect(
                    summary
                        ?.metrics
                        .oracleDurationMs
                ).toBe(30);
            }
        );

        it(
            'non modifica un artifact V2 durante la lettura',
            async () => {
                const v2 =
                    createV2Run();

                const artifactPath =
                    await writeArtifact(
                        'v2.json',
                        v2
                    );

                const before =
                    await fs.readFile(
                        artifactPath,
                        'utf8'
                    );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                await storage.listRuns();

                const after =
                    await fs.readFile(
                        artifactPath,
                        'utf8'
                    );

                expect(after).toBe(
                    before
                );
            }
        );
    }
);
