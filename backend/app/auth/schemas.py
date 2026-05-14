import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AuthCredentials(BaseModel):
    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserRead(BaseModel):
    id: uuid.UUID
    username: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
