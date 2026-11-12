export interface ParsedHunk {
    readonly oldStart: number;
    readonly oldCount: number;
    readonly newStart: number;
    readonly newCount: number;
    readonly lines: Array<{
        readonly kind: ' ' | '-' | '+';
        readonly text: string;
    }>;
}

export interface ParsedFileDiff {
    readonly file: string;
    readonly isNewFile: boolean;
    readonly hunks: ParsedHunk[];
}

export interface PatchGrounding {
    readonly hunks: number;
    readonly ungroundedHunks: number;
    readonly oldSideLines: number;
    readonly ungroundedLines: number;
}

export interface PatchStructureViolation {
    readonly file?: string;
    readonly hunkIndex?: number;
    readonly code:
    | 'NO_FILE_DIFF'
    | 'NO_HUNKS'
    | 'NO_CHANGES'
    | 'NEW_FILE_CONTAINS_NON_ADDITIONS'
    | 'EMPTY_CHANGE_GROUP'
    | 'NO_OP_CHANGE_GROUP'
    | 'HUNK_COUNT_MISMATCH';
    readonly message: string;
}

export interface PatchStructureValidation {
    readonly valid: boolean;
    readonly violations: PatchStructureViolation[];
}

export interface PatchNormalizationResult {
    readonly normalized: boolean;
    readonly diffText: string;
    readonly repairedHunks: number;
}

interface ChangeGroup {
    readonly removed: readonly string[];
    readonly added: readonly string[];
    readonly before: readonly string[];
    readonly after: readonly string[];
    readonly hint: number;
}

interface Edit {
    readonly start: number;
    readonly deleteCount: number;
    readonly insert: readonly string[];
}

export type FullReplacementFileStatus =
    | 'MODIFIED'
    | 'NEW';

interface LogicalText {
    readonly lines: readonly string[];
    readonly hasFinalNewline: boolean;
}

const toLogicalText = (
    content: string
): LogicalText => {
    const normalized =
        content.replace(/\r\n/g, '\n');

    if (normalized.length === 0) {
        return {
            lines: [],
            hasFinalNewline: false
        };
    }

    const hasFinalNewline =
        normalized.endsWith('\n');

    const lines =
        normalized.split('\n');

    if (hasFinalNewline) {
        lines.pop();
    }

    return {
        lines,
        hasFinalNewline
    };
};

