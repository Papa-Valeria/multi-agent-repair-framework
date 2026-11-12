import {
    CoderAgent,
    CoderOutputExtractionError
} from '../src/agents/CoderAgent.js';
import type {
    OpenAICompatibleClient
} from '../src/inference/OpenAICompatibleClient.js';

const TARGET_FILE =
    'src/example.ts';

const TEST_FILE =
    'tests/example.test.ts';

const VALID_DIFF = [
    'diff --git a/src/example.ts b/src/example.ts',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;'
].join('\n');

const SECOND_VALID_DIFF = [
    'diff --git a/src/example.ts b/src/example.ts',
    '--- a/src/example.ts',
    '+++ b/src/example.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 3;'
].join('\n');

const TEST_FILE_DIFF = [
    'diff --git a/tests/example.test.ts b/tests/example.test.ts',
    '--- a/tests/example.test.ts',
    '+++ b/tests/example.test.ts',
    '@@ -1 +1 @@',
    '-expect(value).toBe(1);',
    '+expect(value).toBe(2);'
].join('\n');

const HUNK_ONLY_DIFF = [
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;'
].join('\n');

const createCoderAgent = (): CoderAgent => {
    const unusedClient =
        {} as OpenAICompatibleClient;

    return new CoderAgent(
        unusedClient
    );
};

