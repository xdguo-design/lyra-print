import os
from pathlib import Path

TEST_DB = Path(".pytest-print-platform.db")
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["PRINT_DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ["PRINT_SECURITY_ENABLED"] = "false"
