# Print Platform Python Backend

This directory is the primary backend runtime for the Print Platform.

## Runtime

- Python 3.11+
- FastAPI
- SQLAlchemy 2.x
- Alembic
- Pydantic v2 / pydantic-settings
- SQLite by default; `PRINT_DATABASE_URL` can point to PostgreSQL later.

The authoritative HTTP contract remains `../../contracts/openapi/print-platform.yaml`.

## Local run

```bash
python -m pip install -e '.[dev]'
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

For development, the application also calls `metadata.create_all()` on startup so an empty SQLite database can boot without a separate migration command. Production deployments should run `alembic upgrade head` explicitly.

## SQLite data

The default database is `./print-platform.db` inside the backend working directory. Existing deployments migrating from the former backend can point `PRINT_DATABASE_URL` at a backed-up SQLite database whose schema matches the platform contract.

## Compatibility status

The FastAPI router exposes the same 78 method/path operations currently declared in the OpenAPI contract. Core local flows are implemented in Python:

- template CRUD/lifecycle/version/release/audit
- preview and print task lifecycle
- PDF/RAW task snapshot storage
- printer profiles
- print-agent heartbeat/printer inventory
- system logs and alerts
- reports
- local data-source metadata and SQLite read-only connectivity test
- template test-run persistence
- auth/session and runtime capabilities

Cloud-template and external AI integrations keep their API endpoints but require their Python adapters/configuration before production use. They fail closed rather than silently pretending success.

The Python backend is the only server implementation kept in the repository.
