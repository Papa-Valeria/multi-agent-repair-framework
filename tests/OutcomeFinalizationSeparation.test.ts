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
    ExperimentModelConfig,
    ExperimentProfile
} from '../src/types/analytics.js';

import type {
    AutonomousWorkbenchSessionStatus,
    FinalizationStatus,
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

const createTestExecutionReport = (
    verified: boolean,
    functionalConfig:
        ExperimentProfile[
        'functionalTestOracleConfig'
        ]
): TestExecutionReport => ({
    oracleStatus:
        verified
            ? 'PASS'
            : 'FAIL',

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
                        'AssertionError: expected True'
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

const createPassingOracleResults = (
    functionalConfig:
        ExperimentProfile[
        'functionalTestOracleConfig'
        ],
    functionalReport:
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
                    'passing-patch-hash'
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
                report: {
                    ...functionalReport,

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

                    expectedExitPolicy:
                        functionalConfig.expectedExitPolicy
                }
            }
        }
    ];

const createSession = (
    taskId: string,
    autonomousStatus:
        AutonomousWorkbenchSessionStatus,
    verified: boolean,
    finalizationStatus:
        FinalizationStatus =
        'NOT_FINALIZED',
    isHumanAugmented = false
): WorkbenchSessionState => {
    const functionalConfig =
        createFunctionalTestConfig();

    const functionalReport =
        createTestExecutionReport(
            verified,
            functionalConfig
        );

    const oracleResults:
        readonly OracleResult[] =
        verified
            ? createPassingOracleResults(
                functionalConfig,
                functionalReport
            )
            : [];

    const patchDiff = [
        '--- a/src/target.py',
        '+++ b/src/target.py',
        '@@ -1 +1 @@',
        '-return False',
        '+return True'
    ].join('\n');

    /*
     * BE-P0-16:
     *
     * candidateVerified descrive esclusivamente
     * l'esito tecnico dell'ultima candidata.
     *
     * autonomousRunSucceeded descrive invece
     * il successo complessivo del run.
     */
    const candidateVerified =
        verified;

    const autonomousRunSucceeded =
        autonomousStatus === 'CONVERGED' &&
        candidateVerified;

    return {
        taskId,

        issueSpec:
            'Verificare la separazione tra outcome autonomo e finalizzazione umana.',

        category:
            'REPAIR',

        status:
            autonomousStatus,

        autonomousStatus,

        finalizationStatus,

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
                    verified,

                    oracleResults,

                    sastFindings:
                        [],

                    semgrepDurationMs:
                        verified
                            ? 3
                            : 0,

                    testReport:
                        functionalReport
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
        },

        isHumanAugmented,

        initialHead:
            '0123456789abcdef',

        terminationReason:
            'Outcome autonomo del test.'
    };
};

