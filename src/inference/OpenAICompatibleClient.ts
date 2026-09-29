import { TelemetryTracker } from '../telemetry/TelemetryTracker.js';

export interface InferenceConfig {
  readonly baseUrl: string; // e.g. "http://127.0.0.1:11434/v1" o "http://127.0.0.1:8000/v1"
  readonly model: string;   // e.g. "qwen2.5-coder:32b", "deepseek-coder"
  readonly seed?: number;
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

interface ChatCompletionResponse {
  readonly choices: ReadonlyArray<{
    readonly message: { readonly content: string };
  }>;
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  };
}

export class OpenAICompatibleClient {
  constructor(
    private readonly config: InferenceConfig,
    private readonly telemetryTracker: TelemetryTracker
  ) {}

  public async completeChat(messages: readonly ChatMessage[]): Promise<string> {
    const t0 = performance.now();
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    // Parametri deterministici (RNF-03)
    const payload = {
      model: this.config.model,
      messages,
      temperature: 0.0,
      top_p: 1.0,
      seed: this.config.seed ?? 42,
      stream: false
    };

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err: unknown) {
      throw new Error(`Connessione fallita verso l'engine locale (${endpoint}): ${(err as Error).message}`);
    }

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Inference engine ha restituito HTTP ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const durationMs = performance.now() - t0;

    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;

    this.telemetryTracker.recordLLMUsage(promptTokens, completionTokens, durationMs);

    const content = data.choices[0]?.message.content;
    if (typeof content !== 'string') {
      throw new Error("L'engine di inferenza ha restituito un payload prive di scelte testuali valide.");
    }

    return content;
  }
}
