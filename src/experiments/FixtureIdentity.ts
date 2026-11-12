import {
    createHash
} from 'node:crypto';

import * as path from 'node:path';

import type {
    ExperimentCategory
} from '../types/analytics.js';

export interface FixtureIdentityInput {
    readonly category:
    ExperimentCategory;

    readonly issueSpec:
    string;

    readonly targetSources:
    Readonly<
        Record<string, string>
    >;

    readonly testSources:
    Readonly<
        Record<string, string>
    >;
}

interface CanonicalSourceEntry {
    readonly path:
    string;

    readonly content:
    string;
}

interface CanonicalFixtureIdentity {
    readonly category:
    ExperimentCategory;

    readonly issueSpec:
    string;

    readonly targetSources:
    readonly CanonicalSourceEntry[];

    readonly testSources:
    readonly CanonicalSourceEntry[];
}

const normalizeFixturePath = (
    filePath: string
): string => {
    let normalized =
        filePath
            .replaceAll(
                '\\',
                '/'
            )
            .trim();

    while (
        normalized.startsWith(
            './'
        )
    ) {
        normalized =
            normalized.substring(
                2
            );
    }

    return path.posix.normalize(
        normalized
    );
};

const normalizeFixtureContent = (
    content: string
): string => {
    return content.replace(
        /\r\n/g,
        '\n'
    );
};

const canonicalizeSources = (
    sources:
        Readonly<
            Record<string, string>
        >,
    sourceKind:
        'targetSources' |
        'testSources',
): readonly CanonicalSourceEntry[] => {
    const canonicalEntries:
        CanonicalSourceEntry[] = [];

    const canonicalPaths =
        new Map<
            string,
            string
        >();

    for (
        const [
            sourcePath,
            content
        ] of Object.entries(
            sources
        )
    ) {
        const canonicalPath =
            normalizeFixturePath(
                sourcePath
            );

        const existingSourcePath =
            canonicalPaths.get(
                canonicalPath
            );

        if (
            existingSourcePath !==
            undefined
        ) {
            throw new Error(
                `Collisione di path canonico in ${sourceKind}: ` +
                `'${existingSourcePath}' e '${sourcePath}' ` +
                `normalizzano entrambi a '${canonicalPath}'.`
            );
        }

        canonicalPaths.set(
            canonicalPath,
            sourcePath
        );

        canonicalEntries.push({
            path:
                canonicalPath,

            content:
                normalizeFixtureContent(
                    content
                )
        });
    }

    return canonicalEntries.sort(
        (
            left,
            right
        ) =>
            left.path.localeCompare(
                right.path
            )
    );
};

export const canonicalizeFixtureIdentity = (
    input:
        FixtureIdentityInput
): CanonicalFixtureIdentity => {
    return {
        category:
            input.category,

        issueSpec:
            normalizeFixtureContent(
                input.issueSpec
            ),

        targetSources:
            canonicalizeSources(
                input.targetSources,
                'targetSources'
            ),

        testSources:
            canonicalizeSources(
                input.testSources,
                'testSources'
            )
    };
};

export const createFixtureIdentity = (
    input:
        FixtureIdentityInput
): string => {
    const canonicalFixture =
        canonicalizeFixtureIdentity(
            input
        );

    const serialized =
        JSON.stringify(
            canonicalFixture
        );

    return createHash(
        'sha256'
    )
        .update(
            serialized,
            'utf8'
        )
        .digest(
            'hex'
        );
};
