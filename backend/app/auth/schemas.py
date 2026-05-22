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
    is_admin: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)
    confirm_new_password: str = Field(min_length=1)


class DeleteAccountRequest(BaseModel):
    confirmation: str = Field(min_length=1)


class ActionResponse(BaseModel):
    message: str
