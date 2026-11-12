import cors from "@fastify/cors";
import Fastify from "fastify";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CoderAgent } from "../agents/CoderAgent.js";
import { ReviewerAgent } from "../agents/ReviewerAgent.js";
import { createFixtureIdentity } from "../experiments/FixtureIdentity.js";
import { GitManager, type PatchScope } from "../git/GitManager.js";
import {
  buildOracleConfigSchema,
  functionalTestOracleConfigSchema,
  type BuildOracleConfig,
} from "../inference/BuildOracleConfig.js";
import {
  DEFAULT_EXPERIMENT_LIMITS,
  experimentLimitsSchema,
} from "../inference/ExperimentLimitsConfig.js";
import {
  DEFAULT_MODEL_SESSION_CONFIG,
  modelSessionConfigSchema,
} from "../inference/ModelSessionConfig.js";
import { OpenAICompatibleClient } from "../inference/OpenAICompatibleClient.js";
import { DEFAULT_PROMPT_PROFILE } from '../inference/PromptProfile.js';
import {
  ContextBuilder,
  type InitialContextParams,
} from "../orchestration/ContextBuilder.js";
import { RefinementFSM } from "../orchestration/RefinementFSM.js";
import {
  describeTerminalState,
  resolveTerminalState,
} from "../orchestration/TerminalStatePolicy.js";
import { resolveRepositoryPath } from "../security/RepositoryPathPolicy.js";
import { TelemetryStorage } from "../telemetry/TelemetryStorage.js";
import { TelemetryTracker } from "../telemetry/TelemetryTracker.js";
import type {
  ExperimentCategory,
  ExperimentLimits,
  ExperimentMode,
  ExperimentModelConfig,
  ExperimentProfileV3,
  ExperimentSemgrepConfig,
  RunHistoryFilters,
} from "../types/analytics.js";
import type {
  ExecutionFailure,
  FunctionalTestOracleConfig,
  OracleResult,
  WorkbenchSessionState,
  WorkbenchStreamEvent,
} from "../types/domain.js";
import { BuildSyntaxOracle } from "../verification/BuildSyntaxOracle.js";
import {
  decideOracleResults,
  DEFAULT_ORACLE_PROFILE,
} from "../verification/OracleDecision.js";
import { SemgrepEngine } from "../verification/SemgrepEngine.js";
import {
  DEFAULT_SEMGREP_PROFILE,
} from "../verification/SemgrepProfile.js";
import { TestHarness } from "../verification/TestHarness.js";
import {
  assertApplicabilityResultInvariants,
  assertBuildSyntaxResultInvariants,
  assertFunctionalTestResultInvariants,
  assertSemgrepResultInvariants
} from "../verification/VerificationInvariants.js";

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});

const sessions = new Map<string, WorkbenchSessionState>();
const sessionRepoPaths = new Map<string, string>();
const sessionBuildOracleConfigs = new Map<string, BuildOracleConfig>();
const sessionFunctionalTestOracleConfigs = new Map<
  string,
  FunctionalTestOracleConfig
>();
const sseListeners = new Map<string, (event: WorkbenchStreamEvent) => void>();
const finalizationInProgress = new Set<string>();
const telemetryStorage = new TelemetryStorage();
const semgrepProfile = DEFAULT_SEMGREP_PROFILE;
let experimentExecutionActive = false;

const readFixtureSources = async (
  repositoryRoot: string,
  files: readonly string[],
  allowMissing: boolean,
): Promise<Readonly<Record<string, string>>> => {
  const entries = await Promise.all(
    [...files]
      .sort((left, right) => left.localeCompare(right))
      .map(async (file) => {
        const resolved = await resolveRepositoryPath({
          repositoryRoot,
          relativePath: file,
          allowMissing,
        });

        try {
          const content = await fs.readFile(resolved.absolutePath, "utf8");

          return [
            resolved.relativePath,
            content.replace(/\r\n/g, "\n"),
          ] as const;
        } catch (error: unknown) {
          const fileError = error as NodeJS.ErrnoException;

          if (allowMissing && fileError.code === "ENOENT") {
            return [resolved.relativePath, ""] as const;
          }

          throw error;
        }
      }),
  );

  return Object.freeze(Object.fromEntries(entries));
};

class FinalizationGateError extends Error {
  constructor(
    message: string,
    readonly statusCode: 409 | 422 | 503,
  ) {
    super(message);
    this.name = "FinalizationGateError";
  }
}

