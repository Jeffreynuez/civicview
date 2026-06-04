# Legal Review Roadmap

Reference for when, where, and how much to spend on attorney review of CivicView's
Terms of Service and Privacy Policy. Drafted while planning the pre-launch sequence
— captures the cost ranges + recommended providers + what to ask for, so future-me
doesn't have to re-research it.

**Current state:** ToS and Privacy Policy drafted at `/terms` and `/privacy`. Both
clearly marked as pre-launch drafts pending attorney review. Three `[PLACEHOLDER]`
markers in the ToS that need concrete decisions before publishing (governing-law
state, arbitration provider, registered business address).

---

## The plan

1. **Now** — Start the business entity. File the LLC or corp paperwork. Pick an
   incorporation state (Delaware is the default for SaaS; Florida if you want
   simpler taxes and that's where you operate; New Mexico for cheap + simple LLC).
2. **Set up the GoFundMe.** Use the help-build page funding goals as the public
   target. The financial model says $25K covers everything through Y1 with buffer;
   a fraction of that ($2-3K) covers the attorney engagement described below.
3. **Submit to the App Store + Google Play** with the current draft ToS + Privacy
   in place. They're good enough to pass review (account deletion ✓, privacy
   policy ✓, security posture ✓). The drafts explicitly say "pre-launch" — that
   doesn't prevent app store approval but it does buy you cover if a user
   challenges a clause.
4. **Once ~$2,000 is in the bank,** engage an attorney for a focused ToS + Privacy
   review. See below for what to ask for.
5. **At public launch / first paid subscriber surge** — revisit. Update with any
   new clauses the attorney recommends. Notify signed-in users via in-app banner
   30 days before material changes (this commitment is already in the draft ToS).

---

## Cost ranges (May 2026 USD)

### Tier 1 — Automated services
$50-500 one-time or ~$25-100/month subscription. LegalZoom, Rocket Lawyer, Termly,
iubenda.

- **Quality:** Low to mid. Templates miss civic-tech specifics (FEC adjacency,
  AI-generated content liability, app-store-specific clauses, content moderation
  regime).
- **Verdict:** Skip for CivicView. The draft you already have is better than a
  Termly template, and it's free.

### Tier 2 — Solo / freelance attorney
$1,500-3,000 flat-fee for a ToS-only review; $2,500-5,000 for ToS + Privacy bundle.
Sourced via UpCounsel, Avvo, LawTrades, state bar referral, startup community
referrals.

- **Quality:** Variable but you can vet. Look for "SaaS" + "startup" + "tech" on
  their bio + Avvo profile. Read their reviews.
- **Verdict:** ✅ **This is your target.** Realistic at $2-3K for the focused
  review described below.

### Tier 3 — Boutique tech/startup firm
$2,500-5,000 flat-fee ToS only; $5,000-10,000 bundle. Firms specializing in
SaaS + civic-tech: lots in SF, NYC, Boston. Many advertise "startup package"
flat fees.

- **Quality:** High. They've shipped iOS apps, dealt with content moderation,
  navigated GDPR. Worth the premium when you can swing it.
- **Verdict:** Engage post-Series A or first major enterprise deal. Not needed
  pre-launch.

### Tier 4 — Mid-sized regional firm
$5,000-12,000 (often hourly at $400-800), or flat $8,000-20,000 for a bundle.

- **Verdict:** Skip until you have institutional pressure or significant
  revenue.

### Tier 5 — BigLaw
$10,000-30,000+. Cooley, Wilson Sonsini, Perkins Coie, etc.

- **Verdict:** Skip until post-Series A or until enterprise customers require it.

---

## What to ask the attorney for (the $2-3K Tier 2 engagement)

Don't ask "review my ToS." That invites them to rewrite from scratch and bill
big. Instead, hand them the existing draft + this scope:

1. **Enforceability review** in your incorporation state. Confirm the class-
   action waiver + arbitration clause hold up. Flag any consumer-protection
   law (in your state) that conflicts with the drafted language.

2. **App Store / Google Play compliance flag.** Specifically:
   - Apple Guideline 5.1.1(v) requires self-serve account deletion (✓ already
     built at `/account/delete`).
   - Apple's "Reader app" exemption — does CivicView qualify? If yes, web-
     based subscriptions can route through Stripe instead of Apple's IAP,
     saving 15-30%.
   - In-app purchase disclosures required in ToS.
   - EULA references — Apple has a standard EULA they require you reference.

3. **GDPR + CCPA gaps in the Privacy Policy.** The draft includes both sections
   but an attorney should verify the language is sufficient. CCPA also requires
   a "Do Not Sell My Personal Information" link in the footer if you sell data
   (you don't, so this should be a sanity check).

4. **Election-law / FEC concerns specific to civic platforms.** A few
   to flag:
   - Could verified-citizen engagement on candidate pages be construed as
     in-kind contribution? (Likely no, because the platform is content-
     neutral, but worth confirming.)
   - Do you need a 527-style disclaimer anywhere? (Probably no, but again,
     worth confirming.)
   - Are there state-specific civic-tech regulations to be aware of? (Some
     states have specific rules on platforms that host political content.)

5. **Section 230 + content moderation language.** Confirm the ToS invokes
   Section 230 protections correctly. The draft Editorial standards page
   describes the moderation regime; the ToS should reference it without
   exposing CivicView to publisher-grade defamation liability.

6. **AI-generated content liability.** CivicView surfaces Anthropic Claude
   Haiku summaries of bills + votes. If a summary misrepresents a rep's
   vote, what's CivicView's exposure? Recommend a carve-out clause.

7. **Multi-state operation language.** You start FL-centric but plan
   nationwide. The ToS should not lock you to a single state's data laws.

This scope is **3-6 hours of attorney time** — well within the $2-3K flat-fee
range. Most solo attorneys with SaaS experience will quote you a flat fee for
this scope after reading the draft.

---

## Where to find the attorney

- **Y Combinator's Bookface directory** (even if not YC-funded — several
  listed firms work with non-YC startups at startup rates). Cooley, Gunderson
  Dettmer, Latham & Watkins offer startup packages.
