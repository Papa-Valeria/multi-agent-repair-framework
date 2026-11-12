import * as fs from 'node:fs/promises';
import {
  resolveRepositoryPath
} from '../security/RepositoryPathPolicy.js';
import type {
  CumulativeRemediation,
  FunctionalTestOracleConfig,
  ReviewerFeedbackPayload
} from '../types/domain.js';
import type { ExperimentCategory } from '../types/analytics.js';
import type { BuildOracleConfig } from '../inference/BuildOracleConfig.js';
import { DEFAULT_PROMPT_PROFILE } from '../inference/PromptProfile.js';
import type { PromptProfile } from '../inference/PromptProfile.js';

export interface InitialContextParams {
  readonly issueSpec: string;
  readonly targetFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly category: ExperimentCategory;
  readonly buildOracleConfig?: BuildOracleConfig;
  readonly functionalTestOracleConfig?: FunctionalTestOracleConfig;
}

export interface RefinementContextParams {
  readonly iteration: number;
  readonly previousCandidatePatch?: string;
  readonly currentFeedback: ReviewerFeedbackPayload;
  readonly cumulativeRemediations: readonly CumulativeRemediation[];
  readonly currentFailure: string;
}

interface BaseContext {
  readonly issueSpec: string;
  readonly targets: Readonly<Record<string, string>>;
  readonly testContracts: Readonly<Record<string, string>>;
  readonly category: ExperimentCategory;
}

export class ContextBuilder {
  private baseContext: BaseContext | null = null;

  constructor(
    private readonly repoRoot: string,
    private readonly promptProfile: PromptProfile = DEFAULT_PROMPT_PROFILE
  ) { }

  public async buildInitialPayload(
    params: InitialContextParams
  ): Promise<string> {
    const category =
      params.category;

    const targets:
      Record<string, string> = {};

    for (
      const relPath of
      params.targetFiles
    ) {
      const resolved =
        await resolveRepositoryPath({
          repositoryRoot:
            this.repoRoot,

          relativePath:
            relPath,

          allowMissing:
            category === 'CREATE'
        });

      try {
        const content =
          await fs.readFile(
            resolved.absolutePath,
            'utf8'
          );

        targets[
          resolved.relativePath
        ] = content;
      } catch (err: unknown) {
        const error =
          err as NodeJS.ErrnoException;

        if (
          error.code === 'ENOENT' &&
          category === 'CREATE'
        ) {
          targets[resolved.relativePath] = this.promptProfile.contextBuilder.newFileTargetMarker;
        } else {
          throw err;
        }
      }
    }

    const testContracts:
      Record<string, string> = {};

    for (
      const testPath of
      params.testFiles
    ) {
      const resolved =
        await resolveRepositoryPath({
          repositoryRoot:
            this.repoRoot,

          relativePath:
            testPath
        });
      const content =
        await fs.readFile(
          resolved.absolutePath,
          'utf8'
        );

      testContracts[
        resolved.relativePath
      ] = content;
    }

    this.baseContext = {
      issueSpec:
        params.issueSpec,

      targets,

      testContracts,

      category
    };

    const modeDirective =
      category === 'CREATE'
        ? this.promptProfile
          .contextBuilder
          .createModeDirective
        : this.promptProfile
          .contextBuilder
          .repairModeDirective;
    return `=== INITIAL ${category} REQUEST ===
ISSUE: ${params.issueSpec}
${modeDirective}

${this.renderContext(this.baseContext)}

${category === 'CREATE'
        ? this.promptProfile
          .contextBuilder
          .createDiffInstructions
        : this.promptProfile
          .contextBuilder
          .diffInstructions}`;
  }