fastify.get("/api/tasks/:id/stream", (req, reply) => {
  const { id } = req.params as { id: string };
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("Access-Control-Allow-Origin", "*");
  reply.raw.flushHeaders();

  const listener = (event: WorkbenchStreamEvent) => {
    reply.raw.write(
      `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
    );
  };

  sseListeners.set(id, listener);

  req.raw.on("close", () => {
    sseListeners.delete(id);
  });
});

fastify.post("/api/tasks/init", async (req, reply) => {
  const body = req.body as {
    taskId: string;
    repoPath: string;
    issueSpec: string;
    targetFileName: string;
    targetFileContent: string;
    testFileName: string;
    testFileContent: string;
  };

  const normalizedRepoPath = path.resolve(body.repoPath);

  try {
    const target = await resolveRepositoryPath({
      repositoryRoot: normalizedRepoPath,

      relativePath: body.targetFileName,

      allowMissing: true,
    });

    const test = await resolveRepositoryPath({
      repositoryRoot: normalizedRepoPath,

      relativePath: body.testFileName,

      allowMissing: true,
    });

    const git = new GitManager(normalizedRepoPath);

    await git.hardReset();
    await fs.mkdir(path.dirname(target.absolutePath), {
      recursive: true,
    });

    await fs.mkdir(path.dirname(test.absolutePath), {
      recursive: true,
    });

    /*
     * Rieseguiamo il real containment dopo
     * la creazione delle directory e subito
     * prima della scrittura.
     */
    const writableTarget = await resolveRepositoryPath({
      repositoryRoot: normalizedRepoPath,

      relativePath: target.relativePath,

      allowMissing: true,
    });

    const writableTest = await resolveRepositoryPath({
      repositoryRoot: normalizedRepoPath,

      relativePath: test.relativePath,

      allowMissing: true,
    });

    await fs.writeFile(
      writableTarget.absolutePath,
      body.targetFileContent,
      "utf8",
    );

    await fs.writeFile(writableTest.absolutePath, body.testFileContent, "utf8");

    await git.commitChanges(`bench: initialize task ${body.taskId}`);

    return reply.send({
      success: true,

      taskId: body.taskId,
    });
  } catch (error: unknown) {
    return reply.status(400).send({
      error:
        error instanceof Error
          ? error.message
          : "Path di inizializzazione non valido.",
    });
  }
});

fastify.post("/api/tasks/:id/execute", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as {
    repoPath: string;
    issueSpec: string;
    targetFiles: string[];
    testFiles: string[];
    category: ExperimentCategory;
    modelConfig?: unknown;
    buildOracleConfig?: unknown;
    functionalTestOracleConfig?: unknown;
    experimentLimits?: unknown;
    executionMode?: "BASELINE" | "MULTI_AGENT";
    isBaseline?: boolean;
  };
  const normalizedRepoPath = path.resolve(body.repoPath);
  if (
    body.executionMode !== undefined &&
    body.executionMode !== "BASELINE" &&
    body.executionMode !== "MULTI_AGENT"
  ) {
    return reply
      .status(400)
      .send({ error: "executionMode deve essere BASELINE o MULTI_AGENT." });
  }

  const isBaseline =
    body.executionMode !== undefined
      ? body.executionMode === "BASELINE"
      : body.isBaseline === true;

  if (body.category !== "REPAIR" && body.category !== "CREATE") {
    return reply
      .status(400)
      .send({
        error: "category è obbligatoria e deve essere REPAIR o CREATE.",
      });
  }
  const modelConfigResult = modelSessionConfigSchema.safeParse(
    body.modelConfig ?? DEFAULT_MODEL_SESSION_CONFIG,
  );
  if (!modelConfigResult.success) {
    return reply
      .status(400)
      .send({
        error: "Configurazione modello non valida.",
        details: modelConfigResult.error.flatten(),
      });
  }
  const buildOracleConfigResult = buildOracleConfigSchema.safeParse(
    body.buildOracleConfig,
  );
  if (!buildOracleConfigResult.success) {
    return reply
      .status(400)
      .send({
        error: "Configurazione Build/Syntax Oracle non valida.",
        details: buildOracleConfigResult.error.flatten(),
      });
  }
  const functionalTestOracleConfigResult =
    functionalTestOracleConfigSchema.safeParse(body.functionalTestOracleConfig);
  if (!functionalTestOracleConfigResult.success) {
    return reply
      .status(400)
      .send({
        error: "Configurazione Functional Test Oracle non valida.",
        details: functionalTestOracleConfigResult.error.flatten(),
      });
  }

  const experimentLimitsResult =
    experimentLimitsSchema.safeParse(
      body.experimentLimits ??
      DEFAULT_EXPERIMENT_LIMITS,
    );

  if (!experimentLimitsResult.success) {
    return reply
      .status(400)
      .send({
        error:
          "Limiti sperimentali non validi.",

        details:
          experimentLimitsResult.error.flatten(),
      });
  }

  if (experimentExecutionActive) {
    return reply
      .status(409)
      .send({
        error:
          "È già in corso un esperimento; esegui i run in sequenza per preservare la telemetria CPU.",
      });
  }
  experimentExecutionActive = true;

  try {
    const category = body.category;
    let normalizedTargetFiles: readonly string[];
    let normalizedTestFiles: readonly string[];

    try {
      normalizedTargetFiles = await Promise.all(
        body.targetFiles.map(async (file) => {
          const resolved = await resolveRepositoryPath({
            repositoryRoot: normalizedRepoPath,

            relativePath: file,

            allowMissing: category === "CREATE",
          });

          return resolved.relativePath;
        }),
      );

      normalizedTestFiles = await Promise.all(
        body.testFiles.map(async (file) => {
          const resolved = await resolveRepositoryPath({
            repositoryRoot: normalizedRepoPath,

            relativePath: file,
          });

          return resolved.relativePath;
        }),
      );
    } catch (error: unknown) {
      return reply.status(400).send({
        error:
          error instanceof Error
            ? error.message
            : "targetFiles o testFiles non validi.",
      });
    }

    const selectedModelConfig = Object.freeze(modelConfigResult.data);

    const selectedExperimentLimits:
      ExperimentLimits =
      Object.freeze({
        maxIterations:
          experimentLimitsResult
            .data
            .maxIterations,

        maxTechnicalAttempts:
          experimentLimitsResult
            .data
            .maxTechnicalAttempts,
      });

    const effectiveExperimentLimits:
      ExperimentLimits =
      Object.freeze(
        isBaseline
          ? {
            maxIterations:
              1,

            maxTechnicalAttempts:
              1,
          }
          : {
            maxIterations:
              selectedExperimentLimits
                .maxIterations,

            maxTechnicalAttempts:
              selectedExperimentLimits
                .maxTechnicalAttempts,
          },
      );

    const selectedBuildOracleConfig: BuildOracleConfig = Object.freeze({
      ...buildOracleConfigResult.data,
      args: Object.freeze([...buildOracleConfigResult.data.args]),
      envAllowList: Object.freeze([...buildOracleConfigResult.data.envAllowList]),
    });

    const functionalConfigData = functionalTestOracleConfigResult.data;

    let functionalTestExecutionCwd: string;

    let normalizedOracleFiles: readonly string[];

    try {
      const resolvedCwd = await resolveRepositoryPath({
        repositoryRoot: normalizedRepoPath,

        relativePath: functionalConfigData.cwd,

        allowRepositoryRoot: true,
      });

      functionalTestExecutionCwd = resolvedCwd.absolutePath;

      const authorizedTestFiles = new Set<string>(normalizedTestFiles);

      normalizedOracleFiles = await Promise.all(
        functionalConfigData.oracleFiles.map(async (oracleFile) => {
          const cwdRelativePath =
            resolvedCwd.relativePath === "." ? "" : resolvedCwd.relativePath;

          const normalizedOracleInput = oracleFile.replaceAll("\\", "/");

          const repositoryRelativeOraclePath = path.posix.join(
            cwdRelativePath,
            normalizedOracleInput,
          );
          const resolvedOracle = await resolveRepositoryPath({
            repositoryRoot: normalizedRepoPath,

            relativePath: repositoryRelativeOraclePath,
          });
          if (!authorizedTestFiles.has(resolvedOracle.relativePath)) {
            throw new Error(
              `Oracle file non autorizzato dal task manifest: ` +
              `${resolvedOracle.relativePath}`,
            );
          }
          const cwdRelativeOraclePath = path
            .relative(functionalTestExecutionCwd, resolvedOracle.absolutePath)
            .replaceAll("\\", "/");
          if (
            cwdRelativeOraclePath.length === 0 ||
            cwdRelativeOraclePath === ".." ||
            cwdRelativeOraclePath.startsWith("../")
          ) {
            throw new Error(
              `Oracle file non eseguibile dal cwd configurato: ` +
              `${resolvedOracle.relativePath}`,
            );
          }

          return cwdRelativeOraclePath;
        }),
      );
    } catch (error: unknown) {
      return reply.status(400).send({
        error:
          error instanceof Error
            ? error.message
            : "Configurazione path del Functional Test Oracle non valida.",
      });
    }

    const selectedFunctionalTestOracleConfig: FunctionalTestOracleConfig =
      Object.freeze({
        ...functionalConfigData,
        cwd: functionalTestExecutionCwd,

        args: Object.freeze([...functionalConfigData.args]),

        oracleFiles: Object.freeze([...normalizedOracleFiles]),

        envAllowList: Object.freeze([...functionalConfigData.envAllowList]),

        expectedExitPolicy: Object.freeze({
          passExitCodes: Object.freeze([
            ...functionalConfigData.expectedExitPolicy.passExitCodes,
          ]),
          failExitCodes: Object.freeze([
            ...functionalConfigData.expectedExitPolicy.failExitCodes,
          ]),
          executionErrorExitCodes: Object.freeze([
            ...functionalConfigData.expectedExitPolicy.executionErrorExitCodes,
          ]),
        }),
      });

    const telemetry = new TelemetryTracker();
    const modelConfig: ExperimentModelConfig = Object.freeze({
      baseUrl: selectedModelConfig.apiBaseUrl,
      modelName: selectedModelConfig.modelIdentifier,
      seed: selectedModelConfig.seed,
      temperature: selectedModelConfig.temperature,
      topP: selectedModelConfig.topP,
      inferenceTimeoutMs: selectedModelConfig.inferenceTimeoutMs,
    });
    const inferenceConfig = Object.freeze({
      baseUrl: modelConfig.baseUrl,
      model: modelConfig.modelName,
      seed: modelConfig.seed,
      temperature: modelConfig.temperature,
      topP: modelConfig.topP,
      inferenceTimeoutMs: modelConfig.inferenceTimeoutMs,
    });
    const llmClient = new OpenAICompatibleClient(inferenceConfig, telemetry);
    try {
      await llmClient.validateEndpoint();
    } catch (error: unknown) {
      return reply.status(503).send({
        error:
          error instanceof Error
            ? error.message
            : "Inference endpoint non disponibile.",
      });
    }

    const semgrepConfig: ExperimentSemgrepConfig = Object.freeze({
      command: "semgrep",
      timeoutMs: 60_000,
      envAllowList: Object.freeze([
        "PATH",
        "PATHEXT",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
      ]),
    });
    const git = new GitManager(normalizedRepoPath);
    const semgrep = new SemgrepEngine(normalizedRepoPath, semgrepConfig, semgrepProfile);

    const testHarness = new TestHarness();
    const buildSyntaxOracle = new BuildSyntaxOracle(normalizedRepoPath);
    const promptProfile = DEFAULT_PROMPT_PROFILE;
    const coder = new CoderAgent(llmClient, promptProfile);
    const reviewer = new ReviewerAgent(llmClient, promptProfile);
    const contextBuilder = new ContextBuilder(normalizedRepoPath, promptProfile);

    const fsm = new RefinementFSM(
      id,
      git,
      semgrep,
      testHarness,
      buildSyntaxOracle,
      coder,
      reviewer,
      contextBuilder,
      telemetry,
      effectiveExperimentLimits,
      (evt) => sseListeners.get(id)?.(evt),
    );

    const fixtureTargetSources = await readFixtureSources(
      normalizedRepoPath,
      normalizedTargetFiles,
      category === "CREATE",
    );

    const fixtureTestSources = await readFixtureSources(
      normalizedRepoPath,
      normalizedTestFiles,
      false,
    );

    const fixtureId =
      createFixtureIdentity({
        category,
        issueSpec: body.issueSpec,
        targetSources: fixtureTargetSources,
        testSources: fixtureTestSources,
      });

    const params: InitialContextParams = {
      issueSpec: body.issueSpec,
      targetFiles: normalizedTargetFiles,
      testFiles: normalizedTestFiles,
      category,
      buildOracleConfig: selectedBuildOracleConfig,
      functionalTestOracleConfig: selectedFunctionalTestOracleConfig,
    };

    fastify.log.info(
      {
        taskId: id,
        category,
        executionMode: isBaseline ? "BASELINE" : "MULTI_AGENT",
        limits: effectiveExperimentLimits,
      },
      "Starting task",
    );

    telemetry.startRun();

    const result = isBaseline
      ? await fsm.runBaseline(params)
      : await fsm.runLoop(params);
    const mode: ExperimentMode = isBaseline ? "BASELINE" : "MULTI_AGENT";

    const experimentProfile: ExperimentProfileV3 = Object.freeze({
      oracleProfileId: DEFAULT_ORACLE_PROFILE.id,
      promptProfileId: promptProfile.id,
      semgrepProfileId: semgrepProfile.id,
      buildOracleConfig: selectedBuildOracleConfig,
      functionalTestOracleConfig: selectedFunctionalTestOracleConfig,
      semgrepConfig,
      modelConfig,
      limits: effectiveExperimentLimits,
      fixture: Object.freeze({
        id: fixtureId,
        taskId: id,
        category,
        issueSpec: body.issueSpec,
        targetFiles: Object.freeze([...normalizedTargetFiles]),
        testFiles: Object.freeze([...normalizedTestFiles]),
      }),
    });

    sessions.set(id, result);
    sessionRepoPaths.set(id, normalizedRepoPath);
    sessionBuildOracleConfigs.set(id, selectedBuildOracleConfig);
    sessionFunctionalTestOracleConfigs.set(
      id,
      selectedFunctionalTestOracleConfig,
    );
    let runId: string;

    try {
      runId = await telemetryStorage.saveRun(
        result,
        mode,
        modelConfig,
        category,
        experimentProfile,
        fixtureTargetSources,
        fixtureTestSources
      );
    } catch (error: unknown) {
      const persistenceFailure: ExecutionFailure = {
        phase: "PERSISTENCE",

        category: "PERSISTENCE_FAILURE",

        message: error instanceof Error ? error.message : String(error),

        originalErrorName: error instanceof Error ? error.name : "UnknownError",

        iteration: result.currentIteration,

        recoverable: false,
      };

      const terminalResolution = resolveTerminalState({
        failure: persistenceFailure,

        refinementBudgetExhausted: true,
      });

      const failedResult: WorkbenchSessionState = {
        ...result,
        status: terminalResolution.status,
        autonomousStatus: terminalResolution.status,
        finalizationStatus: "NOT_FINALIZED",
        candidateVerified: result.candidateVerified,
        autonomousRunSucceeded: false,
        failure: persistenceFailure,
        terminationReason: describeTerminalState(
          terminalResolution,
          persistenceFailure,
        ),
      };

      sessions.set(id, failedResult);

      sessionRepoPaths.set(id, normalizedRepoPath);

      sessionBuildOracleConfigs.set(id, selectedBuildOracleConfig);

      sessionFunctionalTestOracleConfigs.set(
        id,
        selectedFunctionalTestOracleConfig,
      );

      sseListeners.get(id)?.({
        type: "ITERATION_COMPLETE",

        payload: failedResult,
      });

      fastify.log.error(
        {
          taskId: id,

          phase: persistenceFailure.phase,

          category: persistenceFailure.category,

          terminalStatus: failedResult.status,

          persisted: false,

          error:
            error instanceof Error
              ? {
                name: error.name,

                message: error.message,

                stack: error.stack,
              }
              : String(error),
        },
        "Telemetry persistence failure",
      );

      return reply.status(500).send({
        error:
          "L’esecuzione del task è terminata, ma il risultato non è stato persistito.",

        persisted: false,

        result: failedResult,
      });
    }
    const persistedResult: WorkbenchSessionState = { ...result, runId };
    sessions.set(id, persistedResult);
    sessionRepoPaths.set(id, normalizedRepoPath);
    sessionBuildOracleConfigs.set(id, selectedBuildOracleConfig);
    return reply.send(persistedResult);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
        : String(error);
    fastify.log.error(
      {
        taskId: id,
        error: message,
      },
      "Unhandled task execution failure",
    );
    return reply.status(500).send({
      error:
        error instanceof Error
          ? error.message
          : "Errore imprevisto durante l'esecuzione del task.",
    });
  } finally {
    experimentExecutionActive = false;
  }
});

fastify.get("/api/analytics/summary", async (req, reply) => {
  const query = req.query as { category?: string; modelName?: string };
  if (
    query.category &&
    query.category !== "REPAIR" &&
    query.category !== "CREATE"
  ) {
    return reply.status(400).send({ error: "Filtro category non valido." });
  }
  const filters: RunHistoryFilters = {
    ...(query.category
      ? { category: query.category as ExperimentCategory }
      : {}),
    ...(query.modelName ? { modelName: query.modelName } : {}),
  };
  return reply.send(await telemetryStorage.getAggregatedMetrics(filters));
});

fastify.get("/api/analytics/history", async (req, reply) => {
  const query = req.query as {
    mode?: string;
    category?: string;
    modelName?: string;
  };
  if (query.mode && query.mode !== "BASELINE" && query.mode !== "MULTI_AGENT") {
    return reply.status(400).send({ error: "Filtro mode non valido." });
  }
  if (
    query.category &&
    query.category !== "REPAIR" &&
    query.category !== "CREATE"
  ) {
    return reply.status(400).send({ error: "Filtro category non valido." });
  }
  const filters: RunHistoryFilters = {
    ...(query.mode ? { mode: query.mode as ExperimentMode } : {}),
    ...(query.category
      ? { category: query.category as ExperimentCategory }
      : {}),
    ...(query.modelName ? { modelName: query.modelName } : {}),
  };
  return reply.send(await telemetryStorage.listRuns(filters));
});

fastify.get("/api/analytics/compare/:taskId", async (req, reply) => {
  const { taskId } = req.params as { taskId: string };
  const query = req.query as { category?: string; modelName?: string };
  if (
    query.category &&
    query.category !== "REPAIR" &&
    query.category !== "CREATE"
  ) {
    return reply.status(400).send({ error: "Filtro category non valido." });
  }
  const comparison = await telemetryStorage.compareTask(taskId, {
    ...(query.category
      ? { category: query.category as ExperimentCategory }
      : {}),
    ...(query.modelName ? { modelName: query.modelName } : {}),
  });
  if (!comparison.baseline && !comparison.multiAgent) {
    return reply
      .status(404)
      .send({ error: "Nessuna esecuzione archiviata per questo task." });
  }
  return reply.send(comparison);
});

fastify.get("/api/experiments/:runId", async (req, reply) => {
  const { runId } = req.params as { runId: string };
  const run = await telemetryStorage.getRun(runId);
  if (!run)
    return reply.status(404).send({ error: "Run sperimentale non trovato." });
  return reply.send(run);
});

fastify.post("/api/tasks/:id/approve", async (req, reply) => {
  const { id } = req.params as { id: string };
  const session = sessions.get(id);
  if (!session) {
    return reply
      .status(404)
      .send({ error: "Sessione o patch finale non trovata." });
  }

  const autonomousStatus =
    session.autonomousStatus ??
    (session.status === "CONVERGED" ||
      session.status === "UNRESOLVED" ||
      session.status === "FAILED" ||
      session.status === "INFRASTRUCTURE_ERROR"
      ? session.status
      : undefined);

  if (autonomousStatus === undefined) {
    return reply
      .status(409)
      .send({
        error: "La sessione non contiene un outcome autonomo finalizzabile.",
      });
  }

  if (session.finalizationStatus === "APPROVED" && session.approvalCommitHash) {
    return reply.send({
      success: true,
      commitHash: session.approvalCommitHash,
      alreadyApproved: true,
    });
  }
  if (session.finalizationStatus === "REJECTED") {
    return reply
      .status(409)
      .send({ error: "Una sessione già scartata non può essere approvata." });
  }
  if (finalizationInProgress.has(id)) {
    return reply
      .status(409)
      .send({ error: "La finalizzazione di questa sessione è già in corso." });
  }

  const body = req.body as { repoPath: string; overrideDiff?: string };
  const expectedRepoPath = sessionRepoPaths.get(id);
  if (!expectedRepoPath) {
    return reply
      .status(409)
      .send({
        error: "Il repository associato alla sessione non è stato registrato",
      });
  }

  const buildOracleConfig = sessionBuildOracleConfigs.get(id);
  if (!buildOracleConfig) {
    return reply
      .status(409)
      .send({
        error:
          "La configurazione Build/Syntax associata alla sessione non è stata registrata.",
      });
  }
  const functionalTestOracleConfig = sessionFunctionalTestOracleConfigs.get(id);

  if (!functionalTestOracleConfig) {
    return reply.status(409).send({
      error:
        "La configurazione Functional Test Oracle associata alla sessione non è stata registrata.",
    });
  }
  const requestedRepoPath = path.resolve(body.repoPath);
  if (requestedRepoPath !== expectedRepoPath) {
    return reply
      .status(409)
      .send({
        error:
          "Il repository indicato non corrisponde a quello verificato durante il run.",
      });
  }
  const normalizedOverrideDiff = body.overrideDiff?.trim();
  const isHumanOverride =
    normalizedOverrideDiff !== undefined && normalizedOverrideDiff.length > 0;
  if (!session.initialHead) {
    return reply
      .status(409)
      .send({
        error:
          "Impossibile approvare la sessione: initial HEAD non registrato.",
      });
  }
  if (!isHumanOverride && autonomousStatus !== "CONVERGED") {
    return reply
      .status(409)
      .send({
        error:
          "La patch autonoma può essere approvata soltanto da una sessione CONVERGED.",
      });
  }
  if (!isHumanOverride && session.candidateVerified !== true) {
    return reply
      .status(409)
      .send({
        error:
          "La sessione è marcata CONVERGED ma non contiene un candidata finale verificata.",
      });
  }
  const verifiedFinalPatch = session.iterations.at(-1)?.patchDiff;
  if (!isHumanOverride && session.finalPatch !== verifiedFinalPatch) {
    return reply
      .status(409)
      .send({
        error:
          "La patch finale della sessione non corrisponde alla patch verificata nell'ultima iterazione.",
      });
  }
  const humanOverrideAllowedStatuses: ReadonlySet<
    NonNullable<WorkbenchSessionState["autonomousStatus"]>
  > = new Set(["CONVERGED", "UNRESOLVED", "FAILED"]);
  if (isHumanOverride && !humanOverrideAllowedStatuses.has(autonomousStatus)) {
    return reply
      .status(409)
      .send({
        error: `Human Override non consentito per l'outcome autonomo ${autonomousStatus}.`,
      });
  }
  if (!isHumanOverride && !session.finalPatch) {
    return reply
      .status(404)
      .send({ error: "La sessione non contiene una patch autonoma finale." });
  }
  const diffToApply = isHumanOverride
    ? normalizedOverrideDiff
    : session.finalPatch!;
  if (!diffToApply) {
    return reply
      .status(400)
      .send({ error: "Nessuna patch valida fornita per la finalizzazione." });
  }
  const git = new GitManager(expectedRepoPath);
  const patchScope: PatchScope = {
    category: session.category,
    targetFiles: session.targetFiles,
    testFiles: session.testFiles,
  };
  finalizationInProgress.add(id);
  let approvalCommitHash: string | undefined;
  try {
    const currentHead = await git.getHead();
    if (currentHead !== session.initialHead) {
      return reply
        .status(409)
        .send({
          error:
            `Il repository non è più sull'HEAD verificato dalla sessione. ` +
            `Atteso ${session.initialHead}, corrente ${currentHead}.`,
        });
    }
    try {
      await git.assertWorkingTreeClean();
    } catch (error: unknown) {
      return reply.status(409).send({
        error:
          error instanceof Error
            ? error.message
            : "Il repository non è clean prima della finalizzazione.",
      });
    }
    let applicability: OracleResult<"APPLICABILITY">;
    try {
      applicability = await git.evaluateApplicability(
        diffToApply,
        patchScope,
        true,
      );
    } catch (error: unknown) {
      throw new FinalizationGateError(
        error instanceof Error
          ? error.message
          : "La verifica di applicabilità non è stata completata.",
        503,
      );
    }

    try {
      assertApplicabilityResultInvariants(
        applicability
      );
    } catch (error: unknown) {
      throw new FinalizationGateError(
        error instanceof Error
          ? error.message
          : "Il risultato Applicability viola le invarianti.",
        503
      );
    }

    if (applicability.status === "EXECUTION_ERROR") {
      throw new FinalizationGateError(applicability.summary, 503);
    }

    if (applicability.status === "NOT_AVAILABLE") {
      throw new FinalizationGateError(applicability.summary, 422);
    }

    if (applicability.status === "FAIL") {
      throw new FinalizationGateError(applicability.summary, 409);
    }
    const certifiedApplyMode = applicability.evidence.applyMode;
    if (certifiedApplyMode === "NOT_APPLICABLE") {
      throw new FinalizationGateError(
        "Applicability ha restituito PASS con modalità NOT_APPLICABLE.",
        503,
      );
    }
    await git.applyPatch(diffToApply, patchScope, certifiedApplyMode);
    if (isHumanOverride) {
      const buildSyntax = new BuildSyntaxOracle(expectedRepoPath);
      const semgrep = new SemgrepEngine(expectedRepoPath, {
        command: "semgrep",
        timeoutMs: 60_000,
        envAllowList: Object.freeze([
          "PATH",
          "PATHEXT",
          "SYSTEMROOT",
          "WINDIR",
          "TEMP",
          "TMP",
        ]),
      },
        semgrepProfile,
      );

      const testHarness = new TestHarness();
      const buildResult = await buildSyntax.evaluate({
        config: buildOracleConfig,
        required: true,
      });
      const semgrepResult = await semgrep.evaluate({
        targetFiles: session.targetFiles,
        patchDiff: diffToApply,
        category: session.category,
        required: true,
      });
      const functionalResult = await testHarness.evaluate({
        config: functionalTestOracleConfig,
        required: true,
      });

      try {
        assertBuildSyntaxResultInvariants(
          buildResult
        );

        assertSemgrepResultInvariants(
          semgrepResult
        );

        assertFunctionalTestResultInvariants(
          functionalResult
        );
      } catch (error: unknown) {
        throw new FinalizationGateError(
          error instanceof Error
            ? error.message
            : "Un risultato Oracle dell'Human Override viola le invarianti.",
          503
        );
      }

      const overrideDecision = decideOracleResults([
        applicability,
        buildResult,
        semgrepResult,
        functionalResult,
      ]);

      if (
        overrideDecision.hasInvariantViolation
      ) {
        throw new FinalizationGateError(
          "Human Override non verificabile: il set dei risultati Oracle viola il profilo richiesto.",
          503
        );
      }

      if (overrideDecision.hasExecutionError) {
        const executionError = overrideDecision.executionErrors[0];
        throw new FinalizationGateError(
          executionError?.summary ??
          "Human Override non verificabile: un oracle non ha completato correttamente l’esecuzione.",
          503,
        );
      }
      if (overrideDecision.hasRequiredUnavailable) {
        const unavailableError = overrideDecision.requiredUnavailable[0];
        throw new FinalizationGateError(
          unavailableError?.summary ??
          "Human Override non approvabile: uno o più oracle obbligatori non sono disponibili.",
          422,
        );
      }
      if (!overrideDecision.converged) {
        const failedSummary = overrideDecision.failedResults
          .map((result) => `${result.oracle}: ${result.summary}`)
          .join("; ");
        throw new FinalizationGateError(
          failedSummary
            ? `Human Override respinto dai gate: ${failedSummary}`
            : "Human Override respinto: i gate obbligatori non risultano convergenti.",
          422,
        );
      }
    }
    approvalCommitHash = await git.commitChanges(
      `fix(agent): risoluzione issue ${id} [${isHumanOverride ? "Human-Augmented" : "Autonomous"}]`,
    );
    const commitHash = approvalCommitHash;

    const updated: WorkbenchSessionState = {
      ...session,
      autonomousStatus,
      finalizationStatus: "APPROVED",
      finalPatch: diffToApply,
      approvalCommitHash: commitHash,
      isHumanAugmented: isHumanOverride,
      terminationReason: isHumanOverride
        ? "Human Override verificato dagli stessi gate e approvato."
        : "Patch autonoma verificata e approvata.",
    };
    sessions.set(id, updated);
    if (session.runId) await telemetryStorage.updateRun(session.runId, updated);
    sseListeners.get(id)?.({ type: "ITERATION_COMPLETE", payload: updated });

    return reply.send({ success: true, commitHash, alreadyApproved: false });
  } catch (error: unknown) {
    const originalError = error;
    if (approvalCommitHash) {
      const committedSession: WorkbenchSessionState = {
        ...session,
        autonomousStatus,
        finalizationStatus: "APPROVED",
        finalPatch: diffToApply,
        approvalCommitHash,
        isHumanAugmented: isHumanOverride,
        terminationReason:
          "La patch è stata committata, ma la persistenza o la pubblicazione dello stato finale non è riuscita.",
      };
      sessions.set(id, committedSession);
      fastify.log.error(
        {
          taskId: id,
          commitHash: approvalCommitHash,
          error:
            originalError instanceof Error
              ? {
                name: originalError.name,
                message: originalError.message,
                stack: originalError.stack,
              }
              : String(originalError),
        },
        "Approval commit succeeded but post-commit finalization failed",
      );
      return reply
        .status(500)
        .send({
          error:
            "Il commit è stato creato correttamente, ma non è stato possibile completare la persistenza dello stato.",
          commitHash: approvalCommitHash,
          committed: true,
        });
    }
    const rollbackResult = await git.rollback(session.initialHead);
    if (rollbackResult.status === "FAILED") {
      const updated: WorkbenchSessionState = {
        ...session,
        autonomousStatus,
        finalizationStatus: "NOT_FINALIZED",
        rollbackResult,
        terminationReason:
          rollbackResult.message ??
          "La finalizzazione è fallita e il repository non è stato ripristinato completamente.",
      };
      sessions.set(id, updated);

      if (session.runId) {
        await telemetryStorage.updateRun(session.runId, updated);
      }

      sseListeners.get(id)?.({ type: "ITERATION_COMPLETE", payload: updated });
      fastify.log.error(
        {
          taskId: id,
          originalError:
            originalError instanceof Error
              ? {
                name: originalError.name,
                message: originalError.message,
                stack: originalError.stack,
              }
              : String(originalError),
          rollbackResult,
        },
        "Approval failed and transactional rollback was incomplete",
      );
      return reply
        .status(500)
        .send({
          error:
            "La finalizzazione è fallita e il rollback transazionale non ha ripristinato completamente il repository.",
          rollbackResult,
        });
    }
    const restoredSession: WorkbenchSessionState = {
      ...session,
      rollbackResult,
    };
    sessions.set(id, restoredSession);
    if (session.runId) {
      await telemetryStorage.updateRun(session.runId, restoredSession);
    }
    fastify.log.warn(
      {
        taskId: id,
        originalError:
          originalError instanceof Error
            ? {
              name: originalError.name,
              message: originalError.message,
              stack: originalError.stack,
            }
            : String(originalError),
        rollbackResult,
      },
      "Approval failed; repository restored to initial HEAD",
    );

    if (originalError instanceof FinalizationGateError) {
      return reply
        .status(originalError.statusCode)
        .send({ error: originalError.message, rollbackResult });
    }
    return reply
      .status(500)
      .send({
        error:
          originalError instanceof Error
            ? originalError.message
            : "Errore imprevisto durante la finalizzazione.",
        rollbackResult,
      });
  } finally {
    finalizationInProgress.delete(id);
  }
});

