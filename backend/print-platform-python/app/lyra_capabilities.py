from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from .tasks import (
    create_pdf_task,
    create_print_task,
    create_raw_task,
    queue_print_task,
)

router = APIRouter()


@router.post("/api/lyra/capabilities/print.execute")
def execute_print_capability(body: dict[str, Any] = Body(...)):
    payload = body.get("payload")
    if not isinstance(payload, dict):
        raise HTTPException(
            400,
            detail={
                "code": "INVALID_CAPABILITY_PAYLOAD",
                "detail": "payload must be an object",
            },
        )

    request_payload = dict(payload)
    kind = str(request_payload.pop("kind", "template")).strip().lower()
    should_queue = bool(request_payload.pop("queue", True))

    if kind == "template":
        task = create_print_task(request_payload)
    elif kind == "pdf":
        task = create_pdf_task(request_payload)
    elif kind == "raw":
        task = create_raw_task(request_payload)
    else:
        raise HTTPException(
            400,
            detail={
                "code": "INVALID_PRINT_KIND",
                "detail": "kind must be one of: template, pdf, raw",
            },
        )

    if not should_queue:
        return {
            "capability": "print.execute",
            "result": {"task": task, "queued": False},
        }

    task_id = str(task.get("id", "")).strip()
    if not task_id:
        raise HTTPException(
            502,
            detail={
                "code": "PRINT_TASK_ID_MISSING",
                "detail": "created print task did not return an id",
            },
        )
    queued = queue_print_task(task_id)
    return {
        "capability": "print.execute",
        "result": {
            "task": task,
            "queued": True,
            "queue_result": queued,
        },
    }
