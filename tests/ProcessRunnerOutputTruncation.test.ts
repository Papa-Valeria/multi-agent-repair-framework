import {
    afterEach,
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import type {
    FunctionalTestOracleConfig
} from '../src/types/domain.js';

import {
    BuildSyntaxOracle
} from '../src/verification/BuildSyntaxOracle.js';

import {
    ProcessRunner,
    type ProcessResult
} from '../src/verification/ProcessRunner.js';

import {
    TestHarness
} from '../src/verification/TestHarness.js';

const MAX_OUTPUT_LENGTH =
    1_000_000;

const executeNodeScript = async (
    script: string
): Promise<ProcessResult> =>
    ProcessRunner.execute(
        process.execPath,
        [
            '-e',
            script
        ],
        {
            cwd:
                process.cwd(),

            timeoutMs:
                20_000,

            envAllowList:
                []
        }
    );

const createProcessResult = (
    overrides:
        Partial<ProcessResult> = {}
): ProcessResult => ({
    exitCode:
        0,

    stdout:
        '',

    stderr:
        '',

    stdoutTruncated:
        false,

    stderrTruncated:
        false,

    timedOut:
        false,

    durationMs:
        10,

    ...overrides
});

afterEach(
    () => {
        jest.restoreAllMocks();
    }
);

describe(
    'BE-P1-07 - ProcessRunner structured output truncation',
    () => {
        describe(
            'ProcessRunner',
            () => {
                it(
                    'espone false per entrambi i flag quando gli output sono completi',
                    async () => {
                        const result =
                            await executeNodeScript(
                                [
                                    "process.stdout.write('stdout-completo');",
                                    "process.stderr.write('stderr-completo');"
                                ].join('')
                            );

                        expect(
                            result.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            result.stdout
                        ).toBe(
                            'stdout-completo'
                        );

                        expect(
                            result.stderr
                        ).toBe(
                            'stderr-completo'
                        );

                        expect(
                            result.stdoutTruncated
                        ).toBe(
                            false
                        );

                        expect(
                            result.stderrTruncated
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'espone stdoutTruncated=true quando stdout supera il limite',
                    async () => {
                        const result =
                            await executeNodeScript(
                                `process.stdout.write('x'.repeat(${MAX_OUTPUT_LENGTH + 100}));`
                            );

                        expect(
                            result.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            result.stdout
                        ).toHaveLength(
                            MAX_OUTPUT_LENGTH
                        );

                        expect(
                            result.stdout
                        ).toContain(
                            '[output truncated]'
                        );

                        expect(
                            result.stdoutTruncated
                        ).toBe(
                            true
                        );

                        expect(
                            result.stderrTruncated
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'espone stderrTruncated=true quando stderr supera il limite',
                    async () => {
                        const result =
                            await executeNodeScript(
                                `process.stderr.write('e'.repeat(${MAX_OUTPUT_LENGTH + 100}));`
                            );

                        expect(
                            result.exitCode
                        ).toBe(
                            0
                        );

                        expect(
                            result.stderr
                        ).toHaveLength(
                            MAX_OUTPUT_LENGTH
                        );

                        expect(
                            result.stderr
                        ).toContain(
                            '[output truncated]'
                        );

                        expect(
                            result.stdoutTruncated
                        ).toBe(
                            false
                        );

                        expect(
                            result.stderrTruncated
                        ).toBe(
                            true
                        );
                    }
                );

                it(
                    'mantiene indipendenti i flag di stdout e stderr',
                    async () => {
                        const result =
                            await executeNodeScript(
                                [
                                    "process.stdout.write('stdout-completo');",
                                    `process.stderr.write('e'.repeat(${MAX_OUTPUT_LENGTH + 100}));`
                                ].join('')
                            );

                        expect(
                            result.stdout
                        ).toBe(
                            'stdout-completo'
                        );

                        expect(
                            result.stdoutTruncated
                        ).toBe(
                            false
                        );

                        expect(
                            result.stderr
                        ).toHaveLength(
                            MAX_OUTPUT_LENGTH
                        );

                        expect(
                            result.stderrTruncated
                        ).toBe(
                            true
                        );
                    }
                );

                it(
                    'espone entrambi i flag quando entrambi gli stream vengono troncati',
                    async () => {
                        const result =
                            await executeNodeScript(
                                [
                                    `process.stdout.write('x'.repeat(${MAX_OUTPUT_LENGTH + 100}));`,
                                    `process.stderr.write('e'.repeat(${MAX_OUTPUT_LENGTH + 100}));`
                                ].join('')
                            );

                        expect(
                            result.stdout
                        ).toHaveLength(
                            MAX_OUTPUT_LENGTH
                        );

                        expect(
                            result.stderr
                        ).toHaveLength(
                            MAX_OUTPUT_LENGTH
                        );

                        expect(
                            result.stdoutTruncated
                        ).toBe(
                            true
                        );

                        expect(
                            result.stderrTruncated
                        ).toBe(
                            true
                        );
                    }
                );

                it(
                    'non considera troncato un output esattamente pari al limite',
                    async () => {
                        const result =
                            await executeNodeScript(
                                `process.stdout.write('x'.repeat(${MAX_OUTPUT_LENGTH}));`
                            );

                        expect(
                            result.stdout
                        ).toHaveLength(
                            MAX_OUTPUT_LENGTH
                        );

                        expect(
                            result.stdoutTruncated
                        ).toBe(
                            false
                        );

                        expect(
                            result.stderrTruncated
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'espone false nei risultati sintetici per timeout non valido',
                    async () => {
                        const result =
                            await ProcessRunner.execute(
                                process.execPath,
                                [
                                    '-e',
                                    "process.stdout.write('ignored');"
                                ],
                                {
                                    cwd:
                                        process.cwd(),

                                    timeoutMs:
                                        0,

                                    envAllowList:
                                        []
                                }
                            );

                        expect(
                            result.exitCode
                        ).toBeNull();

                        expect(
                            result.executionError
                        ).toContain(
                            'Timeout non valido'
                        );

                        expect(
                            result.stdoutTruncated
                        ).toBe(
                            false
                        );

                        expect(
                            result.stderrTruncated
                        ).toBe(
                            false
                        );
                    }
                );
            }
        );

        describe(
            'propagazione nel BuildSyntaxOracle',
            () => {
                it(
                    'propaga stdoutTruncated e stderrTruncated nella Build evidence',
                    async () => {
                        jest.spyOn(
                            ProcessRunner,
                            'execute'
                        ).mockResolvedValue(
                            createProcessResult({
                                stdout:
                                    'build stdout bounded',

                                stderr:
                                    'build stderr bounded',

                                stdoutTruncated:
                                    true,

                                stderrTruncated:
                                    true
                            })
                        );

                        const oracle =
                            new BuildSyntaxOracle(
                                process.cwd()
                            );

                        const result =
                            await oracle.evaluate({
                                required:
                                    true,

                                config: {
                                    command:
                                        process.execPath,

                                    args: [
                                        '-e',
                                        ''
                                    ],

                                    cwd:
                                        '.',

                                    timeoutMs:
                                        5_000,

                                    envAllowList:
                                        []
                                }
                            });

                        expect(
                            result.status
                        ).toBe(
                            'PASS'
                        );

                        expect(
                            result.evidence.stdout
                        ).toBe(
                            'build stdout bounded'
                        );

                        expect(
                            result.evidence.stderr
                        ).toBe(
                            'build stderr bounded'
                        );

                        expect(
                            result.evidence.stdoutTruncated
                        ).toBe(
                            true
                        );

                        expect(
                            result.evidence.stderrTruncated
                        ).toBe(
                            true
                        );
                    }
                );

                it(
                    'espone false nei risultati Build NOT_AVAILABLE sintetici',
                    async () => {
                        const oracle =
                            new BuildSyntaxOracle(
                                process.cwd()
                            );

                        const result =
                            await oracle.evaluate({
                                required:
                                    true
                            });

                        expect(
                            result.status
                        ).toBe(
                            'NOT_AVAILABLE'
                        );

                        expect(
                            result.evidence.stdoutTruncated
                        ).toBe(
                            false
                        );

                        expect(
                            result.evidence.stderrTruncated
                        ).toBe(
                            false
                        );
                    }
                );
            }
        );

        describe(
            'propagazione nel TestHarness',
            () => {
                const config:
                    FunctionalTestOracleConfig = {
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

                    envAllowList:
                        [],

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
                };

                it(
                    'propaga i flag del ProcessRunner nel TestExecutionReport',
                    async () => {
                        jest.spyOn(
                            ProcessRunner,
                            'execute'
                        ).mockResolvedValue(
                            createProcessResult({
                                stdout:
                                    '1 passed in 0.01s',

                                stderr:
                                    '',

                                stdoutTruncated:
                                    true,

                                stderrTruncated:
                                    false
                            })
                        );

                        const harness =
                            new TestHarness();

                        const result =
                            await harness.evaluate({
                                config,
                                required:
                                    true
                            });

                        expect(
                            result.status
                        ).toBe(
                            'PASS'
                        );

                        expect(
                            result.evidence.report.stdout
                        ).toBe(
                            '1 passed in 0.01s'
                        );

                        expect(
                            result.evidence.report.stdoutTruncated
                        ).toBe(
                            true
                        );

                        expect(
                            result.evidence.report.stderrTruncated
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'propaga separatamente il flag stderrTruncated',
                    async () => {
                        jest.spyOn(
                            ProcessRunner,
                            'execute'
                        ).mockResolvedValue(
                            createProcessResult({
                                stdout:
                                    '1 passed in 0.01s',

                                stderr:
                                    'diagnostic bounded',

                                stdoutTruncated:
                                    false,

                                stderrTruncated:
                                    true
                            })
                        );

                        const harness =
                            new TestHarness();

                        const result =
                            await harness.evaluate({
                                config,
                                required:
                                    true
                            });

                        expect(
                            result.status
                        ).toBe(
                            'PASS'
                        );

                        expect(
                            result.evidence.report.stdoutTruncated
                        ).toBe(
                            false
                        );

                        expect(
                            result.evidence.report.stderrTruncated
                        ).toBe(
                            true
                        );
                    }
                );

                it(
                    'espone false nei report NOT_AVAILABLE sintetici',
                    async () => {
                        const harness =
                            new TestHarness();

                        const result =
                            await harness.evaluate({
                                required:
                                    true
                            });

                        expect(
                            result.status
                        ).toBe(
                            'NOT_AVAILABLE'
                        );

                        expect(
                            result.evidence.report.stdoutTruncated
                        ).toBe(
                            false
                        );

                        expect(
                            result.evidence.report.stderrTruncated
                        ).toBe(
                            false
                        );
                    }
                );
            }
        );

        it(
            'consente al consumer di distinguere output completo e troncato senza leggere il marker',
            () => {
                const completeResult =
                    createProcessResult({
                        stdout:
                            'output completo',

                        stdoutTruncated:
                            false
                    });

                const truncatedResult =
                    createProcessResult({
                        /*
                         * Il marker è volutamente assente:
                         * il consumer deve usare il flag.
                         */
                        stdout:
                            'output bounded senza marker',

                        stdoutTruncated:
                            true
                    });

                expect(
                    completeResult.stdout
                        .includes(
                            '[output truncated]'
                        )
                ).toBe(
                    false
                );

                expect(
                    truncatedResult.stdout
                        .includes(
                            '[output truncated]'
                        )
                ).toBe(
                    false
                );

                expect(
                    completeResult.stdoutTruncated
                ).toBe(
                    false
                );

                expect(
                    truncatedResult.stdoutTruncated
                ).toBe(
                    true
                );
            }
        );
    }
);
