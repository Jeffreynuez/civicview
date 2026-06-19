# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
SQLAlchemy models for the Pages feature (Phase 1 demo MVP).

Design notes:
  • `official_id` is a string that matches whichever id we already use
    for that official elsewhere in the app (bioguide_id for federal
    reps, state seed ids, candidate ids). This avoids introducing a
    parallel identity system for officials — the curated JSON remains
    the source of truth; the DB only stores user-generated content
    *about* those officials.
  • A RepAccount is 1:1 with an official. The account owner can post,
    attach polls, add events, all scoped to that one official_id.
  • Posts, Polls, PollOptions, and PollVotes use cascading deletes —
    killing a post removes its poll and all votes. RepEvents are
    independent (they're also surfaced in the existing Events tab).
  • CitizenWaitlist is a flat email capture table; the real citizen
    account system arrives in Phase 2 after funding/legal review.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import (
    String, Integer, Float, DateTime, ForeignKey, Boolean, Text, Index,
    UniqueConstraint, func,
)
from sqlalchemy.sql import expression as sa_expression
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


# ── Rep accounts ──────────────────────────────────────────────────────
class RepAccount(Base):
    __tablename__ = "rep_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Matches bioguide_id / state seed id / candidate id used elsewhere.
    official_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # Cached display fields — refreshed at login from the curated data.
    display_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    # Scope reference — used to compute which citizens are "my
    # constituents" for engagement filtering. owner_state is the 2-char
    # code the rep represents (FL for a FL House rep or senator).
    # owner_district is the CD string like "FL-19" for House reps, null
    # for senators / governors / state-wide officials.
    # We store these explicitly rather than parsing them out of `role`
    # because role is a free-form display string.
    owner_state: Mapped[Optional[str]] = mapped_column(String(2), default=None)
    owner_district: Mapped[Optional[str]] = mapped_column(String(8), default=None)
    owner_city: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Admin moderation — when set, the account can't sign in or act.
    # Distinct from is_active (which is the "account exists but hasn't
    # been activated yet" state) so we can tell soft-suspension from
    # never-activated. Auth dependencies treat both states as
    # "not signed in" for callers; admin endpoints can list+restore
    # the suspended set.
    suspended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    suspended_reason: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    # TOTP 2FA fields — see CitizenAccount for the column-level docs.
    # For reps these will be required (Phase 3+ enforcement); they're
    # nullable here so the auto-migrate can ADD COLUMN on existing rows
    # without backfill.
    totp_secret_encrypted: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    totp_enabled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Self-serve account deletion (Task #81). Distinct from
    # admin-driven `suspended_at` so we can tell user-initiated
    # delete-and-archive from moderation action.
    #   self_deleted_at — when the user clicked Delete in archive
    #                    mode. While set, login is blocked at the
    #                    auth dep but the row + content still exist
    #                    so the user can recover.
    #   purge_after    — timestamp at which the startup purge job
    #                    hard-deletes the row + cascade content.
    #                    Typically self_deleted_at + 30 days.
    # Both stay NULL on active accounts. Hard delete bypasses these
    # columns entirely (row gone immediately).
    self_deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    purge_after: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    # Login attempt tracking + lockout (Task #29). Counter is bumped on
    # each wrong-password attempt; when it hits the per-identity-kind
    # threshold (3 for reps/candidates, 5 for citizens), locked_until
    # is set to an escalating window (15min → 1hr → 24h based on
    # consecutive_lockout_count). Reset on successful sign-in OR
    # successful password reset. See services/login_attempts.py.
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    consecutive_lockout_count: Mapped[int] = mapped_column(Integer, default=0)

    posts: Mapped[List["Post"]] = relationship(
        back_populates="author", cascade="all, delete-orphan",
    )
    events: Mapped[List["RepEvent"]] = relationship(
        back_populates="author", cascade="all, delete-orphan",
    )


# ── Candidate accounts (Phase 3+) ─────────────────────────────────────
class CandidateAccount(Base):
    """
    Mirror of RepAccount for declared candidates. A CandidateAccount is
    1:1 with a candidate row in ElectionsService (matched on
    `candidate_id`). The account owner can post, attach polls, and add
    events on the candidate's page — same engagement surface a sitting
    rep gets after claiming.

    Differences from RepAccount worth calling out:
      • `candidate_id` mirrors RepAccount.official_id but uses the
        ElectionsService id space (e.g. "fl-cand-byron-donalds")
        rather than the rep id space (bioguide_id, state seed id).
      • There is no `role` field — the candidate's seeking_office
        comes from the curated registry and updates as the race
        evolves; storing it here would let it drift.
      • `claim_status` distinguishes pending claims (waitlist signup
        approved → account provisioned but candidate hasn't completed
        identity verification yet) from active claims. Phase 3 ships
        with manual approval; Phase 4+ may auto-approve via FEC ID
        match or similar.

    Phase 1 + 2 only use this table for admin listing + suspension /
    appeal plumbing. Phase 3 adds auth endpoints; Phase 4 wires
    Posts.author_candidate_id and the engagement filter.
    """
    __tablename__ = "candidate_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Matches the candidate id used in ElectionsService (e.g.
    # "fl-cand-byron-donalds"). Indexed + unique because it's the
    # primary lookup key when resolving page ownership.
    candidate_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    # Cached display name — refreshed from the registry at login.
    display_name: Mapped[str] = mapped_column(String(255))

    # Geographic ownership for engagement filtering. owner_state is
    # the 2-char code the candidate is running in. owner_district is
    # the CD string when the candidate is running for House (e.g.
    # "FL-19"); null for statewide / executive races.
    owner_state: Mapped[Optional[str]] = mapped_column(String(2), default=None)
    owner_district: Mapped[Optional[str]] = mapped_column(String(8), default=None)
    owner_city: Mapped[Optional[str]] = mapped_column(String(128), default=None)

    # Claim lifecycle: 'pending' (waitlist approved, account exists,
    # candidate hasn't logged in yet) → 'active' (candidate verified
    # and posting). 'pending' accounts can't sign in.
    claim_status: Mapped[str] = mapped_column(String(16), default="pending")

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Same suspension columns as RepAccount + CitizenAccount so the
    # admin moderation surface is uniform across the three account
    # kinds. When set, the candidate-auth dependency treats the
    # account as not-signed-in and the admin endpoints can list +
    # restore the suspended set via the existing tabs.
    suspended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    suspended_reason: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    # TOTP 2FA fields — see CitizenAccount for the column-level docs.
    # Candidates get the same enforcement treatment as reps in Phase 3+
    # since they post on a verified page and an impersonation post would
    # be just as damaging as one on a sitting rep's page.
    totp_secret_encrypted: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    totp_enabled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Self-serve account deletion (Task #81) — see RepAccount for docs.
    self_deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    purge_after: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    # Login attempt tracking + lockout (Task #29). Counter is bumped on
    # each wrong-password attempt; when it hits the per-identity-kind
    # threshold (3 for reps/candidates, 5 for citizens), locked_until
    # is set to an escalating window (15min → 1hr → 24h based on
    # consecutive_lockout_count). Reset on successful sign-in OR
    # successful password reset. See services/login_attempts.py.
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    consecutive_lockout_count: Mapped[int] = mapped_column(Integer, default=0)


# ── Posts + Polls ─────────────────────────────────────────────────────
class Post(Base):
    """
    A page-author's post — rep posts (the original use case) or
    candidate posts (Phase 4). Exactly ONE of author_id /
    author_candidate_id is set per row — the XOR is enforced at
    the route layer (create_post checks the caller's identity
    type and writes the matching column).

    official_id is the denormalized page identifier. For rep
    posts it equals the rep's RepAccount.official_id; for
    candidate posts it equals the candidate's
    CandidateAccount.candidate_id. The two id spaces don't
    overlap by design ("fl-cand-..." for candidates vs bioguide
    ids for federal reps), so the string is unambiguous about
    which kind of page the post lives on.
    """
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Both author FKs are nullable now (Phase 4 made author_id nullable
    # to accommodate candidate-authored posts). Auto-migrate handles
    # the NOT NULL → NULL relaxation on existing deployments.
    author_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    author_candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Denormalized so unauthenticated reads don't need to hit
    # rep_accounts OR candidate_accounts.
    official_id: Mapped[str] = mapped_column(String(64), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    # Soft-delete so reps + candidates can undo recent posts without
    # leaking via polls.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Edit feature (Task #41). edited_at NULL = never edited. The 24h
    # edit window runs from created_at, not from edited_at, so people
    # can't extend the window by editing again.
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # First-edit body snapshot — captures the ORIGINAL body the first
    # time the author edits, so the moderation audit + threat-detection
    # algo (Task #14) can see what the user originally posted before
    # any edits scrubbed it. Subsequent edits do NOT overwrite this.
    pre_edit_text: Mapped[Optional[str]] = mapped_column(Text, default=None)
    # Body at delete-time. Posts use soft delete (deleted_at set; row
    # stays so cascade comments don't get orphaned). This column gives
    # moderation review the body for already-deleted posts.
    pre_delete_text: Mapped[Optional[str]] = mapped_column(Text, default=None)

    # Rep-side relationship — None for candidate-authored posts.
    author: Mapped[Optional["RepAccount"]] = relationship(back_populates="posts")
    # Candidate-side relationship — None for rep-authored posts. No
    # back_populates on CandidateAccount today (Phase 4a keeps the
    # candidate side intentionally narrow); we'll add the reverse
    # collection if dashboard rollups need it later.
    author_candidate: Mapped[Optional["CandidateAccount"]] = relationship()
    # Rolling moderation counter — bumped each time someone hits Report.
    # Cached on the row (vs. counting rows in post_reports on each read)
    # so list views can sort/filter without the join. The auto-hide
    # threshold in the report endpoint compares against this column.
    report_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0",
    )
    # Distinguishes admin/auto moderation from author-deleted content.
    # When the author hits Delete: stays NULL (and deleted_at is set).
    # When an admin hides via /admin: 'admin_hidden'.
    # When the auto-hide threshold is crossed by reports: 'auto_hidden'.
    # When cascade-hide fires during a user suspend: 'admin_hidden'
    # (the trigger is an admin action, not the report threshold).
    # The "Hidden by moderation" surface on the author's dashboard
    # filters on hide_reason IS NOT NULL so author-deletes don't
    # surface there. Appeal eligibility checks the same column.
    hide_reason: Mapped[Optional[str]] = mapped_column(
        String(32), default=None, index=True,
    )

    poll: Mapped[Optional["Poll"]] = relationship(
        back_populates="post", uselist=False, cascade="all, delete-orphan",
    )
    reactions: Mapped[List["PostReaction"]] = relationship(
        back_populates="post", cascade="all, delete-orphan",
    )
    comments: Mapped[List["PostComment"]] = relationship(
        back_populates="post", cascade="all, delete-orphan",
        order_by="PostComment.created_at.desc()",
    )
    images: Mapped[List["PostImage"]] = relationship(
        back_populates="post", cascade="all, delete-orphan",
        order_by="PostImage.sort_order",
    )


# ── Post images (multi-image gallery, local disk in demo) ────────────
class PostImage(Base):
    """
    One uploaded image. Two-phase lifecycle:
      1. Rep uploads via /api/pages/images/upload → row is created with
         post_id=NULL (orphan). Bytes hit disk, row stores the UUID
         filename + metadata.
      2. Rep submits the post with image_ids=[...]; the create_post
         handler claims the orphan rows by setting post_id + sort_order.
    Orphans never claimed in step 2 are dev-demo litter — good enough
    for now; a future janitor task can sweep them once they're old.

    filename is a server-generated UUID, never user-provided — the raw
    upload name is irrelevant and a path-traversal risk if trusted.
    """
    __tablename__ = "post_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nullable on purpose — pre-claim the image exists without a post.
    post_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), default=None, index=True,
    )
    # Which page-owner uploaded this. Gates the "attach to my post"
    # check in create_post so one owner can't appropriate another's
    # image. Phase 4d adds the candidate parallel — exactly ONE of
    # uploader_id / uploader_candidate_id is set per row.
    uploader_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    uploader_candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    filename: Mapped[str] = mapped_column(String(128))   # UUID + extension
    content_type: Mapped[str] = mapped_column(String(64))
    file_size: Mapped[int] = mapped_column(Integer)
    # Position in the post's gallery (0..4). Set at claim time from the
    # order of image_ids in the PostCreate payload.
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    post: Mapped[Optional["Post"]] = relationship(back_populates="images")


# ── Reactions + comments (citizen-gated engagement) ──────────────────
class PostReaction(Base):
    """
    Up/down reaction on a single post. Exactly ONE of citizen_id /
    author_rep_id is set per row (XOR enforced at the route layer —
    SQLite can't enforce a cross-nullable CHECK cleanly).

    citizen_id is the original engagement path (citizens reacting to a
    rep's post). author_rep_id was added for Phase 2 of self-
    engagement: a rep can react to their own post on a page they
    own. The two unique indexes below let both paths coexist
    without false collisions (SQLite treats NULLs in unique indexes
    individually).

    Geography columns are denormalized from CitizenAccount at write
    time so the owner-side engagement filter can roll up reactions by
    scope without a join. For rep-authored engagement the scope
    columns are all NULL — the rep doesn't have a constituency-of-one
    geography and rollups treat rep engagement as scope='country'.
    """
    __tablename__ = "post_reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    author_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Phase 4c — candidate self-reaction (parity with rep). Same XOR
    # pattern: exactly one of citizen_id / author_rep_id /
    # author_candidate_id is set per row.
    author_candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # 'up' or 'down'. Kept as a short string rather than a DB enum so we
    # can add neutral reactions (heart, eyes, etc.) later without a
    # migration.
    kind: Mapped[str] = mapped_column(String(8))
    scope_state: Mapped[Optional[str]] = mapped_column(String(2), default=None, index=True)
    scope_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)
    scope_city: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    scope_county: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    post: Mapped["Post"] = relationship(back_populates="reactions")


# One reaction per (post, citizen) AND one per (post, rep) AND one
# per (post, candidate). NULLs in the author column don't collide
# thanks to SQLite/Postgres unique-index NULL-distinct semantics,
# so rows from each identity kind coexist cleanly on the same post.
Index("uq_post_reaction_citizen",  PostReaction.post_id, PostReaction.citizen_id, unique=True)
Index("uq_post_reaction_rep",      PostReaction.post_id, PostReaction.author_rep_id, unique=True)
Index("uq_post_reaction_candidate", PostReaction.post_id, PostReaction.author_candidate_id, unique=True)


# ── Poll reactions (citizen + standalone polls) ───────────────────────
class PollReaction(Base):
    """
    Up/down reaction on a citizen poll (including standalone polls).
    Mirrors PostReaction exactly — same three-XOR-identity columns
    (citizen / rep / candidate), same kind, same geography rollup
    columns. Lives in its own table because Poll.id is a separate
    space from Post.id.

    Rep polls don't use this — their like/dislike is recorded on the
    parent Post via PostReaction. Citizen polls and standalone polls
    do use this (they have no parent post). The frontend /polls feed
    dispatches per card kind.
    """
    __tablename__ = "poll_reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id", ondelete="CASCADE"), index=True)
    citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    author_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    author_candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    kind: Mapped[str] = mapped_column(String(8))
    scope_state: Mapped[Optional[str]] = mapped_column(String(2), default=None, index=True)
    scope_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)
    scope_city: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    scope_county: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# One reaction per (poll, identity). Same SQLite/Postgres NULL-distinct
