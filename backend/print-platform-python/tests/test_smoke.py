from fastapi.testclient import TestClient

from app.main import app


def test_template_to_print_task_happy_path():
    with TestClient(app) as client:
        created = client.post(
            "/api/templates",
            json={"code": "OUTPATIENT-RECEIPT", "name": "门诊收费票据", "documentType": "A4"},
        )
        assert created.status_code == 201, created.text
        template = created.json()

        draft = client.put(
            f"/api/templates/{template['id']}/draft",
            json={
                "name": template["name"],
                "design": {"schemaVersion": 1, "page": {"size": "A4"}, "elements": []},
                "sampleData": {"patientName": "测试患者"},
                "dataConfig": {"schemaVersion": 1, "mode": "JSON", "queries": []},
            },
        )
        assert draft.status_code == 200, draft.text
        assert draft.json()["draftRevision"] == 2

        assert client.post(f"/api/templates/{template['id']}/testing").status_code == 200
        assert client.post(f"/api/templates/{template['id']}/submit-review").status_code == 200
        published = client.post(
            f"/api/templates/{template['id']}/publish",
            json={"changeNote": "python migration smoke", "scope": {"type": "ALL", "values": []}},
        )
        assert published.status_code == 200, published.text
        assert published.json()["publishedVersion"] == 1

        preview = client.post(
            "/api/print-previews",
            json={"templateCode": "OUTPATIENT-RECEIPT", "data": {"patientName": "张三"}},
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["renderData"]["patientName"] == "张三"

        task_resp = client.post(
            "/api/print-tasks",
            json={
                "templateCode": "OUTPATIENT-RECEIPT",
                "businessKey": "REG-20260923-001",
                "printerId": "cashier-a4-02",
                "copies": 1,
                "data": {"patientName": "张三"},
            },
        )
        assert task_resp.status_code == 201, task_resp.text
        task = task_resp.json()
        assert task["status"] == "CREATED"
        assert task["templateVersion"] == 1

        assert client.post(f"/api/print-tasks/{task['id']}/queue").json()["status"] == "QUEUED"
        printing = client.post(f"/api/print-tasks/{task['id']}/start").json()
        assert printing["status"] == "PRINTING"
        assert printing["attempts"] == 1
        assert client.post(f"/api/print-tasks/{task['id']}/success").json()["status"] == "SUCCESS"

        summary = client.get("/api/print-tasks/summary").json()
        assert summary["total"] >= 1
        assert summary["succeeded"] >= 1


def test_printer_and_agent_heartbeat():
    with TestClient(app) as client:
        saved = client.put(
            "/api/printers/cashier-a4-02",
            json={
                "displayName": "收费处 A4",
                "enabled": True,
                "defaultPrinter": True,
                "offsetXmm": 0.5,
                "offsetYmm": -0.5,
                "scalePercent": 100,
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["printerId"] == "cashier-a4-02"

        heartbeat = client.post(
            "/api/agents/heartbeat",
            json={
                "agentId": "agent-cashier",
                "instanceId": "cashier-01",
                "hostName": "CASHIER-PC",
                "osName": "Windows",
                "agentVersion": "0.3.0",
                "cpuUsage": 12.5,
                "memoryUsage": 42.1,
                "activeJobs": 0,
                "queuedJobs": 0,
                "spoolerStatus": "READY",
                "printers": [
                    {
                        "printerId": "cashier-a4-02",
                        "name": "收费处 A4",
                        "type": "WINDOWS",
                        "status": "ONLINE",
                        "defaultPrinter": True,
                        "paperSizes": ["A4"],
                    }
                ],
            },
        )
        assert heartbeat.status_code == 200, heartbeat.text
        assert heartbeat.json()["accepted"] is True

        agents = client.get("/api/agents").json()
        assert any(item["agentId"] == "agent-cashier" for item in agents)
        printers = client.get("/api/agents/agent-cashier/instances/cashier-01/printers").json()
        assert printers[0]["printerId"] == "cashier-a4-02"