fastify.post("/api/tasks/:id/reject", async (req, reply) => {
  const { id } = req.params as { id: string };
  const session = sessions.get(id);
  if (!session) {
    return reply.status(404).send({ error: "Sessione non trovata." });
  }

  const autonomousStatus =
    session.autonomousStatus ??
    (session.status === "CONVERGED" ||
      session.status === "UNRESOLVED" ||
      session.status === "FAILED" ||
      session.status === "INFRASTRUCTURE_ERROR"
      ? session.status
      : undefined);

  if (autonomousStatus === undefined) {
    return reply
      .status(409)
      .send({
        error: "La sessione non contiene un outcome autonomo finalizzabile.",
      });
  }

  if (session.finalizationStatus === "REJECTED") {
    return reply.send({
      success: true,
      alreadyRejected: true,
      message: "La sessione era già stata scartata.",
    });
  }
  if (session.finalizationStatus === "APPROVED") {
    return reply
      .status(409)
      .send({ error: "Una sessione approvata non può essere scartata." });
  }
  const rejectedAllowedStatuses: ReadonlySet<
    NonNullable<WorkbenchSessionState["autonomousStatus"]>
  > = new Set(["CONVERGED", "UNRESOLVED", "FAILED", "INFRASTRUCTURE_ERROR"]);
  if (!rejectedAllowedStatuses.has(autonomousStatus)) {
    return reply
      .status(409)
      .send({
        error: `Reject non consentito per una sessione in stato ${autonomousStatus}.`,
      });
  }
  if (!session.initialHead) {
    return reply.status(409).send({
      error: "Impossibile scartare la sessione: initial HEAD non registrato.",
    });
  }
  if (finalizationInProgress.has(id)) {
    return reply
      .status(409)
      .send({ error: "La finalizzazione di questa sessione è già in corso." });
  }

  const body = req.body as { repoPath: string };
  const expectedRepoPath = sessionRepoPaths.get(id);
  if (!expectedRepoPath) {
    return reply
      .status(409)
      .send({
        error: "Il repository associato alla sessione non è stato registrato.",
      });
  }
  const requestedRepoPath = path.resolve(body.repoPath);
  if (requestedRepoPath !== expectedRepoPath) {
    return reply
      .status(409)
      .send({
        error:
          "Il repository indicato non corrisponde a quello verificato durante il run.",
      });
  }

  const git = new GitManager(expectedRepoPath);
  finalizationInProgress.add(id);
  try {
    const rollbackResult = await git.rollback(session.initialHead);
    if (rollbackResult.status === "FAILED") {
      const updated: WorkbenchSessionState = {
        ...session,
        autonomousStatus,
        finalizationStatus: "NOT_FINALIZED",
        rollbackResult,
        terminationReason:
          rollbackResult.message ??
          "Il rollback non ha ripristinato completamente il repository.",
      };
      sessions.set(id, updated);
      if (session.runId) {
        await telemetryStorage.updateRun(session.runId, updated);
      }
      sseListeners.get(id)?.({ type: "ITERATION_COMPLETE", payload: updated });
      fastify.log.error(
        { taskId: id, rollbackResult },
        "Task rejection rollback was incomplete",
      );
      return reply
        .status(500)
        .send({
          error:
            "Il rollback della sessione non ha ripristinato completamente il repository.",
          rollbackResult,
        });
    }
    const updated: WorkbenchSessionState = {
      ...session,
      autonomousStatus,
      finalizationStatus: "REJECTED",
      rollbackResult,
      terminationReason:
        "Sessione scartata e repository ripristinato all’HEAD iniziale.",
    };
    sessions.set(id, updated);
    if (session.runId) {
      await telemetryStorage.updateRun(session.runId, updated);
    }
    sseListeners.get(id)?.({ type: "ITERATION_COMPLETE", payload: updated });
    return reply.send({
      success: true,
      alreadyRejected: false,
      message: "Rollback transazionale eseguito con successo.",
      rollbackResult,
    });
  } catch (error: unknown) {
    fastify.log.error(
      {
        taskId: id,
        error:
          error instanceof Error
            ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
            : String(error),
      },
      "Task rejection failed",
    );
    return reply
      .status(500)
      .send({
        error:
          error instanceof Error
            ? error.message
            : "Errore durante il rollback della sessione.",
      });
  } finally {
    finalizationInProgress.delete(id);
  }
});

fastify.get("/api/files/read", async (req, reply) => {
  const query = req.query as {
    repoPath: string;
    filePath: string;
  };

  try {
    const resolved = await resolveRepositoryPath({
      repositoryRoot: query.repoPath,

      relativePath: query.filePath,
    });

    const content = await fs.readFile(resolved.absolutePath, "utf8");

    return reply.send({
      content,
    });
  } catch (error: unknown) {
    return reply.status(404).send({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    console.log("[Fastify Server] In ascolto su http://localhost:3000");
  } catch (error: unknown) {
    fastify.log.error(error instanceof Error ? error : String(error));
    process.exit(1);
  }
};
start();