# semantics as the post_reactions indexes — rows from each identity
# kind coexist cleanly.
Index("uq_poll_reaction_citizen",   PollReaction.poll_id, PollReaction.citizen_id,   unique=True)
Index("uq_poll_reaction_rep",       PollReaction.poll_id, PollReaction.author_rep_id, unique=True)
Index("uq_poll_reaction_candidate", PollReaction.poll_id, PollReaction.author_candidate_id, unique=True)


class PostComment(Base):
    """
    Flat comment on a post. Soft-delete so the author or moderation
    can remove abusive content without losing the ID for review.

    Exactly ONE of citizen_id / author_rep_id is set per row (XOR
    enforced at the route layer). citizen_id is the original path
    (citizens commenting on a rep's post); author_rep_id was added
    for Phase 2 self-engagement so a rep can comment on their own
    post.
    """
    __tablename__ = "post_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    author_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Phase 4c — candidate comments on their own page. Same XOR shape
    # as PostReaction: exactly one identity column is set per row.
    author_candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Phase 3 reply threading. NULL = top-level comment, anyone signed
    # in may create. NON-NULL = reply to a top-level comment, gated
    # to two parties at the route layer: the post creator OR the
    # top-level comment's author. Replies-to-replies are not allowed
    # (the route rejects when the target parent itself has a non-NULL
    # parent), so the data stays one level deep and the render is a
    # simple flat pool under each top-level. ondelete=CASCADE so that
    # deleting a top-level comment vaporises its reply thread; a soft-
    # delete on the parent still keeps replies addressable for
    # moderation review.
    parent_comment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("post_comments.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Cached display name so render-side doesn't JOIN. For citizen
    # commenters this is CitizenAccount.display_name; for rep
    # commenters it's RepAccount.display_name. Kept in sync at
    # write time. UI shows (Unverified) next to citizen names.
    citizen_display_name: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(String(1000))
    scope_state: Mapped[Optional[str]] = mapped_column(String(2), default=None, index=True)
    scope_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)
    scope_city: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    scope_county: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Edit feature (Task #41). edited_at NULL = never edited (or only
    # edited within the silent 60s grace window). Lock-on-reply uses
    # first_reply_at below — see services/edit_window.py for the rule.
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Body width matches body's String(1000) so a future migration of
    # body length stays consistent across these snapshot columns.
    pre_edit_text: Mapped[Optional[str]] = mapped_column(String(1000), default=None)
    pre_delete_text: Mapped[Optional[str]] = mapped_column(String(1000), default=None)
    # Lock-on-reply signal. Set to NOW the first time any reply row
    # (child PostComment with parent_comment_id == this.id) is
    # created. Only the FIRST reply trips it. Combined with the 60s
    # silent grace window, edits are allowed IF first_reply_at IS NULL
    # OR (now - created_at) < 60s.
    first_reply_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    # ── AI classification (populated async after comment create) ────
    # All four columns are nullable: NULL means "not classified yet"
    # (the background task hasn't run, or Claude was unavailable).
    # The filter endpoint just excludes unclassified comments from
    # tag-based filters; they're still visible in the unfiltered list.
    ai_sentiment: Mapped[Optional[str]] = mapped_column(
        String(16), default=None, index=True,
    )  # 'positive' | 'neutral' | 'negative'
    # Comma-separated tag list — small, readable, indexable enough
    # for LIKE '%funny%' filtering. We cap to 5 tags per comment in
    # the classifier so this never exceeds a couple hundred chars.
    ai_tones: Mapped[Optional[str]] = mapped_column(
        String(255), default=None,
    )
    ai_intensity: Mapped[Optional[int]] = mapped_column(
        Integer, default=None,
    )  # 1-5 — how strongly sentiment is expressed
    ai_topic: Mapped[Optional[str]] = mapped_column(
        String(80), default=None,
    )  # 2-4 word gist, e.g. "broadband funding"
    ai_classified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )
    # Rolling moderation counter — same semantics as Post.report_count
    # and Poll.report_count. Cached for fast list-view sort/filter
    # and as the comparand for the auto-hide threshold.
    report_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0",
    )
    # Mirrors Post.hide_reason — see that column for the full
    # explanation. NULL = author-deleted (no appeal surface);
    # 'admin_hidden' / 'auto_hidden' = moderation action eligible
    # for appeal within the 30-day window.
    hide_reason: Mapped[Optional[str]] = mapped_column(
        String(32), default=None, index=True,
    )

    post: Mapped["Post"] = relationship(back_populates="comments")
    reactions: Mapped[List["CommentReaction"]] = relationship(
        back_populates="comment", cascade="all, delete-orphan",
    )


