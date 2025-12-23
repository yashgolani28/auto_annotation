from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    database_url: str = Field(alias="DATABASE_URL")
    storage_dir: str = Field(default="/app/data", alias="STORAGE_DIR")
    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

    jwt_secret: str = Field(default="change-me-super-secret", alias="JWT_SECRET")
    jwt_alg: str = Field(default="HS256", alias="JWT_ALG")
    access_token_minutes: int = Field(default=30, alias="ACCESS_TOKEN_MINUTES")
    refresh_token_days: int = Field(default=14, alias="REFRESH_TOKEN_DAYS")

    bootstrap_admin_email: str = Field(default="admin@local", alias="BOOTSTRAP_ADMIN_EMAIL")
    bootstrap_admin_password: str = Field(default="admin12345", alias="BOOTSTRAP_ADMIN_PASSWORD")


settings = Settings()
