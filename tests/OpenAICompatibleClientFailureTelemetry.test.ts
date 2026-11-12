import {
    InferenceTimeoutError,
    OpenAICompatibleClient,
    type ChatMessage,
    type InferenceConfig
} from '../src/inference/OpenAICompatibleClient.js';

import type {
    TelemetryTracker
} from '../src/telemetry/TelemetryTracker.js';

const CONFIG: InferenceConfig = {
    baseUrl:
        'http://localhost:11434/v1',

    model:
        'test-model',

    seed:
        42,

    temperature:
        0,

    topP:
        1,

    inferenceTimeoutMs:
        25
};

const MESSAGES:
    readonly ChatMessage[] = [
        {
            role:
                'user',

            content:
                'Generate a patch.'
        }
    ];

type RecordLLMUsage =
    jest.Mock<
        void,
        [
            role:
            'CODER' | 'REVIEWER',

            promptTokens:
            number | null,

            completionTokens:
            number | null,

            durationMs:
            number
        ]
    >;

interface TelemetryHarness {
    readonly tracker:
    TelemetryTracker;

    readonly recordLLMUsage:
    RecordLLMUsage;
}

const createTelemetryHarness =
    (): TelemetryHarness => {
        const recordLLMUsage:
            RecordLLMUsage =
            jest.fn();

        const tracker = {
            recordLLMUsage
        } as unknown as TelemetryTracker;

        return {
            tracker,
            recordLLMUsage
        };
    };

const createResponse = (
    params: {
        readonly ok:
        boolean;

        readonly status?:
        number;

        readonly json?:
        () => Promise<unknown>;

        readonly text?:
        () => Promise<string>;
    }
): Response =>
({
    ok:
        params.ok,

    status:
        params.status ??
        (
            params.ok
                ? 200
                : 500
        ),

    json:
        params.json ??
        (
            async () => ({})
        ),

    text:
        params.text ??
        (
            async () => ''
        ),

    headers:
        new Headers(),

    redirected:
        false,

    statusText:
        '',

    type:
        'basic',

    url:
        '',

    body:
        null,

    bodyUsed:
        false,

    arrayBuffer:
        async () =>
            new ArrayBuffer(0),

    blob:
        async () =>
            new Blob(),

    bytes:
        async () =>
            new Uint8Array(),

    clone(): Response {
        return this;
    },

    formData:
        async () =>
            new FormData()
} as Response);

const expectSingleTelemetryRecord = (
    recordLLMUsage:
        RecordLLMUsage,

    expectedPromptTokens:
        number | null,

    expectedCompletionTokens:
        number | null,

    expectedRole:
        'CODER' | 'REVIEWER' =
        'CODER'
): void => {
    expect(
        recordLLMUsage
    ).toHaveBeenCalledTimes(
        1
    );

    expect(
        recordLLMUsage
    ).toHaveBeenCalledWith(
        expectedRole,
        expectedPromptTokens,
        expectedCompletionTokens,
        expect.any(Number)
    );

    const durationMs =
        recordLLMUsage
            .mock
            .calls[0]?.[3];

    expect(
        durationMs
    ).toBeDefined();

    expect(
        Number.isFinite(
            durationMs
        )
    ).toBe(true);

    expect(
        durationMs
    ).toBeGreaterThanOrEqual(
        0
    );
};

