from dataclasses import dataclass


@dataclass
class CheckResult:
    name: str
    status: str
    duration_seconds: float
    exit_code: int | None
    log_path: str | None
    detail: str


def aggregate_exit_code(results: list[CheckResult]) -> int:
    if any(r.status in {"failed", "interrupted"} for r in results):
        return 1
    if not results or any(r.status != "passed" for r in results):
        return 2
    return 0
