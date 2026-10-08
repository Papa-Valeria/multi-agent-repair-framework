export interface ParsedHunk {
    readonly oldStart: number;
    readonly lines: Array<{ readonly kind: ' ' | '-' | '+'; readonly text: string }>;
}

export interface ParsedFileDiff {
    readonly file: string;
    readonly isNewFile: boolean;
    readonly hunks: ParsedHunk[];
}

export function parseFileDiffs(diffText: string): ParsedFileDiff[] {
    const lines = diffText.replace(/\r\n/g, '\n').split('\n');
    const files: ParsedFileDiff[] = [];
    let current: ParsedFileDiff | null = null;
    let hunk: ParsedHunk | null = null;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        if (line.startsWith('diff --git ')) {
            current = null;
            hunk = null;
            continue;
        }

        // Supporta sia --- a/file sia --- /dev/null per i nuovi file
        if (line.startsWith('--- ') && lines[index + 1]?.startsWith('+++ ') && lines[index + 2]?.startsWith('@@')) {
            const isNewFile = line.trim() === '--- /dev/null';
            const target = lines[index + 1]!.slice(4).split('\t')[0]!.trim().replace(/^b\//, '');
            current = { file: target, isNewFile, hunks: [] };
            files.push(current);
            hunk = null;
            index++;
            continue;
        }

        const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (header && current) {
            hunk = { oldStart: Number(header[1]), lines: [] };
            current.hunks.push(hunk);
            continue;
        }

        if (!hunk || line.startsWith('\\')) continue;
        const marker = line[0];
        if (marker === '-' || marker === '+') {
            hunk.lines.push({ kind: marker, text: line.slice(1) });
        } else {
            hunk.lines.push({ kind: ' ', text: marker === ' ' ? line.slice(1) : line });
        }
    }

    for (const file of files) {
        for (const parsed of file.hunks) {
            while (parsed.lines.length > 0) {
                const last = parsed.lines[parsed.lines.length - 1]!;
                if (last.kind !== ' ' || last.text.trim() !== '') break;
                parsed.lines.pop();
            }
        }
    }

    return files;
}

export interface PatchGrounding {
    readonly hunks: number;
    readonly ungroundedHunks: number;
    readonly oldSideLines: number;
    readonly ungroundedLines: number;
}

export function measurePatchGrounding(
    diffText: string,
    sources: Readonly<Record<string, string>>
): PatchGrounding {
    const names = Object.keys(sources);
    let hunks = 0;
    let ungroundedHunks = 0;
    let oldSideLines = 0;
    let ungroundedLines = 0;

    for (const fileDiff of parseFileDiffs(diffText)) {
        // In accordo con RF-12: hunk di creazione/sola aggiunta non hanno lato vecchio da ancorare
        if (fileDiff.isNewFile) continue;

        const source = sources[fileDiff.file] ?? (names.length === 1 ? sources[names[0]!] : undefined);
        if (source === undefined || source === '') continue;

        const fileLines = source.replace(/\r\n/g, '\n').split('\n');
        const present = new Set(fileLines.map(normalize));

        for (const hunk of fileDiff.hunks) {
            const oldSide = hunk.lines.filter((line) => line.kind !== '+').map((line) => normalize(line.text));
            const meaningful = oldSide.filter((text) => text !== '');
            if (meaningful.length === 0) continue;

            hunks++;
            oldSideLines += meaningful.length;
            ungroundedLines += meaningful.filter((text) => !present.has(text)).length;
            if (findBlocks(fileLines, oldSide).length === 0) ungroundedHunks++;
        }
    }

    return { hunks, ungroundedHunks, oldSideLines, ungroundedLines };
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

export function applyHunksToContent(content: string, hunks: readonly ParsedHunk[]): string | null {
    const eol = content.includes('\r\n') ? '\r\n' : '\n';

    // Se il file era inesistente o vuoto e l'hunk è una sintesi ex-novo (oldStart == 0 o sola aggiunta)
    if (content.trim() === '' && hunks.length > 0 && hunks.every((h) => h.oldStart === 0 || h.lines.every((l) => l.kind === '+'))) {
        const newLines = hunks.flatMap((h) => h.lines.filter((l) => l.kind === '+').map((l) => l.text));
        return newLines.join(eol);
    }

    const fileLines = content.replace(/\r\n/g, '\n').split('\n');
    const edits: Edit[] = [];

    for (const hunk of hunks) {
        for (const group of toGroups(hunk)) {
            const edit = locateGroup(fileLines, group);
            if (edit) edits.push(edit);
        }
    }

    if (edits.length === 0) return null;

    const ordered = edits
        .map((edit, index) => ({ edit, index }))
        .sort((a, b) => a.edit.start - b.edit.start || a.index - b.index)
        .map(({ edit }) => edit);

    const output: string[] = [];
    let cursor = 0;

    for (const edit of ordered) {
        if (edit.start < cursor) continue;
        output.push(...fileLines.slice(cursor, edit.start), ...edit.insert);
        cursor = edit.start + edit.deleteCount;
    }

    output.push(...fileLines.slice(cursor));
    return output.join(eol);
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
        for (let back = index - 1; back >= 0 && lines[back]!.kind === ' '; back--) before.unshift(lines[back]!.text);

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
        for (let ahead = index; ahead < lines.length && lines[ahead]!.kind === ' '; ahead++) after.push(lines[ahead]!.text);

        groups.push({ removed, added, before, after, hint });
    }

    return groups;
}

