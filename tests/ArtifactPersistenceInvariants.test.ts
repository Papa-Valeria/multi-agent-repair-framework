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
    WorkbenchSessionState
} from '../src/types/domain.js';

import {
    DEFAULT_ORACLE_PROFILE
} from '../src/verification/OracleDecision.js';

const createExperimentProfile = (
    taskId: string,
    modelConfig: ExperimentModelConfig,
    maxIterations: number,
    maxTechnicalAttempts: number
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
        maxTechnicalAttempts
    },

    fixture: {
        /*
         * Digest SHA-256 formalmente valido.
         *
         * Questa suite verifica il Persistence Gate,
         * non l'algoritmo di costruzione della Fixture
         * Identity eseguito da app.ts.
         */
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

describe(
    'Artifact Persistence Gate',
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
            'non scrive un artifact con conteggio iterazioni incoerente',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'artifact-gate-'
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
                 * Outcome e metriche BE-P0-16 sono
                 * semanticamente coerenti:
                 *
                 * status = FAILED
                 * autonomousStatus = FAILED
                 * finalizationStatus = NOT_FINALIZED
                 * candidateVerified = false
                 * autonomousRunSucceeded = false
                 *
                 * L'unica anomalia intenzionale resta:
                 *
                 * currentIteration = 1
                 * iterations.length = 0
                 */
                const invalidSession =
                    {
                        taskId:
                            'invalid-artifact',

                        issueSpec:
                            'Artifact intenzionalmente invalido per testare il Persistence Gate.',

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
                        },

                        isHumanAugmented:
                            false,

                        failure: {
                            phase:
                                'PERSISTENCE',

                            category:
                                'PERSISTENCE_FAILURE',

                            message:
                                'Sessione intenzionalmente incoerente.',

                            recoverable:
                                false
                        },

                        terminationReason:
                            'Sessione intenzionalmente invalida.'
                    } satisfies WorkbenchSessionState;

                const modelConfig =
                    createModelConfig();

                const experimentProfile =
                    createExperimentProfile(
                        invalidSession.taskId,
                        modelConfig,
                        invalidSession.maxIterations,
                        2
                    );

                const persistence =
                    storage.saveRun(
                        invalidSession,
                        'MULTI_AGENT',
                        modelConfig,
                        'REPAIR',
                        experimentProfile,
                        {
                            'src/target.py':
                                'return False\n'
                        }
                    );

                await expect(
                    persistence
                ).rejects.toBeInstanceOf(
                    ArtifactPersistenceInvariantError
                );

                /*
                 * Il gate deve fallire prima di writeRun().
                 *
                 * La directory è stata creata dal test,
                 * ma deve rimanere completamente vuota:
                 * nessun JSON e nessun file temporaneo.
                 */
                const entries =
                    await fs.readdir(
                        storageDirectory
                    );

                expect(entries)
                    .toEqual([]);
            }
        );

        it(
            'non scrive token non disponibili rappresentati come valori numerici',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'artifact-token-gate-'
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
                 * Outcome, finalizzazione e metriche
                 * BE-P0-16 sono coerenti:
                 *
                 * candidateVerified = false
                 * autonomousRunSucceeded = false
                 *
                 * L'unica anomalia intenzionale resta
                 * la rappresentazione dei token.
                 */
                const invalidSession =
                    {
                        taskId:
                            'invalid-token-artifact',

                        issueSpec:
                            'Verificare la coerenza della disponibilità token.',

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
                            0,

                        maxIterations:
                            3,

                        iterations:
                            [],

                        cumulativeTelemetry: {
                            /*
                             * Stato contraddittorio:
                             *
                             * tokenUsageAvailable = false
                             * ma i conteggi sono numerici.
                             */
                            promptTokens:
                                100,

                            completionTokens:
                                20,

                            tokenUsageAvailable:
                                false,

                            inferenceDurationMs:
                                150,

                            oracleDurationMs:
                                0,

                            orchestrationOverheadMs:
                                1,

                            totalDurationMs:
                                151,

                            agentUsage: {
                                CODER: {
                                    promptTokens:
                                        100,

                                    completionTokens:
                                        20,

                                    tokenUsageAvailable:
                                        true,

                                    inferenceDurationMs:
                                        150
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

                        failure: {
                            phase:
                                'PERSISTENCE',

                            category:
                                'PERSISTENCE_FAILURE',

                            message:
                                'Telemetria token intenzionalmente incoerente.',

                            recoverable:
                                false
                        },

                        terminationReason:
                            'Artifact non persistibile.'
                    } satisfies WorkbenchSessionState;

                const modelConfig =
                    createModelConfig();

                const experimentProfile =
                    createExperimentProfile(
                        invalidSession.taskId,
                        modelConfig,
                        invalidSession.maxIterations,
                        2
                    );

                await expect(
                    storage.saveRun(
                        invalidSession,
                        'BASELINE',
                        modelConfig,
                        'REPAIR',
                        experimentProfile,
                        {
                            'src/target.py':
                                'return False\n'
                        }
                    )
                ).rejects.toBeInstanceOf(
                    ArtifactPersistenceInvariantError
                );

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
