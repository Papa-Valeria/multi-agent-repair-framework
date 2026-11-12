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
    GitManager,
    type FuzzyWriteFile,
    type PatchScope
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
    OracleResult
} from '../src/types/domain.js';

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
    readonly firstTargetPath: string;
    readonly secondTargetPath: string;
}

class ForcedFuzzyGitManager extends GitManager {
    public override async evaluateApplicability(
        unifiedDiff: string,
        _scope: PatchScope,
        required: boolean
    ): Promise<OracleResult<'APPLICABILITY'>> {
        return {
            oracle:
                'APPLICABILITY',

            status:
                'PASS',

            required,

            durationMs:
                0,

            summary:
                'Patch certificata come applicabile tramite FUZZY dal test BE-P0-25.',

            evidence: {
                applyMode:
                    'FUZZY',

                patchHash:
                    this.computePatchHash(
                        unifiedDiff
                    )
            }
        };
    }
}

const normalizeText =
    (
        content: string
    ): string =>
        content.replace(
            /\r\n/g,
            '\n'
        );

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

const readText =
    async (
        filePath: string
    ): Promise<string> => {
        const content =
            await fs.readFile(
                filePath,
                'utf8'
            );

        return normalizeText(
            content
        );
    };

const pathExists =
    async (
        candidatePath: string
    ): Promise<boolean> => {
        try {
            await fs.lstat(
                candidatePath
            );

            return true;
        } catch (error: unknown) {
            const fileError =
                error as NodeJS.ErrnoException;

            if (
                fileError.code === 'ENOENT' ||
                fileError.code === 'ENOTDIR'
            ) {
                return false;
            }

            throw error;
        }
    };

const removeDirectoryWithRetry =
    async (
        directory: string
    ): Promise<void> => {
        const maximumAttempts =
            5;

        for (
            let attempt = 1;
            attempt <= maximumAttempts;
            attempt++
        ) {
            try {
                await fs.rm(
                    directory,
                    {
                        recursive:
                            true,

                        force:
                            true
                    }
                );

                return;
            } catch (error: unknown) {
                const fileError =
                    error as NodeJS.ErrnoException;

                if (
                    attempt === maximumAttempts ||
                    (
                        fileError.code !== 'EBUSY' &&
                        fileError.code !== 'EPERM'
                    )
                ) {
                    throw error;
                }

                await new Promise<void>(
                    (resolve) => {
                        setTimeout(
                            resolve,
                            100 * attempt
                        );
                    }
                );
            }
        }
    };

const createRepository =
    async (): Promise<RepositoryFixture> => {
        const repositoryRoot =
            await createTemporaryDirectory(
                'refinement-fsm-partial-fuzzy-'
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
                'partial-fuzzy@example.test'
            ]
        );

        await runGit(
            repositoryRoot,
            [
                'config',
                'user.name',
                'Partial FUZZY Rollback Test'
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

        const firstTargetPath =
            path.join(
                repositoryRoot,
                'src',
                'first.txt'
            );

        const secondTargetPath =
            path.join(
                repositoryRoot,
                'src',
                'second.txt'
            );

        await fs.writeFile(
            firstTargetPath,
            'first-original\n',
            'utf8'
        );

        await fs.writeFile(
            secondTargetPath,
            'second-original\n',
            'utf8'
        );

        await fs.writeFile(
            path.join(
                repositoryRoot,
                'tests',
                'test_contract.py'
            ),
            [
                'def test_contract():',
                '    assert True',
                ''
            ].join('\n'),
            'utf8'
        );

        /*
         * Serve anche alla fixture-reset policy usata
         * dal rollback. Non è necessario ignorare altri
         * file per questo scenario.
         */
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
                'fixture: initial partial fuzzy state'
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
            initialHead,
            firstTargetPath,
            secondTargetPath
        };
    };

const partialFuzzyPatch = [
    '--- a/src/first.txt',
    '+++ b/src/first.txt',
    '@@ -1 +1 @@',
    '-first-original',
    '+first-modified',
    '--- a/src/second.txt',
    '+++ b/src/second.txt',
    '@@ -1 +1 @@',
    '-second-original',
    '+second-modified'
].join('\n');

