# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Request body size limits (audit S12).

Nothing capped request bodies before: a 5 MB JSON body to a tracked-item
endpoint was accepted and stored. This pure ASGI middleware caps every
request body:

  • multipart/form-data (post image upload): 6 MB, just above the 5 MB
    per-image limit pages.py enforces itself.
  • everything else: 1 MB. The largest legitimate JSON body is the AI
    search over a loaded list of bills or votes, which stays well
    under that.

A declared Content-Length over the cap is refused before the body is
read. A body without one (chunked) is counted as it streams; the read
that crosses the cap aborts the request, and whatever response the app
produces for the aborted read is replaced with the same 413.

Pure ASGI rather than BaseHTTPMiddleware so the body is never buffered
here, and so it can sit inside CORS (413s still carry CORS headers).
"""
from __future__ import annotations

import json

from fastapi import HTTPException

DEFAULT_LIMIT = 1 * 1024 * 1024
MULTIPART_LIMIT = 6 * 1024 * 1024


class BodySizeLimitMiddleware:
    def __init__(self, app, default_limit: int = DEFAULT_LIMIT, multipart_limit: int = MULTIPART_LIMIT):
        self.app = app
        self.default_limit = default_limit
        self.multipart_limit = multipart_limit

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)

        headers = {k.lower(): v for k, v in scope.get("headers") or []}
        ctype = headers.get(b"content-type", b"").decode("latin-1").lower()
        limit = self.multipart_limit if ctype.startswith("multipart/form-data") else self.default_limit

        declared = headers.get(b"content-length")
        if declared is not None:
            try:
                if int(declared) > limit:
                    return await _send_413(send, limit)
            except ValueError:
                pass

        seen = 0
        exceeded = False
        replaced = False

        async def limited_receive():
            nonlocal seen, exceeded
            message = await receive()
            if message.get("type") == "http.request":
                seen += len(message.get("body") or b"")
                if seen > limit:
                    exceeded = True
                    raise HTTPException(status_code=413, detail=_detail(limit))
            return message

        async def guarded_send(message):
            # Whatever the layers above made of the aborted read (FastAPI
            # can turn it into a 400 "error parsing the body"), the client
            # gets a 413.
            nonlocal replaced
            if exceeded:
                if message.get("type") == "http.response.start" and not replaced:
                    replaced = True
                    await _send_413(send, limit)
                return
            await send(message)

        return await self.app(scope, limited_receive, guarded_send)


def _detail(limit: int) -> str:
    return f"Request body too large (limit {limit // (1024 * 1024)} MB)."


async def _send_413(send, limit: int) -> None:
    body = json.dumps({"detail": _detail(limit), "code": "payload_too_large"}).encode("utf-8")
    await send({
        "type": "http.response.start",
        "status": 413,
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
    })
    await send({"type": "http.response.body", "body": body})
