# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
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

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator


# ── Auth ──────────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=256)


# ── Self-serve account deletion (Task #81) ──────────────────────────
class DeleteAccountRequest(BaseModel):
    """Body for /api/{identity}/delete. Used by all three identity
    types (rep, citizen, candidate) — the route uses whichever auth
    dep matches.

    confirm_email: must match the signed-in account's email (case-
      insensitive). Defends against accidental clicks + auto-fill
      mistakes. The /account/delete UI populates this from a
      'Type your email to confirm' field.
    mode:
      'soft' — archive the account for 30 days. Login still works
               during the grace window so the user can recover.
      'hard' — delete immediately, no recovery. Verification archive
               is still preserved on citizens so they don't pay for
               re-verification on a future signup.
    """
    confirm_email: EmailStr
    mode: str = Field(default="soft", pattern="^(soft|hard)$")


class DeleteAccountResponse(BaseModel):
    """Response from /api/{identity}/delete.
    mode echoes the request mode.
    purge_after is only populated for 'soft' deletes — null for 'hard'."""
    mode: str
    purge_after: Optional[datetime] = None


# ── Password reset (Task #87) ─────────────────────────────────────────
class PasswordResetRequestRequest(BaseModel):
    """Body for POST /api/{identity-auth}/password-reset/request.

    Endpoint ALWAYS returns 200 regardless of whether the email maps to
    a real account — see services/password_reset.request_password_reset
    for the anti-enumeration rationale. Only the email is required;
    the identity kind is implicit in the route path (rep / citizen /
    candidate) so the same address can hold an account in each space
    without ambiguity."""
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    """Body for POST /api/{identity-auth}/password-reset/confirm.

    token is the raw URL-safe string the user pasted from the email
    link (not the sha256 hash stored in the DB — the backend re-hashes
    it for comparison). new_password is the cleartext that gets bcrypt-
    hashed and written to the account row.

    Min length 8 enforced server-side too; we set it here so the API
    rejects the obviously-too-short cases before bcrypt runs."""
    token: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=256)


class PasswordResetGenericResponse(BaseModel):
    """Returned by both /request and /confirm. ok=True on the request
    path means 'we accepted the request' — NOT 'an email was sent'
    (see anti-enumeration note). On the confirm path ok=True means the
    password was actually updated."""
    ok: bool


class MeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    official_id: str
    email: EmailStr
    display_name: str
    role: Optional[str] = None
    is_active: bool
    # 2FA Phase 4 — true when FORCE_2FA_ENABLED is set, this account
    # has no totp_enabled_at, AND the account kind is in the enforced
    # set (rep / candidate / admin — citizens stay opt-in). The
    # frontend uses this flag to render a full-screen enrollment
    # overlay that blocks all other interaction until the user
    # finishes 2FA setup.
    needs_2fa_enrollment: bool = False
    # Self-serve account deletion (Task #81). When self_deleted_at is
    # populated the account is in the 30-day soft-delete grace window
    # — the frontend reads these fields to render the recovery banner
    # so the user can decide whether to recover or let the purge job
    # finish. Both NULL on active accounts.
    self_deleted_at: Optional[datetime] = None
    purge_after: Optional[datetime] = None


