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
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock, Thread
from typing import Annotated, Callable, Dict, Literal, Optional, Sequence

from fastapi import Depends, FastAPI, Header, HTTPException, Response, status
from pydantic import BaseModel, Field

LOGGER = logging.getLogger("codex-proxy")

DEFAULT_TIMEOUT_MS = 600_000
OUTPUT_FILENAME = "suggestion.json"
SUMMARY_FILENAME = "summary.txt"
JOB_RETENTION_SECONDS = int(os.getenv("CODEX_PROXY_JOB_RETENTION_SECONDS", "3600"))
POLL_INTERVAL_SECONDS = 0.5


class ContextFile(BaseModel):
    path: str = Field(..., min_length=1, description="Relative file path inside the workspace")
    contents: str = Field(default="", description="File contents written verbatim with UTF-8 encoding")


class GenerateRequest(BaseModel):
    mode: Literal["workflow", "job", "job-with-bundle", "workflow-with-jobs"]
    operatorRequest: str = Field(default="", description="Operator prompt text")
    metadataSummary: str = Field(default="", description="Catalog metadata summary")
    additionalNotes: Optional[str] = Field(default=None, description="Extra prompt instructions")
    timeoutMs: Optional[int] = Field(default=None, ge=1_000, description="Request-specific timeout in ms")
    contextFiles: Optional[list[ContextFile]] = Field(
        default=None,
        description="Additional context files to materialize inside the workspace",
    )


class GenerateResponse(BaseModel):
    workspace: Optional[str]
    outputPath: Optional[str]
    output: str
    stdout: str
    stderr: str
    summary: Optional[str]
    durationMs: int


class CreateJobResponse(BaseModel):
    jobId: str
    status: Literal["pending", "running"]
    createdAt: str


class JobStatusResponse(BaseModel):
    jobId: str
    status: Literal["pending", "running", "succeeded", "failed"]
    stdout: str
    stderr: str
    output: Optional[str]
    summary: Optional[str]
    error: Optional[str]
    exitCode: Optional[int]
    workspace: Optional[str]
    outputPath: Optional[str]
    durationMs: Optional[int]
    createdAt: str
    startedAt: Optional[str]
    completedAt: Optional[str]
    updatedAt: str


@dataclass
class CodexExecutionResult:
    stdout: str
    stderr: str
    output: Optional[str]
    summary: Optional[str]
    exit_code: Optional[int]
    error: Optional[str]
    duration_ms: int
    workspace: Optional[str]
    output_path: Optional[str]


@dataclass
class CodexJobState:
    id: str
    request: GenerateRequest
    status: Literal["pending", "running", "succeeded", "failed"] = "pending"
    stdout: str = ""
    stderr: str = ""
    output: Optional[str] = None
    summary: Optional[str] = None
    error: Optional[str] = None
    exit_code: Optional[int] = None
    workspace: Optional[str] = None
    output_path: Optional[str] = None
    duration_ms: Optional[int] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    updated_at: float = field(default_factory=time.time)
    lock: Lock = field(default_factory=Lock, repr=False)


_jobs: Dict[str, CodexJobState] = {}
_jobs_lock = Lock()


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
    args = shlex.split(raw) if raw else []

    has_sandbox = False
    for index, token in enumerate(args):
        if token == "--sandbox" or token == "-s":
            has_sandbox = True
            break
        if token.startswith("--sandbox="):
            has_sandbox = True
            break
    if not has_sandbox:
        default_sandbox = os.getenv("CODEX_PROXY_DEFAULT_SANDBOX", "workspace-write").strip()
        if default_sandbox:
            args.extend(["--sandbox", default_sandbox])

    return args


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


def _is_safe_relative_path(path: Path) -> bool:
    if path.is_absolute():
        return False
    for part in path.parts:
        if part in ("..", ""):
            return False
    return True


