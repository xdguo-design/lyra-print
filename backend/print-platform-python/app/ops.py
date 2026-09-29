from __future__ import annotations

import secrets
import sqlite3
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException, Query, Request, status
from sqlalchemy import and_, case, delete, desc, func, insert, or_, select, update

from .config import get_settings
from .db import transaction
from .models import (
    agent_heartbeat,
    agent_instance,
    agent_printer,
    alert_event,
    alert_rule,
    data_source_connection,
    print_attempt,
    print_task,
    printer_profile,
    system_log,
    template_installation,
)
from .utils import json_dumps, new_id, now_iso, public_row, require

router = APIRouter()
settings = get_settings()


def extract_api_key(
    authorization: str | None,
    api_key: str | None,
    legacy_api_key: str | None = None,
) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
        if token:
            return token
    for value in (api_key, legacy_api_key):
        if value and value.strip():
            return value.strip()
    return None


def api_key_role(key: str | None) -> str | None:
    if not key:
        return None
    for role, value in (
        ("ADMIN", settings.security_admin_key),
        ("DESIGNER", settings.security_designer_key),
        ("OPERATOR", settings.security_operator_key),
        ("VIEWER", settings.security_viewer_key),
    ):
        configured = value.strip() if value else ""
        if configured and secrets.compare_digest(key, configured):
            return role
    return None


@router.get("/api/auth/session")
def auth_session(
    authorization: str | None = Header(None),
    api_key: str | None = Header(None, alias="X-Print-Api-Key"),
    legacy_api_key: str | None = Header(None, alias="X-API-Key"),
):
    if not settings.security_enabled:
        return {"authenticated": True, "role": "ADMIN", "securityEnabled": False}
    role = api_key_role(extract_api_key(authorization, api_key, legacy_api_key))
    if not role:
        raise HTTPException(401, detail={"code": "AUTH_REQUIRED", "detail": "需要有效的 Print Platform API Key"})
    return {"authenticated": True, "role": role, "securityEnabled": True}


@router.get("/api/runtime/capabilities")
def runtime_capabilities():
    enabled = bool(settings.security_enabled)
    configured = bool(settings.security_admin_key.strip()) if settings.security_admin_key else False
    if not enabled:
        warnings = [
            "当前工程未启用服务端身份认证。",
            "生产部署请设置 PRINT_SECURITY_ENABLED=true 及至少 PRINT_SECURITY_ADMIN_KEY。",
        ]
    elif not configured:
        warnings = [
            "服务端 API Key 身份认证已启用，但未配置 ADMIN Key。",
            "管理类接口将无法由 ADMIN 调用，请配置 PRINT_SECURITY_ADMIN_KEY。",
        ]
    else:
        warnings = [
            "服务端 API Key 身份认证已启用。",
            "VIEWER / DESIGNER / OPERATOR / ADMIN 权限已由后端强制校验。",
        ]
    return {
        "authenticationEnabled": enabled,
        "rbacEnabled": enabled,
        "productionActionsProtected": enabled,
        "warnings": warnings,
    }


@router.get("/api/printers")
def list_printers():
    with transaction() as conn:
        return [public_row(r) for r in conn.execute(select(printer_profile).order_by(printer_profile.c.display_name)).mappings().all()]


@router.get("/api/printers/{printerId}")
def get_printer(printerId: str):
    with transaction() as conn:
        row = conn.execute(select(printer_profile).where(printer_profile.c.printer_id == printerId)).mappings().first()
        if not row:
            raise HTTPException(404, detail={"error": "printer_not_found", "printerId": printerId})
        return public_row(row)


