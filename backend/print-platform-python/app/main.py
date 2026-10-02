from __future__ import annotations

import re
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .db import init_db
from .lyra_capabilities import router as lyra_capabilities_router
from .ops import api_key_role, extract_api_key
from .ops import router as ops_router
from .tasks import router as tasks_router
from .templates import router as templates_router

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Print Platform API",
    version=settings.app_version,
    description="Python/FastAPI implementation of the Print Platform contract.",
    lifespan=lifespan,
)

ERROR_CODES = {
    "task_not_found": "TASK_NOT_FOUND",
    "template_not_found": "TEMPLATE_NOT_FOUND",
    "invalid_task_transition": "TASK_STATE_CONFLICT",
    "template_state_conflict": "TEMPLATE_STATE_CONFLICT",
    "template_code_conflict": "TEMPLATE_CONFLICT",
    "system_log_not_found": "SYSTEM_LOG_NOT_FOUND",
    "alert_not_found": "ALERT_NOT_FOUND",
}


@app.exception_handler(HTTPException)
async def http_problem(_request: Request, exc: HTTPException):
    detail = exc.detail
    if isinstance(detail, dict):
        error = detail.get("error")
        code = detail.get("code") or ERROR_CODES.get(str(error), str(error).upper() if error else "BAD_REQUEST")
        message = detail.get("detail") or detail.get("message") or (str(error).replace("_", " ") if error else "request failed")
        body = {"type": "about:blank", "status": exc.status_code, "detail": message, "code": code}
        for key, value in detail.items():
            if key not in {"error", "detail", "message", "code"}:
                body[key] = value
        return JSONResponse(status_code=exc.status_code, content=body, headers=exc.headers)
    return JSONResponse(
        status_code=exc.status_code,
        content={"type": "about:blank", "status": exc.status_code, "detail": str(detail), "code": "BAD_REQUEST"},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_problem(_request: Request, _exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={"type": "about:blank", "status": 400, "detail": "请求参数校验失败", "code": "REQUEST_VALIDATION_FAILED"},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _required_permission(method: str, path: str) -> str:
    if method.upper() == "GET":
        return "VIEW"
    if path == "/api/system-logs/batch":
        return "OPERATE"
    if path.startswith("/api/system-logs"):
        return "ADMIN"
    if path == "/api/agents/heartbeat":
        return "OPERATE"
    if re.fullmatch(r"/api/alerts/\\d+/ack", path):
        return "OPERATE"
    if path.startswith("/api/alerts"):
        return "ADMIN"
    if path.startswith("/api/print-tasks") or path.startswith("/api/print-previews"):
        return "OPERATE"
    if path.startswith("/api/lyra/capabilities/"):
        return "OPERATE"
    if path.startswith("/api/templates/") or path == "/api/templates" or path.startswith("/api/template-test-runs"):
        return "DESIGN"
    if path.startswith("/api/template-installations") or path.startswith("/api/cloud-templates/upload"):
        return "ADMIN"
    if path.startswith("/api/data-sources") or path.startswith("/api/printers"):
        return "ADMIN"
    return "ADMIN"


def _role_allows(role: str, permission: str) -> bool:
    if permission == "VIEW":
        return role in {"VIEWER", "DESIGNER", "OPERATOR", "ADMIN"}
    if permission == "DESIGN":
        return role in {"DESIGNER", "ADMIN"}
    if permission == "OPERATE":
        return role in {"OPERATOR", "ADMIN"}
    return role == "ADMIN"


def _security_problem(status_code: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        media_type="application/problem+json",
        content={"type": "about:blank", "status": status_code, "code": code, "detail": detail},
    )


@app.middleware("http")
async def security_filter(request: Request, call_next):
    path = request.url.path
    if (
        not settings.security_enabled
        or not path.startswith("/api/")
        or request.method.upper() == "OPTIONS"
        or path == "/api/runtime/capabilities"
    ):
        return await call_next(request)

    key = extract_api_key(
        request.headers.get("Authorization"),
        request.headers.get("X-Print-Api-Key"),
        request.headers.get("X-API-Key"),
    )
    role = api_key_role(key)
    if not role:
        return _security_problem(401, "AUTH_REQUIRED", "需要有效的 Print Platform API Key")

    permission = _required_permission(request.method, path)
    if not _role_allows(role, permission):
        return _security_problem(403, "PERMISSION_DENIED", f"当前角色 {role} 无权执行该操作")
    request.state.platform_role = role
    return await call_next(request)


app.include_router(ops_router)
app.include_router(lyra_capabilities_router)
app.include_router(tasks_router)
app.include_router(templates_router)


@app.get("/health", include_in_schema=False)
@app.get("/actuator/health", include_in_schema=False)
def health():
    return {"status": "UP"}


@app.get("/actuator/info", include_in_schema=False)
def info():
    return {
        "app": {
            "name": settings.app_name,
            "version": settings.app_version,
            "storage": "sqlite" if settings.database_url.startswith("sqlite") else "sql",
            "runtime": "python-fastapi",
        }
    }
