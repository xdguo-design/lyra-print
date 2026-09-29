from __future__ import annotations

import base64
import binascii
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, status
from sqlalchemy import and_, desc, func, insert, or_, select, update

from .data_query import resolve_production_data
from .db import transaction
from .models import (
    print_attempt,
    print_snapshot,
    print_task,
    print_template,
    print_template_version,
    printer_profile,
    template_installation,
)
from .utils import json_dumps, json_loads, new_id, now_iso, public_row, require, sha256_hex

router = APIRouter()

ALLOWED = {
    "CREATED": {"QUEUED", "CANCELLED"},
    "QUEUED": {"PRINTING", "WAITING_AGENT", "CANCELLED"},
    "PRINTING": {"SUCCESS", "FAILED", "WAITING_AGENT", "CANCELLED"},
    "FAILED": {"RETRYING"},
    "RETRYING": {"QUEUED", "WAITING_AGENT"},
    "WAITING_AGENT": {"QUEUED", "CANCELLED"},
    "SUCCESS": set(),
    "CANCELLED": set(),
}


def _get_task(conn, task_id: str):
    row = conn.execute(select(print_task).where(print_task.c.id == task_id)).mappings().first()
    if not row:
        raise HTTPException(404, detail={"error": "task_not_found", "taskId": task_id})
    return row


def _transition(conn, task_id: str, target: str, message: str | None = None, printer_id: str | None = None):
    row = _get_task(conn, task_id)
    if target not in ALLOWED.get(row["status"], set()):
        raise HTTPException(
            409,
            detail={"error": "invalid_task_transition", "taskId": task_id, "from": row["status"], "to": target},
        )

    now = now_iso()
    current_attempts = int(row["attempts"] or 0)
    values: dict[str, Any] = {"status": target, "message": message, "updated_at": now}
    if printer_id:
        values["printer_id"] = printer_id
    if target == "PRINTING":
        values["attempts"] = current_attempts + 1

    updated = conn.execute(
        update(print_task)
        .where(
            and_(
                print_task.c.id == task_id,
                print_task.c.status == row["status"],
                print_task.c.attempts == current_attempts,
            )
        )
        .values(**values)
    )
    if updated.rowcount != 1:
        latest = _get_task(conn, task_id)
        raise HTTPException(
            409,
            detail={
                "error": "invalid_task_transition",
                "taskId": task_id,
                "from": latest["status"],
                "to": target,
            },
        )

    if target == "PRINTING":
        attempt_no = current_attempts + 1
        conn.execute(
            insert(print_attempt).values(
                task_id=task_id,
                attempt_no=attempt_no,
                printer_id=printer_id or row["printer_id"],
                status="PRINTING",
                message=None,
                created_at=now,
                updated_at=now,
            )
        )

    if target in {"SUCCESS", "FAILED", "CANCELLED", "WAITING_AGENT"}:
        latest_attempt_id = conn.execute(
            select(print_attempt.c.id)
            .where(print_attempt.c.task_id == task_id)
            .order_by(desc(print_attempt.c.attempt_no), desc(print_attempt.c.id))
            .limit(1)
        ).scalar_one_or_none()
        if latest_attempt_id:
            conn.execute(
                update(print_attempt)
                .where(print_attempt.c.id == latest_attempt_id)
                .values(status=target, message=message, updated_at=now)
            )
    return public_row(_get_task(conn, task_id))


def _ensure_printer_enabled(conn, printer_id: str | None, *, required: bool = False) -> None:
    if not printer_id:
        if required:
            raise HTTPException(400, detail={"error": "validation_error", "field": "printerId"})
        return
    managed = conn.execute(
        select(printer_profile).where(printer_profile.c.printer_id == printer_id)
    ).mappings().first()
    if managed and not bool(managed["enabled"]):
        raise HTTPException(400, detail="打印机已在平台停用，不能创建或执行正式打印任务")


