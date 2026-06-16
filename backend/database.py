import os

from pymongo import MongoClient

client = MongoClient(os.getenv("MONGODB_URI"))

DB = client["chatbot"]

messages_collection = DB["messages"]
api_keys_collection = DB["api_keys"]

messages_collection.create_index([("user_id", 1), ("session_id", 1), ("timestamp", 1)])
api_keys_collection.create_index([("key_hash", 1)], unique=True)
api_keys_collection.create_index([("user_id", 1)])
