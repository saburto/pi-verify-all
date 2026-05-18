"""Minimal Flask REST API with health check."""

from flask import Flask, jsonify, request

app = Flask(__name__)

# In-memory "database"
_items: list[dict] = [
    {"id": 1, "name": "Widget", "price": 9.99},
    {"id": 2, "name": "Gadget", "price": 14.99},
]


@app.get("/health")
def health():
    return jsonify({"status": "ok"}), 200


@app.get("/api/items")
def list_items():
    return jsonify(_items), 200


@app.get("/api/items/<int:item_id>")
def get_item(item_id: int):
    item = next((i for i in _items if i["id"] == item_id), None)
    if item is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(item), 200


@app.post("/api/items")
def create_item():
    body = request.get_json(silent=True)
    if not body or "name" not in body or "price" not in body:
        return jsonify({"error": "name and price required"}), 422
    new_id = max(i["id"] for i in _items) + 1 if _items else 1
    item = {"id": new_id, "name": body["name"], "price": float(body["price"])}
    _items.append(item)
    return jsonify(item), 201


@app.delete("/api/items/<int:item_id>")
def delete_item(item_id: int):
    global _items
    before = len(_items)
    _items = [i for i in _items if i["id"] != item_id]
    if len(_items) == before:
        return jsonify({"error": "not found"}), 404
    return jsonify({"deleted": item_id}), 200
