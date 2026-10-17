#!/usr/bin/env python3
"""The merge gate (WORKFLOW §5.3): computes the `factory/merge-gate` commit status of a PR.

merge-gate.yml runs this from the BASE branch's checkout (pull_request_target, status and
workflow_dispatch all run the default branch's workflow), with the base branch's
factory/config.yml, so a PR can change neither the gate nor the globs that classify it. The PR's
commits are fetched as data (refs/factory/pr/<n>) and are never checked out or executed.

  merge_gate.py --pr N [--dry-run]       gate one PR (pull_request_target, workflow_dispatch)
  merge_gate.py --sha SHA [--dry-run]    gate the open PRs into dev whose head is SHA (status)
  merge_gate.py --classify --base R --head R [--labels L,...]
                                         print the tier of base..head (ci.yml's plan job)

The decision is the pure function decide(facts, cfg); gather() is the only code that reads
GitHub and git, and main() the only code that writes (one status, the step summary).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))

import cilib  # noqa: E402
from cilib import FactoryError, Git, log  # noqa: E402
from factory_cli.common import FULL_SHA_RE  # noqa: E402

COMMITS_WALK_MAX = 100             # PR commits searched for an earlier reviewer verdict
RED = ("failure", "timed_out")     # dev CI conclusions that open the revert fast lane


# ── the pure decision ──────────────────────────────────────────────────────────────────────────
def body_problems(body, tier):
    """TEMPLATES §7 "PR-body check": the machine lines the gate reads. `PRD:` is required from
    T1 and must name a real section (not the placeholder, not n/a). Whether `Slice:` names an
    existing issue is the tick's contract check: Actions cannot read Multica."""
    out = [f"PR body needs a `{key}:` line" for key in ("Slice", "Tier", "Acceptance-SHA")
           if cilib.body_line(body, key) is None]
    prd = cilib.body_line(body, "PRD")
    if tier != "T0" and (prd is None or prd.lower().startswith(("n/a", "none"))):
        out.append("PR body needs a `PRD:` line")
    return out


def required_reviews(cfg, tier):
    return list(cfg.get("tiers", "reviews", tier, default=[]) or [])


def decide(facts, cfg):
    """facts (see gather) -> (state, description, detail lines). No I/O.

    pending  = something is still missing (the tick reads the description);
    failure  = a required review is `failure` (or `error`): the builder must fix, not wait;
    success  = shape, tier and reviews all hold, or the revert fast lane applies."""
    dev = cfg.get("repos", "main", "default_branch", default="dev")
    tier = facts.get("tier") or "T3"
    details = [f"tier {tier} (base-branch classifier, max with tier label)"]
    if facts.get("halted"):
        return "pending", "factory halted", details + ["FACTORY_HALTED is true (WORKFLOW §10)"]

    shape = []
    if facts.get("base") != dev:
        shape.append(f"base is {facts.get('base')}, not {dev}")
    if facts.get("draft"):
        shape.append("PR is a draft")

    fast = facts.get("fast_lane")
    if fast and not fast.get("reasons") and not shape:
        short = (fast.get("reverts") or "")[:7]
        return "success", f"revert fast lane: reverts {short}", details + [
            f"revert fast lane: tree equals `git revert {fast.get('reverts')}`, red dev CI "
            f"({fast.get('red_run') or 'run'}); no reviews required (§5.3 step 6)"]
    if fast and fast.get("reasons"):
        details.append("not the revert fast lane: " + "; ".join(fast["reasons"]))

    problems, failed = list(shape), []
    problems += body_problems(facts.get("body"), tier)
    required = required_reviews(cfg, tier)
    reviewer = facts.get("reviewer_login")
    if required and not reviewer:
        problems.append("reviewer bot not configured (bot.reviewer_login)")
    reviews = facts.get("reviews") or {}
    for ctx in required if reviewer else ():
        r = reviews.get(ctx) or {"source": "missing"}
        state, src, at = r.get("state"), r.get("source"), (r.get("sha") or "")[:7]
        if src == "stale":
            problems.append(f"{ctx} stale (diff changed since {at})")
            details.append(f"{ctx}: {state} on {at}, PR diff changed since: re-review needed")
        elif src == "missing" or not state:
            problems.append(f"needs {ctx}")
            details.append(f"{ctx}: no status from {reviewer}")
        elif state in ("failure", "error"):
            failed.append(ctx)
            details.append(f"{ctx}: {state}" + (f" (carried from {at})" if src == "carried" else ""))
        elif state == "success":
            details.append(f"{ctx}: success" + (f" (carried from {at}, same net diff)"
                                               if src == "carried" else ""))
        else:
            problems.append(f"{ctx} {state}")
            details.append(f"{ctx}: {state}")

    if failed:
        return "failure", f"{tier}: " + "; ".join([f"{c} failed" for c in failed] + problems), details
    if problems:
        return "pending", f"{tier}: " + "; ".join(problems), details
    if not required:
        return "success", f"{tier}: no review needed", details
    carried = [c for c in required if (reviews.get(c) or {}).get("source") == "carried"]
    return "success", f"{tier}: " + ", ".join(required) + " passed" + (
        " (carried over)" if carried else ""), details


