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
    ArtifactPersistenceInvariantError
} from '../src/telemetry/ArtifactPersistenceInvariants.js';

import {
    TelemetryStorage
} from '../src/telemetry/TelemetryStorage.js';

import type {
    ExperimentModelConfig,
    ExperimentProfile
} from '../src/types/analytics.js';

import type {
    AutonomousWorkbenchSessionStatus,
    OracleResult,
    TestExecutionReport,
    WorkbenchSessionState
} from '../src/types/domain.js';

import {
    DEFAULT_ORACLE_PROFILE
} from '../src/verification/OracleDecision.js';

const createModelConfig = ():
    ExperimentModelConfig => ({
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
    });

const createFunctionalTestConfig = ():
    ExperimentProfile[
    'functionalTestOracleConfig'
    ] => ({
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
    });

const createExperimentProfile = (
    taskId: string,
    modelConfig: ExperimentModelConfig
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

    functionalTestOracleConfig:
        createFunctionalTestConfig(),

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

const createPassingTestReport = (
    functionalConfig:
        ExperimentProfile[
        'functionalTestOracleConfig'
        ]
): TestExecutionReport => ({
    oracleStatus:
        'PASS',

    command:
        functionalConfig.command,

    args:
        functionalConfig.args,

    cwd:
        functionalConfig.cwd,

    timeoutMs:
        functionalConfig.timeoutMs,

    envAllowList:
        functionalConfig.envAllowList,

    oracleFilesExecuted:
        functionalConfig.oracleFiles,

    implicitDiscoveryUsed:
        false,

    expectedExitPolicy:
        functionalConfig.expectedExitPolicy,

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
        10,

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

    executionDurationMs:
        10
});

const createPassingOracleResults = (
    testReport:
        TestExecutionReport
): readonly OracleResult[] => [
        {
            oracle:
                'APPLICABILITY',

            status:
                'PASS',

            required:
                true,

            durationMs:
                1,

            summary:
                'Patch applicabile.',

            evidence: {
                applyMode:
                    'GIT',

                patchHash:
                    'verified-patch-hash'
            }
        },

        {
            oracle:
                'BUILD_SYNTAX',

            status:
                'PASS',

            required:
                true,

            durationMs:
                2,

            summary:
                'Build/Syntax completato con successo.',

            evidence: {
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
                ],

                exitCode:
                    0,

                timedOut:
                    false,

                stdout:
                    '',

                stderr:
                    ''
            }
        },

        {
            oracle:
                'SEMGREP',

            status:
                'PASS',

            required:
                true,

            durationMs:
                3,

            summary:
                'Semgrep completato senza finding.',

            evidence: {
                findings:
                    [],

                scannedFiles: [
                    'src/target.py'
                ]
            }
        },

        {
            oracle:
                'FUNCTIONAL_TEST',

            status:
                'PASS',

            required:
                true,

            durationMs:
                10,

            summary:
                'Test funzionali completati con successo.',

            evidence: {
                report:
                    testReport
            }
        }
    ];

