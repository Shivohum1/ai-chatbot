import hashlib
import secrets
from datetime import datetime
from typing import Annotated

from fastapi import Header, HTTPException

from database import api_keys_collection


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def extract_api_key(
    authorization: str | None,
    x_api_key: str | None,
) -> str | None:
    if x_api_key:
        return x_api_key.strip()

    if not authorization:
        return None

    parts = authorization.strip().split(" ", 1)
    if len(parts) == 2 and parts[0].lower() in {"apikey", "bearer"}:
        return parts[1].strip()

    if len(parts) == 1:
        return parts[0].strip()

    return None


def bootstrap_api_keys() -> None:
    from config import BOOTSTRAP_API_KEYS

    if not BOOTSTRAP_API_KEYS.strip():
        return

    for entry in BOOTSTRAP_API_KEYS.split(","):
        entry = entry.strip()
        if not entry or ":" not in entry:
            continue

        user_id, plaintext_key = entry.split(":", 1)
        user_id = user_id.strip()
        plaintext_key = plaintext_key.strip()
        if not user_id or not plaintext_key:
            continue

        key_hash = hash_api_key(plaintext_key)
        existing = api_keys_collection.find_one({"key_hash": key_hash})
        if existing:
            continue

        api_keys_collection.insert_one(
            {
                "user_id": user_id,
                "key_hash": key_hash,
                "label": "bootstrap",
                "active": True,
                "created_at": datetime.utcnow(),
            }
        )


def create_api_key_record(user_id: str, label: str = "manual") -> str:
    plaintext_key = f"ak_{secrets.token_urlsafe(32)}"
    api_keys_collection.insert_one(
        {
            "user_id": user_id,
            "key_hash": hash_api_key(plaintext_key),
            "label": label,
            "active": True,
            "created_at": datetime.utcnow(),
        }
    )
    return plaintext_key


async def require_api_key(
    authorization: Annotated[str | None, Header()] = None,
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> dict[str, str]:
    plaintext_key = extract_api_key(authorization, x_api_key)
    if not plaintext_key:
        raise HTTPException(status_code=401, detail="Missing API key.")

    record = api_keys_collection.find_one(
        {
            "key_hash": hash_api_key(plaintext_key),
            "active": True,
        }
    )
    if not record:
        raise HTTPException(status_code=401, detail="Invalid API key.")

    return {
        "user_id": record["user_id"],
        "key_id": str(record["_id"]),
    }
