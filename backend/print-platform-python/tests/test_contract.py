# ruff: noqa: I001
from pathlib import Path

from app.main import app


HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def test_fastapi_routes_match_authoritative_openapi_contract():
    import yaml

    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "openapi" / "print-platform.yaml"
    contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))

    expected = {
        (method.upper(), path)
        for path, spec in contract["paths"].items()
        for method in spec
        if method.lower() in HTTP_METHODS
    }
    generated = app.openapi()
    actual = {
        (method.upper(), path)
        for path, spec in generated["paths"].items()
        if path.startswith("/api/")
        for method in spec
        if method.lower() in HTTP_METHODS
    }

    assert len(expected) == 79
    assert actual == expected