export function createFullReplacementDiff(
    filename: string,
    original: string,
    modified: string,
    status: FullReplacementFileStatus
): string | null {
    const normalizedFilename =
        filename
            .replaceAll('\\', '/')
            .trim();

    const pathSegments =
        normalizedFilename.split('/');

    const containsControlCharacters =
        /[\u0000-\u001F\u007F]/.test(
            normalizedFilename
        );

    const isWindowsAbsolutePath =
        /^[A-Za-z]:\//.test(
            normalizedFilename
        );

    if (
        normalizedFilename.length === 0 ||
        normalizedFilename.startsWith('/') ||
        isWindowsAbsolutePath ||
        containsControlCharacters ||
        pathSegments.some(
            (segment) =>
                segment === '' ||
                segment === '.' ||
                segment === '..'
        )
    ) {
        throw new Error(
            'filename non valido per Unified Diff.'
        );
    }

    if (
        status === 'NEW' &&
        original.length > 0
    ) {
        throw new Error(
            'Un file NEW non puo avere contenuto originale.'
        );
    }

    const normalizedOriginal =
        original.replace(/\r\n/g, '\n');

    const normalizedModified =
        modified.replace(/\r\n/g, '\n');

    if (
        original !== modified &&
        normalizedOriginal === normalizedModified
    ) {
        throw new Error(
            'La modifica cambia esclusivamente lo stile EOL. ' +
            'La conversione CRLF/LF non e supportata dal ' +
            'generatore full-replacement.'
        );
    }

    if (
        status === 'MODIFIED' &&
        original === modified
    ) {
        return null;
    }

    const oldText =
        toLogicalText(original);

    const newText =
        toLogicalText(modified);

    if (
        status === 'NEW' &&
        newText.lines.length === 0
    ) {
        throw new Error(
            'La creazione di un file vuoto non e rappresentabile ' +
            'con le invarianti Unified Diff correnti.'
        );
    }

    const oldCount =
        status === 'NEW'
            ? 0
            : oldText.lines.length;

    const newCount =
        newText.lines.length;

    const oldStart =
        oldCount === 0
            ? 0
            : 1;

    const newStart =
        newCount === 0
            ? 0
            : 1;

    const lines: string[] = [
        `diff --git a/${normalizedFilename} b/${normalizedFilename}`
    ];

    if (status === 'NEW') {
        lines.push(
            'new file mode 100644',
            '--- /dev/null',
            `+++ b/${normalizedFilename}`
        );
    } else {
        lines.push(
            `--- a/${normalizedFilename}`,
            `+++ b/${normalizedFilename}`
        );
    }

    lines.push(
        `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
    );

    if (status !== 'NEW') {
        oldText.lines.forEach(
            (line, index) => {
                lines.push(
                    `-${line}`
                );

                if (
                    index ===
                    oldText.lines.length - 1 &&
                    !oldText.hasFinalNewline
                ) {
                    lines.push(
                        '\\ No newline at end of file'
                    );
                }
            }
        );
    }

    newText.lines.forEach(
        (line, index) => {
            lines.push(
                `+${line}`
            );

            if (
                index ===
                newText.lines.length - 1 &&
                !newText.hasFinalNewline
            ) {
                lines.push(
                    '\\ No newline at end of file'
                );
            }
        }
    );

    return `${lines.join('\n')}\n`;
}


export function parseFileDiffs(diffText: string): ParsedFileDiff[] {
    const lines = diffText.replace(/\r\n/g, '\n').split('\n');

    const files: ParsedFileDiff[] = [];

    let currentFile: ParsedFileDiff | null = null;
    let currentHunk: ParsedHunk | null = null;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;

        if (line.startsWith('diff --git ')) {
            currentFile = null;
            currentHunk = null;
            continue;
        }

        const nextLine = lines[index + 1];
        const followingLine = lines[index + 2];

        const isFileHeader = line.startsWith('--- ') && nextLine?.startsWith('+++ ') && followingLine?.startsWith('@@');

        if (isFileHeader) {
            const isNewFile = line.trim() === '--- /dev/null';
            const targetHeader = nextLine!.substring(4);
            const targetFile = targetHeader.split('\t')[0]!.trim().replace(/^b\//, '');

            if (!targetFile || targetFile === '/dev/null') {
                currentFile = null;
                currentHunk = null;
                continue;
            }

            currentFile = {
                file: targetFile,
                isNewFile,
                hunks: []
            };

            files.push(currentFile);

            currentHunk = null;

            index++;
            continue;
        }

        const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);

        if (hunkHeader && currentFile) {
            const oldStart = Number(hunkHeader[1]);
            const oldCount = hunkHeader[2] !== undefined ? Number(hunkHeader[2]) : 1;
            const newStart = Number(hunkHeader[3]);
            const newCount = hunkHeader[4] !== undefined ? Number(hunkHeader[4]) : 1;

            currentHunk = {
                oldStart,
                oldCount,
                newStart,
                newCount,
                lines: []
            };

            currentFile.hunks.push(currentHunk);

            continue;
        }

        if (!currentHunk || line.startsWith('\\')) {
            continue;
        }

        const marker = line[0];
        if (line === '') {
            continue;
        }

        if (marker === '-' || marker === '+') {
            currentHunk.lines.push({
                kind: marker,
                text: line.substring(1)
            });

            continue;
        }
        if (marker === ' ') {
            currentHunk.lines.push({
                kind: ' ',
                text: line.substring(1)
            });
            continue;
        }
    }

    return files;
}

function containsNoOpChangeGroup(
    hunk: ParsedHunk
): boolean {
    let index = 0;

    while (index < hunk.lines.length) {
        if (hunk.lines[index]?.kind === ' ') {
            index++;
            continue;
        }

        const removed: string[] = [];
        const added: string[] = [];

        while (
            index < hunk.lines.length &&
            hunk.lines[index]?.kind !== ' '
        ) {
            const line = hunk.lines[index];

            if (line?.kind === '-') {
                removed.push(line.text);
            } else if (line?.kind === '+') {
                added.push(line.text);
            }

            index++;
        }

        const isNoOpReplacement =
            removed.length > 0 &&
            removed.length === added.length &&
            removed.every(
                (text, lineIndex) =>
                    text === added[lineIndex]
            );

        if (isNoOpReplacement) {
            return true;
        }
    }

    return false;
}

export function validatePatchStructure(diffText: string): PatchStructureValidation {
    const fileDiffs = parseFileDiffs(diffText);
    const violations: PatchStructureViolation[] = [];

    if (fileDiffs.length === 0) {
        return {
            valid: false,
            violations: [
                {
                    code: 'NO_FILE_DIFF',
                    message: 'La patch non contiene alcuna sezione file Unified Diff valida.'
                }
            ]
        };
    }

    for (const fileDiff of fileDiffs) {
        if (fileDiff.hunks.length === 0) {
            violations.push({
                file: fileDiff.file,
                code: 'NO_HUNKS',
                message: `Il file ${fileDiff.file} non contiene hunk validi.`
            });

            continue;
        }

        let fileHasChanges = false;

        fileDiff.hunks.forEach((hunk, hunkIndex) => {
            const removedLines = hunk.lines.filter((line) => line.kind === '-');
            const addedLines = hunk.lines.filter((line) => line.kind === '+');
            const contextLines = hunk.lines.filter((line) => line.kind === ' ');

            if (containsNoOpChangeGroup(hunk)) {
                violations.push({
                    file: fileDiff.file,
                    hunkIndex,
                    code: 'NO_OP_CHANGE_GROUP',
                    message:
                        `L'hunk ${hunkIndex + 1} di ` +
                        `${fileDiff.file} contiene una ` +
                        `sostituzione no-op: le righe ` +
                        `rimosse e aggiunte sono identiche.`
                });
            }

            const actualOldCount = contextLines.length + removedLines.length;
            const actualNewCount = contextLines.length + addedLines.length;
            if (hunk.oldCount !== actualOldCount || hunk.newCount !== actualNewCount) {
                violations.push({
                    file: fileDiff.file,
                    hunkIndex,
                    code: 'HUNK_COUNT_MISMATCH',
                    message: `L'hunk ${hunkIndex + 1} di ` +
                        `${fileDiff.file} dichiara ` +
                        `oldCount=${hunk.oldCount} e ` +
                        `newCount=${hunk.newCount}, ma ` +
                        `contiene rispettivamente ` +
                        `${actualOldCount} righe old-side e ` +
                        `${actualNewCount} righe new-side.`
                });
            }
            const hasChanges = removedLines.length > 0 || addedLines.length > 0;

            if (!hasChanges) {
                violations.push({
                    file: fileDiff.file,
                    hunkIndex,
                    code: 'EMPTY_CHANGE_GROUP',
                    message: `L’hunk ${hunkIndex + 1} di ${fileDiff.file} contiene soltanto righe di contesto.`
                });

                return;
            }

            fileHasChanges = true;

            if (fileDiff.isNewFile && hunk.lines.some((line) => line.kind !== '+')) {
                violations.push({
                    file: fileDiff.file,
                    hunkIndex,
                    code: 'NEW_FILE_CONTAINS_NON_ADDITIONS',
                    message: `Il nuovo file ${fileDiff.file} deve contenere esclusivamente righe aggiunte con prefisso '+'.`
                });
            }
        });

        if (!fileHasChanges) {
            violations.push({
                file: fileDiff.file,
                code: 'NO_CHANGES',
                message: `La patch per ${fileDiff.file} non contiene modifiche effettive.`
            });
        }
    }
    return {
        valid: violations.length === 0,
        violations
    };
}

