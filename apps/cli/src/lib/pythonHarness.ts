export const PYTHON_RESULT_SENTINEL = '__APPHUB_PYTHON_RESULT__';

export const PYTHON_HARNESS_SOURCE = String.raw`
import asyncio
import importlib.util
import inspect
import json
import sys
import time
import traceback
from datetime import datetime, timezone

PYTHON_RESULT_SENTINEL = "__APPHUB_PYTHON_RESULT__"


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _load_handler(entry_path):
    spec = importlib.util.spec_from_file_location("apphub_job", entry_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load handler from {}".format(entry_path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    handler = getattr(module, "handler", None)
    if handler is None:
        raise RuntimeError("Python entry {} does not define a 'handler' function".format(entry_path))
    return handler


class JobContext:
    def __init__(self, slug, definition, run_record, parameters, logs):
        self.definition = definition
        self.run = run_record
        self._parameters = parameters
        self._logs = logs
        self._slug = slug

    @property
    def parameters(self):
        return self._parameters

    @parameters.setter
    def parameters(self, value):
        self._parameters = value
        self.run["parameters"] = value

    async def update(self, updates):
        if not isinstance(updates, dict):
            return
        if "parameters" in updates:
            self.parameters = updates["parameters"]
        if "logsUrl" in updates:
            self.run["logsUrl"] = updates["logsUrl"]
        if "metrics" in updates:
            self.run["metrics"] = updates["metrics"]
        if "context" in updates:
            self.run["context"] = updates["context"]
        if "timeoutMs" in updates:
            timeout = updates["timeoutMs"]
            if isinstance(timeout, (int, float)):
                self.run["timeoutMs"] = timeout
        self.run["updatedAt"] = _now()

    def logger(self, message, meta=None):
        if meta is None:
            meta = {}
        serialized = ""
        try:
            serialized = json.dumps(meta, ensure_ascii=False) if meta else ""
        except Exception:
            serialized = str(meta) if meta else ""
        line = "[job:{}] {}".format(self._slug, str(message))
        if serialized:
            line = line + " " + serialized
        self._logs.append(line)
        print(line)

    def resolve_secret(self):
        return None


async def _execute(payload):
    entry_path = payload["entry"]
    parameters = payload.get("parameters")
    manifest = payload.get("manifest", {})
    slug = payload.get("slug", "local-bundle")

    handler = _load_handler(entry_path)

    logs = []
    now = _now()
    definition = {
        "id": "local-definition",
        "slug": slug,
        "name": manifest.get("name") or slug,
        "version": manifest.get("version") or "0.0.0",
        "entryPoint": manifest.get("pythonEntry") or entry_path,
        "metadata": manifest.get("metadata"),
    }
    run_record = {
        "id": "local-run",
        "jobDefinitionId": definition["id"],
        "status": "running",
        "parameters": parameters,
        "result": None,
        "errorMessage": None,
        "logsUrl": None,
        "metrics": None,
        "context": None,
        "timeoutMs": None,
        "attempt": 1,
        "maxAttempts": 1,
        "durationMs": None,
        "scheduledAt": now,
        "startedAt": now,
        "completedAt": None,
        "createdAt": now,
        "updatedAt": now,
    }
    context = JobContext(slug, definition, run_record, parameters, logs)

    started = time.perf_counter()
    try:
        result = handler(context)
        if inspect.isawaitable(result):
            result = await result
    except Exception:
        traceback.print_exc()
        raise
    finished = time.perf_counter()
    duration_ms = round((finished - started) * 1000)

    if isinstance(result, dict):
        job_result = result
    else:
        job_result = {"result": result}
    if "status" not in job_result:
        job_result["status"] = "succeeded"

    return {
        "result": job_result,
        "durationMs": duration_ms,
        "logs": logs,
    }


def _json_default(value):
    try:
        return list(value)
    except Exception:
        return str(value)


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw) if raw else {}
    try:
        result = asyncio.run(_execute(payload))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
    encoded = json.dumps(result, ensure_ascii=False, default=_json_default)
    print(PYTHON_RESULT_SENTINEL + encoded)


if __name__ == "__main__":
    main()
`;
