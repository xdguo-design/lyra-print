from __future__ import annotations

import re
import time
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, status
from sqlalchemy import and_, desc, insert, select, update

from .config import get_settings
from .data_query import execute_single_query, resolve_production_data_with_summaries
from .db import transaction
from .models import (
    print_template,
    print_template_audit,
    print_template_release,
    print_template_version,
    template_ai_task,
    template_installation,
    template_test_query,
    template_test_run,
)
from .utils import json_dumps, json_loads, new_id, now_iso, public_row, require

router = APIRouter()
settings = get_settings()

DEFAULT_DESIGN = {
    "paper": {
        "size": "A4", "width": 210, "height": 297, "orientation": "PORTRAIT",
        "marginTop": 10, "marginRight": 10, "marginBottom": 10, "marginLeft": 10,
    },
    "grid": True,
    "snap": True,
    "elements": [
        {"id": "title", "type": "TITLE", "x": 35, "y": 15, "w": 140, "h": 12, "text": "门诊缴费票据", "binding": "title", "visible": True, "locked": False, "fontSize": 12, "zIndex": 1, "style": {}},
        {"id": "patient", "type": "TEXT", "x": 20, "y": 35, "w": 80, "h": 8, "text": "患者：{{patientName}}", "binding": "patientName", "visible": True, "locked": False, "fontSize": 12, "zIndex": 1, "style": {}},
        {"id": "table", "type": "TABLE", "x": 20, "y": 55, "w": 170, "h": 70, "text": "费用明细", "binding": "items", "visible": True, "locked": False, "fontSize": 12, "zIndex": 1, "style": {}, "table": {"repeatHeader": True, "pageRows": 18, "hideWhenEmpty": False, "fixedTotal": True, "columns": [{"key": "name", "label": "项目", "width": 80, "align": "left"}, {"key": "qty", "label": "数量", "width": 35, "align": "center"}, {"key": "amount", "label": "金额", "width": 55, "align": "right", "aggregate": "SUM"}]}},
        {"id": "total", "type": "AMOUNT", "x": 120, "y": 132, "w": 70, "h": 10, "text": "合计：{{totalAmount}}", "binding": "totalAmount", "visible": True, "locked": False, "fontSize": 12, "zIndex": 1, "style": {}},
    ],
}
DEFAULT_SAMPLE_DATA = {
    "title": "门诊缴费票据", "patientName": "张三", "patientNo": "MZ20260920001",
    "date": "2026-09-20", "page": 1, "amount": 266.0, "totalAmount": 266.0,
    "items": [
        {"name": "挂号费", "qty": 1, "amount": 20},
        {"name": "检查费", "qty": 2, "amount": 160},
        {"name": "药品费", "qty": 1, "amount": 86},
    ],
}
DEFAULT_DATA_CONFIG = {"schemaVersion": 1, "mode": "JSON", "queries": []}
SCOPE_TYPES = {"ALL", "ORG", "CAMPUS", "DEPARTMENT", "TERMINAL"}


def _get_template(conn, template_id: str):
    row = conn.execute(select(print_template).where(print_template.c.id == template_id)).mappings().first()
    if not row:
        raise HTTPException(404, detail={"error": "template_not_found", "templateId": template_id})
    return row


def _audit(conn, template_id: str, action: str, detail: dict[str, Any] | None = None) -> None:
    conn.execute(
        insert(print_template_audit).values(
            template_id=template_id,
            action=action,
            detail_json=json_dumps(detail or {}),
            created_at=now_iso(),
        )
    )


def _scope(body: dict[str, Any] | None):
    body = body or {}
    raw = body.get("scope") or {}
    scope_type = str(raw.get("type") or body.get("scopeType") or "ALL").upper()
    values = raw.get("values") if isinstance(raw, dict) else body.get("scopeValues")
    values = values or body.get("scopeValues") or []
    if scope_type not in SCOPE_TYPES:
        raise HTTPException(400, detail={"error": "invalid_release_scope", "scopeType": scope_type})
    if scope_type != "ALL" and not values:
        raise HTTPException(400, detail={"error": "release_scope_values_required", "scopeType": scope_type})
    return scope_type, values


@router.get("/api/templates")
def list_templates():
    with transaction() as conn:
        rows = conn.execute(select(print_template).order_by(desc(print_template.c.updated_at))).mappings().all()
        return [public_row(row) for row in rows]