export function measurePatchGrounding(diffText: string, sources: Readonly<Record<string, string>>): PatchGrounding {
    let hunks = 0;
    let ungroundedHunks = 0;
    let oldSideLines = 0;
    let ungroundedLines = 0;

    const fileDiffs = parseFileDiffs(diffText);

    for (const fileDiff of fileDiffs) {
        if (fileDiff.isNewFile) {
            continue;
        }

        const source = sources[fileDiff.file];

        if (source === undefined || source === '') {
            continue;
        }

        const fileLines = source.replace(/\r\n/g, '\n').split('\n');

        const presentLines = new Set(fileLines.map(normalize));

        for (const hunk of fileDiff.hunks) {
            const oldSide = hunk.lines.filter((line) => line.kind !== '+').map((line) => normalize(line.text));
            const meaningfulLines = oldSide.filter((text) => text !== '');

            if (meaningfulLines.length === 0) {
                continue;
            }

            hunks++;
            oldSideLines += meaningfulLines.length;
            ungroundedLines += meaningfulLines.filter((text) => !presentLines.has(text)).length;

            if (findBlocks(fileLines, oldSide).length === 0
            ) {
                ungroundedHunks++;
            }
        }
    }

    return {
        hunks,
        ungroundedHunks,
        oldSideLines,
        ungroundedLines
    };
}