describe(
    'BE-P0-25 - Partial FUZZY write and FSM rollback',
    () => {
        afterEach(async () => {
            for (
                const directory of
                temporaryDirectories
            ) {
                await removeDirectoryWithRetry(
                    directory
                );
            }

            temporaryDirectories.length =
                0;
        });

        it(
            'ripristina HEAD, working tree e residui dopo il fallimento della seconda scrittura FUZZY',
            async () => {
                const {
                    repositoryRoot,
                    initialHead,
                    firstTargetPath,
                    secondTargetPath
                } =
                    await createRepository();

                const residualPath =
                    path.join(
                        repositoryRoot,
                        'partial-write-residual.tmp'
                    );

                let writeCount =
                    0;

                let firstWriteObservedBeforeFailure =
                    false;

                let firstWrittenContentBeforeRollback:
                    string | undefined;

                const failingWriter:
                    FuzzyWriteFile =
                    async (
                        filePath,
                        content,
                        encoding
                    ): Promise<void> => {
                        writeCount++;

                        if (
                            writeCount === 1
                        ) {
                            /*
                             * La prima write deve avvenire realmente.
                             */
                            await fs.writeFile(
                                filePath,
                                content,
                                encoding
                            );

                            firstWrittenContentBeforeRollback =
                                await readText(
                                    filePath
                                );

                            firstWriteObservedBeforeFailure =
                                firstWrittenContentBeforeRollback ===
                                'first-modified\n';

                            /*
                             * Residuo untracked creato durante la
                             * fase parzialmente completata.
                             *
                             * Il rollback FSM deve eliminarlo tramite
                             * la fixture-reset policy.
                             */
                            await fs.writeFile(
                                residualPath,
                                'partial fuzzy residual\n',
                                'utf8'
                            );

                            return;
                        }

                        if (
                            writeCount === 2
                        ) {
                            /*
                             * Verifichiamo immediatamente che la prima
                             * scrittura sia già visibile prima di
                             * provocare la seconda failure.
                             */
                            const firstContent =
                                await readText(
                                    firstTargetPath
                                );

                            firstWriteObservedBeforeFailure =
                                firstContent ===
                                'first-modified\n';

                            throw new Error(
                                'Injected second FUZZY write failure'
                            );
                        }

                        throw new Error(
                            `Scrittura FUZZY inattesa numero ${writeCount}.`
                        );
                    };

                const gitManager =
                    new ForcedFuzzyGitManager(
                        repositoryRoot,
                        failingWriter
                    );

                const coder =
                    {
                        generatePatch:
                            async (): Promise<string> =>
                                partialFuzzyPatch
                    } as unknown as CoderAgent;

                /*
                 * Queste dipendenze non devono essere invocate:
                 * la failure avviene durante PATCH_APPLICATION,
                 * prima dell'EVALUATION.
                 */
                const semgrep =
                    {
                        evaluate:
                            async (): Promise<never> => {
                                throw new Error(
                                    'Semgrep non deve essere invocato dopo una partial FUZZY failure.'
                                );
                            }
                    } as unknown as SemgrepEngine;

                const testHarness =
                    {
                        evaluate:
                            async (): Promise<never> => {
                                throw new Error(
                                    'TestHarness non deve essere invocato dopo una partial FUZZY failure.'
                                );
                            }
                    } as unknown as TestHarness;

                const buildSyntaxOracle =
                    {
                        evaluate:
                            async (): Promise<never> => {
                                throw new Error(
                                    'BuildSyntaxOracle non deve essere invocato dopo una partial FUZZY failure.'
                                );
                            }
                    } as unknown as BuildSyntaxOracle;

                const reviewer =
                    {
                        review:
                            async (): Promise<never> => {
                                throw new Error(
                                    'ReviewerAgent non deve essere invocato dopo una partial FUZZY failure.'
                                );
                            }
                    } as unknown as ReviewerAgent;

                const contextBuilder =
                    new ContextBuilder(
                        repositoryRoot
                    );

                const telemetryTracker =
                    new TelemetryTracker();

                const fsm =
                    new RefinementFSM(
                        'BE-P0-25-partial-fuzzy',
                        gitManager,
                        semgrep,
                        testHarness,
                        buildSyntaxOracle,
                        coder,
                        reviewer,
                        contextBuilder,
                        telemetryTracker
                    );

                const params:
                    InitialContextParams = {
                    issueSpec:
                        'Modificare entrambi i file target.',

                    targetFiles: [
                        'src/first.txt',
                        'src/second.txt'
                    ],

                    testFiles: [
                        'tests/test_contract.py'
                    ],

                    category:
                        'REPAIR'
                };

                const result =
                    await fsm.runLoop(
                        params
                    );

                /*
                 * Deve essersi verificata realmente una partial
                 * write: la prima modifica era già visibile
                 * prima della failure della seconda write.
                 */
                expect(
                    writeCount
                ).toBe(
                    2
                );

                expect(
                    firstWriteObservedBeforeFailure
                ).toBe(
                    true
                );

                expect(
                    firstWrittenContentBeforeRollback
                ).toBe(
                    'first-modified\n'
                );

                /*
                 * Il fallimento deve essere classificato
                 * come application failure, non come errore
                 * di applicability o di valutazione.
                 */
                expect(
                    result.failure?.phase
                ).toBe(
                    'PATCH_APPLICATION'
                );

                expect(
                    result.failure?.category
                ).toBe(
                    'PATCH_APPLICATION_FAILURE'
                );

                expect(
                    result.failure?.message
                ).toContain(
                    'La patch risultava applicabile in modalità FUZZY'
                );

                /*
                 * Il rollback deve essere stato eseguito
                 * automaticamente dal RefinementFSM.
                 */
                expect(
                    result.rollbackResult?.status
                ).toBe(
                    'SUCCESS'
                );

                expect(
                    result.rollbackResult?.initialHead
                ).toBe(
                    initialHead
                );

                expect(
                    result.rollbackResult?.finalHead
                ).toBe(
                    initialHead
                );

                expect(
                    result.rollbackResult?.repositoryClean
                ).toBe(
                    true
                );

                /*
                 * HEAD finale identico all'HEAD transazionale.
                 */
                expect(
                    await gitManager.getHead()
                ).toBe(
                    initialHead
                );

                /*
                 * Il working tree deve essere completamente clean.
                 */
                expect(
                    await gitManager.getWorkingTreeStatus()
                ).toBe(
                    ''
                );

                /*
                 * Il primo file era stato realmente modificato,
                 * ma deve essere tornato al contenuto originale.
                 */
                expect(
                    await readText(
                        firstTargetPath
                    )
                ).toBe(
                    'first-original\n'
                );

                /*
                 * La seconda scrittura non è stata completata.
                 * Anche il secondo file deve essere allo stato
                 * iniziale della transazione.
                 */
                expect(
                    await readText(
                        secondTargetPath
                    )
                ).toBe(
                    'second-original\n'
                );

                /*
                 * Il residuo untracked creato durante la prima
                 * scrittura deve essere eliminato dal rollback.
                 */
                expect(
                    await pathExists(
                        residualPath
                    )
                ).toBe(
                    false
                );

                /*
                 * Lo stato pubblicato deve mantenere l'HEAD
                 * iniziale registrato dalla transazione.
                 */
                expect(
                    result.initialHead
                ).toBe(
                    initialHead
                );

                expect(
                    result.iterations
                ).toHaveLength(
                    1
                );

                expect(
                    result.iterations[0]?.failure?.phase
                ).toBe(
                    'PATCH_APPLICATION'
                );

                expect(
                    result.iterations[0]?.failure?.category
                ).toBe(
                    'PATCH_APPLICATION_FAILURE'
                );

                expect(
                    result.iterations[0]?.applyMode
                ).toBe(
                    'NOT_APPLICABLE'
                );

                expect(
                    result.iterations[0]?.fuzzyFallbackUsed
                ).toBe(
                    false
                );
            },
            20_000
        );
    }
);
