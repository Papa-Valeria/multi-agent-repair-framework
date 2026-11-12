import {
    describe,
    expect,
    it
} from '@jest/globals';

import {
    applyHunksToContent,
    measurePatchGrounding,
    parseFileDiffs
} from '../src/git/UnifiedDiff.js';

const original = [
    'def authenticate(token: str) -> bool:',
    '    query = "SELECT * FROM tokens WHERE t = " + token',
    '    return False'
].join('\n');

describe(
    'Unified diff preview and application share one engine',
    () => {
        it(
            'never appends hunk lines after the file when the diff context does not exist',
            () => {
                const diff = [
                    'diff --git a/service.py b/service.py',
                    '--- a/service.py',
                    '+++ b/service.py',
                    '@@ -11,7 +11,7 @@ def authenticate(token: str) -> bool:',
                    '     query = "SELECT * FROM tokens WHERE t = ?"',
                    '     cursor = conn.cursor()',
                    '     cursor.execute(query, (token,))',
                    '-    return False',
                    '+    return bool(cursor.fetchone())'
                ].join('\n');

                const [fileDiff] =
                    parseFileDiffs(diff);

                expect(fileDiff?.file).toBe(
                    'service.py'
                );

                expect(fileDiff?.isNewFile).toBe(
                    false
                );
                expect(
                    applyHunksToContent(
                        original,
                        fileDiff!.hunks
                    )
                ).toBe(
                    [
                        'def authenticate(token: str) -> bool:',
                        '    query = "SELECT * FROM tokens WHERE t = " + token',
                        '    return bool(cursor.fetchone())'
                    ].join('\n')
                );
            }
        );

        it(
            'replaces the removed lines in place when the context matches',
            () => {
                const diff = [
                    '--- a/service.py',
                    '+++ b/service.py',
                    '@@ -2,2 +2,3 @@',
                    '     query = "SELECT * FROM tokens WHERE t = " + token',
                    '-    return False',
                    '+    cursor = conn.cursor()',
                    '+    return True'
                ].join('\n');

                const [fileDiff] =
                    parseFileDiffs(diff);

                expect(fileDiff).toBeDefined();

                expect(
                    applyHunksToContent(
                        original,
                        fileDiff!.hunks
                    )
                ).toBe(
                    [
                        'def authenticate(token: str) -> bool:',
                        '    query = "SELECT * FROM tokens WHERE t = " + token',
                        '    cursor = conn.cursor()',
                        '    return True'
                    ].join('\n')
                );
            }
        );

        it(
            'parses oldStart and newStart independently from the hunk header',
            () => {
                const diff = [
                    '--- a/service.py',
                    '+++ b/service.py',
                    '@@ -2,2 +5,3 @@',
                    '     query = "SELECT * FROM tokens WHERE t = " + token',
                    '-    return False',
                    '+    cursor = conn.cursor()',
                    '+    return True'
                ].join('\n');

                const [fileDiff] =
                    parseFileDiffs(diff);

                expect(fileDiff).toBeDefined();
                expect(fileDiff!.hunks).toHaveLength(1);

                const [hunk] =
                    fileDiff!.hunks;

                expect(hunk?.oldStart).toBe(2);
                expect(hunk?.newStart).toBe(5);
            }
        );

        it(
            'measures how many old-side lines of a diff do not exist in the original source',
            () => {
                const invented = [
                    '--- a/service.py',
                    '+++ b/service.py',
                    '@@ -11,7 +11,7 @@',
                    '     query = "SELECT * FROM tokens WHERE t = ?"',
                    '     cursor = conn.cursor()',
                    '     cursor.execute(query, (token,))',
                    '-    return False',
                    '+    return bool(cursor.fetchone())'
                ].join('\n');

                const grounded = [
                    '--- a/service.py',
                    '+++ b/service.py',
                    '@@ -2,2 +2,2 @@',
                    '     query = "SELECT * FROM tokens WHERE t = " + token',
                    '-    return False',
                    '+    return True'
                ].join('\n');

                const additionOnly = [
                    '--- a/service.py',
                    '+++ b/service.py',
                    '@@ -3,0 +4,1 @@',
                    '+    x = 1'
                ].join('\n');

                expect(
                    measurePatchGrounding(
                        invented,
                        {
                            'service.py': original
                        }
                    )
                ).toEqual({
                    hunks: 1,
                    ungroundedHunks: 1,
                    oldSideLines: 4,
                    ungroundedLines: 3
                });

                expect(
                    measurePatchGrounding(
                        grounded,
                        {
                            'service.py': original
                        }
                    )
                ).toEqual({
                    hunks: 1,
                    ungroundedHunks: 0,
                    oldSideLines: 2,
                    ungroundedLines: 0
                });

                expect(
                    measurePatchGrounding(
                        additionOnly,
                        {
                            'service.py': original
                        }
                    )
                ).toEqual({
                    hunks: 0,
                    ungroundedHunks: 0,
                    oldSideLines: 0,
                    ungroundedLines: 0
                });
            }
        );

        it(
            'treats a removed line starting with dashes as content, not as a file header',
            () => {
                const diff = [
                    '--- a/q.sql',
                    '+++ b/q.sql',
                    '@@ -1,2 +1,2 @@',
                    ' SELECT 1',
                    '--- old comment',
                    '+-- new comment'
                ].join('\n');

                const [fileDiff] =
                    parseFileDiffs(diff);

                expect(fileDiff).toBeDefined();

                expect(
                    applyHunksToContent(
                        'SELECT 1\n-- old comment',
                        fileDiff!.hunks
                    )
                ).toBe(
                    'SELECT 1\n-- new comment'
                );
            }
        );

        it(
            'parses a CREATE patch for a new file',
            () => {
                const diff = [
                    'diff --git a/new_service.py b/new_service.py',
                    'new file mode 100644',
                    '--- /dev/null',
                    '+++ b/new_service.py',
                    '@@ -0,0 +1,3 @@',
                    '+def created():',
                    '+    return True',
                    '+'
                ].join('\n');

                const [fileDiff] =
                    parseFileDiffs(diff);

                expect(fileDiff).toBeDefined();

                expect(fileDiff?.file).toBe(
                    'new_service.py'
                );

                expect(
                    fileDiff?.isNewFile
                ).toBe(true);

                expect(
                    fileDiff?.hunks
                ).toHaveLength(1);

                const [hunk] =
                    fileDiff!.hunks;

                expect(hunk?.oldStart).toBe(0);
                expect(hunk?.newStart).toBe(1);

                expect(
                    applyHunksToContent(
                        '',
                        fileDiff!.hunks
                    )
                ).toBe(
                    [
                        'def created():',
                        '    return True',
                        ''
                    ].join('\n')
                );
            }
        );

        it(
            'does not count a new file as an ungrounded existing-file patch',
            () => {
                const diff = [
                    'diff --git a/helper.py b/helper.py',
                    'new file mode 100644',
                    '--- /dev/null',
                    '+++ b/helper.py',
                    '@@ -0,0 +1,2 @@',
                    '+def helper():',
                    '+    return True'
                ].join('\n');

                expect(
                    measurePatchGrounding(
                        diff,
                        {}
                    )
                ).toEqual({
                    hunks: 0,
                    ungroundedHunks: 0,
                    oldSideLines: 0,
                    ungroundedLines: 0
                });
            }
        );

        it(
            'parses multiple files from one CREATE patch',
            () => {
                const diff = [
                    'diff --git a/service.py b/service.py',
                    '--- a/service.py',
                    '+++ b/service.py',
                    '@@ -3,1 +3,1 @@',
                    '-    return False',
                    '+    return True',
                    'diff --git a/helper.py b/helper.py',
                    'new file mode 100644',
                    '--- /dev/null',
                    '+++ b/helper.py',
                    '@@ -0,0 +1,2 @@',
                    '+def helper():',
                    '+    return True'
                ].join('\n');

                const fileDiffs =
                    parseFileDiffs(diff);

                expect(fileDiffs).toHaveLength(2);

                expect(fileDiffs[0]?.file).toBe(
                    'service.py'
                );

                expect(
                    fileDiffs[0]?.isNewFile
                ).toBe(false);

                expect(
                    fileDiffs[0]?.hunks[0]?.oldStart
                ).toBe(3);

                expect(
                    fileDiffs[0]?.hunks[0]?.newStart
                ).toBe(3);

                expect(fileDiffs[1]?.file).toBe(
                    'helper.py'
                );

                expect(
                    fileDiffs[1]?.isNewFile
                ).toBe(true);

                expect(
                    fileDiffs[1]?.hunks[0]?.oldStart
                ).toBe(0);

                expect(
                    fileDiffs[1]?.hunks[0]?.newStart
                ).toBe(1);
            }
        );

        it(
            'preserves an explicitly prefixed empty context line',
            () => {
                const diff = [
                    '--- a/example.py',
                    '+++ b/example.py',
                    '@@ -1,3 +1,3 @@',
                    ' first',
                    ' ',
                    '-old',
                    '+new'
                ].join('\n');

                const [fileDiff] =
                    parseFileDiffs(diff);

                expect(fileDiff).toBeDefined();

                const [hunk] =
                    fileDiff!.hunks;

                expect(hunk?.lines).toEqual([
                    {
                        kind: ' ',
                        text: 'first'
                    },
                    {
                        kind: ' ',
                        text: ''
                    },
                    {
                        kind: '-',
                        text: 'old'
                    },
                    {
                        kind: '+',
                        text: 'new'
                    }
                ]);
            }
        );

        it(
            'ignores an unprefixed trailing empty line instead of treating it as diff context',
            () => {
                const diff = [
                    '--- a/example.py',
                    '+++ b/example.py',
                    '@@ -1,1 +1,1 @@',
                    '-old',
                    '+new',
                    ''
                ].join('\n');

                const [fileDiff] =
                    parseFileDiffs(diff);

                expect(fileDiff).toBeDefined();

                expect(
                    fileDiff!.hunks[0]!.lines
                ).toEqual([
                    {
                        kind: '-',
                        text: 'old'
                    },
                    {
                        kind: '+',
                        text: 'new'
                    }
                ]);
            }
        );

        it(
            'preserves independent coordinates across multiple hunks',
            () => {
                const diff = [
                    '--- a/example.py',
                    '+++ b/example.py',
                    '@@ -2,1 +2,2 @@',
                    '-old_a',
                    '+new_a',
                    '+new_b',
                    '@@ -10,2 +11,1 @@',
                    '-old_c',
                    '-old_d',
                    '+new_c'
                ].join('\n');

                const [fileDiff] =
                    parseFileDiffs(diff);

                expect(fileDiff).toBeDefined();
                expect(fileDiff!.hunks).toHaveLength(2);

                expect(
                    fileDiff!.hunks[0]!.oldStart
                ).toBe(2);

                expect(
                    fileDiff!.hunks[0]!.newStart
                ).toBe(2);

                expect(
                    fileDiff!.hunks[1]!.oldStart
                ).toBe(10);

                expect(
                    fileDiff!.hunks[1]!.newStart
                ).toBe(11);
            }
        );
    }
);