def _write_context_files(workspace: Path, files: Sequence[ContextFile] | None) -> None:
    if not files:
        return
    for file in files:
        relative = Path(file.path.strip())
        if not _is_safe_relative_path(relative):
            LOGGER.warning("Skipping unsafe context path: %s", file.path)
            continue
        target = workspace / relative
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(file.contents, encoding="utf-8")
            try:
                target.parent.chmod(0o777)
            except OSError:
                pass
            try:
                target.chmod(0o666)
            except OSError:
                pass
        except OSError as exc:
            LOGGER.warning("Failed to write context file %s: %s", target, exc)


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

    sections.append(
        "Reference the JSON schemas in `./context/schemas/` and the summaries in `./context/reference/` for precise field definitions."
    )

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
                '    "capabilityFlags": ["fs.read", "redis"],',
                '    "files": [',
                '      { "path": "index.js", "contents": "// handler source", "encoding": "utf8", "executable": false }',
                '    ]',
                '  }',
                "}",
                "Mirror the bundle manifest `capabilities` in `capabilityFlags` so required permissions are explicit.",
                "When producing bundle files, ensure every entry is included in the `files` array and referenced relative to the bundle root.",
                "You may add optional fields like `metadata` where suitable.",
            ]
        )
        sections.append(bundle_instructions)
    elif request.mode == "job":
        job_instructions = "\n".join(
            [
                "For job mode the JSON must be a single job definition object, not wrapped in a `job` property.",
                "Ensure it includes required fields such as `slug`, `name`, `type`, `version`, `timeout`, `entry`, and a `parameters` array.",
                "Include optional metadata (like tags or description) where appropriate.",
            ]
        )
        sections.append(job_instructions)
    elif request.mode == "workflow":
        workflow_instructions = "\n".join(
            [
                "For workflow mode the JSON must be a workflow definition object matching the platform schema (no wrapper key).",
                "Populate `slug`, `name`, `version`, `triggers`, and `steps` with valid values.",
            ]
        )
        sections.append(workflow_instructions)
    elif request.mode == "workflow-with-jobs":
        workflow_jobs_instructions = "\n".join(
            [
                "For workflow-with-jobs mode, output a JSON object containing `workflow`, `dependencies`, and optional `notes` fields.",
                "Use `dependencies` to list every job the workflow relies on. Tag catalog jobs with `kind` = `existing-job` and include a short description.",
                "For new jobs set `kind` = `job` or `job-with-bundle` and provide a reusable `prompt` explaining how to generate that job in the next step.",
                "When `kind` is `job-with-bundle`, include a `bundleOutline` with the intended entry point, required capabilities, and any notable files.",
                "Keep guidance concise and actionable. Document broader operator follow-up (like secrets to provision) in the `notes` field.",
            ]
        )
        sections.append(workflow_jobs_instructions)

    return "\n\n".join(filter(None, sections)) + "\n"


def _write_workspace(request: GenerateRequest) -> tuple[Path, Path, Path]:
    workspace = Path(tempfile.mkdtemp(prefix="codex-proxy-"))
    context_dir = workspace / "context"
    output_dir = workspace / "output"
    context_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    # The Codex CLI runs inside a sandboxed environment that may execute as
    # a different user. Relax permissions so the process can write to the
    # workspace and particularly the output directory where it must persist
    # `suggestion.json`.
    for directory in (workspace, context_dir, output_dir):
        try:
            directory.chmod(0o777)
        except OSError as exc:  # pragma: no cover - defensive logging
            LOGGER.warning("Failed to adjust permissions for %s: %s", directory, exc)

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

    _write_context_files(workspace, request.contextFiles)

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


