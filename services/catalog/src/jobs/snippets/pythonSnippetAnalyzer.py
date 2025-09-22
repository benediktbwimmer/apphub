#!/usr/bin/env python3
"""Analyze Python job snippets that define Pydantic input/output models and a handler function.

The script loads a snippet from disk, performs light-weight static validation, executes the code in a
restricted global namespace, and extracts JSON Schemas for the input/output Pydantic models that are
referenced by the primary handler function. Results are written to stdout as JSON so the Node backend
can consume them.
"""
from __future__ import annotations

import ast
import builtins
import inspect
import json
import os
import subprocess
import sys
import tempfile
import traceback
from typing import Any, Dict, List, Tuple, get_type_hints

ALLOWED_MODULES = {
    "typing",
    "typing_extensions",
    "pydantic",
    "datetime",
    "uuid",
    "decimal",
    "pathlib",
    "dataclasses",
    "math",
    "functools",
    "statistics",
    "collections",
    "re",
    "json",
    "enum",
    "fractions",
    "itertools"
}

BaseModel = None


def ensure_pydantic() -> None:
    global BaseModel
    if BaseModel is not None:
        return
    try:
        from pydantic import BaseModel as _BaseModel  # type: ignore

        BaseModel = _BaseModel
        return
    except ImportError:
        pass

    target_root = os.path.join(tempfile.gettempdir(), 'apphub-python-snippet-deps')
    install_dir = os.path.join(target_root, 'pydantic')
    os.makedirs(install_dir, exist_ok=True)
    marker = os.path.join(install_dir, '.installed')
    need_install = True
    if os.path.isfile(marker) and os.path.isdir(os.path.join(install_dir, 'pydantic')):
        need_install = False

    if need_install:
        cmd = [
            sys.executable,
            '-m',
            'pip',
            'install',
            '--quiet',
            '--disable-pip-version-check',
            '--no-warn-script-location',
            '-t',
            install_dir,
            'pydantic'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            message = result.stderr.strip() or result.stdout.strip() or 'Failed to install pydantic'
            raise SystemExit(json.dumps({
                "ok": False,
                "error": {
                    "message": "Unable to install pydantic",
                    "details": message
                }
            }))
        with open(marker, 'w', encoding='utf-8') as handle:
            handle.write('installed')

    if install_dir not in sys.path:
        sys.path.insert(0, install_dir)

    try:
        from pydantic import BaseModel as _BaseModel  # type: ignore

        BaseModel = _BaseModel
    except ImportError as exc:  # pragma: no cover - defensive guard
        raise SystemExit(json.dumps({
            "ok": False,
            "error": {
                "message": "Pydantic could not be imported",
                "details": str(exc)
            }
        }))


def ensure_allowed_imports(tree: ast.AST) -> None:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split('.')[0]
                if root not in ALLOWED_MODULES:
                    raise ValueError(f"Importing module '{alias.name}' is not permitted")
        elif isinstance(node, ast.ImportFrom):
            module = node.module.split('.')[0] if node.module else ''
            if module and module not in ALLOWED_MODULES:
                raise ValueError(f"Importing from module '{node.module}' is not permitted")


def guarded_import(name: str, globals_dict: Dict[str, Any] | None = None,
                   locals_dict: Dict[str, Any] | None = None,
                   fromlist: Tuple[str, ...] = (), level: int = 0) -> Any:
    root = name.split('.')[0]
    if root not in ALLOWED_MODULES:
        raise ImportError(f"Import of module '{name}' is not permitted")
    return __import__(name, globals_dict, locals_dict, fromlist, level)


SAFE_BUILTINS = builtins.__dict__.copy()
SAFE_BUILTINS['__import__'] = guarded_import

SAFE_GLOBALS = {"__builtins__": SAFE_BUILTINS}


class AnalysisError(Exception):
    pass


def load_snippet(path: str) -> str:
    try:
        with open(path, 'r', encoding='utf-8') as handle:
            return handle.read()
    except OSError as exc:  # pragma: no cover - filesystem guard
        raise AnalysisError(f"Failed to read snippet: {exc}")


def execute_snippet(snippet: str) -> Dict[str, Any]:
    namespace: Dict[str, Any] = {}
    try:
        exec(snippet, SAFE_GLOBALS, namespace)
    except Exception as exc:
        raise AnalysisError(f"Failed to execute snippet: {exc}") from exc
    return namespace


def resolve_handler(namespace: Dict[str, Any]) -> Tuple[str, Any, Any, Any]:
    candidates: List[Tuple[int, str, Any, Any, Any]] = []
    for name, obj in list(namespace.items()):
        if not inspect.isfunction(obj):
            continue
        try:
            hints = get_type_hints(obj, globalns=namespace, localns=namespace)
        except Exception:
            continue
        parameters = list(inspect.signature(obj).parameters.values())
        if len(parameters) != 1:
            continue
        param_name = parameters[0].name
        param_type = hints.get(param_name)
        return_type = hints.get('return')
        if param_type is None or return_type is None:
            continue
        if not inspect.isclass(param_type) or not issubclass(param_type, BaseModel):
            continue
        if not inspect.isclass(return_type) or not issubclass(return_type, BaseModel):
            continue
        score = 1 if name in {"handler", "run", "main"} else 0
        candidates.append((score, name, obj, param_type, return_type))
    if not candidates:
        raise AnalysisError(
            "No function with a single Pydantic parameter and Pydantic return annotation was found"
        )
    candidates.sort(key=lambda entry: (-entry[0], entry[1]))
    _, chosen_name, chosen_fn, input_model, output_model = candidates[0]
    return chosen_name, chosen_fn, input_model, output_model


def model_schema(model: Any) -> Dict[str, Any]:
    try:
        return model.model_json_schema()
    except Exception as exc:  # pragma: no cover - defensive guard
        raise AnalysisError(f"Failed to generate schema for model '{model.__name__}': {exc}") from exc


def analyse(path: str) -> Dict[str, Any]:
    ensure_pydantic()
    snippet = load_snippet(path)
    tree = ast.parse(snippet)
    ensure_allowed_imports(tree)
    namespace = execute_snippet(snippet)

    models = {
        name: value for name, value in namespace.items()
        if inspect.isclass(value) and issubclass(value, BaseModel)
    }
    if not models:
        raise AnalysisError('No Pydantic BaseModel subclasses were defined in the snippet')

    function_name, function_obj, input_model, output_model = resolve_handler(namespace)

    parameters_schema = model_schema(input_model)
    output_schema = model_schema(output_model)

    return {
        "ok": True,
        "handlerName": function_name,
        "handlerIsAsync": inspect.iscoroutinefunction(function_obj),
        "inputModel": {
            "name": input_model.__name__,
            "schema": parameters_schema
        },
        "outputModel": {
            "name": output_model.__name__,
            "schema": output_schema
        }
    }


def main() -> None:
    if len(sys.argv) != 2:
        print(json.dumps({
            "ok": False,
            "error": {
                "message": "Snippet path argument is required"
            }
        }), file=sys.stdout)
        raise SystemExit(1)
    snippet_path = sys.argv[1]
    try:
        result = analyse(snippet_path)
    except AnalysisError as exc:
        payload = {
            "ok": False,
            "error": {
                "message": str(exc)
            }
        }
        print(json.dumps(payload), file=sys.stdout)
        raise SystemExit(0)
    except Exception as exc:  # pragma: no cover - unexpected failure
        payload = {
            "ok": False,
            "error": {
                "message": "Unexpected analyzer error",
                "details": ''.join(traceback.format_exception(type(exc), exc, exc.__traceback__))
            }
        }
        print(json.dumps(payload), file=sys.stdout)
        raise SystemExit(0)
    print(json.dumps(result), file=sys.stdout)


if __name__ == '__main__':
    main()
