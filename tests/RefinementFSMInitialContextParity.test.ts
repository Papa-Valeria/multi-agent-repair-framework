import {
    afterEach,
    describe,
    expect,
    it
} from '@jest/globals';

import {
    execFile
} from 'node:child_process';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    promisify
} from 'node:util';

import type {
    CoderAgent
} from '../src/agents/CoderAgent.js';

import type {
    ReviewerAgent
} from '../src/agents/ReviewerAgent.js';

import {
    GitManager
} from '../src/git/GitManager.js';

import {
    ContextBuilder,
    type InitialContextParams
} from '../src/orchestration/ContextBuilder.js';

import {
    RefinementFSM
} from '../src/orchestration/RefinementFSM.js';

import {
    TelemetryTracker
} from '../src/telemetry/TelemetryTracker.js';

import type {
    BuildSyntaxOracle
} from '../src/verification/BuildSyntaxOracle.js';

import type {
    SemgrepEngine
} from '../src/verification/SemgrepEngine.js';

import type {
    TestHarness
} from '../src/verification/TestHarness.js';

const execFileAsync =
    promisify(
        execFile
    );

const temporaryDirectories:
    string[] = [];

interface RepositoryFixture {
    readonly repositoryRoot: string;
    readonly initialHead: string;
}

interface CapturingCoder {
    readonly coder: CoderAgent;
    readonly getPayloads: () => readonly string[];
}

const createTemporaryDirectory =
    async (
        prefix: string
    ): Promise<string> => {
        const directory =
            await fs.mkdtemp(
                path.join(
                    os.tmpdir(),
                    prefix
                )
            );

        temporaryDirectories.push(
            directory
        );

        return directory;
    };

const runGit =
    async (
        repositoryRoot: string,
        args: readonly string[]
    ): Promise<string> => {
        const result =
            await execFileAsync(
                'git',
                [
                    ...args
                ],
                {
                    cwd:
                        repositoryRoot
                }
            );

        return result.stdout.trim();
    };

const createRepository =
    async (): Promise<RepositoryFixture> => {
        const repositoryRoot =
            await createTemporaryDirectory(
                'refinement-fsm-context-parity-'
            );

        await runGit(
            repositoryRoot,
            [
                'init'
            ]
        );

        await runGit(
            repositoryRoot,
            [
                'config',
                'user.email',
                'context-parity@example.test'
            ]
        );

        await runGit(
            repositoryRoot,
            [
                'config',
                'user.name',
                'Initial Context Parity Test'
            ]
        );

        await fs.mkdir(
            path.join(
                repositoryRoot,
                'src'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.mkdir(
            path.join(
                repositoryRoot,
                'tests'
            ),
            {
                recursive:
                    true
            }
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'src',
                'calculator.py'
            ),
            [
                'def add(left, right):',
                '    return left - right',
                ''
            ].join('\n'),
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'tests',
                'test_calculator.py'
            ),
            [
                'SECRET_PARITY_MARKER = "must-not-enter-context"',
                '',
                'def hidden_helper():',
                '    return 5',
                '',
                'def test_addition_contract():',
                '    result = add(2, 3)',
                '    assert result == 5',
                ''
            ].join('\n'),
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                '.gitignore'
            ),
            [
                '**/__pycache__/',
                '**/.pytest_cache/',
                '**/.coverage',
                '**/coverage.xml',
                '**/htmlcov/',
                ''
            ].join('\n'),
            'utf8'
        );

        await runGit(
            repositoryRoot,
            [
                'add',
                '.'
            ]
        );

        await runGit(
            repositoryRoot,
            [
                'commit',
                '-m',
                'fixture: initial context parity'
            ]
        );

        const initialHead =
            await runGit(
                repositoryRoot,
                [
                    'rev-parse',
                    'HEAD'
                ]
            );

        return {
            repositoryRoot,
            initialHead
        };
    };

const createParams =
    (): InitialContextParams => ({
        issueSpec:
            'Correggere la funzione add affinché esegua una somma.',

        targetFiles: [
            'src/calculator.py'
        ],

        testFiles: [
            'tests/test_calculator.py'
        ],

        category:
            'REPAIR'
    });

const createCapturingCoder =
    (): CapturingCoder => {
        const payloads:
            string[] = [];

        const coder =
            {
                generatePatch:
                    async (
                        payload: string
                    ): Promise<string> => {
                        payloads.push(
                            payload
                        );

                        /*
                         * Fermiamo intenzionalmente l'esecuzione
                         * dopo aver catturato il payload.
                         *
                         * Baseline e Multi-Agent devono comunque
                         * aver costruito e consegnato il relativo
                         * initial context al Coder.
                         */
                        throw new Error(
                            'Injected coder generation failure after initial payload capture.'
                        );
                    }
            } as unknown as CoderAgent;

        return {
            coder,

            getPayloads:
                () => [
                    ...payloads
                ]
        };
    };

const createUnusedDependencies =
    (): {
        readonly semgrep: SemgrepEngine;
        readonly testHarness: TestHarness;
        readonly buildSyntaxOracle: BuildSyntaxOracle;
        readonly reviewer: ReviewerAgent;
    } => {
        const semgrep =
            {
                evaluate:
                    async (): Promise<never> => {
                        throw new Error(
                            'Semgrep non deve essere invocato nel test di initial context parity.'
                        );
                    }
            } as unknown as SemgrepEngine;

        const testHarness =
            {
                evaluate:
                    async (): Promise<never> => {
                        throw new Error(
                            'TestHarness non deve essere invocato nel test di initial context parity.'
                        );
                    }
            } as unknown as TestHarness;

        const buildSyntaxOracle =
            {
                evaluate:
                    async (): Promise<never> => {
                        throw new Error(
                            'BuildSyntaxOracle non deve essere invocato nel test di initial context parity.'
                        );
                    }
            } as unknown as BuildSyntaxOracle;

        const reviewer =
            {
                review:
                    async (): Promise<never> => {
                        throw new Error(
                            'ReviewerAgent non deve essere invocato nel test di initial context parity.'
                        );
                    }
            } as unknown as ReviewerAgent;

        return {
            semgrep,
            testHarness,
            buildSyntaxOracle,
            reviewer
        };
    };

