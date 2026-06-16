import io
import json
from typing import Any

from fastapi import HTTPException, UploadFile
from pypdf import PdfReader

from config import CHUNK_OVERLAP_DEFAULT, CHUNK_SIZE_DEFAULT, MAX_UPLOAD_BYTES
from embeddings import create_embedding
from qdrant_store import upsert_chunks
from rag import split_text


ALLOWED_EXTENSIONS = {".pdf", ".txt"}


def extract_text_from_pdf(file_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(file_bytes))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages).strip()


def extract_text_from_upload(filename: str, file_bytes: bytes) -> str:
    lower_name = filename.lower()

    if lower_name.endswith(".txt"):
        return file_bytes.decode("utf-8", errors="ignore").strip()

    if lower_name.endswith(".pdf"):
        return extract_text_from_pdf(file_bytes)

    raise HTTPException(
        status_code=400,
        detail=f"Unsupported file type for {filename}. Allowed: PDF, TXT.",
    )


async def read_upload_file(file: UploadFile) -> tuple[str, bytes]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Uploaded file is missing a filename.")

    lower_name = file.filename.lower()
    if not any(lower_name.endswith(ext) for ext in ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type for {file.filename}. Allowed: PDF, TXT.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail=f"File {file.filename} is empty.")

    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File {file.filename} exceeds upload size limit.",
        )

    return file.filename, file_bytes


def index_text_document(
    *,
    tenant_id: str,
    source: str,
    text: str,
    metadata: dict[str, Any] | None = None,
    chunk_size: int = CHUNK_SIZE_DEFAULT,
    chunk_overlap: int = CHUNK_OVERLAP_DEFAULT,
) -> int:
    chunks = split_text(text, chunk_size, chunk_overlap)
    if not chunks:
        return 0

    records = []
    for chunk_index, chunk in enumerate(chunks):
        records.append(
            {
                "tenant_id": tenant_id,
                "source": source,
                "content": chunk,
                "chunk_index": chunk_index,
                "metadata": metadata or {},
                "embedding": create_embedding(chunk),
            }
        )

    return upsert_chunks(records)


async def ingest_uploaded_files(
    *,
    tenant_id: str,
    files: list[UploadFile],
    source_prefix: str | None,
    metadata_raw: str | None,
    chunk_size: int,
    chunk_overlap: int,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {}
    if metadata_raw:
        try:
            metadata = json.loads(metadata_raw)
            if not isinstance(metadata, dict):
                raise ValueError("metadata must be a JSON object")
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid metadata JSON.") from exc

    indexed_files = 0
    indexed_chunks = 0
    file_results: list[dict[str, Any]] = []

    for file in files:
        filename, file_bytes = await read_upload_file(file)
        text = extract_text_from_upload(filename, file_bytes)
        source = source_prefix or filename

        chunk_count = index_text_document(
            tenant_id=tenant_id,
            source=source,
            text=text,
            metadata={**metadata, "filename": filename},
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )

        indexed_files += 1
        indexed_chunks += chunk_count
        file_results.append(
            {
                "filename": filename,
                "source": source,
                "chunks_indexed": chunk_count,
            }
        )

    return {
        "status": "ok",
        "files_processed": indexed_files,
        "chunks_indexed": indexed_chunks,
        "files": file_results,
    }
