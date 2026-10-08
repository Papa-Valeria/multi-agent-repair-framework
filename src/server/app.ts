import Fastify from 'fastify';
import cors from '@fastify/cors';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GitManager } from '../git/GitManager.js';
import { SemgrepEngine } from '../verification/SemgrepEngine.js';
import { TestHarness } from '../verification/TestHarness.js';
import { ReviewerAgent } from '../agents/ReviewerAgent.js';
import { ContextBuilder } from '../orchestration/ContextBuilder.js';
import { TelemetryTracker } from '../telemetry/TelemetryTracker.js';
import { OpenAICompatibleClient } from '../inference/OpenAICompatibleClient.js';
import { RefinementFSM } from '../orchestration/RefinementFSM.js';
import { WorkbenchSessionState, WorkbenchStreamEvent } from '../types/domain.js';
import { CoderAgent } from '../agents/CoderAgent.js';
import { TelemetryStorage } from '../telemetry/TelemetryStorage.js';
import { ExperimentCategory, ExperimentMode, ExperimentModelConfig, RunHistoryFilters } from '../types/analytics.js';
import { DEFAULT_MODEL_SESSION_CONFIG, modelSessionConfigSchema } from '../inference/ModelSessionConfig.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

const sessions = new Map<string, WorkbenchSessionState>();
const sseListeners = new Map<string, (event: WorkbenchStreamEvent) => void>();
const finalizationInProgress = new Set<string>();
const telemetryStorage = new TelemetryStorage();
let experimentExecutionActive = false;

fastify.get('/api/tasks/:id/stream', (req, reply) => {
  const { id } = req.params as { id: string };

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('Access-Control-Allow-Origin', '*');
  reply.raw.flushHeaders();

  const listener = (event: WorkbenchStreamEvent) => {
    reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  };

  sseListeners.set(id, listener);

  req.raw.on('close', () => {
    sseListeners.delete(id);
  });
});

fastify.post('/api/tasks/init', async (req, reply) => {
  const body = req.body as {
    taskId: string;
    repoPath: string;
    issueSpec: string;
    targetFileName: string;
    targetFileContent: string;
    testFileName: string;
    testFileContent: string;
  };

  const git = new GitManager(body.repoPath);
  await git.hardReset();

  const targetPath = path.join(body.repoPath, body.targetFileName);
  const testPath = path.join(body.repoPath, body.testFileName);

  await fs.writeFile(targetPath, body.targetFileContent, 'utf-8');
  await fs.writeFile(testPath, body.testFileContent, 'utf-8');

  await git.commitChanges(`bench: initialize task ${body.taskId}`);

  return reply.send({ success: true, taskId: body.taskId });
});

