from __future__ import annotations

import sys

from agenthub.process.pipe_backend import PipeBackend


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args == ["pipe-smoke"]:
        result = PipeBackend().run(
            run_id="pipe-smoke",
            command=[sys.executable, "-c", "print('AGENTHUB_PIPE_OK')"],
            cwd=None,
            timeout_seconds=10,
        )
        print(result.stdout, end="")
        return result.exit_code
    print("usage: python -m agenthub.main pipe-smoke", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
