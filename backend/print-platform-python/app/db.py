from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Connection, Engine

from .config import get_settings
from .models import metadata


def _make_engine() -> Engine:
    settings = get_settings()
    connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
    engine = create_engine(settings.database_url, future=True, pool_pre_ping=True, connect_args=connect_args)

    if settings.database_url.startswith("sqlite"):
        @event.listens_for(engine, "connect")
        def _configure_sqlite(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


engine = _make_engine()


def init_db() -> None:
    metadata.create_all(engine)


@contextmanager
def transaction() -> Iterator[Connection]:
    with engine.begin() as connection:
        yield connection


def connect() -> Connection:
    return engine.connect()
