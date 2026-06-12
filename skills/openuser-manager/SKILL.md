---
name: openuser-manager
description: |
  Operating manual for the orchestrating agent: how to ensure the OpenUser daemon is running,
  register the current project, design personas from PRD/codebase knowledge, design saved test
  flows, dispatch fresh tester subagents per harness, monitor runs, triage findings, and report
  results upstream. Use this skill whenever a user says "test my feature", "run a smoke test",
  "set up personas", "triage findings", or any variant of "use OpenUser to check my app."
---

# openuser-manager — Operating Manual

## When to invoke this skill

Use this skill in any of these situations:

- The user says "test [feature / flow / page / checkout / registration / anything in the app]."
- The user says "set up OpenUser personas" or "create a test suite."
- The user says "what did OpenUser find?" or "triage the findings."
- You have just shipped a code change and want automated user-perspective verification.
- The user says "test what I just built" — derive goals from the diff.
- You need to promote an ad-hoc run to a saved test.

Never invoke the tester tools yourself. You are the manager. Your job ends when you hand the
tester prompt to a fresh subagent and then retrieve the result via `get_run` once it completes.

---

## Step 0 — Ensure daemon + register project

### 0a. Check if daemon is running

Call `list_projects`. If the MCP returns a connection error, the daemon is not running. Instruct
the user to run `npx openuser` in a terminal (or `openuser start --detach` for background). The
MCP will auto-spawn it if configured; if auto-spawn fails, surface the error verbatim.

### 0b. Register the project (first time per repo)

Check for `openuser.config.json` in the project root. If it exists, read `projectId` from it —
the project is already registered. If it does not exist (or you have no `projectId`):

```
register_project({
  name: "<project name from package.json or directory name>",
  path: "<absolute path to project root>",
  baseUrl: "<dev server URL, e.g. http://localhost:5173>",
  environments: [{ name: "local", url: "http://localhost:5173" }]
})
```

Write the returned `id` into `openuser.config.json` at the project root:

```json
{
  "projectId": "prj_<nanoid>",
  "name": "<name>",
  "baseUrl": "<baseUrl>"
}
```

---

## Step 1 — Design personas

Personas are the heart of OpenUser. A poorly designed persona produces shallow runs; a
well-designed persona catches real user pain.

### What makes a good persona

1. **Grounded in a real user archetype** — base it on PRD user stories, support tickets, or
   actual user research. Do not invent fictional needs that do not match the app.
2. **Behaviorally specific** — `patience: "low"` means the tester gives up after 2 retries;
   `readingStyle: "skims"` means the tester will miss fine print. These values drive real
   tester behavior through the skill.
3. **Knowledgeable in the right way** — `productKnowledge` captures what the persona *already
   knows* (not what they should discover). A first-time buyer knows nothing; a reseller knows
   SKU codes and bulk-pricing rules.
4. **Vocabulary-accurate** — `vocabulary` tells the tester which words to use in findings
   ("the 'Checkout' button", not "the submit element at #checkout-btn"). This keeps findings
   readable by non-developers.
5. **Single credential set or clear signup path** — never leave `credentials` empty unless you
   also provide `signupInstructions`. Testers must be able to log in.

### Persona creation call

```
create_persona({
  projectId: "<prj_id>",
  name: "<display name>",
  role: "<short role key>",
  identity: {
    fullName: "...",
    roleLabel: "...",
    credentials: { username: "...", password: "..." },
    locale: "en-US"
  },
  behavior: {
    techSavviness: "novice" | "average" | "expert",
    patience: "low" | "medium" | "high",
    readingStyle: "skims" | "reads",
    device: "desktop" | "mobile",
    viewport: { width: 1280, height: 720 },
    habits: "<free text describing typical usage patterns>"
  },
  knowledge: {
    productKnowledge: "<what they already know>",
    expectations: "<what they expect the product to do>",
    vocabulary: "<words they use for key UI elements>"
  },
  notes: "<optional extra context for the tester>"
})
```

