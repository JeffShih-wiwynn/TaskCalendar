FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/pyproject.toml backend/
COPY backend/app backend/app
COPY backend/alembic backend/alembic
COPY backend/alembic.ini backend/
COPY backend/docker-entrypoint.sh backend/

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir backend/ \
    && pip install --no-cache-dir alembic \
    && chmod +x /app/backend/docker-entrypoint.sh

WORKDIR /app/backend

ENTRYPOINT ["/app/backend/docker-entrypoint.sh"]