@router.put("/api/printers/{printerId}")
def save_printer(printerId: str, body: dict[str, Any] = Body(...)):
    now = now_iso()
    with transaction() as conn:
        old = conn.execute(select(printer_profile).where(printer_profile.c.printer_id == printerId)).mappings().first()
        values = {
            "display_name": body.get("displayName") or (old["display_name"] if old else printerId),
            "location": body.get("location", old["location"] if old else None),
            "enabled": int(body.get("enabled", bool(old["enabled"]) if old else True)),
            "default_printer": int(body.get("defaultPrinter", bool(old["default_printer"]) if old else False)),
            "notes": body.get("notes", old["notes"] if old else None),
            "offset_x_mm": float(body.get("offsetXmm", old["offset_x_mm"] if old else 0)),
            "offset_y_mm": float(body.get("offsetYmm", old["offset_y_mm"] if old else 0)),
            "scale_percent": float(body.get("scalePercent", old["scale_percent"] if old else 100)),
            "duplex_mode": body.get("duplexMode", old["duplex_mode"] if old else "SIMPLEX"),
            "color_mode": body.get("colorMode", old["color_mode"] if old else "AUTO"),
            "fit_mode": body.get("fitMode", old["fit_mode"] if old else "ACTUAL"),
            "paper_source": body.get("paperSource", old["paper_source"] if old else None),
            "updated_at": now,
        }
        if old:
            conn.execute(update(printer_profile).where(printer_profile.c.printer_id == printerId).values(**values))
        else:
            conn.execute(insert(printer_profile).values(printer_id=printerId, created_at=now, **values))
        row = conn.execute(select(printer_profile).where(printer_profile.c.printer_id == printerId)).mappings().one()
        return public_row(row)


@router.get("/api/data-sources/connections")
def list_data_sources():
    with transaction() as conn:
        return [public_row(r) for r in conn.execute(select(data_source_connection).order_by(data_source_connection.c.name)).mappings().all()]


@router.post("/api/data-sources/connections", status_code=status.HTTP_201_CREATED)
def create_data_source(body: dict[str, Any] = Body(...)):
    now = now_iso()
    connection_id = new_id("DS")
    with transaction() as conn:
        conn.execute(insert(data_source_connection).values(
            id=connection_id,
            name=require(body.get("name"), "name"),
            db_type=str(require(body.get("dbType"), "dbType")).upper(),
            jdbc_url=require(body.get("jdbcUrl"), "jdbcUrl"),
            username=body.get("username"), secret_ref=body.get("secretRef"),
            read_only=int(body.get("readOnly", True)), enabled=int(body.get("enabled", True)),
            created_at=now, updated_at=now,
        ))
        return public_row(conn.execute(select(data_source_connection).where(data_source_connection.c.id == connection_id)).mappings().one())


@router.get("/api/data-sources/connections/{connectionId}")
def get_data_source(connectionId: str):
    with transaction() as conn:
        row = conn.execute(select(data_source_connection).where(data_source_connection.c.id == connectionId)).mappings().first()
        if not row:
            raise HTTPException(404, detail={"error": "data_source_not_found", "connectionId": connectionId})
        return public_row(row)


def _sqlite_path(url: str) -> str | None:
    for prefix in ("jdbc:sqlite:", "sqlite:///"):
        if url.startswith(prefix):
            return url[len(prefix):]
    return None


@router.post("/api/data-sources/connections/test")
def test_data_source(body: dict[str, Any] = Body(...)):
    started = time.perf_counter()
    jdbc_url = require(body.get("jdbcUrl"), "jdbcUrl")
    db_type = str(body.get("dbType") or "SQLITE").upper()
    if db_type != "SQLITE":
        return {
            "success": False,
            "databaseProduct": None,
            "databaseVersion": None,
            "message": f"{db_type} adapter is not enabled in the Python runtime",
            "elapsedMs": int((time.perf_counter() - started) * 1000),
        }
    path = _sqlite_path(jdbc_url)
    if not path:
        return {
            "success": False,
            "databaseProduct": None,
            "databaseVersion": None,
            "message": "invalid SQLite URL",
            "elapsedMs": int((time.perf_counter() - started) * 1000),
        }
    try:
        uri = f"file:{Path(path).resolve().as_posix()}?mode=ro"
        db = sqlite3.connect(uri, uri=True, timeout=5)
        try:
            version = str(db.execute("SELECT sqlite_version()").fetchone()[0])
        finally:
            db.close()
        return {
            "success": True,
            "databaseProduct": "SQLite",
            "databaseVersion": version,
            "message": "connection ok",
            "elapsedMs": int((time.perf_counter() - started) * 1000),
        }
    except sqlite3.Error:
        return {
            "success": False,
            "databaseProduct": "SQLite",
            "databaseVersion": None,
            "message": "connection failed",
            "elapsedMs": int((time.perf_counter() - started) * 1000),
        }


@router.get("/api/agents")
def list_agents():
    with transaction() as conn:
        return [public_row(r) for r in conn.execute(select(agent_instance).order_by(desc(agent_instance.c.last_heartbeat_at))).mappings().all()]


