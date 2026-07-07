import torch
from transformers import AutoProcessor, AutoModel
from backend.app.core.config import settings

class InferenceModelsCache:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.siglip_model = None
        self.siglip_processor = None
        print(f"InferenceModelsCache initialized. Default hardware target: {self.device}")

    def get_siglip(self):
        """
        Lazy-loads SigLIP encoder.
        """
        if self.siglip_model is None:
            model_id = settings.SIGLIP_MODEL_NAME
            print(f"Loading SigLIP model '{model_id}' into memory on device: {self.device}...")
            self.siglip_processor = AutoProcessor.from_pretrained(model_id)
            self.siglip_model = AutoModel.from_pretrained(model_id).to(self.device)
            self.siglip_model.eval()
        return self.siglip_model, self.siglip_processor

    def get_text_embedding(self, text: str) -> list:
        """
        Generates 768-dimensional normalized text vector from SigLIP.
        """
        model, processor = self.get_siglip()
        with torch.no_grad():
            inputs = processor(text=[text], padding="max_length", return_tensors="pt").to(self.device)
            text_features = model.get_text_features(**inputs)
            if hasattr(text_features, "pooler_output"):
                text_features = text_features.pooler_output
            # Apply L2 normalization
            normalized = text_features / text_features.norm(p=2, dim=-1, keepdim=True)
            return normalized[0].cpu().tolist()

# Global inference cache instance
models_cache = InferenceModelsCache()
