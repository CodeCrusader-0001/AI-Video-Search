import time
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.core.database import get_db
from backend.app.api.deps import get_current_user
from backend.app.models.models import User
from backend.app.schemas.schemas import SearchResponse
from backend.app.services.search_orchestrator import SearchOrchestrator

router = APIRouter()

@router.get("", response_model=SearchResponse)
async def hybrid_search(
    q: str = Query(..., min_length=1, description="Natural language search query"),
    video_id: Optional[str] = Query(None, description="Optional video ID to filter results"),
    top_k: int = Query(10, ge=1, le=100, description="Number of results to return"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    start_time = time.time()
    
    # Run hybrid query
    results = await SearchOrchestrator.search(
        db=db,
        query=q,
        video_id=video_id,
        top_k=top_k
    )
    
    latency_ms = (time.time() - start_time) * 1000.0
    
    return SearchResponse(
        query=q,
        results=results,
        latency_ms=round(latency_ms, 2)
    )
