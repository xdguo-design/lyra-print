import base64
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import insert, select

from app.db import transaction
from app.main import app, settings
from app.models import system_log


def _code(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _publish_json_template(client: TestClient, code: str):
    created = client.post(
        "/api/templates",
        json={"code": code, "name": "Review template", "documentType": "FORM"},
    )
    assert created.status_code == 201, created.text
    template = created.json()
    saved = client.put(
        f"/api/templates/{template['id']}/draft",
        json={
            "name": "Review template",
            "design": {"schemaVersion": 1, "elements": []},
            "sampleData": {"title": "sample"},
            "dataConfig": {"schemaVersion": 1, "mode": "JSON", "queries": []},
        },
    )
    assert saved.status_code == 200, saved.text
    assert client.post(f"/api/templates/{template['id']}/testing").status_code == 200
    assert client.post(f"/api/templates/{template['id']}/submit-review").status_code == 200
    published = client.post(f"/api/templates/{template['id']}/publish", json={"changeNote": "review"})
    assert published.status_code == 200, published.text
    return published.json()


@pytest.fixture
def secured_settings():
    names = (
        "security_enabled",
        "security_admin_key",
        "security_designer_key",
        "security_operator_key",
        "security_viewer_key",
    )
    original = {name: getattr(settings, name) for name in names}
    settings.security_enabled = True
    settings.security_admin_key = "admin-secret"
    settings.security_designer_key = "designer-secret"
    settings.security_operator_key = "operator-secret"
    settings.security_viewer_key = "viewer-secret"
    try:
        yield
    finally:
        for name, value in original.items():
            setattr(settings, name, value)


def test_rbac_and_contract_api_key_header(secured_settings):
    with TestClient(app) as client:
        capabilities = client.get("/api/runtime/capabilities")
        assert capabilities.status_code == 200
        assert capabilities.json()["authenticationEnabled"] is True

        preflight = client.options(
            "/api/templates",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )
        assert preflight.status_code == 200

        assert client.get("/api/templates").status_code == 401

        viewer_headers = {"X-Print-Api-Key": "viewer-secret"}
        assert client.get("/api/templates", headers=viewer_headers).status_code == 200
        denied = client.post(
            "/api/templates",
            headers=viewer_headers,
            json={"code": _code("viewer"), "name": "blocked", "documentType": "FORM"},
        )
        assert denied.status_code == 403
        assert denied.json()["code"] == "PERMISSION_DENIED"

        designer_headers = {"Authorization": "Bearer designer-secret"}
        allowed = client.post(
            "/api/templates",
            headers=designer_headers,
            json={"code": _code("designer"), "name": "allowed", "documentType": "FORM"},
        )
        assert allowed.status_code == 201, allowed.text
        operator_denied = client.post(
            "/api/templates",
            headers={"X-Print-Api-Key": "operator-secret"},
            json={"code": _code("operator"), "name": "blocked", "documentType": "FORM"},
        )
        assert operator_denied.status_code == 403

        admin = client.put(
            "/api/printers/review-printer",
            headers={"X-Print-Api-Key": "admin-secret"},
            json={"displayName": "Review printer", "enabled": True},
        )
        assert admin.status_code == 200, admin.text

        legacy = client.get("/api/auth/session", headers={"X-API-Key": "viewer-secret"})
        assert legacy.status_code == 200
        assert legacy.json()["role"] == "VIEWER"


def test_formal_print_requires_published_version_and_runtime_input():
    with TestClient(app) as client:
        draft_code = _code("draft")
        draft = client.post(
            "/api/templates",
            json={"code": draft_code, "name": "draft", "documentType": "FORM"},
        )
        assert draft.status_code == 201

        unpublished = client.post(
            "/api/print-tasks",
            json={"templateCode": draft_code, "businessKey": "B-1", "printerId": None, "copies": 1, "inputData": {}},
        )
        assert unpublished.status_code == 400
        assert unpublished.json()["code"] == "TEMPLATE_NOT_PUBLISHED"

        code = _code("published")
        template = _publish_json_template(client, code)

        missing_input = client.post(
            "/api/print-tasks",
            json={"templateCode": code, "businessKey": "B-2", "printerId": None, "copies": 1},
        )
        assert missing_input.status_code == 400
        assert missing_input.json()["code"] == "INPUT_DATA_REQUIRED"

        created = client.post(
            "/api/print-tasks",
            json={
                "templateCode": code,
                "businessKey": "B-3",
                "printerId": None,
                "copies": 1,
                "inputData": {"patientName": "张三"},
            },
        )
        assert created.status_code == 201, created.text
        assert created.json()["templateVersion"] == template["publishedVersion"]

        disabled = client.post(f"/api/templates/{template['id']}/disable")
        assert disabled.status_code == 200
        blocked = client.post(
            "/api/print-tasks",
            json={
                "templateCode": code,
                "businessKey": "B-4",
                "printerId": None,
                "copies": 1,
                "inputData": {"patientName": "李四"},
            },
        )
        assert blocked.status_code == 400
        assert blocked.json()["code"] == "TEMPLATE_DISABLED"


def test_pdf_and_raw_payload_contract_is_enforced():
    with TestClient(app) as client:
        invalid_pdf = client.post(
            "/api/print-tasks/pdf",
            json={
                "title": "bad",
                "businessKey": "PDF-BAD",
                "printerId": "pdf-printer",
                "copies": 1,
                "pdfBase64": base64.b64encode(b"not-a-pdf").decode(),
            },
        )
        assert invalid_pdf.status_code == 400
        assert invalid_pdf.json()["code"] == "PDF_INVALID"

        pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"
        pdf_task = client.post(
            "/api/print-tasks/pdf",
            json={
                "title": "Review PDF",
                "businessKey": "PDF-OK",
                "printerId": "pdf-printer",
                "copies": 2,
                "pdfBase64": base64.b64encode(pdf_bytes).decode(),
            },
        )
        assert pdf_task.status_code == 201, pdf_task.text
        pdf_doc = client.get(f"/api/print-tasks/{pdf_task.json()['id']}/document").json()
        assert pdf_doc["templateName"] == "Review PDF"
        assert pdf_doc["documentType"] == "PDF"

        raw_copies = client.post(
            "/api/print-tasks/raw",
            json={
                "title": "Raw",
                "businessKey": "RAW-BAD-COPIES",
                "printerId": "raw-printer",
                "copies": 2,
                "rawLanguage": "ZPL",
                "rawBase64": base64.b64encode(b"^XA^XZ").decode(),
            },
        )
        assert raw_copies.status_code == 400

        raw_language = client.post(
            "/api/print-tasks/raw",
            json={
                "title": "Raw",
                "businessKey": "RAW-BAD-LANG",
                "printerId": "raw-printer",
                "copies": 1,
                "rawLanguage": "POSTSCRIPT",
                "rawBase64": base64.b64encode(b"payload").decode(),
            },
        )
        assert raw_language.status_code == 400
        assert raw_language.json()["code"] == "RAW_LANGUAGE_INVALID"

        raw_task = client.post(
            "/api/print-tasks/raw",
            json={
                "title": "Raw",
                "businessKey": "RAW-OK",
                "printerId": "raw-printer",
                "copies": 1,
                "rawLanguage": "ZPL",
                "rawBase64": base64.b64encode(b"^XA^FO10,10^FDOK^FS^XZ").decode(),
            },
        )
        assert raw_task.status_code == 201, raw_task.text
        raw_doc = client.get(f"/api/print-tasks/{raw_task.json()['id']}/document").json()
        assert raw_doc["documentType"] == "RAW"
        assert raw_doc["rawLanguage"] == "ZPL"
        assert raw_doc["byteLength"] > 0
        assert len(raw_doc["sha256"]) == 64


def test_sqlite_sql_mode_executes_read_only_published_query(tmp_path):
    business_db = tmp_path / "business.db"
    db = sqlite3.connect(business_db)
    try:
        db.execute("CREATE TABLE patient(no TEXT PRIMARY KEY, name TEXT, total_amount REAL)")
        db.execute("INSERT INTO patient VALUES('P001', '张三', 266.0)")
        db.commit()
    finally:
        db.close()

    with TestClient(app) as client:
        source = client.post(
            "/api/data-sources/connections",
            json={
                "name": "Review SQLite",
                "dbType": "SQLITE",
                "jdbcUrl": f"jdbc:sqlite:{business_db}",
                "readOnly": True,
                "enabled": True,
            },
        )
        assert source.status_code == 201, source.text
        source_id = source.json()["id"]

        tested = client.post(
            "/api/data-sources/connections/test",
            json={"dbType": "SQLITE", "jdbcUrl": f"jdbc:sqlite:{business_db}"},
        )
        assert tested.status_code == 200
        assert tested.json()["success"] is True
        assert tested.json()["databaseProduct"] == "SQLite"
        assert isinstance(tested.json()["elapsedMs"], int)

        code = _code("sql")
        created = client.post(
            "/api/templates",
            json={"code": code, "name": "SQL template", "documentType": "FORM"},
        ).json()
        config = {
            "schemaVersion": 1,
            "mode": "SQL",
            "queries": [
                {
                    "queryId": "patient-header",
                    "name": "patient",
                    "connectionId": source_id,
                    "sql": "SELECT name AS patientName, total_amount AS totalAmount FROM patient WHERE no=:patientNo",
                    "params": [{"name": "patientNo", "type": "STRING", "required": True}],
                    "resultKey": "patient",
                    "resultType": "OBJECT",
                    "order": 10,
                    "enabled": True,
                    "maxRows": 2,
                }
            ],
        }
        saved = client.put(
            f"/api/templates/{created['id']}/draft",
            json={
                "name": "SQL template",
                "design": {"schemaVersion": 1, "elements": []},
                "sampleData": {"title": "SQL sample"},
                "dataConfig": config,
            },
        )
        assert saved.status_code == 200, saved.text

        single = client.post(
            f"/api/templates/{created['id']}/queries/patient-header/test",
            json={"params": {"patientNo": "P001"}},
        )
        assert single.status_code == 200, single.text
        assert single.json()["status"] == "SUCCESS"
        assert single.json()["query"]["queryId"] == "patient-header"
        assert single.json()["result"]["patientName"] == "张三"

        preview = client.post(
            f"/api/templates/{created['id']}/test-data",
            json={"params": {"patientNo": "P001"}},
        )
        assert preview.status_code == 200, preview.text
        preview_body = preview.json()
        assert preview_body["dataMode"] == "SQL"
        assert preview_body["target"]["kind"] == "DRAFT"
        assert preview_body["templateSnapshot"]["templateId"] == created["id"]
        assert preview_body["renderData"]["patient"]["patientName"] == "张三"
        assert preview_body["queries"][0]["status"] == "SUCCESS"
        assert preview_body["renderStatus"] == "NOT_STARTED"
        assert isinstance(preview_body["elapsedMs"], int)

        assert client.post(f"/api/templates/{created['id']}/testing").status_code == 200
        assert client.post(f"/api/templates/{created['id']}/submit-review").status_code == 200
        assert client.post(f"/api/templates/{created['id']}/publish", json={}).status_code == 200

        task = client.post(
            "/api/print-tasks",
            json={
                "templateCode": code,
                "businessKey": "SQL-001",
                "printerId": None,
                "copies": 1,
                "params": {"patientNo": "P001"},
            },
        )
        assert task.status_code == 201, task.text
        document = client.get(f"/api/print-tasks/{task.json()['id']}/document").json()
        assert document["renderData"]["patient"]["patientName"] == "张三"
        assert document["renderData"]["patient"]["totalAmount"] == 266.0


def test_queue_requires_printer_and_spooler_binding_uses_contract_fields():
    with TestClient(app) as client:
        code = _code("queue")
        _publish_json_template(client, code)
        task = client.post(
            "/api/print-tasks",
            json={
                "templateCode": code,
                "businessKey": "QUEUE-001",
                "printerId": None,
                "copies": 1,
                "inputData": {"x": 1},
            },
        ).json()
        assert client.post(f"/api/print-tasks/{task['id']}/queue").status_code == 400

        task2 = client.post(
            "/api/print-tasks",
            json={
                "templateCode": code,
                "businessKey": "QUEUE-002",
                "printerId": "printer-1",
                "copies": 1,
                "inputData": {"x": 1},
            },
        ).json()
        assert client.post(f"/api/print-tasks/{task2['id']}/queue").status_code == 200
        assert client.post(f"/api/print-tasks/{task2['id']}/start").status_code == 200
        bound = client.post(
            f"/api/print-tasks/{task2['id']}/spooler-binding",
            json={
                "agentJobId": "agent-job-1",
                "spoolerJobId": 77,
                "documentName": "Review document",
                "spoolerStatus": "PRINTING",
                "boundAt": "2026-09-24T00:00:00Z",
            },
        )
        assert bound.status_code == 200, bound.text
        assert bound.json()["spoolerDocumentName"] == "Review document"
        assert bound.json()["spoolerBoundAt"] == "2026-09-24T00:00:00Z"



def test_system_log_cleanup_deletes_expired_rows_and_preserves_unresolved_errors():
    old = "2000-01-01T00:00:00Z"
    with transaction() as conn:
        conn.execute(
            insert(system_log),
            [
                {
                    "level": "INFO",
                    "module": "review",
                    "event_type": "OLD_INFO",
                    "message": "expired",
                    "resolved": 0,
                    "created_at": old,
                    "updated_at": old,
                },
                {
                    "level": "ERROR",
                    "module": "review",
                    "event_type": "OLD_UNRESOLVED_ERROR",
                    "message": "preserve",
                    "resolved": 0,
                    "created_at": old,
                    "updated_at": old,
                },
                {
                    "level": "ERROR",
                    "module": "review",
                    "event_type": "OLD_RESOLVED_ERROR",
                    "message": "delete",
                    "resolved": 1,
                    "resolved_at": old,
                    "created_at": old,
                    "updated_at": old,
                },
            ],
        )

    with TestClient(app) as client:
        cleaned = client.post("/api/system-logs/cleanup")
        assert cleaned.status_code == 200, cleaned.text
        body = cleaned.json()
        assert body["deleted"] >= 2
        assert body["batches"] >= 1
        assert isinstance(body["durationMs"], int)
        assert body["completedAt"].endswith("Z")

    with transaction() as conn:
        remaining = conn.execute(
            select(system_log.c.event_type).where(system_log.c.module == "review")
        ).scalars().all()
    assert "OLD_UNRESOLVED_ERROR" in remaining
    assert "OLD_INFO" not in remaining
    assert "OLD_RESOLVED_ERROR" not in remaining



def test_template_validation_blocks_invalid_review_and_returns_string_errors():
    with TestClient(app) as client:
        code = _code("invalid")
        template = client.post(
            "/api/templates",
            json={"code": code, "name": "Invalid template", "documentType": "FORM"},
        ).json()
        saved = client.put(
            f"/api/templates/{template['id']}/draft",
            json={
                "name": "Invalid template",
                "design": {
                    "schemaVersion": 1,
                    "paper": {"width": 210, "height": 297},
                    "elements": [
                        {"id": "dup", "type": "TEXT", "binding": "missing"},
                        {"id": "dup", "type": "TEXT"},
                    ],
                },
                "sampleData": {"title": "sample"},
                "dataConfig": {"schemaVersion": 1, "mode": "JSON", "queries": []},
            },
        )
        assert saved.status_code == 200, saved.text

        validated = client.get(f"/api/templates/{template['id']}/validate")
        assert validated.status_code == 200
        body = validated.json()
        assert body["valid"] is False
        assert body["errors"]
        assert all(isinstance(item, str) for item in body["errors"])
        assert any("组件 id 重复" in item for item in body["errors"])
        assert any("绑定字段不存在" in item for item in body["errors"])

        assert client.post(f"/api/templates/{template['id']}/testing").status_code == 200
        blocked = client.post(f"/api/templates/{template['id']}/submit-review")
        assert blocked.status_code == 400
        assert blocked.json()["code"] == "TEMPLATE_VALIDATION_FAILED"
