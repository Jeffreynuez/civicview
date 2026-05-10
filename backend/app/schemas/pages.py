# CivicView — Copyright (c) 2026 Jeffrey Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Pydantic request/response schemas for the Pages feature.

Kept separate from SQLAlchemy models so we can version the API shape
without touching DB columns (and vice versa). All response schemas use
ConfigDict(from_attributes=True) so we can return ORM objects directly.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# ── Auth ──────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=256)


class MeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    official_id: str
    email: EmailStr
    display_name: str
    role: Optional[str] = None
    is_active: bool


class LoginResponse(BaseModel):
    rep: MeResponse
    csrf_token: str
    # Bearer token mirror of the httpOnly session cookie. Returned so a
    # frontend running in an environment that blocks cross-site cookies
    # (mobile browsers, Safari ITP) can store it and forward it as
    # `Authorization: Bearer <session_token>` on subsequent requests.
    # The cookie is also set on the response; whichever auth path works
    # in the caller's environment, the backend accepts.
    session_token: str


# ── Poll options / polls ──────────────────────────────────────────────
class PollOptionCreate(BaseModel):
    text: str = Field(..., min_length=1, max_length=255)


SCOPE_VALUES = ("country", "state", "district", "city")
PRESENTATION_MODES = ("full", "hidden", "reveal_after_close")


class PollCreate(BaseModel):
    question: str = Field(..., min_length=1, max_length=500)
    options: List[PollOptionCreate] = Field(..., min_length=2, max_length=8)
    closes_at: Optional[datetime] = None
    # Default scope the post author wants viewers to see first. Only
    # scopes that make sense for the author's office are allowed; the
    # router rejects mismatches. Defaults to 'country' (inclusive).
    default_visibility_scope: str = Field(default="country")
    # How option counts are surfaced in the feed. 'full' | 'hidden' |
    # 'reveal_after_close'. Router clamps 'reveal_after_close' back to
    # 'full' when no closes_at is set (it'd be a perpetual blackout
    # otherwise).
    presentation_mode: str = Field(default="full")


class PollOptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    text: str
    sort_order: int
    vote_count: int = 0


class PollScopeBreakdown(BaseModel):
    """Per-scope vote counts for a single poll. Lets the UI render the
    current view + let the viewer know how much bigger the
    country-scope pool is compared to the author's district."""
    country_total: int = 0
    state_total: int = 0
    district_total: int = 0
    city_total: int = 0


class PollRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    question: str
    closes_at: Optional[datetime] = None
    options: List[PollOptionRead]
    total_votes: int = 0
    voter_choice_id: Optional[int] = None  # filled per-request
    # Scope controls (Phase 1.5).
    default_visibility_scope: str = "country"
    active_scope: str = "country"       # scope actually used for the option counts in this response
    allowed_scopes: List[str] = []      # scopes the author's role supports (country/state/district/city)
    scope_totals: PollScopeBreakdown = Field(default_factory=PollScopeBreakdown)
    # Label describing what the active scope resolves to, e.g. "FL-19"
    # or "Florida" — used in the UI to say "Showing FL-19 · 4 votes".
    active_scope_label: Optional[str] = None
    # Presentation mode — see Poll.presentation_mode. Frontend uses
    # this to pick between full bars, collapsed "Show results" +
    # "Vote" dropdowns, or a pre-close blackout.
    presentation_mode: str = "full"
    # True when the backend has suppressed counts on this response
    # (currently: reveal_after_close mode, still open, caller is not
    # the owner). The UI uses it to render the "Results will appear
    # when the poll closes" placeholder without having to
    # re-derive the logic.
    counts_suppressed: bool = False


# ── Post images ───────────────────────────────────────────────────────
class PostImageRead(BaseModel):
    """A single image attached to a post. `url` is a path the frontend
    resolves against its configured API base URL (works cross-origin
    in dev where backend and frontend are on different ports)."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    url: str
    content_type: str
    sort_order: int = 0


# ── Posts ─────────────────────────────────────────────────────────────
class PostCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)
    poll: Optional[PollCreate] = None
    # Optional list of image IDs previously uploaded via
    # /api/pages/images/upload. The create_post handler claims those
    # rows by setting their post_id. Cap matches the user-facing "5
    # images max" limit; longer lists are rejected with 422.
    image_ids: List[int] = Field(default_factory=list, max_length=5)


class AuthorSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    official_id: str
    display_name: str
    role: Optional[str] = None


class ReactionSummary(BaseModel):
    """Aggregated reaction state for one post, from the caller's POV."""
    up_count: int = 0
    down_count: int = 0
    # 'up' | 'down' | None. Requires the caller to be a signed-in citizen.
    my_reaction: Optional[str] = None


class PostRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    official_id: str
    body: str
    created_at: datetime
    author: AuthorSummary
    poll: Optional[PollRead] = None
    # Phase 1.5 additions — engagement summary.
    reactions: ReactionSummary = Field(default_factory=ReactionSummary)
    comment_count: int = 0
    # Attached images, ordered by sort_order ascending. Empty list
    # when the post has no images.
    images: List[PostImageRead] = Field(default_factory=list)


# ── Poll vote ─────────────────────────────────────────────────────────
class PollVoteRequest(BaseModel):
    option_id: int
    # Anonymous fallback. Still accepted so a lurking viewer can click an
    # option; their vote lands under scope='country' only. Citizen auth
    # is preferred — when present on the request, the vote gets geography.
    voter_token: Optional[str] = Field(default=None, min_length=8, max_length=64)


# ── Reactions ─────────────────────────────────────────────────────────
class ReactionRequest(BaseModel):
    # 'up' or 'down'. Toggling the same kind removes the reaction.
    kind: str = Field(..., pattern=r"^(up|down)$")


# ── Comments ──────────────────────────────────────────────────────────
class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000)


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    post_id: int
    citizen_display_name: str
    body: str
    created_at: datetime
    # Geography the comment was written under — used by the owner-side
    # filter. Always Unverified in the current build.
    scope_state: Optional[str] = None
    scope_district: Optional[str] = None
    scope_city: Optional[str] = None
    # Per-comment reactions. `my_reaction` is the caller's own — only
    # populated when the caller is an authenticated citizen.
    up_count: int = 0
    down_count: int = 0
    my_reaction: Optional[str] = None  # 'up' | 'down' | None


# Sort / filter modes for list_comments. Named enum-ish for the router
# to validate against instead of a grab-bag of magic strings.
COMMENT_SORTS = ("latest", "oldest", "most_liked", "most_disliked")
COMMENT_FILTERS = ("my_district", "my_state")


# ── Rep events ────────────────────────────────────────────────────────
class RepEventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = Field(default=None, max_length=5000)
    location: Optional[str] = Field(default=None, max_length=500)
    url: Optional[str] = Field(default=None, max_length=500)
    start_at: str = Field(..., min_length=4, max_length=40)  # ISO-8601
    end_at: Optional[str] = Field(default=None, max_length=40)


class RepEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    official_id: str
    title: str
    description: Optional[str] = None
    location: Optional[str] = None
    url: Optional[str] = None
    start_at: str
    end_at: Optional[str] = None
    created_at: datetime


