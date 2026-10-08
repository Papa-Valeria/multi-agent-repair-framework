export interface ParsedPytestSummary {
    readonly totalTests: number;
    readonly passedTests: number;
    readonly failedTests: number;
    readonly skippedTests: number;
    readonly xfailedTests: number;
    readonly errorTests: number;
}

export function parsePytestSummary(output: string): ParsedPytestSummary | null {
    const summaryLine = output.split(/\r?\n/).find((line) =>
        /^(?:=+\s*)?(?:(?:\d+\s+(?:passed|failed|errors?|skipped|xfailed|xpassed)\s*,?\s*)+in\s+\d+(?:\.\d+)?s|(?:\d+\s+errors?\s+in\s+\d+(?:\.\d+)?s))(?:\s*=+)?\s*$/i.test(line.trim())
    );

    if (!summaryLine) return null;

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let skippedTests = 0;
    let xfailedTests = 0;
    let errorTests = 0;

    for (const match of summaryLine.matchAll(/(\d+)\s+(passed|failed|error|errors|skipped|xfailed|xpassed)/gi)) {
        const count = Number(match[1]);
        const outcome = match[2]?.toLowerCase();

        if (outcome !== 'xfailed') totalTests += count;
        if (outcome === 'passed' || outcome === 'xpassed') passedTests += count;
        if (outcome === 'failed') failedTests += count;
        if (outcome === 'skipped') skippedTests += count;
        if (outcome === 'xfailed') xfailedTests += count;
        if (outcome === 'error' || outcome === 'errors') errorTests += count;
    }

    if (totalTests === 0 && errorTests > 0) {
        totalTests = errorTests;
    }

    return { totalTests, passedTests, failedTests, skippedTests, xfailedTests, errorTests };
}
