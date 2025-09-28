#!/usr/bin/env python3
import asyncio
import builtins
import importlib.util
import inspect
import json
import math
import os
import fcntl
import hashlib
import resource
import sys
import subprocess
import threading
import time
import traceback
import sysconfig
import uuid
from typing import Any, Dict, List, Optional, Tuple, Union

HOST_ROOT_PREFIX_ENV = "APPHUB_SANDBOX_HOST_ROOT_PREFIX"
WORKFLOW_EVENT_CONTEXT_ENV = "APPHUB_WORKFLOW_EVENT_CONTEXT"

message_queue: Optional["asyncio.Queue[Dict[str, Any]]"] = None
pending_requests: Dict[str, Tuple[str, asyncio.Future[Any]]] = {}
current_handler_task: Optional[asyncio.Task[Any]] = None
cancel_reason: Optional[str] = None
writer_lock = threading.Lock()
UNSUPPORTED = object()


def get_message_queue() -> "asyncio.Queue[Dict[str, Any]]":
    if message_queue is None:
        raise RuntimeError("Sandbox message queue has not been initialised")
    return message_queue


def send_message(message: Dict[str, Any]) -> None:
    data = json.dumps(message, separators=(",", ":"), ensure_ascii=False)
    with writer_lock:
        sys.stdout.write(data + "\n")
        sys.stdout.flush()


def stdin_reader(loop: asyncio.AbstractEventLoop) -> None:
    queue = get_message_queue()
    for line in sys.stdin:
        payload = line.strip()
        if not payload:
            continue
        try:
            message = json.loads(payload)
        except json.JSONDecodeError:
            continue
        asyncio.run_coroutine_threadsafe(queue.put(message), loop)
    asyncio.run_coroutine_threadsafe(queue.put({"_internal": "eof"}), loop)


def is_plain_object(value: Any) -> bool:
    return isinstance(value, dict)


def to_json_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, bool)):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        return UNSUPPORTED
    if isinstance(value, (list, tuple)):
        result: List[Any] = []
        for entry in value:
            converted = to_json_value(entry)
            if converted is not UNSUPPORTED:
                result.append(converted)
        return result
    if isinstance(value, dict):
        result: Dict[str, Any] = {}
        for key, entry_value in value.items():
            if isinstance(key, str):
                converted = to_json_value(entry_value)
                if converted is not UNSUPPORTED:
                    result[key] = converted
        return result
    return UNSUPPORTED


def sanitize_for_ipc(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, ensure_ascii=False))
    except Exception as err:  # pragma: no cover - defensive guard
        raise RuntimeError(
            f"Failed to serialize sandbox payload: {err if isinstance(err, BaseException) else str(err)}"
        ) from err


def ensure_within_bundle(bundle_dir: str, candidate: str) -> str:
    normalized_root = os.path.realpath(bundle_dir)
    normalized_candidate = os.path.realpath(candidate)
    if normalized_candidate == normalized_root or normalized_candidate.startswith(normalized_root + os.sep):
        return normalized_candidate

    host_root_raw = os.environ.get(HOST_ROOT_PREFIX_ENV)
    if host_root_raw:
        host_root = os.path.realpath(host_root_raw)
        if normalized_candidate == host_root or normalized_candidate.startswith(host_root + os.sep):
            return normalized_candidate
        relative_from_root = os.path.relpath(normalized_candidate, os.sep)
        translated = os.path.realpath(os.path.join(host_root, relative_from_root))
        if translated == host_root or translated.startswith(host_root + os.sep):
            return translated
    raise PermissionError("Attempted to access path outside of bundle directory")


PathLike = Union[str, bytes, os.PathLike[str], os.PathLike[bytes]]


def normalize_path_argument(bundle_dir: str, allow_fs: bool, value: PathLike) -> PathLike:
    if isinstance(value, int):
        if not allow_fs:
            raise PermissionError('File system access requires declaring the "fs" capability')
        return value
    path_str = os.fspath(value)
    if os.path.isabs(path_str):
        normalized = ensure_within_bundle(bundle_dir, path_str)
        return normalized
    absolute = os.path.realpath(os.path.join(os.getcwd(), path_str))
    normalized = ensure_within_bundle(bundle_dir, absolute)
    return normalized


