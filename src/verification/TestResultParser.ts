export interface ParsedTestSummary {
    readonly totalTests: number;
    readonly passedTests: number;
    readonly failedTests: number;
    readonly skippedTests: number;
    readonly xfailedTests: number;
    readonly xpassedTests: number;
    readonly errorTests: number;
    readonly zeroTestsCollected: boolean;
}

export interface TestResultParser {
    parse(output: string): ParsedTestSummary | null;
}
