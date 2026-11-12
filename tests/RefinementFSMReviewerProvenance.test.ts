import {
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import type {
    CoderAgent
} from '../src/agents/CoderAgent.js';

import type {
    ReviewerAgent
} from '../src/agents/ReviewerAgent.js';

import type {
    GitManager
} from '../src/git/GitManager.js';

import type {
    ContextBuilder,
    InitialContextParams
} from '../src/orchestration/ContextBuilder.js';

import {
    RefinementFSM
} from '../src/orchestration/RefinementFSM.js';

import {
    TelemetryTracker
} from '../src/telemetry/TelemetryTracker.js';

import type {
    OracleResult,
    ReviewerFeedbackPayload,
    ReviewerReviewResult,
    TestExecutionReport
} from '../src/types/domain.js';

import type {
    BuildSyntaxOracle
} from '../src/verification/BuildSyntaxOracle.js';

import type {
    SemgrepEngine
} from '../src/verification/SemgrepEngine.js';

import type {
    TestHarness
} from '../src/verification/TestHarness.js';

const patch = [
    '--- a/src/target.py',
    '+++ b/src/target.py',
    '@@ -1 +1 @@',
    '-return False',
    '+return True'
].join('\n');

const testReport:
    TestExecutionReport = {
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
        10,

    failureDetails: [
        {
            testName:
                'test_target',

            assertionMessage:
                'assert False is True',

            stackTrace:
                'tests/test_target.py:2'
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
        10
};

const feedback:
    ReviewerFeedbackPayload = {
    rootCauseSummary:
        'La funzione restituisce il valore errato.',

    violationsPrunedCount:
        0,

    targetRemediations: [
        {
            file:
                'src/target.py',

            lineRange: {
                start:
                    1,

                end:
                    1
            },

            rootCause:
                'Il valore restituito è errato.',

            mandatoryCorrection:
                'Restituire True.'
        }
    ],

    securityPriorityStrict:
        true,

    flappingDetected:
        false
};

const applicability:
    OracleResult<'APPLICABILITY'> = {
    oracle:
        'APPLICABILITY',

    status:
        'PASS',

    required:
        true,

    durationMs:
        1,

    summary:
        'Patch applicabile.',

    evidence: {
        applyMode:
            'GIT',

        patchHash:
            'patch-hash'
    }
};

const buildSyntax:
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
        'Build valida.',

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

const semgrep:
    OracleResult<'SEMGREP'> = {
    oracle:
        'SEMGREP',

    status:
        'FAIL',

    required:
        true,

    durationMs:
        1,

    summary:
        'Finding SAST.',

    evidence: {
        findings: [
            {
                ruleId:
                    'test.rule',

                path:
                    'src/target.py',

                startLine:
                    1,

                endLine:
                    1,

                severity:
                    'ERROR',

                message:
                    'Finding controllato.'
            }
        ],

        scannedFiles: [
            'src/target.py'
        ]
    }
};

const functionalTest:
    OracleResult<'FUNCTIONAL_TEST'> = {
    oracle:
        'FUNCTIONAL_TEST',

    status:
        'FAIL',

    required:
        true,

    durationMs:
        10,

    summary:
        'Test fallito.',

    evidence: {
        report:
            testReport
    }
};

const params:
    InitialContextParams = {
    issueSpec:
        'Correggere target.',

    targetFiles: [
        'src/target.py'
    ],

    testFiles: [
        'tests/test_target.py'
    ],

    category:
        'REPAIR'
};

const createFsm =
    (
        reviewResult:
            ReviewerReviewResult
    ): {
        readonly fsm:
        RefinementFSM;

        readonly reviewer:
        ReviewerAgent;

        readonly rollback:
        ReturnType<typeof jest.fn>;
    } => {
        const coder =
            {
                generatePatch:
                    jest.fn(
                        async (): Promise<string> =>
                            patch
                    )
            } as unknown as CoderAgent;

        const rollback =
            jest.fn(
                async () => ({
                    status:
                        'SUCCESS' as const,

                    initialHead:
                        'initial-head',

                    finalHead:
                        'initial-head',

                    repositoryClean:
                        true,

                    workingTreeStatus:
                        ''
                })
            );

        const gitManager =
            {
                getHead:
                    jest.fn(
                        async () =>
                            'initial-head'
                    ),

                assertWorkingTreeClean:
                    jest.fn(
                        async () =>
                            undefined
                    ),

                computePatchHash:
                    jest.fn(
                        () =>
                            'patch-hash'
                    ),

                evaluateApplicability:
                    jest.fn(
                        async () =>
                            applicability
                    ),

                normalizeRejectedPatch:
                    jest.fn(
                        async () =>
                            null
                    ),

                applyPatch:
                    jest.fn(
                        async () =>
                            'GIT' as const
                    ),

                rollback
            } as unknown as GitManager;

        const buildSyntaxOracle =
            {
                evaluate:
                    jest.fn(
                        async () =>
                            buildSyntax
                    )
            } as unknown as BuildSyntaxOracle;

        const semgrepEngine =
            {
                evaluate:
                    jest.fn(
                        async () =>
                            semgrep
                    )
            } as unknown as SemgrepEngine;

        const testHarness =
            {
                evaluate:
                    jest.fn(
                        async () =>
                            functionalTest
                    )
            } as unknown as TestHarness;

        const reviewer =
            {
                review:
                    jest.fn(
                        async () =>
                            reviewResult
                    )
            } as unknown as ReviewerAgent;

        const contextBuilder =
            {
                buildInitialPayload:
                    jest.fn(
                        async () =>
                            'initial payload'
                    ),

                buildRefinementPayload:
                    jest.fn(
                        () =>
                            'refinement payload'
                    ),

                buildTechnicalRetryPayload:
                    jest.fn(
                        () =>
                            'technical retry payload'
                    )
            } as unknown as ContextBuilder;

        const fsm =
            new RefinementFSM(
                'BE-P0-28-provenance',
                gitManager,
                semgrepEngine,
                testHarness,
                buildSyntaxOracle,
                coder,
                reviewer,
                contextBuilder,
                new TelemetryTracker()
            );

        return {
            fsm,
            reviewer,
            rollback
        };
    };

describe(
    'BE-P0-28 - RefinementFSM Reviewer provenance',
    () => {
        it(
            'registra la modalità LLM senza fallbackReason',
            async () => {
                const {
                    fsm,
                    reviewer,
                    rollback
                } =
                    createFsm({
                        feedback,

                        reviewerMode:
                            'LLM'
                    });

                const result =
                    await fsm.runLoop(
                        params
                    );

                expect(
                    reviewer.review
                ).toHaveBeenCalled();

                expect(
                    rollback
                ).toHaveBeenCalled();

                const reviewedIteration =
                    result.iterations.find(
                        (iteration) =>
                            iteration.reviewerFeedback !==
                            undefined
                    );

                expect(
                    reviewedIteration
                ).toBeDefined();

                expect(
                    reviewedIteration?.reviewerMode
                ).toBe(
                    'LLM'
                );

                expect(
                    reviewedIteration?.fallbackReason
                ).toBeUndefined();

                expect(
                    reviewedIteration?.reviewerFeedback
                ).toEqual(
                    feedback
                );
            }
        );

        it(
            'registra il fallback deterministico e la relativa causa',
            async () => {
                const {
                    fsm
                } =
                    createFsm({
                        feedback,

                        reviewerMode:
                            'DETERMINISTIC_FALLBACK',

                        fallbackReason:
                            'Injected Reviewer parsing failure'
                    });

                const result =
                    await fsm.runLoop(
                        params
                    );

                const reviewedIteration =
                    result.iterations.find(
                        (iteration) =>
                            iteration.reviewerMode ===
                            'DETERMINISTIC_FALLBACK'
                    );

                expect(
                    reviewedIteration
                ).toBeDefined();

                expect(
                    reviewedIteration?.reviewerFeedback
                ).toEqual(
                    feedback
                );

                expect(
                    reviewedIteration?.fallbackReason
                ).toBe(
                    'Injected Reviewer parsing failure'
                );
            }
        );

        it(
            'trasforma un fallback privo di fallbackReason in REVIEWER_FAILURE',
            async () => {
                const {
                    fsm
                } =
                    createFsm({
                        feedback,

                        reviewerMode:
                            'DETERMINISTIC_FALLBACK'
                    } as ReviewerReviewResult);

                const result =
                    await fsm.runLoop(
                        params
                    );

                expect(
                    result.failure?.phase
                ).toBe(
                    'REVIEW'
                );

                expect(
                    result.failure?.category
                ).toBe(
                    'REVIEWER_FAILURE'
                );

                expect(
                    result.failure?.message
                ).toContain(
                    'fallbackReason'
                );
            }
        );

        it(
            'trasforma fallbackReason associata a LLM in REVIEWER_FAILURE',
            async () => {
                const {
                    fsm
                } =
                    createFsm({
                        feedback,

                        reviewerMode:
                            'LLM',

                        fallbackReason:
                            'reason non consentita'
                    });

                const result =
                    await fsm.runLoop(
                        params
                    );

                expect(
                    result.failure?.phase
                ).toBe(
                    'REVIEW'
                );

                expect(
                    result.failure?.category
                ).toBe(
                    'REVIEWER_FAILURE'
                );

                expect(
                    result.failure?.message
                ).toContain(
                    'non può dichiarare fallbackReason'
                );
            }
        );
    }
);
