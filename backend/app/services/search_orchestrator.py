import time
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from backend.app.core.models_cache import models_cache
from backend.app.services.vector_db import vector_db_service
from backend.app.services.storage import storage_service
from backend.app.models.models import Video, Scene, Frame, TranscriptSegment, DetectedObject
from backend.app.schemas.schemas import SearchResultItem

class SearchOrchestrator:
    @staticmethod
    async def search(
        db: AsyncSession,
        query: str,
        video_id: Optional[str] = None,
        top_k: int = 15
    ) -> List[SearchResultItem]:
        """
        Executes hybrid vector-keyword-object-speech search.
        """
        # 1. Generate text query embedding vector
        query_vector = models_cache.get_text_embedding(query)
        
        # 2. Visual Vector Search (Qdrant Dense Scan)
        vector_matches = vector_db_service.search_vectors(
            query_vector=query_vector,
            top_k=50,
            video_id=video_id
        )
        
        # Parse query terms for text/tag matching
        query_words = [w.lower().strip(",.?!") for w in query.split() if len(w) > 2]
        
        # 3. Object & Transcript Keyword Search (PostgreSQL matching)
        text_matches: Dict[str, Dict[str, Any]] = {}
        
        if query_words:
            # Query transcript segments matching words
            # SQL: select * from transcript_segments where segment_text like '%word%'
            # Simple fallback search compatible with SQLite/Postgres
            for word in query_words:
                # Transcripts search
                stmt_trans = select(TranscriptSegment).where(TranscriptSegment.segment_text.like(f"%{word}%"))
                if video_id:
                    stmt_trans = stmt_trans.where(TranscriptSegment.video_id == video_id)
                res_trans = await db.execute(stmt_trans)
                segments = res_trans.scalars().all()
                
                for seg in segments:
                    # Find frames under the matching scene
                    stmt_frames = select(Frame).where(Frame.scene_id == seg.scene_id)
                    res_frames = await db.execute(stmt_frames)
                    frames = res_frames.scalars().all()
                    for f in frames:
                        if f.id not in text_matches:
                            text_matches[f.id] = {"score": 0.0, "transcript": seg.segment_text, "matched_words": set()}
                        text_matches[f.id]["score"] += 0.2
                        text_matches[f.id]["matched_words"].add(word)

                # Object labels search
                stmt_obj = select(DetectedObject).where(DetectedObject.label.like(f"%{word}%"))
                res_obj = await db.execute(stmt_obj)
                objects = res_obj.scalars().all()
                for obj in objects:
                    # Fetch frame
                    stmt_f = select(Frame).where(Frame.id == obj.frame_id)
                    res_f = await db.execute(stmt_f)
                    f = res_f.scalars().first()
                    if f:
                        # Fetch scene to check video filter if needed
                        stmt_s = select(Scene).where(Scene.id == f.scene_id)
                        res_s = await db.execute(stmt_s)
                        s = res_s.scalars().first()
                        if video_id and s and s.video_id != video_id:
                            continue
                        
                        if f.id not in text_matches:
                            text_matches[f.id] = {"score": 0.0, "transcript": None, "matched_words": set()}
                        text_matches[f.id]["score"] += 0.3 * obj.confidence
                        text_matches[f.id]["matched_words"].add(word)

        # 4. Blend Vector & Text matches using weighted score combo
        blended_results: Dict[str, Dict[str, Any]] = {}
        
        # Add vector matches (weight = 0.7)
        for v in vector_matches:
            fid = v["frame_id"]
            blended_results[fid] = {
                "score": v["score"] * 0.7,
                "vector_score": v["score"],
                "text_score": 0.0,
                "transcript": None,
                "objects": v["objects"],
                "caption": v["caption"]
            }

        # Merge text/object matches (weight = 0.3)
        for fid, text_val in text_matches.items():
            if fid in blended_results:
                blended_results[fid]["score"] += text_val["score"] * 0.3
                blended_results[fid]["text_score"] = text_val["score"]
                if text_val["transcript"]:
                    blended_results[fid]["transcript"] = text_val["transcript"]
            else:
                blended_results[fid] = {
                    "score": text_val["score"] * 0.3,
                    "vector_score": 0.0,
                    "text_score": text_val["score"],
                    "transcript": text_val["transcript"],
                    "objects": [],
                    "caption": ""
                }

        # 5. Hydrate candidates with database records & sort
        sorted_candidates = sorted(blended_results.items(), key=lambda item: item[1]["score"], reverse=True)[:top_k]
        
        results: List[SearchResultItem] = []
        for fid, score_details in sorted_candidates:
            # Fetch frame and relationships
            stmt = select(Frame).where(Frame.id == fid).options(
                selectinload(Frame.scene).selectinload(Scene.video),
                selectinload(Frame.captions),
                selectinload(Frame.objects)
            )
            res = await db.execute(stmt)
            frame = res.scalars().first()
            if not frame or not frame.scene:
                continue

            scene = frame.scene
            video = scene.video
            
            # Map object tags list
            objects_list = [obj.label for obj in frame.objects]
            # Map best caption text
            caption_text = frame.captions[0].caption_text if frame.captions else score_details["caption"]
            
            # If no transcript segment matching, fetch the scene's transcript segment
            transcript_snippet = score_details["transcript"]
            if not transcript_snippet:
                stmt_ts = select(TranscriptSegment).where(TranscriptSegment.scene_id == scene.id).limit(1)
                res_ts = await db.execute(stmt_ts)
                ts = res_ts.scalars().first()
                if ts:
                    transcript_snippet = ts.segment_text
            
            # Generate temporary secure link for keyframe image
            image_url = storage_service.generate_presigned_url(frame.storage_path)

            results.append(
                SearchResultItem(
                    video_id=video.id,
                    video_title=video.title,
                    scene_id=scene.id,
                    start_time=scene.start_time,
                    end_time=scene.end_time,
                    frame_id=frame.id,
                    frame_image_url=image_url,
                    timestamp=frame.timestamp_seconds,
                    similarity_score=round(score_details["score"], 4),
                    caption=caption_text,
                    objects=objects_list or score_details["objects"],
                    transcript_snippet=transcript_snippet
                )
            )

        return results
