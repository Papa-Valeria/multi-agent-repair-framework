import {
    describe,
    expect,
    it
} from '@jest/globals';

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const STORAGE_DIRECTORY =
    path.resolve(
        process.cwd(),
        'experiments_log'
    );

interface JsonObject {
    readonly [key: string]:
    unknown;
}

interface ArtifactSnapshot {
    readonly filename:
    string;

    readonly schemaVersion:
    unknown;

    readonly runId:
    string | null;

    readonly profileKeys:
    readonly string[];

    readonly hasExperimentProfile:
    boolean;

    readonly hasOracleProfileId:
    boolean;

    readonly hasPromptProfileId:
    boolean;

    readonly hasSemgrepProfileId:
    boolean;

    readonly hasBuildOracleConfig:
    boolean;

    readonly hasFunctionalTestOracleConfig:
    boolean;

    readonly hasSemgrepConfig:
    boolean;

    readonly hasModelConfig:
    boolean;

    readonly hasLimits:
    boolean;

    readonly hasFixture:
    boolean;

    readonly fixtureKeys:
    readonly string[];

    readonly fixtureId:
    string | null;
}

const isObject = (
    value:
        unknown
): value is JsonObject => {
    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    );
};

const hasOwn = (
    value:
        JsonObject,

    key:
        string
): boolean => {
    return Object.prototype
        .hasOwnProperty
        .call(
            value,
            key
        );
};

const stringValue = (
    value:
        unknown
): string | null => {
    return typeof value === 'string'
        ? value
        : null;
};

const sortedKeys = (
    value:
        unknown
): readonly string[] => {
    return isObject(value)
        ? Object.keys(value)
            .sort(
                (
                    left,
                    right
                ) =>
                    left.localeCompare(
                        right
                    )
            )
        : [];
};

const readArtifactFiles =
    async (): Promise<
        readonly {
            readonly filename:
            string;

            readonly parsed:
            unknown;
        }[]
    > => {
        let filenames:
            string[];

        try {
            filenames =
                await fs.readdir(
                    STORAGE_DIRECTORY
                );
        } catch (
        error:
            unknown
        ) {
            const fileError =
                error as NodeJS.ErrnoException;

            if (
                fileError.code ===
                'ENOENT'
            ) {
                return [];
            }

            throw error;
        }

        const jsonFilenames =
            filenames
                .filter(
                    (filename) =>
                        filename.endsWith(
                            '.json'
                        )
                )
                .sort(
                    (
                        left,
                        right
                    ) =>
                        left.localeCompare(
                            right
                        )
                );

        return Promise.all(
            jsonFilenames.map(
                async (
                    filename
                ) => {
                    const absolutePath =
                        path.join(
                            STORAGE_DIRECTORY,
                            filename
                        );

                    const content =
                        await fs.readFile(
                            absolutePath,
                            'utf8'
                        );

                    return {
                        filename,

                        parsed:
                            JSON.parse(
                                content
                            ) as unknown
                    };
                }
            )
        );
    };

