import os
import sys
import subprocess
import uvicorn

# Configure environment variables defaults
os.environ.setdefault("DATABASE_URL", "sqlite:///c:/Users/ashis/Music/Desktop/A/video_search.db")
os.environ.setdefault("ASYNC_DATABASE_URL", "sqlite+aiosqlite:///c:/Users/ashis/Music/Desktop/A/video_search.db")
os.environ.setdefault("QDRANT_URL", ":memory:")
os.environ.setdefault("LOCAL_STORAGE_PATH", "c:/Users/ashis/Music/Desktop/A/storage")

def bootstrap():
    print("=================================================================")
    print("           AURA: Multimodal AI Video Search Engine               ")
    print("=================================================================")
    
    # Ensure storage paths exist
    storage_path = os.environ["LOCAL_STORAGE_PATH"]
    os.makedirs(storage_path, exist_ok=True)
    os.makedirs(os.path.join(storage_path, "videos"), exist_ok=True)
    os.makedirs(os.path.join(storage_path, "frames"), exist_ok=True)
    print(f"[*] Local media storage directory ready: {storage_path}")

    # Check dependencies
    print("[*] Checking backend dependencies...")
    try:
        import fastapi
        import uvicorn
        import sqlalchemy
        import aiosqlite
        import qdrant_client
        import transformers
        import torch
        import cv2
        import ultralytics
        print("[+] Dependency checks passed successfully.")
    except ImportError as e:
        print(f"[-] Missing library: {e.name}")
        print("[!] Suggest running: uv pip install -r backend/requirements.txt -r worker/requirements.txt")
        print("[*] Attempting automatic dependency installation...")
        try:
            # Check if running within a virtual environment and try uv first
            try:
                subprocess.run(["uv", "pip", "install", "-r", "backend/requirements.txt", "-r", "worker/requirements.txt"], check=True)
                print("[+] Libraries installed successfully via uv.")
            except (subprocess.SubprocessError, FileNotFoundError):
                subprocess.run([sys.executable, "-m", "pip", "install", "-r", "backend/requirements.txt", "-r", "worker/requirements.txt"], check=True)
                print("[+] Libraries installed successfully via pip.")
        except Exception as inst_err:
            print(f"[!] Autoinstall failed: {inst_err}. Please run: uv pip install -r backend/requirements.txt -r worker/requirements.txt manually.")

    # Expose FastAPI server
    print("\n[*] Starting AURA Multimodal Search Engine Gateway on http://localhost:8000")
    print("[*] Interactive API documentation available at http://localhost:8000/docs")
    print("[*] Running in Local Resilience Mode (SQLite + Qdrant In-Memory + Local Disk S3 Fallback)")
    print("=================================================================\n")
    
    # Run server
    # Set CWD to root and target app
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=False)

if __name__ == "__main__":
    bootstrap()
