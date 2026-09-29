from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: Any, default: Any = None) -> Any:
    if value is None:
        return default
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default if default is not None else value


_CAMEL_RE = re.compile(r"_([a-z])")


def camel(name: str) -> str:
    return _CAMEL_RE.sub(lambda m: m.group(1).upper(), name)


RENAME = {
    "design_json": "design",
    "sample_data_json": "sampleData",
    "data_config_json": "dataConfig",
    "payload_json": "payload",
    "scope_values_json": "scopeValues",
    "detail_json": "detail",
    "paper_sizes_json": "paperSizes",
    "request_json": "request",
    "result_json": "result",
    "input_params_json": "inputParams",
    "input_data_json": "inputData",
    "render_data_json": "renderData",
}

JSON_FIELDS = {
    "design_json",
    "sample_data_json",
    "data_config_json",
    "payload_json",
    "scope_values_json",
    "detail_json",
    "paper_sizes_json",
    "request_json",
    "result_json",
    "input_params_json",
    "input_data_json",
    "render_data_json",
}

BOOL_FIELDS = {
    "enabled",
    "default_printer",
    "read_only",
    "active",
    "resolved",
    "shared",
    "clone_allowed",
    "payload_persisted",
}


def public_row(row: Mapping[str, Any] | Any) -> dict[str, Any]:
    source = row._mapping if hasattr(row, "_mapping") else row
    result: dict[str, Any] = {}
    for key, value in dict(source).items():
        out_key = RENAME.get(key, camel(key))
        if key in JSON_FIELDS:
            if key == "paper_sizes_json":
                value = json_loads(value, [])
            elif key in {"scope_values_json"}:
                value = json_loads(value, [])
            elif key in {"detail_json", "request_json", "result_json", "input_params_json", "input_data_json", "render_data_json"}:
                value = json_loads(value, {})
            else:
                value = json_loads(value, {})
        elif key in BOOL_FIELDS and value is not None:
            value = bool(value)
        result[out_key] = value
    return result


def require(value: Any, field: str) -> Any:
    if value is None or (isinstance(value, str) and not value.strip()):
        raise HTTPException(status_code=400, detail={"error": "validation_error", "field": field})
    return value


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