@router.post("/api/templates", status_code=status.HTTP_201_CREATED)
def create_template(body: dict[str, Any] = Body(...)):
    code = require(body.get("code"), "code")
    name = require(body.get("name"), "name")
    document_type = require(body.get("documentType"), "documentType")
    now = now_iso()
    template_id = new_id("TPL")
    with transaction() as conn:
        exists = conn.execute(select(print_template.c.id).where(print_template.c.code == code)).scalar_one_or_none()
        if exists:
            raise HTTPException(400, detail={"code": "BAD_REQUEST", "detail": "模板编码已存在"})
        conn.execute(
            insert(print_template).values(
                id=template_id, code=code, name=name, document_type=str(document_type).upper(),
                status="DRAFT", draft_revision=1, published_version=None,
                design_json=json_dumps(DEFAULT_DESIGN), sample_data_json=json_dumps(DEFAULT_SAMPLE_DATA),
                data_config_json=json_dumps(DEFAULT_DATA_CONFIG), created_at=now, updated_at=now,
            )
        )
        _audit(conn, template_id, "CREATE", {"code": code})
        return public_row(_get_template(conn, template_id))


@router.get("/api/templates/{templateId}")
def get_template(templateId: str):
    with transaction() as conn:
        return public_row(_get_template(conn, templateId))


@router.get("/api/templates/{templateId}/versions")
def list_template_versions(templateId: str):
    with transaction() as conn:
        _get_template(conn, templateId)
        rows = conn.execute(
            select(print_template_version).where(print_template_version.c.template_id == templateId)
            .order_by(print_template_version.c.version_no)
        ).mappings().all()
        return [public_row(row) for row in rows]


@router.get("/api/templates/{templateId}/releases")
def list_template_releases(templateId: str):
    with transaction() as conn:
        _get_template(conn, templateId)
        rows = conn.execute(
            select(print_template_release).where(print_template_release.c.template_id == templateId)
            .order_by(desc(print_template_release.c.created_at))
        ).mappings().all()
        return [public_row(row) for row in rows]


@router.get("/api/templates/{templateId}/audit")
def list_template_audit(templateId: str):
    with transaction() as conn:
        _get_template(conn, templateId)
        rows = conn.execute(
            select(print_template_audit).where(print_template_audit.c.template_id == templateId)
            .order_by(desc(print_template_audit.c.created_at), desc(print_template_audit.c.id))
        ).mappings().all()
        return [public_row(row) for row in rows]


_VARIABLE_RE = re.compile(r"\\{\\{\\s*([A-Za-z0-9_.-]+)\\s*}}")


