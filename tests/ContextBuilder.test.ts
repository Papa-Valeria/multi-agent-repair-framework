import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContextBuilder } from '../src/orchestration/ContextBuilder.js';
import { ReviewerFeedbackPayload } from '../src/types/domain.js';

const feedback: ReviewerFeedbackPayload = {
  rootCauseSummary: 'Test failure',
  violationsPrunedCount: 0,
  targetRemediations: [{
    file: 'service.py',
    lineRange: { start: 1, end: 1 },
    rootCause: 'cause',
    mandatoryCorrection: 'fix it'
  }],
  securityPriorityStrict: true,
  flappingDetected: false
};

describe('ContextBuilder prompts', () => {
  let repo: string;
  const params = { issueSpec: 'Fix the bug', targetFiles: ['service.py'], testFiles: ['test_service.py'] };

  beforeEach(async () => {
    repo = await mkdtemp(path.join(os.tmpdir(), 'context-builder-'));
    await writeFile(path.join(repo, 'service.py'), 'def f():\n    query = "SELECT 1"\n    return False\n');
    await writeFile(path.join(repo, 'test_service.py'), 'def test_f():\n    assert f() is True\n');
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('shows the target source verbatim instead of a JSON-escaped string', async () => {
    const payload = await new ContextBuilder(repo).buildInitialPayload(params);

    expect(payload).toContain('def f():\n    query = "SELECT 1"\n    return False');
    expect(payload).not.toContain('\\"');
    expect(payload).toContain('copied character-for-character');
  });

  it('can build refinement prompts on consecutive iterations from the original source', async () => {
    const builder = new ContextBuilder(repo);
    const initial = await builder.buildInitialPayload(params);

    const first = builder.buildRefinementPayload(initial, '--- a/service.py\n+++ b/service.py', feedback);
    const second = builder.buildRefinementPayload(first, '--- a/service.py\n+++ b/service.py', feedback);

    expect(second).toContain('    query = "SELECT 1"');
    expect(second).toContain('Mandatory Correction: fix it');
    expect(second.match(/TARGET FILE: service\.py/g)).toHaveLength(1);
  });
});
