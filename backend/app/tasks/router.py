import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.tasks import service
from app.tasks.schemas import ScheduledTaskCreate, ScheduledTaskRead, ScheduledTaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

DbSession = Annotated[Session, Depends(get_db)]


@router.get("", response_model=list[ScheduledTaskRead])
def list_tasks(
    db: DbSession,
    range_start: Annotated[datetime | None, Query(alias="from")] = None,
    range_end: Annotated[datetime | None, Query(alias="to")] = None,
    completed: bool | None = None,
    list_id: uuid.UUID | None = None,
) -> list[ScheduledTaskRead]:
    return service.list_tasks(
        db,
        range_start=range_start,
        range_end=range_end,
        completed=completed,
        list_id=list_id,
    )


@router.post("", response_model=ScheduledTaskRead, status_code=status.HTTP_201_CREATED)
def create_task(data: ScheduledTaskCreate, db: DbSession) -> ScheduledTaskRead:
    return service.create_task(db, data)


@router.get("/{task_id}", response_model=ScheduledTaskRead)
def get_task(task_id: uuid.UUID, db: DbSession) -> ScheduledTaskRead:
    return service.get_task_or_404(db, task_id)


@router.patch("/{task_id}", response_model=ScheduledTaskRead)
def update_task(
    task_id: uuid.UUID,
    data: ScheduledTaskUpdate,
    db: DbSession,
) -> ScheduledTaskRead:
    return service.update_task(db, task_id, data)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: uuid.UUID, db: DbSession) -> Response:
    service.delete_task(db, task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{task_id}/complete", response_model=ScheduledTaskRead)
def complete_task(task_id: uuid.UUID, db: DbSession) -> ScheduledTaskRead:
    return service.complete_task(db, task_id)


@router.post("/{task_id}/uncomplete", response_model=ScheduledTaskRead)
def uncomplete_task(task_id: uuid.UUID, db: DbSession) -> ScheduledTaskRead:
    return service.uncomplete_task(db, task_id)