def _resolve_sample(root: Any, path: str) -> Any:
    current = root
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _validate_template_row(row) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    design = json_loads(row["design_json"], None)
    sample = json_loads(row["sample_data_json"], None)
    data_config = json_loads(row["data_config_json"], None)

    if not str(row["name"] or "").strip():
        errors.append("模板名称不能为空")
    if not isinstance(sample, dict):
        errors.append("sampleData 必须是对象")
        sample = {}

    if not isinstance(design, dict):
        errors.append("design 必须是对象")
        design = {}
    elements = design.get("elements")
    if not isinstance(elements, list):
        errors.append("模板缺少 elements 数组")
        elements = []

    paper = design.get("paper")
    if paper is None:
        paper = design.get("page")
    page_width = page_height = None
    if isinstance(paper, dict):
        width = paper.get("width")
        height = paper.get("height")
        if width is not None:
            if not isinstance(width, (int, float)) or width <= 0:
                errors.append("纸张宽度必须大于 0")
            else:
                page_width = float(width)
        if height is not None:
            if not isinstance(height, (int, float)) or height <= 0:
                errors.append("纸张高度必须大于 0")
            else:
                page_height = float(height)
        if page_width and page_height and (page_width > 1000 or page_height > 2000):
            warnings.append("纸张尺寸异常，请确认单位为 mm")
    else:
        warnings.append("模板未显式配置 paper/page，运行时将依赖宿主默认纸张")

    ids: set[str] = set()
    for index, element in enumerate(elements):
        if not isinstance(element, dict):
            errors.append(f"组件[{index + 1}] 必须是对象")
            continue
        element_id = str(element.get("id") or "").strip()
        element_type = str(element.get("type") or "").strip().upper()
        if not element_id:
            errors.append(f"组件[{index + 1}] 缺少 id")
        elif element_id in ids:
            errors.append(f"组件 id 重复: {element_id}")
        else:
            ids.add(element_id)
        if not element_type:
            errors.append(f"组件 {element_id or index + 1} 缺少 type")

        width = element.get("w")
        height = element.get("h")
        if width is not None and (not isinstance(width, (int, float)) or width <= 0):
            errors.append(f"组件 {element_id or index + 1} 的宽度必须大于 0")
        if height is not None and (not isinstance(height, (int, float)) or height <= 0):
            errors.append(f"组件 {element_id or index + 1} 的高度必须大于 0")
        x = element.get("x")
        y = element.get("y")
        if (
            page_width is not None
            and page_height is not None
            and all(isinstance(value, (int, float)) for value in (x, y, width, height))
            and (x < 0 or y < 0 or x + width > page_width + 0.1 or y + height > page_height + 0.1)
        ):
            warnings.append(f"组件 {element_id or index + 1} 超出纸张边界")

        binding = str(element.get("binding") or "").strip()
        if binding and _resolve_sample(sample, binding) is None:
            errors.append(f"组件 {element_id or index + 1} 绑定字段不存在: {binding}")

        text_value = str(element.get("text") or element.get("content") or "")
        for variable in _VARIABLE_RE.findall(text_value):
            if _resolve_sample(sample, variable) is None:
                errors.append(f"变量未在样例数据中定义: {variable}")

        if element_type == "TABLE":
            table = element.get("table")
            if not isinstance(table, dict):
                warnings.append(f"表格 {element_id or index + 1} 使用默认列配置")
            else:
                columns = table.get("columns")
                if isinstance(columns, list) and not columns:
                    errors.append(f"表格 {element_id or index + 1} 至少需要一列")
                page_rows = table.get("pageRows")
                if page_rows is not None and (not isinstance(page_rows, int) or page_rows < 0):
                    errors.append(f"表格 {element_id or index + 1} 的每页行数不能小于 0")

    if not elements:
        warnings.append("模板没有任何组件")

    if not isinstance(data_config, dict):
        errors.append("dataConfig 必须是对象")
        data_config = {}
    schema_version = data_config.get("schemaVersion", 1)
    if schema_version != 1:
        errors.append("dataConfig.schemaVersion 当前只支持 1")
    mode = str(data_config.get("mode") or "JSON").upper()
    if mode not in {"JSON", "SQL"}:
        errors.append("dataConfig.mode 仅支持 JSON 或 SQL")
    queries = data_config.get("queries", [])
    if not isinstance(queries, list):
        errors.append("dataConfig.queries 必须是数组")
        queries = []

    query_ids: set[str] = set()
    result_keys: set[str] = set()
    enabled_count = 0
    for index, query in enumerate(queries):
        if not isinstance(query, dict):
            errors.append(f"查询[{index + 1}] 必须是对象")
            continue
        enabled = bool(query.get("enabled"))
        if enabled:
            enabled_count += 1
        if mode == "JSON" and enabled:
            errors.append("JSON 模式不能包含启用的 SQL 查询")

        query_id = str(query.get("queryId") or "").strip()
        if not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", query_id):
            errors.append(f"查询[{index + 1}] queryId 格式非法")
        elif query_id in query_ids:
            errors.append(f"queryId 重复: {query_id}")
        else:
            query_ids.add(query_id)

        result_key = str(query.get("resultKey") or "").strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", result_key) or result_key in {
            "__proto__",
            "prototype",
            "constructor",
        }:
            errors.append(f"查询 {query_id or index + 1} resultKey 非法")
        elif result_key in result_keys:
            errors.append(f"resultKey 重复: {result_key}")
        else:
            result_keys.add(result_key)

        result_type = str(query.get("resultType") or "").upper()
        if result_type not in {"OBJECT", "ARRAY", "SCALAR"}:
            errors.append(f"查询 {query_id or index + 1} resultType 非法: {result_type}")

        sql = str(query.get("sql") or "").strip()
        sql_head = sql[:-1].strip() if sql.endswith(";") else sql
        if not sql_head or sql_head.lstrip().split(None, 1)[0].upper() not in {"SELECT", "WITH"} or ";" in sql_head:
            errors.append(f"查询 {query_id or index + 1} 只允许单条 SELECT/WITH 只读 SQL")

        if not str(query.get("connectionId") or "").strip():
            errors.append(f"查询 {query_id or index + 1} 缺少 connectionId")
        params = query.get("params", [])
        if not isinstance(params, list):
            errors.append(f"查询 {query_id or index + 1} params 必须是数组")

    if mode == "SQL" and enabled_count == 0:
        errors.append("SQL 模式至少需要一条启用的查询")

    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "templateId": row["id"],
        "draftRevision": row["draft_revision"],
    }


@router.get("/api/templates/{templateId}/validate")
def validate_template(templateId: str):
    with transaction() as conn:
        return _validate_template_row(_get_template(conn, templateId))


