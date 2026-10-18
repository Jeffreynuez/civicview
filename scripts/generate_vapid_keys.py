#!/usr/bin/env python3
# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Make the VAPID key pair for web push (2026-10-18). Run it on your own
computer, never in a Claude session, a CI job or a shared terminal.

    cd "C:\\dev\\US apps\\CivicLens"
    python scripts\\generate_vapid_keys.py

(any Python 3 with the cryptography package; if it says it is missing,
pip install cryptography first).

It prints four lines to paste, and writes nothing to disk:

    Render, service civicview-api, Environment:
      VAPID_PUBLIC_KEY        the public key
      VAPID_PRIVATE_KEY       the private key (secret)
      VAPID_SUBJECT           mailto:civicview@civicview.app
    Vercel, project settings, Environment Variables (Production):
      NEXT_PUBLIC_VAPID_PUBLIC_KEY   the same public key

Keep a copy of the pair in C:\\dev\\US apps\\Keys\\, outside the repo.
The private key never goes in the repo, a chat or a log. The public key is
public (every browser gets it), but it must be the same on Render and
Vercel: the API refuses a subscription made with another key.

Run it once. A new pair later ends every browser's subscription (each
browser subscribes again, without a prompt, the next time CivicView is
opened in it), so only replace the pair if the private key leaks.
"""
import base64
import sys

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
except ImportError:
    sys.exit("This needs the cryptography package: pip install cryptography")

SUBJECT = "mailto:civicview@civicview.app"


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def main() -> int:
    key = ec.generate_private_key(ec.SECP256R1())
    # The raw 32-byte private value and the 65-byte uncompressed public
    # point, base64url without padding: the forms py-vapid (the API) and
    # PushManager.subscribe (the browser) read.
    private = b64url(key.private_numbers().private_value.to_bytes(32, "big"))
    public = b64url(key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    print("Render (civicview-api), Environment:")
    print(f"  VAPID_PUBLIC_KEY={public}")
    print(f"  VAPID_PRIVATE_KEY={private}")
    print(f"  VAPID_SUBJECT={SUBJECT}")
    print("Vercel (Production), Environment Variables:")
    print(f"  NEXT_PUBLIC_VAPID_PUBLIC_KEY={public}")
    print()
    print("Save the pair in C:\\dev\\US apps\\Keys\\ (never in the repo), then clear this window.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
