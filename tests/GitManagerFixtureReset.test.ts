import {
    afterEach,
    describe,
    expect,
    it
} from '@jest/globals';

import {
    execFile
} from 'node:child_process';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    promisify
} from 'node:util';

import {
    GitManager
} from '../src/git/GitManager.js';

const execFileAsync =
    promisify(
        execFile
    );

const temporaryDirectories:
    string[] = [];

interface RepositoryFixture {
    readonly repositoryRoot: string;
    readonly initialHead: string;
}

type FilesystemSnapshot =
    Readonly<Record<string, string>>;

const normalizeText =
    (
        content: string
    ): string =>
        content.replace(
            /\r\n/g,
            '\n'
        );

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

const runGit =
    async (
        repositoryRoot: string,
        args: readonly string[]
    ): Promise<string> => {
        const result =
            await execFileAsync(
                'git',
                [
                    ...args
                ],
                {
                    cwd:
                        repositoryRoot
                }
            );

        return result.stdout.trim();
    };

const pathExists =
    async (
        candidatePath: string
    ): Promise<boolean> => {
        try {
            await fs.lstat(
                candidatePath
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

const readText =
    async (
        filePath: string
    ): Promise<string> => {
        const content =
            await fs.readFile(
                filePath,
                'utf8'
            );

        return normalizeText(
            content
        );
    };

const createRepository =
    async (): Promise<RepositoryFixture> => {
        const repositoryRoot =
            await createTemporaryDirectory(
                'git-manager-fixture-reset-'
            );

        await runGit(
            repositoryRoot,
            [
                'init'
            ]
        );

        await runGit(
            repositoryRoot,
            [
                'config',
                'user.email',
                'fixture-reset@example.test'
            ]
        );

        await runGit(
            repositoryRoot,
            [
                'config',
                'user.name',
                'Fixture Reset Test'
            ]
        );

        /*
         * Gli artifact previsti dalla fixture-reset policy
         * sono realmente ignored da Git.
         *
         * .venv è volutamente ignored ma NON appartiene
         * alla whitelist BE-P0-24: deve sopravvivere.
         */
        await fs.writeFile(
            path.join(
                repositoryRoot,
                '.gitignore'
            ),
            [
                '**/__pycache__/',
                '**/.pytest_cache/',
                '**/.coverage',
                '**/coverage.xml',
                '**/htmlcov/',
                '.venv/',
                ''
            ].join('\n'),
            'utf8'
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
                'target.py'
            ),
            [
                'def target():',
                '    return "original"',
                ''
            ].join('\n'),
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'tests',
                'test_target.py'
            ),
            [
                'def test_target():',
                '    assert True',
                ''
            ].join('\n'),
            'utf8'
        );

        /*
         * coverage.xml appartiene nominalmente alla
         * cleanup whitelist ed è coperto da .gitignore.
         *
         * Viene però aggiunto forzatamente e versionato.
         * Il reset deve ripristinarlo e preservarlo.
         */
        await fs.writeFile(
            path.join(
                repositoryRoot,
                'coverage.xml'
            ),
            '<coverage>tracked-baseline</coverage>\n',
            'utf8'
        );

        await runGit(
            repositoryRoot,
            [
                'add',
                '.gitignore',
                'src/target.py',
                'tests/test_target.py'
            ]
        );

        await runGit(
            repositoryRoot,
            [
                'add',
                '-f',
                'coverage.xml'
            ]
        );

        await runGit(
            repositoryRoot,
            [
                'commit',
                '-m',
                'fixture: initial state'
            ]
        );

        const initialHead =
            await runGit(
                repositoryRoot,
                [
                    'rev-parse',
                    'HEAD'
                ]
            );

        return {
            repositoryRoot,
            initialHead
        };
    };

const contaminateRepository =
    async (
        repositoryRoot: string
    ): Promise<void> => {
        /*
         * Modifica di un file tracked.
         */
        await fs.writeFile(
            path.join(
                repositoryRoot,
                'src',
                'target.py'
            ),
            [
                'def target():',
                '    return "contaminated"',
                ''
            ].join('\n'),
            'utf8'
        );

        /*
         * Modifica del file tracked con nome
         * appartenente alla whitelist.
         */
        await fs.writeFile(
            path.join(
                repositoryRoot,
                'coverage.xml'
            ),
            '<coverage>contaminated</coverage>\n',
            'utf8'
        );

        /*
         * Untracked non ignored.
         */
        await fs.writeFile(
            path.join(
                repositoryRoot,
                'scratch.tmp'
            ),
            'untracked contamination\n',
            'utf8'
        );

        await fs.mkdir(
            path.join(
                repositoryRoot,
                'generated'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'generated',
                'runtime.txt'
            ),
            'untracked runtime output\n',
            'utf8'
        );

        /*
         * __pycache__ ignored e whitelisted.
         */
        await fs.mkdir(
            path.join(
                repositoryRoot,
                'src',
                '__pycache__'
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
                '__pycache__',
                'target.cpython-312.pyc'
            ),
            'compiled python artifact\n',
            'utf8'
        );

        /*
         * .pytest_cache ignored e whitelisted.
         */
        await fs.mkdir(
            path.join(
                repositoryRoot,
                '.pytest_cache',
                'v',
                'cache'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                '.pytest_cache',
                'v',
                'cache',
                'nodeids'
            ),
            'cached test identifiers\n',
            'utf8'
        );

        /*
         * .coverage ignored e whitelisted.
         */
        await fs.writeFile(
            path.join(
                repositoryRoot,
                'src',
                '.coverage'
            ),
            'coverage database\n',
            'utf8'
        );

        /*
         * coverage.xml ignored, whitelisted e non tracked
         * perché si trova sotto src/.
         */
        await fs.writeFile(
            path.join(
                repositoryRoot,
                'src',
                'coverage.xml'
            ),
            '<coverage>ignored-runtime</coverage>\n',
            'utf8'
        );

        /*
         * htmlcov ignored e whitelisted.
         */
        await fs.mkdir(
            path.join(
                repositoryRoot,
                'reports',
                'htmlcov'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'reports',
                'htmlcov',
                'index.html'
            ),
            '<html>coverage report</html>\n',
            'utf8'
        );

        /*
         * Ignored ma NON whitelisted.
         * Deve sopravvivere al reset.
         */
        await fs.mkdir(
            path.join(
                repositoryRoot,
                '.venv'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                '.venv',
                'keep.txt'
            ),
            'preserve ignored local resource\n',
            'utf8'
        );
    };

const assertCleanRelevantFilesystem =
    async (
        repositoryRoot: string
    ): Promise<void> => {
        expect(
            await readText(
                path.join(
                    repositoryRoot,
                    'src',
                    'target.py'
                )
            )
        ).toBe(
            [
                'def target():',
                '    return "original"',
                ''
            ].join('\n')
        );

        /*
         * Il coverage.xml tracked deve essere ripristinato,
         * non eliminato dalla whitelist.
         */
        expect(
            await readText(
                path.join(
                    repositoryRoot,
                    'coverage.xml'
                )
            )
        ).toBe(
            '<coverage>tracked-baseline</coverage>\n'
        );

        /*
         * Untracked non ignored.
         */
        expect(
            await pathExists(
                path.join(
                    repositoryRoot,
                    'scratch.tmp'
                )
            )
        ).toBe(
            false
        );

        expect(
            await pathExists(
                path.join(
                    repositoryRoot,
                    'generated'
                )
            )
        ).toBe(
            false
        );

        /*
         * Ignored artifact whitelisted.
         */
        expect(
            await pathExists(
                path.join(
                    repositoryRoot,
                    'src',
                    '__pycache__'
                )
            )
        ).toBe(
            false
        );

        expect(
            await pathExists(
                path.join(
                    repositoryRoot,
                    '.pytest_cache'
                )
            )
        ).toBe(
            false
        );

        expect(
            await pathExists(
                path.join(
                    repositoryRoot,
                    'src',
                    '.coverage'
                )
            )
        ).toBe(
            false
        );

        expect(
            await pathExists(
                path.join(
                    repositoryRoot,
                    'src',
                    'coverage.xml'
                )
            )
        ).toBe(
            false
        );

        expect(
            await pathExists(
                path.join(
                    repositoryRoot,
                    'reports',
                    'htmlcov'
                )
            )
        ).toBe(
            false
        );

        /*
         * Ignored ma non whitelisted.
         */
        expect(
            await readText(
                path.join(
                    repositoryRoot,
                    '.venv',
                    'keep.txt'
                )
            )
        ).toBe(
            'preserve ignored local resource\n'
        );

        const status =
            await runGit(
                repositoryRoot,
                [
                    'status',
                    '--porcelain'
                ]
            );

        expect(
            status
        ).toBe(
            ''
        );
    };

const captureRelevantSnapshot =
    async (
        repositoryRoot: string
    ): Promise<FilesystemSnapshot> => {
        const snapshot:
            Record<string, string> = {};

        const visit =
            async (
                directory: string
            ): Promise<void> => {
                const entries =
                    await fs.readdir(
                        directory,
                        {
                            withFileTypes:
                                true
                        }
                    );

                entries.sort(
                    (left, right) =>
                        left.name.localeCompare(
                            right.name
                        )
                );

                for (
                    const entry of entries
                ) {
                    /*
                     * I metadata Git non appartengono
                     * allo snapshot della fixture.
                     */
                    if (
                        entry.name === '.git'
                    ) {
                        continue;
                    }

                    const absolutePath =
                        path.join(
                            directory,
                            entry.name
                        );

                    const relativePath =
                        path
                            .relative(
                                repositoryRoot,
                                absolutePath
                            )
                            .replaceAll(
                                '\\',
                                '/'
                            );

                    if (
                        entry.isSymbolicLink()
                    ) {
                        snapshot[
                            relativePath
                        ] =
                            `SYMLINK:${await fs.readlink(
                                absolutePath
                            )}`;

                        continue;
                    }

                    if (
                        entry.isDirectory()
                    ) {
                        snapshot[
                            `${relativePath}/`
                        ] =
                            'DIRECTORY';

                        await visit(
                            absolutePath
                        );

                        continue;
                    }

                    const content =
                        await fs.readFile(
                            absolutePath,
                            'utf8'
                        );

                    /*
                     * Gli EOL vengono normalizzati per evitare
                     * dipendenze da core.autocrlf.
                     */
                    snapshot[
                        relativePath
                    ] =
                        normalizeText(
                            content
                        );
                }
            };

        await visit(
            repositoryRoot
        );

        return Object.freeze({
            ...snapshot
        });
    };

describe(
    'BE-P0-24 - Fixture reset ignored artifacts cleanup',
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
            'hardReset ripristina tracked, elimina untracked e pulisce gli ignored artifact autorizzati',
            async () => {
                const {
                    repositoryRoot
                } =
                    await createRepository();

                await contaminateRepository(
                    repositoryRoot
                );

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                await gitManager.hardReset();

                await assertCleanRelevantFilesystem(
                    repositoryRoot
                );
            }
        );

        it(
            'preserva un file tracked anche se il nome appartiene alla whitelist degli artifact',
            async () => {
                const {
                    repositoryRoot
                } =
                    await createRepository();

                const coveragePath =
                    path.join(
                        repositoryRoot,
                        'coverage.xml'
                    );

                await fs.writeFile(
                    coveragePath,
                    '<coverage>modified</coverage>\n',
                    'utf8'
                );

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                await gitManager.hardReset();

                expect(
                    await pathExists(
                        coveragePath
                    )
                ).toBe(
                    true
                );

                expect(
                    await readText(
                        coveragePath
                    )
                ).toBe(
                    '<coverage>tracked-baseline</coverage>\n'
                );
            }
        );

        it(
            'preserva gli ignored file non inclusi nella fixture cleanup whitelist',
            async () => {
                const {
                    repositoryRoot
                } =
                    await createRepository();

                const preservedIgnoredFile =
                    path.join(
                        repositoryRoot,
                        '.venv',
                        'keep.txt'
                    );

                await fs.mkdir(
                    path.dirname(
                        preservedIgnoredFile
                    ),
                    {
                        recursive:
                            true
                    }
                );

                await fs.writeFile(
                    preservedIgnoredFile,
                    'must survive reset\n',
                    'utf8'
                );

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                await gitManager.hardReset();

                expect(
                    await readText(
                        preservedIgnoredFile
                    )
                ).toBe(
                    'must survive reset\n'
                );
            }
        );

        it(
            'due hardReset consecutivi producono lo stesso filesystem rilevante',
            async () => {
                const {
                    repositoryRoot
                } =
                    await createRepository();

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                await contaminateRepository(
                    repositoryRoot
                );

                await gitManager.hardReset();

                const firstSnapshot =
                    await captureRelevantSnapshot(
                        repositoryRoot
                    );

                await contaminateRepository(
                    repositoryRoot
                );

                await gitManager.hardReset();

                const secondSnapshot =
                    await captureRelevantSnapshot(
                        repositoryRoot
                    );

                expect(
                    secondSnapshot
                ).toEqual(
                    firstSnapshot
                );

                await assertCleanRelevantFilesystem(
                    repositoryRoot
                );
            }
        );

        it(
            'rollback applica la stessa fixture reset policy di hardReset',
            async () => {
                const {
                    repositoryRoot,
                    initialHead
                } =
                    await createRepository();

                await contaminateRepository(
                    repositoryRoot
                );

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const rollbackResult =
                    await gitManager.rollback(
                        initialHead
                    );

                expect(
                    rollbackResult.status
                ).toBe(
                    'SUCCESS'
                );

                expect(
                    rollbackResult.finalHead
                ).toBe(
                    initialHead
                );

                expect(
                    rollbackResult.repositoryClean
                ).toBe(
                    true
                );

                await assertCleanRelevantFilesystem(
                    repositoryRoot
                );
            }
        );

        /*
         * Questo è il test più costoso della suite:
         * esegue due contaminazioni complete, hardReset,
         * rollback, cleanup ignored e due snapshot.
         *
         * Su Windows il limite Jest predefinito di 5 secondi
         * è troppo stretto. Il timeout locale non modifica
         * il comportamento production e non indebolisce
         * alcuna assertion.
         */
        it(
            'rollback e hardReset producono lo stesso filesystem rilevante',
            async () => {
                const {
                    repositoryRoot,
                    initialHead
                } =
                    await createRepository();

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                await contaminateRepository(
                    repositoryRoot
                );

                await gitManager.hardReset();

                const hardResetSnapshot =
                    await captureRelevantSnapshot(
                        repositoryRoot
                    );

                await contaminateRepository(
                    repositoryRoot
                );

                const rollbackResult =
                    await gitManager.rollback(
                        initialHead
                    );

                expect(
                    rollbackResult.status
                ).toBe(
                    'SUCCESS'
                );

                const rollbackSnapshot =
                    await captureRelevantSnapshot(
                        repositoryRoot
                    );

                expect(
                    rollbackSnapshot
                ).toEqual(
                    hardResetSnapshot
                );
            },
            15_000
        );

        it(
            'rimuove un artifact ignored symlink senza modificare la destinazione esterna',
            async () => {
                const {
                    repositoryRoot
                } =
                    await createRepository();

                const outsideDirectory =
                    await createTemporaryDirectory(
                        'git-manager-fixture-reset-outside-'
                    );

                const outsideFile =
                    path.join(
                        outsideDirectory,
                        'keep.txt'
                    );

                await fs.writeFile(
                    outsideFile,
                    'external content must survive\n',
                    'utf8'
                );

                const artifactLink =
                    path.join(
                        repositoryRoot,
                        'htmlcov'
                    );

                await fs.symlink(
                    outsideDirectory,
                    artifactLink,
                    process.platform === 'win32'
                        ? 'junction'
                        : 'dir'
                );

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                await gitManager.hardReset();

                expect(
                    await pathExists(
                        artifactLink
                    )
                ).toBe(
                    false
                );

                expect(
                    await readText(
                        outsideFile
                    )
                ).toBe(
                    'external content must survive\n'
                );
            }
        );
    }
);
