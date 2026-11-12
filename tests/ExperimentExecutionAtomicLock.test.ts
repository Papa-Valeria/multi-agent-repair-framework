import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";

import type {
    FastifyInstance,
} from "fastify";

type ResolveRepositoryPath =
    typeof import(
    "../src/security/RepositoryPathPolicy.js"
    ).resolveRepositoryPath;

interface Deferred {
    readonly promise:
    Promise<void>;

    readonly resolve:
    () => void;
}

const LOCK_ERROR =
    "È già in corso un esperimento; " +
    "esegui i run in sequenza per preservare la telemetria CPU.";

const ASYNC_PREPARATION_ERROR =
    "Preparazione asincrona controllata fallita.";

const validRequestBody = {
    repoPath:
        "/repository",

    issueSpec:
        "Verificare l'esclusione atomica dei run sperimentali.",

    targetFiles: [
        "src/target.py",
    ],

    testFiles: [
        "tests/test_target.py",
    ],

    category:
        "REPAIR",

    executionMode:
        "MULTI_AGENT",

    modelConfig: {
        apiBaseUrl:
            "http://127.0.0.1:11434/v1",

        modelIdentifier:
            "qwen2.5-coder:7b",

        seed:
            42,

        temperature:
            0,

        topP:
            1,

        inferenceTimeoutMs:
            120_000,
    },

    buildOracleConfig: {
        command:
            "python",

        args: [
            "-B",
            "-m",
            "py_compile",
            "src/target.py",
        ],

        cwd:
            ".",

        timeoutMs:
            30_000,

        envAllowList: [
            "PATH",
        ],
    },

    functionalTestOracleConfig: {
        command:
            "python",

        args: [
            "-B",
            "-m",
            "pytest",
            "tests/test_target.py",
        ],

        cwd:
            ".",

        timeoutMs:
            30_000,

        oracleFiles: [
            "tests/test_target.py",
        ],

        envAllowList: [
            "PATH",
        ],

        expectedExitPolicy: {
            passExitCodes: [
                0,
            ],

            failExitCodes: [
                1,
            ],

            executionErrorExitCodes: [
                2,
                3,
                4,
                5,
            ],
        },

        allowImplicitDiscovery:
            false,
    },

    experimentLimits: {
        maxIterations:
            3,

        maxTechnicalAttempts:
            2,
    },
};

const createDeferred = ():
    Deferred => {
    let resolvePromise:
        (() => void) | undefined;

    const promise =
        new Promise<void>(
            (resolve) => {
                resolvePromise =
                    resolve;
            },
        );

    return {
        promise,

        resolve: () => {
            if (
                resolvePromise === undefined
            ) {
                throw new Error(
                    "Deferred non inizializzato.",
                );
            }

            resolvePromise();
        },
    };
};

