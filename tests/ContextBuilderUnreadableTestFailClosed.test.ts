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
    ContextBuilder,
    type InitialContextParams
} from '../src/orchestration/ContextBuilder.js';

const temporaryDirectories:
    string[] = [];

const createRepository =
    async (): Promise<string> => {
        const repositoryRoot =
            await fs.mkdtemp(
                path.join(
                    os.tmpdir(),
                    'context-builder-fail-closed-'
                )
            );

        temporaryDirectories.push(
            repositoryRoot
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

        /*
         * Questo path esiste ed è confinato nel repository,
         * ma è una directory e non un file leggibile come
         * test/oracle.
         *
         * Serve per provocare deterministicamente una
         * failure di fs.readFile senza dipendere da chmod
         * o permessi specifici della piattaforma.
         */
        await fs.mkdir(
            path.join(
                repositoryRoot,
                'tests',
                'unreadable-test'
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
                '    return False',
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
                '    assert target() is True',
                ''
            ].join('\n'),
            'utf8'
        );

        return repositoryRoot;
    };

const createParams =
    (
        testFiles: readonly string[]
    ): InitialContextParams => ({
        issueSpec:
            'Correggere target affinché soddisfi il contratto.',

        targetFiles: [
            'src/target.py'
        ],

        testFiles,

        category:
            'REPAIR'
    });

describe(
    'BE-P0-27 - ContextBuilder fail closed on unreadable declared tests',
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
            'costruisce normalmente il payload quando il test dichiarato è leggibile',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await contextBuilder.buildInitialPayload(
                        createParams([
                            'tests/test_target.py'
                        ])
                    );

                expect(
                    payload
                ).toContain(
                    'TEST CONTRACT (read-only): tests/test_target.py'
                );

                expect(
                    payload
                ).toContain(
                    'def test_target():'
                );

                expect(
                    payload
                ).toContain(
                    'assert target() is True'
                );
            }
        );

        it(
            'fallisce se un test dichiarato non esiste',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                await expect(
                    contextBuilder.buildInitialPayload(
                        createParams([
                            'tests/missing_test.py'
                        ])
                    )
                ).rejects.toMatchObject({
                    name:
                        'RepositoryPathPolicyError',

                    reason:
                        'PATH_NOT_FOUND'
                });
            }
        );

        it(
            'propaga la failure quando il path dichiarato esiste ma non è leggibile come file',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                let producedPayload:
                    string | undefined;

                let capturedError:
                    unknown;

                try {
                    producedPayload =
                        await contextBuilder.buildInitialPayload(
                            createParams([
                                'tests/unreadable-test'
                            ])
                        );
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                /*
                 * Il requisito BE-P0-27 non dipende dalla
                 * specifica classe dell'errore filesystem.
                 *
                 * Deve semplicemente essere impossibile
                 * costruire un payload quando il test
                 * dichiarato non può essere letto.
                 */
                expect(
                    capturedError
                ).toBeDefined();

                expect(
                    producedPayload
                ).toBeUndefined();
            }
        );

        it(
            'fallisce l intero initial context se almeno uno dei test dichiarati non è disponibile',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                await expect(
                    contextBuilder.buildInitialPayload(
                        createParams([
                            'tests/test_target.py',
                            'tests/missing_test.py'
                        ])
                    )
                ).rejects.toMatchObject({
                    name:
                        'RepositoryPathPolicyError',

                    reason:
                        'PATH_NOT_FOUND'
                });
            }
        );

        it(
            'non degrada un test illeggibile nel precedente placeholder test contract',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                let producedPayload:
                    string | undefined;

                let capturedError:
                    unknown;

                try {
                    producedPayload =
                        await contextBuilder.buildInitialPayload(
                            createParams([
                                'tests/unreadable-test'
                            ])
                        );
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                /*
                 * Fail closed:
                 * deve esistere una failure.
                 */
                expect(
                    capturedError
                ).toBeDefined();

                /*
                 * Non deve esistere alcun payload utilizzabile.
                 */
                expect(
                    producedPayload
                ).toBeUndefined();

                /*
                 * La vecchia implementazione avrebbe
                 * trasformato la failure nel placeholder:
                 *
                 * "# Impossibile leggere il file di test: ..."
                 *
                 * BE-P0-27 vieta questa degradazione.
                 */
                expect(
                    producedPayload ?? ''
                ).not.toContain(
                    '# Impossibile leggere il file di test:'
                );
            }
        );

        it(
            'non produce un payload parziale quando un test valido precede un test illeggibile',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                let producedPayload:
                    string | undefined;

                let capturedError:
                    unknown;

                try {
                    producedPayload =
                        await contextBuilder.buildInitialPayload(
                            createParams([
                                'tests/test_target.py',
                                'tests/unreadable-test'
                            ])
                        );
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                /*
                 * Anche se il primo test era stato letto
                 * correttamente, il secondo rende invalido
                 * l'intero information contract.
                 */
                expect(
                    capturedError
                ).toBeDefined();

                expect(
                    producedPayload
                ).toBeUndefined();
            }
        );

        it(
            'non modifica il comportamento CREATE previsto per un target sorgente mancante',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const params:
                    InitialContextParams = {
                    issueSpec:
                        'Creare una nuova implementazione.',

                    targetFiles: [
                        'src/new_target.py'
                    ],

                    testFiles: [
                        'tests/test_target.py'
                    ],

                    category:
                        'CREATE'
                };

                const payload =
                    await contextBuilder.buildInitialPayload(
                        params
                    );

                /*
                 * Il target mancante in modalità CREATE
                 * rimane un caso esplicitamente supportato.
                 */
                expect(
                    payload
                ).toContain(
                    '[NEW FILE TO CREATE:'
                );

                /*
                 * Il test/oracle invece continua a essere
                 * obbligatorio e leggibile.
                 */
                expect(
                    payload
                ).toContain(
                    'TEST CONTRACT (read-only): tests/test_target.py'
                );

                expect(
                    payload
                ).toContain(
                    'def test_target():'
                );

                expect(
                    payload
                ).toContain(
                    'assert target() is True'
                );
            }
        );
    }
);
