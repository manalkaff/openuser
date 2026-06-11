import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  PersonaIdentitySchema,
  PersonaBehaviorSchema,
  PersonaKnowledgeSchema,
} from '@openuser/shared';
import {
  postProject,
  getProjects,
  postPersona,
  patchPersona,
  getPersonas,
  postTest,
  patchTest,
  getTests,
  postRun,
  getRuns,
  getRun,
  getRunReport,
  getFindings,
  patchFinding,
  getCheckpoints,
  deleteCheckpoint,
  type HttpClientOptions,
  ApiError,
} from '../http-client.js';

function mcpError(err: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
  const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
  return { content: [{ type: 'text', text: msg }], isError: true };
}

function ok(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function registerManagerTools(server: McpServer, opts: HttpClientOptions): void {
  // ── 1. register_project ────────────────────────────────────────────────────
  server.registerTool(
    'register_project',
    {
      description: 'Register a project with OpenUser (name, local path, base URL, optional environments and viewport).',
      inputSchema: {
        name: z.string().min(1).describe('Human-readable project name'),
        path: z.string().min(1).describe('Absolute path to the project root on disk'),
        baseUrl: z.string().url().describe('Default base URL for the running app, e.g. http://localhost:5173'),
        environments: z
          .array(z.object({ name: z.string(), url: z.string().url() }))
          .optional()
          .describe('Named environment overrides, e.g. [{name:"staging",url:"https://staging.example.com"}]'),
        defaultViewport: z
          .object({ width: z.number().int().positive(), height: z.number().int().positive() })
          .optional()
          .describe('Default viewport size (defaults to 1280×720)'),
      },
    },
    async (input) => {
      try {
        const project = await postProject(opts, input as Parameters<typeof postProject>[1]);
        return ok(project);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 2. list_projects ───────────────────────────────────────────────────────
  server.registerTool(
    'list_projects',
    {
      description: 'List all registered projects with open finding counts and last run timestamps.',
      inputSchema: {},
    },
    async () => {
      try {
        const projects = await getProjects(opts);
        return ok(projects);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 3. create_persona ──────────────────────────────────────────────────────
  server.registerTool(
    'create_persona',
    {
      description: 'Create a user persona for a project. Personas embody real user archetypes (identity, behavior, knowledge).',
      inputSchema: {
        projectId: z.string().describe('ID of the project this persona belongs to (prj_...)'),
        name: z.string().min(1).describe('Short display name, e.g. "First-time Buyer"'),
        role: z.string().min(1).describe('Role label, e.g. "reseller", "admin", "guest"'),
        identity: PersonaIdentitySchema.describe('Full identity: fullName, roleLabel, credentials or signupInstructions, locale'),
        behavior: PersonaBehaviorSchema.describe('Behavior profile: techSavviness, patience, readingStyle, device, viewport, habits'),
        knowledge: PersonaKnowledgeSchema.describe('Knowledge profile: productKnowledge, expectations, vocabulary'),
        notes: z.string().optional().describe('Free-form notes visible to the tester subagent'),
        archived: z.boolean().optional().describe('Archive this persona (default false)'),
      },
    },
    async (input) => {
      try {
        const { projectId, ...body } = input;
        const persona = await postPersona(opts, projectId, body as Parameters<typeof postPersona>[2]);
        return ok(persona);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 4. update_persona ──────────────────────────────────────────────────────
  server.registerTool(
    'update_persona',
    {
      description: 'Update fields on an existing persona.',
      inputSchema: {
        personaId: z.string().describe('ID of the persona to update (per_...)'),
        name: z.string().min(1).optional(),
        role: z.string().min(1).optional(),
        identity: PersonaIdentitySchema.optional(),
        behavior: PersonaBehaviorSchema.optional(),
        knowledge: PersonaKnowledgeSchema.optional(),
        notes: z.string().optional(),
        archived: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        const { personaId, ...body } = input;
        const persona = await patchPersona(opts, personaId, body as Parameters<typeof patchPersona>[2]);
        return ok(persona);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 5. list_personas ───────────────────────────────────────────────────────
  server.registerTool(
    'list_personas',
    {
      description: 'List all personas for a project.',
      inputSchema: {
        projectId: z.string().describe('ID of the project (prj_...)'),
      },
    },
    async (input) => {
      try {
        const personas = await getPersonas(opts, input.projectId);
        return ok(personas);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 6. create_test ─────────────────────────────────────────────────────────
  server.registerTool(
    'create_test',
    {
      description:
        'Create a saved test. Set source to "promoted_from_run" when promoting an ad-hoc run to a reusable test.',
      inputSchema: {
        projectId: z.string().describe('ID of the project (prj_...)'),
        title: z.string().min(1).describe('Short test title'),
        goal: z.string().min(1).describe('Natural-language mission the tester subagent will pursue'),
        preconditions: z.string().optional().describe('What must be true before the run starts'),
        expectedOutcome: z.string().optional().describe('What a successful run looks like'),
        defaultPersonaId: z.string().optional().describe('Default persona ID to pre-select in prepare_run'),
        priority: z.enum(['low', 'medium', 'high']).optional().describe('Test priority (default: medium)'),
        tags: z.array(z.string()).optional().describe('Tag strings for filtering'),
        source: z
          .enum(['manual', 'agent', 'promoted_from_run'])
          .optional()
          .describe('Origin of this test (default: manual)'),
      },
    },
    async (input) => {
      try {
        const { projectId, ...body } = input;
        const test = await postTest(opts, projectId, body as Parameters<typeof postTest>[2]);
        return ok(test);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 7. update_test ─────────────────────────────────────────────────────────
  server.registerTool(
    'update_test',
    {
      description: 'Update fields on an existing test.',
      inputSchema: {
        testId: z.string().describe('ID of the test to update (tst_...)'),
        title: z.string().min(1).optional(),
        goal: z.string().min(1).optional(),
        preconditions: z.string().optional(),
        expectedOutcome: z.string().optional(),
        defaultPersonaId: z.string().optional(),
        priority: z.enum(['low', 'medium', 'high']).optional(),
        tags: z.array(z.string()).optional(),
        archived: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        const { testId, ...body } = input;
        const test = await patchTest(opts, testId, body as Parameters<typeof patchTest>[2]);
        return ok(test);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 8. list_tests ──────────────────────────────────────────────────────────
  server.registerTool(
    'list_tests',
    {
      description: 'List all tests for a project, including the last run status.',
      inputSchema: {
        projectId: z.string().describe('ID of the project (prj_...)'),
      },
    },
    async (input) => {
      try {
        const tests = await getTests(opts, input.projectId);
        return ok(tests);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 9. prepare_run ─────────────────────────────────────────────────────────
  server.registerTool(
    'prepare_run',
    {
      description: `Prepare a new run. Returns {runId, token, testerPrompt}.

IMPORTANT: After calling prepare_run, copy the testerPrompt and hand it VERBATIM to a FRESH subagent that has ONLY the openuser tester MCP configured. The tester subagent must NOT have code access. The prompt already contains the token and complete instructions — do not modify it.`,
      inputSchema: {
        projectId: z.string().describe('ID of the project (prj_...)'),
        testId: z
          .string()
          .optional()
          .describe('ID of a saved test (tst_...). Provide exactly one of testId or adhocGoal.'),
        adhocGoal: z
          .string()
          .optional()
          .describe(
            'Natural-language goal for an ad-hoc run. Provide exactly one of testId or adhocGoal.',
          ),
        personaId: z.string().describe('ID of the persona to embody (per_...)'),
        checkpointId: z
          .string()
          .optional()
          .describe('ID of a checkpoint to restore browser state from (chk_...)'),
        environment: z
          .string()
          .optional()
          .describe('Named environment to use (must match a name in project environments)'),
        agentLabel: z
          .string()
          .optional()
          .describe('Human-readable label for the agent running this test, e.g. "claude-opus-4"'),
      },
    },
    async (input) => {
      try {
        const result = await postRun(opts, input as Parameters<typeof postRun>[1]);
        return ok({
          runId: result.runId,
          token: result.token,
          testerPrompt: result.testerPrompt,
          _instruction:
            '⬆ Hand the testerPrompt above VERBATIM to a FRESH subagent that has ONLY the openuser tester MCP configured. The prompt contains the token and full instructions. Do not modify it.',
        });
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 10. get_run ────────────────────────────────────────────────────────────
  server.registerTool(
    'get_run',
    {
      description: 'Get a run by ID, including all steps and findings.',
      inputSchema: {
        runId: z.string().describe('ID of the run (run_...)'),
      },
    },
    async (input) => {
      try {
        const run = await getRun(opts, input.runId);
        return ok(run);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 11. list_runs ──────────────────────────────────────────────────────────
  server.registerTool(
    'list_runs',
    {
      description: 'List runs, optionally filtered by project, status, and count limit.',
      inputSchema: {
        projectId: z.string().optional().describe('Filter by project ID (prj_...)'),
        status: z
          .enum(['pending', 'running', 'passed', 'blocked', 'failed', 'aborted'])
          .optional()
          .describe('Filter by run status'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum number of runs to return (default: 50)'),
      },
    },
    async (input) => {
      try {
        const runs = await getRuns(opts, input as Parameters<typeof getRuns>[1]);
        return ok(runs);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 12. get_findings ───────────────────────────────────────────────────────
  server.registerTool(
    'get_findings',
    {
      description: 'Get findings, optionally filtered by project, severity, type, and status.',
      inputSchema: {
        projectId: z.string().optional().describe('Filter by project ID (prj_...)'),
        severity: z
          .enum(['critical', 'high', 'medium', 'low'])
          .optional()
          .describe('Filter by finding severity'),
        type: z
          .enum(['functional', 'console', 'network', 'ux_confusion'])
          .optional()
          .describe('Filter by finding type'),
        status: z
          .enum(['open', 'acknowledged', 'resolved', 'dismissed'])
          .optional()
          .describe('Filter by finding status'),
      },
    },
    async (input) => {
      try {
        const findings = await getFindings(opts, input as Parameters<typeof getFindings>[1]);
        return ok(findings);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 13. update_finding ─────────────────────────────────────────────────────
  server.registerTool(
    'update_finding',
    {
      description: 'Update the triage status of a finding.',
      inputSchema: {
        findingId: z.string().describe('ID of the finding to update (fnd_...)'),
        status: z
          .enum(['open', 'acknowledged', 'resolved', 'dismissed'])
          .describe('New triage status'),
      },
    },
    async (input) => {
      try {
        const finding = await patchFinding(opts, input.findingId, { status: input.status });
        return ok(finding);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 14. list_checkpoints ───────────────────────────────────────────────────
  server.registerTool(
    'list_checkpoints',
    {
      description: 'List all saved checkpoints for a project.',
      inputSchema: {
        projectId: z.string().describe('ID of the project (prj_...)'),
      },
    },
    async (input) => {
      try {
        const checkpoints = await getCheckpoints(opts, input.projectId);
        return ok(checkpoints);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 15. delete_checkpoint ─────────────────────────────────────────────────
  server.registerTool(
    'delete_checkpoint',
    {
      description: 'Delete a checkpoint and its associated storage state files.',
      inputSchema: {
        checkpointId: z.string().describe('ID of the checkpoint to delete (chk_...)'),
      },
    },
    async (input) => {
      try {
        await deleteCheckpoint(opts, input.checkpointId);
        return ok({ deleted: true, checkpointId: input.checkpointId });
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 16. get_report ────────────────────────────────────────────────────────
  server.registerTool(
    'get_report',
    {
      description:
        'Get the markdown report for a run, including all findings with evidence links.',
      inputSchema: {
        runId: z.string().describe('ID of the run (run_...)'),
      },
    },
    async (input) => {
      try {
        const report = await getRunReport(opts, input.runId);
        return { content: [{ type: 'text' as const, text: report }] };
      } catch (err) {
        return mcpError(err);
      }
    },
  );
}
