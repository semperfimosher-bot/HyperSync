"""Explicit, read-only HTTPS smoke checks; no credentials, redirects or mutation routes."""

import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from .models import CheckResult


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def smoke_targets(origin: str) -> tuple[str, str]:
    target = urlsplit(origin)
    if (
        target.scheme != 'https' or not target.hostname or target.username or target.password
        or target.path not in ('', '/') or target.query or target.fragment
        or any(char.isspace() for char in origin)
    ):
        raise ValueError(
            'Smoke target must be a credential-free HTTPS origin without path or query'
        )
    _ = target.port  # Reject malformed ports before any request.
    base = origin.rstrip('/')
    return base + '/', base + '/health/ready'


def verify_smoke(origin: str, report_dir: Path) -> list[CheckResult]:
    targets = smoke_targets(origin)
    opener = build_opener(ProxyHandler({}), NoRedirect())
    results = []
    for name, url in zip(('frontend-smoke', 'readiness-smoke'), targets, strict=True):
        started = time.monotonic()
        log = report_dir / f'{name}.log'
        try:
            request = Request(url, method='GET', headers={'User-Agent': 'HyperSync-Verification/1'})
            with opener.open(request, timeout=15) as response:
                status = response.status
                body = response.read(512_001)
                content_type = response.headers.get('Content-Type', '')
            assert status == 200 and 0 < len(body) <= 512_000
            if name == 'frontend-smoke':
                assert 'text/html' in content_type and b'<html' in body.lower()
            else:
                import json

                health = json.loads(body)
                assert health.get('api') == 'healthy' and health.get('database') == 'healthy'
            log.write_text(f'GET {url}: HTTP {status}\n'
                           'Build identity and device playback are not verified by this probe.\n')
            results.append(CheckResult(name, 'passed', time.monotonic() - started, 0,
                                       str(log), 'Read-only HTTP evidence only'))
        except Exception as error:
            # Do not retain response bodies, cookies, tokens or sensitive error payloads.
            log.write_text(f'GET {url}: {type(error).__name__}\n')
            results.append(CheckResult(name, 'failed', time.monotonic() - started, 1,
                                       str(log), f'Smoke check failed: {type(error).__name__}'))
    return results
