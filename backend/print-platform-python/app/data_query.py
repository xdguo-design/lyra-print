from __future__ import annotations

import sqlite3
import time
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select

from .models import data_source_connection
from .utils import json_loads

_DENIED_SQLITE_ACTIONS = {
    getattr(sqlite3, name)
    for name in (
        "SQLITE_INSERT",
        "SQLITE_UPDATE",
        "SQLITE_DELETE",
        "SQLITE_CREATE_INDEX",
        "SQLITE_CREATE_TABLE",
        "SQLITE_CREATE_TEMP_INDEX",
        "SQLITE_CREATE_TEMP_TABLE",
        "SQLITE_CREATE_TEMP_TRIGGER",
        "SQLITE_CREATE_TEMP_VIEW",
        "SQLITE_CREATE_TRIGGER",
        "SQLITE_CREATE_VIEW",
        "SQLITE_DROP_INDEX",
        "SQLITE_DROP_TABLE",
        "SQLITE_DROP_TEMP_INDEX",
        "SQLITE_DROP_TEMP_TABLE",
        "SQLITE_DROP_TEMP_TRIGGER",
        "SQLITE_DROP_TEMP_VIEW",
        "SQLITE_DROP_TRIGGER",
        "SQLITE_DROP_VIEW",
        "SQLITE_ALTER_TABLE",
        "SQLITE_REINDEX",
        "SQLITE_ANALYZE",
        "SQLITE_ATTACH",
        "SQLITE_DETACH",
        "SQLITE_PRAGMA",
        "SQLITE_TRANSACTION",
        "SQLITE_SAVEPOINT",
    )
    if hasattr(sqlite3, name)
}


def _problem(status_code: int, code: str, detail: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code, detail={"code": code, "detail": detail, **extra})


def _sqlite_path(url: str) -> str | None:
    for prefix in ("jdbc:sqlite:", "sqlite:///"):
        if url.startswith(prefix):
            return url[len(prefix):]
    return None


def _authorizer(action: int, _arg1: str | None, _arg2: str | None, _db: str | None, _source: str | None) -> int:
    return sqlite3.SQLITE_DENY if action in _DENIED_SQLITE_ACTIONS else sqlite3.SQLITE_OK


def _coerce_param(value: Any, param_type: str) -> Any:
    if value is None:
        return None
    kind = param_type.upper()
    try:
        if kind == "STRING":
            return str(value)
        if kind == "INTEGER":
            return int(value)
        if kind == "DECIMAL":
            return float(Decimal(str(value)))
        if kind == "BOOLEAN":
            if isinstance(value, bool):
                return int(value)
            text = str(value).strip().lower()
            if text in {"1", "true", "yes", "on"}:
                return 1
            if text in {"0", "false", "no", "off"}:
                return 0
            raise ValueError("invalid boolean")
        if kind == "DATE":
            return date.fromisoformat(str(value)).isoformat()
        if kind == "DATETIME":
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).isoformat()
    except (TypeError, ValueError, ArithmeticError) as exc:
        raise _problem(400, "QUERY_PARAM_INVALID", f"参数值无法转换为 {kind}") from exc
    raise _problem(400, "QUERY_PARAM_TYPE_INVALID", f"不支持的参数类型: {param_type}")