@router.post("/api/agents/heartbeat")
def agent_heartbeat_upsert(body: dict[str, Any] = Body(...), request: Request = None):
    now = now_iso()
    agent_id = require(body.get("agentId"), "agentId")
    instance_id = require(body.get("instanceId"), "instanceId")
    printers = body.get("printers") or []
    ip = body.get("ipAddress") or (request.client.host if request and request.client else None)
    with transaction() as conn:
        old = conn.execute(select(agent_instance).where(and_(agent_instance.c.agent_id == agent_id, agent_instance.c.instance_id == instance_id))).mappings().first()
        values = dict(
            host_name=require(body.get("hostName"), "hostName"), ip_address=ip,
            os_name=require(body.get("osName"), "osName"), agent_version=require(body.get("agentVersion"), "agentVersion"),
            status="ONLINE", cpu_usage=body.get("cpuUsage"), memory_usage=body.get("memoryUsage"),
            active_jobs=int(body.get("activeJobs") or 0), queued_jobs=int(body.get("queuedJobs") or 0),
            printer_count=int(body.get("printerCount") if body.get("printerCount") is not None else len(printers)),
            spooler_status=body.get("spoolerStatus"), last_heartbeat_at=now, updated_at=now,
        )
        if old:
            conn.execute(update(agent_instance).where(and_(agent_instance.c.agent_id == agent_id, agent_instance.c.instance_id == instance_id)).values(**values))
        else:
            conn.execute(insert(agent_instance).values(agent_id=agent_id, instance_id=instance_id, registered_at=now, **values))
        conn.execute(insert(agent_heartbeat).values(
            agent_id=agent_id, instance_id=instance_id, cpu_usage=body.get("cpuUsage"), memory_usage=body.get("memoryUsage"),
            active_jobs=int(body.get("activeJobs") or 0), queued_jobs=int(body.get("queuedJobs") or 0),
            printer_count=int(body.get("printerCount") if body.get("printerCount") is not None else len(printers)),
            spooler_status=body.get("spoolerStatus"), agent_version=body.get("agentVersion"), created_at=now,
        ))
        for item in printers:
            pid = require(item.get("printerId"), "printerId")
            p_old = conn.execute(select(agent_printer).where(and_(agent_printer.c.agent_id == agent_id, agent_printer.c.instance_id == instance_id, agent_printer.c.printer_id == pid))).mappings().first()
            pvals = dict(
                name=item.get("name") or pid, type=item.get("type") or "UNKNOWN", status=item.get("status") or "UNKNOWN",
                default_printer=int(bool(item.get("defaultPrinter"))), driver_name=item.get("driverName"), port_name=item.get("portName"),
                shared=int(bool(item.get("shared"))), share_name=item.get("shareName"), location=item.get("location"),
                comment=item.get("comment"), paper_sizes_json=json_dumps(item.get("paperSizes") or []), last_seen_at=now,
            )
            if p_old:
                conn.execute(update(agent_printer).where(and_(agent_printer.c.agent_id == agent_id, agent_printer.c.instance_id == instance_id, agent_printer.c.printer_id == pid)).values(**pvals))
            else:
                conn.execute(insert(agent_printer).values(agent_id=agent_id, instance_id=instance_id, printer_id=pid, first_seen_at=now, **pvals))
    return {"accepted": True, "serverTime": now, "heartbeatSeconds": settings.agent_heartbeat_seconds}


@router.get("/api/agents/{agentId}/instances/{instanceId}/heartbeats")
def list_agent_heartbeats(agentId: str, instanceId: str, limit: int | None = None):
    with transaction() as conn:
        rows = conn.execute(select(agent_heartbeat).where(and_(agent_heartbeat.c.agent_id == agentId, agent_heartbeat.c.instance_id == instanceId)).order_by(desc(agent_heartbeat.c.created_at)).limit(max(1, min(limit or 200, 1000)))).mappings().all()
        return [public_row(r) for r in rows]


@router.get("/api/agents/{agentId}/instances/{instanceId}/printers")
def list_agent_printers(agentId: str, instanceId: str):
    with transaction() as conn:
        rows = conn.execute(select(agent_printer).where(and_(agent_printer.c.agent_id == agentId, agent_printer.c.instance_id == instanceId)).order_by(agent_printer.c.name)).mappings().all()
        return [public_row(r) for r in rows]