- **Clerky** + **Stripe Atlas** referral lists. Both maintain vetted
  attorney directories with flat-fee offerings.
- **Local startup community** — Code for America chapters, civic-tech Slacks,
  local startup meetups.
- **State bar referral service** — every state bar offers free referrals to
  attorneys in specific practice areas (tech, internet, startup law). Usually
  includes a 30-min reduced-rate initial consult.
- **CodeForAmerica.org legal pro bono** — civic-tech-specific. Long-shot but
  worth a query.

---

## Saving money — concrete tactics

1. **Hand them the draft.** Don't make them start from scratch. The drafted
   ToS at `/terms` is ~80% of where an attorney would land. Saves 3-5 hours
   of their drafting time → roughly $1,000-2,000 off the quote at most
   firms.

2. **Flat fee, not hourly.** Always ask. "What's your flat fee for the scope
   above?" Most startup attorneys will quote you one because hourly creates
   uncertainty for both sides.

3. **Bundle ToS + Privacy.** Asking for both at once usually saves 20-30%
   vs. separate engagements.

4. **Skip BigLaw entirely until you actually need them.** Their hourly rates
   are 3-4x higher than competent solo attorneys for what is, at your stage,
   the same deliverable.

5. **Engage mid-year.** Most tax + corporate lawyers have busy seasons in
   Q4 + early Q1. Flat fees flex downward when their calendar is open
   (March-June, September). Avoid year-end.

6. **Don't add unnecessary scope.** Asking for "review everything I've ever
   written" is a $20K engagement. Asking for the 7-point scope above is a
   $2-3K engagement. Be precise.

---

## What pre-attorney work to do to make the engagement smooth

Before you email the attorney for an initial consult, have ready:

- [ ] Business entity formed (LLC or corp), with incorporation state confirmed.
- [ ] Registered business address (for the §15 placeholder in ToS).
- [ ] Decision on arbitration provider (AAA is the default; JAMS is the
      alternative; some startups skip arbitration entirely and stick with
      court — discuss with the attorney).
- [ ] Decision on governing law — usually matches incorporation state but not
      required to.
- [ ] EIN obtained from the IRS (free, ~10 minutes online).
- [ ] List of every third-party service CivicView shares data with (already
      in the Privacy Policy: ID.me, Anthropic, Stripe, Render, Cloudflare,
      Cloudflare R2). Keep this list updated as you add vendors.
- [ ] A list of any specific clauses you want the attorney to focus on (e.g.,
      "I'm worried about clause X in §3" — directs their attention efficiently).

---

## When NOT to skip the attorney

Three triggers that should accelerate the engagement even before you have
$2K saved:

1. **A user files a formal complaint.** GDPR data-subject request, CCPA
   deletion demand, or DMCA counter-notice that you don't know how to
   handle. Engage an attorney immediately — even an hour of consultation
   prevents larger problems.

2. **A media inquiry or political accusation.** If a press outlet or
   political figure publicly challenges CivicView's neutrality or content
   moderation choices, get an attorney before responding publicly.

3. **An app store rejection citing legal grounds.** Apple or Google bouncing
   your submission for ToS / Privacy reasons is a signal to fix the underlying
   document before re-submitting. Attorney consultation cheaper than a
   second rejection.

---

## Cross-references

- `/terms` — current draft Terms of Service with placeholders.
- `/privacy` — current draft Privacy Policy.
- `docs/SECURITY.md` — security posture the Privacy Policy references.
- `docs/civicview_financial_model.xlsx` — line items for legal fees would
  go into "Other recurring infra" (row 36 of the Assumptions sheet) once
  recurring. Today they're one-off and not yet modeled.
- `docs/identity-model.pdf` — context an attorney will want for understanding
  the three-identity auth structure.

---

## Last updated

May 20, 2026 — initial draft. Update this doc whenever the plan changes or
once an attorney has actually been engaged.

## Poll demographic forms — sensitive-category review (pre-production)

The optional poll demographic forms feature (`docs/polls-demographic-forms-prd.md`)
collects self-reported demographics, including SENSITIVE categories: political
party, race/ethnicity, household income, and religion. Before this ships to
production, counsel should review:

- Consent language shown to voters at answer time (currently: "anonymous, never
  linked to you publicly, shown only in aggregate; skip any or all").
- Lawful basis / disclosures for collecting sensitive categories, and any
  state-level (e.g. CA/IL) or sectoral requirements.
- Whether the privacy policy + ToS need specific clauses for this data.
- Retention (answers live and die with the poll) and the aggregate-only +
  min-cell-10 suppression posture as the privacy safeguard.

Mitigations already in place: every question optional, verified-citizen-only,
no free text, aggregate-only with server-side suppression. Flagged 2026-06-04.