describe(
    'BE-P1-28 - CoderAgent deterministic Unified Diff extraction',
    () => {
        it(
            'seleziona l’unico fence diff anche quando è preceduto da testo e da un fence non-diff',
            () => {
                const rawResponse = [
                    'I inspected the source first.',
                    '',
                    '```typescript',
                    'export const explanation = true;',
                    '```',
                    '',
                    'The actual patch follows.',
                    '',
                    '```diff',
                    VALID_DIFF,
                    '```'
                ].join('\n');

                const coder =
                    createCoderAgent();

                const extracted =
                    coder.extractDiff(
                        rawResponse,
                        [TARGET_FILE],
                        [TEST_FILE],
                        'REPAIR'
                    );

                expect(extracted).toBe(
                    VALID_DIFF
                );

                expect(extracted).not.toContain(
                    'export const explanation = true;'
                );
            }
        );

        it(
            'accetta un unico fence generico con struttura Unified Diff riconoscibile',
            () => {
                const rawResponse = [
                    '```',
                    VALID_DIFF,
                    '```'
                ].join('\n');

                const coder =
                    createCoderAgent();

                const extracted =
                    coder.extractDiff(
                        rawResponse,
                        [TARGET_FILE],
                        [TEST_FILE],
                        'REPAIR'
                    );

                expect(extracted).toBe(
                    VALID_DIFF
                );
            }
        );

        it(
            'ignora un fence generico non-diff quando esiste un solo candidato riconoscibile',
            () => {
                const rawResponse = [
                    '```typescript',
                    'export const value = 2;',
                    '```',
                    '',
                    '```',
                    VALID_DIFF,
                    '```'
                ].join('\n');

                const coder =
                    createCoderAgent();

                const extracted =
                    coder.extractDiff(
                        rawResponse,
                        [TARGET_FILE],
                        [TEST_FILE],
                        'REPAIR'
                    );

                expect(extracted).toBe(
                    VALID_DIFF
                );
            }
        );

        it(
            'accetta un Unified Diff riconoscibile non racchiuso in code fence',
            () => {
                const coder =
                    createCoderAgent();

                const extracted =
                    coder.extractDiff(
                        VALID_DIFF,
                        [TARGET_FILE],
                        [TEST_FILE],
                        'REPAIR'
                    );

                expect(extracted).toBe(
                    VALID_DIFF
                );
            }
        );

        it(
            'accetta in REPAIR un unico hunk senza file header e lo associa al solo target',
            () => {
                const rawResponse = [
                    '```diff',
                    HUNK_ONLY_DIFF,
                    '```'
                ].join('\n');

                const coder =
                    createCoderAgent();

                const extracted =
                    coder.extractDiff(
                        rawResponse,
                        [TARGET_FILE],
                        [TEST_FILE],
                        'REPAIR'
                    );

                expect(extracted).toBe(
                    [
                        '--- a/src/example.ts',
                        '+++ b/src/example.ts',
                        HUNK_ONLY_DIFF
                    ].join('\n')
                );
            }
        );

        it(
            'rifiuta una risposta vuota',
            () => {
                const coder =
                    createCoderAgent();

                expect(
                    () =>
                        coder.extractDiff(
                            '   \n   ',
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    CoderOutputExtractionError
                );

                expect(
                    () =>
                        coder.extractDiff(
                            '   \n   ',
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    'risposta vuota'
                );
            }
        );

        it(
            'rifiuta una risposta senza alcun candidato Unified Diff',
            () => {
                const rawResponse = [
                    'Here is the corrected code:',
                    '',
                    '```typescript',
                    'export const value = 2;',
                    '```'
                ].join('\n');

                const coder =
                    createCoderAgent();

                expect(
                    () =>
                        coder.extractDiff(
                            rawResponse,
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    CoderOutputExtractionError
                );

                expect(
                    () =>
                        coder.extractDiff(
                            rawResponse,
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    'non contiene un candidato Unified Diff riconoscibile'
                );
            }
        );

        it(
            'rifiuta deterministicamente più fence marcati diff',
            () => {
                const rawResponse = [
                    '```diff',
                    VALID_DIFF,
                    '```',
                    '',
                    '```diff',
                    SECOND_VALID_DIFF,
                    '```'
                ].join('\n');

                const coder =
                    createCoderAgent();

                expect(
                    () =>
                        coder.extractDiff(
                            rawResponse,
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    CoderOutputExtractionError
                );

                expect(
                    () =>
                        coder.extractDiff(
                            rawResponse,
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    'più blocchi contrassegnati come diff'
                );
            }
        );

        it(
            'rifiuta deterministicamente più fence generici con struttura Unified Diff riconoscibile',
            () => {
                const rawResponse = [
                    '```',
                    VALID_DIFF,
                    '```',
                    '',
                    '```text',
                    SECOND_VALID_DIFF,
                    '```'
                ].join('\n');

                const coder =
                    createCoderAgent();

                expect(
                    () =>
                        coder.extractDiff(
                            rawResponse,
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    CoderOutputExtractionError
                );

                expect(
                    () =>
                        coder.extractDiff(
                            rawResponse,
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    'selezione della patch è ambigua'
                );
            }
        );

        it(
            'mantiene la priorità del fence diff rispetto a un fence generico che contiene un altro diff',
            () => {
                const rawResponse = [
                    '```text',
                    SECOND_VALID_DIFF,
                    '```',
                    '',
                    '```diff',
                    VALID_DIFF,
                    '```'
                ].join('\n');

                const coder =
                    createCoderAgent();

                const extracted =
                    coder.extractDiff(
                        rawResponse,
                        [TARGET_FILE],
                        [TEST_FILE],
                        'REPAIR'
                    );

                expect(extracted).toBe(
                    VALID_DIFF
                );

                expect(extracted).not.toContain(
                    '+export const value = 3;'
                );
            }
        );

        it(
            'mantiene attiva la protezione dei file di test nel fence diff selezionato',
            () => {
                const rawResponse = [
                    '```typescript',
                    'const explanation = true;',
                    '```',
                    '',
                    '```diff',
                    TEST_FILE_DIFF,
                    '```'
                ].join('\n');

                const coder =
                    createCoderAgent();

                expect(
                    () =>
                        coder.extractDiff(
                            rawResponse,
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    CoderOutputExtractionError
                );

                expect(
                    () =>
                        coder.extractDiff(
                            rawResponse,
                            [TARGET_FILE],
                            [TEST_FILE],
                            'REPAIR'
                        )
                ).toThrow(
                    'file di test/oracolo protetto'
                );
            }
        );

        it(
            'normalizza CRLF nel candidato estratto',
            () => {
                const rawResponse = [
                    '```diff',
                    VALID_DIFF,
                    '```'
                ]
                    .join('\r\n');

                const coder =
                    createCoderAgent();

                const extracted =
                    coder.extractDiff(
                        rawResponse,
                        [TARGET_FILE],
                        [TEST_FILE],
                        'REPAIR'
                    );

                expect(extracted).toBe(
                    VALID_DIFF
                );

                expect(extracted).not.toContain(
                    '\r\n'
                );
            }
        );
    }
);
