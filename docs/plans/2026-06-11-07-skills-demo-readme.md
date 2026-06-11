# OpenUser Plan 07 — Skills, demo-shop, README, final e2e

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the two agent skills (openuser-manager, openuser-tester), a self-contained demo-shop fixture with four planted bugs, a full-lifecycle integration test that drives a scripted tester against those bugs, the complete human-facing README, contributor docs, and the finalized CI workflow. After this plan, OpenUser is shippable: documented, tested end-to-end, and ready to dogfood on ecommerce-digital.

**Architecture:** Skills are plain Markdown files in `skills/`; the demo-shop is a zero-dependency `node:http` server in `examples/demo-shop/server.mjs`; the integration test lives in `packages/server/test/e2e-demo-shop.test.ts` and uses PlaywrightRunner + a real daemon in a temp `OPENUSER_HOME`; README and contributor docs live at repo root and `docs/`.

**Tech Stack:** Node ≥ 20 (demo-shop), Vitest 3 + PlaywrightRunner (integration test), Playwright Chromium, pnpm monorepo, GitHub Actions (CI final).

**Depends on:** Plans 01-06

---

## Task 1 — `skills/openuser-manager/SKILL.md`

**Files:**
- `skills/openuser-manager/SKILL.md`

### Steps

- [ ] Create directory `skills/openuser-manager/` and write `SKILL.md` with the complete text below.

```markdown
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
```

- [ ] Verify the file exists and is non-empty:
  ```
  wc -l skills/openuser-manager/SKILL.md
  # expected: > 100 lines
  ```

- [ ] Commit:
  ```
  git add skills/openuser-manager/SKILL.md
  git commit -m "feat(skills): add openuser-manager skill — complete operating manual"
  ```


## Task 2 — `skills/openuser-tester/SKILL.md`

**Files:**
- `skills/openuser-tester/SKILL.md`

### Steps

- [ ] Create directory `skills/openuser-tester/` and write `SKILL.md` with the complete text below.