@router.put("/api/templates/{templateId}/draft")
def save_template_draft(templateId: str, body: dict[str, Any] = Body(...)):
    if body.get("design") is None:
        raise HTTPException(400, detail={"error": "validation_error", "field": "design"})
    if body.get("sampleData") is None:
        raise HTTPException(400, detail={"error": "validation_error", "field": "sampleData"})
    now = now_iso()
    with transaction() as conn:
        old = _get_template(conn, templateId)
        conn.execute(
            update(print_template).where(print_template.c.id == templateId).values(
                name=(body.get("name") or old["name"]).strip(),
                status="DISABLED" if old["status"] == "DISABLED" else "DRAFT",
                draft_revision=int(old["draft_revision"]) + 1,
                design_json=json_dumps(body["design"]),
                sample_data_json=json_dumps(body["sampleData"]),
                data_config_json=json_dumps(body.get("dataConfig", json_loads(old["data_config_json"], DEFAULT_DATA_CONFIG))),
                updated_at=now,
            )
        )
        _audit(conn, templateId, "SAVE_DRAFT", {"draftRevision": int(old["draft_revision"]) + 1})
        return public_row(_get_template(conn, templateId))


def _set_status(conn, template_id: str, expected: set[str], target: str, action: str):
    old = _get_template(conn, template_id)
    if old["status"] not in expected:
        raise HTTPException(409, detail={"error": "template_state_conflict", "from": old["status"], "to": target})
    conn.execute(update(print_template).where(print_template.c.id == template_id).values(status=target, updated_at=now_iso()))
    _audit(conn, template_id, action, {"from": old["status"], "to": target})
    return public_row(_get_template(conn, template_id))


@router.post("/api/templates/{templateId}/testing")
def mark_template_testing(templateId: str):
    with transaction() as conn:
        return _set_status(conn, templateId, {"DRAFT"}, "TESTING", "MARK_TESTING")


@router.post("/api/templates/{templateId}/submit-review")
def submit_template_review(templateId: str):
    with transaction() as conn:
        row = _get_template(conn, templateId)
        result = _validate_template_row(row)
        if not result["valid"]:
            raise HTTPException(
                400,
                detail={
                    "code": "TEMPLATE_VALIDATION_FAILED",
                    "detail": "模板静态校验失败: " + "；".join(result["errors"]),
                    "errors": result["errors"],
                    "warnings": result["warnings"],
                },
            )
        return _set_status(conn, templateId, {"TESTING"}, "REVIEWING", "SUBMIT_REVIEW")


@router.post("/api/templates/{templateId}/publish")
def publish_template(templateId: str, body: dict[str, Any] | None = Body(None)):
    now = now_iso()
    with transaction() as conn:
        old = _get_template(conn, templateId)
        if old["status"] != "REVIEWING":
            raise HTTPException(409, detail={"error": "template_state_conflict", "from": old["status"], "to": "PUBLISHED"})
        validation = _validate_template_row(old)
        if not validation["valid"]:
            raise HTTPException(
                400,
                detail={
                    "code": "TEMPLATE_VALIDATION_FAILED",
                    "detail": "模板静态校验失败: " + "；".join(validation["errors"]),
                    "errors": validation["errors"],
                    "warnings": validation["warnings"],
                },
            )
        scope_type, scope_values = _scope(body)
        next_version = 1 if old["published_version"] is None else int(old["published_version"]) + 1
        conn.execute(insert(print_template_version).values(
            id=new_id("TV"), template_id=templateId, version_no=next_version,
            design_json=old["design_json"], sample_data_json=old["sample_data_json"],
            data_config_json=old["data_config_json"], change_note=(body or {}).get("changeNote"), created_at=now,
        ))
        conn.execute(insert(print_template_release).values(
            id=new_id("REL"), template_id=templateId, version_no=next_version,
            scope_type=scope_type, scope_values_json=json_dumps(scope_values),
            rollback_from_version=None, active=1, created_at=now,
        ))
        conn.execute(update(print_template).where(print_template.c.id == templateId).values(
            status="PUBLISHED", published_version=next_version, updated_at=now
        ))
        _audit(conn, templateId, "PUBLISH", {"versionNo": next_version, "scopeType": scope_type})
        return public_row(_get_template(conn, templateId))


@router.post("/api/templates/{templateId}/rollback")
def rollback_template(templateId: str, body: dict[str, Any] = Body(...)):
    target_version = int(require(body.get("versionNo"), "versionNo"))
    now = now_iso()
    with transaction() as conn:
        current = _get_template(conn, templateId)
        if current["status"] != "PUBLISHED":
            raise HTTPException(409, detail={"error": "template_state_conflict", "from": current["status"], "to": "PUBLISHED"})
        target = conn.execute(
            select(print_template_version).where(and_(
                print_template_version.c.template_id == templateId,
                print_template_version.c.version_no == target_version,
            ))
        ).mappings().first()
        if not target:
            raise HTTPException(404, detail={"error": "template_version_not_found", "versionNo": target_version})
        scope_type, scope_values = _scope(body)
        next_version = int(current["published_version"] or 0) + 1
        conn.execute(insert(print_template_version).values(
            id=new_id("TV"), template_id=templateId, version_no=next_version,
            design_json=target["design_json"], sample_data_json=target["sample_data_json"],
            data_config_json=target["data_config_json"], change_note=body.get("changeNote") or f"rollback to v{target_version}",
            created_at=now,
        ))
        conn.execute(insert(print_template_release).values(
            id=new_id("REL"), template_id=templateId, version_no=next_version, scope_type=scope_type,
            scope_values_json=json_dumps(scope_values), rollback_from_version=target_version, active=1, created_at=now,
        ))
        conn.execute(update(print_template).where(print_template.c.id == templateId).values(
            status="PUBLISHED", draft_revision=int(current["draft_revision"]) + 1,
            published_version=next_version, design_json=target["design_json"],
            sample_data_json=target["sample_data_json"], data_config_json=target["data_config_json"], updated_at=now,
        ))
        _audit(conn, templateId, "ROLLBACK", {
            "fromVersion": current["published_version"], "targetVersion": target_version,
            "newVersion": next_version, "scopeType": scope_type,
        })
        return public_row(_get_template(conn, templateId))