class CommentReaction(Base):
    """
    Up/down reaction on a single comment. Mirrors PostReaction's
    dual-author shape — exactly one of citizen_id / author_rep_id is
    set per row, two unique indexes prevent dupes per identity per
    comment without colliding across identity kinds. Geography
    columns are denormalized from CitizenAccount at write time so a
    later "most-engaged districts" rollup doesn't have to join
    citizen_accounts.
    """
    __tablename__ = "comment_reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    comment_id: Mapped[int] = mapped_column(
        ForeignKey("post_comments.id", ondelete="CASCADE"), index=True,
    )
    citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    author_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Phase 4c — candidate reaction on a comment. Same XOR.
    author_candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    kind: Mapped[str] = mapped_column(String(8))   # 'up' | 'down'
    scope_state: Mapped[Optional[str]] = mapped_column(String(2), default=None, index=True)
    scope_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)
    scope_city: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    scope_county: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    comment: Mapped["PostComment"] = relationship(back_populates="reactions")


Index("uq_comment_reaction_citizen",  CommentReaction.comment_id, CommentReaction.citizen_id, unique=True)
Index("uq_comment_reaction_rep",      CommentReaction.comment_id, CommentReaction.author_rep_id, unique=True)
Index("uq_comment_reaction_candidate", CommentReaction.comment_id, CommentReaction.author_candidate_id, unique=True)


class Poll(Base):
    """
    A poll. Two flavors share this table:

      • Rep-authored polls (the original) attach to a Post via post_id.
        author_kind='rep', author_citizen_id is NULL. The post is the
        authoritative content; comments live on PostComment.

      • Citizen-authored polls (added for the "subscribed citizens post
        on unclaimed pages" feature) are standalone — no Post. post_id
        is NULL, author_kind='citizen', author_citizen_id is set. The
        poll sits on a specific rep's page (target_official_id) while
        that rep hasn't claimed it. Comments live on PollComment
        (separate table because PostComment keys on post_id).

    Archive lifecycle (citizen polls only):
      • archived_at NULL                — active and visible on the page
      • archived_at set, reason='rep_claimed'  — page got claimed; poll
        moves to the rep's "Pre-claim discussion" archive section and
        to the citizen's dashboard "My polls > Archived" tab.
      • archived_at set, reason='citizen_closed' — citizen closed it
        themselves before posting a new one (rate-limit rule: 1 active
        per (citizen, page) at a time).
      • archived_at set, reason='superseded' — the per-page cap (20)
        knocked the oldest active poll off the visible feed.
      • archived_at set, reason='reported' — admin took the poll down.
    """
    __tablename__ = "polls"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nullable: rep polls set this; citizen polls leave it NULL.
    post_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), unique=True, default=None,
    )
    question: Mapped[str] = mapped_column(String(500))
    closes_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    default_visibility_scope: Mapped[str] = mapped_column(String(16), default="country")
    presentation_mode: Mapped[str] = mapped_column(
        String(24), default="full", server_default="full",
    )
    # Per-poll demographic suppression floor override (Task: demographic forms).
    # NULL = use the app-wide MIN_CELL (10). When set, the breakdown endpoint
    # uses max(app floor, this) so a creator can only make suppression STRICTER.
    min_cell_override: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    # Author kind drives which join is meaningful: 'rep' means look at
    # post.author; 'citizen' means look at author_citizen_id +
    # target_official_id. Default 'rep' is backwards-compatible with
    # every row that exists today.
    author_kind: Mapped[str] = mapped_column(
        String(16), default="rep", server_default="rep",
    )
    # Citizen author (when author_kind='citizen'). NULL otherwise.
    author_citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="SET NULL"),
        default=None, index=True,
    )
    # The rep page this poll lives on. Always set for citizen polls
    # (that's how we route them to the right page). Always NULL for
    # rep polls (they reach the rep page through post.official_id).
    target_official_id: Mapped[Optional[str]] = mapped_column(
        String(64), default=None, index=True,
    )
    # Citizen-author audit columns. NULL on rep polls.
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    archived_reason: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    # When a rep claims a page, citizen polls archive (reason='rep_claimed')
    # and surface to the rep as "Pre-claim discussion (N polls)". The rep
    # can dismiss the section with one click; we record the dismissal
    # time so the section stays hidden across reloads but the rows still
    # persist in the citizen's dashboard.
    dismissed_by_owner_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Rolling moderation counter — bumped each time someone hits "Report".
    # Admins use it to triage. Stored on the poll (not in PollReport
    # alone) so list views can sort/filter without the join.
    report_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Created-at for list ordering of standalone citizen polls. Rep polls
    # already get their ordering via post.created_at; we still set this
    # for new rep polls but legacy rows get NULL and fall back.
    # Nullable so the auto-migrate can ADD COLUMN to existing rows
    # without backfilling — old polls just keep created_at=NULL and the
    # post.created_at fallback covers them.
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, server_default=func.now(),
    )

    # AI classification — same shape as PostComment.ai_*. Populated
    # asynchronously after create by services/poll_classifier.py.
    # NULL = pending (just posted) or unavailable (AI not configured).
    # The /polls filter endpoint excludes NULLs from tag-based filters
    # but still includes them in the unfiltered list.
    ai_sentiment: Mapped[Optional[str]] = mapped_column(
        String(16), default=None, index=True,
    )  # 'positive' | 'neutral' | 'negative'
    ai_tones: Mapped[Optional[str]] = mapped_column(
        String(255), default=None,
    )  # CSV: 'funny,supportive,...'
    ai_intensity: Mapped[Optional[int]] = mapped_column(
        Integer, default=None,
    )  # 1-5
    ai_topic: Mapped[Optional[str]] = mapped_column(
        String(80), default=None,
    )  # 2-4 word gist
    ai_classified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )

    post: Mapped[Optional["Post"]] = relationship(back_populates="poll")
    options: Mapped[List["PollOption"]] = relationship(
        back_populates="poll", cascade="all, delete-orphan",
        order_by="PollOption.sort_order",
    )
    poll_comments: Mapped[List["PollComment"]] = relationship(
        back_populates="poll", cascade="all, delete-orphan",
        order_by="PollComment.created_at.desc()",
    )


class PollComment(Base):
    """
    Comment attached directly to a standalone (citizen-authored) poll.
    Mirrors PostComment but keyed on poll_id since citizen polls have
    no Post row to hang comments off of. Used both by citizens and —
    once a rep arrives and the page archives — read-only by everyone.

    Dual-author shape mirrors PostComment: exactly ONE of citizen_id
    / author_rep_id is set per row. The rep path is used when a rep
    that owns the target page comments on a citizen-authored poll
    sitting on their page (Phase 2 self-engagement adjacent — a rep
    on a freshly-claimed page can chime in on the pre-claim
    citizen polls).
    """
    __tablename__ = "poll_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id", ondelete="CASCADE"), index=True)
    citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    author_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Phase 4c — candidate comment on a citizen poll on their page.
    author_candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Phase 3 reply threading — see PostComment.parent_comment_id for
    # the full rationale. Same two-party rule applies here: only the
    # poll creator (citizen author OR page-owning rep on an archived
    # citizen poll) and the top-level commenter may reply.
    parent_comment_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("poll_comments.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    citizen_display_name: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(String(1000))
    scope_state: Mapped[Optional[str]] = mapped_column(String(2), default=None, index=True)
    scope_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)
    scope_city: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    scope_county: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    # AI classification — mirrors PostComment.ai_*. See that model for
    # the full column docstring; the semantics are identical.
    ai_sentiment: Mapped[Optional[str]] = mapped_column(
        String(16), default=None, index=True,
    )
    ai_tones: Mapped[Optional[str]] = mapped_column(
        String(255), default=None,
    )
    ai_intensity: Mapped[Optional[int]] = mapped_column(
        Integer, default=None,
    )
    ai_topic: Mapped[Optional[str]] = mapped_column(
        String(80), default=None,
    )
    ai_classified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )
    # Rolling moderation counter — auto-hide threshold compares
    # against this. Defaulted to 0 server-side so the auto-migrate
    # can ADD COLUMN on existing rows without backfill.
    report_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0",
    )
    # Mirrors PostComment.hide_reason — see Post.hide_reason for the
    # full explanation. Drives the appeal-eligibility surface.
    hide_reason: Mapped[Optional[str]] = mapped_column(
        String(32), default=None, index=True,
    )

    poll: Mapped["Poll"] = relationship(back_populates="poll_comments")


