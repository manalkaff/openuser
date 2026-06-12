import { z } from 'zod';
import { RunStatusSchema, VerdictSchema, FindingStatusSchema, FindingTypeSchema, SeveritySchema, TestSourceSchema } from './enums.js';
import { PersonaIdentitySchema, PersonaBehaviorSchema, PersonaKnowledgeSchema } from './persona.js';
import { FindingEvidenceSchema, TesterActionSchema, PageSnapshotSchema } from './types.js';

// ── Health ──────────────────────────────────────────────────────────────────

export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ── Projects ─────────────────────────────────────────────────────────────────

export const CreateProjectBodySchema = z.object({
  name: z.string(),
  path: z.string(),
  baseUrl: z.string().url(),
  environments: z.array(z.object({ name: z.string(), url: z.string().url() })).optional(),
  defaultViewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
});
export type CreateProjectBody = z.infer<typeof CreateProjectBodySchema>;

export const PatchProjectBodySchema = CreateProjectBodySchema.partial();
export type PatchProjectBody = z.infer<typeof PatchProjectBodySchema>;

// ── Personas ─────────────────────────────────────────────────────────────────

export const CreatePersonaBodySchema = z.object({
  name: z.string(),
  role: z.string(),
  identity: PersonaIdentitySchema,
  behavior: PersonaBehaviorSchema,
  knowledge: PersonaKnowledgeSchema,
  notes: z.string().optional(),
});
export type CreatePersonaBody = z.infer<typeof CreatePersonaBodySchema>;

export const PatchPersonaBodySchema = CreatePersonaBodySchema.partial().extend({
  archived: z.boolean().optional(),
});
export type PatchPersonaBody = z.infer<typeof PatchPersonaBodySchema>;

// ── Tests ─────────────────────────────────────────────────────────────────────

export const CreateTestBodySchema = z.object({
  title: z.string(),
  goal: z.string(),
  preconditions: z.string().optional(),
  expectedOutcome: z.string().optional(),
  defaultPersonaId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  tags: z.array(z.string()).optional(),
  source: TestSourceSchema.optional(),
});
export type CreateTestBody = z.infer<typeof CreateTestBodySchema>;

export const PatchTestBodySchema = CreateTestBodySchema.partial().extend({
  archived: z.boolean().optional(),
});
export type PatchTestBody = z.infer<typeof PatchTestBodySchema>;

// ── Runs ─────────────────────────────────────────────────────────────────────

export const PrepareRunBodySchema = z.object({
  projectId: z.string(),
  testId: z.string().optional(),
  adhocGoal: z.string().optional(),
  personaId: z.string(),
  checkpointId: z.string().optional(),
  environment: z.string().optional(),
  agentLabel: z.string().optional(),
});
export type PrepareRunBody = z.infer<typeof PrepareRunBodySchema>;

export const PrepareRunResponseSchema = z.object({
  runId: z.string(),
  token: z.string(),
  testerPrompt: z.string(),
});
export type PrepareRunResponse = z.infer<typeof PrepareRunResponseSchema>;

export const ListRunsQuerySchema = z.object({
  projectId: z.string().optional(),
  status: RunStatusSchema.optional(),
  limit: z.string().optional(),
});
export type ListRunsQuery = z.infer<typeof ListRunsQuerySchema>;

export const PromoteRunBodySchema = z.object({
  title: z.string(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  tags: z.array(z.string()).optional(),
});
export type PromoteRunBody = z.infer<typeof PromoteRunBodySchema>;

// ── Findings ─────────────────────────────────────────────────────────────────

export const PatchFindingBodySchema = z.object({
  status: FindingStatusSchema,
});
export type PatchFindingBody = z.infer<typeof PatchFindingBodySchema>;

export const ListFindingsQuerySchema = z.object({
  projectId: z.string().optional(),
  severity: SeveritySchema.optional(),
  type: FindingTypeSchema.optional(),
  status: FindingStatusSchema.optional(),
});
export type ListFindingsQuery = z.infer<typeof ListFindingsQuerySchema>;

// ── Settings ─────────────────────────────────────────────────────────────────

export const PatchSettingsBodySchema = z.record(z.string(), z.unknown());
export type PatchSettingsBody = z.infer<typeof PatchSettingsBodySchema>;

// ── Tester endpoints ─────────────────────────────────────────────────────────

export const TesterBeginResponseSchema = z.object({
  personaCard: z.string(),
  mission: z.string(),
  journeyNotes: z.string().optional(),
  snapshot: PageSnapshotSchema,
});
export type TesterBeginResponse = z.infer<typeof TesterBeginResponseSchema>;

export const TesterActionRequestSchema = TesterActionSchema.and(
  z.object({ note: z.string().optional() }),
);
export type TesterActionRequest = z.infer<typeof TesterActionRequestSchema>;

export const TesterActionResponseSchema = z.union([
  z.object({ ok: z.literal(true), snapshot: PageSnapshotSchema }),
  z.object({ ok: z.literal(false), error: z.string(), snapshot: PageSnapshotSchema.optional() }),
]);
export type TesterActionResponse = z.infer<typeof TesterActionResponseSchema>;

export const TesterScreenshotResponseSchema = z.object({ path: z.string() });
export type TesterScreenshotResponse = z.infer<typeof TesterScreenshotResponseSchema>;

export const TesterFindingBodySchema = z.object({
  type: FindingTypeSchema,
  severity: SeveritySchema,
  title: z.string(),
  description: z.string(),
});
export type TesterFindingBody = z.infer<typeof TesterFindingBodySchema>;

export const TesterCheckpointBodySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  journeyNotes: z.string(),
});
export type TesterCheckpointBody = z.infer<typeof TesterCheckpointBodySchema>;

export const TesterCompleteBodySchema = z.object({
  verdict: VerdictSchema,
  summary: z.string(),
});
export type TesterCompleteBody = z.infer<typeof TesterCompleteBodySchema>;

export const TesterCompleteResponseSchema = z.object({
  status: RunStatusSchema,
  findings: z.array(
    z.object({
      id: z.string(),
      type: FindingTypeSchema,
      severity: SeveritySchema,
      title: z.string(),
      description: z.string(),
      evidence: FindingEvidenceSchema,
      status: FindingStatusSchema,
      createdAt: z.number(),
    }),
  ),
});
export type TesterCompleteResponse = z.infer<typeof TesterCompleteResponseSchema>;
