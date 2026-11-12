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
    DEFAULT_PROMPT_PROFILE
} from '../src/inference/PromptProfile.js';

import {
    ArtifactPersistenceInvariantError,
    assertStoredRunV3PersistenceInvariants
} from '../src/telemetry/ArtifactPersistenceInvariants.js';

import {
    TelemetryStorage
} from '../src/telemetry/TelemetryStorage.js';

import type {
    ExperimentModelConfig,
    ExperimentProfileV3,
    StoredRunV3
} from '../src/types/analytics.js';

import type {
    ComputationalTelemetry,
    WorkbenchSessionState
} from '../src/types/domain.js';

import {
    DEFAULT_ORACLE_PROFILE
} from '../src/verification/OracleDecision.js';

import {
    DEFAULT_SEMGREP_PROFILE
} from '../src/verification/SemgrepProfile.js';

const TARGET_FILE =
    'src/target.py';

const TEST_FILE =
    'tests/test_target.py';

const ISSUE_SPEC =
    'Verificare la disponibilità della Oracle duration.';

const TARGET_SOURCE =
    [
        'def target():',
        '    return False',
        ''
    ].join('\n');

const FIXTURE_ID =
    'a'.repeat(64);

const temporaryDirectories:
    string[] = [];

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

const createTelemetry = (
    oracleDurationMs:
        number | null,

    oracleDurationAvailable:
        boolean
): ComputationalTelemetry => ({
    promptTokens:
        0,

    completionTokens:
        0,

    tokenUsageAvailable:
        true,

    inferenceDurationMs:
        0,

    oracleDurationMs,

    oracleDurationAvailable,

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
});

const createSession = (
    taskId:
        string,

    oracleDurationMs:
        number | null,

    oracleDurationAvailable:
        boolean
): WorkbenchSessionState => ({
    taskId,

    issueSpec:
        ISSUE_SPEC,

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
        TARGET_FILE
    ],

    testFiles: [
        TEST_FILE
    ],

    currentIteration:
        0,

    maxIterations:
        3,

    iterations:
        [],

    cumulativeTelemetry:
        createTelemetry(
            oracleDurationMs,
            oracleDurationAvailable
        ),

    isHumanAugmented:
        false,

    failure: {
        phase:
            'PERSISTENCE',

        category:
            'PERSISTENCE_FAILURE',

        message:
            'Failure controllato per il test TelemetryStorage.',

        recoverable:
            false
    },

    terminationReason:
        'Sessione terminata senza iterazioni.'
});

