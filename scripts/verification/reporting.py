import html
import json
import os
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from .models import CheckResult, aggregate_exit_code


def atomic_write(path: Path, text: str) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, path)


def write_report(run_dir: Path, metadata: dict[str, object], results: list[CheckResult]) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "metadata": metadata,
        "exit_code": (2 if metadata.get("state") == "running" else aggregate_exit_code(results)),
        "counts": dict(Counter(r.status for r in results)),
        "results": [asdict(r) for r in results],
    }
    atomic_write(run_dir / "results.json", json.dumps(payload, indent=2, ensure_ascii=False))
    lines = [
        "# HyperSynced verification",
        "",
        f"Exit code: {payload['exit_code']}",
        "",
        "```json",
        json.dumps(metadata, indent=2, ensure_ascii=False),
        "```",
        "",
    ]
    for result in results:
        lines.append(
            f"- {result.status.upper()}: {result.name} ({result.duration_seconds:.2f}s) "
            f"{result.detail} — log: {result.log_path or 'none'}"
        )
    summary = "\n".join(lines) + "\n"
    atomic_write(run_dir / "summary.md", summary)
    atomic_write(
        run_dir / "index.html",
        '<!doctype html><meta charset="utf-8">'
        "<title>HyperSynced verification</title><style>body{font:15px system-ui;"
        "margin:2rem}pre{white-space:pre-wrap}</style><pre>"
        + html.escape(summary)
        + '</pre><p><a href="browser-report/index.html">'
        "Browser report (when generated)</a></p>",
    )
