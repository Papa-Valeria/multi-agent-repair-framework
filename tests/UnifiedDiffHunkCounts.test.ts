import {
    normalizeRejectedDiff,
    parseFileDiffs,
    validatePatchStructure
} from '../src/git/UnifiedDiff.js';

describe(
    'BE-P1-26 - Unified Diff hunk count invariants',
    () => {
        it(
            'accetta un hunk con oldCount e newCount coerenti',
            () => {
                const diff = [
                    'diff --git a/src/example.ts b/src/example.ts',
                    '--- a/src/example.ts',
                    '+++ b/src/example.ts',
                    '@@ -1,2 +1,2 @@',
                    '-const value = 1;',
                    '+const value = 2;',
                    ' export default value;'
                ].join('\n');

                const result =
                    validatePatchStructure(
                        diff
                    );

                expect(
                    result.valid
                ).toBe(true);

                expect(
                    result.violations
                ).toEqual([]);
            }
        );

        it(
            'conserva oldCount e newCount dichiarati nel ParsedHunk',
            () => {
                const diff = [
                    'diff --git a/src/example.ts b/src/example.ts',
                    '--- a/src/example.ts',
                    '+++ b/src/example.ts',
                    '@@ -10,3 +20,4 @@',
                    ' const a = 1;',
                    '-const b = 2;',
                    '+const b = 3;',
                    '+const c = 4;',
                    ' export { a, b };'
                ].join('\n');

                const parsed =
                    parseFileDiffs(
                        diff
                    );

                expect(parsed).toHaveLength(1);
                expect(
                    parsed[0]?.hunks
                ).toHaveLength(1);

                expect(
                    parsed[0]?.hunks[0]
                ).toMatchObject({
                    oldStart: 10,
                    oldCount: 3,
                    newStart: 20,
                    newCount: 4
                });
            }
        );

        it(
            'interpreta count omessi come 1 secondo Unified Diff',
            () => {
                const diff = [
                    'diff --git a/src/example.ts b/src/example.ts',
                    '--- a/src/example.ts',
                    '+++ b/src/example.ts',
                    '@@ -1 +1 @@',
                    '-const value = 1;',
                    '+const value = 2;'
                ].join('\n');

                const parsed =
                    parseFileDiffs(
                        diff
                    );

                const hunk =
                    parsed[0]?.hunks[0];

                expect(hunk).toBeDefined();

                expect(hunk).toMatchObject({
                    oldStart: 1,
                    oldCount: 1,
                    newStart: 1,
                    newCount: 1
                });

                const validation =
                    validatePatchStructure(
                        diff
                    );

                expect(
                    validation.valid
                ).toBe(true);
            }
        );

        it(
            'rifiuta un oldCount maggiore delle righe old-side effettive',
            () => {
                const diff = [
                    'diff --git a/src/example.ts b/src/example.ts',
                    '--- a/src/example.ts',
                    '+++ b/src/example.ts',
                    '@@ -1,99 +1,2 @@',
                    '-const value = 1;',
                    '+const value = 2;',
                    ' export default value;'
                ].join('\n');

                const result =
                    validatePatchStructure(
                        diff
                    );

                expect(
                    result.valid
                ).toBe(false);

                expect(
                    result.violations
                ).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            file:
                                'src/example.ts',
                            hunkIndex: 0,
                            code:
                                'HUNK_COUNT_MISMATCH'
                        })
                    ])
                );

                expect(
                    result.violations.some(
                        (violation) =>
                            violation.message.includes(
                                'oldCount=99'
                            )
                    )
                ).toBe(true);
            }
        );

        it(
            'rifiuta un newCount maggiore delle righe new-side effettive',
            () => {
                const diff = [
                    'diff --git a/src/example.ts b/src/example.ts',
                    '--- a/src/example.ts',
                    '+++ b/src/example.ts',
                    '@@ -1,2 +1,99 @@',
                    '-const value = 1;',
                    '+const value = 2;',
                    ' export default value;'
                ].join('\n');

                const result =
                    validatePatchStructure(
                        diff
                    );

                expect(
                    result.valid
                ).toBe(false);

                expect(
                    result.violations
                ).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            file:
                                'src/example.ts',
                            hunkIndex: 0,
                            code:
                                'HUNK_COUNT_MISMATCH'
                        })
                    ])
                );

                expect(
                    result.violations.some(
                        (violation) =>
                            violation.message.includes(
                                'newCount=99'
                            )
                    )
                ).toBe(true);
            }
        );

        it(
            'rifiuta anche count dichiarati inferiori alle righe effettive',
            () => {
                const diff = [
                    'diff --git a/src/example.ts b/src/example.ts',
                    '--- a/src/example.ts',
                    '+++ b/src/example.ts',
                    '@@ -1,1 +1,1 @@',
                    ' const before = true;',
                    '-const value = 1;',
                    '+const value = 2;'
                ].join('\n');

                const result =
                    validatePatchStructure(
                        diff
                    );

                expect(
                    result.valid
                ).toBe(false);

                expect(
                    result.violations
                ).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            code:
                                'HUNK_COUNT_MISMATCH'
                        })
                    ])
                );
            }
        );

        it(
            'accetta count zero sul lato old per un nuovo file valido',
            () => {
                const diff = [
                    'diff --git a/src/new.ts b/src/new.ts',
                    'new file mode 100644',
                    '--- /dev/null',
                    '+++ b/src/new.ts',
                    '@@ -0,0 +1,2 @@',
                    '+export const value = 1;',
                    '+export const other = 2;'
                ].join('\n');

                const parsed =
                    parseFileDiffs(
                        diff
                    );

                const hunk =
                    parsed[0]?.hunks[0];

                expect(
                    parsed[0]?.isNewFile
                ).toBe(true);

                expect(hunk).toMatchObject({
                    oldStart: 0,
                    oldCount: 0,
                    newStart: 1,
                    newCount: 2
                });

                expect(
                    validatePatchStructure(
                        diff
                    ).valid
                ).toBe(true);
            }
        );

        it(
            'rifiuta un nuovo file quando newCount non coincide con le aggiunte',
            () => {
                const diff = [
                    'diff --git a/src/new.ts b/src/new.ts',
                    'new file mode 100644',
                    '--- /dev/null',
                    '+++ b/src/new.ts',
                    '@@ -0,0 +1,99 @@',
                    '+export const value = 1;',
                    '+export const other = 2;'
                ].join('\n');

                const result =
                    validatePatchStructure(
                        diff
                    );

                expect(
                    result.valid
                ).toBe(false);

                expect(
                    result.violations
                ).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            file: 'src/new.ts',
                            hunkIndex: 0,
                            code:
                                'HUNK_COUNT_MISMATCH'
                        })
                    ])
                );
            }
        );

        it(
            'impedisce al normalizer di correggere una patch con count incoerenti',
            () => {
                const diff = [
                    'diff --git a/src/example.ts b/src/example.ts',
                    '--- a/src/example.ts',
                    '+++ b/src/example.ts',
                    '@@ -1,99 +1,99 @@',
                    '-const value = 1;',
                    '+const value = 2;',
                    ' export default wrongValue;'
                ].join('\n');

                const sources = {
                    'src/example.ts': [
                        'const value = 1;',
                        'export default value;'
                    ].join('\n') + '\n'
                };

                const normalized =
                    normalizeRejectedDiff(
                        diff,
                        sources
                    );

                expect(
                    normalized
                ).toBeNull();
            }
        );

        it(
            'continua a normalizzare una patch valida con count coerenti',
            () => {
                const diff = [
                    'diff --git a/src/example.ts b/src/example.ts',
                    '--- a/src/example.ts',
                    '+++ b/src/example.ts',
                    '@@ -1,2 +1,2 @@',
                    '-const value = 1;',
                    '+const value = 2;',
                    ' export default wrongValue;'
                ].join('\n');

                const sources = {
                    'src/example.ts': [
                        'const value = 1;',
                        'export default value;'
                    ].join('\n') + '\n'
                };

                const normalized =
                    normalizeRejectedDiff(
                        diff,
                        sources
                    );

                expect(
                    normalized
                ).not.toBeNull();

                expect(
                    normalized?.normalized
                ).toBe(true);

                expect(
                    normalized?.repairedHunks
                ).toBe(1);

                expect(
                    normalized?.diffText
                ).toContain(
                    '@@ -1,2 +1,2 @@'
                );

                expect(
                    normalized?.diffText
                ).toContain(
                    '-export default value;'
                );

                expect(
                    normalized?.diffText
                ).toContain(
                    '+export default wrongValue;'
                );
            }
        );
    }
);