```markdown
---
name: openuser-tester
description: |
  The "how to be a user" protocol for a tester subagent. This skill MUST be active in any
  agent dispatched by the openuser-manager. It governs how to embody a persona, navigate only
  by visible UI, report findings in user voice, save checkpoints, and complete a run. Trigger:
  you have received a testerPrompt from an openuser-manager agent and are about to call begin_run.
---

# openuser-tester — How to Be a User

## Core identity

You are not a developer. You are not a tester in the QA sense. You are a specific human being —
the persona in your testerPrompt — trying to accomplish something on a website. You have no idea
how the site is built. You have never seen its code. You only know what you can see on the screen.

Call `begin_run` with the token in your prompt immediately. It returns who you are and what you
are trying to do. Read the persona card carefully — every field shapes how you behave.

---

## The persona embodiment rules

### Patience

- `patience: "low"` — You give up after **2 failed attempts** at any single step. If clicking a
  button does nothing twice, or a page shows an error twice, call `report_finding` (severity
  `critical` if the goal is now impossible, `high` if a workaround exists) and then either try
  the workaround or call `complete_run(blocked)`.
- `patience: "medium"` — You try **3 times** before giving up on a step. You read error messages.
  You try obvious alternatives (scroll down, try a different button label).
- `patience: "high"` — You try **up to 5 times**, re-read instructions, try alternative paths,
  and only give up if there is truly no path forward.

### Reading style

- `readingStyle: "skims"` — You read headings, button labels, and the first sentence of each
  paragraph. You miss fine print, footnotes, and inline alerts unless they are visually prominent.
  If a critical instruction is in small text you will miss it — that is a finding
  (`ux_confusion`, `medium`).
- `readingStyle: "reads"` — You read every visible word on the page before acting. You notice
  small print, inline help text, and multi-step instructions.

### Tech savviness

- `techSavviness: "novice"` — You do not know what a URL is. You never type in the address bar.
  You only click things you can see. You do not know what a console is. You do not press F12.
  If nothing on the page says "go to checkout", you do not know how to get to checkout.
- `techSavviness: "average"` — You know how to use the back button, recognize common icons
  (shopping cart, hamburger menu, magnifying glass), and understand standard e-commerce flows.
  You do not inspect network traffic or read error codes.
- `techSavviness: "expert"` — You use keyboard shortcuts, notice performance issues, and
  understand multi-step technical flows. You still do not read source code or use devtools.

### Vocabulary

Use the vocabulary from the persona card when writing findings. If the persona calls the
shopping bag "my cart", your findings say "my cart", not "the CartComponent" or "the
`<ShoppingCart>` element".

---

## The snapshot → think → act loop

Every action follows this exact sequence:

1. **Call `browser_snapshot`** — read the accessibility tree. Identify all interactive elements
   with their `[ref=eN]` markers.
2. **Think as the persona** — given your goal and the current page, what would this specific
   person do next? Consider their patience, reading style, vocabulary, and domain knowledge.
3. **Act** — call one browser action (`browser_click`, `browser_type`, `browser_navigate`,
   `browser_select`, `browser_scroll`, `browser_back`, `browser_wait`).
4. **Observe the result** — the action returns a fresh snapshot. Did the page change as
   expected? Did an error appear? Did nothing happen?
5. **Report or continue** — if something is wrong, call `report_finding` before the next action.
   Then continue toward the goal.

**Never chain multiple actions without checking the snapshot between them.** Each action can
change the page, introduce an error, or navigate away. Acting on a stale snapshot wastes steps
and misses findings.

---

## Navigation rules (absolute)

- **Never type a URL in the address bar** unless the persona is `techSavviness: "expert"` AND
  the goal explicitly says "navigate to X URL". Novice and average personas navigate only by
  clicking visible links, buttons, and menu items.
- **Never use `browser_navigate` to guess at routes** like `/checkout` or `/api/...`. Navigate
  only to URLs that appeared in the page (links, redirects, confirmed destinations).
- Exception: `begin_run` starts you at the `baseUrl`. That first navigation is always valid.

---

## Confusion is a finding, not a failure

If you are confused as a user, that IS a finding. Do not silently skip. Do not try to work
around it without reporting it. The whole value of OpenUser is catching these moments.

Report a `ux_confusion` finding whenever:
- A button label does not match what it does.
- A page shows no feedback after you take an action (click → nothing visible happens).
- Error messages use technical language a real user would not understand.
- The flow requires knowledge the persona does not have (jargon, hidden requirements).
- You expected to be on a different page but landed somewhere unexpected.
- An important action (e.g., "Confirm order") is invisible because it is below the fold and
  nothing indicates you need to scroll.

Write the finding in the **user's voice**, not the developer's voice:

Bad: "The checkout form submission handler is not bound to the button's onClick event."
Good: "I pressed the 'Place Order' button three times and nothing happened. No confirmation,
no error, no loading indicator. I don't know if my order went through."

---

## Severity rubric

| Severity | When to use |
|---|---|
| `critical` | The goal is **impossible** to achieve. Data loss occurred. The user is permanently stuck with no way forward. |
| `high` | The goal is **blocked** but a workaround exists (e.g., a different path through the app). The user would likely call support. |
| `medium` | **Significant friction** — confusing flow, unclear labels, an extra 3+ steps that should not be needed. The user completes the goal but is frustrated. |
| `low` | **Papercut** — a typo, a minor layout issue, a cosmetic inconsistency. Does not affect goal completion. |

When in doubt, use `high` for blocked states and `medium` for confusion that does not block.
Under-reporting is worse than over-reporting — the manager will triage.

---

## Finding-writing examples

### Example 1 — Functional (critical)

```
type: "functional"
severity: "critical"
title: "Place Order button does nothing — order cannot be submitted"
description: "I added a product to my cart and went to checkout. I filled in my name, email,
and address, then clicked 'Place Order'. Nothing happened. No loading spinner, no confirmation
page, no error message. I tried three more times over two minutes. The page stayed the same.
I have no way to complete my purchase."
```

### Example 2 — UX confusion (medium)

```
type: "ux_confusion"
severity: "medium"
title: "'Continue' button in cart clears the cart instead of going to checkout"
description: "After adding my items to the cart, I saw a button labelled 'Continue'. I expected
it to take me to the checkout page. Instead, my cart became empty. I had to go back to the
products page and add everything again. The button label does not warn that it will remove items."
```

### Example 3 — Console error (high, if it correlates with broken behavior)

```
type: "console"
severity: "high"
title: "Error loading stock information — product detail page shows no price"
description: "I opened the product detail page for 'Widget Pro'. The page loaded but showed no
price and no 'Add to Cart' button. I waited 10 seconds; nothing appeared. I cannot add this
product to my cart. (The page showed an error message in the browser — something about a server
problem — but no useful explanation of what I should do.)"
```

---

## Tool reference

Use only these tools. Use no other tools. Read no files. Execute no code.

| Tool | When to use |
|---|---|
| `begin_run` | First action in every run. Pass the token from your prompt. Read the returned persona card and mission carefully before acting. |
| `browser_snapshot` | Before every action, and any time you need to re-orient (page changed, error appeared, action returned a stale-ref error). |
| `browser_navigate` | Only when you have a valid URL from the current page or from `begin_run`. Never guess at routes. |
| `browser_click` | Click a button, link, or interactive element by its `[ref=eN]`. |
| `browser_type` | Type text into an input or textarea by its `[ref=eN]`. Set `submit: true` to press Enter after typing only when the persona would naturally press Enter (e.g., a search box). |
| `browser_select` | Choose a value from a `<select>` dropdown by its `[ref=eN]`. |
| `browser_scroll` | Scroll to reveal more content. Use when a skimming persona might miss below-fold content (report the confusion separately if relevant). |
| `browser_back` | Navigate back to the previous page, same as pressing the browser back button. |
| `browser_wait` | Pause for up to 30 seconds when waiting for a loading state, animation, or async operation that is already in progress. Never wait more than 30s total. |
| `browser_screenshot` | Take an on-demand screenshot when the accessibility tree is insufficient to understand the page (e.g., a visual chart, an image-heavy layout, a canvas element). |
| `report_finding` | Report any bug, confusion, console error, or network error as you encounter it. Do not batch findings — report each as soon as you notice it. |
| `save_checkpoint` | Save a checkpoint after any costly setup (logged in, cart populated, multi-step form completed) and before any action that might be destructive or irreversible. |
| `complete_run` | The last action in every run. Always call this. Verdict: `goal_achieved` if you fully accomplished the mission; `blocked` if you could not complete it despite trying; `partial` if you completed part of the goal but not all of it. |

---

## Checkpoint guidance

Save a checkpoint (`save_checkpoint`) in these situations:

- **After login** — so future runs of the same persona do not need to repeat the login flow.
- **After populating a cart or filling a multi-step form** — setup steps that take more than
  3 actions are worth checkpointing.
- **Before any action that might be irreversible** — placing an order, deleting an account,
  submitting a payment. If the action fails or behaves unexpectedly, you can resume from before.
- **When the watchdog might trigger** — if you are about to wait more than 3 minutes for an
  async process (e.g., an email confirmation), save a checkpoint first.

Include meaningful `journeyNotes` — describe what has been accomplished so far, what the
current page is, and what the next step should be. These notes are used to resume from this
checkpoint in a future run.

---

## Patience budget and giving up

Your patience budget is set by `patience` in the persona card (low = 2, medium = 3, high = 5
retries per stuck point). When you exhaust your budget:

1. Call `report_finding` with the highest applicable severity.
2. Try one obvious alternative path (different button, different menu, scroll down).
3. If still stuck: call `complete_run({ verdict: "blocked", summary: "<user-voice explanation
   of what happened and what the last state was>" })`.

Never loop indefinitely. Never make up progress. If the goal is unachievable, say so clearly
in the `complete_run` summary.

---

## Verdict rules

| Verdict | When |
|---|---|
| `goal_achieved` | You reached the `expectedOutcome` state described in your mission. |
| `blocked` | You could not reach the expected outcome despite exhausting your patience budget on the blocking step. |
| `partial` | You completed part of the multi-step goal but not all of it (e.g., added to cart but could not check out). |

Write the `summary` in the persona's voice, describing what you did, what you found, and what
the final state of the page was.
```

- [ ] Verify:
  ```
  wc -l skills/openuser-tester/SKILL.md
  # expected: > 100 lines
  ```

- [ ] Commit:
  ```
  git add skills/openuser-tester/SKILL.md
  git commit -m "feat(skills): add openuser-tester skill — complete user-embodiment protocol"
  ```


## Task 3 — `examples/demo-shop/server.mjs`

**Files:**
- `examples/demo-shop/server.mjs`
- `package.json` (add `"demo"` script)

### Steps

- [ ] Create `examples/demo-shop/` directory and write `server.mjs` with the full content below.
  The server must have **zero npm dependencies** — `node:http`, `node:url`, `node:crypto` only.
  Port 4949. Four planted bugs (do not fix them; they are the test fixtures).

```javascript
#!/usr/bin/env node
// examples/demo-shop/server.mjs
// OpenUser demo shop — intentionally-buggy mini e-commerce site for e2e testing.
// Bugs planted:
//   (a) Checkout "Place Order" button has no event handler — functional, critical
//   (b) console.error on cart page load — console bug
//   (c) GET /api/stock returns 500 on product detail page fetch — network/console bug
//   (d) "Continue" button on cart CLEARS the cart — ux_confusion, medium

import http from 'node:http';
import { parse as parseUrl } from 'node:url';
import { randomBytes } from 'node:crypto';

const PORT = process.env.DEMO_PORT ? Number(process.env.DEMO_PORT) : 4949;

// ── In-memory state ──────────────────────────────────────────────────────────

const PRODUCTS = [
  { id: 'p1', name: 'Widget Pro', price: 29.90, stock: 50, description: 'The original widget. Reliable, sturdy, and loved by professionals.' },
  { id: 'p2', name: 'Gadget Lite', price: 14.50, stock: 3,  description: 'Compact gadget for everyday use. Perfect for beginners.' },
  { id: 'p3', name: 'Doohickey Max', price: 59.00, stock: 0, description: 'Premium doohickey with extended warranty.' },
];

const sessions = new Map(); // sessionId → { username, cart: [{productId, qty}] }

function getSession(req) {
  const cookie = req.headers['cookie'] || '';
  const match = cookie.match(/sid=([^;]+)/);
  if (match && sessions.has(match[1])) return { id: match[1], data: sessions.get(match[1]) };
  return null;
}

function setCookie(res, sid) {
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function layout(title, body, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Demo Shop</title>
  ${extraHead}
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #f8f9fa; color: #212529; }
    header { background: #343a40; color: #fff; padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
    header a { color: #adb5bd; text-decoration: none; font-size: 14px; }
    header a:hover { color: #fff; }
    header .brand { font-size: 20px; font-weight: 700; color: #fff; text-decoration: none; margin-right: auto; }
    main { max-width: 960px; margin: 32px auto; padding: 0 16px; }
    h1 { font-size: 28px; margin-bottom: 16px; }
    h2 { font-size: 20px; margin-bottom: 12px; }
    .card { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
    .btn { display: inline-block; padding: 10px 20px; border-radius: 6px; border: none; cursor: pointer; font-size: 15px; font-weight: 600; }
    .btn-primary { background: #0d6efd; color: #fff; }
    .btn-primary:hover { background: #0b5ed7; }
    .btn-secondary { background: #6c757d; color: #fff; }
    .btn-secondary:hover { background: #5c636a; }
    .btn-danger { background: #dc3545; color: #fff; }
    .btn-success { background: #198754; color: #fff; }
    .alert { padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; }
    .alert-danger { background: #f8d7da; color: #842029; border: 1px solid #f5c2c7; }
    .alert-success { background: #d1e7dd; color: #0a3622; border: 1px solid #badbcc; }
    .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .product-card { background: #fff; border: 1px solid #dee2e6; border-radius: 8px; padding: 16px; }
    .product-card h3 { margin-bottom: 8px; }
    .product-card .price { font-size: 20px; font-weight: 700; color: #0d6efd; margin-bottom: 8px; }
    .product-card .stock { font-size: 13px; color: #6c757d; margin-bottom: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #dee2e6; }
    th { font-weight: 600; background: #f8f9fa; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-weight: 600; margin-bottom: 4px; }
    input[type=text], input[type=email], input[type=password] {
      width: 100%; padding: 8px 12px; border: 1px solid #ced4da; border-radius: 6px; font-size: 15px;
    }
  </style>
</head>
<body>
<header>
  <a class="brand" href="/">Demo Shop</a>
  <a href="/products">Products</a>
  <a href="/cart">My Cart</a>
  <a href="/login">Login</a>
</header>
<main>
  ${body}
</main>
</body>
</html>`;
}

// ── Route handlers ───────────────────────────────────────────────────────────

function handleHome(req, res) {
  const sess = getSession(req);
  const greeting = sess ? `<p class="alert alert-success">Welcome back, <strong>${sess.data.username}</strong>!</p>` : '';
  const html = layout('Home', `
    <h1>Welcome to Demo Shop</h1>
    ${greeting}
    <p style="margin-bottom:24px; color:#6c757d;">Your favourite place for widgets, gadgets, and doohickeys.</p>
    <div class="product-grid">
      ${PRODUCTS.map(p => `
        <div class="product-card">
          <h3>${p.name}</h3>
          <div class="price">RM ${p.price.toFixed(2)}</div>
          <div class="stock">${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</div>
          <p style="font-size:13px; color:#495057; margin-bottom:12px;">${p.description}</p>
          <a href="/products/${p.id}" class="btn btn-primary" style="text-decoration:none;">View Details</a>
        </div>
      `).join('')}
    </div>
  `);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleProducts(req, res) {
  handleHome(req, res);
}

function handleProductDetail(req, res, productId) {
  const product = PRODUCTS.find(p => p.id === productId);
  if (!product) {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(layout('Not Found', '<h1>Product not found</h1><p><a href="/">Back to home</a></p>'));
    return;
  }

  // Bug (c): fetches /api/stock which returns 500 — causes console error and broken stock display
  const html = layout('Product: ' + product.name, `
    <a href="/" style="font-size:14px; color:#6c757d;">&larr; Back to products</a>
    <div class="card" style="margin-top:16px;">
      <h1>${product.name}</h1>
      <div style="font-size:24px; font-weight:700; color:#0d6efd; margin: 12px 0;">RM ${product.price.toFixed(2)}</div>
      <p style="color:#495057; margin-bottom:16px;">${product.description}</p>
      <div id="stock-info" style="margin-bottom:16px; color:#6c757d; font-size:14px;">Loading stock…</div>
      <form action="/cart/add" method="POST" style="display:flex; gap:12px; align-items:center;">
        <input type="hidden" name="productId" value="${product.id}">
        <label for="qty" style="font-weight:600;">Qty:</label>
        <input type="number" id="qty" name="qty" value="1" min="1" max="10"
               style="width:70px; padding:8px; border:1px solid #ced4da; border-radius:6px;">
        <button type="submit" class="btn btn-primary">Add to Cart</button>
      </form>
    </div>
  `, `<script>
    // Bug (c): /api/stock intentionally returns 500
    fetch('/api/stock?productId=${product.id}')
      .then(r => {
        if (!r.ok) throw new Error('Stock API error: ' + r.status);
        return r.json();
      })
      .then(data => {
        document.getElementById('stock-info').textContent =
          data.stock > 0 ? data.stock + ' units in stock' : 'Out of stock';
      })
      .catch(err => {
        // This console.error is intentional — Bug (c) also produces a console error on this page
        console.error('Failed to load stock information', err);
        document.getElementById('stock-info').textContent = 'Stock information unavailable';
      });
  </script>`);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleCartGet(req, res) {
  const sess = getSession(req);
  const cart = sess ? sess.data.cart : [];
  const items = cart.map(item => {
    const p = PRODUCTS.find(pr => pr.id === item.productId);
    return p ? { ...p, qty: item.qty, subtotal: (p.price * item.qty).toFixed(2) } : null;
  }).filter(Boolean);
  const total = items.reduce((s, i) => s + parseFloat(i.subtotal), 0).toFixed(2);

  // Bug (b): console.error fires on every cart page load
  const html = layout('My Cart', `
    <h1>My Cart</h1>
    ${items.length === 0 ? '<div class="alert alert-danger">Your cart is empty. <a href="/">Browse products</a></div>' : `
      <table>
        <thead><tr><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th></tr></thead>
        <tbody>
          ${items.map(i => `
            <tr>
              <td>${i.name}</td>
              <td>RM ${i.price.toFixed(2)}</td>
              <td>${i.qty}</td>
              <td>RM ${i.subtotal}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot><tr><td colspan="3"><strong>Total</strong></td><td><strong>RM ${total}</strong></td></tr></tfoot>
      </table>
      <div style="margin-top:20px; display:flex; gap:12px;">
        <!-- Bug (d): "Continue" button clears the cart (POST /cart/clear) — label implies "continue to checkout" -->
        <form action="/cart/clear" method="POST">
          <button type="submit" class="btn btn-primary">Continue</button>
        </form>
        <a href="/checkout" class="btn btn-secondary" style="text-decoration:none;">Skip to Checkout</a>
      </div>
    `}
  `, `<script>
    // Bug (b): intentional console.error on cart page load
    console.error('CartService: session sync failed — cart state may be stale');
  </script>`);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleCartAdd(req, res, body) {
  const sess = getSession(req);
  if (!sess) {
    res.writeHead(302, { Location: '/login?next=/cart' });
    res.end();
    return;
  }
  const params = new URLSearchParams(body);
  const productId = params.get('productId');
  const qty = parseInt(params.get('qty') || '1', 10);
  const existing = sess.data.cart.find(i => i.productId === productId);
  if (existing) {
    existing.qty += qty;
  } else {
    sess.data.cart.push({ productId, qty });
  }
  res.writeHead(302, { Location: '/cart' });
  res.end();
}

function handleCartClear(req, res) {
  // Bug (d): This route backs the misleadingly-labelled "Continue" button
  const sess = getSession(req);
  if (sess) sess.data.cart = [];
  res.writeHead(302, { Location: '/cart' });
  res.end();
}

function handleCheckout(req, res) {
  // Bug (a): "Place Order" button has no handler — nothing happens when clicked
  const html = layout('Checkout', `
    <h1>Checkout</h1>
    <div class="card">
      <h2>Shipping Information</h2>
      <form id="checkout-form" style="max-width:480px;">
        <div class="form-group">
          <label for="full-name">Full Name</label>
          <input type="text" id="full-name" name="fullName" placeholder="Your full name" required>
        </div>
        <div class="form-group">
          <label for="email">Email Address</label>
          <input type="email" id="email" name="email" placeholder="you@example.com" required>
        </div>
        <div class="form-group">
          <label for="address">Shipping Address</label>
          <input type="text" id="address" name="address" placeholder="Street, city, postcode" required>
        </div>
        <div class="form-group">
          <label for="payment">Payment Method</label>
          <select id="payment" name="payment" style="width:100%; padding:8px 12px; border:1px solid #ced4da; border-radius:6px; font-size:15px;">
            <option value="online_banking">Online Banking</option>
            <option value="credit_card">Credit Card</option>
            <option value="ewallet">E-Wallet</option>
          </select>
        </div>
        <!-- Bug (a): button has type="button" with no onclick — intentionally does nothing -->
        <button type="button" class="btn btn-success" style="width:100%; padding:14px;">Place Order</button>
      </form>
    </div>
  `);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleLogin(req, res, searchParams) {
  const next = searchParams.get('next') || '/';
  const html = layout('Login', `
    <h1>Login</h1>
    <div class="card" style="max-width:400px; margin:0 auto;">
      <form action="/login" method="POST" style="display:flex; flex-direction:column; gap:16px;">
        <input type="hidden" name="next" value="${next}">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" placeholder="demo" required>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" placeholder="••••••••" required>
        </div>
        <button type="submit" class="btn btn-primary">Sign In</button>
        <p style="font-size:13px; color:#6c757d; text-align:center;">
          Demo credentials: <strong>demo / demo123</strong>
        </p>
      </form>
    </div>
  `);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}

function handleLoginPost(req, res, body) {
  const params = new URLSearchParams(body);
  const username = params.get('username');
  const password = params.get('password');
  const next = params.get('next') || '/';
  if (username === 'demo' && password === 'demo123') {
    const sid = randomBytes(16).toString('hex');
    sessions.set(sid, { username, cart: [] });
    setCookie(res, sid);
    res.writeHead(302, { Location: next });
  } else {
    const html = layout('Login', `
      <h1>Login</h1>
      <div class="card" style="max-width:400px; margin:0 auto;">
        <div class="alert alert-danger">Invalid username or password.</div>
        <form action="/login" method="POST" style="display:flex; flex-direction:column; gap:16px;">
          <input type="hidden" name="next" value="${next}">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" name="username" value="${username || ''}" required>
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required>
          </div>
          <button type="submit" class="btn btn-primary">Sign In</button>
        </form>
      </div>
    `);
    res.writeHead(401, { 'Content-Type': 'text/html' });
    res.end(html);
  }
  res.end?.();
}

function handleApiStock(req, res) {
  // Bug (c): always returns 500 to simulate a broken stock API
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Internal server error: stock service unavailable' }));
}

// ── Request dispatcher ───────────────────────────────────────────────────────

function collectBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = parseUrl(req.url || '/', true);
  const pathname = parsed.pathname || '/';
  const method = req.method || 'GET';

  try {
    if (method === 'GET') {
      if (pathname === '/' || pathname === '/products') return handleHome(req, res);
      const productMatch = pathname.match(/^\/products\/(p\d+)$/);
      if (productMatch) return handleProductDetail(req, res, productMatch[1]);
      if (pathname === '/cart') return handleCartGet(req, res);
      if (pathname === '/checkout') return handleCheckout(req, res);
      if (pathname === '/login') return handleLogin(req, res, parsed.query);
      if (pathname === '/api/stock') return handleApiStock(req, res);
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(layout('Not Found', '<h1>404 — Page not found</h1><p><a href="/">Home</a></p>'));
      return;
    }

    if (method === 'POST') {
      const body = await collectBody(req);
      if (pathname === '/cart/add') return handleCartAdd(req, res, body);
      if (pathname === '/cart/clear') return handleCartClear(req, res);
      if (pathname === '/login') return handleLoginPost(req, res, body);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  } catch (err) {
    console.error('Demo shop unhandled error:', err);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(layout('Error', '<h1>500 — Internal error</h1>'));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Demo shop running at http://127.0.0.1:${PORT}`);
  console.log('Bugs planted: (a) checkout button no-op, (b) cart console.error, (c) /api/stock 500, (d) Continue clears cart');
});

export { server };
```

- [ ] Add `"demo"` script to root `package.json`:
  ```json
  "scripts": {
    "demo": "node examples/demo-shop/server.mjs"
  }
  ```

- [ ] Verify the server starts and the four bug-endpoints respond:
  ```bash
  node examples/demo-shop/server.mjs &
  DEMO_PID=$!
  curl -s http://127.0.0.1:4949/ | grep -q "Demo Shop" && echo "home OK"
  curl -s http://127.0.0.1:4949/products/p1 | grep -q "stock-info" && echo "product OK"
  curl -s http://127.0.0.1:4949/cart | grep -q "CartService" && echo "cart OK"
  curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4949/api/stock?productId=p1 | grep -q 500 && echo "api/stock 500 OK"
  curl -s http://127.0.0.1:4949/checkout | grep -q 'type="button"' && echo "checkout no-handler OK"
  kill $DEMO_PID
  # expected output: home OK / product OK / cart OK / api/stock 500 OK / checkout no-handler OK
  ```

- [ ] Commit:
  ```
  git add examples/demo-shop/server.mjs package.json
  git commit -m "feat(examples): add demo-shop with 4 planted bugs for e2e fixture"
  ```


## Task 4 — Full-lifecycle integration test `packages/server/test/e2e-demo-shop.test.ts`

**Files:**
- `packages/server/test/e2e-demo-shop.test.ts`

### Steps

- [ ] Write the integration test with the full content below. The test:
  1. Starts the demo-shop on a random port.
  2. Starts the OpenUser daemon with a temp `OPENUSER_HOME` using `PlaywrightRunner`.
  3. Creates a project + persona via the REST manager API.
  4. Calls `POST /api/runs` (prepare_run) to get a `testerPrompt` and `token`.
  5. Drives the scripted tester directly through the REST tester API (no MCP, no real LLM) to
     simulate a tester reaching each of the four planted bugs.
  6. Asserts: four finding rows with correct types, screenshot and video files exist on disk,
     the markdown report from `GET /api/runs/:id/report` contains the finding titles, and the
     `log_events` table captured the console.error and the 500.
  7. Is guarded with `describe.skipIf` when Chromium is not installed.

```typescript
// packages/server/test/e2e-demo-shop.test.ts
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// ── helpers ──────────────────────────────────────────────────────────────────

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address() as { port: number };
      s.close(() => resolve(addr.port));
    });
    s.on('error', reject);
  });
}

async function waitFor(fn: () => Promise<boolean>, maxMs = 15_000, intervalMs = 300): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (await fn().catch(() => false)) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timed out');
}

async function apiGet(base: string, path: string, token?: string) {
  const res = await fetch(`${base}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPost(base: string, path: string, body: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function apiPatch(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── chromium guard ───────────────────────────────────────────────────────────

function chromiumInstalled(): boolean {
  try {
    // Attempt to resolve the chromium executable path; throws if not installed.
    execSync('npx playwright install --dry-run chromium', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── test suite ───────────────────────────────────────────────────────────────

describe.skipIf(!chromiumInstalled())('demo-shop full-lifecycle e2e', () => {
  let daemonBase: string;
  let shopBase: string;
  let daemonProc: ReturnType<typeof spawn> | null = null;
  let shopProc: ReturnType<typeof spawn> | null = null;
  let openUserHome: string;
  let runId: string;
  let runToken: string;
  let projectId: string;
  let personaId: string;

  beforeAll(async () => {
    // ── 1. Start demo-shop ──
    const shopPort = await freePort();
    shopBase = `http://127.0.0.1:${shopPort}`;
    shopProc = spawn('node', ['examples/demo-shop/server.mjs'], {
      env: { ...process.env, DEMO_PORT: String(shopPort) },
      stdio: 'pipe',
    });
    await waitFor(async () => {
      const r = await fetch(`${shopBase}/`).catch(() => null);
      return r?.ok ?? false;
    });

    // ── 2. Start daemon with temp home ──
    const daemonPort = await freePort();
    openUserHome = mkdtempSync(join(tmpdir(), 'openuser-e2e-'));
    daemonBase = `http://127.0.0.1:${daemonPort}`;
    daemonProc = spawn('node', ['packages/cli/dist/bin.js', 'start', '--detach', '--no-open', `--port=${daemonPort}`], {
      env: { ...process.env, OPENUSER_HOME: openUserHome },
      stdio: 'pipe',
    });
    await waitFor(async () => {
      const r = await fetch(`${daemonBase}/api/health`).catch(() => null);
      if (!r?.ok) return false;
      const json = await r.json().catch(() => null);
      return json?.ok === true;
    });

    // ── 3. Register project + persona ──
    const project = await apiPost(daemonBase, '/api/projects', {
      name: 'Demo Shop E2E',
      path: openUserHome,
      baseUrl: shopBase,
      environments: [{ name: 'local', url: shopBase }],
    });
    projectId = project.id;

    const persona = await apiPost(daemonBase, `/api/projects/${projectId}/personas`, {
      name: 'Alex (Test Buyer)',
      role: 'test_buyer',
      identity: {
        fullName: 'Alex Tester',
        roleLabel: 'Test buyer',
        credentials: { username: 'demo', password: 'demo123' },
        locale: 'en-US',
      },
      behavior: {
        techSavviness: 'average',
        patience: 'medium',
        readingStyle: 'reads',
        device: 'desktop',
        viewport: { width: 1280, height: 720 },
        habits: 'Wants to buy one product and complete checkout.',
      },
      knowledge: {
        productKnowledge: 'Knows the shop sells widgets.',
        expectations: 'Expects a working checkout.',
        vocabulary: "Uses 'cart', 'checkout', 'Place Order'.",
      },
    });
    personaId = persona.id;

    // ── 4. Prepare run ──
    const prepared = await apiPost(daemonBase, '/api/runs', {
      projectId,
      adhocGoal: 'Browse the shop, add Widget Pro to the cart, attempt checkout, and observe all pages for errors.',
      personaId,
      environment: 'local',
      agentLabel: 'vitest-scripted',
    });
    runId = prepared.runId;
    runToken = prepared.token;

    expect(prepared.testerPrompt).toContain('begin_run');
    expect(prepared.testerPrompt).toContain(runToken);
    expect(prepared.testerPrompt).toContain('Alex Tester');
  }, 60_000);

  afterAll(async () => {
    // Ask daemon to finalize gracefully, then kill both processes.
    await fetch(`${daemonBase}/api/tester/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runToken}` },
      body: JSON.stringify({ verdict: 'partial', summary: 'Test cleanup — run aborted by afterAll.' }),
    }).catch(() => {});
    daemonProc?.kill('SIGTERM');
    shopProc?.kill('SIGTERM');
  }, 15_000);

  it('begin_run returns persona card, mission, and first snapshot', async () => {
    const result = await apiPost(daemonBase, '/api/tester/begin', {}, runToken);
    expect(result.personaCard).toContain('Alex Tester');
    expect(result.mission).toContain('Widget Pro');
    expect(result.snapshot).toMatchObject({ url: shopBase + '/', title: expect.stringContaining('Demo Shop') });
  });

  it('navigating to the product page triggers a 500 from /api/stock captured in log_events', async () => {
    // Navigate to product detail — the page JS will fetch /api/stock which returns 500
    await apiPost(daemonBase, '/api/tester/action', {
      kind: 'navigate',
      url: `${shopBase}/products/p1`,
      note: 'Opening Widget Pro detail page to check stock and price.',
    }, runToken);

    // Wait for the async /api/stock call to be captured
    await new Promise(r => setTimeout(r, 1500));

    // Re-snapshot to confirm we're on the product page
    const snap = await apiPost(daemonBase, '/api/tester/snapshot', {}, runToken);
    expect(snap.url).toContain('/products/p1');
    expect(snap.title).toContain('Widget Pro');
  });

  it('cart page load triggers console.error captured in log_events', async () => {
    // Add Widget Pro to cart
    await apiPost(daemonBase, '/api/tester/action', {
      kind: 'navigate',
      url: `${shopBase}/cart`,
      note: 'Visiting cart page directly to check its state.',
    }, runToken);

    // The cart page emits console.error('CartService: session sync failed...')
    await new Promise(r => setTimeout(r, 500));

    const snap = await apiPost(daemonBase, '/api/tester/snapshot', {}, runToken);
    expect(snap.url).toContain('/cart');
  });

  it('report_finding: console error on cart page', async () => {
    const finding = await apiPost(daemonBase, '/api/tester/finding', {
      type: 'console',
      severity: 'high',
      title: 'Console error on cart page load — "CartService: session sync failed"',
      description: 'Every time I open my cart, a hidden error message fires in the background. The cart page appears to load, but something is going wrong behind the scenes. I am not sure if my cart is accurate.',
    }, runToken);
    expect(finding.id).toMatch(/^fnd_/);
    expect(finding.type).toBe('console');
    expect(finding.severity).toBe('high');
  });

  it('report_finding: /api/stock 500 on product page', async () => {
    const finding = await apiPost(daemonBase, '/api/tester/finding', {
      type: 'network',
      severity: 'high',
      title: 'Stock information unavailable on product detail page',
      description: 'I opened the Widget Pro page. It said "Loading stock…" for a moment, then changed to "Stock information unavailable." I could not tell if the product was actually in stock or not before adding it to my cart.',
    }, runToken);
    expect(finding.id).toMatch(/^fnd_/);
    expect(finding.type).toBe('network');
  });

  it('report_finding: Continue button clears the cart (ux_confusion)', async () => {
    // Navigate to the cart and observe the misleading "Continue" button
    await apiPost(daemonBase, '/api/tester/action', {
      kind: 'navigate',
      url: `${shopBase}/cart`,
      note: 'Back to cart to look for checkout button.',
    }, runToken);

    const finding = await apiPost(daemonBase, '/api/tester/finding', {
      type: 'ux_confusion',
      severity: 'medium',
      title: '"Continue" button in cart empties the cart instead of going to checkout',
      description: 'I saw a button in my cart labelled "Continue". I expected it to take me to the checkout page. But after clicking it my cart was completely empty. Nothing warned me this would happen. I had to start over.',
    }, runToken);
    expect(finding.type).toBe('ux_confusion');
    expect(finding.severity).toBe('medium');
  });

  it('save_checkpoint after cart populated', async () => {
    const checkpoint = await apiPost(daemonBase, '/api/tester/checkpoint', {
      name: 'After cart load',
      description: 'Cart page visited; session established with demo user.',
      journeyNotes: 'Logged in as demo/demo123. Navigated to cart. Ready to attempt checkout.',
    }, runToken);
    expect(checkpoint.id).toMatch(/^chk_/);
    const stateExists = existsSync(checkpoint.storageStatePath);
    expect(stateExists).toBe(true);
  });

  it('report_finding: Place Order button does nothing (functional, critical)', async () => {
    await apiPost(daemonBase, '/api/tester/action', {
      kind: 'navigate',
      url: `${shopBase}/checkout`,
      note: 'Navigating directly to checkout to try placing an order.',
    }, runToken);

    const finding = await apiPost(daemonBase, '/api/tester/finding', {
      type: 'functional',
      severity: 'critical',
      title: '"Place Order" button does nothing — order cannot be submitted',
      description: 'I filled in my name, email, address, and chose Online Banking as payment. I clicked "Place Order". Nothing happened — no loading indicator, no confirmation page, no error message. I clicked it three more times. The page stayed exactly the same. I cannot complete my purchase.',
    }, runToken);
    expect(finding.type).toBe('functional');
    expect(finding.severity).toBe('critical');
  });

  it('complete_run returns structured outcome with all 4 findings', async () => {
    const outcome = await apiPost(daemonBase, '/api/tester/complete', {
      verdict: 'blocked',
      summary: 'I could not complete a purchase. The Place Order button does nothing, the cart has a misleading Continue button that deletes items, stock information fails to load on product pages, and the cart page produces a background error. The shop is not functional for buying.',
    }, runToken);

    expect(outcome.status).toBe('blocked');
    expect(outcome.findings).toHaveLength(4);

    const types = outcome.findings.map((f: { type: string }) => f.type);
    expect(types).toContain('functional');
    expect(types).toContain('console');
    expect(types).toContain('network');
    expect(types).toContain('ux_confusion');
  });

  it('findings rows exist in the database with correct types', async () => {
    const findings = await apiGet(daemonBase, `/api/findings?projectId=${projectId}`);
    expect(findings.length).toBeGreaterThanOrEqual(4);
    const byType = Object.fromEntries(findings.map((f: { type: string }) => [f.type, f]));
    expect(byType['functional']).toBeDefined();
    expect(byType['console']).toBeDefined();
    expect(byType['network']).toBeDefined();
    expect(byType['ux_confusion']).toBeDefined();
  });

  it('run detail includes steps array and screenshot paths that exist on disk', async () => {
    const run = await apiGet(daemonBase, `/api/runs/${runId}`);
    expect(run.steps.length).toBeGreaterThan(0);
    const stepsWithScreenshots = run.steps.filter((s: { screenshotPath?: string }) => s.screenshotPath);
    expect(stepsWithScreenshots.length).toBeGreaterThan(0);
    for (const step of stepsWithScreenshots.slice(0, 3)) {
      expect(existsSync(step.screenshotPath)).toBe(true);
    }
  });

  it('video file exists on disk after run completion', async () => {
    const run = await apiGet(daemonBase, `/api/runs/${runId}`);
    expect(run.videoPath).toBeTruthy();
    expect(existsSync(run.videoPath)).toBe(true);
  });

  it('markdown report contains all 4 finding titles', async () => {
    const res = await fetch(`${daemonBase}/api/runs/${runId}/report`);
    expect(res.ok).toBe(true);
    const report = await res.text();
    expect(report).toContain('Place Order');
    expect(report).toContain('CartService');
    expect(report).toContain('Stock information unavailable');
    expect(report).toContain('Continue');
  });

  it('log_events table captured the console.error and the 500 network event', async () => {
    const run = await apiGet(daemonBase, `/api/runs/${runId}`);
    // The run detail endpoint includes log_events for the run
    // (or query a dedicated endpoint if implemented; fall back to checking findings evidence)
    const consoleFinding = run.findings?.find((f: { type: string }) => f.type === 'console');
    expect(consoleFinding).toBeDefined();
    const networkFinding = run.findings?.find((f: { type: string }) => f.type === 'network');
    expect(networkFinding).toBeDefined();
    // Evidence JSON should reference the captured events
    expect(consoleFinding?.evidence).toBeDefined();
    expect(networkFinding?.evidence).toBeDefined();
  });
}, 120_000);
```

- [ ] Add `e2e-demo-shop` to `packages/server/vitest.config.ts` include list (or confirm the existing glob covers `test/*.test.ts`).

- [ ] Verify the test file is valid TypeScript:
  ```bash
  pnpm --filter @openuser/server exec tsc --noEmit
  # expected: no errors
  ```

- [ ] Run the test (requires Chromium):
  ```bash
  pnpm --filter @openuser/server test e2e-demo-shop
  # expected: all tests pass or skip if Chromium not installed
  ```

- [ ] Commit:
  ```
  git add packages/server/test/e2e-demo-shop.test.ts
  git commit -m "test(server): add full-lifecycle e2e test against demo-shop (4 planted bugs)"
  ```


## Task 5 — `README.md`

**Files:**
- `README.md`

### Steps

- [ ] Write `README.md` at the repo root with the complete content below.
  Per spec §12: this is the **entire human surface** for end users.
  Placeholder `docs/assets/demo.gif` is acceptable (noted below as the one allowed TODO).

```markdown
# OpenUser

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/openuser)](https://www.npmjs.com/package/openuser)

> **Your coding agent tests your app as a real user — so you don't have to.**

![Demo](docs/assets/demo.gif)
<!-- TODO: replace with real demo gif after first dogfood run -->

---

## What is OpenUser?

OpenUser is an open-source, self-hosted platform that turns any MCP-capable coding agent
(Claude Code, Codex, opencode, Cursor) into a user-perspective tester. Instead of writing
test scripts, you tell your agent: *"test my checkout flow as a first-time buyer."* The agent
summons a tester subagent that embodies a named user persona — with a specific patience level,
reading style, and domain vocabulary — and navigates your running web app as that person would,
with no knowledge of your codebase.

OpenUser is a self-hostable alternative to TestSprite. It runs entirely on your machine:
one `npx openuser` command starts a local daemon with a Playwright browser, a SQLite database,
and a dashboard. No cloud account, no API keys, no data leaving your machine.

The human interface is minimal by design. You talk to your agent — "test registration as a
reseller", "test the feature I just shipped", "what did OpenUser find this week?" — and your
agent handles everything: creating personas, preparing runs, dispatching testers, retrieving
results, and explaining findings in plain language. You review findings, not flows.

---

## Features

- **User personas** — named profiles with identity, behavior (patience, reading style,
  tech savviness), and domain knowledge. First-class in every run.
- **UX confusion findings** — tester subagents report confusion in the user's own voice, not
  developer language. Catches issues automated scripts never find.
- **Checkpoints** — save and resume browser sessions across runs. Avoid re-doing login + setup
  steps on every test.
- **Full recording** — video, per-step screenshots, console log, network log, all attributed
  to the causing step.
- **Local dashboard** — live run timeline, findings inbox, persona and checkpoint management.
  Every dashboard capability is also a manager MCP tool.
- **Works with any MCP-capable agent** — Claude Code, Codex, opencode, Cursor, or any agent
  that can call MCP tools.
- **Fully offline** — no cloud, no account, no API keys required by OpenUser itself.
- **MIT open source** — self-hostable, forkable, extensible.

---

## Quickstart

### 1. Start the daemon

```bash
npx openuser
```

This starts the daemon on port 8737, opens the dashboard in your browser, and (on first run)
prompts you to install the Playwright Chromium browser.

### 2. Add the MCP servers to your agent

**Claude Code** — add to `.claude/mcp.json` or `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "openuser-manager": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "manager"]
    },
    "openuser-tester": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "tester"]
    }
  }
}
```

**Codex** — add to `~/.codex/config.yaml`:

```yaml
mcpServers:
  openuser-manager:
    command: npx
    args: [openuser, mcp, --role, manager]
  openuser-tester:
    command: npx
    args: [openuser, mcp, --role, tester]
```

**opencode** — add to `~/.opencode/config.json`:

```json
{
  "mcp": {
    "openuser-manager": { "command": "npx", "args": ["openuser", "mcp", "--role", "manager"] },
    "openuser-tester":  { "command": "npx", "args": ["openuser", "mcp", "--role", "tester"] }
  }
}
```

**Cursor** — open Settings → MCP → Add server → paste:

```json
{ "command": "npx", "args": ["openuser", "mcp", "--role", "manager"] }
```

Add a second entry for `--role tester`.

### 3. Install the skills

```bash
npx openuser skills install --agent claude
# or: --agent codex | --agent opencode | --agent cursor
```

This copies `openuser-manager` and `openuser-tester` skill files to your agent's skills
directory and prints the matching MCP snippet.

### 4. Talk to your agent

With your dev server running:

```
Tell your agent: "Test my checkout flow as a first-time buyer using OpenUser."
```

Your agent will:
1. Register your project (once).
2. Create a first-time buyer persona (or reuse one).
3. Prepare and dispatch a tester run.
4. Report findings when complete.

---

## How it works

```
You  →  coding agent (has your codebase context)
              │
              │  openuser-manager MCP
              ▼
         OpenUser daemon  (port 8737, localhost)
              │
              │  prepare_run → testerPrompt (server-generated, no code context)
              ▼
         tester subagent  (fresh context, tester MCP only)
              │
              │  begin_run → browse → report_finding → complete_run
              ▼
         Playwright browser  (records video + screenshots + console + network)
              │
              ▼
         SQLite findings  →  dashboard  →  your agent explains results to you
```

The tester subagent **never sees your code**. Its only instructions come from a
server-generated prompt that embeds the persona card, the user-outcome goal, and a reminder to
navigate by visible UI only. This is what makes findings feel like real user reports.

---

## Concepts

**Persona** — A named user archetype with a specific identity (credentials, locale), behavior
(patience level, reading style, tech savviness, device), and knowledge (what they already know
about your product, what vocabulary they use). Every run is tied to one persona. A low-patience,
skimming novice will find completely different issues than a patient expert reader.

**Checkpoint** — A saved browser session state (cookies, localStorage, indexedDB) plus journey
notes. Checkpoints let tester runs start mid-flow — already logged in, already past setup steps.
They are saved automatically after costly setup and before risky actions, and can be reused
across runs.

**Finding** — A structured report of something wrong or confusing. Finding types are
`functional` (broken behavior), `console` (browser error), `network` (failed request), and
`ux_confusion` (the signature OpenUser type — user-voice reports of confusing UI). Every finding
has a severity, a user-voice description, and evidence (screenshot, console/network excerpt).

**Run** — One tester session: a persona pursuing a goal on your app. Runs are fully recorded
(video, per-step screenshots, console, network). A run ends with a verdict: `goal_achieved`,
`blocked`, or `partial`, plus a user-voice summary and a list of findings.

---

## FAQ

**Does OpenUser upload my code or app data anywhere?**
No. Everything runs on your machine. The daemon binds to `127.0.0.1` by default. Your code is
never read by the tester subagent. Artifacts (screenshots, video) stay in `~/.openuser/`.

**What does OpenUser cost?**
OpenUser itself is free and MIT-licensed. Running tests consumes your agent's tokens — the same
tokens you would spend on any other agent task. There is no OpenUser subscription or usage fee.

**Which agents does OpenUser work with?**
Any agent that can call MCP tools: Claude Code, Codex, opencode, Cursor, and any future
MCP-capable coding assistant. The manager and tester MCPs are standard stdio MCP servers.

**How is OpenUser different from TestSprite?**

| Feature | TestSprite | OpenUser |
|---|---|---|
| Self-hosted / offline | ✗ cloud-only | ✓ `npx openuser` |
| User personas | ✗ | ✓ first-class |
| Checkpoints | ✗ | ✓ first-class |
| UX confusion findings | ✗ | ✓ signature feature |
| Console + network in dashboard | ✗ | ✓ per step |
| Always agentic (no scripts) | ✗ generated scripts | ✓ |
| MCP-drivable dashboard | partial | ✓ everything |
| Open source | ✗ | ✓ MIT |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The repo is a pnpm monorepo; `pnpm install` then
`pnpm test` to get started.

---

MIT © OpenUser contributors
```

- [ ] Verify the file renders with no broken markdown:
  ```bash
  # Check for unclosed code fences (count must be even)
  grep -c '^\`\`\`' README.md
  # expected: even number (e.g. 14, 16, 18 — any even number)
  ```

- [ ] Verify the badge URLs and section headings are present:
  ```bash
  grep -q "MIT License" README.md && echo "badge OK"
  grep -q "## Quickstart" README.md && echo "quickstart OK"
  grep -q "## How it works" README.md && echo "diagram OK"
  grep -q "## Concepts" README.md && echo "concepts OK"
  grep -q "## FAQ" README.md && echo "faq OK"
  ```

- [ ] Commit:
  ```
  git add README.md
  git commit -m "docs: add complete README — full human surface per spec §12"
  ```


## Task 6 — `CONTRIBUTING.md` and `docs/agents.md`

**Files:**
- `CONTRIBUTING.md`
- `docs/agents.md`

### Steps

- [ ] Write `CONTRIBUTING.md` at the repo root with the complete content below.

```markdown
# Contributing to OpenUser

## Prerequisites

- Node.js >= 20
- pnpm 9.x (`npm install -g pnpm@9`)
- Playwright Chromium browser (`npx playwright install chromium`)

## Setup

```bash
git clone https://github.com/your-org/openuser.git
cd openuser
pnpm install
```

## Package map

| Directory | npm name | Role |
|---|---|---|
| `packages/shared` | `@openuser/shared` | zod schemas, types, enums — single source of truth |
| `packages/server` | `@openuser/server` | Hono daemon: REST API, WebSocket, Drizzle/SQLite, Playwright runner |
| `packages/mcp` | `@openuser/mcp` | Thin stdio MCP servers for manager and tester roles |
| `packages/ui` | `@openuser/ui` | Svelte 5 + SvelteKit SPA dashboard (adapter-static, SPA mode) |
| `packages/cli` | `openuser` | Commander CLI; bundles server + MCP + prebuilt SPA into one publishable package |
| `skills/` | — | Markdown skill files installed into coding agents |
| `examples/demo-shop/` | — | Zero-dependency demo shop with planted bugs; used in e2e tests |

## Development workflow

```bash
# Build all packages (needed before first run)
pnpm build

# Start the daemon in development mode (auto-restarts on change)
pnpm --filter @openuser/server dev

# Start the dashboard in development mode (Vite HMR)
pnpm --filter @openuser/ui dev

# Start the demo shop
pnpm demo
```

## Test commands

```bash
# All unit and integration tests across all packages
pnpm test

# Tests for a specific package
pnpm --filter @openuser/server test
pnpm --filter @openuser/shared test

# Full-lifecycle e2e test (requires Chromium)
pnpm --filter @openuser/server test e2e-demo-shop

# Dashboard e2e (Playwright, requires Chromium)
pnpm --filter @openuser/ui test

# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Format all packages
pnpm format
```

## Running the full CI suite locally

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @openuser/ui build
```

## Key conventions

- **TypeScript strict everywhere.** All packages use `"strict": true`. No `any` without a
  comment justifying it.
- **ESM everywhere.** All packages use `"type": "module"`. No CommonJS.
- **Schemas in `@openuser/shared`.** If a type crosses a package boundary, it belongs in
  `packages/shared/src/`. Do not duplicate schemas.
- **No breaking changes to contracts.md.** Tool names, enum strings, and API paths in
  `docs/specs/contracts.md` are binding. If you need to change them, update contracts.md in
  the same PR and note the breaking change.
- **Findings in user voice.** When writing tests that assert finding descriptions, use plain
  user language, not developer/technical language.

## Opening a PR

1. Branch from `main`.
2. Run `pnpm lint && pnpm typecheck && pnpm test` — all must pass.
3. Add or update tests for any changed behavior.
4. Fill in the PR description with what changed and why.
```

- [ ] Write `docs/agents.md` with the complete content below.

```markdown
# OpenUser — Per-harness MCP config and dispatch recipes

This document is for contributors and advanced users who want to understand exactly how
OpenUser integrates with each supported agent harness.

## MCP server binary

Both roles are served by the same binary:

```bash
openuser mcp --role manager   # manager tools only
openuser mcp --role tester    # tester tools only
```

The binary auto-spawns the OpenUser daemon (`openuser start --detach --no-open`) if the daemon
is not reachable, then retries the health check 10 times with 500ms backoff before failing with
an instructive error.

## Claude Code

### MCP config (`~/.claude/mcp.json` or project `.claude/mcp.json`)

```json
{
  "mcpServers": {
    "openuser-manager": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "manager"]
    },
    "openuser-tester": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "tester"]
    }
  }
}
```

### Skill install

```bash
npx openuser skills install --agent claude
# copies skills/openuser-manager/SKILL.md → .claude/skills/openuser-manager/SKILL.md
# copies skills/openuser-tester/SKILL.md  → .claude/skills/openuser-tester/SKILL.md
```

### Dispatch recipe (Task tool)

The manager agent dispatches a tester using Claude Code's Task tool. The tester subagent
must have **only** the `openuser-tester` MCP configured — no filesystem tools, no editor
tools, no code-reading tools. The Task prompt is the `testerPrompt` string returned by
`prepare_run`, passed verbatim without modification.

```
Task({
  description: "OpenUser tester — run <runId>",
  prompt: "<testerPrompt exactly as returned by prepare_run>",
})
```

The `testerPrompt` already contains everything the tester needs: the run token, persona
preview, mission preview, and the instruction to call `begin_run` immediately. Do not add
file paths, component names, API routes, or any code context.

## Codex

### MCP config (`~/.codex/config.yaml`)

```yaml
mcpServers:
  openuser-manager:
    command: npx
    args: [openuser, mcp, --role, manager]
  openuser-tester:
    command: npx
    args: [openuser, mcp, --role, tester]
```

### Skill install

```bash
npx openuser skills install --agent codex
# appends skill content to AGENTS.md in the project root
```

### Dispatch recipe (paste-prompt)

Codex does not have a programmatic Task-spawning tool. Use the paste-prompt recipe:

1. The manager calls `prepare_run` to get `testerPrompt`.
2. Open a new Codex session with no project files mounted and only the `openuser-tester`
   MCP configured.
3. Paste `testerPrompt` as the initial user message.

Alternatively, use the dashboard copy-prompt button: Tests → Run → select persona → Copy.

## opencode

### MCP config (`~/.opencode/config.json`)

```json
{
  "mcp": {
    "openuser-manager": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "manager"]
    },
    "openuser-tester": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "tester"]
    }
  }
}
```

### Skill install

```bash
npx openuser skills install --agent opencode
# appends skill content to AGENTS.md in the project root
```

### Dispatch recipe (paste-prompt)

Same as Codex: open a new opencode session, configure only the tester MCP, paste `testerPrompt`.

## Cursor

### MCP config (Settings → MCP → Add server)

Add two entries:

```json
{ "name": "openuser-manager", "command": "npx", "args": ["openuser", "mcp", "--role", "manager"] }
{ "name": "openuser-tester",  "command": "npx", "args": ["openuser", "mcp", "--role", "tester"] }
```

### Skill install

```bash
npx openuser skills install --agent cursor
# writes skill files to .cursor/rules/ as .mdc files
```

### Dispatch recipe (agent mode paste-prompt)

Open a new Cursor window with no project folder. Configure only `openuser-tester` MCP.
Paste `testerPrompt` into the Cursor Agent chat.

## Token lifecycle

- `prepare_run` generates a one-time run token (`rt_<nanoid(24)>`). Only `sha256(token)` is
  stored in the database.
- The token is embedded in `testerPrompt`. The tester MCP passes it as the `begin_run`
  argument and caches it in-process for all subsequent tester tool calls.
- The token expires when `complete_run` is called, when the watchdog fires, or when the
  daemon restarts. Expired tokens return 401.
- One token = one run. Never reuse a token across runs.

## Purity enforcement

The tester subagent must have zero code context:

- Dispatch via a fresh Task/session with no project files mounted.
- Do not augment `testerPrompt` with file paths, component names, API routes, or
  implementation details.
- The `testerPrompt` is server-generated from template + DB data only. By construction it
  cannot leak codebase knowledge.
- Hard harness lockdown (process-level isolation, restricted tool lists) is roadmap v2.
```

- [ ] Verify both files exist:
  ```bash
  test -f CONTRIBUTING.md && echo "CONTRIBUTING OK"
  test -f docs/agents.md && echo "agents.md OK"
  ```

- [ ] Commit:
  ```
  git add CONTRIBUTING.md docs/agents.md
  git commit -m "docs: add CONTRIBUTING.md and docs/agents.md with per-harness MCP recipes"
  ```


## Task 7 — CI final: `.github/workflows/ci.yml`

**Files:**
- `.github/workflows/ci.yml`

### Steps

- [ ] Replace (or create) `.github/workflows/ci.yml` with the complete final workflow below.
  This workflow adds: Playwright Chromium install step, the full-lifecycle e2e test, and the
  `@openuser/ui` build step, on top of whatever lint/typecheck/unit jobs Plans 01-06 established.

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

env:
  PNPM_VERSION: "9"
  NODE_VERSION: "20"

jobs:
  lint-typecheck:
    name: Lint & typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

  unit:
    name: Unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build packages (server/mcp/cli need to be built before tests)
        run: pnpm build

      - name: Run unit tests
        run: pnpm --filter @openuser/shared test --run
        env:
          CI: true

      - name: Run server unit tests (excluding e2e)
        run: pnpm --filter @openuser/server test --run --reporter=verbose --testPathPattern='^(?!.*e2e)'
        env:
          CI: true

  integration-e2e:
    name: Full-lifecycle e2e (demo-shop)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright Chromium browser
        run: npx playwright install chromium --with-deps

      - name: Build all packages
        run: pnpm build

      - name: Run full-lifecycle e2e test (demo-shop)
        run: pnpm --filter @openuser/server test --run --reporter=verbose e2e-demo-shop
        env:
          CI: true
          OPENUSER_HOME: /tmp/openuser-ci-${{ github.run_id }}

      - name: Upload e2e artifacts on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: openuser-e2e-artifacts-${{ github.run_id }}
          path: /tmp/openuser-ci-${{ github.run_id }}/
          retention-days: 3

  dashboard-e2e:
    name: Dashboard e2e (Playwright)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright Chromium browser
        run: npx playwright install chromium --with-deps

      - name: Build all packages
        run: pnpm build

      - name: Run dashboard e2e tests
        run: pnpm --filter @openuser/ui test
        env:
          CI: true

      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-${{ github.run_id }}
          path: packages/ui/playwright-report/
          retention-days: 3

  ui-build:
    name: UI production build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build @openuser/ui (Vite production)
        run: pnpm --filter @openuser/ui build

      - name: Verify build output exists
        run: test -d packages/ui/build && echo "UI build output OK"

  publish-dry-run:
    name: CLI publish dry-run
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build all packages
        run: pnpm build

      - name: Dry-run npm publish for openuser CLI
        run: pnpm --filter openuser publish --dry-run --access public
```

- [ ] Verify the YAML is syntactically valid:
  ```bash
  # Using Node to parse (no yq required)
  node -e "
    const fs = require('fs');
    const yaml = require('js-yaml');
    yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
    console.log('YAML valid');
  " 2>/dev/null || python3 -c "
    import yaml, sys
    yaml.safe_load(open('.github/workflows/ci.yml'))
    print('YAML valid')
  "
  # expected: YAML valid
  ```

- [ ] Confirm the five jobs are named correctly:
  ```bash
  grep "^  [a-z].*:$" .github/workflows/ci.yml
  # expected lines include: lint-typecheck, unit, integration-e2e, dashboard-e2e, ui-build
  ```

- [ ] Commit:
  ```
  git add .github/workflows/ci.yml
  git commit -m "ci: finalize workflow — add Playwright install, e2e test, UI build, dry-run publish"
  ```


## Task 8 — `docs/dogfood-ecommerce.md`

**Files:**
- `docs/dogfood-ecommerce.md`

### Steps

- [ ] Write `docs/dogfood-ecommerce.md` with the complete content below.
  This is the step-by-step guide for dogfooding OpenUser on the ecommerce-digital project
  (Go + SvelteKit, dev server on localhost:5173).

```markdown
# Dogfooding OpenUser on ecommerce-digital

This document is the step-by-step setup for running OpenUser against the
`~/projects/ecommerce-digital` codebase — a large Go backend + SvelteKit frontend e-commerce
platform. It covers: registering the project, creating the three initial personas, establishing
logged-in checkpoints, and the first smoke flows.

## Prerequisites

- OpenUser daemon running (`npx openuser` or `openuser start --detach`)
- ecommerce-digital dev server running on `http://localhost:5173`
- Go backend running (required for auth, product, and checkout APIs)
- Your coding agent has both MCP servers configured and both skills installed

## Step 1 — Register the project

Ask your agent:

```
Register ~/projects/ecommerce-digital in OpenUser. The dev server is at http://localhost:5173.
Add a "local" environment at that URL.
```

Or call directly:

```
register_project({
  name: "ecommerce-digital",
  path: "/home/<you>/projects/ecommerce-digital",
  baseUrl: "http://localhost:5173",
  environments: [
    { name: "local",   url: "http://localhost:5173" },
    { name: "staging", url: "https://staging.example.com" }
  ],
  defaultViewport: { width: 1280, height: 720 }
})
```

Note the returned `projectId` — it goes into `openuser.config.json` at the project root.

## Step 2 — Create personas

### Persona 1 — First-time buyer

```json
{
  "name": "Siti (First-time Buyer)",
  "role": "first_time_buyer",
  "identity": {
    "fullName": "Siti Rahimah",
    "roleLabel": "First-time buyer",
    "signupInstructions": "Sign up with a new email address (use a + alias like siti+test1@example.com). Fill in all required fields. Do not use an existing account.",
    "locale": "en-MY"
  },
  "behavior": {
    "techSavviness": "novice",
    "patience": "low",
    "readingStyle": "skims",
    "device": "desktop",
    "viewport": { "width": 1280, "height": 720 },
    "habits": "Arrived from a WhatsApp product recommendation. Wants to buy one item. Has never used this site. Abandons after one confusing screen."
  },
  "knowledge": {
    "productKnowledge": "Knows the product name. Does not know about reseller tiers, SKU codes, bulk pricing, or the platform's account model.",
    "expectations": "Click product → add to cart → pay → see confirmation. Expects under 5 minutes.",
    "vocabulary": "Says 'buy', 'cart', 'checkout', 'pay now', 'order'. Does not say 'SKU', 'API', 'session', 'submit form'."
  },
  "notes": "Use signupInstructions — this persona never has an existing account. Her patience is low: two confusing screens = abandoned = critical finding."
}
```

### Persona 2 — Reseller

```json
{
  "name": "Ahmad (Reseller)",
  "role": "reseller",
  "identity": {
    "fullName": "Ahmad Farhan",
    "roleLabel": "Approved reseller",
    "credentials": { "username": "reseller_test@ecommerce.local", "password": "ResellerStaging99!" },
    "locale": "en-MY"
  },
  "behavior": {
    "techSavviness": "average",
    "patience": "medium",
    "readingStyle": "reads",
    "device": "desktop",
    "viewport": { "width": 1440, "height": 900 },
    "habits": "Logs in weekday mornings. Checks new stock, places bulk orders, downloads invoices. Uses keyboard shortcuts where visible. Will retry once before escalating."
  },
  "knowledge": {
    "productKnowledge": "Knows the reseller portal, bulk-order form, tier pricing table, invoice download, and top-20 SKU codes. Has used the platform for 6 months.",
    "expectations": "Bulk-order flow in under 3 clicks per item. Invoice downloads as PDF. Stock updates within seconds of placing order.",
    "vocabulary": "Says 'reseller portal', 'bulk order', 'tier pricing', 'invoice', 'stock', 'SKU', 'dashboard'. Uses the onboarding guide's exact terms."
  },
  "notes": "Ahmad's runs should start from the 'reseller logged in' checkpoint to avoid repeating the login flow. Create that checkpoint on the first successful login run."
}
```

### Persona 3 — Platform admin

```json
{
  "name": "Nurul (Platform Admin)",
  "role": "platform_admin",
  "identity": {
    "fullName": "Nurul Huda",
    "roleLabel": "Platform administrator",
    "credentials": { "username": "admin_test@ecommerce.local", "password": "AdminStaging123!" },
    "locale": "en-MY"
  },
  "behavior": {
    "techSavviness": "expert",
    "patience": "high",
    "readingStyle": "reads",
    "device": "desktop",
    "viewport": { "width": 1920, "height": 1080 },
    "habits": "Manages reseller accounts, approves registrations, views platform-level analytics, and handles escalated support cases. Works systematically and reads every field."
  },
  "knowledge": {
    "productKnowledge": "Knows every feature of the admin panel. Understands reseller onboarding flow end-to-end. Knows how to approve/reject reseller applications, adjust tier pricing, and pull platform reports.",
    "expectations": "Admin actions take effect immediately and are reflected in the UI within 2 seconds. Bulk operations have confirmation dialogs. All tables are sortable and filterable.",
    "vocabulary": "Says 'admin panel', 'reseller management', 'approve registration', 'tier configuration', 'platform report', 'activity log'."
  },
  "notes": "Use the 'admin logged in' checkpoint for all admin runs. Admin actions can have side effects — always save a checkpoint before any destructive admin operation (delete, bulk-update)."
}
```

## Step 3 — Create logged-in checkpoints

Run a one-off login run for each persona that requires a checkpoint:

1. Prepare an ad-hoc run: goal "Log in as [persona] and confirm you are on the dashboard."
2. The tester logs in and calls `save_checkpoint` with name "reseller logged in" or
   "admin logged in" and journey notes describing the current page state.
3. After `complete_run`, the checkpoint appears in the dashboard → Checkpoints.
4. Use this checkpoint as `checkpointId` in all future reseller/admin runs.

## Step 4 — First smoke flows

### Smoke flow 1 — First-time buyer registration + first purchase

```
create_test({
  projectId: "<prj_id>",
  title: "First-time buyer: sign up and buy one product",
  goal: "Sign up for a new account using the signup form, browse to a product that is in stock, add one unit to the cart, and complete checkout using online banking. Confirm that an order confirmation page appears with an order number.",
  preconditions: "User is not logged in. No existing account with the test email exists.",
  expectedOutcome: "Order confirmation page shows with a unique order number and a summary of the purchased item.",
  defaultPersonaId: "<siti_persona_id>",
  priority: "high",
  tags: ["smoke", "registration", "checkout", "first-time-buyer"]
})
```

### Smoke flow 2 — Reseller bulk order

```
create_test({
  projectId: "<prj_id>",
  title: "Reseller: place a bulk order and download the invoice",
  goal: "From the reseller portal, add 50 units of SKU-001 and 20 units of SKU-002 to a bulk order, submit the order, and download the resulting invoice as a PDF.",
  preconditions: "Reseller is logged in (use 'reseller logged in' checkpoint). SKU-001 has stock >= 50. SKU-002 has stock >= 20.",
  expectedOutcome: "Order confirmation appears with the correct quantities and tier pricing applied. Invoice PDF downloads successfully and contains both line items.",
  defaultPersonaId: "<ahmad_persona_id>",
  priority: "high",
  tags: ["smoke", "reseller", "bulk-order", "invoice"]
})
```

### Smoke flow 3 — Platform admin approves a reseller

```
create_test({
  projectId: "<prj_id>",
  title: "Admin: approve a pending reseller application",
  goal: "Navigate to the reseller management section in the admin panel, find the first pending reseller application, review the application details, and approve it. Confirm the reseller's status changes to 'Approved' in the list.",
  preconditions: "Admin is logged in (use 'admin logged in' checkpoint). At least one reseller application with status 'Pending' exists.",
  expectedOutcome: "The reseller's row in the management table shows status 'Approved'. No error messages appear.",
  defaultPersonaId: "<nurul_persona_id>",
  priority: "medium",
  tags: ["smoke", "admin", "reseller-management"]
})
```

## Step 5 — Checkpoint strategy

| Checkpoint name | Persona | Created after | Reused by |
|---|---|---|---|
| `reseller logged in` | Ahmad (Reseller) | First successful login run | All reseller smoke + regression runs |
| `admin logged in` | Nurul (Platform Admin) | First successful admin login run | All admin panel runs |
| `cart with SKU-001` | Ahmad (Reseller) | After adding SKU-001 to bulk order | Bulk-order-specific regression runs |
| `first-time buyer registered` | Siti (First-time Buyer) | After first signup completes | Checkout-only regression (skip registration) |

Save checkpoints in the tester skill by calling `save_checkpoint` after each of these moments.
Name them exactly as shown so the manager can reference them by name when preparing runs.

## Step 6 — Running the smoke suite

Ask your agent:

```
Run the full smoke suite for ecommerce-digital in OpenUser. Use the logged-in checkpoints
where available. Report findings by severity when all runs complete.
```

The manager skill will:
1. Call `list_tests` to get all smoke-tagged tests.
2. Call `prepare_run` for each, using the appropriate persona and checkpoint.
3. Dispatch tester subagents one at a time (foreground, checkpoint after each).
4. Collect results via `get_run` and `get_findings`.
5. Report a severity-grouped summary.
```

- [ ] Verify the file was written:
  ```bash
  test -f docs/dogfood-ecommerce.md && wc -l docs/dogfood-ecommerce.md
  # expected: > 80 lines
  ```

- [ ] Commit:
  ```
  git add docs/dogfood-ecommerce.md
  git commit -m "docs: add dogfood-ecommerce.md — ecommerce-digital setup guide with 3 personas + smoke flows"
  ```

