import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  runs, tests, personas, projects, steps, findings,
  type RunStatus, type Verdict,
} from '../db/schema.js';
import type { WsHub } from '../ws/hub.js';

// ---- testerPrompt template — VERBATIM from contracts §10 ----
const TESTER_PROMPT_TEMPLATE = `You are about to act as a real user of a web application. You have NO knowledge of its codebase.

First: call the \`begin_run\` tool with token "{{token}}" (openuser tester MCP).
It returns who you are, your mission, and the current page.

Follow your openuser-tester skill strictly: stay in character as the persona at all
times, navigate only by what you can see, report problems and confusion as findings
in the user's voice, save checkpoints after costly setup, and finish with complete_run.

Persona preview: {{personaName}} — {{roleLabel}}.
Mission preview: {{goal}}

Do not read any source code. Do not use any tools other than the openuser tester tools.`;

function renderTesterPrompt(vars: {
  token: string;
  personaName: string;
  roleLabel: string;
  goal: string;
}): string {
  return TESTER_PROMPT_TEMPLATE
    .replace('{{token}}', vars.token)
    .replace('{{personaName}}', vars.personaName)
    .replace('{{roleLabel}}', vars.roleLabel)
    .replace('{{goal}}', vars.goal);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Status computation rule from contracts §3 */
export function computeRunStatus(
  verdict: Verdict,
  openFindings: { severity: string }[],
): RunStatus {
  if (verdict === 'goal_achieved') {
    const hasCriticalOrHigh = openFindings.some(
      (f) => f.severity === 'critical' || f.severity === 'high',
    );
    return hasCriticalOrHigh ? 'failed' : 'passed';
  }
  if (verdict === 'blocked') return 'blocked';
  // 'partial'
  return 'failed';
}

export interface PrepareRunInput {
  projectId: string;
  testId?: string | null;
  adhocGoal?: string | null;
  personaId: string;
  checkpointId?: string | null;
  environment?: string | null;
  agentLabel?: string | null;
}

export interface PrepareRunResult {
  runId: string;
  token: string;
  testerPrompt: string;
}

export class RunLifecycleService {
  constructor(
    private readonly db: DB,
    private readonly wsHub: WsHub,
  ) {}

  prepare(input: PrepareRunInput): PrepareRunResult {
    // Validate exactly one of testId / adhocGoal
    if (!input.testId && !input.adhocGoal) {
      throw new Error('Exactly one of testId or adhocGoal must be provided');
    }
    if (input.testId && input.adhocGoal) {
      throw new Error('Provide only one of testId or adhocGoal, not both');
    }

    // Load project
    const project = this.db.select().from(projects).where(eq(projects.id, input.projectId)).get();
    if (!project) throw new NotFoundError(`Project not found: ${input.projectId}`);

    // Load persona
    const persona = this.db.select().from(personas).where(eq(personas.id, input.personaId)).get();
    if (!persona) throw new NotFoundError(`Persona not found: ${input.personaId}`);

    // Resolve goal
    let goal = input.adhocGoal ?? '';
    if (input.testId) {
      const test = this.db.select().from(tests).where(eq(tests.id, input.testId)).get();
      if (!test) throw new NotFoundError(`Test not found: ${input.testId}`);
      goal = test.goal;
    }

    // Resolve base URL
    let baseUrlResolved = project.baseUrl;
    if (input.environment) {
      const env = project.environments.find((e) => e.name === input.environment);
      if (env) baseUrlResolved = env.url;
    }

    // Generate token
    const rawToken = `rt_${nanoid(24)}`;
    const tokenHash = hashToken(rawToken);

    const runId = `run_${nanoid(12)}`;
    const now = new Date();

    this.db.insert(runs).values({
      id: runId,
      projectId: input.projectId,
      testId: input.testId ?? null,
      adhocGoal: input.adhocGoal ?? null,
      personaId: input.personaId,
      checkpointId: input.checkpointId ?? null,
      environmentName: input.environment ?? null,
      baseUrlResolved,
      status: 'pending',
      verdict: null,
      summary: null,
      agentLabel: input.agentLabel ?? null,
      tokenHash,
      videoPath: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
    }).run();

    const run = this.db.select().from(runs).where(eq(runs.id, runId)).get()!;
    this.wsHub.broadcastRun(runId, 'run.created', run);

    const testerPrompt = renderTesterPrompt({
      token: rawToken,
      personaName: persona.name,
      roleLabel: persona.identity.roleLabel,
      goal,
    });

    return { runId, token: rawToken, testerPrompt };
  }

  /** Update run status and broadcast run.updated */
  updateStatus(runId: string, status: RunStatus, extra?: Partial<typeof runs.$inferInsert>): void {
    this.db.update(runs).set({ status, ...extra }).where(eq(runs.id, runId)).run();
    const run = this.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run) return;
    this.wsHub.broadcastRun(runId, 'run.updated', run);
  }

  /** Finalize a run: set verdict + status + finishedAt + videoPath */
  finalize(
    runId: string,
    verdict: Verdict,
    summary: string,
    videoPath?: string,
  ): RunStatus {
    const openFindingsRows = this.db
      .select({ severity: findings.severity })
      .from(findings)
      .where(and(eq(findings.runId, runId), eq(findings.status, 'open')))
      .all();
    const status = computeRunStatus(verdict, openFindingsRows);
    this.db
      .update(runs)
      .set({
        verdict,
        summary,
        status,
        videoPath: videoPath ?? null,
        finishedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .run();
    const run = this.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run) return status;
    this.wsHub.broadcastRun(runId, 'run.completed', run);
    return status;
  }

  /** Abort a run (watchdog or crash) — guarded: no-ops if run already reached a terminal state */
  abort(runId: string, videoPath?: string): void {
    this.db
      .update(runs)
      .set({ status: 'aborted', finishedAt: new Date(), videoPath: videoPath ?? null })
      .where(and(eq(runs.id, runId), eq(runs.status, 'running')))
      .run();
    const run = this.db.select().from(runs).where(eq(runs.id, runId)).get();
    // If the run is not 'aborted' the guarded UPDATE changed 0 rows — it already completed; do nothing
    if (!run || run.status !== 'aborted') return;
    this.wsHub.broadcastRun(runId, 'run.completed', run);
  }

  /** Build persona card markdown */
  buildPersonaCard(persona: typeof personas.$inferSelect): string {
    const id = persona.identity;
    const bh = persona.behavior;
    const kn = persona.knowledge;
    return [
      `## Persona: ${persona.name}`,
      `**Role:** ${persona.role} (${id.roleLabel})`,
      `**Full name:** ${id.fullName}`,
      `**Locale:** ${id.locale}`,
      id.credentials ? `**Credentials:** username \`${id.credentials.username}\`, password \`${id.credentials.password}\`` : '',
      id.signupInstructions ? `**Sign-up instructions:** ${id.signupInstructions}` : '',
      '',
      '### Behavior',
      `- Tech savviness: ${bh.techSavviness}`,
      `- Patience: ${bh.patience}`,
      `- Reading style: ${bh.readingStyle}`,
      `- Device: ${bh.device} (${bh.viewport.width}×${bh.viewport.height})`,
      `- Habits/goals: ${bh.habits}`,
      '',
      '### Knowledge',
      `- Product knowledge: ${kn.productKnowledge}`,
      `- Expectations: ${kn.expectations}`,
      `- Vocabulary: ${kn.vocabulary}`,
      persona.notes ? `\n**Notes:** ${persona.notes}` : '',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  /** Build mission string from run */
  buildMission(run: typeof runs.$inferSelect): string {
    if (run.adhocGoal) return run.adhocGoal;
    if (!run.testId) return '(no goal)';
    const test = this.db.select().from(tests).where(eq(tests.id, run.testId)).get();
    if (!test) return '(test not found)';
    const parts = [`**Goal:** ${test.goal}`];
    if (test.preconditions) parts.push(`**Preconditions:** ${test.preconditions}`);
    if (test.expectedOutcome) parts.push(`**Expected outcome:** ${test.expectedOutcome}`);
    return parts.join('\n');
  }

  /** Get current step index (max idx of steps for run, or -1) */
  currentStepIdx(runId: string): number {
    const row = this.db
      .select({ idx: steps.idx })
      .from(steps)
      .where(eq(steps.runId, runId))
      .orderBy(steps.idx)
      .all()
      .at(-1);
    return row?.idx ?? -1;
  }
}
