import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  testerBegin,
  testerSnapshot,
  testerAction,
  testerScreenshot,
  testerFinding,
  testerCheckpoint,
  testerComplete,
  fetchArtifactBytes,
  ApiError,
  type HttpClientOptions,
} from '../http-client.js';

/** In-process session state. Set once by begin_run, used by all subsequent tools. */
interface TesterSession {
  token: string;
  runId: string;
}

let session: TesterSession | null = null;

function mcpError(err: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
  const msg = err instanceof ApiError ? `API error ${err.status}: ${err.message}` : String(err);
  return { content: [{ type: 'text', text: msg }], isError: true };
}

function ok(data: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function requireSession(): { content: { type: 'text'; text: string }[]; isError: true } | null {
  if (!session) {
    return {
      content: [
        {
          type: 'text',
          text:
            'You must call begin_run(token) first. Obtain the token from your manager via prepare_run, ' +
            'then call begin_run with it before using any other tester tool.',
        },
      ],
      isError: true,
    };
  }
  return null;
}

export function registerTesterTools(server: McpServer, baseUrl: string): void {
  function getOpts(): HttpClientOptions {
    const tok = session?.token;
    return tok !== undefined ? { baseUrl, token: tok } : { baseUrl };
  }

  // ── 1. begin_run ──────────────────────────────────────────────────────────
  server.registerTool(
    'begin_run',
    {
      description:
        'Start the run identified by token. Caches the token in-process for the rest of the session. ' +
        'Returns your persona card, mission, optional journey notes from a resumed checkpoint, and the first page snapshot.',
      inputSchema: {
        token: z
          .string()
          .startsWith('rt_')
          .describe('Run token returned by prepare_run (format: rt_...)'),
      },
    },
    async (input) => {
      try {
        // Set token before calling begin so the auth header is sent
        session = { token: input.token, runId: '' };
        const result = await testerBegin(getOpts());
        // The server returns the runId embedded; we store it for reference in error messages
        // (the run ID is available via get_run on the manager side; we don't need it here for routing)
        // Store a placeholder so session is non-null
        session = { token: input.token, runId: 'active' };
        return ok(result);
      } catch (err) {
        session = null; // reset on failure
        return mcpError(err);
      }
    },
  );

  // ── 2. browser_snapshot ───────────────────────────────────────────────────
  server.registerTool(
    'browser_snapshot',
    {
      description:
        'Get the current page accessibility tree (a11y outline) with interactive element refs (e.g. [ref=e12]). ' +
        'Use refs in browser_click, browser_type, browser_select. Always snapshot after navigation or unexpected changes.',
      inputSchema: {},
    },
    async () => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const snapshot = await testerSnapshot(getOpts());
        return ok(snapshot);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 3. browser_navigate ───────────────────────────────────────────────────
  server.registerTool(
    'browser_navigate',
    {
      description:
        'Navigate to a URL. Only navigate to URLs you can see as links or that were provided in your mission. ' +
        'Do not guess URLs — navigate by what is visible on the page. Returns updated page snapshot.',
      inputSchema: {
        url: z.string().url().describe('URL to navigate to'),
        note: z.string().optional().describe('Optional in-character thought about this navigation'),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const result = await testerAction(getOpts(), { kind: 'navigate', url: input.url, ...(input.note !== undefined && { note: input.note }) } as Parameters<typeof testerAction>[1]);
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return ok(result.snapshot);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 4. browser_click ──────────────────────────────────────────────────────
  server.registerTool(
    'browser_click',
    {
      description:
        'Click an element by its ref (e.g. "e12" from browser_snapshot). ' +
        'If the page changed since your last snapshot, you will get an error — call browser_snapshot first. ' +
        'Returns updated page snapshot.',
      inputSchema: {
        ref: z.string().describe('Element ref from browser_snapshot, e.g. "e12"'),
        note: z.string().optional().describe('Optional in-character thought about why you are clicking this'),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const result = await testerAction(getOpts(), { kind: 'click', ref: input.ref, ...(input.note !== undefined && { note: input.note }) } as Parameters<typeof testerAction>[1]);
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return ok(result.snapshot);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 5. browser_type ───────────────────────────────────────────────────────
  server.registerTool(
    'browser_type',
    {
      description:
        'Type text into an input element by its ref. Optionally submit (press Enter) after typing. ' +
        'Returns updated page snapshot.',
      inputSchema: {
        ref: z.string().describe('Element ref from browser_snapshot, e.g. "e7"'),
        text: z.string().describe('Text to type into the element'),
        submit: z
          .boolean()
          .optional()
          .describe('If true, press Enter after typing (default: false)'),
        note: z.string().optional().describe('Optional in-character thought'),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const result = await testerAction(getOpts(), {
          kind: 'type',
          ref: input.ref,
          text: input.text,
          ...(input.submit !== undefined && { submit: input.submit }),
          ...(input.note !== undefined && { note: input.note }),
        } as Parameters<typeof testerAction>[1]);
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return ok(result.snapshot);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 6. browser_select ─────────────────────────────────────────────────────
  server.registerTool(
    'browser_select',
    {
      description:
        'Select an option in a <select> element by its ref and value. Returns updated page snapshot.',
      inputSchema: {
        ref: z.string().describe('Element ref of the <select> element'),
        value: z.string().describe('Option value to select'),
        note: z.string().optional().describe('Optional in-character thought'),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const result = await testerAction(getOpts(), {
          kind: 'select',
          ref: input.ref,
          value: input.value,
          ...(input.note !== undefined && { note: input.note }),
        } as Parameters<typeof testerAction>[1]);
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return ok(result.snapshot);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 7. browser_scroll ─────────────────────────────────────────────────────
  server.registerTool(
    'browser_scroll',
    {
      description:
        'Scroll the page up or down by a pixel amount (default 400px). ' +
        'Use when content is below the fold and not yet in the snapshot tree. Returns updated page snapshot.',
      inputSchema: {
        direction: z.enum(['up', 'down']).describe('Scroll direction'),
        amountPx: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Pixels to scroll (default: 400)'),
        note: z.string().optional().describe('Optional in-character thought'),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const result = await testerAction(getOpts(), {
          kind: 'scroll',
          direction: input.direction,
          ...(input.amountPx !== undefined && { amountPx: input.amountPx }),
          ...(input.note !== undefined && { note: input.note }),
        } as Parameters<typeof testerAction>[1]);
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return ok(result.snapshot);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 8. browser_back ───────────────────────────────────────────────────────
  server.registerTool(
    'browser_back',
    {
      description:
        'Press the browser Back button. Use when you want to undo navigation. Returns updated page snapshot.',
      inputSchema: {
        note: z.string().optional().describe('Optional in-character thought about going back'),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const result = await testerAction(getOpts(), { kind: 'back', ...(input.note !== undefined && { note: input.note }) } as Parameters<typeof testerAction>[1]);
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return ok(result.snapshot);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 9. browser_wait ───────────────────────────────────────────────────────
  server.registerTool(
    'browser_wait',
    {
      description:
        'Wait for a number of seconds (max 30). Use sparingly — only when the app needs time to load or process. ' +
        'Returns updated page snapshot.',
      inputSchema: {
        seconds: z
          .number()
          .int()
          .min(1)
          .max(30)
          .describe('Seconds to wait (max 30)'),
        note: z.string().optional().describe('Optional note about why you are waiting'),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const result = await testerAction(getOpts(), {
          kind: 'wait',
          seconds: input.seconds,
          ...(input.note !== undefined && { note: input.note }),
        } as Parameters<typeof testerAction>[1]);
        if (!result.ok) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return ok(result.snapshot);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 10. browser_screenshot ────────────────────────────────────────────────
  server.registerTool(
    'browser_screenshot',
    {
      description:
        'Take an on-demand screenshot of the current page for visual inspection. ' +
        'Use when the accessibility tree is insufficient (e.g. visual layout issues, charts, images). ' +
        'Returns the image.',
      // Per contracts §9, browser_screenshot takes no input — POST /api/tester/screenshot
      // has an empty body and records the shot on the server side.
      inputSchema: {},
    },
    async () => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const result = await testerScreenshot(getOpts());
        // Fetch the image bytes from the artifacts endpoint
        // result.path is relative to the artifacts dir, e.g. "run_abc/shots/xyz.png"
        const { data, mimeType } = await fetchArtifactBytes(baseUrl, result.path);
        return {
          content: [
            {
              type: 'image' as const,
              data,
              mimeType,
            },
          ],
        };
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 11. report_finding ────────────────────────────────────────────────────
  server.registerTool(
    'report_finding',
    {
      description:
        'Report a problem or confusion you experienced as a user. ' +
        'Write description in the USER\'s voice ("I tried to..., but..."), not as a developer. ' +
        'The server automatically attaches the current screenshot and recent console/network errors as evidence.',
      inputSchema: {
        type: z
          .enum(['functional', 'console', 'network', 'ux_confusion'])
          .describe(
            'functional = something is broken; console = JS error; network = HTTP error; ux_confusion = confusing UX even if technically working',
          ),
        severity: z
          .enum(['critical', 'high', 'medium', 'low'])
          .describe(
            'critical = goal impossible / data loss; high = goal blocked with workaround; medium = significant friction; low = minor papercut',
          ),
        title: z.string().min(1).describe('Short finding title, e.g. "Checkout button missing after payment selection"'),
        description: z
          .string()
          .min(1)
          .describe(
            'User-voice narrative describing what happened. Write as the persona, e.g. "I selected bank transfer but the checkout button disappeared. I had no idea what to do next."',
          ),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const finding = await testerFinding(getOpts(), input);
        return ok(finding);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 12. save_checkpoint ───────────────────────────────────────────────────
  server.registerTool(
    'save_checkpoint',
    {
      description:
        'Save a checkpoint of the current browser session (cookies, localStorage, session storage) and your journey progress. ' +
        'Save after costly setup (login, multi-step onboarding) and before risky actions. ' +
        'Future runs can resume from this checkpoint.',
      inputSchema: {
        name: z.string().min(1).describe('Short descriptive name for the checkpoint, e.g. "Logged in as reseller"'),
        description: z.string().optional().describe('Longer description of what this checkpoint represents'),
        journeyNotes: z
          .string()
          .min(1)
          .describe('Notes about your progress so far in this run, so a future session can pick up in context'),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const checkpoint = await testerCheckpoint(getOpts(), input as Parameters<typeof testerCheckpoint>[1]);
        return ok(checkpoint);
      } catch (err) {
        return mcpError(err);
      }
    },
  );

  // ── 13. complete_run ──────────────────────────────────────────────────────
  server.registerTool(
    'complete_run',
    {
      description:
        'Mark the run as complete with a verdict and summary narrative. ' +
        'Returns the final run status and all findings recorded during this run. ' +
        'Call this when you have achieved your goal, when you are blocked and cannot proceed, or when you have explored as much as your persona\'s patience allows.',
      inputSchema: {
        verdict: z
          .enum(['goal_achieved', 'blocked', 'partial'])
          .describe(
            'goal_achieved = mission completed; blocked = could not complete due to a blocker; partial = completed some but not all objectives',
          ),
        summary: z
          .string()
          .min(1)
          .describe(
            'Narrative summary of the run in the user\'s voice: what you tried, what worked, what did not, and the overall experience.',
          ),
      },
    },
    async (input) => {
      const sessionErr = requireSession();
      if (sessionErr) return sessionErr;
      try {
        const result = await testerComplete(getOpts(), input);
        // Clear session after completion
        session = null;
        return ok(result);
      } catch (err) {
        return mcpError(err);
      }
    },
  );
}
