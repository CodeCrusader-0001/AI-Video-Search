# AURA — Multimodal AI Video Search Engine: System Architecture Design

This document details the production-grade architecture design of the **AURA Multimodal AI Video Search Engine**. The system is built for high-throughput video ingestion, parallelized CUDA deep learning model inference, hybrid retrieval indexing, and low-latency query reranking.

---

## 1. High-Level System Architecture

AURA separates synchronous HTTP request serving from heavy GPU neural-network inference using a message broker and asynchronous execution queues.

```
                  ┌────────────────────────────────────────┐
                  │          Internet (Client SPA)         │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼ [HTTPS / WSS / API]
                  ┌────────────────────────────────────────┐
                  │             Nginx Gateway              │
                  └───────────────────┬────────────────────┘
                                      │
                                      ▼ [Load Balanced]
                  ┌────────────────────────────────────────┐
                  │            FastAPI Gateway             │
                  └────────┬──────────┬──────────┬─────────┘
                           │          │          │
        [Metadata Storage] │          │          │ [Object Storage]
                           ▼          │          ▼
            ┌──────────────┴───┐      │      ┌───┴──────────────┐
            │    PostgreSQL    │      │      │  AWS S3 Bucket   │
            │  Relational DB   │      │      │  (Raw & Frames)  │
            └──────────────────┘      │      └──────────────────┘
                                      ▼ [Job Dispatcher]
                  ┌────────────────────────────────────────┐
                  │          Redis Message Queue           │
                  └────────┬────────────────────┬──────────┘
                           │                    │
                           ▼ [Parallel CUDA]    ▼ [Parallel CUDA]
                  ┌────────┴─────────┐    ┌─────┴────────────┐
                  │  Celery Worker 0 │    │  Celery Worker 1 │
                  │  (GPU Device 0)  │    │  (GPU Device 1)  │
                  └────────┬─────────┘    └─────┬────────────┘
                           │                    │
                           └──────────┬─────────┘
                                      ▼ [Embedding Inserts]
                  ┌────────────────────────────────────────┐
                  │             Qdrant Vector             │
                  │            Database Index            │
                  └────────────────────────────────────────┘
```

---

## 2. Asynchronous Video Ingestion Sequence Diagram

The following sequence details how the system ingests a video, offloads heavy deep learning processes asynchronously, and streams updates back to the database.

```mermaid
sequenceDiagram
    autonumber
    actor User as Client Dashboard
    participant API as FastAPI Gateway
    participant S3 as AWS S3 Storage
    participant DB as PostgreSQL DB
    participant Queue as Redis Queue
    participant Worker as Celery GPU Worker
    participant Qdrant as Qdrant Vector DB

    User->>API: POST /api/v1/videos/upload (Multipart File)
    activate API
    API->>S3: Upload raw video file (Signed PUT/Multipart)
    S3-->>API: File URI (e.g. s3://bucket/video_uuid.mp4)
    API->>DB: INSERT into videos (status=PENDING, progress=0)
    API->>Queue: Push job 'process_video_pipeline(video_id)'
    API-->>User: 202 Accepted (video_id, status=PENDING)
    deactivate API

    Note over Worker: Worker continuously polls Redis
    Queue->>Worker: Dispatch 'process_video_pipeline(video_id)'
    activate Worker
    Worker->>DB: UPDATE videos (status=PROCESSING, progress=5)
    
    %% Scene detection
    Worker->>Worker: Run PySceneDetect (HSV Color Space Histogram)
    Worker->>DB: INSERT scenes (timestamps & metadata)
    
    %% Frame extraction
    Worker->>Worker: Extract Keyframes (JPEG)
    Worker->>S3: Upload keyframes to S3
    
    %% AI Inference
    par Vision Models
        Worker->>Worker: Run Google SigLIP (768-dim Visual Embeddings)
        Worker->>Qdrant: Batch Insert Visual Vectors
    and
        Worker->>Worker: Run Florence-2/BLIP-2 (Auto visual captioning)
        Worker->>DB: INSERT frame_captions
    and
        Worker->>Worker: Run YOLOv11 Object Detection (labels & boxes)
        Worker->>DB: INSERT detected_objects
    and
        Worker->>Worker: Run PaddleOCR/EasyOCR (Frame text extraction)
        Worker->>DB: INSERT ocr_text
    end
    
    %% Audio Inference
    Worker->>Worker: Run OpenAI Whisper ASR (Speech transcription & timestamps)
    Worker->>DB: INSERT transcript_segments

    Worker->>DB: UPDATE videos (status=COMPLETED, progress=100)
    deactivate Worker
```