fastify.post('/api/tasks/:id/execute', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as {
    repoPath: string;
    issueSpec: string;
    targetFiles: string[];
    testFiles: string[];
    category?: ExperimentCategory;
    modelConfig?: unknown;
    executionMode?: 'BASELINE' | 'MULTI_AGENT';
    isBaseline?: boolean;
  };
  if (body.executionMode !== undefined && body.executionMode !== 'BASELINE' && body.executionMode !== 'MULTI_AGENT') {
    return reply.status(400).send({ error: 'executionMode deve essere BASELINE o MULTI_AGENT.' });
  }
  if (body.category !== undefined && body.category !== 'REPAIR' && body.category !== 'CREATE') {
    return reply.status(400).send({ error: 'category deve essere REPAIR o CREATE.' });
  }
  const modelConfigResult = modelSessionConfigSchema.safeParse(body.modelConfig ?? DEFAULT_MODEL_SESSION_CONFIG);
  if (!modelConfigResult.success) {
    return reply.status(400).send({ error: 'Configurazione modello non valida.', details: modelConfigResult.error.flatten() });
  }
  if (experimentExecutionActive) {
    return reply.status(409).send({ error: 'È già in corso un esperimento; esegui i run in sequenza per preservare la telemetria CPU.' });
  }
  const category = body.category ?? 'REPAIR';
  const selectedModelConfig = Object.freeze(modelConfigResult.data);

  experimentExecutionActive = true;
  try {
    const telemetry = new TelemetryTracker();
    const modelConfig: ExperimentModelConfig = Object.freeze({
      baseUrl: selectedModelConfig.apiBaseUrl,
      modelName: selectedModelConfig.modelIdentifier,
      seed: selectedModelConfig.seed,
      temperature: selectedModelConfig.temperature,
      topP: selectedModelConfig.topP
    });
    const inferenceConfig = Object.freeze({
      baseUrl: modelConfig.baseUrl,
      model: modelConfig.modelName,
      seed: modelConfig.seed,
      temperature: modelConfig.temperature,
      topP: modelConfig.topP
    });
    const llmClient = new OpenAICompatibleClient(
      inferenceConfig,
      telemetry
    );
    try {
      await llmClient.validateEndpoint();
    } catch (error: unknown) {
      return reply.status(503).send({
        error: error instanceof Error ? error.message : 'Inference endpoint non disponibile.'
      });
    }

    const git = new GitManager(body.repoPath);
    const semgrep = new SemgrepEngine(body.repoPath);
    const testHarness = new TestHarness(body.repoPath);
    const coder = new CoderAgent(llmClient);
    const reviewer = new ReviewerAgent(llmClient);
    const contextBuilder = new ContextBuilder(body.repoPath);

    const fsm = new RefinementFSM(
      id,
      git,
      semgrep,
      testHarness,
      coder,
      reviewer,
      contextBuilder,
      telemetry,
      (evt) => sseListeners.get(id)?.(evt)
    );

    const params = {
      issueSpec: body.issueSpec,
      targetFiles: body.targetFiles,
      testFiles: body.testFiles
    };

    const isBaseline = body.executionMode
      ? body.executionMode === 'BASELINE'
      : body.isBaseline === true;
    fastify.log.info(
      { taskId: id, executionMode: isBaseline ? 'BASELINE' : 'MULTI_AGENT' },
      'Starting repair task'
    );
    const result = isBaseline ? await fsm.runBaseline(params) : await fsm.runLoop(params);
    const mode: ExperimentMode = isBaseline ? 'BASELINE' : 'MULTI_AGENT';
    const targetSources: Record<string, string> = {};
    await Promise.all(
      body.targetFiles.map(async (file) => {
        try {
          targetSources[file] = await fs.readFile(path.join(body.repoPath, file), 'utf8');
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            targetSources[file] = '';
          } else {
            throw err;
          }
        }
      })
    );
    const runId = await telemetryStorage.saveRun(result, mode, modelConfig, category, targetSources);
    const persistedResult: WorkbenchSessionState = { ...result, runId };
    sessions.set(id, persistedResult);
    return reply.send(persistedResult);
  } finally {
    experimentExecutionActive = false;
  }
});

fastify.get('/api/analytics/summary', async (req, reply) => {
  const query = req.query as { category?: string; modelName?: string };
  if (query.category && query.category !== 'REPAIR' && query.category !== 'CREATE') {
    return reply.status(400).send({ error: 'Filtro category non valido.' });
  }
  const filters: RunHistoryFilters = {
    ...(query.category ? { category: query.category as ExperimentCategory } : {}),
    ...(query.modelName ? { modelName: query.modelName } : {})
  };
  return reply.send(await telemetryStorage.getAggregatedMetrics(filters));
});

fastify.get('/api/analytics/history', async (req, reply) => {
  const query = req.query as { mode?: string; category?: string; modelName?: string };
  if (query.mode && query.mode !== 'BASELINE' && query.mode !== 'MULTI_AGENT') {
    return reply.status(400).send({ error: 'Filtro mode non valido.' });
  }
  if (query.category && query.category !== 'REPAIR' && query.category !== 'CREATE') {
    return reply.status(400).send({ error: 'Filtro category non valido.' });
  }
  const filters: RunHistoryFilters = {
    ...(query.mode ? { mode: query.mode as ExperimentMode } : {}),
    ...(query.category ? { category: query.category as ExperimentCategory } : {}),
    ...(query.modelName ? { modelName: query.modelName } : {})
  };
  return reply.send(await telemetryStorage.listRuns(filters));
});

fastify.get('/api/analytics/compare/:taskId', async (req, reply) => {
  const { taskId } = req.params as { taskId: string };
  const query = req.query as { category?: string; modelName?: string };
  if (query.category && query.category !== 'REPAIR' && query.category !== 'CREATE') {
    return reply.status(400).send({ error: 'Filtro category non valido.' });
  }
  const comparison = await telemetryStorage.compareTask(taskId, {
    ...(query.category ? { category: query.category as ExperimentCategory } : {}),
    ...(query.modelName ? { modelName: query.modelName } : {})
  });
  if (!comparison.baseline && !comparison.multiAgent) {
    return reply.status(404).send({ error: 'Nessuna esecuzione archiviata per questo task.' });
  }
  return reply.send(comparison);
});

