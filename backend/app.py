import os
import uuid
from datetime import datetime
from typing import Any

from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from pydantic import BaseModel

from openai import OpenAI
from sentence_transformers import SentenceTransformer

from database import messages_collection, knowledge_chunks_collection

import telemetry

from openinference.instrumentation import using_attributes

load_dotenv()

EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
CHAT_MODEL_NAME = os.getenv("CHAT_MODEL_NAME", "llama-3.3-70b-versatile")
MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", "12"))
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*")

client = OpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://api.groq.com/openai/v1"
)

embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)

app = FastAPI(
    title="AI Chatbot API",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in ALLOWED_ORIGINS.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    user_id: str | None = "anonymous"


class KnowledgeDocument(BaseModel):
    source: str
    text: str
    metadata: dict[str, Any] | None = None


class IngestRequest(BaseModel):
    documents: list[KnowledgeDocument]
    chunk_size: int = 800
    chunk_overlap: int = 120


class SearchRequest(BaseModel):
    query: str
    top_k: int = RAG_TOP_K


def split_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
    clean_text = " ".join(text.split())
    if not clean_text:
        return []

    if chunk_overlap >= chunk_size:
        chunk_overlap = max(0, chunk_size // 4)

    chunks: list[str] = []
    start = 0
    text_len = len(clean_text)
    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunks.append(clean_text[start:end])
        if end >= text_len:
            break
        start = end - chunk_overlap

    return chunks


def create_embedding(text: str) -> list[float]:
    vector = embedding_model.encode(text, normalize_embeddings=True)
    return vector.tolist()


def dot_product_similarity(vector_a: list[float], vector_b: list[float]) -> float:
    return float(sum(a * b for a, b in zip(vector_a, vector_b)))


def retrieve_context(query: str, top_k: int) -> list[dict[str, Any]]:
    query_embedding = create_embedding(query)
    candidates = list(knowledge_chunks_collection.find({}, {"_id": 0}))

    if not candidates:
        return []

    ranked = sorted(
        candidates,
        key=lambda item: dot_product_similarity(query_embedding, item["embedding"]),
        reverse=True,
    )

    return ranked[:top_k]


def build_context_block(chunks: list[dict[str, Any]]) -> str:
    if not chunks:
        return ""

    lines = []
    for index, chunk in enumerate(chunks, start=1):
        lines.append(
            f"[{index}] source={chunk.get('source', 'unknown')}\n{chunk.get('content', '')}"
        )
    return "\n\n".join(lines)


@app.get("/")
def home():
    return {
        "status": "running"
    }


@app.post("/knowledge/ingest")
def ingest_knowledge(req: IngestRequest):
    if not req.documents:
        raise HTTPException(status_code=400, detail="No documents provided.")

    if req.chunk_size < 100:
        raise HTTPException(status_code=400, detail="chunk_size must be at least 100.")

    inserted_chunks = 0

    for doc in req.documents:
        chunks = split_text(doc.text, req.chunk_size, req.chunk_overlap)
        for chunk_index, chunk in enumerate(chunks):
            record = {
                "source": doc.source,
                "content": chunk,
                "chunk_index": chunk_index,
                "embedding": create_embedding(chunk),
                "metadata": doc.metadata or {},
                "created_at": datetime.utcnow(),
            }
            knowledge_chunks_collection.insert_one(record)
            inserted_chunks += 1

    return {
        "status": "ok",
        "documents": len(req.documents),
        "chunks_indexed": inserted_chunks,
    }


@app.post("/knowledge/search")
def search_knowledge(req: SearchRequest):
    results = retrieve_context(req.query, req.top_k)
    formatted = [
        {
            "source": item.get("source"),
            "content": item.get("content"),
            "chunk_index": item.get("chunk_index"),
            "metadata": item.get("metadata", {}),
        }
        for item in results
    ]
    return {"results": formatted}


@app.post("/chat")
async def chat(req: ChatRequest):

    session_id = req.session_id or str(uuid.uuid4())

    old_messages = list(
        messages_collection.find(
            {
                "session_id": session_id
            }
        ).sort("timestamp", -1).limit(MAX_HISTORY_MESSAGES)
    )
    old_messages.reverse()

    retrieved_chunks = retrieve_context(req.message, RAG_TOP_K)
    context_block = build_context_block(retrieved_chunks)

    conversation = [
        {
            "role": "system",
            "content": (
                "You are a helpful AI assistant. "
                "Use the provided knowledge context when it is relevant. "
                "If the context is insufficient, say so clearly instead of inventing facts."
            )
        }
    ]

    if context_block:
        conversation.append(
            {
                "role": "system",
                "content": (
                    "Knowledge context:\n"
                    f"{context_block}\n\n"
                    "When you use facts from context, cite source ids like [1], [2]."
                ),
            }
        )

    for msg in old_messages:

        conversation.append(
            {
                "role": msg["role"],
                "content": msg["content"]
            }
        )

    conversation.append(
        {
            "role": "user",
            "content": req.message
        }
    )

    with using_attributes(
        session_id=session_id,
        user_id=req.user_id,
    ):

        response = client.chat.completions.create(
            model=CHAT_MODEL_NAME,
            messages=conversation,
            temperature=0.7,
            stream=True,
        )

    async def generate():

        full_response = ""

        for chunk in response:

            if chunk.choices[0].delta.content:

                token = chunk.choices[0].delta.content

                full_response += token

                yield token

        messages_collection.insert_one(
            {
                "session_id": session_id,
                "role": "user",
                "content": req.message,
                "timestamp": datetime.utcnow(),
                "user_id": req.user_id,
            }
        )

        messages_collection.insert_one(
            {
                "session_id": session_id,
                "role": "assistant",
                "content": full_response,
                "timestamp": datetime.utcnow(),
                "user_id": req.user_id,
            }
        )

    return StreamingResponse(
        generate(),
        media_type="text/plain"
    )