@router.post("/api/templates/{templateId}/disable")
def disable_template(templateId: str):
    with transaction() as conn:
        old = _get_template(conn, templateId)
        if old["status"] == "DISABLED":
            raise HTTPException(409, detail={"error": "template_already_disabled"})
        conn.execute(update(print_template).where(print_template.c.id == templateId).values(status="DISABLED", updated_at=now_iso()))
        conn.execute(
            update(print_template_release)
            .where(print_template_release.c.template_id == templateId)
            .values(active=0)
        )
        _audit(conn, templateId, "DISABLE", {})
        return public_row(_get_template(conn, templateId))


@router.post("/api/templates/{templateId}/clone")
def clone_template(templateId: str):
    now = now_iso()
    with transaction() as conn:
        source = _get_template(conn, templateId)
        install = conn.execute(
            select(template_installation).where(template_installation.c.local_template_id == templateId)
        ).mappings().first()
        if install and not bool(install["clone_allowed"]):
            raise HTTPException(403, detail={"error": "cloud_template_clone_not_allowed"})
        new_template_id = new_id("TPL")
        code = f"{source['code']}-COPY-{new_template_id[-6:].upper()}"
        conn.execute(insert(print_template).values(
            id=new_template_id, code=code, name=f"{source['name']} 副本",
            document_type=source["document_type"], status="DRAFT", draft_revision=1, published_version=None,
            design_json=source["design_json"], sample_data_json=source["sample_data_json"],
            data_config_json=source["data_config_json"], created_at=now, updated_at=now,
        ))
        _audit(conn, new_template_id, "CLONE", {"sourceTemplateId": templateId})
        return public_row(_get_template(conn, new_template_id))


@router.post("/api/templates/{templateId}/ai-layout")
def ai_layout(templateId: str, body: dict[str, Any] = Body(...)):
    now = now_iso()
    with transaction() as conn:
        _get_template(conn, templateId)
        task_id = new_id("AI")
        if not settings.ai_layout_endpoint:
            conn.execute(insert(template_ai_task).values(
                id=task_id, template_id=templateId, provider=settings.ai_provider, model=settings.ai_model,
                status="FAILED", request_json=json_dumps(body), result_json=None,
                error_message="PRINT_AI_LAYOUT_ENDPOINT is not configured", created_at=now, updated_at=now,
            ))
            raise HTTPException(503, detail={"error": "ai_layout_not_configured", "taskId": task_id})
        conn.execute(insert(template_ai_task).values(
            id=task_id, template_id=templateId, provider=settings.ai_provider, model=settings.ai_model,
            status="PENDING", request_json=json_dumps(body), result_json=None, error_message=None,
            created_at=now, updated_at=now,
        ))
        return {
            "taskId": task_id,
            "status": "PENDING",
            "provider": settings.ai_provider,
            "model": settings.ai_model,
            "candidates": [],
            "message": "AI layout task accepted by the configured external adapter workflow.",
        }


@router.get("/api/templates/{templateId}/ai-layout/tasks")
def list_ai_layout_tasks(templateId: str):
    with transaction() as conn:
        _get_template(conn, templateId)
        rows = conn.execute(
            select(template_ai_task).where(template_ai_task.c.template_id == templateId)
            .order_by(desc(template_ai_task.c.created_at))
        ).mappings().all()
        return [public_row(row) for row in rows]


