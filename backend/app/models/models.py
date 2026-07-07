import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, ForeignKey, Boolean, DateTime, JSON
from sqlalchemy.orm import relationship
from backend.app.core.database import Base

def generate_uuid() -> str:
    return str(uuid.uuid4())

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    videos = relationship("Video", back_populates="owner", cascade="all, delete-orphan")

class Video(Base):
    __tablename__ = "videos"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), nullable=False)
    storage_path = Column(String(512), nullable=False)  # S3 bucket URI or local file path
    duration_seconds = Column(Integer, default=0)
    status = Column(String(50), default="PENDING")  # PENDING, PROCESSING, COMPLETED, FAILED
    progress = Column(Integer, default=0)
    progress_message = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="videos")
    scenes = relationship("Scene", back_populates="video", cascade="all, delete-orphan")
    transcript_segments = relationship("TranscriptSegment", back_populates="video", cascade="all, delete-orphan")

class Scene(Base):
    __tablename__ = "scenes"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    video_id = Column(String(36), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    scene_index = Column(Integer, nullable=False)

    video = relationship("Video", back_populates="scenes")
    frames = relationship("Frame", back_populates="scene", cascade="all, delete-orphan")
    transcript_segments = relationship("TranscriptSegment", back_populates="scene")

class Frame(Base):
    __tablename__ = "frames"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    scene_id = Column(String(36), ForeignKey("scenes.id", ondelete="CASCADE"), nullable=False)
    storage_path = Column(String(512), nullable=False)  # Path to keyframe JPEG
    timestamp_seconds = Column(Float, nullable=False)
    frame_index = Column(Integer, nullable=False)

    scene = relationship("Scene", back_populates="frames")
    captions = relationship("FrameCaption", back_populates="frame", cascade="all, delete-orphan")
    objects = relationship("DetectedObject", back_populates="frame", cascade="all, delete-orphan")

class FrameCaption(Base):
    __tablename__ = "frame_captions"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    frame_id = Column(String(36), ForeignKey("frames.id", ondelete="CASCADE"), nullable=False)
    caption_text = Column(String(1000), nullable=False)
    confidence = Column(Float, default=1.0)

    frame = relationship("Frame", back_populates="captions")

class DetectedObject(Base):
    __tablename__ = "detected_objects"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    frame_id = Column(String(36), ForeignKey("frames.id", ondelete="CASCADE"), nullable=False)
    label = Column(String(100), nullable=False, index=True)
    confidence = Column(Float, nullable=False)
    bounding_box = Column(JSON, nullable=True)  # [x_min, y_min, x_max, y_max] format

    frame = relationship("Frame", back_populates="objects")

class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id = Column(String(36), primary_key=True, default=generate_uuid)
    video_id = Column(String(36), ForeignKey("videos.id", ondelete="CASCADE"), nullable=False)
    scene_id = Column(String(36), ForeignKey("scenes.id", ondelete="SET NULL"), nullable=True)
    segment_text = Column(String(2000), nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)

    video = relationship("Video", back_populates="transcript_segments")
    scene = relationship("Scene", back_populates="transcript_segments")