describe(
    'BE-P0-26 - Baseline and Multi-Agent initial context parity',
    () => {
        afterEach(async () => {
            await Promise.all(
                temporaryDirectories.map(
                    async (directory) => {
                        await fs.rm(
                            directory,
                            {
                                recursive:
                                    true,

                                force:
                                    true
                            }
                        );
                    }
                )
            );

            temporaryDirectories.length =
                0;
        });

        it(
            'consegna al Coder lo stesso initial payload in Baseline e Multi-Agent',
            async () => {
                const {
                    repositoryRoot,
                    initialHead
                } =
                    await createRepository();

                const params =
                    createParams();

                const baselineCapture =
                    createCapturingCoder();

                const baselineDependencies =
                    createUnusedDependencies();

                const baselineGitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const baselineContextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const baselineFsm =
                    new RefinementFSM(
                        'BE-P0-26-baseline',
                        baselineGitManager,
                        baselineDependencies.semgrep,
                        baselineDependencies.testHarness,
                        baselineDependencies.buildSyntaxOracle,
                        baselineCapture.coder,
                        baselineDependencies.reviewer,
                        baselineContextBuilder,
                        new TelemetryTracker()
                    );

                const baselineResult =
                    await baselineFsm.runBaseline(
                        params
                    );

                expect(
                    baselineResult.failure?.phase
                ).toBe(
                    'INSPECTION'
                );

                expect(
                    await baselineGitManager.getHead()
                ).toBe(
                    initialHead
                );

                expect(
                    await baselineGitManager.getWorkingTreeStatus()
                ).toBe(
                    ''
                );

                /*
                 * Nuove istanze per il percorso Multi-Agent:
                 * nessuno stato interno del ContextBuilder o
                 * del TelemetryTracker viene condiviso.
                 */
                const multiAgentCapture =
                    createCapturingCoder();

                const multiAgentDependencies =
                    createUnusedDependencies();

                const multiAgentGitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const multiAgentContextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const multiAgentFsm =
                    new RefinementFSM(
                        'BE-P0-26-multi-agent',
                        multiAgentGitManager,
                        multiAgentDependencies.semgrep,
                        multiAgentDependencies.testHarness,
                        multiAgentDependencies.buildSyntaxOracle,
                        multiAgentCapture.coder,
                        multiAgentDependencies.reviewer,
                        multiAgentContextBuilder,
                        new TelemetryTracker()
                    );

                await multiAgentFsm.runLoop(
                    params
                );

                const baselinePayloads =
                    baselineCapture.getPayloads();

                const multiAgentPayloads =
                    multiAgentCapture.getPayloads();

                expect(
                    baselinePayloads.length
                ).toBeGreaterThanOrEqual(
                    1
                );

                expect(
                    multiAgentPayloads.length
                ).toBeGreaterThanOrEqual(
                    1
                );

                const baselineInitialPayload =
                    baselinePayloads[0];

                const multiAgentInitialPayload =
                    multiAgentPayloads[0];

                expect(
                    baselineInitialPayload
                ).toBeDefined();

                expect(
                    multiAgentInitialPayload
                ).toBeDefined();

                expect(
                    multiAgentInitialPayload
                ).toBe(
                    baselineInitialPayload
                );

                /*
                 * Verifichiamo esplicitamente che la parità
                 * riguardi anche il contratto test-informed.
                 */
                expect(
                    baselineInitialPayload
                ).toContain(
                    'TEST CONTRACT (read-only): tests/test_calculator.py'
                );

                expect(
                    baselineInitialPayload
                ).toContain(
                    'def test_addition_contract():'
                );

                expect(
                    baselineInitialPayload
                ).toContain(
                    '    assert result == 5'
                );

                expect(
                    multiAgentInitialPayload
                ).toContain(
                    'TEST CONTRACT (read-only): tests/test_calculator.py'
                );

                expect(
                    multiAgentInitialPayload
                ).toContain(
                    'def test_addition_contract():'
                );

                expect(
                    multiAgentInitialPayload
                ).toContain(
                    '    assert result == 5'
                );

                /*
                 * Il sorgente completo del test non deve
                 * apparire in nessuno dei due initial payload.
                 */
                expect(
                    baselineInitialPayload
                ).not.toContain(
                    'SECRET_PARITY_MARKER'
                );

                expect(
                    baselineInitialPayload
                ).not.toContain(
                    'def hidden_helper():'
                );

                expect(
                    baselineInitialPayload
                ).not.toContain(
                    'result = add(2, 3)'
                );

                expect(
                    multiAgentInitialPayload
                ).not.toContain(
                    'SECRET_PARITY_MARKER'
                );

                expect(
                    multiAgentInitialPayload
                ).not.toContain(
                    'def hidden_helper():'
                );

                expect(
                    multiAgentInitialPayload
                ).not.toContain(
                    'result = add(2, 3)'
                );

                expect(
                    await multiAgentGitManager.getHead()
                ).toBe(
                    initialHead
                );

                expect(
                    await multiAgentGitManager.getWorkingTreeStatus()
                ).toBe(
                    ''
                );
            },
            20_000
        );
    }
);
