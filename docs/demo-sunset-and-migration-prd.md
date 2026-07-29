# Demo Sunset & Verified Migration — PRD

**CIVICVIEW, INC.** | Drafted 2026-07-28 | Owner: Jeffrey De La Nuez
**Status:** design agreed; implementation in increments (see §9)
**Supersedes:** the "Identity verification + demo migration plan" section of `README.md`,
which described a Keep-vs-Start-fresh choice. This document is the source of truth.

---

## 1. Problem

CivicView runs entirely on self-serve demo citizen accounts. They are self-attested,
carry `verified=False`, and every engagement they produce is labeled "Unverified."
When the ID.me Relying Party contract is funded and verification goes live, three
things have to happen at once and none of them exist yet:

1. **The permission gates have to start being enforced.** Today nothing enforces them.
   Both comment creation and poll creation gate only on "is there a signed-in citizen
   session"; `is_subscribed` is populated but no code reads it as a permission check.
   The gates are *unimplemented*, not disabled — there is no switch to flip.
2. **Demo users have to be given a path to a verified account** without losing the
   history they built.
3. **Demo accounts have to be sunset**, or the platform permanently carries a cohort of
   unverifiable identities that undermine the verified-constituent claim.

---

## 2. Decisions (agreed 2026-07-28)

| # | Question | Decision |
|---|---|---|
| D1 | How does a demo user become verified? | **In-place upgrade**, with credential transfer as fallback |
| D2 | Do migrated comments/votes become verified? | **No — preserve verification state as of authorship** |
| D3 | Are demo accounts hard-deleted? | **No — soft-delete, then purge after a grace period** |
| D4 | What happens to demo-authored polls? | **Orphan and keep** |

### D1 — In-place upgrade is the primary path

The user signs into their existing demo account, completes ID.me, and **the same
`CitizenAccount` row** becomes verified (`verified=True`, `verified_method='idme'`,
name/state/district reconciled against the ID.me claim). Nothing transfers, because
nothing moves. No credentials to lose, no ownership proof, no orphaned rows.

**Fallback — one-time credential transfer.** For users who created a verified account
*before* thinking about migration, the dashboard offers a one-time claim: enter the
demo account's email + password (both are issued and displayed at demo signup), and
that account's content is reassigned to the verified account. Once used, the option
disappears from the dashboard permanently.

Constraints on the fallback:
- **One migration per verified account** and **one per demo account** (a demo account
  cannot be claimed twice).
- Rate-limited like a login endpoint — this is a credential-checking surface.
- Written to an **audit log** (`demo_migrations`): who claimed what, when, from what IP.

### D2 — Verification state is preserved, never retroactive

Migrated content moves ownership but **keeps the verification state it had when it was
written**. A comment authored by a demo account still renders "Unverified" after
migration; a vote cast by a demo account still counts as an unverified vote.

This is not a limitation to apologize for — it is the product claim. CivicView tells
reps, the NSF, and two app stores that engagement carries a verified-constituent signal.
Retroactively stamping self-attested speech as verified would falsify that claim and
silently change historical poll tallies.

Implementation: add `authored_verified: bool` (default matching the author's state at
insert time) to `PostComment`, `PollComment`, `PollVote`, `PostReaction`, and
`PollReaction`. Render badges from that column rather than from the author's *current*
state. Backfill existing rows from the author's current `verified` value.

### D3 — Soft-delete, then purge

Reuse the Task #81 self-deletion machinery (`self_deleted_at`, `purge_after`) rather
than building a second deletion path.

| T | Event |
|---|---|
| T0 | ID.me goes live. `DEMO_SUNSET_AT` is set to T0 + 30 days. Sunset emails begin. |
| T0 + 30d | Migration window closes. Un-migrated demo accounts are **soft-deleted** (invisible, not purged). |
| T0 + 60d | **Purge.** Rows deleted per the existing purge job. |

A user who returns between T+30 and T+60 can still recover — the recovery banner from
Task #81 already exists.

### D4 — Demo-authored polls are orphaned, not deleted

A demo account's polls carry other users' votes. Deleting them destroys engagement that
is not the demo user's to erase. On sunset, the poll survives with authorship displayed
as a former demo account; votes stay intact. Polls do **not** transfer on the fallback
path (the author identity on a poll is a public claim; see D2 reasoning).

---

## 3. The dormant switch

The point of this section is that **the enforcement code gets written now and ships
disabled**, following the existing env-gate convention (`DIGEST_ENABLED`,
`FORCE_2FA_ENABLED`, `APP_MIN_VERSION_CODE`, `AI_PROVIDER`).

### Env vars

| Var | Default | Effect |
|---|---|---|
| `IDME_ENABLED` | `false` | Master switch. False = every gate below no-ops; demo accounts behave exactly as today. |
| `DEMO_SUNSET_AT` | unset | ISO-8601 date. Drives countdown copy, email cadence, and the soft-delete job. Ignored when `IDME_ENABLED` is false. |

### Dependencies to write now

```
require_verified(citizen)    -> no-op when IDME_ENABLED is false
require_subscribed(citizen)  -> no-op when IDME_ENABLED is false
```

Wire them onto the real endpoints immediately, per the gate model:

