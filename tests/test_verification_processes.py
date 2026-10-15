import os
import socket
import sys
import time

import pytest

from scripts.verification.environment import assert_port_available
from scripts.verification.processes import run_check


def test_occupied_port_does_not_kill_owner():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        with pytest.raises(OSError):
            assert_port_available(listener.getsockname()[1])
        assert listener.fileno() >= 0


@pytest.mark.skipif(os.name == "nt", reason="Windows cleanup exercised by CI process job")
def test_timeout_terminates_owned_descendant(tmp_path):
    marker = tmp_path / "escaped"
    child = f"import time; from pathlib import Path; time.sleep(1); Path({str(marker)!r}).touch()"
    code = (
        f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{child!r}]);"
        "time.sleep(10)"
    )
    result = run_check(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env=dict(os.environ),
        timeout_seconds=0.2,
        log_path=tmp_path / "timeout.log",
        secrets=(),
    )
    time.sleep(1.2)
    assert result.status == "failed"
    assert not marker.exists()


def test_interruption_leaves_evidence_and_stops_child(tmp_path, monkeypatch):
    import subprocess

    original = subprocess.Popen.wait
    interrupted = False

    def interrupt_once(self, *args, **kwargs):
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            raise KeyboardInterrupt
        return original(self, *args, **kwargs)

    monkeypatch.setattr(subprocess.Popen, "wait", interrupt_once)
    result = run_check(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        cwd=tmp_path,
        env=dict(os.environ),
        timeout_seconds=5,
        log_path=tmp_path / "interrupted.log",
        secrets=(),
    )
    assert result.status == "interrupted"
    assert "Interrupted" in (tmp_path / "interrupted.log").read_text()


def test_descendants_stop_even_after_leader_exits(tmp_path):
    import time

    from scripts.verification.processes import spawn_owned, stop_process

    marker = tmp_path / 'child-ready'
    code = (
        "import pathlib,time; "
        f"p=pathlib.Path({str(marker)!r}); "
        "p.write_text('ready'); time.sleep(1); p.write_text('leaked'); time.sleep(20)"
    )
    parent_code = f'import subprocess,sys; subprocess.Popen([sys.executable,"-c",{code!r}])'
    parent = spawn_owned([sys.executable, '-c', parent_code])
    try:
        parent.wait(timeout=5)
        deadline = time.monotonic() + 5
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(.02)
        assert marker.exists()
    finally:
        stop_process(parent)
    time.sleep(1.1)
    assert marker.read_text() == 'ready'


def test_app_cleanup_attempts_all_processes_after_one_failure(monkeypatch):
    from unittest.mock import MagicMock

    from scripts.verification import application

    app = application.ManagedApp()
    first, second = MagicMock(), MagicMock()
    app.processes = [first, second]
    log = MagicMock()
    app.logs = [log]
    calls = []

    def stop(process):
        calls.append(process)
        if process is second:
            raise OSError('owned process cleanup failed')

    monkeypatch.setattr(application, 'stop_process', stop)
    with pytest.raises(RuntimeError, match='clean'):
        app.close()
    assert calls == [second, first]
    log.close.assert_called_once()
    assert app.processes == [second]