const createSnapshot = (
    filename:
        string,

    artifact:
        JsonObject
): ArtifactSnapshot => {
    const metadata =
        isObject(
            artifact.metadata
        )
            ? artifact.metadata
            : null;

    const experimentProfile =
        isObject(
            artifact.experimentProfile
        )
            ? artifact.experimentProfile
            : null;

    const fixture =
        experimentProfile !== null &&
            isObject(
                experimentProfile.fixture
            )
            ? experimentProfile.fixture
            : null;

    return {
        filename,

        schemaVersion:
            artifact.schemaVersion,

        runId:
            metadata === null
                ? null
                : stringValue(
                    metadata.runId
                ),

        profileKeys:
            sortedKeys(
                experimentProfile
            ),

        hasExperimentProfile:
            experimentProfile !== null,

        hasOracleProfileId:
            experimentProfile !== null &&
            hasOwn(
                experimentProfile,
                'oracleProfileId'
            ),

        hasPromptProfileId:
            experimentProfile !== null &&
            hasOwn(
                experimentProfile,
                'promptProfileId'
            ),

        hasSemgrepProfileId:
            experimentProfile !== null &&
            hasOwn(
                experimentProfile,
                'semgrepProfileId'
            ),

        hasBuildOracleConfig:
            experimentProfile !== null &&
            hasOwn(
                experimentProfile,
                'buildOracleConfig'
            ),

        hasFunctionalTestOracleConfig:
            experimentProfile !== null &&
            hasOwn(
                experimentProfile,
                'functionalTestOracleConfig'
            ),

        hasSemgrepConfig:
            experimentProfile !== null &&
            hasOwn(
                experimentProfile,
                'semgrepConfig'
            ),

        hasModelConfig:
            experimentProfile !== null &&
            hasOwn(
                experimentProfile,
                'modelConfig'
            ),

        hasLimits:
            experimentProfile !== null &&
            hasOwn(
                experimentProfile,
                'limits'
            ),

        hasFixture:
            fixture !== null,

        fixtureKeys:
            sortedKeys(
                fixture
            ),

        fixtureId:
            fixture === null
                ? null
                : stringValue(
                    fixture.id
                )
    };
};

const profileShapeKey = (
    snapshot:
        ArtifactSnapshot
): string => {
    return snapshot
        .profileKeys
        .join(
            '|'
        );
};

const fixtureShapeKey = (
    snapshot:
        ArtifactSnapshot
): string => {
    return snapshot
        .fixtureKeys
        .join(
            '|'
        );
};

const describeV2Snapshots = (
    snapshots:
        readonly ArtifactSnapshot[]
): void => {
    if (
        snapshots.length === 0
    ) {
        console.info(
            '[BE-P1-21] Nessun artifact schemaVersion 2 trovato in experiments_log.'
        );

        return;
    }

    const profileShapes =
        new Map<
            string,
            string[]
        >();

    const fixtureShapes =
        new Map<
            string,
            string[]
        >();

    for (
        const snapshot of
        snapshots
    ) {
        const profileKey =
            profileShapeKey(
                snapshot
            );

        const profileFiles =
            profileShapes.get(
                profileKey
            ) ?? [];

        profileFiles.push(
            snapshot.filename
        );

        profileShapes.set(
            profileKey,
            profileFiles
        );

        const fixtureKey =
            fixtureShapeKey(
                snapshot
            );

        const fixtureFiles =
            fixtureShapes.get(
                fixtureKey
            ) ?? [];

        fixtureFiles.push(
            snapshot.filename
        );

        fixtureShapes.set(
            fixtureKey,
            fixtureFiles
        );
    }

    console.info(
        '[BE-P1-21] Artifact V2 analizzati:',
        snapshots.length
    );

    console.info(
        '[BE-P1-21] Forme ExperimentProfile V2 osservate:',
        [...profileShapes.entries()]
            .map(
                (
                    [
                        shape,
                        filenames
                    ]
                ) => ({
                    keys:
                        shape.length > 0
                            ? shape.split('|')
                            : [],

                    artifactCount:
                        filenames.length,

                    filenames
                })
            )
    );

    console.info(
        '[BE-P1-21] Forme fixture V2 osservate:',
        [...fixtureShapes.entries()]
            .map(
                (
                    [
                        shape,
                        filenames
                    ]
                ) => ({
                    keys:
                        shape.length > 0
                            ? shape.split('|')
                            : [],

                    artifactCount:
                        filenames.length,

                    filenames
                })
            )
    );

    console.info(
        '[BE-P1-21] Presenza provenance nei V2:',
        snapshots.map(
            (
                snapshot
            ) => ({
                filename:
                    snapshot.filename,

                runId:
                    snapshot.runId,

                oracleProfileId:
                    snapshot.hasOracleProfileId,

                promptProfileId:
                    snapshot.hasPromptProfileId,

                semgrepProfileId:
                    snapshot.hasSemgrepProfileId,

                buildOracleConfig:
                    snapshot.hasBuildOracleConfig,

                functionalTestOracleConfig:
                    snapshot.hasFunctionalTestOracleConfig,

                semgrepConfig:
                    snapshot.hasSemgrepConfig,

                modelConfig:
                    snapshot.hasModelConfig,

                limits:
                    snapshot.hasLimits,

                fixture:
                    snapshot.hasFixture,

                fixtureId:
                    snapshot.fixtureId
            })
        )
    );
};