fastify.get('/api/experiments/:runId', async (req, reply) => {
  const { runId } = req.params as { runId: string };
  const run = await telemetryStorage.getRun(runId);
  if (!run) return reply.status(404).send({ error: 'Run sperimentale non trovato.' });
  return reply.send(run);
});

fastify.post('/api/tasks/:id/approve', async (req, reply) => {
  const { id } = req.params as { id: string };
  const session = sessions.get(id);
  if (!session) {
    return reply.status(404).send({ error: 'Sessione o patch finale non trovata.' });
  }
  if (session.status === 'APPROVED' && session.approvalCommitHash) {
    return reply.send({ success: true, commitHash: session.approvalCommitHash, alreadyApproved: true });
  }
  if (!session.finalPatch) {
    return reply.status(404).send({ error: 'Sessione o patch finale non trovata.' });
  }
  if (session.status !== 'CONVERGED') {
    return reply.status(409).send({ error: 'È possibile approvare solo una sessione verificata e convergente.' });
  }
  if (finalizationInProgress.has(id)) {
    return reply.status(409).send({ error: 'La finalizzazione di questa sessione è già in corso.' });
  }

  const body = req.body as { repoPath: string; overrideDiff?: string };
  const git = new GitManager(body.repoPath);
  const diffToApply = body.overrideDiff ?? session.finalPatch;
  finalizationInProgress.add(id);
  try {
    if (!(await git.dryRunPatch(diffToApply))) {
      return reply.status(409).send({ error: 'La patch non è applicabile allo stato pulito del repository.' });
    }

    await git.applyPatch(diffToApply);
    const commitHash = await git.commitChanges(
      `fix(agent): risoluzione issue ${id} [${body.overrideDiff ? 'Human-Augmented' : 'Autonomous'}]`,
      session.targetFiles
    );

    const updated: WorkbenchSessionState = {
      ...session,
      status: 'APPROVED',
      approvalCommitHash: commitHash,
      isHumanAugmented: !!body.overrideDiff
    };
    sessions.set(id, updated);
    if (session.runId) await telemetryStorage.updateRun(session.runId, updated);
    sseListeners.get(id)?.({ type: 'ITERATION_COMPLETE', payload: updated });

    return reply.send({ success: true, commitHash, alreadyApproved: false });
  } catch (err) {
    await git.rollback();
    throw err;
  } finally {
    finalizationInProgress.delete(id);
  }
});

fastify.post('/api/tasks/:id/reject', async (req, reply) => {
  const { id } = req.params as { id: string };
  const session = sessions.get(id);
  if (!session) {
    return reply.status(404).send({ error: 'Sessione non trovata.' });
  }
  if (session.status === 'REJECTED') {
    return reply.send({ success: true, alreadyRejected: true, message: 'La sessione era già stata scartata.' });
  }
  if (session.status === 'APPROVED') {
    return reply.status(409).send({ error: 'Una sessione approvata non può essere scartata.' });
  }
  if (finalizationInProgress.has(id)) {
    return reply.status(409).send({ error: 'La finalizzazione di questa sessione è già in corso.' });
  }

  const body = req.body as { repoPath: string };
  const git = new GitManager(body.repoPath);
  finalizationInProgress.add(id);
  try {
    await git.rollback();
    const updated: WorkbenchSessionState = { ...session, status: 'REJECTED' };
    sessions.set(id, updated);
    if (session.runId) await telemetryStorage.updateRun(session.runId, updated);
    sseListeners.get(id)?.({ type: 'ITERATION_COMPLETE', payload: updated });
    return reply.send({ success: true, alreadyRejected: false, message: 'Rollback eseguito con successo.' });
  } finally {
    finalizationInProgress.delete(id);
  }
});

fastify.get('/api/files/read', async (req, reply) => {
  const query = req.query as { repoPath: string; filePath: string };
  try {
    const full = path.join(query.repoPath, query.filePath);
    const content = await fs.readFile(full, 'utf-8');
    return reply.send({ content });
  } catch (err: any) {
    return reply.status(404).send({ error: err.message });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('[Fastify Server] In ascolto su http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