export function normalizeRejectedDiff(diffText: string, sources: Readonly<Record<string, string>>): PatchNormalizationResult | null {
    const structure = validatePatchStructure(diffText);
    const onlyHunkCountMismatches =
        !structure.valid &&
        structure.violations.length > 0 &&
        structure.violations.every(
            (violation) =>
                violation.code ===
                'HUNK_COUNT_MISMATCH'
        );
    if (
        !structure.valid &&
        !onlyHunkCountMismatches
    ) {
        return null;
    }

    const parsedFileDiffs = parseFileDiffs(diffText);
    let repairedHunks = 0;

    const fileDiffs: ParsedFileDiff[] =
        onlyHunkCountMismatches
            ? parsedFileDiffs.map(
                (fileDiff) => ({
                    ...fileDiff,

                    hunks:
                        fileDiff.hunks.map(
                            (hunk) => {
                                const oldCount =
                                    hunk.lines.filter(
                                        (line) =>
                                            line.kind !== '+'
                                    ).length;

                                const newCount =
                                    hunk.lines.filter(
                                        (line) =>
                                            line.kind !== '-'
                                    ).length;

                                if (
                                    oldCount !==
                                    hunk.oldCount ||
                                    newCount !==
                                    hunk.newCount
                                ) {
                                    repairedHunks++;
                                }

                                return {
                                    ...hunk,
                                    oldCount,
                                    newCount
                                };
                            }
                        )
                })
            )
            : parsedFileDiffs;

    const normalizedFiles: ParsedFileDiff[] = [];

    for (const fileDiff of fileDiffs) {
        if (fileDiff.isNewFile) {
            normalizedFiles.push(fileDiff);
            continue;
        }

        const source = sources[fileDiff.file];

        if (source === undefined) {
            return null;
        }

        const sourceLines = source.replace(/\r\n/g, '\n').split('\n');
        const normalizedHunks: ParsedHunk[] = [];

        for (const hunk of fileDiff.hunks) {
            const alreadyGrounded = hunk.lines.filter((line) => line.kind !== '+').map((line) => normalize(line.text));
            if (alreadyGrounded.length > 0 && findBlocks(sourceLines, alreadyGrounded).length > 0
            ) {
                normalizedHunks.push(hunk);
                continue;
            }

            const repaired = repairHunkAgainstOriginal(hunk, sourceLines);
            if (!repaired) {
                return null;
            }
            normalizedHunks.push(repaired);
            repairedHunks++;
        }

        normalizedFiles.push({
            file: fileDiff.file,
            isNewFile: false,
            hunks: normalizedHunks
        });
    }

    if (repairedHunks === 0) {
        return {
            normalized: false,
            diffText,
            repairedHunks: 0
        };
    }

    const normalizedDiff = renderFileDiffs(normalizedFiles);
    const normalizedStructure = validatePatchStructure(normalizedDiff);

    if (!normalizedStructure.valid) {
        return null;
    }

    for (const fileDiff of normalizedFiles) {
        if (fileDiff.isNewFile) {
            continue;
        }

        const source = sources[fileDiff.file];

        if (source === undefined) {
            return null;
        }

        const normalizedContent = applyHunksToContent(source, fileDiff.hunks);

        if (normalizedContent === null) {
            return null;
        }
    }

    return {
        normalized: true,
        diffText: normalizedDiff,
        repairedHunks
    };
}