# ── Page payload ──────────────────────────────────────────────────────
class PageOwnerInfo(BaseModel):
    """The rep who owns the page. Null when unclaimed."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    display_name: str
    role: Optional[str] = None
    last_login_at: Optional[datetime] = None


class PageResponse(BaseModel):
    official_id: str
    claimed: bool
    owner: Optional[PageOwnerInfo] = None
    is_owner: bool = False  # true if the caller's session owns this page
    posts: List[PostRead]
    upcoming_events: List[RepEventRead]
    # Phase 1.5 engagement filter (owner-only). Scopes the owner may
    # slice their constituent feedback by. Derived from which of
    # owner_state / owner_district / owner_city the owner has
    # populated. Frontend uses it to build the filter chip row on the
    # owner's view. Empty list when the page is unclaimed.
    allowed_engagement_scopes: List[str] = []
    # Human label for each allowed scope, parallel-indexed — e.g.
    # {"country": "United States", "state": "FL", "district": "FL-19"}.
    # Lets the UI render "Showing: FL-19" without re-deriving the label.
    engagement_scope_labels: dict = {}


# ── Owner dashboard (Step 7) ──────────────────────────────────────────
class DashboardSummary(BaseModel):
    """Top-line numbers on the owner's dashboard. All counts respect
    the caller's active scope (country / state / district / city).
    total_posts is never geography-filtered — posts belong to the
    official, not to any citizen geography."""
    total_posts: int = 0
    total_reactions: int = 0
    total_comments: int = 0
    total_poll_votes: int = 0
    unique_engaged_citizens: int = 0
    # up_total - down_total. Positive = net-approving, negative = the
    # opposite. Makes skimming a feed for "where's the friction?" fast.
    reactions_net: int = 0


class DashboardPostSummary(BaseModel):
    """One row in the top-engaged-posts table."""
    post_id: int
    body_preview: str           # first ~200 chars
    created_at: datetime
    up_count: int = 0
    down_count: int = 0
    comment_count: int = 0
    poll_vote_count: int = 0
    engagement_score: int = 0   # sum of the four above — how we rank


class DashboardCommenter(BaseModel):
    """One row in the top-commenters leaderboard."""
    citizen_id: int
    display_name: str
    city: Optional[str] = None
    scope_district: Optional[str] = None
    scope_state: Optional[str] = None
    comment_count: int = 0


class DashboardReactions(BaseModel):
    """Reactions breakdown card."""
    up_total: int = 0
    down_total: int = 0
    most_liked_post: Optional[DashboardPostSummary] = None
    most_disliked_post: Optional[DashboardPostSummary] = None


class PageDashboardResponse(BaseModel):
    """Root payload for GET /api/pages/{official_id}/dashboard.

    Everything here is gated to the page owner at the endpoint layer —
    non-owners 403 so an outsider can't scrape per-district engagement
    on someone else's page.
    """
    official_id: str
    scope: str                   # active scope used to compute this response
    scope_label: Optional[str] = None
    summary: DashboardSummary
    top_posts: List[DashboardPostSummary]
    top_commenters: List[DashboardCommenter]
    reactions_breakdown: DashboardReactions


# ── Citizen auth (demo) ───────────────────────────────────────────────
class CitizenLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=256)


class CitizenMeResponse(BaseModel):
    """Public-facing citizen identity. The `verified` flag is the single
    source of truth for whether this identity has been address-verified;
    UI copy should never present geography attributes as confirmed when
    verified is False."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: EmailStr
    display_name: str
    city: str
    county: Optional[str] = None
    state: str
    zip_code: Optional[str] = None
    congressional_district: Optional[str] = None
    verified: bool = False


class CitizenLoginResponse(BaseModel):
    citizen: CitizenMeResponse
    # Bearer token mirror of the cl_citizen cookie. See LoginResponse
    # for the rationale — same cross-site-cookie workaround for the
    # citizen auth path. The frontend stores this and forwards it as
    # `X-Citizen-Token: <token>` on requests that need citizen auth.
    citizen_token: str


# ── Citizen waitlist ──────────────────────────────────────────────────
class WaitlistSignup(BaseModel):
    email: EmailStr
    clicked_from: Optional[str] = Field(default=None, max_length=64)
    state: Optional[str] = Field(default=None, min_length=2, max_length=2)
    # Free-form note — used by the claim-this-page flow to carry the
    # requester's legal name + relationship to the official. Ignored
    # by the citizen waitlist path.
    note: Optional[str] = Field(default=None, max_length=2000)


class WaitlistStatus(BaseModel):
    ok: bool
    already_subscribed: bool = False


# ── Citizen-authored polls ────────────────────────────────────────────
# Schemas for the "Subscribed citizens post polls on unclaimed rep
# pages" feature. The poll itself reuses the existing PollCreate /
# PollRead shapes — the differences are at the wrapper level (no body,
# no images, no rep author) and at the list level (citizen-poll
# context: who created it, archive state, comment count, report count).

# Reasons we accept on a Report. Open list — UI can add new ones, the
# router only validates against this tuple to catch typos. Free-form
# `detail` carries any nuance the reporter wants to add.
POLL_REPORT_REASONS = (
    "spam",
    "harassment",
    "misinformation",
    "off_topic",
    "impersonation",
    "other",
)

# Reasons a citizen poll can land in the archive. Surfaced to the
# citizen on their dashboard so they understand what happened.
POLL_ARCHIVE_REASONS = (
    "rep_claimed",
    "citizen_closed",
    "superseded",
    "reported",
)

# Per-page cap on visible (active) citizen polls. When a new poll is
# posted and the page is already at the cap, the oldest active poll
# is auto-archived with reason='superseded'. The cap is intentionally
# generous so a popular unclaimed page stays lively without becoming
# unreadable.
PER_PAGE_ACTIVE_POLL_CAP = 20


