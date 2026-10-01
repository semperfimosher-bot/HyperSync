"""Launch the real API with isolated test settings. Never used by production."""

import argparse
import os
import socket
from functools import lru_cache
from pathlib import Path

import uvicorn

from .environment import load_test_settings, read_environment


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    environment = read_environment(args.manifest)
    settings = load_test_settings(environment)
    from backend.app import config

    config.get_settings = lru_cache()(lambda: settings)
    original_lookup = socket.getaddrinfo

    def local_only(host, *args, **kwargs):
        if host not in {"localhost", "127.0.0.1", "::1", None, b"localhost", b"127.0.0.1"}:
            raise OSError("External network disabled in verification API")
        return original_lookup(host, *args, **kwargs)

    socket.getaddrinfo = local_only
    os.chdir(environment.root)

    from backend.app.main import app

    uvicorn.run(app, host="127.0.0.1", port=environment.api_port, log_level="info", loop="asyncio")


if __name__ == "__main__":
    main()
