# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""The one place CivicView decides which IP address a request came from.

Every per-IP limit (demo signup, suspension appeals, the engagement rate
limiter's anonymous fallback) and the login audit trail depend on this
answer, so it lives in one function instead of four copies.

HOW THE REQUEST ARRIVES
    browser -> Cloudflare (api.civicview.app) -> Render's proxy -> uvicorn

Render's proxy appends the address that connected to it as the LAST
X-Forwarded-For entry. Everything to the left of that entry was supplied
by whoever sent the request, so it cannot be trusted. The previous code
took the FIRST entry, which meant any caller could pick their own IP by
sending an X-Forwarded-For header, and dodge every per-IP limit.

So:
  * Take the last hop (the address that actually connected to Render).
  * If that hop is a Cloudflare edge, the request came through our own
    Cloudflare zone, and Cloudflare's CF-Connecting-IP names the real
    client. Trust it.
  * Otherwise (someone calling civicview-api.onrender.com directly, or
    local development), the last hop IS the client. A CF-Connecting-IP
    header on such a request is forged, so it is ignored.
"""
from __future__ import annotations

import ipaddress
from functools import lru_cache
from typing import Optional

# Cloudflare's published edge ranges (https://www.cloudflare.com/ips/).
# They change rarely; if Cloudflare adds a range, requests from it fall
# back to "the edge's own IP", which is safe (over-limits one edge rather
# than trusting a forgeable header).
_CLOUDFLARE_RANGES = (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
    "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
    "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
    "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
    "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
)
_NETWORKS = tuple(ipaddress.ip_network(r) for r in _CLOUDFLARE_RANGES)


@lru_cache(maxsize=4096)
def _is_cloudflare(addr: str) -> bool:
    try:
        ip = ipaddress.ip_address(addr)
    except ValueError:
        return False
    return any(ip in net for net in _NETWORKS)


def _valid_ip(addr: Optional[str]) -> Optional[str]:
    if not addr:
        return None
    addr = addr.strip()
    try:
        ipaddress.ip_address(addr)
    except ValueError:
        return None
    return addr


def client_ip(request) -> str:
    """Best trustworthy guess at the caller's IP address. Never raises."""
    if request is None:
        return "unknown"
    peer = request.client.host if getattr(request, "client", None) else None
    chain = [h.strip() for h in (request.headers.get("x-forwarded-for") or "").split(",") if h.strip()]
    hop = _valid_ip(chain[-1]) if chain else _valid_ip(peer)
    if hop and _is_cloudflare(hop):
        cf = _valid_ip(request.headers.get("cf-connecting-ip"))
        if cf:
            return cf
    return hop or peer or "unknown"
