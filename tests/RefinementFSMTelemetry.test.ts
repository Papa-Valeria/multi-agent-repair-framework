import {
    describe,
    expect,
    it,
    jest
} from '@jest/globals';

import {
    RefinementFSM
} from '../src/orchestration/RefinementFSM.js';

import {
    TelemetryTracker
} from '../src/telemetry/TelemetryTracker.js';

import type {
    ComputationalTelemetry,
    FunctionalTestOracleConfig,
    OracleResult
} from '../src/types/domain.js';

import type {
    InitialContextParams,
    ContextBuilder
} from '../src/orchestration/ContextBuilder.js';

import type {
    GitManager
} from '../src/git/GitManager.js';

import type {
    SemgrepEngine
} from '../src/verification/SemgrepEngine.js';

import type {
    TestHarness
} from '../src/verification/TestHarness.js';

import type {
    BuildSyntaxOracle
} from '../src/verification/BuildSyntaxOracle.js';

import type {
    CoderAgent
} from '../src/agents/CoderAgent.js';

import type {
    ReviewerAgent
} from '../src/agents/ReviewerAgent.js';

class DeterministicTelemetryTracker
    extends TelemetryTracker {

    private recordedCpuMeasurements = 0;

    public override startCpuMeasurement():
        NodeJS.CpuUsage {
        return {
            user: 0,
            system: 0
        };
    }

    public override recordOrchestrationCpu(
        _start: NodeJS.CpuUsage
    ): void {
        this.recordedCpuMeasurements += 1;
    }

    public override getSnapshot():
        ComputationalTelemetry {
        const base = super.getSnapshot();

        return {
            ...base,
            orchestrationOverheadMs:
                this.recordedCpuMeasurements
        };
    }
}

const functionalTestConfig:
    FunctionalTestOracleConfig = {
    command: 'python',
    args: [
        '-m',
        'pytest',
        '-q',
        'test_service.py'
    ],
    cwd: '.',
    timeoutMs: 30_000,
    envAllowList: ['PATH'],
    oracleFiles: [
        'test_service.py'
    ],
    allowImplicitDiscovery: false,
    expectedExitPolicy: {
        passExitCodes: [0],
        failExitCodes: [1],
        executionErrorExitCodes: [
            2,
            3,
            4,
            5
        ]
    }
};

function params():
    InitialContextParams {
    return {
        issueSpec:
            'Correggere il comportamento target.',
        targetFiles: [
            'service.py'
        ],
        testFiles: [
            'test_service.py'
        ],
        category: 'REPAIR',

        buildOracleConfig: {
            command: 'python',
            args: [
                '-m',
                'py_compile',
                'service.py'
            ],
            cwd: '.',
            timeoutMs: 30_000,
            envAllowList: ['PATH']
        },

        functionalTestOracleConfig:
            functionalTestConfig
    };
}

function applicabilityPass():
    OracleResult<'APPLICABILITY'> {
    return {
        oracle: 'APPLICABILITY',
        status: 'PASS',
        required: true,
        durationMs: 1,
        summary: 'Patch applicabile.',
        evidence: {
            applyMode: 'GIT',
            patchHash: 'patch-hash'
        }
    };
}

function buildPass():
    OracleResult<'BUILD_SYNTAX'> {
    return {
        oracle: 'BUILD_SYNTAX',
        status: 'PASS',
        required: true,
        durationMs: 1,
        summary: 'Build valida.',
        evidence: {
            command: 'python',
            args: [
                '-m',
                'py_compile',
                'service.py'
            ],
            cwd: '.',
            timeoutMs: 30_000,
            envAllowList: ['PATH'],
            exitCode: 0,
            timedOut: false,
            stdout: '',
            stderr: ''
        }
    };
}

