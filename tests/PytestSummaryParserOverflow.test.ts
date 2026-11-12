import {
    describe,
    expect,
    it
} from '@jest/globals';

import {
    parsePytestSummary,
    pytestResultParser
} from '../src/verification/PytestSummaryParser.js';

describe(
    'BE-P1-33 - Pytest Summary Parser safe integer overflow',
    () => {
        it(
            'rifiuta un conteggio individuale maggiore di Number.MAX_SAFE_INTEGER',
            () => {
                const unsafeCount =
                    Number.MAX_SAFE_INTEGER + 1;

                const output =
                    `================ ${unsafeCount} passed in 1.00s ================`;

                expect(
                    parsePytestSummary(
                        output
                    )
                ).toBeNull();
            }
        );

        it(
            'rifiuta totalTests quando conteggi individualmente safe superano MAX_SAFE_INTEGER nella somma',
            () => {
                const firstCount =
                    Number.MAX_SAFE_INTEGER;

                const secondCount =
                    1;

                expect(
                    Number.isSafeInteger(
                        firstCount
                    )
                ).toBe(
                    true
                );

                expect(
                    Number.isSafeInteger(
                        secondCount
                    )
                ).toBe(
                    true
                );

                const output =
                    `================ ${firstCount} passed, ${secondCount} failed in 1.00s ================`;

                expect(
                    parsePytestSummary(
                        output
                    )
                ).toBeNull();
            }
        );

        it(
            'rifiuta overflow cumulativo dello stesso outcome',
            () => {
                const firstCount =
                    Number.MAX_SAFE_INTEGER;

                const secondCount =
                    1;

                const output =
                    `================ ${firstCount} passed, ${secondCount} passed in 1.00s ================`;

                expect(
                    parsePytestSummary(
                        output
                    )
                ).toBeNull();
            }
        );

        it(
            'accetta la somma esattamente uguale a Number.MAX_SAFE_INTEGER',
            () => {
                const passedTests =
                    Number.MAX_SAFE_INTEGER - 1;

                const failedTests =
                    1;

                const output =
                    `================ ${passedTests} passed, ${failedTests} failed in 1.00s ================`;

                const result =
                    parsePytestSummary(
                        output
                    );

                expect(
                    result
                ).not.toBeNull();

                expect(
                    result
                ).toEqual({
                    totalTests:
                        Number.MAX_SAFE_INTEGER,

                    passedTests,

                    failedTests:
                        1,

                    skippedTests:
                        0,

                    xfailedTests:
                        0,

                    xpassedTests:
                        0,

                    errorTests:
                        0,

                    zeroTestsCollected:
                        false
                });
            }
        );

        it(
            'continua a parsare una summary ordinaria',
            () => {
                const output =
                    '===== 8 passed, 2 failed, 3 skipped, 1 xfailed, 1 xpassed, 2 errors in 2.50s =====';

                expect(
                    parsePytestSummary(
                        output
                    )
                ).toEqual({
                    totalTests:
                        17,

                    passedTests:
                        8,

                    failedTests:
                        2,

                    skippedTests:
                        3,

                    xfailedTests:
                        1,

                    xpassedTests:
                        1,

                    errorTests:
                        2,

                    zeroTestsCollected:
                        false
                });
            }
        );

        it(
            'mantiene il comportamento zero-test per no tests ran',
            () => {
                const output =
                    '================ no tests ran in 0.01s ================';

                expect(
                    parsePytestSummary(
                        output
                    )
                ).toEqual({
                    totalTests:
                        0,

                    passedTests:
                        0,

                    failedTests:
                        0,

                    skippedTests:
                        0,

                    xfailedTests:
                        0,

                    xpassedTests:
                        0,

                    errorTests:
                        0,

                    zeroTestsCollected:
                        true
                });
            }
        );

        it(
            'mantiene il comportamento zero-test per collected 0 items',
            () => {
                const output =
                    [
                        '================ test session starts ================',
                        'collected 0 items',
                        '',
                        '================ no tests ran in 0.01s ================'
                    ].join('\n');

                expect(
                    parsePytestSummary(
                        output
                    )
                ).toEqual({
                    totalTests:
                        0,

                    passedTests:
                        0,

                    failedTests:
                        0,

                    skippedTests:
                        0,

                    xfailedTests:
                        0,

                    xpassedTests:
                        0,

                    errorTests:
                        0,

                    zeroTestsCollected:
                        true
                });
            }
        );

        it(
            'continua a rimuovere ANSI prima del parsing',
            () => {
                const output =
                    '\u001B[32m===== 3 passed, 1 skipped in 0.25s =====\u001B[0m';

                expect(
                    parsePytestSummary(
                        output
                    )
                ).toEqual({
                    totalTests:
                        4,

                    passedTests:
                        3,

                    failedTests:
                        0,

                    skippedTests:
                        1,

                    xfailedTests:
                        0,

                    xpassedTests:
                        0,

                    errorTests:
                        0,

                    zeroTestsCollected:
                        false
                });
            }
        );

        it(
            'continua a normalizzare CRLF durante il parsing',
            () => {
                const output =
                    [
                        '================ test session starts ================',
                        'platform win32 -- Python',
                        '================ 4 passed, 2 failed in 0.50s ================'
                    ].join('\r\n');

                expect(
                    parsePytestSummary(
                        output
                    )
                ).toEqual({
                    totalTests:
                        6,

                    passedTests:
                        4,

                    failedTests:
                        2,

                    skippedTests:
                        0,

                    xfailedTests:
                        0,

                    xpassedTests:
                        0,

                    errorTests:
                        0,

                    zeroTestsCollected:
                        false
                });
            }
        );

        it(
            'mantiene pytestResultParser coerente con parsePytestSummary',
            () => {
                const output =
                    '===== 5 passed, 1 failed in 0.10s =====';

                expect(
                    pytestResultParser.parse(
                        output
                    )
                ).toEqual(
                    parsePytestSummary(
                        output
                    )
                );
            }
        );
    }
);
