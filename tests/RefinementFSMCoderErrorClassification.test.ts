import {
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import {
    CoderModelInvocationError,
    CoderOutputExtractionError,
    type CoderAgent
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
    BuildSyntaxOracle
} from '../src/verification/BuildSyntaxOracle.js';

import type {
    SemgrepEngine
} from '../src/verification/SemgrepEngine.js';

import type {
    TestHarness
} from '../src/verification/TestHarness.js';

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

interface FsmFixture {
    readonly fsm:
    RefinementFSM;

    readonly coder:
    CoderAgent;

    readonly gitManager:
    GitManager;

    readonly contextBuilder:
    ContextBuilder;
}

const createFsm =
    (
        coderError:
            unknown
    ): FsmFixture => {
        const coder =
            {
                generatePatch:
                    jest.fn(
                        async (): Promise<string> => {
                            throw coderError;
                        }
                    )
            } as unknown as CoderAgent;

        const gitManager =
            {
                getHead:
                    jest.fn(
                        async (): Promise<string> =>
                            'initial-head'
                    ),

                assertWorkingTreeClean:
                    jest.fn(
                        async (): Promise<void> =>
                            undefined
                    )
            } as unknown as GitManager;

        const contextBuilder =
            {
                buildInitialPayload:
                    jest.fn(
                        async (): Promise<string> =>
                            'initial payload'
                    ),

                buildRefinementPayload:
                    jest.fn(
                        (): string =>
                            'refinement payload'
                    ),

                buildTechnicalRetryPayload:
                    jest.fn(
                        (): string =>
                            'technical retry payload'
                    )
            } as unknown as ContextBuilder;

        const reviewer =
            {
                review:
                    jest.fn(
                        async (): Promise<never> => {
                            throw new Error(
                                'ReviewerAgent non deve essere invocato.'
                            );
                        }
                    )
            } as unknown as ReviewerAgent;

        const semgrep =
            {
                evaluate:
                    jest.fn(
                        async (): Promise<never> => {
                            throw new Error(
                                'SemgrepEngine non deve essere invocato.'
                            );
                        }
                    )
            } as unknown as SemgrepEngine;

        const testHarness =
            {
                evaluate:
                    jest.fn(
                        async (): Promise<never> => {
                            throw new Error(
                                'TestHarness non deve essere invocato.'
                            );
                        }
                    )
            } as unknown as TestHarness;

        const buildSyntaxOracle =
            {
                evaluate:
                    jest.fn(
                        async (): Promise<never> => {
                            throw new Error(
                                'BuildSyntaxOracle non deve essere invocato.'
                            );
                        }
                    )
            } as unknown as BuildSyntaxOracle;

        const fsm =
            new RefinementFSM(
                'BE-P1-01-coder-errors',
                gitManager,
                semgrep,
                testHarness,
                buildSyntaxOracle,
                coder,
                reviewer,
                contextBuilder,
                new TelemetryTracker()
            );

        return {
            fsm,
            coder,
            gitManager,
            contextBuilder
        };
    };

describe(
    'BE-P1-01 - RefinementFSM typed Coder error classification',
    () => {
        describe(
            'Baseline',
            () => {
                it(
                    'classifica CoderModelInvocationError come MODEL_GENERATION_FAILURE anche se il messaggio contiene parole da extraction failure',
                    async () => {
                        const {
                            fsm,
                            coder
                        } =
                            createFsm(
                                new CoderModelInvocationError(
                                    'invalid diff, risposta vuota e file di test protetto'
                                )
                            );

                        const result =
                            await fsm.runBaseline(
                                params
                            );

                        expect(
                            coder.generatePatch
                        ).toHaveBeenCalledTimes(
                            1
                        );

                        expect(
                            result.failure
                        ).toMatchObject({
                            phase:
                                'INSPECTION',

                            category:
                                'MODEL_GENERATION_FAILURE',

                            originalErrorName:
                                'CoderModelInvocationError',

                            recoverable:
                                false,

                            iteration:
                                1
                        });

                        expect(
                            result.iterations
                        ).toHaveLength(
                            1
                        );

                        expect(
                            result.iterations[0]
                                ?.failure?.category
                        ).toBe(
                            'MODEL_GENERATION_FAILURE'
                        );

                        expect(
                            result.iterations[0]
                                ?.verification
                                .testReport
                                .failureDetails[0]
                                ?.testName
                        ).toBe(
                            'ModelGenerationFailure'
                        );

                        expect(
                            result.iterations[0]
                                ?.verification
                                .testReport
                                .failureDetails[0]
                                ?.assertionMessage
                        ).toContain(
                            'Model Generation Failure'
                        );
                    }
                );

                it(
                    'classifica CoderOutputExtractionError come DIFF_EXTRACTION_FAILURE senza dipendere da keyword nel messaggio',
                    async () => {
                        const {
                            fsm
                        } =
                            createFsm(
                                new CoderOutputExtractionError(
                                    'generic output problem'
                                )
                            );

                        const result =
                            await fsm.runBaseline(
                                params
                            );

                        expect(
                            result.failure
                        ).toMatchObject({
                            phase:
                                'INSPECTION',

                            category:
                                'DIFF_EXTRACTION_FAILURE',

                            originalErrorName:
                                'CoderOutputExtractionError',

                            recoverable:
                                false,

                            iteration:
                                1
                        });

                        expect(
                            result.iterations[0]
                                ?.verification
                                .testReport
                                .failureDetails[0]
                                ?.testName
                        ).toBe(
                            'DiffFormatFailure'
                        );

                        expect(
                            result.iterations[0]
                                ?.verification
                                .testReport
                                .failureDetails[0]
                                ?.assertionMessage
                        ).toContain(
                            'Diff Extraction Failure'
                        );
                    }
                );

                it(
                    'classifica un errore Coder non tipizzato come UNKNOWN_FAILURE',
                    async () => {
                        const {
                            fsm
                        } =
                            createFsm(
                                new Error(
                                    'diff response empty protected oracle'
                                )
                            );

                        const result =
                            await fsm.runBaseline(
                                params
                            );

                        expect(
                            result.failure
                        ).toMatchObject({
                            phase:
                                'INSPECTION',

                            category:
                                'UNKNOWN_FAILURE',

                            originalErrorName:
                                'Error',

                            recoverable:
                                false,

                            iteration:
                                1
                        });

                        expect(
                            result.iterations[0]
                                ?.verification
                                .testReport
                                .failureDetails[0]
                                ?.testName
                        ).toBe(
                            'UnknownFailure'
                        );

                        expect(
                            result.iterations[0]
                                ?.verification
                                .testReport
                                .failureDetails[0]
                                ?.assertionMessage
                        ).toContain(
                            'Unknown Coder Failure'
                        );
                    }
                );
            }
        );

        describe(
            'Multi-Agent',
            () => {
                it(
                    'classifica CoderModelInvocationError come MODEL_GENERATION_FAILURE anche con messaggio fuorviante',
                    async () => {
                        const {
                            fsm,
                            coder,
                            contextBuilder
                        } =
                            createFsm(
                                new CoderModelInvocationError(
                                    'invalid diff and protected test file'
                                )
                            );

                        const result =
                            await fsm.runLoop(
                                params
                            );

                        expect(
                            coder.generatePatch
                        ).toHaveBeenCalledTimes(
                            RefinementFSM.MAX_ITERATIONS
                        );

                        expect(
                            contextBuilder
                                .buildRefinementPayload
                        ).toHaveBeenCalledTimes(
                            RefinementFSM.MAX_ITERATIONS -
                            1
                        );

                        expect(
                            result.failure
                        ).toMatchObject({
                            phase:
                                'INSPECTION',

                            category:
                                'MODEL_GENERATION_FAILURE',

                            originalErrorName:
                                'CoderPatchGenerationError',

                            iteration:
                                RefinementFSM.MAX_ITERATIONS
                        });

                        expect(
                            result.iterations
                        ).toHaveLength(
                            RefinementFSM.MAX_ITERATIONS
                        );

                        for (
                            const iteration of
                            result.iterations
                        ) {
                            expect(
                                iteration.failure?.category
                            ).toBe(
                                'MODEL_GENERATION_FAILURE'
                            );

                            expect(
                                iteration.verification
                                    .testReport
                                    .failureDetails[0]
                                    ?.testName
                            ).toBe(
                                'ModelGenerationFailure'
                            );
                        }
                    }
                );

                it(
                    'classifica CoderOutputExtractionError come DIFF_EXTRACTION_FAILURE anche con messaggio senza keyword',
                    async () => {
                        const {
                            fsm
                        } =
                            createFsm(
                                new CoderOutputExtractionError(
                                    'generic output problem'
                                )
                            );

                        const result =
                            await fsm.runLoop(
                                params
                            );

                        expect(
                            result.failure
                        ).toMatchObject({
                            phase:
                                'INSPECTION',

                            category:
                                'DIFF_EXTRACTION_FAILURE',

                            originalErrorName:
                                'CoderPatchGenerationError',

                            iteration:
                                RefinementFSM.MAX_ITERATIONS
                        });

                        expect(
                            result.iterations
                        ).toHaveLength(
                            RefinementFSM.MAX_ITERATIONS
                        );

                        for (
                            const iteration of
                            result.iterations
                        ) {
                            expect(
                                iteration.failure?.category
                            ).toBe(
                                'DIFF_EXTRACTION_FAILURE'
                            );

                            expect(
                                iteration.verification
                                    .testReport
                                    .failureDetails[0]
                                    ?.testName
                            ).toBe(
                                'DiffFormatFailure'
                            );
                        }
                    }
                );

                it(
                    'non trasforma un errore sconosciuto in MODEL_GENERATION_FAILURE',
                    async () => {
                        const {
                            fsm,
                            coder
                        } =
                            createFsm(
                                new Error(
                                    'invalid diff risposta vuota file di test'
                                )
                            );

                        const result =
                            await fsm.runLoop(
                                params
                            );

                        expect(
                            coder.generatePatch
                        ).toHaveBeenCalledTimes(
                            1
                        );

                        expect(
                            result.failure
                        ).toMatchObject({
                            phase:
                                'INSPECTION',

                            category:
                                'UNKNOWN_FAILURE',

                            originalErrorName:
                                'Error',

                            recoverable:
                                false,

                            iteration:
                                1
                        });

                        /*
                         * L'errore sconosciuto termina prima
                         * della creazione di un IterationRecord
                         * sintetico, perché non è considerato
                         * una normale failure recuperabile del
                         * Coder.
                         */
                        expect(
                            result.iterations
                        ).toHaveLength(
                            0
                        );
                    }
                );
            }
        );
    }
);
