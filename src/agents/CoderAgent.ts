import { OpenAICompatibleClient, ChatMessage } from '../inference/OpenAICompatibleClient.js';

export class CoderAgent {
  private static readonly SYSTEM_PROMPT =
`You are an autonomous software engineering agent specialized in precise code repair.
Your task is to produce a valid Unified Diff patch to fix the target codebase.

CRITICAL OPERATIONAL CONSTRAINTS:
1. You MUST generate ONLY a valid Unified Diff patch enclosed in a single \`\`\`diff ... \`\`\` block.
2. Do NOT touch, modify, or patch any TEST files. Test suites are immutable validation oracles.
3. Modify ONLY the target source files specified in the request.
4. Do NOT write any conversational text, explanations, or markdown outside the diff block.
5. ZERO CONTEXT AMBIGUITY: Every single line you want to alter MUST be prefixed with '-'. The replacement line MUST be prefixed with '+'. Never output a desired new line without a '+' prefix.
6. Context lines before and after the change must match the target files VERBATIM.
7. CRITICAL: The repository working tree is ALWAYS RESET to clean HEAD before every iteration. Generate diffs directly against the ORIGINAL base files shown in 'targetFiles'.`;

  constructor(private readonly client: OpenAICompatibleClient) {}

  public async generatePatch(userPromptPayload: string): Promise<string> {
    const messages: readonly ChatMessage[] = [
      { role: 'system', content: CoderAgent.SYSTEM_PROMPT },
      { role: 'user', content: userPromptPayload }
    ];

    const rawOutput = await this.client.completeChat(messages);
    return this.extractDiff(rawOutput);
  }

  /**
   * Sanitizzazione e normalizzazione agnostica del blocco unified diff.
   */
  public extractDiff(rawResponse: string): string {
    const match = /```(?:diff)?\s*([\s\S]*?)\s*```/i.exec(rawResponse);
    let content = match && match[1] ? match[1].trim() : rawResponse.trim();

    content = content.replace(/\\"/g, '"').replace(/\\'/g, "'");
    content = content.replace(/\r\n/g, '\n');

    const fileDiffs = content.split(/(?=diff --git )/g);

    const sanitizedDiffs = fileDiffs.filter(block => {
      const headerMatch = block.match(/diff --git a\/(\S+) b\/(\S+)/);
      if (!headerMatch) return true;
      const targetPath = headerMatch[2];
      const isTest = targetPath?.startsWith('test_') || targetPath?.endsWith('_test.py') || targetPath?.includes('test');
      if (isTest) {
        console.warn(`[CoderAgent] Rimosso hunk illegale sul file di test: ${targetPath}`);
        return false;
      }
      return true;
    });

    content = sanitizedDiffs.join('').trim();

    // Normalizzazione agnostica degli header diff: garantisce a/ e b/
    content = content.replace(/^--- (?!a\/)(\S+)/gm, '--- a/$1');
    content = content.replace(/^\+\+\+ (?!b\/)(\S+)/gm, '+++ b/$1');

    if (!content.includes('--- ') || !content.includes('+++ ')) {
      throw new Error('La risposta generata non contiene un blocco Unified Diff valido.');
    }

    return content;
  }
}