class LoginResponse(BaseModel):
    """Response from POST /api/auth/login.

    Two possible shapes depending on whether 2FA is enrolled on the
    account whose password just verified:

      • Plain login (no 2FA): rep + csrf_token + session_token are
        populated; two_factor_required is False.
      • 2FA required: two_factor_required is True + challenge_token
        is populated; rep / csrf_token / session_token are None. The
        client then calls POST /api/2fa/login-challenge with the
        challenge_token + the user's TOTP/recovery code to finish
        the login.

    The session cookie is also conditional — only set on the plain
    login path. The 2FA path returns no cookie until the code
    verifies, so a stolen-password attacker can't complete the
    session without also producing a valid code.
    """
    rep: Optional[MeResponse] = None
    csrf_token: Optional[str] = None
    # Bearer token mirror of the httpOnly session cookie. Returned so a
    # frontend running in an environment that blocks cross-site cookies
    # (mobile browsers, Safari ITP) can store it and forward it as
    # `Authorization: Bearer <session_token>` on subsequent requests.
    # The cookie is also set on the response; whichever auth path works
    # in the caller's environment, the backend accepts.
    session_token: Optional[str] = None
    # 2FA challenge fields — populated only when the password verified
    # and the account has totp_enabled_at set. The challenge_token is
    # a short-lived bearer the client passes back to /api/2fa/login-
    # challenge along with the user's 6-digit TOTP or recovery code.
    two_factor_required: bool = False
    challenge_token: Optional[str] = None


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
    voter_choice_id: Optional[int] = None  # legacy single-value; highest-priority identity
    # Phase 6 multi-identity: per-identity vote choice. Slots populated
    # only for identities the caller is signed in to; absent slots
    # stay None so the IdentityPicker can decide whether to auto-fire
    # or pop the picker. Keys: 'citizen', 'rep', 'candidate'.
    voter_choices: dict = Field(default_factory=dict)
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
    # Body is OPTIONAL — a poll-only or image-only post is valid as
    # long as at least one of (body, poll, image_ids) carries content.
    # The model_validator below enforces that "at least one non-empty"
    # rule. Empty-string body is the canonical empty value (matches
    # what the frontend sends when the user typed nothing); the SQL
    # column is Text so empty stores cleanly.
    body: str = Field(default="", max_length=5000)
    poll: Optional[PollCreate] = None
    # Optional list of image IDs previously uploaded via
    # /api/pages/images/upload. The create_post handler claims those
    # rows by setting their post_id. Cap matches the user-facing "5
    # images max" limit; longer lists are rejected with 422.
    image_ids: List[int] = Field(default_factory=list, max_length=5)

    @model_validator(mode="after")
    def _require_at_least_one(self) -> "PostCreate":
        """A post must carry at least one of: body text, a poll, or
        images. An empty post-shaped object would be noise on the
        feed; we reject it before it hits the database."""
        has_body = bool((self.body or "").strip())
        has_poll = self.poll is not None
        has_images = bool(self.image_ids)
        if not (has_body or has_poll or has_images):
            raise ValueError(
                "A post needs at least one of: text body, an attached poll, "
                "or one or more images."
            )
        return self


class AuthorSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    official_id: str
    display_name: str
    role: Optional[str] = None


class ReactionSummary(BaseModel):
    """Aggregated reaction state for one post, from the caller's POV.

    Phase 6 multi-identity: `my_reactions` exposes per-identity state
    when the caller is signed in to multiple identities at once
    (e.g. citizen + rep + candidate). The IdentityPicker UI uses
    this to decide whether to show its dropdown — if 2+ identities
    haven't reacted yet, pop the picker; if only 1 has any
    remaining choice, auto-fire; if all have acted, the picker
    opens in toggle-off mode.

    `my_reaction` is the legacy single-value field — kept for
    backward-compat. It mirrors the highest-priority signed-in
    identity's reaction (rep > candidate > citizen ordering).
    """
    up_count: int = 0
    down_count: int = 0
    my_reaction: Optional[str] = None
    # Per-identity reactions. Slots are populated only for identities
    # the caller is signed in to; absent slots stay None so the
    # frontend can treat "not signed in as X" and "signed in as X
    # but haven't reacted" identically.
    my_reactions: dict = Field(default_factory=dict)


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
    # Phase 6 multi-identity. When set, forces the backend to engage as
    # the named identity instead of the default cookie-priority pick
    # (rep > candidate > citizen). The IdentityPicker UI sends this
    # whenever the user is signed in to multiple identities so the
    # vote lands on the correct identity row.
    as_identity: Optional[str] = Field(default=None, pattern=r"^(citizen|rep|candidate)$")


# ── Reactions ─────────────────────────────────────────────────────────
class ReactionRequest(BaseModel):
    # 'up' or 'down'. Toggling the same kind removes the reaction.
    kind: str = Field(..., pattern=r"^(up|down)$")
    # Phase 6 multi-identity — see PollVoteRequest.as_identity.
    as_identity: Optional[str] = Field(default=None, pattern=r"^(citizen|rep|candidate)$")


# ── Comments ──────────────────────────────────────────────────────────
class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=1000)
    # Phase 3 reply threading. When set, this is a reply to the named
    # top-level comment; the route enforces the two-party rule
    # (caller must be the post creator OR the parent comment's
    # author). Replies-to-replies are rejected at the route layer
    # — the data model stays one level deep so the render is a
    # simple flat pool under each top-level comment.
    parent_comment_id: Optional[int] = None
    # Phase 6 multi-identity — see PollVoteRequest.as_identity. The
    # comment composer's "Posting as" picker forwards this so a
    # multi-identity user knows + controls which identity authors
    # the comment.
    as_identity: Optional[str] = Field(default=None, pattern=r"^(citizen|rep|candidate)$")


class CommentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    post_id: int
    # Phase 3 reply threading: NULL on top-level comments; set on
    # replies to point at their parent top-level comment. Frontend
    # buckets comments by this field to render the conversation pool.
    parent_comment_id: Optional[int] = None
    # Canonical author id for citizen-authored comments. Needed by the
    # frontend to distinguish the comment author from other citizens
    # with the same display_name (rare but possible) — comparing IDs
    # is the only correct way to gate the "delete my own" affordance.
    # Nullable: rep-authored comments (Phase 2 self-engagement) set
    # author_rep_id instead and leave citizen_id NULL.
    citizen_id: Optional[int] = None
    # Phase 2 self-engagement: when set, this comment was authored by
    # the page-owning rep replying to or weighing in on their own
    # post. Frontend uses author_kind below to decide which side to
    # compare against; the legacy citizen_display_name field holds
    # the rep's display_name in this case so renderers don't need a
    # second lookup.
    author_rep_id: Optional[int] = None
    # Phase 4c — candidate-authored comment. Same shape as
    # author_rep_id: set when a candidate engaging on their own
    # candidate page authored this comment; null otherwise.
    author_candidate_id: Optional[int] = None
    # Discriminator: 'citizen' | 'rep' | 'candidate'. Lets the UI
    # render an 'Author' badge when author_kind ∈ {'rep', 'candidate'}
    # (both are page-owner identities), or compare the identity id
    # when threading replies in Phase 3. Defaulted here + derived in
    # the validator below so model_validate(orm_obj) picks the right
    # value without hand-construction.
    author_kind: str = "citizen"
    citizen_display_name: str
    body: str
    created_at: datetime
    # Geography the comment was written under — used by the owner-side
    # filter. Always Unverified in the current build.
    scope_state: Optional[str] = None
    scope_district: Optional[str] = None
    scope_city: Optional[str] = None

    @model_validator(mode="after")
    def _derive_author_kind(self) -> "CommentRead":
        # If the caller explicitly set author_kind we honor it (e.g.
        # the router hand-builds responses for freshly-created rows
        # before the ORM has refreshed). Otherwise derive from
        # whichever identity column is populated. The default "citizen"
        # is only correct when both author_*_id columns are None.
        if self.author_kind == "citizen":
            if self.author_rep_id is not None:
                self.author_kind = "rep"
            elif self.author_candidate_id is not None:
                self.author_kind = "candidate"
        return self
    # Per-comment reactions. `my_reaction` is the caller's own — only
    # populated when the caller is an authenticated citizen.
    up_count: int = 0
    down_count: int = 0
    my_reaction: Optional[str] = None  # 'up' | 'down' | None
    # Phase 6 multi-identity per-comment reactions. Slots populated
    # only for identities the caller is signed in to; the
    # IdentityPicker reads this to stamp ✓ Liked / ✓ Disliked per
    # identity. Same shape as ReactionSummary.my_reactions.
    my_reactions: dict = Field(default_factory=dict)
    # AI classification. All optional — the classifier may not have run
    # yet (NULL means pending) or may have failed (also NULL). The
    # frontend uses these for quick-filter chips and shows a faint
    # "classifying…" indicator when NULL + recently posted.
    ai_sentiment: Optional[str] = None     # 'positive' | 'neutral' | 'negative'
    ai_tones: Optional[str] = None         # comma-separated tags
    ai_intensity: Optional[int] = None     # 1-5
    ai_topic: Optional[str] = None         # 2-4 word gist
    ai_classified_at: Optional[datetime] = None


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
    # 2FA Phase 4 — citizens are opt-in for 2FA, so this is always
    # False. Field kept for shape symmetry with the rep / candidate
    # /me responses so a generic identity-aware client can read it
    # uniformly.
    needs_2fa_enrollment: bool = False
    # Self-serve account deletion (Task #81) — see MeResponse docs.
    self_deleted_at: Optional[datetime] = None
    purge_after: Optional[datetime] = None
    # Subscription (Task #88). Only citizens carry these — reps +
    # candidates remain free in the current product. The frontend
    # reads is_subscribed to gate premium features (creating polls,
    # commenting). The rest are surfaced in the Account → Billing
    # tab so the user can see when the next renewal hits and what
    # state Stripe thinks they're in. Demo citizens have
    # is_subscribed=True with stripe_subscription_id=None — the
    # presence of the Stripe id distinguishes "real paid" from
    # "demo grant" when we audit later.
    is_subscribed: bool = False
    subscription_status: Optional[str] = None
    current_period_end: Optional[datetime] = None
    # Boolean derived from stripe_customer_id so the UI can show
    # "Manage billing" only when the Customer Portal has something
    # to manage. Stripped of the actual ID (no need to leak it to
    # the client).
    has_billing_account: bool = False
    # Identity verification (Task #89). `verified` (above) is the
    # gate. These supporting fields let the UI show "Verified via
    # ID.me · since May 2026" without exposing the encrypted legal
    # name. verified_method is 'id.me' for real verifications,
    # 'id.me-archive' for cost-skip grants, 'demo' on demo signups.
    verified_at: Optional[datetime] = None
    verified_method: Optional[str] = None

    @field_validator("is_subscribed", "has_billing_account", mode="before")
    @classmethod
    def _none_to_false(cls, v):
        """Defensive: ORM rows from before the subscription columns
        existed (and unsaved in-memory CitizenAccount instances)
        may surface None for these boolean fields. Coerce to False
        so the response shape stays valid + the frontend can rely
        on these being booleans without extra null checks."""
        return False if v is None else v