class CitizenPollCreate(BaseModel):
    """Payload to create a standalone citizen poll on an unclaimed
    rep page. Same options as a rep would have when creating a poll
    inside a post — minus body, minus images. Author identity comes
    from the citizen session cookie; the page is identified by the
    URL path parameter (/pages/{official_id}/citizen-polls)."""
    poll: PollCreate


class CitizenAuthorSummary(BaseModel):
    """Lightweight identity payload for the poll author. Includes the
    'Unverified' geography so the UI can render 'Citizen · FL · Naples'
    style chips without knowing about the canonical citizen schema.
    """
    model_config = ConfigDict(from_attributes=True)
    id: int
    display_name: str
    state: Optional[str] = None
    city: Optional[str] = None
    congressional_district: Optional[str] = None
    verified: bool = False


class CitizenPollRead(BaseModel):
    """One citizen-authored poll row. Composes PollRead (the actual
    voting data) with the authoring + archival metadata."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    target_official_id: str
    author: CitizenAuthorSummary
    poll: PollRead
    created_at: datetime
    archived_at: Optional[datetime] = None
    archived_reason: Optional[str] = None
    # Comment count is denormalized — we run a single SELECT COUNT per
    # poll in the list builder so the read endpoint stays one round-
    # trip-per-page rather than N+1 across comments.
    comment_count: int = 0
    report_count: int = 0
    # True if the caller has already reported this poll. Hides the
    # "Report" button (or shows a "Reported" pill) so they don't keep
    # mashing it expecting a different result.
    my_report_filed: bool = False
    # Whether the caller can close this poll (only the author can).
    can_close: bool = False


class CitizenPollListResponse(BaseModel):
    """List wrapper for citizen polls on a page. Splits active vs.
    archived so the page UI can render the active feed at the top and
    optionally show a 'Pre-claim discussion (N polls)' archive
    section below for the rep owner.
    """
    official_id: str
    page_claimed: bool
    # Which slot the caller occupies on this page. 'subscribed' allows
    # poll creation; 'unsubscribed' shows an upsell; 'rep_owner' shows
    # the dismiss-archive control. None when anonymous.
    caller_role: Optional[str] = None
    # Cap signal so the frontend can disable the "Create poll" button
    # before the user types a question and gets rejected at submit.
    active_count: int
    active_cap: int = PER_PAGE_ACTIVE_POLL_CAP
    # When True, the caller already has an active poll on this page
    # and must close it before posting another (rate-limit rule:
    # 1 active per (citizen, page)).
    caller_has_active_poll: bool = False
    # Geographic scopes this page's office supports — drives the
    # Country/State/District chip row above the poll feed. Inferred
    # from curated officials data on the backend (so the frontend
    # doesn't need to know which office maps to which scopes). Empty
    # for officials not in the curated index → frontend falls back to
    # country-only.
    allowed_scopes: List[str] = Field(default_factory=lambda: ["country"])
    # Pretty-print labels for each scope, e.g. {state: "FL", district:
    # "FL-19"}. country always reads "United States". Parallel-keyed
    # to allowed_scopes.
    scope_labels: dict = Field(default_factory=dict)
    # Which scope the active vote counts in this response are
    # filtered to. The caller's last-selected scope, or "country"
    # for the default.
    active_scope: str = "country"
    active: List[CitizenPollRead] = Field(default_factory=list)
    archived: List[CitizenPollRead] = Field(default_factory=list)


class PollCommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000)


class PollCommentRead(BaseModel):
    """Comment on a citizen poll. Same shape as PostComment minus the
    post_id (we use poll_id) so the frontend can reuse the same row
    component with a different parent reference."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    poll_id: int
    citizen_display_name: str
    body: str
    created_at: datetime
    scope_state: Optional[str] = None
    scope_district: Optional[str] = None
    scope_city: Optional[str] = None


class PollReportCreate(BaseModel):
    reason: str = Field(..., max_length=64)
    detail: Optional[str] = Field(default=None, max_length=1000)


class PollReportStatus(BaseModel):
    ok: bool = True
    already_reported: bool = False


class CitizenPollListMineResponse(BaseModel):
    """List wrapper for the citizen's dashboard 'My polls' tab.
    Active and archived are returned separately so the UI's filter
    pills don't need to do client-side splits.
    """
    active: List[CitizenPollRead] = Field(default_factory=list)
    archived: List[CitizenPollRead] = Field(default_factory=list)
