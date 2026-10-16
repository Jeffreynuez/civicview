"""The weekly digest finds followed officials whatever the case of their id.

Run:  cd backend && python3 tests/test_digest_tracked_case.py   (exit 0 = pass)

routers/tracked.py stores every followed official's key lowercased
("vt-sen-essex"), but posts, polls and events keep the official's id as
the data files spell it: "vt-sen-Essex" for a Vermont senator, an
uppercase bioguide id such as "S001217" for a member of Congress. Until
2026-10-15 the digest compared the two as stored, so a citizen who
followed either one got no digest about them.

  1. A post on a mixed-case state page ("vt-sen-Essex") is in the digest.
  2. A post on a member of Congress's page (uppercase bioguide) is in it.
  3. A poll on a post on a mixed-case page is listed with the new polls;
     a citizen poll that only targets the page is not (since 2026-10-16
     the digest lists what the officials did, not citizen polls).
  4. An upcoming event on a mixed-case page is listed.
  5. A post on a page the citizen does not follow stays out.
"""
import os
import sys
import tempfile
from datetime import UTC, datetime, timedelta

_failures = []


def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        _failures.append(name)


def main() -> int:
    db_file = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    db_file.close()
    os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
    os.environ.setdefault("SESSION_SECRET", "test-secret-not-for-prod-" + "x" * 32)
    os.environ["CIVICVIEW_SKIP_LEGISLATORS_FETCH"] = "1"
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    import logging
    logging.disable(logging.CRITICAL)

    from app.db import Base, SessionLocal, engine
    from app.models.pages import CitizenAccount, Poll, Post, RepEvent, TrackedOfficial
    from app.services import digest_service

    Base.metadata.create_all(engine)
    now = datetime.now(UTC).replace(tzinfo=None)
    with SessionLocal() as db:
        cz = CitizenAccount(email="reader@example.org", password_hash="x",
                            display_name="Reader", city="", state="VT", digest_opt_in=True)
        db.add(cz)
        db.commit()
        # Keys as routers/tracked.py writes them: stripped and lowercased.
        for key in ("vt-sen-Essex", "S001217"):
            db.add(TrackedOfficial(tracker_kind="citizen", tracker_id=cz.id,
                                   official_key=key.strip().lower()))
        db.add(Post(official_id="vt-sen-Essex", body="Town meeting recap", created_at=now))
        db.add(Post(official_id="S001217", body="Weekly update from Washington", created_at=now))
        db.add(Post(official_id="vt-sen-Orange", body="Not followed", created_at=now))
        db.add(Poll(question="Should the bridge be rebuilt?", target_official_id="vt-sen-Essex",
                    author_kind="citizen", created_at=now))
        survey = Post(official_id="vt-sen-Essex", body="Quick survey", created_at=now)
        db.add(survey)
        db.flush()
        db.add(Poll(question="Which road first?", post_id=survey.id, created_at=now))
        db.add(RepEvent(official_id="vt-sen-Essex", title="Office hours",
                        start_at=(now + timedelta(days=3)).isoformat()))
        db.commit()

        digest = digest_service.build_digest(db, cz) or {}

    previews = [p["preview"] for p in digest.get("posts", [])]
    check("1: post on vt-sen-Essex is in the digest", "Town meeting recap" in previews, str(previews))
    check("2: post on bioguide S001217 is in the digest", "Weekly update from Washington" in previews, str(previews))
    polls = [p.get("question") for p in digest.get("new_polls", [])]
    check("3: the official's poll on vt-sen-Essex is listed", "Which road first?" in polls, str(digest.get("new_polls")))
    check("3: a citizen poll targeting it is not", "Should the bridge be rebuilt?" not in polls, str(polls))
    events = [e.get("title") for e in digest.get("events", [])]
    check("4: event on vt-sen-Essex is listed", "Office hours" in events, str(digest.get("events")))
    check("5: post on an unfollowed page stays out", "Not followed" not in previews, str(previews))

    print()
    if _failures:
        print(f"FAILED ({len(_failures)}): {', '.join(_failures)}")
        return 1
    print("ALL PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
