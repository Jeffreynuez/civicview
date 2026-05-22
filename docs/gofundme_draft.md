# CivicView — GoFundMe campaign draft

**Status:** v1 draft — review and edit before publishing.
**Funding goal:** $25,000
**Story angle:** Civic infrastructure (non-partisan, builder voice)
**Generated:** May 21, 2026
**Companion docs:**
- `docs/civicview_financial_model.xlsx` — full 5-year P&L behind the $25K ask
- `frontend/components/HelpBuildThisView.js` — the public "Help build this" page that the GoFundMe links to for the line-item breakdown

---

## 1. Campaign metadata

| Field | Value |
| --- | --- |
| **Title** | CivicView: a non-partisan window into U.S. government |
| **Tagline (subhead)** | Verified citizens, verified reps, transparent civic data — built in public, owned by nobody |
| **Category** | Community & Neighborhood (or "Volunteer & Service" — both work; see launch checklist) |
| **Goal** | $25,000 |
| **Beneficiary** | CivicView Inc. (Florida Benefit Corporation — Amendment pending; initial filing tracking #800474911808) |
| **Location** | Florida, USA |
| **Cover image** | TBD — recommend a clean screenshot of the interactive U.S. map with the rep-page sidebar open (most distinctive surface). Mobile crop matters; verify on the GoFundMe preview. |
| **Cover video** | Optional. If included: 60-90 seconds, founder voiceover over screen recording. Script below. |

---

## 2. Story body (paste into GoFundMe → "Tell your story")

> ### What CivicView is
>
> CivicView is a non-partisan civic-engagement platform that surfaces what your elected officials publicly say and do — voting records, sponsored bills, executive orders, public statements — and lets verified constituents respond in their own districts.
>
> It's a window into government. Not a campaign tool. Not a news site. Not a partisan outlet. Just the actual public record, plus the structured ability for the people those officials represent to weigh in.
>
> ### The problem we're solving
>
> **You can't find out what your government is actually doing.** Most Americans don't know who their state senator is. Most don't know how their U.S. representative voted on the last major bill. Most can't name the bills currently in committee that will affect their city. That isn't apathy — it's an information problem. The data exists, but it's scattered across hundreds of government websites, lobbyist databases, and paid news terminals. Representatives don't fear voters who can't see what they're doing, and voters can't hold representatives accountable when the cost of finding out is half a day of research per question.
>
> **You can't talk to your reps in a way that counts, either.** The channels representatives use today to gauge what their constituents actually think are all broken in some way. Town halls self-select — only the loudest 50 people in a 750,000-person district show up. Phone-and-letter campaigns get astroturfed by lobbying groups with autodialers and paid mail mills. Social-media replies are anonymous, often automated, and full of out-of-district noise. Office surveys go only to people already on the mailing list. There is no district-scoped, identity-verified channel where a representative can see what their actual constituents — verified to live in their district — think about a specific bill or vote. Reps end up listening to whoever shouts loudest. Voters end up feeling unheard.
>
> **And the polling we rely on to understand each other doesn't hold up to scrutiny.** A headline says "90% of voters agree on X" — and never mentions, in the same breath, that the sample was 300 self-selected respondents, or that the question was leading, or that the demographic mix was nothing like the country it claims to represent. Trust in polling has collapsed, and for good reason: methodology is hidden, sample sizes are small, and topline numbers get repeated as fact by influencers and news shows that never read past the chart. That's how citizens end up walking into a voting booth confident in a "consensus" that was never real.
>
> CivicView attacks all three. Every elected official's record — their votes, their sponsored bills, their public statements, their committee assignments — is in one place, free and searchable. The engagement layer is gated to verified citizens at real addresses in real districts, so when a rep sees "62% of your district opposes this vote," that number is built from verified constituents, not bots and not a 300-person panel. And every poll on the platform shows its sample size, its scope, and its participant verification status up front. Methodology *is* the headline.
>
> ### What's already built
>
> This isn't a pitch deck. It's a working product. As of today CivicView already ships:
>
> - **All 50 states + 435 congressional districts** on an interactive U.S. map you can drill into
> - **Every member of Congress** with profile photos, voting records, sponsored bills, and committee assignments
> - **The President, Vice President, Cabinet, Supreme Court** — full executive + judicial branch coverage
> - **Florida full coverage** — state senate + house + statewide execs + 2026 candidates + election dates (other 49 states ramping)
> - **Address-to-rep lookup** — paste your street address, get the people who represent you at every level
> - **AI integration powered by Anthropic Claude** — plain-English translation for every federal bill (alongside the official Congressional Research Service summary), a "What was this vote?" explainer on every roll-call, a generated abstract on every executive order, semantic poll filter chips, and sentiment + tone classification on user comments. All cached per-bill / per-vote / per-EO so cost stays predictable as traffic grows.
> - **Three-identity engagement system** — citizens, verified representatives, and declared candidates can all hold accounts with appropriate features for each role
> - **Polls, comments, and "Verified citizen" labels** that let reps filter for their actual constituents instead of drowning in out-of-district noise
> - **Modern security foundation** — Cloudflare WAF + DDoS protection, automated dependency scanning, static analysis, daily Postgres backups, two-factor authentication for sensitive accounts, documented incident-response runbook
>
> You can use it right now at **civicview.app**. There's no waitlist for browsing; you can start exploring your district immediately.
>
> ### Where CivicView fits among the civic tools that already exist
>
> Civic tech isn't a blank field. GovTrack, Ballotpedia, and USAFacts have catalogued legislators, bills, and government statistics for years. BallotReady covers ballot races at scale. Each does part of what civic-information work needs, and you can use any of them today for free. CivicView's specific contribution is the engagement layer on top — verified, district-scoped constituents responding directly to the people who represent them, weighing in on bills and votes, asking questions on rep pages, all editorially neutral and structured to keep the conversation local to the district it actually affects. Browsing legislative data is table stakes. Bringing the conversation between citizens and the officials who represent them into one verified, district-scoped place is what's missing — and what CivicView is here to fill.
>
> ### What the $25,000 covers
>
> CivicView's operating model is deliberately lean. There are no salaries in this budget. No marketing agencies. No investor carve-outs. The $25,000 raises exactly what it takes to keep the lights on through Year 2 of operations and unlock the verification + data feeds that turn the demo into a real public utility:
>
> - **$2,400** — ID.me identity verification setup (so "Verified citizen" badges become provably real, not self-attested)
> - **$1,050** — Federal trademark registration for CivicView across software, SaaS, and online-community classes
> - **$6** — DMCA agent registration (required for user-generated content liability protection)
> - **~$6,000/year** — ProPublica Congress API Pro tier (real-time bill text, sponsor lists, roll-call votes across all 535 members)
> - **~$1,200/year** — OpenStates API Pro tier (state legislature data for all 50 states; right now Florida is the only state with deep coverage)
> - **$2,400–$6,000/year** — Google Civic Information API at scale (polling-place lookup, sample-ballot data, contact info that stays current automatically)
> - **~$300/year** — Render hosting + Postgres on the Pro tier (no cold-start delay, warm database — currently funded out of pocket; the campaign moves this onto the project so it doesn't depend on the founder absorbing it)
> - **$15/year** — Domain renewal for civicview.app
> - **$2,700** — Benefit Corp formation costs, attorney review of Terms of Service + Privacy Policy, modest civic-tech launch outreach
> - **$7,000** — Year-2 operating buffer so we don't have to run an emergency campaign while the subscription revenue is still ramping toward break-even
>
> Every line item above has a published source — you can audit the math at **civicview.app/help-build**.
>
> ### What unlocks at what dollar amount
>
> Backers can see exactly where their contribution lands as the bar fills. The ladder runs:
>
> | When the campaign reaches… | What unlocks |
> | --- | --- |
> | **$2,400** | ID.me Relying Party application filed — real verified-citizen badges become possible |
> | **$3,450** | Federal trademark filing + DMCA agent registered (every one-time legal item done) |
> | **$6,450** | Attorney review of Terms of Service + Privacy Policy commissioned |
> | **~$15,400** | Full Year-1 of recurring infrastructure (all data APIs + hosting + domain) funded |
> | **$25,000** | Year-2 six-month operating buffer secured — no emergency Year-3 campaign needed |
>
> Each milestone gets a public announcement on the campaign page as it's crossed. Donors love seeing exactly where their money went; we'd rather show it than hint at it.
>
> ### Where the money is *not* going
>
> Just as important as the line items above is the absence of these:
>
> - **No salaries.** Including the founder's. The fundraise pays for infrastructure; it doesn't pay anyone a wage. If the project ever justifies salaried staff, that decision goes through a future fundraise with its own explicit budget disclosure — not this one.
> - **No marketing agencies, growth hackers, or paid acquisition.** Outreach happens through honest channels — the share copy below, the GitHub repo, civic-tech community word-of-mouth. If $25K is going to get used on Facebook ads, we don't deserve $25K.
> - **No equity carve-outs, investor relations, or board observer seats.** Crowdfunding isn't a priced round. Backers get founding-supporter recognition and subscription credits — not stock.
> - **No contracted developers.** Engineering is one person. Adding more hands later happens out of subscription revenue, not crowdfunding proceeds.
> - **No executive comp, no offsites, no SaaS sprawl.** The five paid SaaS lines above (Render, ProPublica, OpenStates, Google Civic, Vercel) are it. No company credit card funding miscellaneous "we'll figure it out" expenses.
>
> ### Why this isn't ads-supported or venture-backed
>
> CivicView is filing as a **Florida Benefit Corporation**. That's a legal structure that requires the company to consider its public-benefit purpose alongside shareholder interests — codified into our Articles of Incorporation, reviewable in the state public record.
>
> No ads. Ads would mean advertisers pay to put content in front of constituents, which corrupts the editorial neutrality. The revenue model is a $5/month subscription for the engagement features (creating polls on rep pages, commenting on posts) once verified accounts go live. Browsing is free, forever — informational access shouldn't sit behind a paywall.
>
> No venture capital, either. VC-backed civic-tech has a track record of pivoting toward whatever pays — political ad-tech, data brokerage, partisan tools — once the runway runs out. Crowdfunding lets us stay accountable to citizens instead.
>
> ### What CivicView is *not*
>
> Civic tech is a crowded label, so it's worth being explicit about what CivicView is *not* doing:
>
> - **Not a voter-registration drive.** We don't sign anyone up to vote, don't collect voter-registration data, don't push registration as a CTA. There are organizations that do that work well — go support them.
> - **Not a candidate-endorsement tool.** We don't endorse candidates, don't run ads for candidates, don't rank candidates by preference. Every candidate gets the same surface treatment regardless of party, platform, or fundraising tier.
> - **Not a campaign-donation platform.** We don't process political contributions, don't link to PACs or donor portals, don't surface fundraising totals.
> - **Not a news site.** We don't generate editorial commentary on legislators or policies. The AI summaries translate official text into plain English; they don't argue about whether a vote was good or bad.
> - **Not a data broker.** We don't sell user data. We don't sell aggregated anonymized engagement data either. The Privacy Policy commits to this in writing.
>
> ### What you're getting
>
> See the "Perks" section below — supporters at every tier get founding-supporter recognition + free-or-discounted subscriptions once verified accounts open.
>
> Even if a perk isn't useful to you, every dollar above goal makes the platform more durable, not more expensive — more cushion against unexpected expenses, more headroom to add roadmap features as their costs come in, and less time spent fundraising instead of shipping.
>
> Beyond donating, the two things that genuinely help the project survive are these. **First, subscribe** at $5 a month once verified accounts go live. The financial model says the project breaks even at a 3% subscription rate among regular visitors; anything above 3% funds expansion to the rest of the country and the roadmap features further down. **Second, share the campaign and the platform** with anyone who cares about civic infrastructure. The more citizens and reps who join, the more useful the project becomes for everyone already on it. If you can't donate, those two still move the needle.
>
> ### About the builder
>
> CivicView is built by **Jeffrey De La Nuez**, an independent developer based in Florida.
>
> The idea for this app started years ago. I'd been listening — to representatives, to reporters, to social-media influencers — and at first I was genuinely enamored by the talk of change. But after years of it, I noticed something: nobody actually had a good way to connect with each other or surface real solutions to any of the problems that kept getting raised. Even people who followed political news closely couldn't name their own representatives, didn't know which bills were moving, and didn't really understand how the governing system worked.
>
> I also kept getting fooled by polling. I'd see a headline — "90% of voters agree on this" — and only later realize the poll never disclosed how many people they actually asked. Sometimes it was 300. That kind of misleading framing led me astray more than once when I walked into a voting booth thinking I knew where the country stood.
>
> And I kept watching newcomer candidates run into the same wall. Most races come down to whoever has the most money and the deepest connections, and that keeps good people with real ideas from ever running, because they know they can't compete on either axis.
>
> About two months ago all of this finally clicked into one project. CivicView is my attempt to take all three problems on at once — informational, conversational, electoral. I'm building it because I have a solution-oriented mindset, because I take the integrity of the system seriously, and because I love this country and would rather build than complain. My hope is that this app helps American citizens come together with a clearer, more coherent picture of their own government — and that it pushes the polling and governing systems we rely on toward more transparency along the way.
>
> The full source is on GitHub. There's no team yet — the design, the engineering, the moderation, the documentation, the financial model, all of it has been one-person work. The fundraise pays for the infrastructure that lets one person ship and maintain national-scale civic data; it doesn't pay anybody a salary.
>
> ### One last thing
>
> Every dollar that comes in here is logged. Every line item is sourced. The 5-year financial model is published. The list of what's shipped (35+ items) and what's blocked on funding (the items above) is on the public site at **civicview.app/help-build**. You can audit the project before you fund it, and you can keep auditing it after.
>
> That's the deal. Verified information, transparent funding, non-partisan tools. Help us ship it.

---

## 3. Donor tiers (paste into GoFundMe → "Add a thank-you gift" / Perks)

| Donation | Perk | Approx. donor net cost vs. retail | Cap on number redeemed |
| --- | --- | --- | --- |
| **$5** | 2 months of CivicView subscription free, once verified accounts open. "Founding Citizen" badge on your profile. | Retail value $10. | Uncapped. |
| **$50** | 1 year of CivicView subscription free. "Founding Citizen" badge + "1-year founder" credit on the /about page. | Retail value $60. | Uncapped. |
| **$200** | 5 years of CivicView subscription free. "Founding Citizen" badge + name listed in the /about credits + early access to verified-citizen onboarding (before public launch). | Retail value $300. | First 100 redemptions. |
| **$500** | Lifetime CivicView subscription. "Founding Citizen — Lifetime" badge + name listed in the /about credits + early access + a handwritten thank-you letter from the founder. | Retail value $1,200+ at average tenure. | First 50 redemptions. |

> **Important small print to include verbatim on each tier description:**
> *"Subscription perks are honored once the CivicView verified-account system + Stripe billing go live (target: Q3-Q4 2026). Until then, every supporter gets full access to the demo / preview environment with no subscription required. Subscription credits are tied to your verified account once you create one. If you delete your account, unused subscription time does not refund. If CivicView shuts down before subscription billing launches, supporters at any tier are eligible for a refund of unredeemed pledges via the GoFundMe payout protections."*

---

## 4. FAQ (paste below the story body, before the perks)

**Q: Where exactly does the money go?**
A: Every dollar goes into operating CivicView. No salaries, no profit distribution, no marketing agencies. The detailed line-item breakdown — with sources — is at civicview.app/help-build and in the 5-year financial model (docs/civicview_financial_model.xlsx in the public repo).

**Q: Is CivicView affiliated with any political party, campaign, PAC, or government agency?**
A: No. CivicView is independent, filed as a Florida Benefit Corporation, and our editorial standards explicitly forbid endorsements of candidates, parties, or political positions. Read the standards at civicview.app/editorial-standards.

**Q: Who decides what counts as "non-partisan" on the platform?**
A: The neutrality is enforced structurally rather than editorially. We don't write opinion pieces on legislators or policies. We don't endorse candidates. The AI summaries (powered by Anthropic Claude Haiku) translate official text — Congressional Research Service bill summaries, vote records, executive order text — into plain English without commentary on whether the underlying action was good or bad. Every elected official gets the same page treatment regardless of party. Every candidate gets the same composer regardless of party. The full editorial standards are published at civicview.app/editorial-standards. If you spot a violation, the Feedback button on the site goes straight to the moderation queue and corrections are logged publicly.

**Q: What's a Benefit Corporation, and why does it matter here?**
A: A Benefit Corporation is a for-profit company with a legal obligation, written into its Articles of Incorporation, to consider the public-benefit purpose alongside shareholder interests. For CivicView, that public benefit is informed civic engagement and access to government information. The structure means a future buyer can't gut the mission without changing the corporate charter — a much higher bar than ordinary corporate governance.

**Q: What happens if you don't hit the goal?**
A: GoFundMe is "keep what you raise" — we get every dollar contributed regardless of whether we hit $25K. If we fall short, we prioritize keeping the existing platform running (hosting + domain + security) and defer the discretionary line items (trademark, premium APIs) until subscription revenue catches up.

**Q: What if you overfund?**
A: There aren't named stretch goals on this campaign, because I'd rather not promise specific dollar amounts that aren't tied to real costs. What overfunding *does* is make launch and ongoing operation more durable: a bigger cushion against unexpected expenses, more headroom to ship the roadmap features as their real costs come in, and less time spent fundraising instead of building. If you want to make sure CivicView launches successfully, donate more. If you want to make sure it stays alive past launch, **subscribe** at $5/month once verified accounts open — the project breaks even at a 3% subscription rate among regular visitors, and anything above 3% funds expansion and the roadmap. And whether or not you donate, **share the campaign and the platform**. The more citizens and reps who join, the more useful CivicView becomes for everyone already on it.

**Q: How do I redeem my subscription perk?**
A: Subscription perks activate once we ship the verified-account system + Stripe billing (target Q3-Q4 2026). When that lands, every supporter will receive an email walking through verification + how to claim your subscription credit. Until then you can use the platform's demo / preview environment with no subscription required.

**Q: What if CivicView shuts down before I get to redeem?**
A: GoFundMe has buyer-protection mechanisms; supporters can request a refund of unredeemed pledges through their dispute process. We'd also publish a wind-down notice on the site itself with at least 60 days of warning.

**Q: Can I see the source code?**
A: Yes — the full backend + frontend source is on GitHub (jeffreynuez/civiclens). Reading the code is the highest form of due-diligence.

**Q: Why $5/month for the eventual subscription? Why not free or ad-supported?**
A: Ads corrupt the editorial neutrality (advertisers gain leverage over what gets shown to whom). Free-forever doesn't sustainably cover ID.me verification ($1.50/user), Render hosting at scale, or the data-API costs above. $5/month is the floor that lets the project pay its own way without ads or VC compromise.

**Q: Do you accept anonymous donations?**
A: Yes. GoFundMe lets you donate anonymously at any tier; the perks still apply (you'll get a perk-claim email once accounts open).

**Q: Are donations tax-deductible?**
A: No — CivicView is a Benefit Corporation, not a 501(c)(3) nonprofit. We considered the nonprofit route but the IRS approval process takes 12-18 months and we'd rather ship now. If CivicView eventually qualifies for a public-benefit tax structure, we'll consider transitioning at that point.

**Q: How can I help if I can't donate?**
A: (1) Share the campaign with people who care about civic infrastructure. (2) Use civicview.app and submit feedback via the Feedback button — we triage everything. (3) If you're a developer, the GitHub repo accepts pull requests for state-data coverage outside Florida. (4) If you're a local official or campaign staffer, claim your rep or candidate page once verified accounts open.

---

## 5. Pre-publish launch checklist

**Important sequencing note:** ID.me's Relying Party contract requires the
$2,400 setup fee upfront — the application can't begin without it. That
means the GoFundMe is *funding* the ID.me onboarding, not the other way
around. The sequence below reflects that dependency: stand up Postmark
and the corporate / banking pieces first (all free or cheap), launch the
campaign, then use the proceeds to onboard ID.me + Stripe live mode.

**Phase 1 — Free / cheap pre-work (do now, no money required):**
- [ ] Postmark account created + Server set up + Server API Token grabbed
      (POSTMARK_API_TOKEN). Free 100 emails/month forever. Verify
      `civicview@civicview.app` as a Sender Signature, OR add DKIM +
      Return-Path DNS records for full domain verification.
- [ ] EIN obtained (IRS.gov — free, instant if you have SSN; ~10 minutes
      online with the SS-4 form). Needed before you can open the business
      bank account.
- [ ] Stripe account created in **test mode** — no EIN required for this
      step. Create the Product ("CivicView Citizen Subscription"), the
      $5/mo Price, grab the test API key + a webhook signing secret. The
      whole subscription flow can be exercised end-to-end with Stripe's
      test card `4242 4242 4242 4242` before any real money moves.

**Phase 2 — Corporate + banking (1–2 weeks):**
- [ ] Wait for Sunbiz to process the initial Profit Corp filing
      (tracking #800474911808). Standard processing is ~5–7 business days.
- [ ] File the Benefit Corporation Amendment (Task #90) with Sunbiz once
      the initial filing is on the books. Articles language is in
      `docs/civicview_benefit_corp_filing.pdf`.
- [ ] Business bank account opened (need EIN + Articles of Incorporation +
      government ID + sometimes the Sunbiz tracking confirmation). Most
      online business banks (Mercury, Relay, Novo) approve in 1–3 business
      days. Brick-and-mortar banks can take a week.

**Phase 3 — Launch the GoFundMe:**
- [ ] GoFundMe account created and linked to the **business** bank
      account (NOT personal — this matters for accounting and for the
      Benefit Corp ledger).
- [ ] Cover image finalized (recommend: map screenshot with sidebar open;
      clean, no PII visible).
- [ ] Optional: cover video recorded (60–90 sec; see script below).
- [ ] Tiers configured in GoFundMe perks UI exactly as in section 3 above.
- [ ] FAQ pasted into the story body (or as a separate section below the
      main story).
- [ ] Link to civicview.app/help-build cited in the story.
- [ ] Test-donate $5 from a different account before going live so you've
      seen the full flow.
- [ ] Decide launch timing — Tuesday or Wednesday morning (US Eastern)
      typically gets the best initial-day engagement.

**Phase 4 — Once raised, deploy the proceeds in priority order:**
- [ ] **First $2,400 → ID.me Relying Party application.** This unlocks
      verified-citizen accounts, which unlocks Stripe live mode (no point
      charging $5/mo for engagement features until verified accounts can
      actually engage). Note: before paying the full $2,400, double-check
      ID.me's current pricing — some Relying Parties qualify for reduced
      or staged pricing (civic-tech, nonprofit-adjacent, pilot programs).
      Worth a 10-minute call to ID.me's sales contact at id.me/business
      to confirm there isn't a smaller-footprint contract available for a
      pre-revenue Benefit Corp.
- [ ] **Next $1,050 → Federal trademark filing (USPTO).** Protect the
      CivicView name before the user base grows. Three classes (9, 42,
      45) at $350 each.
- [ ] **Then activate Stripe live mode.** Submit business identity +
      bank account through Stripe's onboarding. They'll run a soft
      verification (no credit pull); usually live in <24 hours.
- [ ] **Then attorney review of Terms of Service + Privacy Policy**
      (~$1.5K–$3K per the LEGAL-REVIEW-ROADMAP.md). Required before
      verified accounts can hold any subscription funds, before the ID.me
      Relying Party contract goes live, and before launching outreach.
- [ ] **Then ProPublica + OpenStates Pro API subscriptions** ($600/mo
      combined). These are the data feeds that keep the rep pages fresh
      automatically instead of relying on the curated snapshot.
- [ ] **Remainder into the Year-2 operating buffer.** Sits in the
      business account; no spending pressure.

**At launch (the day the GoFundMe goes live):**
- [ ] Share copy ready in section 6 below — post to Twitter/X, LinkedIn,
      Reddit r/civictech and r/programming, civicview.app's home page
      banner.
- [ ] Email your existing waitlist (whoever's already in the
      CitizenWaitlist table) with the campaign link.
- [ ] Update the SHIPPED list on /help-build with a "Crowdfunding
      launched" entry linking to the GoFundMe URL.
- [ ] Pin the GoFundMe link as a banner on civicview.app.
- [ ] Reply to the first 20 donations within 24 hours with a personal
      thank-you note (GoFundMe lets you message donors).

**Through the campaign:**
- [ ] Weekly progress update post (on the GoFundMe + shared to social) —
      momentum matters more than perfection.
- [ ] If you hit milestones (25%, 50%, 75%, 100%), share immediately.
- [ ] When you cross $2,400, post "ID.me application started" as a major
      milestone update. Donors love seeing exactly where their money went.
- [ ] When verified accounts ship, email all supporters with the
      perk-redemption walkthrough.

---

## 6. Share copy

**Twitter / X (280 chars):**
> Built CivicView in the open over the last 6 months — a non-partisan window into U.S. government. Verified citizens, verified reps, transparent funding. Crowdfunding the infrastructure now: [GoFundMe link]
>
> No ads. No VC. No partisan agenda. Just the public record + tools to engage.

**LinkedIn (longer-form post):**
> Civic infrastructure is broken. Most Americans can't name their state senator, can't tell you how their U.S. rep voted on the last major bill, and can't find their polling place without a Google rabbit hole. That's not apathy — it's a data problem. The information exists; it's just scattered, paywalled, and partisan.
>
> Over the last six months I've been building CivicView (civicview.app) — a non-partisan platform that puts all 535 members of Congress, the President + Cabinet + SCOTUS, every Florida state legislator, and 435 congressional districts in one place. Voting records, sponsored bills, public statements, AI-translated plain-English summaries. You can browse it right now.
>
> What it doesn't have yet is the verified-citizen layer and the live data feeds that turn the demo into a public utility. That's what the crowdfunding is for: $25K covers Year 2 infrastructure (ID.me verification, ProPublica/OpenStates/Google Civic APIs, hosting, security, legal). No salaries. No marketing. Every line item is sourced and audited at civicview.app/help-build.
>
> Filed as a Florida Benefit Corporation — legally obligated to weigh the public benefit alongside any shareholder interest. No ads, no VC, no partisan agenda. Just the public record + tools to hold reps accountable.
>
> Link to support: [GoFundMe link]

**Reddit r/civictech and r/programming:**
> [Title] CivicView — non-partisan civic data + engagement platform, fully working, crowdfunding the Year-2 infrastructure
>
> Hey folks — for the last 6 months I've been building civicview.app, a non-partisan way to see what your elected officials actually do (votes, bills, statements) and to weigh in as a verified constituent.
>
> The Phase 1 product is live and free: all 50 states map, all 535 members of Congress with photos + votes + sponsored bills, the entire executive + judicial branch, address-to-rep lookup, AI-translated bill summaries.
>
> What's gated on funding: ID.me identity verification, the paid tier of ProPublica's Congress API, OpenStates Pro for all 50 state legislatures, and the Year-2 hosting buffer. Total ask is $25K with every line item sourced — breakdown at civicview.app/help-build.
>
> Built as a Florida Benefit Corp (no ads, no VC), source on GitHub at jeffreynuez/civiclens. Happy to answer technical or product questions in the thread.
>
> GoFundMe: [link]

**Email to existing waitlist:**
> Subject: We're crowdfunding CivicView's Year-2 infrastructure
>
> Hi —
>
> You joined the CivicView waitlist some time ago, so this update is overdue: the product is live and free to browse at civicview.app. All 535 members of Congress, the executive + judicial branch, address-to-rep lookup, AI-translated bill summaries, plus full Florida coverage.
>
> What hasn't shipped yet is the verified-account system that lets you create polls + comment on rep pages as a confirmed constituent. That's blocked on ID.me verification ($2,400 setup + $1.50/user) plus the live data feeds (ProPublica Congress API + OpenStates Pro) that keep the rep data fresh.
>
> We're crowdfunding it. $25K covers Year 2 of operations entirely — no salaries, no marketing, no VC, no ads. Every line item is sourced at civicview.app/help-build.
>
> Supporters at every tier get free-or-discounted subscription credits once verified accounts open:
> • $5  → 2 months of subscription
> • $50 → 1 year
> • $200 → 5 years
> • $500 → lifetime
>
> Campaign: [GoFundMe link]
>
> Thank you,
> Jeffrey De La Nuez
> Founder, CivicView

---

## 7. Cover video script (optional, 75 seconds)

> [Screen recording: civicview.app homepage. The interactive U.S. map renders. Cursor clicks Florida → rep page opens.]
>
> **[Voiceover, calm and direct]**
> Most Americans can't name their state senator. Most don't know how their congressperson voted on the last major bill.
>
> [Screen: switches to a federal rep's page — Marco Rubio, say — with voting record visible.]
>
> That isn't because people don't care. It's because the data is scattered across hundreds of government websites and paid news terminals.
>
> [Screen: bill detail page, with the Haiku-translated plain-English summary unfurling.]
>
> CivicView puts it in one place. Every member of Congress, every state legislator in Florida, every executive order, every Supreme Court justice — with AI-translated plain-English summaries on top.
>
> [Screen: poll page, citizen authoring a poll with "Unverified" badge visible.]
>
> Once we add ID.me verification, verified citizens get to weigh in on their rep's page as actual constituents. That's the unlock.
>
> [Screen: the /help-build page, scrolling through the funding line items.]
>
> No ads. No venture capital. No partisan agenda. Florida Benefit Corp, source open on GitHub, every funding line audited in public.
>
> [Cut to founder, on camera, plain background.]
>
> I'm Jeffrey De La Nuez. I built this myself over the last six months. The $25K we're raising covers Year 2 of operations — that's it. If you care about civic infrastructure that isn't owned by anyone, help me ship it.
>
> [End card: civicview.app + GoFundMe link]

---

## 8. Notes for the publisher (Jeff)

- **GoFundMe takes 0% platform fees** as of 2026 — they ask donors for an optional tip instead. Mention this nowhere in the campaign itself (GoFundMe asks you not to discount tips); just be aware the goal you set is what supporters see, and the donor tip is on top.
- **Stripe payment processing** ~2.9% + $0.30 is automatically deducted from each donation before it hits your business bank account.
- **GoFundMe payout cadence** is ~2–5 business days per disbursement. Plan to draw down weekly, not daily.
- **For accounting**: every GoFundMe payout should hit the CivicView business bank account (not personal). The donation isn't taxable income to you personally (it's revenue to the corporation), but the corporation may owe state taxes depending on FL Benefit Corp treatment. Confirm with the same attorney who reviews the Terms of Service.
- **Don't open the campaign before EIN + business bank account land** — running it through a personal account creates an accounting cleanup later that isn't worth the impatience.
- **Pre-launch test**: ask 3–5 trusted friends to read the story body and give 30-second feedback. They'll catch tone issues you've gone blind to.
- **Day-1 momentum** is statistically the biggest predictor of overall campaign success. Pre-line up at least 5 supporters willing to donate within the first 2 hours so the campaign doesn't show $0 to early visitors.