function repairHunkAgainstOriginal(hunk: ParsedHunk, sourceLines: readonly string[]): ParsedHunk | null {
    const sourceStart = hunk.oldStart - 1;

    if (sourceStart < 0 || sourceStart >= sourceLines.length) {
        return null;
    }

    const repairedLines: ParsedHunk['lines'] = [];
    let sourceCursor = sourceStart;
    let repairedContextLines = 0;

    for (let index = 0; index < hunk.lines.length; index++) {
        const line = hunk.lines[index]!;

        if (line.kind === '+') {
            repairedLines.push(line);
            continue;
        }

        const originalLine = sourceLines[sourceCursor];

        if (originalLine === undefined) {
            return null;
        }

        if (line.kind === '-') {
            if (normalize(originalLine) !== normalize(line.text)) {
                return null;
            }

            repairedLines.push({
                kind: '-',
                text: originalLine
            });

            sourceCursor++;
            continue;
        }

        if (normalize(originalLine) === normalize(line.text)) {
            repairedLines.push({
                kind: ' ',
                text: originalLine
            });

            sourceCursor++;
            continue;
        }

        const previousLine = hunk.lines[index - 1];
        let precedingGroupHasRemoval = false;
        for (let back = index - 1; back >= 0 && hunk.lines[back]!.kind !== ' '; back--) {
            if (hunk.lines[back]!.kind === '-') {
                precedingGroupHasRemoval = true;
                break;
            }
        }

        const followsReplacementGroup = previousLine?.kind === '+' && precedingGroupHasRemoval;
        if (!followsReplacementGroup) {
            return null;
        }

        if (repairedContextLines > 0) {
            return null;
        }

        const desiredMatches = sourceLines.filter((candidate) => normalize(candidate) === normalize(line.text));

        if (desiredMatches.length > 0) {
            return null;
        }

        repairedLines.push(
            {
                kind: '-',
                text: originalLine
            },
            {
                kind: '+',
                text: line.text
            }
        );

        repairedContextLines++;
        sourceCursor++;
    }

    if (repairedContextLines !== 1) {
        return null;
    }

    const oldCount =
        repairedLines.filter(
            (line) =>
                line.kind !== '+'
        ).length;

    const newCount =
        repairedLines.filter(
            (line) =>
                line.kind !== '-'
        ).length;

    return {
        oldStart:
            hunk.oldStart,

        oldCount,

        newStart:
            hunk.newStart,

        newCount,

        lines:
            repairedLines
    };
}

function renderFileDiffs(fileDiffs: readonly ParsedFileDiff[]): string {
    const blocks = fileDiffs.map((fileDiff) => {
        const lines: string[] = [];
        lines.push(`diff --git a/${fileDiff.file} b/${fileDiff.file}`);

        if (fileDiff.isNewFile) {
            lines.push(
                'new file mode 100644',
                '--- /dev/null',
                `+++ b/${fileDiff.file}`
            );
        } else {
            lines.push(
                `--- a/${fileDiff.file}`,
                `+++ b/${fileDiff.file}`
            );
        }

        for (const hunk of fileDiff.hunks) {
            lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);

            for (const line of hunk.lines) {
                lines.push(`${line.kind}${line.text}`);
            }
        }

        return lines.join('\n');
    });

    return `${blocks.join('\n')}\n`;
}

