import {
    z
} from 'zod';

import type {
    ExperimentLimits
} from '../types/analytics.js';

export const DEFAULT_EXPERIMENT_LIMITS:
    ExperimentLimits =
    Object.freeze({
        maxIterations: 3,
        maxTechnicalAttempts: 2
    });

export const experimentLimitsSchema =
    z.object({
        maxIterations:
            z.number()
                .int()
                .min(1),

        maxTechnicalAttempts:
            z.number()
                .int()
                .min(1)
    })
        .strict();

export type ExperimentLimitsConfig =
    z.infer<
        typeof experimentLimitsSchema
    >;