@router.get("/api/agents/{agentId}/instances/{instanceId}/printers/detail")
def get_agent_printer_detail(agentId: str, instanceId: str, printerId: str = Query(...)):
    with transaction() as conn:
        row = conn.execute(select(agent_printer).where(and_(agent_printer.c.agent_id == agentId, agent_printer.c.instance_id == instanceId, agent_printer.c.printer_id == printerId))).mappings().first()
        if not row:
            raise HTTPException(404, detail={"error": "agent_printer_not_found"})
        return public_row(row)


@router.get("/api/alerts")
def list_alerts(status_value: str | None = Query(None, alias="status"), severity: str | None = None, limit: int | None = None):
    q = select(alert_event)
    conditions = []
    if status_value:
        conditions.append(alert_event.c.status == status_value.upper())
    if severity:
        conditions.append(alert_event.c.severity == severity.upper())
    if conditions:
        q = q.where(and_(*conditions))
    with transaction() as conn:
        rows = conn.execute(q.order_by(desc(alert_event.c.last_seen_at)).limit(max(1, min(limit or 200, 1000)))).mappings().all()
        return {"items": [public_row(r) for r in rows], "total": len(rows)}


@router.get("/api/alerts/rules")
def list_alert_rules():
    with transaction() as conn:
        return [public_row(r) for r in conn.execute(select(alert_rule).order_by(alert_rule.c.code)).mappings().all()]


def _get_alert(conn, alert_id: int):
    row = conn.execute(select(alert_event).where(alert_event.c.id == alert_id)).mappings().first()
    if not row:
        raise HTTPException(404, detail={"error": "alert_not_found", "id": alert_id})
    return row


@router.post("/api/alerts/{id}/ack")
def ack_alert(id: int):
    now = now_iso()
    with transaction() as conn:
        _get_alert(conn, id)
        conn.execute(update(alert_event).where(alert_event.c.id == id).values(status="ACKED", acked_at=now, updated_at=now))
        return public_row(_get_alert(conn, id))


@router.post("/api/alerts/{id}/resolve")
def resolve_alert(id: int):
    now = now_iso()
    with transaction() as conn:
        _get_alert(conn, id)
        conn.execute(update(alert_event).where(alert_event.c.id == id).values(status="RESOLVED", resolved_at=now, updated_at=now))
        return public_row(_get_alert(conn, id))


@router.post("/api/alerts/rules/{code}/enabled")
def set_alert_rule_enabled(code: str, enabled: bool = Query(...)):
    with transaction() as conn:
        result = conn.execute(update(alert_rule).where(alert_rule.c.code == code).values(enabled=int(enabled), updated_at=now_iso()))
        if result.rowcount == 0:
            raise HTTPException(404, detail={"error": "alert_rule_not_found", "code": code})
        return public_row(conn.execute(select(alert_rule).where(alert_rule.c.code == code)).mappings().one())


@router.get("/api/system-logs")
def list_system_logs(level: str | None = None, module: str | None = None, keyword: str | None = None, resolved: bool | None = None, limit: int | None = None):
    q = select(system_log)
    conditions = []
    if level:
        conditions.append(system_log.c.level == level.upper())
    if module:
        conditions.append(system_log.c.module == module)
    if resolved is not None:
        conditions.append(system_log.c.resolved == int(resolved))
    if keyword:
        p = f"%{keyword}%"
        conditions.append(or_(system_log.c.message.like(p), system_log.c.event_type.like(p), system_log.c.task_id.like(p)))
    if conditions:
        q = q.where(and_(*conditions))
    with transaction() as conn:
        rows = conn.execute(q.order_by(desc(system_log.c.created_at)).limit(max(1, min(limit or 200, 1000)))).mappings().all()
        return {"items": [public_row(r) for r in rows], "total": len(rows)}


@router.get("/api/system-logs/{id}")
def get_system_log(id: int):
    with transaction() as conn:
        row = conn.execute(select(system_log).where(system_log.c.id == id)).mappings().first()
        if not row:
            raise HTTPException(404, detail={"error": "system_log_not_found", "id": id})
        return public_row(row)


