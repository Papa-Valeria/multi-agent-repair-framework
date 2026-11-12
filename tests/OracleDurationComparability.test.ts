import {
    afterEach,
    describe,
    expect,
    it
} from '@jest/globals';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    ContextBuilder
} from '../src/orchestration/ContextBuilder.js';

import {
    TelemetryStorage
} from '../src/telemetry/TelemetryStorage.js';

import type {
    ExperimentMetadata,
    ExperimentModelConfig,
    ExperimentProfile,
    StoredRunV1,
    StoredRunV2
} from '../src/types/analytics.js';

import type {
    ComputationalTelemetry,
    TestExecutionReport,
    WorkbenchSessionState
} from '../src/types/domain.js';

import {
    DEFAULT_ORACLE_PROFILE
} from '../src/verification/OracleDecision.js';

const modelConfig:
    ExperimentModelConfig = {
    baseUrl:
        'http://127.0.0.1:11434/v1',

    modelName:
        'qwen2.5-coder:7b',

    seed:
        42,

    temperature:
        0,

    topP:
        1,

    inferenceTimeoutMs:
        120_000
};

const createTelemetry = (
    oracleDurationMs: number
): ComputationalTelemetry => ({
    promptTokens:
        100,

    completionTokens:
        20,

    tokenUsageAvailable:
        true,

    inferenceDurationMs:
        100,

    oracleDurationMs,

    orchestrationOverheadMs:
        5,

    totalDurationMs:
        105 + oracleDurationMs,

    agentUsage: {
        CODER: {
            promptTokens:
                100,

            completionTokens:
                20,

            tokenUsageAvailable:
                true,

            inferenceDurationMs:
                100
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

const createTestReport = (
    executionDurationMs: number
): TestExecutionReport => ({
    oracleStatus:
        'PASS',

    command:
        'python',

    args: [
        '-B',
        '-m',
        'pytest',
        'tests/test_target.py'
    ],

    cwd:
        '.',

    timeoutMs:
        30_000,

    envAllowList: [
        'PATH'
    ],

    oracleFilesExecuted: [
        'tests/test_target.py'
    ],

    implicitDiscoveryUsed:
        false,

    expectedExitPolicy: {
        passExitCodes: [
            0
        ],

        failExitCodes: [
            1
        ],

        executionErrorExitCodes: [
            2,
            3,
            4,
            5
        ]
    },

    exitCode:
        0,

    suitePassed:
        true,

    timedOut:
        false,

    oracleFailed:
        false,

    totalTests:
        1,

    passedTests:
        1,

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
        1,

    durationMs:
        executionDurationMs,

    failureDetails:
        [],

    stdout:
        '1 passed',

    stderr:
        '',

    rawStdout:
        '1 passed',

    rawStderr:
        '',

    executionDurationMs
});

const createSession = (
    taskId: string,
    runId: string,
    oracleDurationMs: number,
    testExecutionDurationMs:
        number = 10
): WorkbenchSessionState => {
    const telemetry =
        createTelemetry(
            oracleDurationMs
        );

    const testReport =
        createTestReport(
            testExecutionDurationMs
        );

    const patchDiff = [
        '--- a/src/target.py',
        '+++ b/src/target.py',
        '@@ -1 +1 @@',
        '-return False',
        '+return True'
    ].join('\n');

    return {
        taskId,

        runId,

        issueSpec:
            'Verificare la comparabilità delle durate Oracle.',

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
            1,

        iterations: [
            {
                iteration:
                    1,

                patchDiff,

                patchHash:
                    `patch-${taskId}`,

                isApplicable:
                    true,

                verification: {
                    verified:
                        true,

                    oracleResults:
                        [],

                    sastFindings:
                        [],

                    /*
                     * Nei V1 il vecchio fallback può
                     * ricostruire la durata usando
                     * Semgrep + Functional Test.
                     */
                    semgrepDurationMs:
                        oracleDurationMs -
                        testExecutionDurationMs,

                    testReport
                },

                telemetry,

                agentUsage:
                    telemetry.agentUsage,

                patchChanges: {
                    addedLines:
                        1,

                    deletedLines:
                        1
                },

                applyMode:
                    'GIT',

                fuzzyFallbackUsed:
                    false,

                technicalAttempts:
                    1
            }
        ],

        finalPatch:
            patchDiff,

        cumulativeTelemetry:
            telemetry,

        isHumanAugmented:
            false,

        initialHead:
            '0123456789abcdef',

        terminationReason:
            'ALL_REQUIRED_GATES_PASSED'
    };
};

const createMetadata = (
    taskId: string,
    runId: string,
    oracleDurationMs: number,
    timestamp: string
): ExperimentMetadata => ({
    runId,

    taskId,

    category:
        'REPAIR',

    mode:
        'MULTI_AGENT',

    apiBaseUrl:
        modelConfig.baseUrl,

    modelName:
        modelConfig.modelName,

    seed:
        modelConfig.seed,

    temperature:
        modelConfig.temperature,

    topP:
        modelConfig.topP,

    inferenceTimeoutMs:
        modelConfig.inferenceTimeoutMs,

    timestamp,

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

    totalIterations:
        1,

    totalTokens:
        120,

    tokenUsageAvailable:
        true,

    totalDurationMs:
        105 + oracleDurationMs,

    inferenceDurationMs:
        100,

    oracleDurationMs,

    orchestrationOverheadMs:
        5,

    orchestrationOverheadBasis:
        'NODE_PROCESS_CPU',

    isHumanAugmented:
        false,

    resolutionVerified:
        true
});

const createExperimentProfile = (
    taskId: string
): ExperimentProfile => ({
    oracleProfileId:
        DEFAULT_ORACLE_PROFILE.id,

    promptProfileId:
        ContextBuilder.PROMPT_PROFILE_ID,

    buildOracleConfig: {
        command:
            'python',

        args: [
            '-B',
            '-m',
            'py_compile',
            'src/target.py'
        ],

        cwd:
            '.',

        timeoutMs:
            30_000,

        envAllowList: [
            'PATH'
        ]
    },

    functionalTestOracleConfig: {
        command:
            'python',

        args: [
            '-B',
            '-m',
            'pytest',
            'tests/test_target.py'
        ],

        cwd:
            '.',

        timeoutMs:
            30_000,

        oracleFiles: [
            'tests/test_target.py'
        ],

        envAllowList: [
            'PATH'
        ],

        expectedExitPolicy: {
            passExitCodes: [
                0
            ],

            failExitCodes: [
                1
            ],

            executionErrorExitCodes: [
                2,
                3,
                4,
                5
            ]
        },

        allowImplicitDiscovery:
            false
    },

    semgrepConfig: {
        command:
            'semgrep',

        timeoutMs:
            60_000,

        envAllowList: [
            'PATH',
            'PATHEXT',
            'SYSTEMROOT',
            'WINDIR',
            'TEMP',
            'TMP'
        ]
    },

    modelConfig,

    limits: {
        maxIterations:
            1,

        maxTechnicalAttempts:
            1
    },

    fixture: {
        id:
            'a'.repeat(64),

        taskId,

        category:
            'REPAIR',

        targetFiles: [
            'src/target.py'
        ],

        testFiles: [
            'tests/test_target.py'
        ]
    }
});

const createV2Artifact = (
    taskId: string,
    runId: string,
    oracleDurationMs: number,
    timestamp: string
): StoredRunV2 => ({
    schemaVersion:
        2,

    metadata:
        createMetadata(
            taskId,
            runId,
            oracleDurationMs,
            timestamp
        ),

    modelConfig,

    experimentProfile:
        createExperimentProfile(
            taskId
        ),

    session:
        createSession(
            taskId,
            runId,
            oracleDurationMs
        ),

    targetSources: {
        'src/target.py':
            'return False\n'
    }
});

const createV1Artifact = (
    taskId: string,
    runId: string,
    legacyOracleDurationMs: number,
    timestamp: string
): StoredRunV1 => ({
    schemaVersion:
        1,

    metadata:
        createMetadata(
            taskId,
            runId,
            legacyOracleDurationMs,
            timestamp
        ),

    modelConfig,

    session:
        createSession(
            taskId,
            runId,
            legacyOracleDurationMs
        ),

    targetSources: {
        'src/target.py':
            'return False\n'
    }
});

const writeArtifact = async (
    storageDirectory: string,
    artifact:
        StoredRunV1 |
        StoredRunV2
): Promise<void> => {
    const filename = [
        artifact.metadata.taskId,
        artifact.schemaVersion,
        artifact.metadata.runId,
        '.json'
    ].join('_');

    await fs.writeFile(
        path.join(
            storageDirectory,
            filename
        ),
        `${JSON.stringify(
            artifact,
            null,
            2
        )
        }\n`,
        'utf8'
    );
};

describe(
    'BE-P0-20 - Oracle duration comparability',
    () => {
        const temporaryDirectories:
            string[] = [];

        afterEach(async () => {
            await Promise.all(
                temporaryDirectories.map(
                    async (directory) => {
                        await fs.rm(
                            directory,
                            {
                                recursive:
                                    true,

                                force:
                                    true
                            }
                        );
                    }
                )
            );

            temporaryDirectories.length =
                0;
        });

        it(
            'espone la durata Oracle solo per run v2 nativi e marca i v1 come non comparabili',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'oracle-duration-summary-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                await writeArtifact(
                    storageDirectory,
                    createV2Artifact(
                        'native-v2',
                        '11111111-1111-4111-8111-111111111111',
                        100,
                        '2026-10-27T08:00:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createV1Artifact(
                        'legacy-v1',
                        '22222222-2222-4222-8222-222222222222',
                        5_000,
                        '2026-10-27T08:01:00.000Z'
                    )
                );

                const history =
                    await storage.listRuns({
                        mode:
                            'MULTI_AGENT',

                        category:
                            'REPAIR',

                        modelName:
                            modelConfig.modelName
                    });

                expect(history)
                    .toHaveLength(2);

                const native =
                    history.find(
                        (run) =>
                            run.metadata.taskId ===
                            'native-v2'
                    );

                const legacy =
                    history.find(
                        (run) =>
                            run.metadata.taskId ===
                            'legacy-v1'
                    );

                expect(native)
                    .toBeDefined();

                expect(legacy)
                    .toBeDefined();

                expect(
                    native?.metrics
                        .oracleDurationComparable
                ).toBe(true);

                expect(
                    native?.metrics
                        .oracleDurationMs
                ).toBe(100);

                expect(
                    legacy?.metrics
                        .oracleDurationComparable
                ).toBe(false);

                expect(
                    legacy?.metrics
                        .oracleDurationMs
                ).toBeNull();

                /*
                 * Il valore legacy può continuare a
                 * esistere nei metadata materializzati,
                 * ma non viene esposto come metrica
                 * comparabile.
                 */
                expect(
                    legacy?.metadata
                        .oracleDurationMs
                ).not.toBeNull();
            }
        );

        it(
            'calcola le medie Oracle usando solo valori nativi v2',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'oracle-duration-average-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                /*
                 * Durate:
                 *
                 * V2 = 100 ms
                 * V2 = 300 ms
                 * V1 = 5000 ms
                 *
                 * La media comparabile deve essere:
                 *
                 * (100 + 300) / 2 = 200 ms
                 */
                await writeArtifact(
                    storageDirectory,
                    createV2Artifact(
                        'native-v2-100',
                        '33333333-3333-4333-8333-333333333333',
                        100,
                        '2026-10-27T08:02:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createV2Artifact(
                        'native-v2-300',
                        '44444444-4444-4444-8444-444444444444',
                        300,
                        '2026-10-27T08:03:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createV1Artifact(
                        'legacy-v1-5000',
                        '55555555-5555-4555-8555-555555555555',
                        5_000,
                        '2026-10-27T08:04:00.000Z'
                    )
                );

                const report =
                    await storage
                        .getAggregatedMetrics({
                            category:
                                'REPAIR',

                            modelName:
                                modelConfig.modelName
                        });

                const modeMetrics =
                    report.modes.MULTI_AGENT;

                expect(
                    modeMetrics
                        .oracleDurationComparableRunCount
                ).toBe(2);

                expect(
                    modeMetrics
                        .oracleDurationExcludedLegacyRunCount
                ).toBe(1);

                expect(
                    modeMetrics
                        .averageOracleDurationMs
                ).toBe(200);

                expect(
                    report
                        .oracleDurationComparableRunCount
                ).toBe(2);

                expect(
                    report
                        .oracleDurationExcludedLegacyRunCount
                ).toBe(1);

                expect(
                    report.averageOracleDurationMs
                ).toBe(200);

                /*
                 * Protezione esplicita dalla vecchia
                 * media contaminata:
                 *
                 * (100 + 300 + 5000) / 3 = 1800
                 */
                expect(
                    report.averageOracleDurationMs
                ).not.toBe(1_800);
            }
        );

        it(
            'restituisce media null quando esistono soltanto run legacy',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'oracle-duration-legacy-only-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                await writeArtifact(
                    storageDirectory,
                    createV1Artifact(
                        'legacy-only-1',
                        '66666666-6666-4666-8666-666666666666',
                        1_000,
                        '2026-10-27T08:05:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createV1Artifact(
                        'legacy-only-2',
                        '77777777-7777-4777-8777-777777777777',
                        2_000,
                        '2026-10-27T08:06:00.000Z'
                    )
                );

                const report =
                    await storage
                        .getAggregatedMetrics({
                            category:
                                'REPAIR',

                            modelName:
                                modelConfig.modelName
                        });

                const metrics =
                    report.modes.MULTI_AGENT;

                expect(
                    metrics
                        .oracleDurationComparableRunCount
                ).toBe(0);

                expect(
                    metrics
                        .oracleDurationExcludedLegacyRunCount
                ).toBe(2);

                expect(
                    metrics.averageOracleDurationMs
                ).toBeNull();

                expect(
                    report
                        .oracleDurationComparableRunCount
                ).toBe(0);

                expect(
                    report
                        .oracleDurationExcludedLegacyRunCount
                ).toBe(2);

                expect(
                    report.averageOracleDurationMs
                ).toBeNull();
            }
        );
    }
);
