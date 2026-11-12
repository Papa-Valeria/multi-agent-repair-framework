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
    GitManager,
    type PatchScope
} from '../src/git/GitManager.js';

const temporaryDirectories:
    string[] = [];

const createTemporaryDirectory =
    async (
        prefix: string
    ): Promise<string> => {
        const directory =
            await fs.mkdtemp(
                path.join(
                    os.tmpdir(),
                    prefix
                )
            );

        temporaryDirectories.push(
            directory
        );

        return directory;
    };

const createRepository =
    async (): Promise<string> => {
        const repositoryRoot =
            await createTemporaryDirectory(
                'git-manager-fuzzy-repository-'
            );

        await fs.mkdir(
            path.join(
                repositoryRoot,
                'src'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.mkdir(
            path.join(
                repositoryRoot,
                'internal'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.mkdir(
            path.join(
                repositoryRoot,
                'tests'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'src',
                'target.txt'
            ),
            'original\n',
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'src',
                'second.txt'
            ),
            'second-original\n',
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'internal',
                'target.txt'
            ),
            'internal-original\n',
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'tests',
                'protected.txt'
            ),
            'protected\n',
            'utf8'
        );

        return repositoryRoot;
    };

const createDirectoryLink =
    async (
        targetDirectory: string,
        linkPath: string
    ): Promise<void> => {
        await fs.symlink(
            targetDirectory,
            linkPath,
            process.platform === 'win32'
                ? 'junction'
                : 'dir'
        );
    };

const readText =
    async (
        filePath: string
    ): Promise<string> =>
        fs.readFile(
            filePath,
            'utf8'
        );

const pathExists =
    async (
        filePath: string
    ): Promise<boolean> => {
        try {
            await fs.lstat(
                filePath
            );

            return true;
        } catch (error: unknown) {
            const fileError =
                error as NodeJS.ErrnoException;

            if (
                fileError.code === 'ENOENT' ||
                fileError.code === 'ENOTDIR'
            ) {
                return false;
            }

            throw error;
        }
    };

const repairScope = (
    targetFiles: readonly string[]
): PatchScope => ({
    category:
        'REPAIR',

    targetFiles,

    testFiles: [
        'tests/protected.txt'
    ]
});

const createScope = (
    targetFiles: readonly string[] = []
): PatchScope => ({
    category:
        'CREATE',

    targetFiles,

    testFiles: [
        'tests/protected.txt'
    ]
});

describe(
    'BE-P0-23 - FUZZY symlink confinement',
    () => {
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
            'applica FUZZY a un file normale interno al repository',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const patch = [
                    '--- a/src/target.txt',
                    '+++ b/src/target.txt',
                    '@@ -1 +1 @@',
                    '-original',
                    '+modified'
                ].join('\n');

                const mode =
                    await gitManager.applyPatch(
                        patch,
                        repairScope([
                            'src/target.txt'
                        ]),
                        'FUZZY'
                    );

                expect(
                    mode
                ).toBe(
                    'FUZZY'
                );

                expect(
                    await readText(
                        path.join(
                            repositoryRoot,
                            'src',
                            'target.txt'
                        )
                    )
                ).toBe(
                    'modified\n'
                );
            }
        );

        it(
            'consente FUZZY tramite symlink che rimane realmente dentro il repository',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const internalDirectory =
                    path.join(
                        repositoryRoot,
                        'internal'
                    );

                const internalLink =
                    path.join(
                        repositoryRoot,
                        'internal-link'
                    );

                await createDirectoryLink(
                    internalDirectory,
                    internalLink
                );

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const patch = [
                    '--- a/internal-link/target.txt',
                    '+++ b/internal-link/target.txt',
                    '@@ -1 +1 @@',
                    '-internal-original',
                    '+internal-modified'
                ].join('\n');

                const mode =
                    await gitManager.applyPatch(
                        patch,
                        repairScope([
                            'internal-link/target.txt'
                        ]),
                        'FUZZY'
                    );

                expect(
                    mode
                ).toBe(
                    'FUZZY'
                );

                expect(
                    await readText(
                        path.join(
                            internalDirectory,
                            'target.txt'
                        )
                    )
                ).toBe(
                    'internal-modified\n'
                );
            }
        );

        it(
            'rifiuta FUZZY tramite symlink che risolve a un file esterno e lascia il file esterno invariato',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const outsideDirectory =
                    await createTemporaryDirectory(
                        'git-manager-fuzzy-outside-'
                    );

                const outsideTarget =
                    path.join(
                        outsideDirectory,
                        'target.txt'
                    );

                await fs.writeFile(
                    outsideTarget,
                    'outside-original\n',
                    'utf8'
                );

                await createDirectoryLink(
                    outsideDirectory,
                    path.join(
                        repositoryRoot,
                        'external-link'
                    )
                );

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const patch = [
                    '--- a/external-link/target.txt',
                    '+++ b/external-link/target.txt',
                    '@@ -1 +1 @@',
                    '-outside-original',
                    '+outside-modified'
                ].join('\n');

                await expect(
                    gitManager.applyPatch(
                        patch,
                        repairScope([
                            'external-link/target.txt'
                        ]),
                        'FUZZY'
                    )
                ).rejects.toThrow(
                    'La patch risultava applicabile in modalità FUZZY, ma l’applicazione è fallita.'
                );

                expect(
                    await readText(
                        outsideTarget
                    )
                ).toBe(
                    'outside-original\n'
                );
            }
        );

        it(
            'rifiuta la creazione FUZZY sotto una directory symlink esterna',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const outsideDirectory =
                    await createTemporaryDirectory(
                        'git-manager-fuzzy-create-outside-'
                    );

                await createDirectoryLink(
                    outsideDirectory,
                    path.join(
                        repositoryRoot,
                        'generated-link'
                    )
                );

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const patch = [
                    'diff --git a/generated-link/new-file.txt b/generated-link/new-file.txt',
                    'new file mode 100644',
                    '--- /dev/null',
                    '+++ b/generated-link/new-file.txt',
                    '@@ -0,0 +1 @@',
                    '+created-outside'
                ].join('\n');

                await expect(
                    gitManager.applyPatch(
                        patch,
                        createScope(),
                        'FUZZY'
                    )
                ).rejects.toThrow(
                    'La patch risultava applicabile in modalità FUZZY, ma l’applicazione è fallita.'
                );

                expect(
                    await pathExists(
                        path.join(
                            outsideDirectory,
                            'new-file.txt'
                        )
                    )
                ).toBe(
                    false
                );
            }
        );

        it(
            'non lascia scritture parziali quando una patch multi-file include un symlink esterno',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const outsideDirectory =
                    await createTemporaryDirectory(
                        'git-manager-fuzzy-multifile-outside-'
                    );

                const outsideTarget =
                    path.join(
                        outsideDirectory,
                        'target.txt'
                    );

                await fs.writeFile(
                    outsideTarget,
                    'outside-original\n',
                    'utf8'
                );

                await createDirectoryLink(
                    outsideDirectory,
                    path.join(
                        repositoryRoot,
                        'external-link'
                    )
                );

                const internalTarget =
                    path.join(
                        repositoryRoot,
                        'src',
                        'target.txt'
                    );

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const patch = [
                    '--- a/src/target.txt',
                    '+++ b/src/target.txt',
                    '@@ -1 +1 @@',
                    '-original',
                    '+internal-modified',
                    '--- a/external-link/target.txt',
                    '+++ b/external-link/target.txt',
                    '@@ -1 +1 @@',
                    '-outside-original',
                    '+outside-modified'
                ].join('\n');

                await expect(
                    gitManager.applyPatch(
                        patch,
                        repairScope([
                            'src/target.txt',
                            'external-link/target.txt'
                        ]),
                        'FUZZY'
                    )
                ).rejects.toThrow(
                    'La patch risultava applicabile in modalità FUZZY, ma l’applicazione è fallita.'
                );

                /*
                 * Il file interno non deve essere modificato:
                 * computeFuzzyUpdates e i preflight devono
                 * fallire prima della prima writeFile.
                 */
                expect(
                    await readText(
                        internalTarget
                    )
                ).toBe(
                    'original\n'
                );

                expect(
                    await readText(
                        outsideTarget
                    )
                ).toBe(
                    'outside-original\n'
                );
            }
        );

        it(
            'rifiuta un path FUZZY che tenta un escape lessicale dal repository',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const patch = [
                    '--- a/../outside.txt',
                    '+++ b/../outside.txt',
                    '@@ -1 +1 @@',
                    '-outside-original',
                    '+outside-modified'
                ].join('\n');

                await expect(
                    gitManager.applyPatch(
                        patch,
                        createScope(),
                        'FUZZY'
                    )
                ).rejects.toThrow();
            }
        );

        it(
            'rifiuta una patch FUZZY diretta a .git',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const patch = [
                    '--- a/.git/config',
                    '+++ b/.git/config',
                    '@@ -1 +1 @@',
                    '-original',
                    '+modified'
                ].join('\n');

                await expect(
                    gitManager.applyPatch(
                        patch,
                        createScope(),
                        'FUZZY'
                    )
                ).rejects.toThrow(
                    'La patch tenta di modificare la directory Git'
                );
            }
        );

        it(
            'non tratta come nuovo un file mancante se il diff non lo dichiara new file',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const patch = [
                    '--- a/src/missing.txt',
                    '+++ b/src/missing.txt',
                    '@@ -1 +1 @@',
                    '-missing-original',
                    '+created-incorrectly'
                ].join('\n');

                await expect(
                    gitManager.applyPatch(
                        patch,
                        repairScope([
                            'src/missing.txt'
                        ]),
                        'FUZZY'
                    )
                ).rejects.toThrow(
                    'La patch risultava applicabile in modalità FUZZY, ma l’applicazione è fallita.'
                );

                expect(
                    await pathExists(
                        path.join(
                            repositoryRoot,
                            'src',
                            'missing.txt'
                        )
                    )
                ).toBe(
                    false
                );
            }
        );
    }
);