# ── gathering facts (GitHub + git; read-only) ──────────────────────────────────────────────────
def classify(cfg, git, base, head, labels=()):
    """(tier, {path: (tier, reason)}) of base..head; migration bodies are read at head."""
    paths = git.changed(base, head)
    return cfg.classifier().classify(paths, read_body=lambda p: git.show(head, p), labels=labels)


def review_verdicts(gh, slug, git, cfg, commits, head, mb, required, reviewer):
    """{context: {state, source, sha}} for the required review contexts.

    source = head (posted on the head SHA) | carried (an earlier SHA with the same net diff,
    §5.3 step 5) | stale (an earlier SHA whose diff differs) | missing. Only statuses created by
    the reviewer login count. Each earlier SHA is compared with its own merge-base with dev, so
    merging dev into the branch does not make an approval stale."""
    if not required or not reviewer:
        return {}
    cache = {}

    def verdicts(sha):
        if sha not in cache:
            cache[sha] = cilib.latest_by_context(cilib.statuses(gh, slug, sha), login=reviewer)
        return cache[sha]

    out, head_v = {}, verdicts(head)
    for ctx in required:
        if ctx in head_v:
            out[ctx] = {"state": head_v[ctx].get("state"), "source": "head", "sha": head}
    todo = [c for c in required if c not in out]
    if not todo:
        return out
    dev_ref = git.remote_ref(cfg.get("repos", "main", "default_branch", default="dev"))
    head_pid = git.diff_id(mb, head)
    earlier = [c["sha"] for c in commits if c.get("sha") != head][-COMMITS_WALK_MAX:]
    pids = {}
    for sha in reversed(earlier):                       # newest first: the latest verdict wins
        if not todo:
            break
        found = [c for c in todo if c in verdicts(sha)]
        if not found:
            continue
        if sha not in pids:
            sha_mb = git.merge_base(dev_ref, sha) if git.has_commit(sha) else None
            pids[sha] = git.diff_id(sha_mb, sha) if sha_mb else None
        same = pids[sha] is not None and pids[sha] == head_pid
        for ctx in found:
            out[ctx] = {"state": verdicts(sha)[ctx].get("state"),
                        "source": "carried" if same else "stale", "sha": sha}
            todo.remove(ctx)
    return out