describe(
    'BE-P0-15 - Outcome autonomo e finalizzazione umana',
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
            'mantiene CONVERGED come outcome autonomo dopo APPROVED',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'outcome-finalization-converged-'
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
                    createSession(
                        'converged-approved',
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

                const finalized:
                    WorkbenchSessionState = {
                    ...session,

                    runId,

                    finalizationStatus:
                        'APPROVED',

                    isHumanAugmented:
                        false
                };

                await storage.updateRun(
                    runId,
                    finalized
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
                        'Il run finalizzato deve essere disponibile.'
                    );
                }

                expect(
                    loaded.session.status
                ).toBe(
                    'CONVERGED'
                );

                expect(
                    loaded.session.autonomousStatus
                ).toBe(
                    'CONVERGED'
                );

                expect(
                    loaded.session.finalizationStatus
                ).toBe(
                    'APPROVED'
                );

                /*
                 * BE-P0-16:
                 * la finalizzazione non deve modificare
                 * né la verifica della candidata né
                 * il successo autonomo del run.
                 */
                expect(
                    loaded.session.candidateVerified
                ).toBe(true);

                expect(
                    loaded.session.autonomousRunSucceeded
                ).toBe(true);

                expect(
                    loaded.metadata.status
                ).toBe(
                    'CONVERGED'
                );

                expect(
                    loaded.metadata.autonomousStatus
                ).toBe(
                    'CONVERGED'
                );

                expect(
                    loaded.metadata.finalizationStatus
                ).toBe(
                    'APPROVED'
                );

                expect(
                    loaded.metadata.candidateVerified
                ).toBe(true);

                expect(
                    loaded.metadata.autonomousRunSucceeded
                ).toBe(true);

                expect(
                    loaded.metadata.resolutionVerified
                ).toBe(true);

                expect(
                    loaded.metadata.isHumanAugmented
                ).toBe(false);
            }
        );

        it(
            'mantiene UNRESOLVED e run non riuscito dopo Human Override APPROVED',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'outcome-human-override-'
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
                    createSession(
                        'unresolved-human-approved',
                        'UNRESOLVED',
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

                const finalized:
                    WorkbenchSessionState = {
                    ...session,

                    runId,

                    finalizationStatus:
                        'APPROVED',

                    isHumanAugmented:
                        true
                };

                await storage.updateRun(
                    runId,
                    finalized
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
                        'Il run Human-Augmented deve essere disponibile.'
                    );
                }

                expect(
                    loaded.session.status
                ).toBe(
                    'UNRESOLVED'
                );

                expect(
                    loaded.session.autonomousStatus
                ).toBe(
                    'UNRESOLVED'
                );

                expect(
                    loaded.session.finalizationStatus
                ).toBe(
                    'APPROVED'
                );

                expect(
                    loaded.session.candidateVerified
                ).toBe(false);

                expect(
                    loaded.session.autonomousRunSucceeded
                ).toBe(false);

                expect(
                    loaded.metadata.status
                ).toBe(
                    'UNRESOLVED'
                );

                expect(
                    loaded.metadata.autonomousStatus
                ).toBe(
                    'UNRESOLVED'
                );

                expect(
                    loaded.metadata.finalizationStatus
                ).toBe(
                    'APPROVED'
                );

                expect(
                    loaded.metadata.candidateVerified
                ).toBe(false);

                expect(
                    loaded.metadata.autonomousRunSucceeded
                ).toBe(false);

                expect(
                    loaded.metadata.isHumanAugmented
                ).toBe(true);

                /*
                 * Alias legacy:
                 * continua a rappresentare il successo
                 * complessivo del run, non l'approval.
                 */
                expect(
                    loaded.metadata.resolutionVerified
                ).toBe(false);
            }
        );

        it(
            'mantiene FAILED come outcome autonomo dopo REJECTED',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'outcome-rejected-'
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
                    createSession(
                        'failed-rejected',
                        'FAILED',
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

                const finalized:
                    WorkbenchSessionState = {
                    ...session,

                    runId,

                    finalizationStatus:
                        'REJECTED',

                    isHumanAugmented:
                        false
                };

                await storage.updateRun(
                    runId,
                    finalized
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
                        'Il run rejected deve essere disponibile.'
                    );
                }

                expect(
                    loaded.session.status
                ).toBe(
                    'FAILED'
                );

                expect(
                    loaded.session.autonomousStatus
                ).toBe(
                    'FAILED'
                );

                expect(
                    loaded.session.finalizationStatus
                ).toBe(
                    'REJECTED'
                );

                expect(
                    loaded.session.candidateVerified
                ).toBe(false);

                expect(
                    loaded.session.autonomousRunSucceeded
                ).toBe(false);

                expect(
                    loaded.metadata.status
                ).toBe(
                    'FAILED'
                );

                expect(
                    loaded.metadata.autonomousStatus
                ).toBe(
                    'FAILED'
                );

                expect(
                    loaded.metadata.finalizationStatus
                ).toBe(
                    'REJECTED'
                );

                expect(
                    loaded.metadata.candidateVerified
                ).toBe(false);

                expect(
                    loaded.metadata.autonomousRunSucceeded
                ).toBe(false);

                expect(
                    loaded.metadata.resolutionVerified
                ).toBe(false);

                expect(
                    loaded.metadata.isHumanAugmented
                ).toBe(false);
            }
        );

        it(
            'non conta un Human Override APPROVED come successo autonomo nelle analytics',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'outcome-analytics-'
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
                    createSession(
                        'analytics-human-override',
                        'UNRESOLVED',
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

                await storage.updateRun(
                    runId,
                    {
                        ...session,

                        runId,

                        finalizationStatus:
                            'APPROVED',

                        isHumanAugmented:
                            true
                    }
                );

                const history =
                    await storage.listRuns({
                        category:
                            'REPAIR',

                        modelName:
                            modelConfig.modelName
                    });

                expect(history)
                    .toHaveLength(1);

                const summary =
                    history[0];

                if (!summary) {
                    throw new Error(
                        'Il summary analytics deve essere disponibile.'
                    );
                }

                expect(
                    summary.metadata.status
                ).toBe(
                    'UNRESOLVED'
                );

                expect(
                    summary.metadata.autonomousStatus
                ).toBe(
                    'UNRESOLVED'
                );

                expect(
                    summary.metadata.finalizationStatus
                ).toBe(
                    'APPROVED'
                );

                expect(
                    summary.metadata.candidateVerified
                ).toBe(false);

                expect(
                    summary.metadata.autonomousRunSucceeded
                ).toBe(false);

                expect(
                    summary.metadata.isHumanAugmented
                ).toBe(true);

                expect(
                    summary.metrics.candidateVerified
                ).toBe(false);

                expect(
                    summary.metrics.autonomousRunSucceeded
                ).toBe(false);

                expect(
                    summary.metrics.resolutionVerified
                ).toBe(false);

                const aggregated =
                    await storage.getAggregatedMetrics({
                        category:
                            'REPAIR',

                        modelName:
                            modelConfig.modelName
                    });

                expect(
                    aggregated.modes
                        .MULTI_AGENT
                        .runCount
                ).toBe(1);

                expect(
                    aggregated.modes
                        .MULTI_AGENT
                        .resolvedCount
                ).toBe(0);

                expect(
                    aggregated.modes
                        .MULTI_AGENT
                        .successRatePct
                ).toBe(0);

                expect(
                    aggregated.humanOverrideRatePct
                ).toBe(100);
            }
        );
    }
);
