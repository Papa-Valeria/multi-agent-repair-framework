import { z } from 'zod';

const environmentNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(200)
    .transform(
        (name) =>
            name.toUpperCase()
    );

export const buildOracleConfigSchema = z.object({
    command: z
        .string()
        .trim()
        .min(1)
        .max(500),

    args: z
        .array(
            z.string().max(1_000)
        )
        .max(100)
        .default([]),

    cwd: z
        .string()
        .trim()
        .min(1)
        .max(1_000)
        .optional(),

    timeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(300_000),

    envAllowList: z
        .array(
            environmentNameSchema
        )
        .max(100)
        .default([])
}).strict().superRefine((config, context) => {
    if (
        new Set(
            config.envAllowList
        ).size !==
        config.envAllowList.length
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['envAllowList'],
            message:
                'envAllowList contiene nomi di variabili duplicati.'
        });
    }
});

type ParsedBuildOracleConfig =
    z.infer<typeof buildOracleConfigSchema>;

export type BuildOracleConfig = Readonly<
    Omit<
        ParsedBuildOracleConfig,
        'args' | 'envAllowList'
    > & {
        readonly args: readonly string[];
        readonly envAllowList: readonly string[];
    }
>;

const exitCodeSchema = z
    .number()
    .int()
    .min(0)
    .max(255);

export const expectedExitPolicySchema = z.object({
    passExitCodes: z
        .array(exitCodeSchema)
        .min(1)
        .max(32),

    failExitCodes: z
        .array(exitCodeSchema)
        .min(1)
        .max(32),

    executionErrorExitCodes: z
        .array(exitCodeSchema)
        .max(32)
        .default([])
}).strict().superRefine((policy, context) => {
    const categories = [
        {
            name: 'passExitCodes',
            values: policy.passExitCodes
        },
        {
            name: 'failExitCodes',
            values: policy.failExitCodes
        },
        {
            name: 'executionErrorExitCodes',
            values: policy.executionErrorExitCodes
        }
    ] as const;

    for (const category of categories) {
        if (
            new Set(category.values).size !==
            category.values.length
        ) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: [category.name],
                message:
                    `La categoria ${category.name} contiene ` +
                    `exit code duplicati.`
            });
        }
    }

    const exitCodeCategories = new Map<
        number,
        string[]
    >();

    for (const category of categories) {
        for (const exitCode of category.values) {
            const existingCategories =
                exitCodeCategories.get(exitCode) ?? [];

            existingCategories.push(category.name);

            exitCodeCategories.set(
                exitCode,
                existingCategories
            );
        }
    }

    for (
        const [exitCode, categoryNames]
        of exitCodeCategories
    ) {
        if (categoryNames.length > 1) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message:
                    `L'exit code ${exitCode} compare in più ` +
                    `categorie: ${categoryNames.join(', ')}.`
            });
        }
    }
});

export const functionalTestOracleConfigSchema = z.object({
    command: z
        .string()
        .trim()
        .min(1)
        .max(500),

    args: z
        .array(
            z.string().max(1_000)
        )
        .max(100)
        .default([]),

    cwd: z
        .string()
        .trim()
        .min(1)
        .max(1_000),

    timeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(300_000),

    oracleFiles: z
        .array(
            z
                .string()
                .trim()
                .min(1)
                .max(1_000)
        )
        .max(100)
        .default([]),

    envAllowList: z
        .array(
            environmentNameSchema
        )
        .max(100)
        .default([]),

    expectedExitPolicy:
        expectedExitPolicySchema,

    allowImplicitDiscovery: z
        .boolean()
        .default(false)
}).strict().superRefine((config, context) => {
    if (
        config.oracleFiles.length === 0 &&
        !config.allowImplicitDiscovery
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['oracleFiles'],
            message:
                'Almeno un oracleFile deve essere dichiarato ' +
                'quando allowImplicitDiscovery è false.'
        });
    }

    const normalizedOracleFiles =
        config.oracleFiles.map((file) =>
            file
                .trim()
                .replaceAll('\\', '/')
                .replace(/^\.\//, '')
                .toLowerCase()
        );

    if (
        new Set(normalizedOracleFiles).size !==
        normalizedOracleFiles.length
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['oracleFiles'],
            message:
                'oracleFiles contiene percorsi duplicati.'
        });
    }

    if (
        new Set(
            config.envAllowList
        ).size !==
        config.envAllowList.length
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['envAllowList'],
            message:
                'envAllowList contiene nomi di variabili duplicati.'
        });
    }
});
