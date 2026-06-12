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