@router.post("/api/system-logs/batch")
def write_system_log_batch(items: list[dict[str, Any]] = Body(...)):
    now = now_iso()
    with transaction() as conn:
        for item in items:
            conn.execute(insert(system_log).values(
                level=str(item.get("level") or "INFO").upper(), module=item.get("module") or "unknown",
                event_type=item.get("eventType") or "GENERIC", message=item.get("message") or "",
                stack_trace=item.get("stackTrace"), request_id=item.get("requestId"), task_id=item.get("taskId"),
                attempt_id=item.get("attemptId"), agent_id=item.get("agentId"), agent_instance_id=item.get("agentInstanceId"),
                printer_id=item.get("printerId"), spooler_job_id=item.get("spoolerJobId"), host_name=item.get("hostName"),
                ip_address=item.get("ipAddress"), resolved=0, resolved_at=None, created_at=now, updated_at=now,
            ))
    return {"accepted": len(items)}


@router.post("/api/system-logs/{id}/resolve")
def resolve_system_log(id: int):
    now = now_iso()
    with transaction() as conn:
        result = conn.execute(update(system_log).where(system_log.c.id == id).values(resolved=1, resolved_at=now, updated_at=now))
        if result.rowcount == 0:
            raise HTTPException(404, detail={"error": "system_log_not_found", "id": id})
        return public_row(conn.execute(select(system_log).where(system_log.c.id == id)).mappings().one())


@router.post("/api/system-logs/cleanup")
def cleanup_system_logs():
    started = time.perf_counter()
    batch_size = max(1, settings.system_log_cleanup_batch_size)
    max_batches = max(1, settings.system_log_cleanup_max_batches)
    retention = {
        "DEBUG": max(1, settings.system_log_retention_debug_days),
        "INFO": max(1, settings.system_log_retention_info_days),
        "WARN": max(1, settings.system_log_retention_warn_days),
        "ERROR": max(1, settings.system_log_retention_error_days),
        "FATAL": max(1, settings.system_log_retention_fatal_days),
    }
    deleted_count = 0
    batches = 0

    with transaction() as conn:
        for level, days in retention.items():
            cutoff = (datetime.now(UTC) - timedelta(days=days)).isoformat().replace("+00:00", "Z")
            while batches < max_batches:
                stmt = (
                    select(system_log.c.id)
                    .where(system_log.c.level == level, system_log.c.created_at < cutoff)
                    .order_by(system_log.c.id)
                    .limit(batch_size)
                )
                if settings.system_log_cleanup_preserve_unresolved_errors and level in {"ERROR", "FATAL"}:
                    stmt = stmt.where(system_log.c.resolved == 1)
                ids = [row[0] for row in conn.execute(stmt).all()]
                if not ids:
                    break
                result = conn.execute(delete(system_log).where(system_log.c.id.in_(ids)))
                deleted_count += int(result.rowcount or 0)
                batches += 1
                if len(ids) < batch_size:
                    break
            if batches >= max_batches:
                break

        oldest_remaining = conn.execute(select(func.min(system_log.c.created_at))).scalar_one_or_none()

    return {
        "deleted": deleted_count,
        "batches": batches,
        "durationMs": max(0, int((time.perf_counter() - started) * 1000)),
        "oldestRemainingAt": oldest_remaining,
        "completedAt": now_iso(),
    }


def _report_range(from_: str | None, to: str | None):
    from datetime import date, timedelta

    if from_ is None and to is None:
        today = date.today()
        return (today - timedelta(days=6)).isoformat(), (today + timedelta(days=1)).isoformat()
    try:
        if from_:
            date.fromisoformat(from_[:10])
        end = (date.fromisoformat(to[:10]) + timedelta(days=1)).isoformat() if to else None
    except ValueError as exc:
        raise HTTPException(
            400,
            detail={"code": "REPORT_RANGE_INVALID", "detail": "报表日期范围格式无效，应使用 ISO 日期"},
        ) from exc
    return from_, end


def _range_conditions(column, from_: str | None, to: str | None):
    start, end = _report_range(from_, to)
    conditions = []
    if start:
        conditions.append(column >= start)
    if end:
        conditions.append(column < end)
    return conditions, start, end


