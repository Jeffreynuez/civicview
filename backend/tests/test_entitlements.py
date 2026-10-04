# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Unit tests for the engagement entitlement gates (the "dormant switch").

WHY THIS FILE EXISTS
CivicView's permission model lived in prose for months — CLAUDE.md, the
README tier table, the identity-model PDF, and a dozen UI strings all
described gates that no code enforced and no test asserted. That is
exactly how the docs drifted into telling users a subscription was
required to comment when nothing of the sort was implemented. These
tests pin the model down in BOTH switch states so it cannot drift
silently again.

Guards:
  1.  Switch OFF (default): every gate no-ops, even for an unverified,
      unsubscribed citizen. Demo accounts keep working exactly as today.
  2.  Switch ON: unverified citizen blocked from verified-tier actions
      with code='verification_required'.
  3.  Switch ON: verified citizen passes verified-tier actions.
  4.  Switch ON: verified-but-unsubscribed blocked from poll creation
      with code='subscription_required'.
  5.  Switch ON: verified + subscribed passes poll creation.
  6.  Switch ON: an UNVERIFIED citizen hitting a subscriber-tier action
      gets the VERIFICATION error, not the subscription one — never send
      someone to a payment screen they cannot complete.
  7.  citizen=None (the rep / candidate path chosen by _resolve_engager)
      is always allowed, in both states.
  8.  A demo grant does NOT count as verified once the switch is on.
      That is the entire point of the sunset.
  9.  demo_sunset_at() parses ISO input, tolerates junk, and returns
      None when unset — None must read as "no sunset scheduled",
      never as "sunset now".
  10. The location gate (2026-10-03) is on in BOTH switch states: a
      citizen with no state and district, or a district outside their
      state, gets 409 code='location_required' from both gates, and it
      is checked before verification. citizen=None still passes.

