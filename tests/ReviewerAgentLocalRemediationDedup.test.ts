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
    SastFinding,
    TestExecutionReport
} from '../src/types/domain.js';

const createClient = (
    behavior:
        string | Error
): OpenAICompatibleClient => ({
    completeChat:
        jest.fn(
            async (): Promise<string> => {
                if (
                    behavior instanceof Error
                ) {
                    throw behavior;
                }

                return behavior;
            }
        )
}) as unknown as OpenAICompatibleClient;

const buildSyntaxPass:
    OracleResult<'BUILD_SYNTAX'> = {
    oracle:
        'BUILD_SYNTAX',

    status:
        'PASS',

    required:
        true,

    durationMs:
        1,

    summary:
        'Build/Syntax superato.',

    evidence: {
        command:
            'python',

        args:
            [],

        cwd:
            '.',

        timeoutMs:
            5_000,

        envAllowList:
            [],

        exitCode:
            0,

        timedOut:
            false,

        stdout:
            '',

        stderr:
            ''
    }
};

const testReportPass:
    TestExecutionReport = {
    oracleStatus:
        'PASS',

    command:
        'pytest',

    args:
        [],

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
        0,

    suitePassed:
        true,

    timedOut:
        false,

    oracleFailed:
        false,

    totalTests:
        1,

    passedTests:
        1,

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

    passRate:
        1,

    durationMs:
        1,

    failureDetails:
        [],

    stdout:
        '',

    stderr:
        '',

    rawStdout:
        '',

    rawStderr:
        '',

    executionDurationMs:
        1
};

const createFinding = (
    overrides:
        Partial<SastFinding> = {}
): SastFinding => ({
    ruleId:
        'security.rule',

    path:
        './src\\target.py',

    startLine:
        10,

    endLine:
        10,

    severity:
        'ERROR',

    message:
        'Synthetic duplicated SAST finding.',

    ...overrides
});

