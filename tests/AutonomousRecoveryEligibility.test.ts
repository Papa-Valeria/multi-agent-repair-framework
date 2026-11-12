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
        [],

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

    const iterations =
        Array.from(
            {
                length:
                    totalIterations
            },
            (
                unused,
                index
            ) => {
                void unused;

                const isFinalIteration =
                    index ===
                    totalIterations - 1;

                const verified =
                    isFinalIteration &&
                    candidateVerified;

                return {
                    iteration:
                        index + 1,

                    patchDiff: [
                        '--- a/src/target.py',
                        '+++ b/src/target.py',
                        '@@ -1 +1 @@',
                        '-return False',
                        '+return True'
                    ].join('\n'),

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
            'Verificare il denominatore dell’Autonomous Recovery Rate.',

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
            iterations.at(-1)?.patchDiff,

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
                        'Rollback infrastrutturale fallito.',

                    iteration:
                        totalIterations,

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
    runId: string,
    taskId: string,
    mode: ExperimentMode,
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
    mode: ExperimentMode,
    status:
        AutonomousWorkbenchSessionStatus,
    totalIterations: number,
    timestamp: string
): StoredRunV2 => ({
    schemaVersion:
        2,

    metadata:
        createMetadata(
            runId,
            taskId,
            mode,
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
    'BE-P0-17 - Autonomous Recovery Rate eligibility',
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
            'usa soltanto baseline UNRESOLVED come denominatore ed esclude gli errori tecnici',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'autonomous-recovery-eligibility-'
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
                 * Coppia 1:
                 *
                 * Baseline UNRESOLVED.
                 * Multi-Agent CONVERGED dopo refinement.
                 *
                 * Eleggibile e recuperata.
                 */
                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'eligible-recovered',
                        '11111111-1111-4111-8111-111111111111',
                        'BASELINE',
                        'UNRESOLVED',
                        1,
                        '2026-10-27T08:00:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'eligible-recovered',
                        '11111111-1111-4111-8111-222222222222',
                        'MULTI_AGENT',
                        'CONVERGED',
                        2,
                        '2026-10-27T08:01:00.000Z'
                    )
                );

                /*
                 * Coppia 2:
                 *
                 * Baseline UNRESOLVED.
                 * Multi-Agent ancora UNRESOLVED.
                 *
                 * Eleggibile ma non recuperata.
                 */
                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'eligible-not-recovered',
                        '22222222-2222-4222-8222-111111111111',
                        'BASELINE',
                        'UNRESOLVED',
                        1,
                        '2026-10-27T08:02:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'eligible-not-recovered',
                        '22222222-2222-4222-8222-222222222222',
                        'MULTI_AGENT',
                        'UNRESOLVED',
                        3,
                        '2026-10-27T08:03:00.000Z'
                    )
                );

                /*
                 * Coppia 3:
                 *
                 * Baseline INFRASTRUCTURE_ERROR.
                 * Multi-Agent CONVERGED.
                 *
                 * La coppia può apparire recuperata in senso
                 * meccanico, ma non è statisticamente eleggibile.
                 */
                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'infrastructure-excluded',
                        '33333333-3333-4333-8333-111111111111',
                        'BASELINE',
                        'INFRASTRUCTURE_ERROR',
                        1,
                        '2026-10-27T08:04:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'infrastructure-excluded',
                        '33333333-3333-4333-8333-222222222222',
                        'MULTI_AGENT',
                        'CONVERGED',
                        2,
                        '2026-10-27T08:05:00.000Z'
                    )
                );

                /*
                 * Coppia 4:
                 *
                 * Baseline FAILED.
                 * Multi-Agent CONVERGED.
                 *
                 * Esclusa come altro failure tecnico.
                 */
                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'other-failure-excluded',
                        '44444444-4444-4444-8444-111111111111',
                        'BASELINE',
                        'FAILED',
                        1,
                        '2026-10-27T08:06:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'other-failure-excluded',
                        '44444444-4444-4444-8444-222222222222',
                        'MULTI_AGENT',
                        'CONVERGED',
                        2,
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

                expect(
                    report.pairedTasks
                ).toHaveLength(4);

                /*
                 * Soltanto le due baseline UNRESOLVED
                 * entrano nel denominatore.
                 */
                expect(
                    report
                        .autonomousRecoveryEligiblePairs
                ).toBe(2);

                /*
                 * Campo legacy allineato al nuovo
                 * denominatore eleggibile.
                 */
                expect(
                    report.baselineFailuresInPairs
                ).toBe(2);

                expect(
                    report
                        .autonomousRecoveryInfrastructureExcludedPairs
                ).toBe(1);

                expect(
                    report
                        .autonomousRecoveryOtherFailureExcludedPairs
                ).toBe(1);

                /*
                 * Tra le due coppie eleggibili:
                 *
                 * - una è recuperata;
                 * - una non è recuperata.
                 *
                 * Autonomous Recovery Rate = 1 / 2 = 50%.
                 */
                expect(
                    report.autonomousRecoveryRatePct
                ).toBe(50);
            }
        );

        it(
            'restituisce null quando non esistono coppie eleggibili',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'autonomous-recovery-empty-denominator-'
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
                        'only-infrastructure-error',
                        '55555555-5555-4555-8555-111111111111',
                        'BASELINE',
                        'INFRASTRUCTURE_ERROR',
                        1,
                        '2026-10-27T08:08:00.000Z'
                    )
                );

                await writeArtifact(
                    storageDirectory,
                    createArtifact(
                        'only-infrastructure-error',
                        '55555555-5555-4555-8555-222222222222',
                        'MULTI_AGENT',
                        'CONVERGED',
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

                expect(
                    report.pairedTasks
                ).toHaveLength(1);

                expect(
                    report
                        .autonomousRecoveryEligiblePairs
                ).toBe(0);

                expect(
                    report.baselineFailuresInPairs
                ).toBe(0);

                expect(
                    report
                        .autonomousRecoveryInfrastructureExcludedPairs
                ).toBe(1);

                expect(
                    report
                        .autonomousRecoveryOtherFailureExcludedPairs
                ).toBe(0);
                expect(
                    report.autonomousRecoveryRatePct
                ).toBeNull();
            }
        );
    }
);