export function applyHunksToContent(content: string, hunks: readonly ParsedHunk[]): string | null {
    const endOfLine = content.includes('\r\n') ? '\r\n' : '\n';

    if (content.trim() === '' && hunks.length > 0) {
        const isNewFilePatch = hunks.every((hunk) => hunk.oldStart === 0 && hunk.lines.every((line) => line.kind === '+'));

        if (!isNewFilePatch) {
            return null;
        }

        const newLines = hunks.flatMap((hunk) => hunk.lines.map((line) => line.text));

        return newLines.join(endOfLine);
    }

    const fileLines = content.replace(/\r\n/g, '\n').split('\n');

    const edits: Edit[] = [];

    for (const hunk of hunks) {
        const oldSideLines = hunk.lines.filter((line) => line.kind !== '+').map((line) => normalize(line.text));
        if (oldSideLines.length > 0 && findBlocks(fileLines, oldSideLines).length === 0) {
            return null;
        }

        const groups = toGroups(hunk);

        for (const group of groups) {
            const edit = locateGroup(fileLines, group);

            if (!edit) {
                return null;
            }

            edits.push(edit);
        }
    }

    if (edits.length === 0) {
        return null;
    }

    const orderedEdits = edits.map((edit, index) => ({
        edit,
        index
    })).sort((first, second) => first.edit.start - second.edit.start || first.index - second.index)
        .map(({ edit }) => edit);

    const output: string[] = [];
    let cursor = 0;

    for (const edit of orderedEdits) {
        if (edit.start < cursor) {
            return null;
        }

        output.push(
            ...fileLines.slice(
                cursor,
                edit.start
            ),
            ...edit.insert
        );

        cursor = edit.start + edit.deleteCount;
    }

    output.push(...fileLines.slice(cursor));

    return output.join(endOfLine);
}

function toGroups(hunk: ParsedHunk): ChangeGroup[] {
    const groups: ChangeGroup[] = [];
    const lines = hunk.lines;

    let oldOffset = 0;
    let index = 0;

    while (index < lines.length) {
        if (lines[index]!.kind === ' ') {
            oldOffset++;
            index++;
            continue;
        }

        const before: string[] = [];

        for (let back = index - 1; back >= 0 && lines[back]!.kind === ' '; back--) {
            before.unshift(lines[back]!.text);
        }

        const removed: string[] = [];
        const added: string[] = [];

        const hint = hunk.oldStart - 1 + oldOffset;

        while (index < lines.length && lines[index]!.kind !== ' ') {
            const line = lines[index]!;

            if (line.kind === '-') {
                removed.push(line.text);
                oldOffset++;
            } else {
                added.push(line.text);
            }

            index++;
        }

        const after: string[] = [];

        for (let ahead = index; ahead < lines.length && lines[ahead]!.kind === ' '; ahead++) {
            after.push(lines[ahead]!.text);
        }

        groups.push({
            removed,
            added,
            before,
            after,
            hint
        });
    }

    return groups;
}

function normalize(line: string): string {
    return line.replace(/\s+/g, ' ').trim();
}

function locateGroup(
    fileLines: readonly string[],
    group: ChangeGroup
): Edit | null {
    if (
        group.removed.length > 0
    ) {
        const removedLines =
            group.removed.map(
                normalize
            );

        const matches =
            findBlocks(
                fileLines,
                removedLines
            );

        if (
            matches.length === 0
        ) {
            return null;
        }

        const start =
            pickUnambiguousCandidate(
                fileLines,
                matches,
                group,
                removedLines.length
            );

        if (
            start === null
        ) {
            return null;
        }

        return {
            start,

            deleteCount:
                removedLines.length,

            insert:
                group.added
        };
    }

    if (
        group.added.length === 0
    ) {
        return null;
    }

    const position =
        insertionPoint(
            fileLines,
            group
        );

    if (
        position === null
    ) {
        return null;
    }

    return {
        start:
            position,

        deleteCount:
            0,

        insert:
            group.added
    };
}
function findBlocks(fileLines: readonly string[], expected: readonly string[]): number[] {
    const matches: number[] = [];

    for (let start = 0; start + expected.length <= fileLines.length; start++) {
        const blockMatches = expected.every((text, offset) => normalize(fileLines[start + offset]!) === text);

        if (blockMatches) {
            matches.push(start);
        }
    }

    return matches;
}

