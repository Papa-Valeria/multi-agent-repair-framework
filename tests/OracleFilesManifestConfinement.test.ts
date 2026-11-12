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
    resolveRepositoryPath
} from '../src/security/RepositoryPathPolicy.js';

const temporaryDirectories:
    string[] = [];

const createRepository =
    async (): Promise<string> => {
        const repositoryRoot =
            await fs.mkdtemp(
                path.join(
                    os.tmpdir(),
                    'oracle-manifest-confinement-'
                )
            );

        temporaryDirectories.push(
            repositoryRoot
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

        await fs.mkdir(
            path.join(
                repositoryRoot,
                'backend',
                'tests'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.mkdir(
            path.join(
                repositoryRoot,
                'private'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'tests',
                'test_target.py'
            ),
            'def test_target(): assert True\n',
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'tests',
                'alternate_test.py'
            ),
            'def test_alternate(): assert True\n',
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'backend',
                'tests',
                'test_target.py'
            ),
            'def test_backend_target(): assert True\n',
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'private',
                'hidden_oracle.py'
            ),
            'def test_hidden(): assert True\n',
            'utf8'
        );

        return repositoryRoot;
    };

/*
 * Riproduce la regola BE-P0-22 applicata
 * dal boundary di app.ts.
 *
 * Contratto:
 *
 * 1. testFiles viene normalizzato e confinato;
 * 2. cwd viene risolto nel repository;
 * 3. oracleFile viene interpretato rispetto al cwd;
 * 4. il file realmente raggiunto viene confinato;
 * 5. il file deve appartenere al manifest testFiles;
 * 6. TestHarness riceve nuovamente un path
 *    relativo al cwd configurato.
 */
const resolveAuthorizedOracleFiles =
    async (
        repositoryRoot: string,
        testFiles: readonly string[],
        configuredCwd: string,
        oracleFiles: readonly string[]
    ): Promise<readonly string[]> => {
        const normalizedTestFiles =
            await Promise.all(
                testFiles.map(
                    async (file) => {
                        const resolved =
                            await resolveRepositoryPath({
                                repositoryRoot,

                                relativePath:
                                    file
                            });

                        return resolved.relativePath;
                    }
                )
            );

        const resolvedCwd =
            await resolveRepositoryPath({
                repositoryRoot,

                relativePath:
                    configuredCwd,

                allowRepositoryRoot:
                    true
            });

        const functionalTestExecutionCwd =
            resolvedCwd.absolutePath;

        const authorizedTestFiles =
            new Set<string>(
                normalizedTestFiles
            );

        return Promise.all(
            oracleFiles.map(
                async (oracleFile) => {
                    /*
                     * oracleFile viene interpretato dal
                     * TestHarness relativamente a config.cwd.
                     */
                    const cwdRelativePath =
                        resolvedCwd.relativePath === '.'
                            ? ''
                            : resolvedCwd.relativePath;

                    const normalizedOracleInput =
                        oracleFile.replaceAll(
                            '\\',
                            '/'
                        );

                    /*
                     * Ricostruiamo il path repository-relative
                     * del file che il runner raggiungerà.
                     */
                    const repositoryRelativeOraclePath =
                        path.posix.join(
                            cwdRelativePath,
                            normalizedOracleInput
                        );

                    /*
                     * RepositoryPathPolicy garantisce:
                     *
                     * - path relativo;
                     * - normalizzazione;
                     * - no escape dal repository;
                     * - no .git;
                     * - esistenza;
                     * - real containment.
                     */
                    const resolvedOracle =
                        await resolveRepositoryPath({
                            repositoryRoot,

                            relativePath:
                                repositoryRelativeOraclePath
                        });

                    /*
                     * BE-P0-22:
                     *
                     * essere fisicamente confinato nel
                     * repository non è sufficiente.
                     *
                     * L'oracle deve essere dichiarato
                     * esplicitamente nel manifest testFiles.
                     */
                    if (
                        !authorizedTestFiles.has(
                            resolvedOracle.relativePath
                        )
                    ) {
                        throw new Error(
                            `Oracle file non autorizzato dal task manifest: ` +
                            `${resolvedOracle.relativePath}`
                        );
                    }

                    /*
                     * TestHarness deve ricevere il path
                     * nella forma relativa al cwd.
                     */
                    const cwdRelativeOraclePath =
                        path
                            .relative(
                                functionalTestExecutionCwd,
                                resolvedOracle.absolutePath
                            )
                            .replaceAll(
                                '\\',
                                '/'
                            );

                    /*
                     * Fail-closed:
                     *
                     * il path consegnato al runner non
                     * deve essere vuoto né risalire sopra
                     * il cwd configurato.
                     */
                    if (
                        cwdRelativeOraclePath.length === 0 ||
                        cwdRelativeOraclePath === '..' ||
                        cwdRelativeOraclePath.startsWith('../')
                    ) {
                        throw new Error(
                            `Oracle file non eseguibile dal cwd configurato: ` +
                            `${resolvedOracle.relativePath}`
                        );
                    }

                    return cwdRelativeOraclePath;
                }
            )
        );
    };

