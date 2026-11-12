import {
    afterEach,
    describe,
    expect,
    it
} from '@jest/globals';

import {
    buildOracleConfigSchema,
    functionalTestOracleConfigSchema
} from '../src/inference/BuildOracleConfig.js';

import {
    ProcessRunner
} from '../src/verification/ProcessRunner.js';

const ENV_NAME =
    'BE_P1_08_CASE_TEST';

const ORIGINAL_ENV =
    process.env[ENV_NAME];

const restoreEnvironment =
    (): void => {
        if (
            ORIGINAL_ENV === undefined
        ) {
            delete process.env[
                ENV_NAME
            ];

            return;
        }

        process.env[
            ENV_NAME
        ] =
            ORIGINAL_ENV;
    };

afterEach(
    () => {
        restoreEnvironment();
    }
);

describe(
    'BE-P1-08 - Environment name canonicalization',
    () => {
        describe(
            'Build Oracle config schema',
            () => {
                it(
                    'canonicalizza envAllowList con trim e uppercase',
                    () => {
                        const parsed =
                            buildOracleConfigSchema.parse({
                                command:
                                    'python',

                                args:
                                    [],

                                cwd:
                                    '.',

                                timeoutMs:
                                    5_000,

                                envAllowList: [
                                    ' path ',
                                    'Home',
                                    ' pythonpath '
                                ]
                            });

                        expect(
                            parsed.envAllowList
                        ).toEqual([
                            'PATH',
                            'HOME',
                            'PYTHONPATH'
                        ]);
                    }
                );

                it(
                    'preserva l ordine degli environment names dopo la canonicalizzazione',
                    () => {
                        const parsed =
                            buildOracleConfigSchema.parse({
                                command:
                                    'python',

                                timeoutMs:
                                    5_000,

                                envAllowList: [
                                    'pythonpath',
                                    'home',
                                    'path'
                                ]
                            });

                        expect(
                            parsed.envAllowList
                        ).toEqual([
                            'PYTHONPATH',
                            'HOME',
                            'PATH'
                        ]);
                    }
                );

                it(
                    'rifiuta duplicati che differiscono soltanto per casing',
                    () => {
                        const result =
                            buildOracleConfigSchema.safeParse({
                                command:
                                    'python',

                                timeoutMs:
                                    5_000,

                                envAllowList: [
                                    'PATH',
                                    'path'
                                ]
                            });

                        expect(
                            result.success
                        ).toBe(
                            false
                        );

                        if (
                            result.success
                        ) {
                            throw new Error(
                                'La configurazione duplicata doveva essere rifiutata.'
                            );
                        }

                        expect(
                            result.error.issues.some(
                                (issue) =>
                                    issue.path[0] ===
                                    'envAllowList' &&
                                    issue.message ===
                                    'envAllowList contiene nomi di variabili duplicati.'
                            )
                        ).toBe(
                            true
                        );
                    }
                );

                it(
                    'rifiuta duplicati che diventano equivalenti dopo trim e casing normalization',
                    () => {
                        const result =
                            buildOracleConfigSchema.safeParse({
                                command:
                                    'python',

                                timeoutMs:
                                    5_000,

                                envAllowList: [
                                    ' PATH ',
                                    'Path'
                                ]
                            });

                        expect(
                            result.success
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'mantiene envAllowList vuota come default',
                    () => {
                        const parsed =
                            buildOracleConfigSchema.parse({
                                command:
                                    'python',

                                timeoutMs:
                                    5_000
                            });

                        expect(
                            parsed.envAllowList
                        ).toEqual(
                            []
                        );
                    }
                );
            }
        );

        describe(
            'Functional Test Oracle config schema',
            () => {
                const createConfig =
                    (
                        envAllowList:
                            readonly string[]
                    ) => ({
                        command:
                            'pytest',

                        args:
                            [],

                        cwd:
                            '.',

                        timeoutMs:
                            5_000,

                        oracleFiles: [
                            'tests/test_target.py'
                        ],

                        envAllowList,

                        expectedExitPolicy: {
                            passExitCodes: [
                                0
                            ],

                            failExitCodes: [
                                1
                            ],

                            executionErrorExitCodes: [
                                2,
                                3,
                                4,
                                5
                            ]
                        },

                        allowImplicitDiscovery:
                            false
                    });

                it(
                    'canonicalizza envAllowList con la stessa policy del Build Oracle',
                    () => {
                        const parsed =
                            functionalTestOracleConfigSchema.parse(
                                createConfig([
                                    ' path ',
                                    'Home',
                                    'pythonpath'
                                ])
                            );

                        expect(
                            parsed.envAllowList
                        ).toEqual([
                            'PATH',
                            'HOME',
                            'PYTHONPATH'
                        ]);
                    }
                );

                it(
                    'rifiuta duplicati case-insensitive',
                    () => {
                        const result =
                            functionalTestOracleConfigSchema.safeParse(
                                createConfig([
                                    'PYTHONPATH',
                                    'pythonpath'
                                ])
                            );

                        expect(
                            result.success
                        ).toBe(
                            false
                        );

                        if (
                            result.success
                        ) {
                            throw new Error(
                                'La configurazione duplicata doveva essere rifiutata.'
                            );
                        }

                        expect(
                            result.error.issues.some(
                                (issue) =>
                                    issue.path[0] ===
                                    'envAllowList' &&
                                    issue.message ===
                                    'envAllowList contiene nomi di variabili duplicati.'
                            )
                        ).toBe(
                            true
                        );
                    }
                );

                it(
                    'produce la stessa envAllowList canonica del Build schema',
                    () => {
                        const build =
                            buildOracleConfigSchema.parse({
                                command:
                                    'python',

                                timeoutMs:
                                    5_000,

                                envAllowList: [
                                    ' Path ',
                                    'home'
                                ]
                            });

                        const functional =
                            functionalTestOracleConfigSchema.parse(
                                createConfig([
                                    ' path ',
                                    'HOME'
                                ])
                            );

                        expect(
                            functional.envAllowList
                        ).toEqual(
                            build.envAllowList
                        );

                        expect(
                            functional.envAllowList
                        ).toEqual([
                            'PATH',
                            'HOME'
                        ]);
                    }
                );
            }
        );

        describe(
            'ProcessRunner',
            () => {
                it(
                    'risolve un nome environment con casing canonico',
                    async () => {
                        process.env[
                            ENV_NAME
                        ] =
                            'canonical-value';

                        const result =
                            await ProcessRunner.execute(
                                process.execPath,
                                [
                                    '-e',
                                    `process.stdout.write(process.env.${ENV_NAME} ?? 'MISSING');`
                                ],
                                {
                                    cwd:
                                        process.cwd(),

                                    timeoutMs:
                                        5_000,

                                    envAllowList: [
                                        ENV_NAME
                                    ]
                                }
                            );

                        expect(
                            result.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            result.stdout
                        ).toBe(
                            'canonical-value'
                        );
                    }
                );

                it(
                    'interpreta casing differenti della config con la stessa semantica',
                    async () => {
                        process.env[
                            ENV_NAME
                        ] =
                            'same-value';

                        const lowerResult =
                            await ProcessRunner.execute(
                                process.execPath,
                                [
                                    '-e',
                                    `process.stdout.write(process.env.${ENV_NAME} ?? 'MISSING');`
                                ],
                                {
                                    cwd:
                                        process.cwd(),

                                    timeoutMs:
                                        5_000,

                                    envAllowList: [
                                        ENV_NAME.toLowerCase()
                                    ]
                                }
                            );

                        const mixedName =
                            ENV_NAME
                                .toLowerCase()
                                .replace(
                                    'be_p1_08',
                                    'Be_P1_08'
                                );

                        const mixedResult =
                            await ProcessRunner.execute(
                                process.execPath,
                                [
                                    '-e',
                                    `process.stdout.write(process.env.${ENV_NAME} ?? 'MISSING');`
                                ],
                                {
                                    cwd:
                                        process.cwd(),

                                    timeoutMs:
                                        5_000,

                                    envAllowList: [
                                        mixedName
                                    ]
                                }
                            );

                        expect(
                            lowerResult.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            mixedResult.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            lowerResult.stdout
                        ).toBe(
                            'same-value'
                        );

                        expect(
                            mixedResult.stdout
                        ).toBe(
                            'same-value'
                        );
                    }
                );

                it(
                    'applica trim anche quando ProcessRunner viene invocato senza passare dagli schema',
                    async () => {
                        process.env[
                            ENV_NAME
                        ] =
                            'trimmed-value';

                        const result =
                            await ProcessRunner.execute(
                                process.execPath,
                                [
                                    '-e',
                                    `process.stdout.write(process.env.${ENV_NAME} ?? 'MISSING');`
                                ],
                                {
                                    cwd:
                                        process.cwd(),

                                    timeoutMs:
                                        5_000,

                                    envAllowList: [
                                        `  ${ENV_NAME.toLowerCase()}  `
                                    ]
                                }
                            );

                        expect(
                            result.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            result.stdout
                        ).toBe(
                            'trimmed-value'
                        );
                    }
                );

                it(
                    'deduplica semanticamente nomi equivalenti quando ProcessRunner viene invocato direttamente',
                    async () => {
                        process.env[
                            ENV_NAME
                        ] =
                            'deduplicated-value';

                        const result =
                            await ProcessRunner.execute(
                                process.execPath,
                                [
                                    '-e',
                                    [
                                        `const matches = Object.keys(process.env)`,
                                        `.filter((name) => name.toUpperCase() === '${ENV_NAME}')`,
                                        `.length;`,
                                        `process.stdout.write(String(matches));`
                                    ].join('')
                                ],
                                {
                                    cwd:
                                        process.cwd(),

                                    timeoutMs:
                                        5_000,

                                    envAllowList: [
                                        ENV_NAME,
                                        ENV_NAME.toLowerCase(),
                                        ` ${ENV_NAME} `
                                    ]
                                }
                            );

                        expect(
                            result.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            result.stdout
                        ).toBe(
                            '1'
                        );
                    }
                );

                it(
                    'espone al child il nome canonico uppercase',
                    async () => {
                        process.env[
                            ENV_NAME
                        ] =
                            'canonical-name-value';

                        const result =
                            await ProcessRunner.execute(
                                process.execPath,
                                [
                                    '-e',
                                    [
                                        `const key = Object.keys(process.env)`,
                                        `.find((name) => name.toUpperCase() === '${ENV_NAME}');`,
                                        `process.stdout.write(key ?? 'MISSING');`
                                    ].join('')
                                ],
                                {
                                    cwd:
                                        process.cwd(),

                                    timeoutMs:
                                        5_000,

                                    envAllowList: [
                                        ENV_NAME.toLowerCase()
                                    ]
                                }
                            );

                        expect(
                            result.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            result.stdout
                        ).toBe(
                            ENV_NAME
                        );
                    }
                );

                it(
                    'non espone variabili non presenti nella allow-list',
                    async () => {
                        process.env[
                            ENV_NAME
                        ] =
                            'secret-value';

                        const result =
                            await ProcessRunner.execute(
                                process.execPath,
                                [
                                    '-e',
                                    `process.stdout.write(process.env.${ENV_NAME} ?? 'MISSING');`
                                ],
                                {
                                    cwd:
                                        process.cwd(),

                                    timeoutMs:
                                        5_000,

                                    envAllowList:
                                        []
                                }
                            );

                        expect(
                            result.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            result.stdout
                        ).toBe(
                            'MISSING'
                        );
                    }
                );

                it(
                    'ignora nomi vuoti nella chiamata diretta al ProcessRunner',
                    async () => {
                        process.env[
                            ENV_NAME
                        ] =
                            'allowed-value';

                        const result =
                            await ProcessRunner.execute(
                                process.execPath,
                                [
                                    '-e',
                                    `process.stdout.write(process.env.${ENV_NAME} ?? 'MISSING');`
                                ],
                                {
                                    cwd:
                                        process.cwd(),

                                    timeoutMs:
                                        5_000,

                                    envAllowList: [
                                        '',
                                        '   ',
                                        ENV_NAME.toLowerCase()
                                    ]
                                }
                            );

                        expect(
                            result.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            result.stdout
                        ).toBe(
                            'allowed-value'
                        );
                    }
                );
            }
        );
    }
);
