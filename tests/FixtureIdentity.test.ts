import {
    describe,
    expect,
    it
} from '@jest/globals';

import {
    canonicalizeFixtureIdentity,
    createFixtureIdentity
} from '../src/experiments/FixtureIdentity.js';

import type {
    FixtureIdentityInput
} from '../src/experiments/FixtureIdentity.js';

const BASE_FIXTURE:
    FixtureIdentityInput = {
    category:
        'REPAIR',

    issueSpec:
        'Fix the incorrect production value.',

    targetSources: {
        'src/target.ts':
            'export const value = 1;\n'
    },

    testSources: {
        'tests/target.test.ts':
            [
                "import { value } from '../src/target.js';",
                '',
                "test('value is correct', () => {",
                '  expect(value).toBe(2);',
                '});',
                ''
            ].join('\n')
    }
};

const copyFixture = (
    overrides:
        Partial<FixtureIdentityInput> = {}
): FixtureIdentityInput => ({
    category:
        overrides.category ??
        BASE_FIXTURE.category,

    issueSpec:
        overrides.issueSpec ??
        BASE_FIXTURE.issueSpec,

    targetSources:
        overrides.targetSources ??
        BASE_FIXTURE.targetSources,

    testSources:
        overrides.testSources ??
        BASE_FIXTURE.testSources
});