def _parse_instant(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


def _ensure_template_entitlement(conn, template_id: str) -> None:
    install = conn.execute(
        select(template_installation).where(template_installation.c.local_template_id == template_id)
    ).mappings().first()
    if not install or install["origin"] == "CLOUD_FREE":
        return

    state = str(install["license_state"] or "EXPIRED").upper()
    if state == "REVOKED":
        raise HTTPException(
            403,
            detail={"code": "TEMPLATE_ENTITLEMENT_REVOKED", "detail": "在线模板授权已被撤销，不能创建新的正式打印任务"},
        )

    now = datetime.now(UTC)
    valid_until = _parse_instant(install["entitlement_valid_until"])
    grace_until = _parse_instant(install["grace_until"])
    if valid_until and now <= valid_until:
        return
    if grace_until and now <= grace_until:
        return
    if state in {"ACTIVE", "GRACE"} and valid_until is None and grace_until is None:
        return
    raise HTTPException(
        403,
        detail={"code": "TEMPLATE_ENTITLEMENT_EXPIRED", "detail": "在线模板订阅与离线宽限期均已过期，不能创建新的正式打印任务"},
    )


def _resolve_published_template(conn, template_code: str):
    template = conn.execute(select(print_template).where(print_template.c.code == template_code)).mappings().first()
    if not template:
        raise HTTPException(404, detail={"error": "template_not_found", "templateCode": template_code})
    if template["status"] == "DISABLED":
        raise HTTPException(400, detail={"code": "TEMPLATE_DISABLED", "detail": "模板已停用，不能用于正式打印或预览"})
    version = template["published_version"]
    if version is None:
        raise HTTPException(400, detail={"code": "TEMPLATE_NOT_PUBLISHED", "detail": "模板尚未发布，不能用于正式打印或预览"})
    version_row = conn.execute(
        select(print_template_version).where(
            and_(
                print_template_version.c.template_id == template["id"],
                print_template_version.c.version_no == version,
            )
        )
    ).mappings().first()
    if not version_row:
        raise HTTPException(
            404,
            detail={"code": "TEMPLATE_VERSION_NOT_FOUND", "detail": f"已发布模板版本不存在: {template_code} v{version}"},
        )
    _ensure_template_entitlement(conn, template["id"])
    return template, int(version), version_row


def _copies(body: dict[str, Any], *, kind: str) -> int:
    try:
        copies = int(body.get("copies", 1))
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, detail={"error": "validation_error", "field": "copies"}) from exc
    maximum = 1 if kind == "RAW" else 99 if kind == "PDF" else None
    if copies < 1 or (maximum is not None and copies > maximum):
        raise HTTPException(400, detail={"error": "validation_error", "field": "copies"})
    return copies


def _decode_pdf(value: Any) -> tuple[str, bytes]:
    encoded = str(require(value, "pdfBase64")).strip()
    if encoded.startswith("data:application/pdf") and "," in encoded:
        encoded = encoded.split(",", 1)[1].strip()
    if len(encoded) > 30_000_000:
        raise HTTPException(400, detail={"code": "PDF_TOO_LARGE", "detail": "PDF Base64 超过允许大小"})
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(400, detail={"code": "PDF_BASE64_INVALID", "detail": "PDF Base64 无效"}) from exc
    if not raw.startswith(b"%PDF-"):
        raise HTTPException(400, detail={"code": "PDF_INVALID", "detail": "上传内容不是有效 PDF"})
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(400, detail={"code": "PDF_TOO_LARGE", "detail": "PDF 文件不能超过 20 MB"})
    return base64.b64encode(raw).decode("ascii"), raw


def _decode_raw(value: Any, language: Any) -> tuple[str, str, bytes]:
    raw_language = str(require(language, "rawLanguage")).strip().upper()
    if raw_language not in {"ESC_POS", "ZPL", "TSPL", "CPCL"}:
        raise HTTPException(400, detail={"code": "RAW_LANGUAGE_INVALID", "detail": f"不支持的 RAW 指令类型: {raw_language}"})
    encoded = str(require(value, "rawBase64")).strip()
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(400, detail={"code": "RAW_BASE64_INVALID", "detail": "RAW Base64 无效"}) from exc
    if not raw:
        raise HTTPException(400, detail={"code": "RAW_EMPTY", "detail": "RAW payload 不能为空"})
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(400, detail={"code": "RAW_TOO_LARGE", "detail": "RAW payload 不能超过 10 MB"})
    return raw_language, base64.b64encode(raw).decode("ascii"), raw


