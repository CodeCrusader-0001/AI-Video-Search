import os
import time
import subprocess
import tempfile
import cv2
from PIL import Image
from sqlalchemy.orm import Session
from backend.app.core.database import get_sync_db
from backend.app.core.config import settings
from backend.app.models.models import Video, Scene, Frame, FrameCaption, DetectedObject, TranscriptSegment
from backend.app.services.storage import storage_service
from backend.app.services.vector_db import vector_db_service
from worker.pipeline.models import pipeline_models

def run_pipeline_local(video_id: str) -> None:
    """
    Executes the ingestion pipeline on a video file.
    """
    db: Session = get_sync_db()
    video = db.query(Video).filter(Video.id == video_id).first()
    if not video:
        print(f"Error: Video {video_id} not found in database.")
        db.close()
        return

    print(f"Starting pipeline execution for video: {video.title} (ID: {video_id})")
    video.status = "PROCESSING"
    db.commit()

    temp_video_path = None
    temp_audio_path = None
    
    try:
        # 1. Download video file if remote, or resolve local path
        if video.storage_path.startswith("s3://"):
            temp_video = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            temp_video_path = temp_video.name
            temp_video.close()
            print(f"Downloading video from S3 to temp path: {temp_video_path}")
            storage_service.download_file(video.storage_path, temp_video_path)
        else:
            temp_video_path = video.storage_path
            if not os.path.exists(temp_video_path):
                raise FileNotFoundError(f"Local video file not found at: {temp_video_path}")

        # 2. Get Video Metadata (duration)
        cap = cv2.VideoCapture(temp_video_path)
        if not cap.isOpened():
            raise RuntimeError("Could not open video file via OpenCV")
        
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = int(frame_count / fps)
        video.duration_seconds = duration
        video.progress = 10
        video.progress_message = "Segmenting video into scenes..."
        db.commit()
        print(f"Video loaded: duration={duration}s, FPS={fps}, total_frames={frame_count}")

        # 3. Scene Detection
        scenes = []
        try:
            from scenedetect import detect, ContentDetector
            print("Running PySceneDetect content analysis...")
            scene_list = detect(temp_video_path, ContentDetector(threshold=27.0))
            for idx, (start, end) in enumerate(scene_list):
                scenes.append({
                    "index": idx,
                    "start": start.get_seconds(),
                    "end": end.get_seconds()
                })
            print(f"PySceneDetect segmented video into {len(scenes)} scenes")
        except Exception as e:
            print(f"PySceneDetect skipped or failed: {e}. Falling back to uniform sampling.")
            
        if not scenes:
            print("No scenes detected or analysis failed. Falling back to uniform sampling.")
            # Fallback: create 6-second uniform scenes
            scene_len = 6.0
            num_scenes = max(1, int(duration / scene_len))
            for idx in range(num_scenes):
                scenes.append({
                    "index": idx,
                    "start": idx * scene_len,
                    "end": min(duration, (idx + 1) * scene_len)
                })

        # Save Scene Records and extract keyframes
        db_scenes = []
        db_frames = []
        qdrant_points = []
        
        total_scenes = len(scenes)
        video.progress = 20
        video.progress_message = f"Segmented into {total_scenes} scenes. Starting scene analysis..."
        db.commit()
        
        for idx, scene_data in enumerate(scenes):
            percent = int(20 + (70 * (idx + 1) / total_scenes))
            video.progress = percent
            video.progress_message = f"Analyzing scene {idx + 1}/{total_scenes} (BLIP + YOLO)..."
            db.commit()
            
            db_scene = Scene(
                video_id=video_id,
                start_time=scene_data["start"],
                end_time=scene_data["end"],
                scene_index=scene_data["index"]
            )
            db.add(db_scene)
            db.flush() # Populate db_scene.id
            db_scenes.append(db_scene)

            # Keyframe selection: midpoint of scene
            midpoint_time = (scene_data["start"] + scene_data["end"]) / 2.0
            midpoint_frame = int(midpoint_time * fps)
            
            # Extract keyframe using OpenCV
            cap.set(cv2.CAP_PROP_POS_FRAMES, midpoint_frame)
            success, img_frame = cap.read()
            if success:
                # Save keyframe image to temp file
                temp_img = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
                temp_img_path = temp_img.name
                temp_img.close()
                
                cv2.imwrite(temp_img_path, img_frame)
                
                # Upload frame file to storage
                frame_id = str(uuid_generator())
                frame_storage_key = f"frames/{video_id}/{frame_id}.jpg"
                final_frame_path = storage_service.upload_file(temp_img_path, frame_storage_key)
                
                # Remove local temp image
                if os.path.exists(temp_img_path):
                    os.remove(temp_img_path)

                db_frame = Frame(
                    id=frame_id,
                    scene_id=db_scene.id,
                    storage_path=final_frame_path,
                    timestamp_seconds=midpoint_time,
                    frame_index=midpoint_frame
                )
                db.add(db_frame)
                db.flush() # Populate db_frame.id
                db_frames.append(db_frame)
                
                # Process visual models on keyframe image
                pil_image = Image.fromarray(cv2.cvtColor(img_frame, cv2.COLOR_BGR2RGB))
                
                # A. Run Image Captioning
                caption = pipeline_models.generate_caption(pil_image)
                db_caption = FrameCaption(
                    frame_id=frame_id,
                    caption_text=caption,
                    confidence=1.0
                )
                db.add(db_caption)
                
                # B. Run Object Detection
                detected_objects = pipeline_models.detect_objects(pil_image)
                object_labels = []
                for obj in detected_objects:
                    db_obj = DetectedObject(
                        frame_id=frame_id,
                        label=obj["label"],
                        confidence=obj["confidence"],
                        bounding_box=obj["bbox"]
                    )
                    db.add(db_obj)
                    object_labels.append(obj["label"])
                
                # C. Compute SigLIP dense vector embedding
                embedding = pipeline_models.compute_image_embedding(pil_image)
                
                # Stage point for Qdrant batch indexing
                qdrant_points.append({
                    "id": frame_id,
                    "vector": embedding,
                    "payload": {
                        "video_id": video_id,
                        "scene_id": db_scene.id,
                        "timestamp": midpoint_time,
                        "objects": list(set(object_labels)),
                        "caption": caption
                    }
                })

        cap.release()
        
        # 4. Audio Demuxing & Speech Transcription
        video.progress = 95
        video.progress_message = "Extracting audio and transcribing speech (Whisper)..."
        db.commit()
        # Extract audio track to temporary WAV file (16kHz mono)
        temp_audio = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        temp_audio_path = temp_audio.name
        temp_audio.close()
        
        print("Extracting audio stream using FFmpeg...")
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", temp_video_path,
            "-vn",
            "-ac", "1",
            "-ar", "16000",
            temp_audio_path
        ]
        
        try:
            # Hide subprocess console window on Windows to run silently
            startupinfo = None
            if os.name == 'nt':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            
            subprocess.run(ffmpeg_cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, startupinfo=startupinfo)
            print("Audio extraction successful. Running speech transcribing pipeline...")
            
            # Run Whisper speech model
            transcript_segments = pipeline_models.run_transcription(temp_audio_path)
            
            for seg in transcript_segments:
                # Find matching scene overlapping the segment center
                seg_center = (seg["start"] + seg["end"]) / 2.0
                matched_scene_id = None
                
                for s in db_scenes:
                    if s.start_time <= seg_center <= s.end_time:
                        matched_scene_id = s.id
                        break
                
                db_seg = TranscriptSegment(
                    video_id=video_id,
                    scene_id=matched_scene_id,
                    segment_text=seg["text"],
                    start_time=seg["start"],
                    end_time=seg["end"]
                )
                db.add(db_seg)
                
            print(f"Transcribed {len(transcript_segments)} speech segments")
        except Exception as ae:
            print(f"Speech transcription skipped/failed (FFmpeg or model error): {ae}")

        # 5. Commit all records to PostgreSQL / SQLite
        db.commit()
        print("Relational metadata successfully committed to database.")

        # 6. Index visual embeddings into Qdrant
        if qdrant_points:
            print(f"Indexing {len(qdrant_points)} frame embeddings into Qdrant database...")
            vector_db_service.upsert_frame_vectors(qdrant_points)
            print("Vector indexing completed.")

        # Mark video processing completed
        video.progress = 100
        video.progress_message = "Ingestion completed successfully"
        video.status = "COMPLETED"
        db.commit()
        print(f"Pipeline executed successfully for video {video_id}.")
        
    except Exception as e:
        db.rollback()
        video.progress = 100
        video.progress_message = f"Failed: {str(e)}"
        video.status = "FAILED"
        db.commit()
        print(f"Pipeline execution failed for video {video_id}. Error: {e}")
        import traceback
        traceback.print_exc()
        
    finally:
        # Cleanup temporary files
        if temp_video_path and video.storage_path.startswith("s3://") and os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        if temp_audio_path and os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
        db.close()

# Helper function to generate UUID
def uuid_generator() -> str:
    import uuid
    return str(uuid.uuid4())
