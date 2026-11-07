from datetime import datetime

from sqlalchemy import DateTime, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RegistrationSettings(Base):
    __tablename__ = "registration_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    open_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