const createParams = (
    overrides:
        Partial<ReviewerReviewParams> = {}
): ReviewerReviewParams => ({
    buildSyntax:
        buildSyntaxPass,

    sastFindings:
        [],

    testReport:
        testReportPass,

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

const review = async (
    behavior:
        string | Error,
    params:
        ReviewerReviewParams =
        createParams()
) => {
    const reviewer =
        new ReviewerAgent(
            createClient(
                behavior
            )
        );

    return reviewer.review(
        params
    );
};

const createLlmPayload = (
    targetRemediations:
        readonly unknown[]
): string =>
    JSON.stringify({
        rootCauseSummary:
            'Diagnosi con remediation potenzialmente duplicate.',

        targetRemediations
    });

const baseRemediation = {
    file:
        'src/target.py',

    lineRange: {
        start:
            10,

        end:
            10
    },

    rootCause:
        'Il codice sorgente viola la regola.',

    mandatoryCorrection:
        'Correggere il valore restituito.',

    relatedRuleId:
        'security.rule'
};

describe(
    'BE-P1-04 - ReviewerAgent local remediation deduplication',
    () => {
        describe(
            'percorso LLM',
            () => {
                it(
                    'deduplica remediation perfettamente identiche',
                    async () => {
                        const result =
                            await review(
                                createLlmPayload([
                                    baseRemediation,
                                    {
                                        ...baseRemediation
                                    }
                                ])
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'LLM'
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toHaveLength(
                            1
                        );

                        expect(
                            result.feedback
                                .targetRemediations[0]
                        ).toEqual(
                            baseRemediation
                        );
                    }
                );

                it(
                    'deduplica path equivalenti dopo normalizzazione',
                    async () => {
                        const result =
                            await review(
                                createLlmPayload([
                                    {
                                        ...baseRemediation,

                                        file:
                                            './src\\target.py'
                                    },
                                    {
                                        ...baseRemediation,

                                        file:
                                            'src/target.py'
                                    }
                                ])
                            );

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
                    'deduplica correction equivalenti dopo normalizzazione di case e whitespace',
                    async () => {
                        const result =
                            await review(
                                createLlmPayload([
                                    {
                                        ...baseRemediation,

                                        mandatoryCorrection:
                                            'Correggere il valore restituito.'
                                    },
                                    {
                                        ...baseRemediation,

                                        mandatoryCorrection:
                                            '  CORREGGERE   il valore   RESTITUITO.  '
                                    }
                                ])
                            );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toHaveLength(
                            1
                        );

                        /*
                         * La deduplica è first-wins:
                         * deve essere preservata la prima
                         * rappresentazione incontrata.
                         */
                        expect(
                            result.feedback
                                .targetRemediations[0]
                                ?.mandatoryCorrection
                        ).toBe(
                            'Correggere il valore restituito.'
                        );
                    }
                );

                it(
                    'deduplica relatedRuleId equivalenti dopo trim e case normalization',
                    async () => {
                        const result =
                            await review(
                                createLlmPayload([
                                    {
                                        ...baseRemediation,

                                        relatedRuleId:
                                            'SECURITY.RULE'
                                    },
                                    {
                                        ...baseRemediation,

                                        relatedRuleId:
                                            ' security.rule '
                                    }
                                ])
                            );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toHaveLength(
                            1
                        );

                        expect(
                            result.feedback
                                .targetRemediations[0]
                                ?.relatedRuleId
                        ).toBe(
                            'SECURITY.RULE'
                        );
                    }
                );

                it(
                    'considera equivalenti remediation con rootCause e lineRange differenti ma stessa correzione atomica',
                    async () => {
                        const firstRemediation = {
                            ...baseRemediation,

                            lineRange: {
                                start:
                                    10,

                                end:
                                    10
                            },

                            rootCause:
                                'Prima formulazione diagnostica.'
                        };

                        const secondRemediation = {
                            ...baseRemediation,

                            lineRange: {
                                start:
                                    20,

                                end:
                                    21
                            },

                            rootCause:
                                'Seconda formulazione diagnostica.'
                        };

                        const result =
                            await review(
                                createLlmPayload([
                                    firstRemediation,
                                    secondRemediation
                                ])
                            );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toHaveLength(
                            1
                        );

                        expect(
                            result.feedback
                                .targetRemediations[0]
                        ).toEqual(
                            firstRemediation
                        );
                    }
                );

                it(
                    'preserva remediation con relatedRuleId differenti',
                    async () => {
                        const result =
                            await review(
                                createLlmPayload([
                                    {
                                        ...baseRemediation,

                                        relatedRuleId:
                                            'security.rule.one'
                                    },
                                    {
                                        ...baseRemediation,

                                        relatedRuleId:
                                            'security.rule.two'
                                    }
                                ])
                            );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toHaveLength(
                            2
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .map(
                                    (remediation) =>
                                        remediation.relatedRuleId
                                )
                        ).toEqual([
                            'security.rule.one',
                            'security.rule.two'
                        ]);
                    }
                );

                it(
                    'preserva remediation con mandatoryCorrection differenti',
                    async () => {
                        const result =
                            await review(
                                createLlmPayload([
                                    {
                                        ...baseRemediation,

                                        mandatoryCorrection:
                                            'Correggere il valore restituito.'
                                    },
                                    {
                                        ...baseRemediation,

                                        mandatoryCorrection:
                                            'Aggiungere la validazione dell’input.'
                                    }
                                ])
                            );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toHaveLength(
                            2
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .map(
                                    (remediation) =>
                                        remediation.mandatoryCorrection
                                )
                        ).toEqual([
                            'Correggere il valore restituito.',
                            'Aggiungere la validazione dell’input.'
                        ]);
                    }
                );

                it(
                    'preserva remediation equivalenti riferite a file diversi in CREATE',
                    async () => {
                        const result =
                            await review(
                                createLlmPayload([
                                    {
                                        ...baseRemediation,

                                        file:
                                            'src/first.py'
                                    },
                                    {
                                        ...baseRemediation,

                                        file:
                                            'src/second.py'
                                    }
                                ]),
                                createParams({
                                    category:
                                        'CREATE'
                                })
                            );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toHaveLength(
                            2
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .map(
                                    (remediation) =>
                                        remediation.file
                                )
                        ).toEqual([
                            'src/first.py',
                            'src/second.py'
                        ]);
                    }
                );

                it(
                    'mantiene stabile l’ordine delle prime occorrenze',
                    async () => {
                        const first = {
                            ...baseRemediation,

                            relatedRuleId:
                                'first.rule',

                            mandatoryCorrection:
                                'Applicare la prima correzione.'
                        };

                        const second = {
                            ...baseRemediation,

                            relatedRuleId:
                                'second.rule',

                            mandatoryCorrection:
                                'Applicare la seconda correzione.'
                        };

                        const firstDuplicate = {
                            ...first,

                            file:
                                './src\\target.py',

                            rootCause:
                                'Duplicato con causa differente.',

                            lineRange: {
                                start:
                                    30,

                                end:
                                    30
                            },

                            mandatoryCorrection:
                                '  APPLICARE  la prima correzione. '
                        };

                        const result =
                            await review(
                                createLlmPayload([
                                    first,
                                    second,
                                    firstDuplicate
                                ])
                            );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toEqual([
                            first,
                            second
                        ]);
                    }
                );
            }
        );

        describe(
            'percorso fallback',
            () => {
                it(
                    'deduplica finding SAST fallback equivalenti',
                    async () => {
                        const result =
                            await review(
                                new Error(
                                    'Injected Reviewer failure'
                                ),
                                createParams({
                                    sastFindings: [
                                        createFinding(),
                                        createFinding({
                                            path:
                                                'src/target.py'
                                        })
                                    ]
                                })
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'DETERMINISTIC_FALLBACK'
                        );

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

                        expect(
                            result.feedback
                                .targetRemediations[0]
                                ?.relatedRuleId
                        ).toBe(
                            'security.rule'
                        );
                    }
                );

                it(
                    'preserva finding fallback con rule ID differenti',
                    async () => {
                        const result =
                            await review(
                                new Error(
                                    'Injected Reviewer failure'
                                ),
                                createParams({
                                    sastFindings: [
                                        createFinding({
                                            ruleId:
                                                'security.rule.one'
                                        }),
                                        createFinding({
                                            ruleId:
                                                'security.rule.two'
                                        })
                                    ]
                                })
                            );

                        expect(
                            result.reviewerMode
                        ).toBe(
                            'DETERMINISTIC_FALLBACK'
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                        ).toHaveLength(
                            2
                        );

                        expect(
                            result.feedback
                                .targetRemediations
                                .map(
                                    (remediation) =>
                                        remediation.relatedRuleId
                                )
                        ).toEqual([
                            'security.rule.one',
                            'security.rule.two'
                        ]);
                    }
                );
            }
        );

        it(
            'non produce chiavi duplicate nel feedback corrente',
            async () => {
                const result =
                    await review(
                        createLlmPayload([
                            baseRemediation,
                            {
                                ...baseRemediation,

                                file:
                                    './src\\target.py'
                            },
                            {
                                ...baseRemediation,

                                mandatoryCorrection:
                                    ' CORREGGERE   IL VALORE RESTITUITO. '
                            },
                            {
                                ...baseRemediation,

                                relatedRuleId:
                                    ' security.rule '
                            },
                            {
                                ...baseRemediation,

                                relatedRuleId:
                                    'different.rule'
                            }
                        ])
                    );

                const keys =
                    result.feedback
                        .targetRemediations
                        .map(
                            (remediation) => {
                                const file =
                                    remediation.file
                                        .trim()
                                        .replaceAll(
                                            '\\',
                                            '/'
                                        )
                                        .replace(
                                            /^\.\//,
                                            ''
                                        )
                                        .toLowerCase();

                                const ruleId =
                                    remediation.relatedRuleId
                                        ?.trim()
                                        .toLowerCase() ??
                                    '';

                                const correction =
                                    remediation
                                        .mandatoryCorrection
                                        .trim()
                                        .toLowerCase()
                                        .replace(
                                            /\s+/g,
                                            ' '
                                        );

                                return [
                                    file,
                                    ruleId,
                                    correction
                                ].join('|');
                            }
                        );

                expect(
                    new Set(
                        keys
                    ).size
                ).toBe(
                    keys.length
                );

                expect(
                    result.feedback
                        .targetRemediations
                ).toHaveLength(
                    2
                );
            }
        );
    }
);
