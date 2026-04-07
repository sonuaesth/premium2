import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from FragmentAPI.core import FragmentAPICore

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def emit(payload: dict, code: int = 0):
    print(json.dumps(payload, ensure_ascii=False))
    raise SystemExit(code)


def main():
    if len(sys.argv) != 3:
        emit(
            {
                "success": False,
                "stage": "args",
                "error": "Использование: python debug_fragment_gift_chain.py <username> <months>",
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

    cookies = os.getenv("FRAGMENT_COOKIES", "").strip()
    hash_value = os.getenv("FRAGMENT_HASH", "").strip()

    if not cookies or not hash_value:
        emit(
            {
                "success": False,
                "stage": "config",
                "error": "Отсутствуют FRAGMENT_COOKIES или FRAGMENT_HASH",
            },
            1,
        )

    try:
        core = FragmentAPICore(cookies, hash_value)
    except Exception as error:
        emit(
            {
                "success": False,
                "stage": "core_init",
                "error_type": type(error).__name__,
                "error": str(error),
            },
            1,
        )

    search_response = None
    init_response = None

    try:
        search_response = core._make_request(
            {
                "query": username,
                "method": "searchPremiumGiftRecipient",
                "months": str(months),
            }
        )

        recipient = (search_response.get("found") or {}).get("recipient")
        if not recipient:
            emit(
                {
                    "success": False,
                    "stage": "searchPremiumGiftRecipient",
                    "username": username,
                    "months": months,
                    "response": search_response,
                    "error": "В ответе отсутствует получатель",
                },
                1,
            )

        init_response = core._make_request(
            {
                "recipient": recipient,
                "months": str(months),
                "method": "initGiftPremiumRequest",
            }
        )

        req_id = init_response.get("req_id")
        if not req_id:
            emit(
                {
                    "success": False,
                    "stage": "initGiftPremiumRequest",
                    "username": username,
                    "months": months,
                    "recipient": recipient,
                    "search_response": search_response,
                    "response": init_response,
                    "error": "В ответе отсутствует req_id",
                },
                1,
            )

        link_response = core._make_request(
            {
                "transaction": "1",
                "id": req_id,
                "show_sender": "0",
                "method": "getGiftPremiumLink",
            }
        )

        emit(
            {
                "success": True,
                "stage": "completed",
                "username": username,
                "months": months,
                "search_response": search_response,
                "init_response": init_response,
                "link_response": link_response,
            }
        )
    except Exception as error:
        emit(
            {
                "success": False,
                "stage": "request_exception",
                "username": username,
                "months": months,
                "search_response": search_response,
                "init_response": init_response,
                "error_type": type(error).__name__,
                "error": str(error),
            },
            1,
        )
    finally:
        core.close()


if __name__ == "__main__":
    main()
