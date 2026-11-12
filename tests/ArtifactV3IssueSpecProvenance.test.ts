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
    WorkbenchSessionState
} from '../src/types/domain.js';

import {
    DEFAULT_ORACLE_PROFILE
} from '../src/verification/OracleDecision.js';

import {
    DEFAULT_SEMGREP_PROFILE
} from '../src/verification/SemgrepProfile.js';

const TASK_ID =
    'be-p1-32-task';

const ISSUE_SPEC =
    'Correggere il valore restituito dalla funzione target.';

const TARGET_FILE =
    'src/target.py';

const TEST_FILE =
    'tests/test_target.py';

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

const createSession = ():
    WorkbenchSessionState => ({
        taskId:
            TASK_ID,

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
                'Failure controllato per il test di persistenza.',

            recoverable:
                false
        },

        terminationReason:
            'Sessione terminata senza iterazioni.'
    });

const createExperimentProfileV3 = (
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

        taskId:
            TASK_ID,

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
                'be-p1-32-'
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

const saveValidV3 = async (
    storage:
        TelemetryStorage
): Promise<string> => {
    const modelConfig =
        createModelConfig();

    return storage.saveRun(
        createSession(),
        'MULTI_AGENT',
        modelConfig,
        'REPAIR',
        createExperimentProfileV3(
            modelConfig
        ),
        {
            [TARGET_FILE]:
                TARGET_SOURCE
        }
    );
};

const readPersistedV3 = async (
    directory:
        string
): Promise<{
    readonly filename:
    string;

    readonly text:
    string;

    readonly run:
    StoredRunV3;
}> => {
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

    const text =
        await fs.readFile(
            path.join(
                directory,
                filename
            ),
            'utf8'
        );

    const parsed =
        JSON.parse(
            text
        ) as StoredRunV3;

    return {
        filename,
        text,
        run:
            parsed
    };
};

describe(
    'BE-P1-32 - issueSpec auditabile nella Fixture Provenance V3',
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

                temporaryDirectories.length =
                    0;
            }
        );

        it(
            'salva i nuovi artifact come V3 con issueSpec esplicitamente auditabile',
            async () => {
                const {
                    directory,
                    storage
                } =
                    await createStorage();

                await saveValidV3(
                    storage
                );

                const persisted =
                    await readPersistedV3(
                        directory
                    );

                expect(
                    persisted.run.schemaVersion
                ).toBe(
                    3
                );

                expect(
                    persisted
                        .run
                        .experimentProfile
                        .fixture
                        .issueSpec
                ).toBe(
                    ISSUE_SPEC
                );

                expect(
                    persisted
                        .run
                        .experimentProfile
                        .fixture
                        .issueSpec
                ).toBe(
                    persisted
                        .run
                        .session
                        .issueSpec
                );
            }
        );

        it(
            'mantiene issueSpec invariato nel round-trip V3',
            async () => {
                const {
                    directory,
                    storage
                } =
                    await createStorage();

                const runId =
                    await saveValidV3(
                        storage
                    );

                const before =
                    await readPersistedV3(
                        directory
                    );

                const loaded =
                    await storage.getRun(
                        runId
                    );

                expect(
                    loaded
                ).not.toBeNull();

                expect(
                    loaded?.schemaVersion
                ).toBe(
                    3
                );

                if (
                    loaded === null ||
                    loaded.schemaVersion !== 3
                ) {
                    throw new Error(
                        'Il round-trip non ha restituito un artifact V3.'
                    );
                }

                expect(
                    loaded
                        .experimentProfile
                        .fixture
                        .issueSpec
                ).toBe(
                    ISSUE_SPEC
                );

                expect(
                    loaded
                        .experimentProfile
                        .fixture
                        .issueSpec
                ).toBe(
                    loaded
                        .session
                        .issueSpec
                );

                const after =
                    await readPersistedV3(
                        directory
                    );

                expect(
                    after.text
                ).toBe(
                    before.text
                );
            }
        );

        it(
            'rifiuta un V3 quando fixture.issueSpec non coincide con session.issueSpec',
            async () => {
                const {
                    directory,
                    storage
                } =
                    await createStorage();

                await saveValidV3(
                    storage
                );

                const persisted =
                    await readPersistedV3(
                        directory
                    );

                const invalidRun:
                    StoredRunV3 = {
                    ...persisted.run,

                    experimentProfile: {
                        ...persisted
                            .run
                            .experimentProfile,

                        fixture: {
                            ...persisted
                                .run
                                .experimentProfile
                                .fixture,

                            issueSpec:
                                'Issue specification differente.'
                        }
                    }
                };

                let thrown:
                    unknown;

                try {
                    assertStoredRunV3PersistenceInvariants(
                        invalidRun
                    );
                } catch (
                error:
                    unknown
                ) {
                    thrown =
                        error;
                }

                expect(
                    thrown
                ).toBeInstanceOf(
                    ArtifactPersistenceInvariantError
                );

                expect(
                    (
                        thrown as
                        ArtifactPersistenceInvariantError
                    ).invariant
                ).toBe(
                    'FIXTURE_ISSUE_SPEC_MISMATCH'
                );
            }
        );

        it(
            'rifiuta un V3 con fixture.issueSpec vuoto',
            async () => {
                const {
                    directory,
                    storage
                } =
                    await createStorage();

                await saveValidV3(
                    storage
                );

                const persisted =
                    await readPersistedV3(
                        directory
                    );

                const invalidRun:
                    StoredRunV3 = {
                    ...persisted.run,

                    experimentProfile: {
                        ...persisted
                            .run
                            .experimentProfile,

                        fixture: {
                            ...persisted
                                .run
                                .experimentProfile
                                .fixture,

                            issueSpec:
                                '   '
                        }
                    }
                };

                let thrown:
                    unknown;

                try {
                    assertStoredRunV3PersistenceInvariants(
                        invalidRun
                    );
                } catch (
                error:
                    unknown
                ) {
                    thrown =
                        error;
                }

                expect(
                    thrown
                ).toBeInstanceOf(
                    ArtifactPersistenceInvariantError
                );

                expect(
                    (
                        thrown as
                        ArtifactPersistenceInvariantError
                    ).invariant
                ).toBe(
                    'NON_EMPTY_STRING'
                );
            }
        );

        it(
            'mantiene schemaVersion 3 e issueSpec dopo updateRun',
            async () => {
                const {
                    storage
                } =
                    await createStorage();

                const runId =
                    await saveValidV3(
                        storage
                    );

                const existing =
                    await storage.getRun(
                        runId
                    );

                expect(
                    existing
                ).not.toBeNull();

                if (
                    existing === null ||
                    existing.schemaVersion !== 3
                ) {
                    throw new Error(
                        'Artifact V3 appena salvato non trovato.'
                    );
                }

                await storage.updateRun(
                    runId,
                    {
                        ...existing.session,

                        terminationReason:
                            'Sessione aggiornata preservando la provenance.'
                    }
                );

                const updated =
                    await storage.getRun(
                        runId
                    );

                expect(
                    updated?.schemaVersion
                ).toBe(
                    3
                );

                if (
                    updated === null ||
                    updated.schemaVersion !== 3
                ) {
                    throw new Error(
                        'updateRun non ha preservato la schemaVersion V3.'
                    );
                }

                expect(
                    updated
                        .experimentProfile
                        .fixture
                        .issueSpec
                ).toBe(
                    ISSUE_SPEC
                );

                expect(
                    updated
                        .experimentProfile
                        .fixture
                        .issueSpec
                ).toBe(
                    updated
                        .session
                        .issueSpec
                );
            }
        );

        it(
            'legge un V2 senza sintetizzare fixture.issueSpec e senza riscriverlo',
            async () => {
                const {
                    directory,
                    storage
                } =
                    await createStorage();

                await saveValidV3(
                    storage
                );

                const persisted =
                    await readPersistedV3(
                        directory
                    );

                const rawV2 =
                    JSON.parse(
                        JSON.stringify(
                            persisted.run
                        )
                    ) as Record<
                        string,
                        any
                    >;

                rawV2.schemaVersion =
                    2;

                delete rawV2
                    .experimentProfile
                    .fixture
                    .issueSpec;

                await fs.rm(
                    path.join(
                        directory,
                        persisted.filename
                    )
                );

                const v2Path =
                    path.join(
                        directory,
                        'legacy-v2.json'
                    );

                const originalText =
                    `${JSON.stringify(
                        rawV2,
                        null,
                        2
                    )}\n`;

                await fs.writeFile(
                    v2Path,
                    originalText,
                    'utf8'
                );

                const runId =
                    rawV2.metadata.runId as string;

                const loaded =
                    await storage.getRun(
                        runId
                    );

                expect(
                    loaded
                ).not.toBeNull();

                expect(
                    loaded?.schemaVersion
                ).toBe(
                    2
                );

                if (
                    loaded === null ||
                    loaded.schemaVersion !== 2
                ) {
                    throw new Error(
                        'L’artifact non è stato letto come V2.'
                    );
                }

                expect(
                    'issueSpec' in
                    loaded
                        .experimentProfile
                        .fixture
                ).toBe(
                    false
                );

                const afterRead =
                    await fs.readFile(
                        v2Path,
                        'utf8'
                    );

                expect(
                    afterRead
                ).toBe(
                    originalText
                );
            }
        );
    }
);