def _create_task(conn, body: dict[str, Any], *, kind: str = "TEMPLATE"):
    now = now_iso()
    task_id = new_id("PT")
    snapshot_id = new_id("PS")
    copies = _copies(body, kind=kind)
    business_key = str(require(body.get("businessKey"), "businessKey")).strip()
    printer_id = body.get("printerId")

    if kind == "TEMPLATE":
        if "printerId" not in body:
            raise HTTPException(400, detail={"error": "validation_error", "field": "printerId"})
        template_code = str(require(body.get("templateCode"), "templateCode")).strip()
        _ensure_printer_enabled(conn, printer_id)
        template, template_version, version_row = _resolve_published_template(conn, template_code)
        input_data = body.get("inputData") if "inputData" in body else body.get("data")
        render_data = resolve_production_data(conn, version_row, body.get("params"), input_data)
        payload = {
            "schemaVersion": 1,
            "documentKind": "TEMPLATE",
            "templateId": template["id"],
            "templateCode": template_code,
            "templateName": template["name"],
            "documentType": template["document_type"],
            "templateVersion": template_version,
            "businessKey": business_key,
            "design": json_loads(version_row["design_json"], {}),
            "renderData": render_data,
            "createdAt": now,
        }
    elif kind == "PDF":
        template_code = "__PDF__"
        template_version = None
        title = str(require(body.get("title"), "title")).strip()
        printer_id = str(require(printer_id, "printerId")).strip()
        _ensure_printer_enabled(conn, printer_id, required=True)
        encoded, raw = _decode_pdf(body.get("pdfBase64") or body.get("documentBase64"))
        payload = {
            "schemaVersion": 1,
            "documentKind": "PDF",
            "templateName": title,
            "documentType": "PDF",
            "businessKey": business_key,
            "pdfBase64": encoded,
            "byteLength": len(raw),
            "sha256": sha256_hex(raw),
            "createdAt": now,
        }
    else:
        template_code = "__RAW__"
        template_version = None
        title = str(require(body.get("title"), "title")).strip()
        printer_id = str(require(printer_id, "printerId")).strip()
        _ensure_printer_enabled(conn, printer_id, required=True)
        language, encoded, raw = _decode_raw(
            body.get("rawBase64") or body.get("documentBase64"),
            body.get("rawLanguage") or body.get("language"),
        )
        payload = {
            "schemaVersion": 1,
            "documentKind": "RAW",
            "templateName": title,
            "documentType": "RAW",
            "businessKey": business_key,
            "rawLanguage": language,
            "rawBase64": encoded,
            "byteLength": len(raw),
            "sha256": sha256_hex(raw),
            "createdAt": now,
        }

    conn.execute(
        insert(print_task).values(
            id=task_id,
            template_code=template_code,
            template_version=template_version,
            business_key=business_key,
            snapshot_id=snapshot_id,
            printer_id=printer_id,
            copies=copies,
            status="CREATED",
            attempts=0,
            message=None,
            created_at=now,
            updated_at=now,
        )
    )
    conn.execute(
        insert(print_snapshot).values(
            id=snapshot_id,
            task_id=task_id,
            payload_json=json_dumps(payload),
            created_at=now,
        )
    )
    return public_row(_get_task(conn, task_id))


@router.post("/api/print-previews")
def create_print_preview(body: dict[str, Any] = Body(...)):
    with transaction() as conn:
        template_code = str(require(body.get("templateCode"), "templateCode")).strip()
        template, version, version_row = _resolve_published_template(conn, template_code)
        input_data = body.get("inputData") if "inputData" in body else body.get("data")
        return {
            "templateCode": template_code,
            "templateVersion": version,
            "templateName": template["name"],
            "documentType": template["document_type"],
            "design": json_loads(version_row["design_json"], {}),
            "renderData": resolve_production_data(conn, version_row, body.get("params"), input_data),
            "generatedAt": now_iso(),
        }