def fast_lane(gh, slug, git, cfg, pr, commits, mb, head):
    """The revert fast lane (§5.3 step 6, §5.5), or None when the PR is not a revert/* PR.

    Returns {reverts, red_run, reasons}; it applies only when reasons is empty:
    exactly one reverted commit X; X is a single-parent (squash) commit on dev's first-parent
    line; the PR's net diff equals `git revert X` by exact diff; and dev CI (ci.yml on push) is red
    on X or a later dev commit."""
    revert_pattern = cfg.get("branches", "revert", default="revert/{key}").split("{")[0]
    if not (pr.get("head") or {}).get("ref", "").startswith(revert_pattern):
        return None
    texts = [pr.get("body") or ""] + [(c.get("commit") or {}).get("message") or "" for c in commits]
    named = {m for t in texts for m in cilib.REVERTS_RE.findall(t)}
    if len(named) != 1:
        return {"reverts": None, "red_run": None,
                "reasons": [f"names {len(named)} reverted commits (needs exactly one "
                            "'This reverts commit <sha>')"]}
    x = named.pop()
    out = {"reverts": x, "red_run": None, "reasons": []}
    dev = cfg.get("repos", "main", "default_branch", default="dev")
    dev_ref = git.remote_ref(dev)
    if not git.has_commit(x) or not git.is_ancestor(x, dev_ref):
        out["reasons"].append(f"{x[:7]} is not on {dev}")
        return out
    parents = git.parents(x)
    if len(parents) != 1:
        out["reasons"].append(f"{x[:7]} is not a squash commit")
        return out
    later = git.first_parent(f"{parents[0]}..{dev_ref}", max_count=1000)
    if x not in later:
        out["reasons"].append(f"{x[:7]} is not on {dev}'s first-parent line")
        return out
    if git.diff_id(x, parents[0]) != git.diff_id(mb, head):
        out["reasons"].append(f"diff is not exactly `git revert {x[:7]}`")
    runs = gh.get(f"/repos/{slug}/actions/workflows/ci.yml/runs", branch=dev, event="push",
                  per_page=100) or {}
    red = [r for r in runs.get("workflow_runs", [])
           if r.get("head_sha") in later and r.get("conclusion") in RED]
    if red:
        out["red_run"] = red[0].get("html_url") or red[0].get("head_sha")
    else:
        out["reasons"].append(f"no red {dev} CI on {x[:7]} or later")
    return out


def gather(gh, slug, git, cfg, number, halted=False):
    """Every fact decide() needs for PR `number`, or None when the PR is closed (no status)."""
    pr = gh.get(f"/repos/{slug}/pulls/{number}")
    if pr.get("state") != "open":
        return None
    head = pr["head"]["sha"]
    base = (pr.get("base") or {}).get("ref")
    labels = [lb.get("name") for lb in pr.get("labels") or []]
    facts = {"number": number, "head": head, "base": base, "draft": bool(pr.get("draft")),
             "body": pr.get("body") or "", "halted": halted, "labels": labels,
             "reviewer_login": cfg.get("bot", "reviewer_login")}
    if halted:
        return facts                                   # nothing else can change the result
    dev = cfg.get("repos", "main", "default_branch", default="dev")
    branches = [dev] + ([base] if base and base != dev else [])
    git.fetch_branches(*branches)
    git.fetch_pr(number)
    if not git.has_commit(head):
        raise FactoryError(f"PR #{number} head {head[:7]} not fetched (pushed again since?)")
    mb = git.merge_base(git.remote_ref(base or dev), head)
    if not mb:
        raise FactoryError(f"PR #{number}: no merge-base with {base}")
    tier, per_file = classify(cfg, git, mb, head, labels)
    facts.update(merge_base=mb, tier=tier, per_file=per_file)
    commits = gh.paginate(f"/repos/{slug}/pulls/{number}/commits")
    facts["fast_lane"] = fast_lane(gh, slug, git, cfg, pr, commits, mb, head)
    facts["reviews"] = review_verdicts(gh, slug, git, cfg, commits, head, mb,
                                       required_reviews(cfg, tier), facts["reviewer_login"])
    return facts


