import { TelemetryTracker } from '../telemetry/TelemetryTracker.js';
import { AgentRole } from '../types/domain.js';

export interface InferenceConfig {
  readonly baseUrl: string;
  readonly model: string;
  readonly seed?: number;
  readonly temperature?: number;
  readonly topP?: number;
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

export class OpenAICompatibleClient {
  constructor(
    private readonly config: InferenceConfig,
    private readonly telemetryTracker: TelemetryTracker
  ) {}

  public async validateEndpoint(timeoutMs = 5000): Promise<void> {
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
        throw new Error(`Modello '${this.config.model}' non esposto dall’endpoint. Disponibili: ${availableModels.join(', ')}.`);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timeout ${timeoutMs} ms durante la verifica dell’endpoint modello.`);
      }
      throw new Error(`Impossibile verificare l’endpoint modello ${endpoint}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  public async completeChat(messages: readonly ChatMessage[], role: AgentRole = 'CODER'): Promise<string> {
    const t0 = performance.now();
    const endpoint = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const payload = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature ?? 0.0,
      top_p: this.config.topP ?? 1.0,
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

    this.telemetryTracker.recordLLMUsage(role, promptTokens, completionTokens, durationMs);

    const content = data.choices[0]?.message.content;
    if (typeof content !== 'string') {
      throw new Error("L'engine di inferenza ha restituito un payload prive di scelte testuali valide.");
    }

    return content;
  }
}