Run:  cd backend && python3 tests/test_entitlements.py   (exit 0 = pass)
"""
import os
import sys

FAILURES = []


class FakeCitizen:
    """Minimal stand-in. The gates read verified, is_subscribed, and the
    state and district the location gate checks."""

    def __init__(self, verified=False, is_subscribed=False, state="FL", district="FL-17"):
        self.verified = verified
        self.is_subscribed = is_subscribed
        self.state = state
        self.congressional_district = district


def check(label, fn):
    try:
        fn()
    except AssertionError as exc:
        print("  FAIL  %s: %s" % (label, exc))
        FAILURES.append(label)
    else:
        print("  PASS  %s" % label)


def main():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from fastapi import HTTPException
    from app.services import entitlements as ent

    def switch(on):
        if on:
            os.environ["IDME_ENABLED"] = "true"
        else:
            os.environ.pop("IDME_ENABLED", None)

    def allows(fn):
        try:
            fn()
        except HTTPException as exc:
            raise AssertionError("expected no exception, got %s %s" % (exc.status_code, exc.detail))

    def blocks_with(fn, expected_code, status=403):
        try:
            fn()
        except HTTPException as exc:
            assert exc.status_code == status, "expected %s, got %s" % (status, exc.status_code)
            code = exc.detail.get("code") if isinstance(exc.detail, dict) else None
            assert code == expected_code, "expected code=%r, got %r" % (expected_code, code)
            return
        raise AssertionError("expected a 403 with code=%r; nothing raised" % expected_code)

    nobody = FakeCitizen(verified=False, is_subscribed=False)
    verified = FakeCitizen(verified=True, is_subscribed=False)
    subscriber = FakeCitizen(verified=True, is_subscribed=True)
    demo_grant = FakeCitizen(verified=False, is_subscribed=True)

    print("\nSwitch OFF (the shipped default):")
    switch(False)
    check("idme_enabled() is False", lambda: (_ for _ in ()).throw(AssertionError("switch reads as on")) if ent.idme_enabled() else None)
    check("unverified may comment", lambda: allows(lambda: ent.require_verified(nobody, action="comment")))
    check("unverified may vote", lambda: allows(lambda: ent.require_verified(nobody, action="vote on polls")))
    check("unsubscribed may create polls", lambda: allows(lambda: ent.require_subscribed(nobody, action="create polls")))
    check("rep/candidate path (None) allowed", lambda: allows(lambda: ent.require_verified(None, action="comment")))

    print("\nSwitch ON:")
    switch(True)
    check("idme_enabled() is True", lambda: None if ent.idme_enabled() else (_ for _ in ()).throw(AssertionError("switch reads as off")))
    check("unverified BLOCKED from commenting", lambda: blocks_with(lambda: ent.require_verified(nobody, action="comment"), ent.CODE_VERIFICATION_REQUIRED))
    check("verified MAY comment", lambda: allows(lambda: ent.require_verified(verified, action="comment")))
    check("verified MAY vote", lambda: allows(lambda: ent.require_verified(verified, action="vote on polls")))
    check("verified-unsubscribed BLOCKED from poll creation", lambda: blocks_with(lambda: ent.require_subscribed(verified, action="create polls"), ent.CODE_SUBSCRIPTION_REQUIRED))
    check("subscriber MAY create polls", lambda: allows(lambda: ent.require_subscribed(subscriber, action="create polls")))
    check("unverified hitting poll-create gets VERIFICATION error", lambda: blocks_with(lambda: ent.require_subscribed(nobody, action="create polls"), ent.CODE_VERIFICATION_REQUIRED))
    check("rep/candidate path allowed for verified gate", lambda: allows(lambda: ent.require_verified(None, action="comment")))
    check("rep/candidate path allowed for subscriber gate", lambda: allows(lambda: ent.require_subscribed(None, action="create polls")))
    check("demo grant does NOT count as verified", lambda: blocks_with(lambda: ent.require_verified(demo_grant, action="comment"), ent.CODE_VERIFICATION_REQUIRED))

    print("\nLocation gate (always on):")
    homeless = FakeCitizen(verified=True, is_subscribed=True, district=None)
    wrong_state = FakeCitizen(verified=True, is_subscribed=True, state="FL", district="GA-3")
    no_state = FakeCitizen(verified=True, is_subscribed=True, state=None, district=None)
    at_large = FakeCitizen(verified=True, is_subscribed=True, state="WY", district="WY-AL")
    for state in (False, True):
        switch(state)
        label = "switch ON " if state else "switch OFF"
        for who, name in ((homeless, "no district"), (wrong_state, "district outside state"), (no_state, "no state")):
            check("%s: %s BLOCKED from commenting" % (label, name),
                  lambda who=who: blocks_with(lambda: ent.require_verified(who, action="comment"), ent.CODE_LOCATION_REQUIRED, 409))
            check("%s: %s BLOCKED from poll creation" % (label, name),
                  lambda who=who: blocks_with(lambda: ent.require_subscribed(who, action="create polls"), ent.CODE_LOCATION_REQUIRED, 409))
        check("%s: at-large district passes" % label,
              lambda: allows(lambda: ent.require_subscribed(at_large, action="create polls")))
        check("%s: rep/candidate path (None) allowed" % label,
              lambda: allows(lambda: ent.require_verified(None, action="comment")))
    switch(True)
    unverified_homeless = FakeCitizen(verified=False, district=None)
    check("location is asked for before verification",
          lambda: blocks_with(lambda: ent.require_verified(unverified_homeless, action="comment"), ent.CODE_LOCATION_REQUIRED, 409))
    switch(False)

    print("\nDEMO_SUNSET_AT parsing:")
    os.environ.pop("DEMO_SUNSET_AT", None)
    check("unset -> None", lambda: None if ent.demo_sunset_at() is None else (_ for _ in ()).throw(AssertionError("expected None")))
    os.environ["DEMO_SUNSET_AT"] = "not-a-date"
    check("junk -> None (never 'sunset now')", lambda: None if ent.demo_sunset_at() is None else (_ for _ in ()).throw(AssertionError("expected None")))
    os.environ["DEMO_SUNSET_AT"] = "2027-01-15T00:00:00Z"
    check("ISO+Z parses tz-aware", lambda: _assert_dt(ent.demo_sunset_at(), 2027))
    os.environ["DEMO_SUNSET_AT"] = "2027-01-15"
    check("bare date gets UTC", lambda: _assert_dt(ent.demo_sunset_at(), 2027))

    print("\nauthored_verified_flag (increment 4) — must NOT depend on the switch:")
    for state in (True, False):
        switch(state)
        label = "switch ON " if state else "switch OFF"
        check("%s: rep authors -> True" % label,
              lambda: _assert_true(ent.authored_verified_flag(None, object(), None)))
        check("%s: candidate authors -> True" % label,
              lambda: _assert_true(ent.authored_verified_flag(None, None, object())))
        check("%s: verified citizen -> True" % label,
              lambda: _assert_true(ent.authored_verified_flag(verified)))
        check("%s: unverified citizen -> False" % label,
              lambda: _assert_false(ent.authored_verified_flag(nobody)))
        check("%s: demo grant -> False" % label,
              lambda: _assert_false(ent.authored_verified_flag(demo_grant)))
        check("%s: no identity (legacy anon vote) -> False" % label,
              lambda: _assert_false(ent.authored_verified_flag()))
        check("%s: verified subscriber -> True (billing is not the input)" % label,
              lambda: _assert_true(ent.authored_verified_flag(subscriber)))

    switch(False)
    os.environ.pop("DEMO_SUNSET_AT", None)

    print()
    if FAILURES:
        print("FAILED (%d): %s" % (len(FAILURES), ", ".join(FAILURES)))
        return 1
    print("All entitlement guards passed.")
    return 0


def _assert_true(value):
    assert value is True, "expected True, got %r" % (value,)


def _assert_false(value):
    assert value is False, "expected False, got %r" % (value,)


def _assert_dt(value, year):
    assert value is not None, "expected a datetime, got None"
    assert value.year == year, "expected year %s, got %s" % (year, value.year)
    assert value.tzinfo is not None, "expected tz-aware datetime"


if __name__ == "__main__":
    raise SystemExit(main())