def prs_for_sha(gh, slug, cfg, sha):
    """Open PRs into dev whose head is sha (a `status` event names only the commit)."""
    dev = cfg.get("repos", "main", "default_branch", default="dev")
    pulls = gh.get(f"/repos/{slug}/commits/{sha}/pulls") or []
    return sorted(p["number"] for p in pulls if p.get("state") == "open"
                  and (p.get("base") or {}).get("ref") == dev
                  and (p.get("head") or {}).get("sha") == sha)


def summary(facts, state, description, details):
    lines = [f"### factory/merge-gate: {state}", "", f"PR #{facts.get('number')} "
             f"head `{(facts.get('head') or '')[:12]}`: **{description}**", ""]
    lines += [f"- {d}" for d in details]
    per_file = facts.get("per_file") or {}
    if per_file:
        lines += ["", "| file | tier | why |", "|---|---|---|"]
        lines += [f"| `{p}` | {t} | {why} |" for p, (t, why) in sorted(per_file.items())]
    return "\n".join(lines)


# ── CLI ───────────────────────────────────────────────────────────────────────────────────────
def build_parser():
    p = argparse.ArgumentParser(prog="merge_gate.py", description="Compute the factory/merge-gate "
                                "status of a PR into dev (WORKFLOW §5.3).")
    who = p.add_mutually_exclusive_group(required=True)
    who.add_argument("--pr", type=int, help="the PR number")
    who.add_argument("--sha", help="gate the open PRs into dev whose head is this SHA")
    who.add_argument("--classify", action="store_true", help="print the tier of --base..--head")
    p.add_argument("--base", help="with --classify: the base revision")
    p.add_argument("--head", help="with --classify: the head revision (default HEAD)")
    p.add_argument("--labels", default="", help="with --classify: comma-separated PR labels")
    p.add_argument("--dry-run", action="store_true", help="print the decision, post nothing")
    p.add_argument("--config", default=cilib.DEFAULT_CONFIG,
                   help="factory/config.yml to use (default: the base checkout's)")
    p.add_argument("--repo", default=".", help="the git clone to read (default: .)")
    p.add_argument("--remote", default="origin", help="its GitHub remote (default: origin)")
    return p


def main(argv=None, opener=None):
    args = build_parser().parse_args(argv)
    try:
        if args.sha and not FULL_SHA_RE.match(args.sha):
            raise FactoryError(f"--sha needs a full 40-hex SHA, got {args.sha!r}")
        cfg = cilib.load_config(args.config)
        git = Git(args.repo, args.remote)
        if args.classify:
            if not args.base:
                raise FactoryError("--classify needs --base")
            labels = [x for x in args.labels.split(",") if x.strip()]
            tier, per_file = classify(cfg, git, args.base, args.head or "HEAD", labels)
            for path, (t, why) in sorted(per_file.items()):
                log(f"{t}  {path}  ({why})")
            print(tier)
            return 0
        gh, slug = cilib.client_from_env(opener)
        halted = cilib.env_true("FACTORY_HALTED")
        numbers = [args.pr] if args.pr else prs_for_sha(gh, slug, cfg, args.sha)
        if not numbers:
            print(f"merge-gate: no open PR into dev has head {args.sha}")
        context = cfg.get("ci", "merge_gate_context", default="factory/merge-gate")
        for number in numbers:
            facts = gather(gh, slug, git, cfg, number, halted=halted)
            if facts is None:
                print(f"merge-gate: PR #{number} is not open; nothing to post")
                continue
            state, description, details = decide(facts, cfg)
            print(f"PR #{number} {facts['head'][:7]}: {state}: {description}")
            for d in details:
                print(f"  - {d}")
            if args.dry_run:
                continue
            cilib.post_status(gh, slug, facts["head"], state, context, description,
                              target_url=cilib.run_url())
            cilib.step_summary(summary(facts, state, description, details))
        return 0
    except FactoryError as e:
        print(f"merge_gate.py: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
