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
    CoderAgent
} from '../src/agents/CoderAgent.js';

import {
    ReviewerAgent
} from '../src/agents/ReviewerAgent.js';

import {
    ContextBuilder
} from '../src/orchestration/ContextBuilder.js';

import {
    DEFAULT_PROMPT_PROFILE
} from '../src/inference/PromptProfile.js';

import type {
    PromptProfile
} from '../src/inference/PromptProfile.js';

import type {
    ChatMessage,
    OpenAICompatibleClient
} from '../src/inference/OpenAICompatibleClient.js';

import type {
    CumulativeRemediation,
    OracleResult,
    TestExecutionReport
} from '../src/types/domain.js';

const TEST_PROFILE_ID =
    'prompt-profile-provenance-test-v1';

const TARGET_FILE =
    'src/target.ts';

const createdDirectories:
    string[] = [];

const TEST_PROMPT_PROFILE:
    PromptProfile = {
    id:
        TEST_PROFILE_ID,

    contextBuilder: {
        createModeDirective:
            '__CONTEXT_CREATE_MODE__',

        repairModeDirective:
            '__CONTEXT_REPAIR_MODE__',

        diffInstructions:
            '__CONTEXT_DIFF_INSTRUCTIONS__',

        createDiffInstructions:
            '__CONTEXT_CREATE_DIFF_INSTRUCTIONS__',

        refinementInstructions:
            '__CONTEXT_REFINEMENT_INSTRUCTIONS__',

        createRefinementDirective:
            '__CONTEXT_CREATE_REFINEMENT_DIRECTIVE__',

        repairRefinementDirective:
            '__CONTEXT_REPAIR_REFINEMENT_DIRECTIVE__',

        technicalRetryInstructions:
            '__CONTEXT_TECHNICAL_RETRY_INSTRUCTIONS__',

        newFileTargetMarker:
            '__CONTEXT_NEW_FILE_TARGET_MARKER__'
    },

    coder: {
        systemInstructions:
            '__CODER_SYSTEM_INSTRUCTIONS__'
    },

    reviewer: {
        systemInstructions:
            '__REVIEWER_SYSTEM_INSTRUCTIONS__',

        createModeDirective:
            '__REVIEWER_CREATE_MODE_DIRECTIVE__',

        repairModeDirective:
            '__REVIEWER_REPAIR_MODE_DIRECTIVE__',

        responseInstructions:
            '__REVIEWER_RESPONSE_INSTRUCTIONS__'
    }
};

interface CapturedInvocation {
    readonly messages:
    readonly ChatMessage[];

    readonly role:
    'CODER' | 'REVIEWER';
}

const createCapturingClient = (
    responses:
        Readonly<
            Record<
                'CODER' | 'REVIEWER',
                string
            >
        >
): {
    readonly client:
    OpenAICompatibleClient;

    readonly invocations:
    CapturedInvocation[];
} => {
    const invocations:
        CapturedInvocation[] = [];

    const client = {
        completeChat: async (
            messages:
                readonly ChatMessage[],

            role:
                'CODER' | 'REVIEWER'
        ): Promise<string> => {
            invocations.push({
                messages,
                role
            });

            return responses[
                role
            ];
        }
    } as unknown as
        OpenAICompatibleClient;

    return {
        client,
        invocations
    };
};

const createRepository = async (
    prefix: string
): Promise<string> => {
    const repoRoot =
        await fs.mkdtemp(
            path.join(
                os.tmpdir(),
                prefix
            )
        );

    createdDirectories.push(
        repoRoot
    );

    await fs.mkdir(
        path.join(
            repoRoot,
            'src'
        ),
        {
            recursive:
                true
        }
    );

    return repoRoot;
};

const createTargetFile = async (
    repoRoot: string
): Promise<void> => {
    await fs.writeFile(
        path.join(
            repoRoot,
            TARGET_FILE
        ),
        'export const value = 1;\n',
        'utf8'
    );
};

