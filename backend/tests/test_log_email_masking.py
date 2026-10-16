"""Email addresses and sign-up details stay out of the logs (2026-10-16).

Run:  cd backend && python3 tests/test_log_email_masking.py   (exit 0 = pass)

Before: the waitlist, Brevo sync, email service, two-step sign-in,
appeals, admin actions, admin notices and seeding logged whole email
addresses; a demo sign-up logged the new account's display name, state
and district; and a voter_token in a URL reached the access log.

Now:
1. mask_email() keeps the first letter and the domain (j***@example.org).
2. The RedactingFilter masks any address left in a message, its args or
   its traceback, and masks voter_token like the other tokens.
3. Real paths log masked addresses even without the filter: a waitlist
   sign-up, a demo sign-up (account number only), the dev and Postmark
   email backends, and Brevo (its response body is not logged).
4. Static guard: no logger call in app/ passes an email-looking value
   without mask_email().
"""
import ast
import logging
import os
import pathlib
import re
import sys
import tempfile


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    for name in ("BREVO_API_KEY", "BREVO_WAITLIST_LIST_ID", "POSTMARK_API_TOKEN", "POSTMARK_FROM_EMAIL"):
        os.environ.pop(name, None)
    backend = pathlib.Path(__file__).resolve().parent.parent
    sys.path.insert(0, str(backend))

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    from app.services.log_redaction import RedactingFilter, mask_email, redact

    # 1. mask_email
    for raw, want in (("jane.doe@Example.org", "j***@example.org"), ("x@y.co", "x***@y.co"),
                      ("", "(none)"), (None, "(none)"), ("not-an-address", "***")):
        check(mask_email(raw) == want, f"mask_email({raw!r}) = {mask_email(raw)!r}, want {want!r}")

    # 2. the filter, as a backstop
    text = redact("to=jane.doe@example.org GET /api/pages/x?voter_token=abc123&scope=state")
    check("jane.doe" not in text and "j***@example.org" in text, f"redact email: {text}")
    check("abc123" not in text and "voter_token=[redacted]" in text, f"redact voter_token: {text}")
    check(redact("already j***@example.org") == "already j***@example.org", "a masked address stays as it is")
    try:
        raise ValueError("Illegal 'To' address: 'bob.smith@mail.example.com'")
    except ValueError:
        rec = logging.LogRecord("t", logging.ERROR, __file__, 1, "send failed for %s", ("bob.smith@mail.example.com",),
                                sys.exc_info())
    RedactingFilter().filter(rec)
    out = logging.Formatter().format(rec)
    check("bob.smith" not in out, f"traceback and args should be masked: {out[-200:]}")
    check("b***@mail.example.com" in out, "the masked form should be in the line")

    # 3. real paths, captured WITHOUT the filter so the call sites
    #    themselves are tested.
    lines = []

    class Capture(logging.Handler):
        # The message only, read before any other handler's filter can
        # rewrite the record, and without caching a traceback on it.
        def emit(self, record):
            lines.append(f"{record.name} {record.getMessage()}")

    import app.main as m
    from fastapi.testclient import TestClient

    cap = Capture()
    root = logging.getLogger()
    root.handlers.insert(0, cap)  # ahead of the app's filtered handler
    root.setLevel(logging.INFO)

    with TestClient(m.app) as c:
        lines.clear()
        r = c.post("/api/waitlist", json={"email": "wanda.waitlist@example.org", "clicked_from": "hero", "state": "FL"})
        check(r.status_code == 200, f"waitlist {r.status_code}")
        joined = "\n".join(lines)
        check("wanda.waitlist" not in joined, f"waitlist email in the log: {joined[-300:]}")
        check("w***@example.org" in joined, "waitlist log should show the masked address")

        lines.clear()
        r = c.post("/api/citizen-auth/demo-signup", json={
            "display_name": "Quentin Quillfeather", "state": "VT", "congressional_district": "VT-AL",
            "city": "Montpelier", "age_confirmed": True,
        })
        check(r.status_code == 201, f"demo signup {r.status_code} {r.text[:200]}")
        joined = "\n".join(lines)
        check("Demo citizen created: id=" in joined, "the sign-up should still be logged by account number")
        for detail in ("Quentin", "Quillfeather", "VT-AL", "Montpelier", "demo-citizens.civicview.app"):
            check(detail not in joined, f"sign-up detail {detail!r} reached the log")

    from app.services import brevo_service, email_service

    # Dev email backend: masked recipient.
    lines.clear()
    email_service.DevEmailService().send(to="dana.dev@example.net", subject="s", text_body="b")
    joined = "\n".join(lines)
    check("dana.dev" not in joined and "d***@example.net" in joined, f"dev email log: {joined}")

    # Postmark backend failing with the address in the error text: the
    # call site masks the argument (the traceback is the filter's job).
    svc = email_service.PostmarkEmailService.__new__(email_service.PostmarkEmailService)
    svc._from_email, svc._stream = "civicview@civicview.app", "outbound"

    class _Emails:
        def send(self, **kw):
            raise RuntimeError("Invalid 'To' address: 'pat.postmark@example.com'")

    svc._client = type("C", (), {"emails": _Emails()})()
    lines.clear()
    check(svc.send(to="pat.postmark@example.com", subject="s", text_body="b") is False, "failed send returns False")
    joined = "\n".join(lines)
    check("pat.postmark" not in joined and "p***@example.com" in joined, f"postmark log: {joined}")

    # Brevo non-2xx: masked address, Brevo's error code, never its body.
    import httpx

    class _Resp:
        status_code = 400
        text = '{"code":"invalid_parameter","message":"email is not valid: bree.brevo@example.org"}'

        def json(self):
            return {"code": "invalid_parameter", "message": "email is not valid: bree.brevo@example.org"}

    os.environ.update({"BREVO_API_KEY": "test-key", "BREVO_WAITLIST_LIST_ID": "3"})
    orig_post = httpx.post
    httpx.post = lambda *a, **k: _Resp()
    try:
        lines.clear()
        brevo_service.sync_waitlist_contact("bree.brevo@example.org", "FL", "hero")
    finally:
        httpx.post = orig_post
        os.environ.pop("BREVO_API_KEY", None)
        os.environ.pop("BREVO_WAITLIST_LIST_ID", None)
    joined = "\n".join(lines)
    check("bree.brevo" not in joined, f"brevo log: {joined}")
    check("invalid_parameter" in joined, f"brevo log should keep the error code: {joined}")

    root.removeHandler(cap)

    # 4. static guard over every logger call in app/
    risky = re.compile(r"(?i)(email|\bto\b|\baddr\b|recipient|display_name|congressional_district)")
    allowed = {"os.getenv('POSTMARK_FROM_EMAIL')"}  # our own sender address
    offenders = []
    for path in sorted((backend / "app").rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in ("debug", "info", "warning", "error", "exception", "critical")
                    and "log" in ast.unparse(node.func.value).lower()):
                continue
            for arg in node.args[1:]:
                src = ast.unparse(arg)
                if src.startswith("mask_email(") or src in allowed:
                    continue
                # Seeded accounts' names come from operator config.
                if path.name == "seed.py" and "display_name" in src:
                    continue
                if risky.search(src) and not src.endswith(".id"):
                    offenders.append(f"{path.relative_to(backend)}:{node.lineno}: {src}")
    check(not offenders, "logger calls passing unmasked personal values:\n  " + "\n  ".join(offenders))

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: no email addresses or sign-up details in the logs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
