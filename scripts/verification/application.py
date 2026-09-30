import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from .environment import RunEnvironment, assert_port_available, child_environment
from .processes import spawn_owned, stop_process

ROOT = Path(__file__).resolve().parents[2]


class ManagedApp:
    def __init__(self) -> None:
        self.processes: list[subprocess.Popen] = []
        self.logs: list = []

    def close(self) -> None:
        errors = []
        remaining = []
        for process in reversed(self.processes):
            try:
                stop_process(process)
            except Exception as error:
                errors.append(error)
                remaining.append(process)
        self.processes = remaining
        for log in self.logs:
            try:
                log.close()
            except Exception as error:
                errors.append(error)
        self.logs.clear()
        if errors:
            raise RuntimeError(f"Failed to clean {len(errors)} owned resources") from errors[0]



def start_app(environment: RunEnvironment) -> ManagedApp:
    assert_port_available(environment.api_port)
    assert_port_available(environment.web_port)
    if not (ROOT / "frontend/dist/index.html").is_file():
        raise FileNotFoundError("Run npm run build in frontend first")
    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    if not npm:
        raise FileNotFoundError("npm is required")
    app = ManagedApp()
    env = child_environment(environment)
    env["PYTHONPATH"] = str(ROOT)
    commands = [
        (
            [
                sys.executable,
                "-m",
                "scripts.verification.serve",
                "--manifest",
                str(environment.manifest_path),
            ],
            ROOT,
            environment.api_port,
            "/health/ready",
        ),
        (
            [
                npm,
                "run",
                "preview",
                "--",
                "--host",
                "127.0.0.1",
                "--port",
                str(environment.web_port),
                "--strictPort",
            ],
            ROOT / "frontend",
            environment.web_port,
            "/",
        ),
    ]
    try:
        for command, cwd, port, path in commands:
            log = (environment.root / f"server-{port}.log").open("w")
            app.logs.append(log)
            process = spawn_owned(
                command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT
            )
            app.processes.append(process)
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"Test server exited; see server-{port}.log")
                try:
                    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
                        f"http://127.0.0.1:{port}{path}", timeout=1
                    ) as response:
                        if response.status == 200:
                            break
                except (urllib.error.URLError, TimeoutError):
                    pass
                time.sleep(0.1)
            else:
                raise TimeoutError(f"Test server readiness timeout on port {port}")
        return app
    except BaseException:
        app.close()
        raise
