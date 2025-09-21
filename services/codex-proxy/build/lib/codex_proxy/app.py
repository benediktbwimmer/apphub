from __future__ import annotations

import json
import logging
import os
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Annotated, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from pydantic import BaseModel, Field

LOGGER = logging.getLogger("codex-proxy")

DEFAULT_TIMEOUT_MS = 120_000
OUTPUT_FILENAME = "suggestion.json"
SUMMARY_FILENAME = "summary.txt"


class GenerateRequest(BaseModel):
    mode: Literal["workflow", "job", "job-with-bundle"]
    operatorRequest: str = Field(default="", description="Operator prompt text")
    metadataSummary: str = Field(default="", description="Catalog metadata summary")
    additionalNotes: Optional[str] = Field(default=None, description="Extra prompt instructions")
    timeoutMs: Optional[int] = Field(default=None, ge=1_000, description="Request-specific timeout in ms")


class GenerateResponse(BaseModel):
    workspace: Optional[str]
    outputPath: Optional[str]
    output: str
    stdout: str
    stderr: str
    summary: Optional[str]
    durationMs: int


def _configure_logging() -> None:
    level = logging.DEBUG if os.getenv("CODEX_PROXY_DEBUG_LOGS") else logging.INFO
    logging.basicConfig(level=level, format="[%(asctime)s] %(levelname)s %(name)s: %(message)s")


def _get_cli_path() -> str:
    override = os.getenv("CODEX_PROXY_CLI")
    if override:
        return override
    return "codex"


def _get_additional_args() -> list[str]:
    raw = os.getenv("CODEX_PROXY_EXEC_OPTS")
    if not raw:
        return []
    return shlex.split(raw)


def _default_timeout_ms() -> int:
    raw = os.getenv("CODEX_PROXY_TIMEOUT_MS")
    if not raw:
        return DEFAULT_TIMEOUT_MS
    try:
        value = int(raw)
        return max(value, 1_000)
    except ValueError:
        LOGGER.warning("Invalid CODEX_PROXY_TIMEOUT_MS=%s, falling back to default", raw)
        return DEFAULT_TIMEOUT_MS


def _should_keep_workspace() -> bool:
    if os.getenv("CODEX_PROXY_KEEP_WORKSPACES"):
        return True
    if os.getenv("APPHUB_CODEX_DEBUG_WORKSPACES"):
        return True
    return False


def _build_instructions_text(request: GenerateRequest, workspace: Path) -> str:
    sections: list[str] = [
        "# AppHub AI Builder Task",
        f"Session: {uuid.uuid4()}",
        "You are operating inside the AppHub Codex integration workspace. Generate a candidate definition for the operator.",
        f"Mode: {request.mode.upper()}",
        "1. Inspect the context files under `./context/`. They summarise available jobs, services, and workflows.",
        "2. Produce a JSON definition that satisfies the platform constraints for the selected mode.",
        f"3. Write the JSON payload to `./output/{OUTPUT_FILENAME}`. Do not print the JSON to stdout.",
        "4. Ensure the JSON is pretty-printed with two-space indentation.",
    ]

    extra = (request.additionalNotes or "").strip()
    if extra:
        sections.append(extra)

    sections.append("When the suggestion is ready, append a short summary to `./output/summary.txt` describing key choices.")

    if request.mode == "job-with-bundle":
        bundle_instructions = "\n".join(
            [
                "For job-with-bundle mode, `suggestion.json` must contain an object with the shape:",
                "{",
                '  "job": { /* job definition matching the AppHub schema */ },',
                '  "bundle": {',
                '    "slug": "...",',
                '    "version": "...",',
                '    "entryPoint": "index.js",',
                '    "manifestPath": "manifest.json",',
                '    "manifest": { /* bundle manifest JSON */ },',
                '    "capabilityFlags": ["optional", "flags"],',
                '    "files": [',
                '      { "path": "index.js", "contents": "// handler source", "encoding": "utf8", "executable": false }',
                '    ]',
                '  }',
                "}",
                "When producing bundle files, ensure every entry is included in the `files` array and referenced relative to the bundle root.",
                "You may add optional fields like `metadata` where suitable.",
            ]
        )
        sections.append(bundle_instructions)

    return "\n\n".join(filter(None, sections)) + "\n"


