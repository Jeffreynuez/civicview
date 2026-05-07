# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
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
    String, Integer, DateTime, ForeignKey, Boolean, Text, Index,
    func,
)
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

    posts: Mapped[List["Post"]] = relationship(
        back_populates="author", cascade="all, delete-orphan",
    )
    events: Mapped[List["RepEvent"]] = relationship(
        back_populates="author", cascade="all, delete-orphan",
    )


# ── Posts + Polls ─────────────────────────────────────────────────────
class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("rep_accounts.id", ondelete="CASCADE"), index=True)
    # Denormalized so unauthenticated reads don't need to hit rep_accounts.
    official_id: Mapped[str] = mapped_column(String(64), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    # Soft-delete so reps can undo recent posts without leaking via polls.
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    author: Mapped["RepAccount"] = relationship(back_populates="posts")
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
    # Which rep owns this upload. Gates the "attach to my post" check
    # in create_post so one rep can't appropriate another's image.
    uploader_id: Mapped[int] = mapped_column(
        ForeignKey("rep_accounts.id", ondelete="CASCADE"), index=True,
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
    Up/down reaction from a verified citizen on a single post. One
    reaction per (post, citizen) — flipping up↔down updates the row;
    re-sending the same kind deletes it.

    Geography columns are denormalized from CitizenAccount at write
    time so the owner-side engagement filter can roll up reactions by
    scope without a join.
    """
    __tablename__ = "post_reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    citizen_id: Mapped[int] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"), index=True,
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


Index("uq_post_reaction_citizen", PostReaction.post_id, PostReaction.citizen_id, unique=True)


class PostComment(Base):
    """
    Flat comment on a post. Citizen-gated writes. Soft-delete so the
    author or the page owner can remove abusive content without losing
    the ID for moderation review.
    """
    __tablename__ = "post_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    citizen_id: Mapped[int] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"), index=True,
    )
    # Cached for read-side so we don't JOIN citizen_accounts just to
    # render a name. Kept in sync from CitizenAccount.display_name at
    # write time; UI will show (Unverified) next to it.
    citizen_display_name: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(String(1000))
    scope_state: Mapped[Optional[str]] = mapped_column(String(2), default=None, index=True)
    scope_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)
    scope_city: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    scope_county: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)

    post: Mapped["Post"] = relationship(back_populates="comments")
    reactions: Mapped[List["CommentReaction"]] = relationship(
        back_populates="comment", cascade="all, delete-orphan",
    )


class CommentReaction(Base):
    """
    Up/down reaction from a verified citizen on a single comment.
    Shape mirrors PostReaction exactly — one row per (comment, citizen)
    enforced by a unique index; geography columns are denormalized from
    CitizenAccount at write time so a later "most-engaged districts"
    rollup doesn't have to join citizen_accounts.
    """
    __tablename__ = "comment_reactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    comment_id: Mapped[int] = mapped_column(
        ForeignKey("post_comments.id", ondelete="CASCADE"), index=True,
    )
    citizen_id: Mapped[int] = mapped_column(
        ForeignKey("citizen_accounts.id", ondelete="CASCADE"), index=True,
    )
    kind: Mapped[str] = mapped_column(String(8))   # 'up' | 'down'
    scope_state: Mapped[Optional[str]] = mapped_column(String(2), default=None, index=True)
    scope_district: Mapped[Optional[str]] = mapped_column(String(8), default=None, index=True)
    scope_city: Mapped[Optional[str]] = mapped_column(String(128), default=None, index=True)
    scope_county: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    comment: Mapped["PostComment"] = relationship(back_populates="reactions")


Index("uq_comment_reaction_citizen", CommentReaction.comment_id, CommentReaction.citizen_id, unique=True)


class Poll(Base):
    __tablename__ = "polls"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), unique=True,
    )
    question: Mapped[str] = mapped_column(String(500))
    closes_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=None)
    # Default scope the post author wants viewers to see first.
    # Values: 'country' | 'state' | 'district' | 'city'. Defaults to
    # 'country' (inclusive). The frontend lets viewers override this
    # (Phase 2) — for now it drives the initial render only.
    default_visibility_scope: Mapped[str] = mapped_column(String(16), default="country")
    # How results are surfaced to viewers. 'full' is the classic "show
    # bars always" rendering; 'hidden' collapses results and vote
    # behind toggles so viewers explicitly opt in (useful for polls
    # the author doesn't want biasing in either direction until the
    # viewer commits); 'reveal_after_close' pairs with closes_at —
    # option counts stay hidden until the close time passes, then the
    # full results appear. The backend enforces the last one by
    # zeroing counts for non-owner viewers before close.
    presentation_mode: Mapped[str] = mapped_column(
        String(24), default="full", server_default="full",
    )

    post: Mapped["Post"] = relationship(back_populates="poll")
    options: Mapped[List["PollOption"]] = relationship(
        back_populates="poll", cascade="all, delete-orphan",
        order_by="PollOption.sort_order",
    )


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
# unique index keyed on voter_token.
Index("uq_poll_vote_poll_citizen", PollVote.poll_id, PollVote.citizen_id, unique=True)
Index("uq_poll_vote_poll_token",   PollVote.poll_id, PollVote.voter_token, unique=True)


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
