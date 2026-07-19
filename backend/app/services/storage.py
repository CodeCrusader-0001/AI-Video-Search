import os
import shutil
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from typing import Optional
from backend.app.core.config import settings

class StorageService:
    def __init__(self):
        self.use_s3 = not settings.is_local_storage
        self.bucket_name = settings.S3_BUCKET_NAME
        self.local_path = settings.LOCAL_STORAGE_PATH

        if self.use_s3:
            # Configure boto3 client for S3/MinIO
            self.s3_client = boto3.client(
                "s3",
                endpoint_url=settings.S3_ENDPOINT_URL,
                aws_access_key_id=settings.S3_ACCESS_KEY,
                aws_secret_access_key=settings.S3_SECRET_KEY,
                config=Config(signature_version="s3v4")
            )
            # Ensure bucket exists
            try:
                self.s3_client.head_bucket(Bucket=self.bucket_name)
            except ClientError:
                try:
                    self.s3_client.create_bucket(Bucket=self.bucket_name)
                except Exception as e:
                    print(f"Warning: Could not create S3 bucket: {e}. Falling back to local storage.")
                    self.use_s3 = False
        
        if not self.use_s3:
            # Ensure local folder exists
            os.makedirs(self.local_path, exist_ok=True)
            print(f"StorageService initialized using local path: {self.local_path}")

    def upload_file(self, local_file_path: str, destination_key: str) -> str:
        """
        Uploads a file to object storage or copies it to the local media directory.
        Returns the identifier/path of the stored asset.
        """
        if self.use_s3:
            try:
                self.s3_client.upload_file(local_file_path, self.bucket_name, destination_key)
                return f"s3://{self.bucket_name}/{destination_key}"
            except Exception as e:
                raise RuntimeError(f"Failed S3 upload for {destination_key}: {e}")
        else:
            dest_path = os.path.join(self.local_path, destination_key)
            os.makedirs(os.path.dirname(dest_path), exist_ok=True)
            shutil.copy2(local_file_path, dest_path)
            return dest_path

    def download_file(self, source_key: str, local_destination_path: str) -> None:
        """
        Downloads a file from object storage or copies it from local directory to local path.
        """
        if self.use_s3:
            # Handle full S3 URL or raw key
            key = source_key.replace(f"s3://{self.bucket_name}/", "")
            try:
                self.s3_client.download_file(self.bucket_name, key, local_destination_path)
            except Exception as e:
                raise RuntimeError(f"Failed downloading S3 key {key}: {e}")
        else:
            # Handle local storage copy
            src_path = source_key if os.path.exists(source_key) else os.path.join(self.local_path, source_key)
            if not os.path.exists(src_path):
                raise FileNotFoundError(f"Local source file not found: {src_path}")
            os.makedirs(os.path.dirname(local_destination_path), exist_ok=True)
            shutil.copy2(src_path, local_destination_path)

    def generate_presigned_url(self, file_key: str, expiration_seconds: int = 3600) -> str:
        """
        Generates a temporary access URL. For local files, returns an API route prefix.
        """
        if self.use_s3:
            key = file_key.replace(f"s3://{self.bucket_name}/", "")
            try:
                url = self.s3_client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self.bucket_name, "Key": key},
                    ExpiresIn=expiration_seconds
                )
                return url
            except Exception as e:
                print(f"Failed to generate S3 URL: {e}")
                return file_key
        else:
            # For local media, we generate a relative backend streaming URL
            # The backend will route GET /api/v1/videos/stream/{filename} to return the file
            try:
                rel_path = os.path.relpath(file_key, self.local_path)
                clean_key = rel_path.replace("\\", "/").strip("/")
            except Exception:
                clean_key = file_key.replace(self.local_path, "").replace("\\", "/").strip("/")
            return f"/api/v1/videos/stream/{clean_key}"

    def delete_file(self, file_key: str) -> None:
        """
        Deletes the file from storage.
        """
        if self.use_s3:
            key = file_key.replace(f"s3://{self.bucket_name}/", "")
            try:
                self.s3_client.delete_object(Bucket=self.bucket_name, Key=key)
            except Exception as e:
                print(f"Warning: Failed to delete S3 key {key}: {e}")
        else:
            src_path = file_key if os.path.exists(file_key) else os.path.join(self.local_path, file_key)
            if os.path.exists(src_path):
                try:
                    os.remove(src_path)
                except Exception as e:
                    print(f"Warning: Failed to delete local file {src_path}: {e}")

# Global storage service instance
storage_service = StorageService()
