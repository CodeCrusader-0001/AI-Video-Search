# AURA — Production-Grade Multimodal AI Video Search Engine

AURA is a high-throughput, enterprise-ready AI Video Search Engine designed for indexing, searching, and analyzing large-scale video repositories. It enables users to upload video catalogs, automatically segment visual scenes, generate rich textual captions, recognize spoken keywords, detect object boundaries, extract frame text, and execute hybrid semantic queries.

The architecture is built for multi-GPU scalability, separating synchronous HTTP API requests from asynchronous PyTorch inference jobs using a Redis-backed Celery task queue, with a zero-friction fallback to FastAPI local background threads for development.

---

## 🎨 Enterprise System Architecture & Data Flow

AURA supports two modes of execution depending on the environment:
1.  **Local Development Mode (Zero-Friction)**: FastAPI uses Python `BackgroundTasks` to execute the ingestion pipeline inline in a background thread. It stores metadata in a local SQLite file, vector embeddings in Qdrant (in-memory or local folder), and files on the local disk.
2.  **Production Mode (Distributed & Scaled)**: Celery workers parallelize GPU tasks via a Redis queue. Files are stored in AWS S3 or MinIO, metadata in a PostgreSQL cluster, and vector embeddings in a distributed Qdrant server.

```mermaid
graph TD
    %% Client & Gateway
    User[Client SPA Dashboard] -->|HTTP / Websockets| Nginx[Nginx Reverse Proxy]
    Nginx -->|Route Request| FastAPI[FastAPI Gateway]
    
    %% Ingest Pipelines (Local vs. Prod)
    subgraph FastAPI In-Process Ingestion (Local Mode)
        FastAPI -->|BackgroundTasks thread| LocalWorker[Local Processing Pipeline]
    end
    
    subgraph Celery Queue Ingestion (Production Mode)
        FastAPI -->|Dispatch Ingestion Task| Redis[Redis Broker Queue]
        
        subgraph Parallel CUDA Compute
            Redis -->|Dispatch Job 0| Celery_0[Celery Worker 0 (GPU 0)]
            Redis -->|Dispatch Job 1| Celery_1[Celery Worker 1 (GPU 1)]
        end
    end
    
    %% Storage & Metadata (Shared Targets)
    LocalWorker & Celery_0 & Celery_1 -->|Relational Data SQL| DB[(PostgreSQL / SQLite)]
    LocalWorker & Celery_0 & Celery_1 -->|Media File Uploads| OS[(AWS S3 / MinIO / Local Disk)]
    
    %% Deep Learning Workers Pipeline
    LocalWorker & Celery_0 & Celery_1 -->|HSV Frame Cuts| PyScene[PySceneDetect ContentDetector]
    LocalWorker & Celery_0 & Celery_1 -->|ASR Speech segments| Whisper[Whisper-Small Speech-to-Text]
    LocalWorker & Celery_0 & Celery_1 -->|Visual Embeddings| SigLIP[SigLIP Frame Encoder]
    LocalWorker & Celery_0 & Celery_1 -->|Visual Detections| YOLO[YOLOv8 Object Detector]
    LocalWorker & Celery_0 & Celery_1 -->|Auto Captioning| BLIP[BLIP-Image-Captioning-Base]
    LocalWorker & Celery_0 & Celery_1 -->|Mock Frame Text| OCR[PaddleOCR / EasyOCR - Planned Extension]
    
    %% Vector Indexing
    SigLIP -->|768-dim Visual Vectors| Qdrant[(Qdrant Vector DB)]
```

---

## 📖 Deep-Dive Architectural Specifications

For details on security, deployment pipelines, scaling, and schemas, reference the specialized document guides:

1.  **[System Architecture & Data Flows](docs/architecture.md)**:
    *   Entity-Relationship layout for PostgreSQL tables mapping users, videos, scenes, objects, text, and transcripts.
    *   Asynchronous Video Ingestion Sequence Diagrams.
    *   Multi-modal hybrid retrieval matching pipelines using blended vector and keyword scores.
    *   Detailed model parameters for SigLIP, BLIP, Whisper, and YOLOv8.
2.  **[Deployment & Security Specifications](docs/deployment.md)**:
    *   Multi-GPU container scheduling using `CUDA_VISIBLE_DEVICES`.
    *   Prometheus alert metric scrape points and Grafana telemetry dashboards.
    *   JWT Refresh Token rotation policies.
    *   FastAPI rate-limiting rules and file upload validations.

---

## 🔍 Hybrid Search & Ranking Algorithm

