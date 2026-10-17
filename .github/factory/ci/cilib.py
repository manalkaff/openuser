"""Shared plumbing for the factory/ci scripts: sys.path, the Actions environment, statuses, git.

The workflows check out the BASE branch's factory/ci, factory/bin and factory/config.yml and run
these scripts from there (⚑S-17), so a PR never runs its own gate code. The PR's commits are
fetched into the same clone as data only (refs/factory/pr/<n>); they are never checked out.
"""
import hashlib
import os
import re
import subprocess
import sys

CI_DIR = os.path.dirname(os.path.abspath(__file__))
FACTORY_DIR = os.path.dirname(CI_DIR)
BIN_DIR = os.path.join(FACTORY_DIR, "bin")
if BIN_DIR not in sys.path:
    sys.path.insert(0, BIN_DIR)

from factory_cli import config as fconfig  # noqa: E402
from factory_cli.common import FactoryError, log, run  # noqa: E402
from factory_cli.github import API, GitHub, GitHubError  # noqa: E402

DEFAULT_CONFIG = os.path.join(FACTORY_DIR, "config.yml")
DESC_MAX = 140                     # GitHub truncates a status description at 140 characters
REVERTS_RE = re.compile(r"This reverts commit ([0-9a-f]{40})")


def body_line(body, key):
    """The value of a PR body's machine line `<key>: <value>` (TEMPLATES §3), or None when the
    line is missing, empty, or still the template's `<placeholder>`."""
    m = re.search(rf"^[ \t>*_-]*{re.escape(key)}[*_]*:[*_]*[ \t]*(.*?)[ \t]*$", body or "",
                  re.MULTILINE | re.IGNORECASE)
    value = m.group(1).strip() if m else ""
    return None if not value or "<" in value else value


def load_config(path=None):
    return fconfig.load(path or DEFAULT_CONFIG)


def client_from_env(opener=None):
    """(GitHub, slug) from the Actions environment: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL."""
    slug = os.environ.get("GITHUB_REPOSITORY")
    if not slug:
        raise FactoryError("GITHUB_REPOSITORY is not set")
    return GitHub(os.environ.get("GITHUB_TOKEN"), api=os.environ.get("GITHUB_API_URL") or API,
                  opener=opener), slug


def env_true(name):
    return os.environ.get(name, "").strip().lower() == "true"


def run_url():
    """The current Actions run, used as the status target_url; None outside Actions."""
    server, repo, run_id = (os.environ.get(k) for k in
                            ("GITHUB_SERVER_URL", "GITHUB_REPOSITORY", "GITHUB_RUN_ID"))
    return f"{server}/{repo}/actions/runs/{run_id}" if server and repo and run_id else None


def clip(text, limit=DESC_MAX):
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


def post_status(gh, slug, sha, state, context, description, target_url=None):
    body = {"state": state, "context": context, "description": clip(description)}
    if target_url:
        body["target_url"] = target_url
    gh.post(f"/repos/{slug}/statuses/{sha}", body)


# Lane statuses are posted by workflow jobs with the run's GITHUB_TOKEN, whose creator is this
# login. Anyone with write access can post a commit status with any context, so a lane status
# only counts from this creator (WORKFLOW §5.9).
ACTIONS_LOGIN = "github-actions[bot]"


def statuses(gh, slug, sha):
    """Every commit status on the SHA, newest first (the API's order)."""
    return gh.paginate(f"/repos/{slug}/commits/{sha}/statuses")


def latest_by_context(items, login=None):
    """{context: newest status}; with login, only statuses whose creator is that account."""
    out = {}
    for s in items or []:
        if login is not None and ((s.get("creator") or {}).get("login") != login):
            continue
        out.setdefault(s.get("context"), s)
    return out


def step_summary(text):
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(text.rstrip("\n") + "\n")


