# Arizee Chatbot

This repository contains a full-stack chatbot application using a Python backend and a Next.js frontend. It includes components for ingestion, embeddings, and a RAG-based retrieval system.

## Project structure

- backend/: Flask-based API and ingestion tools
  - app.py — Flask app entrypoint
  - ingestion.py — document ingestion pipeline
  - embeddings.py — embedding helpers
  - qdrant_store.py — vector store integration
  - rag.py — retrieval-augmented generation logic
  - requirements.txt — Python dependencies
- frontend/: Next.js application (TypeScript + React)

## Quickstart (development)

Prerequisites:
- Python 3.10+ and pip
- Node.js 18+ and npm/yarn
- Docker & docker-compose (optional)

Backend (Python):

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate  # Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
python app.py
```

Frontend (Next.js):

```bash
cd frontend
npm install
npm run dev
```

Using Docker (optional):

```bash
docker-compose up --build
```

## Configuration
See `backend/config.py` for backend configuration and environment variables. If you need to generate API keys, see `backend/scripts/create_api_key.py`.

## Contributing
Open issues or submit pull requests. Keep changes small and include tests where applicable.

## License
Specify a license for your project.
