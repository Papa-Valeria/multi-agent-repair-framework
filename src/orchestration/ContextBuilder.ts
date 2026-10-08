import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ReviewerFeedbackPayload } from '../types/domain.js';
import { ExperimentCategory } from '../types/analytics.js';

export interface InitialContextParams {
  readonly issueSpec: string;
  readonly targetFiles: readonly string[];
  readonly testFiles: readonly string[];
  readonly category?: ExperimentCategory;
}

interface BaseContext {
  readonly issueSpec: string;
  readonly targets: Readonly<Record<string, string>>;
  readonly testContracts: Readonly<Record<string, string>>;
  readonly category: ExperimentCategory;
}

export class ContextBuilder {
  private baseContext: BaseContext | null = null;

  constructor(private readonly repoRoot: string) { }

  public async buildInitialPayload(params: InitialContextParams): Promise<string> {
    const category = params.category ?? 'REPAIR';
    const targets: Record<string, string> = {};

    for (const relPath of params.targetFiles) {
      const full = path.join(this.repoRoot, relPath);
      try {
        targets[relPath] = await fs.readFile(full, 'utf-8');
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT' || category === 'CREATE') {
          targets[relPath] =
            '[NEW FILE TO CREATE: The file does not exist yet. Synthesize the complete implementation from scratch to satisfy the testContracts and issueSpec]';
        } else {
          throw err;
        }
      }
    }

    const testContracts: Record<string, string> = {};
    for (const testPath of params.testFiles) {
      const full = path.join(this.repoRoot, testPath);
      try {
        const content = await fs.readFile(full, 'utf-8');
        testContracts[testPath] = this.extractSignaturesAndAssertions(content);
      } catch (err: unknown) {
        testContracts[testPath] = `# Impossibile leggere il file di test: ${(err as Error).message}`;
      }
    }

    this.baseContext = { issueSpec: params.issueSpec, targets, testContracts, category };

    const modeDirective = category === 'CREATE'
      ? 'MODE: CREATE (GREEN-FIELD SYNTHESIS). The target module does not exist on disk. Synthesize the complete module from scratch using the Git new-file syntax (--- /dev/null).'
      : 'MODE: REPAIR (BUG FIXING / REFACTORING). The target module exists. Produce minimal diff modifications to fix issues and pass tests.';

    return `=== INITIAL ${category} REQUEST ===
ISSUE: ${params.issueSpec}
${modeDirective}

${this.renderContext(this.baseContext)}

${category === 'CREATE' ? ContextBuilder.CREATE_DIFF_INSTRUCTIONS : ContextBuilder.DIFF_INSTRUCTIONS}`;
  }

  public buildRefinementPayload(
    _previousPayload: string,
    previousDiff: string,
    feedback: ReviewerFeedbackPayload
  ): string {
    const base = this.baseContext;
    if (!base) {
      throw new Error('buildRefinementPayload richiede una chiamata precedente a buildInitialPayload.');
    }

    const remediationsText = feedback.targetRemediations
      .map(
        (r, i) =>
          `${i + 1}. [${r.file}] Root Cause: ${r.rootCause}\n   Mandatory Correction: ${r.mandatoryCorrection}`
      )
      .join('\n');

    return `=== REFINEMENT REQUEST (${base.category}) ===
The previous patch was REJECTED by deterministic oracles and the repository has been reset to clean HEAD.
ISSUE: ${base.issueSpec}

${this.renderContext(base)}

PREVIOUS REJECTED PATCH:
\`\`\`diff
${previousDiff}
\`\`\`

DIAGNOSTIC FEEDBACK FROM ORACLES (SEMGREP / TEST HARNESS):
Summary: ${feedback.rootCauseSummary}
Prescribed Fixes:
${remediationsText}

Generate a NEW and DIFFERENT patch directly against the TARGET files above. Ensure you satisfy BOTH security oracles and test assertions.
${base.category === 'CREATE' ? ContextBuilder.CREATE_DIFF_INSTRUCTIONS : ContextBuilder.DIFF_INSTRUCTIONS}`;
  }

  private static readonly DIFF_INSTRUCTIONS = `OUTPUT RULES:
- Output ONLY one \`\`\`diff block and nothing else.
- Every context line (prefix ' ') and every removed line (prefix '-') MUST be copied character-for-character from the TARGET FILE above, including indentation. Never invent, reorder or paraphrase them.
- Use at most 3 context lines around each change.
- Added lines use the prefix '+' and must keep the file's indentation style.
- Hunk header line numbers are informational; the exact text of the lines decides where the patch applies.`;

  private static readonly CREATE_DIFF_INSTRUCTIONS = `OUTPUT RULES (NEW FILE SYNTHESIS):
- Output ONLY one \`\`\`diff block and nothing else.
- To create a new file, format the diff header strictly as:
  diff --git a/<targetFile> b/<targetFile>
  new file mode 100644
  --- /dev/null
  +++ b/<targetFile>
  @@ -0,0 +1,<num_lines> @@
- Every single line of the synthesized code MUST start with '+'.
- Do not add conversational text, markdown explanation, or comments outside the diff block.`;

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

  private extractSignaturesAndAssertions(testSource: string): string {
    return testSource
      .split('\n')
      .filter((l) => l.includes('def test_') || l.includes('assert ') || l.includes('it(') || l.includes('expect('))
      .join('\n');
  }
}
