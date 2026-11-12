import { TelemetryTracker } from '../telemetry/TelemetryTracker.js';
import { AgentRole } from '../types/domain.js';

export interface InferenceConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly seed?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly inferenceTimeoutMs: number;
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

interface ModelListResponse {
  readonly data?: ReadonlyArray<{ readonly id?: string }>;
}

export class InferenceTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly endpoint: string
  ) {
    super(`Timeout di inferenza dopo ${timeoutMs} ms verso ${endpoint}.`);
    this.name = 'InferenceTimeoutError';
  }
}

export class OpenAICompatibleClient {
  constructor(
    private readonly config: InferenceConfig,
    private readonly telemetryTracker: TelemetryTracker
  ) { }

  public async validateEndpoint(timeoutMs = 5_000): Promise<void> {
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/models`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Endpoint modello non disponibile (${response.status}).`);
      }

      const data = await response.json() as ModelListResponse;
      const availableModels = data.data?.flatMap((entry) => entry.id ? [entry.id] : []) ?? [];
      if (availableModels.length > 0 && !availableModels.includes(this.config.model)) {
        throw new Error(`Modello '${this.config.model}' non esposto dall'endpoint. Disponibili: ${availableModels.join(', ')}.`);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timeout ${timeoutMs} ms durante la verifica dell'endpoint modello.`);
      }
      throw new Error(`Impossibile verificare l'endpoint modello ${endpoint}: ${this.errorMessage(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  public async completeChat(messages: readonly ChatMessage[], role: AgentRole = 'CODER'): Promise<string> {
    const startedAt = performance.now();
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const payload = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature ?? 0.0,
      top_p: this.config.topP ?? 1.0,
      seed: this.config.seed ?? 42,
      stream: false
    };

    const controller = new AbortController();
    let timeoutTriggered = false;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;

    const timeout = setTimeout(
      () => {
        timeoutTriggered = true;
        controller.abort();
      },
      this.config.inferenceTimeoutMs
    );

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!response.ok) {
        const errorBody = await response.text();

        throw new Error(`Inference engine ha restituito HTTP ${response.status}: ${errorBody}`);
      }
      const data = await response.json() as ChatCompletionResponse;
      promptTokens = data.usage?.prompt_tokens ?? null;
      completionTokens = data.usage?.completion_tokens ?? null;
      const content = data.choices[0]?.message.content;

      if (typeof content !== 'string') {
        throw new Error("L'engine di inferenza ha restituito un payload privo di scelte testuali valide.");
      }

      return content;
    } catch (err: unknown) {
      if (timeoutTriggered || (err instanceof Error && err.name === 'AbortError')) {
        throw new InferenceTimeoutError(this.config.inferenceTimeoutMs, endpoint);
      }
      if (err instanceof InferenceTimeoutError) {
        throw err;
      }
      throw new Error(`Connessione o inferenza fallita verso l'engine locale (${endpoint}): ${this.errorMessage(err)}`);
    } finally {
      clearTimeout(timeout);
      const durationMs = performance.now() - startedAt;
      this.telemetryTracker.recordLLMUsage(role, promptTokens, completionTokens, durationMs);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
