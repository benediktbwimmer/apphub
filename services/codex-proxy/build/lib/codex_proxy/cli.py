from __future__ import annotations

import os
from typing import Optional

import uvicorn


def _infer_host() -> str:
    return os.getenv("CODEX_PROXY_HOST", "127.0.0.1")


def _infer_port() -> int:
    raw = os.getenv("CODEX_PROXY_PORT")
    if raw is None:
        return 3030
    try:
        return int(raw)
    except ValueError:
        raise SystemExit(f"Invalid CODEX_PROXY_PORT: {raw}") from None


def main(argv: Optional[list[str]] = None) -> None:  # pragma: no cover
    host = _infer_host()
    port = _infer_port()
    uvicorn.run("codex_proxy.app:app", host=host, port=port, reload=False)


if __name__ == "__main__":  # pragma: no cover
    main()
