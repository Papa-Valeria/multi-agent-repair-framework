import type {
    ExecutionErrorCategory,
    ExecutionFailure
} from '../src/types/domain.js';

import type {
    OracleDecision
} from '../src/verification/OracleDecision.js';

import {
    describeTerminalState,
    resolveTerminalState
} from '../src/orchestration/TerminalStatePolicy.js';

function createFailure(
    category: ExecutionErrorCategory
): ExecutionFailure {
    return {
        phase: 'EVALUATION',
        category,
        message: `Failure ${category}`,
        originalErrorName: 'TestError',
        recoverable: false,
        iteration: 1
    };
}

function createDecision(
    overrides: Partial<OracleDecision>
): OracleDecision {
    return {
        converged: false,
        shouldRefine: false,
        hasInvariantViolation: false,
        hasExecutionError: false,
        hasRequiredUnavailable: false,
        missingRequiredOracles: [],
        duplicateOracles: [],
        requirementMismatches: [],
        executionErrors: [],
        requiredUnavailable: [],
        failedResults: [],
        ...overrides
    } as OracleDecision;
}

describe('TerminalStatePolicy', () => {
    describe.each([
        'CONTEXT_BUILD_FAILURE',
        'MODEL_GENERATION_FAILURE',
        'PATCH_APPLICATION_FAILURE',
        'ORACLE_EXECUTION_FAILURE',
        'ORACLE_INVARIANT_FAILURE',
        'REVIEWER_FAILURE',
        'REFINEMENT_CONTEXT_FAILURE',
        'ROLLBACK_FAILURE',
        'PERSISTENCE_FAILURE',
        'INFRASTRUCTURE_FAILURE',
        'UNKNOWN_FAILURE'
    ] satisfies readonly ExecutionErrorCategory[])(
        'infrastructure category %s',
        (category) => {
            it('returns INFRASTRUCTURE_ERROR', () => {
                const result = resolveTerminalState({
                    failure: createFailure(category),
                    refinementBudgetExhausted: true
                });

                expect(result).toEqual({
                    status: 'INFRASTRUCTURE_ERROR',
                    reason: 'INFRASTRUCTURE_FAILURE'
                });
            });
        }
    );

    describe.each([
        'DIFF_EXTRACTION_FAILURE',
        'PATCH_SCOPE_FAILURE'
    ] satisfies readonly ExecutionErrorCategory[])(
        'experimental output category %s',
        (category) => {
            it('returns FAILED', () => {
                const result = resolveTerminalState({
                    failure: createFailure(category),
                    refinementBudgetExhausted: true
                });

                expect(result).toEqual({
                    status: 'FAILED',
                    reason: 'EXPERIMENTAL_OUTPUT_FAILURE'
                });
            });
        }
    );

    it(
        'classifies an empty terminal context as INFRASTRUCTURE_ERROR',
        () => {
            const result = resolveTerminalState({});

            expect(result).toEqual({
                status: 'INFRASTRUCTURE_ERROR',
                reason: 'INFRASTRUCTURE_FAILURE'
            });
        }
    );

    it(
        'classifies PATCH_NOT_APPLICABLE as UNRESOLVED',
        () => {
            const result = resolveTerminalState({
                failure: createFailure(
                    'PATCH_NOT_APPLICABLE'
                ),
                refinementBudgetExhausted: true
            });

            expect(result).toEqual({
                status: 'UNRESOLVED',
                reason: 'REFINEMENT_BUDGET_EXHAUSTED'
            });
        }
    );

    it(
        'classifies REFINEMENT_STAGNATION with its specific reason',
        () => {
            const result = resolveTerminalState({
                failure: createFailure(
                    'REFINEMENT_STAGNATION'
                ),
                refinementBudgetExhausted: true
            });

            expect(result).toEqual({
                status: 'UNRESOLVED',
                reason: 'REFINEMENT_STAGNATION'
            });
        }
    );

    it(
        'returns CONVERGED when all required gates passed',
        () => {
            const decision = createDecision({
                converged: true
            });

            const result = resolveTerminalState({
                decision,
                refinementBudgetExhausted: false
            });

            expect(result).toEqual({
                status: 'CONVERGED',
                reason: 'ALL_REQUIRED_GATES_PASSED'
            });
        }
    );

    it(
        'returns UNRESOLVED when refinement budget is exhausted',
        () => {
            const decision = createDecision({
                shouldRefine: true
            });

            const result = resolveTerminalState({
                decision,
                refinementBudgetExhausted: true
            });

            expect(result).toEqual({
                status: 'UNRESOLVED',
                reason: 'REFINEMENT_BUDGET_EXHAUSTED'
            });
        }
    );

    it(
        'returns UNRESOLVED when a required oracle is unavailable',
        () => {
            const decision = createDecision({
                hasRequiredUnavailable: true
            });

            const result = resolveTerminalState({
                decision,
                refinementBudgetExhausted: false
            });

            expect(result).toEqual({
                status: 'UNRESOLVED',
                reason: 'REQUIRED_ORACLE_UNAVAILABLE'
            });
        }
    );

    it(
        'returns UNRESOLVED when required-oracle unavailability is reported before a decision exists',
        () => {
            const result = resolveTerminalState({
                requiredOracleUnavailable: true,
                refinementBudgetExhausted: true
            });

            expect(result).toEqual({
                status: 'UNRESOLVED',
                reason: 'REQUIRED_ORACLE_UNAVAILABLE'
            });
        }
    );

    it(
        'returns INFRASTRUCTURE_ERROR for an oracle execution error',
        () => {
            const decision = createDecision({
                hasExecutionError: true
            });

            const result = resolveTerminalState({
                decision,
                refinementBudgetExhausted: true
            });

            expect(result).toEqual({
                status: 'INFRASTRUCTURE_ERROR',
                reason: 'INFRASTRUCTURE_FAILURE'
            });
        }
    );

    it(
        'returns INFRASTRUCTURE_ERROR for an oracle invariant violation',
        () => {
            const decision = createDecision({
                hasInvariantViolation: true
            });

            const result = resolveTerminalState({
                decision,
                refinementBudgetExhausted: true
            });

            expect(result).toEqual({
                status: 'INFRASTRUCTURE_ERROR',
                reason: 'INFRASTRUCTURE_FAILURE'
            });
        }
    );

    it(
        'returns UNRESOLVED when verification gates fail',
        () => {
            const decision = createDecision({
                converged: false,
                shouldRefine: false
            });

            const result = resolveTerminalState({
                decision,
                refinementBudgetExhausted: false
            });

            expect(result).toEqual({
                status: 'UNRESOLVED',
                reason: 'VERIFICATION_GATES_FAILED'
            });
        }
    );

    it(
        'gives rollback failure precedence over a converged decision',
        () => {
            const decision = createDecision({
                converged: true
            });

            const result = resolveTerminalState({
                failure: createFailure(
                    'ROLLBACK_FAILURE'
                ),
                decision,
                refinementBudgetExhausted: false
            });

            expect(result).toEqual({
                status: 'INFRASTRUCTURE_ERROR',
                reason: 'INFRASTRUCTURE_FAILURE'
            });
        }
    );

    it(
        'gives experimental output failure precedence over a converged decision',
        () => {
            const decision = createDecision({
                converged: true
            });

            const result = resolveTerminalState({
                failure: createFailure(
                    'PATCH_SCOPE_FAILURE'
                ),
                decision,
                refinementBudgetExhausted: false
            });

            expect(result).toEqual({
                status: 'FAILED',
                reason: 'EXPERIMENTAL_OUTPUT_FAILURE'
            });
        }
    );

    it(
        'derives terminationReason from the canonical infrastructure reason',
        () => {
            const failure = createFailure(
                'REVIEWER_FAILURE'
            );

            const resolution = resolveTerminalState({
                failure,
                refinementBudgetExhausted: true
            });

            expect(
                describeTerminalState(
                    resolution,
                    failure
                )
            ).toBe(
                'INFRASTRUCTURE_FAILURE: REVIEWER_FAILURE: Failure REVIEWER_FAILURE'
            );
        }
    );

    it(
        'derives terminationReason from the canonical convergence reason',
        () => {
            const decision = createDecision({
                converged: true
            });

            const resolution = resolveTerminalState({
                decision,
                refinementBudgetExhausted: false
            });

            expect(
                describeTerminalState(
                    resolution
                )
            ).toBe(
                'ALL_REQUIRED_GATES_PASSED: All required verification gates passed.'
            );
        }
    );
});