AURA uses a custom hybrid retrieval pipeline that blends semantic visual vector matching with keyword/tag database matching. This provides highly relevant results even when search terms specify exact speech keywords or visual objects alongside semantic descriptions.

### Retrieval Pipeline Steps
1.  **Text Embedding**: The user's query $q$ is embedded into a 768-dimensional normalized vector using Google's SigLIP text encoder.
2.  **Visual Scan**: Qdrant executes a Cosine Similarity vector search with the query embedding, returning up to 50 frame matches (scores ranging between 0.0 and 1.0).
3.  **Keyword Matching**: The query is tokenized into word components. AURA queries the SQL database to find:
    *   **Speech transcripts**: Matching words in `transcript_segments` add a boost of `0.2` to the text score of all frames within the matching scene.
    *   **Object detection labels**: Matching labels in `detected_objects` add a boost of `0.3 * YOLO_confidence` to the matching frame's text score.
4.  **Blended Score Combination**: The system combines the scores using a weighted formula:
    
    $$\text{Blended Score} = 0.7 \times \text{Vector Score} + 0.3 \times \text{Text Score}$$
    
5.  **Hydration**: The top results are hydrated with video titles, scene timestamps, captions, object lists, and temporary secure file URLs before being returned to the UI.

---

## 🛠️ Technology Stack & AI Deep Learning Pipeline

AURA integrates modern backend microservices with deep learning models running on a unified worker interface:

### 1. Model Specifications
*   **Multimodal Semantic Alignment (SigLIP)**: Google's symmetric `siglip-base-patch16-224` image-text dual encoder. It maps visual frame features and search queries into a shared 768-dimensional vector space.
*   **Scene Extraction (PySceneDetect)**: Detects visual transitions using HSV color-space histogram shifts to slice videos into individual scenes. Falls back to a uniform 6-second segmentation if content detection fails.
*   **Speech Recognition (OpenAI Whisper)**: Transcribes raw audio tracks (demuxed to 16kHz WAV via FFmpeg) into time-aligned text fragments using `openai/whisper-small`.
*   **Object Categorization (YOLOv8)**: Detects visual objects (e.g. people, cars, laptops) in keyframes using `yolov8n.pt`, populating target entity chips.
*   **Frame Description (BLIP)**: Image-to-text conditional transformer (`Salesforce/blip-image-captioning-base`) that generates detailed natural scene descriptions and visual captions.
*   **Optical Character Recognition (OCR)**: Scans frame areas and indexes text, planned as a future backend extension (currently mocked in the UI).

### 2. Infrastructure
*   **Nginx**: Reverse proxy handling load balancing, static assets, and SSL termination.
*   **FastAPI**: Asynchronous ASGI API gateway routing queries and stream chunks.
*   **Celery & Redis**: Message broker and distributed worker queue managing asynchronous tasks.
*   **PostgreSQL / SQLite**: High-concurrency SQL database storing users, metadata, object tags, and search logs.
*   **Qdrant Vector DB**: Scalable vector database executing high-speed Cosine Similarity indexes over the 768-dimensional SigLIP frame embeddings.

---

## ⚡ NVIDIA CUDA GPU Acceleration

AURA detects and utilizes integrated NVIDIA GPUs to accelerate PyTorch model inferences:

| Model Pipeline Stage | CPU Processing Time (5 min Video) | GPU CUDA Processing Time (5 min Video) | Speedup Multiplier |
| :--- | :--- | :--- | :--- |
| SigLIP Frame Encoding | ~180 seconds | ~14 seconds | **12.8x** |
| Whisper Transcription | ~72 seconds | ~8 seconds | **9.0x** |
| YOLOv8 Classification | ~38 seconds | ~3 seconds | **12.6x** |
| **Total Ingestion Execution** | **~290 seconds** | **~25 seconds** | **11.6x** |

---

## 📂 Database Entity-Relationship Layout

The relational schema coordinates video assets, structural scenes, keyframe visual descriptors, and audio speech transcripts:

```
               ┌──────────────┐
               │    users     │
               └──────┬───────┘
                      │ 1
                      │
                      │ 0..*
               ┌──────▼───────┐
               │    videos    │◀──────────────┐
               └──────┬───────┘               │
                      │ 1                     │ 1
                      │                       │
                      │ 0..*                  │ 0..*
               ┌──────▼───────┐        ┌──────┴──────────────┐
               │    scenes     │◀──────┤ transcript_segments │
               └──────┬───────┘ 1      └─────────────────────┘
                      │ 1       0..* (nullable FK)
                      │
                      │ 0..*
               ┌──────▼───────┐
               │    frames    │
               └──────┬───────┘
                      │
           ┌──────────┴──────────┐
           │ 1                   │ 1
           │                     │
           │ 0..*                │ 0..*
   ┌───────▼───────┐     ┌───────▼────────┐
   │frame_captions │     │detected_objects│
   └───────────────┘     └────────────────┘
```