function semgrepFail():
    OracleResult<'SEMGREP'> {
    return {
        oracle: 'SEMGREP',
        status: 'FAIL',
        required: true,
        durationMs: 1,
        summary: 'Finding rilevato.',
        evidence: {
            findings: [
                {
                    ruleId: 'test.rule',
                    path: 'service.py',
                    startLine: 1,
                    endLine: 1,
                    severity: 'ERROR',
                    message: 'Finding di test.',
                    cweHierarchy: []
                }
            ],
            scannedFiles: [
                'service.py'
            ]
        }
    };
}

function functionalPass():
    OracleResult<'FUNCTIONAL_TEST'> {
    return {
        oracle: 'FUNCTIONAL_TEST',
        status: 'PASS',
        required: true,
        durationMs: 1,
        summary:
            'Suite funzionale superata.',
        evidence: {
            report: {
                oracleStatus: 'PASS',
                command: 'python',
                args: [
                    '-m',
                    'pytest',
                    '-q',
                    'test_service.py'
                ],
                cwd: '.',
                timeoutMs: 30_000,
                envAllowList: ['PATH'],
                oracleFilesExecuted: [
                    'test_service.py'
                ],
                implicitDiscoveryUsed: false,
                expectedExitPolicy: {
                    passExitCodes: [0],
                    failExitCodes: [1],
                    executionErrorExitCodes: [
                        2,
                        3,
                        4,
                        5
                    ]
                },
                exitCode: 0,
                suitePassed: true,
                timedOut: false,
                oracleFailed: false,
                totalTests: 1,
                passedTests: 1,
                failedTests: 0,
                skippedTests: 0,
                xfailedTests: 0,
                xpassedTests: 0,
                errorTests: 0,
                passRate: 1,
                durationMs: 1,
                failureDetails: [],
                stdout: '1 passed',
                stderr: '',
                rawStdout: '1 passed',
                rawStderr: '',
                executionDurationMs: 1
            }
        }
    };
}

function gitMock():
    GitManager {
    return {
        getHead:
            jest.fn(async () =>
                'initial-head'
            ),

        assertWorkingTreeClean:
            jest.fn(async () =>
                undefined
            ),

        computePatchHash:
            jest.fn(() =>
                'patch-hash'
            ),

        evaluateApplicability:
            jest.fn(async () =>
                applicabilityPass()
            ),

        normalizeRejectedPatch:
            jest.fn(async () =>
                null
            ),

        applyPatch:
            jest.fn(async () =>
                'GIT' as const
            ),

        rollback:
            jest.fn(async () => ({
                status: 'SUCCESS' as const
            }))
    } as unknown as GitManager;
}

function semgrepMock():
    SemgrepEngine {
    return {
        evaluate:
            jest.fn(async () =>
                semgrepFail()
            )
    } as unknown as SemgrepEngine;
}

function testHarnessMock():
    TestHarness {
    return {
        evaluate:
            jest.fn(async () =>
                functionalPass()
            )
    } as unknown as TestHarness;
}

function buildOracleMock():
    BuildSyntaxOracle {
    return {
        evaluate:
            jest.fn(async () =>
                buildPass()
            )
    } as unknown as BuildSyntaxOracle;
}

