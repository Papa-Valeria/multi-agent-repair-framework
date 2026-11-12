export function canonicalizeWorkspacePath(
    filePath: string
): string {
    let normalized =
        filePath
            .replaceAll('\\', '/')
            .trim();

    while (normalized.startsWith('./')) {
        normalized = normalized.substring(2);
    }

    if (
        normalized.startsWith('a/') ||
        normalized.startsWith('b/')
    ) {
        normalized = normalized.substring(2);
    }

    const segments = normalized.split('/');
    const canonicalSegments: string[] = [];

    for (const segment of segments) {
        if (!segment || segment === '.') {
            continue;
        }

        if (segment === '..') {
            canonicalSegments.push(segment);
            continue;
        }

        canonicalSegments.push(segment);
    }

    return canonicalSegments.join('/');
}

export function workspacePathsEqual(
    left: string,
    right: string
): boolean {
    return (
        canonicalizeWorkspacePath(left) ===
        canonicalizeWorkspacePath(right)
    );
}

