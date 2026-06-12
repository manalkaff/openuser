// Enums & enum types
export {
  RunStatusSchema,
  type RunStatus,
  VerdictSchema,
  type Verdict,
  FindingTypeSchema,
  type FindingType,
  SeveritySchema,
  type Severity,
  FindingStatusSchema,
  type FindingStatus,
  StepKindSchema,
  type StepKind,
  TestSourceSchema,
  type TestSource,
} from './enums.js';

// Constants & helpers
export { DEFAULT_PORT, newId, newRunToken, hashToken } from './helpers.js';

// Persona types
export {
  PersonaIdentitySchema,
  type PersonaIdentity,
  PersonaBehaviorSchema,
  type PersonaBehavior,
  PersonaKnowledgeSchema,
  type PersonaKnowledge,
} from './persona.js';

// Core types
export {
  FindingEvidenceSchema,
  type FindingEvidence,
  TesterActionSchema,
  type TesterAction,
  PageSnapshotSchema,
  type PageSnapshot,
  LogEventSchema,
  type LogEvent,
} from './types.js';

// API schemas
export {
  HealthResponseSchema,
  type HealthResponse,
  CreateProjectBodySchema,
  type CreateProjectBody,
  PatchProjectBodySchema,
  type PatchProjectBody,
  CreatePersonaBodySchema,
  type CreatePersonaBody,
  PatchPersonaBodySchema,
  type PatchPersonaBody,
  CreateTestBodySchema,
  type CreateTestBody,
  PatchTestBodySchema,
  type PatchTestBody,
  PrepareRunBodySchema,
  type PrepareRunBody,
  PrepareRunResponseSchema,
  type PrepareRunResponse,
  ListRunsQuerySchema,
  type ListRunsQuery,
  PromoteRunBodySchema,
  type PromoteRunBody,
  PatchFindingBodySchema,
  type PatchFindingBody,
  ListFindingsQuerySchema,
  type ListFindingsQuery,
  PatchSettingsBodySchema,
  type PatchSettingsBody,
  TesterBeginResponseSchema,
  type TesterBeginResponse,
  TesterActionRequestSchema,
  type TesterActionRequest,
  TesterActionResponseSchema,
  type TesterActionResponse,
  TesterScreenshotResponseSchema,
  type TesterScreenshotResponse,
  TesterFindingBodySchema,
  type TesterFindingBody,
  TesterCheckpointBodySchema,
  type TesterCheckpointBody,
  TesterCompleteBodySchema,
  type TesterCompleteBody,
  TesterCompleteResponseSchema,
  type TesterCompleteResponse,
} from './api.js';

// WebSocket schemas
export {
  WsChannelSchema,
  type WsChannel,
  WsSubscribeMessageSchema,
  type WsSubscribeMessage,
  WsEventTypeSchema,
  type WsEventType,
  WsServerEventSchema,
  type WsServerEvent,
} from './ws.js';

// Entity types (DB row shapes as returned by the REST API)
export {
  type Project,
  type Persona,
  type Checkpoint,
  type Test,
  type Run,
  type Step,
  type Finding,
} from './entities.js';
