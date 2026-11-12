import {
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import {
    CoderAgent,
    CoderModelInvocationError,
    CoderOutputExtractionError
} from '../src/agents/CoderAgent.js';

import type {
    OpenAICompatibleClient
} from '../src/inference/OpenAICompatibleClient.js';

const createClient =
    (
        completeChat:
            (...args: readonly unknown[]) =>
                Promise<string>
    ): OpenAICompatibleClient =>
        ({
            completeChat
        }) as unknown as OpenAICompatibleClient;

describe(
    'BE-P1-01 - CoderAgent typed errors',
    () => {
        it(
            'restituisce una patch valida quando il modello produce un Unified Diff corretto',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> =>
                            [
                                '```diff',
                                '--- a/src/target.py',
                                '+++ b/src/target.py',
                                '@@ -1,2 +1,2 @@',
                                ' def target():',
                                '-    return False',
                                '+    return True',
                                '```'
                            ].join('\n')
                    );

                const coder =
                    new CoderAgent(
                        createClient(
                            completeChat
                        )
                    );

                const patch =
                    await coder.generatePatch(
                        'Correggere target.',
                        [
                            'src/target.py'
                        ],
                        [
                            'tests/test_target.py'
                        ],
                        'REPAIR'
                    );

                expect(
                    completeChat
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    patch
                ).toContain(
                    '--- a/src/target.py'
                );

                expect(
                    patch
                ).toContain(
                    '+++ b/src/target.py'
                );

                expect(
                    patch
                ).toContain(
                    '+    return True'
                );
            }
        );

        it(
            'tipizza una failure del provider come CoderModelInvocationError indipendentemente dal messaggio',
            async () => {
                const providerError =
                    new Error(
                        'invalid diff and protected test file'
                    );

                const completeChat =
                    jest.fn(
                        async (): Promise<string> => {
                            throw providerError;
                        }
                    );

                const coder =
                    new CoderAgent(
                        createClient(
                            completeChat
                        )
                    );

                let capturedError:
                    unknown;

                try {
                    await coder.generatePatch(
                        'Correggere target.',
                        [
                            'src/target.py'
                        ],
                        [
                            'tests/test_target.py'
                        ],
                        'REPAIR'
                    );
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                expect(
                    capturedError
                ).toBeInstanceOf(
                    CoderModelInvocationError
                );

                expect(
                    capturedError
                ).toMatchObject({
                    name:
                        'CoderModelInvocationError',

                    message:
                        'invalid diff and protected test file',

                    originalError:
                        providerError
                });
            }
        );

        it(
            'preserva un CoderModelInvocationError già tipizzato',
            async () => {
                const typedError =
                    new CoderModelInvocationError(
                        'provider failure already typed'
                    );

                const completeChat =
                    jest.fn(
                        async (): Promise<string> => {
                            throw typedError;
                        }
                    );

                const coder =
                    new CoderAgent(
                        createClient(
                            completeChat
                        )
                    );

                await expect(
                    coder.generatePatch(
                        'Correggere target.',
                        [
                            'src/target.py'
                        ],
                        [],
                        'REPAIR'
                    )
                ).rejects.toBe(
                    typedError
                );
            }
        );

        it(
            'tipizza una risposta vuota come CoderOutputExtractionError',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> =>
                            '   '
                    );

                const coder =
                    new CoderAgent(
                        createClient(
                            completeChat
                        )
                    );

                let capturedError:
                    unknown;

                try {
                    await coder.generatePatch(
                        'Correggere target.',
                        [
                            'src/target.py'
                        ],
                        [],
                        'REPAIR'
                    );
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                expect(
                    capturedError
                ).toBeInstanceOf(
                    CoderOutputExtractionError
                );

                expect(
                    capturedError
                ).toMatchObject({
                    name:
                        'CoderOutputExtractionError',

                    message:
                        'Il modello ha restituito una risposta vuota (0 token utili).'
                });
            }
        );

        it(
            'tipizza un output non Unified Diff come CoderOutputExtractionError',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> =>
                            'Generic output problem without classification keywords.'
                    );

                const coder =
                    new CoderAgent(
                        createClient(
                            completeChat
                        )
                    );

                let capturedError:
                    unknown;

                try {
                    await coder.generatePatch(
                        'Correggere target.',
                        [
                            'src/target.py'
                        ],
                        [],
                        'REPAIR'
                    );
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                expect(
                    capturedError
                ).toBeInstanceOf(
                    CoderOutputExtractionError
                );

                expect(
                    capturedError
                ).toMatchObject({
                    name:
                        'CoderOutputExtractionError',

                    message:
                        'La risposta generata non contiene un blocco Unified Diff valido.'
                });
            }
        );

        it(
            'tipizza la modifica di un test tramite header Unified Diff come extraction failure',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> =>
                            [
                                '```diff',
                                '--- a/tests/test_target.py',
                                '+++ b/tests/test_target.py',
                                '@@ -1 +1 @@',
                                '-assert False',
                                '+assert True',
                                '```'
                            ].join('\n')
                    );

                const coder =
                    new CoderAgent(
                        createClient(
                            completeChat
                        )
                    );

                let capturedError:
                    unknown;

                try {
                    await coder.generatePatch(
                        'Correggere target.',
                        [
                            'src/target.py'
                        ],
                        [
                            'tests/test_target.py'
                        ],
                        'REPAIR'
                    );
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                expect(
                    capturedError
                ).toBeInstanceOf(
                    CoderOutputExtractionError
                );

                expect(
                    capturedError
                ).toMatchObject({
                    name:
                        'CoderOutputExtractionError'
                });

                expect(
                    capturedError instanceof Error
                        ? capturedError.message
                        : ''
                ).toContain(
                    'tests/test_target.py'
                );
            }
        );

        it(
            'tipizza la modifica di un test tramite header diff --git come extraction failure',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> =>
                            [
                                '```diff',
                                'diff --git a/tests/test_target.py b/tests/test_target.py',
                                '--- a/tests/test_target.py',
                                '+++ b/tests/test_target.py',
                                '@@ -1 +1 @@',
                                '-assert False',
                                '+assert True',
                                '```'
                            ].join('\n')
                    );

                const coder =
                    new CoderAgent(
                        createClient(
                            completeChat
                        )
                    );

                let capturedError:
                    unknown;

                try {
                    await coder.generatePatch(
                        'Correggere target.',
                        [
                            'src/target.py'
                        ],
                        [
                            'tests/test_target.py'
                        ],
                        'REPAIR'
                    );
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                expect(
                    capturedError
                ).toBeInstanceOf(
                    CoderOutputExtractionError
                );

                expect(
                    capturedError instanceof Error
                        ? capturedError.message
                        : ''
                ).toContain(
                    'test/oracolo protetto'
                );
            }
        );

        it(
            'usa una causa non vuota anche quando il provider lancia un valore senza messaggio utile',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> => {
                            throw '';
                        }
                    );

                const coder =
                    new CoderAgent(
                        createClient(
                            completeChat
                        )
                    );

                let capturedError:
                    unknown;

                try {
                    await coder.generatePatch(
                        'Correggere target.',
                        [
                            'src/target.py'
                        ],
                        [],
                        'REPAIR'
                    );
                } catch (error: unknown) {
                    capturedError =
                        error;
                }

                expect(
                    capturedError
                ).toBeInstanceOf(
                    CoderModelInvocationError
                );

                expect(
                    capturedError
                ).toMatchObject({
                    message:
                        'Invocazione del modello Coder fallita senza dettagli.'
                });
            }
        );
    }
);