| Endpoint | Dependency |
|---|---|
| `POST /api/pages/posts/{id}/comments` | `require_verified` |
| `POST /api/citizen-polls/{id}/comments` | `require_verified` |
| post/poll reactions, poll votes | `require_verified` |
| `POST /api/citizen-polls` (create) | `require_subscribed` |

**Why wire them while disabled:** an unimplemented gate is a gate nobody remembers to
build. A wired, no-op gate is one env var away from correct, and its presence in the
route signature documents the model at the point of enforcement.

**Testing requirement:** add tests that assert each gate's behavior in BOTH flag states.
There is currently no test anywhere asserting engagement permissions, which is how the
gates drifted from the docs in the first place.

---

## 4. Optional email on demo signup — ship this NOW

**This is the only piece with a real deadline, and it is independent of everything else.**

Demo accounts are auto-assigned `@demo-citizens.civicview.app` addresses that reach
nobody. Every demo account created before an email field exists is **permanently
unreachable** — the sunset notice could never be delivered to them.

So the field ships now, months ahead of ID.me, and the contactable list builds passively.

- Field is **optional**, on the demo signup form, below City.
- Copy states plainly that it is used **only** to notify them about migrating their
  account, and for nothing else.
- Stored on `CitizenAccount.contact_email` (distinct from the synthetic login `email`).
- Existing demo users get an in-app prompt to add one — a dismissible dashboard card,
  not a modal.

---

## 5. Notifications

**Email cadence** (to `contact_email` only; suppress the synthetic domain):
T0 announcement, T-14, T-7, T-1, and a post-deadline "soft-deleted, recoverable until
T+60" notice.

**In-app** — do not rely on email alone; most demo users never supplied one:
- Persistent countdown banner for demo accounts once `DEMO_SUNSET_AT` is set (not just
  on the dashboard — most users never open it).
- Dashboard card with the date, the migrate CTA, and a data-export link.

**Data export.** Offer "download my data" (comments, votes, tracked items) before
deletion. Cheap to build, and the right posture for a platform whose entire pitch is
trust.

---

## 6. What migrates

| Item | Migrates? | Notes |
|---|---|---|
| Comments (post + poll) | Yes | `authored_verified` preserved (D2) |
| Likes / dislikes | Yes | Same |
| Poll votes | Yes | Same — tallies unchanged |
| Tracked officials / bills / elections | Yes | No integrity concern |
| Saved items, featured picks | Yes | Same |
| Notification prefs, start-page pref | Yes | Same |
| Demographic profile | Yes | Opt-in data; carry the opt-in with it |
| Authored polls | **No** | Orphaned and kept (D4) |

---

## 7. Edge cases

- **ID.me vs demo geography conflict.** ID.me wins; the demo state/district are
  self-attested. Surface the change so the user isn't surprised their district moved.
- **Seeded internal accounts** (`DEMO_ACCOUNTS_JSON`, `DEMO_CITIZEN_ACCOUNTS_JSON`, the
  test rep/candidate) must be **excluded from sunset**. Deleting your own test fixtures
  during launch would be a bad week.
- **Demo account with an active subscription grant.** Demo grants set
  `is_subscribed=True`; that flag must not carry into the verified account. Verified
  users start unsubscribed unless they actually pay.
- **Multi-identity browsers.** A user signed in as citizen + rep + candidate migrates
  only the citizen identity.
- **Abuse.** The fallback path lets someone with stolen demo credentials pull another
  person's content into their verified identity. Rate-limit, audit-log, and consider
  emailing `contact_email` on a successful claim so the original owner is notified.

---

## 8. Legal / policy updates required

- **Privacy policy** — new `contact_email` field, its single purpose, and the retention/
  deletion schedule.
- **Terms** — the demo sunset and the deletion timeline.
- **Demo signup copy** — explicit consent language on the email field.
- Fold into the existing attorney review (`docs/LEGAL-REVIEW-ROADMAP.md`) rather than
  commissioning a separate pass.

---

## 9. Implementation increments

Each is its own commit; each is independently shippable.

1. ~~**Optional `contact_email` on demo signup**~~ — model column, schema, route, frontend
   field + consent copy. **DONE** 2026-07-29 (34c6d81).
2. ~~**In-app prompt for existing demo users** to add a contact email.~~ — dismissible
   dashboard card, `PUT /me/contact-email`, `POST /me/contact-email/dismiss`, and a
   `contact_email_prompt_dismissed_at` column so the dismissal follows the account across
   devices. **DONE** 2026-07-29.
3. ~~**Dormant switch**~~ — `IDME_ENABLED`, `require_verified` / `require_subscribed`, wired
   onto all engagement endpoints, no-op when disabled, plus tests in both flag states.
   **DONE** 2026-07-29 (3a10040).
4. **`authored_verified` columns** + badge rendering from them + backfill.
5. **In-place upgrade path** (the real ID.me integration; blocked on the RP contract).
6. **Fallback credential transfer** — dashboard card, one-time claim, audit log.
7. **Sunset machinery** — `DEMO_SUNSET_AT`, countdown banner, email cadence, soft-delete
   job, data export.

Increments 1-4 can all ship **before** ID.me is funded, which is the point: when the
contract lands, the remaining work is an integration and an env var rather than a
platform migration.

---

*Informational engineering document; not legal advice. The privacy, terms, and retention
items in §8 require attorney review before the sunset is announced to users.*
