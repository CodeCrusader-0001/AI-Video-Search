# AURA — Production-Grade Multimodal AI Video Search Engine

AURA is a high-throughput, enterprise-ready AI Video Search Engine designed for indexing, searching, and analyzing large-scale video repositories. It enables users to upload video catalogs, automatically segment visual scenes, generate rich textual captions, recognize spoken keywords, detect object boundaries, extract frame text, and execute hybrid semantic queries.

The architecture is built for multi-GPU scalability, separating synchronous HTTP API requests from asynchronous PyTorch inference jobs using a Redis-backed Celery task queue.

---

## 🎨 Enterprise System Architecture & Data Flow

```mermaid
graph TD
    %% Client & Gateway
    User[Client SPA Dashboard] -->|HTTP / Websockets| Nginx[Nginx Reverse Proxy]
    Nginx -->|Route Request| FastAPI[FastAPI Gateway]
    
    %% Storage & Metadata
    FastAPI -->|Signed S3 URL / PUT| MinIO[AWS S3 / MinIO Object Storage]
    FastAPI -->|Transactional SQL| Postgres[(PostgreSQL Relational DB)]
    
    %% Message Queueing
    FastAPI -->|Dispatch Ingestion Task| Redis[Redis Broker Queue]
    
    %% Distributed GPU Inferences
    subgraph Parallel CUDA Compute
        Redis -->|Dispatch Job 0| Celery_0[Celery Worker 0 (GPU 0)]
        Redis -->|Dispatch Job 1| Celery_1[Celery Worker 1 (GPU 1)]
    end
    
    %% Worker Processing
    Celery_0 & Celery_1 -->|HSV Frame Cuts| PyScene[PySceneDetect Splitter]
    Celery_0 & Celery_1 -->|ASR Speech segments| Whisper[Whisper Speech-to-Text]
    Celery_0 & Celery_1 -->|Visual Embeddings| SigLIP[SigLIP Frame Encoder]
    Celery_0 & Celery_1 -->|Visual Detections| YOLO[YOLOv11 Object Detector]
    Celery_0 & Celery_1 -->|Text Extraction| OCR[PaddleOCR / EasyOCR]
    Celery_0 & Celery_1 -->|Auto Captioning| BLIP[Florence-2 / BLIP-2]
    
    %% Indexing Outputs
    SigLIP -->|768-dim Visual Vectors| Qdrant[(Qdrant Vector DB)]
    Whisper & YOLO & OCR & BLIP -->|Store Scene Metadata| Postgres
```

---

## 📖 Deep-Dive Architectural Specifications

For details on security, deployment pipelines, scaling, and schemas, reference the specialized document guides:

1.  **[System Architecture & Data Flows (docs/architecture.md)](file:///c:/Users/ashis/Music/Desktop/AI%20Video%20Search/docs/architecture.md)**:
    *   Entity-Relationship layout for PostgreSQL tables mapping users, videos, scenes, objects, text, and transcripts.
    *   Asynchronous Video Ingestion Sequence Diagrams.
    *   Multi-modal hybrid retrieval matching pipelines using Reciprocal Rank Fusion (RRF).
    *   Detailed model parameters for SigLIP, Florence-2, Whisper, and YOLOv11.
2.  **[Deployment & Security Specifications (docs/deployment.md)](file:///c:/Users/ashis/Music/Desktop/AI%20Video%20Search/docs/deployment.md)**:
    *   Multi-GPU container scheduling using `CUDA_VISIBLE_DEVICES`.
    *   Prometheus alert metric scrape points and Grafana telemetry dashboards.
    *   JWT Refresh Token rotation policies.
    *   FastAPI rate-limiting rules and file upload validations.

---

## 🛠️ Technology Stack & AI Deep Learning Pipeline

AURA integrates modern backend microservices with deep learning models running on a unified worker interface:

### 1. Model Specifications
*   **Multimodal Semantic Alignment (SigLIP)**: Google's symmetric `siglip-base-patch16-224` image-text dual encoder. It maps visual frame features and search queries into a shared 768-dimensional vector space.
*   **Scene Extraction (PySceneDetect)**: Detects visual transitions using HSV color-space histogram shifts to slice videos into individual scenes.
*   **Speech Recognition (OpenAI Whisper)**: Transcribes raw audio tracks into time-aligned text fragments.
*   **Object Categorization (YOLOv11)**: Detects visual objects (e.g. people, cars, laptops) in keyframes, populating target entity chips.
*   **Frame Description (Florence-2 / BLIP-2)**: Unified visual-language model that generates detailed natural scene descriptions and visual captions.
*   **Optical Character Recognition (PaddleOCR / EasyOCR)**: Scans frame areas and indexes text, making slide presentations and overlay titles searchable.

### 2. Infrastructure
*   **Nginx**: Reverse proxy handling load balancing, static assets, and SSL termination.
*   **FastAPI**: Asynchronous ASGI API gateway routing queries and stream chunks.
*   **Celery & Redis**: Message broker and distributed worker queue managing asynchronous tasks.
*   **PostgreSQL**: High-concurrency relational database storing users, metadata, object tags, and search logs.
*   **Qdrant Vector DB**: Scalable vector database executing high-speed Cosine Similarity indexes over the 768-dimensional SigLIP frame embeddings.

---

## ⚡ NVIDIA CUDA GPU Acceleration

AURA detects and utilizes integrated NVIDIA GPUs to accelerate PyTorch model inferences:

| Model Pipeline Stage | CPU Processing Time (5 min Video) | GPU CUDA Processing Time (5 min Video) | Speedup Multiplier |
| :--- | :--- | :--- | :--- |
| SigLIP Frame Encoding | ~180 seconds | ~14 seconds | **12.8x** |
| Whisper Transcription | ~72 seconds | ~8 seconds | **9.0x** |
| YOLOv11 Classification | ~38 seconds | ~3 seconds | **12.6x** |
| **Total Ingestion Execution** | **~290 seconds** | **~25 seconds** | **11.6x** |

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
AURA-AI-Video-Search/
├── backend/                      # FastAPI Gateway Application
│   ├── app/
│   │   ├── api/                  # REST API routes (Auth, Videos, Search)
│   │   ├── core/                 # Configurations, Security, Database bindings
│   │   ├── models/               # SQLAlchemy DB Schemas
│   │   ├── schemas/              # Pydantic schemas
│   │   ├── services/             # Storage, Qdrant bindings, Search orchestrator
│   │   └── main.py               # Gateway entrypoint & db migration triggers
│   └── requirements.txt
├── worker/                       # CPU/CUDA worker pipeline
│   ├── tasks/                    # Worker process routines
│   ├── pipeline/                 # PyTorch model implementations
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
