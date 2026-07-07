from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional, Dict, Any
from datetime import datetime

# --- Auth Schemas ---
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: EmailStr
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    user_id: Optional[str] = None

# --- Ingestion Schemas ---
class VideoCreate(BaseModel):
    title: str

class VideoResponse(BaseModel):
    id: str
    user_id: str
    title: str
    storage_path: str
    duration_seconds: int
    status: str
    progress: int
    progress_message: str
    created_at: datetime

    class Config:
        from_attributes = True

class SceneResponse(BaseModel):
    id: str
    video_id: str
    start_time: float
    end_time: float
    scene_index: int

    class Config:
        from_attributes = True

class FrameResponse(BaseModel):
    id: str
    scene_id: str
    storage_path: str
    timestamp_seconds: float
    frame_index: int
    caption: Optional[str] = None
    objects: List[str] = []

# --- Search Schemas ---
class SearchResultItem(BaseModel):
    video_id: str
    video_title: str
    scene_id: str
    start_time: float
    end_time: float
    frame_id: str
    frame_image_url: str
    timestamp: float
    similarity_score: float
    caption: str
    objects: List[str]
    transcript_snippet: Optional[str] = None

class SearchResponse(BaseModel):
    query: str
    results: List[SearchResultItem]
    latency_ms: float