def _test_target(conn, template_id: str, body: dict[str, Any]):
    template = _get_template(conn, template_id)
    requested_version = body.get("versionNo")
    if requested_version is None:
        requested_version = body.get("templateVersion")
    if requested_version is None:
        return (
            template,
            template,
            {"kind": "DRAFT", "draftRevision": template["draft_revision"], "versionNo": None},
        )
    try:
        version_no = int(requested_version)
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, detail={"code": "TEMPLATE_VERSION_INVALID", "detail": "versionNo 必须是正整数"}) from exc
    if version_no < 1:
        raise HTTPException(400, detail={"code": "TEMPLATE_VERSION_INVALID", "detail": "versionNo 必须是正整数"})
    version = conn.execute(
        select(print_template_version).where(
            and_(
                print_template_version.c.template_id == template_id,
                print_template_version.c.version_no == version_no,
            )
        )
    ).mappings().first()
    if not version:
        raise HTTPException(
            404,
            detail={"code": "TEMPLATE_VERSION_NOT_FOUND", "detail": f"模板版本不存在: {template_id} v{version_no}"},
        )
    return template, version, {"kind": "VERSION", "draftRevision": None, "versionNo": version_no}


def _query_summary(query: dict[str, Any], *, status_value: str, elapsed_ms: int = 0, row_count: int | None = None,
                   error_code: str | None = None, error_message: str | None = None) -> dict[str, Any]:
    return {
        "queryId": str(query.get("queryId") or ""),
        "name": query.get("name"),
        "resultKey": query.get("resultKey"),
        "resultType": query.get("resultType"),
        "status": status_value,
        "rowCount": row_count,
        "elapsedMs": elapsed_ms,
        "errorCode": error_code,
        "errorMessage": error_message,
    }


def _error_from_http(exc: HTTPException) -> tuple[str, str]:
    if isinstance(exc.detail, dict):
        code = str(exc.detail.get("code") or exc.detail.get("error") or "QUERY_EXECUTION_FAILED").upper()
        message = str(exc.detail.get("detail") or exc.detail.get("message") or "查询执行失败")
        return code, message
    return "QUERY_EXECUTION_FAILED", str(exc.detail)


def _insert_test_run(
    conn,
    *,
    run_id: str,
    template_id: str,
    source,
    target: dict[str, Any],
    data_mode: str,
    test_type: str,
    status_value: str,
    render_status: str,
    print_channel: str,
    print_status: str,
    printer_id: str | None,
    params: dict[str, Any],
    input_data: Any,
    render_data: dict[str, Any],
    elapsed_ms: int,
    error_code: str | None = None,
    message: str | None = None,
) -> None:
    now = now_iso()
    conn.execute(
        insert(template_test_run).values(
            id=run_id,
            template_id=template_id,
            template_version=target["versionNo"],
            draft_revision=target["draftRevision"],
            data_mode=data_mode,
            test_type=test_type,
            status=status_value,
            render_status=render_status,
            print_channel=print_channel,
            print_status=print_status,
            printer_id=printer_id,
            page_count=None,
            agent_job_id=None,
            error_code=error_code,
            message=message,
            payload_persisted=1,
            input_params_json=json_dumps(params),
            input_data_json=json_dumps(input_data) if input_data is not None else None,
            render_data_json=json_dumps(render_data),
            started_at=now,
            finished_at=now,
            elapsed_ms=elapsed_ms,
        )
    )


def _insert_query_summary(conn, run_id: str, query: dict[str, Any], summary: dict[str, Any], result: Any = None) -> None:
    conn.execute(
        insert(template_test_query).values(
            test_run_id=run_id,
            query_id=summary["queryId"],
            name=summary.get("name"),
            result_key=summary.get("resultKey"),
            result_type=summary.get("resultType"),
            order_no=int(query.get("order") or 0),
            status=summary["status"],
            row_count=summary.get("rowCount"),
            elapsed_ms=summary.get("elapsedMs"),
            error_code=summary.get("errorCode"),
            error_message=summary.get("errorMessage"),
            result_json=json_dumps(result) if result is not None else None,
        )
    )


def _template_snapshot(template, source) -> dict[str, Any]:
    return {
        "templateId": template["id"],
        "code": template["code"],
        "name": template["name"],
        "documentType": template["document_type"],
        "design": json_loads(source["design_json"], {}),
    }


