#!/usr/bin/env python3
"""Create a new API key for a user and print the plaintext key once."""

import argparse
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from auth import create_api_key_record
from database import api_keys_collection


def main() -> None:
    parser = argparse.ArgumentParser(description="Create an API key for the chatbot API.")
    parser.add_argument("user_id", help="Tenant/user id associated with this key")
    parser.add_argument("--label", default="manual", help="Optional label for the key")
    args = parser.parse_args()

    if api_keys_collection.database.client is None:
        print("MongoDB is not configured.", file=sys.stderr)
        sys.exit(1)

    plaintext_key = create_api_key_record(args.user_id, label=args.label)
    print("API key created successfully.")
    print(f"user_id: {args.user_id}")
    print(f"api_key: {plaintext_key}")
    print("Store this key securely. It will not be shown again.")


if __name__ == "__main__":
    main()
