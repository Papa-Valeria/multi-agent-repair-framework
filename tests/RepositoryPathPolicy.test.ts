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
    RepositoryPathPolicyError,
    resolveRepositoryPath
} from '../src/security/RepositoryPathPolicy.js';

describe(
    'BE-P0-21 - Repository path confinement policy',
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

        const createRepository =
            async (): Promise<string> => {
                const root =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'repository-path-policy-'
                        )
                    );

                temporaryDirectories.push(
                    root
                );

                await fs.mkdir(
                    path.join(
                        root,
                        'src'
                    ),
                    {
                        recursive:
                            true
                    }
                );

                await fs.mkdir(
                    path.join(
                        root,
                        'tests'
                    ),
                    {
                        recursive:
                            true
                    }
                );

                await fs.writeFile(
                    path.join(
                        root,
                        'src',
                        'target.py'
                    ),
                    'return True\n',
                    'utf8'
                );

                await fs.writeFile(
                    path.join(
                        root,
                        'tests',
                        'test_target.py'
                    ),
                    'def test_target(): pass\n',
                    'utf8'
                );

                return root;
            };

        it(
            'accetta un file relativo esistente confinato nel repository',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const resolved =
                    await resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            'src/target.py'
                    });

                expect(
                    resolved.relativePath
                ).toBe(
                    'src/target.py'
                );

                expect(
                    resolved.absolutePath
                ).toBe(
                    path.resolve(
                        repositoryRoot,
                        'src',
                        'target.py'
                    )
                );
            }
        );

        it(
            'normalizza dot segment e separatori senza modificare il confinement',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const resolved =
                    await resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            './src/../src/target.py'
                    });

                expect(
                    resolved.relativePath
                ).toBe(
                    'src/target.py'
                );

                expect(
                    resolved.absolutePath
                ).toBe(
                    path.resolve(
                        repositoryRoot,
                        'src',
                        'target.py'
                    )
                );
            }
        );

        it(
            'normalizza i separatori Windows per path relativi validi',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const resolved =
                    await resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            'src\\target.py'
                    });

                expect(
                    resolved.relativePath
                ).toBe(
                    'src/target.py'
                );

                expect(
                    resolved.absolutePath
                ).toBe(
                    path.resolve(
                        repositoryRoot,
                        'src',
                        'target.py'
                    )
                );
            }
        );

        it(
            'rifiuta un path vuoto',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            '   '
                    })
                ).rejects.toMatchObject({
                    name:
                        'RepositoryPathPolicyError',

                    reason:
                        'EMPTY_PATH'
                });
            }
        );

        it(
            'rifiuta la root repository rappresentata da dot senza autorizzazione esplicita',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            '.'
                    })
                ).rejects.toMatchObject({
                    reason:
                        'EMPTY_PATH'
                });
            }
        );

        it(
            'accetta la repository root quando esplicitamente autorizzata',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const resolved =
                    await resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            '.',

                        allowRepositoryRoot:
                            true
                    });

                expect(
                    resolved.relativePath
                ).toBe(
                    '.'
                );

                expect(
                    resolved.absolutePath
                ).toBe(
                    path.resolve(
                        repositoryRoot
                    )
                );
            }
        );

        it(
            'rifiuta path assoluti POSIX',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            '/tmp/outside.py'
                    })
                ).rejects.toMatchObject({
                    reason:
                        'ABSOLUTE_PATH'
                });
            }
        );

        it(
            'rifiuta path assoluti Windows indipendentemente dalla piattaforma host',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            'C:\\temp\\outside.py'
                    })
                ).rejects.toMatchObject({
                    reason:
                        'ABSOLUTE_PATH'
                });
            }
        );

        it(
            'rifiuta escape diretto tramite parent traversal',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            '../outside.py'
                    })
                ).rejects.toMatchObject({
                    reason:
                        'PATH_ESCAPE'
                });
            }
        );

        it(
            'rifiuta escape multiplo tramite parent traversal',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            '../../outside.py'
                    })
                ).rejects.toMatchObject({
                    reason:
                        'PATH_ESCAPE'
                });
            }
        );

        it(
            'rifiuta escape con separatori Windows',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            '..\\outside.py'
                    })
                ).rejects.toMatchObject({
                    reason:
                        'PATH_ESCAPE'
                });
            }
        );

        it(
            'rifiuta accesso diretto a .git',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            '.git/config',

                        allowMissing:
                            true
                    })
                ).rejects.toMatchObject({
                    reason:
                        'GIT_PATH'
                });
            }
        );

        it(
            'rifiuta .git anche quando compare in una directory annidata',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            'src/.git/config',

                        allowMissing:
                            true
                    })
                ).rejects.toMatchObject({
                    reason:
                        'GIT_PATH'
                });
            }
        );

        it(
            'rifiuta un file inesistente quando allowMissing non è abilitato',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            'src/missing.py'
                    })
                ).rejects.toMatchObject({
                    reason:
                        'PATH_NOT_FOUND'
                });
            }
        );

        it(
            'accetta un target CREATE inesistente sotto un ancestor realmente confinato',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const resolved =
                    await resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            'src/generated/new_target.py',

                        allowMissing:
                            true
                    });

                expect(
                    resolved.relativePath
                ).toBe(
                    'src/generated/new_target.py'
                );

                expect(
                    resolved.absolutePath
                ).toBe(
                    path.resolve(
                        repositoryRoot,
                        'src',
                        'generated',
                        'new_target.py'
                    )
                );
            }
        );

        it(
            'rifiuta un file esistente raggiunto tramite symlink che esce dal repository',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const outsideDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'repository-path-outside-'
                        )
                    );

                temporaryDirectories.push(
                    outsideDirectory
                );

                await fs.writeFile(
                    path.join(
                        outsideDirectory,
                        'outside.py'
                    ),
                    'return False\n',
                    'utf8'
                );

                const linkPath =
                    path.join(
                        repositoryRoot,
                        'external-link'
                    );

                await fs.symlink(
                    outsideDirectory,
                    linkPath,
                    process.platform === 'win32'
                        ? 'junction'
                        : 'dir'
                );

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            'external-link/outside.py'
                    })
                ).rejects.toMatchObject({
                    reason:
                        'REAL_PATH_ESCAPE'
                });
            }
        );

        it(
            'rifiuta CREATE sotto un symlink che esce dal repository',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const outsideDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'repository-create-outside-'
                        )
                    );

                temporaryDirectories.push(
                    outsideDirectory
                );

                const linkPath =
                    path.join(
                        repositoryRoot,
                        'generated-link'
                    );

                await fs.symlink(
                    outsideDirectory,
                    linkPath,
                    process.platform === 'win32'
                        ? 'junction'
                        : 'dir'
                );

                await expect(
                    resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            'generated-link/new_target.py',

                        allowMissing:
                            true
                    })
                ).rejects.toMatchObject({
                    reason:
                        'REAL_PATH_ESCAPE'
                });
            }
        );

        it(
            'accetta un file raggiunto tramite symlink che rimane dentro il repository',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const internalDirectory =
                    path.join(
                        repositoryRoot,
                        'internal'
                    );

                await fs.mkdir(
                    internalDirectory
                );

                await fs.writeFile(
                    path.join(
                        internalDirectory,
                        'inside.py'
                    ),
                    'return True\n',
                    'utf8'
                );

                const linkPath =
                    path.join(
                        repositoryRoot,
                        'internal-link'
                    );

                await fs.symlink(
                    internalDirectory,
                    linkPath,
                    process.platform === 'win32'
                        ? 'junction'
                        : 'dir'
                );

                const resolved =
                    await resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            'internal-link/inside.py'
                    });

                /*
                 * Il realpath verifica il confinement,
                 * ma non modifica l'identità logica
                 * richiesta dal chiamante.
                 */
                expect(
                    resolved.relativePath
                ).toBe(
                    'internal-link/inside.py'
                );

                expect(
                    resolved.absolutePath
                ).toBe(
                    path.resolve(
                        repositoryRoot,
                        'internal-link',
                        'inside.py'
                    )
                );
            }
        );

        it(
            'espone errori tipizzati RepositoryPathPolicyError',
            async () => {
                const repositoryRoot =
                    await createRepository();

                let capturedError:
                    unknown;

                try {
                    await resolveRepositoryPath({
                        repositoryRoot,

                        relativePath:
                            '../outside.py'
                    });
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                expect(
                    capturedError
                ).toBeInstanceOf(
                    RepositoryPathPolicyError
                );

                if (
                    !(capturedError instanceof
                        RepositoryPathPolicyError)
                ) {
                    throw new Error(
                        'Era atteso RepositoryPathPolicyError.'
                    );
                }

                expect(
                    capturedError.reason
                ).toBe(
                    'PATH_ESCAPE'
                );
            }
        );
    }
);