### Example persona A — First-time buyer

```json
{
  "name": "Siti (First-time Buyer)",
  "role": "first_time_buyer",
  "identity": {
    "fullName": "Siti Rahimah",
    "roleLabel": "First-time buyer",
    "credentials": { "username": "siti@example.com", "password": "TestPass123!" },
    "locale": "en-MY"
  },
  "behavior": {
    "techSavviness": "novice",
    "patience": "low",
    "readingStyle": "skims",
    "device": "desktop",
    "viewport": { "width": 1280, "height": 720 },
    "habits": "Landed from a WhatsApp link. Wants to buy one item and leave. Has never used this site before. Will abandon if confused after one failed attempt."
  },
  "knowledge": {
    "productKnowledge": "Knows the product name from a friend's recommendation. Does not know about bulk pricing, SKU codes, reseller tiers, or the checkout flow.",
    "expectations": "Expects to click a product, add to cart, pay with online banking, and receive a confirmation. Expects the process to take under 5 minutes.",
    "vocabulary": "Calls the shopping bag 'my cart', the final step 'checkout', and payment 'pay now'. Does not know developer terms like 'submit', 'API', or 'session'."
  },
  "notes": "This persona's patience is low — she gives up after 2 confusing screens. Any dead-end is a critical finding."
}
```

### Example persona B — Reseller

```json
{
  "name": "Ahmad (Reseller)",
  "role": "reseller",
  "identity": {
    "fullName": "Ahmad Farhan",
    "roleLabel": "Approved reseller",
    "credentials": { "username": "reseller@acme.com", "password": "ResellerTest99!" },
    "locale": "en-MY"
  },
  "behavior": {
    "techSavviness": "average",
    "patience": "medium",
    "readingStyle": "reads",
    "device": "desktop",
    "viewport": { "width": 1440, "height": 900 },
    "habits": "Logs in every weekday morning to check new stock, place bulk orders, and download invoices. Uses keyboard shortcuts where visible. Will try a second time if something fails, but will escalate to support after two failures."
  },
  "knowledge": {
    "productKnowledge": "Knows the reseller dashboard, bulk-order form, tiered pricing table, and invoice download flow. Has used the platform for 6 months. Knows SKU codes for top-selling products.",
    "expectations": "Expects the bulk-order flow to be fast (under 3 clicks to add an item). Expects the invoice to download as a PDF. Expects the stock count to update within seconds of placing an order.",
    "vocabulary": "Says 'reseller portal', 'bulk order', 'tier pricing', 'invoice', 'stock', 'SKU'. Uses the product's own terminology from the onboarding guide."
  },
  "notes": "Ahmad's runs should start from a logged-in checkpoint to avoid repeating login steps in every run."
}
```

---

## Step 2 — Design test flows (saved tests)

### Goal-writing rubric

A good test goal:

1. **Uses user-outcome language** — describes what the user is trying to achieve, not how the
   system implements it. Write "Buy one unit of [product] using online banking" — never write
   "click #add-to-cart then POST /api/orders".
2. **Is completable in one session** — a run should finish in under 15 minutes of tester time.
   Split multi-phase journeys across multiple tests, linked by checkpoints.
3. **Has a clear success state** — the `expectedOutcome` must be something a user can observe
   on the screen ("A confirmation page appears with an order number").
4. **Specifies preconditions** — what must be true before the run starts ("User is logged out",
   "Cart is empty", "Product SKU-001 has stock > 0").
5. **Never mentions selectors, endpoints, component names, or file paths** — those are code
   knowledge, not user knowledge. The tester must not receive them.

Bad goal: "Click the AddToCart button, verify the POST /api/cart returns 200."
Good goal: "Add a single unit of the featured product to the cart and verify it appears in the cart with the correct price."

### Test creation call

