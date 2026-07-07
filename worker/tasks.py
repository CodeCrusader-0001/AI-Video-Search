import os
import sys
# Make sure the backend directory is in the python path for importing modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from worker.config import celery_app
from worker.pipeline.processing import run_pipeline_local

@celery_app.task(name="worker.tasks.process_video_task", bind=True, max_retries=3)
def process_video_task(self, video_id: str):
    """
    Celery background worker entrypoint task to run the video ingestion pipeline.
    """
    print(f"Celery task received for video: {video_id}")
    try:
        run_pipeline_local(video_id)
    except Exception as exc:
        print(f"Task failed for video {video_id}, retrying...")
        raise self.retry(exc=exc, countdown=60)
