import { OpenAICompatibleClient, type ChatMessage } from '../inference/OpenAICompatibleClient.js';
import type { ExperimentCategory } from '../types/analytics.js';
import { DEFAULT_PROMPT_PROFILE } from '../inference/PromptProfile.js';
import type { PromptProfile } from '../inference/PromptProfile.js';
import { parseFileDiffs } from '../git/UnifiedDiff.js';

export class CoderModelInvocationError
  extends Error {
  constructor(
    message: string,
    readonly originalError?: unknown
  ) {
    super(message);
    this.name =
      'CoderModelInvocationError';
  }
}

export class CoderOutputExtractionError
  extends Error {
  constructor(
    message: string,
    readonly originalError?: unknown
  ) {
    super(message);
    this.name =
      'CoderOutputExtractionError';
  }
}

interface FencedCodeBlock {
  readonly language: string;
  readonly content: string;
}

export class CoderAgent {
  constructor(
    private readonly client: OpenAICompatibleClient,
    private readonly promptProfile: PromptProfile = DEFAULT_PROMPT_PROFILE
  ) { }

  private static bindToTarget(content: string, target: string): string {
    if (!content.includes('@@')) {
      return content;
    }

    const hasFileHeader = /^--- [^\n]+\n\+\+\+ [^\n]+$/m.test(content);

    if (hasFileHeader) {
      return content;
    }

    return `--- a/${target}\n+++ b/${target}\n${content}`;
  }

  private static normalizePath(filePath: string): string {
    let normalized = filePath.replaceAll('\\', '/').trim();

    while (normalized.startsWith('./')) {
      normalized = normalized.substring(2);
    }

    if (normalized.startsWith('a/') || normalized.startsWith('b/')) {
      normalized = normalized.substring(2);
    }

    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }


  public async generatePatch(
    userPromptPayload: string,
    targetFiles: readonly string[] = [],
    testFiles: readonly string[] = [],
    category: ExperimentCategory,
  ): Promise<string> {
    const messages: readonly ChatMessage[] = [
      { role: 'system', content: this.promptProfile.coder.systemInstructions },
      { role: 'user', content: userPromptPayload }
    ];

    let rawOutput: string;
    try {
      rawOutput = await this.client.completeChat(messages, 'CODER');
    } catch (error: unknown) {
      if (error instanceof CoderModelInvocationError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new CoderModelInvocationError(
        message.trim().length > 0 ?
          message :
          'Invocazione del modello Coder fallita senza dettagli.',
        error
      );
    }
    return this.extractDiff(
      rawOutput,
      targetFiles,
      testFiles,
      category
    );
  }

  private static extractFencedBlocks(rawResponse: string): FencedCodeBlock[] {
    const blocks: FencedCodeBlock[] = [];
    const fencePattern = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
    for (const match of rawResponse.matchAll(fencePattern)) {
      const language = match[1]?.trim().toLowerCase() ?? '';
      const content = match[2]?.trim().replace(/\r\n/g, '\n') ?? '';
      if (content.length === 0) continue;
      blocks.push({ language, content });
    }
    return blocks;
  }

  private static isRecognizableUnifiedDiff(content: string, targetFiles: readonly string[], category: ExperimentCategory): boolean {
    const normalized = content.trim().replace(/\r\n/g, '\n');
    if (normalized.length === 0) {
      return false;
    }
    if (parseFileDiffs(normalized).length > 0) {
      return true;
    }
    if (category !== 'REPAIR' || targetFiles.length !== 1) {
      return false;
    }
    const boundCandidate = CoderAgent.bindToTarget(normalized, targetFiles[0]!);
    return parseFileDiffs(boundCandidate).length > 0;
  }

  private static selectDiffCandidate(rawResponse: string, targetFiles: readonly string[], category: ExperimentCategory): string {
    const fencedBlocks = CoderAgent.extractFencedBlocks(rawResponse);
    const explicitDiffBlocks = fencedBlocks.filter((block) => block.language === 'diff');
    if (explicitDiffBlocks.length > 1) {
      throw new CoderOutputExtractionError(`La risposta contiene più blocchi contrassegnati come diff e non consente di selezionare deterministicamente una singola patch`);
    }
    if (explicitDiffBlocks.length === 1) {
      return explicitDiffBlocks[0]!.content;
    }
    const recognizableFencedBlocks = fencedBlocks.filter((block) => CoderAgent.isRecognizableUnifiedDiff(block.content, targetFiles, category));
    if (recognizableFencedBlocks.length > 1) {
      throw new CoderOutputExtractionError(`La risposta contiene più code fence con struttura Unified Diff riconoscibile e la selezione della patch è ambigua.`);
    }
    if (recognizableFencedBlocks.length === 1) {
      return recognizableFencedBlocks[0]!.content;
    }
    if (fencedBlocks.length === 0 && CoderAgent.isRecognizableUnifiedDiff(rawResponse, targetFiles, category)) {
      return rawResponse.trim().replace(/\r\n/g, '\n');
    }
    throw new CoderOutputExtractionError(`La risposta generata non contiene un candidato Unified Diff riconoscibile`);
  }

  public extractDiff(rawResponse: string, targetFiles: readonly string[] = [], testFiles: readonly string[] = [], category: ExperimentCategory): string {
    if (!rawResponse.trim()) {
      throw new CoderOutputExtractionError('Il modello ha restituito una risposta vuota (0 token utili).');
    }

    let content = CoderAgent.selectDiffCandidate(rawResponse, targetFiles, category);
    content = content.replace(/\r\n/g, '\n');
    const protectedFiles = new Set(testFiles.map((file) => CoderAgent.normalizePath(file)));
    const diffPaths = content.split('\n').filter((line) => line.startsWith('--- ') || line.startsWith('+++ ')).map((line) => {
      const headerValue = line.substring(4).trim();

      return headerValue.split(/\t/)[0]?.trim() ?? '';
    })
      .filter((filePath) => filePath.length > 0 && filePath !== '/dev/null');

    for (const diffPath of diffPaths) {
      const normalizedPath = CoderAgent.normalizePath(diffPath);
      if (protectedFiles.has(normalizedPath)) {
        throw new CoderOutputExtractionError(`La patch generata tenta di modificare un file di test/oracolo protetto: ${normalizedPath}`);
      }
    }

    const fileDiffs = content.split(/(?=diff --git )/g);
    for (const block of fileDiffs) {
      const headerMatch = block.match(/diff --git a\/(\S+) b\/(\S+)/);
      if (!headerMatch) continue;
      const oldPath = CoderAgent.normalizePath(headerMatch[1] ?? '');
      const newPath = CoderAgent.normalizePath(headerMatch[2] ?? '');
      if (protectedFiles.has(oldPath) || protectedFiles.has(newPath)) {
        throw new CoderOutputExtractionError(`La patch generata tenta di modificare un file di test/oracolo protetto: ${newPath || oldPath}`);
      }
    }

    if (category === 'REPAIR' && targetFiles.length === 1) {
      content = CoderAgent.bindToTarget(content, targetFiles[0]!);
    }

    content = content.replace(/^--- (?!a\/|\/dev\/null)(\S+)/gm, '--- a/$1');
    content = content.replace(/^\+\+\+ (?!b\/)(\S+)/gm, '+++ b/$1');

    if (!content.includes('--- ') || !content.includes('+++ ')) {
      throw new CoderOutputExtractionError('La risposta generata non contiene un blocco Unified Diff valido.');
    }

    return content;
  }
}