---

## 3. Database Layer: Entity-Relationship Schema (PostgreSQL)

This schema represents the production PostgreSQL design, which extends the SQLite schema with OCR content, text indices, job tracking, and authentication tables.

```mermaid
erDiagram
    users {
        uuid id PK
        string email UK
        string hashed_password
        boolean is_active
        timestamp created_at
    }
    
    videos {
        uuid id PK
        uuid user_id FK
        string title
        string storage_path
        integer duration_seconds
        string status
        integer progress
        string progress_message
        timestamp created_at
    }

    processing_jobs {
        uuid id PK
        uuid video_id FK
        string status
        string worker_id
        integer retry_count
        string error_log
        timestamp updated_at
    }

    scenes {
        uuid id PK
        uuid video_id FK
        float start_time
        float end_time
        integer scene_index
    }

    frames {
        uuid id PK
        uuid scene_id FK
        string storage_path
        float timestamp_seconds
        integer frame_index
    }

    frame_captions {
        uuid id PK
        uuid frame_id FK
        string caption_text
        float confidence
    }

    ocr_text {
        uuid id PK
        uuid frame_id FK
        string ocr_content
        json bounding_boxes
        float confidence
    }

    detected_objects {
        uuid id PK
        uuid frame_id FK
        string label
        float confidence
        json bounding_box
    }

    transcript_segments {
        uuid id PK
        uuid video_id FK
        uuid scene_id FK
        string segment_text
        string language
        float start_time
        float end_time
    }

    search_history {
        uuid id PK
        uuid user_id FK
        string query_text
        float latency_ms
        timestamp timestamp
        json results_json
    }

    users ||--o{ videos : owns
    videos ||--o{ processing_jobs : logs
    videos ||--o{ scenes : contains
    videos ||--o{ transcript_segments : has
    scenes ||--o{ frames : has
    scenes ||--o{ transcript_segments : contains
    frames ||--o{ frame_captions : describes
    frames ||--o{ ocr_text : has
    frames ||--o{ detected_objects : visualizes
    users ||--o{ search_history : queries
```

---

## 4. Multi-Modal AI Processing Pipeline

AURA's inference worker is built for batched CUDA pipeline execution to prevent GPU context switching overheads.

```
                      ┌────────────────────────┐
                      │    Raw Video Stream    │
                      └───────────┬────────────┘
                                  │
                                  ▼
                      ┌────────────────────────┐
                      │     PySceneDetect      │ (Scene segment boundaries)
                      └───────────┬────────────┘
                                  │
                                  ▼
                      ┌────────────────────────┐
                      │   Keyframe Extractor   │ (Representational JPEGs)
                      └─────┬────────────┬─────┘
                            │            │
            ┌───────────────┘            └───────────────┐
            ▼ (Audio Track)                              ▼ (Visual Frames)
┌───────────────────────┐                    ┌───────────────────────┐
│  OpenAI Whisper ASR   │                    │      SigLIP Base      │ (768-dim Visual
│ (Speech-to-text cuts) │                    │  (Google Patch16-224) │  dense vectors)
└───────────┬───────────┘                    └───────────┬───────────┘
            │                                            │
            ▼                                            ▼
┌───────────────────────┐                    ┌───────────────────────┐
│ Multilingual Rerank   │                    │     Florence-2 /      │ (Detailed natural
│   (Language Translate)│                    │        BLIP-2         │  scene summaries)
└───────────┬───────────┘                    └───────────┬───────────┘
            │                                            │
            │                                            ▼
            │                                ┌───────────────────────┐
            │                                │       YOLOv11         │ (Visual object
            │                                │  (Object Detections)  │  boundary boxes)
            │                                └───────────┬───────────┘
            │                                            │
            │                                            ▼
            │                                ┌───────────────────────┐
            │                                │ PaddleOCR / EasyOCR   │ (Text extracted
            │                                │  (Video frame text)   │  from scenes)
            │                                └───────────┬───────────┘
            │                                            │
            ▼                                            ▼
┌────────────────────────────────────────────────────────────────────┐
│                       Search Orchestrator                          │
│        (Metadata Ingestion to PostgreSQL & Vectors to Qdrant)      │
└────────────────────────────────────────────────────────────────────┘
```

