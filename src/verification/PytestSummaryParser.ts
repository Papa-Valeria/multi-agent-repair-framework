import type { ParsedTestSummary, TestResultParser } from './TestResultParser.js';

const safeAdd = (
    current: number,
    increment: number
): number | null => {
    const result =
        current + increment;

    if (
        !Number.isSafeInteger(result) ||
        result < 0
    ) {
        return null;
    }

    return result;
};

export function parsePytestSummary(output: string): ParsedTestSummary | null {
    const normalizedOutput = output.replace(/\r\n/g, '\n').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
    const zeroTestsCollected = /\bno tests ran\b/i.test(normalizedOutput) || /\bcollected 0 items?\b/i.test(normalizedOutput);
    if (zeroTestsCollected) {
        return {
            totalTests: 0,
            passedTests: 0,
            failedTests: 0,
            skippedTests: 0,
            xfailedTests: 0,
            xpassedTests: 0,
            errorTests: 0,
            zeroTestsCollected: true
        };
    }

    const lines = normalizedOutput.split('\n').map(line => line.trim()).filter((line) => line.length > 0);

    const summaryLine = [...lines].reverse().find((line) => {
        const withoutMarkers = line.replace(/^=+\s*/, '').replace(/\s*=+$/, '');
        const containsTestOutcome = /\b\d+\s+(?:passed|failed|errors?|skipped|xfailed|xpassed)\b/i.test(withoutMarkers);
        const hasValidDuration = /\bin\s+\d+(?:\.\d+)?s\s*$/i.test(withoutMarkers);
        return containsTestOutcome && hasValidDuration;
    });

    if (!summaryLine) return null;

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;
    let skippedTests = 0;
    let xfailedTests = 0;
    let xpassedTests = 0;
    let errorTests = 0;

    const outcomePatterns = /(\d+)\s+(passed|failed|error|errors|skipped|xfailed|xpassed)\b/gi;
    for (const match of summaryLine.matchAll(outcomePatterns)) {
        const rawCount = match[1];
        const rawOutcome = match[2];
        if (!rawCount || !rawOutcome) continue;
        const count = Number(rawCount);
        const outcome = rawOutcome.toLowerCase();

        if (!Number.isSafeInteger(count) || count < 0) return null;

        switch (outcome) {
            case 'passed': {
                const next =
                    safeAdd(
                        passedTests,
                        count
                    );

                if (next === null) {
                    return null;
                }

                passedTests =
                    next;

                break;
            }

            case 'failed': {
                const next =
                    safeAdd(
                        failedTests,
                        count
                    );

                if (next === null) {
                    return null;
                }

                failedTests =
                    next;

                break;
            }

            case 'skipped': {
                const next =
                    safeAdd(
                        skippedTests,
                        count
                    );

                if (next === null) {
                    return null;
                }

                skippedTests =
                    next;

                break;
            }

            case 'xfailed': {
                const next =
                    safeAdd(
                        xfailedTests,
                        count
                    );

                if (next === null) {
                    return null;
                }

                xfailedTests =
                    next;

                break;
            }

            case 'xpassed': {
                const next =
                    safeAdd(
                        xpassedTests,
                        count
                    );

                if (next === null) {
                    return null;
                }

                xpassedTests =
                    next;

                break;
            }

            case 'error':
            case 'errors': {
                const next =
                    safeAdd(
                        errorTests,
                        count
                    );

                if (next === null) {
                    return null;
                }

                errorTests =
                    next;

                break;
            }
        }
    }

    const counters = [
        passedTests,
        failedTests,
        skippedTests,
        xfailedTests,
        xpassedTests,
        errorTests
    ];

    for (
        const counter of counters
    ) {
        const nextTotal =
            safeAdd(
                totalTests,
                counter
            );

        if (nextTotal === null) {
            return null;
        }

        totalTests =
            nextTotal;
    }

    if (
        totalTests === 0
    ) {
        return null;
    }

    return { totalTests, passedTests, failedTests, skippedTests, xfailedTests, xpassedTests, errorTests, zeroTestsCollected: false };
}

export const pytestResultParser:
    TestResultParser = {
    parse: parsePytestSummary
};
