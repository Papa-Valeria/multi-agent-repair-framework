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
    ExperimentMode,
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
                        'Expected True, received False.',

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

const createSession = (
    taskId: string,
    runId: string,
    status:
        AutonomousWorkbenchSessionStatus
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

    return {
        taskId,

        runId,

        issueSpec:
            'Verificare raw convergence e valid-run convergence.',

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
                        candidateVerified,

                    oracleResults:
                        [],

                    sastFindings:
                        [],

                    semgrepDurationMs:
                        0,

                    testReport:
                        createTestReport(
                            candidateVerified
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

        ...(status ===
            'INFRASTRUCTURE_ERROR'
            ? {
                failure: {
                    phase:
                        'ROLLBACK' as const,

                    category:
                        'ROLLBACK_FAILURE' as const,

                    message:
                        'Rollback fallito.',

                    iteration:
                        1,

                    recoverable:
                        false
                }
            }
            : {}),

        ...(status === 'FAILED'
            ? {
                failure: {
                    phase:
                        'EVALUATION' as const,

                    category:
                        'ORACLE_EXECUTION_FAILURE' as const,

                    message:
                        'Valutazione non completata.',

                    iteration:
                        1,

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
    mode: ExperimentMode,
    status:
        AutonomousWorkbenchSessionStatus,
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

        mode,

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

        totalIterations:
            1,

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
    mode: ExperimentMode,
    status:
        AutonomousWorkbenchSessionStatus,
    timestamp: string
): StoredRunV2 => ({
    schemaVersion:
        2,

    metadata:
        createMetadata(
            taskId,
            runId,
            mode,
            status,
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
            status
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
        artifact.metadata.mode,
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
    'BE-P0-18 - Raw e valid-run convergence rate',
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
            'espone numeratori e denominatori distinti per raw e valid-run convergence',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'convergence-denominators-'
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
                 * Popolazione controllata:
                 *
                 * CONVERGED             = 2
                 * UNRESOLVED            = 1
                 * FAILED                = 1
                 * INFRASTRUCTURE_ERROR  = 1
                 *
                 * Raw:
                 * 2 / 5 = 40%
                 *
                 * Valid-run:
                 * 2 / 3 = 66,666...%
                 *
                 * Invalid:
                 * 2
                 */
                const artifacts = [
                    createArtifact(
                        'converged-1',
                        '11111111-1111-4111-8111-111111111111',
                        'MULTI_AGENT',
                        'CONVERGED',
                        '2026-10-27T08:00:00.000Z'
                    ),

                    createArtifact(
                        'converged-2',
                        '22222222-2222-4222-8222-222222222222',
                        'MULTI_AGENT',
                        'CONVERGED',
                        '2026-10-27T08:01:00.000Z'
                    ),

                    createArtifact(
                        'unresolved-1',
                        '33333333-3333-4333-8333-333333333333',
                        'MULTI_AGENT',
                        'UNRESOLVED',
                        '2026-10-27T08:02:00.000Z'
                    ),

                    createArtifact(
                        'failed-1',
                        '44444444-4444-4444-8444-444444444444',
                        'MULTI_AGENT',
                        'FAILED',
                        '2026-10-27T08:03:00.000Z'
                    ),

                    createArtifact(
                        'infrastructure-error-1',
                        '55555555-5555-4555-8555-555555555555',
                        'MULTI_AGENT',
                        'INFRASTRUCTURE_ERROR',
                        '2026-10-27T08:04:00.000Z'
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
                ).toBe(5);

                expect(
                    metrics.resolvedCount
                ).toBe(2);

                /*
                 * Raw convergence:
                 * tutti i run entrano nel denominatore.
                 */
                expect(
                    metrics.rawConvergenceNumerator
                ).toBe(2);

                expect(
                    metrics.rawConvergenceDenominator
                ).toBe(5);

                expect(
                    metrics.rawConvergenceRatePct
                ).toBe(40);

                /*
                 * Valid-run convergence:
                 * soltanto CONVERGED e UNRESOLVED
                 * entrano nel denominatore.
                 */
                expect(
                    metrics.validRunConvergenceNumerator
                ).toBe(2);

                expect(
                    metrics.validRunConvergenceDenominator
                ).toBe(3);

                expect(
                    metrics.validRunConvergenceRatePct
                ).toBeCloseTo(
                    66.6666666667,
                    8
                );

                expect(
                    metrics.invalidRunCount
                ).toBe(2);

                /*
                 * Campo legacy:
                 * deve restare alias della raw rate.
                 */
                expect(
                    metrics.successRatePct
                ).toBe(
                    metrics.rawConvergenceRatePct
                );

                expect(
                    metrics.successRatePct
                ).toBe(40);
            }
        );

        it(
            'restituisce null quando il denominatore raw e valid-run è vuoto',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'convergence-empty-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const report =
                    await storage
                        .getAggregatedMetrics({
                            category:
                                'REPAIR',

                            modelName:
                                modelConfig.modelName
                        });

                const baseline =
                    report.modes.BASELINE;

                const multiAgent =
                    report.modes.MULTI_AGENT;

                for (
                    const metrics of [
                        baseline,
                        multiAgent
                    ]
                ) {
                    expect(
                        metrics.runCount
                    ).toBe(0);

                    expect(
                        metrics.resolvedCount
                    ).toBe(0);

                    expect(
                        metrics.rawConvergenceNumerator
                    ).toBe(0);

                    expect(
                        metrics.rawConvergenceDenominator
                    ).toBe(0);

                    expect(
                        metrics.rawConvergenceRatePct
                    ).toBeNull();

                    expect(
                        metrics.validRunConvergenceNumerator
                    ).toBe(0);

                    expect(
                        metrics.validRunConvergenceDenominator
                    ).toBe(0);

                    expect(
                        metrics.validRunConvergenceRatePct
                    ).toBeNull();

                    expect(
                        metrics.invalidRunCount
                    ).toBe(0);

                    expect(
                        metrics.successRatePct
                    ).toBeNull();
                }
            }
        );

        it(
            'restituisce valid-run null quando esistono soltanto run invalidi',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'convergence-invalid-only-'
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
                        '66666666-6666-4666-8666-666666666666',
                        'BASELINE',
                        'FAILED',
                        '2026-10-27T08:05:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'infrastructure-only',
                        '77777777-7777-4777-8777-777777777777',
                        'BASELINE',
                        'INFRASTRUCTURE_ERROR',
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
                    report.modes.BASELINE;

                /*
                 * Raw: 0 successi su 2 run.
                 */
                expect(
                    metrics.rawConvergenceNumerator
                ).toBe(0);

                expect(
                    metrics.rawConvergenceDenominator
                ).toBe(2);

                expect(
                    metrics.rawConvergenceRatePct
                ).toBe(0);

                /*
                 * Valid-run: nessun run validamente
                 * valutabile, quindi percentuale null.
                 */
                expect(
                    metrics.validRunConvergenceNumerator
                ).toBe(0);

                expect(
                    metrics.validRunConvergenceDenominator
                ).toBe(0);

                expect(
                    metrics.validRunConvergenceRatePct
                ).toBeNull();

                expect(
                    metrics.invalidRunCount
                ).toBe(2);

                expect(
                    metrics.successRatePct
                ).toBe(0);
            }
        );
    }
);