def _write_workspace(request: GenerateRequest) -> tuple[Path, Path, Path]:
    workspace = Path(tempfile.mkdtemp(prefix="codex-proxy-"))
    context_dir = workspace / "context"
    output_dir = workspace / "output"
    context_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    instructions_path = workspace / "instructions.md"
    instructions = _build_instructions_text(request, workspace)
    instructions_path.write_text(instructions, encoding="utf-8")

    normalized_request = request.operatorRequest.strip() or "Operator did not provide a description."
    normalized_summary = request.metadataSummary.strip() or "No catalog metadata was supplied."
    metadata_body = "# Operator Request\n\n{request}\n\n# Catalog Snapshot\n\n{summary}\n".format(
        request=normalized_request,
        summary=normalized_summary,
    )
    metadata_path = context_dir / "metadata.md"
    metadata_path.write_text(metadata_body, encoding="utf-8")

    return workspace, instructions_path, output_dir / OUTPUT_FILENAME


def _cleanup_workspace(path: Path) -> None:
    try:
        shutil.rmtree(path)
    except FileNotFoundError:
        return
    except OSError as exc:
        LOGGER.warning("Failed to remove workspace %s: %s", path, exc)


def _verify_token(
    authorization: Annotated[Optional[str], Header()] = None,
    header_token: Annotated[Optional[str], Header(alias="X-AppHub-Proxy-Token")] = None,
) -> None:
    token = os.getenv("CODEX_PROXY_TOKEN")
    if not token:
        return
    supplied: Optional[str] = None
    if header_token and header_token.strip():
        supplied = header_token.strip()
    elif authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if supplied != token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid proxy token")


app = FastAPI(title="Codex Proxy", version="0.1.0")


@app.get("/healthz", status_code=status.HTTP_204_NO_CONTENT)
def health_check() -> Response:
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/v1/codex/generate", response_model=GenerateResponse)
def generate(request: GenerateRequest, _: None = Depends(_verify_token)) -> GenerateResponse:
    workspace: Optional[Path] = None
    instructions_path: Optional[Path] = None
    output_path: Optional[Path] = None

    keep_workspace = _should_keep_workspace()
    cli_path = _get_cli_path()
    extra_args = _get_additional_args()
    timeout_ms = request.timeoutMs or _default_timeout_ms()
    timeout_s = max(timeout_ms / 1000.0, 1.0)
    start = time.monotonic()

    try:
        workspace, instructions_path, output_path = _write_workspace(request)
        env = os.environ.copy()
        env.setdefault("CODEX_NO_COLOR", "1")
        env.setdefault("CODEX_SUPPRESS_SPINNER", "1")
        env["APPHUB_CODEX_OUTPUT_DIR"] = str(output_path.parent)

        command = [cli_path, "exec", *extra_args, str(instructions_path)]
        LOGGER.debug("Executing %s", json.dumps(command))

        proc = subprocess.Popen(
            command,
            cwd=str(workspace),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        try:
            stdout, stderr = proc.communicate(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            proc.kill()
            stdout, stderr = proc.communicate()
            raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Codex CLI timed out")

        if proc.returncode != 0:
            detail = {
                "message": "Codex CLI exited with a non-zero status",
                "exitCode": proc.returncode,
                "stdout": stdout,
                "stderr": stderr,
            }
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)

        if not output_path.exists():
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Codex output file missing")

        output = output_path.read_text(encoding="utf-8").strip()
        summary_path = output_path.parent / SUMMARY_FILENAME
        summary = summary_path.read_text(encoding="utf-8").strip() if summary_path.exists() else None

        duration_ms = int((time.monotonic() - start) * 1000)
        return GenerateResponse(
            workspace=str(workspace) if keep_workspace else None,
            outputPath=str(output_path) if keep_workspace else None,
            output=output,
            stdout=stdout,
            stderr=stderr,
            summary=summary,
            durationMs=duration_ms,
        )
    finally:
        if workspace and not keep_workspace:
            _cleanup_workspace(workspace)


_configure_logging()