class PollReport(Base):
    """
    User-submitted report on a citizen-authored poll. Anyone signed in
    (citizen or rep) can file one. We keep the reporter id + reason so
    a future admin queue can review and act. Multiple reports per
    (poll, reporter) are deduped by a unique index — re-clicking
    Report is a no-op.

    `acted_at` is set when a moderator resolves the report (either by
    archiving the poll or dismissing the report as not actionable).
    """
    __tablename__ = "poll_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id", ondelete="CASCADE"), index=True)
    # Either citizen_id or rep_id is set (XOR enforced at the route layer,
    # not the schema — SQLite won't enforce a CHECK across nullable cols
    # cleanly).
    reporter_citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="SET NULL"), default=None, index=True,
    )
    reporter_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="SET NULL"), default=None, index=True,
    )
    reason: Mapped[str] = mapped_column(String(64))
    detail: Mapped[Optional[str]] = mapped_column(String(1000), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    acted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)


# Dedupe reports — one per (poll, citizen) and one per (poll, rep) so
# spamming Report doesn't inflate the count.
Index("uq_poll_report_citizen", PollReport.poll_id, PollReport.reporter_citizen_id, unique=True)
Index("uq_poll_report_rep", PollReport.poll_id, PollReport.reporter_rep_id, unique=True)


# ── Post + comment reports ──────────────────────────────────────────
# Same shape as PollReport, mirrored onto Post and PostComment so the
# moderation surface is uniform across content types. Citizens can
# report a rep's post; either reps or citizens can report a comment.
# Anonymous viewers cannot report — the endpoint requires a session.
class PostReport(Base):
    """
    User-submitted report on a rep-authored post. Used to flag spam,
    abuse, doxxing, or other policy-violating content for human review
    (no auto-action yet — admins triage via the report_count column,
    same pattern as PollReport).
    """
    __tablename__ = "post_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    reporter_citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="SET NULL"), default=None, index=True,
    )
    reporter_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="SET NULL"), default=None, index=True,
    )
    reason: Mapped[str] = mapped_column(String(64))
    detail: Mapped[Optional[str]] = mapped_column(String(1000), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    acted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)


Index("uq_post_report_citizen", PostReport.post_id, PostReport.reporter_citizen_id, unique=True)
Index("uq_post_report_rep", PostReport.post_id, PostReport.reporter_rep_id, unique=True)


class CommentReport(Base):
    """
    User-submitted report on a citizen-authored PostComment. Either a
    rep (typically the page owner moderating their thread) or another
    citizen can file one. Reps DO NOT have unilateral delete authority
    on comments anymore — reports + admin review is the path. Comment
    authors can still delete their own comments.
    """
    __tablename__ = "comment_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    comment_id: Mapped[int] = mapped_column(
        ForeignKey("post_comments.id", ondelete="CASCADE"), index=True,
    )
    reporter_citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="SET NULL"), default=None, index=True,
    )
    reporter_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="SET NULL"), default=None, index=True,
    )
    reason: Mapped[str] = mapped_column(String(64))
    detail: Mapped[Optional[str]] = mapped_column(String(1000), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    acted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)


Index("uq_comment_report_citizen", CommentReport.comment_id, CommentReport.reporter_citizen_id, unique=True)
Index("uq_comment_report_rep", CommentReport.comment_id, CommentReport.reporter_rep_id, unique=True)


class PollCommentReport(Base):
    """Same shape as CommentReport — separate table so it FK's cleanly
    to poll_comments rather than post_comments. Citizens and reps
    can both report poll comments under the standard mutually-
    exclusive-session contract.
    """
    __tablename__ = "poll_comment_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_comment_id: Mapped[int] = mapped_column(
        ForeignKey("poll_comments.id", ondelete="CASCADE"), index=True,
    )
    reporter_citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="SET NULL"), default=None, index=True,
    )
    reporter_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="SET NULL"), default=None, index=True,
    )
    reason: Mapped[str] = mapped_column(String(64))
    detail: Mapped[Optional[str]] = mapped_column(String(1000), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    acted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)


Index("uq_poll_comment_report_citizen", PollCommentReport.poll_comment_id, PollCommentReport.reporter_citizen_id, unique=True)
Index("uq_poll_comment_report_rep", PollCommentReport.poll_comment_id, PollCommentReport.reporter_rep_id, unique=True)


# ── PollComment reactions (parallel of CommentReaction) ──────────────
class PollCommentReaction(Base):
    """Up/down reaction on a single citizen-poll comment. Mirrors
    CommentReaction exactly — same three-XOR identity columns
    (citizen / rep / candidate), same kind, same geography rollup
    columns, three parallel unique indexes keyed on
    (poll_comment_id, identity). Lives in its own table because
    PollComment.id is a separate space from PostComment.id.
    """
    __tablename__ = "poll_comment_reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_comment_id: Mapped[int] = mapped_column(
        ForeignKey("poll_comments.id", ondelete="CASCADE"), index=True,
    )
    citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    author_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    author_candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    kind: Mapped[str] = mapped_column(String(8))  # 'up' | 'down'
    scope_state: Mapped[Optional[str]] = mapped_column(String(2), default=None, index=True)
    scope_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)
    scope_city: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    scope_county: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


Index("uq_pollcomment_reaction_citizen",   PollCommentReaction.poll_comment_id, PollCommentReaction.citizen_id,   unique=True)
Index("uq_pollcomment_reaction_rep",       PollCommentReaction.poll_comment_id, PollCommentReaction.author_rep_id, unique=True)
Index("uq_pollcomment_reaction_candidate", PollCommentReaction.poll_comment_id, PollCommentReaction.author_candidate_id, unique=True)


class PollOption(Base):
    __tablename__ = "poll_options"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(255))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    poll: Mapped["Poll"] = relationship(back_populates="options")
    votes: Mapped[List["PollVote"]] = relationship(
        back_populates="option", cascade="all, delete-orphan",
    )


class PollVote(Base):
    """
    Phase 1.5: citizen-scoped votes.

    Every vote records the citizen's geography (state / congressional
    district / city / county) at the moment of the vote. These are
    denormalized copies of CitizenAccount columns — we want filter
    queries to be one table scan rather than a join, and we want votes
    to freeze in time if the citizen ever moves (Phase 2 concern).

    For the demo period we still accept anonymous `voter_token`-only
    votes so a lurking viewer can click an option and see counts, but
    those votes have all scope columns NULL so they only appear under
    scope='country'. Citizen-authenticated votes are the ones that flow
    into state / district / city scopes.
    """
    __tablename__ = "poll_votes"

    id: Mapped[int] = mapped_column(primary_key=True)
    option_id: Mapped[int] = mapped_column(ForeignKey("poll_options.id", ondelete="CASCADE"), index=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id", ondelete="CASCADE"), index=True)
    # Anonymous fallback — nullable now. Present for citizens too so the
    # same browser can't double-vote with both a signed-in and signed-
    # out session.
    voter_token: Mapped[Optional[str]] = mapped_column(String(64), default=None, index=True)
    # Citizen identity (preferred). When set, this is authoritative —
    # voter_token is retained only for double-vote prevention.
    citizen_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="SET NULL"), default=None, index=True,
    )
    # Rep self-vote on their own poll (Phase 2 self-engagement). At
    # most one of citizen_id / author_rep_id / author_candidate_id /
    # (voter_token-only) is set per row. The unique index below
    # dedupes per rep.
    author_rep_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Phase 4c — candidate self-vote on their own poll. Same shape +
    # NULL-distinct unique index pattern.
    author_candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    # Denormalized geography. Copied from CitizenAccount at vote time.
    scope_state: Mapped[Optional[str]] = mapped_column(String(2), default=None, index=True)
    scope_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)
    scope_city: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    scope_county: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    option: Mapped["PollOption"] = relationship(back_populates="votes")


# Unique-per-identity-per-poll. We match on citizen_id when present so
# a citizen can only vote once even if their browser token changes; we
# fall back to voter_token for anonymous votes. SQLite treats NULLs in
# unique indexes individually, so the partial-ish behavior works out of
# the box: `(poll_id, citizen_id)` with NULL citizen_id never conflicts
# with another NULL citizen_id row, which is handled by the second
# unique index keyed on voter_token. The rep index follows the same
# pattern for the self-vote case.
Index("uq_poll_vote_poll_citizen",  PollVote.poll_id, PollVote.citizen_id, unique=True)
Index("uq_poll_vote_poll_token",    PollVote.poll_id, PollVote.voter_token, unique=True)
Index("uq_poll_vote_poll_rep",      PollVote.poll_id, PollVote.author_rep_id, unique=True)
Index("uq_poll_vote_poll_candidate", PollVote.poll_id, PollVote.author_candidate_id, unique=True)


