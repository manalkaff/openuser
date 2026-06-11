/**
 * Entity types — row shapes returned by the REST API.
 * These mirror the DB schema's $inferSelect shapes with timestamp_ms → number.
 */
import type {
  PersonaIdentity,
  PersonaBehavior,
  PersonaKnowledge,
} from './persona.js';
import type { FindingEvidence } from './types.js';
import type {
  RunStatus,
  Verdict,
  FindingType,
  Severity,
  FindingStatus,
  StepKind,
  TestSource,
} from './enums.js';

export type Project = {
  id: string;
  name: string;
  path: string;
  baseUrl: string;
  environments: { name: string; url: string }[];
  defaultViewport: { width: number; height: number };
  createdAt: number;
};

export type Persona = {
  id: string;
  projectId: string;
  name: string;
  role: string;
  identity: PersonaIdentity;
  behavior: PersonaBehavior;
  knowledge: PersonaKnowledge;
  notes: string | null;
  archived: boolean;
  createdAt: number;
};

export type Checkpoint = {
  id: string;
  projectId: string;
  personaId: string;
  name: string;
  description: string | null;
  storageStatePath: string;
  journey: { notes: string; savedAtStep: number; url: string };
  createdFromRunId: string | null;
  createdAt: number;
};

export type Test = {
  id: string;
  projectId: string;
  title: string;
  goal: string;
  preconditions: string | null;
  expectedOutcome: string | null;
  defaultPersonaId: string | null;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  source: TestSource;
  archived: boolean;
  createdAt: number;
};

export type Run = {
  id: string;
  projectId: string;
  testId: string | null;
  adhocGoal: string | null;
  personaId: string;
  checkpointId: string | null;
  environmentName: string | null;
  baseUrlResolved: string;
  status: RunStatus;
  verdict: Verdict | null;
  summary: string | null;
  agentLabel: string | null;
  tokenHash: string;
  videoPath: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
};

export type Step = {
  id: string;
  runId: string;
  idx: number;
  kind: StepKind;
  description: string;
  pageUrl: string | null;
  screenshotPath: string | null;
  status: 'ok' | 'error';
  error: string | null;
  note: string | null;
  durationMs: number | null;
  createdAt: number;
};

export type Finding = {
  id: string;
  runId: string;
  stepId: string | null;
  projectId: string;
  type: FindingType;
  severity: Severity;
  title: string;
  description: string;
  evidence: FindingEvidence;
  status: FindingStatus;
  createdAt: number;
};
