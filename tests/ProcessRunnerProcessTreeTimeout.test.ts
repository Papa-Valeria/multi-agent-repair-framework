import {
    afterEach,
    describe,
    expect,
    it
} from '@jest/globals';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
    ProcessRunner
} from '../src/verification/ProcessRunner.js';

const PROCESS_TIMEOUT_MS =
    1_200;

const LATE_WRITE_DELAY_MS =
    3_000;

const POST_TIMEOUT_OBSERVATION_MS =
    3_500;

const createdDirectories:
    string[] = [];

const wait = async (
    durationMs: number
): Promise<void> => {
    await new Promise<void>(
        (resolve) => {
            setTimeout(
                resolve,
                durationMs
            );
        }
    );
};

const fileExists = async (
    filePath: string
): Promise<boolean> => {
    try {
        await fs.access(
            filePath
        );

        return true;
    } catch {
        return false;
    }
};

const readPid = async (
    filePath: string
): Promise<number | null> => {
    try {
        const content =
            await fs.readFile(
                filePath,
                'utf8'
            );

        const value =
            Number.parseInt(
                content.trim(),
                10
            );

        return Number.isInteger(value) &&
            value > 0
            ? value
            : null;
    } catch {
        return null;
    }
};

const isProcessAlive = (
    pid: number
): boolean => {
    try {
        process.kill(
            pid,
            0
        );

        return true;
    } catch {
        return false;
    }
};

const forceKillIfAlive = (
    pid: number | null
): void => {
    if (
        pid === null ||
        !isProcessAlive(pid)
    ) {
        return;
    }

    try {
        process.kill(
            pid,
            'SIGKILL'
        );
    } catch {
        /*
         * Il processo potrebbe essere terminato
         * tra il controllo e il segnale.
         */
    }
};

