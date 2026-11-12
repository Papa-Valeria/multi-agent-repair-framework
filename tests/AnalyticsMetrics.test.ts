import {
  describe,
  expect,
  it
} from '@jest/globals';

import type {
  ExperimentMetadata,
  ModeAggregateMetrics,
  RunQualityMetrics
} from '../src/types/analytics.js';

describe(
  'Research analytics metric quarantine',
  () => {
    it(
      'conserva la CPU di orchestrazione solo come diagnostica nei metadata',
      () => {
        const metadata:
          ExperimentMetadata = {
          runId:
            'run-1',
          taskId:
            'task-1',
          category:
            'REPAIR',
          mode:
            'MULTI_AGENT',
          apiBaseUrl:
            'http://localhost:1234',
          modelName:
            'test-model',
          seed:
            42,
          temperature:
            0,
          topP:
            1,
          timestamp:
            '2026-10-26T08:00:00.000Z',
          status:
            'CONVERGED',
          totalIterations:
            2,
          totalTokens:
            150,
          totalDurationMs:
            10_000,
          inferenceDurationMs:
            6_000,
          oracleDurationMs:
            2_000,
          orchestrationOverheadMs:
            100,
          orchestrationOverheadBasis:
            'NODE_PROCESS_CPU',
          isHumanAugmented:
            false,
          resolutionVerified:
            true
        };

        expect(
          metadata.orchestrationOverheadMs
        ).toBe(100);

        expect(
          metadata.orchestrationOverheadBasis
        ).toBe(
          'NODE_PROCESS_CPU'
        );

        expect(
          'frameworkDurationMs' in metadata
        ).toBe(false);

        expect(
          'endToEndOverheadPct' in metadata
        ).toBe(false);

        expect(
          'activeFrameworkOverheadPct' in metadata
        ).toBe(false);
      }
    );

    it(
      'non espone percentuali di overhead nelle metriche scientifiche del run',
      () => {
        const metrics:
          RunQualityMetrics = {
          resolutionVerified:
            true,
          testPassRatePct:
            100,
          testCounts: {
            total: 2,
            passed: 2,
            failed: 0,
            skipped: 0,
            xfailed: 0,
            xpassed: 0,
            errors: 0
          },
          totalTests:
            2,
          passedTests:
            2,
          failedTests:
            0,
          skippedTests:
            0,
          xfailedTests:
            0,
          xpassedTests:
            0,
          errorTests:
            0,
          residualSastCount:
            0,
          sastErrors:
            0,
          sastWarnings:
            0,
          allPatchesApplicable:
            true,
          fuzzyFallbackUsed:
            false,
          patchGrounding: {
            hunks: 1,
            ungroundedHunks: 0,
            oldSideLines: 1,
            ungroundedLines: 0
          },
          hallucinationRatePct:
            0,
          ungroundedHunkRatePct:
            0,
          patchFlappingDetected:
            false,
          addedLines:
            1,
          deletedLines:
            1,
          promptTokens:
            100,
          completionTokens:
            50,
          coderPromptTokens:
            75,
          coderCompletionTokens:
            40,
          reviewerPromptTokens:
            25,
          reviewerCompletionTokens:
            10,
          totalTokens:
            150,
          inferenceDurationMs:
            6_000,
          oracleDurationMs:
            2_000
        };

        expect(
          'endToEndOverheadPct' in metrics
        ).toBe(false);

        expect(
          'activeFrameworkOverheadPct' in metrics
        ).toBe(false);

        expect(
          'frameworkDurationMs' in metrics
        ).toBe(false);

        expect(
          'orchestrationOverheadMs' in metrics
        ).toBe(false);
      }
    );

    it(
      'non aggrega percentuali di overhead nei risultati per modalità',
      () => {
        const metrics:
          ModeAggregateMetrics = {
          runCount:
            2,
          resolvedCount:
            1,
          successRatePct:
            50,
          averageSuccessfulTokens:
            150,
          averageInferenceDurationMs:
            6_000,
          averageOracleDurationMs:
            2_000,
          averageResidualSastFindings:
            0,
          averageAddedLines:
            1,
          averageDeletedLines:
            1,
          hallucinationRatePct:
            0,
          ungroundedHunkRatePct:
            0,
          convergenceDistribution: {
            '1': 1,
            '2': 1,
            '3': 0,
            N_MAX: 0
          }
        };

        expect(
          'averageEndToEndOverheadPct' in metrics
        ).toBe(false);

        expect(
          'averageActiveFrameworkOverheadPct' in metrics
        ).toBe(false);

        expect(
          'frameworkDurationMs' in metrics
        ).toBe(false);
      }
    );
  }
);
