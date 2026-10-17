"""Small helpers shared by every subcommand."""
import datetime as _dt
import os
import pwd
import re
import secrets
import subprocess
import sys

TZ_NAME = "Asia/Jakarta"


class FactoryError(Exception):
    """A refusal or failure the CLI reports as one line and exit 1."""


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def die(msg):
    raise FactoryError(msg)


def username():
    return pwd.getpwuid(os.getuid()).pw_name


def uid_of(user):
    try:
        return pwd.getpwnam(user).pw_uid
    except KeyError:
        return None


def home_of(user):
    return pwd.getpwnam(user).pw_dir


_DUR = re.compile(r"^\s*(\d+)\s*(s|sec|m|min|h|d)\s*$")
_DUR_UNIT = {"s": 1, "sec": 1, "m": 60, "min": 60, "h": 3600, "d": 86400}


def parse_duration(text):
    """'30s', '30m', '45min', '2h', '7d' -> seconds."""
    m = _DUR.match(str(text))
    if not m:
        raise ValueError(f"bad duration: {text!r}")
    return int(m.group(1)) * _DUR_UNIT[m.group(2)]


def now_utc():
    return _dt.datetime.now(_dt.timezone.utc)


def wib(dt=None):
    """The factory's wall clock (⚑S-14): Asia/Jakarta, fixed UTC+7 (no DST)."""
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(TZ_NAME)
    except Exception:  # pragma: no cover - zoneinfo data missing
        tz = _dt.timezone(_dt.timedelta(hours=7), "WIB")
    return (dt or now_utc()).astimezone(tz)


def stamp(dt=None):
    return wib(dt).strftime("%Y%m%dT%H%M%S")


def parse_time(text):
    """RFC3339 (with Z or offset, optional fraction) -> aware datetime, or None."""
    if not text:
        return None
    t = str(text).strip().replace("Z", "+00:00")
    # Python < 3.11 cannot parse more than 6 fraction digits.
    t = re.sub(r"(\.\d{6})\d+", r"\1", t)
    try:
        dt = _dt.datetime.fromisoformat(t)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_dt.timezone.utc)
    return dt


def in_quiet_hours(start, end, at=None):
    """True when the WIB wall clock is inside [start, end) ('22:00', '06:00'); wraps midnight."""
    t = wib(at)
    minutes = t.hour * 60 + t.minute
    s = _hhmm(start)
    e = _hhmm(end)
    if s == e:
        return False
    if s < e:
        return s <= minutes < e
    return minutes >= s or minutes < e


def _hhmm(text):
    h, m = str(text).split(":")
    return int(h) * 60 + int(m)


def read_env_file(path):
    """KEY=VALUE lines; '#' comments; optional single or double quotes; no expansion."""
    out = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:].lstrip()
            key, sep, val = line.partition("=")
            if not sep or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key.strip()):
                continue
            val = val.strip()
            if len(val) >= 2 and val[0] == val[-1] and val[0] in "'\"":
                val = val[1:-1]
            out[key.strip()] = val
    return out


def atomic_write(path, data, mode=0o644, group=None):
    """Write via a dotfile in the same directory, then rename (readers never see a partial file)."""
    d = os.path.dirname(path) or "."
    tmp = os.path.join(d, f".{os.path.basename(path)}.{secrets.token_hex(4)}.tmp")
    if isinstance(data, str):
        data = data.encode("utf-8")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.chmod(tmp, mode)
        if group is not None:
            try:
                import grp
                os.chown(tmp, -1, grp.getgrnam(group).gr_gid)
            except (KeyError, PermissionError):
                pass
            os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def run(cmd, check=True, capture=True, env=None, cwd=None, input=None, timeout=None):
    """subprocess.run with text I/O; raises FactoryError carrying stderr on failure."""
    try:
        res = subprocess.run(cmd, check=False, text=True, env=env, cwd=cwd, input=input,
                             timeout=timeout,
                             stdout=subprocess.PIPE if capture else None,
                             stderr=subprocess.PIPE if capture else None)
    except FileNotFoundError:
        raise FactoryError(f"command not found: {cmd[0]}")
    except subprocess.TimeoutExpired:
        raise FactoryError(f"timed out: {' '.join(cmd[:3])}")
    if check and res.returncode != 0:
        err = (res.stderr or "").strip().splitlines()
        raise FactoryError(f"{' '.join(cmd[:3])} failed ({res.returncode}): {err[-1] if err else ''}")
    return res


SHA_RE = re.compile(r"^[0-9a-f]{7,40}$")
FULL_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