def _query_params(query: dict[str, Any], supplied: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for spec in query.get("params") or []:
        name = str(spec.get("name") or "").strip()
        if not name:
            raise _problem(400, "QUERY_CONFIG_INVALID", "查询参数缺少 name")
        if name in supplied:
            value = supplied[name]
        elif "defaultValue" in spec:
            value = spec.get("defaultValue")
        elif spec.get("required"):
            raise _problem(400, "QUERY_PARAM_REQUIRED", f"缺少必填参数: {name}", parameter=name)
        else:
            value = None
        result[name] = _coerce_param(value, str(spec.get("type") or "STRING"))
    return result


def _validate_read_only_sql(sql: str) -> str:
    statement = sql.strip()
    if not statement:
        raise _problem(400, "QUERY_SQL_REQUIRED", "SQL 不能为空")
    without_tail = statement[:-1].rstrip() if statement.endswith(";") else statement
    if ";" in without_tail:
        raise _problem(400, "QUERY_SQL_MULTIPLE_STATEMENTS", "只允许单条只读 SQL")
    head = without_tail.lstrip().split(None, 1)[0].upper() if without_tail.strip() else ""
    if head not in {"SELECT", "WITH"}:
        raise _problem(400, "QUERY_SQL_NOT_READ_ONLY", "只允许 SELECT 或 WITH...SELECT")
    return without_tail


def _open_sqlite_read_only(url: str) -> sqlite3.Connection:
    path = _sqlite_path(url)
    if not path:
        raise _problem(400, "DATA_SOURCE_URL_INVALID", "SQLite URL 无效")
    resolved = Path(path).expanduser().resolve()
    uri = f"file:{resolved.as_posix()}?mode=ro"
    try:
        db = sqlite3.connect(uri, uri=True, timeout=5)
    except sqlite3.Error as exc:
        raise _problem(400, "DATA_SOURCE_CONNECT_FAILED", "SQLite 数据源连接失败") from exc
    db.row_factory = sqlite3.Row
    db.set_authorizer(_authorizer)
    return db


def _execute_query(platform_conn, query: dict[str, Any], supplied_params: dict[str, Any]) -> Any:
    connection_id = str(query.get("connectionId") or "").strip()
    if not connection_id:
        raise _problem(400, "QUERY_CONFIG_INVALID", "查询缺少 connectionId")
    source = platform_conn.execute(
        select(data_source_connection).where(data_source_connection.c.id == connection_id)
    ).mappings().first()
    if not source:
        raise _problem(400, "DATA_SOURCE_NOT_FOUND", f"数据源不存在: {connection_id}")
    if not bool(source["enabled"]):
        raise _problem(400, "DATA_SOURCE_DISABLED", f"数据源已停用: {connection_id}")
    if not bool(source["read_only"]):
        raise _problem(400, "DATA_SOURCE_NOT_READ_ONLY", f"正式打印只允许只读数据源: {connection_id}")
    if str(source["db_type"]).upper() != "SQLITE":
        raise _problem(503, "DATA_SOURCE_ADAPTER_UNAVAILABLE", f"{source['db_type']} Python 适配器尚未启用")

    sql = _validate_read_only_sql(str(query.get("sql") or ""))
    params = _query_params(query, supplied_params)
    max_rows = max(1, min(int(query.get("maxRows") or 1000), 10000))
    timeout_ms = max(100, min(int(query.get("timeoutMs") or 5000), 30000))
    deadline = time.monotonic() + timeout_ms / 1000

    db = _open_sqlite_read_only(str(source["jdbc_url"]))
    db.set_progress_handler(lambda: 1 if time.monotonic() >= deadline else 0, 1000)
    try:
        cursor = db.execute(sql, params)
        rows = cursor.fetchmany(max_rows + 1)
    except sqlite3.OperationalError as exc:
        if "interrupted" in str(exc).lower() and time.monotonic() >= deadline:
            raise _problem(
                400,
                "QUERY_TIMEOUT",
                f"只读 SQL 执行超过 timeoutMs={timeout_ms}",
                queryId=query.get("queryId"),
            ) from exc
        raise _problem(400, "QUERY_EXECUTION_FAILED", "只读 SQL 执行失败", queryId=query.get("queryId")) from exc
    except sqlite3.Error as exc:
        raise _problem(400, "QUERY_EXECUTION_FAILED", "只读 SQL 执行失败", queryId=query.get("queryId")) from exc
    finally:
        db.set_progress_handler(None, 0)
        db.close()

    if len(rows) > max_rows:
        raise _problem(400, "QUERY_ROW_LIMIT_EXCEEDED", f"查询结果超过 maxRows={max_rows}", queryId=query.get("queryId"))

    mapped = [dict(row) for row in rows]
    result_type = str(query.get("resultType") or "ARRAY").upper()
    if result_type == "ARRAY":
        return mapped
    if result_type == "OBJECT":
        return mapped[0] if mapped else {}
    if result_type == "SCALAR":
        if not mapped:
            return None
        first = mapped[0]
        return next(iter(first.values())) if first else None
    raise _problem(400, "QUERY_RESULT_TYPE_INVALID", f"不支持的 resultType: {result_type}")


def execute_single_query(
    platform_conn,
    query: dict[str, Any],
    supplied_params: dict[str, Any] | None = None,
) -> tuple[Any, dict[str, Any]]:
    started = time.perf_counter()
    result = _execute_query(platform_conn, query, supplied_params or {})
    if isinstance(result, list):
        row_count = len(result)
    elif result is None:
        row_count = 0
    else:
        row_count = 1
    summary = {
        "queryId": str(query.get("queryId") or ""),
        "name": query.get("name"),
        "resultKey": query.get("resultKey"),
        "resultType": str(query.get("resultType") or "ARRAY").upper(),
        "status": "SUCCESS",
        "rowCount": row_count,
        "elapsedMs": max(0, int((time.perf_counter() - started) * 1000)),
        "errorCode": None,
        "errorMessage": None,
    }
    return result, summary


def resolve_production_data_with_summaries(
    platform_conn,
    version_row,
    params_input: Any,
    input_data: Any,
    *,
    allow_sample_json: bool = False,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    config = json_loads(version_row["data_config_json"], {"schemaVersion": 1, "mode": "JSON", "queries": []})
    mode = str(config.get("mode") or "JSON").upper()

    if mode == "JSON":
        if input_data is None:
            if not allow_sample_json:
                raise _problem(400, "INPUT_DATA_REQUIRED", "JSON 模式正式打印必须提供 inputData，不能回退到模板样例数据")
            sample = json_loads(version_row["sample_data_json"], {})
            return (dict(sample) if isinstance(sample, dict) else {}), []
        if not isinstance(input_data, dict):
            raise _problem(400, "INPUT_DATA_INVALID", "JSON 模式 inputData 必须是对象")
        return dict(input_data), []

    if mode != "SQL":
        raise _problem(400, "DATA_MODE_INVALID", f"不支持的数据模式: {mode}")
    if input_data is not None:
        raise _problem(400, "INPUT_DATA_NOT_ALLOWED", "SQL 模式不允许 inputData")
    supplied = params_input if isinstance(params_input, dict) else {}

    sample = json_loads(version_row["sample_data_json"], {})
    render_data = dict(sample) if isinstance(sample, dict) else {}
    summaries: list[dict[str, Any]] = []
    queries = sorted(
        (q for q in (config.get("queries") or []) if q.get("enabled", True)),
        key=lambda q: int(q.get("order") or 0),
    )
    if not queries:
        raise _problem(400, "QUERY_REQUIRED", "SQL 模式至少需要一条启用查询")
    for query in queries:
        result_key = str(query.get("resultKey") or "").strip()
        if not result_key or result_key in {"__proto__", "prototype", "constructor"}:
            raise _problem(400, "QUERY_RESULT_KEY_INVALID", "查询 resultKey 无效")
        result, summary = execute_single_query(platform_conn, query, supplied)
        render_data[result_key] = result
        summaries.append(summary)
    return render_data, summaries


def resolve_production_data(platform_conn, version_row, params_input: Any, input_data: Any) -> dict[str, Any]:
    render_data, _ = resolve_production_data_with_summaries(
        platform_conn,
        version_row,
        params_input,
        input_data,
    )
    return render_data