const createVerifiedSession = (
    taskId: string,
    autonomousStatus:
        AutonomousWorkbenchSessionStatus,
    autonomousRunSucceeded: boolean
): WorkbenchSessionState => {
    const functionalConfig =
        createFunctionalTestConfig();

    const testReport =
        createPassingTestReport(
            functionalConfig
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

        issueSpec:
            'Verificare la separazione tra candidata verificata e successo complessivo del run.',

        category:
            'REPAIR',

        status:
            autonomousStatus,

        autonomousStatus,

        finalizationStatus:
            'NOT_FINALIZED',

        /*
         * La candidata ha superato tutti
         * gli Oracle obbligatori.
         */
        candidateVerified:
            true,

        /*
         * Il successo del run è distinto
         * dalla verifica della candidata.
         */
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
                        true,

                    oracleResults:
                        createPassingOracleResults(
                            testReport
                        ),

                    sastFindings:
                        [],

                    semgrepDurationMs:
                        3,

                    testReport
                },

                telemetry: {
                    promptTokens:
                        100,

                    completionTokens:
                        20,

                    tokenUsageAvailable:
                        true,

                    inferenceDurationMs:
                        100,

                    oracleDurationMs:
                        16,

                    orchestrationOverheadMs:
                        5,

                    totalDurationMs:
                        121,

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
                },

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
                },

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

        cumulativeTelemetry: {
            promptTokens:
                100,

            completionTokens:
                20,

            tokenUsageAvailable:
                true,

            inferenceDurationMs:
                100,

            oracleDurationMs:
                16,

            orchestrationOverheadMs:
                5,

            totalDurationMs:
                121,

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
        },

        isHumanAugmented:
            false,

        initialHead:
            '0123456789abcdef',

        ...(autonomousStatus ===
            'INFRASTRUCTURE_ERROR'
            ? {
                failure: {
                    phase:
                        'ROLLBACK',

                    category:
                        'ROLLBACK_FAILURE',

                    message:
                        'Il rollback Git non ha ripristinato completamente il repository.',

                    iteration:
                        1,

                    recoverable:
                        false
                },

                rollbackResult: {
                    status:
                        'FAILED',

                    initialHead:
                        '0123456789abcdef',

                    finalHead:
                        'fedcba9876543210',

                    repositoryClean:
                        false,

                    workingTreeStatus:
                        ' M src/target.py',

                    message:
                        'Rollback incompleto.'
                }
            }
            : {}),

        terminationReason:
            autonomousStatus ===
                'CONVERGED'
                ? 'ALL_REQUIRED_GATES_PASSED'
                : 'ROLLBACK_FAILURE'
    };
};