def _prepare_template_test(conn, template_id: str, body: dict[str, Any], test_type: str) -> dict[str, Any]:
    template, source, target = _test_target(conn, template_id, body)
    config = json_loads(source["data_config_json"], DEFAULT_DATA_CONFIG)
    data_mode = str(config.get("mode") or "JSON").upper()
    params = body.get("params") if isinstance(body.get("params"), dict) else {}
    input_data = body.get("inputData") if "inputData" in body else body.get("data")
    printer_id = body.get("printerId")
    if test_type == "PLUGIN_PRINT" and not printer_id:
        raise HTTPException(400, detail={"code": "PRINTER_REQUIRED", "detail": "插件打印测试必须指定 printerId"})

    print_channel = {
        "SIMULATED_PRINT": "SIMULATED",
        "PLUGIN_PRINT": "BROWSER_EXTENSION_AGENT",
    }.get(test_type, "NONE")
    print_status = "PENDING" if test_type in {"SIMULATED_PRINT", "PLUGIN_PRINT"} else "NOT_REQUESTED"
    run_id = new_id("TTR")
    started = time.perf_counter()
    status_value = "SUCCESS"
    error_code = None
    error_message = None
    query_summaries: list[dict[str, Any]] = []

    if data_mode == "JSON":
        render_data, query_summaries = resolve_production_data_with_summaries(
            conn,
            source,
            params,
            input_data,
            allow_sample_json=True,
        )
    elif data_mode == "SQL":
        try:
            render_data, query_summaries = resolve_production_data_with_summaries(
                conn,
                source,
                params,
                input_data,
                allow_sample_json=True,
            )
        except HTTPException as exc:
            status_value = "FAILED"
            error_code, error_message = _error_from_http(exc)
            render_data = {}
    else:
        raise HTTPException(400, detail={"code": "DATA_MODE_INVALID", "detail": f"不支持的数据模式: {data_mode}"})

    elapsed_ms = max(0, int((time.perf_counter() - started) * 1000))
    _insert_test_run(
        conn,
        run_id=run_id,
        template_id=template_id,
        source=source,
        target=target,
        data_mode=data_mode,
        test_type=test_type,
        status_value=status_value,
        render_status="NOT_STARTED",
        print_channel=print_channel,
        print_status=print_status,
        printer_id=printer_id,
        params=params,
        input_data=input_data,
        render_data=render_data,
        elapsed_ms=elapsed_ms,
        error_code=error_code,
        message=error_message,
    )
    for index, summary in enumerate(query_summaries):
        query = next(
            (item for item in config.get("queries", []) if str(item.get("queryId") or "") == summary["queryId"]),
            {"order": index},
        )
        _insert_query_summary(conn, run_id, query, summary)

    return {
        "testRunId": run_id,
        "status": status_value,
        "dataMode": data_mode,
        "target": target,
        "templateSnapshot": _template_snapshot(template, source),
        "renderData": render_data,
        "queries": query_summaries,
        "renderStatus": "NOT_STARTED",
        "elapsedMs": elapsed_ms,
        "error": (
            {"code": error_code, "message": error_message}
            if error_code is not None
            else None
        ),
    }


@router.post("/api/templates/{templateId}/queries/{queryId}/test")
def test_template_query(templateId: str, queryId: str, body: dict[str, Any] = Body(default={})):
    with transaction() as conn:
        template, source, target = _test_target(conn, templateId, body)
        config = json_loads(source["data_config_json"], DEFAULT_DATA_CONFIG)
        if str(config.get("mode") or "JSON").upper() != "SQL":
            raise HTTPException(400, detail={"code": "DATA_MODE_NOT_SUPPORTED", "detail": "单查询测试仅支持 SQL 模式"})
        query = next(
            (q for q in config.get("queries", []) if str(q.get("queryId") or "") == queryId),
            None,
        )
        if not query:
            raise HTTPException(404, detail={"code": "QUERY_NOT_FOUND", "detail": f"查询不存在: {queryId}"})
        if not bool(query.get("enabled")):
            raise HTTPException(400, detail={"code": "QUERY_DISABLED", "detail": f"查询未启用: {queryId}"})

        params = body.get("params") if isinstance(body.get("params"), dict) else {}
        run_id = new_id("TTR")
        started = time.perf_counter()
        result = None
        try:
            result, summary = execute_single_query(conn, query, params)
            status_value = "SUCCESS"
            error = None
        except HTTPException as exc:
            code, message = _error_from_http(exc)
            elapsed_ms = max(0, int((time.perf_counter() - started) * 1000))
            summary = _query_summary(
                query,
                status_value="FAILED",
                elapsed_ms=elapsed_ms,
                error_code=code,
                error_message=message,
            )
            status_value = "FAILED"
            error = {"code": code, "message": message}

        elapsed_ms = max(0, int((time.perf_counter() - started) * 1000))
        _insert_test_run(
            conn,
            run_id=run_id,
            template_id=templateId,
            source=source,
            target=target,
            data_mode="SQL",
            test_type="QUERY",
            status_value=status_value,
            render_status="NOT_STARTED",
            print_channel="NONE",
            print_status="NOT_REQUESTED",
            printer_id=None,
            params=params,
            input_data=None,
            render_data={},
            elapsed_ms=elapsed_ms,
            error_code=error["code"] if error else None,
            message=error["message"] if error else None,
        )
        _insert_query_summary(conn, run_id, query, summary, result)
        return {
            "testRunId": run_id,
            "status": status_value,
            "target": target,
            "query": summary,
            "result": result,
            "error": error,
        }


