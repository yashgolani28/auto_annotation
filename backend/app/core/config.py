from pydantic_settings import BaseSettings
from pydantic import Field

class Settings(BaseSettings):
    database_url: str = Field(alias="DATABASE_URL")
    storage_dir: str = Field(default="/app/data", alias="STORAGE_DIR")
    cors_origins: str = Field(default="http://localhost:5173", alias="CORS_ORIGINS")
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")

settings = Settings()
