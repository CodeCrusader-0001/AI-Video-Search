from typing import List, Dict, Any, Optional
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from backend.app.core.config import settings

class VectorDBService:
    def __init__(self):
        # Initializes in-memory client or connects to a Qdrant host
        if settings.is_qdrant_memory:
            import os
            os.makedirs(settings.qdrant_local_path, exist_ok=True)
            self.client = QdrantClient(path=settings.qdrant_local_path)
            print(f"VectorDBService initialized using local persistent Qdrant client at {settings.qdrant_local_path}")
        else:
            self.client = QdrantClient(
                url=settings.QDRANT_URL,
                api_key=settings.QDRANT_API_KEY
            )
            print(f"VectorDBService connected to Qdrant at: {settings.QDRANT_URL}")
        
        self.collection_name = settings.QDRANT_COLLECTION_NAME
        # SigLIP base patch16 224 returns 768-dimensional embeddings
        self.vector_dim = 768 
        self.ensure_collection()

    def ensure_collection(self) -> None:
        """
        Creates the target collection in Qdrant if it does not already exist.
        """
        try:
            collections = self.client.get_collections().collections
            exists = any(c.name == self.collection_name for c in collections)
            
            if not exists:
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=self.vector_dim,
                        distance=Distance.COSINE
                    )
                )
                print(f"Created vector collection '{self.collection_name}' in Qdrant (Dim: {self.vector_dim})")
        except Exception as e:
            print(f"Warning: Failed to verify/create Qdrant collection: {e}")

    def upsert_frame_vectors(self, points: List[Dict[str, Any]]) -> None:
        """
        Upserts multiple frame vectors with associated payloads to Qdrant.
        Each point dict contains:
            - id: str (UUID of the Frame)
            - vector: list[float] (768-dim SigLIP representation)
            - payload: dict (video_id, scene_id, timestamp, objects, caption)
        """
        qdrant_points = []
        for p in points:
            qdrant_points.append(
                PointStruct(
                    id=p["id"],
                    vector=p["vector"],
                    payload=p["payload"]
                )
            )
        
        if qdrant_points:
            self.client.upsert(
                collection_name=self.collection_name,
                wait=True,
                points=qdrant_points
            )

    def search_vectors(self, 
                       query_vector: List[float], 
                       top_k: int = 50, 
                       video_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Queries Qdrant for similar frame embeddings. Can filter results to a specific video.
        """
        search_filter = None
        if video_id:
            search_filter = Filter(
                must=[
                    FieldCondition(
                        key="video_id",
                        match=MatchValue(value=video_id)
                    )
                ]
            )

        results = self.client.query_points(
            collection_name=self.collection_name,
            query=query_vector,
            limit=top_k,
            query_filter=search_filter,
            with_payload=True
        )

        output = []
        for r in results.points:
            output.append({
                "frame_id": r.id,
                "score": r.score,
                "video_id": r.payload.get("video_id"),
                "scene_id": r.payload.get("scene_id"),
                "timestamp": r.payload.get("timestamp"),
                "objects": r.payload.get("objects", []),
                "caption": r.payload.get("caption", "")
            })
        return output

    def delete_video_vectors(self, video_id: str) -> None:
        """
        Removes all vectors belonging to a specific video ID.
        """
        self.client.delete(
            collection_name=self.collection_name,
            points_selector=Filter(
                must=[
                    FieldCondition(
                        key="video_id",
                        match=MatchValue(value=video_id)
                    )
                ]
            )
        )

# Global Vector database instance
vector_db_service = VectorDBService()