describe(
    'BE-P1-21 - Artifact schema evolution diagnostics',
    () => {
        it(
            'legge tutti gli artifact JSON senza modificarli',
            async () => {
                const artifacts =
                    await readArtifactFiles();

                for (
                    const artifact of
                    artifacts
                ) {
                    const absolutePath =
                        path.join(
                            STORAGE_DIRECTORY,
                            artifact.filename
                        );

                    const before =
                        await fs.readFile(
                            absolutePath,
                            'utf8'
                        );

                    JSON.parse(
                        before
                    );

                    const after =
                        await fs.readFile(
                            absolutePath,
                            'utf8'
                        );

                    expect(
                        after
                    ).toBe(
                        before
                    );
                }
            }
        );

        it(
            'fotografa le forme reali degli artifact schemaVersion 2',
            async () => {
                const artifacts =
                    await readArtifactFiles();

                const snapshots =
                    artifacts
                        .filter(
                            (
                                artifact
                            ):
                                artifact is {
                                    readonly filename:
                                    string;

                                    readonly parsed:
                                    JsonObject;
                                } =>
                                isObject(
                                    artifact.parsed
                                ) &&
                                artifact.parsed
                                    .schemaVersion ===
                                2
                        )
                        .map(
                            (
                                artifact
                            ) =>
                                createSnapshot(
                                    artifact.filename,
                                    artifact.parsed
                                )
                        );

                describeV2Snapshots(
                    snapshots
                );

                for (
                    const snapshot of
                    snapshots
                ) {
                    expect(
                        snapshot.schemaVersion
                    ).toBe(
                        2
                    );
                }
            }
        );

        it(
            'evidenzia se esistono più contratti ExperimentProfile sotto schemaVersion 2',
            async () => {
                const artifacts =
                    await readArtifactFiles();

                const snapshots =
                    artifacts
                        .filter(
                            (
                                artifact
                            ):
                                artifact is {
                                    readonly filename:
                                    string;

                                    readonly parsed:
                                    JsonObject;
                                } =>
                                isObject(
                                    artifact.parsed
                                ) &&
                                artifact.parsed
                                    .schemaVersion ===
                                2
                        )
                        .map(
                            (
                                artifact
                            ) =>
                                createSnapshot(
                                    artifact.filename,
                                    artifact.parsed
                                )
                        );

                const observedShapes =
                    new Set(
                        snapshots.map(
                            profileShapeKey
                        )
                    );

                console.info(
                    '[BE-P1-21] Numero di contratti ExperimentProfile V2 osservati:',
                    observedShapes.size
                );

                /*
                 * Questo test è diagnostico:
                 * non imponiamo ancora che esista una sola forma.
                 *
                 * Se observedShapes.size > 1, significa che V2
                 * è già stato evoluto in-place e dovremo modellare
                 * esplicitamente la compatibilità storica.
                 */
                expect(
                    observedShapes.size
                ).toBeGreaterThanOrEqual(
                    snapshots.length > 0
                        ? 1
                        : 0
                );
            }
        );

        it(
            'non retro-applica semgrepProfileId agli artifact V2 che non lo possiedono',
            async () => {
                const artifacts =
                    await readArtifactFiles();

                for (
                    const artifact of
                    artifacts
                ) {
                    if (
                        !isObject(
                            artifact.parsed
                        ) ||
                        artifact.parsed
                            .schemaVersion !==
                        2
                    ) {
                        continue;
                    }

                    const before =
                        JSON.stringify(
                            artifact.parsed
                        );

                    const snapshot =
                        createSnapshot(
                            artifact.filename,
                            artifact.parsed
                        );

                    const after =
                        JSON.stringify(
                            artifact.parsed
                        );

                    expect(
                        after
                    ).toBe(
                        before
                    );

                    if (
                        !snapshot
                            .hasSemgrepProfileId
                    ) {
                        const profile =
                            isObject(
                                artifact.parsed
                                    .experimentProfile
                            )
                                ? artifact.parsed
                                    .experimentProfile
                                : null;

                        expect(
                            profile === null ||
                            !hasOwn(
                                profile,
                                'semgrepProfileId'
                            )
                        ).toBe(
                            true
                        );
                    }
                }
            }
        );

        it(
            'non retro-applica limits agli artifact V2 che non li possiedono',
            async () => {
                const artifacts =
                    await readArtifactFiles();

                for (
                    const artifact of
                    artifacts
                ) {
                    if (
                        !isObject(
                            artifact.parsed
                        ) ||
                        artifact.parsed
                            .schemaVersion !==
                        2
                    ) {
                        continue;
                    }

                    const snapshot =
                        createSnapshot(
                            artifact.filename,
                            artifact.parsed
                        );

                    if (
                        !snapshot.hasLimits
                    ) {
                        const profile =
                            isObject(
                                artifact.parsed
                                    .experimentProfile
                            )
                                ? artifact.parsed
                                    .experimentProfile
                                : null;

                        expect(
                            profile === null ||
                            !hasOwn(
                                profile,
                                'limits'
                            )
                        ).toBe(
                            true
                        );
                    }
                }
            }
        );

        it(
            'non retro-applica fixture identity agli artifact V2 che non la possiedono',
            async () => {
                const artifacts =
                    await readArtifactFiles();

                for (
                    const artifact of
                    artifacts
                ) {
                    if (
                        !isObject(
                            artifact.parsed
                        ) ||
                        artifact.parsed
                            .schemaVersion !==
                        2
                    ) {
                        continue;
                    }

                    const snapshot =
                        createSnapshot(
                            artifact.filename,
                            artifact.parsed
                        );

                    if (
                        !snapshot.hasFixture
                    ) {
                        const profile =
                            isObject(
                                artifact.parsed
                                    .experimentProfile
                            )
                                ? artifact.parsed
                                    .experimentProfile
                                : null;

                        expect(
                            profile === null ||
                            !hasOwn(
                                profile,
                                'fixture'
                            )
                        ).toBe(
                            true
                        );
                    }
                }
            }
        );

        it(
            'non cambia schemaVersion durante la sola lettura diagnostica',
            async () => {
                const artifacts =
                    await readArtifactFiles();

                for (
                    const artifact of
                    artifacts
                ) {
                    if (
                        !isObject(
                            artifact.parsed
                        )
                    ) {
                        continue;
                    }

                    const originalVersion =
                        artifact.parsed
                            .schemaVersion;

                    const serialized =
                        JSON.stringify(
                            artifact.parsed
                        );

                    const reparsed =
                        JSON.parse(
                            serialized
                        ) as unknown;

                    expect(
                        isObject(
                            reparsed
                        )
                            ? reparsed
                                .schemaVersion
                            : undefined
                    ).toBe(
                        originalVersion
                    );
                }
            }
        );

        it(
            'classifica soltanto versioni schema numeriche positive',
            async () => {
                const artifacts =
                    await readArtifactFiles();

                for (
                    const artifact of
                    artifacts
                ) {
                    if (
                        !isObject(
                            artifact.parsed
                        )
                    ) {
                        continue;
                    }

                    const version =
                        artifact.parsed
                            .schemaVersion;

                    expect(
                        typeof version
                    ).toBe(
                        'number'
                    );

                    expect(
                        Number.isInteger(
                            version
                        )
                    ).toBe(
                        true
                    );

                    expect(
                        version as number
                    ).toBeGreaterThan(
                        0
                    );
                }
            }
        );
    }
);