describe(
    'BE-P0-22 - Oracle files manifest confinement',
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
            'accetta un oracle confinato e dichiarato nei testFiles del task',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const oracleFiles =
                    await resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            'tests/test_target.py'
                        ],
                        '.',
                        [
                            'tests/test_target.py'
                        ]
                    );

                expect(
                    oracleFiles
                ).toEqual([
                    'tests/test_target.py'
                ]);
            }
        );

        it(
            'normalizza il manifest prima del confronto di autorizzazione',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const oracleFiles =
                    await resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            './tests/../tests/test_target.py'
                        ],
                        '.',
                        [
                            'tests\\test_target.py'
                        ]
                    );

                expect(
                    oracleFiles
                ).toEqual([
                    'tests/test_target.py'
                ]);
            }
        );

        it(
            'rifiuta un oracle interno al repository ma non dichiarato nei testFiles',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            'tests/test_target.py'
                        ],
                        '.',
                        [
                            'tests/alternate_test.py'
                        ]
                    )
                ).rejects.toThrow(
                    'Oracle file non autorizzato dal task manifest: tests/alternate_test.py'
                );
            }
        );

        it(
            'rifiuta un oracle interno in una directory privata ma assente dal manifest',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            'tests/test_target.py'
                        ],
                        '.',
                        [
                            'private/hidden_oracle.py'
                        ]
                    )
                ).rejects.toThrow(
                    'Oracle file non autorizzato dal task manifest: private/hidden_oracle.py'
                );
            }
        );

        it(
            'accetta un oracle cwd-relative quando il file repository-relative appartiene al manifest',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const oracleFiles =
                    await resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            'backend/tests/test_target.py'
                        ],
                        'backend',
                        [
                            'tests/test_target.py'
                        ]
                    );

                expect(
                    oracleFiles
                ).toEqual([
                    'tests/test_target.py'
                ]);
            }
        );

        it(
            'rifiuta un oracle cwd-relative che risolve a un file non autorizzato',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            'tests/test_target.py'
                        ],
                        'backend',
                        [
                            'tests/test_target.py'
                        ]
                    )
                ).rejects.toThrow(
                    'Oracle file non autorizzato dal task manifest: backend/tests/test_target.py'
                );
            }
        );

        it(
            'rifiuta un oracle che tenta di uscire dal repository',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            'backend/tests/test_target.py'
                        ],
                        'backend',
                        [
                            '../../outside.py'
                        ]
                    )
                ).rejects.toMatchObject({
                    name:
                        'RepositoryPathPolicyError',

                    reason:
                        'PATH_ESCAPE'
                });
            }
        );

        it(
            'rifiuta oracle sotto .git',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            'tests/test_target.py'
                        ],
                        '.',
                        [
                            '.git/hooks/test_oracle.py'
                        ]
                    )
                ).rejects.toMatchObject({
                    name:
                        'RepositoryPathPolicyError',

                    reason:
                        'GIT_PATH'
                });
            }
        );

        it(
            'rifiuta l intera configurazione quando almeno un oracle non appartiene al manifest',
            async () => {
                const repositoryRoot =
                    await createRepository();

                await expect(
                    resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            'tests/test_target.py'
                        ],
                        '.',
                        [
                            'tests/test_target.py',
                            'tests/alternate_test.py'
                        ]
                    )
                ).rejects.toThrow(
                    'Oracle file non autorizzato dal task manifest: tests/alternate_test.py'
                );
            }
        );

        it(
            'rifiuta un oracle raggiunto tramite symlink che esce dal repository',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const outsideDirectory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'oracle-manifest-outside-'
                        )
                    );

                temporaryDirectories.push(
                    outsideDirectory
                );

                await fs.writeFile(
                    path.join(
                        outsideDirectory,
                        'external_test.py'
                    ),
                    'def test_external(): assert True\n',
                    'utf8'
                );

                await fs.symlink(
                    outsideDirectory,
                    path.join(
                        repositoryRoot,
                        'external-tests'
                    ),
                    process.platform === 'win32'
                        ? 'junction'
                        : 'dir'
                );

                /*
                 * Il manifest non può autorizzare
                 * un file che viola il real containment.
                 */
                await expect(
                    resolveAuthorizedOracleFiles(
                        repositoryRoot,
                        [
                            'external-tests/external_test.py'
                        ],
                        '.',
                        [
                            'external-tests/external_test.py'
                        ]
                    )
                ).rejects.toMatchObject({
                    name:
                        'RepositoryPathPolicyError',

                    reason:
                        'REAL_PATH_ESCAPE'
                });
            }
        );
    }
);
