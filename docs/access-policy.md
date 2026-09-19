# Access and Neutrality Policy

Draft for review. Not published. Intended location: civicview.app/access-policy,
linked from the footer and from the About page.

---

## Why this page exists

CivicView is a civic platform that carries the pages of elected officials and
candidates from both major parties, minor parties, and no party. A platform like
that gets one question over and over, from people on every side: what are the
rules, and are they the same for me as they are for the other guy.

This page is the answer, written down in advance so it does not have to be
improvised later. It is a commitment, not a description of a mood. If CivicView
ever departs from it, that is a fact you can point at.

## 1. Equal access

Any elected official, declared candidate, or organization may use CivicView on
the same terms as any other. Eligibility does not depend on party, ideology,
platform, endorsements, or who else is already here.

There is no application we approve by judgment. There is identity verification,
which confirms that you are who you say you are, and nothing else.

## 2. No paid placement

No one can pay CivicView for visibility, ranking, priority in search, placement
on the home page, or any form of promotional treatment. No advertising is sold
against political content.

The paid tier on CivicView buys the ability to create polls. It does not buy
audience, reach, or position.

## 3. The same rules for every office

An officeholder's page is built the same way regardless of who holds the office.
The data shown, the sources used, the fields displayed, and the way records are
presented follow one specification. Where a record is thin, it is thin for
everyone. Where a record is missing, we say it is missing rather than filling
the gap.

## 4. Sources are published

Every data source CivicView draws on is named publicly: Congress.gov, GovTrack,
the @unitedstates project, the House Clerk, the Senate, the Federal Register,
CourtListener, OpenFEC, Open States, Google Civic Information, the U.S. Census
Geocoder, and OpenStreetMap. Photos come from the @unitedstates project and
Wikimedia Commons. We use no other sources.

These are public data providers whose APIs we call. They are not partners,
sponsors, or affiliates, and their inclusion implies nothing about their view of
CivicView.

Where CivicView combines records in a way the original source does not, that
combination is labeled as our editorial judgment rather than presented as the
source's fact.

## 5. The code is open to inspection

CivicView's source is public at github.com/Jeffreynuez/civicview. Anyone can
read how a page is assembled, how a ballot is validated, and what happens to a
record we cannot verify. A claim on this page that the code contradicts is a
claim you should not accept.

## 6. What CivicView does not do

- We do not score, rank, segment, or target people by political leaning,
  inferred or declared.
- We do not sell placement, and we do not sell the ability to reach a specific
  group of users.
- We do not remove lawful content because a person or organization with
  influence objected to it.
- We do not fabricate. If we do not have a fact, the field is empty or the
  record says the fact is unavailable.

## 7. How content comes down

Content on CivicView is removed only through a defined path: a report filed
against it, reviewed under published rules, or automated detection of a genuine
threat. There is no administrator button that quietly removes something because
it was inconvenient.

This constraint is deliberate and it cuts against the operator's own
convenience, which is the point of writing it down.

## 8. Independence

CivicView, Inc. is a Florida Benefit Corporation with a single founder. It has
accepted no money from any political party, campaign committee, political action
committee, or advocacy organization, and it will not accept money from those
sources in exchange for any treatment described on this page.

CivicView is not a certified B Corporation. Benefit corporation is a legal
status granted by the State of Florida. The two are different and we do not
claim the second.

## 9. If you think we got something wrong

Errors in public records are common and CivicView inherits them. If a record on
this platform is wrong, report it and we will trace it to the source, correct
what is ours to correct, and say which part came from upstream.

If you believe this policy was violated, say so in writing. Where the answer is
general enough to matter to other people, the answer gets published.

## 10. Changes

This page is versioned. Material changes are dated and the previous version
remains readable.

Last updated: [DATE ON PUBLICATION]

---

## Notes for Jeffrey, remove before publishing

**Verify before this goes live:**

1. **Section 8, the funding sentence.** I wrote that CivicView has accepted no
   money from any party, campaign, PAC, or advocacy organization. I believe that
   is true because you have self-funded, but you are the only person who can
   confirm it. If any of it is not exactly true, cut the sentence rather than
   soften it. A funding claim that turns out to have an exception is worse than
   no funding claim.

2. **Section 2, the paid tier sentence.** This states the post July 28 reality,
   poll creation only. It will contradict the Microsoft Store listing until that
   listing is fixed, and it will contradict `HelpBuildThisView.js:217` and
   `docs/indiegogo_draft.md` until README task #113 lands. Publishing this page
   before those are fixed creates a visible inconsistency on exactly the topic
   where you cannot afford one. Fix them first, or publish this page and treat
   it as the forcing function.

3. **Section 7.** This is your own rule, quoted back: reports plus threat
   detection are the only removal paths. Before publishing, confirm the
   automated threat detection is described accurately. If it is not built yet,
   change "automated detection of a genuine threat" to something that describes
   what exists today. Do not describe a planned system in the present tense.

4. **Section 1.** "There is no application we approve by judgment" is a strong
   claim. Confirm there is no manual approval step anywhere in the rep or
   candidate onboarding flow. If there is one, describe it rather than deny it.

**One thing this page cannot do.** It is worth being clear about the limit.
A published neutrality policy is the right thing to have and it will help you
in ordinary disputes. It will not protect you from a determined bad-faith
attack. ERIC was a nonpartisan interstate compact run by state election
officials, with published rules, and nine member states withdrew between January
2022 and October 2023 after a run of articles about its funding history. Several
officials who withdrew said publicly that the tool worked. Virginia, which left
in 2023, did not resume membership until April 30, 2026. CTCL was cleared by
courts and regulators and twenty-nine states restricted or banned private
election funding anyway. The correction, when it comes, arrives late and does not
restore the position.

So publish this because it is true and because you want it to be your own
standing answer. Do not publish it believing it is armor.