describe(
    'BE-P0-16 - Candidate verification e run success',
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
            'considera riuscito un run CONVERGED con candidata verificata',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'candidate-success-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const modelConfig =
                    createModelConfig();

                const session =
                    createVerifiedSession(
                        'candidate-verified-success',
                        'CONVERGED',
                        true
                    );

                const profile =
                    createExperimentProfile(
                        session.taskId,
                        modelConfig
                    );

                const runId =
                    await storage.saveRun(
                        session,
                        'MULTI_AGENT',
                        modelConfig,
                        'REPAIR',
                        profile,
                        {
                            'src/target.py':
                                'return False\n'
                        }
                    );

                const loaded =
                    await storage.getRun(
                        runId
                    );

                expect(loaded)
                    .not
                    .toBeNull();

                if (!loaded) {
                    throw new Error(
                        'Il run convergente deve essere disponibile.'
                    );
                }

                expect(
                    loaded.session.candidateVerified
                ).toBe(true);

                expect(
                    loaded.session.autonomousRunSucceeded
                ).toBe(true);

                expect(
                    loaded.metadata.candidateVerified
                ).toBe(true);

                expect(
                    loaded.metadata.autonomousRunSucceeded
                ).toBe(true);

                expect(
                    loaded.metadata.resolutionVerified
                ).toBe(true);
            }
        );

        it(
            'preserva candidateVerified ma non conta come successo un rollback failure',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'candidate-rollback-failure-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const modelConfig =
                    createModelConfig();

                /*
                 * La candidata supera tutti gli Oracle,
                 * ma il rollback successivo fallisce.
                 */
                const session =
                    createVerifiedSession(
                        'candidate-verified-rollback-failed',
                        'INFRASTRUCTURE_ERROR',
                        false
                    );

                const profile =
                    createExperimentProfile(
                        session.taskId,
                        modelConfig
                    );

                const runId =
                    await storage.saveRun(
                        session,
                        'MULTI_AGENT',
                        modelConfig,
                        'REPAIR',
                        profile,
                        {
                            'src/target.py':
                                'return False\n'
                        }
                    );

                const loaded =
                    await storage.getRun(
                        runId
                    );

                expect(loaded)
                    .not
                    .toBeNull();

                if (!loaded) {
                    throw new Error(
                        'Il run con rollback failure deve essere disponibile.'
                    );
                }

                /*
                 * Acceptance criterion centrale BE-P0-16:
                 * la candidata resta verificata.
                 */
                expect(
                    loaded.session.candidateVerified
                ).toBe(true);

                expect(
                    loaded.metadata.candidateVerified
                ).toBe(true);

                /*
                 * Il run complessivo non è però
                 * considerato riuscito.
                 */
                expect(
                    loaded.session.autonomousStatus
                ).toBe(
                    'INFRASTRUCTURE_ERROR'
                );

                expect(
                    loaded.session.autonomousRunSucceeded
                ).toBe(false);

                expect(
                    loaded.metadata.autonomousRunSucceeded
                ).toBe(false);

                expect(
                    loaded.metadata.resolutionVerified
                ).toBe(false);

                expect(
                    loaded.session.failure?.category
                ).toBe(
                    'ROLLBACK_FAILURE'
                );

                expect(
                    loaded.session.rollbackResult?.status
                ).toBe(
                    'FAILED'
                );
            }
        );

        it(
            'esclude il rollback failure dalle analytics di successo',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'candidate-analytics-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const modelConfig =
                    createModelConfig();

                const successfulSession =
                    createVerifiedSession(
                        'analytics-success',
                        'CONVERGED',
                        true
                    );

                const failedSession =
                    createVerifiedSession(
                        'analytics-rollback-failure',
                        'INFRASTRUCTURE_ERROR',
                        false
                    );

                await storage.saveRun(
                    successfulSession,
                    'MULTI_AGENT',
                    modelConfig,
                    'REPAIR',
                    createExperimentProfile(
                        successfulSession.taskId,
                        modelConfig
                    ),
                    {
                        'src/target.py':
                            'return False\n'
                    }
                );

                await storage.saveRun(
                    failedSession,
                    'MULTI_AGENT',
                    modelConfig,
                    'REPAIR',
                    createExperimentProfile(
                        failedSession.taskId,
                        modelConfig
                    ),
                    {
                        'src/target.py':
                            'return False\n'
                    }
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

                const rollbackSummary =
                    history.find(
                        (run) =>
                            run.metadata.taskId ===
                            failedSession.taskId
                    );

                expect(rollbackSummary)
                    .toBeDefined();

                expect(
                    rollbackSummary
                        ?.metrics
                        .candidateVerified
                ).toBe(true);

                expect(
                    rollbackSummary
                        ?.metrics
                        .autonomousRunSucceeded
                ).toBe(false);

                expect(
                    rollbackSummary
                        ?.metrics
                        .resolutionVerified
                ).toBe(false);

                const aggregated =
                    await storage.getAggregatedMetrics({
                        category:
                            'REPAIR',

                        modelName:
                            modelConfig.modelName
                    });

                /*
                 * Entrambe le candidate risultano
                 * tecnicamente verificate.
                 */
                expect(
                    history.filter(
                        (run) =>
                            run.metrics.candidateVerified
                    )
                ).toHaveLength(2);

                /*
                 * Ma soltanto il run CONVERGED
                 * è un successo autonomo.
                 */
                expect(
                    aggregated.modes
                        .MULTI_AGENT
                        .runCount
                ).toBe(2);

                expect(
                    aggregated.modes
                        .MULTI_AGENT
                        .resolvedCount
                ).toBe(1);

                expect(
                    aggregated.modes
                        .MULTI_AGENT
                        .successRatePct
                ).toBe(50);

                /*
                 * averageTokenToFix deve essere calcolato
                 * solo sui run autonomi riusciti.
                 */
                expect(
                    aggregated.averageTokenToFix
                ).toBe(120);
            }
        );

        it(
            'rifiuta autonomousRunSucceeded true con outcome INFRASTRUCTURE_ERROR',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'candidate-invalid-success-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const modelConfig =
                    createModelConfig();

                /*
                 * Stato intenzionalmente impossibile:
                 *
                 * candidateVerified = true
                 * autonomousStatus = INFRASTRUCTURE_ERROR
                 * autonomousRunSucceeded = true
                 */
                const invalidSession =
                    createVerifiedSession(
                        'invalid-infrastructure-success',
                        'INFRASTRUCTURE_ERROR',
                        true
                    );

                await expect(
                    storage.saveRun(
                        invalidSession,
                        'MULTI_AGENT',
                        modelConfig,
                        'REPAIR',
                        createExperimentProfile(
                            invalidSession.taskId,
                            modelConfig
                        ),
                        {
                            'src/target.py':
                                'return False\n'
                        }
                    )
                ).rejects.toBeInstanceOf(
                    ArtifactPersistenceInvariantError
                );

                /*
                 * Il gate deve fallire prima
                 * della scrittura dell'artifact.
                 */
                const entries =
                    await fs.readdir(
                        storageDirectory
                    );

                expect(entries)
                    .toEqual([]);
            }
        );
    }
);
