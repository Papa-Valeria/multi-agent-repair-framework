import type {
  ExecutionErrorCategory,
  ExecutionFailure,
  TerminalWorkbenchSessionStatus
} from '../types/domain.js';
import type { OracleDecision } from '../verification/OracleDecision.js';

export type AutonomousTerminalStatus = Extract<
  TerminalWorkbenchSessionStatus,
  | 'CONVERGED'
  | 'UNRESOLVED'
  | 'FAILED'
  | 'INFRASTRUCTURE_ERROR'
>;

export type TerminalStateReason =
  | 'ALL_REQUIRED_GATES_PASSED'
  | 'REQUIRED_ORACLE_UNAVAILABLE'
  | 'INFRASTRUCTURE_FAILURE'
  | 'EXPERIMENTAL_OUTPUT_FAILURE'
  | 'REFINEMENT_BUDGET_EXHAUSTED'
  | 'REFINEMENT_STAGNATION'
  | 'VERIFICATION_GATES_FAILED';

export interface TerminalStateResolution {
  readonly status: AutonomousTerminalStatus;
  readonly reason: TerminalStateReason;
}

export function describeTerminalState(
  resolution: TerminalStateResolution,
  failure?: ExecutionFailure
): string {
  const description = (() => {
    switch (resolution.reason) {
      case 'ALL_REQUIRED_GATES_PASSED':
        return 'All required verification gates passed.';

      case 'REQUIRED_ORACLE_UNAVAILABLE':
        return 'One or more required verification oracles are not available.';

      case 'REFINEMENT_BUDGET_EXHAUSTED':
        return 'The refinement budget was exhausted without convergence.';

      case 'REFINEMENT_STAGNATION':
        return 'The refinement process stagnated without producing a new valid candidate.';

      case 'VERIFICATION_GATES_FAILED':
        return 'One or more required verification gates were not satisfied.';

      case 'EXPERIMENTAL_OUTPUT_FAILURE':
        return 'The generated experimental output was invalid.';

      case 'INFRASTRUCTURE_FAILURE':
        return 'The execution terminated because of an infrastructure or orchestration failure.';
    }
  })();

  return failure
    ? `${resolution.reason}: ${failure.category}: ${failure.message}`
    : `${resolution.reason}: ${description}`;
}

export interface TerminalStateContext {
  readonly decision?: OracleDecision;
  readonly failure?: ExecutionFailure;
  readonly refinementBudgetExhausted?: boolean;
  readonly requiredOracleUnavailable?: boolean;
}

const INFRASTRUCTURE_FAILURE_CATEGORIES = new Set<ExecutionErrorCategory>([
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
]);

const EXPERIMENTAL_OUTPUT_FAILURE_CATEGORIES = new Set<ExecutionErrorCategory>([
  'DIFF_EXTRACTION_FAILURE',
  'PATCH_SCOPE_FAILURE'
]);

const UNRESOLVED_FAILURE_CATEGORIES = new Set<ExecutionErrorCategory>([
  'PATCH_NOT_APPLICABLE',
  'REFINEMENT_STAGNATION'
]);

export function isInfrastructureFailureCategory(
  category: ExecutionErrorCategory
): boolean {
  return INFRASTRUCTURE_FAILURE_CATEGORIES.has(category);
}

export function isExperimentalOutputFailureCategory(
  category: ExecutionErrorCategory
): boolean {
  return EXPERIMENTAL_OUTPUT_FAILURE_CATEGORIES.has(category);
}

export function resolveTerminalState(
  context: TerminalStateContext
): TerminalStateResolution {
  const { decision, failure } = context;
  const refinementBudgetExhausted =
    context.refinementBudgetExhausted ?? false;

  if (failure && isInfrastructureFailureCategory(failure.category)) {
    return {
      status: 'INFRASTRUCTURE_ERROR',
      reason: 'INFRASTRUCTURE_FAILURE'
    };
  }

  if (
    decision?.hasInvariantViolation ||
    decision?.hasExecutionError
  ) {
    return {
      status: 'INFRASTRUCTURE_ERROR',
      reason: 'INFRASTRUCTURE_FAILURE'
    };
  }

  if (
    context.requiredOracleUnavailable ||
    decision?.hasRequiredUnavailable
  ) {
    return {
      status: 'UNRESOLVED',
      reason: 'REQUIRED_ORACLE_UNAVAILABLE'
    };
  }

  if (failure?.category === 'REFINEMENT_STAGNATION') {
    return {
      status: 'UNRESOLVED',
      reason: 'REFINEMENT_STAGNATION'
    };
  }

  if (
    failure &&
    UNRESOLVED_FAILURE_CATEGORIES.has(
      failure.category
    )
  ) {
    return {
      status: 'UNRESOLVED',
      reason: refinementBudgetExhausted
        ? 'REFINEMENT_BUDGET_EXHAUSTED'
        : 'VERIFICATION_GATES_FAILED'
    };
  }

  if (
    failure &&
    isExperimentalOutputFailureCategory(
      failure.category
    )
  ) {
    return {
      status: 'FAILED',
      reason: 'EXPERIMENTAL_OUTPUT_FAILURE'
    };
  }

  if (decision?.converged) {
    return {
      status: 'CONVERGED',
      reason: 'ALL_REQUIRED_GATES_PASSED'
    };
  }

  if (
    decision?.shouldRefine &&
    refinementBudgetExhausted
  ) {
    return {
      status: 'UNRESOLVED',
      reason: 'REFINEMENT_BUDGET_EXHAUSTED'
    };
  }

  if (decision && !decision.converged) {
    return {
      status: 'UNRESOLVED',
      reason: 'VERIFICATION_GATES_FAILED'
    };
  }

  if (refinementBudgetExhausted) {
    return {
      status: 'UNRESOLVED',
      reason: 'REFINEMENT_BUDGET_EXHAUSTED'
    };
  }

  return {
    status: 'INFRASTRUCTURE_ERROR',
    reason: 'INFRASTRUCTURE_FAILURE'
  };
}
