import { z } from 'zod';

const localApiBaseUrl = z.string().url().superRefine((value, context) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  if (!loopbackHosts.has(url.hostname.toLowerCase())) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'L’endpoint del modello deve essere locale (localhost o loopback IP).'
    });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'L’endpoint deve usare HTTP o HTTPS.'
    });
  }
}).transform((value) => value.replace(/\/+$/, ''));

export const modelSessionConfigSchema = z.object({
  apiBaseUrl: localApiBaseUrl,
  modelIdentifier: z.string().trim().min(1).max(200),
  seed: z.number().int().min(0).max(2_147_483_647),
  temperature: z.number().min(0).max(2),
  topP: z.number().gt(0).max(1)
}).strict();

export type ModelSessionConfig = z.infer<typeof modelSessionConfigSchema>;

export const DEFAULT_MODEL_SESSION_CONFIG: ModelSessionConfig = Object.freeze({
  apiBaseUrl: 'http://127.0.0.1:11434/v1',
  modelIdentifier: 'qwen2.5-coder:7b',
  seed: 42,
  temperature: 0,
  topP: 1
});