def setup_filesystem_guards(bundle_dir: str, capabilities: List[str]) -> None:
    allow_fs = "fs" in capabilities
    original_open = builtins.open

    def guarded_open(file: PathLike, *args: Any, **kwargs: Any):  # type: ignore[override]
        if isinstance(file, int):
            if not allow_fs:
                raise PermissionError('File system access requires declaring the "fs" capability')
            return original_open(file, *args, **kwargs)
        path = normalize_path_argument(bundle_dir, allow_fs, file)
        if not allow_fs:
            raise PermissionError('File system access requires declaring the "fs" capability')
        return original_open(path, *args, **kwargs)

    builtins.open = guarded_open  # type: ignore[assignment]

    import os as os_module
    import shutil as shutil_module

    def wrap_function(module: Any, name: str, indexes: List[int], kw_names: Optional[List[str]] = None) -> None:
        original = getattr(module, name, None)
        if not callable(original):
            return

        def wrapper(*args: Any, **kwargs: Any):
            if not allow_fs:
                raise PermissionError('File system access requires declaring the "fs" capability')
            new_args = list(args)
            for index in indexes:
                if 0 <= index < len(new_args):
                    new_args[index] = normalize_path_argument(bundle_dir, True, new_args[index])
            if kw_names:
                for key in kw_names:
                    if key in kwargs:
                        kwargs[key] = normalize_path_argument(bundle_dir, True, kwargs[key])
            return original(*new_args, **kwargs)

        setattr(module, name, wrapper)

    path_methods: Dict[str, List[int]] = {
        "listdir": [0],
        "scandir": [0],
        "remove": [0],
        "unlink": [0],
        "rmdir": [0],
        "mkdir": [0],
        "makedirs": [0],
        "chdir": [0],
        "replace": [0, 1],
        "rename": [0, 1],
        "stat": [0],
        "lstat": [0],
        "readlink": [0],
        "symlink": [0, 1],
        "utime": [0],
        "chmod": [0],
        "chown": [0],
        "access": [0],
        "walk": [0],
    }

    for method, indexes in path_methods.items():
        wrap_function(os_module, method, indexes)

    shutil_methods: Dict[str, List[int]] = {
        "copy": [0, 1],
        "copy2": [0, 1],
        "copyfile": [0, 1],
        "move": [0, 1],
        "copytree": [0, 1],
        "rmtree": [0],
        "make_archive": [1]
    }

    for method, indexes in shutil_methods.items():
        wrap_function(shutil_module, method, indexes)


def setup_network_guards(capabilities: List[str]) -> None:
    allow_network = "network" in capabilities
    if allow_network:
        return

    import socket as socket_module

    def blocked_network(*_args: Any, **_kwargs: Any) -> Any:
        raise PermissionError('Network access requires declaring the "network" capability')

    socket_module.socket = blocked_network  # type: ignore[assignment]
    socket_module.create_connection = blocked_network  # type: ignore[assignment]
    socket_module.create_server = blocked_network  # type: ignore[assignment]

    try:
        import http.client as http_client
        http_client.HTTPConnection = blocked_network  # type: ignore[assignment]
        http_client.HTTPSConnection = blocked_network  # type: ignore[assignment]
    except ImportError:
        pass

    try:
        import urllib.request as urllib_request
        urllib_request.urlopen = blocked_network  # type: ignore[assignment]
    except ImportError:
        pass

    try:
        import asyncio

        async def blocked_asyncio_connection(*_args: Any, **_kwargs: Any) -> Any:
            raise PermissionError('Network access requires declaring the "network" capability')

        asyncio.open_connection = blocked_asyncio_connection  # type: ignore[assignment]
        asyncio.start_server = blocked_asyncio_connection  # type: ignore[assignment]
    except ImportError:
        pass


def _venv_bin_dir(venv_dir: str) -> str:
    return os.path.join(venv_dir, 'Scripts' if os.name == 'nt' else 'bin')


def _find_executable(venv_dir: str, names: List[str]) -> Optional[str]:
    bin_dir = _venv_bin_dir(venv_dir)
    suffix = '.exe' if os.name == 'nt' else ''
    for name in names:
        candidate = os.path.join(bin_dir, f"{name}{suffix}")
        if os.path.isfile(candidate):
            return candidate
    return None


