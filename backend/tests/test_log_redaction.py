"""API keys and street addresses stay out of URLs and logs (audit S6).

Run:  cd backend && python3 tests/test_log_redaction.py   (exit 0 = pass)

1. The redacting filter masks key, token and address query values and
   key headers in any log line, and leaves ordinary text alone.
2. After app.main loads, httpx and httpcore log at WARNING, so the
   per-request INFO line with the full URL is gone.
3. Congress.gov, OpenFEC and Google Civic calls send the key as a
   header and never as a query parameter.
"""
import asyncio
import io
import logging
import os
import sys
import tempfile


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    os.environ["CONGRESS_API_KEY"] = "CONGRESSKEY123"
    os.environ["OPEN_FEC_API_KEY"] = "FECKEY123"
    os.environ["GOOGLE_CIVIC_API_KEY"] = "GOOGLEKEY123"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

    import app.main  # noqa: F401  (installs the filter)
    import httpx
    from app.services.log_redaction import RedactingFilter, redact

    failures = []

    # 1. filter behaviour
    line = ('HTTP Request: GET https://api.congress.gov/v3/bill?api_key=SECRET1&format=json '
            'and /api/address/lookup?address=123%20Main%20St&zip=32801 '
            "headers={'X-Api-Key': 'SECRET2'}")
    out = redact(line)
    for secret in ("SECRET1", "SECRET2", "123%20Main", "32801"):
        if secret in out:
            failures.append(f"redact() left {secret!r} in: {out}")
    if "format=json" not in out:
        failures.append("redact() removed a harmless parameter")

    buf = io.StringIO()
    handler = logging.StreamHandler(buf)
    handler.addFilter(RedactingFilter())
    lg = logging.getLogger("redaction-test")
    lg.addHandler(handler)
    lg.setLevel(logging.INFO)
    lg.propagate = False
    lg.info("fetch failed %s", "https://x.test/?key=SECRET3&state=FL")
    if "SECRET3" in buf.getvalue() or "state=FL" not in buf.getvalue():
        failures.append(f"filter output wrong: {buf.getvalue()!r}")

    # 2. httpx quiet
    for name in ("httpx", "httpcore"):
        if logging.getLogger(name).getEffectiveLevel() < logging.WARNING:
            failures.append(f"{name} logger still logs below WARNING")

    # 3. keys in headers, not params
    calls = []

    class FakeResp:
        status_code = 200

        def json(self):
            return {}

    async def fake_get(self, url, params=None, headers=None, **kw):
        calls.append((str(url), dict(params or {}), dict(headers or {})))
        return FakeResp()

    httpx.AsyncClient.get = fake_get

    from app.services import fec_service, google_civic_service
    from app.services.congress_service import CongressService

    async def drive():
        await CongressService()._api_get("/bill")
        await fec_service.fetch_state_federal_candidates("FL", 2026, "H")
        await google_civic_service.fetch_voter_info("1 Main St, Orlando, FL")
        await google_civic_service.fetch_elections()
        await google_civic_service.fetch_divisions("1 Main St, Orlando, FL")

    asyncio.run(drive())

    if not calls:
        failures.append("no outbound calls captured")
    for url, params, headers in calls:
        joined = url + " " + " ".join(f"{k}={v}" for k, v in params.items())
        for secret in ("CONGRESSKEY123", "FECKEY123", "GOOGLEKEY123"):
            if secret in joined:
                failures.append(f"key in URL or params: {joined}")
        if not any(v in ("CONGRESSKEY123", "FECKEY123", "GOOGLEKEY123") for v in headers.values()):
            failures.append(f"no key header on {url}")
    hosts = {u.split('/')[2] for u, _, _ in calls}
    for expected in ("api.congress.gov", "api.open.fec.gov", "www.googleapis.com"):
        if expected not in hosts:
            failures.append(f"no call captured to {expected}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("NO KEYS OR ADDRESSES IN URLS OR LOGS.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