class CitizenLoginResponse(BaseModel):
    """Response shape mirrors LoginResponse. See LoginResponse docs
    for the two-shape rationale (plain login vs. 2FA challenge)."""
    citizen: Optional[CitizenMeResponse] = None
    # Bearer token mirror of the cl_citizen cookie. See LoginResponse
    # for the rationale — same cross-site-cookie workaround for the
    # citizen auth path. The frontend stores this and forwards it as
    # `X-Citizen-Token: <token>` on requests that need citizen auth.
    citizen_token: Optional[str] = None
    # 2FA challenge fields — populated when the citizen account has
    # totp_enabled_at set (rare today; citizens enroll voluntarily).
    two_factor_required: bool = False
    challenge_token: Optional[str] = None


# ── Candidate auth ───────────────────────────────────────────────────
class CandidateLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=256)


class CandidateMeResponse(BaseModel):
    """Public-facing candidate identity. The fields mirror what a rep
    profile renders so a candidate's claimed page can use the same
    component shape downstream.

    claim_status: 'pending' accounts can authenticate at the cookie
    layer but can't pass get_optional_candidate (which only accepts
    'active'); this surface still echoes the status so a future
    onboarding screen can show "Approval pending" without inventing
    a separate endpoint."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    candidate_id: str
    email: EmailStr
    display_name: str
    owner_state: Optional[str] = None
    owner_district: Optional[str] = None
    owner_city: Optional[str] = None
    claim_status: str = "active"
    # 2FA Phase 4 — see MeResponse for the field-level docs. Candidates
    # are in the enforced set alongside reps + admins; a campaign-page
    # owner's posting and engagement reach is the same as a sitting
    # rep's, so the credential-theft blast radius warrants the same
    # second factor.
    needs_2fa_enrollment: bool = False
    # Self-serve account deletion (Task #81) — see MeResponse docs.
    self_deleted_at: Optional[datetime] = None
    purge_after: Optional[datetime] = None


class CandidateLoginResponse(BaseModel):
    """Response shape mirrors LoginResponse. See LoginResponse docs
    for the two-shape rationale (plain login vs. 2FA challenge)."""
    candidate: Optional[CandidateMeResponse] = None
    # Bearer token mirror of cl_candidate cookie. The frontend
    # forwards this as `X-Candidate-Token: <token>` on requests that
    # need candidate auth — the third leg of the three-identity
    # header bundle (rep / citizen / candidate) used in mobile
    # browsers that block cross-site cookies.
    candidate_token: Optional[str] = None
    # 2FA challenge fields — populated when the candidate account has
    # totp_enabled_at set.
    two_factor_required: bool = False
    challenge_token: Optional[str] = None


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
# Across all rep pages, how many active citizen-authored polls a
# single citizen may have at once. Per-page cap of 1 still applies
# independently — this is the aggregate ceiling so one citizen can't
# carpet 30 pages with simultaneous polls.
TOTAL_REP_PAGE_POLL_CAP_PER_CITIZEN = 20
# How many active standalone polls a single citizen may have at
# once. Tight (1) because standalone polls compete for attention
# in the global /polls feed; we don't want a single citizen to
# dominate the top of the feed.
STANDALONE_POLL_CAP_PER_CITIZEN = 1


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
    # Phase 3 reply threading — see CommentCreate.parent_comment_id.
    parent_comment_id: Optional[int] = None
    # Phase 6 multi-identity — see CommentCreate.as_identity.
    as_identity: Optional[str] = Field(default=None, pattern=r"^(citizen|rep|candidate)$")


class PollCommentRead(BaseModel):
    """Comment on a citizen poll. Same shape as PostComment minus the
    post_id (we use poll_id) so the frontend can reuse the same row
    component with a different parent reference."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    poll_id: int
    # Phase 3 reply threading — NULL on top-level comments, set on
    # replies. Same purpose as CommentRead.parent_comment_id.
    parent_comment_id: Optional[int] = None
    # Canonical author id for citizen-authored comments. Nullable for
    # the rep-authored path — see CommentRead for the full rationale.
    citizen_id: Optional[int] = None
    # Phase 2 self-engagement: when a rep visits a citizen poll on
    # their own (newly-claimed) page and chimes in, the comment is
    # authored by the rep. author_kind below disambiguates.
    author_rep_id: Optional[int] = None
    # Phase 4c — same shape for candidate-authored poll comments.
    author_candidate_id: Optional[int] = None
    # 'citizen' | 'rep' | 'candidate'. See CommentRead.author_kind.
    author_kind: str = "citizen"
    citizen_display_name: str
    body: str
    created_at: datetime
    scope_state: Optional[str] = None
    scope_district: Optional[str] = None
    scope_city: Optional[str] = None
    # Reactions on the comment. Same shape as CommentRead's reaction
    # block — PollCommentReaction (Phase 9) is the source of truth.
    up_count: int = 0
    down_count: int = 0
    my_reaction: Optional[str] = None  # 'up' | 'down' | None
    my_reactions: dict = Field(default_factory=dict)
    # AI classification — see CommentRead for semantics. Same shape,
    # same NULL-means-pending convention.
    ai_sentiment: Optional[str] = None
    ai_tones: Optional[str] = None
    ai_intensity: Optional[int] = None
    ai_topic: Optional[str] = None
    ai_classified_at: Optional[datetime] = None

    @model_validator(mode="after")
    def _derive_author_kind(self) -> "PollCommentRead":
        # Same logic as CommentRead._derive_author_kind — see there
        # for the rationale.
        if self.author_kind == "citizen":
            if self.author_rep_id is not None:
                self.author_kind = "rep"
            elif self.author_candidate_id is not None:
                self.author_kind = "candidate"
        return self


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