# ── Poll demographic forms (optional, creator-attached) ───────────────
class PollDemographicQuestion(Base):
    """Which standardized demographic questions a poll attaches. Catalog
    prompts/options/tier live in services/demographics_catalog.py (versioned
    code) — this table records only which catalog KEYS a poll uses and their
    display order. See docs/polls-demographic-forms-prd.md."""
    __tablename__ = "poll_demographic_questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(
        ForeignKey("polls.id", ondelete="CASCADE"), index=True,
    )
    question_key: Mapped[str] = mapped_column(String(40))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class PollVoteDemographic(Base):
    """A single self-reported demographic answer, frozen at vote time and tied
    to one PollVote. Written ONLY for verified-citizen votes that chose to
    answer (anonymous/demo-token votes carry none, mirroring how PollVote
    geography scopes work). AGGREGATE-ONLY by policy: no endpoint exposes an
    individual row; the results breakdown applies server-side min-cell
    suppression. poll_id is denormalized so breakdown filters stay one scan."""
    __tablename__ = "poll_vote_demographics"

    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(
        ForeignKey("polls.id", ondelete="CASCADE"), index=True,
    )
    poll_vote_id: Mapped[int] = mapped_column(
        ForeignKey("poll_votes.id", ondelete="CASCADE"), index=True,
    )
    question_key: Mapped[str] = mapped_column(String(40), index=True)
    answer_value: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# One attached question per (poll, question_key); one answer per (vote, key).
Index("uq_poll_demo_question", PollDemographicQuestion.poll_id,
      PollDemographicQuestion.question_key, unique=True)
Index("uq_poll_vote_demo_answer", PollVoteDemographic.poll_vote_id,
      PollVoteDemographic.question_key, unique=True)


class CitizenDemographicProfile(Base):
    """Opt-in reusable demographic profile for a citizen — STANDARD catalog
    questions only (sensitive categories stay answer-per-poll). Pure
    convenience auto-fill for the voter form; per-vote PollVoteDemographic
    snapshots remain the source of truth for results."""
    __tablename__ = "citizen_demographic_profile"

    id: Mapped[int] = mapped_column(primary_key=True)
    citizen_id: Mapped[int] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"), index=True,
    )
    question_key: Mapped[str] = mapped_column(String(40))
    answer_value: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


Index("uq_citizen_demo_profile", CitizenDemographicProfile.citizen_id,
      CitizenDemographicProfile.question_key, unique=True)


# ── Rep-created events ────────────────────────────────────────────────
class RepEvent(Base):
    """
    Rep-created events. Surfaced in the existing Events tab alongside
    curated entries from events.json. The events_service merges both
    sources at read time.
    """
    __tablename__ = "rep_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("rep_accounts.id", ondelete="CASCADE"), index=True)
    official_id: Mapped[str] = mapped_column(String(64), index=True)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[Optional[str]] = mapped_column(Text, default=None)
    location: Mapped[Optional[str]] = mapped_column(String(500), default=None)
    url: Mapped[Optional[str]] = mapped_column(String(500), default=None)
    # ISO-8601 string to mirror the shape of curated events.json
    start_at: Mapped[str] = mapped_column(String(40), index=True)
    end_at: Mapped[Optional[str]] = mapped_column(String(40), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    author: Mapped["RepAccount"] = relationship(back_populates="events")


# ── Citizen accounts (demo) ───────────────────────────────────────────
class CitizenAccount(Base):
    """
    Demo citizen account — Phase 1.5 scaffolding so the engagement
    features (like / dislike / comment / poll-vote-with-geography) have
    a verifiable identity to hang off of.

    Important: `verified=False` is the only honest value for this table
    in the current build. Identity verification (USPS address check,
    id.me, etc.) arrives in Phase 2 and will flip the flag. UI copy
    needs to say "Unverified" everywhere this identity is surfaced so we
    never accidentally present self-attested addresses as confirmed.

    Geographic columns are flattened rather than normalized because the
    demo's scope filters (country / state / district / city) are all
    single-hop lookups and we'd rather eat a little duplication than add
    a join to every engagement read.
    """
    __tablename__ = "citizen_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(255))

    # Address blob. `address_line1` is optional in schema but present in
    # the demo seed so the UI can render "123 Gulf Shore Blvd · Naples,
    # FL" when the citizen reviews their own profile.
    address_line1: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    city: Mapped[str] = mapped_column(String(128), index=True)
    county: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    state: Mapped[str] = mapped_column(String(2), index=True)
    zip_code: Mapped[Optional[str]] = mapped_column(String(10), default=None)
    # Congressional district as "<STATE>-<NN>" (e.g. "FL-19") so it's
    # directly matchable against RepAccount roles and candidate
    # seeking_office strings without extra parsing.
    congressional_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)

    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Start-page preference (Task #102). Which surface the app opens on
    # after sign-in / first visit of a session. NULL = default (home).
    # Allowlisted in routers/auth_citizen.py (START_PAGE_CHOICES) — the
    # column stores the raw key ('polls', 'bills', 'dashboard', ...).
    # Nullable String so the boot-time auto-migrate adds it without a
    # server_default (see db.py BOOLEAN NOT NULL caveat — strings are
    # safe nullable).
    start_page: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    # Weekly civic digest (Task #104). Explicit opt-in — default OFF, no
    # surprise email. BOOLEAN NOT NULL → server_default required for the
    # boot-time auto-migrate (db.py caveat). digest_last_sent_at gives
    # per-citizen idempotency: a backend restart on send day can't
    # double-send (sender skips anyone mailed in the last 6 days).
    digest_opt_in: Mapped[bool] = mapped_column(
        Boolean, server_default=sa_expression.false(), default=False, nullable=False
    )
    digest_last_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Admin moderation — mirrors RepAccount.suspended_at. When set,
    # the auth dependencies treat the account as not-signed-in and
    # the citizen-login endpoint refuses with a clear error.
    suspended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    suspended_reason: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    # TOTP 2FA fields — Task #62 Phase 1. Optional for citizens; required
    # for reps + candidates + admin once enforced in Phase 3+.
    #   totp_secret_encrypted: Fernet-encrypted base32 secret (see
    #     services/totp_service.py). NULL until the user successfully
    #     completes the enroll/verify flow.
    #   totp_enabled_at: timestamp of successful enrollment. NULL means
    #     2FA is not active on this account, regardless of whether a
    #     secret is present (partial enrollments).
    totp_secret_encrypted: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    totp_enabled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Self-serve account deletion (Task #81) — see RepAccount for docs.
    self_deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    purge_after: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    # Login attempt tracking + lockout (Task #29). Counter is bumped on
    # each wrong-password attempt; when it hits the per-identity-kind
    # threshold (3 for reps/candidates, 5 for citizens), locked_until
    # is set to an escalating window (15min → 1hr → 24h based on
    # consecutive_lockout_count). Reset on successful sign-in OR
    # successful password reset. See services/login_attempts.py.
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    consecutive_lockout_count: Mapped[int] = mapped_column(Integer, default=0)

    # ── Subscription (Task #88) ─────────────────────────────────────
    # Only citizens subscribe ($5/mo consumer tier). Reps + candidates
    # remain free. These columns hold the link between this account
    # and the Stripe Customer + Subscription objects so we can:
    #   • render account state ("Renewing on 2026-06-21" / "Past due")
    #   • route the user into the Stripe Customer Portal for cancel/
    #     update-payment without a custom UI
    #   • idempotently process the same webhook event twice (look up
    #     by stripe_subscription_id, no-op if already applied)
    #
    # is_subscribed is the BOOLEAN GATE the rest of the app reads.
    # It's derived from the Stripe state (status in {active, trialing})
    # but cached on the row so feature checks are a single column
    # read with no join.
    #
    # While ID.me + real account creation aren't live yet, demo
    # citizens get is_subscribed=True at signup time so engagement
    # features work end-to-end. The stripe_subscription_id stays NULL
    # for those rows, so an audit / cleanup script can later
    # distinguish "real paid subscriber" from "demo grant".
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(
        String(64), default=None, index=True,
    )
    stripe_subscription_id: Mapped[Optional[str]] = mapped_column(
        String(64), default=None, index=True,
    )
    # Mirrors Stripe's subscription status enum so we can show the
    # exact label in the UI: 'active', 'trialing', 'past_due',
    # 'canceled', 'incomplete', 'incomplete_expired', 'unpaid',
    # 'paused'. Reflect Stripe values verbatim rather than collapsing
    # into our own enum — saves a translation table when we read
    # webhooks back.
    subscription_status: Mapped[Optional[str]] = mapped_column(
        String(32), default=None,
    )
    current_period_end: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )
    # The cached gate. Set to True when:
    #   • Stripe webhook reports status in {active, trialing}, OR
    #   • Demo citizen signup (temporary; remove the demo-grant once
    #     real billing goes live).
    # Set to False when a webhook reports a non-active status.
    #
    # Uses server_default=expression.false() (not the Python-side
    # default=False alone) so the auto-migrate's ALTER TABLE ADD
    # COLUMN renders a dialect-correct DEFAULT clause. Postgres
    # rejects `DEFAULT 0` on a BOOLEAN column (literal int won't
    # cast); SQLite accepts both. The sa_expression.false() helper
    # compiles to `false` on Postgres and `0` on SQLite.
    is_subscribed: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=sa_expression.false(),
        nullable=False,
    )

    # ── Identity verification (Task #89) ─────────────────────────────
    # ID.me is the canonical verification path for citizens. The
    # existing `verified` boolean (above) is the gate the rest of the
    # app reads. These columns add the supporting metadata so the UI
    # can show "Verified since ...", the cost-skip lookup can find
    # the same person across re-signups, and the verified address
    # acts as ground truth for state + congressional_district.
    #
    # PII handling:
    #   • verified_legal_name_encrypted — Fernet-encrypted via the
    #     same SESSION_SECRET-derived key the TOTP secrets use.
    #     Plaintext name never lives in the DB. Decrypted only when
    #     the UI needs to display "Verified as <name>" or when the
    #     cost-skip path needs to hash + match against the archive.
    #   • verified_address_hash — sha256(normalized_address +
    #     SESSION_SECRET). One-way: we can match an inbound address
    #     against this hash, but never reconstruct the address from
    #     the row. Used for duplicate-address detection across
    #     accounts (one verified citizen per real residence).
    #
    # No DOB / SSN persisted. ID.me retains those itself; we just
    # take the boolean "ID.me says yes" + the address + the legal
    # name and let ID.me hold everything else.
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )
    # 'id.me' once real verification ships. 'demo' on demo signups
    # so the UI can render "Verified — demo" instead of pretending
    # they passed real ID.me checks. NULL on unverified rows.
    verified_method: Mapped[Optional[str]] = mapped_column(
        String(16), default=None,
    )
    verified_legal_name_encrypted: Mapped[Optional[str]] = mapped_column(
        String(512), default=None,
    )
    verified_address_hash: Mapped[Optional[str]] = mapped_column(
        String(64), default=None, index=True,
    )

    @property
    def has_billing_account(self) -> bool:
        """Surfaced on CitizenMeResponse so the UI knows whether to
        render 'Manage billing' (opens Stripe Customer Portal) or
        'Subscribe' (opens Stripe Checkout). True iff there's a
        Stripe Customer object backing this row."""
        return self.stripe_customer_id is not None


