"""Minimal GitHub REST client (urllib). Tokens come from gh-token or founder.env, never argv."""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

from .common import FactoryError

API = "https://api.github.com"


class GitHubError(FactoryError):
    def __init__(self, status, msg):
        super().__init__(f"GitHub {status}: {msg}")
        self.status = status


class GitHub:
    def __init__(self, token, api=API, opener=None):
        if not token:
            raise FactoryError("no GitHub token")
        self.token = token
        self.api = api.rstrip("/")
        self._open = opener or urllib.request.urlopen

    def request(self, method, path, body=None, params=None, accept="application/vnd.github+json"):
        url = path if path.startswith("http") else self.api + path
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}",
            "Accept": accept,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "factory-cli/1",
            **({"Content-Type": "application/json"} if data else {}),
        })
        try:
            with self._open(req, timeout=30) as resp:
                raw = resp.read()
                link = resp.headers.get("Link", "") if resp.headers else ""
                return (json.loads(raw) if raw else None), link
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read() or b"{}").get("message", e.reason)
            except ValueError:
                msg = e.reason
            raise GitHubError(e.code, f"{method} {path}: {msg}")
        except urllib.error.URLError as e:
            raise FactoryError(f"GitHub unreachable: {e.reason}")

    def get(self, path, **params):
        return self.request("GET", path, params=params or None)[0]

    def post(self, path, body=None):
        return self.request("POST", path, body=body)[0]

    def patch(self, path, body):
        return self.request("PATCH", path, body=body)[0]

    def paginate(self, path, key=None, **params):
        params.setdefault("per_page", 100)
        url, out = path, []
        while url:
            data, link = self.request("GET", url, params=params if url == path else None)
            out.extend(data[key] if key else data)
            m = re.search(r'<([^>]+)>;\s*rel="next"', link or "")
            url = m.group(1) if m else None
        return out

    # ── helpers used by several subcommands ────────────────────────────────────────────────
    def set_variable(self, slug, name, value):
        """Create or update an Actions repository variable."""
        try:
            self.patch(f"/repos/{slug}/actions/variables/{name}", {"name": name, "value": value})
        except GitHubError as e:
            if e.status != 404:
                raise
            self.post(f"/repos/{slug}/actions/variables", {"name": name, "value": value})

    def get_variable(self, slug, name):
        try:
            return self.get(f"/repos/{slug}/actions/variables/{name}").get("value")
        except GitHubError as e:
            if e.status == 404:
                return None
            raise

    def dispatch(self, slug, workflow, ref, inputs=None):
        self.post(f"/repos/{slug}/actions/workflows/{workflow}/dispatches",
                  {"ref": ref, "inputs": inputs or {}})
