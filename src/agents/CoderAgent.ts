import { OpenAICompatibleClient, ChatMessage } from '../inference/OpenAICompatibleClient.js';

export class CoderAgent {
  private static readonly SYSTEM_PROMPT = `You are an autonomous software engineering agent specialized in precise code modifications and module synthesis.
Your task is to produce a valid Unified Diff patch to satisfy the requirements on the target codebase.

CRITICAL OPERATIONAL CONSTRAINTS:
1. You MUST generate ONLY a valid Unified Diff patch enclosed in a single \`\`\`diff ... \`\`\` block.
2. Do NOT touch, modify, or patch any TEST files. Test suites are immutable validation oracles.
3. Modify or create ONLY the target source files specified in the request.
4. Do NOT write any conversational text, explanations, or markdown outside the diff block.
5. ZERO CONTEXT AMBIGUITY: Every single line you alter must have prefix '-', every new line must have prefix '+'.
6. Context lines before and after changes must match the target files VERBATIM when modifying existing files.
7. CRITICAL: The repository working tree is ALWAYS RESET to clean HEAD before every iteration.
8. NEW FILE CREATION: If creating a new file from scratch, use the standard Git syntax:
   diff --git a/<path> b/<path>
   new file mode 100644
   --- /dev/null
   +++ b/<path>
   @@ -0,0 +1,<num_lines> @@
   followed by all synthesized code lines, each prefixed with '+'.`;

  constructor(private readonly client: OpenAICompatibleClient) { }

  private static bindToTarget(content: string, target: string): string {
    if (!content.includes('@@')) return content;
    const isNewFile = content.includes('--- /dev/null');
    const headerPattern = /^--- [^\n]*\n\+\+\+ [^\n]*$/m;

    if (!headerPattern.test(content)) {
      const oldHeader = isNewFile ? '--- /dev/null' : `--- a/${target}`;
      return `${oldHeader}\n+++ b/${target}\n${content}`;
    }

    const paths = new Set([...content.matchAll(/^\+\+\+ (?:b\/)?(\S+)/gm)].map((match) => match[1]));
    if (paths.size !== 1 || paths.has(target)) return content;

    const oldHeader = isNewFile ? '--- /dev/null' : `--- a/${target}`;
    return content
      .replace(/^diff --git .*$/gm, `diff --git a/${target} b/${target}`)
      .replace(/^--- [^\n]*\n\+\+\+ [^\n]*$/gm, `${oldHeader}\n+++ b/${target}`);
  }

  private static isTestPath(filePath: string): boolean {
    const segments = filePath.split('/');
    const name = segments[segments.length - 1] ?? '';
    return (
      /^test_.*\.py$\vert{}_test\.py$|^conftest\.py$\vert{}\.(?:test\vert{}spec)\.[cm]?[jt]sx?$/.test(name) ||
      segments.slice(0, -1).some((segment) => segment === 'tests' || segment === 'test')
    );
  }

  public async generatePatch(userPromptPayload: string, targetFiles: readonly string[] = []): Promise<string> {
    const messages: readonly ChatMessage[] = [
      { role: 'system', content: CoderAgent.SYSTEM_PROMPT },
      { role: 'user', content: userPromptPayload }
    ];
    const rawOutput = await this.client.completeChat(messages, 'CODER');
    return this.extractDiff(rawOutput, targetFiles);
  }

  public extractDiff(rawResponse: string, targetFiles: readonly string[] = []): string {
    if (!rawResponse.trim()) {
      throw new Error('Il modello ha restituito una risposta vuota (0 token utili).');
    }

    const match = /```(?:diff)?\s*([\s\S]*?)\s*```/i.exec(rawResponse);
    let content = match && match[1] ? match[1].trim() : rawResponse.trim();
    content = content.replace(/\\"/g, '"').replace(/\\'/g, "'");
    content = content.replace(/\r\n/g, '\n');

    const fileDiffs = content.split(/(?=diff --git )/g);
    const sanitizedDiffs = fileDiffs.filter((block) => {
      const headerMatch = block.match(/diff --git a\/(\S+) b\/(\S+)/);
      if (!headerMatch) return true;
      const targetPath = headerMatch[2] ?? '';
      if (CoderAgent.isTestPath(targetPath)) {
        console.warn(`[CoderAgent] Rimosso hunk illegale sul file di test: ${targetPath}`);
        return false;
      }
      return true;
    });

    content = sanitizedDiffs.join('').trim();
    if (targetFiles.length === 1) content = CoderAgent.bindToTarget(content, targetFiles[0]!);

    // Normalizzazione agnostica degli header diff: preserva esplicitamente /dev/null
    content = content.replace(/^--- (?!a\/|\/dev\/null)(\S+)/gm, '--- a/$1');
    content = content.replace(/^\+\+\+ (?!b\/)(\S+)/gm, '+++ b/$1');

    if (!content.includes('--- ') || !content.includes('+++ ')) {
      throw new Error('La risposta generata non contiene un blocco Unified Diff valido.');
    }

    return content;
  }
}
