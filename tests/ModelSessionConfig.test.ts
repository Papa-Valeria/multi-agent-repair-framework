import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { OpenAICompatibleClient } from '../src/inference/OpenAICompatibleClient.js';
import {
  DEFAULT_MODEL_SESSION_CONFIG,
  modelSessionConfigSchema
} from '../src/inference/ModelSessionConfig.js';
import { TelemetryTracker } from '../src/telemetry/TelemetryTracker.js';

describe('Dynamic local model configuration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts loopback OpenAI-compatible model endpoints and exact model tags', () => {
    const parsed = modelSessionConfigSchema.safeParse({
      apiBaseUrl: 'http://localhost:8000/v1/',
      modelIdentifier: 'deepseek-coder:6.7b',
      seed: 42,
      temperature: 0,
      topP: 1
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.apiBaseUrl).toBe('http://localhost:8000/v1');
      expect(parsed.data.modelIdentifier).toBe('deepseek-coder:6.7b');
    }
  });

  it('rejects non-loopback endpoints and invalid sampling parameters', () => {
    const parsed = modelSessionConfigSchema.safeParse({
      ...DEFAULT_MODEL_SESSION_CONFIG,
      apiBaseUrl: 'https://inference.example.com/v1',
      temperature: 3
    });

    expect(parsed.success).toBe(false);
    expect(() => modelSessionConfigSchema.safeParse({
      ...DEFAULT_MODEL_SESSION_CONFIG,
      apiBaseUrl: 'http://localhost:not-a-port/v1'
    })).not.toThrow();
  });

  it('probes endpoint reachability and confirms the selected model is exposed', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ data: [{ id: 'qwen2.5-coder:7b' }, { id: 'deepseek-coder:6.7b' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    const config = {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'deepseek-coder:6.7b',
      seed: 42,
      temperature: 0,
      topP: 1
    };
    const client = new OpenAICompatibleClient(config, new TelemetryTracker());

    await expect(client.validateEndpoint()).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/models', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('rejects a model identifier that is not exposed by the reachable endpoint', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ data: [{ id: 'qwen2.5-coder:7b' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    const client = new OpenAICompatibleClient({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'missing-model:1b'
    }, new TelemetryTracker());

    await expect(client.validateEndpoint()).rejects.toThrow(/non esposto dall’endpoint/);
  });

  it('sends the selected model and sampling tuple in each inference request', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: '```diff\n```' } }], usage: { prompt_tokens: 12, completion_tokens: 4 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ));
    const client = new OpenAICompatibleClient({
      baseUrl: 'http://localhost:8000/v1',
      model: 'codellama:7b',
      seed: 7,
      temperature: 0.2,
      topP: 0.9
    }, new TelemetryTracker());

    await client.completeChat([{ role: 'user', content: 'repair' }]);

    const [url, request] = fetchSpy.mock.calls[0] ?? [];
    const payload = JSON.parse(String(request?.body)) as {
      model: string;
      seed: number;
      temperature: number;
      top_p: number;
      stream: boolean;
      messages: readonly { role: string; content: string }[];
    };
    expect(url).toBe('http://localhost:8000/v1/chat/completions');
    expect(payload).toEqual({
      model: 'codellama:7b',
      seed: 7,
      temperature: 0.2,
      top_p: 0.9,
      stream: false,
      messages: [{ role: 'user', content: 'repair' }]
    });
  });
});
