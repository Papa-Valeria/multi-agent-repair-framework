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

import {
    GitManager
} from '../src/git/GitManager.js';

import type {
    PatchScope
} from '../src/git/GitManager.js';

const execFileAsync =
    promisify(
        execFile
    );

const createdDirectories:
    string[] = [];

const TARGET_FILE =
    'src/target.ts';

const BASE_CONTENT = [
    'export function alpha(): number {',
    '  return 1;',
    '}',
    '',
    'export function beta(): number {',
    '  return 2;',
    '}',
    '',
    'export function gamma(): number {',
    '  return 3;',
    '}',
    ''
].join('\n');

const MODIFIED_CONTENT = [
    'export function alpha(): number {',
    '  return 10;',
    '}',
    '',
    'export function beta(): number {',
    '  return 2;',
    '}',
    '',
    'export function gamma(): number {',
    '  return 30;',
    '}',
    ''
].join('\n');

const scope:
    PatchScope = {
    category:
        'REPAIR',

    targetFiles: [
        TARGET_FILE
    ],

    testFiles:
        []
};

const normalizeLineEndings = (
    content: string
): string => {
    return content.replace(
        /\r\n/g,
        '\n'
    );
};

const expectFileContent = async (
    repoRoot: string,
    expectedContent: string
): Promise<void> => {
    const actualContent =
        await fs.readFile(
            path.join(
                repoRoot,
                TARGET_FILE
            ),
            'utf8'
        );

    expect(
        normalizeLineEndings(
            actualContent
        )
    ).toBe(
        normalizeLineEndings(
            expectedContent
        )
    );
};

const runGit = async (
    repoRoot: string,
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
                    repoRoot
            }
        );

    return result.stdout;
};

const createRepository =
    async (): Promise<string> => {
        const repoRoot =
            await fs.mkdtemp(
                path.join(
                    os.tmpdir(),
                    'be-p1-16-'
                )
            );

        createdDirectories.push(
            repoRoot
        );

        await runGit(
            repoRoot,
            [
                'init'
            ]
        );

        /*
         * Il fixture deve essere indipendente dalla configurazione
         * Git globale della macchina che esegue il test.
         */
        await runGit(
            repoRoot,
            [
                'config',
                'core.autocrlf',
                'false'
            ]
        );

        await runGit(
            repoRoot,
            [
                'config',
                'user.name',
                'BE-P1-16 Test'
            ]
        );

        await runGit(
            repoRoot,
            [
                'config',
                'user.email',
                'be-p1-16@example.invalid'
            ]
        );

        const targetPath =
            path.join(
                repoRoot,
                TARGET_FILE
            );

        await fs.mkdir(
            path.dirname(
                targetPath
            ),
            {
                recursive:
                    true
            }
        );

        await fs.writeFile(
            targetPath,
            BASE_CONTENT,
            'utf8'
        );

        await runGit(
            repoRoot,
            [
                'add',
                '--',
                TARGET_FILE
            ]
        );

        await runGit(
            repoRoot,
            [
                'commit',
                '-m',
                'Initial fixture'
            ]
        );

        return repoRoot;
    };

const createPatch =
    async (
        repoRoot: string
    ): Promise<string> => {
        const targetPath =
            path.join(
                repoRoot,
                TARGET_FILE
            );

        await fs.writeFile(
            targetPath,
            MODIFIED_CONTENT,
            'utf8'
        );

        const patch =
            await runGit(
                repoRoot,
                [
                    'diff',
                    '--',
                    TARGET_FILE
                ]
            );

        /*
         * Probe e apply devono partire esattamente
         * dallo stesso stato del repository.
         */
        await runGit(
            repoRoot,
            [
                'checkout',
                '--',
                TARGET_FILE
            ]
        );

        return patch;
    };

const listTemporaryPatchFiles =
    async (
        repoRoot: string
    ): Promise<string[]> => {
        const entries =
            await fs.readdir(
                repoRoot
            );

        return entries.filter(
            (entry) =>
                entry.startsWith(
                    '.tmp_'
                ) &&
                entry.endsWith(
                    '.patch'
                )
        );
    };

