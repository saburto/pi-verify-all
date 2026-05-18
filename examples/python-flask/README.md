# Python Flask — pi-verify-all Example

A minimal Flask REST API demonstrating the full pi-verify-all pipeline.

## Project Structure

```
python-flask/
├── .pi/
│   └── verify.json      ← Verify pipeline configuration
├── app/
│   ├── __init__.py       ← Exports Flask app
│   └── main.py           ← Flask application (CRUD API)
├── tests/
│   └── test_app.py       ← Pytest unit tests (8 tests)
├── hurl/
│   └── api.hurl          ← 8 hurl integration tests
├── pyproject.toml        ← Dependencies + tool config
└── README.md
```

## Verify Pipeline

| Step | Command | Description |
|------|---------|-------------|
| 1. Install deps | `uv sync --frozen` | Sync project dependencies |
| 2. Format check | `uv run black --check --diff .` | Ensures code is formatted |
| 3. Lint | `uv run ruff check .` | Lints for errors and style issues |
| 4. Unit tests | `uv run pytest tests/ -v` | Runs 8 pytest tests |
| 5. Stop existing app | `lsof -ti:5000 \| xargs kill` | Clears port 5000 |
| 6. Start Flask app | `uv run flask run --port=5000` | Starts in **background** with health check |
| 7. API tests | `hurl --test hurl/api.hurl` | 8 end-to-end HTTP tests |

## Quick Start

```bash
# Install dependencies
uv sync

# Run quality checks
uv run black --check . && uv run ruff check . && uv run pytest tests/ -v

# Run the full pipeline (stop → start → hurl)
lsof -ti:5000 | xargs kill 2>/dev/null || true
uv run flask run --port=5000 &
sleep 2
curl -s http://localhost:5000/health
hurl --test hurl/api.hurl
```

## Running with pi-verify-all

In pi coding agent, just type:

```
/verify
```

The widget shows live progress for all 7 steps. After a failure, the pipeline auto-retries on `agent_end` (up to 3 times).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/items` | List all items |
| GET | `/api/items/:id` | Get single item |
| POST | `/api/items` | Create item |
| DELETE | `/api/items/:id` | Delete item |