```
create_test({
  projectId: "<prj_id>",
  title: "<short display name>",
  goal: "<natural-language mission, 1-3 sentences>",
  preconditions: "<comma-separated or prose preconditions>",
  expectedOutcome: "<what the user sees when the goal is achieved>",
  defaultPersonaId: "<per_id>",
  priority: "low" | "medium" | "high",
  tags: ["smoke", "checkout", ...]
})
```

---

## Step 3 — "Test what I just built" (ad-hoc flow)

When the user says "test the feature I just built" or "test this PR":

1. **Read the diff or feature description.** Identify the user-facing change: what can a user
   now do, or what should now work differently?
2. **Derive 1-3 user goals** from the change. Express each as a one-sentence mission in
   user-outcome language (rubric above).
3. **Pick persona(s).** Choose the persona(s) most likely to exercise the change. If the change
   affects checkout, use the first-time buyer. If it affects the reseller dashboard, use the
   reseller. If uncertain, use the persona with the lowest tech-savviness — they will surface
   the most friction.
4. **Pick a checkpoint** (if any) that puts the tester in the right starting state. For a
   checkout change, a "logged-in, item in cart" checkpoint saves 3-4 setup steps.
5. **Call `prepare_run`** for each goal/persona pair:

```
prepare_run({
  projectId: "<prj_id>",
  adhocGoal: "<derived user-outcome goal>",
  personaId: "<per_id>",
  checkpointId: "<chk_id or omit>",
  environment: "local",
  agentLabel: "claude-code"
})
```

This returns `{ runId, token, testerPrompt }`.

6. **Dispatch** each run per Step 4 below.
7. After runs complete, call `get_run` and `get_findings` per Step 5.
8. **Optionally promote** passing ad-hoc runs to saved tests via the dashboard "Promote" button
   or `create_test({ source: "promoted_from_run", ... })`.

---

## Step 4 — Dispatch tester subagents

**HARD RULE: Never give testers any code knowledge beyond the server-generated `testerPrompt`.
Do not add file paths, component names, API routes, or implementation hints. The prompt is
already complete — augmenting it breaks the "real user" guarantee.**

The `testerPrompt` returned by `prepare_run` is self-contained. Your only job is to wrap it
in a harness-appropriate dispatch call.

### Claude Code (Task tool)

Spawn a fresh Task-tool subagent whose only configured MCP is the openuser tester MCP
(`openuser mcp --role tester`). Use the following dispatch pattern:

```
Task({
  description: "OpenUser tester run <runId>",
  prompt: "<testerPrompt exactly as returned by prepare_run — do not modify>",
  // The subagent must have the openuser tester MCP configured and NO other code tools.
  // It must NOT have access to the filesystem, editor tools, or any source-reading tool.
})
```

The subagent will call `begin_run`, then loop `browser_snapshot → act → report_finding` until
it calls `complete_run`. You do not need to monitor it in real time; poll via `get_run` (Step 5).

### Codex / opencode (paste-prompt recipe)

Codex and opencode do not have a Task tool. Use the copy-prompt flow:

1. From the dashboard → Tests → Run → copy the generated prompt (it equals `testerPrompt`).
2. Open a new Codex session with the openuser tester MCP configured and no project files
   mounted.
3. Paste the prompt as the initial user message.
4. Codex will call `begin_run` and proceed autonomously.

### Cursor (agent mode)

1. Open Cursor in a new window with no project folder open (or open a blank scratch folder).
2. Configure only the openuser tester MCP in Cursor's MCP settings.
3. Paste `testerPrompt` into the chat as the first message.
4. Cursor's agent mode will use the tester tools until `complete_run`.

---

## Step 5 — Monitor runs

Poll with `get_run({ runId: "<run_id>" })`. The response includes `status` and `verdict`.

- `status: "running"` — still in progress; poll again in 30s.
- `status: "passed"` — goal achieved, no critical/high findings.
- `status: "failed"` — goal achieved but critical/high findings exist, or partial verdict.
- `status: "blocked"` — tester could not achieve goal.
- `status: "aborted"` — watchdog timeout; check the auto-saved checkpoint for resume material.