function normalize(line: string): string {
    return line.replace(/\s+/g, ' ').trim();
}

function locateGroup(fileLines: readonly string[], group: ChangeGroup): Edit | null {
    if (group.removed.length > 0) {
        const removed = group.removed.map(normalize);
        const exact = findBlocks(fileLines, removed);
        if (exact.length > 0) {
            return { start: pickBest(fileLines, exact, group), deleteCount: removed.length, insert: group.added };
        }
        const window = bestWindow(fileLines, removed, group);
        if (window >= 0) return { start: window, deleteCount: removed.length, insert: group.added };
    }

    if (group.added.length === 0) return null;
    return { start: insertionPoint(fileLines, group), deleteCount: 0, insert: group.added };
}

function findBlocks(fileLines: readonly string[], expected: readonly string[]): number[] {
    const matches: number[] = [];
    for (let start = 0; start + expected.length <= fileLines.length; start++) {
        if (expected.every((text, offset) => normalize(fileLines[start + offset]!) === text)) matches.push(start);
    }
    return matches;
}

function contextScore(fileLines: readonly string[], start: number, length: number, group: ChangeGroup): number {
    let score = 0;
    for (let offset = 1; offset <= group.before.length; offset++) {
        const fileLine = fileLines[start - offset];
        if (fileLine === undefined || normalize(fileLine) !== normalize(group.before[group.before.length - offset]!)) break;
        score++;
    }
    for (let offset = 0; offset < group.after.length; offset++) {
        const fileLine = fileLines[start + length + offset];
        if (fileLine === undefined || normalize(fileLine) !== normalize(group.after[offset]!)) break;
        score++;
    }
    return score;
}

function pickBest(fileLines: readonly string[], candidates: readonly number[], group: ChangeGroup, length = group.removed.length): number {
    let best = candidates[0]!;
    let bestScore = -1;
    for (const start of candidates) {
        const score = contextScore(fileLines, start, length, group);
        if (score > bestScore || (score === bestScore && Math.abs(start - group.hint) < Math.abs(best - group.hint))) {
            best = start;
            bestScore = score;
        }
    }
    return best;
}

function bestWindow(fileLines: readonly string[], removed: readonly string[], group: ChangeGroup): number {
    const candidates: number[] = [];
    let bestMatches = 0;
    for (let start = 0; start + removed.length <= fileLines.length; start++) {
        const matches = removed.filter((text, offset) => normalize(fileLines[start + offset]!) === text).length;
        if (matches > bestMatches) {
            bestMatches = matches;
            candidates.length = 0;
        }
        if (matches > 0 && matches === bestMatches) candidates.push(start);
    }
    return candidates.length > 0 ? pickBest(fileLines, candidates, group) : -1;
}

function insertionPoint(fileLines: readonly string[], group: ChangeGroup): number {
    const limit = fileLines[fileLines.length - 1] === '' ? fileLines.length - 1 : fileLines.length;
    const nearestTo = (matches: readonly number[], target: number): number =>
        matches.reduce((best, candidate) => (Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best), matches[0]!);
    const indicesOf = (text: string): number[] =>
        fileLines.flatMap((line, index) => (normalize(line) === normalize(text) ? [index] : []));

    for (let k = group.before.length - 1; k >= 0; k--) {
        if (normalize(group.before[k]!) === '') continue;
        const matches = indicesOf(group.before[k]!);
        if (matches.length > 0) return Math.min(limit, nearestTo(matches, group.hint - (group.before.length - k)) + 1 + (group.before.length - 1 - k));
        break;
    }

    for (let k = 0; k < group.after.length; k++) {
        if (normalize(group.after[k]!) === '') continue;
        const matches = indicesOf(group.after[k]!);
        if (matches.length > 0) return Math.max(0, nearestTo(matches, group.hint + k) - k);
        break;
    }

    return Math.max(0, Math.min(group.hint, limit));
}