  public buildRefinementPayload(params: RefinementContextParams): string {
    const base = this.baseContext;
    if (!base) {
      throw new Error('buildRefinementPayload richiede una chiamata precedente a buildInitialPayload.');
    }

    const {
      iteration,
      previousCandidatePatch,
      currentFeedback,
      cumulativeRemediations,
      currentFailure
    } = params;

    if (cumulativeRemediations.length === 0) {
      throw new Error('Il refinement richiede almeno una remediation cumulativa.');
    }

    const previousPatchSection = previousCandidatePatch?.trim() ? `PREVIOUS CANDIDATE PATCH:
The following patch was evaluated in the previous iteration and has now been rolled back.

It is evidence of the complete set of changes attempted previously, but it is not the current repository state.

Preserve its still-valid changes in the replacement patch. Remove or replace a previous change only when it conflicts with:
- the original issue specification;
- current oracle evidence;
- a cumulative mandatory correction;
- repository scope or protected-test constraints.

${ContextBuilder.fence(previousCandidatePatch)}`
      : `PREVIOUS CANDIDATE PATCH:
No usable candidate patch is available from the previous iteration.`;

    const remediationsText = cumulativeRemediations.map((entry, index) => {
      const remediation = entry.remediation;
      return [
        `${index + 1}. [${remediation.file}]`,
        `   Line range: ${remediation.lineRange.start}-${remediation.lineRange.end}`,
        `   First observed: iteration ${entry.firstObservedIteration}`,
        `   Last observed: iteration ${entry.lastObservedIteration}`,
        `   Observation count: ${entry.observationCount}`,
        `   Root Cause: ${remediation.rootCause}`,
        `   Mandatory Correction: ${remediation.mandatoryCorrection}`,
        remediation.relatedRuleId
          ? `   Related Rule: ${remediation.relatedRuleId}`
          : ''
      ]
        .filter((line) => line.length > 0)
        .join('\n');
    })
      .join('\n\n');

    return `=== REFINEMENT REQUEST (${base.category}) ===

REFINEMENT ITERATION:
${iteration}

REPOSITORY STATE:
- The previous candidate patch was rejected and has been completely rolled back.
- The repository is currently at its original clean HEAD.
- The TARGET FILE contents below are the only authoritative source state.
- Generate a complete new Unified Diff against these exact original contents.
- Do not treat any previous candidate patch as the current repository state.
- Do not reproduce previously diagnosed faulty behavior.

ORIGINAL ISSUE SPECIFICATION:
${base.issueSpec}

AUTHORITATIVE ORIGINAL CONTEXT:
${this.renderContext(base)}

${previousPatchSection}

CURRENT FAILURE:
${currentFailure}

CURRENT ORACLE DIAGNOSIS:
${currentFeedback.rootCauseSummary}

CUMULATIVE MANDATORY CORRECTIONS:
${remediationsText}

${this.promptProfile.contextBuilder.refinementInstructions}
${base.category === 'CREATE'
        ? this.promptProfile
          .contextBuilder
          .createRefinementDirective
        : this.promptProfile
          .contextBuilder
          .repairRefinementDirective}
${base.category === 'CREATE'
        ? this.promptProfile
          .contextBuilder
          .createDiffInstructions
        : this.promptProfile
          .contextBuilder
          .diffInstructions}`;
  }

  public buildTechnicalRetryPayload(semanticPayload: string, rejectedPatch: string, applicabilitySummary: string, attempt: number): string {
    return `${semanticPayload}
    === UNIFIED DIFF TECHNICAL RETRY ===

TECHNICAL ATTEMPT:
${attempt}

The previous candidate was rejected by the Applicability Oracle.

APPLICABILITY DIAGNOSIS:
${applicabilitySummary}

REJECTED CANDIDATE PATCH:
${ContextBuilder.fence(rejectedPatch)}

${this.promptProfile
        .contextBuilder
        .technicalRetryInstructions}`;
  }

  private renderContext(base: BaseContext): string {
    const targetBlocks = Object.entries(base.targets)
      .map(([file, content]) => `TARGET FILE: ${file}\n${ContextBuilder.fence(content)}`)
      .join('\n\n');

    const testBlocks = Object.entries(base.testContracts)
      .map(([file, content]) => `TEST CONTRACT (read-only): ${file}\n${ContextBuilder.fence(content)}`)
      .join('\n\n');

    return [targetBlocks, testBlocks].filter((block) => block.length > 0).join('\n\n');
  }

  private static fence(content: string): string {
    const longestRun = Math.max(2, ...(content.match(/`+/g) ?? []).map((run) => run.length));
    const marker = '`'.repeat(longestRun + 1);
    return `${marker}\n${content.replace(/\r\n/g, '\n')}\n${marker}`;
  }
}
