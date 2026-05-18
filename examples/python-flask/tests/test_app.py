"""Unit tests for the Flask API."""

import pytest

from app.main import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


class TestHealth:
    def test_health_returns_200(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.get_json() == {"status": "ok"}


class TestItems:
    def test_list_items(self, client):
        resp = client.get("/api/items")
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) >= 2

    def test_get_existing_item(self, client):
        resp = client.get("/api/items/1")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["name"] == "Widget"

    def test_get_nonexistent_item(self, client):
        resp = client.get("/api/items/999")
        assert resp.status_code == 404

    def test_create_item(self, client):
        resp = client.post("/api/items", json={"name": "New", "price": 4.99})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "New"
        assert data["price"] == 4.99

    def test_create_item_missing_fields(self, client):
        resp = client.post("/api/items", json={"name": "Incomplete"})
        assert resp.status_code == 422

    def test_delete_item(self, client):
        resp = client.delete("/api/items/2")
        assert resp.status_code == 200

    def test_delete_nonexistent_item(self, client):
        resp = client.delete("/api/items/999")
        assert resp.status_code == 404