For live visibility, open the dashboard run detail page (the daemon URL + `/runs/<runId>`).

---

## Step 6 — Triage findings

Retrieve findings: `get_findings({ projectId: "<prj_id>", status: "open" })`.

### Severity guide

| Severity | Definition | Action |
|---|---|---|
| `critical` | Goal impossible or data loss | Fix before merging; block the PR |
| `high` | Goal blocked but a workaround exists | Fix before merging unless explicitly deferred |
| `medium` | Significant friction; user confused but can continue | Fix in this sprint or file issue |
| `low` | Papercut; minor wording or cosmetic issue | File issue, fix opportunistically |

### What to fix vs acknowledge vs dismiss

- **Fix**: critical and high findings that reproduce on a fresh run.
- **Acknowledge** (`update_finding({ id, status: "acknowledged" })`): known issues already
  tracked, out-of-scope findings (e.g. third-party widgets), or findings in features not yet
  shipped.
- **Dismiss** (`update_finding({ id, status: "dismissed" })`): false positives where the
  tester misunderstood a correct UI (explain why in your reply to the user). Dismiss sparingly.

---

## Step 7 — Promote ad-hoc runs to saved tests

When an ad-hoc run produces findings worth re-running on future changes, promote it:

```
create_test({
  projectId: "<prj_id>",
  title: "<concise title derived from the goal>",
  goal: "<adhocGoal from the run>",
  preconditions: "<preconditions you used>",
  expectedOutcome: "<what passing looks like>",
  defaultPersonaId: "<per_id used in the run>",
  source: "promoted_from_run",
  priority: "high" | "medium" | "low",
  tags: [...]
})
```

---

## Step 8 — Report results to the orchestrator

OpenUser returns structured results — what you do with them is your orchestrator's business.
Typical patterns:

- **Post to a kanban** (e.g. Linear, Jira): call `get_report({ runId })` for the markdown
  report; attach finding screenshots from the artifact paths in the evidence JSON; post as a
  comment on the PR or task.
- **Block a merge**: if any `critical` or `high` finding is `open`, surface it to the user
  with severity, title, and evidence path.
- **Continue shipping**: if `status: "passed"`, summarize the run verdict and tell the user
  all user-facing goals were achieved.
- **Re-run after fix**: call `prepare_run` again for the same test; dispatch a new tester.

Never make up findings. Never summarize what "probably" happened. Read the structured data
from `get_run` and `get_findings` and relay it faithfully.

---

## Quick reference — all manager tools

| Tool | When to use |
|---|---|
| `register_project` | First time in a repo. Writes to `openuser.config.json`. |
| `list_projects` | Enumerate registered projects; verify daemon is running. |
| `create_persona` | Design a new user archetype (Step 1). |
| `update_persona` | Edit an existing persona (update credentials, behavior, or notes). |
| `list_personas` | Show all personas for a project; pick one for a run. |
| `create_test` | Save a new test flow or promote an ad-hoc run (Step 7). |
| `update_test` | Edit a test's goal, preconditions, priority, or tags. |
| `list_tests` | Enumerate saved tests; used when running a full smoke suite. |
| `prepare_run` | Generate a run token + testerPrompt (Steps 3 and 4). |
| `get_run` | Poll run status; retrieve steps, findings, and video path (Step 5). |
| `list_runs` | List recent runs for a project filtered by status. |
| `get_findings` | Retrieve all findings for a project filtered by severity/type/status. |
| `update_finding` | Triage a finding: set status to acknowledged, resolved, or dismissed. |
| `list_checkpoints` | Show saved checkpoints for a project/persona. |
| `delete_checkpoint` | Remove a stale checkpoint (e.g., after credentials change). |
| `get_report` | Retrieve the markdown run report with findings and evidence links. |
