import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


@pytest.fixture
def service():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/slow":
                time.sleep(0.08)
            self.send_response(503 if self.path == "/busy" else 200)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()
    thread.join()


def runner():
    from scripts.load_recovery import run_phase, validate_target

    return run_phase, validate_target


@pytest.mark.parametrize(
    "target",
    [
        "https://production.example/health",
        "http://localhost/health",
        "http://user:secret@127.0.0.1/health",
        "http://127.0.0.1/health?token=secret",
        "ftp://127.0.0.1/health",
        "http://127.0.0.1/health#secret",
    ],
)
def test_refuses_non_literal_loopback_and_secrets(target):
    _, validate = runner()
    with pytest.raises(ValueError):
        validate(target)


def test_records_http_rejections_and_latency_percentiles(service):
    run, _ = runner()
    metrics = run(service + "/busy", requests=8, concurrency=2, timeout=1)
    assert metrics["completed"] == 8
    assert metrics["status_counts"] == {"503": 8}
    assert metrics["http_503"] == 8
    assert metrics["http_errors"] == 8
    assert metrics["timeouts"] == 0
    assert metrics["p95_ms"] >= metrics["p50_ms"] > 0
    assert metrics["requests_per_second"] > 0


def test_records_timeout_without_disclosing_request_or_exception(service):
    run, _ = runner()
    metrics = run(service + "/slow", requests=2, concurrency=1, timeout=0.01)
    assert metrics["timeouts"] == 2
    assert metrics["transport_errors"] == 0
    assert metrics["status_counts"] == {}
    assert service not in str(metrics)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"requests": 10001},
        {"concurrency": 65},
        {"timeout": 31},
        {"requests": 0},
        {"concurrency": 0},
        {"timeout": 0},
    ],
)
def test_refuses_unbounded_work_before_network(kwargs):
    run, _ = runner()
    with pytest.raises(ValueError):
        run(
            "http://127.0.0.1:1/health",
            **{
                "requests": 1,
                "concurrency": 1,
                "timeout": 1,
                **kwargs,
            },
        )


def test_cli_enforces_wall_clock_budget(service):
    import subprocess
    import sys
    from pathlib import Path

    result = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).resolve().parents[1] / "load_recovery.py"),
            "--url",
            service + "/slow",
            "--requests",
            "100",
            "--concurrency",
            "1",
            "--max-seconds",
            "0.05",
        ],
        capture_output=True,
        text=True,
        timeout=5,
    )
    assert result.returncode == 124
    assert "deadline" in result.stdout
    assert service not in result.stdout + result.stderr


def test_success_after_overload_has_no_errors(service):
    run, _ = runner()
    assert run(service + "/busy", requests=2, concurrency=2, timeout=1)["http_503"] == 2
    recovery = run(service + "/health", requests=3, concurrency=1, timeout=1)
    assert recovery["status_counts"] == {"200": 3}
    assert recovery["http_errors"] == recovery["timeouts"] == recovery["transport_errors"] == 0