def _compute_requirements_hash(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        while True:
            chunk = handle.read(65_536)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _run_subprocess(args: List[str], error_message: str) -> None:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        details = '; '.join(filter(None, [stdout, stderr]))
        raise RuntimeError(f"{error_message}: {details or 'no output'}")


def _discover_site_packages(python_executable: str) -> str:
    code = 'import sysconfig; print(sysconfig.get_paths()[\'purelib\'])'
    result = subprocess.run(
        [python_executable, '-c', code],
        capture_output=True,
        text=True,
        check=False
    )
    if result.returncode != 0:
        stderr = result.stderr.strip() or 'unknown'
        raise RuntimeError(f'Failed to determine site-packages path: {stderr}')
    return result.stdout.strip()


def ensure_python_dependencies(bundle_dir: str) -> None:
    requirements_path = os.path.join(bundle_dir, 'requirements.txt')
    if not os.path.isfile(requirements_path):
        return

    with open(requirements_path, 'r', encoding='utf-8') as req_file:
        requirements = [line.strip() for line in req_file if line.strip() and not line.strip().startswith('#')]
    if not requirements:
        return

    venv_dir = os.path.join(bundle_dir, '.venv')
    os.makedirs(venv_dir, exist_ok=True)
    lock_path = os.path.join(venv_dir, '.install.lock')
    site_packages = ''
    with open(lock_path, 'w', encoding='utf-8') as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        try:
            python_executable = _find_executable(venv_dir, ['python', 'python3'])
            if not python_executable:
                _run_subprocess(['python3', '-m', 'venv', venv_dir], 'Failed to create virtual environment')
                python_executable = _find_executable(venv_dir, ['python', 'python3'])
            if not python_executable:
                raise RuntimeError('Virtual environment python executable not found')

            requirements_hash = _compute_requirements_hash(requirements_path)
            marker_path = os.path.join(venv_dir, '.requirements.hash')
            marker_hash = None
            if os.path.isfile(marker_path):
                with open(marker_path, 'r', encoding='utf-8') as marker_file:
                    marker_hash = marker_file.read().strip() or None

            if marker_hash != requirements_hash:
                pip_executable = _find_executable(venv_dir, ['pip', 'pip3'])
                if pip_executable:
                    pip_args = [pip_executable]
                else:
                    pip_args = [python_executable, '-m', 'pip']
                upgrade_args = pip_args + [
                    'install',
                    '--no-input',
                    '--disable-pip-version-check',
                    '--upgrade',
                    'pip'
                ]
                _run_subprocess(upgrade_args, 'Failed to upgrade pip inside virtual environment')
                install_args = pip_args + [
                    'install',
                    '--no-input',
                    '--disable-pip-version-check',
                    '-r',
                    requirements_path
                ]
                _run_subprocess(install_args, 'Failed to install Python dependencies')
                with open(marker_path, 'w', encoding='utf-8') as marker_file:
                    marker_file.write(requirements_hash)

            site_packages = _discover_site_packages(python_executable)
        finally:
            fcntl.flock(lock_file, fcntl.LOCK_UN)

    if site_packages and site_packages not in sys.path:
        sys.path.insert(0, site_packages)
    bin_dir = _venv_bin_dir(venv_dir)
    os.environ['VIRTUAL_ENV'] = venv_dir
    current_path = os.environ.get('PATH', '')
    os.environ['PATH'] = f"{bin_dir}{os.pathsep}{current_path}" if current_path else bin_dir


def normalize_meta(task_id: str, meta: Any) -> Optional[Dict[str, Any]]:
    if meta is None:
        return None
    try:
        serialized = sanitize_for_ipc(meta)
        if isinstance(serialized, dict):
            serialized["sandboxTaskId"] = task_id
            return serialized
    except Exception as err:  # pragma: no cover - defensive guard
        send_message(
            {
                "type": "log",
                "level": "warn",
                "message": "Failed to serialize log metadata",
                "meta": {"sandboxTaskId": task_id, "error": str(err)},
            }
        )
    return {"sandboxTaskId": task_id}


class JobContext:
    def __init__(self, payload: Dict[str, Any], task_id: str):
        self.definition = payload["job"]["definition"]
        self.run = payload["job"]["run"]
        self.parameters = payload["job"]["parameters"]
        self._task_id = task_id
        workflow_context = payload.get("workflowEventContext")
        self.workflowEventContext = workflow_context
        self.workflow_event_context = workflow_context

    def logger(self, message: str, meta: Optional[Dict[str, Any]] = None) -> None:
        normalized = normalize_meta(self._task_id, meta) or {"sandboxTaskId": self._task_id}
        send_message({"type": "log", "level": "info", "message": message, "meta": normalized})

    def getWorkflowEventContext(self) -> Any:
        return self.workflowEventContext

    async def update(self, updates: Dict[str, Any]) -> Any:
        request_id = str(uuid.uuid4())
        normalized_updates = normalize_updates(updates)
        sanitized = sanitize_for_ipc(normalized_updates)
        loop = asyncio.get_running_loop()
        future: "asyncio.Future[Any]" = loop.create_future()
        pending_requests[request_id] = ("update", future)
        send_message({"type": "update-request", "requestId": request_id, "updates": sanitized})
        result = await future
        if isinstance(result, dict):
            self.run = result
            if "parameters" in result:
                self.parameters = result.get("parameters")
        return result

    async def resolveSecret(self, reference: Dict[str, Any]) -> Optional[str]:
        request_id = str(uuid.uuid4())
        loop = asyncio.get_running_loop()
        future: "asyncio.Future[Any]" = loop.create_future()
        pending_requests[request_id] = ("resolve-secret", future)
        send_message(
            {"type": "resolve-secret-request", "requestId": request_id, "reference": sanitize_for_ipc(reference)}
        )
        result = await future
        return result

    async def resolve_secret(self, reference: Dict[str, Any]) -> Optional[str]:
        return await self.resolveSecret(reference)

    def get_workflow_event_context(self) -> Any:
        return self.getWorkflowEventContext()


def normalize_updates(updates: Dict[str, Any]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    if "parameters" in updates:
        converted = to_json_value(updates.get("parameters"))
        if converted is not UNSUPPORTED:
            result["parameters"] = converted
    if "logsUrl" in updates:
        result["logsUrl"] = updates.get("logsUrl")
    if "metrics" in updates:
        converted = to_json_value(updates.get("metrics"))
        if converted is not UNSUPPORTED:
            result["metrics"] = converted
    if "context" in updates:
        converted = to_json_value(updates.get("context"))
        if converted is not UNSUPPORTED:
            result["context"] = converted
    if "timeoutMs" in updates:
        result["timeoutMs"] = updates.get("timeoutMs")
    return result


def collect_resource_usage() -> Optional[Dict[str, Any]]:
    try:
        usage = resource.getrusage(resource.RUSAGE_SELF)
    except Exception:  # pragma: no cover - defensive guard
        return None
    return {
        "ru_utime": usage.ru_utime,
        "ru_stime": usage.ru_stime,
        "ru_maxrss": usage.ru_maxrss,
        "ru_ixrss": usage.ru_ixrss,
        "ru_idrss": usage.ru_idrss,
        "ru_isrss": usage.ru_isrss,
        "ru_minflt": usage.ru_minflt,
        "ru_majflt": usage.ru_majflt,
        "ru_nswap": usage.ru_nswap,
        "ru_inblock": usage.ru_inblock,
        "ru_oublock": usage.ru_oublock,
        "ru_msgsnd": usage.ru_msgsnd,
        "ru_msgrcv": usage.ru_msgrcv,
        "ru_nsignals": usage.ru_nsignals,
        "ru_nvcsw": usage.ru_nvcsw,
        "ru_nivcsw": usage.ru_nivcsw,
    }


async def handle_parent_message(message: Dict[str, Any]) -> None:
    global cancel_reason
    msg_type = message.get("type")
    if msg_type == "update-response":
        request_id = message.get("requestId")
        pending = pending_requests.pop(request_id, None)
        if not pending:
            return
        kind, future = pending
        if message.get("ok"):
            value = message.get("run") if kind == "update" else message.get("value")
            if not future.done():
                future.set_result(value)
        else:
            error_message = message.get("error") or "Request failed"
            if not future.done():
                future.set_exception(RuntimeError(error_message))
    elif msg_type == "resolve-secret-response":
        request_id = message.get("requestId")
        pending = pending_requests.pop(request_id, None)
        if not pending:
            return
        _kind, future = pending
        if message.get("ok"):
            value = message.get("value")
            if not future.done():
                future.set_result(value)
        else:
            error_message = message.get("error") or "Secret resolution failed"
            if not future.done():
                future.set_exception(RuntimeError(error_message))
    elif msg_type == "cancel":
        cancel_reason = message.get("reason")
        if current_handler_task:
            current_handler_task.cancel()


async def wait_for_start() -> Dict[str, Any]:
    queue = get_message_queue()
    while True:
        message = await queue.get()
        if message.get("_internal") == "eof":
            continue
        if message.get("type") == "start":
            return message


async def dispatch_messages() -> None:
    queue = get_message_queue()
    while True:
        message = await queue.get()
        if message.get("_internal") == "shutdown":
            return
        await handle_parent_message(message)


async def execute_start(payload: Dict[str, Any]) -> None:
    global pending_requests
    task_id = payload.get("taskId") or str(uuid.uuid4())
    bundle = payload["bundle"]
    bundle_dir = bundle["directory"]
    entry_file = os.path.realpath(bundle["entryFile"])
    ensure_within_bundle(bundle_dir, entry_file)

    workflow_context = payload.get("workflowEventContext")
    if workflow_context is not None:
        try:
            serialized = json.dumps(workflow_context, separators=(",", ":"), ensure_ascii=False)
            os.environ[WORKFLOW_EVENT_CONTEXT_ENV] = serialized
        except Exception:
            os.environ.pop(WORKFLOW_EVENT_CONTEXT_ENV, None)

    os.chdir(bundle_dir)
    capabilities = bundle.get("manifest", {}).get("capabilities") or []
    if not isinstance(capabilities, list):
        capabilities = []

    setup_filesystem_guards(bundle_dir, capabilities)
    setup_network_guards(capabilities)
    try:
        ensure_python_dependencies(bundle_dir)
    except Exception as err:
        raise RuntimeError(f"Failed to install Python dependencies: {err}") from err

    spec = importlib.util.spec_from_file_location("apphub_bundle_entry", entry_file)
    if spec is None or spec.loader is None:
        raise RuntimeError("Failed to load bundle entry module")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)  # type: ignore[call-arg]
    except Exception as err:
        raise RuntimeError(f"Failed to load bundle entry: {err}") from err

    export_name = bundle.get("exportName")
    handler: Any = None
    if export_name and hasattr(module, export_name):
        handler = getattr(module, export_name)
    elif hasattr(module, "handler") and callable(getattr(module, "handler")):
        handler = getattr(module, "handler")
    elif callable(module):  # type: ignore[arg-type]
        handler = module
    elif hasattr(module, "default") and callable(getattr(module, "default")):
        handler = getattr(module, "default")

    if not callable(handler):
        raise RuntimeError("Bundle entry did not export a callable handler")

    context = JobContext(payload, task_id)

    def log(level: str, message: str, meta: Optional[Dict[str, Any]] = None) -> None:
        normalized = normalize_meta(task_id, meta) or {"sandboxTaskId": task_id}
        normalized.setdefault("sandboxTaskId", task_id)
        send_message({"type": "log", "level": level, "message": message, "meta": normalized})

    start_time = time.perf_counter()
    try:
        result = handler(context)
        if inspect.isawaitable(result):
            result = await result
        serialized = to_json_value(result if result is not None else {})
        if serialized is UNSUPPORTED:
            serialized = {}
        sanitized = sanitize_for_ipc(serialized)
        duration_ms = int((time.perf_counter() - start_time) * 1000)
        send_message(
            {
                "type": "result",
                "result": sanitized,
                "durationMs": duration_ms,
                "resourceUsage": collect_resource_usage(),
            }
        )
    except asyncio.CancelledError:
        message = cancel_reason or "Sandbox execution cancelled"
        for _request_id, (_kind, future) in list(pending_requests.items()):
            if not future.done():
                future.set_exception(RuntimeError(message))
        pending_requests.clear()
        send_message({"type": "error", "error": {"message": message}})
    except Exception:
        error = traceback.format_exc()
        message = "Handler threw error"
        log("error", message, {"error": error})
        for _request_id, (_kind, future) in list(pending_requests.items()):
            if not future.done():
                future.set_exception(RuntimeError("Handler failed"))
        pending_requests.clear()
        send_message({"type": "error", "error": {"message": message, "stack": error}})


async def main() -> None:
    loop = asyncio.get_running_loop()
    global message_queue
    message_queue = asyncio.Queue()
    reader = threading.Thread(target=stdin_reader, args=(loop,), daemon=True)
    reader.start()

    start_message = await wait_for_start()
    dispatcher_task = asyncio.create_task(dispatch_messages())
    global current_handler_task
    current_handler_task = asyncio.create_task(execute_start(start_message["payload"]))
    await current_handler_task
    current_handler_task = None
    queue = get_message_queue()
    await queue.put({"_internal": "shutdown"})
    await dispatcher_task


if __name__ == "__main__":
    asyncio.run(main())