def set_output(name, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(f"{name}={value}\n")


HUNK_RE = re.compile(rb"^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@")


def diff_digest(diff):
    """sha256 of a `git diff` output with index lines and hunk line numbers removed. Header lines
    are only dropped in a file's header (before its first hunk or binary patch), never in
    content, so every added, removed or context byte counts."""
    h, in_header = hashlib.sha256(), False
    for line in diff.splitlines(keepends=True):
        if line.startswith(b"diff --git "):
            in_header = True
        elif in_header and line.startswith(b"index "):
            continue
        elif line.startswith((b"@@", b"GIT binary patch", b"Binary files ")) and in_header:
            in_header = False
        if not in_header and line.startswith(b"@@"):
            line = HUNK_RE.sub(b"@@ @@", line, count=1)
        h.update(line)
    return h.hexdigest()


class Git:
    """Read-only git facts from one clone. Every call is `git -C <repo> ...`."""

    def __init__(self, repo=".", remote="origin"):
        self.repo, self.remote = repo, remote

    def run(self, *args, check=True, input=None):
        return run(["git", "-C", self.repo, *args], check=check, input=input)

    def out(self, *args):
        return self.run(*args).stdout.strip()

    def ok(self, *args):
        return self.run(*args, check=False).returncode == 0

    def fetch(self, *refspecs):
        self.run("fetch", "--quiet", "--no-tags", self.remote, *refspecs)

    def remote_ref(self, branch):
        return f"refs/remotes/{self.remote}/{branch}"

    def fetch_branches(self, *branches):
        self.fetch(*(f"+refs/heads/{b}:{self.remote_ref(b)}" for b in branches))

    def fetch_pr(self, number):
        """The PR head as data: refs/factory/pr/<n>. Never checked out."""
        ref = f"refs/factory/pr/{number}"
        self.fetch(f"+refs/pull/{number}/head:{ref}")
        return ref

    def has_commit(self, rev):
        return self.ok("cat-file", "-e", f"{rev}^{{commit}}")

    def rev(self, rev):
        res = self.run("rev-parse", "--verify", "--quiet", f"{rev}^{{commit}}", check=False)
        return res.stdout.strip() if res.returncode == 0 else None

    def merge_base(self, a, b):
        res = self.run("merge-base", a, b, check=False)
        return res.stdout.strip() if res.returncode == 0 else None

    def is_ancestor(self, a, b):
        return self.ok("merge-base", "--is-ancestor", a, b)

    def changed(self, a, b):
        """Paths changed from a to b. Renames count as a delete plus an add (both sides classify)."""
        raw = self.run("diff", "--name-only", "--no-renames", "-z", a, b).stdout
        return [p for p in raw.split("\0") if p]

    def raw(self, *args, input=None):
        """Bytes in and out (diffs and blobs need not be UTF-8); raises FactoryError on failure."""
        res = subprocess.run(["git", "-C", self.repo, *args], input=input,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if res.returncode != 0:
            err = res.stderr.decode("utf-8", "replace").strip().splitlines()
            raise FactoryError(f"git {args[0]} failed ({res.returncode}): {err[-1] if err else ''}")
        return res.stdout

    def show(self, rev, path):
        """The file's text at rev, or None when it does not exist there. Undecodable bytes are
        replaced, so a binary file still reads as (meaningless) text, never as "deleted"."""
        if not self.exists(rev, path):
            return None
        return self.raw("show", f"{rev}:{path}").decode("utf-8", "replace")

    def exists(self, rev, path):
        return self.ok("cat-file", "-e", f"{rev}:{path}")

    def diff_id(self, a, b):
        """A hash of the exact diff a..b; '' for an empty diff (WORKFLOW §5.3 step 5).

        Unlike `git patch-id`, it does not ignore whitespace, so a whitespace-only push still makes
        a review stale and a whitespace edit is not "exactly a revert". Only what depends on where
        the change sits is dropped: `index` header lines (blob ids of the whole file) and hunk
        line numbers, so the same change rebased onto a moved dev keeps its id."""
        diff = self.raw("diff", "--no-color", "--no-ext-diff", "--no-renames", "--full-index",
                        "--binary", a, b)
        return diff_digest(diff) if diff else ""

    def parents(self, sha):
        return self.out("rev-list", "--parents", "-n", "1", sha).split()[1:]

    def first_parent(self, rev_range, max_count=500, since=None):
        args = ["rev-list", "--first-parent", f"--max-count={max_count}"]
        if since:
            args.append(f"--since={since}")
        return self.out(*args, rev_range).split()

    def commits(self, *revs):
        """Oldest first, merges included. revs as rev-list takes them (`a..b`, `b ^a ^c`)."""
        return self.out("rev-list", "--reverse", *revs).split()

    def message(self, sha):
        return self.run("log", "-1", "--format=%B", sha).stdout

    def subject(self, sha):
        return self.out("log", "-1", "--format=%s", sha)

    def commit_time(self, sha):
        return int(self.out("log", "-1", "--format=%ct", sha))

    def trailers(self, sha):
        """{key: [values]} from the commit's trailer block."""
        raw = self.run("log", "-1", "--format=%(trailers:only,unfold)", sha).stdout
        out = {}
        for line in raw.splitlines():
            key, sep, value = line.partition(":")
            if sep:
                out.setdefault(key.strip(), []).append(value.strip())
        return out

    def touched(self, sha):
        """Paths a commit changed. For a merge, only the paths it changed against EVERY parent
        (`--cc`): a conflict resolution or an evil merge, not what the merge brought in."""
        raw = self.run("diff-tree", "-r", "--root", "--cc", "--no-commit-id", "--name-only", "-z",
                       sha).stdout
        return [p for p in raw.split("\0") if p]