const createExperimentProfile = (
    taskId:
        string,

    modelConfig:
        ExperimentModelConfig
): ExperimentProfileV3 => ({
    oracleProfileId:
        DEFAULT_ORACLE_PROFILE.id,

    promptProfileId:
        DEFAULT_PROMPT_PROFILE.id,

    semgrepProfileId:
        DEFAULT_SEMGREP_PROFILE.id,

    buildOracleConfig: {
        command:
            'python',

        args: [
            '-B',
            '-m',
            'py_compile',
            TARGET_FILE
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
            TEST_FILE
        ],

        cwd:
            '.',

        timeoutMs:
            30_000,

        oracleFiles: [
            TEST_FILE
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
            3,

        maxTechnicalAttempts:
            2
    },

    fixture: {
        id:
            FIXTURE_ID,

        taskId,

        category:
            'REPAIR',

        issueSpec:
            ISSUE_SPEC,

        targetFiles: [
            TARGET_FILE
        ],

        testFiles: [
            TEST_FILE
        ]
    }
});

const createStorage = async ():
    Promise<{
        readonly directory:
        string;

        readonly storage:
        TelemetryStorage;
    }> => {
    const directory =
        await fs.mkdtemp(
            path.join(
                os.tmpdir(),
                'be-p1-34-'
            )
        );

    temporaryDirectories.push(
        directory
    );

    return {
        directory,

        storage:
            new TelemetryStorage(
                directory
            )
    };
};

const persistRun = async (
    storage:
        TelemetryStorage,

    taskId:
        string,

    oracleDurationMs:
        number | null,

    oracleDurationAvailable:
        boolean
): Promise<string> => {
    const modelConfig =
        createModelConfig();

    const session =
        createSession(
            taskId,
            oracleDurationMs,
            oracleDurationAvailable
        );

    const experimentProfile =
        createExperimentProfile(
            taskId,
            modelConfig
        );

    return storage.saveRun(
        session,
        'MULTI_AGENT',
        modelConfig,
        'REPAIR',
        experimentProfile,
        {
            [TARGET_FILE]:
                TARGET_SOURCE
        }
    );
};

const readOnlyPersistedRun = async (
    directory:
        string
): Promise<StoredRunV3> => {
    const filenames =
        (
            await fs.readdir(
                directory
            )
        ).filter(
            (
                filename
            ) =>
                filename.endsWith(
                    '.json'
                )
        );

    expect(
        filenames
    ).toHaveLength(
        1
    );

    const filename =
        filenames[0];

    if (
        filename === undefined
    ) {
        throw new Error(
            'Artifact JSON non trovato.'
        );
    }

    const content =
        await fs.readFile(
            path.join(
                directory,
                filename
            ),
            'utf8'
        );

    return JSON.parse(
        content
    ) as StoredRunV3;
};

describe(
    'BE-P1-34 - TelemetryStorage Oracle duration availability',
    () => {
        afterEach(
            async () => {
                await Promise.all(
                    temporaryDirectories.map(
                        async (
                            directory
                        ) => {
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

                0;
            }
        );

        it(
            'persiste una Oracle duration assente come null e non disponibile',
            async () => {
                const {
                    directory,
                    storage
                } =
                    await createStorage();

                await persistRun(
                    storage,
                    'oracle-unavailable',
                    null,
                    false
                );

                const persisted =
                    await readOnlyPersistedRun(
                        directory
                    );

                expect(
                    persisted
                        .session
                        .cumulativeTelemetry
                        .oracleDurationMs
                ).toBeNull();

                expect(
                    persisted
                        .session
                        .cumulativeTelemetry
                        .oracleDurationAvailable
                ).toBe(
                    false
                );

                expect(
                    persisted
                        .metadata
                        .oracleDurationMs
                ).toBeNull();
            }
        );

        it(
            'rende non comparabile una Oracle duration assente',
            async () => {
                const {
                    storage
                } =
                    await createStorage();

                await persistRun(
                    storage,
                    'oracle-not-comparable',
                    null,
                    false
                );

                const summaries =
                    await storage.listRuns();

                expect(
                    summaries
                ).toHaveLength(
                    1
                );

                const summary =
                    summaries[0];

                if (
                    summary === undefined
                ) {
                    throw new Error(
                        'RunSummary non trovato.'
                    );
                }

                expect(
                    summary
                        .metrics
                        .oracleDurationMs
                ).toBeNull();

                expect(
                    summary
                        .metrics
                        .oracleDurationComparable
                ).toBe(
                    false
                );
            }
        );

        it(
            'preserva zero come durata realmente osservata e comparabile',
            async () => {
                const {
                    storage
                } =
                    await createStorage();

                await persistRun(
                    storage,
                    'oracle-zero',
                    0,
                    true
                );

                const summaries =
                    await storage.listRuns();

                expect(
                    summaries
                ).toHaveLength(
                    1
                );

                const summary =
                    summaries[0];

                if (
                    summary === undefined
                ) {
                    throw new Error(
                        'RunSummary non trovato.'
                    );
                }

                expect(
                    summary
                        .metrics
                        .oracleDurationMs
                ).toBe(
                    0
                );

                expect(
                    summary
                        .metrics
                        .oracleDurationComparable
                ).toBe(
                    true
                );
            }
        );

        it(
            'preserva una durata positiva come misura comparabile',
            async () => {
                const {
                    storage
                } =
                    await createStorage();

                await persistRun(
                    storage,
                    'oracle-positive',
                    25,
                    true
                );

                const summaries =
                    await storage.listRuns();

                expect(
                    summaries
                ).toHaveLength(
                    1
                );

                const summary =
                    summaries[0];

                if (
                    summary === undefined
                ) {
                    throw new Error(
                        'RunSummary non trovato.'
                    );
                }

                expect(
                    summary
                        .metrics
                        .oracleDurationMs
                ).toBe(
                    25
                );

                expect(
                    summary
                        .metrics
                        .oracleDurationComparable
                ).toBe(
                    true
                );
            }
        );

        it(
            'esclude la durata assente dalla media aggregata',
            async () => {
                const {
                    storage
                } =
                    await createStorage();

                await persistRun(
                    storage,
                    'oracle-missing',
                    null,
                    false
                );

                await persistRun(
                    storage,
                    'oracle-twenty',
                    20,
                    true
                );

                await persistRun(
                    storage,
                    'oracle-forty',
                    40,
                    true
                );

                const report =
                    await storage
                        .getAggregatedMetrics();

                expect(
                    report.totalRuns
                ).toBe(
                    3
                );

                expect(
                    report
                        .oracleDurationComparableRunCount
                ).toBe(
                    2
                );

                expect(
                    report
                        .averageOracleDurationMs
                ).toBe(
                    30
                );
            }
        );

        it(
            'include zero osservato nella media delle durate comparabili',
            async () => {
                const {
                    storage
                } =
                    await createStorage();

                await persistRun(
                    storage,
                    'oracle-zero-average',
                    0,
                    true
                );

                await persistRun(
                    storage,
                    'oracle-ten-average',
                    10,
                    true
                );

                const report =
                    await storage
                        .getAggregatedMetrics();

                expect(
                    report
                        .oracleDurationComparableRunCount
                ).toBe(
                    2
                );

                expect(
                    report
                        .averageOracleDurationMs
                ).toBe(
                    5
                );
            }
        );

        it(
            'rifiuta zero usato come sentinella quando la durata è non disponibile',
            async () => {
                const {
                    storage
                } =
                    await createStorage();

                await expect(
                    persistRun(
                        storage,
                        'oracle-invalid-zero',
                        0,
                        false
                    )
                ).rejects.toBeInstanceOf(
                    ArtifactPersistenceInvariantError
                );
            }
        );

        it(
            'rifiuta null quando la durata è dichiarata disponibile',
            async () => {
                const {
                    storage
                } =
                    await createStorage();

                await expect(
                    persistRun(
                        storage,
                        'oracle-invalid-null',
                        null,
                        true
                    )
                ).rejects.toBeInstanceOf(
                    ArtifactPersistenceInvariantError
                );
            }
        );

        it(
            'Persistence Gate rifiuta la coppia zero e non disponibile',
            async () => {
                const {
                    directory,
                    storage
                } =
                    await createStorage();

                await persistRun(
                    storage,
                    'oracle-zero-mutation',
                    10,
                    true
                );

                const persisted =
                    await readOnlyPersistedRun(
                        directory
                    );

                const invalidTelemetry:
                    ComputationalTelemetry = {
                    ...persisted
                        .session
                        .cumulativeTelemetry,

                    oracleDurationMs:
                        0,

                    oracleDurationAvailable:
                        false
                };

                const invalidRun:
                    StoredRunV3 = {
                    ...persisted,

                    metadata: {
                        ...persisted.metadata,

                        oracleDurationMs:
                            0
                    },

                    session: {
                        ...persisted.session,

                        cumulativeTelemetry:
                            invalidTelemetry
                    }
                };

                expect(
                    () =>
                        assertStoredRunV3PersistenceInvariants(
                            invalidRun
                        )
                ).toThrow(
                    ArtifactPersistenceInvariantError
                );
            }
        );

        it(
            'Persistence Gate rifiuta la coppia null e disponibile',
            async () => {
                const {
                    directory,
                    storage
                } =
                    await createStorage();

                await persistRun(
                    storage,
                    'oracle-null-mutation',
                    10,
                    true
                );

                const persisted =
                    await readOnlyPersistedRun(
                        directory
                    );

                const invalidTelemetry:
                    ComputationalTelemetry = {
                    ...persisted
                        .session
                        .cumulativeTelemetry,

                    oracleDurationMs:
                        null,

                    oracleDurationAvailable:
                        true
                };

                const invalidRun:
                    StoredRunV3 = {
                    ...persisted,

                    metadata: {
                        ...persisted.metadata,

                        oracleDurationMs:
                            null
                    },

                    session: {
                        ...persisted.session,

                        cumulativeTelemetry:
                            invalidTelemetry
                    }
                };

                expect(
                    () =>
                        assertStoredRunV3PersistenceInvariants(
                            invalidRun
                        )
                ).toThrow(
                    ArtifactPersistenceInvariantError
                );
            }
        );
    }
);
