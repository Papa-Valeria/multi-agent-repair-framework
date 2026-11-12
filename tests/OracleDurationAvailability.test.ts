import {
    describe,
    expect,
    it
} from '@jest/globals';

import {
    TelemetryTracker
} from '../src/telemetry/TelemetryTracker.js';

describe(
    'BE-P1-34 - Oracle duration availability',
    () => {
        it(
            'rappresenta una Oracle duration non ancora osservata come null e non disponibile',
            () => {
                const tracker =
                    new TelemetryTracker();

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBeNull();

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    false
                );
            }
        );

        it(
            'non usa zero come sentinella quando nessuna Oracle duration è stata osservata',
            () => {
                const tracker =
                    new TelemetryTracker();

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).not.toBe(
                    0
                );

                expect(
                    snapshot.oracleDurationMs
                ).toBeNull();

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    false
                );
            }
        );

        it(
            'considera zero una durata valida quando viene realmente registrata',
            () => {
                const tracker =
                    new TelemetryTracker();

                tracker.recordOracleDuration(
                    0
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBe(
                    0
                );

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    true
                );
            }
        );

        it(
            'rende disponibile una Oracle duration positiva registrata',
            () => {
                const tracker =
                    new TelemetryTracker();

                tracker.recordOracleDuration(
                    12.5
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBe(
                    12.5
                );

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    true
                );
            }
        );

        it(
            'accumula più Oracle duration osservate mantenendo disponibile la misura',
            () => {
                const tracker =
                    new TelemetryTracker();

                tracker.recordOracleDuration(
                    12.5
                );

                tracker.recordOracleDuration(
                    7.5
                );

                tracker.recordOracleDuration(
                    5
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBe(
                    25
                );

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    true
                );
            }
        );

        it(
            'mantiene zero disponibile anche dopo più registrazioni zero',
            () => {
                const tracker =
                    new TelemetryTracker();

                tracker.recordOracleDuration(
                    0
                );

                tracker.recordOracleDuration(
                    0
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBe(
                    0
                );

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    true
                );
            }
        );

        it(
            'non rende disponibile la Oracle duration registrando soltanto usage LLM',
            () => {
                const tracker =
                    new TelemetryTracker();

                tracker.recordLLMUsage(
                    'CODER',
                    100,
                    20,
                    150
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBeNull();

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    false
                );

                expect(
                    snapshot.inferenceDurationMs
                ).toBe(
                    150
                );
            }
        );

        it(
            'mantiene indipendenti inference duration e Oracle duration',
            () => {
                const tracker =
                    new TelemetryTracker();

                tracker.recordLLMUsage(
                    'CODER',
                    100,
                    20,
                    120
                );

                tracker.recordLLMUsage(
                    'REVIEWER',
                    50,
                    10,
                    30
                );

                tracker.recordOracleDuration(
                    25
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.inferenceDurationMs
                ).toBe(
                    150
                );

                expect(
                    snapshot.oracleDurationMs
                ).toBe(
                    25
                );

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    true
                );
            }
        );

        it(
            'rifiuta una Oracle duration negativa senza alterare lo stato',
            () => {
                const tracker =
                    new TelemetryTracker();

                expect(
                    () =>
                        tracker.recordOracleDuration(
                            -1
                        )
                ).toThrow(
                    'oracleDurationMs deve essere finito e non negativo.'
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBeNull();

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    false
                );
            }
        );

        it(
            'rifiuta NaN senza rendere disponibile la Oracle duration',
            () => {
                const tracker =
                    new TelemetryTracker();

                expect(
                    () =>
                        tracker.recordOracleDuration(
                            Number.NaN
                        )
                ).toThrow(
                    'oracleDurationMs deve essere finito e non negativo.'
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBeNull();

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    false
                );
            }
        );

        it(
            'rifiuta Infinity senza rendere disponibile la Oracle duration',
            () => {
                const tracker =
                    new TelemetryTracker();

                expect(
                    () =>
                        tracker.recordOracleDuration(
                            Number.POSITIVE_INFINITY
                        )
                ).toThrow(
                    'oracleDurationMs deve essere finito e non negativo.'
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBeNull();

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    false
                );
            }
        );

        it(
            'preserva una misura valida precedente quando una registrazione successiva è invalida',
            () => {
                const tracker =
                    new TelemetryTracker();

                tracker.recordOracleDuration(
                    25
                );

                expect(
                    () =>
                        tracker.recordOracleDuration(
                            -10
                        )
                ).toThrow(
                    'oracleDurationMs deve essere finito e non negativo.'
                );

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBe(
                    25
                );

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    true
                );
            }
        );

        it(
            'mantiene la Oracle duration assente dopo startRun se nessuna misura viene registrata',
            () => {
                const tracker =
                    new TelemetryTracker();

                tracker.startRun();

                const snapshot =
                    tracker.getSnapshot();

                expect(
                    snapshot.oracleDurationMs
                ).toBeNull();

                expect(
                    snapshot.oracleDurationAvailable
                ).toBe(
                    false
                );

                expect(
                    snapshot.totalDurationMs
                ).toBeGreaterThanOrEqual(
                    0
                );
            }
        );
    }
);
