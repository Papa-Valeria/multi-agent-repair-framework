import { ExecutionPhase, TerminalWorkbenchSessionStatus, WorkbenchSessionState } from '../../src/types/domain.js';

export type {
  SastFinding,
  OracleStatus,
  TestExecutionReport,
  VerificationVerdict,
  AgentRole,
  AgentUsage,
  PatchChangeMetrics,
  TargetRemediation,
  TargetRemediation as ReviewerRemediation,
  CumulativeRemediation,
  ReviewerFeedbackPayload,
  ComputationalTelemetry,
  IterationRecord,
  ExecutionPhase,
  ExecutionErrorCategory,
  ExecutionFailure,
  RollbackResult,
  WorkbenchSessionState,
  WorkbenchStreamEvent
} from '../../src/types/domain.js';

export type LivePipelinePhase =
  Extract<
    ExecutionPhase,
    | 'INSPECTION'
    | 'EVALUATION'
    | 'REFINEMENT'
  >;

export type AutonomousPipelineStatus =
  Extract<
    TerminalWorkbenchSessionStatus,
    | 'CONVERGED'
    | 'UNRESOLVED'
    | 'FAILED'
    | 'INFRASTRUCTURE_ERROR'
  >;

export type PipelineFinalizationStatus =
  WorkbenchSessionState['finalizationStatus'];


export type {
  ExperimentCategory
} from '../../src/types/analytics.js';

export interface WorkspaceFile {
  readonly path: string;
  readonly originalContent: string;
  readonly modifiedContent: string;
  readonly status:
  | 'NEW'
  | 'MODIFIED'
  | 'UNCHANGED';
  readonly role:
  | 'TARGET'
  | 'TEST';
}
