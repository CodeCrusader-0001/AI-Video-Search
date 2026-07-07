import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.app.core.config import settings
from backend.app.core.database import Base, sync_engine
from backend.app.api import auth, videos, search
from backend.app.services.vector_db import vector_db_service

from sqlalchemy import text

# Initialize database schema (SQLite/PostgreSQL fallback auto-creation)
try:
    Base.metadata.create_all(bind=sync_engine)
    # Auto-migration: Add progress tracking columns if they do not exist
    with sync_engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE videos ADD COLUMN progress INTEGER DEFAULT 0"))
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE videos ADD COLUMN progress_message VARCHAR(255) DEFAULT ''"))
        except Exception:
            pass
        conn.commit()
    print("Database tables initialized successfully")
except Exception as e:
    print(f"Warning: Database auto-initialization error: {e}")

# Initialize Vector DB Collections
try:
    vector_db_service.ensure_collection()
except Exception as e:
    print(f"Warning: Qdrant collection auto-initialization error: {e}")

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Production-grade AI Video Search Engine API Gateway",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# Set up CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Routers
app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["Authentication"])
app.include_router(videos.router, prefix=f"{settings.API_V1_STR}/videos", tags=["Videos"])
app.include_router(search.router, prefix=f"{settings.API_V1_STR}/search", tags=["Semantic Search"])

# Mount static frontend assets
app.mount("/static", StaticFiles(directory="c:/Users/ashis/Music/Desktop/A/frontend"), name="static")

# Route root to serve the SPA landing index page
@app.get("/")
def read_root():
    return FileResponse("c:/Users/ashis/Music/Desktop/A/frontend/index.html")

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse("c:/Users/ashis/Music/Desktop/A/frontend/favicon.ico")

if __name__ == "__main__":
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