@router.get("/api/reports/summary")
def report_summary(from_: str | None = Query(None, alias="from"), to: str | None = None):
    conditions, start, end = _range_conditions(print_task.c.created_at, from_, to)
    where = and_(*conditions) if conditions else None

    def q(expr):
        stmt = select(expr).select_from(print_task)
        return stmt.where(where) if where is not None else stmt

    with transaction() as conn:
        total = int(conn.execute(q(func.count())).scalar_one() or 0)
        succeeded = int(conn.execute(q(func.coalesce(func.sum(case((print_task.c.status == "SUCCESS", 1), else_=0)), 0))).scalar_one() or 0)
        failed = int(conn.execute(q(func.coalesce(func.sum(case((print_task.c.status == "FAILED", 1), else_=0)), 0))).scalar_one() or 0)
        cancelled = int(conn.execute(q(func.coalesce(func.sum(case((print_task.c.status == "CANCELLED", 1), else_=0)), 0))).scalar_one() or 0)
        active = int(conn.execute(q(func.coalesce(func.sum(case((print_task.c.status.in_(["QUEUED", "PRINTING", "RETRYING", "WAITING_AGENT"]), 1), else_=0)), 0))).scalar_one() or 0)
        attempts = int(conn.execute(q(func.coalesce(func.sum(print_task.c.attempts), 0))).scalar_one() or 0)
    return {
        "from": start,
        "to": end,
        "total": total,
        "succeeded": succeeded,
        "failed": failed,
        "cancelled": cancelled,
        "active": active,
        "attempts": attempts,
        "successRate": round(succeeded * 100 / total, 2) if total else 0,
    }


@router.get("/api/reports/daily")
def report_daily(from_: str | None = Query(None, alias="from"), to: str | None = None):
    conditions, _, _ = _range_conditions(print_task.c.created_at, from_, to)
    q = select(
        func.substr(print_task.c.created_at, 1, 10).label("date"),
        func.count().label("total"),
        func.sum(case((print_task.c.status == "SUCCESS", 1), else_=0)).label("succeeded"),
        func.sum(case((print_task.c.status == "FAILED", 1), else_=0)).label("failed"),
        func.sum(case((print_task.c.status == "CANCELLED", 1), else_=0)).label("cancelled"),
    ).group_by("date").order_by("date")
    if conditions:
        q = q.where(and_(*conditions))
    with transaction() as conn:
        rows = conn.execute(q).mappings().all()
        return [
            {
                **dict(r),
                "successRate": round((r["succeeded"] or 0) * 100 / r["total"], 2) if r["total"] else 0,
            }
            for r in rows
        ]


@router.get("/api/reports/printers")
def report_printers(from_: str | None = Query(None, alias="from"), to: str | None = None):
    conditions, _, _ = _range_conditions(print_task.c.created_at, from_, to)
    q = select(
        print_task.c.printer_id,
        func.count().label("total"),
        func.sum(case((print_task.c.status == "SUCCESS", 1), else_=0)).label("succeeded"),
        func.sum(case((print_task.c.status == "FAILED", 1), else_=0)).label("failed"),
        func.max(print_task.c.created_at).label("lastPrintAt"),
    ).group_by(print_task.c.printer_id).order_by(desc("total"))
    if conditions:
        q = q.where(and_(*conditions))
    with transaction() as conn:
        rows = conn.execute(q).mappings().all()
        return [
            {
                "printerId": r["printer_id"],
                "total": r["total"],
                "succeeded": r["succeeded"] or 0,
                "failed": r["failed"] or 0,
                "successRate": round((r["succeeded"] or 0) * 100 / r["total"], 2) if r["total"] else 0,
                "lastPrintAt": r["lastPrintAt"],
            }
            for r in rows
        ]


@router.get("/api/reports/templates")
def report_templates(from_: str | None = Query(None, alias="from"), to: str | None = None):
    conditions, _, _ = _range_conditions(print_task.c.created_at, from_, to)
    q = select(
        print_task.c.template_code,
        func.count().label("total"),
        func.sum(case((print_task.c.status == "SUCCESS", 1), else_=0)).label("succeeded"),
        func.sum(case((print_task.c.status == "FAILED", 1), else_=0)).label("failed"),
        func.max(print_task.c.created_at).label("lastPrintAt"),
    ).group_by(print_task.c.template_code).order_by(desc("total"))
    if conditions:
        q = q.where(and_(*conditions))
    with transaction() as conn:
        rows = conn.execute(q).mappings().all()
        return [
            {
                "templateCode": r["template_code"],
                "total": r["total"],
                "succeeded": r["succeeded"] or 0,
                "failed": r["failed"] or 0,
                "successRate": round((r["succeeded"] or 0) * 100 / r["total"], 2) if r["total"] else 0,
                "lastPrintAt": r["lastPrintAt"],
            }
            for r in rows
        ]


