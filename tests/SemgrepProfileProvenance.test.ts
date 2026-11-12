import {
    afterEach,
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import {
    ProcessRunner
} from '../src/verification/ProcessRunner.js';

import {
    SemgrepEngine
} from '../src/verification/SemgrepEngine.js';

import {
    DEFAULT_SEMGREP_PROFILE
} from '../src/verification/SemgrepProfile.js';

import type {
    SemgrepProfile
} from '../src/verification/SemgrepProfile.js';

const REPOSITORY_ROOT =
    '/repository';

const TARGET_FILE =
    'src/target.ts';

const PATCH_DIFF = [
    '--- a/src/target.ts',
    '+++ b/src/target.ts',
    '@@ -1 +1 @@',
    '-export const value = 1;',
    '+export const value = 2;'
].join('\n');

const createSuccessfulProcessResult = ():
    Awaited<
        ReturnType<
            typeof ProcessRunner.execute
        >
    > => ({
        exitCode:
            0,

        timedOut:
            false,

        durationMs:
            1,

        stdout:
            JSON.stringify({
                errors:
                    [],

                results:
                    []
            }),

        stderr:
            '',

        stdoutTruncated:
            false,

        stderrTruncated:
            false
    });

const evaluateWithProfile = async (
    profile:
        SemgrepProfile,

    executionConfig = {
        command:
            'semgrep',

        timeoutMs:
            60_000,

        envAllowList:
            [
                'PATH'
            ] as readonly string[]
    }
) => {
    const engine =
        new SemgrepEngine(
            REPOSITORY_ROOT,
            executionConfig,
            profile
        );

    return engine.evaluate({
        targetFiles:
            [
                TARGET_FILE
            ],

        patchDiff:
            PATCH_DIFF,

        category:
            'REPAIR',

        required:
            true
    });
};

afterEach(
    () => {
        jest.restoreAllMocks();
    }
);

describe(
    'BE-P1-20 - Semgrep profile provenance',
    () => {
        describe(
            'default Semgrep profile',
            () => {
                it(
                    'espone un identificatore esplicitamente versionato',
                    () => {
                        expect(
                            DEFAULT_SEMGREP_PROFILE.id
                        ).toBe(
                            'semgrep-profile-v1'
                        );

                        expect(
                            DEFAULT_SEMGREP_PROFILE.id
                        ).toMatch(
                            /^semgrep-profile-v\d+$/
                        );
                    }
                );

                it(
                    'espone il ruleset autorevole del profilo corrente',
                    () => {
                        expect(
                            DEFAULT_SEMGREP_PROFILE.configs
                        ).toEqual([
                            'auto',
                            'p/owasp-top-ten',
                            'p/security-audit',
                            'p/cwe-top-25',
                            'p/python'
                        ]);
                    }
                );

                it(
                    'contiene almeno una configurazione non vuota',
                    () => {
                        expect(
                            DEFAULT_SEMGREP_PROFILE
                                .configs
                                .length
                        ).toBeGreaterThan(
                            0
                        );

                        for (
                            const config of
                            DEFAULT_SEMGREP_PROFILE.configs
                        ) {
                            expect(
                                config.trim().length
                            ).toBeGreaterThan(
                                0
                            );
                        }
                    }
                );

                it(
                    'non contiene configurazioni duplicate',
                    () => {
                        expect(
                            new Set(
                                DEFAULT_SEMGREP_PROFILE.configs
                            ).size
                        ).toBe(
                            DEFAULT_SEMGREP_PROFILE
                                .configs
                                .length
                        );
                    }
                );

                it(
                    'rende immutabili il profilo e la lista delle configurazioni',
                    () => {
                        expect(
                            Object.isFrozen(
                                DEFAULT_SEMGREP_PROFILE
                            )
                        ).toBe(
                            true
                        );

                        expect(
                            Object.isFrozen(
                                DEFAULT_SEMGREP_PROFILE.configs
                            )
                        ).toBe(
                            true
                        );
                    }
                );
            }
        );

        describe(
            'SemgrepEngine profile integration',
            () => {
                it(
                    'trasforma esattamente le configurazioni del profilo negli argomenti --config',
                    async () => {
                        const executeSpy =
                            jest.spyOn(
                                ProcessRunner,
                                'execute'
                            )
                                .mockResolvedValue(
                                    createSuccessfulProcessResult()
                                );

                        const result =
                            await evaluateWithProfile(
                                DEFAULT_SEMGREP_PROFILE
                            );

                        expect(
                            result.status
                        ).toBe(
                            'PASS'
                        );

                        expect(
                            executeSpy
                        ).toHaveBeenCalledTimes(
                            1
                        );

                        const expectedArgs = [
                            'scan',

                            ...DEFAULT_SEMGREP_PROFILE
                                .configs
                                .map(
                                    (config) =>
                                        `--config=${config}`
                                ),

                            '--json',
                            TARGET_FILE
                        ];

                        expect(
                            executeSpy
                        ).toHaveBeenCalledWith(
                            'semgrep',

                            expectedArgs,

                            {
                                cwd:
                                    REPOSITORY_ROOT,

                                timeoutMs:
                                    60_000,

                                envAllowList:
                                    [
                                        'PATH'
                                    ]
                            }
                        );
                    }
                );

                it(
                    'preserva l ordine dichiarato delle configurazioni',
                    async () => {
                        const orderedProfile:
                            SemgrepProfile = {
                            id:
                                'semgrep-profile-test-v1',

                            configs:
                                [
                                    'custom/first.yml',
                                    'p/custom-pack',
                                    'custom/last.yml'
                                ]
                        };

                        const executeSpy =
                            jest.spyOn(
                                ProcessRunner,
                                'execute'
                            )
                                .mockResolvedValue(
                                    createSuccessfulProcessResult()
                                );

                        const result =
                            await evaluateWithProfile(
                                orderedProfile
                            );

                        expect(
                            result.status
                        ).toBe(
                            'PASS'
                        );

                        expect(
                            executeSpy
                        ).toHaveBeenCalledWith(
                            'semgrep',

                            [
                                'scan',
                                '--config=custom/first.yml',
                                '--config=p/custom-pack',
                                '--config=custom/last.yml',
                                '--json',
                                TARGET_FILE
                            ],

                            {
                                cwd:
                                    REPOSITORY_ROOT,

                                timeoutMs:
                                    60_000,

                                envAllowList:
                                    [
                                        'PATH'
                                    ]
                            }
                        );
                    }
                );

                it(
                    'usa esclusivamente il profilo iniettato invece di un ruleset interno hardcoded',
                    async () => {
                        const customProfile:
                            SemgrepProfile = {
                            id:
                                'semgrep-profile-test-v99',

                            configs:
                                [
                                    'custom/local-rules.yml'
                                ]
                        };

                        const executeSpy =
                            jest.spyOn(
                                ProcessRunner,
                                'execute'
                            )
                                .mockResolvedValue(
                                    createSuccessfulProcessResult()
                                );

                        const result =
                            await evaluateWithProfile(
                                customProfile
                            );

                        expect(
                            result.status
                        ).toBe(
                            'PASS'
                        );

                        expect(
                            executeSpy
                        ).toHaveBeenCalledTimes(
                            1
                        );

                        const executedArgs =
                            executeSpy.mock.calls[0]?.[1];

                        expect(
                            executedArgs
                        ).toEqual([
                            'scan',
                            '--config=custom/local-rules.yml',
                            '--json',
                            TARGET_FILE
                        ]);

                        for (
                            const defaultConfig of
                            DEFAULT_SEMGREP_PROFILE.configs
                        ) {
                            expect(
                                executedArgs
                            ).not.toContain(
                                `--config=${defaultConfig}`
                            );
                        }
                    }
                );

                it(
                    'mantiene separati il profilo e la configurazione operativa',
                    async () => {
                        const executeSpy =
                            jest.spyOn(
                                ProcessRunner,
                                'execute'
                            )
                                .mockResolvedValue(
                                    createSuccessfulProcessResult()
                                );

                        const result =
                            await evaluateWithProfile(
                                DEFAULT_SEMGREP_PROFILE,

                                {
                                    command:
                                        'custom-semgrep-command',

                                    timeoutMs:
                                        12_345,

                                    envAllowList:
                                        [
                                            'PATH',
                                            'TEMP'
                                        ]
                                }
                            );

                        expect(
                            result.status
                        ).toBe(
                            'PASS'
                        );

                        expect(
                            executeSpy
                        ).toHaveBeenCalledWith(
                            'custom-semgrep-command',

                            [
                                'scan',

                                ...DEFAULT_SEMGREP_PROFILE
                                    .configs
                                    .map(
                                        (config) =>
                                            `--config=${config}`
                                    ),

                                '--json',
                                TARGET_FILE
                            ],

                            {
                                cwd:
                                    REPOSITORY_ROOT,

                                timeoutMs:
                                    12_345,

                                envAllowList:
                                    [
                                        'PATH',
                                        'TEMP'
                                    ]
                            }
                        );
                    }
                );
            }
        );

        describe(
            'provenance contract',
            () => {
                it(
                    'deriva semgrepProfileId dalla stessa istanza che contiene il ruleset',
                    () => {
                        const semgrepProfile =
                            DEFAULT_SEMGREP_PROFILE;

                        const experimentProfileFragment = {
                            semgrepProfileId:
                                semgrepProfile.id
                        };

                        expect(
                            experimentProfileFragment
                                .semgrepProfileId
                        ).toBe(
                            semgrepProfile.id
                        );

                        expect(
                            experimentProfileFragment
                                .semgrepProfileId
                        ).toBe(
                            'semgrep-profile-v1'
                        );

                        expect(
                            semgrepProfile.configs
                        ).toBe(
                            DEFAULT_SEMGREP_PROFILE.configs
                        );
                    }
                );

                it(
                    'mantiene distinti profile id e configurazioni operative',
                    () => {
                        const semgrepProfile =
                            DEFAULT_SEMGREP_PROFILE;

                        const semgrepExecutionConfig = {
                            command:
                                'semgrep',

                            timeoutMs:
                                60_000,

                            envAllowList:
                                [
                                    'PATH'
                                ]
                        };

                        expect(
                            semgrepProfile
                        ).not.toHaveProperty(
                            'command'
                        );

                        expect(
                            semgrepProfile
                        ).not.toHaveProperty(
                            'timeoutMs'
                        );

                        expect(
                            semgrepProfile
                        ).not.toHaveProperty(
                            'envAllowList'
                        );

                        expect(
                            semgrepExecutionConfig
                        ).not.toHaveProperty(
                            'id'
                        );

                        expect(
                            semgrepExecutionConfig
                        ).not.toHaveProperty(
                            'configs'
                        );
                    }
                );
            }
        );
    }
);
