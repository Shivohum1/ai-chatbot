import uuid
from datetime import datetime
from typing import Annotated, Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAI
from openinference.instrumentation import using_attributes
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

import telemetry
from auth import bootstrap_api_keys, require_api_key
from config import (
    ALLOWED_ORIGINS,
    CHAT_MODEL_NAME,
    CHUNK_OVERLAP_DEFAULT,
    CHUNK_SIZE_DEFAULT,
    GROQ_API_KEY,
    MAX_HISTORY_MESSAGES,
    MAX_MESSAGE_LENGTH,
    MAX_UPLOAD_FILES,
    RAG_TOP_K,
    RATE_LIMIT_CHAT,
    RATE_LIMIT_INGEST,
)
from database import messages_collection
from embeddings import VECTOR_SIZE
from ingestion import index_text_document, ingest_uploaded_files
from qdrant_store import ensure_collection
from rag import (
    CONTEXT_PROMPT_PREFIX,
    SYSTEM_PROMPT,
    build_context_block,
    retrieve_context,
)

load_dotenv()

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is required.")

client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1",
)

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="AI Chatbot API",
    docs_url="/docs",
    redoc_url="/redoc",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in ALLOWED_ORIGINS.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-API-Key"],
)


@app.on_event("startup")
def on_startup() -> None:
    bootstrap_api_keys()
    ensure_collection()


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LENGTH)
    session_id: str | None = None


class KnowledgeDocument(BaseModel):
    source: str = Field(..., min_length=1, max_length=255)
    text: str = Field(..., min_length=1)
    metadata: dict[str, Any] | None = None


class IngestRequest(BaseModel):
    documents: list[KnowledgeDocument] = Field(..., min_length=1)
    chunk_size: int = Field(default=CHUNK_SIZE_DEFAULT, ge=100, le=4000)
    chunk_overlap: int = Field(default=CHUNK_OVERLAP_DEFAULT, ge=0, le=1000)


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LENGTH)
    top_k: int = Field(default=RAG_TOP_K, ge=1, le=20)


AuthContext = Annotated[dict[str, str], Depends(require_api_key)]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def home() -> dict[str, str]:
    return {"status": "running"}


@app.post("/knowledge/ingest")
@limiter.limit(RATE_LIMIT_INGEST)
def ingest_knowledge(
    request: Request,
    req: IngestRequest,
    auth: AuthContext,
) -> dict[str, Any]:
    tenant_id = auth["user_id"]
    indexed_chunks = 0

    for doc in req.documents:
        indexed_chunks += index_text_document(
            tenant_id=tenant_id,
            source=doc.source,
            text=doc.text,
            metadata=doc.metadata,
            chunk_size=req.chunk_size,
            chunk_overlap=req.chunk_overlap,
        )

    return {
        "status": "ok",
        "documents": len(req.documents),
        "chunks_indexed": indexed_chunks,
    }


@app.post("/knowledge/upload")
@limiter.limit(RATE_LIMIT_INGEST)
async def upload_knowledge(
    request: Request,
    auth: AuthContext,
    files: list[UploadFile] = File(...),
    source: str | None = Form(default=None),
    metadata: str | None = Form(default=None),
    chunk_size: int = Form(default=CHUNK_SIZE_DEFAULT),
    chunk_overlap: int = Form(default=CHUNK_OVERLAP_DEFAULT),
) -> dict[str, Any]:
    if not files:
        raise HTTPException(status_code=400, detail="No files provided.")

    if len(files) > MAX_UPLOAD_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Too many files. Maximum allowed: {MAX_UPLOAD_FILES}.",
        )

    if chunk_size < 100 or chunk_size > 4000:
        raise HTTPException(status_code=400, detail="chunk_size must be between 100 and 4000.")

    if chunk_overlap < 0 or chunk_overlap >= chunk_size:
        raise HTTPException(
            status_code=400,
            detail="chunk_overlap must be >= 0 and less than chunk_size.",
        )

    return await ingest_uploaded_files(
        tenant_id=auth["user_id"],
        files=files,
        source_prefix=source,
        metadata_raw=metadata,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )


@app.post("/knowledge/search")
@limiter.limit(RATE_LIMIT_INGEST)
def search_knowledge(
    request: Request,
    req: SearchRequest,
    auth: AuthContext,
) -> dict[str, list[dict[str, Any]]]:
    results = retrieve_context(req.query, req.top_k, auth["user_id"])
    formatted = [
        {
            "source": item.get("source"),
            "content": item.get("content"),
            "chunk_index": item.get("chunk_index"),
            "metadata": item.get("metadata", {}),
            "score": item.get("score"),
        }
        for item in results
    ]
    return {"results": formatted}


@app.post("/chat")
@limiter.limit(RATE_LIMIT_CHAT)
async def chat(
    request: Request,
    req: ChatRequest,
    auth: AuthContext,
):
    user_id = auth["user_id"]
    session_id = req.session_id or str(uuid.uuid4())

    old_messages = list(
        messages_collection.find(
            {
                "session_id": session_id,
                "user_id": user_id,
            }
        )
        .sort("timestamp", -1)
        .limit(MAX_HISTORY_MESSAGES)
    )
    old_messages.reverse()

    retrieved_chunks = retrieve_context(req.message, RAG_TOP_K, user_id)
    context_block = build_context_block(retrieved_chunks)

    conversation: list[dict[str, str]] = [
        {
            "role": "system",
            "content": SYSTEM_PROMPT,
        }
    ]

    if context_block:
        conversation.append(
            {
                "role": "system",
                "content": (
                    f"{CONTEXT_PROMPT_PREFIX}{context_block}\n\n"
                    "When you use facts from context, cite source ids like [1], [2]."
                ),
            }
        )

    for msg in old_messages:
        conversation.append(
            {
                "role": msg["role"],
                "content": msg["content"],
            }
        )

    conversation.append(
        {
            "role": "user",
            "content": req.message,
        }
    )

    with using_attributes(
        session_id=session_id,
        user_id=user_id,
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
                "user_id": user_id,
            }
        )

        messages_collection.insert_one(
            {
                "session_id": session_id,
                "role": "assistant",
                "content": full_response,
                "timestamp": datetime.utcnow(),
                "user_id": user_id,
            }
        )

    return StreamingResponse(
        generate(),
        media_type="text/plain",
    )


@app.get("/config/vector")
def vector_config(auth: AuthContext) -> dict[str, int | str]:
    return {
        "collection": "knowledge_chunks",
        "vector_size": VECTOR_SIZE,
    }