# ── Password reset tokens (Task #87) ─────────────────────────────────
class PasswordResetToken(Base):
    """Single-use, time-bounded token issued when a user requests a
    password reset.

    Stored as a sha256 hash (not the raw token string) so a database
    leak doesn't expose valid reset tokens. The user receives the raw
    token in an email link; we hash the inbound token and look up the
    row on the confirm endpoint.

    Tied to (identity_kind, account_id) so the password reset for a
    rep / citizen / candidate routes to the right table on confirmation.
    A user with multiple identities at the same email address would
    request resets for each separately — each gets its own token row.

    Single-use: the row is deleted after a successful password change,
    OR when it expires (cron-style purge from a startup hook similar
    to soft-delete account purging). 1-hour TTL by default.
    """
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    # sha256(raw_token + SESSION_SECRET salt). 64 hex chars. The raw
    # token never lives in the DB — only its hash. Mirrors the
    # verification archive's approach to one-way storage.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # Which identity this reset is for. Validates which table the
    # confirm endpoint should update the password_hash on.
    identity_kind: Mapped[str] = mapped_column(String(16))  # 'citizen' | 'rep' | 'candidate'
    account_id: Mapped[int] = mapped_column(index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)


# ── Verified-identity archive (Task #81) ─────────────────────────────
class VerifiedIdentityArchive(Base):
    """Persists an opaque marker that a given email address was
    previously ID.me-verified, so a returning citizen who deleted
    their account can re-sign-up without paying the $1.50 verification
    fee a second time.

    Stores a one-way hash of the normalized email (lowercased, trimmed)
    salted with a server-side secret so the archive isn't reversible
    to plaintext PII even if the row table leaks. The `verified_at`
    timestamp preserves the original verification date so we can
    surface it on the new account ('Verified since YYYY-MM-DD') and
    decide later whether identity-proofing too stale to honor.

    Only citizens go in this archive — reps + candidates don't
    transact through ID.me (they're admin-provisioned today and
    will use a different verification path when verified-rep
    onboarding ships).
    """
    __tablename__ = "verified_identity_archive"

    id: Mapped[int] = mapped_column(primary_key=True)
    # sha256(normalized_email + SESSION_SECRET salt). 64 hex chars.
    # Primary lookup key — most re-signups happen at the same email,
    # so this hits first + cheapest.
    email_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # ── Secondary lookup key (Task #89) ──
    # sha256(normalized_legal_name + SESSION_SECRET salt). Catches the
    # "same person, different email" re-signup case — a user who
    # deleted their account and signs up with a fresh address still
    # has the same legal name on file at ID.me, so the verified
    # callback's name hash will match this column and we can skip
    # the $1.50 charge anyway. NULL on pre-#89 archive rows.
    #
    # Not unique-indexed: name collisions exist (two real "John
    # Smith"s legitimately need separate verifications). The
    # cost-skip path treats a name hit as a strong signal but
    # confirms with at least one other attribute (currently
    # verified_address_hash if available) before granting the skip.
    legal_name_hash: Mapped[Optional[str]] = mapped_column(
        String(64), default=None, index=True,
    )
    # sha256(normalized_verified_address + SESSION_SECRET salt).
    # Stored on the archive so the legal-name-only match can
    # cross-check with address — defending against two real John
    # Smiths sharing the cost-skip incorrectly. NULL on pre-#89
    # archive rows.
    address_hash: Mapped[Optional[str]] = mapped_column(
        String(64), default=None, index=True,
    )
    # When the user originally completed ID.me verification.
    verified_at: Mapped[datetime] = mapped_column(DateTime)
    # When the underlying account was deleted and the archive row
    # written. Distinct from verified_at so we can spot abuse patterns
    # (rapid delete-and-recreate cycles).
    archived_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── Citizen waitlist ──────────────────────────────────────────────────
class CitizenWaitlist(Base):
    """
    Phase 1 placeholder for real user accounts. We capture interested
    citizens' emails + where they clicked from (comment CTA, subscribe
    button, claim-this-page modal, etc.) so Phase 2 can segment the
    launch list.
    """
    __tablename__ = "citizen_waitlist"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    clicked_from: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    state: Mapped[Optional[str]] = mapped_column(String(2), default=None)
    # Free-form context the user provides. The claim-this-page flow
    # uses this to carry the requester's legal name + relationship to
    # the official (chief of staff / campaign manager / etc.) so we
    # can follow up once identity verification ships. For the citizen
    # waitlist path this stays null.
    note: Mapped[Optional[str]] = mapped_column(String(2000), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ── Appeals ───────────────────────────────────────────────────────────
class Appeal(Base):
    """
    A user-filed appeal against a moderation action. Six target shapes:
      • 'post'                — rep's hidden post (appellant: rep)
      • 'post_comment'        — citizen's hidden comment (appellant: citizen)
      • 'poll'                — citizen's archived poll (appellant: citizen)
      • 'poll_comment'        — citizen's hidden poll-comment (appellant: citizen)
      • 'suspension_rep'      — suspended rep account (appellant: that rep)
      • 'suspension_citizen'  — suspended citizen (appellant: that citizen)

    Lifecycle:
      created_at         — submission timestamp
      acted_at IS NULL   — pending in admin queue
      acted_at SET       — admin granted or denied (decision col)

    Rules enforced at the row level:
      • UNIQUE (appellant_kind, appellant_id, target_kind, target_id) —
        one appeal per (appellant, target) ever. A denied appeal is the
        final word on that piece of content / suspension.
      • 30-day submission window enforced at the endpoint, not here
        (we'd need the moderation timestamp denormalized to enforce
        in-DB; cheaper to check at submit time).

    Future: candidates aren't appellants today (no account model). When
    Phase 2 ships verified-candidate accounts, add 'candidate' to
    appellant_kind and 'suspension_candidate' to target_kind. No schema
    rewrite needed.
    """
    __tablename__ = "appeals"

    id: Mapped[int] = mapped_column(primary_key=True)

    target_kind: Mapped[str] = mapped_column(String(24), index=True)
    # NOT a foreign key — target_id's table varies by target_kind, so
    # we keep it loose. The endpoints validate the (kind, id) pair on
    # write and on read.
    target_id: Mapped[int] = mapped_column(Integer, index=True)

    appellant_kind: Mapped[str] = mapped_column(String(16))  # 'rep' | 'citizen' | 'candidate'
    # Same loose-FK rationale — appellant_id refers to either
    # rep_accounts.id, citizen_accounts.id, or candidate_accounts.id
    # depending on appellant_kind. We don't ON DELETE CASCADE because
    # we WANT the appeal row to survive an account deletion (audit
    # trail). String length bumped from 8 → 16 in Phase 2 to fit
    # 'candidate'; the auto-migrate handles the column resize on next
    # boot.
    appellant_id: Mapped[int] = mapped_column(Integer, index=True)

    rationale: Mapped[str] = mapped_column(String(1000))

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), index=True,
    )

    # Decision fields. NULL = pending in queue.
    acted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None, index=True)
    decision: Mapped[Optional[str]] = mapped_column(String(8), default=None)  # 'granted' | 'denied'
    admin_email: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    # Optional admin note surfaced in the appellant's outcome email
    # and in their dashboard view of the resolved appeal.
    admin_note: Mapped[Optional[str]] = mapped_column(String(1000), default=None)


# Dedupe index: one appeal per (appellant, target) lifetime. Denied
# is final; the unique constraint blocks resubmission with a clear
# violation the endpoint converts to a 409.
Index(
    "uq_appeal_appellant_target",
    Appeal.appellant_kind, Appeal.appellant_id,
    Appeal.target_kind, Appeal.target_id,
    unique=True,
)


