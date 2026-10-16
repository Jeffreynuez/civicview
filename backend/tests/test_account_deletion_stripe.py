"""Deleting a citizen account cancels its Stripe subscription (2026-10-16).

Run:  cd backend && python3 tests/test_account_deletion_stripe.py   (exit 0 = pass)

Before: services/account_deletion.py deleted the row and never told
Stripe, so a paying citizen who deleted their account kept being billed
with no account left to cancel from.

Now, when Stripe is configured, a hard delete and the 30-day purge both
cancel every subscription that can still charge (on the Stripe customer
and the stored subscription id), immediately, before the row goes. If
Stripe fails, nothing is deleted: the API answers 503 and the purge
keeps that account for its next pass while the others still go. Logs
carry Stripe ids only. Stripe is mocked: nothing here reaches the
network.
"""
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone


class _Sub(dict):
    pass


class FakeStripe:
    """Stands in for the `stripe` module inside StripeBillingService."""

    class InvalidRequestError(Exception):
        def __init__(self, message, code=None):
            super().__init__(message)
            self.code = code

    def __init__(self):
        self.subscriptions = {}   # id -> {"id", "customer", "status"}
        self.missing_customers = set()
        self.failing_customers = set()
        self.calls = []
        fake = self

        class _Page:
            def __init__(self, items):
                self._items = items

            def auto_paging_iter(self):
                return iter(self._items)

        class Subscription:
            @staticmethod
            def list(customer=None, status=None, limit=None):
                fake.calls.append(("list", customer))
                if customer in fake.failing_customers:
                    raise ConnectionError("Stripe unreachable for jane.citizen@example.com")
                if customer in fake.missing_customers:
                    raise FakeStripe.InvalidRequestError("No such customer", code="resource_missing")
                return _Page([_Sub(s) for s in fake.subscriptions.values() if s["customer"] == customer])

            @staticmethod
            def retrieve(sub_id):
                fake.calls.append(("retrieve", sub_id))
                if sub_id not in fake.subscriptions:
                    raise FakeStripe.InvalidRequestError("No such subscription", code="resource_missing")
                return _Sub(fake.subscriptions[sub_id])

            @staticmethod
            def cancel(sub_id):
                fake.calls.append(("cancel", sub_id))
                fake.subscriptions[sub_id]["status"] = "canceled"
                return _Sub(fake.subscriptions[sub_id])

        self.Subscription = Subscription

    def canceled(self):
        return [sid for op, sid in self.calls if op == "cancel"]


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod")
    os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
    for name in ("STRIPE_API_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET"):
        os.environ.pop(name, None)
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging

    import app.main as m
    from fastapi.testclient import TestClient
    from app.auth import compute_csrf_token, hash_password
    from app.auth_citizen import issue_citizen_token
    from app.db import SessionLocal
    from app.models.pages import CitizenAccount
    from app.services import account_deletion, stripe_service

    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    # Capture every log record (the rest of the app stays quiet).
    records = []

    class Capture(logging.Handler):
        def emit(self, record):
            records.append(record.getMessage())

    root = logging.getLogger()
    root.addHandler(Capture())
    root.setLevel(logging.DEBUG)
    for noisy in ("httpx", "urllib3", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    fake = FakeStripe()

    def use_stripe():
        os.environ.update({"STRIPE_API_KEY": "sk_test_not_real", "STRIPE_PRICE_ID": "price_test",
                           "STRIPE_WEBHOOK_SECRET": "whsec_test"})
        stripe_service.reset_billing_service_for_tests()
        svc = stripe_service.StripeBillingService()
        svc._stripe = fake  # every Stripe call goes to the fake
        stripe_service._BILLING_SINGLETON = svc

    def use_dev_billing():
        for name in ("STRIPE_API_KEY", "STRIPE_PRICE_ID", "STRIPE_WEBHOOK_SECRET"):
            os.environ.pop(name, None)
        stripe_service.reset_billing_service_for_tests()

    def make_citizen(db, email, name, **kw):
        cit = CitizenAccount(email=email, password_hash=hash_password("pw-12345678"), display_name=name,
                             city="", state="FL", congressional_district="FL-10", is_active=True, **kw)
        db.add(cit)
        db.flush()
        return cit

    def delete_via_api(c, cid, email):
        tok = issue_citizen_token(cid)
        c.cookies.clear()
        return c.post("/api/citizen-auth/delete",
                      json={"confirm_email": email, "mode": "hard", "password": "pw-12345678"},
                      headers={"X-Citizen-Token": tok, "X-CSRF-Token": compute_csrf_token(tok)})

    with TestClient(m.app) as c:
        use_stripe()
        fake.subscriptions.update({
            "sub_live": {"id": "sub_live", "customer": "cus_jane", "status": "active"},
            "sub_late": {"id": "sub_late", "customer": "cus_jane", "status": "past_due"},
            "sub_old": {"id": "sub_old", "customer": "cus_jane", "status": "canceled"},
        })
        with SessionLocal() as db:
            jane = make_citizen(db, "jane.citizen@example.com", "Jane Q Citizen",
                                stripe_customer_id="cus_jane", stripe_subscription_id="sub_live",
                                subscription_status="active", is_subscribed=True)
            db.commit()
            jane_id = jane.id

        # 1. Hard delete through the API cancels both live subscriptions
        #    (not the one already canceled) and then deletes the row.
        records.clear()
        r = delete_via_api(c, jane_id, "jane.citizen@example.com")
        check(r.status_code == 200, f"hard delete: {r.status_code} {r.text[:160]}")
        check(sorted(fake.canceled()) == ["sub_late", "sub_live"], f"canceled: {fake.canceled()}")
        with SessionLocal() as db:
            check(db.get(CitizenAccount, jane_id) is None, "account should be gone after a successful cancel")
        logged = "\n".join(records)
        check("sub_live" in logged and "cus_jane" in logged, "the cancel should be logged with its ids")
        check("jane.citizen" not in logged and "Jane Q Citizen" not in logged,
              "logs must carry ids only, no email or name")

        # 2. Stripe failing: 503, nothing deleted, no email in the logs
        #    even though the Stripe error text contains one.
        fake.calls.clear()
        fake.failing_customers.add("cus_down")
        with SessionLocal() as db:
            down = make_citizen(db, "down@example.com", "Down Citizen",
                                stripe_customer_id="cus_down", stripe_subscription_id="sub_down")
            db.commit()
            down_id = down.id
        records.clear()
        r = delete_via_api(c, down_id, "down@example.com")
        check(r.status_code == 503, f"Stripe down: expected 503, got {r.status_code}")
        check("not deleted" in r.text, f"the message should say the account was not deleted: {r.text[:200]}")
        with SessionLocal() as db:
            check(db.get(CitizenAccount, down_id) is not None, "account must stay while Stripe can't cancel")
        logged = "\n".join(records)
        check("example.com" not in logged, f"no email in the logs: {logged[:300]}")
        check("cus_down" in logged, "the failure should be logged with the customer id")

        # 3. The purge: one expired account whose cancel fails is kept for
        #    the next pass; the other expired account still goes.
        fake.calls.clear()
        fake.subscriptions["sub_purge"] = {"id": "sub_purge", "customer": "cus_purge", "status": "trialing"}
        past = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
        with SessionLocal() as db:
            row = db.get(CitizenAccount, down_id)
            if row is not None:
                row.self_deleted_at = past - timedelta(days=30)
                row.purge_after = past
            purge_me = make_citizen(db, "purge@example.com", "Purge Citizen",
                                    stripe_customer_id="cus_purge", stripe_subscription_id="sub_purge",
                                    self_deleted_at=past - timedelta(days=30), purge_after=past)
            db.commit()
            purge_id = purge_me.id
        counts = account_deletion.purge_expired_accounts()
        check(counts.get("citizen") == 1, f"purge count: {counts}")
        check("sub_purge" in fake.canceled(), f"purge should cancel the trialing subscription: {fake.canceled()}")
        with SessionLocal() as db:
            check(db.get(CitizenAccount, purge_id) is None, "purged account should be gone")
            check(db.get(CitizenAccount, down_id) is not None, "account whose cancel failed is kept")

        # 4. A subscription Stripe no longer has is nothing to cancel.
        fake.calls.clear()
        fake.missing_customers.add("cus_gone")
        with SessionLocal() as db:
            ghost = make_citizen(db, "ghost@example.com", "Ghost Citizen",
                                 stripe_customer_id="cus_gone", stripe_subscription_id="sub_missing")
            db.commit()
            ghost_id = ghost.id
        r = delete_via_api(c, ghost_id, "ghost@example.com")
        check(r.status_code == 200, f"missing in Stripe: {r.status_code} {r.text[:160]}")
        check(fake.canceled() == [], f"nothing to cancel: {fake.canceled()}")

        # 5. No Stripe ids on the row (every demo account): no Stripe call.
        fake.calls.clear()
        with SessionLocal() as db:
            demo = make_citizen(db, "demo-1@demo-citizens.civicview.app", "Demo Citizen",
                                verified_method="demo", is_subscribed=True, subscription_status="demo")
            db.commit()
            demo_id = demo.id
        r = delete_via_api(c, demo_id, "demo-1@demo-citizens.civicview.app")
        check(r.status_code == 200, f"demo delete: {r.status_code}")
        check(fake.calls == [], f"no Stripe call for an account without Stripe ids: {fake.calls}")

        # 6. Stripe not configured: deletion goes ahead without a call.
        use_dev_billing()
        fake.calls.clear()
        with SessionLocal() as db:
            stale = make_citizen(db, "stale@example.com", "Stale Citizen",
                                 stripe_customer_id="cus_stale", stripe_subscription_id="sub_stale")
            db.commit()
            stale_id = stale.id
        r = delete_via_api(c, stale_id, "stale@example.com")
        check(r.status_code == 200, f"dev billing delete: {r.status_code}")
        check(fake.calls == [], "no Stripe call when Stripe isn't configured")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: deleting a citizen cancels its Stripe subscription")
    return 0


if __name__ == "__main__":
    sys.exit(main())
