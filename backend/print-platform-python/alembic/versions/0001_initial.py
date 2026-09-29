"""Initial Python backend schema aligned with the Java SQLite schema.

Revision ID: 0001
Revises:
Create Date: 2026-09-23
"""

from alembic import op

from app.models import metadata

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    metadata.drop_all(bind=op.get_bind())
