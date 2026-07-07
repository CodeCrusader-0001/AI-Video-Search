import os
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # API Settings
    PROJECT_NAME: str = "AI Video Search Engine"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = Field(default="super_secret_key_for_jwt_tokens_change_in_production")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # Relational Database Settings
    # Fallback to local SQLite file in the workspace
    DATABASE_URL: str = Field(default="sqlite:///c:/Users/ashis/Music/Desktop/A/video_search.db")
    ASYNC_DATABASE_URL: str = Field(default="sqlite+aiosqlite:///c:/Users/ashis/Music/Desktop/A/video_search.db")

    # Vector Database Settings (Qdrant)
    # Default to ":memory:" for in-memory testing when no Qdrant server is running
    QDRANT_URL: str = Field(default=":memory:")
    QDRANT_API_KEY: Optional[str] = None
    QDRANT_COLLECTION_NAME: str = "video_frames"

    # Message Queue Settings (Celery + RabbitMQ/Redis)
    # Default to "memory://" or local execution if RabbitMQ is not available
    CELERY_BROKER_URL: str = Field(default="redis://localhost:6379/0")
    CELERY_RESULT_BACKEND: str = Field(default="redis://localhost:6379/0")

    # Object Storage Settings (S3 / MinIO)
    # Fallback to local directory storage when S3/MinIO is not set
    S3_ENDPOINT_URL: Optional[str] = None  # e.g., http://localhost:9000 for MinIO
    S3_ACCESS_KEY: Optional[str] = None
    S3_SECRET_KEY: Optional[str] = None
    S3_BUCKET_NAME: str = "ai-video-search-assets"
    
    # Path for local storage fallback
    LOCAL_STORAGE_PATH: str = "c:/Users/ashis/Music/Desktop/A/storage"

    # AI Model Settings
    SIGLIP_MODEL_NAME: str = "google/siglip-base-patch16-224"
    BLIP_MODEL_NAME: str = "Salesforce/blip-image-captioning-base"
    WHISPER_MODEL_NAME: str = "openai/whisper-small"  # Small/Base models run well on both CPU and GPU
    YOLO_MODEL_NAME: str = "yolov8n.pt"  # Lightweight for fast inference

    @property
    def is_local_storage(self) -> bool:
        return not self.S3_ENDPOINT_URL or not self.S3_ACCESS_KEY

    @property
    def is_qdrant_memory(self) -> bool:
        return self.QDRANT_URL == ":memory:"

    @property
    def qdrant_local_path(self) -> str:
        return os.path.join(self.LOCAL_STORAGE_PATH, "qdrant_db")

settings = Settings()
