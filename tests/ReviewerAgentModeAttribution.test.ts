import {
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import {
    ReviewerAgent,
    type ReviewerReviewParams
} from '../src/agents/ReviewerAgent.js';

import type {
    OpenAICompatibleClient
} from '../src/inference/OpenAICompatibleClient.js';

import type {
    OracleResult,
    TestExecutionReport
} from '../src/types/domain.js';

const createBuildSyntaxResult =
    (
        status:
            OracleResult<'BUILD_SYNTAX'>['status'] =
            'PASS'
    ): OracleResult<'BUILD_SYNTAX'> => ({
        oracle:
            'BUILD_SYNTAX',

        status,

        required:
            true,

        durationMs:
            10,

        summary:
            status === 'PASS'
                ? 'Build completata.'
                : 'Build non superata.',

        evidence: {
            command:
                'python',

            args: [
                '-m',
                'py_compile',
                'src/target.py'
            ],

            cwd:
                '.',

            timeoutMs:
                5_000,

            envAllowList:
                [],

            exitCode:
                status === 'PASS'
                    ? 0
                    : 1,

            timedOut:
                false,

            stdout:
                '',

            stderr:
                status === 'PASS'
                    ? ''
                    : 'SyntaxError: invalid syntax'
        }
    });

const createFailedTestReport =
    (): TestExecutionReport => ({
        oracleStatus:
            'FAIL',

        command:
            'pytest',

        args: [
            '-q',
            'tests/test_target.py'
        ],

        cwd:
            '.',

        timeoutMs:
            5_000,

        envAllowList:
            [],

        oracleFilesExecuted: [
            'tests/test_target.py'
        ],

        implicitDiscoveryUsed:
            false,

        expectedExitPolicy: {
            passExitCodes: [
                0
            ],

            failExitCodes: [
                1
            ],

            executionErrorExitCodes: [
                2,
                3,
                4,
                5
            ]
        },

        exitCode:
            1,

        suitePassed:
            false,

        timedOut:
            false,

        oracleFailed:
            false,

        totalTests:
            1,

        passedTests:
            0,

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

        passRate:
            0,

        durationMs:
            25,

        failureDetails: [
            {
                testName:
                    'test_target',

                assertionMessage:
                    'assert False is True',

                stackTrace:
                    'tests/test_target.py:2',

                expected:
                    'True',

                actual:
                    'False'
            }
        ],

        stdout:
            '',

        stderr:
            '',

        rawStdout:
            '',

        rawStderr:
            '',

        executionDurationMs:
            25
    });

const createReviewParams =
    (
        overrides:
            Partial<ReviewerReviewParams> = {}
    ): ReviewerReviewParams => ({
        buildSyntax:
            createBuildSyntaxResult(),

        sastFindings:
            [],

        testReport:
            createFailedTestReport(),

        flappingDetected:
            false,

        targetFiles: [
            'src/target.py'
        ],

        testFiles: [
            'tests/test_target.py'
        ],

        category:
            'REPAIR',

        ...overrides
    });

const createClient =
    (
        completeChat:
            (
                ...args:
                    readonly unknown[]
            ) => Promise<string>
    ): OpenAICompatibleClient =>
        ({
            completeChat
        }) as unknown as OpenAICompatibleClient;

describe(
    'BE-P0-28 - ReviewerAgent mode attribution',
    () => {
        it(
            'attribuisce una risposta Reviewer valida alla modalità LLM',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> =>
                            JSON.stringify({
                                rootCauseSummary:
                                    'La funzione target restituisce il valore errato.',

                                targetRemediations: [
                                    {
                                        file:
                                            'src/target.py',

                                        lineRange: {
                                            start:
                                                1,

                                            end:
                                                2
                                        },

                                        rootCause:
                                            'La funzione restituisce False invece di True.',

                                        mandatoryCorrection:
                                            'Modificare il valore restituito dalla funzione target.'
                                    }
                                ],

                                securityPriorityStrict:
                                    true,

                                flappingDetected:
                                    false
                            })
                    );

                const reviewer =
                    new ReviewerAgent(
                        createClient(
                            completeChat
                        )
                    );

                const result =
                    await reviewer.review(
                        createReviewParams()
                    );

                expect(
                    completeChat
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    result.reviewerMode
                ).toBe(
                    'LLM'
                );

                expect(
                    result.fallbackReason
                ).toBeUndefined();

                expect(
                    result.feedback
                        .targetRemediations
                ).toHaveLength(
                    1
                );

                expect(
                    result.feedback
                        .targetRemediations[0]
                        ?.file
                ).toBe(
                    'src/target.py'
                );
            }
        );

        it(
            'attribuisce una risposta priva di JSON al fallback deterministico e registra la causa',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> =>
                            'Risposta Reviewer priva di JSON.'
                    );

                const reviewer =
                    new ReviewerAgent(
                        createClient(
                            completeChat
                        )
                    );

                const result =
                    await reviewer.review(
                        createReviewParams()
                    );

                expect(
                    result.reviewerMode
                ).toBe(
                    'DETERMINISTIC_FALLBACK'
                );

                expect(
                    result.fallbackReason
                ).toContain(
                    'deve contenere esclusivamente un oggetto JSON'
                );

                expect(
                    result.fallbackReason
                        ?.trim()
                        .length
                ).toBeGreaterThan(
                    0
                );

                expect(
                    result.feedback
                        .targetRemediations
                        .length
                ).toBeGreaterThan(
                    0
                );

                expect(
                    result.feedback
                        .targetRemediations[0]
                        ?.file
                ).toBe(
                    'src/target.py'
                );
            }
        );

        it(
            'attribuisce un errore del provider al fallback deterministico',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> => {
                            throw new Error(
                                'Injected Reviewer provider failure'
                            );
                        }
                    );

                const reviewer =
                    new ReviewerAgent(
                        createClient(
                            completeChat
                        )
                    );

                const result =
                    await reviewer.review(
                        createReviewParams()
                    );

                expect(
                    result.reviewerMode
                ).toBe(
                    'DETERMINISTIC_FALLBACK'
                );

                expect(
                    result.fallbackReason
                ).toBe(
                    'Injected Reviewer provider failure'
                );

                expect(
                    result.feedback
                        .targetRemediations
                        .length
                ).toBeGreaterThan(
                    0
                );

                expect(
                    result.feedback
                        .targetRemediations
                        .every(
                            (remediation) =>
                                remediation.file ===
                                'src/target.py'
                        )
                ).toBe(
                    true
                );
            }
        );

        it(
            'attribuisce remediation LLM strutturalmente non valide al fallback deterministico',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> =>
                            JSON.stringify({
                                rootCauseSummary:
                                    'Risposta priva di remediation valide.',

                                targetRemediations:
                                    []
                            })
                    );

                const reviewer =
                    new ReviewerAgent(
                        createClient(
                            completeChat
                        )
                    );

                const result =
                    await reviewer.review(
                        createReviewParams()
                    );

                expect(
                    result.reviewerMode
                ).toBe(
                    'DETERMINISTIC_FALLBACK'
                );

                expect(
                    result.fallbackReason
                ).toContain(
                    'targetRemediations deve contenere almeno una remediation'
                );

                expect(
                    result.feedback
                        .targetRemediations
                        .length
                ).toBeGreaterThan(
                    0
                );

                expect(
                    result.feedback
                        .targetRemediations
                        .every(
                            (remediation) =>
                                remediation.file ===
                                'src/target.py'
                        )
                ).toBe(
                    true
                );
            }
        );

        it(
            'normalizza i path delle remediation LLM prima di restituirle',
            async () => {
                const completeChat =
                    jest.fn(
                        async (): Promise<string> =>
                            JSON.stringify({
                                rootCauseSummary:
                                    'Correzione target.',

                                targetRemediations: [
                                    {
                                        file:
                                            './src\\target.py',

                                        lineRange: {
                                            start:
                                                1,

                                            end:
                                                1
                                        },

                                        rootCause:
                                            'Comportamento errato.',

                                        mandatoryCorrection:
                                            'Correggere il comportamento del codice sorgente.'
                                    }
                                ]
                            })
                    );

                const reviewer =
                    new ReviewerAgent(
                        createClient(
                            completeChat
                        )
                    );

                const result =
                    await reviewer.review(
                        createReviewParams()
                    );

                expect(
                    result.reviewerMode
                ).toBe(
                    'LLM'
                );

                expect(
                    result.feedback
                        .targetRemediations[0]
                        ?.file
                ).toBe(
                    'src/target.py'
                );
            }
        );
    }
);