@router.post("/api/templates/{templateId}/test-data")
def preview_template_test_data(templateId: str, body: dict[str, Any] = Body(default={})):
    with transaction() as conn:
        return _prepare_template_test(conn, templateId, body, "PREVIEW")


@router.post("/api/templates/{templateId}/tests/simulated-print")
def simulated_template_print(templateId: str, body: dict[str, Any] = Body(default={})):
    with transaction() as conn:
        return _prepare_template_test(conn, templateId, body, "SIMULATED_PRINT")


@router.post("/api/templates/{templateId}/tests/plugin-print")
def plugin_template_print(templateId: str, body: dict[str, Any] = Body(default={})):
    with transaction() as conn:
        return _prepare_template_test(conn, templateId, body, "PLUGIN_PRINT")


def _get_test_run(conn, run_id: str):
    row = conn.execute(select(template_test_run).where(template_test_run.c.id == run_id)).mappings().first()
    if not row:
        raise HTTPException(404, detail={"error": "template_test_run_not_found", "testRunId": run_id})
    return row


def _test_run_detail(conn, run_id: str) -> dict[str, Any]:
    detail = public_row(_get_test_run(conn, run_id))
    query_rows = conn.execute(
        select(template_test_query)
        .where(template_test_query.c.test_run_id == run_id)
        .order_by(template_test_query.c.order_no, template_test_query.c.id)
    ).mappings().all()
    detail["queries"] = [
        {
            "queryId": row["query_id"],
            "name": row["name"],
            "resultKey": row["result_key"],
            "resultType": row["result_type"],
            "status": row["status"],
            "rowCount": row["row_count"],
            "elapsedMs": row["elapsed_ms"],
            "errorCode": row["error_code"],
            "errorMessage": row["error_message"],
        }
        for row in query_rows
    ]
    return detail


@router.get("/api/templates/{templateId}/test-runs")
def list_template_test_runs(
    templateId: str,
    status_value: str | None = Query(None, alias="status"),
    testType: str | None = None,
    dataMode: str | None = None,
    from_: str | None = Query(None, alias="from"),
    to: str | None = None,
    limit: int = Query(100, ge=1, le=500),
):
    with transaction() as conn:
        _get_template(conn, templateId)
        stmt = select(template_test_run).where(template_test_run.c.template_id == templateId)
        if status_value:
            stmt = stmt.where(template_test_run.c.status == status_value.upper())
        if testType:
            stmt = stmt.where(template_test_run.c.test_type == testType.upper())
        if dataMode:
            stmt = stmt.where(template_test_run.c.data_mode == dataMode.upper())
        if from_:
            stmt = stmt.where(template_test_run.c.started_at >= from_)
        if to:
            stmt = stmt.where(template_test_run.c.started_at <= to)
        rows = conn.execute(
            stmt.order_by(desc(template_test_run.c.started_at)).limit(limit)
        ).mappings().all()
        return [public_row(row) for row in rows]


@router.get("/api/template-test-runs/{testRunId}")
def get_template_test_run(testRunId: str):
    with transaction() as conn:
        return _test_run_detail(conn, testRunId)


@router.post("/api/template-test-runs/{testRunId}/render-result")
def save_template_render_result(testRunId: str, body: dict[str, Any] = Body(...)):
    with transaction() as conn:
        _get_test_run(conn, testRunId)
        success = bool(body.get("success"))
        conn.execute(
            update(template_test_run)
            .where(template_test_run.c.id == testRunId)
            .values(
                render_status="SUCCESS" if success else "FAILED",
                page_count=body.get("pageCount"),
                message=body.get("message"),
                elapsed_ms=body.get("elapsedMs"),
                finished_at=now_iso(),
            )
        )
        return _test_run_detail(conn, testRunId)


@router.post("/api/template-test-runs/{testRunId}/print-result")
def save_template_print_result(testRunId: str, body: dict[str, Any] = Body(...)):
    channel = str(require(body.get("channel"), "channel")).upper()
    if channel not in {"SIMULATED", "BROWSER_EXTENSION_AGENT"}:
        raise HTTPException(400, detail={"code": "PRINT_CHANNEL_INVALID", "detail": f"不支持的打印测试通道: {channel}"})
    with transaction() as conn:
        _get_test_run(conn, testRunId)
        success = bool(body.get("success"))
        conn.execute(
            update(template_test_run)
            .where(template_test_run.c.id == testRunId)
            .values(
                print_channel=channel,
                print_status="SUCCESS" if success else "FAILED",
                printer_id=body.get("printerId"),
                agent_job_id=body.get("agentJobId"),
                message=body.get("message"),
                elapsed_ms=body.get("elapsedMs"),
                finished_at=now_iso(),
            )
        )
        return _test_run_detail(conn, testRunId)
