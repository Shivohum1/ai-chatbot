import os

from pymongo import MongoClient

client = MongoClient(os.getenv("MONGODB_URI"))

DB = client["chatbot"]

messages_collection = DB["messages"]
knowledge_chunks_collection = DB["knowledge_chunks"]

messages_collection.create_index([("session_id", 1), ("timestamp", 1)])
knowledge_chunks_collection.create_index([("source", 1), ("chunk_index", 1)])