afterEach(
    async () => {
        for (
            const directory of
            createdDirectories.splice(0)
        ) {
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
    }
);

describe(
    'BE-P1-16 - Git probe/apply equivalence',
    () => {
        it(
            'applica realmente una patch certificata GIT sullo stesso repository state',
            async () => {
                const repoRoot =
                    await createRepository();

                const manager =
                    new GitManager(
                        repoRoot
                    );

                const patch =
                    await createPatch(
                        repoRoot
                    );

                expect(
                    patch.trim().length
                ).toBeGreaterThan(
                    0
                );

                await expectFileContent(
                    repoRoot,
                    BASE_CONTENT
                );

                expect(
                    await manager
                        .isWorkingTreeClean()
                ).toBe(
                    true
                );

                const applicability =
                    await manager
                        .evaluateApplicability(
                            patch,
                            scope,
                            true
                        );

                expect(
                    applicability.status
                ).toBe(
                    'PASS'
                );

                expect(
                    applicability.evidence
                        .applyMode
                ).toBe(
                    'GIT'
                );

                expect(
                    applicability.evidence
                        .patchHash
                ).toBe(
                    manager.computePatchHash(
                        patch
                    )
                );

                /*
                 * Il probe deve essere osservazionalmente
                 * privo di effetti sul repository.
                 */
                await expectFileContent(
                    repoRoot,
                    BASE_CONTENT
                );

                expect(
                    await manager
                        .isWorkingTreeClean()
                ).toBe(
                    true
                );

                /*
                 * Narrowing reale TypeScript.
                 */
                if (
                    applicability.evidence
                        .applyMode !== 'GIT'
                ) {
                    throw new Error(
                        'Il probe doveva certificare GIT.'
                    );
                }

                const actualMode =
                    await manager.applyPatch(
                        patch,
                        scope,
                        applicability.evidence
                            .applyMode
                    );

                expect(
                    actualMode
                ).toBe(
                    'GIT'
                );

                await expectFileContent(
                    repoRoot,
                    MODIFIED_CONTENT
                );

                expect(
                    await manager
                        .isWorkingTreeClean()
                ).toBe(
                    false
                );
            }
        );

        it(
            'mantiene equivalenza probe/apply con modifiche in zone diverse del file',
            async () => {
                const repoRoot =
                    await createRepository();

                const manager =
                    new GitManager(
                        repoRoot
                    );

                const patch =
                    await createPatch(
                        repoRoot
                    );

                expect(
                    patch
                ).toContain(
                    'return 10;'
                );

                expect(
                    patch
                ).toContain(
                    'return 30;'
                );

                const applicability =
                    await manager
                        .evaluateApplicability(
                            patch,
                            scope,
                            true
                        );

                expect(
                    applicability.status
                ).toBe(
                    'PASS'
                );

                expect(
                    applicability.evidence
                        .applyMode
                ).toBe(
                    'GIT'
                );

                if (
                    applicability.evidence
                        .applyMode !== 'GIT'
                ) {
                    throw new Error(
                        'La patch doveva essere certificata GIT.'
                    );
                }

                const actualMode =
                    await manager.applyPatch(
                        patch,
                        scope,
                        applicability.evidence
                            .applyMode
                    );

                expect(
                    actualMode
                ).toBe(
                    'GIT'
                );

                await expectFileContent(
                    repoRoot,
                    MODIFIED_CONTENT
                );
            }
        );

        it(
            'il probe GIT non modifica HEAD né working tree',
            async () => {
                const repoRoot =
                    await createRepository();

                const manager =
                    new GitManager(
                        repoRoot
                    );

                const initialHead =
                    await manager.getHead();

                const patch =
                    await createPatch(
                        repoRoot
                    );

                expect(
                    await manager
                        .isWorkingTreeClean()
                ).toBe(
                    true
                );

                const applicability =
                    await manager
                        .evaluateApplicability(
                            patch,
                            scope,
                            true
                        );

                expect(
                    applicability.status
                ).toBe(
                    'PASS'
                );

                expect(
                    applicability.evidence
                        .applyMode
                ).toBe(
                    'GIT'
                );

                expect(
                    await manager.getHead()
                ).toBe(
                    initialHead
                );

                expect(
                    await manager
                        .isWorkingTreeClean()
                ).toBe(
                    true
                );

                await expectFileContent(
                    repoRoot,
                    BASE_CONTENT
                );
            }
        );

        it(
            'rimuove il file patch temporaneo dopo il probe',
            async () => {
                const repoRoot =
                    await createRepository();

                const manager =
                    new GitManager(
                        repoRoot
                    );

                const patch =
                    await createPatch(
                        repoRoot
                    );

                expect(
                    await listTemporaryPatchFiles(
                        repoRoot
                    )
                ).toEqual(
                    []
                );

                const applicability =
                    await manager
                        .evaluateApplicability(
                            patch,
                            scope,
                            true
                        );

                expect(
                    applicability.status
                ).toBe(
                    'PASS'
                );

                expect(
                    applicability.evidence
                        .applyMode
                ).toBe(
                    'GIT'
                );

                expect(
                    await listTemporaryPatchFiles(
                        repoRoot
                    )
                ).toEqual(
                    []
                );
            }
        );

        it(
            'rimuove il file patch temporaneo dopo l apply',
            async () => {
                const repoRoot =
                    await createRepository();

                const manager =
                    new GitManager(
                        repoRoot
                    );

                const patch =
                    await createPatch(
                        repoRoot
                    );

                const applicability =
                    await manager
                        .evaluateApplicability(
                            patch,
                            scope,
                            true
                        );

                expect(
                    applicability.evidence
                        .applyMode
                ).toBe(
                    'GIT'
                );

                if (
                    applicability.evidence
                        .applyMode !== 'GIT'
                ) {
                    throw new Error(
                        'La patch doveva essere certificata GIT.'
                    );
                }

                await manager.applyPatch(
                    patch,
                    scope,
                    applicability.evidence
                        .applyMode
                );

                expect(
                    await listTemporaryPatchFiles(
                        repoRoot
                    )
                ).toEqual(
                    []
                );

                await expectFileContent(
                    repoRoot,
                    MODIFIED_CONTENT
                );
            }
        );

        it(
            'non ricertifica GIT la stessa patch dopo che lo stato del repository è cambiato',
            async () => {
                const repoRoot =
                    await createRepository();

                const manager =
                    new GitManager(
                        repoRoot
                    );

                const patch =
                    await createPatch(
                        repoRoot
                    );

                const firstProbe =
                    await manager
                        .evaluateApplicability(
                            patch,
                            scope,
                            true
                        );

                expect(
                    firstProbe.status
                ).toBe(
                    'PASS'
                );

                expect(
                    firstProbe.evidence
                        .applyMode
                ).toBe(
                    'GIT'
                );

                if (
                    firstProbe.evidence
                        .applyMode !== 'GIT'
                ) {
                    throw new Error(
                        'Il primo probe doveva certificare GIT.'
                    );
                }

                await manager.applyPatch(
                    patch,
                    scope,
                    firstProbe.evidence
                        .applyMode
                );

                await expectFileContent(
                    repoRoot,
                    MODIFIED_CONTENT
                );

                /*
                 * Il repository non è più nello stato
                 * certificato dal primo probe.
                 */
                const secondProbe =
                    await manager
                        .evaluateApplicability(
                            patch,
                            scope,
                            true
                        );

                expect(
                    secondProbe.evidence
                        .applyMode
                ).not.toBe(
                    'GIT'
                );
            }
        );

        it(
            'rollback ripristina HEAD, working tree e contenuto dopo apply',
            async () => {
                const repoRoot =
                    await createRepository();

                const manager =
                    new GitManager(
                        repoRoot
                    );

                const initialHead =
                    await manager.getHead();

                const patch =
                    await createPatch(
                        repoRoot
                    );

                const applicability =
                    await manager
                        .evaluateApplicability(
                            patch,
                            scope,
                            true
                        );

                expect(
                    applicability.status
                ).toBe(
                    'PASS'
                );

                expect(
                    applicability.evidence
                        .applyMode
                ).toBe(
                    'GIT'
                );

                if (
                    applicability.evidence
                        .applyMode !== 'GIT'
                ) {
                    throw new Error(
                        'La patch doveva essere certificata GIT.'
                    );
                }

                await manager.applyPatch(
                    patch,
                    scope,
                    applicability.evidence
                        .applyMode
                );

                await expectFileContent(
                    repoRoot,
                    MODIFIED_CONTENT
                );

                expect(
                    await manager
                        .isWorkingTreeClean()
                ).toBe(
                    false
                );

                const rollback =
                    await manager.rollback(
                        initialHead
                    );

                expect(
                    rollback.status
                ).toBe(
                    'SUCCESS'
                );

                expect(
                    rollback.finalHead
                ).toBe(
                    initialHead
                );

                expect(
                    rollback.repositoryClean
                ).toBe(
                    true
                );

                expect(
                    rollback.workingTreeStatus
                ).toBe(
                    ''
                );

                await expectFileContent(
                    repoRoot,
                    BASE_CONTENT
                );

                expect(
                    await manager
                        .isWorkingTreeClean()
                ).toBe(
                    true
                );
            }
        );
    }
);
