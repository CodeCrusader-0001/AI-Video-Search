import os
import sys
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Ensure workspace is in Python path for test execution
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.app.core.config import settings

# Set up test database environment (use clean SQLite for tests) BEFORE database engines are created
settings.DATABASE_URL = "sqlite:///c:/Users/ashis/Music/Desktop/A/video_search_test.db"
settings.ASYNC_DATABASE_URL = "sqlite+aiosqlite:///c:/Users/ashis/Music/Desktop/A/video_search_test.db"
settings.QDRANT_URL = ":memory:"

from backend.app.main import app
from backend.app.core.database import Base, sync_engine

@pytest.fixture(scope="module", autouse=True)
def setup_test_db():
    # Setup database schemas before running tests
    Base.metadata.drop_all(bind=sync_engine)
    Base.metadata.create_all(bind=sync_engine)
    yield
    # Cleanup database files after tests complete
    Base.metadata.drop_all(bind=sync_engine)
    sync_engine.dispose()
    db_file = "c:/Users/ashis/Music/Desktop/A/video_search_test.db"
    if os.path.exists(db_file):
        try:
            os.remove(db_file)
        except PermissionError:
            pass  # Suppress lock warnings on Windows; the file will be dropped/recreated on the next run anyway

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_auth_workflow(client):
    # 1. Register guest user
    register_payload = {
        "email": "test_user@aura.ai",
        "password": "securepassword123"
    }
    response = client.post("/api/v1/auth/register", json=register_payload)
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "test_user@aura.ai"
    assert "id" in data
    
    # 2. Login to get JWT Token
    login_payload = {
        "username": "test_user@aura.ai",
        "password": "securepassword123"
    }
    response = client.post("/api/v1/auth/login", data=login_payload)
    assert response.status_code == 200
    token_data = response.json()
    assert "access_token" in token_data
    assert token_data["token_type"] == "bearer"

@patch("worker.pipeline.models.pipeline_models.generate_caption")
@patch("worker.pipeline.models.pipeline_models.detect_objects")
@patch("worker.pipeline.models.pipeline_models.compute_image_embedding")
@patch("worker.pipeline.models.pipeline_models.run_transcription")
@patch("scenedetect.detect")
@patch("worker.pipeline.processing.subprocess.run")
def test_video_upload_and_search_workflow(
    mock_subrun,
    mock_detect,
    mock_transcription,
    mock_embedding,
    mock_objects,
    mock_caption,
    client
):
    # Setup pipeline mocks
    mock_subrun.return_value = MagicMock(returncode=0)
    mock_detect.side_effect = Exception("Mock detect error")
    mock_caption.return_value = "A person typing code on a laptop computer"
    mock_objects.return_value = [{"label": "laptop", "confidence": 0.95, "bbox": [10, 20, 100, 200]}]
    mock_embedding.return_value = [0.1] * 768  # 768-dim SigLIP mock vector
    mock_transcription.return_value = [{"text": "here is a speech segment containing gradient descent details", "start": 0.0, "end": 4.0}]
    
    # Get Auth Token
    login_payload = {
        "username": "test_user@aura.ai",
        "password": "securepassword123"
    }
    auth_res = client.post("/api/v1/auth/login", data=login_payload)
    token = auth_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # Create a mock video file content
    mock_video_content = b"fake video content mp4 data streams"
    
    # Upload video
    files = {"file": ("demo_video.mp4", mock_video_content, "video/mp4")}
    upload_res = client.post("/api/v1/videos/upload?title=DemoVideo", files=files, headers=headers)
    assert upload_res.status_code == 201
    video_data = upload_res.json()
    assert video_data["title"] == "DemoVideo"
    assert video_data["status"] == "PENDING"
    video_id = video_data["id"]
    
    # Run the processing pipeline locally (simulating the background task synchronously)
    from worker.pipeline.processing import run_pipeline_local
    
    # Mock cv2 VideoCapture to simulate a 10-second video with 1 scene
    import numpy as np
    mock_frame = np.zeros((100, 100, 3), dtype=np.uint8)
    with patch("cv2.VideoCapture") as mock_cap:
        instance = mock_cap.return_value
        instance.isOpened.return_value = True
        instance.get.side_effect = lambda prop: 30.0 if prop == 5 else (300 if prop == 7 else 0.0) # FPS=30, Frames=300
        instance.read.return_value = (True, mock_frame) # Return success and mock image frame
        
        # Run local ingestion
        run_pipeline_local(video_id)
        
    # Check video status updated to COMPLETED in database
    get_video_res = client.get(f"/api/v1/videos/{video_id}", headers=headers)
    assert get_video_res.status_code == 200
    assert get_video_res.json()["status"] == "COMPLETED"
    
    # Run Search Query
    # Mock the text embedding generation in search router
    with patch("backend.app.core.models_cache.models_cache.get_text_embedding") as mock_text_emb:
        mock_text_emb.return_value = [0.1] * 768
        
        search_res = client.get("/api/v1/search?q=gradient+descent", headers=headers)
        assert search_res.status_code == 200
        search_data = search_res.json()
        assert "results" in search_data
        assert len(search_data["results"]) > 0
        
        # Assert result fields match expectations
        first_result = search_data["results"][0]
        assert first_result["video_title"] == "DemoVideo"
        assert "laptop" in first_result["objects"]
        assert "gradient descent" in first_result["transcript_snippet"]
        assert first_result["similarity_score"] > 0
