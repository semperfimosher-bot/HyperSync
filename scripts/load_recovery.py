"""Small, unauthenticated loopback-only HTTP load/recovery rehearsal.

Never point a local port forward at production. This runner does not mutate the
service, orchestrate outages, or certify deployment capacity.
"""

import argparse
import json
import math
import multiprocessing
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_target(target: str) -> str:
    try:
        parsed = urlsplit(target)
        valid = (
            parsed.scheme == "http"
            and parsed.hostname in {"127.0.0.1", "::1"}
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
            and parsed.port != 0
            and not any(char.isspace() for char in target)
        )
    except ValueError:
        valid = False
    if not valid:
        # Never echo rejected input: it may contain a credential.
        raise ValueError("Use an HTTP literal loopback URL without credentials, query, or fragment")
    return target


def _request(target: str, timeout: float):
    start = time.monotonic()
    status = None
    error = None
    try:
        # Disable environment proxies and redirects, including redirects off-loopback.
        opener = build_opener(ProxyHandler({}), NoRedirect())
        request = Request(
            target, method="GET", headers={"User-Agent": "HyperSync-isolated-rehearsal"}
        )
        with opener.open(request, timeout=timeout) as response:
            status = response.status
            # Do not download a possibly large or unbounded response body.
    except HTTPError as exc:
        status = exc.code
        exc.close()
    except TimeoutError:
        error = "timeout"
    except URLError as exc:
        error = "timeout" if isinstance(exc.reason, TimeoutError) else "transport"
    except OSError:
        error = "transport"
    return (time.monotonic() - start) * 1000, status, error


def run_phase(target: str, *, requests: int, concurrency: int, timeout: float) -> dict:
    validate_target(target)
    if not (1 <= requests <= 10000 and 1 <= concurrency <= 64 and 0 < timeout <= 30):
        raise ValueError("Limits: requests 1..10000, concurrency 1..64, timeout (0,30] seconds")
    start = time.monotonic()
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        observations = list(executor.map(lambda _: _request(target, timeout), range(requests)))
    elapsed = time.monotonic() - start
    latencies = sorted(value[0] for value in observations)
    statuses = Counter(str(value[1]) for value in observations if value[1] is not None)
    return {
        "completed": len(observations),
        "concurrency": concurrency,
        "elapsed_seconds": round(elapsed, 6),
        "requests_per_second": round(requests / max(elapsed, 0.000001), 3),
        "p50_ms": round(latencies[math.ceil(requests * 0.50) - 1], 3),
        "p95_ms": round(latencies[math.ceil(requests * 0.95) - 1], 3),
        "max_ms": round(latencies[-1], 3),
        "status_counts": dict(sorted(statuses.items())),
        "http_503": statuses["503"],
        "http_errors": sum(count for status, count in statuses.items() if int(status) >= 400),
        "timeouts": sum(value[2] == "timeout" for value in observations),
        "transport_errors": sum(value[2] == "transport" for value in observations),
    }


def _phases(args, sender):
    report: dict = {"evidence": "isolated HTTP rehearsal; not deployment capacity certification"}
    try:
        for name, count, concurrency in (
            ("baseline", args.recovery_requests, 1),
            ("load", args.requests, args.concurrency),
            ("recovery", args.recovery_requests, 1),
        ):
            report[name] = run_phase(
                args.url,
                requests=count,
                concurrency=concurrency,
                timeout=args.timeout,
            )
        sender.send(report)
    finally:
        sender.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000/health")
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--timeout", type=float, default=2)
    parser.add_argument("--recovery-requests", type=int, default=10)
    parser.add_argument("--max-seconds", type=float, default=60)
    args = parser.parse_args()
    try:
        validate_target(args.url)
        if not (
            1 <= args.requests <= 10000
            and 1 <= args.recovery_requests <= 10000
            and 1 <= args.concurrency <= 64
            and 0 < args.timeout <= 30
            and 0 < args.max_seconds <= 300
        ):
            raise ValueError("Invalid workload bounds")
    except ValueError as exc:
        parser.exit(2, str(exc) + "\n")
    # A subprocess enforces a whole-run deadline even if a server trickles HTTP
    # headers forever (socket timeout alone only bounds inactivity).
    ctx = multiprocessing.get_context("spawn")
    receiver, sender = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_phases, args=(args, sender), daemon=True)
    process.start()
    sender.close()
    try:
        if not receiver.poll(args.max_seconds):
            print(
                json.dumps(
                    {"evidence": "isolated rehearsal", "error": "wall-clock deadline exceeded"}
                )
            )
            return 124
        try:
            report = receiver.recv()
        except EOFError:
            print(json.dumps({"evidence": "isolated rehearsal", "error": "runner failed"}))
            return 1
    finally:
        receiver.close()
        process.join(timeout=0.1)
        if process.is_alive():
            process.terminate()
            process.join(timeout=1)
        if process.is_alive():
            process.kill()
            process.join(timeout=1)
    print(json.dumps(report, indent=2))
    recovery = report["recovery"]
    return int(
        bool(recovery["http_errors"] or recovery["timeouts"] or recovery["transport_errors"])
    )


if __name__ == "__main__":
    raise SystemExit(main())
