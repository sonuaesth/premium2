import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from FragmentAPI import AsyncFragmentAPI

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def fail(message: str, code: int = 1):
    print(json.dumps({"success": False, "error": message}))
    raise SystemExit(code)

async def main():
    if len(sys.argv) != 3:
        fail("Usage: python gift_premium.py <username> <months>")

    username = sys.argv[1].lstrip("@").strip()
    try:
        months = int(sys.argv[2])
    except ValueError:
        fail("Months must be an integer")

    if months not in (3, 6, 12):
        fail("Months must be 3, 6, or 12")

    cookies = os.getenv("FRAGMENT_COOKIES", "").strip()
    hash_value = os.getenv("FRAGMENT_HASH", "").strip()
    wallet_mnemonic = os.getenv("TON_WALLET_MNEMONIC", "").strip()
    wallet_api_key = os.getenv("TON_API_KEY", "").strip()
    wallet_version = os.getenv("TON_WALLET_VERSION", "V4R2").strip()

    if not all([cookies, hash_value, wallet_mnemonic, wallet_api_key]):
        fail("Missing Fragment or TON environment variables")

    try:
        async with AsyncFragmentAPI(
            cookies=cookies,
            hash_value=hash_value,
            wallet_mnemonic=wallet_mnemonic,
            wallet_api_key=wallet_api_key,
            wallet_version=wallet_version,
        ) as api:
            result = await api.gift_premium(username, months=months)

        if result.success:
            print(json.dumps({
                "success": True,
                "username": username,
                "months": months,
                "transaction_hash": getattr(result, "transaction_hash", None),
                "required_amount": getattr(result, "required_amount", None),
            }))
            return

        print(json.dumps({
            "success": False,
            "username": username,
            "months": months,
            "error": getattr(result, "error", "Unknown error"),
        }))
    except Exception as error:
        fail(str(error))

if __name__ == "__main__":
    asyncio.run(main())
