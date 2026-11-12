import {
    describe,
    expect,
    it
} from '@jest/globals';

import {
    DiffScoper,
    type LineRange
} from '../src/verification/DiffScoper.js';

import type {
    SastFinding
} from '../src/types/domain.js';

const targetFile =
    'src/target.py';

const otherFile =
    'src/other.py';

const targetFiles:
    readonly string[] = [
        targetFile
    ];

/*
 * La patch modifica la riga 10.
 *
 * DiffScoper applica CONTEXT_LINES=3, quindi
 * la regione rilevante risultante è attorno
 * alla modifica.
 *
 * I finding usati come "fuori patch" vengono
 * intenzionalmente collocati molto lontano,
 * per evitare qualsiasi sovrapposizione con
 * il context window.
 */
const repairPatch = [
    '--- a/src/target.py',
    '+++ b/src/target.py',
    '@@ -10 +10 @@',
    '-old_value = False',
    '+old_value = True'
].join('\n');

const createFinding =
    (
        overrides:
            Partial<SastFinding> = {}
    ): SastFinding => ({
        ruleId:
            'test.rule',

        path:
            targetFile,

        startLine:
            100,

        endLine:
            100,

        severity:
            'WARNING',

        message:
            'Synthetic Semgrep finding.',

        ...overrides
    });

const modifiedRanges =
    (): ReadonlyMap<
        string,
        readonly LineRange[]
    > =>
        DiffScoper.extractModifiedLineRanges(
            repairPatch
        );

