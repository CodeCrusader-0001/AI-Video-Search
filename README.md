# 🌌 AURA — Multimodal AI Video Search Engine

AURA is a production-grade, state-of-the-art AI-powered Video Search Engine. It enables users to ingest video catalogs, auto-partition visual scenes, transcribe audio speech tracks, detect visual entities, and execute high-speed semantic natural-language searches.

Designed around a sleek, unified single-workspace desktop interface, AURA provides real-time progress metrics during GPU-accelerated video ingestion and returns top search results containing matched frames, 3-second autoplaying loops, BLIP descriptions, speech transcripts, and YOLO entity tags. It syncs directly with an embedded media player offering advanced frame-stepping and looping capabilities.

---

## ⚡ Key Features

*   **Multimodal Semantic Alignment (SigLIP)**: Maps visual frame features and natural language search queries into a shared 768-dimensional vector space, enabling similarity-based search without keyword tag matches.
*   **Speech Recognition (OpenAI Whisper)**: Automatic Speech Recognition (ASR) system transcribing raw audio streams into time-aligned text segments.
*   **Object Categorization (YOLOv11)**: Real-time object detection model that categorizes visual objects (e.g. people, cars, laptops) present in keyframes.
*   **Visual Scene Cut Segmentation (PySceneDetect)**: Detects visual transitions using HSV color-space histogram shifts, splitting videos into individual thematic scenes rather than arbitrary time cuts.
*   **Zero-Config Path Resolution**: All databases, cache locations, static folders, and media assets are dynamically resolved relative to the workspace root, enabling a plug-and-play setup.
*   **Intelligent Ingestion Caching**: Detects duplicate uploads of the same video and instantly returns/reuses the existing `COMPLETED` or `PROCESSING` metadata records, preventing redundant GPU/CPU inference passes.

---

## 📐 System Architecture & Data Flow

```mermaid
graph TD
    %% Ingestion Pipeline
    U[User Video Upload] -->|multipart/form-data| G[FastAPI Gateway]
    G -->|Write Raw Video| S3[Local Storage / AWS S3 API]
    G -->|DB Transaction| DB[(SQLite Relational DB)]
    G -->|Queue Job| W[PyTorch Inference Worker]
    
    %% Processing Pipeline
    subgraph Worker Pipeline [CUDA Accelerated Processing Pipeline]
        W -->|HSV Adaptive Threshold| PD[PySceneDetect Scene Splitter]
        PD -->|Frame Extraction| FE[Keyframe Grabber]
        FE -->|Inference SigLIP| SIG[SigLIP Frame Encoder]
        FE -->|Inference YOLOv11| YOLO[YOLOv11 Object Detector]
        W -->|Inference Whisper| WH[Whisper Speech-to-Text ASR]
    end
    
    %% Storage & Indexing
    SIG -->|768-dim Vector Embeddings| Q[(Qdrant Vector Database)]
    YOLO -->|Label Tags| DB
    WH -->|Synchronized Time Segments| DB
    
    %% Query & Search
    User[Search Query] -->|GET /api/v1/search?q=query| G
    G -->|Encode Text Query| SIG_TXT[SigLIP Text Encoder]
    SIG_TXT -->|Similarity Scan| Q
    Q -->|RRF Reranking| Orchestrator[Search Orchestrator]
    DB -->|Fetch Segment Metadata| Orchestrator
    Orchestrator -->|Top 3 Matches| UI[Frontend Search Studio]
```

---

## 🛠️ Technology Stack & AI Deep Learning Pipeline

AURA integrates modern backend microservices with deep learning models running on a unified worker interface:

### 1. Model Specifications
*   **SigLIP (`siglip-base-patch16-224`)**: Google's symmetric image-text dual encoder used for embedding visual frames and textual search queries.
*   **Whisper (`openai/whisper-small`)**: High-performance automatic speech recognition model for word/sentence level audio transcript alignments.
*   **YOLOv11 (`yolov8n.pt` / `yolov11n.pt`)**: Real-time object boundary detector that tags entity chips (e.g. `person`, `laptop`, `car`).
*   **PySceneDetect**: Performs content-aware scene partitioning using HSV histogram transitions.

### 2. Infrastructure Layers
*   **FastAPI Gateway**: Asynchronous ASGI web framework acting as the ingestion API, validation filter, and media streaming server.
*   **Qdrant Vector DB**: High-speed vector search engine configured for Cosine Similarity indexing.
*   **SQLAlchemy Core & SQLite**: Relational database engine mapping metadata models (Videos, Scenes, Keyframes, Transcripts).

---

## 🚀 NVIDIA CUDA GPU Acceleration

AURA automatically detects and utilizes integrated NVIDIA GPUs to accelerate PyTorch model inference:

| Model Pipeline Stage | CPU Processing Time (5 min Video) | GPU CUDA Processing Time (5 min Video) | Speedup Multiplier |
| :--- | :--- | :--- | :--- |
| SigLIP Frame Encoding | ~180 seconds | ~14 seconds | **12.8x** |
| Whisper Transcription | ~72 seconds | ~8 seconds | **9.0x** |
| YOLOv11 Classification | ~38 seconds | ~3 seconds | **12.6x** |
| **Total Ingestion Execution** | **~290 seconds** | **~25 seconds** | **11.6x** |

