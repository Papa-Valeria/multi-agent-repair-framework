import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ReviewerFeedbackPayload } from '../types/domain.js';

export interface InitialContextParams {
  readonly issueSpec: string;
  readonly targetFiles: readonly string[];
  readonly testFiles: readonly string[];
}

export class ContextBuilder {
  constructor(private readonly repoRoot: string) {}

  public async buildInitialPayload(params: InitialContextParams): Promise<string> {
    const targets: Record<string, string> = {};
    for (const relPath of params.targetFiles) {
      const full = path.join(this.repoRoot, relPath);
      targets[relPath] = await fs.readFile(full, 'utf-8');
    }

    const testContracts: Record<string, string> = {};
    for (const testPath of params.testFiles) {
      const full = path.join(this.repoRoot, testPath);
      const content = await fs.readFile(full, 'utf-8');
      testContracts[testPath] = this.extractSignaturesAndAssertions(content);
    }

    return JSON.stringify(
      {
        taskType: 'INITIAL_REPAIR',
        issueSpec: params.issueSpec,
        targetFiles: targets,
        testContracts
      },
      null,
      2
    );
  }

  public buildRefinementPayload(
    originalPayload: string,
    previousDiff: string,
    feedback: ReviewerFeedbackPayload
  ): string {
    const base = JSON.parse(originalPayload);
    const remediationsText = feedback.targetRemediations
      .map((r, i) => `${i + 1}. [${r.file}] Root Cause: ${r.rootCause}\n   Mandatory Correction:${r.mandatoryCorrection}`)
      .join('\n');

    return `=== REFINEMENT REQUEST ===
The previous patch was REJECTED by deterministic oracles and the repository has been reset to clean HEAD.

ORIGINAL SOURCE FILES:
${JSON.stringify(base.targetFiles, null, 2)}

TEST CONTRACTS:
${JSON.stringify(base.testContracts, null, 2)}

PREVIOUS REJECTED PATCH:
\`\`\`diff
${previousDiff}
\`\`\`

DIAGNOSTIC FEEDBACK FROM ORACLES (SEMGREP / TEST HARNESS):
Summary: ${feedback.rootCauseSummary}
Prescribed Fixes:
${remediationsText}

INSTRUCTIONS:
Generate a NEW and DIFFERENT Unified Diff patch directly modifying the original source files.
Ensure you satisfy BOTH security oracles and test assertions. Output ONLY the \`\`\`diff block.`;
  }

  private extractSignaturesAndAssertions(testSource: string): string {
    return testSource
      .split('\n')
      .filter((l) => l.includes('def test_') || l.includes('assert ') || l.includes('it(') || l.includes('expect('))
      .join('\n');
  }
}
