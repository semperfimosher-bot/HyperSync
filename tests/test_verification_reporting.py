import json

from scripts.verification.models import CheckResult
from scripts.verification.reporting import write_report


def test_failure_report_is_readable_and_html_safe(tmp_path):
    result = CheckResult("browser <script>", "failed", 1.2, 1, "browser.log", "assertion failed")
    write_report(tmp_path, {"commit": "abc", "suite": "quick"}, [result])
    data = json.loads((tmp_path / "results.json").read_text())
    assert data["results"][0]["status"] == "failed"
    assert data["exit_code"] == 1
    assert "assertion failed" in (tmp_path / "summary.md").read_text()
    html = (tmp_path / "index.html").read_text()
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_reporting_preserves_failed_attempt_when_retry_passes(tmp_path):
    results = [
        CheckResult("journey attempt 1", "failed", 1, 1, None, "original failure"),
        CheckResult("journey retry", "passed", 1, 0, None, ""),
    ]
    write_report(tmp_path, {}, results)
    data = json.loads((tmp_path / "results.json").read_text())
    assert data["exit_code"] == 1
    assert len(data["results"]) == 2


def test_partial_report_is_never_green(tmp_path):
    from scripts.verification.models import CheckResult

    write_report(tmp_path, {'state': 'running'}, [CheckResult('first', 'passed', 1, 0, None, '')])
    assert json.loads((tmp_path / 'results.json').read_text())['exit_code'] == 2