# ── Tracked items (per-identity, server-side) ────────────────────────
#
# Wire format mirrors what the frontend store builds today — a tiny
# snapshot of display fields + a free-form prefs dict. Snapshot is
# kept as a dict in Python land (and stored as JSON text in the DB)
# so callers don't have to maintain parallel column lists per type.
#
# Shapes are intentionally permissive: the frontend has already shipped
# variants of these snapshots and we don't want a schema bump to break
# in-flight UI. The router enforces just the must-haves (the key).


class TrackedBillCreate(BaseModel):
    """Body for POST /api/tracked/bills.

    `bill_key` is the canonical "{congress}-{type}-{number}" string
    the frontend constructs in trackedBills.js. The snapshot mirrors
    the display fields rendered in the My Tracked list. Prefs are
    optional on first track — the router seeds defaults from the
    frontend schema if omitted.
    """
    bill_key: str = Field(..., min_length=1, max_length=64)
    snapshot: dict = Field(default_factory=dict)
    prefs: Optional[dict] = None


class TrackedBillRead(BaseModel):
    bill_key: str
    snapshot: dict
    prefs: dict
    tracked_at: datetime


class TrackedOfficialCreate(BaseModel):
    official_key: str = Field(..., min_length=1, max_length=64)
    snapshot: dict = Field(default_factory=dict)
    prefs: Optional[dict] = None


class TrackedOfficialRead(BaseModel):
    official_key: str
    snapshot: dict
    prefs: dict
    followed_at: datetime


class TrackedElectionCreate(BaseModel):
    election_key: str = Field(..., min_length=1, max_length=128)
    snapshot: dict = Field(default_factory=dict)
    prefs: Optional[dict] = None


class TrackedElectionRead(BaseModel):
    election_key: str
    snapshot: dict
    prefs: dict
    tracked_at: datetime


class TrackedPrefsPatch(BaseModel):
    """Body for PATCH /api/tracked/<type>/<key>/prefs.
    Permissive merge — any keys you pass overwrite, others stay.
    """
    prefs: dict = Field(default_factory=dict)


class TrackedListResponse(BaseModel):
    """Wrapper returned from GET /api/tracked. Lets the frontend
    bootstrap all three lists in one round-trip on login.
    """
    bills: List[TrackedBillRead] = Field(default_factory=list)
    officials: List[TrackedOfficialRead] = Field(default_factory=list)
    elections: List[TrackedElectionRead] = Field(default_factory=list)