const createBuildResult =
    (): OracleResult<'BUILD_SYNTAX'> => ({
        oracle:
            'BUILD_SYNTAX',

        status:
            'PASS',

        required:
            true,

        durationMs:
            5,

        summary:
            'Build/Syntax completato.',

        evidence: {
            command:
                'npm',

            args: [
                'run',
                'build'
            ],

            cwd:
                '.',

            timeoutMs:
                5_000,

            envAllowList:
                [],

            exitCode:
                0,

            timedOut:
                false,

            stdout:
                '',

            stderr:
                '',

            stdoutTruncated:
                false,

            stderrTruncated:
                false
        }
    });

const createTestReport =
    (): TestExecutionReport => ({
        oracleStatus:
            'FAIL',

        command:
            'pytest',

        args:
            [],

        cwd:
            '.',

        timeoutMs:
            5_000,

        envAllowList:
            [],

        oracleFilesExecuted: [
            'tests/test_target.py'
        ],

        implicitDiscoveryUsed:
            false,

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

        exitCode:
            1,

        suitePassed:
            false,

        timedOut:
            false,

        oracleFailed:
            false,

        totalTests:
            1,

        passedTests:
            0,

        failedTests:
            1,

        skippedTests:
            0,

        xfailedTests:
            0,

        xpassedTests:
            0,

        errorTests:
            0,

        passRate:
            0,

        durationMs:
            10,

        failureDetails: [
            {
                testName:
                    'test_target',

                assertionMessage:
                    'Expected 2, received 1.',

                stackTrace:
                    'AssertionError'
            }
        ],

        stdout:
            '1 failed in 0.01s',

        stderr:
            '',

        rawStdout:
            '1 failed in 0.01s',

        rawStderr:
            '',

        stdoutTruncated:
            false,

        stderrTruncated:
            false,

        executionDurationMs:
            10
    });

const createCumulativeRemediation =
    (): CumulativeRemediation => ({
        key:
            'src/target.ts||set the production value to 2',

        remediation: {
            file:
                TARGET_FILE,

            lineRange: {
                start:
                    1,

                end:
                    1
            },

            rootCause:
                'The production value is incorrect.',

            mandatoryCorrection:
                'Set the production value to 2.'
        },

        firstObservedIteration:
            1,

        lastObservedIteration:
            1,

        observationCount:
            1
    });

