import os
import uuid
from datetime import datetime

from dotenv import load_dotenv

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

from openai import OpenAI

from database import messages_collection

import telemetry

from openinference.instrumentation import using_attributes

load_dotenv()



client = OpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://api.groq.com/openai/v1"
)

app = FastAPI(
    title="AI Chatbot API",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    user_id: str | None = "anonymous"


@app.get("/")
def home():
    return {
        "status": "running"
    }


@app.post("/chat")
def chat(req: ChatRequest):

    session_id = req.session_id or str(uuid.uuid4())

    old_messages = list(
        messages_collection.find(
            {
                "session_id": session_id
            }
        ).sort("timestamp", 1)
    )

    conversation = [
        {
            "role": "system",
            "content": "You are a helpful AI assistant."
        }
    ]

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

    # One trace per conversation
    with using_attributes(
    session_id=session_id,
    user_id=req.user_id,
   ): 

     response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=conversation,
        temperature=0.7,
    )

    

    answer = response.choices[0].message.content

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
            "content": answer,
            "timestamp": datetime.utcnow(),
            "user_id": req.user_id,
        }
    )

    return {
        "session_id": session_id,
        "response": answer,
    }