describe(
    'BE-P0-29 - DiffScoper REPAIR security policy',
    () => {
        it(
            'estrae una regione modificata per il target della patch',
            () => {
                const ranges =
                    modifiedRanges();

                const targetRanges =
                    ranges.get(
                        targetFile
                    );

                expect(
                    targetRanges
                ).toBeDefined();

                expect(
                    targetRanges?.length
                ).toBeGreaterThan(
                    0
                );

                /*
                 * La riga 10 modificata deve essere
                 * compresa nella regione calcolata.
                 */
                expect(
                    targetRanges?.some(
                        (range) =>
                            range.start <= 10 &&
                            range.end >= 10
                    )
                ).toBe(
                    true
                );

                /*
                 * La riga 100 usata dai test fuori-patch
                 * deve essere sicuramente esterna.
                 */
                expect(
                    targetRanges?.some(
                        (range) =>
                            range.start <= 100 &&
                            range.end >= 100
                    )
                ).toBe(
                    false
                );
            }
        );

        it(
            'include in REPAIR un finding ERROR nel target anche fuori dalle linee modificate',
            () => {
                const finding =
                    createFinding({
                        severity:
                            'ERROR',

                        startLine:
                            100,

                        endLine:
                            100
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        modifiedRanges(),
                        targetFiles,
                        'REPAIR'
                    );

                expect(
                    filtered
                ).toEqual([
                    finding
                ]);
            }
        );

        it(
            'include in REPAIR un finding con CWE nel target anche fuori dalle linee modificate',
            () => {
                const finding =
                    createFinding({
                        severity:
                            'WARNING',

                        cweHierarchy: [
                            'CWE-79'
                        ],

                        startLine:
                            100,

                        endLine:
                            100
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        modifiedRanges(),
                        targetFiles,
                        'REPAIR'
                    );

                expect(
                    filtered
                ).toEqual([
                    finding
                ]);
            }
        );

        it(
            'include in REPAIR un finding con categoria OWASP nel target anche fuori dalle linee modificate',
            () => {
                const finding =
                    createFinding({
                        severity:
                            'WARNING',

                        owaspCategory:
                            'A03:2021-Injection',

                        startLine:
                            100,

                        endLine:
                            100
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        modifiedRanges(),
                        targetFiles,
                        'REPAIR'
                    );

                expect(
                    filtered
                ).toEqual([
                    finding
                ]);
            }
        );

        it(
            'esclude in REPAIR un finding non-security nel target quando è fuori dalle linee modificate',
            () => {
                const finding =
                    createFinding({
                        severity:
                            'WARNING',

                        startLine:
                            100,

                        endLine:
                            100
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        modifiedRanges(),
                        targetFiles,
                        'REPAIR'
                    );

                expect(
                    filtered
                ).toEqual(
                    []
                );
            }
        );

        it(
            'include in REPAIR un finding non-security nel target quando interseca la regione modificata',
            () => {
                const finding =
                    createFinding({
                        severity:
                            'WARNING',

                        startLine:
                            10,

                        endLine:
                            10
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        modifiedRanges(),
                        targetFiles,
                        'REPAIR'
                    );

                expect(
                    filtered
                ).toEqual([
                    finding
                ]);
            }
        );

        it(
            'include in REPAIR un finding non-security che interseca il context window della modifica',
            () => {
                const ranges =
                    modifiedRanges();

                const targetRanges =
                    ranges.get(
                        targetFile
                    );

                expect(
                    targetRanges
                ).toBeDefined();

                const firstRange =
                    targetRanges?.[0];

                expect(
                    firstRange
                ).toBeDefined();

                if (
                    !firstRange
                ) {
                    throw new Error(
                        'La fixture non ha prodotto la regione modificata attesa.'
                    );
                }

                const finding =
                    createFinding({
                        severity:
                            'INFO',

                        startLine:
                            firstRange.start,

                        endLine:
                            firstRange.start
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        ranges,
                        targetFiles,
                        'REPAIR'
                    );

                expect(
                    filtered
                ).toEqual([
                    finding
                ]);
            }
        );

        it(
            'esclude in REPAIR un finding security fuori dai target quando è anche fuori dalle linee modificate',
            () => {
                const finding =
                    createFinding({
                        path:
                            otherFile,

                        severity:
                            'ERROR',

                        startLine:
                            100,

                        endLine:
                            100
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        modifiedRanges(),
                        targetFiles,
                        'REPAIR'
                    );

                expect(
                    filtered
                ).toEqual(
                    []
                );
            }
        );

        it(
            'non estende automaticamente la target security hygiene alla modalità CREATE',
            () => {
                const finding =
                    createFinding({
                        severity:
                            'ERROR',

                        startLine:
                            100,

                        endLine:
                            100
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        modifiedRanges(),
                        targetFiles,
                        'CREATE'
                    );

                expect(
                    filtered
                ).toEqual(
                    []
                );
            }
        );

        it(
            'mantiene in CREATE il normale scoping sulle regioni modificate',
            () => {
                const finding =
                    createFinding({
                        severity:
                            'WARNING',

                        startLine:
                            10,

                        endLine:
                            10
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        modifiedRanges(),
                        targetFiles,
                        'CREATE'
                    );

                expect(
                    filtered
                ).toEqual([
                    finding
                ]);
            }
        );

        it(
            'applica la policy security soltanto al target dichiarato anche con path Semgrep assolutizzato',
            () => {
                /*
                 * DiffScoper supporta finding il cui path
                 * contiene il target come suffisso.
                 */
                const finding =
                    createFinding({
                        path:
                            `repository/${targetFile}`,

                        severity:
                            'ERROR',

                        startLine:
                            100,

                        endLine:
                            100
                    });

                const filtered =
                    DiffScoper.filterFindings(
                        [
                            finding
                        ],
                        modifiedRanges(),
                        targetFiles,
                        'REPAIR'
                    );

                expect(
                    filtered
                ).toEqual([
                    finding
                ]);
            }
        );

        it(
            'filtra deterministicamente una fixture mista secondo la policy REPAIR',
            () => {
                const securityErrorOutsidePatch =
                    createFinding({
                        ruleId:
                            'security.error',

                        severity:
                            'ERROR',

                        startLine:
                            100,

                        endLine:
                            100
                    });

                const securityCweOutsidePatch =
                    createFinding({
                        ruleId:
                            'security.cwe',

                        severity:
                            'WARNING',

                        cweHierarchy: [
                            'CWE-89'
                        ],

                        startLine:
                            110,

                        endLine:
                            110
                    });

                const securityOwaspOutsidePatch =
                    createFinding({
                        ruleId:
                            'security.owasp',

                        severity:
                            'INFO',

                        owaspCategory:
                            'A03:2021-Injection',

                        startLine:
                            120,

                        endLine:
                            120
                    });

                const nonSecurityInsidePatch =
                    createFinding({
                        ruleId:
                            'quality.inside',

                        severity:
                            'WARNING',

                        startLine:
                            10,

                        endLine:
                            10
                    });

                const nonSecurityOutsidePatch =
                    createFinding({
                        ruleId:
                            'quality.outside',

                        severity:
                            'WARNING',

                        startLine:
                            130,

                        endLine:
                            130
                    });

                const securityOutsideTarget =
                    createFinding({
                        ruleId:
                            'security.other-file',

                        path:
                            otherFile,

                        severity:
                            'ERROR',

                        startLine:
                            140,

                        endLine:
                            140
                    });

                const findings:
                    readonly SastFinding[] = [
                        securityErrorOutsidePatch,
                        securityCweOutsidePatch,
                        securityOwaspOutsidePatch,
                        nonSecurityInsidePatch,
                        nonSecurityOutsidePatch,
                        securityOutsideTarget
                    ];

                const filtered =
                    DiffScoper.filterFindings(
                        findings,
                        modifiedRanges(),
                        targetFiles,
                        'REPAIR'
                    );

                expect(
                    filtered
                ).toEqual([
                    securityErrorOutsidePatch,
                    securityCweOutsidePatch,
                    securityOwaspOutsidePatch,
                    nonSecurityInsidePatch
                ]);
            }
        );
    }
);
