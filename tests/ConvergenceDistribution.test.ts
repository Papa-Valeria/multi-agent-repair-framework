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
    StoredRunV2
} from '../src/types/analytics.js';

import type {
    AutonomousWorkbenchSessionStatus,
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

const createTelemetry = ():
    ComputationalTelemetry => ({
        promptTokens:
            100,

        completionTokens:
            20,

        tokenUsageAvailable:
            true,

        inferenceDurationMs:
            100,

        oracleDurationMs:
            10,

        orchestrationOverheadMs:
            5,

        totalDurationMs:
            115,

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
    verified: boolean
): TestExecutionReport => ({
    oracleStatus:
        verified
            ? 'PASS'
            : 'FAIL',

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
        verified
            ? 0
            : 1,

    suitePassed:
        verified,

    timedOut:
        false,

    oracleFailed:
        false,

    totalTests:
        1,

    passedTests:
        verified
            ? 1
            : 0,

    failedTests:
        verified
            ? 0
            : 1,

    skippedTests:
        0,

    xfailedTests:
        0,

    xpassedTests:
        0,

    errorTests:
        0,

    passRate:
        verified
            ? 1
            : 0,

    durationMs:
        10,

    failureDetails:
        verified
            ? []
            : [
                {
                    testName:
                        'test_target',

                    assertionMessage:
                        'Candidate not verified.',

                    stackTrace:
                        'AssertionError'
                }
            ],

    stdout:
        verified
            ? '1 passed'
            : '1 failed',

    stderr:
        '',

    rawStdout:
        verified
            ? '1 passed'
            : '1 failed',

    rawStderr:
        '',

    executionDurationMs:
        10
});

const createExperimentProfile = (
    taskId: string,
    maxIterations: number
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
        maxIterations,

        maxTechnicalAttempts:
            2
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

const createSession = (
    taskId: string,
    runId: string,
    status:
        AutonomousWorkbenchSessionStatus,
    totalIterations: number
): WorkbenchSessionState => {
    const candidateVerified =
        status === 'CONVERGED';

    const autonomousRunSucceeded =
        status === 'CONVERGED' &&
        candidateVerified;

    const telemetry =
        createTelemetry();

    const patchDiff = [
        '--- a/src/target.py',
        '+++ b/src/target.py',
        '@@ -1 +1 @@',
        '-return False',
        '+return True'
    ].join('\n');

    const iterations =
        Array.from(
            {
                length:
                    totalIterations
            },
            (
                _,
                index
            ) => {
                const isFinal =
                    index ===
                    totalIterations - 1;

                const verified =
                    isFinal &&
                    candidateVerified;

                return {
                    iteration:
                        index + 1,

                    patchDiff,

                    patchHash:
                        `patch-${taskId}-${index + 1}`,

                    isApplicable:
                        true,

                    verification: {
                        verified,

                        oracleResults:
                            [],

                        sastFindings:
                            [],

                        semgrepDurationMs:
                            0,

                        testReport:
                            createTestReport(
                                verified
                            )
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
                        'GIT' as const,

                    fuzzyFallbackUsed:
                        false,

                    technicalAttempts:
                        1
                };
            }
        );

    return {
        taskId,

        runId,

        issueSpec:
            'Verificare la distribuzione delle iterazioni alla convergenza.',

        category:
            'REPAIR',

        status,

        autonomousStatus:
            status,

        finalizationStatus:
            'NOT_FINALIZED',

        candidateVerified,

        autonomousRunSucceeded,

        targetFiles: [
            'src/target.py'
        ],

        testFiles: [
            'tests/test_target.py'
        ],

        currentIteration:
            totalIterations,

        maxIterations:
            totalIterations,

        iterations,

        finalPatch:
            patchDiff,

        cumulativeTelemetry:
            telemetry,

        isHumanAugmented:
            false,

        initialHead:
            '0123456789abcdef',

        ...(status ===
            'FAILED'
            ? {
                failure: {
                    phase:
                        'EVALUATION' as const,

                    category:
                        'ORACLE_EXECUTION_FAILURE' as const,

                    message:
                        'Valutazione non completata.',

                    iteration:
                        totalIterations,

                    recoverable:
                        false
                }
            }
            : {}),

        ...(status ===
            'INFRASTRUCTURE_ERROR'
            ? {
                failure: {
                    phase:
                        'ROLLBACK' as const,

                    category:
                        'ROLLBACK_FAILURE' as const,

                    message:
                        'Rollback non completato.',

                    iteration:
                        totalIterations,

                    recoverable:
                        false
                }
            }
            : {}),

        terminationReason:
            status
    };
};

const createMetadata = (
    taskId: string,
    runId: string,
    status:
        AutonomousWorkbenchSessionStatus,
    totalIterations: number,
    timestamp: string
): ExperimentMetadata => {
    const candidateVerified =
        status === 'CONVERGED';

    const autonomousRunSucceeded =
        status === 'CONVERGED' &&
        candidateVerified;

    return {
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

        status,

        autonomousStatus:
            status,

        finalizationStatus:
            'NOT_FINALIZED',

        candidateVerified,

        autonomousRunSucceeded,

        totalIterations,

        totalTokens:
            120,

        tokenUsageAvailable:
            true,

        totalDurationMs:
            115,

        inferenceDurationMs:
            100,

        oracleDurationMs:
            10,

        orchestrationOverheadMs:
            5,

        orchestrationOverheadBasis:
            'NODE_PROCESS_CPU',

        isHumanAugmented:
            false,

        resolutionVerified:
            autonomousRunSucceeded
    };
};

const createArtifact = (
    taskId: string,
    runId: string,
    status:
        AutonomousWorkbenchSessionStatus,
    totalIterations: number,
    timestamp: string
): StoredRunV2 => ({
    schemaVersion:
        2,

    metadata:
        createMetadata(
            taskId,
            runId,
            status,
            totalIterations,
            timestamp
        ),

    modelConfig,

    experimentProfile:
        createExperimentProfile(
            taskId,
            totalIterations
        ),

    session:
        createSession(
            taskId,
            runId,
            status,
            totalIterations
        ),

    targetSources: {
        'src/target.py':
            'return False\n'
    }
});

const writeArtifact = async (
    storageDirectory: string,
    artifact: StoredRunV2
): Promise<void> => {
    const filename = [
        artifact.metadata.taskId,
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
    'BE-P0-19 - Convergence distribution',
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
            'usa i bucket 1 2 3 solo per convergenza effettiva, N_MAX per UNRESOLVED e separa gli invalidi',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'convergence-distribution-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const artifacts = [
                    /*
                     * Convergenza effettiva.
                     */
                    createArtifact(
                        'converged-iteration-1',
                        '11111111-1111-4111-8111-111111111111',
                        'CONVERGED',
                        1,
                        '2026-10-27T08:00:00.000Z'
                    ),

                    createArtifact(
                        'converged-iteration-2',
                        '22222222-2222-4222-8222-222222222222',
                        'CONVERGED',
                        2,
                        '2026-10-27T08:01:00.000Z'
                    ),

                    createArtifact(
                        'converged-iteration-3',
                        '33333333-3333-4333-8333-333333333333',
                        'CONVERGED',
                        3,
                        '2026-10-27T08:02:00.000Z'
                    ),

                    /*
                     * Non-convergenza valida.
                     *
                     * Il primo termina materialmente
                     * a iterazione 1 ma deve comunque
                     * essere classificato N_MAX.
                     */
                    createArtifact(
                        'unresolved-iteration-1',
                        '44444444-4444-4444-8444-444444444444',
                        'UNRESOLVED',
                        1,
                        '2026-10-27T08:03:00.000Z'
                    ),

                    createArtifact(
                        'unresolved-iteration-3',
                        '55555555-5555-4555-8555-555555555555',
                        'UNRESOLVED',
                        3,
                        '2026-10-27T08:04:00.000Z'
                    ),

                    /*
                     * Run invalidi.
                     *
                     * Non devono entrare né nei bucket
                     * 1/2/3 né in N_MAX.
                     */
                    createArtifact(
                        'failed-iteration-1',
                        '66666666-6666-4666-8666-666666666666',
                        'FAILED',
                        1,
                        '2026-10-27T08:05:00.000Z'
                    ),

                    createArtifact(
                        'infrastructure-iteration-2',
                        '77777777-7777-4777-8777-777777777777',
                        'INFRASTRUCTURE_ERROR',
                        2,
                        '2026-10-27T08:06:00.000Z'
                    )
                ];

                for (const artifact of artifacts) {
                    await writeArtifact(
                        storageDirectory,
                        artifact
                    );
                }

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
                    metrics.runCount
                ).toBe(7);

                expect(
                    metrics.resolvedCount
                ).toBe(3);

                expect(
                    metrics.convergenceDistribution
                ).toEqual({
                    '1':
                        1,

                    '2':
                        1,

                    '3':
                        1,

                    N_MAX:
                        2
                });

                expect(
                    metrics
                        .convergenceDistributionInvalidRunCount
                ).toBe(2);

                /*
                 * Check di consistenza:
                 *
                 * 3 convergenti
                 * + 2 valid non-convergenti
                 * + 2 invalidi
                 * = 7 run.
                 */
                const classifiedRuns =
                    metrics
                        .convergenceDistribution['1'] +
                    metrics
                        .convergenceDistribution['2'] +
                    metrics
                        .convergenceDistribution['3'] +
                    metrics
                        .convergenceDistribution.N_MAX +
                    metrics
                        .convergenceDistributionInvalidRunCount;

                expect(
                    classifiedRuns
                ).toBe(
                    metrics.runCount
                );
            }
        );

        it(
            'non confonde terminazione anticipata UNRESOLVED con convergenza alla prima iterazione',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'convergence-unresolved-early-'
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
                    createArtifact(
                        'early-unresolved',
                        '88888888-8888-4888-8888-888888888888',
                        'UNRESOLVED',
                        1,
                        '2026-10-27T08:07:00.000Z'
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
                    metrics.convergenceDistribution['1']
                ).toBe(0);

                expect(
                    metrics.convergenceDistribution['2']
                ).toBe(0);

                expect(
                    metrics.convergenceDistribution['3']
                ).toBe(0);

                expect(
                    metrics.convergenceDistribution.N_MAX
                ).toBe(1);

                expect(
                    metrics
                        .convergenceDistributionInvalidRunCount
                ).toBe(0);
            }
        );

        it(
            'esclude FAILED e INFRASTRUCTURE_ERROR da tutti i bucket di convergenza',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'convergence-invalid-'
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
                    createArtifact(
                        'failed-only',
                        '99999999-9999-4999-8999-999999999999',
                        'FAILED',
                        1,
                        '2026-10-27T08:08:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'infrastructure-only',
                        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                        'INFRASTRUCTURE_ERROR',
                        2,
                        '2026-10-27T08:09:00.000Z'
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
                    metrics.convergenceDistribution
                ).toEqual({
                    '1':
                        0,

                    '2':
                        0,

                    '3':
                        0,

                    N_MAX:
                        0
                });

                expect(
                    metrics
                        .convergenceDistributionInvalidRunCount
                ).toBe(2);

                /*
                 * Coerenza con BE-P0-18.
                 */
                expect(
                    metrics.invalidRunCount
                ).toBe(2);

                expect(
                    metrics.validRunConvergenceDenominator
                ).toBe(0);

                expect(
                    metrics.validRunConvergenceRatePct
                ).toBeNull();
            }
        );
    }
);
