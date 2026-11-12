import {
    afterEach,
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import {
    OpenAICompatibleClient
} from '../src/inference/OpenAICompatibleClient.js';

import {
    TelemetryTracker
} from '../src/telemetry/TelemetryTracker.js';

const createClient = (
    telemetry: TelemetryTracker
): OpenAICompatibleClient =>
    new OpenAICompatibleClient(
        {
            baseUrl:
                'http://127.0.0.1:11434/v1',
            model:
                'qwen2.5-coder:7b',
            seed: 42,
            temperature: 0,
            topP: 1,
            inferenceTimeoutMs: 120_000
        },
        telemetry
    );

describe(
    'Token usage availability',
    () => {
        afterEach(() => {
            jest.restoreAllMocks();
        });

        it(
            'mantiene distinguibile un usage dichiarato pari a zero',
            async () => {
                const telemetry =
                    new TelemetryTracker();

                const client =
                    createClient(telemetry);

                jest.spyOn(
                    globalThis,
                    'fetch'
                ).mockResolvedValue(
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
                                prompt_tokens: 0,
                                completion_tokens: 0
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

                expect(result).toBe(
                    'Risposta valida.'
                );

                const snapshot =
                    telemetry.getSnapshot();

                expect(
                    snapshot.tokenUsageAvailable
                ).toBe(true);

                expect(
                    snapshot.promptTokens
                ).toBe(0);

                expect(
                    snapshot.completionTokens
                ).toBe(0);

                expect(
                    snapshot.agentUsage
                        .CODER.tokenUsageAvailable
                ).toBe(true);

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
            'rappresenta usage assente come token non disponibili',
            async () => {
                const telemetry =
                    new TelemetryTracker();

                const client =
                    createClient(telemetry);

                jest.spyOn(
                    globalThis,
                    'fetch'
                ).mockResolvedValue(
                    new Response(
                        JSON.stringify({
                            choices: [
                                {
                                    message: {
                                        content:
                                            'Risposta senza usage.'
                                    }
                                }
                            ]
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

                expect(result).toBe(
                    'Risposta senza usage.'
                );

                const snapshot =
                    telemetry.getSnapshot();

                expect(
                    snapshot.tokenUsageAvailable
                ).toBe(false);

                expect(
                    snapshot.promptTokens
                ).toBeNull();

                expect(
                    snapshot.completionTokens
                ).toBeNull();

                expect(
                    snapshot.agentUsage
                        .CODER.tokenUsageAvailable
                ).toBe(false);

                expect(
                    snapshot.agentUsage
                        .CODER.promptTokens
                ).toBeNull();

                expect(
                    snapshot.agentUsage
                        .CODER.completionTokens
                ).toBeNull();

                expect(
                    snapshot.inferenceDurationMs
                ).toBeGreaterThanOrEqual(0);
            }
        );

        it(
            'invalida il totale quando una chiamata successiva non espone usage',
            () => {
                const telemetry =
                    new TelemetryTracker();

                telemetry.recordLLMUsage(
                    'CODER',
                    100,
                    40,
                    250
                );

                let snapshot =
                    telemetry.getSnapshot();

                expect(
                    snapshot.tokenUsageAvailable
                ).toBe(true);

                expect(
                    snapshot.promptTokens
                ).toBe(100);

                expect(
                    snapshot.completionTokens
                ).toBe(40);

                telemetry.recordLLMUsage(
                    'CODER',
                    null,
                    null,
                    150
                );

                snapshot =
                    telemetry.getSnapshot();

                expect(
                    snapshot.tokenUsageAvailable
                ).toBe(false);

                expect(
                    snapshot.promptTokens
                ).toBeNull();

                expect(
                    snapshot.completionTokens
                ).toBeNull();

                expect(
                    snapshot.inferenceDurationMs
                ).toBe(400);

                expect(
                    snapshot.agentUsage
                        .CODER.tokenUsageAvailable
                ).toBe(false);

                expect(
                    snapshot.agentUsage
                        .CODER.promptTokens
                ).toBeNull();

                expect(
                    snapshot.agentUsage
                        .CODER.completionTokens
                ).toBeNull();
            }
        );

        it(
            'preserva i token disponibili del Coder quando manca usage del Reviewer',
            () => {
                const telemetry =
                    new TelemetryTracker();

                telemetry.recordLLMUsage(
                    'CODER',
                    120,
                    30,
                    200
                );

                telemetry.recordLLMUsage(
                    'REVIEWER',
                    null,
                    null,
                    100
                );

                const snapshot =
                    telemetry.getSnapshot();

                expect(
                    snapshot.tokenUsageAvailable
                ).toBe(false);

                expect(
                    snapshot.promptTokens
                ).toBeNull();

                expect(
                    snapshot.completionTokens
                ).toBeNull();

                expect(
                    snapshot.agentUsage
                        .CODER.tokenUsageAvailable
                ).toBe(true);

                expect(
                    snapshot.agentUsage
                        .CODER.promptTokens
                ).toBe(120);

                expect(
                    snapshot.agentUsage
                        .CODER.completionTokens
                ).toBe(30);

                expect(
                    snapshot.agentUsage
                        .REVIEWER.tokenUsageAvailable
                ).toBe(false);

                expect(
                    snapshot.agentUsage
                        .REVIEWER.promptTokens
                ).toBeNull();

                expect(
                    snapshot.agentUsage
                        .REVIEWER.completionTokens
                ).toBeNull();

                expect(
                    snapshot.inferenceDurationMs
                ).toBe(300);
            }
        );

        it(
            'mantiene separata la disponibilità della nuova iterazione dal totale del run',
            () => {
                const telemetry =
                    new TelemetryTracker();

                telemetry.startIteration();

                telemetry.recordLLMUsage(
                    'CODER',
                    null,
                    null,
                    100
                );

                expect(
                    telemetry
                        .getSnapshot()
                        .tokenUsageAvailable
                ).toBe(false);

                expect(
                    telemetry
                        .getIterationAgentUsage()
                        .CODER
                        .tokenUsageAvailable
                ).toBe(false);

                telemetry.startIteration();

                telemetry.recordLLMUsage(
                    'CODER',
                    25,
                    10,
                    50
                );

                const cumulativeSnapshot =
                    telemetry.getSnapshot();

                const iterationUsage =
                    telemetry
                        .getIterationAgentUsage();

                expect(
                    cumulativeSnapshot
                        .tokenUsageAvailable
                ).toBe(false);

                expect(
                    cumulativeSnapshot
                        .promptTokens
                ).toBeNull();

                expect(
                    cumulativeSnapshot
                        .completionTokens
                ).toBeNull();

                expect(
                    iterationUsage
                        .CODER
                        .tokenUsageAvailable
                ).toBe(true);

                expect(
                    iterationUsage
                        .CODER
                        .promptTokens
                ).toBe(25);

                expect(
                    iterationUsage
                        .CODER
                        .completionTokens
                ).toBe(10);
            }
        );
    }
);