@router.get("/api/print-tasks")
def list_print_tasks(
    status_value: str | None = Query(None, alias="status"),
    template_code: str | None = Query(None, alias="templateCode"),
    printer_id: str | None = Query(None, alias="printerId"),
    keyword: str | None = None,
    limit: int | None = None,
):
    query = select(print_task)
    conditions = []
    if status_value:
        conditions.append(print_task.c.status == status_value.upper())
    if template_code:
        conditions.append(print_task.c.template_code == template_code)
    if printer_id:
        conditions.append(print_task.c.printer_id == printer_id)
    if keyword:
        pattern = f"%{keyword}%"
        conditions.append(or_(print_task.c.id.like(pattern), print_task.c.business_key.like(pattern), print_task.c.template_code.like(pattern)))
    if conditions:
        query = query.where(and_(*conditions))
    query = query.order_by(desc(print_task.c.created_at)).limit(max(1, min(limit or 200, 1000)))
    with transaction() as conn:
        return [public_row(row) for row in conn.execute(query).mappings().all()]


@router.post("/api/print-tasks", status_code=status.HTTP_201_CREATED)
def create_print_task(body: dict[str, Any] = Body(...)):
    with transaction() as conn:
        return _create_task(conn, body, kind="TEMPLATE")


@router.post("/api/print-tasks/pdf", status_code=status.HTTP_201_CREATED)
def create_pdf_task(body: dict[str, Any] = Body(...)):
    with transaction() as conn:
        return _create_task(conn, body, kind="PDF")


@router.post("/api/print-tasks/raw", status_code=status.HTTP_201_CREATED)
def create_raw_task(body: dict[str, Any] = Body(...)):
    with transaction() as conn:
        return _create_task(conn, body, kind="RAW")


@router.get("/api/print-tasks/summary")
def print_task_summary():
    with transaction() as conn:
        rows = conn.execute(select(print_task.c.status, func.count().label("count")).group_by(print_task.c.status)).all()
    counts = {row.status: int(row.count) for row in rows}
    return {
        "total": sum(counts.values()),
        "created": counts.get("CREATED", 0),
        "queued": counts.get("QUEUED", 0),
        "printing": counts.get("PRINTING", 0),
        "succeeded": counts.get("SUCCESS", 0),
        "failed": counts.get("FAILED", 0),
        "retrying": counts.get("RETRYING", 0),
        "waitingAgent": counts.get("WAITING_AGENT", 0),
        "cancelled": counts.get("CANCELLED", 0),
        "active": sum(counts.get(s, 0) for s in ("CREATED", "QUEUED", "PRINTING", "RETRYING", "WAITING_AGENT")),
    }


@router.get("/api/print-tasks/{taskId}")
def get_print_task(taskId: str):
    with transaction() as conn:
        return public_row(_get_task(conn, taskId))


@router.get("/api/print-tasks/{taskId}/document")
def get_print_task_document(taskId: str):
    with transaction() as conn:
        task = _get_task(conn, taskId)
        snap = conn.execute(select(print_snapshot).where(print_snapshot.c.task_id == taskId)).mappings().first()
        payload = json_loads(snap["payload_json"], {}) if snap else {}
        return {
            "taskId": task["id"], "templateCode": task["template_code"], "templateVersion": task["template_version"],
            "templateName": payload.get("templateName"), "documentType": payload.get("documentType"),
            "documentKind": payload.get("documentKind", "TEMPLATE"), "businessKey": task["business_key"],
            "printerId": task["printer_id"], "copies": task["copies"], "design": payload.get("design"),
            "renderData": payload.get("renderData"), "pdfBase64": payload.get("pdfBase64"),
            "rawLanguage": payload.get("rawLanguage"), "rawBase64": payload.get("rawBase64"),
            "byteLength": payload.get("byteLength"), "sha256": payload.get("sha256"), "createdAt": task["created_at"],
        }


