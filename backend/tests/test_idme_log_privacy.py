"""An ID.me reply that can't be parsed is logged by key names only (2026-10-16).

Run:  cd backend && python3 tests/test_idme_log_privacy.py   (exit 0 = pass)

Before: services/idme_service.py logged
  logger.exception("ID.me userinfo parse failed; data=%r", data)
which wrote the whole userinfo reply to the logs: the verified name,
street address and, when ID.me sends it, the date of birth.

Now the line names the error type and the reply's top-level key names,
with no values and no traceback (an error message can quote a value).
httpx is replaced by fakes: nothing here reaches the network.
"""
import logging
import os
import sys


class _Resp:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def main() -> int:
    os.environ.update({
        "IDME_CLIENT_ID": "test-client", "IDME_CLIENT_SECRET": "test-secret",
        "IDME_REDIRECT_URI": "http://localhost:8000/api/identity/idme/callback",
    })
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

    import httpx

    from app.services import idme_service

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    # Every record, formatted the way a handler would write it,
    # including any traceback.
    lines = []
    fmt = logging.Formatter("%(levelname)s %(name)s %(message)s")

    class Capture(logging.Handler):
        def emit(self, record):
            lines.append(fmt.format(record))

    logger = logging.getLogger("app.services.idme_service")
    logger.addHandler(Capture())
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    private = ("1980-02-03", "Janet", "Doolittle", "742 Evergreen", "62704")
    replies = [
        # Values that make the parser fail, one of which (ial_level)
        # would be quoted by the int() error message.
        {"fname": "Janet", "lname": "Doolittle", "birth_date": "1980-02-03",
         "street": "742 Evergreen Terrace", "zip": "62704", "ial_level": "1980-02-03"},
        # A nested reply whose parse fails on a non-string name.
        {"attributes": {"name": ["Janet", "Doolittle"], "birth_date": "1980-02-03"}, "status": "ok"},
        # Not an object at all.
        ["Janet Doolittle", "1980-02-03"],
    ]
    expected_keys = [
        "birth_date, fname, ial_level, lname, street, zip",
        "attributes, status",
        "(not an object: list)",
    ]

    svc = idme_service.IdMeService()
    orig_post, orig_get = httpx.post, httpx.get
    try:
        httpx.post = lambda *a, **k: _Resp({"access_token": "tok"})
        for reply, keys in zip(replies, expected_keys):
            lines.clear()
            httpx.get = lambda *a, _r=reply, **k: _Resp(_r)
            try:
                svc.exchange_code_for_attributes(code="abc")
                check(False, f"parse should fail for {keys}")
            except idme_service.IdMeError:
                pass
            text = "\n".join(lines)
            check(len(lines) == 1, f"one log line expected, got {len(lines)}: {text[:300]}")
            check(f"top-level keys={keys}" in text, f"key names missing: {text[:300]}")
            check("Traceback" not in text, "no traceback in the log")
            for value in private:
                check(value not in text, f"{value!r} reached the log: {text[:300]}")
    finally:
        httpx.post, httpx.get = orig_post, orig_get

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: ID.me parse failures log key names only")
    return 0


if __name__ == "__main__":
    sys.exit(main())