const waitForFile = async (
    filePath: string,
    timeoutMs: number
): Promise<boolean> => {
    const startedAt =
        performance.now();

    while (
        performance.now() -
        startedAt <
        timeoutMs
    ) {
        if (
            await fileExists(
                filePath
            )
        ) {
            return true;
        }

        await wait(
            25
        );
    }

    return false;
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
    'BE-P1-15 - ProcessRunner process-tree timeout cleanup',
    () => {
        it(
            'termina parent e child senza consentire file tardivi dopo il timeout',
            async () => {
                const directory =
                    await fs.mkdtemp(
                        path.join(
                            os.tmpdir(),
                            'be-p1-15-'
                        )
                    );

                createdDirectories.push(
                    directory
                );

                const parentScriptPath =
                    path.join(
                        directory,
                        'parent.cjs'
                    );

                const childScriptPath =
                    path.join(
                        directory,
                        'child.cjs'
                    );

                const parentPidPath =
                    path.join(
                        directory,
                        'parent.pid'
                    );

                const childPidPath =
                    path.join(
                        directory,
                        'child.pid'
                    );

                const parentReadyPath =
                    path.join(
                        directory,
                        'parent.ready'
                    );

                const childReadyPath =
                    path.join(
                        directory,
                        'child.ready'
                    );

                const parentLateMarkerPath =
                    path.join(
                        directory,
                        'parent-late-marker.txt'
                    );

                const childLateMarkerPath =
                    path.join(
                        directory,
                        'child-late-marker.txt'
                    );

                const childScript = [
                    "const fs = require('node:fs');",
                    '',
                    'const [',
                    '  childPidPath,',
                    '  childReadyPath,',
                    '  childLateMarkerPath,',
                    '  lateWriteDelayMs',
                    '] = process.argv.slice(2);',
                    '',
                    'fs.writeFileSync(',
                    '  childPidPath,',
                    '  String(process.pid),',
                    "  'utf8'",
                    ');',
                    '',
                    'fs.writeFileSync(',
                    '  childReadyPath,',
                    "  'ready',",
                    "  'utf8'",
                    ');',
                    '',
                    'setTimeout(',
                    '  () => {',
                    '    fs.writeFileSync(',
                    '      childLateMarkerPath,',
                    "      'child survived timeout',",
                    "      'utf8'",
                    '    );',
                    '  },',
                    '  Number(lateWriteDelayMs)',
                    ');'
                ].join(
                    '\n'
                );

                const parentScript = [
                    "const fs = require('node:fs');",
                    "const { spawn } = require('node:child_process');",
                    '',
                    'const [',
                    '  childScriptPath,',
                    '  parentPidPath,',
                    '  childPidPath,',
                    '  parentReadyPath,',
                    '  childReadyPath,',
                    '  parentLateMarkerPath,',
                    '  childLateMarkerPath,',
                    '  lateWriteDelayMs',
                    '] = process.argv.slice(2);',
                    '',
                    'fs.writeFileSync(',
                    '  parentPidPath,',
                    '  String(process.pid),',
                    "  'utf8'",
                    ');',
                    '',
                    'fs.writeFileSync(',
                    '  parentReadyPath,',
                    "  'ready',",
                    "  'utf8'",
                    ');',
                    '',
                    'const child = spawn(',
                    '  process.execPath,',
                    '  [',
                    '    childScriptPath,',
                    '    childPidPath,',
                    '    childReadyPath,',
                    '    childLateMarkerPath,',
                    '    lateWriteDelayMs',
                    '  ],',
                    '  {',
                    '    shell: false,',
                    "    stdio: 'ignore'",
                    '  }',
                    ');',
                    '',
                    'child.once(',
                    "  'error',",
                    '  (error) => {',
                    '    fs.writeSync(',
                    '      2,',
                    "      `CHILD_START_ERROR:${error.message}\\n`",
                    '    );',
                    '  }',
                    ');',
                    '',
                    'fs.writeSync(',
                    '  1,',
                    "  'PARENT_STARTED\\n'",
                    ');',
                    '',
                    'setTimeout(',
                    '  () => {',
                    '    fs.writeFileSync(',
                    '      parentLateMarkerPath,',
                    "      'parent survived timeout',",
                    "      'utf8'",
                    '    );',
                    '  },',
                    '  Number(lateWriteDelayMs)',
                    ');'
                ].join(
                    '\n'
                );

                await fs.writeFile(
                    childScriptPath,
                    childScript,
                    'utf8'
                );

                await fs.writeFile(
                    parentScriptPath,
                    parentScript,
                    'utf8'
                );

                let parentPid:
                    number | null = null;

                let childPid:
                    number | null = null;

                try {
                    const executionPromise =
                        ProcessRunner.execute(
                            process.execPath,
                            [
                                parentScriptPath,
                                childScriptPath,
                                parentPidPath,
                                childPidPath,
                                parentReadyPath,
                                childReadyPath,
                                parentLateMarkerPath,
                                childLateMarkerPath,
                                String(
                                    LATE_WRITE_DELAY_MS
                                )
                            ],
                            {
                                cwd:
                                    directory,

                                timeoutMs:
                                    PROCESS_TIMEOUT_MS,

                                envAllowList:
                                    []
                            }
                        );

                    const parentBecameReady =
                        await waitForFile(
                            parentReadyPath,
                            PROCESS_TIMEOUT_MS
                        );

                    const childBecameReady =
                        await waitForFile(
                            childReadyPath,
                            PROCESS_TIMEOUT_MS
                        );

                    expect(
                        parentBecameReady
                    ).toBe(
                        true
                    );

                    expect(
                        childBecameReady
                    ).toBe(
                        true
                    );

                    parentPid =
                        await readPid(
                            parentPidPath
                        );

                    childPid =
                        await readPid(
                            childPidPath
                        );

                    expect(
                        parentPid
                    ).not.toBeNull();

                    expect(
                        childPid
                    ).not.toBeNull();

                    expect(
                        parentPid
                    ).not.toBe(
                        childPid
                    );

                    const result =
                        await executionPromise;

                    expect(
                        result.timedOut
                    ).toBe(
                        true
                    );

                    expect(
                        result.stdout
                    ).toContain(
                        'PARENT_STARTED'
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

                    /*
                     * Il processo tree killer può completare pochi istanti
                     * dopo la chiusura osservata del parent, soprattutto
                     * su Windows dove viene utilizzato taskkill.
                     */
                    await wait(
                        250
                    );

                    expect(
                        parentPid === null
                            ? false
                            : isProcessAlive(
                                parentPid
                            )
                    ).toBe(
                        false
                    );

                    expect(
                        childPid === null
                            ? false
                            : isProcessAlive(
                                childPid
                            )
                    ).toBe(
                        false
                    );

                    expect(
                        await fileExists(
                            parentLateMarkerPath
                        )
                    ).toBe(
                        false
                    );

                    expect(
                        await fileExists(
                            childLateMarkerPath
                        )
                    ).toBe(
                        false
                    );

                    /*
                     * La finestra di osservazione supera il ritardo con cui
                     * parent e child avrebbero creato i marker. Se un processo
                     * fosse sopravvissuto al timeout, il file comparirebbe qui.
                     */
                    await wait(
                        POST_TIMEOUT_OBSERVATION_MS
                    );

                    expect(
                        await fileExists(
                            parentLateMarkerPath
                        )
                    ).toBe(
                        false
                    );

                    expect(
                        await fileExists(
                            childLateMarkerPath
                        )
                    ).toBe(
                        false
                    );

                    expect(
                        parentPid === null
                            ? false
                            : isProcessAlive(
                                parentPid
                            )
                    ).toBe(
                        false
                    );

                    expect(
                        childPid === null
                            ? false
                            : isProcessAlive(
                                childPid
                            )
                    ).toBe(
                        false
                    );
                } finally {
                    /*
                     * Cleanup difensivo nel caso in cui una regressione del
                     * ProcessRunner lasci vivo uno dei processi sotto test.
                     */
                    forceKillIfAlive(
                        childPid
                    );

                    forceKillIfAlive(
                        parentPid
                    );

                    await fs.rm(
                        directory,
                        {
                            recursive:
                                true,

                            force:
                                true
                        }
                    );

                    const directoryIndex =
                        createdDirectories.indexOf(
                            directory
                        );

                    if (
                        directoryIndex >= 0
                    ) {
                        createdDirectories.splice(
                            directoryIndex,
                            1
                        );
                    }
                }
            },
            15_000
        );
    }
);
