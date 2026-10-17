Slice: <KEY> <link>
PRD: manalkaff/ecommerce-digital docs/prd/domains/<file>.md#<anchor> @ <ecommerce-digital dev sha>
Tier: T<n>   Stream: <stream>
Acceptance-SHA: <sha | n/a (T0) | n/a (PRD)>
Depends-on-merged: <PR links, or none>
Changelog: <none (not user-visible) | <entry file> (FB-<n>, …)>

## What changed
<3–8 bullets, in behaviour terms, not file terms>

## Acceptance criteria → tests
| AC | Test | Result |
|----|------|--------|
| AC1 | `<test id>` | <pass on <short sha>> |

## Evidence
- CI: <run link on head sha>
- <tier-specific evidence, per the slice's "Evidence required">

## Definition of done (DoD §1)
- [ ] 1 PRD-first: the PRD section above was merged before this PR
- [ ] 2 Acceptance tests exist, pass, and were not modified by the builder (`acceptance-integrity` green)
- [ ] 3 Unit tests for the new logic
- [ ] 4 Tier gates green on the head SHA
- [ ] 5 Reviews approved on the head SHA; no open P0/P1; P2s fixed or filed (links)
- [ ] 6 Evidence attached (above)
- [ ] 7 Build: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; <no new dependency | Architect record link>
- [ ] 8 House rules: no secret or key in source; the published package contents (`pnpm test:pack`) unchanged unless intended
- [ ] 9 Docs: <README / docs / skills updated, or "none needed">

## Review log
<appended by the engineer after each round: "R1: fixed F1 in <sha>; F2 filed as <KEY>; rejected F3 (reason)">

Factory-Run: <multica run id of the role that last edited this body>
