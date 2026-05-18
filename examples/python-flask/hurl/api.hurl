# ── Health check ──────────────────────────────────────────────
GET http://localhost:5000/health
HTTP 200
[Asserts]
jsonpath "$.status" == "ok"

# ── List items ────────────────────────────────────────────────
GET http://localhost:5000/api/items
HTTP 200
[Asserts]
jsonpath "$[0].name" == "Widget"
jsonpath "$[1].name" == "Gadget"

# ── Get single item ───────────────────────────────────────────
GET http://localhost:5000/api/items/1
HTTP 200
[Asserts]
jsonpath "$.id" == 1
jsonpath "$.price" == 9.99

# ── Create item ───────────────────────────────────────────────
POST http://localhost:5000/api/items
{
  "name": "Sprocket",
  "price": 19.99
}
HTTP 201
[Captures]
new_id: jsonpath "$.id"
[Asserts]
jsonpath "$.name" == "Sprocket"
jsonpath "$.price" == 19.99

# ── Get the newly created item ────────────────────────────────
GET http://localhost:5000/api/items/{{new_id}}
HTTP 200

# ── Delete an item ────────────────────────────────────────────
DELETE http://localhost:5000/api/items/2
HTTP 200

# ── Missing fields returns 422 ────────────────────────────────
POST http://localhost:5000/api/items
{
  "name": "Incomplete"
}
HTTP 422

# ── Not found returns 404 ─────────────────────────────────────
GET http://localhost:5000/api/items/99999
HTTP 404
