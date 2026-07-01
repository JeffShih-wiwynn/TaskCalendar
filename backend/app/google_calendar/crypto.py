from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, status

from app.core.config import settings


def encrypt_refresh_token(refresh_token: str) -> str:
    return get_fernet().encrypt(refresh_token.encode("utf-8")).decode("utf-8")


def decrypt_refresh_token(encrypted_refresh_token: str) -> str:
    try:
        return get_fernet().decrypt(encrypted_refresh_token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google token encryption is not configured correctly",
        ) from exc


def get_fernet() -> Fernet:
    key = settings.google_token_encryption_key
    if not key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google token encryption is not configured",
        )
    try:
        return Fernet(key.encode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google token encryption is not configured correctly",
        ) from exc