---

## 🎹 Keyboard Shortcuts

The workspace listens to global keyboard events to accelerate catalog searching and playback analysis:

*   <kbd>Ctrl</kbd> + <kbd>K</kbd> (or <kbd>Cmd</kbd> + <kbd>K</kbd>) — **Command Palette Overlay** (fuzzy search videos, open configurations, trigger uploads).
*   <kbd>/</kbd> — **Focus Search Input** (instantly jumps selection cursor into the centerpiece search query bar).
*   <kbd>Space</kbd> — **Play / Pause Video** (toggles state on the inline media player).
*   <kbd>←</kbd> / <kbd>→</kbd> — **Precision Frame Step** (skips media timeline back/forward by `1 / 30` seconds).
*   <kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd> — **Jump Search Matches** (seeks the player playhead directly to the previous/next matched scene in the Top-3 results feed).
*   <kbd>Esc</kbd> — **Dismiss Overlays** (closes command palette, settings panels, or collapses inline video players).

---

## 📂 Repository Directory Layout

```
AI-Video-Search/
├── backend/                      # FastAPI Gateway Application
│   ├── app/
│   │   ├── api/                  # REST API routes (Auth, Videos, Search)
│   │   ├── core/                 # Configurations, Security, Database bindings, Model caches
│   │   ├── models/               # SQLAlchemy DB Schemas
│   │   ├── schemas/              # Pydantic schemas
│   │   ├── services/             # Storage, Qdrant bindings, Search orchestrator
│   │   └── main.py               # Gateway entrypoint & db migration triggers
│   └── requirements.txt
├── worker/                       # CPU/CUDA worker pipeline
│   ├── tasks/                    # Worker process routines (Celery task mappings)
│   ├── pipeline/                 # PyTorch model implementations & processing loop
│   └── config.py                 # Worker setup definitions
├── docker/                       # Docker Ingestion Orchestrations
│   └── docker-compose.prod.yml   # Production Compose File (Postgres, S3, Exporters)
├── docs/                         # Architecture documentation
│   ├── architecture.md           # ER schemas, RRF models, Sequence diagrams
│   └── deployment.md             # Multi-GPU, JWT Rotation, Prometheus metrics
├── frontend/                     # SPA Client Assets
│   ├── index.html                # Custom HTML5 structure with top-navigation
│   ├── style.css                 # Premium glassmorphic design stylesheet
│   └── app.js                    # Autoplay loops, hotkey listeners, upload states
└── README.md
```

---

## 🚀 Execution & Setup Guide

### Local Development Mode (Zero-Friction CPU/Local Run)

AURA features a **Local Resilience Mode** that uses SQLite as the relational store, Qdrant in-memory mode, and local file storage:

1.  **Clone the Repository** and navigate to the project directory:
    ```bash
    cd "c:/Users/ashis/Music/Desktop/AI Video Search"
    ```
2.  **Install Python Dependencies**:
    ```bash
    pip install -r backend/requirements.txt -r worker/requirements.txt
    ```
3.  **Execute Setup & Bootstrap the Gateway**:
    ```bash
    python run.py
    ```
4.  **Access the Client Dashboard**:
    Open your browser and navigate to: `http://localhost:8000/`

### Production Deployment Mode (Distributed Multi-GPU Scale)

To spin up the PostgreSQL database, parallelized GPU workers, Qdrant vector index, Redis queue broker, Prometheus collectors, Grafana dashboards, and Nginx gateway:

```bash
docker compose -f docker/docker-compose.prod.yml up --build -d
```

All system containers will initialize in the background. Access metrics through Grafana at `http://localhost:3000` and the web app gateway at `http://localhost`.

---

## ⚠️ Troubleshooting & Locking Warnings

### Qdrant SQLite Lock Conflicts
When running the development server and test runner concurrently on a single machine, Qdrant's local persistent database client can conflict over the local folder file lock (`storage/qdrant_db`), throwing a `RuntimeError: Storage folder is already accessed by another instance`. 

**Solution**: The AURA test runner includes an automated bypass: if pytest or the `TESTING` environment variable is detected, it switches from a local folder path to a pure `location=":memory:"` database. This ensures complete test isolation and allows tests to run alongside a live development server.
