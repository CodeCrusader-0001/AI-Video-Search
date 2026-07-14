import os
from typing import List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from backend.app.core.config import settings
from backend.app.core.database import get_db
from backend.app.api.deps import get_current_user
from backend.app.models.models import User, Video, Scene, Frame
from backend.app.schemas.schemas import VideoResponse
from backend.app.services.storage import storage_service
from backend.app.services.vector_db import vector_db_service

router = APIRouter()

# Try importing celery task; if broker fails to load, use fallback
try:
    from worker.tasks import process_video_task
    CELERY_AVAILABLE = False # Force local processing since celery worker is not running
except Exception:
    CELERY_AVAILABLE = False

@router.post("/upload", response_model=VideoResponse, status_code=status.HTTP_201_CREATED)
async def upload_video(
    background_tasks: BackgroundTasks,
    title: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Check if a completed or processing video with the same title already exists for this user
    result = await db.execute(
        select(Video).where(
            Video.user_id == current_user.id,
            Video.title == title,
            Video.status.in_(["COMPLETED", "PROCESSING"])
        )
    )
    existing_video = result.scalars().first()
    if existing_video:
        print(f"Video '{title}' is already '{existing_video.status}'. Skipping upload/processing.")
        return existing_video

    # Ensure raw subdirectory exists locally for upload caching
    temp_dir = os.path.join(settings.LOCAL_STORAGE_PATH, "temp")
    os.makedirs(temp_dir, exist_ok=True)
    
    # Save the file temporarily
    temp_file_path = os.path.join(temp_dir, file.filename)
    with open(temp_file_path, "wb") as buffer:
        shutil_dest = buffer
        # Write chunks
        while content := await file.read(1024 * 1024):
            shutil_dest.write(content)
            
    # Push to S3/MinIO or copy to target local storage destination
    video_id = str(uuid_generator())
    file_extension = os.path.splitext(file.filename)[1] or ".mp4"
    storage_key = f"videos/{video_id}{file_extension}"
    
    try:
        final_storage_path = storage_service.upload_file(temp_file_path, storage_key)
    except Exception as e:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to store video upload: {e}"
        )
    finally:
        # Clean temp cache
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

    # Insert Video Record
    db_video = Video(
        id=video_id,
        user_id=current_user.id,
        title=title,
        storage_path=final_storage_path,
        duration_seconds=0,
        status="PENDING"
    )
    db.add(db_video)
    await db.commit()
    await db.refresh(db_video)

    # Queue video processing
    if CELERY_AVAILABLE and settings.CELERY_BROKER_URL.startswith(("amqp", "redis")):
        try:
            process_video_task.delay(db_video.id)
            print(f"Queued Celery job for video {db_video.id}")
        except Exception as e:
            print(f"Celery queue error: {e}. Running via FastAPI background thread.")
            from worker.pipeline.processing import run_pipeline_local
            background_tasks.add_task(run_pipeline_local, db_video.id)
    else:
        # Import execution loop dynamically
        from worker.pipeline.processing import run_pipeline_local
        background_tasks.add_task(run_pipeline_local, db_video.id)
        print(f"Running pipeline synchronously in background thread for video {db_video.id}")

    return db_video

# Helper function to generate UUID in route file
def uuid_generator():
    import uuid
    return uuid.uuid4()

@router.get("", response_model=List[VideoResponse])
async def list_videos(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Video).where(Video.user_id == current_user.id).order_by(Video.created_at.desc())
    )
    return result.scalars().all()

@router.get("/{video_id}", response_model=VideoResponse)
async def get_video(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.user_id == current_user.id)
    )
    video = result.scalars().first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    return video

@router.delete("/{video_id}", status_code=status.HTTP_200_OK)
async def delete_video(
    video_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Fetch video
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.user_id == current_user.id)
    )
    video = result.scalars().first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    
    # 1. Delete Qdrant vectors
    try:
        vector_db_service.delete_video_vectors(video_id)
    except Exception as e:
        print(f"Error purging vectors for {video_id}: {e}")

    # 2. Delete frame files from storage
    # Fetch frames to delete files
    from sqlalchemy.orm import selectinload
    result_frames = await db.execute(
        select(Frame).join(Scene).where(Scene.video_id == video_id)
    )
    frames = result_frames.scalars().all()
    for frame in frames:
        storage_service.delete_file(frame.storage_path)

    # 3. Delete raw video from storage
    storage_service.delete_file(video.storage_path)

    # 4. Remove relational database records (cascading triggers ondelete="CASCADE" for scenes, frames, transcript_segments)
    await db.delete(video)
    await db.commit()
    
    return {"status": "success", "message": "Video and all processed descriptors deleted successfully"}

@router.put("/{video_id}", response_model=VideoResponse)
async def rename_video(
    video_id: str,
    title: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    result = await db.execute(
        select(Video).where(Video.id == video_id, Video.user_id == current_user.id)
    )
    video = result.scalars().first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")
    video.title = title
    await db.commit()
    await db.refresh(video)
    return video

@router.post("/{video_id}/reprocess", status_code=status.HTTP_202_ACCEPTED)
async def reprocess_video(
    video_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    # Fetch video
    result = await db.execute(
        select(Video).where(Video.id == video_id)
    )
    video = result.scalars().first()
    if not video:
        raise HTTPException(status_code=404, detail="Video not found")

    # Clear old scene and transcript records to prevent duplicate keys
    from sqlalchemy import delete
    from backend.app.models.models import Scene, TranscriptSegment
    await db.execute(delete(Scene).where(Scene.video_id == video_id))
    await db.execute(delete(TranscriptSegment).where(TranscriptSegment.video_id == video_id))

    video.status = "PENDING"
    await db.commit()

    # Trigger processing inside active FastAPI background thread
    from worker.pipeline.processing import run_pipeline_local
    background_tasks.add_task(run_pipeline_local, video.id)
    
    return {"status": "processing", "message": "Video re-ingestion started inside server memory"}

@router.get("/stream/{filename:path}")
async def stream_media(filename: str):
    """
    Streams local media files from settings.LOCAL_STORAGE_PATH.
    This routes files when using the local storage engine.
    """
    clean_path = os.path.abspath(os.path.join(settings.LOCAL_STORAGE_PATH, filename))
    # Security check: prevent directory traversal attacks
    if not clean_path.startswith(os.path.abspath(settings.LOCAL_STORAGE_PATH)):
        raise HTTPException(status_code=403, detail="Access denied")
    
    if not os.path.exists(clean_path):
        raise HTTPException(status_code=404, detail="Media file not found")
        
    return FileResponse(clean_path)
