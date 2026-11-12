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
                    'context-builder-test-informed-'
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

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'src',
                'calculator.py'
            ),
            [
                'def add(left, right):',
                '    return left - right',
                ''
            ].join('\n'),
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'tests',
                'test_calculator.py'
            ),
            [
                'SECRET_TEST_IMPLEMENTATION_MARKER = "must-not-be-exposed"',
                '',
                'def helper_expected_value():',
                '    return 5',
                '',
                'def test_addition_contract():',
                '    expected = helper_expected_value()',
                '    result = add(2, 3)',
                '    assert result == expected',
                '',
                'def unrelated_setup_helper():',
                '    hidden_value = 123456',
                '    return hidden_value',
                ''
            ].join('\n'),
            'utf8'
        );

        return repositoryRoot;
    };

const createParams =
    (): InitialContextParams => ({
        issueSpec:
            'Correggere la funzione add affinché sommi i due operandi.',

        targetFiles: [
            'src/calculator.py'
        ],

        testFiles: [
            'tests/test_calculator.py'
        ],

        category:
            'REPAIR'
    });

describe(
    'BE-P0-26 - ContextBuilder test-informed contract',
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
            'mantiene invariato il prompt profile id esistente',
            () => {
                expect(
                    ContextBuilder.PROMPT_PROFILE_ID
                ).toBe(
                    'context-builder-v1'
                );
            }
        );

        it(
            'espone nel payload iniziale la firma del test e la relativa assertion',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await contextBuilder.buildInitialPayload(
                        createParams()
                    );

                expect(
                    payload
                ).toContain(
                    'TEST CONTRACT (read-only): tests/test_calculator.py'
                );

                expect(
                    payload
                ).toContain(
                    'def test_addition_contract():'
                );

                expect(
                    payload
                ).toContain(
                    '    assert result == expected'
                );
            }
        );

        it(
            'non tratta i test come hidden oracle perché include informazioni derivate dai test',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await contextBuilder.buildInitialPayload(
                        createParams()
                    );

                /*
                 * La presenza di firma e assertion dimostra
                 * che il Coder dispone di informazioni
                 * provenienti dai test.
                 */
                expect(
                    payload
                ).toContain(
                    'def test_addition_contract():'
                );

                expect(
                    payload
                ).toContain(
                    'assert result == expected'
                );
            }
        );

        it(
            'non espone indiscriminatamente l intero sorgente del test',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await contextBuilder.buildInitialPayload(
                        createParams()
                    );

                expect(
                    payload
                ).not.toContain(
                    'SECRET_TEST_IMPLEMENTATION_MARKER'
                );

                expect(
                    payload
                ).not.toContain(
                    'must-not-be-exposed'
                );

                expect(
                    payload
                ).not.toContain(
                    'def helper_expected_value():'
                );

                expect(
                    payload
                ).not.toContain(
                    'return 5'
                );

                expect(
                    payload
                ).not.toContain(
                    'result = add(2, 3)'
                );

                expect(
                    payload
                ).not.toContain(
                    'def unrelated_setup_helper():'
                );

                expect(
                    payload
                ).not.toContain(
                    'hidden_value = 123456'
                );
            }
        );

        it(
            'include il target completo ma soltanto il contratto estratto del test',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const payload =
                    await contextBuilder.buildInitialPayload(
                        createParams()
                    );

                expect(
                    payload
                ).toContain(
                    'TARGET FILE: src/calculator.py'
                );

                expect(
                    payload
                ).toContain(
                    'def add(left, right):'
                );

                expect(
                    payload
                ).toContain(
                    '    return left - right'
                );

                expect(
                    payload
                ).toContain(
                    'TEST CONTRACT (read-only): tests/test_calculator.py'
                );

                expect(
                    payload
                ).not.toContain(
                    'SECRET_TEST_IMPLEMENTATION_MARKER'
                );
            }
        );

        it(
            'produce deterministicamente lo stesso initial payload a parità di fixture e parametri',
            async () => {
                const repositoryRoot =
                    await createRepository();

                const firstBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const secondBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const params =
                    createParams();

                const firstPayload =
                    await firstBuilder.buildInitialPayload(
                        params
                    );

                const secondPayload =
                    await secondBuilder.buildInitialPayload(
                        params
                    );

                expect(
                    secondPayload
                ).toBe(
                    firstPayload
                );
            }
        );
    }
);
