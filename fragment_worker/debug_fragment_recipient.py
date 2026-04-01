import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from FragmentAPI.core import FragmentAPICore

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def fail(stage: str, error: str, extra: dict | None = None, code: int = 1):
    payload = {"success": False, "stage": stage, "error": error}
    if extra:
        payload.update(extra)
    print(json.dumps(payload, ensure_ascii=False))
    raise SystemExit(code)


def main():
    if len(sys.argv) != 2:
        fail("args", "Usage: python debug_fragment_recipient.py <username>")

    username = sys.argv[1].lstrip("@").strip()
    cookies = os.getenv("FRAGMENT_COOKIES", "").strip()
    hash_value = os.getenv("FRAGMENT_HASH", "").strip()

    if not cookies or not hash_value:
        fail("config", "Missing FRAGMENT_COOKIES or FRAGMENT_HASH")

    try:
        core = FragmentAPICore(cookies, hash_value)
    except Exception as error:
        fail("core_init", str(error), {"error_type": type(error).__name__})

    try:
        response = core._make_request(
            {
                "query": username,
                "method": "searchPremiumGiftRecipient",
                "months": "3",
            }
        )
    except Exception as error:
        core.close()
        fail("request", str(error), {"error_type": type(error).__name__, "username": username})

    core.close()
    print(
        json.dumps(
            {
                "success": True,
                "stage": "recipient_lookup",
                "username": username,
                "response": response,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