@router.get("/api/print-tasks/{taskId}/attempts")
def list_print_attempts(taskId: str):
    with transaction() as conn:
        _get_task(conn, taskId)
        rows = conn.execute(select(print_attempt).where(print_attempt.c.task_id == taskId).order_by(print_attempt.c.attempt_no, print_attempt.c.id)).mappings().all()
        return [public_row(row) for row in rows]


def _latest_attempt(conn, task_id: str):
    row = conn.execute(
        select(print_attempt).where(print_attempt.c.task_id == task_id)
        .order_by(desc(print_attempt.c.attempt_no), desc(print_attempt.c.id)).limit(1)
    ).mappings().first()
    if not row:
        raise HTTPException(409, detail={"error": "print_attempt_not_started", "taskId": task_id})
    return row


@router.post("/api/print-tasks/{taskId}/spooler-binding")
def bind_spooler(taskId: str, body: dict[str, Any] = Body(...)):
    now = now_iso()
    with transaction() as conn:
        _get_task(conn, taskId)
        attempt = _latest_attempt(conn, taskId)
        conn.execute(
            update(print_attempt)
            .where(print_attempt.c.id == attempt["id"])
            .values(
                agent_job_id=require(body.get("agentJobId"), "agentJobId"),
                spooler_job_id=int(require(body.get("spoolerJobId"), "spoolerJobId")),
                spooler_document_name=require(
                    body.get("documentName") or body.get("spoolerDocumentName"),
                    "documentName",
                ),
                spooler_status=require(body.get("spoolerStatus"), "spoolerStatus"),
                spooler_bound_at=body.get("boundAt") or now,
                spooler_last_observed_at=now,
                updated_at=now,
            )
        )
        return public_row(_latest_attempt(conn, taskId))


@router.post("/api/print-tasks/{taskId}/spooler-status")
def update_spooler_status(taskId: str, body: dict[str, Any] = Body(...)):
    now = now_iso()
    with transaction() as conn:
        _get_task(conn, taskId)
        attempt = _latest_attempt(conn, taskId)
        conn.execute(
            update(print_attempt)
            .where(print_attempt.c.id == attempt["id"])
            .values(
                spooler_status=require(body.get("spoolerStatus"), "spoolerStatus"),
                spooler_last_observed_at=now,
                updated_at=now,
            )
        )
        return public_row(_latest_attempt(conn, taskId))


@router.post("/api/print-tasks/{taskId}/queue")
def queue_print_task(taskId: str):
    with transaction() as conn:
        task = _get_task(conn, taskId)
        _ensure_printer_enabled(conn, task["printer_id"], required=True)
        return _transition(conn, taskId, "QUEUED")


@router.post("/api/print-tasks/{taskId}/start")
def start_print_task(taskId: str):
    with transaction() as conn:
        return _transition(conn, taskId, "PRINTING")


@router.post("/api/print-tasks/{taskId}/success")
def succeed_print_task(taskId: str):
    with transaction() as conn:
        return _transition(conn, taskId, "SUCCESS")


@router.post("/api/print-tasks/{taskId}/fail")
def fail_print_task(taskId: str, body: dict[str, Any] | None = Body(None)):
    with transaction() as conn:
        return _transition(conn, taskId, "FAILED", (body or {}).get("reason"))


@router.post("/api/print-tasks/{taskId}/retry")
def retry_print_task(taskId: str, body: dict[str, Any] | None = Body(None)):
    with transaction() as conn:
        task = _get_task(conn, taskId)
        printer_id = (body or {}).get("printerId") or task["printer_id"]
        _ensure_printer_enabled(conn, printer_id, required=True)
        return _transition(conn, taskId, "RETRYING", printer_id=printer_id)


@router.post("/api/print-tasks/{taskId}/wait-agent")
def wait_agent(taskId: str, body: dict[str, Any] | None = Body(None)):
    with transaction() as conn:
        return _transition(conn, taskId, "WAITING_AGENT", (body or {}).get("reason"))


@router.post("/api/print-tasks/{taskId}/cancel")
def cancel_print_task(taskId: str):
    with transaction() as conn:
        return _transition(conn, taskId, "CANCELLED")
