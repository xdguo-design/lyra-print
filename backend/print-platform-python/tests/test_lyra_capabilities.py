from fastapi.testclient import TestClient

from app import lyra_capabilities
from app.main import app


def test_lyra_print_capability_provider_creates_and_queues(monkeypatch):
    monkeypatch.setattr(
        lyra_capabilities,
        "create_print_task",
        lambda body: {"id": "PT-100", "status": "CREATED", **body},
    )
    monkeypatch.setattr(
        lyra_capabilities,
        "queue_print_task",
        lambda task_id: {"id": task_id, "status": "QUEUED"},
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/lyra/capabilities/print.execute",
            json={
                "payload": {
                    "kind": "template",
                    "businessKey": "demo-100",
                    "templateCode": "receipt",
                    "inputData": {"name": "Lyra"},
                }
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["capability"] == "print.execute"
    assert payload["result"]["task"]["id"] == "PT-100"
    assert payload["result"]["queued"] is True
    assert payload["result"]["queue_result"]["status"] == "QUEUED"


def test_lyra_print_capability_provider_can_create_without_queue(monkeypatch):
    monkeypatch.setattr(
        lyra_capabilities,
        "create_pdf_task",
        lambda body: {"id": "PT-PDF", "status": "CREATED", **body},
    )

    with TestClient(app) as client:
        response = client.post(
            "/api/lyra/capabilities/print.execute",
            json={
                "payload": {
                    "kind": "pdf",
                    "queue": False,
                    "documentBase64": "JVBERi0xLjQ=",
                }
            },
        )

    assert response.status_code == 200
    result = response.json()["result"]
    assert result["task"]["id"] == "PT-PDF"
    assert result["queued"] is False


def test_lyra_print_capability_provider_rejects_unknown_kind():
    with TestClient(app) as client:
        response = client.post(
            "/api/lyra/capabilities/print.execute",
            json={"payload": {"kind": "unknown"}},
        )

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_PRINT_KIND"