@router.get("/api/reports/logs")
def report_logs(
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    status_value: str | None = Query(None, alias="status"),
    keyword: str | None = None,
    limit: int | None = None,
):
    conditions, _, _ = _range_conditions(print_attempt.c.created_at, from_, to)
    if status_value:
        conditions.append(print_attempt.c.status == status_value.upper())
    if keyword:
        pattern = f"%{keyword}%"
        conditions.append(or_(print_task.c.business_key.like(pattern), print_task.c.template_code.like(pattern)))
    q = select(
        print_attempt.c.created_at,
        print_attempt.c.task_id,
        print_task.c.template_code,
        print_task.c.template_version,
        print_task.c.business_key,
        print_attempt.c.attempt_no,
        print_attempt.c.printer_id,
        print_attempt.c.status,
        print_attempt.c.message,
    ).select_from(print_attempt.join(print_task, print_attempt.c.task_id == print_task.c.id))
    if conditions:
        q = q.where(and_(*conditions))
    q = q.order_by(desc(print_attempt.c.created_at), desc(print_attempt.c.id)).limit(max(1, min(limit or 100, 500)))
    with transaction() as conn:
        return [
            {
                "createdAt": r["created_at"],
                "taskId": r["task_id"],
                "templateCode": r["template_code"],
                "templateVersion": r["template_version"],
                "businessKey": r["business_key"],
                "attemptNo": r["attempt_no"],
                "printerId": r["printer_id"],
                "status": r["status"],
                "message": r["message"],
            }
            for r in conn.execute(q).mappings().all()
        ]


@router.get("/api/cloud-templates/status")
def cloud_template_status():
    return {
        "provider": settings.cloud_template_provider,
        "enabled": settings.cloud_template_enabled,
        "configured": bool(settings.cloud_template_enabled),
        "available": False,
        "publisherEnabled": settings.cloud_template_publisher_enabled,
        "accountConfigured": bool(settings.cloud_template_account_id),
        "message": "在线模板未启用" if not settings.cloud_template_enabled else "在线模板适配器尚未配置",
    }


@router.get("/api/cloud-templates")
def list_cloud_templates():
    if not settings.cloud_template_enabled:
        return []
    raise HTTPException(503, detail={"code": "CLOUD_TEMPLATE_UNAVAILABLE", "detail": "在线模板服务不可用"})


@router.post("/api/cloud-templates/upload/{templateId}")
def upload_cloud_template(templateId: str):
    raise HTTPException(503, detail={"code": "CLOUD_TEMPLATE_UNAVAILABLE", "detail": "在线模板服务不可用", "templateId": templateId})


@router.get("/api/cloud-templates/{code}/versions/{versionNo}")
def get_cloud_template(code: str, versionNo: int):
    raise HTTPException(503, detail={"code": "CLOUD_TEMPLATE_UNAVAILABLE", "detail": "在线模板服务不可用", "templateCode": code, "versionNo": versionNo})


@router.get("/api/template-installations")
def list_template_installations():
    with transaction() as conn:
        return [public_row(r) for r in conn.execute(select(template_installation).order_by(desc(template_installation.c.updated_at))).mappings().all()]


@router.post("/api/template-installations/cloud/{code}/versions/{versionNo}")
def install_cloud_template(code: str, versionNo: int):
    raise HTTPException(503, detail={"error": "cloud_template_adapter_not_configured", "code": code, "versionNo": versionNo})


@router.post("/api/template-installations/{localTemplateId}/refresh-license")
def refresh_template_license(localTemplateId: str):
    with transaction() as conn:
        row = conn.execute(select(template_installation).where(template_installation.c.local_template_id == localTemplateId)).mappings().first()
        if not row:
            raise HTTPException(404, detail={"error": "template_installation_not_found", "localTemplateId": localTemplateId})
        if not settings.cloud_template_enabled:
            raise HTTPException(503, detail={"error": "cloud_template_adapter_not_configured"})
        return public_row(row)