function contextScore(fileLines: readonly string[], start: number, length: number, group: ChangeGroup): number {
    let score = 0;

    for (let offset = 1; offset <= group.before.length; offset++) {
        const fileLine = fileLines[start - offset];
        const contextLine = group.before[group.before.length - offset]!;

        if (fileLine === undefined || normalize(fileLine) !== normalize(contextLine)) {
            break;
        }

        score++;
    }

    for (let offset = 0; offset < group.after.length; offset++) {
        const fileLine = fileLines[start + length + offset];
        const contextLine = group.after[offset]!;

        if (fileLine === undefined || normalize(fileLine) !== normalize(contextLine)) {
            break;
        }

        score++;
    }

    return score;
}

function pickUnambiguousCandidate(
    fileLines: readonly string[],
    candidates: readonly number[],
    group: ChangeGroup,
    length: number
): number | null {
    if (
        candidates.length === 0
    ) {
        return null;
    }

    if (
        candidates.length === 1
    ) {
        return candidates[0]!;
    }

    const scoredCandidates =
        candidates.map(
            (start) => ({
                start,

                score:
                    contextScore(
                        fileLines,
                        start,
                        length,
                        group
                    )
            })
        );

    const highestScore =
        Math.max(
            ...scoredCandidates.map(
                ({ score }) =>
                    score
            )
        );

    const bestCandidates =
        scoredCandidates.filter(
            ({ score }) =>
                score === highestScore
        );
    if (
        bestCandidates.length !== 1
    ) {
        return null;
    }

    return bestCandidates[0]!.start;
}

function insertionPoint(
    fileLines: readonly string[],
    group: ChangeGroup
): number | null {
    const limit =
        fileLines[
            fileLines.length - 1
        ] === ''
            ? fileLines.length - 1
            : fileLines.length;

    const meaningfulBefore =
        group.before.filter(
            (line) =>
                normalize(line) !== ''
        );

    const meaningfulAfter =
        group.after.filter(
            (line) =>
                normalize(line) !== ''
        );

    if (
        meaningfulBefore.length === 0 &&
        meaningfulAfter.length === 0
    ) {
        return null;
    }

    const candidatePositions:
        number[] = [];

    for (
        let position = 0;
        position <= limit;
        position++
    ) {
        let score =
            0;

        for (
            let offset = 1;
            offset <=
            meaningfulBefore.length;
            offset++
        ) {
            const fileLine =
                fileLines[
                position - offset
                ];

            const contextLine =
                meaningfulBefore[
                meaningfulBefore.length -
                offset
                ];

            if (
                fileLine === undefined ||
                contextLine === undefined ||
                normalize(fileLine) !==
                normalize(contextLine)
            ) {
                break;
            }

            score++;
        }

        for (
            let offset = 0;
            offset <
            meaningfulAfter.length;
            offset++
        ) {
            const fileLine =
                fileLines[
                position + offset
                ];

            const contextLine =
                meaningfulAfter[offset];

            if (
                fileLine === undefined ||
                contextLine === undefined ||
                normalize(fileLine) !==
                normalize(contextLine)
            ) {
                break;
            }

            score++;
        }

        if (
            score > 0
        ) {
            candidatePositions.push(
                position
            );
        }
    }

    if (
        candidatePositions.length === 0
    ) {
        return null;
    }

    const scoredCandidates =
        candidatePositions.map(
            (position) => ({
                position,

                score:
                    contextScore(
                        fileLines,
                        position,
                        0,
                        group
                    )
            })
        );

    const highestScore =
        Math.max(
            ...scoredCandidates.map(
                ({ score }) =>
                    score
            )
        );

    const bestCandidates =
        scoredCandidates.filter(
            ({ score }) =>
                score === highestScore
        );

    if (
        bestCandidates.length !== 1
    ) {
        return null;
    }

    return bestCandidates[0]!.position;
}
