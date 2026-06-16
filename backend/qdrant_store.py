import uuid
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

from config import QDRANT_API_KEY, QDRANT_COLLECTION, QDRANT_URL
from embeddings import VECTOR_SIZE

_qdrant_client: QdrantClient | None = None


def get_qdrant_client() -> QdrantClient:
    global _qdrant_client
    if _qdrant_client is None:
        if not QDRANT_URL:
            raise RuntimeError("QDRANT_URL is not configured.")
        _qdrant_client = QdrantClient(
            url=QDRANT_URL,
            api_key=QDRANT_API_KEY or None,
        )
    return _qdrant_client


def ensure_collection() -> None:
    client = get_qdrant_client()
    existing = {collection.name for collection in client.get_collections().collections}
    if QDRANT_COLLECTION in existing:
        return

    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
    )


def upsert_chunks(chunks: list[dict[str, Any]]) -> int:
    if not chunks:
        return 0

    client = get_qdrant_client()
    points = []

    for chunk in chunks:
        points.append(
            PointStruct(
                id=str(uuid.uuid4()),
                vector=chunk["embedding"],
                payload={
                    "tenant_id": chunk["tenant_id"],
                    "source": chunk["source"],
                    "content": chunk["content"],
                    "chunk_index": chunk["chunk_index"],
                    "metadata": chunk.get("metadata", {}),
                },
            )
        )

    client.upsert(collection_name=QDRANT_COLLECTION, points=points)
    return len(points)


def search_chunks(
    query_embedding: list[float],
    top_k: int,
    tenant_id: str,
) -> list[dict[str, Any]]:
    client = get_qdrant_client()
    results = client.search(
        collection_name=QDRANT_COLLECTION,
        query_vector=query_embedding,
        limit=top_k,
        query_filter=Filter(
            must=[
                FieldCondition(
                    key="tenant_id",
                    match=MatchValue(value=tenant_id),
                )
            ]
        ),
    )

    formatted: list[dict[str, Any]] = []
    for hit in results:
        payload = hit.payload or {}
        formatted.append(
            {
                "source": payload.get("source"),
                "content": payload.get("content"),
                "chunk_index": payload.get("chunk_index"),
                "metadata": payload.get("metadata", {}),
                "score": hit.score,
            }
        )
    return formatted