def _format_timestamp(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()


def _prune_jobs() -> None:
    if JOB_RETENTION_SECONDS <= 0:
        return
    cutoff = time.time() - JOB_RETENTION_SECONDS
    with _jobs_lock:
        stale = [job_id for job_id, job in _jobs.items() if job.completed_at and job.completed_at < cutoff]
        for job_id in stale:
            LOGGER.debug("Pruning stale job %s", job_id)
            _jobs.pop(job_id, None)


def _execute_codex(
    request: GenerateRequest,
    *,
    on_stdout: Optional[Callable[[str], None]] = None,
    on_stderr: Optional[Callable[[str], None]] = None,
) -> CodexExecutionResult:
    workspace: Optional[Path] = None
    output_path: Optional[Path] = None
    keep_workspace = _should_keep_workspace()
    cli_path = _get_cli_path()
    extra_args = _get_additional_args()
    timeout_ms = request.timeoutMs or _default_timeout_ms()
    timeout_s = max(timeout_ms / 1000.0, 1.0)
    start_time = time.monotonic()

    try:
        workspace, instructions_path, output_path = _write_workspace(request)
        env = os.environ.copy()
        env.setdefault("CODEX_NO_COLOR", "1")
        env.setdefault("CODEX_SUPPRESS_SPINNER", "1")
        env["APPHUB_CODEX_OUTPUT_DIR"] = str(output_path.parent)
        # Some Codex sandboxes expose a read-only /tmp; point temp dirs to the
        # writable workspace so here-docs and python's tempfile module succeed.
        env.setdefault("TMPDIR", str(workspace))
        env.setdefault("TMP", str(workspace))
        env.setdefault("TEMP", str(workspace))

        command = [cli_path, "exec", *extra_args, str(instructions_path)]
        LOGGER.debug("Executing %s", json.dumps(command))

        proc = subprocess.Popen(
            command,
            cwd=str(workspace),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        stdout_chunks: list[str] = []
        stderr_chunks: list[str] = []

        def _pump(stream, collector: list[str], callback: Optional[Callable[[str], None]]) -> None:
            try:
                if not stream:
                    return
                for chunk in iter(stream.readline, ""):
                    collector.append(chunk)
                    if callback:
                        try:
                            callback(chunk)
                        except Exception as exc:  # pragma: no cover - defensive
                            LOGGER.debug("stdout/stderr callback failed: %s", exc)
            finally:
                if stream:
                    stream.close()

        threads: list[Thread] = []
        if proc.stdout is not None:
            threads.append(Thread(target=_pump, args=(proc.stdout, stdout_chunks, on_stdout), daemon=True))
        if proc.stderr is not None:
            threads.append(Thread(target=_pump, args=(proc.stderr, stderr_chunks, on_stderr), daemon=True))
        for thread in threads:
            thread.start()

        exit_code: Optional[int] = None
        error_message: Optional[str] = None
        try:
            exit_code = proc.wait(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            proc.kill()
            exit_code = None
            error_message = "Codex CLI timed out"
        finally:
            for thread in threads:
                thread.join()

        stdout_text = "".join(stdout_chunks)
        stderr_text = "".join(stderr_chunks)
        duration_ms = int((time.monotonic() - start_time) * 1000)

        summary_path = output_path.parent / SUMMARY_FILENAME if output_path else None
        summary_text = None
        if summary_path and summary_path.exists():
            summary_text = summary_path.read_text(encoding="utf-8").strip()

        if error_message:
            return CodexExecutionResult(
                stdout=stdout_text,
                stderr=stderr_text,
                output=None,
                summary=summary_text,
                exit_code=exit_code,
                error=error_message,
                duration_ms=duration_ms,
                workspace=str(workspace) if keep_workspace else None,
                output_path=str(output_path) if keep_workspace else None,
            )

        if exit_code != 0:
            return CodexExecutionResult(
                stdout=stdout_text,
                stderr=stderr_text,
                output=None,
                summary=summary_text,
                exit_code=exit_code,
                error=f"Codex CLI exited with status {exit_code}",
                duration_ms=duration_ms,
                workspace=str(workspace) if keep_workspace else None,
                output_path=str(output_path) if keep_workspace else None,
            )

        if not output_path or not output_path.exists():
            return CodexExecutionResult(
                stdout=stdout_text,
                stderr=stderr_text,
                output=None,
                summary=summary_text,
                exit_code=exit_code,
                error="Codex output file missing",
                duration_ms=duration_ms,
                workspace=str(workspace) if keep_workspace else None,
                output_path=str(output_path) if keep_workspace else None,
            )

        output_text = output_path.read_text(encoding="utf-8").strip()
        return CodexExecutionResult(
            stdout=stdout_text,
            stderr=stderr_text,
            output=output_text,
            summary=summary_text,
            exit_code=exit_code,
            error=None,
            duration_ms=duration_ms,
            workspace=str(workspace) if keep_workspace else None,
            output_path=str(output_path) if keep_workspace else None,
        )
    finally:
        if workspace and not keep_workspace:
            _cleanup_workspace(workspace)


def _append_stdout(job: CodexJobState, chunk: str) -> None:
    with job.lock:
        job.stdout += chunk
        job.updated_at = time.time()


def _append_stderr(job: CodexJobState, chunk: str) -> None:
    with job.lock:
        job.stderr += chunk
        job.updated_at = time.time()


def _run_job(job: CodexJobState) -> None:
    with job.lock:
        job.status = "running"
        job.started_at = time.time()
        job.updated_at = job.started_at

    result = _execute_codex(
        job.request,
        on_stdout=lambda chunk: _append_stdout(job, chunk),
        on_stderr=lambda chunk: _append_stderr(job, chunk),
    )

    with job.lock:
        job.stdout = result.stdout
        job.stderr = result.stderr
        job.summary = result.summary
        job.output = result.output
        job.exit_code = result.exit_code
        job.error = result.error
        job.duration_ms = result.duration_ms
        job.workspace = result.workspace
        job.output_path = result.output_path
        job.completed_at = time.time()
        job.updated_at = job.completed_at
        if result.error:
            job.status = "failed"
        else:
            job.status = "succeeded"


def _start_job(request: GenerateRequest) -> CodexJobState:
    job = CodexJobState(id=uuid.uuid4().hex, request=request)
    with _jobs_lock:
        _jobs[job.id] = job
    thread = Thread(target=_run_job, args=(job,), daemon=True)
    thread.start()
    return job


def _snapshot_job(job: CodexJobState) -> JobStatusResponse:
    with job.lock:
        return JobStatusResponse(
            jobId=job.id,
            status=job.status,
            stdout=job.stdout,
            stderr=job.stderr,
            output=job.output,
            summary=job.summary,
            error=job.error,
            exitCode=job.exit_code,
            workspace=job.workspace,
            outputPath=job.output_path,
            durationMs=job.duration_ms,
            createdAt=_format_timestamp(job.created_at),
            startedAt=_format_timestamp(job.started_at),
            completedAt=_format_timestamp(job.completed_at),
            updatedAt=_format_timestamp(job.updated_at) or _format_timestamp(time.time()),
        )


app = FastAPI(title="Codex Proxy", version="0.2.0")


@app.get("/healthz", status_code=status.HTTP_204_NO_CONTENT)
def health_check() -> Response:
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/v1/codex/generate", response_model=GenerateResponse)
def generate(request: GenerateRequest, _: None = Depends(_verify_token)) -> GenerateResponse:
    result = _execute_codex(request)
    if result.error or not result.output:
        detail = {
            "message": result.error or "Codex output missing",
            "exitCode": result.exit_code,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
        status_code = status.HTTP_502_BAD_GATEWAY if result.exit_code not in (None, 0) else status.HTTP_500_INTERNAL_SERVER_ERROR
        raise HTTPException(status_code=status_code, detail=detail)

    return GenerateResponse(
        workspace=result.workspace,
        outputPath=result.output_path,
        output=result.output,
        stdout=result.stdout,
        stderr=result.stderr,
        summary=result.summary,
        durationMs=result.duration_ms,
    )


@app.post("/v1/codex/jobs", status_code=status.HTTP_202_ACCEPTED, response_model=CreateJobResponse)
def create_job(request: GenerateRequest, _: None = Depends(_verify_token)) -> CreateJobResponse:
    _prune_jobs()
    job = _start_job(request)
    with job.lock:
        status_value = job.status
        created_at = _format_timestamp(job.created_at) or _format_timestamp(time.time())
    return CreateJobResponse(jobId=job.id, status=status_value, createdAt=created_at or datetime.now(timezone.utc).isoformat())


@app.get("/v1/codex/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str, _: None = Depends(_verify_token)) -> JobStatusResponse:
    _prune_jobs()
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Codex job not found")
    return _snapshot_job(job)


_configure_logging()
