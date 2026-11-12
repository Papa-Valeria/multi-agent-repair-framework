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
    FunctionalTestOracleConfig,
    WorkbenchSessionState
} from '../src/types/domain.js';

import {
    DEFAULT_ORACLE_PROFILE
} from '../src/verification/OracleDecision.js';

describe(
    'TelemetryStorage artifact schema v2',
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
            'mantiene candidate verification, run success, outcome, finalizzazione, evidence e profilo sperimentale identici durante la lettura di un artifact v2',
            async () => {
                const storageDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'telemetry-v2-read-'
                        )
                    );

                temporaryDirectories.push(
                    storageDirectory
                );

                const storage =
                    new TelemetryStorage(
                        storageDirectory
                    );

                const runId =
                    '123e4567-e89b-12d3-a456-426614174000';

                const timestamp =
                    '2026-10-26T12:00:00.000Z';

                const functionalConfig:
                    FunctionalTestOracleConfig = {
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
                };

                /*
                 * L'outcome è volutamente anomalo:
                 *
                 * - autonomousStatus = CONVERGED
                 * - candidateVerified = true
                 * - autonomousRunSucceeded = true
                 * - verification.verified = true
                 * - testReport.oracleStatus = NOT_AVAILABLE
                 *
                 * Questo artifact viene scritto manualmente
                 * e non passa dal Persistence Gate.
                 *
                 * Lo scopo è verificare esclusivamente che
                 * la lettura di un artifact v2 non reinterpreti
                 * né modifichi ciò che è già stato persistito.
                 */
                const session:
                    WorkbenchSessionState = {
                    taskId:
                        'artifact-v2-immutable-read',

                    runId,

                    issueSpec:
                        'Verificare che un artifact v2 non venga reinterpretato durante la lettura.',

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
                        3,

                    iterations: [
                        {
                            iteration:
                                1,

                            patchDiff: [
                                '--- a/src/target.py',
                                '+++ b/src/target.py',
                                '@@ -1 +1 @@',
                                '-return False',
                                '+return True'
                            ].join('\n'),

                            patchHash:
                                'immutable-v2-patch-hash',

                            isApplicable:
                                true,

                            verification: {
                                verified:
                                    true,

                                oracleResults: [
                                    {
                                        oracle:
                                            'FUNCTIONAL_TEST',

                                        status:
                                            'NOT_AVAILABLE',

                                        required:
                                            true,

                                        durationMs:
                                            17,

                                        summary:
                                            'Evidence v2 originale da preservare.',

                                        evidence: {
                                            report: {
                                                oracleStatus:
                                                    'NOT_AVAILABLE',

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
                                                    functionalConfig
                                                        .expectedExitPolicy,

                                                exitCode:
                                                    null,

                                                suitePassed:
                                                    false,

                                                timedOut:
                                                    false,

                                                oracleFailed:
                                                    false,

                                                oracleFailureReason:
                                                    'Evidence originale da preservare.',

                                                totalTests:
                                                    7,

                                                passedTests:
                                                    5,

                                                failedTests:
                                                    1,

                                                skippedTests:
                                                    1,

                                                xfailedTests:
                                                    0,

                                                xpassedTests:
                                                    0,

                                                errorTests:
                                                    0,

                                                passRate:
                                                    5 / 7,

                                                durationMs:
                                                    17,

                                                failureDetails: [
                                                    {
                                                        testName:
                                                            'test_evidence_originale',

                                                        failureLocation: {
                                                            file:
                                                                'tests/test_target.py',

                                                            line:
                                                                42
                                                        },

                                                        assertionMessage:
                                                            'Evidence immutabile.',

                                                        stackTrace:
                                                            'Original evidence stack trace.',

                                                        expected:
                                                            'True',

                                                        actual:
                                                            'False'
                                                    }
                                                ],

                                                stdout:
                                                    'stdout originale evidence',

                                                stderr:
                                                    'stderr originale evidence',

                                                rawStdout:
                                                    'raw stdout originale evidence',

                                                rawStderr:
                                                    'raw stderr originale evidence',

                                                executionDurationMs:
                                                    17
                                            }
                                        }
                                    }
                                ],

                                sastFindings: [
                                    {
                                        ruleId:
                                            'python.lang.correctness.test-rule',

                                        path:
                                            'src/target.py',

                                        startLine:
                                            1,

                                        endLine:
                                            1,

                                        severity:
                                            'WARNING',

                                        message:
                                            'Finding originale da preservare.',

                                        cweHierarchy: [
                                            'CWE-670'
                                        ],

                                        owaspCategory:
                                            'A04:2021'
                                    }
                                ],

                                semgrepDurationMs:
                                    11,

                                testReport: {
                                    oracleStatus:
                                        'NOT_AVAILABLE',

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
                                        functionalConfig
                                            .expectedExitPolicy,

                                    exitCode:
                                        null,

                                    suitePassed:
                                        false,

                                    timedOut:
                                        false,

                                    oracleFailed:
                                        false,

                                    oracleFailureReason:
                                        'Report originale da preservare.',

                                    totalTests:
                                        7,

                                    passedTests:
                                        5,

                                    failedTests:
                                        1,

                                    skippedTests:
                                        1,

                                    xfailedTests:
                                        0,

                                    xpassedTests:
                                        0,

                                    errorTests:
                                        0,

                                    passRate:
                                        5 / 7,

                                    durationMs:
                                        17,

                                    failureDetails: [
                                        {
                                            testName:
                                                'test_report_originale',

                                            failureLocation: {
                                                file:
                                                    'tests/test_target.py',

                                                line:
                                                    42
                                            },

                                            assertionMessage:
                                                'Report immutabile.',

                                            stackTrace:
                                                'Original report stack trace.',

                                            expected:
                                                'True',

                                            actual:
                                                'False'
                                        }
                                    ],

                                    stdout:
                                        'stdout originale report',

                                    stderr:
                                        'stderr originale report',

                                    rawStdout:
                                        'raw stdout originale report',

                                    rawStderr:
                                        'raw stderr originale report',

                                    executionDurationMs:
                                        17
                                }
                            },

                            telemetry: {
                                promptTokens:
                                    null,

                                completionTokens:
                                    null,

                                tokenUsageAvailable:
                                    false,

                                inferenceDurationMs:
                                    250,

                                oracleDurationMs:
                                    28,

                                orchestrationOverheadMs:
                                    3,

                                totalDurationMs:
                                    500,

                                agentUsage: {
                                    CODER: {
                                        promptTokens:
                                            null,

                                        completionTokens:
                                            null,

                                        tokenUsageAvailable:
                                            false,

                                        inferenceDurationMs:
                                            250
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
                                        null,

                                    completionTokens:
                                        null,

                                    tokenUsageAvailable:
                                        false,

                                    inferenceDurationMs:
                                        250
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

                    finalPatch: [
                        '--- a/src/target.py',
                        '+++ b/src/target.py',
                        '@@ -1 +1 @@',
                        '-return False',
                        '+return True'
                    ].join('\n'),

                    cumulativeTelemetry: {
                        promptTokens:
                            null,

                        completionTokens:
                            null,

                        tokenUsageAvailable:
                            false,

                        inferenceDurationMs:
                            250,

                        oracleDurationMs:
                            28,

                        orchestrationOverheadMs:
                            3,

                        totalDurationMs:
                            500,

                        agentUsage: {
                            CODER: {
                                promptTokens:
                                    null,

                                completionTokens:
                                    null,

                                tokenUsageAvailable:
                                    false,

                                inferenceDurationMs:
                                    250
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

                    terminationReason:
                        'Outcome v2 originale.',

                    initialHead:
                        '0123456789abcdef'
                };

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

                /*
                 * Profilo sperimentale completo introdotto
                 * con BE-P0-14.
                 *
                 * La Fixture Identity è formalmente valida.
                 * Il test verifica l'immutabilità in lettura,
                 * non il calcolo SHA-256 effettuato da app.ts.
                 */
                const experimentProfile:
                    ExperimentProfile = {
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
                        functionalConfig,

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
                            session.maxIterations,

                        maxTechnicalAttempts:
                            2
                    },

                    fixture: {
                        id:
                            'a'.repeat(64),

                        taskId:
                            session.taskId,

                        category:
                            session.category,

                        targetFiles:
                            session.targetFiles,

                        testFiles:
                            session.testFiles
                    }
                };

                /*
                 * BE-P0-16:
                 *
                 * candidateVerified descrive la candidata.
                 * autonomousRunSucceeded descrive il run.
                 *
                 * In questo artifact entrambi sono true.
                 */
                const metadata:
                    ExperimentMetadata = {
                    runId,

                    taskId:
                        session.taskId,

                    category:
                        session.category,

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
                        null,

                    tokenUsageAvailable:
                        false,

                    totalDurationMs:
                        500,

                    inferenceDurationMs:
                        250,

                    oracleDurationMs:
                        28,

                    orchestrationOverheadMs:
                        3,

                    orchestrationOverheadBasis:
                        'NODE_PROCESS_CPU',

                    isHumanAugmented:
                        false,

                    /*
                     * Campo legacy compatibile.
                     * Da BE-P0-16 coincide con il successo
                     * complessivo del run autonomo.
                     */
                    resolutionVerified:
                        true
                };

                const artifact:
                    StoredRunV2 = {
                    schemaVersion:
                        2,

                    metadata,

                    modelConfig,

                    experimentProfile,

                    session,

                    targetSources: {
                        'src/target.py':
                            'return False\n'
                    }
                };

                const filename =
                    'artifact-v2-immutable-read.json';

                const artifactPath =
                    path.join(
                        storageDirectory,
                        filename
                    );

                await fs.writeFile(
                    artifactPath,
                    `${JSON.stringify(
                        artifact,
                        null,
                        2
                    )
                    }\n`,
                    'utf8'
                );

                const persistedBeforeRead =
                    await fs.readFile(
                        artifactPath,
                        'utf8'
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
                        'L’artifact v2 deve essere ricaricabile.'
                    );
                }

                /*
                 * L'intero artifact deve essere identico
                 * all'oggetto scritto manualmente.
                 */
                expect(loaded)
                    .toEqual(artifact);

                expect(
                    loaded.schemaVersion
                ).toBe(2);

                /*
                 * Narrowing esplicito perché getRun()
                 * può restituire StoredRunV1 o StoredRunV2.
                 */
                if (
                    loaded.schemaVersion !== 2
                ) {
                    throw new Error(
                        'L’artifact caricato deve mantenere schemaVersion 2.'
                    );
                }

                /*
                 * BE-P0-15:
                 * outcome autonomo e finalizzazione
                 * restano separati.
                 */
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
                    'NOT_FINALIZED'
                );

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
                    'NOT_FINALIZED'
                );

                /*
                 * BE-P0-16:
                 * candidate verification e run success
                 * devono rimanere distinti e immutati
                 * durante getRun().
                 */
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
                    loaded.metadata.isHumanAugmented
                ).toBe(false);

                expect(
                    loaded.metadata.resolutionVerified
                ).toBe(true);

                /*
                 * Il valore originario della candidate
                 * verification resta immutato.
                 */
                expect(
                    loaded.session
                        .iterations[0]
                        ?.verification
                        .verified
                ).toBe(true);

                expect(
                    loaded.session
                        .iterations[0]
                        ?.verification
                        .oracleResults
                ).toEqual(
                    artifact.session
                        .iterations[0]
                        ?.verification
                        .oracleResults
                );

                expect(
                    loaded.session
                        .iterations[0]
                        ?.verification
                        .oracleResults[0]
                        ?.evidence
                ).toEqual(
                    artifact.session
                        .iterations[0]
                        ?.verification
                        .oracleResults[0]
                        ?.evidence
                );

                expect(
                    loaded.session
                        .iterations[0]
                        ?.verification
                        .testReport
                ).toEqual(
                    artifact.session
                        .iterations[0]
                        ?.verification
                        .testReport
                );

                /*
                 * BE-P0-14:
                 * il profilo sperimentale deve rimanere
                 * completamente immutato.
                 */
                expect(
                    loaded.experimentProfile
                ).toEqual(
                    artifact.experimentProfile
                );

                expect(
                    loaded.experimentProfile
                        .oracleProfileId
                ).toBe(
                    DEFAULT_ORACLE_PROFILE.id
                );

                expect(
                    loaded.experimentProfile
                        .promptProfileId
                ).toBe(
                    ContextBuilder.PROMPT_PROFILE_ID
                );

                expect(
                    loaded.experimentProfile
                        .modelConfig
                ).toEqual(
                    modelConfig
                );

                expect(
                    loaded.experimentProfile
                        .buildOracleConfig
                ).toEqual(
                    experimentProfile
                        .buildOracleConfig
                );

                expect(
                    loaded.experimentProfile
                        .functionalTestOracleConfig
                ).toEqual(
                    functionalConfig
                );

                expect(
                    loaded.experimentProfile
                        .semgrepConfig
                ).toEqual(
                    experimentProfile
                        .semgrepConfig
                );

                expect(
                    loaded.experimentProfile
                        .limits
                ).toEqual({
                    maxIterations:
                        3,

                    maxTechnicalAttempts:
                        2
                });

                expect(
                    loaded.experimentProfile
                        .fixture
                ).toEqual(
                    experimentProfile.fixture
                );

                expect(
                    loaded.experimentProfile
                        .fixture.id
                ).toBe(
                    'a'.repeat(64)
                );

                expect(
                    loaded.metadata.totalTokens
                ).toBeNull();

                expect(
                    loaded.metadata
                        .tokenUsageAvailable
                ).toBe(false);

                /*
                 * Una lettura non deve riscrivere
                 * o modificare fisicamente il file v2.
                 */
                const persistedAfterRead =
                    await fs.readFile(
                        artifactPath,
                        'utf8'
                    );

                expect(
                    persistedAfterRead
                ).toBe(
                    persistedBeforeRead
                );

                const entries =
                    await fs.readdir(
                        storageDirectory
                    );

                expect(entries)
                    .toEqual([
                        filename
                    ]);
            }
        );
    }
);
