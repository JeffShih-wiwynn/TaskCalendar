from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import create_db_and_tables
from app.health.router import router as health_router
from app.task_lists.router import router as task_lists_router
from app.tasks.router import router as tasks_router


def create_app(*, create_tables: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if create_tables:
            create_db_and_tables()
        yield

    app = FastAPI(title="Calendar API", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_frontend_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(task_lists_router)
    app.include_router(tasks_router)

    return app


app = create_app()