const createReviewerResponse = (
    file:
        string
): string => {
    return JSON.stringify({
        rootCauseSummary:
            'The production source does not satisfy the oracle.',

        targetRemediations: [
            {
                file,

                lineRange: {
                    start:
                        1,

                    end:
                        1
                },

                rootCause:
                    'The production value is incorrect.',

                mandatoryCorrection:
                    'Set the production value to 2.'
            }
        ]
    });
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
    'BE-P1-17 - Prompt profile provenance',
    () => {
        it(
            'espone un profilo predefinito versionato e completamente valorizzato',
            () => {
                expect(
                    DEFAULT_PROMPT_PROFILE.id
                ).toMatch(
                    /^prompt-profile-v\d+$/
                );

                const instructions:
                    readonly string[] = [
                        DEFAULT_PROMPT_PROFILE
                            .contextBuilder
                            .createModeDirective,

                        DEFAULT_PROMPT_PROFILE
                            .contextBuilder
                            .repairModeDirective,

                        DEFAULT_PROMPT_PROFILE
                            .contextBuilder
                            .diffInstructions,

                        DEFAULT_PROMPT_PROFILE
                            .contextBuilder
                            .createDiffInstructions,

                        DEFAULT_PROMPT_PROFILE
                            .contextBuilder
                            .refinementInstructions,

                        DEFAULT_PROMPT_PROFILE
                            .contextBuilder
                            .createRefinementDirective,

                        DEFAULT_PROMPT_PROFILE
                            .contextBuilder
                            .repairRefinementDirective,

                        DEFAULT_PROMPT_PROFILE
                            .contextBuilder
                            .technicalRetryInstructions,

                        DEFAULT_PROMPT_PROFILE
                            .contextBuilder
                            .newFileTargetMarker,

                        DEFAULT_PROMPT_PROFILE
                            .coder
                            .systemInstructions,

                        DEFAULT_PROMPT_PROFILE
                            .reviewer
                            .systemInstructions,

                        DEFAULT_PROMPT_PROFILE
                            .reviewer
                            .createModeDirective,

                        DEFAULT_PROMPT_PROFILE
                            .reviewer
                            .repairModeDirective,

                        DEFAULT_PROMPT_PROFILE
                            .reviewer
                            .responseInstructions
                    ];

                for (
                    const instruction of
                    instructions
                ) {
                    expect(
                        instruction.trim()
                    ).not.toBe(
                        ''
                    );
                }
            }
        );

        it(
            'ContextBuilder usa le istruzioni REPAIR del profilo iniettato',
            async () => {
                const repoRoot =
                    await createRepository(
                        'prompt-profile-repair-'
                    );

                await createTargetFile(
                    repoRoot
                );

                const builder =
                    new ContextBuilder(
                        repoRoot,
                        TEST_PROMPT_PROFILE
                    );

                const payload =
                    await builder
                        .buildInitialPayload({
                            issueSpec:
                                'Repair the target.',

                            targetFiles: [
                                TARGET_FILE
                            ],

                            testFiles:
                                [],

                            category:
                                'REPAIR'
                        });

                expect(
                    payload
                ).toContain(
                    '__CONTEXT_REPAIR_MODE__'
                );

                expect(
                    payload
                ).toContain(
                    '__CONTEXT_DIFF_INSTRUCTIONS__'
                );

                expect(
                    payload
                ).not.toContain(
                    '__CONTEXT_CREATE_MODE__'
                );

                expect(
                    payload
                ).not.toContain(
                    '__CONTEXT_CREATE_DIFF_INSTRUCTIONS__'
                );
            }
        );

        it(
            'ContextBuilder usa marker e istruzioni CREATE del profilo iniettato',
            async () => {
                const repoRoot =
                    await createRepository(
                        'prompt-profile-create-'
                    );

                const builder =
                    new ContextBuilder(
                        repoRoot,
                        TEST_PROMPT_PROFILE
                    );

                const payload =
                    await builder
                        .buildInitialPayload({
                            issueSpec:
                                'Create the target.',

                            targetFiles: [
                                'src/new-target.ts'
                            ],

                            testFiles:
                                [],

                            category:
                                'CREATE'
                        });

                expect(
                    payload
                ).toContain(
                    '__CONTEXT_CREATE_MODE__'
                );

                expect(
                    payload
                ).toContain(
                    '__CONTEXT_CREATE_DIFF_INSTRUCTIONS__'
                );

                expect(
                    payload
                ).toContain(
                    '__CONTEXT_NEW_FILE_TARGET_MARKER__'
                );

                expect(
                    payload
                ).not.toContain(
                    '__CONTEXT_REPAIR_MODE__'
                );
            }
        );

        it(
            'ContextBuilder usa refinement e technical retry del profilo',
            async () => {
                const repoRoot =
                    await createRepository(
                        'prompt-profile-refinement-'
                    );

                await createTargetFile(
                    repoRoot
                );

                const builder =
                    new ContextBuilder(
                        repoRoot,
                        TEST_PROMPT_PROFILE
                    );

                await builder
                    .buildInitialPayload({
                        issueSpec:
                            'Repair the target.',

                        targetFiles: [
                            TARGET_FILE
                        ],

                        testFiles:
                            [],

                        category:
                            'REPAIR'
                    });

                const refinementPayload =
                    builder
                        .buildRefinementPayload({
                            iteration:
                                2,

                            previousCandidatePatch:
                                [
                                    '--- a/src/target.ts',
                                    '+++ b/src/target.ts',
                                    '@@ -1 +1 @@',
                                    '-export const value = 1;',
                                    '+export const value = 2;'
                                ].join(
                                    '\n'
                                ),

                            currentFeedback: {
                                rootCauseSummary:
                                    'The value is incorrect.',

                                violationsPrunedCount:
                                    0,

                                targetRemediations: [
                                    {
                                        file:
                                            TARGET_FILE,

                                        lineRange: {
                                            start:
                                                1,

                                            end:
                                                1
                                        },

                                        rootCause:
                                            'The production value is incorrect.',

                                        mandatoryCorrection:
                                            'Set the production value to 2.'
                                    }
                                ],

                                securityPriorityStrict:
                                    true,

                                flappingDetected:
                                    false
                            },

                            cumulativeRemediations: [
                                createCumulativeRemediation()
                            ],

                            currentFailure:
                                'Expected 2, received 1.'
                        });

                expect(
                    refinementPayload
                ).toContain(
                    '__CONTEXT_REFINEMENT_INSTRUCTIONS__'
                );

                expect(
                    refinementPayload
                ).toContain(
                    '__CONTEXT_REPAIR_REFINEMENT_DIRECTIVE__'
                );

                expect(
                    refinementPayload
                ).toContain(
                    '__CONTEXT_DIFF_INSTRUCTIONS__'
                );

                expect(
                    refinementPayload
                ).not.toContain(
                    '__CONTEXT_CREATE_REFINEMENT_DIRECTIVE__'
                );

                const retryPayload =
                    builder
                        .buildTechnicalRetryPayload(
                            refinementPayload,
                            'rejected-diff',
                            'invalid hunk',
                            2
                        );

                expect(
                    retryPayload
                ).toContain(
                    '__CONTEXT_TECHNICAL_RETRY_INSTRUCTIONS__'
                );

                expect(
                    retryPayload
                ).toContain(
                    refinementPayload
                );
            }
        );

        it(
            'CoderAgent invia come system message le istruzioni del profilo',
            async () => {
                const {
                    client,
                    invocations
                } =
                    createCapturingClient({
                        CODER:
                            [
                                '```diff',
                                '--- a/src/target.ts',
                                '+++ b/src/target.ts',
                                '@@ -1 +1 @@',
                                '-export const value = 1;',
                                '+export const value = 2;',
                                '```'
                            ].join(
                                '\n'
                            ),

                        REVIEWER:
                            '{}'
                    });

                const coder =
                    new CoderAgent(
                        client,
                        TEST_PROMPT_PROFILE
                    );

                await coder.generatePatch(
                    '__USER_PAYLOAD__',
                    [
                        TARGET_FILE
                    ],
                    [],
                    'REPAIR'
                );

                expect(
                    invocations
                ).toHaveLength(
                    1
                );

                expect(
                    invocations[0]
                ).toEqual({
                    role:
                        'CODER',

                    messages: [
                        {
                            role:
                                'system',

                            content:
                                '__CODER_SYSTEM_INSTRUCTIONS__'
                        },
                        {
                            role:
                                'user',

                            content:
                                '__USER_PAYLOAD__'
                        }
                    ]
                });
            }
        );

        it(
            'ReviewerAgent invia system, modalità REPAIR e response instructions del profilo',
            async () => {
                const {
                    client,
                    invocations
                } =
                    createCapturingClient({
                        CODER:
                            '',

                        REVIEWER:
                            createReviewerResponse(
                                TARGET_FILE
                            )
                    });

                const reviewer =
                    new ReviewerAgent(
                        client,
                        TEST_PROMPT_PROFILE
                    );

                const result =
                    await reviewer.review({
                        buildSyntax:
                            createBuildResult(),

                        sastFindings:
                            [],

                        testReport:
                            createTestReport(),

                        flappingDetected:
                            false,

                        targetFiles: [
                            TARGET_FILE
                        ],

                        testFiles: [
                            'tests/test_target.py'
                        ],

                        category:
                            'REPAIR'
                    });

                expect(
                    result.reviewerMode
                ).toBe(
                    'LLM'
                );

                expect(
                    invocations
                ).toHaveLength(
                    1
                );

                expect(
                    invocations[0]?.role
                ).toBe(
                    'REVIEWER'
                );

                expect(
                    invocations[0]
                        ?.messages[0]
                ).toEqual({
                    role:
                        'system',

                    content:
                        '__REVIEWER_SYSTEM_INSTRUCTIONS__'
                });

                const userMessage =
                    invocations[0]
                        ?.messages[1]
                        ?.content;

                expect(
                    userMessage
                ).toContain(
                    '__REVIEWER_REPAIR_MODE_DIRECTIVE__'
                );

                expect(
                    userMessage
                ).toContain(
                    '__REVIEWER_RESPONSE_INSTRUCTIONS__'
                );

                expect(
                    userMessage
                ).not.toContain(
                    '__REVIEWER_CREATE_MODE_DIRECTIVE__'
                );

                expect(
                    userMessage
                ).toContain(
                    '"category": "REPAIR"'
                );
            }
        );

        it(
            'ReviewerAgent seleziona la direttiva CREATE dello stesso profilo',
            async () => {
                const generatedFile =
                    'src/generated.ts';

                const {
                    client,
                    invocations
                } =
                    createCapturingClient({
                        CODER:
                            '',

                        REVIEWER:
                            createReviewerResponse(
                                generatedFile
                            )
                    });

                const reviewer =
                    new ReviewerAgent(
                        client,
                        TEST_PROMPT_PROFILE
                    );

                const result =
                    await reviewer.review({
                        buildSyntax:
                            createBuildResult(),

                        sastFindings:
                            [],

                        testReport:
                            createTestReport(),

                        flappingDetected:
                            false,

                        targetFiles: [
                            generatedFile
                        ],

                        testFiles: [
                            'tests/test_generated.py'
                        ],

                        category:
                            'CREATE'
                    });

                expect(
                    result.reviewerMode
                ).toBe(
                    'LLM'
                );

                const userMessage =
                    invocations[0]
                        ?.messages[1]
                        ?.content;

                expect(
                    userMessage
                ).toContain(
                    '__REVIEWER_CREATE_MODE_DIRECTIVE__'
                );

                expect(
                    userMessage
                ).toContain(
                    '__REVIEWER_RESPONSE_INSTRUCTIONS__'
                );

                expect(
                    userMessage
                ).not.toContain(
                    '__REVIEWER_REPAIR_MODE_DIRECTIVE__'
                );

                expect(
                    userMessage
                ).toContain(
                    '"category": "CREATE"'
                );
            }
        );

        it(
            'deriva la provenance dalla stessa istanza che contiene le istruzioni',
            () => {
                const promptProfile =
                    TEST_PROMPT_PROFILE;

                const experimentProfileFragment = {
                    promptProfileId:
                        promptProfile.id
                };

                expect(
                    experimentProfileFragment
                        .promptProfileId
                ).toBe(
                    TEST_PROFILE_ID
                );

                expect(
                    promptProfile
                        .coder
                        .systemInstructions
                ).toBe(
                    '__CODER_SYSTEM_INSTRUCTIONS__'
                );

                expect(
                    promptProfile
                        .reviewer
                        .systemInstructions
                ).toBe(
                    '__REVIEWER_SYSTEM_INSTRUCTIONS__'
                );

                expect(
                    promptProfile
                        .reviewer
                        .responseInstructions
                ).toBe(
                    '__REVIEWER_RESPONSE_INSTRUCTIONS__'
                );

                expect(
                    promptProfile
                        .contextBuilder
                        .refinementInstructions
                ).toBe(
                    '__CONTEXT_REFINEMENT_INSTRUCTIONS__'
                );
            }
        );
    }
);
