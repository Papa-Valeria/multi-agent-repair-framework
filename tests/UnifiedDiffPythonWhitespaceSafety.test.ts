import {
    describe,
    expect,
    it
} from '@jest/globals';

import {
    applyHunksToContent,
    type ParsedHunk
} from '../src/git/UnifiedDiff.js';

const lf =
    (
        lines: readonly string[]
    ): string =>
        [
            ...lines,
            ''
        ].join('\n');

describe(
    'BE-P0-30 - UnifiedDiff Python whitespace safety',
    () => {
        describe(
            'replacement',
            () => {
                it(
                    'applica un replacement al blocco Python univoco preservando lo scope corretto',
                    () => {
                        const source =
                            lf([
                                'def first():',
                                '    value = 1',
                                '    return value',
                                '',
                                'def second():',
                                '    value = 2',
                                '    return value'
                            ]);

                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        5,

                                    newStart:
                                        5,

                                    lines: [
                                        {
                                            kind:
                                                ' ',

                                            text:
                                                'def second():'
                                        },

                                        {
                                            kind:
                                                '-',

                                            text:
                                                '    value = 2'
                                        },

                                        {
                                            kind:
                                                '+',

                                            text:
                                                '    value = 3'
                                        },

                                        {
                                            kind:
                                                ' ',

                                            text:
                                                '    return value'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBe(
                            lf([
                                'def first():',
                                '    value = 1',
                                '    return value',
                                '',
                                'def second():',
                                '    value = 3',
                                '    return value'
                            ])
                        );
                    }
                );

                it(
                    'non deve applicare arbitrariamente un replacement quando blocchi Python distinti coincidono soltanto dopo whitespace normalization',
                    () => {
                        const source =
                            lf([
                                'def outer():',
                                '    value = 1',
                                '    return value',
                                '',
                                'def container():',
                                '    def inner():',
                                '        value = 1',
                                '        return value',
                                '    return inner()'
                            ]);

                        /*
                         * Dopo normalize():
                         *
                         * "    value = 1"
                         * "        value = 1"
                         *
                         * diventano entrambe:
                         *
                         * "value = 1"
                         *
                         * Lo stesso vale per "return value".
                         *
                         * Il matcher non deve usare soltanto
                         * l'hint per scegliere arbitrariamente
                         * uno scope Python semanticamente diverso.
                         */
                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        2,

                                    newStart:
                                        2,

                                    lines: [
                                        {
                                            kind:
                                                '-',

                                            text:
                                                'value = 1'
                                        },

                                        {
                                            kind:
                                                '+',

                                            text:
                                                'value = 2'
                                        },

                                        {
                                            kind:
                                                ' ',

                                            text:
                                                'return value'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBeNull();
                    }
                );

                it(
                    'non applica un replacement al nested scope sbagliato quando il contenuto normalizzato è duplicato',
                    () => {
                        const source =
                            lf([
                                'def first():',
                                '    if enabled:',
                                '        result = compute()',
                                '        return result',
                                '',
                                'def second():',
                                '    if fallback:',
                                '        result = compute()',
                                '        return result'
                            ]);

                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        3,

                                    newStart:
                                        3,

                                    lines: [
                                        {
                                            kind:
                                                '-',

                                            text:
                                                'result = compute()'
                                        },

                                        {
                                            kind:
                                                '+',

                                            text:
                                                'result = safe_compute()'
                                        },

                                        {
                                            kind:
                                                ' ',

                                            text:
                                                'return result'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBeNull();
                    }
                );
            }
        );

        describe(
            'deletion',
            () => {
                it(
                    'applica una deletion quando il contesto identifica univocamente lo scope Python',
                    () => {
                        const source =
                            lf([
                                'def first():',
                                '    obsolete = True',
                                '    return 1',
                                '',
                                'def second():',
                                '    obsolete = True',
                                '    return 2'
                            ]);

                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        5,

                                    newStart:
                                        5,

                                    lines: [
                                        {
                                            kind:
                                                ' ',

                                            text:
                                                'def second():'
                                        },

                                        {
                                            kind:
                                                '-',

                                            text:
                                                '    obsolete = True'
                                        },

                                        {
                                            kind:
                                                ' ',

                                            text:
                                                '    return 2'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBe(
                            lf([
                                'def first():',
                                '    obsolete = True',
                                '    return 1',
                                '',
                                'def second():',
                                '    return 2'
                            ])
                        );
                    }
                );

                it(
                    'non elimina arbitrariamente una riga da uno di due scope Python equivalenti dopo normalization',
                    () => {
                        const source =
                            lf([
                                'def first():',
                                '    if condition_a:',
                                '        obsolete = True',
                                '        return 1',
                                '',
                                'def second():',
                                '    if condition_b:',
                                '        obsolete = True',
                                '        return 2'
                            ]);

                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        3,

                                    newStart:
                                        3,

                                    lines: [
                                        {
                                            kind:
                                                '-',

                                            text:
                                                'obsolete = True'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBeNull();
                    }
                );
            }
        );

        describe(
            'insertion',
            () => {
                it(
                    'inserisce nel punto corretto quando il context anchor Python è univoco',
                    () => {
                        const source =
                            lf([
                                'def first():',
                                '    return 1',
                                '',
                                'def second():',
                                '    value = 2',
                                '    return value'
                            ]);

                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        5,

                                    newStart:
                                        5,

                                    lines: [
                                        {
                                            kind:
                                                ' ',

                                            text:
                                                '    value = 2'
                                        },

                                        {
                                            kind:
                                                '+',

                                            text:
                                                '    validate(value)'
                                        },

                                        {
                                            kind:
                                                ' ',

                                            text:
                                                '    return value'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBe(
                            lf([
                                'def first():',
                                '    return 1',
                                '',
                                'def second():',
                                '    value = 2',
                                '    validate(value)',
                                '    return value'
                            ])
                        );
                    }
                );

                it(
                    'non inserisce arbitrariamente quando l anchor compare in scope Python diversi soltanto distinti dall indentazione',
                    () => {
                        const source =
                            lf([
                                'def first():',
                                '    prepare()',
                                '    execute()',
                                '',
                                'def second():',
                                '    if enabled:',
                                '        prepare()',
                                '        execute()'
                            ]);

                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        2,

                                    newStart:
                                        2,

                                    lines: [
                                        {
                                            kind:
                                                ' ',

                                            text:
                                                'prepare()'
                                        },

                                        {
                                            kind:
                                                '+',

                                            text:
                                                'validate()'
                                        },

                                        {
                                            kind:
                                                ' ',

                                            text:
                                                'execute()'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBeNull();
                    }
                );
            }
        );

        describe(
            'duplicate blocks and hints',
            () => {
                it(
                    'non considera l hunk line hint sufficiente a risolvere un match semanticamente ambiguo',
                    () => {
                        const source =
                            lf([
                                'def first():',
                                '    value = compute()',
                                '    return value',
                                '',
                                '',
                                '',
                                '',
                                '',
                                '',
                                'def second():',
                                '    value = compute()',
                                '    return value'
                            ]);

                        /*
                         * L'hint punta chiaramente al secondo blocco.
                         *
                         * Il requisito di sicurezza BE-P0-30
                         * stabilisce però che l'hint non deve
                         * trasformare da solo un match ambiguo
                         * in una modifica sicura quando il vecchio
                         * contenuto normalizzato è duplicato.
                         */
                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        11,

                                    newStart:
                                        11,

                                    lines: [
                                        {
                                            kind:
                                                '-',

                                            text:
                                                'value = compute()'
                                        },

                                        {
                                            kind:
                                                '+',

                                            text:
                                                'value = safe_compute()'
                                        },

                                        {
                                            kind:
                                                ' ',

                                            text:
                                                'return value'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBeNull();
                    }
                );

                it(
                    'applica il replacement quando il contesto circostante rende univoco uno dei blocchi duplicati',
                    () => {
                        const source =
                            lf([
                                'def first():',
                                '    value = compute()',
                                '    return value',
                                '',
                                'def second():',
                                '    value = compute()',
                                '    audit(value)',
                                '    return value'
                            ]);

                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        6,

                                    newStart:
                                        6,

                                    lines: [
                                        {
                                            kind:
                                                ' ',

                                            text:
                                                'def second():'
                                        },

                                        {
                                            kind:
                                                '-',

                                            text:
                                                '    value = compute()'
                                        },

                                        {
                                            kind:
                                                '+',

                                            text:
                                                '    value = safe_compute()'
                                        },

                                        {
                                            kind:
                                                ' ',

                                            text:
                                                '    audit(value)'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBe(
                            lf([
                                'def first():',
                                '    value = compute()',
                                '    return value',
                                '',
                                'def second():',
                                '    value = safe_compute()',
                                '    audit(value)',
                                '    return value'
                            ])
                        );
                    }
                );
            }
        );

        describe(
            'whitespace tolerance without ambiguity',
            () => {
                it(
                    'continua a tollerare whitespace differente quando esiste un solo candidato',
                    () => {
                        const source =
                            lf([
                                'def target():',
                                '    value     =     compute()',
                                '    return value'
                            ]);

                        const hunks:
                            readonly ParsedHunk[] = [
                                {
                                    oldStart:
                                        2,

                                    newStart:
                                        2,

                                    lines: [
                                        {
                                            kind:
                                                '-',

                                            text:
                                                'value = compute()'
                                        },

                                        {
                                            kind:
                                                '+',

                                            text:
                                                '    value = safe_compute()'
                                        },

                                        {
                                            kind:
                                                ' ',

                                            text:
                                                'return value'
                                        }
                                    ]
                                }
                            ];

                        const result =
                            applyHunksToContent(
                                source,
                                hunks
                            );

                        expect(
                            result
                        ).toBe(
                            lf([
                                'def target():',
                                '    value = safe_compute()',
                                '    return value'
                            ])
                        );
                    }
                );
            }
        );
    }
);
