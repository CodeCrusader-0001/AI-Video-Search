# AURA — Multimodal AI Video Search Engine: Deployment & Security Specification

This document details the production-grade deployment layout, parallel GPU execution policies, monitoring tools, and security schemes for the **AURA** platform.

---

## 1. Multi-GPU Scalability Strategy

To scale visual encoders (SigLIP) and transcription decoders (Whisper), AURA deploys multiple independent Celery worker processes, each pinned to a specific physical GPU. This prevents GPU context switching, thrashing, and memory resource exhaustion.

### GPU Assignment Configuration
Workers are scheduled in parallel containers with target CUDA device bindings.

```yaml
# Environment definitions for individual Celery workers
# Worker 0 pins GPU 0
CELERY_WORKER_0:
  environment:
    - CUDA_VISIBLE_DEVICES=0
    - WORKER_CONCURRENCY=1   # 1 task per worker thread to prevent PyTorch CUDA OOM

# Worker 1 pins GPU 1
CELERY_WORKER_1:
  environment:
    - CUDA_VISIBLE_DEVICES=1
    - WORKER_CONCURRENCY=1
```

### PyTorch In-Worker Allocation
Within the worker script context, PyTorch model loaders automatically target the assigned device:
```python
import os
import torch

def get_inference_device() -> torch.device:
    # Read assigned CUDA device index
    if torch.cuda.is_available():
        # Will automatically map to index 0 inside its isolated container namespace
        return torch.device("cuda")
    return torch.device("cpu")
```

---

## 2. Telemetry & Monitoring Architecture

Production deployments mount a centralized monitoring collection layer to track ingestion speeds, server performance, and model telemetry:

```
┌─────────────────┐     Scrapes      ┌──────────────┐     Visualizes     ┌───────────┐
│ FastAPI Exporter│─────────────────>│  Prometheus  │───────────────────>│  Grafana  │
└─────────────────┘                  │ Time-Series  │                    │Dashboards │
┌─────────────────┐                  │   Database   │                    └───────────┘
│nvidia-smi-export│─────────────────>│              │
└─────────────────┘     Scrapes      └──────────────┘
```

### Exporter Metrics Definitions

*   **FastAPI Exporter**:
    *   `http_requests_total`: Total API request counts, grouped by method, path, and response status codes.
    *   `http_request_duration_seconds`: API latency histograms (tracking search query speeds).
*   **Celery Queue Exporter**:
    *   `celery_queue_length`: Backlog count of pending ingestion tasks waiting for GPU resources.
    *   `celery_task_runtime_seconds`: Average execution time of model pipelines per video.
*   **NVIDIA SMI Exporter**:
    *   `nv_gpu_utilization`: Core GPU compute loads (%).
    *   `nv_gpu_memory_used_bytes`: VRAM footprint (tracks PyTorch allocation thresholds).
    *   `nv_gpu_temp_celsius`: Physical heat tracking to monitor throttling.

---

## 3. JWT Security & Refresh Token Flow

AURA uses asymmetric-like token authentication. Access tokens are short-lived, while Refresh tokens are stored in the relational database with rotation security.

```
 Client App               FastAPI Gateway                PostgreSQL DB
    │                           │                            │
    │ 1. POST /auth/login       │                            │
    ├──────────────────────────>│                            │
    │                           │ 2. Verify Credentials      │
    │                           ├───────────────────────────>│
    │                           │ 3. Generate Access +       │
    │                           │    Refresh Token Pair      │
    │                           │<───────────────────────────┤
    │ 4. Tokens Returned        │                            │
    │<──────────────────────────┤                            │
    │                           │                            │
   ─── (After 15 Minutes: Access Token Expires) ───────────────────
    │                           │                            │
    │ 5. POST /auth/refresh     │                            │
    │    (Includes Refresh)     │                            │
    ├──────────────────────────>│                            │
    │                           │ 6. Query active refresh    │
    │                           ├───────────────────────────>│
    │                           │ 7. Verify & rotate token   │
    │                           │<───────────────────────────┤
    │ 8. New Access/Refresh     │                            │
    │<──────────────────────────┤                            │
```

### Access Token vs. Refresh Token Specs
*   **Access Token**: JWT payload signed with HS256 containing user ID and expiration claims (`exp` set to 15 minutes). Sent in the `Authorization: Bearer <token>` header.
*   **Refresh Token**: Long-lived cryptographically secure UUID (`exp` set to 7 days) stored in the database. When used, the old refresh token is marked as revoked, and a new pair is issued (**Refresh Token Rotation**). This detects token hijacking attempts instantly.

---

## 4. API Rate Limiting & File Validation

To protect the server gateway from Denial of Service (DoS) and disk space exhaustion:

### Rate Limiting Layer
We utilize **FastAPI Limiter** backed by the Redis cache:
*   `GET /api/v1/search` -> Limited to **30 queries per minute** per IP.
*   `POST /api/v1/videos/upload` -> Limited to **5 uploads per hour** per user.

### File Validation Pipeline
Before raw files are committed to S3 or processed by Workers, the API performs structural checks:
1.  **File Extension Validation**: Rejects files unless they match safe containers: `mp4`, `mkv`, `mov`.
2.  **MIME Type Header Parsing**: Validates matching metadata (e.g., `video/mp4`, `video/quicktime`).
3.  **Maximum File Size Constraints**: Refuses streams exceeding **500 Megabytes** per transaction to prevent drive-fill attacks.
