from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def test_root() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json()["application"] == "HyperSync"


def test_live_health() -> None:
    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json()["api"] == "healthy"