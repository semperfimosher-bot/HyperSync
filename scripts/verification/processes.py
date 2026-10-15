import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import IO

from .models import CheckResult


def process_options() -> dict:
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def spawn_owned(*args, **kwargs) -> subprocess.Popen:
    if os.name != "nt":
        return subprocess.Popen(*args, **kwargs, **process_options())
    from .windows_job import WindowsJob

    job = WindowsJob()
    process = None
    try:
        process = subprocess.Popen(
            *args, **kwargs,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | 0x4,  # CREATE_SUSPENDED
        )
        job.assign_and_resume(process._handle)
        process._verification_job = job
        return process
    except BaseException:
        if process is not None:
            process.kill()
            process.wait(timeout=5)
        job.close()
        raise


def stop_process(process: subprocess.Popen) -> None:
    """Stop only the process group created by this runner, including descendants."""
    if os.name == "nt":
        job = getattr(process, "_verification_job", None)
        if job is not None:
            job.close()
        elif process.poll() is None:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                timeout=10,
                check=False,
            )
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def _copy_redacted(source: IO[bytes], destination: IO[str], secrets: tuple[str, ...]) -> None:
    import codecs

    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    private = sorted((s for s in secrets if s), key=len, reverse=True)
    reserve = max([len(s) for s in private] + [1])
    pending = ""
    while True:
        chunk = source.read1(4096)  # type: ignore[attr-defined]
        pending += decoder.decode(chunk, final=not chunk)
        cut = max(0, len(pending) - reserve) if chunk else len(pending)
        for secret in private:
            start = pending.find(secret, max(0, cut - len(secret)))
            if start >= 0 and start < cut < start + len(secret):
                cut = start
        text, pending = pending[:cut], pending[cut:]
        for secret in private:
            text = text.replace(secret, "[REDACTED]")
        destination.write(text)
        destination.flush()
        if not chunk:
            break


def run_check(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
    timeout_seconds: float,
    log_path: Path,
    secrets: tuple[str, ...],
) -> CheckResult:
    started = time.monotonic()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    result = CheckResult(log_path.stem, "failed", 0, None, log_path.name, "")
    process = None
    reader = None
    errors: list[str] = []
    with log_path.open("w", encoding="utf-8") as log:
        try:
            process = spawn_owned(
                argv,
                cwd=cwd,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
            )

            def copy() -> None:
                try:
                    assert process is not None and process.stdout is not None
                    _copy_redacted(process.stdout, log, secrets)
                except Exception as exc:
                    errors.append(type(exc).__name__)

            reader = threading.Thread(target=copy, daemon=True)
            reader.start()
            process.wait(timeout=timeout_seconds)
            result.exit_code = process.returncode
            result.status = "passed" if process.returncode == 0 else "failed"
        except (FileNotFoundError, PermissionError) as exc:
            result.status, result.detail = (
                "blocked",
                f"Cannot launch required command: {type(exc).__name__}",
            )
        except subprocess.TimeoutExpired:
            result.detail = f"Timeout after {timeout_seconds:g} seconds"
        except KeyboardInterrupt:
            result.status, result.detail = "interrupted", "Interrupted by user"
        except OSError as exc:
            result.detail = f"Process error: {type(exc).__name__}"
        finally:
            if process is not None:
                stop_process(process)
            if reader is not None:
                reader.join(timeout=10)
            if process is not None and process.stdout is not None:
                process.stdout.close()
        if errors or (reader is not None and reader.is_alive()):
            result.status, result.detail = "failed", "Log capture did not complete"
        if result.detail:
            log.write("\n" + result.detail + "\n")
    result.duration_seconds = time.monotonic() - started
    return result