# ── Bill summaries ────────────────────────────────────────────────────
class BillSummary(Base):
    """
    Cached per-bill summary used by the rep-profile Bills tab. Two
    populated columns can carry text:

      • crs_summary    — fetched from the Congress.gov /bill/.../summaries
                          endpoint. Written by Congressional Research
                          Service analysts. Free, professionally neutral,
                          no LLM. Most non-trivial bills have one within
                          days of introduction.

      • plain_english  — Haiku-generated translation of the CRS summary
                          (or, when CRS is missing, of the bill title +
                          latest action). Triggered by the user clicking
                          "Translate to plain English" — first click runs
                          the LLM, subsequent renders are instant from
                          this column. Cached forever per (congress,
                          bill_type, number).

    Why a single row per bill rather than versioning summaries: bills
    DO have multiple text versions (Introduced → Reported → Engrossed
    → Enrolled), but the CRS summary is regenerated by analysts after
    each substantive version change, and re-fetching the summaries
    endpoint always returns the current one. We just refresh in place.
    The plain_english column gets invalidated and regenerated on the
    next user click when crs_fetched_at is older than the bill's
    update timestamp from the API.

    Lookup is always by (congress, bill_type, number) — that triple is
    the canonical bill identity. The compound unique index serves both
    the dedup constraint and the lookup index.
    """
    __tablename__ = "bill_summaries"

    id: Mapped[int] = mapped_column(primary_key=True)

    congress: Mapped[int] = mapped_column(Integer, index=True)
    # Bill type abbreviation as Congress.gov returns it: HR / S /
    # HJRES / SJRES / HCONRES / SCONRES / HRES / SRES. Always upper.
    bill_type: Mapped[str] = mapped_column(String(8), index=True)
    number: Mapped[str] = mapped_column(String(16), index=True)

    # Cached title + latest action — denormalized so the summary
    # endpoint can return everything the frontend needs without
    # round-tripping back to Congress.gov for the static fields.
    title: Mapped[Optional[str]] = mapped_column(Text, default=None)
    latest_action: Mapped[Optional[str]] = mapped_column(Text, default=None)

    # CRS summary — Markdown / plain text. NULL when the API has no
    # summary on file yet (e.g. bill just introduced).
    crs_summary: Mapped[Optional[str]] = mapped_column(Text, default=None)
    # When we last fetched the CRS summary from Congress.gov. Used to
    # decide whether to refresh.
    crs_fetched_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )

    # Haiku-generated plain-English translation. NULL until a user hits
    # the "Translate" button for the first time. Stored as Markdown
    # (one short paragraph + bullet list) so the frontend can render
    # it the same way every time.
    plain_english: Mapped[Optional[str]] = mapped_column(Text, default=None)
    plain_english_model: Mapped[Optional[str]] = mapped_column(
        String(64), default=None,
    )
    plain_english_generated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )

    # Bookkeeping — when the row was first created and last touched.
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(),
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )


# Lookup + dedup: one cache row per bill triple.
Index(
    "uq_bill_summary_triple",
    BillSummary.congress, BillSummary.bill_type, BillSummary.number,
    unique=True,
)


# ── Executive-order summaries ────────────────────────────────────────
class EoSummary(Base):
    """
    Cached Haiku-generated plain-English translation of an executive
    order's Federal Register abstract.

    The Federal Register API already exposes a free `abstract` field
    on every EO — that's the canonical "what does this order do"
    text written by the executive branch counsel's office (analogous
    to a CRS bill summary). The abstract is NOT cached here; the
    frontend renders it directly from the Federal Register response
    every time. This table only stores the Haiku translation — the
    "explain it like a citizen" upgrade.

    Cache key is the Federal Register `document_number` (e.g.
    "2025-12345"). Document numbers are immutable once an EO is
    signed and published, so the translation is valid forever.
    """
    __tablename__ = "eo_summaries"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Federal Register document_number — unique, lowercase, hyphenated
    # (e.g. "2025-12345"). Indexed for lookup.
    document_number: Mapped[str] = mapped_column(
        String(64), unique=True, index=True,
    )

    # Denormalized so the lookup endpoint can return a summary card
    # without the caller having to also pass title/eo_number/url.
    title: Mapped[Optional[str]] = mapped_column(Text, default=None)
    eo_number: Mapped[Optional[str]] = mapped_column(String(16), default=None)

    plain_english: Mapped[Optional[str]] = mapped_column(Text, default=None)
    plain_english_model: Mapped[Optional[str]] = mapped_column(
        String(64), default=None,
    )
    plain_english_generated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(),
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )


# ── Vote explainers ──────────────────────────────────────────────────
class VoteExplainer(Base):
    """
    Cached Haiku-generated explainer for a single roll-call vote.

    Why a cache row at all (templates are free): for the AI-enhanced
    "Explain in detail" upgrade, we want to pay the Haiku call ONCE
    per vote and serve it to every subsequent user. Votes are
    immutable (the question text, result, and procedural meaning
    don't change after the vote is cast), so cached AI text is
    valid forever.

    Lookup is by GovTrack vote_id. Templates don't get a cache row —
    they're regenerated on every request since they're deterministic
    and microseconds-fast. Only the AI body sits in the DB.

    Four content columns mirror the template shape:
      ai_what_was_voted   — substantive description of the vote
      ai_what_yea_means   — concrete meaning of a YEA position
      ai_what_nay_means   — concrete meaning of a NAY position
      ai_outcome_meaning  — what the result changes going forward
    """
    __tablename__ = "vote_explainers"

    id: Mapped[int] = mapped_column(primary_key=True)
    # GovTrack vote_id (e.g. "h2026-100" / "s2026-50"). Unique per
    # vote — one cache row per vote regardless of which rep was
    # voting (the position-specific framing happens client-side at
    # render time).
    vote_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    ai_what_was_voted: Mapped[Optional[str]] = mapped_column(Text, default=None)
    ai_what_yea_means: Mapped[Optional[str]] = mapped_column(Text, default=None)
    ai_what_nay_means: Mapped[Optional[str]] = mapped_column(Text, default=None)
    ai_outcome_meaning: Mapped[Optional[str]] = mapped_column(Text, default=None)

    # Which model produced this — preserved on the row so an admin can
    # invalidate / regenerate when we upgrade the model in the future.
    ai_model: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    ai_generated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(),
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None,
    )


# ── Notifications (Phase 5 MVP) ──────────────────────────────────────
class Notification(Base):
    """In-app notification — one row per (recipient, event). MVP scope
    covers reply notifications only ("someone replied to your comment");
    later kinds (page-owner posts, poll-close alerts, mentions) can
    land on the same table by adding more `kind` values.

    Recipient is keyed polymorphically: recipient_kind is one of
    'citizen' | 'rep' | 'candidate', and recipient_id points at the
    matching accounts table. We don't enforce the FK at the schema
    layer because the kind+id pair is the real foreign key and a
    SQL CHECK across nullable columns is awkward. The list endpoint
    filters by (recipient_kind, recipient_id) on the caller's
    session-derived identity, so a misaligned row would simply not
    surface for anyone (failsafe).

    payload_json carries kind-specific context as a small JSON-encoded
    dict so the frontend can render the right copy + deep-link target
    without an extra round-trip. For kind='reply':
        {comment_id, parent_comment_id, post_id, official_id,
         replier_name, preview}
    """
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipient_kind: Mapped[str] = mapped_column(String(16), index=True)
    recipient_id: Mapped[int] = mapped_column(Integer, index=True)
    kind: Mapped[str] = mapped_column(String(32), index=True)
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), index=True,
    )
    # NULL until the recipient marks it read. The unread-count query
    # is `WHERE recipient_kind=X AND recipient_id=Y AND read_at IS
    # NULL`, so this column carries an index for that fast path.
    read_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, default=None, index=True,
    )


# Composite index for "give me my recent notifications, newest first".
# The single-column indexes above cover the unread-count path; this
# composite avoids the secondary sort on created_at for the list.
Index(
    "ix_notifications_recipient_recent",
    Notification.recipient_kind,
    Notification.recipient_id,
    Notification.created_at.desc(),
)


# ── TOTP recovery codes (Task #62 Phase 1) ────────────────────────────
class RecoveryCode(Base):
    """
    One row per recovery code issued at 2FA enrollment.

    Polymorphic ownership via three nullable FKs (citizen / rep /
    candidate). Exactly one is set per row — matches the engagement-
    attribution pattern used by PostReaction / PostComment / PollVote
    elsewhere in this file. We deliberately avoid a single account_id
    column with a string discriminator because FK constraints +
    cascade-delete on account removal give us free referential
    integrity per account type.

    Lifecycle:
      • created at 2FA enrollment (10 codes per account)
      • used_at set the first time the plaintext code verifies; the
        row is never deleted, so the audit trail of which codes were
        used (and when) survives until the account itself does
      • regeneration deletes all rows for the account and issues 10
        fresh ones (see services/recovery_codes_service.py)
    """
    __tablename__ = "recovery_codes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(128))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Polymorphic ownership — exactly one of these is non-NULL per row.
    # Application-level invariant enforced in services/recovery_codes_service.
    citizen_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    rep_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )
    candidate_account_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("candidate_accounts.id", ondelete="CASCADE"),
        default=None, index=True,
    )