describe(
    "BE-P1-35 - esclusione atomica dei run sperimentali",
    () => {
        let fastify:
            FastifyInstance | undefined;

        let firstResolutionEntered:
            Deferred;

        let releaseFirstResolution:
            Deferred;

        let resolveRepositoryPathMock:
            jest.MockedFunction<
                ResolveRepositoryPath
            >;

        beforeEach(
            async () => {
                jest.resetModules();

                process.env.NODE_ENV =
                    "test";

                firstResolutionEntered =
                    createDeferred();

                releaseFirstResolution =
                    createDeferred();

                let resolutionCalls =
                    0;

                resolveRepositoryPathMock =
                    jest.fn<ResolveRepositoryPath>(
                        async () => {
                            resolutionCalls +=
                                1;

                            /*
                             * La prima richiesta rimane sospesa
                             * nel primo await della preparazione.
                             *
                             * Il lock deve essere già acquisito
                             * prima di raggiungere questo punto.
                             */
                            if (
                                resolutionCalls === 1
                            ) {
                                firstResolutionEntered
                                    .resolve();

                                await releaseFirstResolution
                                    .promise;

                                throw new Error(
                                    ASYNC_PREPARATION_ERROR,
                                );
                            }

                            /*
                             * Le richieste successive possono
                             * entrare qui soltanto dopo che il
                             * lock è stato rilasciato.
                             */
                            throw new Error(
                                "Preparazione asincrona successiva controllata.",
                            );
                        },
                    );

                jest.unstable_mockModule(
                    "../src/security/RepositoryPathPolicy.js",
                    () => ({
                        resolveRepositoryPath:
                            resolveRepositoryPathMock,
                    }),
                );

                /*
                 * Se app.ts si trova in un'altra cartella,
                 * modifica esclusivamente questo path.
                 */
                const appModule =
                    await import(
                        "../src/server/app.js"
                    );

                fastify =
                    appModule.fastify;

                await fastify.ready();
            },
        );

        afterEach(
            async () => {
                releaseFirstResolution
                    .resolve();

                if (
                    fastify !== undefined
                ) {
                    await fastify.close();
                }

                fastify =
                    undefined;

                jest.restoreAllMocks();
                jest.resetModules();
            },
        );

        afterAll(
            () => {
                delete process.env.NODE_ENV;
            },
        );

        it(
            "fa entrare una sola richiesta concorrente nella preparazione e restituisce 409 all'altra",
            async () => {
                if (
                    fastify === undefined
                ) {
                    throw new Error(
                        "Fastify non inizializzato.",
                    );
                }

                const firstRequest =
                    fastify.inject({
                        method:
                            "POST",

                        url:
                            "/api/tasks/run-a/execute",

                        payload:
                            validRequestBody,
                    });

                /*
                 * Non usiamo timeout arbitrari.
                 *
                 * Attendiamo che la prima richiesta sia
                 * realmente entrata nel primo await.
                 */
                await firstResolutionEntered
                    .promise;

                const secondResponse =
                    await fastify.inject({
                        method:
                            "POST",

                        url:
                            "/api/tasks/run-b/execute",

                        payload:
                            validRequestBody,
                    });

                expect(
                    secondResponse.statusCode,
                ).toBe(
                    409,
                );

                expect(
                    secondResponse.json(),
                ).toEqual({
                    error:
                        LOCK_ERROR,
                });

                /*
                 * La seconda richiesta deve essere fermata
                 * prima di qualsiasi preparazione asincrona.
                 */
                expect(
                    resolveRepositoryPathMock,
                ).toHaveBeenCalledTimes(
                    1,
                );

                releaseFirstResolution
                    .resolve();

                const firstResponse =
                    await firstRequest;

                expect(
                    firstResponse.statusCode,
                ).toBe(
                    400,
                );

                expect(
                    firstResponse.json(),
                ).toEqual({
                    error:
                        ASYNC_PREPARATION_ERROR,
                });
            },
        );

        it(
            "rilascia il lock dopo una preparazione asincrona fallita",
            async () => {
                if (
                    fastify === undefined
                ) {
                    throw new Error(
                        "Fastify non inizializzato.",
                    );
                }

                const firstRequest =
                    fastify.inject({
                        method:
                            "POST",

                        url:
                            "/api/tasks/failure-a/execute",

                        payload:
                            validRequestBody,
                    });

                await firstResolutionEntered
                    .promise;

                releaseFirstResolution
                    .resolve();

                const firstResponse =
                    await firstRequest;

                expect(
                    firstResponse.statusCode,
                ).toBe(
                    400,
                );

                expect(
                    firstResponse.json(),
                ).toEqual({
                    error:
                        ASYNC_PREPARATION_ERROR,
                });

                const callsBeforeRetry =
                    resolveRepositoryPathMock
                        .mock
                        .calls
                        .length;

                const retryResponse =
                    await fastify.inject({
                        method:
                            "POST",

                        url:
                            "/api/tasks/failure-b/execute",

                        payload:
                            validRequestBody,
                    });

                /*
                 * La preparazione successiva fallisce ancora
                 * per effetto del mock, ma non deve ricevere
                 * 409: il lock precedente è stato rilasciato.
                 */
                expect(
                    retryResponse.statusCode,
                ).toBe(
                    400,
                );

                expect(
                    retryResponse.statusCode,
                ).not.toBe(
                    409,
                );

                expect(
                    resolveRepositoryPathMock
                        .mock
                        .calls
                        .length,
                ).toBeGreaterThan(
                    callsBeforeRetry,
                );
            },
        );

        it(
            "rilascia il lock anche quando la prima richiesta termina prima di LLM FSM e Oracle",
            async () => {
                if (
                    fastify === undefined
                ) {
                    throw new Error(
                        "Fastify non inizializzato.",
                    );
                }

                const firstRequest =
                    fastify.inject({
                        method:
                            "POST",

                        url:
                            "/api/tasks/early-failure-a/execute",

                        payload:
                            validRequestBody,
                    });

                await firstResolutionEntered
                    .promise;

                const concurrentResponse =
                    await fastify.inject({
                        method:
                            "POST",

                        url:
                            "/api/tasks/early-failure-b/execute",

                        payload:
                            validRequestBody,
                    });

                expect(
                    concurrentResponse.statusCode,
                ).toBe(
                    409,
                );

                releaseFirstResolution
                    .resolve();

                const firstResponse =
                    await firstRequest;

                expect(
                    firstResponse.statusCode,
                ).toBe(
                    400,
                );

                const responseAfterRelease =
                    await fastify.inject({
                        method:
                            "POST",

                        url:
                            "/api/tasks/early-failure-c/execute",

                        payload:
                            validRequestBody,
                    });

                expect(
                    responseAfterRelease.statusCode,
                ).not.toBe(
                    409,
                );
            },
        );
    },
);