describe(
    'RefinementFSM telemetry finalization',
    () => {

        it(
            'registra la CPU del ContextBuilder prima dello snapshot finale quando il contesto iniziale fallisce',
            async () => {
                const telemetry =
                    new DeterministicTelemetryTracker();

                telemetry.startRun();

                const contextBuilder = {
                    buildInitialPayload:
                        jest.fn(async () => {
                            throw new Error(
                                'Context failure'
                            );
                        })
                } as unknown as ContextBuilder;

                const coder = {
                    generatePatch:
                        jest.fn()
                } as unknown as CoderAgent;

                const reviewer = {
                    review:
                        jest.fn()
                } as unknown as ReviewerAgent;

                const fsm =
                    new RefinementFSM(
                        'task-context-failure',
                        gitMock(),
                        semgrepMock(),
                        testHarnessMock(),
                        buildOracleMock(),
                        coder,
                        reviewer,
                        contextBuilder,
                        telemetry
                    );

                const result =
                    await fsm.runBaseline(
                        params()
                    );

                expect(
                    result.failure?.category
                ).toBe(
                    'CONTEXT_BUILD_FAILURE'
                );

                expect(
                    result.cumulativeTelemetry
                        .orchestrationOverheadMs
                ).toBe(1);
            }
        );

        it(
            'registra la CPU del Coder prima dello snapshot del failure path Baseline',
            async () => {
                const telemetry =
                    new DeterministicTelemetryTracker();

                telemetry.startRun();

                const contextBuilder = {
                    buildInitialPayload:
                        jest.fn(async () =>
                            'initial payload'
                        )
                } as unknown as ContextBuilder;

                const coder = {
                    generatePatch:
                        jest.fn(async () => {
                            throw new Error(
                                'model generation failure'
                            );
                        })
                } as unknown as CoderAgent;

                const reviewer = {
                    review:
                        jest.fn()
                } as unknown as ReviewerAgent;

                const fsm =
                    new RefinementFSM(
                        'task-coder-failure',
                        gitMock(),
                        semgrepMock(),
                        testHarnessMock(),
                        buildOracleMock(),
                        coder,
                        reviewer,
                        contextBuilder,
                        telemetry
                    );

                const result =
                    await fsm.runBaseline(
                        params()
                    );

                expect(
                    result.failure?.category
                ).toBe(
                    'MODEL_GENERATION_FAILURE'
                );

                expect(
                    result.cumulativeTelemetry
                        .orchestrationOverheadMs
                ).toBe(2);

                expect(
                    result.iterations[0]
                        ?.telemetry
                        .orchestrationOverheadMs
                ).toBe(2);
            }
        );

        it(
            'aggiorna lo snapshot dell iterazione dopo Reviewer failure e rollback',
            async () => {
                const telemetry =
                    new DeterministicTelemetryTracker();

                telemetry.startRun();

                const contextBuilder = {
                    buildInitialPayload:
                        jest.fn(async () =>
                            'initial payload'
                        ),

                    buildTechnicalRetryPayload:
                        jest.fn(() =>
                            'technical retry'
                        ),

                    buildRefinementPayload:
                        jest.fn(() =>
                            'refinement payload'
                        )
                } as unknown as ContextBuilder;

                const coder = {
                    generatePatch:
                        jest.fn(async () =>
                            [
                                '--- a/service.py',
                                '+++ b/service.py',
                                '@@ -1 +1 @@',
                                '-old',
                                '+new'
                            ].join('\n')
                        )
                } as unknown as CoderAgent;

                const reviewer = {
                    review:
                        jest.fn(async () => {
                            throw new Error(
                                'Reviewer failure'
                            );
                        })
                } as unknown as ReviewerAgent;

                const git =
                    gitMock();

                const fsm =
                    new RefinementFSM(
                        'task-reviewer-failure',
                        git,
                        semgrepMock(),
                        testHarnessMock(),
                        buildOracleMock(),
                        coder,
                        reviewer,
                        contextBuilder,
                        telemetry
                    );

                const result =
                    await fsm.runLoop(
                        params()
                    );

                expect(
                    result.failure?.category
                ).toBe(
                    'REVIEWER_FAILURE'
                );

                expect(
                    result.status
                ).toBe(
                    'INFRASTRUCTURE_ERROR'
                );

                expect(
                    result.iterations
                ).toHaveLength(1);

                const iteration =
                    result.iterations[0];

                expect(
                    iteration
                ).toBeDefined();

                expect(
                    iteration!.telemetry
                        .orchestrationOverheadMs
                ).toBe(
                    result.cumulativeTelemetry
                        .orchestrationOverheadMs
                );

                expect(
                    result.cumulativeTelemetry
                        .orchestrationOverheadMs
                ).toBeGreaterThan(0);
            }
        );
    }
);