# ── Tracked items (per-identity, server-side) ────────────────────────
#
# Previously the user's tracked bills / officials / elections lived in
# localStorage under singleton keys (`civicview.trackedBills` etc.), so
# logging out of citizen A and into citizen B kept A's tracked items
# visible on B's navbar. That cross-account leak was also a privacy
# red flag for the eventual App Store review. Moving to server-side
# storage keyed per-identity fixes both problems and gives us cross-
# device sync once the native app ships.
#
# Owner is polymorphic — same shape as Notification above — so a
# citizen tracking a bill and a rep tracking a bill share one table.
# Today only citizens use this surface, but the schema doesn't paint
# us into a corner if rep / candidate tracking ever lands.
#
# snapshot_json carries the denormalized display fields the My Tracked
# list renders (bill title, sponsor name, election date, etc.) so we
# don't have to re-fetch from Congress.gov or the curated state JSON
# on every page load. The frontend store rewrite reads from this.
#
# prefs_json carries the per-subject notification preferences — same
# schema as frontend/lib/notificationPrefs.js. Defaults seed at first
# track; user toggles patch via PATCH /api/tracked/<type>/<key>/prefs.


class TrackedBill(Base):
    __tablename__ = "tracked_bills"
    __table_args__ = (
        UniqueConstraint(
            "tracker_kind", "tracker_id", "bill_key",
            name="uq_tracked_bills_owner_key",
        ),
        Index("ix_tracked_bills_owner", "tracker_kind", "tracker_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 'citizen' | 'rep' | 'candidate' — application-level FK pair.
    tracker_kind: Mapped[str] = mapped_column(String(16))
    tracker_id: Mapped[int] = mapped_column(Integer)
    # Canonical "{congress}-{type}-{number}" string, lowercased.
    bill_key: Mapped[str] = mapped_column(String(64))
    snapshot_json: Mapped[str] = mapped_column(Text, default="{}")
    prefs_json: Mapped[str] = mapped_column(Text, default="{}")
    tracked_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(),
    )


class TrackedOfficial(Base):
    __tablename__ = "tracked_officials"
    __table_args__ = (
        UniqueConstraint(
            "tracker_kind", "tracker_id", "official_key",
            name="uq_tracked_officials_owner_key",
        ),
        Index("ix_tracked_officials_owner", "tracker_kind", "tracker_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tracker_kind: Mapped[str] = mapped_column(String(16))
    tracker_id: Mapped[int] = mapped_column(Integer)
    # bioguide_id when present, else backend official id (e.g. "fl-sen-1").
    official_key: Mapped[str] = mapped_column(String(64))
    snapshot_json: Mapped[str] = mapped_column(Text, default="{}")
    prefs_json: Mapped[str] = mapped_column(Text, default="{}")
    followed_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(),
    )


class TrackedElection(Base):
    __tablename__ = "tracked_elections"
    __table_args__ = (
        UniqueConstraint(
            "tracker_kind", "tracker_id", "election_key",
            name="uq_tracked_elections_owner_key",
        ),
        Index("ix_tracked_elections_owner", "tracker_kind", "tracker_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tracker_kind: Mapped[str] = mapped_column(String(16))
    tracker_id: Mapped[int] = mapped_column(Integer)
    # Election backend id when present, else "state|office|date" composite.
    election_key: Mapped[str] = mapped_column(String(128))
    snapshot_json: Mapped[str] = mapped_column(Text, default="{}")
    prefs_json: Mapped[str] = mapped_column(Text, default="{}")
    tracked_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(),
    )


class FeaturedTracked(Base):
    """The single tracked item a user pins to the top of their dashboard
    Overview for each category (Task #32). One row per (tracker, category);
    category is one of representative | candidate | bill | election.
    item_key references the matching Tracked* row's key (official_key /
    bill_key / election_key) and is stored verbatim so it matches the
    frontend store key exactly. Cleared by deleting the row.

    Kept in its OWN table rather than a `featured` flag on each Tracked*
    table so that "exactly one per category" is a UNIQUE constraint, and
    so candidates vs representatives — which share the tracked_officials
    table — stay independently featurable.
    """

    __tablename__ = "featured_tracked"
    __table_args__ = (
        UniqueConstraint(
            "tracker_kind", "tracker_id", "category",
            name="uq_featured_tracked_owner_category",
        ),
        Index("ix_featured_tracked_owner", "tracker_kind", "tracker_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tracker_kind: Mapped[str] = mapped_column(String(16))
    tracker_id: Mapped[int] = mapped_column(Integer)
    # 'representative' | 'candidate' | 'bill' | 'election'
    category: Mapped[str] = mapped_column(String(16))
    item_key: Mapped[str] = mapped_column(String(128))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(),
    )


class SavedItem(Base):
    """A post or poll a citizen saved/bookmarked to their dashboard
    (Task #16). Same per-identity polymorphic owner shape as the
    Tracked* tables above (tracker_kind + tracker_id) — today only
    verified citizens save, but the schema doesn't foreclose rep /
    candidate saving later.

    We store only a REFERENCE (item_type + item_id), not a snapshot:
    the dashboard re-serializes the live post/poll on load so saved
    cards always show current vote/comment counts and stay fully
    interactive. Dangling saves (the post/poll was later deleted or
    archived) are skipped at list time rather than pruned eagerly.
    """

    __tablename__ = "saved_items"
    __table_args__ = (
        UniqueConstraint(
            "tracker_kind", "tracker_id", "item_type", "item_id",
            name="uq_saved_items_owner_item",
        ),
        Index("ix_saved_items_owner", "tracker_kind", "tracker_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 'citizen' | 'rep' | 'candidate' — application-level FK pair.
    tracker_kind: Mapped[str] = mapped_column(String(16))
    tracker_id: Mapped[int] = mapped_column(Integer)
    # 'post' | 'poll' — which feed entity this save points at.
    item_type: Mapped[str] = mapped_column(String(8))
    item_id: Mapped[int] = mapped_column(Integer)
    saved_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(),
    )


class ContentModerationVerdict(Base):
    """Audit record for one automated threat/incitement assessment of a
    piece of content (Task #41 — see docs/threat-detection-prd.md).

    One row per assessment (re-checks on edit append new rows). Stores
    the model's verdict + the decision the policy derived from it, plus
    the policy_version so verdicts stay interpretable and rollback-able
    as the rubric evolves. In Phase 0 (shadow mode) `decision` is
    recorded but NO content state changes — nothing is hidden.
    """

    __tablename__ = "content_moderation_verdicts"
    __table_args__ = (
        Index("ix_cmv_content", "content_type", "content_id"),
        Index("ix_cmv_decision", "decision"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 'post' | 'poll' | 'post_comment' | 'poll_comment'
    content_type: Mapped[str] = mapped_column(String(16))
    content_id: Mapped[int] = mapped_column(Integer)
    author_kind: Mapped[Optional[str]] = mapped_column(String(16), default=None)
    author_id: Mapped[Optional[int]] = mapped_column(Integer, default=None)
    # Verdict from the rubric (moderation_policy.CATEGORIES).
    category: Mapped[str] = mapped_column(String(32))
    severity: Mapped[float] = mapped_column(Float, default=0.0)
    # Policy-derived action: 'publish' | 'flag' | 'auto_hide' | 'skipped'.
    decision: Mapped[str] = mapped_column(String(16))
    rationale: Mapped[Optional[str]] = mapped_column(Text, default=None)
    offending_span: Mapped[Optional[str]] = mapped_column(Text, default=None)
    model: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    policy_version: Mapped[str] = mapped_column(String(16), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


# ─────────────────────────────────────────────────────────────────────
# Login attempts audit table (Task #29)
# ─────────────────────────────────────────────────────────────────────
class LoginAttempt(Base):
    """Per-attempt audit record for every login across the three
    identity types (rep, candidate, citizen).

    Why a flat unified table instead of three per-identity tables:
    the schema is identical and we routinely want to ask cross-cutting
    questions ("show me every login attempt from IP X in the last
    hour" — across all three identity types). Filtered by
    `identity_kind` when we need to scope by type.

    `identity_id` is nullable because we still log attempts that
    didn't match any account (so we can detect enumeration sweeps).
    `email_attempted` is always populated so we can correlate even
    when no account matched.

    Retention: we keep these indefinitely for now. Once volume grows,
    add a startup job that prunes rows older than N days, and/or
    summarizes them into per-account counters before deletion. Pruning
    keeps email and ip_address out of long-term storage.
    """
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 'rep' | 'candidate' | 'citizen'. Stored as a short string rather
    # than an enum so we don't have to wrangle ALTER TYPE migrations
    # if we add a new identity track later.
    identity_kind: Mapped[str] = mapped_column(String(16), index=True)
    # NULL when no account matched the email — that's still useful to
    # log so an attacker spraying random emails leaves an audit trail.
    identity_id: Mapped[Optional[int]] = mapped_column(Integer, default=None, index=True)
    # Always populated (the email the client supplied), regardless of
    # whether it matched an account.
    email_attempted: Mapped[str] = mapped_column(String(255), index=True)
    # IPv6-friendly (max length 45). NULLABLE because not all transports
    # supply a client IP (some FastAPI test-client paths drop it).
    ip_address: Mapped[Optional[str]] = mapped_column(String(45), default=None)
    user_agent: Mapped[Optional[str]] = mapped_column(String(512), default=None)
    # True only on full sign-in success (cookie set, no further gates).
    # 2FA-required success returns False here — the attempt isn't
    # "successful" until 2FA also passes.
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    # Short string instead of enum, same reason as identity_kind.
    # Values used: no_account, bad_password, locked_out, suspended,
    # claim_pending, self_deleted, inactive, 2fa_required, success.
    fail_reason: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), index=True,
    )
