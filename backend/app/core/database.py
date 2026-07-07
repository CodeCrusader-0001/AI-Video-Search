from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base, sessionmaker
from backend.app.core.config import settings

# Async Database Engine & Session Maker (for FastAPI API routes)
async_engine = create_async_engine(
    settings.ASYNC_DATABASE_URL,
    echo=False,
    future=True,
    # SQLite-specific arguments (disable thread checks for async connections)
    connect_args={"check_same_thread": False} if settings.ASYNC_DATABASE_URL.startswith("sqlite") else {}
)
AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

# Sync Database Engine & Session Maker (for Celery workers & migration scripts)
# SQLite fallback database needs check_same_thread = False to be accessed across threads
sync_engine = create_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
)
SessionLocal = sessionmaker(
    bind=sync_engine,
    autocommit=False,
    autoflush=False
)

Base = declarative_base()

# FastAPI Dependency for async database sessions
async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

# Context manager or simple getter for Celery sync database sessions
def get_sync_db():
    db = SessionLocal()
    try:
        return db
    except Exception:
        db.close()
        raise
