from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class BackupExportResponse(BaseModel):
    schema_version: int
    exported_at: datetime
    tasks: list[dict[str, Any]]
    task_lists: list[dict[str, Any]]

    model_config = ConfigDict(from_attributes=True)