---

## 5. Hybrid Search & Reranking Sequence Diagram

To resolve multi-modal retrieval matching, AURA implements **Hybrid Search** with a weighted score calculation, utilizing **Reciprocal Rank Fusion (RRF)** and an optional **Cross-Encoder Reranker**.

```mermaid
sequenceDiagram
    autonumber
    actor User as Client Dashboard
    participant API as FastAPI Gateway
    participant SO as Search Orchestrator
    participant Qdrant as Qdrant Vector DB
    participant DB as PostgreSQL DB
    participant Cross as Cross-Encoder

    User->>API: GET /api/v1/search?q="man in red shirt"&video_id=uuid
    activate API
    API->>SO: Execute Hybrid Retrieval (query="man in red shirt")
    activate SO
    
    par Vector Search
        SO->>SO: Encode query via SigLIP Text Encoder (768-dim)
        SO->>Qdrant: Query Cosine Similarity
        Qdrant-->>SO: Visual Hits (Result Set A: [ID, Score])
    and Semantic Text Search
        SO->>DB: Scan transcripts & captions (Full-Text Search)
        DB-->>SO: Text Hits (Result Set B: [ID, Score])
    and Object Tags & OCR
        SO->>DB: Query YOLO objects & OCR text tags
        DB-->>SO: Entity Hits (Result Set C: [ID, Score])
    end

    SO->>SO: Combine matches using Reciprocal Rank Fusion (RRF)
    Note over SO: RRF Score = Sum( 1 / (60 + Rank_i) )
    SO->>SO: Dynamic weights (Visual 0.5, Audio 0.3, Objects 0.1, OCR 0.1)

    %% Optional reranker
    rect rgba(110, 91, 255, 0.05)
        Note over SO, Cross: Optional Reranking Step
        SO->>Cross: Send top candidates + query
        Cross-->>SO: Re-scored & sorted candidates
    end

    SO->>DB: Fetch detailed scene/video metadata
    DB-->>SO: Database results metadata
    SO-->>API: Unified results payload
    deactivate SO
    API-->>User: Renders top-3 matches in Results Feed
    deactivate API
```

---

## 6. Technology Justification

| Technology | Production Alternative | Reason for Selection |
| :--- | :--- | :--- |
| **FastAPI** | Express.js / Django | Native asynchronous async/await event loops, typing validation via Pydantic, and automatic Swagger generation. |
| **Celery + Redis** | RabbitMQ / AWS SQS | Celery handles distributed Python code execution natively. Redis works both as a high-speed message broker and status database cache. |
| **PostgreSQL** | SQLite / MySQL | Supports production-level concurrent writing, ACID transactional guarantees, JSONB fields for YOLO coordinate storage, and pg_trgm for full-text search. |
| **Qdrant** | Pinecone / Milvus | Open-source, rust-based, supports payload filtering directly during vector scan, and includes in-memory mode for fast testing. |
| **SigLIP** | CLIP (OpenAI) | Google's SigLIP uses a sigmoid loss that optimizes image-text pairs individually, showing higher retrieval accuracy on complex descriptions. |
| **Florence-2** | BLIP-1 | Unified visual-language transformer. Generates highly descriptive image captions, coordinates OCR boundary tags, and localizes visual regions. |
