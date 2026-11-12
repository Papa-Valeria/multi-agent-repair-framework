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

const patchDiff = [
    '--- a/src/target.py',
    '+++ b/src/target.py',
    '@@ -10 +10 @@',
    '-old_value = False',
    '+old_value = True'
].join('\n');

const targetFiles =
    [
        'src/target.py'
    ] as const;

const createEngine =
    (): SemgrepEngine =>
        new SemgrepEngine(
            '.',
            {
                command:
                    'semgrep',

                timeoutMs:
                    5_000,

                envAllowList:
                    []
            }
        );

const mockSemgrepExecution =
    (
        results:
            readonly Record<
                string,
                unknown
            >[]
    ): void => {
        jest.spyOn(
            ProcessRunner,
            'execute'
        ).mockResolvedValue({
            exitCode:
                results.length > 0
                    ? 1
                    : 0,

            stdout:
                JSON.stringify({
                    errors:
                        [],

                    results
                }),

            stderr:
                '',

            timedOut:
                false,

            durationMs:
                10
        });
    };

describe(
    'BE-P0-29 - SemgrepEngine REPAIR security policy',
    () => {
        afterEach(
            () => {
                jest.restoreAllMocks();
            }
        );

        it(
            'propaga nell OracleResult REPAIR un finding ERROR nel target anche fuori dalle linee modificate',
            async () => {
                mockSemgrepExecution([
                    {
                        check_id:
                            'security.error',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                100
                        },

                        end: {
                            line:
                                100
                        },

                        extra: {
                            severity:
                                'ERROR',

                            message:
                                'Synthetic security finding.'
                        }
                    }
                ]);

                const engine =
                    createEngine();

                const result =
                    await engine.evaluate({
                        targetFiles,

                        patchDiff,

                        category:
                            'REPAIR',

                        required:
                            true
                    });

                expect(
                    ProcessRunner.execute
                ).toHaveBeenCalledTimes(
                    1
                );

                expect(
                    result.status
                ).toBe(
                    'FAIL'
                );

                expect(
                    result.required
                ).toBe(
                    true
                );

                expect(
                    result.evidence.scannedFiles
                ).toEqual(
                    targetFiles
                );

                expect(
                    result.evidence.findings
                ).toHaveLength(
                    1
                );

                expect(
                    result.evidence.findings[0]
                ).toMatchObject({
                    ruleId:
                        'security.error',

                    path:
                        'src/target.py',

                    startLine:
                        100,

                    endLine:
                        100,

                    severity:
                        'ERROR',

                    message:
                        'Synthetic security finding.'
                });
            }
        );

        it(
            'propaga nell OracleResult REPAIR un finding CWE nel target fuori dalle linee modificate',
            async () => {
                mockSemgrepExecution([
                    {
                        check_id:
                            'security.cwe',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                100
                        },

                        end: {
                            line:
                                100
                        },

                        extra: {
                            severity:
                                'WARNING',

                            message:
                                'Synthetic CWE finding.',

                            metadata: {
                                cwe: [
                                    'CWE-89'
                                ]
                            }
                        }
                    }
                ]);

                const result =
                    await createEngine()
                        .evaluate({
                            targetFiles,

                            patchDiff,

                            category:
                                'REPAIR',

                            required:
                                true
                        });

                expect(
                    result.status
                ).toBe(
                    'FAIL'
                );

                expect(
                    result.evidence.findings
                ).toHaveLength(
                    1
                );

                expect(
                    result.evidence.findings[0]
                ).toMatchObject({
                    ruleId:
                        'security.cwe',

                    path:
                        'src/target.py',

                    startLine:
                        100,

                    endLine:
                        100,

                    severity:
                        'WARNING',

                    cweHierarchy: [
                        'CWE-89'
                    ]
                });
            }
        );

        it(
            'propaga nell OracleResult REPAIR un finding OWASP nel target fuori dalle linee modificate',
            async () => {
                mockSemgrepExecution([
                    {
                        check_id:
                            'security.owasp',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                100
                        },

                        end: {
                            line:
                                100
                        },

                        extra: {
                            severity:
                                'INFO',

                            message:
                                'Synthetic OWASP finding.',

                            metadata: {
                                'owasp-top-ten':
                                    'A03:2021-Injection'
                            }
                        }
                    }
                ]);

                const result =
                    await createEngine()
                        .evaluate({
                            targetFiles,

                            patchDiff,

                            category:
                                'REPAIR',

                            required:
                                true
                        });

                expect(
                    result.status
                ).toBe(
                    'FAIL'
                );

                expect(
                    result.evidence.findings
                ).toHaveLength(
                    1
                );

                expect(
                    result.evidence.findings[0]
                ).toMatchObject({
                    ruleId:
                        'security.owasp',

                    severity:
                        'INFO',

                    owaspCategory:
                        'A03:2021-Injection'
                });
            }
        );

        it(
            'filtra in REPAIR un finding non-security nel target quando è fuori dalle linee modificate',
            async () => {
                mockSemgrepExecution([
                    {
                        check_id:
                            'quality.outside',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                100
                        },

                        end: {
                            line:
                                100
                        },

                        extra: {
                            severity:
                                'WARNING',

                            message:
                                'Synthetic quality finding.'
                        }
                    }
                ]);

                const result =
                    await createEngine()
                        .evaluate({
                            targetFiles,

                            patchDiff,

                            category:
                                'REPAIR',

                            required:
                                true
                        });

                expect(
                    result.status
                ).toBe(
                    'PASS'
                );

                expect(
                    result.evidence.findings
                ).toEqual(
                    []
                );

                expect(
                    result.evidence.scannedFiles
                ).toEqual(
                    targetFiles
                );
            }
        );

        it(
            'mantiene in REPAIR un finding non-security quando interseca la regione modificata',
            async () => {
                mockSemgrepExecution([
                    {
                        check_id:
                            'quality.inside',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                10
                        },

                        end: {
                            line:
                                10
                        },

                        extra: {
                            severity:
                                'WARNING',

                            message:
                                'Synthetic local quality finding.'
                        }
                    }
                ]);

                const result =
                    await createEngine()
                        .evaluate({
                            targetFiles,

                            patchDiff,

                            category:
                                'REPAIR',

                            required:
                                true
                        });

                expect(
                    result.status
                ).toBe(
                    'FAIL'
                );

                expect(
                    result.evidence.findings
                ).toHaveLength(
                    1
                );

                expect(
                    result.evidence.findings[0]
                        ?.ruleId
                ).toBe(
                    'quality.inside'
                );

                expect(
                    result.evidence.findings[0]
                        ?.startLine
                ).toBe(
                    10
                );
            }
        );

        it(
            'non applica in CREATE la target security hygiene specifica di REPAIR',
            async () => {
                mockSemgrepExecution([
                    {
                        check_id:
                            'security.error',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                100
                        },

                        end: {
                            line:
                                100
                        },

                        extra: {
                            severity:
                                'ERROR',

                            message:
                                'Synthetic security finding.'
                        }
                    }
                ]);

                const result =
                    await createEngine()
                        .evaluate({
                            targetFiles,

                            patchDiff,

                            category:
                                'CREATE',

                            required:
                                true
                        });

                expect(
                    result.status
                ).toBe(
                    'PASS'
                );

                expect(
                    result.evidence.findings
                ).toEqual(
                    []
                );
            }
        );

        it(
            'propaga in modo integrato la fixture mista secondo la policy REPAIR',
            async () => {
                mockSemgrepExecution([
                    {
                        check_id:
                            'security.error.outside',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                100
                        },

                        end: {
                            line:
                                100
                        },

                        extra: {
                            severity:
                                'ERROR',

                            message:
                                'Security ERROR outside patch.'
                        }
                    },

                    {
                        check_id:
                            'security.cwe.outside',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                110
                        },

                        end: {
                            line:
                                110
                        },

                        extra: {
                            severity:
                                'WARNING',

                            message:
                                'CWE outside patch.',

                            metadata: {
                                cwe:
                                    'CWE-79'
                            }
                        }
                    },

                    {
                        check_id:
                            'security.owasp.outside',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                115
                        },

                        end: {
                            line:
                                115
                        },

                        extra: {
                            severity:
                                'INFO',

                            message:
                                'OWASP outside patch.',

                            metadata: {
                                'owasp-top-ten':
                                    'A03:2021-Injection'
                            }
                        }
                    },

                    {
                        check_id:
                            'quality.inside',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                10
                        },

                        end: {
                            line:
                                10
                        },

                        extra: {
                            severity:
                                'WARNING',

                            message:
                                'Quality finding inside patch.'
                        }
                    },

                    {
                        check_id:
                            'quality.outside',

                        path:
                            'src/target.py',

                        start: {
                            line:
                                120
                        },

                        end: {
                            line:
                                120
                        },

                        extra: {
                            severity:
                                'WARNING',

                            message:
                                'Quality finding outside patch.'
                        }
                    }
                ]);

                const result =
                    await createEngine()
                        .evaluate({
                            targetFiles,

                            patchDiff,

                            category:
                                'REPAIR',

                            required:
                                true
                        });

                expect(
                    result.status
                ).toBe(
                    'FAIL'
                );

                expect(
                    result.evidence.findings.map(
                        (finding) =>
                            finding.ruleId
                    )
                ).toEqual([
                    'security.error.outside',
                    'security.cwe.outside',
                    'security.owasp.outside',
                    'quality.inside'
                ]);

                expect(
                    result.evidence.findings.some(
                        (finding) =>
                            finding.ruleId ===
                            'quality.outside'
                    )
                ).toBe(
                    false
                );
            }
        );
    }
);
