from fastapi.testclient import TestClient

from app.main import app


def test_java_http_regression_semantics_are_preserved():
    with TestClient(app) as c:
        code = "functional-python"
        r = c.post("/api/templates", json={"code": code, "name": "生命周期测试模板", "documentType": "FORM"})
        assert r.status_code == 201
        t = r.json()
        assert t["status"] == "DRAFT" and t["design"]["elements"] and t["sampleData"]["title"]

        design = t["design"]
        design["elements"].append({"id": "extra", "type": "TEXT"})
        sample = {"title": "修改后的标题", "patientName": "李四", "items": [], "totalAmount": 1}
        r = c.put(
            f"/api/templates/{t['id']}/draft",
            json={"name": "改名后的模板", "design": design, "sampleData": sample},
        )
        assert r.json()["draftRevision"] == 2

        c.post(f"/api/templates/{t['id']}/testing")
        c.post(f"/api/templates/{t['id']}/submit-review")
        assert c.post(f"/api/templates/{t['id']}/publish", json={"changeNote": "v1"}).json()["publishedVersion"] == 1

        r = c.put(
            f"/api/templates/{t['id']}/draft",
            json={"name": "发布后草稿", "design": design, "sampleData": sample},
        )
        assert r.json()["draftRevision"] == 3 and r.json()["publishedVersion"] == 1

        c.post(f"/api/templates/{t['id']}/testing")
        c.post(f"/api/templates/{t['id']}/submit-review")
        assert c.post(f"/api/templates/{t['id']}/publish", json={"changeNote": "v2"}).json()["publishedVersion"] == 2
        assert c.post(f"/api/templates/{t['id']}/rollback", json={"versionNo": 1}).json()["publishedVersion"] == 3

        td = c.post(
            f"/api/templates/{t['id']}/test-data",
            json={"inputData": {**sample, "patientName": "测试运行"}},
        ).json()
        assert td["status"] == "SUCCESS" and td["target"]["kind"] == "DRAFT"
        assert td["renderData"]["patientName"] == "测试运行"

        rr = c.post(
            f"/api/template-test-runs/{td['testRunId']}/render-result",
            json={"success": True, "pageCount": 1, "elapsedMs": 5},
        ).json()
        assert rr["renderStatus"] == "SUCCESS" and rr["pageCount"] == 1
        runs = c.get(f"/api/templates/{t['id']}/test-runs").json()
        assert any(x["testType"] == "PREVIEW" for x in runs)

        clone = c.post(f"/api/templates/{t['id']}/clone").json()
        assert clone["code"].startswith(code + "-COPY-")
        assert c.post("/api/templates", json={"code": code, "name": "dup", "documentType": "FORM"}).status_code == 400

        bad = c.post(f"/api/templates/{clone['id']}/publish", json={})
        assert bad.status_code == 409 and bad.json()["code"] == "TEMPLATE_STATE_CONFLICT"
        missing = c.get("/api/templates/not-found")
        assert missing.status_code == 404 and missing.json()["code"] == "TEMPLATE_NOT_FOUND"

        assert c.get("/api/cloud-templates/status").json()["available"] is False
        assert c.get("/api/runtime/capabilities").json()["authenticationEnabled"] is False

        c.put("/api/printers/disabled", json={"displayName": "停用", "enabled": False})
        blocked = c.post(
            "/api/print-tasks",
            json={
                "templateCode": code,
                "businessKey": "blocked",
                "printerId": "disabled",
                "copies": 1,
                "inputData": sample,
            },
        )
        assert blocked.status_code == 400 and "停用" in blocked.json()["detail"]

        def create(key, printer):
            x = c.post(
                "/api/print-tasks",
                json={
                    "templateCode": code,
                    "businessKey": key,
                    "printerId": printer,
                    "copies": 1,
                    "inputData": sample,
                },
            )
            assert x.status_code == 201, x.text
            assert x.json()["templateVersion"] == 3
            return x.json()

        def act(task, name, body=None):
            endpoint = f"/api/print-tasks/{task['id']}/{name}"
            x = c.post(endpoint, json=body) if body is not None else c.post(endpoint)
            assert x.status_code < 300, x.text
            return x.json()

        t1 = create("OK", "a4-01")
        act(t1, "queue")
        act(t1, "start")
        act(t1, "success")

        t2 = create("FAIL", "a4-02")
        act(t2, "queue")
        act(t2, "start")
        act(t2, "fail", {"reason": "打印机缺纸"})

        t3 = create("RETRY", "a4-03")
        act(t3, "queue")
        act(t3, "start")
        act(t3, "fail", {"reason": "卡纸"})
        act(t3, "retry", {"printerId": "a4-backup"})
        act(t3, "queue")
        act(t3, "start")
        act(t3, "success")

        final = c.get(f"/api/print-tasks/{t3['id']}").json()
        assert final["attempts"] == 2 and final["status"] == "SUCCESS"

        attempts = c.get(f"/api/print-tasks/{t3['id']}/attempts").json()
        assert [x["status"] for x in attempts] == ["FAILED", "SUCCESS"]
        assert attempts[-1]["printerId"] == "a4-backup"

        logs = c.get("/api/reports/logs?limit=200").json()
        assert len(logs) >= 4
        summary = c.get("/api/reports/summary").json()
        assert summary["attempts"] >= 4
        by_printer = c.get("/api/reports/printers").json()
        assert any(x["printerId"] == "a4-backup" and x["succeeded"] == 1 for x in by_printer)
        assert c.get("/api/reports/logs?from=2999-01-01").json() == []

        assert c.post(f"/api/templates/{t['id']}/disable").json()["status"] == "DISABLED"
        releases = c.get(f"/api/templates/{t['id']}/releases").json()
        assert all(not x["active"] for x in releases)
