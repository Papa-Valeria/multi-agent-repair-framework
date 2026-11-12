import {
    afterEach,
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import {
    CoderOutputExtractionError
} from '../src/agents/CoderAgent.js';

import type {
    CoderAgent
} from '../src/agents/CoderAgent.js';

import type {
    ReviewerAgent
} from '../src/agents/ReviewerAgent.js';

import type {
    GitManager,
    PatchScope
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
    ExperimentLimits
} from '../src/types/analytics.js';

import type {
    OracleResult
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

const TASK_ID =
    'be-p1-18-runtime-limits';

const TARGET_FILE =
    'src/target.ts';

const PATCH = [
    '--- a/src/target.ts',
    '+++ b/src/target.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;'
].join(
    '\n'
);

const PARAMS:
    InitialContextParams = {
    issueSpec:
        'Set the production value to 2.',

    targetFiles: [
        TARGET_FILE
    ],

    testFiles:
        [],

    category:
        'REPAIR'
};

const createApplicabilityFailure = (
    patchHash:
        string
): OracleResult<'APPLICABILITY'> => ({
    oracle:
        'APPLICABILITY',

    status:
        'FAIL',

    required:
        true,

    durationMs:
        1,

    summary:
        'La patch non è applicabile.',

    evidence: {
        applyMode:
            'NOT_APPLICABLE',

        patchHash,

        reason:
            'Patch rejected by the applicability probe.'
    }
});

interface GitMock {
    readonly getHead:
    jest.MockedFunction<
        () => Promise<string>
    >;

    readonly assertWorkingTreeClean:
    jest.MockedFunction<
        () => Promise<void>
    >;

    readonly computePatchHash:
    jest.MockedFunction<
        (
            patch:
                string
        ) => string
    >;

    readonly evaluateApplicability:
    jest.MockedFunction<
        (
            patch:
                string,

            scope:
                PatchScope,

            required:
                boolean
        ) => Promise<
            OracleResult<'APPLICABILITY'>
        >
    >;

    readonly normalizeRejectedPatch:
    jest.MockedFunction<
        (
            patch:
                string,

            scope:
                PatchScope
        ) => Promise<
            string | null
        >
    >;
}

interface CoderMock {
    readonly generatePatch:
    jest.MockedFunction<
        (
            userPromptPayload:
                string,

            targetFiles:
                readonly string[],

            testFiles:
                readonly string[],

            category:
                'REPAIR' | 'CREATE'
        ) => Promise<string>
    >;
}

interface ContextBuilderMock {
    readonly buildInitialPayload:
    jest.MockedFunction<
        (
            params:
                InitialContextParams
        ) => Promise<string>
    >;

    readonly buildRefinementPayload:
    jest.MockedFunction<
        (
            params:
                Parameters<
                    ContextBuilder[
                    'buildRefinementPayload'
                    ]
                >[0]
        ) => string
    >;

    readonly buildTechnicalRetryPayload:
    jest.MockedFunction<
        (
            semanticPayload:
                string,

            rejectedPatch:
                string,

            applicabilitySummary:
                string,

            attempt:
                number
        ) => string
    >;
}

interface Dependencies {
    readonly git:
    GitMock;

    readonly gitManager:
    GitManager;

    readonly coder:
    CoderMock;

    readonly coderAgent:
    CoderAgent;

    readonly context:
    ContextBuilderMock;

    readonly contextBuilder:
    ContextBuilder;

    readonly reviewer:
    ReviewerAgent;

    readonly semgrep:
    SemgrepEngine;

    readonly testHarness:
    TestHarness;

    readonly buildSyntaxOracle:
    BuildSyntaxOracle;

    readonly telemetry:
    TelemetryTracker;
}

const createDependencies =
    (): Dependencies => {
        const git:
            GitMock = {
            getHead:
                jest.fn<
                    () => Promise<string>
                >()
                    .mockResolvedValue(
                        'initial-head'
                    ),

            assertWorkingTreeClean:
                jest.fn<
                    () => Promise<void>
                >()
                    .mockResolvedValue(),

            computePatchHash:
                jest.fn<
                    (
                        patch:
                            string
                    ) => string
                >()
                    .mockImplementation(
                        () =>
                            'patch-hash'
                    ),

            evaluateApplicability:
                jest.fn<
                    (
                        patch:
                            string,

                        scope:
                            PatchScope,

                        required:
                            boolean
                    ) => Promise<
                        OracleResult<'APPLICABILITY'>
                    >
                >()
                    .mockImplementation(
                        async () =>
                            createApplicabilityFailure(
                                'patch-hash'
                            )
                    ),

            normalizeRejectedPatch:
                jest.fn<
                    (
                        patch:
                            string,

                        scope:
                            PatchScope
                    ) => Promise<
                        string | null
                    >
                >()
                    .mockResolvedValue(
                        null
                    )
        };

        const coder:
            CoderMock = {
            generatePatch:
                jest.fn<
                    (
                        userPromptPayload:
                            string,

                        targetFiles:
                            readonly string[],

                        testFiles:
                            readonly string[],

                        category:
                            'REPAIR' | 'CREATE'
                    ) => Promise<string>
                >()
                    .mockResolvedValue(
                        PATCH
                    )
        };

        const context:
            ContextBuilderMock = {
            buildInitialPayload:
                jest.fn<
                    (
                        params:
                            InitialContextParams
                    ) => Promise<string>
                >()
                    .mockResolvedValue(
                        '__INITIAL_PAYLOAD__'
                    ),

            buildRefinementPayload:
                jest.fn<
                    (
                        params:
                            Parameters<
                                ContextBuilder[
                                'buildRefinementPayload'
                                ]
                            >[0]
                    ) => string
                >()
                    .mockReturnValue(
                        '__REFINEMENT_PAYLOAD__'
                    ),

            buildTechnicalRetryPayload:
                jest.fn<
                    (
                        semanticPayload:
                            string,

                        rejectedPatch:
                            string,

                        applicabilitySummary:
                            string,

                        attempt:
                            number
                    ) => string
                >()
                    .mockImplementation(
                        (
                            _semanticPayload,
                            _rejectedPatch,
                            _applicabilitySummary,
                            attempt
                        ) =>
                            `__TECHNICAL_RETRY_${attempt}__`
                    )
        };

        const telemetry =
            new TelemetryTracker();

        telemetry.startRun();

        return {
            git,

            gitManager:
                git as unknown as
                GitManager,

            coder,

            coderAgent:
                coder as unknown as
                CoderAgent,

            context,

            contextBuilder:
                context as unknown as
                ContextBuilder,

            reviewer:
                {} as ReviewerAgent,

            semgrep:
                {} as SemgrepEngine,

            testHarness:
                {} as TestHarness,

            buildSyntaxOracle:
                {} as BuildSyntaxOracle,

            telemetry
        };
    };

const createFsm = (
    dependencies:
        Dependencies,

    limits:
        ExperimentLimits
): RefinementFSM => {
    return new RefinementFSM(
        TASK_ID,
        dependencies.gitManager,
        dependencies.semgrep,
        dependencies.testHarness,
        dependencies.buildSyntaxOracle,
        dependencies.coderAgent,
        dependencies.reviewer,
        dependencies.contextBuilder,
        dependencies.telemetry,
        limits
    );
};

afterEach(
    () => {
        jest.restoreAllMocks();
    }
);

describe(
    'BE-P1-18 - RefinementFSM runtime limits',
    () => {
        it(
            'non supera maxIterations durante i fallimenti di generazione refinable',
            async () => {
                const dependencies =
                    createDependencies();

                dependencies.coder
                    .generatePatch
                    .mockRejectedValue(
                        new CoderOutputExtractionError(
                            'Invalid Unified Diff.'
                        )
                    );

                const limits:
                    ExperimentLimits = {
                    maxIterations:
                        2,

                    maxTechnicalAttempts:
                        1
                };

                const fsm =
                    createFsm(
                        dependencies,
                        limits
                    );

                const result =
                    await fsm.runLoop(
                        PARAMS
                    );

                expect(
                    dependencies.coder
                        .generatePatch
                ).toHaveBeenCalledTimes(
                    2
                );

                expect(
                    dependencies.context
                        .buildInitialPayload
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    dependencies.context
                        .buildRefinementPayload
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    result.iterations
                ).toHaveLength(
                    2
                );

                expect(
                    result.iterations.map(
                        (iteration) =>
                            iteration.iteration
                    )
                ).toEqual([
                    1,
                    2
                ]);

                expect(
                    result.currentIteration
                ).toBe(
                    2
                );

                expect(
                    result.maxIterations
                ).toBe(
                    2
                );

                expect(
                    dependencies.coder
                        .generatePatch
                ).not.toHaveBeenCalledTimes(
                    3
                );
            }
        );

        it(
            'con maxTechnicalAttempts uguale a 1 non genera technical retry',
            async () => {
                const dependencies =
                    createDependencies();

                const limits:
                    ExperimentLimits = {
                    maxIterations:
                        1,

                    maxTechnicalAttempts:
                        1
                };

                const fsm =
                    createFsm(
                        dependencies,
                        limits
                    );

                const result =
                    await fsm.runLoop(
                        PARAMS
                    );

                expect(
                    dependencies.coder
                        .generatePatch
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    dependencies.git
                        .evaluateApplicability
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    dependencies.git
                        .normalizeRejectedPatch
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    dependencies.context
                        .buildTechnicalRetryPayload
                ).not.toHaveBeenCalled();

                expect(
                    result.iterations
                ).toHaveLength(
                    1
                );

                expect(
                    result.iterations[0]
                        ?.technicalAttempts
                ).toBe(
                    1
                );

                expect(
                    result.maxIterations
                ).toBe(
                    1
                );
            }
        );

        it(
            'con maxTechnicalAttempts uguale a 2 esegue esattamente un technical retry',
            async () => {
                const dependencies =
                    createDependencies();

                const limits:
                    ExperimentLimits = {
                    maxIterations:
                        1,

                    maxTechnicalAttempts:
                        2
                };

                const fsm =
                    createFsm(
                        dependencies,
                        limits
                    );

                const result =
                    await fsm.runLoop(
                        PARAMS
                    );

                expect(
                    dependencies.coder
                        .generatePatch
                ).toHaveBeenCalledTimes(
                    2
                );

                expect(
                    dependencies.git
                        .evaluateApplicability
                ).toHaveBeenCalledTimes(
                    2
                );

                expect(
                    dependencies.git
                        .normalizeRejectedPatch
                ).toHaveBeenCalledTimes(
                    2
                );

                expect(
                    dependencies.context
                        .buildTechnicalRetryPayload
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    dependencies.context
                        .buildTechnicalRetryPayload
                ).toHaveBeenCalledWith(
                    '__INITIAL_PAYLOAD__',
                    PATCH,
                    'La patch non è applicabile.',
                    2
                );

                expect(
                    dependencies.coder
                        .generatePatch
                ).toHaveBeenNthCalledWith(
                    1,
                    '__INITIAL_PAYLOAD__',
                    [
                        TARGET_FILE
                    ],
                    [],
                    'REPAIR'
                );

                expect(
                    dependencies.coder
                        .generatePatch
                ).toHaveBeenNthCalledWith(
                    2,
                    '__TECHNICAL_RETRY_2__',
                    [
                        TARGET_FILE
                    ],
                    [],
                    'REPAIR'
                );

                expect(
                    result.iterations
                ).toHaveLength(
                    1
                );

                expect(
                    result.iterations[0]
                        ?.technicalAttempts
                ).toBe(
                    2
                );

                expect(
                    result.maxIterations
                ).toBe(
                    1
                );
            }
        );

        it(
            'mantiene separati budget semantico e budget tecnico',
            async () => {
                const dependencies =
                    createDependencies();

                const limits:
                    ExperimentLimits = {
                    maxIterations:
                        2,

                    maxTechnicalAttempts:
                        2
                };

                const fsm =
                    createFsm(
                        dependencies,
                        limits
                    );

                const result =
                    await fsm.runLoop(
                        PARAMS
                    );

                /*
                 * Ogni iterazione semantica esaurisce due
                 * technical attempts prima del refinement.
                 */
                expect(
                    dependencies.coder
                        .generatePatch
                ).toHaveBeenCalledTimes(
                    4
                );

                expect(
                    dependencies.git
                        .evaluateApplicability
                ).toHaveBeenCalledTimes(
                    4
                );

                expect(
                    dependencies.context
                        .buildTechnicalRetryPayload
                ).toHaveBeenCalledTimes(
                    2
                );

                /*
                 * Solo il fallimento della prima iterazione
                 * produce un nuovo payload semantico.
                 */
                expect(
                    dependencies.context
                        .buildRefinementPayload
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    result.iterations
                ).toHaveLength(
                    2
                );

                expect(
                    result.iterations[0]
                        ?.technicalAttempts
                ).toBe(
                    2
                );

                expect(
                    result.iterations[1]
                        ?.technicalAttempts
                ).toBe(
                    2
                );

                expect(
                    result.currentIteration
                ).toBe(
                    2
                );

                expect(
                    result.maxIterations
                ).toBe(
                    2
                );
            }
        );

        it(
            'espone maxIterations configurato anche negli stati di errore anticipato',
            async () => {
                const dependencies =
                    createDependencies();

                dependencies.git
                    .getHead
                    .mockRejectedValue(
                        new Error(
                            'Git unavailable.'
                        )
                    );

                const limits:
                    ExperimentLimits = {
                    maxIterations:
                        5,

                    maxTechnicalAttempts:
                        3
                };

                const fsm =
                    createFsm(
                        dependencies,
                        limits
                    );

                const result =
                    await fsm.runLoop(
                        PARAMS
                    );

                expect(
                    result.maxIterations
                ).toBe(
                    5
                );

                expect(
                    result.currentIteration
                ).toBe(
                    0
                );

                expect(
                    result.iterations
                ).toEqual(
                    []
                );

                expect(
                    result.failure
                        ?.category
                ).toBe(
                    'INFRASTRUCTURE_FAILURE'
                );

                expect(
                    dependencies.coder
                        .generatePatch
                ).not.toHaveBeenCalled();
            }
        );
    }
);