describe(
    'BE-P1-29 - OpenAICompatibleClient failure telemetry',
    () => {
        const originalFetch =
            globalThis.fetch;

        afterEach(
            () => {
                globalThis.fetch =
                    originalFetch;

                jest.useRealTimers();

                jest.restoreAllMocks();
            }
        );

        it(
            'registra una sola volta durata e token nel success path',
            async () => {
                const telemetry =
                    createTelemetryHarness();

                globalThis.fetch =
                    jest.fn()
                        .mockResolvedValue(
                            createResponse({
                                ok:
                                    true,

                                json:
                                    async () => ({
                                        choices: [
                                            {
                                                message: {
                                                    content:
                                                        'successful response'
                                                }
                                            }
                                        ],

                                        usage: {
                                            prompt_tokens:
                                                11,

                                            completion_tokens:
                                                7
                                        }
                                    })
                            })
                        );

                const client =
                    new OpenAICompatibleClient(
                        CONFIG,
                        telemetry.tracker
                    );

                await expect(
                    client.completeChat(
                        MESSAGES,
                        'CODER'
                    )
                ).resolves.toBe(
                    'successful response'
                );

                expectSingleTelemetryRecord(
                    telemetry.recordLLMUsage,
                    11,
                    7
                );
            }
        );

        it(
            'registra una sola volta durata con token null quando il successo non include usage',
            async () => {
                const telemetry =
                    createTelemetryHarness();

                globalThis.fetch =
                    jest.fn()
                        .mockResolvedValue(
                            createResponse({
                                ok:
                                    true,

                                json:
                                    async () => ({
                                        choices: [
                                            {
                                                message: {
                                                    content:
                                                        'response without usage'
                                                }
                                            }
                                        ]
                                    })
                            })
                        );

                const client =
                    new OpenAICompatibleClient(
                        CONFIG,
                        telemetry.tracker
                    );

                await expect(
                    client.completeChat(
                        MESSAGES,
                        'REVIEWER'
                    )
                ).resolves.toBe(
                    'response without usage'
                );

                expectSingleTelemetryRecord(
                    telemetry.recordLLMUsage,
                    null,
                    null,
                    'REVIEWER'
                );
            }
        );

        it(
            'registra una sola volta durata con token null in caso di timeout',
            async () => {
                jest.useFakeTimers();

                const telemetry =
                    createTelemetryHarness();

                globalThis.fetch =
                    jest.fn(
                        async (
                            _input:
                                RequestInfo | URL,

                            init?:
                                RequestInit
                        ): Promise<Response> =>
                            new Promise<Response>(
                                (
                                    _resolve,
                                    reject
                                ) => {
                                    init
                                        ?.signal
                                        ?.addEventListener(
                                            'abort',
                                            () => {
                                                const abortError =
                                                    new Error(
                                                        'aborted'
                                                    );

                                                abortError.name =
                                                    'AbortError';

                                                reject(
                                                    abortError
                                                );
                                            },
                                            {
                                                once:
                                                    true
                                            }
                                        );
                                }
                            )
                    );

                const client =
                    new OpenAICompatibleClient(
                        CONFIG,
                        telemetry.tracker
                    );

                const request =
                    client.completeChat(
                        MESSAGES,
                        'CODER'
                    );

                /*
                 * Il rejection handler viene registrato
                 * PRIMA di far scattare il timeout.
                 *
                 * In questo modo Jest non osserva una
                 * Promise temporaneamente rejected
                 * senza handler associato.
                 */
                const timeoutExpectation =
                    expect(
                        request
                    ).rejects.toBeInstanceOf(
                        InferenceTimeoutError
                    );

                await jest
                    .advanceTimersByTimeAsync(
                        CONFIG.inferenceTimeoutMs
                    );

                await timeoutExpectation;

                expectSingleTelemetryRecord(
                    telemetry.recordLLMUsage,
                    null,
                    null
                );
            }
        );

        it(
            'registra una sola volta durata con token null in caso di HTTP non-2xx',
            async () => {
                const telemetry =
                    createTelemetryHarness();

                globalThis.fetch =
                    jest.fn()
                        .mockResolvedValue(
                            createResponse({
                                ok:
                                    false,

                                status:
                                    503,

                                text:
                                    async () =>
                                        'service unavailable'
                            })
                        );

                const client =
                    new OpenAICompatibleClient(
                        CONFIG,
                        telemetry.tracker
                    );

                await expect(
                    client.completeChat(
                        MESSAGES,
                        'CODER'
                    )
                ).rejects.toThrow(
                    'HTTP 503'
                );

                expectSingleTelemetryRecord(
                    telemetry.recordLLMUsage,
                    null,
                    null
                );
            }
        );

        it(
            'registra una sola volta durata con token null in caso di network error',
            async () => {
                const telemetry =
                    createTelemetryHarness();

                globalThis.fetch =
                    jest.fn()
                        .mockRejectedValue(
                            new TypeError(
                                'network unavailable'
                            )
                        );

                const client =
                    new OpenAICompatibleClient(
                        CONFIG,
                        telemetry.tracker
                    );

                await expect(
                    client.completeChat(
                        MESSAGES,
                        'CODER'
                    )
                ).rejects.toThrow(
                    'network unavailable'
                );

                expectSingleTelemetryRecord(
                    telemetry.recordLLMUsage,
                    null,
                    null
                );
            }
        );

        it(
            'registra una sola volta durata con token null in caso di JSON parsing failure',
            async () => {
                const telemetry =
                    createTelemetryHarness();

                globalThis.fetch =
                    jest.fn()
                        .mockResolvedValue(
                            createResponse({
                                ok:
                                    true,

                                json:
                                    async () => {
                                        throw new SyntaxError(
                                            'invalid JSON'
                                        );
                                    }
                            })
                        );

                const client =
                    new OpenAICompatibleClient(
                        CONFIG,
                        telemetry.tracker
                    );

                await expect(
                    client.completeChat(
                        MESSAGES,
                        'CODER'
                    )
                ).rejects.toThrow(
                    'invalid JSON'
                );

                expectSingleTelemetryRecord(
                    telemetry.recordLLMUsage,
                    null,
                    null
                );
            }
        );

        it(
            'registra una sola volta durata e usage disponibile in caso di payload senza content',
            async () => {
                const telemetry =
                    createTelemetryHarness();

                globalThis.fetch =
                    jest.fn()
                        .mockResolvedValue(
                            createResponse({
                                ok:
                                    true,

                                json:
                                    async () => ({
                                        choices:
                                            [],

                                        usage: {
                                            prompt_tokens:
                                                13,

                                            completion_tokens:
                                                2
                                        }
                                    })
                            })
                        );

                const client =
                    new OpenAICompatibleClient(
                        CONFIG,
                        telemetry.tracker
                    );

                await expect(
                    client.completeChat(
                        MESSAGES,
                        'CODER'
                    )
                ).rejects.toThrow(
                    'payload privo di scelte testuali valide'
                );

                expectSingleTelemetryRecord(
                    telemetry.recordLLMUsage,
                    13,
                    2
                );
            }
        );
    }
);