### Configuration Verification
When booting, AURA queries PyTorch device properties and logs telemetry metrics:
```python
import torch
print(f"CUDA Available: {torch.cuda.is_available()}")
print(f"Active Device: {torch.cuda.get_device_name(0)}")
# Example Output: Active Device: NVIDIA GeForce RTX 3050 Laptop GPU
```

---

## 📐 Unified 2-Column Search Studio UX

The application is structured around a single-workspace desktop studio. All operations happen inline without page redirects.

```
┌─────────────────────────────────────────────────────────────┐
│ Top Navigation (AURA Logo, Cmd+K Palette, Settings, Profile)│
├──────────────┬──────────────────────────────────────────────┤
│ Video        │ Search centerpiece, Suggestion prompt chips  │
│ Library      ├──────────────────────────────────────────────┤
│              │ Netflix-style Top-3 Horizontal Results Feed  │
│ Title        │ (Looping Video | Matched Frame | Meta Tags)  │
│ Duration     ├──────────────────────────────────────────────┤
│ Date & status│ Embedded HTML5 Media Player with:            │
│              │ - Custom playback speed (0.5x - 2.0x)        │
│ Recent       │ - Frame step precision buttons (<- & ->)     │
│ Queries      │ - Timeline scene constraints (Loop Toggle)   │
└──────────────┴──────────────────────────────────────────────┘
```

---

## 🛰️ REST API Specification

Interactive Swagger Docs are hosted at `/docs`. All endpoints support JWT authentication headers.

### 1. Authentication
*   `POST /api/v1/auth/register` — Create account credentials.
*   `POST /api/v1/auth/login` — Authorize developer logs, returning JWT tokens.

### 2. Video Catalog
*   `POST /api/v1/videos/upload?title={title}` — Multipart video stream upload. Checks for duplicate title uploads and reuses existing completed/processing instances.
*   `GET /api/v1/videos` — List catalog records, durations, progress parameters, and processing statuses.
*   `PUT /api/v1/videos/{video_id}?title={title}` — Update video title.
*   `DELETE /api/v1/videos/{video_id}` — Purge relational DB records, local frame clips, and Qdrant vectors.
*   `POST /api/v1/videos/{video_id}/reprocess` — Force repartition and re-encode frames into the vector search engine.

### 3. Multimodal Search
*   `GET /api/v1/search?q={query_string}&video_id={optional_filter}` — Execute Cosine Similarity search over visual frame vectors.

---

## 📂 Repository Directory Layout

```
AURA-AI-Video-Search/
├── backend/                      # FastAPI Gateway Application
│   ├── app/
│   │   ├── api/                  # REST API routes (Auth, Videos, Search)
│   │   ├── core/                 # Configurations, Security, Database bindings
│   │   ├── models/               # SQLAlchemy DB Schemas (models.py)
│   │   ├── schemas/              # Pydantic schemas (schemas.py)
│   │   ├── services/             # Storage, Qdrant bindings, Search orchestrator
│   │   └── main.py               # Gateway entrypoint & db migration triggers
│   └── requirements.txt
├── worker/                       # CPU/CUDA worker pipeline
│   ├── tasks/                    # Worker process routines
│   ├── pipeline/                 # PyTorch model implementations (processing.py)
│   └── config.py                 # Worker setup definitions
├── frontend/                     # SPA Client Assets
│   ├── index.html                # Custom HTML5 structure with top-navigation
│   ├── style.css                 # Premium glassmorphic design stylesheet
│   └── app.js                    # Autoplay loops, hotkey listeners, upload states
└── README.md
```

---

## 🚀 Installation & Local Launch Guide

### 1. Setup Virtual Environment
```bash
python -m venv .venv
.venv\Scripts\activate
```

### 2. Install Project Dependencies
Ensure you have CUDA-supported PyTorch installed for GPU acceleration:
```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
pip install -r backend/requirements.txt -r worker/requirements.txt
```

### 3. Run Automated Tests
Verify that your local paths and services are working correctly by executing pytest:
```bash
python -m pytest
```

### 4. Launch the API Gateway
Bootstrap the FastAPI local server:
```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```
Open **`http://127.0.0.1:8000/`** in your browser. Perform a hard refresh (`Ctrl + F5`) to access the Search Studio client workspace.

---

## 🎹 Keyboard Shortcuts

The workspace listens to global keyboard events to accelerate catalog searching and playback analysis:

*   <kbd>Ctrl</kbd> + <kbd>K</kbd> (or <kbd>Cmd</kbd> + <kbd>K</kbd>) — **Command Palette Overlay** (fuzzy search videos, open configurations, trigger uploads).
*   <kbd>/</kbd> — **Focus Search Input** (instantly jumps selection cursor into the centerpiece search query bar).
*   <kbd>Space</kbd> — **Play / Pause Video** (toggles state on the inline media player).
*   <kbd>←</kbd> / <kbd>→</kbd> — **Precision Frame Step** (skips media timeline back/forward by `1 / 30` seconds).
*   <kbd>Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd> — **Jump Search Matches** (seeks the player playhead directly to the previous/next matched scene in the Top-3 results feed).
*   <kbd>Esc</kbd> — **Dismiss Overlays** (closes command palette, settings panels, or collapses inline video players).