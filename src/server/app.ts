import Fastify from 'fastify';
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

const fastify = Fastify({ logger: true });
const sessions = new Map<string, WorkbenchSessionState>();
const sseListeners = new Map<string, (event: WorkbenchStreamEvent) => void>();

fastify.get('/api/tasks/:id/stream', (req, reply) => {
  const { id } = req.params as { id: string };

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.flushHeaders();

  const listener = (event: WorkbenchStreamEvent) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  sseListeners.set(id, listener);

  req.raw.on('close', () => {
    sseListeners.delete(id);
  });
});

fastify.post('/api/tasks/:id/execute', async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = req.body as {
    repoPath: string;
    issueSpec: string;
    targetFiles: string[];
    testFiles: string[];
    isBaseline?: boolean;
  };

  const telemetry = new TelemetryTracker();
  const llmClient = new OpenAICompatibleClient(
    { baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b', seed: 42 },
    telemetry
  );

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

  const result = body.isBaseline ? await fsm.runBaseline(params) : await fsm.runLoop(params);
  sessions.set(id, result);
  return reply.send(result);
});

fastify.post('/api/tasks/:id/approve', async (req, reply) => {
  const { id } = req.params as { id: string };
  const session = sessions.get(id);
  if (!session || !session.finalPatch) {
    return reply.status(404).send({ error: 'Sessione o patch finale non trovata.' });
  }

  const body = req.body as { repoPath: string; overrideDiff?: string };
  const git = new GitManager(body.repoPath);

  const diffToApply = body.overrideDiff ?? session.finalPatch;
  await git.applyPatch(diffToApply);
  const commitHash = await git.commitChanges(
    `fix(agent): risoluzione issue ${id} [${body.overrideDiff ? 'Human-Augmented' : 'Autonomous'}]`
  );

  return reply.send({ success: true, commitHash });
});

fastify.post('/api/tasks/:id/reject', async (req, reply) => {
  const body = req.body as { repoPath: string };
  const git = new GitManager(body.repoPath);
  await git.hardReset();
  return reply.send({ success: true, message: 'Rollback eseguito con successo.' });
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log('Server operativo su http://localhost:3000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};
start();
