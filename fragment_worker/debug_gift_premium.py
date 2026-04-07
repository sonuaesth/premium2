import asyncio
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from FragmentAPI import AsyncFragmentAPI

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def emit(payload: dict, code: int = 0):
    print(json.dumps(payload, ensure_ascii=False))
    raise SystemExit(code)


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        emit(
            {
                "success": False,
                "stage": "config",
                "error": f"Отсутствует обязательная переменная окружения: {name}",
            },
            1,
        )
    return value


async def main():
    if len(sys.argv) != 3:
        emit(
            {
                "success": False,
                "stage": "args",
                "error": "Использование: python debug_gift_premium.py <username> <months>",
            },
            1,
        )

    username = sys.argv[1].lstrip("@").strip()
    try:
        months = int(sys.argv[2])
    except ValueError:
        emit(
            {
                "success": False,
                "stage": "args",
                "error": "Количество месяцев должно быть целым числом",
            },
            1,
        )

    if months not in (3, 6, 12):
        emit(
            {
                "success": False,
                "stage": "args",
                "error": "Количество месяцев должно быть 3, 6 или 12",
            },
            1,
        )

    cookies = require_env("FRAGMENT_COOKIES")
    hash_value = require_env("FRAGMENT_HASH")
    wallet_mnemonic = require_env("TON_WALLET_MNEMONIC")
    wallet_api_key = require_env("TON_API_KEY")
    wallet_version = os.getenv("TON_WALLET_VERSION", "V4R2").strip() or "V4R2"

    try:
        async with AsyncFragmentAPI(
            cookies=cookies,
            hash_value=hash_value,
            wallet_mnemonic=wallet_mnemonic,
            wallet_api_key=wallet_api_key,
            wallet_version=wallet_version,
        ) as api:
            balance = await api.get_wallet_balance()

            try:
                recipient = await api.get_recipient_premium(username)
            except Exception as error:
                emit(
                    {
                        "success": False,
                        "stage": "recipient_lookup",
                        "username": username,
                        "months": months,
                        "wallet_balance": balance,
                        "error_type": type(error).__name__,
                        "error": str(error),
                    },
                    1,
                )

            try:
                result = await api.gift_premium(username, months=months)
            except Exception as error:
                emit(
                    {
                        "success": False,
                        "stage": "gift_premium_call",
                        "username": username,
                        "months": months,
                        "wallet_balance": balance,
                        "recipient": {
                            "name": getattr(recipient, "name", None),
                            "recipient": getattr(recipient, "recipient", None),
                            "found": getattr(recipient, "found", None),
                            "avatar": getattr(recipient, "avatar", None),
                        },
                        "error_type": type(error).__name__,
                        "error": str(error),
                    },
                    1,
                )

            if result.success:
                emit(
                    {
                        "success": True,
                        "stage": "completed",
                        "username": username,
                        "months": months,
                        "wallet_balance": balance,
                        "recipient": {
                            "name": getattr(result.user, "name", None) if result.user else None,
                            "recipient": getattr(result.user, "recipient", None) if result.user else None,
                            "found": getattr(result.user, "found", None) if result.user else None,
                            "avatar": getattr(result.user, "avatar", None) if result.user else None,
                        },
                        "transaction_hash": getattr(result, "transaction_hash", None),
                        "required_amount": getattr(result, "required_amount", None),
                    }
                )

            emit(
                {
                    "success": False,
                    "stage": "gift_premium_result",
                    "username": username,
                    "months": months,
                    "wallet_balance": balance,
                    "recipient": {
                        "name": getattr(result.user, "name", None) if result.user else None,
                        "recipient": getattr(result.user, "recipient", None) if result.user else None,
                        "found": getattr(result.user, "found", None) if result.user else None,
                        "avatar": getattr(result.user, "avatar", None) if result.user else None,
                    },
                    "error": getattr(result, "error", None),
                    "transaction_hash": getattr(result, "transaction_hash", None),
                    "required_amount": getattr(result, "required_amount", None),
                    "balance_checked": getattr(result, "balance_checked", None),
                },
                1,
            )
    except Exception as error:
        emit(
            {
                "success": False,
                "stage": "client_setup",
                "username": username,
                "months": months,
                "error_type": type(error).__name__,
                "error": str(error),
            },
            1,
        )


if __name__ == "__main__":
    asyncio.run(main())
