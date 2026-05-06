# Development Commands

## Frontend

Install:

```sh
cd frontend
npm install
```

Dev server:

```sh
cd frontend
npm run dev
```

Build:

```sh
cd frontend
npm run build
```

Test:

```sh
cd frontend
npm test
```

Lint:

```sh
cd frontend
npm run lint
```

Typecheck:

```sh
cd frontend
npm run typecheck
```

Preview production build:

```sh
cd frontend
npm run preview
```

## Backend

Install:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
```

Dev server:

```sh
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

Lint:

```sh
cd backend
source .venv/bin/activate
ruff check .
```

Test:

```sh
cd backend
source .venv/bin/activate
pytest
```

Typecheck:

```sh
# No backend typecheck command is configured yet.
```

Database migration:

```sh
# No migration tool is configured yet.
# The backend currently creates tables at startup through SQLAlchemy metadata.
```

## Database

Start PostgreSQL:

```sh
docker compose up -d postgres
```

Stop PostgreSQL:

```sh
docker compose down
```

## Background Dev Script

Start the full local stack:

```sh
./scripts/dev.sh start
```

Stop the background processes and bring down PostgreSQL:

```sh
./scripts/dev.sh stop
```

Status:

```sh
./scripts/dev.sh status
```

The script writes logs and PID files to `.calendar-dev/` and defaults to binding the frontend and backend to `0.0.0.0`.

For remote testing, start it with a public host value so the frontend calls the correct backend and the backend allows that origin. The script remembers the last value in `.calendar-dev/public_host`:

```sh
PUBLIC_HOST=100.64.0.2 ./scripts/dev.sh start
```
