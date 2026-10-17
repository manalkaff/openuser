"""factory/config.yml: loading, path expansion, glob matching and the tier classifier.

The tier classifier is shared with factory/ci/merge_gate.py, which puts factory/bin on
sys.path and reads the config from the BASE branch (WORKFLOW §5.3).
"""
import functools
import os
import re

import yaml

from .common import FactoryError, read_env_file

BIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALLED_CONFIG = "/opt/factory/config.yml"
FACTORY_ENV = "/etc/factory/factory.env"
TIER_ORDER = ["T0", "T1", "T2", "T3"]


def default_config_path(privileged=False):
    """Privileged subcommands (run through sudo) never trust the caller's environment."""
    if privileged:
        return INSTALLED_CONFIG
    return os.environ.get("FACTORY_CONFIG") or os.path.join(os.path.dirname(BIN_DIR), "config.yml")


class Config:
    def __init__(self, data, path=None, privileged=False):
        if not isinstance(data, dict) or data.get("version") != 1:
            raise FactoryError(f"{path or 'config'}: not a version-1 factory config")
        self.data = data
        self.path = path
        self.privileged = privileged
        self._factory_env = None

    def __getitem__(self, key):
        return self.data[key]

    def get(self, *keys, default=None):
        cur = self.data
        for k in keys:
            if not isinstance(cur, dict) or k not in cur:
                return default
            cur = cur[k]
        return cur

    # ── environment ────────────────────────────────────────────────────────────────────────
    def factory_env(self):
        if self._factory_env is None:
            p = self.get("paths", "factory_env", default=FACTORY_ENV)
            try:
                self._factory_env = read_env_file(p)
            except (FileNotFoundError, PermissionError):
                self._factory_env = {}
        return self._factory_env

    @property
    def factory_home(self):
        if not self.privileged and os.environ.get("FACTORY_HOME"):
            return os.environ["FACTORY_HOME"]
        return self.factory_env().get("FACTORY_HOME") or self.get("paths", "factory_home")

    def path_of(self, key, **fmt):
        raw = self.get("paths", key)
        if raw is None:
            raise FactoryError(f"config: paths.{key} missing")
        return self.expand(raw.format(**fmt) if fmt else raw)

    def expand(self, raw):
        out = raw.replace("$FACTORY_HOME", self.factory_home)
        if "$HOME" in out:
            out = out.replace("$HOME", os.path.expanduser("~"))
        return out

    @property
    def founder(self):
        return self.factory_env().get("FACTORY_FOUNDER_USER") or self.get("users", "founder")

    def user(self, role):
        return self.get("users", role)

    def secret_file(self, user, ext="env"):
        """/etc/factory/secrets/<name>.<ext>; the founder's file is founder.env (stage A5)."""
        name = "founder" if user == self.founder else user
        return os.path.join(self.get("paths", "secrets_dir"), f"{name}.{ext}")

    # ── repos ──────────────────────────────────────────────────────────────────────────────
    def repo_slugs(self):
        return [r["slug"] for r in self.get("repos", default={}).values()]

    @property
    def main_repo(self):
        return self.get("repos", "main")

    # ── tiers ──────────────────────────────────────────────────────────────────────────────
    def classifier(self):
        return TierClassifier(self.get("tiers"), self.get("money_tables", default=[]),
                              self.get("services", "migration_paths", default=[]))


def load(path=None, privileged=False):
    path = path or default_config_path(privileged)
    try:
        with open(path, encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except FileNotFoundError:
        raise FactoryError(f"config not found: {path}")
    except yaml.YAMLError as e:
        raise FactoryError(f"{path}: invalid YAML: {e}")
    return Config(data, path, privileged)


def load_text(text, path="<text>"):
    try:
        return Config(yaml.safe_load(text), path)
    except yaml.YAMLError as e:
        raise FactoryError(f"{path}: invalid YAML: {e}")


# ── globs ──────────────────────────────────────────────────────────────────────────────────
@functools.lru_cache(maxsize=512)
def glob_to_regex(glob):
    """'**' any depth (incl. none), '*' within one segment, '?' one char, '{a,b}' alternation."""
    i, out, depth = 0, [], 0
    n = len(glob)
    while i < n:
        c = glob[i]
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("/**", i) and i + 3 == n:
            out.append("(?:/.*)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        elif c == "{":
            out.append("(?:")
            depth += 1
            i += 1
        elif c == "}" and depth:
            out.append(")")
            depth -= 1
            i += 1
        elif c == "," and depth:
            out.append("|")
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    if depth:
        raise FactoryError(f"unbalanced braces in glob {glob!r}")
    return re.compile("^" + "".join(out) + "$")


def glob_match(glob, path):
    return bool(glob_to_regex(glob).match(path))


def any_match(globs, path):
    return any(glob_match(g, path) for g in globs or [])


def tier_max(*tiers):
    tiers = [t for t in tiers if t]
    return max(tiers, key=TIER_ORDER.index) if tiers else "T0"


class TierClassifier:
    """GATES §2: per file, the highest matching tier; the PR tier is the max over files."""

    def __init__(self, tiers, money_tables, migration_paths):
        self.globs = tiers.get("globs", {})
        self.default = tiers.get("default", "T1")
        self.labels = tiers.get("labels", {})
        self.migration_paths = migration_paths or []
        self.money_re = re.compile(
            r"\b(" + "|".join(re.escape(t) for t in sorted(money_tables, key=len, reverse=True)) + r")\b",
            re.IGNORECASE) if money_tables else None

    def classify_file(self, path, read_body=None):
        """read_body(path) -> str | None (None = deleted/unreadable). Returns (tier, reason)."""
        if any_match(self.globs.get("gate_integrity"), path):
            return "T3", "gate-integrity"
        if any_match(self.migration_paths, path):
            body = read_body(path) if read_body else None
            if body is None:
                return "T3", "migration (unreadable or deleted: assumed money)"
            m = self.money_re.search(body) if self.money_re else None
            if m:
                return "T3", f"migration names money table {m.group(1).lower()}"
        for tier in ("T3", "T2", "T1", "T0"):
            if any_match(self.globs.get(tier), path):
                return tier, f"glob {tier}"
        return self.default, "default"

    def classify(self, paths, read_body=None, labels=()):
        """Returns (tier, {path: (tier, reason)}). A tier label can only raise the result."""
        per_file = {p: self.classify_file(p, read_body) for p in paths}
        tier = tier_max(*(t for t, _ in per_file.values())) if per_file else "T0"
        for label in labels or ():
            if label in self.labels:
                tier = tier_max(tier, self.labels[label])
        return tier, per_file
