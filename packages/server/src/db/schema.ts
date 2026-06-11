import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// ---- types referenced by schema (defined here to keep schema self-contained) ----

export type PersonaIdentity = {
  fullName: string;
  roleLabel: string;
  credentials?: { username: string; password: string };
  signupInstructions?: string;
  locale: string;
};

export type PersonaBehavior = {
  techSavviness: 'novice' | 'average' | 'expert';
  patience: 'low' | 'medium' | 'high';
  readingStyle: 'skims' | 'reads';
  device: 'desktop' | 'mobile';
  viewport: { width: number; height: number };
  habits: string;
};

export type PersonaKnowledge = {
  productKnowledge: string;
  expectations: string;
  vocabulary: string;
};

export type FindingEvidence = {
  screenshotPath?: string;
  consoleExcerpt?: unknown[];
  networkExcerpt?: {
    method: string;
    url: string;
    status: number | 'failed';
    bodySnippet?: string;
  }[];
};

export type RunStatus = 'pending' | 'running' | 'passed' | 'blocked' | 'failed' | 'aborted';
export type Verdict = 'goal_achieved' | 'blocked' | 'partial';
export type FindingType = 'functional' | 'console' | 'network' | 'ux_confusion';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type FindingStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';
export type StepKind = 'begin' | 'navigate' | 'click' | 'type' | 'select' | 'scroll' | 'back' | 'wait' | 'screenshot';
export type TestSource = 'manual' | 'agent' | 'promoted_from_run';

// ---- schema (verbatim from contracts §4) ----

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  baseUrl: text('base_url').notNull(),
  environments: text('environments', { mode: 'json' }).$type<{ name: string; url: string }[]>().notNull().default([]),
  defaultViewport: text('default_viewport', { mode: 'json' }).$type<{ width: number; height: number }>().notNull().default({ width: 1280, height: 720 }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const personas = sqliteTable('personas', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  role: text('role').notNull(),
  identity: text('identity', { mode: 'json' }).$type<PersonaIdentity>().notNull(),
  behavior: text('behavior', { mode: 'json' }).$type<PersonaBehavior>().notNull(),
  knowledge: text('knowledge', { mode: 'json' }).$type<PersonaKnowledge>().notNull(),
  notes: text('notes'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  personaId: text('persona_id').notNull().references(() => personas.id),
  name: text('name').notNull(),
  description: text('description'),
  storageStatePath: text('storage_state_path').notNull(),
  journey: text('journey', { mode: 'json' }).$type<{ notes: string; savedAtStep: number; url: string }>().notNull(),
  createdFromRunId: text('created_from_run_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const tests = sqliteTable('tests', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  title: text('title').notNull(),
  goal: text('goal').notNull(),
  preconditions: text('preconditions'),
  expectedOutcome: text('expected_outcome'),
  defaultPersonaId: text('default_persona_id'),
  priority: text('priority').$type<'low' | 'medium' | 'high'>().notNull().default('medium'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  source: text('source').$type<TestSource>().notNull().default('manual'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  testId: text('test_id'),
  adhocGoal: text('adhoc_goal'),
  personaId: text('persona_id').notNull().references(() => personas.id),
  checkpointId: text('checkpoint_id'),
  environmentName: text('environment_name'),
  baseUrlResolved: text('base_url_resolved').notNull(),
  status: text('status').$type<RunStatus>().notNull().default('pending'),
  verdict: text('verdict').$type<Verdict>(),
  summary: text('summary'),
  agentLabel: text('agent_label'),
  tokenHash: text('token_hash').notNull(),
  videoPath: text('video_path'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const steps = sqliteTable('steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  idx: integer('idx').notNull(),
  kind: text('kind').$type<StepKind>().notNull(),
  description: text('description').notNull(),
  pageUrl: text('page_url'),
  screenshotPath: text('screenshot_path'),
  status: text('status').$type<'ok' | 'error'>().notNull().default('ok'),
  error: text('error'),
  note: text('note'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  stepId: text('step_id'),
  projectId: text('project_id').notNull().references(() => projects.id),
  type: text('type').$type<FindingType>().notNull(),
  severity: text('severity').$type<Severity>().notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  evidence: text('evidence', { mode: 'json' }).$type<FindingEvidence>().notNull(),
  status: text('status').$type<FindingStatus>().notNull().default('open'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const logEvents = sqliteTable('log_events', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  stepIdx: integer('step_idx').notNull(),
  kind: text('kind').$type<'console' | 'network'>().notNull(),
  level: text('level'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
});
