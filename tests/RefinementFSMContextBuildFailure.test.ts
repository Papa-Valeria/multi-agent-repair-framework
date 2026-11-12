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

const createTemporaryDirectory =
    async (): Promise<string> => {
        const directory =
            await fs.mkdtemp(
                path.join(
                    os.tmpdir(),
                    'fsm-context-build-failure-'
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
            await createTemporaryDirectory();

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
                'context-failure@example.test'
            ]
        );

        await runGit(
            repositoryRoot,
            [
                'config',
                'user.name',
                'Context Failure Test'
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
                'target.py'
            ),
            [
                'def target():',
                '    return False',
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
                'fixture: context build failure'
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

describe(
    'BE-P0-27 - RefinementFSM context build failure',
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
            'classifica un test dichiarato non disponibile come CONTEXT_BUILD_FAILURE e non invoca il Coder',
            async () => {
                const {
                    repositoryRoot,
                    initialHead
                } =
                    await createRepository();

                let coderInvocationCount =
                    0;

                const coder =
                    {
                        generatePatch:
                            async (): Promise<string> => {
                                coderInvocationCount++;

                                throw new Error(
                                    'CoderAgent non deve essere invocato.'
                                );
                            }
                    } as unknown as CoderAgent;

                const reviewer =
                    {
                        review:
                            async (): Promise<never> => {
                                throw new Error(
                                    'ReviewerAgent non deve essere invocato.'
                                );
                            }
                    } as unknown as ReviewerAgent;

                const semgrep =
                    {
                        evaluate:
                            async (): Promise<never> => {
                                throw new Error(
                                    'Semgrep non deve essere invocato.'
                                );
                            }
                    } as unknown as SemgrepEngine;

                const testHarness =
                    {
                        evaluate:
                            async (): Promise<never> => {
                                throw new Error(
                                    'TestHarness non deve essere invocato.'
                                );
                            }
                    } as unknown as TestHarness;

                const buildSyntaxOracle =
                    {
                        evaluate:
                            async (): Promise<never> => {
                                throw new Error(
                                    'BuildSyntaxOracle non deve essere invocato.'
                                );
                            }
                    } as unknown as BuildSyntaxOracle;

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const fsm =
                    new RefinementFSM(
                        'BE-P0-27-context-build-failure',
                        gitManager,
                        semgrep,
                        testHarness,
                        buildSyntaxOracle,
                        coder,
                        reviewer,
                        contextBuilder,
                        new TelemetryTracker()
                    );

                const params:
                    InitialContextParams = {
                    issueSpec:
                        'Correggere il target.',

                    targetFiles: [
                        'src/target.py'
                    ],

                    /*
                     * Test esplicitamente dichiarato ma
                     * non presente nella fixture.
                     */
                    testFiles: [
                        'tests/missing_test.py'
                    ],

                    category:
                        'REPAIR'
                };

                const result =
                    await fsm.runLoop(
                        params
                    );

                expect(
                    coderInvocationCount
                ).toBe(
                    0
                );

                expect(
                    result.failure
                ).toBeDefined();

                expect(
                    result.failure?.phase
                ).toBe(
                    'INITIALIZATION'
                );

                expect(
                    result.failure?.category
                ).toBe(
                    'CONTEXT_BUILD_FAILURE'
                );

                expect(
                    result.failure?.recoverable
                ).toBe(
                    false
                );

                expect(
                    result.iterations
                ).toHaveLength(
                    0
                );

                expect(
                    result.candidateVerified
                ).toBe(
                    false
                );

                expect(
                    result.autonomousRunSucceeded
                ).toBe(
                    false
                );

                expect(
                    result.initialHead
                ).toBe(
                    initialHead
                );

                /*
                 * Il run fallisce prima di qualsiasi modifica
                 * repository.
                 */
                expect(
                    await gitManager.getHead()
                ).toBe(
                    initialHead
                );

                expect(
                    await gitManager.getWorkingTreeStatus()
                ).toBe(
                    ''
                );
            },
            15_000
        );

        it(
            'applica lo stesso fail closed anche al percorso Baseline',
            async () => {
                const {
                    repositoryRoot,
                    initialHead
                } =
                    await createRepository();

                let coderInvocationCount =
                    0;

                const coder =
                    {
                        generatePatch:
                            async (): Promise<string> => {
                                coderInvocationCount++;

                                throw new Error(
                                    'CoderAgent non deve essere invocato.'
                                );
                            }
                    } as unknown as CoderAgent;

                const reviewer =
                    {} as ReviewerAgent;

                const semgrep =
                    {} as SemgrepEngine;

                const testHarness =
                    {} as TestHarness;

                const buildSyntaxOracle =
                    {} as BuildSyntaxOracle;

                const gitManager =
                    new GitManager(
                        repositoryRoot
                    );

                const fsm =
                    new RefinementFSM(
                        'BE-P0-27-baseline-context-build-failure',
                        gitManager,
                        semgrep,
                        testHarness,
                        buildSyntaxOracle,
                        coder,
                        reviewer,
                        new ContextBuilder(
                            repositoryRoot
                        ),
                        new TelemetryTracker()
                    );

                const params:
                    InitialContextParams = {
                    issueSpec:
                        'Correggere il target.',

                    targetFiles: [
                        'src/target.py'
                    ],

                    testFiles: [
                        'tests/missing_test.py'
                    ],

                    category:
                        'REPAIR'
                };

                const result =
                    await fsm.runBaseline(
                        params
                    );

                expect(
                    coderInvocationCount
                ).toBe(
                    0
                );

                expect(
                    result.failure?.phase
                ).toBe(
                    'INITIALIZATION'
                );

                expect(
                    result.failure?.category
                ).toBe(
                    'CONTEXT_BUILD_FAILURE'
                );

                expect(
                    result.failure?.recoverable
                ).toBe(
                    false
                );

                expect(
                    result.iterations
                ).toHaveLength(
                    0
                );

                expect(
                    result.initialHead
                ).toBe(
                    initialHead
                );

                expect(
                    await gitManager.getHead()
                ).toBe(
                    initialHead
                );

                expect(
                    await gitManager.getWorkingTreeStatus()
                ).toBe(
                    ''
                );
            },
            15_000
        );
    }
);
