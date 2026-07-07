import torch
from PIL import Image
from transformers import AutoProcessor, AutoModel, BlipProcessor, BlipForConditionalGeneration, pipeline
from ultralytics import YOLO
from backend.app.core.config import settings

class PipelineModels:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.torch_dtype = torch.float16 if self.device == "cuda" else torch.float32
        
        self.siglip_model = None
        self.siglip_processor = None
        
        self.blip_model = None
        self.blip_processor = None
        
        self.whisper_pipe = None
        self.yolo_model = None
        
        print(f"PipelineModels helper initialized (Device: {self.device}, Dtype: {self.torch_dtype})")

    def get_siglip(self):
        if self.siglip_model is None:
            model_id = settings.SIGLIP_MODEL_NAME
            print(f"Loading SigLIP model '{model_id}'...")
            self.siglip_processor = AutoProcessor.from_pretrained(model_id)
            self.siglip_model = AutoModel.from_pretrained(model_id).to(self.device, dtype=self.torch_dtype)
            self.siglip_model.eval()
        return self.siglip_model, self.siglip_processor

    def get_blip(self):
        if self.blip_model is None:
            model_id = settings.BLIP_MODEL_NAME
            print(f"Loading BLIP model '{model_id}'...")
            self.blip_processor = BlipProcessor.from_pretrained(model_id)
            self.blip_model = BlipForConditionalGeneration.from_pretrained(model_id).to(self.device, dtype=self.torch_dtype)
            self.blip_model.eval()
        return self.blip_model, self.blip_processor

    def get_whisper(self):
        if self.whisper_pipe is None:
            model_id = settings.WHISPER_MODEL_NAME
            print(f"Loading Whisper pipeline '{model_id}'...")
            self.whisper_pipe = pipeline(
                "automatic-speech-recognition",
                model=model_id,
                device=0 if self.device == "cuda" else -1,
                torch_dtype=self.torch_dtype,
                return_timestamps=True
            )
        return self.whisper_pipe

    def get_yolo(self):
        if self.yolo_model is None:
            model_id = settings.YOLO_MODEL_NAME
            print(f"Loading YOLO model '{model_id}'...")
            # Ultralytics handles device configuration internally
            self.yolo_model = YOLO(model_id)
            if self.device == "cuda":
                self.yolo_model.to("cuda")
        return self.yolo_model

    def compute_image_embedding(self, image: Image.Image) -> list:
        """
        Generates 768-dim SigLIP embedding for an extracted frame image.
        """
        model, processor = self.get_siglip()
        with torch.no_grad():
            inputs = processor(images=image, return_tensors="pt").to(self.device)
            # Match tensor dtype to model
            inputs = {k: v.to(dtype=self.torch_dtype) if v.dtype == torch.float32 else v for k, v in inputs.items()}
            image_features = model.get_image_features(**inputs)
            if hasattr(image_features, "pooler_output"):
                image_features = image_features.pooler_output
            # L2 normalization
            normalized = image_features / image_features.norm(p=2, dim=-1, keepdim=True)
            return normalized[0].cpu().float().tolist()

    def generate_caption(self, image: Image.Image) -> str:
        """
        Generates descriptive caption text using BLIP.
        """
        model, processor = self.get_blip()
        with torch.no_grad():
            inputs = processor(images=image, return_tensors="pt").to(self.device, dtype=self.torch_dtype)
            outputs = model.generate(**inputs)
            caption = processor.decode(outputs[0], skip_special_tokens=True)
            return caption

    def run_transcription(self, audio_file_path: str) -> list:
        """
        Runs Whisper speech-to-text. Returns list of segments with text, start_time, and end_time.
        """
        pipe = self.get_whisper()
        result = pipe(audio_file_path, chunk_length_s=30, batch_size=8)
        
        # Format segments list
        chunks = result.get("chunks", [])
        formatted_segments = []
        for chunk in chunks:
            text = chunk.get("text", "").strip()
            timestamp = chunk.get("timestamp")
            if text and timestamp:
                formatted_segments.append({
                    "text": text,
                    "start": float(timestamp[0]) if timestamp[0] is not None else 0.0,
                    "end": float(timestamp[1]) if timestamp[1] is not None else 0.0
                })
        return formatted_segments

    def detect_objects(self, image: Image.Image) -> list:
        """
        Runs YOLO to extract detected objects and bounding box mappings.
        Returns: list of dicts: {"label": str, "confidence": float, "bbox": [x_min, y_min, x_max, y_max]}
        """
        model = self.get_yolo()
        # Run inference
        results = model(image, verbose=False)
        detected = []
        
        if len(results) > 0:
            result = results[0]
            boxes = result.boxes
            names = result.names
            
            for box in boxes:
                cls_id = int(box.cls[0].item())
                label = names.get(cls_id, f"object_{cls_id}")
                conf = float(box.conf[0].item())
                xyxy = box.xyxy[0].cpu().tolist()  # [x_min, y_min, x_max, y_max]
                
                detected.append({
                    "label": label,
                    "confidence": conf,
                    "bbox": [round(val, 2) for val in xyxy]
                })
        return detected

# Global models service for the worker pipeline
pipeline_models = PipelineModels()
