import os

from dotenv import load_dotenv

load_dotenv()

EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
CHAT_MODEL_NAME = os.getenv("CHAT_MODEL_NAME", "llama-3.3-70b-versatile")
MAX_HISTORY_MESSAGES = int(os.getenv("MAX_HISTORY_MESSAGES", "12"))
MAX_MESSAGE_LENGTH = int(os.getenv("MAX_MESSAGE_LENGTH", "4000"))
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "4"))
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

QDRANT_URL = os.getenv("QDRANT_URL", "")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "knowledge_chunks")

CHUNK_SIZE_DEFAULT = int(os.getenv("CHUNK_SIZE_DEFAULT", "800"))
CHUNK_OVERLAP_DEFAULT = int(os.getenv("CHUNK_OVERLAP_DEFAULT", "120"))
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_UPLOAD_FILES = int(os.getenv("MAX_UPLOAD_FILES", "5"))

RATE_LIMIT_CHAT = os.getenv("RATE_LIMIT_CHAT", "30/minute")
RATE_LIMIT_INGEST = os.getenv("RATE_LIMIT_INGEST", "10/minute")

BOOTSTRAP_API_KEYS = os.getenv("BOOTSTRAP_API_KEYS", "")
