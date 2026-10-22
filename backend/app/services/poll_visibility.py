# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""When a poll's results may be shown (2026-10-20).

The poll's author picks one of three result settings
(Poll.presentation_mode):

  full                results show right away
  hidden              results are sent, and the viewer opens them with
                      "Show results"
  reveal_after_close  no counts for anyone until the poll closes

The page API has applied the last rule since the setting shipped:
routers/pages.py _poll_to_read for rep and candidate polls (the page
owner still sees the counts, and a departed official's polls close the
day they leave) and services/citizen_polls_service.py for citizen polls
(nobody sees them early, the author included). The /polls feed, the
home page Popular polls and the Explore results window did not, so the
counts showed there. This module holds the same rule for those
surfaces.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional, Tuple


def effective_closes_at(db, closes_at: Optional[datetime], page_id: Optional[str]) -> Optional[datetime]:
    """A post's poll closes at its own close time, or on the day the
    page's owner left office or ended a campaign when that comes first
    (as on the page). Pass page_id=None for citizen polls, which have no
    such rule."""
    if not page_id:
        return closes_at
    from app.services import page_lifecycle
    closed_on = page_lifecycle.poll_closed_by_departure(db, page_id)
    if closed_on is not None:
        departure = datetime(closed_on.year, closed_on.month, closed_on.day)
        closes_at = min(closes_at, departure) if closes_at else departure
    return closes_at


def viewer_owns_page(page_id: Optional[str], me_rep=None, me_candidate=None) -> bool:
    """The rep or candidate who owns the page a post's poll lives on sees
    its counts while they are held back from everyone else, as on the
    page. Only ask this for a post's poll: citizen polls have no such
    owner."""
    if not page_id:
        return False
    if me_rep is not None and getattr(me_rep, "official_id", None) == page_id:
        return True
    if me_candidate is not None and getattr(me_candidate, "candidate_id", None) == page_id:
        return True
    return False


def counts_withheld(
    presentation_mode: Optional[str],
    closes_at: Optional[datetime],
    *,
    viewer_is_owner: bool = False,
    now: Optional[datetime] = None,
) -> bool:
    """True while a 'reveal_after_close' poll is still open and the
    viewer is not the page owner. Callers then send no counts at all."""
    if (presentation_mode or "full").lower() != "reveal_after_close":
        return False
    if viewer_is_owner:
        return False
    now = now or datetime.utcnow()
    return not (closes_at is not None and now >= closes_at)


def poll_counts_withheld(
    db, poll, page_id: Optional[str], me_rep=None, me_candidate=None,
) -> Tuple[bool, Optional[datetime]]:
    """(withheld, effective close time) for one Poll row. page_id is the
    page of a post's poll (Post.official_id); it is ignored for citizen
    polls."""
    post_page = page_id if poll.post_id is not None else None
    closes_at = effective_closes_at(db, poll.closes_at, post_page)
    withheld = counts_withheld(
        poll.presentation_mode, closes_at,
        viewer_is_owner=viewer_owns_page(post_page, me_rep, me_candidate),
    )
    return withheld, closes_at
