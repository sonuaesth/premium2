import json
import os
from pathlib import Path

from dotenv import load_dotenv
from FragmentAPI.utils import parse_cookies

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def main():
    cookies = os.getenv("FRAGMENT_COOKIES", "").strip()
    hash_value = os.getenv("FRAGMENT_HASH", "").strip()
    wallet_mnemonic = os.getenv("TON_WALLET_MNEMONIC", "").strip()
    wallet_api_key = os.getenv("TON_API_KEY", "").strip()
    wallet_version = os.getenv("TON_WALLET_VERSION", "").strip()

    parsed_cookies = parse_cookies(cookies) if cookies else {}

    print(
        json.dumps(
            {
                "has_fragment_cookies": bool(cookies),
                "cookie_keys": sorted(parsed_cookies.keys()),
                "hash_length": len(hash_value),
                "wallet_mnemonic_words": len(wallet_mnemonic.split()) if wallet_mnemonic else 0,
                "has_ton_api_key": bool(wallet_api_key),
                "wallet_version": wallet_version,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
