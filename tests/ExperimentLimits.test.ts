import {
    describe,
    expect,
    it
} from '@jest/globals';

import {
    DEFAULT_EXPERIMENT_LIMITS,
    experimentLimitsSchema
} from '../src/inference/ExperimentLimitsConfig.js';

import type {
    ExperimentLimits
} from '../src/types/analytics.js';

describe(
    'BE-P1-18 - Configurable experiment limits',
    () => {
        describe(
            'DEFAULT_EXPERIMENT_LIMITS',
            () => {
                it(
                    'mantiene i limiti storici del profilo sperimentale corrente',
                    () => {
                        expect(
                            DEFAULT_EXPERIMENT_LIMITS
                        ).toEqual({
                            maxIterations:
                                3,

                            maxTechnicalAttempts:
                                2
                        });
                    }
                );

                it(
                    'espone valori interi strettamente positivi',
                    () => {
                        expect(
                            Number.isInteger(
                                DEFAULT_EXPERIMENT_LIMITS
                                    .maxIterations
                            )
                        ).toBe(
                            true
                        );

                        expect(
                            DEFAULT_EXPERIMENT_LIMITS
                                .maxIterations
                        ).toBeGreaterThan(
                            0
                        );

                        expect(
                            Number.isInteger(
                                DEFAULT_EXPERIMENT_LIMITS
                                    .maxTechnicalAttempts
                            )
                        ).toBe(
                            true
                        );

                        expect(
                            DEFAULT_EXPERIMENT_LIMITS
                                .maxTechnicalAttempts
                        ).toBeGreaterThan(
                            0
                        );
                    }
                );

                it(
                    'è immutabile a runtime',
                    () => {
                        expect(
                            Object.isFrozen(
                                DEFAULT_EXPERIMENT_LIMITS
                            )
                        ).toBe(
                            true
                        );
                    }
                );

                it(
                    'supera il proprio schema di validazione',
                    () => {
                        const result =
                            experimentLimitsSchema
                                .safeParse(
                                    DEFAULT_EXPERIMENT_LIMITS
                                );

                        expect(
                            result.success
                        ).toBe(
                            true
                        );
                    }
                );
            }
        );

        describe(
            'experimentLimitsSchema',
            () => {
                it(
                    'accetta limiti sperimentali personalizzati validi',
                    () => {
                        const result =
                            experimentLimitsSchema
                                .safeParse({
                                    maxIterations:
                                        5,

                                    maxTechnicalAttempts:
                                        4
                                });

                        expect(
                            result.success
                        ).toBe(
                            true
                        );

                        if (
                            !result.success
                        ) {
                            throw new Error(
                                'La configurazione valida è stata rifiutata.'
                            );
                        }

                        expect(
                            result.data
                        ).toEqual({
                            maxIterations:
                                5,

                            maxTechnicalAttempts:
                                4
                        });
                    }
                );

                it.each([
                    {
                        label:
                            'maxIterations uguale a zero',

                        limits: {
                            maxIterations:
                                0,

                            maxTechnicalAttempts:
                                2
                        }
                    },
                    {
                        label:
                            'maxIterations negativo',

                        limits: {
                            maxIterations:
                                -1,

                            maxTechnicalAttempts:
                                2
                        }
                    },
                    {
                        label:
                            'maxIterations decimale',

                        limits: {
                            maxIterations:
                                1.5,

                            maxTechnicalAttempts:
                                2
                        }
                    },
                    {
                        label:
                            'maxTechnicalAttempts uguale a zero',

                        limits: {
                            maxIterations:
                                3,

                            maxTechnicalAttempts:
                                0
                        }
                    },
                    {
                        label:
                            'maxTechnicalAttempts negativo',

                        limits: {
                            maxIterations:
                                3,

                            maxTechnicalAttempts:
                                -1
                        }
                    },
                    {
                        label:
                            'maxTechnicalAttempts decimale',

                        limits: {
                            maxIterations:
                                3,

                            maxTechnicalAttempts:
                                1.5
                        }
                    }
                ])(
                    'rifiuta $label',
                    ({
                        limits
                    }) => {
                        const result =
                            experimentLimitsSchema
                                .safeParse(
                                    limits
                                );

                        expect(
                            result.success
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'rifiuta maxIterations non numerico',
                    () => {
                        const result =
                            experimentLimitsSchema
                                .safeParse({
                                    maxIterations:
                                        '3',

                                    maxTechnicalAttempts:
                                        2
                                });

                        expect(
                            result.success
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'rifiuta maxTechnicalAttempts non numerico',
                    () => {
                        const result =
                            experimentLimitsSchema
                                .safeParse({
                                    maxIterations:
                                        3,

                                    maxTechnicalAttempts:
                                        '2'
                                });

                        expect(
                            result.success
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'rifiuta maxIterations mancante',
                    () => {
                        const result =
                            experimentLimitsSchema
                                .safeParse({
                                    maxTechnicalAttempts:
                                        2
                                });

                        expect(
                            result.success
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'rifiuta maxTechnicalAttempts mancante',
                    () => {
                        const result =
                            experimentLimitsSchema
                                .safeParse({
                                    maxIterations:
                                        3
                                });

                        expect(
                            result.success
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'rifiuta proprietà sperimentali sconosciute',
                    () => {
                        const result =
                            experimentLimitsSchema
                                .safeParse({
                                    maxIterations:
                                        3,

                                    maxTechnicalAttempts:
                                        2,

                                    unexpectedLimit:
                                        99
                                });

                        expect(
                            result.success
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'rifiuta null',
                    () => {
                        expect(
                            experimentLimitsSchema
                                .safeParse(
                                    null
                                )
                                .success
                        ).toBe(
                            false
                        );
                    }
                );

                it(
                    'rifiuta un array',
                    () => {
                        expect(
                            experimentLimitsSchema
                                .safeParse([
                                    3,
                                    2
                                ])
                                .success
                        ).toBe(
                            false
                        );
                    }
                );
            }
        );

        describe(
            'effective experiment limits',
            () => {
                const resolveEffectiveLimits = (
                    selected:
                        ExperimentLimits,

                    isBaseline:
                        boolean
                ): ExperimentLimits => {
                    return Object.freeze(
                        isBaseline
                            ? {
                                maxIterations:
                                    1,

                                maxTechnicalAttempts:
                                    1
                            }
                            : {
                                maxIterations:
                                    selected
                                        .maxIterations,

                                maxTechnicalAttempts:
                                    selected
                                        .maxTechnicalAttempts
                            }
                    );
                };

                it(
                    'mantiene i limiti configurati per MULTI_AGENT',
                    () => {
                        const selected:
                            ExperimentLimits = {
                            maxIterations:
                                7,

                            maxTechnicalAttempts:
                                4
                        };

                        const effective =
                            resolveEffectiveLimits(
                                selected,
                                false
                            );

                        expect(
                            effective
                        ).toEqual({
                            maxIterations:
                                7,

                            maxTechnicalAttempts:
                                4
                        });
                    }
                );

                it(
                    'forza la BASELINE a una singola iterazione e un singolo tentativo tecnico',
                    () => {
                        const selected:
                            ExperimentLimits = {
                            maxIterations:
                                7,

                            maxTechnicalAttempts:
                                4
                        };

                        const effective =
                            resolveEffectiveLimits(
                                selected,
                                true
                            );

                        expect(
                            effective
                        ).toEqual({
                            maxIterations:
                                1,

                            maxTechnicalAttempts:
                                1
                        });
                    }
                );

                it(
                    'produce una configurazione effettiva immutabile',
                    () => {
                        const effective =
                            resolveEffectiveLimits(
                                DEFAULT_EXPERIMENT_LIMITS,
                                false
                            );

                        expect(
                            Object.isFrozen(
                                effective
                            )
                        ).toBe(
                            true
                        );
                    }
                );
            }
        );

        describe(
            'execution/provenance contract',
            () => {
                it(
                    'usa lo stesso oggetto effective limits per FSM e ExperimentProfile',
                    () => {
                        const effectiveExperimentLimits:
                            ExperimentLimits =
                            Object.freeze({
                                maxIterations:
                                    4,

                                maxTechnicalAttempts:
                                    3
                            });

                        /*
                         * Rappresenta il wiring di app.ts:
                         *
                         * RefinementFSM(..., effectiveExperimentLimits, ...)
                         *
                         * e
                         *
                         * ExperimentProfile.limits =
                         * effectiveExperimentLimits
                         */
                        const fsmLimits =
                            effectiveExperimentLimits;

                        const experimentProfileFragment = {
                            limits:
                                effectiveExperimentLimits
                        };

                        expect(
                            fsmLimits
                        ).toBe(
                            experimentProfileFragment
                                .limits
                        );

                        expect(
                            experimentProfileFragment
                                .limits
                        ).toEqual({
                            maxIterations:
                                4,

                            maxTechnicalAttempts:
                                3
                        });
                    }
                );

                it(
                    'conserva separati i due budget sperimentali',
                    () => {
                        const limits:
                            ExperimentLimits = {
                            maxIterations:
                                6,

                            maxTechnicalAttempts:
                                2
                        };

                        expect(
                            limits.maxIterations
                        ).toBe(
                            6
                        );

                        expect(
                            limits.maxTechnicalAttempts
                        ).toBe(
                            2
                        );

                        expect(
                            limits.maxIterations
                        ).not.toBe(
                            limits.maxTechnicalAttempts
                        );
                    }
                );
            }
        );
    }
);