describe(
    'BE-P1-19 / BE-P1-31 - Fixture identity',
    () => {
        describe(
            'determinismo',
            () => {
                it(
                    'produce la stessa identity per input identici',
                    () => {
                        const firstIdentity =
                            createFixtureIdentity(
                                BASE_FIXTURE
                            );

                        const secondIdentity =
                            createFixtureIdentity(
                                copyFixture()
                            );

                        expect(
                            firstIdentity
                        ).toBe(
                            secondIdentity
                        );
                    }
                );

                it(
                    'produce un digest SHA-256 esadecimale',
                    () => {
                        const identity =
                            createFixtureIdentity(
                                BASE_FIXTURE
                            );

                        expect(
                            identity
                        ).toMatch(
                            /^[a-f0-9]{64}$/
                        );
                    }
                );

                it(
                    'non dipende dalla stessa istanza dell oggetto',
                    () => {
                        const firstFixture:
                            FixtureIdentityInput = {
                            category:
                                'REPAIR',

                            issueSpec:
                                'Fix the incorrect production value.',

                            targetSources: {
                                'src/target.ts':
                                    'export const value = 1;\n'
                            },

                            testSources: {
                                'tests/target.test.ts':
                                    BASE_FIXTURE
                                        .testSources[
                                    'tests/target.test.ts'
                                    ] ??
                                    ''
                            }
                        };

                        const secondFixture:
                            FixtureIdentityInput =
                            JSON.parse(
                                JSON.stringify(
                                    firstFixture
                                )
                            ) as FixtureIdentityInput;

                        expect(
                            createFixtureIdentity(
                                firstFixture
                            )
                        ).toBe(
                            createFixtureIdentity(
                                secondFixture
                            )
                        );
                    }
                );
            }
        );

        describe(
            'canonicalizzazione',
            () => {
                it(
                    'non dipende dall ordine di inserimento dei target source',
                    () => {
                        const firstIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/a.ts':
                                            'export const a = 1;\n',

                                        'src/b.ts':
                                            'export const b = 2;\n'
                                    }
                                })
                            );

                        const secondIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/b.ts':
                                            'export const b = 2;\n',

                                        'src/a.ts':
                                            'export const a = 1;\n'
                                    }
                                })
                            );

                        expect(
                            firstIdentity
                        ).toBe(
                            secondIdentity
                        );
                    }
                );

                it(
                    'non dipende dall ordine di inserimento dei test source',
                    () => {
                        const firstIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    testSources: {
                                        'tests/a.test.ts':
                                            'test("a", () => {});\n',

                                        'tests/b.test.ts':
                                            'test("b", () => {});\n'
                                    }
                                })
                            );

                        const secondIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    testSources: {
                                        'tests/b.test.ts':
                                            'test("b", () => {});\n',

                                        'tests/a.test.ts':
                                            'test("a", () => {});\n'
                                    }
                                })
                            );

                        expect(
                            firstIdentity
                        ).toBe(
                            secondIdentity
                        );
                    }
                );

                it(
                    'normalizza i separatori Windows e POSIX nei path',
                    () => {
                        const windowsIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src\\nested\\target.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests\\nested\\target.test.ts':
                                            'test("value", () => {});\n'
                                    }
                                })
                            );

                        const posixIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/nested/target.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests/nested/target.test.ts':
                                            'test("value", () => {});\n'
                                    }
                                })
                            );

                        expect(
                            windowsIdentity
                        ).toBe(
                            posixIdentity
                        );
                    }
                );

                it(
                    'normalizza il prefisso relativo ./ nei path',
                    () => {
                        const prefixedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        './src/target.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        './tests/target.test.ts':
                                            'test("value", () => {});\n'
                                    }
                                })
                            );

                        const plainIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/target.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests/target.test.ts':
                                            'test("value", () => {});\n'
                                    }
                                })
                            );

                        expect(
                            prefixedIdentity
                        ).toBe(
                            plainIdentity
                        );
                    }
                );

                it(
                    'normalizza i segmenti ridondanti dei path',
                    () => {
                        const redundantIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/shared/../target.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests/unit/../target.test.ts':
                                            'test("value", () => {});\n'
                                    }
                                })
                            );

                        const normalizedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/target.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests/target.test.ts':
                                            'test("value", () => {});\n'
                                    }
                                })
                            );

                        expect(
                            redundantIdentity
                        ).toBe(
                            normalizedIdentity
                        );
                    }
                );

                it(
                    'normalizza CRLF e LF nei contenuti target',
                    () => {
                        const crlfIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/target.ts':
                                            'export const first = 1;\r\n' +
                                            'export const second = 2;\r\n'
                                    }
                                })
                            );

                        const lfIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/target.ts':
                                            'export const first = 1;\n' +
                                            'export const second = 2;\n'
                                    }
                                })
                            );

                        expect(
                            crlfIdentity
                        ).toBe(
                            lfIdentity
                        );
                    }
                );

                it(
                    'normalizza CRLF e LF nei contenuti test',
                    () => {
                        const crlfIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    testSources: {
                                        'tests/target.test.ts':
                                            'test("first", () => {});\r\n' +
                                            'test("second", () => {});\r\n'
                                    }
                                })
                            );

                        const lfIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    testSources: {
                                        'tests/target.test.ts':
                                            'test("first", () => {});\n' +
                                            'test("second", () => {});\n'
                                    }
                                })
                            );

                        expect(
                            crlfIdentity
                        ).toBe(
                            lfIdentity
                        );
                    }
                );

                it(
                    'normalizza CRLF e LF nella issue specification',
                    () => {
                        const crlfIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    issueSpec:
                                        'Fix the value.\r\n' +
                                        'Preserve existing behavior.'
                                })
                            );

                        const lfIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    issueSpec:
                                        'Fix the value.\n' +
                                        'Preserve existing behavior.'
                                })
                            );

                        expect(
                            crlfIdentity
                        ).toBe(
                            lfIdentity
                        );
                    }
                );

                it(
                    'produce la stessa rappresentazione canonica per fixture equivalenti',
                    () => {
                        const firstCanonical =
                            canonicalizeFixtureIdentity({
                                category:
                                    'REPAIR',

                                issueSpec:
                                    'Fix.\r\nPreserve.',

                                targetSources: {
                                    '.\\src\\b.ts':
                                        'export const b = 2;\r\n',

                                    './src/a.ts':
                                        'export const a = 1;\r\n'
                                },

                                testSources: {
                                    '.\\tests\\target.test.ts':
                                        'test("target", () => {});\r\n'
                                }
                            });

                        const secondCanonical =
                            canonicalizeFixtureIdentity({
                                category:
                                    'REPAIR',

                                issueSpec:
                                    'Fix.\nPreserve.',

                                targetSources: {
                                    'src/a.ts':
                                        'export const a = 1;\n',

                                    'src/b.ts':
                                        'export const b = 2;\n'
                                },

                                testSources: {
                                    'tests/target.test.ts':
                                        'test("target", () => {});\n'
                                }
                            });

                        expect(
                            firstCanonical
                        ).toEqual(
                            secondCanonical
                        );
                    }
                );
            }
        );

        describe(
            'sensibilità agli input sperimentali',
            () => {
                it(
                    'cambia identity quando cambia issueSpec',
                    () => {
                        const originalIdentity =
                            createFixtureIdentity(
                                BASE_FIXTURE
                            );

                        const modifiedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    issueSpec:
                                        'Fix the incorrect production value and add validation.'
                                })
                            );

                        expect(
                            modifiedIdentity
                        ).not.toBe(
                            originalIdentity
                        );
                    }
                );

                it(
                    'cambia identity quando cambia category',
                    () => {
                        const repairIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    category:
                                        'REPAIR'
                                })
                            );

                        const createIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    category:
                                        'CREATE'
                                })
                            );

                        expect(
                            createIdentity
                        ).not.toBe(
                            repairIdentity
                        );
                    }
                );

                it(
                    'cambia identity quando cambia un target path',
                    () => {
                        const originalIdentity =
                            createFixtureIdentity(
                                BASE_FIXTURE
                            );

                        const modifiedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/renamed-target.ts':
                                            'export const value = 1;\n'
                                    }
                                })
                            );

                        expect(
                            modifiedIdentity
                        ).not.toBe(
                            originalIdentity
                        );
                    }
                );

                it(
                    'cambia identity quando cambia un target content',
                    () => {
                        const originalIdentity =
                            createFixtureIdentity(
                                BASE_FIXTURE
                            );

                        const modifiedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/target.ts':
                                            'export const value = 2;\n'
                                    }
                                })
                            );

                        expect(
                            modifiedIdentity
                        ).not.toBe(
                            originalIdentity
                        );
                    }
                );

                it(
                    'cambia identity quando viene aggiunto un target file',
                    () => {
                        const originalIdentity =
                            createFixtureIdentity(
                                BASE_FIXTURE
                            );

                        const modifiedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        ...BASE_FIXTURE
                                            .targetSources,

                                        'src/additional.ts':
                                            'export const additional = true;\n'
                                    }
                                })
                            );

                        expect(
                            modifiedIdentity
                        ).not.toBe(
                            originalIdentity
                        );
                    }
                );

                it(
                    'cambia identity quando cambia un test path',
                    () => {
                        const originalIdentity =
                            createFixtureIdentity(
                                BASE_FIXTURE
                            );

                        const originalTestContent =
                            BASE_FIXTURE
                                .testSources[
                            'tests/target.test.ts'
                            ] ??
                            '';

                        const modifiedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    testSources: {
                                        'tests/renamed-target.test.ts':
                                            originalTestContent
                                    }
                                })
                            );

                        expect(
                            modifiedIdentity
                        ).not.toBe(
                            originalIdentity
                        );
                    }
                );

                it(
                    'cambia identity quando cambia un test content',
                    () => {
                        const originalIdentity =
                            createFixtureIdentity(
                                BASE_FIXTURE
                            );

                        const modifiedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    testSources: {
                                        'tests/target.test.ts':
                                            [
                                                "import { value } from '../src/target.js';",
                                                '',
                                                "test('value is correct', () => {",
                                                '  expect(value).toBe(3);',
                                                '});',
                                                ''
                                            ].join('\n')
                                    }
                                })
                            );

                        expect(
                            modifiedIdentity
                        ).not.toBe(
                            originalIdentity
                        );
                    }
                );

                it(
                    'cambia identity quando viene aggiunto un test file',
                    () => {
                        const originalIdentity =
                            createFixtureIdentity(
                                BASE_FIXTURE
                            );

                        const modifiedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    testSources: {
                                        ...BASE_FIXTURE
                                            .testSources,

                                        'tests/additional.test.ts':
                                            'test("additional", () => {});\n'
                                    }
                                })
                            );

                        expect(
                            modifiedIdentity
                        ).not.toBe(
                            originalIdentity
                        );
                    }
                );

                it(
                    'considera significativa la newline finale dei sorgenti',
                    () => {
                        const withFinalNewline =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/target.ts':
                                            'export const value = 1;\n'
                                    }
                                })
                            );

                        const withoutFinalNewline =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/target.ts':
                                            'export const value = 1;'
                                    }
                                })
                            );

                        expect(
                            withoutFinalNewline
                        ).not.toBe(
                            withFinalNewline
                        );
                    }
                );

                it(
                    'considera significativa l indentazione del codice',
                    () => {
                        const twoSpacesIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/target.ts':
                                            [
                                                'if (condition) {',
                                                '  execute();',
                                                '}',
                                                ''
                                            ].join('\n')
                                    }
                                })
                            );

                        const fourSpacesIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/target.ts':
                                            [
                                                'if (condition) {',
                                                '    execute();',
                                                '}',
                                                ''
                                            ].join('\n')
                                    }
                                })
                            );

                        expect(
                            fourSpacesIdentity
                        ).not.toBe(
                            twoSpacesIdentity
                        );
                    }
                );
            }
        );

        describe(
            'separazione da taskId e run metadata',
            () => {
                it(
                    'non richiede taskId per calcolare la fixture identity',
                    () => {
                        const fixtureInputKeys =
                            Object.keys(
                                BASE_FIXTURE
                            ).sort();

                        expect(
                            fixtureInputKeys
                        ).toEqual([
                            'category',
                            'issueSpec',
                            'targetSources',
                            'testSources'
                        ]);
                    }
                );

                it(
                    'non cambia tra due run organizzativi che condividono gli stessi input',
                    () => {
                        const firstRunFixture =
                            createFixtureIdentity({
                                category:
                                    BASE_FIXTURE.category,

                                issueSpec:
                                    BASE_FIXTURE.issueSpec,

                                targetSources:
                                    BASE_FIXTURE.targetSources,

                                testSources:
                                    BASE_FIXTURE.testSources
                            });

                        const secondRunFixture =
                            createFixtureIdentity({
                                category:
                                    BASE_FIXTURE.category,

                                issueSpec:
                                    BASE_FIXTURE.issueSpec,

                                targetSources:
                                    BASE_FIXTURE.targetSources,

                                testSources:
                                    BASE_FIXTURE.testSources
                            });

                        expect(
                            firstRunFixture
                        ).toBe(
                            secondRunFixture
                        );
                    }
                );
            }
        );

        describe(
            'BE-P1-31 - canonical path collision rejection',
            () => {
                it(
                    'rifiuta due target path distinti che collassano dopo la rimozione di ./',
                    () => {
                        const fixture =
                            copyFixture({
                                targetSources: {
                                    './src/a.ts':
                                        'export const first = 1;\n',

                                    'src/a.ts':
                                        'export const second = 2;\n'
                                }
                            });

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /Collisione di path canonico in targetSources/
                        );

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /src\/a\.ts/
                        );
                    }
                );

                it(
                    'rifiuta due test path distinti che collassano dopo la rimozione di ./',
                    () => {
                        const fixture =
                            copyFixture({
                                testSources: {
                                    './tests/a.test.ts':
                                        'test("first", () => {});\n',

                                    'tests/a.test.ts':
                                        'test("second", () => {});\n'
                                }
                            });

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /Collisione di path canonico in testSources/
                        );

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /tests\/a\.test\.ts/
                        );
                    }
                );

                it(
                    'rifiuta collisioni target introdotte dalla normalizzazione dei separatori',
                    () => {
                        const fixture =
                            copyFixture({
                                targetSources: {
                                    'src\\nested\\a.ts':
                                        'export const first = 1;\n',

                                    'src/nested/a.ts':
                                        'export const second = 2;\n'
                                }
                            });

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /Collisione di path canonico in targetSources/
                        );

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /src\/nested\/a\.ts/
                        );
                    }
                );

                it(
                    'rifiuta collisioni test introdotte dalla normalizzazione dei separatori',
                    () => {
                        const fixture =
                            copyFixture({
                                testSources: {
                                    'tests\\nested\\a.test.ts':
                                        'test("first", () => {});\n',

                                    'tests/nested/a.test.ts':
                                        'test("second", () => {});\n'
                                }
                            });

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /Collisione di path canonico in testSources/
                        );

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /tests\/nested\/a\.test\.ts/
                        );
                    }
                );

                it(
                    'rifiuta collisioni target introdotte da segmenti ridondanti',
                    () => {
                        const fixture =
                            copyFixture({
                                targetSources: {
                                    'src/nested/../a.ts':
                                        'export const first = 1;\n',

                                    'src/a.ts':
                                        'export const second = 2;\n'
                                }
                            });

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /Collisione di path canonico in targetSources/
                        );

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /src\/a\.ts/
                        );
                    }
                );

                it(
                    'rifiuta collisioni test introdotte da segmenti ridondanti',
                    () => {
                        const fixture =
                            copyFixture({
                                testSources: {
                                    'tests/nested/../a.test.ts':
                                        'test("first", () => {});\n',

                                    'tests/a.test.ts':
                                        'test("second", () => {});\n'
                                }
                            });

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /Collisione di path canonico in testSources/
                        );

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /tests\/a\.test\.ts/
                        );
                    }
                );

                it(
                    'controlla le collisioni separatamente tra targetSources e testSources',
                    () => {
                        const fixture =
                            copyFixture({
                                targetSources: {
                                    'src/shared.ts':
                                        'export const value = 1;\n'
                                },

                                testSources: {
                                    'src/shared.ts':
                                        'test("shared", () => {});\n'
                                }
                            });

                        expect(
                            () =>
                                createFixtureIdentity(
                                    fixture
                                )
                        ).not.toThrow();
                    }
                );

                it(
                    'continua a produrre la stessa identity per forme canoniche equivalenti usate in fixture separate',
                    () => {
                        const prefixedIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        './src/a.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        './tests/a.test.ts':
                                            'test("a", () => {});\n'
                                    }
                                })
                            );

                        const canonicalIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/a.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests/a.test.ts':
                                            'test("a", () => {});\n'
                                    }
                                })
                            );

                        expect(
                            prefixedIdentity
                        ).toBe(
                            canonicalIdentity
                        );
                    }
                );

                it(
                    'continua a produrre la stessa identity per separatori equivalenti usati in fixture separate',
                    () => {
                        const windowsIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src\\nested\\a.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests\\nested\\a.test.ts':
                                            'test("a", () => {});\n'
                                    }
                                })
                            );

                        const posixIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/nested/a.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests/nested/a.test.ts':
                                            'test("a", () => {});\n'
                                    }
                                })
                            );

                        expect(
                            windowsIdentity
                        ).toBe(
                            posixIdentity
                        );
                    }
                );

                it(
                    'continua a produrre la stessa identity per segmenti ridondanti equivalenti usati in fixture separate',
                    () => {
                        const redundantIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/nested/../a.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests/nested/../a.test.ts':
                                            'test("a", () => {});\n'
                                    }
                                })
                            );

                        const canonicalIdentity =
                            createFixtureIdentity(
                                copyFixture({
                                    targetSources: {
                                        'src/a.ts':
                                            'export const value = 1;\n'
                                    },

                                    testSources: {
                                        'tests/a.test.ts':
                                            'test("a", () => {});\n'
                                    }
                                })
                            );

                        expect(
                            redundantIdentity
                        ).toBe(
                            canonicalIdentity
                        );
                    }
                );

                it(
                    'rifiuta la collisione già durante canonicalizeFixtureIdentity prima del calcolo SHA-256',
                    () => {
                        const fixture =
                            copyFixture({
                                targetSources: {
                                    './src/a.ts':
                                        'export const first = 1;\n',

                                    'src/a.ts':
                                        'export const second = 2;\n'
                                }
                            });

                        expect(
                            () =>
                                canonicalizeFixtureIdentity(
                                    fixture
                                )
                        ).toThrow(
                            /Collisione di path canonico in targetSources/
                        );
                    }
                );
            }
        );
    }
);
