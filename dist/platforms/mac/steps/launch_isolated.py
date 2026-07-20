#!/usr/bin/env python3
"""Start the Unity return process in a dedicated POSIX session."""

import os
import sys
import time


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit(64)

    ready_path = sys.argv[1]
    acknowledge_path = sys.argv[2]
    executable = sys.argv[3]
    arguments = sys.argv[3:]
    os.setsid()
    pid = os.getpid()
    pgid = os.getpgrp()
    temporary_path = f"{ready_path}.{pid}"
    with open(temporary_path, "x", encoding="ascii") as ready_file:
        ready_file.write(f"{pid}:{pgid}")
    os.replace(temporary_path, ready_path)
    deadline = time.monotonic() + 5
    while not os.path.exists(acknowledge_path):
        if time.monotonic() >= deadline:
            raise SystemExit(70)
        time.sleep(0.01)
    os.execv(executable, arguments)


if __name__ == "__main__":
    main()
