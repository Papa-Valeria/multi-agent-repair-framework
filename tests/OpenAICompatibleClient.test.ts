import {
    afterEach,
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import {
    InferenceTimeoutError,
    OpenAICompatibleClient
} from '../src/inference/OpenAICompatibleClient.js';

import {
    DEFAULT_MODEL_SESSION_CONFIG,
    modelSessionConfigSchema
} from '../src/inference/ModelSessionConfig.js';

import {
    TelemetryTracker
} from '../src/telemetry/TelemetryTracker.js';

describe(
    'OpenAICompatibleClient inference timeout',
    () => {
        afterEach(() => {
            jest.useRealTimers();
            jest.restoreAllMocks();
        });

        it(
            'interrompe una inferenza bloccata alla deadline configurata',
            async () => {
                jest.useFakeTimers();

                const telemetry =
                    new TelemetryTracker();

                telemetry.startRun();

                let capturedSignal:
                    AbortSignal | undefined;

                const fetchSpy =
                    jest.spyOn(
                        globalThis,
                        'fetch'
                    );

                fetchSpy.mockImplementation(
                    async (
                        _input,
                        init
                    ) =>
                        await new Promise<Response>(
                            (
                                _resolve,
                                reject
                            ) => {
                                capturedSignal =
                                    init?.signal ??
                                    undefined;

                                capturedSignal
                                    ?.addEventListener(
                                        'abort',
                                        () => {
                                            const error =
                                                new Error(
                                                    'Aborted'
                                                );

                                            error.name =
                                                'AbortError';

                                            reject(error);
                                        },
                                        {
                                            once: true
                                        }
                                    );
                            }
                        )
                );

                const client =
                    new OpenAICompatibleClient(
                        {
                            baseUrl:
                                'http://127.0.0.1:11434/v1',
                            model:
                                'qwen2.5-coder:7b',
                            seed: 42,
                            temperature: 0,
                            topP: 1,
                            inferenceTimeoutMs:
                                1_000
                        },
                        telemetry
                    );

                const request =
                    client.completeChat(
                        [
                            {
                                role: 'user',
                                content:
                                    'Genera una patch.'
                            }
                        ],
                        'CODER'
                    );

                /*
                 * L'handler della rejection deve essere
                 * collegato prima dell'avanzamento dei timer.
                 */
                const rejectionExpectation =
                    expect(request)
                        .rejects
                        .toMatchObject({
                            name:
                                'InferenceTimeoutError',
                            timeoutMs:
                                1_000,
                            endpoint:
                                'http://127.0.0.1:11434/v1/chat/completions'
                        });

                expect(fetchSpy)
                    .toHaveBeenCalledTimes(1);

                expect(
                    capturedSignal?.aborted
                ).toBe(false);

                await jest.advanceTimersByTimeAsync(
                    1_000
                );

                await rejectionExpectation;

                expect(
                    capturedSignal?.aborted
                ).toBe(true);

                const snapshot =
                    telemetry.getSnapshot();

                expect(
                    snapshot.promptTokens
                ).toBe(0);

                expect(
                    snapshot.completionTokens
                ).toBe(0);

                expect(
                    snapshot.agentUsage
                        .CODER.promptTokens
                ).toBe(0);

                expect(
                    snapshot.agentUsage
                        .CODER.completionTokens
                ).toBe(0);
            }
        );

        it(
            'restituisce esplicitamente InferenceTimeoutError',
            () => {
                const error =
                    new InferenceTimeoutError(
                        5_000,
                        'http://127.0.0.1:11434/v1/chat/completions'
                    );

                expect(
                    error
                ).toBeInstanceOf(Error);

                expect(
                    error.name
                ).toBe(
                    'InferenceTimeoutError'
                );

                expect(
                    error.timeoutMs
                ).toBe(5_000);

                expect(
                    error.endpoint
                ).toBe(
                    'http://127.0.0.1:11434/v1/chat/completions'
                );

                expect(
                    error.message
                ).toContain(
                    '5000 ms'
                );
            }
        );

        it(
            'accetta una risposta completata prima della deadline e registra l usage',
            async () => {
                jest.useFakeTimers();

                const telemetry =
                    new TelemetryTracker();

                telemetry.startRun();

                const fetchSpy =
                    jest.spyOn(
                        globalThis,
                        'fetch'
                    );

                fetchSpy.mockResolvedValue(
                    new Response(
                        JSON.stringify({
                            choices: [
                                {
                                    message: {
                                        content:
                                            'Risposta valida.'
                                    }
                                }
                            ],
                            usage: {
                                prompt_tokens:
                                    12,
                                completion_tokens:
                                    8
                            }
                        }),
                        {
                            status: 200,
                            headers: {
                                'Content-Type':
                                    'application/json'
                            }
                        }
                    )
                );

                const client =
                    new OpenAICompatibleClient(
                        {
                            baseUrl:
                                'http://127.0.0.1:11434/v1',
                            model:
                                'qwen2.5-coder:7b',
                            seed: 42,
                            temperature: 0,
                            topP: 1,
                            inferenceTimeoutMs:
                                120_000
                        },
                        telemetry
                    );

                const result =
                    await client.completeChat(
                        [
                            {
                                role: 'user',
                                content:
                                    'Genera una patch.'
                            }
                        ],
                        'CODER'
                    );

                expect(result)
                    .toBe(
                        'Risposta valida.'
                    );

                expect(fetchSpy)
                    .toHaveBeenCalledTimes(1);

                const requestInit =
                    fetchSpy.mock.calls[0]?.[1];

                expect(
                    requestInit?.signal
                ).toBeInstanceOf(
                    AbortSignal
                );

                expect(
                    requestInit?.signal
                        ?.aborted
                ).toBe(false);

                const snapshot =
                    telemetry.getSnapshot();

                expect(
                    snapshot.promptTokens
                ).toBe(12);

                expect(
                    snapshot.completionTokens
                ).toBe(8);

                expect(
                    snapshot.agentUsage
                        .CODER.promptTokens
                ).toBe(12);

                expect(
                    snapshot.agentUsage
                        .CODER.completionTokens
                ).toBe(8);

                await jest.advanceTimersByTimeAsync(
                    120_000
                );

                expect(
                    requestInit?.signal
                        ?.aborted
                ).toBe(false);
            }
        );

        it(
            'rifiuta inferenceTimeoutMs inferiore al minimo',
            () => {
                const result =
                    modelSessionConfigSchema
                        .safeParse({
                            ...DEFAULT_MODEL_SESSION_CONFIG,
                            inferenceTimeoutMs:
                                999
                        });

                expect(
                    result.success
                ).toBe(false);
            }
        );

        it(
            'rifiuta inferenceTimeoutMs superiore al massimo',
            () => {
                const result =
                    modelSessionConfigSchema
                        .safeParse({
                            ...DEFAULT_MODEL_SESSION_CONFIG,
                            inferenceTimeoutMs:
                                600_001
                        });

                expect(
                    result.success
                ).toBe(false);
            }
        );

        it(
            'accetta il timeout predefinito e lo conserva nella configurazione validata',
            () => {
                const result =
                    modelSessionConfigSchema
                        .safeParse(
                            DEFAULT_MODEL_SESSION_CONFIG
                        );

                expect(
                    result.success
                ).toBe(true);

                if (!result.success) {
                    throw new Error(
                        'Il default del modello deve essere valido.'
                    );
                }

                expect(
                    result.data
                        .inferenceTimeoutMs
                ).toBe(120_000);
            }
        );
    }
);
