"""Safety for the public version.

- URL guard: when hosted publicly, the site checker and persona journeys must
  not be able to reach the server's own network (localhost, 10.x, 192.168.x,
  cloud metadata at 169.254.169.254, ...). This is SSRF protection. It checks
  the address typed in AND every request the page makes afterwards (redirects,
  iframes, scripts), via a Playwright route.
- Rate limits: a small free daily allowance per visitor IP. Visitors who paste
  their own Anthropic key aren't limited on AI features.
"""

from __future__ import annotations

import ipaddress
import os
import posixpath
import socket
import threading
import time
from functools import lru_cache
from urllib.parse import unquote, urlsplit

ALLOWED_PORTS = {None, 80, 443, 8080, 8443}


def public_mode() -> bool:
    return os.environ.get("PUBLIC_MODE", "").lower() in ("1", "true", "yes")


class BlockedURL(ValueError):
    pass


@lru_cache(maxsize=2048)
def _host_is_public(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
        addrs = [ip]
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror:
            return True  # unresolvable: the browser will fail on its own; nothing internal is reachable
        addrs = [ipaddress.ip_address(i[4][0].split("%")[0]) for i in infos]
    return all(a.is_global and not a.is_multicast for a in addrs)


def local_bench_url(path: str) -> str:
    """The built-in demo sites, loaded from this server over loopback (works the same in Docker, on Render, locally)."""
    return f"http://127.0.0.1:{int(os.environ.get('PORT', 5000))}{path}"


def _is_local_bench(parts) -> bool:
    # Only this server's own /bench/ pages are exempt; the path must stay under /bench/ after decoding "..".
    path = posixpath.normpath(unquote(parts.path))
    return (parts.scheme == "http" and parts.hostname == "127.0.0.1"
            and parts.port == int(os.environ.get("PORT", 5000)) and path.startswith("/bench/"))


def check_url(url: str) -> None:
    """Raise BlockedURL if `url` points to a private/internal address (public mode only)."""
    if not public_mode():
        return
    parts = urlsplit(url)
    if _is_local_bench(parts):
        return
    if parts.scheme not in ("http", "https"):
        raise BlockedURL("Only http:// and https:// addresses can be checked.")
    host = (parts.hostname or "").lower()
    if not host or host in ("localhost",) or host.endswith((".localhost", ".local", ".internal")):
        raise BlockedURL("Local and internal addresses can't be checked on the public version.")
    if parts.port not in ALLOWED_PORTS:
        raise BlockedURL("Only standard web ports (80, 443, 8080, 8443) are allowed on the public version.")
    if not _host_is_public(host):
        raise BlockedURL("That address points to a private or internal network, which isn't allowed on the public version.")


def install_route_guard(context) -> None:
    """Block every request from the page to internal addresses (public mode only)."""
    if not public_mode():
        return

    def handler(route, request):
        url = request.url
        if url.startswith(("data:", "blob:", "about:")):
            return route.continue_()
        try:
            check_url(url)
        except BlockedURL:
            return route.abort("blockedbyclient")
        return route.continue_()

    context.route("**/*", handler)


# --------------------------------------------------------------------------
# rate limits


DEFAULT_LIMITS = {"journey": 12}  # one run = 4 journeys (one per persona)


def limits() -> dict:
    return {k: int(os.environ.get(f"LIMIT_{k.upper()}", v)) for k, v in DEFAULT_LIMITS.items()}


class RateLimiter:
    """In-memory daily counters per visitor (fine for a single-process demo deployment)."""

    def __init__(self):
        self._counts: dict[tuple[str, str, int], int] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _day() -> int:
        return int(time.time() // 86400)

    def remaining(self, visitor: str, kind: str) -> int:
        with self._lock:
            return max(0, limits()[kind] - self._counts.get((visitor, kind, self._day()), 0))

    def take(self, visitor: str, kind: str, n: int = 1) -> bool:
        if not public_mode():
            return True
        day = self._day()
        with self._lock:
            key = (visitor, kind, day)
            used = self._counts.get(key, 0)
            if used + n > limits()[kind]:
                return False
            self._counts[key] = used + n
            if len(self._counts) > 50_000:  # drop old days
                self._counts = {k: v for k, v in self._counts.items() if k[2] == day}
            return True


class Busy:
    """Caps concurrent heavy work (each journey or check runs its own browser)."""

    def __init__(self, limit: int):
        self._sem = threading.BoundedSemaphore(limit)

    def __enter__(self):
        if not self._sem.acquire(blocking=False):
            raise BusyError()
        return self

    def __exit__(self, *exc):
        self._sem.release()

    def try_acquire(self) -> bool:
        return self._sem.acquire(blocking=False)

    def release(self):
        self._sem.release()


class BusyError(RuntimeError):
    pass
