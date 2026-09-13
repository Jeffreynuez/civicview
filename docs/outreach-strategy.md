# CivicView outreach strategy

**Drafted 2026-09-13. Strategy only. No outreach copy, no target list, nothing sent.**

This memo answers four questions: who the realistic audiences are, what is actually
achievable, what the ask is for each tier, and in what order to climb. It is written
to be argued with. Where the research contradicts an assumption, including one of
mine and one of yours, it says so.

Everything factual below was verified against live sources in September 2026. Where
something could not be verified, it is marked.

---

## 1. The finding that changes the plan

**U.S. House rules prohibit what "get a politician to publicly recognize CivicView"
literally asks for.**

The House Communications Standards Manual (December 2025) states, under Political and
Personal Material: *"No endorsement or promotion of non-governmental companies,
products, or services, including charitable organizations."* Under Hyperlinks: *"Hyperlinks should only link to official government websites and
information relevant to official business."*

That last one is less absolute than it first reads, and the softening cuts in your favor,
so quote it in full or not at all. The same section also says: *"Other non-advertisement
digital communications may link to non-government pages for the purposes of providing
statistical sources, or otherwise relevant information related to the conduct of official
business."* An office citing CivicView as a statistical source is a different act from an
office promoting it, and the manual treats them differently.

The Members' Congressional Handbook (June 25, 2026 edition), **General Rule 8**, is the
same: *"Official resources may not be used to advertise for any private individual, firm,
charity, or corporation, or imply in any manner that the government endorses or favors any
specific commercial product, commodity, or service."*

House Ethics Committee guidance on outside entities repeats it, and the Senate side
explicitly bars official letterhead for "commercial endorsement letters."

This is not a norm or a tendency. It is written down in four places. A congressional
office cannot tweet from its official account that CivicView is good, cannot link to it
from the official site, and cannot put it on letterhead. I **found no examples of a sitting member of Congress publicly endorsing a third-party
civic tool**, which is what you would expect given the rule. That is an absence of evidence
from a few hours of searching, not proof that none exists, so do not repeat it as a
finding.

So for this one tier, the ask has to change, and this is me pushing back on the
"recognition only" answer you gave. Recognition is the right ask for every other
audience. For elected officials it is the *hardest* ask and the only one that is
rule-constrained. **Adoption is the easier ask, not the harder one.**

"Claim your page and post to your constituents" is a member using a communication
channel, which I read as the same category as having a Facebook page or an X account,
something every office already does. The member is not saying the product is good, they
are using it. "Say something nice about CivicView publicly" is an endorsement and is off
the table through official channels.

**Flagging this clearly: the paragraph above is my reading, not a sourced conclusion, and
the whole Tier E recommendation rests on it.** A member's office directing constituents to
a page on a for-profit platform raises official-resources questions that I cannot resolve
from the published rules. The only way to settle it is a Committee on House Administration
or Ethics Committee advisory opinion, and offices request those routinely. If an office
ever engages, let their counsel make the call rather than asserting it yourself.

Keep recognition as the ask for tiers A through D. Flip the political tier to adoption.

### The narrow openings that do exist

- **Certificates of recognition.** House offices may use official funds to recognize "a
  person who has achieved some public distinction," and this is routine. Constraints:
  the recipient generally must live in the district, offices must treat all constituents
  equally, and no partisan content. Senate offices may not use official funds for these
  at all. This recognizes *you*, a constituent who built something, not the product. That
  distinction is what makes it permissible, and it is also what makes it genuinely
  citable.
- **Campaign or personal accounts** sit outside the official-resources rules, but carry
  political risk for the member and no upside for them at current scale.
- **Honorary roles on an outside organization's own letterhead** are permitted where the
  member holds an actual or honorary position. The Ethics Manual warns against becoming
  "too closely affiliated with a particular enterprise." This path is built for
  charities and honorary boards, not for a for-profit benefit corporation with no users.
  Treat as theoretical.

---

## 2. The honest baseline

### Your numbers, from the live API today

13 citizen accounts, of which 12 are demo and 1 is verified. 1 rep, 1 candidate. 14
posts, 7 polls, 16 poll votes, 12 comments, 30 tracked items. Two signups in the past
eight weeks. Google Play installs were 2 as of mid-July.

This is not a number you lead with, and it is also not a number you hide. Every framing
rule in section 7 exists to keep you from being caught splitting that difference badly.

### The problem nobody has told you about yet

Matt Stempeck writes the quarterly column on the Civic Tech Field Guide, the largest
directory in this field at 12,578+ entries. The Guide is a project of Superbloom with
distributed curation, and Stempeck is Director of Democracy and Technology at the Evens
Foundation. In the Spring 2026 National Civic Review (Vol. 115 No. 1, published April 29,
2026, covering January to March), he wrote, verbatim: *"Fully one third of the legislation
trackers we've found over the past ten years were launched in the past 15 months."* He
described vibe-coded civic apps, specifically AI-built legislation trackers running on
Congress.gov open data, as **a clear trend** in the first months of 2026.

That is your category, described by the person who writes the field directory's own
quarterly column, as a flood.

The practical consequence: a stranger's first pattern-match on "solo founder, AI
assistance, congressional data, civic engagement app" will be *another one of those*.
Every asset you build has to defeat that pattern-match in the first two sentences, and
a user count cannot do it because yours is small. Only two things can: the breadth of
real data, and the integrity engineering.

### What actually differentiates you, which I think you undervalue

You have five artifacts that almost nobody in that flood has. All five are stories about
catching yourself being wrong and fixing it in public, which is the rarest credential in
civic data and the exact opposite of the vibe-coded pattern.

1. **The ballot guard.** You encoded a structural invariant, a general-election ballot
   holds at most one nominee per major party, as a data-quality check. It caught 24 of
   your own 35 Florida races, including FL-1 showing nine Republicans running against
   each other. The app now refuses to present those as a ballot. Deliberately structural
   rather than a freshness check, so it cannot be satisfied by a stale file passing
   review and needs no maintenance to stay correct.
2. **The sourcing audit.** Google Play rejected you twice under Misleading Claims. The
   fix was to stop hedging and publish an exhaustive, definitive source list ending "we
   use no other sources," after auditing the entire backend to make it true. Describe it
   as exactly that and no more: a policy reviewer rejected the listing twice and the list
   was rebuilt to satisfy them. Do not call it adversarial review or third-party
   verification, because a journalist will correctly point out that an app-store policy
   loop is not an audit. The plain version is strong enough.
3. **The download-consent rule.** One bad citation link led to finding 173 Mississippi
   legislators with a raw XML file and 120 Vermont legislators with a district map PDF
   sitting in a "website" field. All 293 were relocated, and links now ask before
   downloading, because a citation that ambushes the reader teaches them not to click
   the next one.
4. **Refusing to fabricate.** Skeleton candidate records containing only FEC facts
   rather than invented detail. Wikimedia portrait matching that validated against the
   article and resolved only 7 of 20, with zero false positives, because a stranger's
   face is worse than initials.
5. **The Donalds correction.** A hand-typed "$67.0M" with no committee ID behind it. You
   found the real structure, discovered Florida publishes no candidate-to-committee
   link, and labeled the combined total as your own editorial join rather than
   presenting it as the state's fact.

Every one of these is a better opening line than anything about the product's features.

---

## 3. Audience map, ranked by reachability against value

Five tiers. Ranked by reachability first, because at your stage a cheap yes that
compounds beats an expensive maybe.

### Tier A. Civic-tech practitioners. Highest reachability. Compounding value.

The people who build and curate this field. Small, reachable, and they are the referral
layer into every other tier.

Why this is the right first rung and not a consolation prize: **this is the only
audience that evaluates the engineering rather than the user count.** Your zero-users
problem costs you least here, and your integrity artifacts are worth most here. The
curator of the Field Guide, the host of GovFresh, and the director of the Alliance of
Civic Technologists are three people, and they collectively touch most of the surfaces
in Tier B.

Reachability is unusually good right now, and one item is time-critical:

- **CityCamp Gainesville, Sunday September 20, 2026, 10am to 6pm.** Seven days from
  today, in Gainesville, roughly two hours from you. Co-organized by Florida Community
  Innovation, QueerCoded at UF, and the Alliance of Civic Technologists. It is an unconference, so attendees propose
  sessions and participants vote on what runs. Registration is an open Google Form, and
  session proposals go to city.camp@floridainnovation.org after registering. This is
  the single most actionable item in this memo and it has a date.
- **ACT Congress 2026, Orlando, hosted by Florida Community Innovation.** The Alliance
  of Civic Technologists' first in-person annual conference, in your city, run by the
  same people as CityCamp Gainesville. Dates and registration were still being
  finalized as of their July newsletter. There will be a cost. Relationships built at
  Gainesville feed directly into this.
- **GovFresh office hours.** Luke Fretwell, Thursdays 12:00 to 12:30pm Pacific, Zoom,
  free, described as "open discussion, ask me anything." No gatekeeper, no pitch, no
  application. Fretwell also publishes a "Demos" format and is involved in the Civic
  Tech Chat podcast.
- **Civic Tech Field Guide listing.** Free self-submission. Near-certain acceptance,
  and for that reason low citable weight on its own. Worth doing as table stakes, not
  as a win.
- **Alliance of Civic Technologists newsletter.** Their July 2026 newsletter contains
  an explicit standing invitation: "Does your local civic tech organization have a
  story to tell? Want to be featured in our next newsletter? Reach out to us." That is
  an open door stated in their own words.

Note on ACT: it is the actual successor to the Code for America Brigade network, which
dissolved when the MOU expired June 30, 2023. Referring to "Code for America Brigades"
in 2026 signals you are three years out of date.

### Tier B. Trade press and democracy publications. High reachability. High value.

This is the tier that produces the **citable artifact**, which is the thing that makes
every higher tier possible. Your instinct about building something citable before going
up was right, and this is where it gets built.

The important finding: **GovTech demonstrably covers very small projects.** A verified
example from their civic-tech tag is an interactive cemetery map in Racine, Wisconsin.
That is a considerably lower bar than a 50-state civic platform. Route Fifty runs a two-person editorial desk, which
cuts both ways, less competition for attention but very little capacity.

Two outlets have explicitly published open submission paths, which is categorically
different from cold pitching:

- **The Fulcrum.** Explicitly nonpartisan and cross-partisan democracy coverage,
  published by the Bridge Alliance Education Fund. Two published pitch addresses, one
  for news and one for opinion, and they state they welcome pitches from perspectives
  they are not currently representing. They prohibit candidate endorsement and practice
  solutions journalism. **Given that non-partisanship is existential for you, this is
  the best ideological fit of any outlet found.**
- **Democracy Notes.** A weekly Substack curating the U.S. democracy field, with an
  explicit open invitation to send suggestions. The National Civic Review republishes
  quarterly roundups of it, giving a second surface. Its self-reported subscriber count
  could not be independently verified.
- **Tech Policy Press** accepts completed drafts rather than pitches, 800 to 1,500
  words, does not pay, and explicitly rejects anything substantially composed by
  generative AI while requiring disclosure of AI-assisted drafting. Read that rule
  carefully before submitting anything, given how CivicView was built. Honesty here is
  both required and, I would argue, the more interesting story anyway.

Honest odds, from real data, with the dates attached because they matter: journalist pitch
reply rates measured across roughly 500,000 pitches ran at **2.91% in Q1 2023**, and a
separate 400,000-pitch dataset gives **3.43% in Q1 2024**. Both are Propel Media Barometer
data and both are now stale. A 2026 survey of about 900 reporters found **54% rarely
respond** to pitches; a 2024 survey found 49% "seldom or never" responded. The wording
differs between the two, so treat that as two separate data points rather than a five-point
trend. Roughly half of journalists block people who follow up aggressively.

General cold-email baselines, for calibration: 8.5% reply across 12 million outreach emails
in one large study, 3.43% platform average in another. One follow-up raises replies
substantially, and small lists beat large ones, with under 50 contacts outperforming 1,000
plus by roughly three to one. **At 3% to 8%, two hundred well-personalized emails yields
perhaps six to seventeen replies, most of them polite declines.**

### Tier C. Academics. Moderate reachability. High value. Slow.

The ask here is not "look at my product." Academics do not respond to products. They
respond to interesting problems and to data.

**Your ballot guard is a publishable methods note.** A structural invariant used as a
data-quality check on election rosters, which caught 24 of 35 races in a live system
before any user saw them, is a real contribution to a real problem that the election-data
field has. That is a conversation an academic will have with a stranger. "Please look at
my app" is not.

Most relevant centers found: the **Allen Lab for Democracy Renovation** at Harvard's Ash
Center, where technology and democracy is one workstream, and which in 2026 published
research on how municipalities use digital tools for civic engagement and convened a Voter
Experience Summit. Get that name exactly right, because an email to an organization that
misnames it is the one failure this tier cannot absorb. Also: the Burnes
Center at Northeastern, whose Reboot Democracy blog publishes verified outside
contributors; MIT's Election Data and Science Lab, which functions as a data clearinghouse
with an advisory board of election officials; and SNF Agora at Johns Hopkins, which has
visiting fellow and faculty affiliate paths and named a new director in July 2026.

One correction worth carrying: the Ash Center's Innovations in American Government Award
is a past program, not an active one. And the Stanford Cyber Policy Center was archived
in September 2025, its work continuing as the Tech Impact and Policy Center with a
social-media and trust-and-safety focus that does not match you.

### Tier D. Good-government and civic organizations. Moderate on both axes. Balance-critical.

This is the tier where the non-partisanship constraint does the most work, because this
is the tier that has a political valence at all.

Start with organizations that are **non-partisan by construction**, not by claim:

- **Braver Network**, the organizational network of Braver Angels. Free, open, joined
  via a form, no required meetings, hundreds of member organizations in a public
  directory. Braver Angels maintains deliberate red and blue parity in its own structure.
  For a project whose non-partisanship is existential, **membership in a visibly balanced
  network is itself the credential**, which makes this the highest-value item in the tier.
- **National Institute for Civil Discourse**, co-chaired by Tom Daschle and Christine
  Todd Whitman, with a membership program that self-reports 26% Republican, 45%
  independent, 24% Democrat. Note it has moved off the University of Arizona domain;
  using the old .edu address will make you look stale.
- **NCDD**, which has a public blog submission path and a resource directory.
- **Bipartisan Policy Center** and **Business for America**, both genuinely centrist,
  both active in 2026 on congressional modernization and civic engagement respectively.

Only after those, and only in matched pairs, approach valenced organizations. See
section 6.

Two structural realities to accept rather than fight. First, **every membership-gated
official body restricts eligibility to government offices or communities, not tools**:
NASS, NASED, NCSL, the Congressional Management Foundation's Democracy Awards, and the
National Civic League's All-America City Award. NASS partnership criteria go further and
limit partnerships to "non-partisan, non-profit and non-issue advocacy groups," which a
Florida benefit corporation is not. Second, the Election Assistance Commission, which
would historically be the neutral federal validator here, **currently has zero
commissioners**, all four seats vacant since July 2026. It cannot confer recognition
right now.

### Tier E. Elected officials and candidates. Lowest reachability for recognition.

Two corrections to the intuitive model.

**The "smaller office means better odds" assumption is backwards.** The audit-study
literature, which measures real emails sent to real officials, is consistent:

| Officials | Sample | Ask | Response rate |
|---|---|---|---|
| State legislators, 44 states | 4,859 | Voter registration info | 56.5% |
| State legislators, in-district | 5,593 | Help with benefits | 55.5% |
| State legislators, out-of-district | same | same | **28.9%** |
| NC state legislators | 170 | Info request | 64.7% |
| NC state legislators | 170 | **Meeting about a bill** | **41.2%** |
| **U.S. mayors** | **3,433** | Trivial info request | **9.8%** |
| Local municipal officials | ~2,165 | Survey and audit | ~11% |

A meta-analysis pooling 41 experiments found political elites respond about 53% of the
time, and **elected officials are 18 points less responsive than non-elected
bureaucrats**.

Read the table carefully. Mayors are the worst tier at 9.8%, not the best. **State
legislators are the only genuinely responsive tier.** And note the ask-type penalty in
the North Carolina rows: identical officials, identical study, and changing the ask from
"send me information" to "meet with me about something" dropped the response rate from
64.7% to 41.2%. Your ask is closer to the second kind.

Also note the 26.6-point penalty for being out of district. **You are a constituent of
exactly one U.S. House district, two U.S. senators, one state senate district, and one
state house district.** Those five offices are the only ones where you get the
in-district rate. Everywhere else you are the 28.9% case at best, and for a product
pitch rather than a service request, considerably worse.

**On non-constituent congressional mail specifically:** legislative correspondents
automatically pull out-of-district messages. One former staffer put it plainly: "If they
didn't live in my boss' district, their correspondence didn't make it past me." House
offices receive tens of thousands of emails a year and the large majority of incoming mail
is organizational form email. I have seen specific figures for both, but they trace back
to secondary syntheses of 2020 Congressional Management Foundation data rather than to a
primary source, so treat the magnitude as reliable and the exact numbers as not.

**Candidates are the better-fit adopter, and the timing is genuinely awkward.** A
challenger with no communications staff has every incentive to claim a free page that
gives them equal footing with an incumbent, and your candidate pages were built for
exactly that. But their motivation peaks in precisely the window when approaching them is
most reputationally dangerous for a non-partisan tool. See section 5 for how I would
resolve that, which is: not before November 3.

**The one genuinely open federal door.** The Congressional Hackathon is a public event at
the Capitol Visitor Center, co-hosted by the Speaker, the Democratic Leader, and the Chief
Administrative Officer. The seventh edition was September 17, 2025, and outside developers
demonstrably do present: past lightning rounds have included independent projects, civic
tech groups, academics, and high-school students. The Congressional Data Task Force holds
quarterly meetings open to stakeholders and the public, with the next on **December 3,
2026, 2pm to 4pm Eastern**. I could not verify whether outside developers may present at
Task Force meetings or only attend.

There is also a **Congress.gov Public Forum on September 24, 2026**, eleven days out, on
the Legislative Branch Innovation Hub calendar. Lower ceiling than CityCamp because it is
a forum rather than a room you can work, and it falls four days after CityCamp rather than
before it, but it is free and it is federal.

---

## 4. The ask, per tier

You said you had not thought this through clearly. Here is the version I would defend.
The principle throughout: **make the yes cheap, specific, and free of reputational risk
for the person saying it.** Vague asks get ignored, and expensive asks get declined.

| Tier | The ask | Why this one is cheap to say yes to |
|---|---|---|
| A. Practitioners | "Can I show you the ballot guard and tell you what it caught?" | Costs 20 minutes, no public commitment, and it is a genuinely interesting engineering problem. |
| B. Press | "Here is a story about a data-integrity check that caught 24 of my own 35 races." | You are handing over a finished story, not requesting coverage. The subject is the method, not the product. |
| C. Academics | "Here is the invariant, here is what it caught, is this interesting or already known?" | Asks for their judgment, not their endorsement. Academics answer questions about methods from strangers. |
| D. Organizations | "Can CivicView be listed in your directory / can I join the network?" | A directory listing is not an endorsement, which is exactly why it is grantable. |
| E. Officials | **"Claim your page."** Not "endorse us." | It is a communication channel, not a product endorsement, so it does not hit the ethics rule. |

Three notes on the table.

**"Join the platform" means something different to a nonprofit than to a member of
Congress, which is what you suspected.** To a nonprofit it means a directory listing or
a newsletter mention, which costs them nothing. To a member of Congress it cannot mean
endorsement at all, so it has to mean using the page as a channel. To an academic it
means neither, it means a conversation about method.

**The recognition ladder is a ratchet.** Each yes becomes the citation that makes the
next ask credible. A Field Guide listing is weak alone but it makes the ACT newsletter
mention easier. The newsletter makes the GovTech pitch easier. A GovTech piece makes the
academic email easier, and an academic who has engaged makes a state legislator's staff
take the email seriously. **Do not skip rungs.** The reason cold-emailing a senator's
office now fails is not only volume, it is that there is nothing in the email that
survives a thirty-second credibility check.

**Never make the first ask a favor.** Every cheap yes above is framed as either offering
something or requesting judgment. None of them is "please help me."

---

## 5. The ladder and the calendar

Your sequencing instinct was right and one piece of the election work is itself the
credibility asset.

### Phase 0. Now through September 30. No gate.

Practitioner tier only. These audiences do not check a Florida ballot before deciding
whether you are serious, so the unresolved rosters cost you nothing here.

- CityCamp Gainesville, September 20. Seven days out. Register, and consider proposing
  a session, since the unconference format means sessions come from attendees.
- Field Guide listing. Table stakes.
- GovFresh office hours. Any Thursday.
- ACT newsletter, using their own standing invitation.

### Phase 1. October. Build the citable artifact.

Write the integrity piece. The ballot guard is the subject, the method is the story, and
the product is the setting rather than the point. Target The Fulcrum first on ideological
fit, Democracy Notes for curation reach, Tech Policy Press if you are comfortable with
their AI-disclosure rule, which you should be, because disclosing it honestly is a better
story than hiding it.

Tasks #110 and #111 run in parallel here. They are the gate for Phase 2, not for Phase 1.

### Phase 2. November 4 onward. Gated on #110 and #111 being done.

The high-profile push. Opening line becomes "here is how the data held up through a live
election" instead of "please look at my app." Trade press, then academics, then Tier D
organizations, then your own five in-district offices.

Two independent reasons this is the right window and not a delay. The three weeks before
a general election is the worst period in the cycle to cold-contact a journalist,
election official, or congressional office, and a non-partisan civic tool arriving
mid-election reads as trying to influence one. And the week after produces
retrospectives, next-year planning, and open foundation cycles.

### Phase 3. 2027 cycle.

Candidate outreach, under a published symmetry policy. ACT Congress in Orlando when
dates are announced. The Congressional Data Task Force meeting on December 3, 2026 sits
between Phase 2 and Phase 3 and is worth attending regardless.

### The gate, stated plainly

**Do not approach Tier B, C, D, or E while 23 of 35 Florida races display "nominees not
confirmed."** Anyone worth reaching will look up something they personally know, and for
a Florida founder pitching a Florida-deepest product, that is a Florida race. The guard
is honest, and to a stranger with no reason to be generous it reads as abandoned rather
than as careful.

After #110, the identical fact reads the opposite way: a system that refused to show a
ballot it could not prove, and then proved it.

---

## 6. Non-partisan guardrails

These are hard rules for every target list and every piece of copy. A tactic that works
better by leaning one way gets rejected, and the reason is in each rule.

1. **Pair by function, not by vibe, and drop any category that cannot be paired.** If a
   left-leaning organization goes on the list, a right-leaning counterpart **doing the same
   kind of work at a comparable scale** goes on in the same pass, or neither does. Pairing
   on ideology alone produces mismatches that are worse than an empty row, because a
   lopsided pair advertises that you were reaching.

   Defensible pairs from the verified research:
   - **Governance and congressional-capacity think tanks:** Brennan Center with R Street's
     Governance program and its Restoring Congress work. The prominence is uneven, Brennan
     is much the larger institution, but this is the field's conventional pairing and reads
     as normal.
   - **Technology-and-democracy policy shops:** Foundation for American Innovation on the
     right with New America's Public Interest Technology program on the left. FAI belongs
     here on its own merits rather than as a counterweight to an advocacy group, since its
     entire remit is technology and American self-government.
   - **Institution-focused research centers:** Hoover's Center for Revitalizing American
     Institutions, which builds its own public civic tools, with SNF Agora at Johns Hopkins
     or UChicago's Center for Effective Government.

   Two pairings I considered and rejected, so nobody reconstructs them later. **Protect
   Democracy with FAI fails on function:** one is a litigation and advocacy organization
   built around anti-authoritarianism, the other is a tech-policy think tank, and they do
   not meet in any actual debate. **Common Cause with AEI's Daniel Stid fails on scale:**
   that sets a 1.5-million-member grassroots organization with state chapters against a
   single scholar's writing on civic association, and "AEI's governance work" is not even a
   named program there.

   **Mass-membership good-government advocacy has no verified right-of-center counterpart
   in this research, so the whole category comes off the list.** That means no Common Cause
   and no League of Women Voters at the national level, not because there is anything wrong
   with them, but because putting them on unpaired tilts the footprint and padding the
   other column with organizations that did not survive verification is worse than a short
   list. The center-left column is genuinely larger and better funded than the right
   column, so **balance takes deliberate effort in one direction only**, and the honest
   response to a missing counterpart is subtraction, not invention.

2. **Apply the swap test to every sentence.** Replace every proper noun with the other
   party's equivalent. If the sentence now reads as advocacy, rewrite it. This is
   mechanical and it catches almost everything.

3. **Never use a named politician as the example of what the platform reveals.** Use
   structural examples: a procedure, a data-quality failure, a sourcing problem. "Look at
   what this member voted for" is the single fastest way to become a partisan tool in a
   reader's mind, regardless of which member you pick.

4. **Present the FL-11 and Donalds examples as method, never as subject.** Both are
   politically loaded. The story in each is what your system did, not what the candidate
   did.

5. **Separate who you approach from what you accept, because rules 1 and 5 otherwise
   contradict each other.** Rule 1 governs the *outreach footprint*: approach valenced
   organizations in pairs so that the set of doors you knock on is balanced. Rule 5 governs
   *what you say yes to*: from an organization with a political valence, accept a neutral
   directory listing or a factual mention, and decline co-branded advocacy, a joint
   campaign, a quote used as ammunition, or any amplification that positions CivicView
   inside their argument. The payload from a valenced organization is a listing and a
   relationship, not a megaphone, and that is worth having. A left-leaning organization
   campaigning on your behalf reads as alignment, and so does a right-leaning one. This
   will feel like turning down free help. It is the whole product.

6. **Refuse any placement that requires framing CivicView as a corrective to one side.**
   Some outlets will only be interested on those terms. The answer is no, and the reason
   is that the framing outlives the placement.

7. **If candidate outreach ever happens, it is simultaneous and identical to every
   candidate in a race, under a written published policy, or it does not happen.** No
   exceptions for who responds first or who seems friendlier.

---

## 7. No-overclaiming rules

A staffer, a journalist, or an academic will check. One padded number ends the effort,
which you already know. These are the specific traps.

**Never state a user count.** Not in any form, not "early users," not "a growing
community." Say pre-launch or early-stage and move to what is actually built.

**Never call demo accounts users.** Twelve of your thirteen citizen accounts are demo
accounts. They are demo accounts in every sentence.

**Never imply a team, funding, backing, or advisors.** Solo and self-funded is accurate
and it is the more interesting claim. The research is unambiguous that the founder story
is more newsworthy than the product at this stage.

**Never say "partnered with" about a data source.** Congress.gov, GovTrack, Open States,
and CourtListener are APIs you call. Calling that a partnership is exactly the kind of
claim that gets checked and that destroys everything around it.

**Do not claim Microsoft Store availability.** README row #108 has said "in
certification" since July 25 and nobody has verified it since. Until someone checks, the
distribution claim is web, desktop PWA, and Google Play.

**Do not say "launched" without the qualifier.** Verified accounts and paid features are
built but inert pending ID.me. The accurate sentence is that it is live and in
demo-preview, with verification pending.

**Do not conflate "Florida Benefit Corporation" with "Certified B Corp."** These are
completely different things. A benefit corporation is a legal entity status conferred by
a state. A Certified B Corp is a certification issued by B Lab, a private nonprofit,
after an assessment. You are the first and not the second. This conflation is common,
it is an overclaim, and anyone in the impact space will catch it instantly.

**Use the Play Store source list as your standard sourcing language everywhere.** It is
exhaustive, it ends with "we use no other sources," and it has already survived
adversarial review by Google twice. Reusing language that has been attacked and held is
strictly safer than writing new language that has not.

**Where the honest number is small, give the honest number and change the subject to
what is verifiable.** "Two signups in the last eight weeks, and all 50 states of
legislator data with every source enumerated" is a fine sentence. The second half is
checkable and impressive, and volunteering the first half is what makes the second half
believable.

---

## 8. What I would do in the next seven days

Nothing in this list is outreach. It is preparation plus one calendar decision.

1. **Decide on CityCamp Gainesville, September 20.** It is seven days out, in Florida,
   run by the people who are bringing ACT Congress to Orlando. In-person contact with
   this specific community is worth more than any volume of cold email, and the research
   is clear that none of the comparable tools got traction by emailing officials.
2. **Submit the Field Guide listing.** Free, fast, table stakes.
3. **Draft the integrity piece.** Not for sending. The act of writing it will tell you
   whether the story holds up, and it is the asset the whole Phase 2 ladder depends on.
4. **Keep #110 and #111 moving.** They are the gate.
5. **Resolve the repo-visibility contradiction.** Your project instructions say the
   GitHub repo is private; CLAUDE.md says it was made public before the Indiegogo push
   and that you corrected the stale note on 2026-06-10. **If it is public, it is one of
   your strongest assets**, because "solo-built and open to inspection" is directly
   checkable and defeats the vibe-coded pattern-match. If it is private, several claims
   in the integrity story become unverifiable to a reader.

---

## 9. What the comparables actually did, since it should change your expectations

Nine comparable tools were traced. **Not one got its first break by contacting elected
officials.**

- **GovTrack** (Josh Tauberer, solo, apartment, launched September 2004) won a Technorati
  developers contest that ran in late 2004 and was awarded in January 2005, which
  coincided with a New York Times feature on January 27, 2005, and then won on SEO
  and by becoming the data layer under OpenCongress, MAPLight, and Sunlight's APIs. His
  own retrospective calls his founding theory that transparency would change voting
  behavior "grossly naive," and he repositioned toward civic education.
- **Open States** got momentum from PyCon 2009 and 132 contributors writing scrapers.
- **Democracy.io** came out of a two-day GitHub sprint where Sunlight, EFF, and about 150
  civic hackers reverse-engineered every House contact form.
- **Vote Smart** and **OpenSecrets** both launched with borrowed elite credibility, a
  board including Carter, Ford, Goldwater, McGovern, and Proxmire in one case, and two
  sitting senators as founders in the other.
- **Ballotpedia** got there with 50+ paid editorial staff and distribution deals with
  Amazon Alexa, ABC News, and Decision Desk HQ.

And the two cautionary tales matter more than the successes. **Brigade** raised $9.3M
with Sean Parker behind it, reached 250,000 ballot-guide users in 2016, and wound down in
2019, with its engineering team acqui-hired by Pinterest and its technology and data sold
to Countable. CEO Matt Mahan's words: "after two election cycles Brigade had not achieved
the user scale we know is required to fundamentally transform our politics." **Countable** got the New York
Times, Wired, GQ, and TechCrunch, claimed 35 million civic actions, and then folded its
consumer app into Causes.com in 2020 and repositioned the Countable brand as a B2B
enterprise arm. Causes is still live, so the accurate statement is that the
Countable-branded consumer product was absorbed, not that it died. **Press coverage was
not sufficient for either of them.**

The honest read: the durable ones became infrastructure that other people's products
depended on, rather than destinations users had to be told about. That is worth thinking
about separately from this campaign, because it suggests a different and possibly
stronger long game than recognition, which is that your 50-state data and your integrity
checks might be more valuable to others as something they can build on than as something
they are asked to admire.

---

## 10. What could not be verified

- Hewlett Foundation's unsolicited-proposal policy. Their grantseeker pages are blocked
  by robots.txt.
- Whether the Knight Election Hub exists for the 2026 cycle. The site reads as a 2024
  archive with no announced continuation.
- Whether outside developers may present at Congressional Data Task Force meetings, or
  only attend.
- ACT Congress 2026 dates, venue, and cost. Not finalized as of their July newsletter.
- Whether Hoover's RAI research seed grants are open to non-Stanford applicants.
- Democracy Notes' actual subscriber count.
- Current status of the Microsoft Store submission, which is a CivicView-side question,
  not a research one.
- Exact congressional inbound-mail volumes. The commonly cited figures trace to secondary
  syntheses of 2020 Congressional Management Foundation data rather than to a primary
  source, so section 3 states the magnitude and not the numbers.
- One widely repeated statistic, that journalists receive 5.8 pitches a day against 3.2 in
  2020, could not be substantiated against the underlying survey and was removed from an
  earlier draft of this memo rather than shipped with a hedge.
- Whether the Costa meta-analysis's "18%" gap between elected officials and non-elected
  bureaucrats means percentage points or a relative effect. The paper's wording is
  ambiguous. Percentage points is the standard reading and is what section 3 uses, but it
  is an interpretation.
- Whether GovTech has covered a second very small project beyond the verified Racine,
  Wisconsin cemetery-map story. A second example in an earlier draft turned out to be
  misattributed and was cut.

Two organizations did not survive verification and should not be used to balance a
target list: **Stand Together's democracy portfolio**, where the most recent
substantive announcement found was from October 2020, and **Civic Right**, where no
2026 activity was found and its rumored R Street affiliation could not be confirmed.


---

## Appendix. How this memo was checked

Every organization, date, quote and statistic here was researched against live sources and
then independently fact-checked in a second adversarial pass whose instruction was to find
errors rather than confirm them. That pass caught real mistakes, which are corrected above:
a wrong rule number in the Congressional Handbook, a wrong name for the Harvard lab, an
overstated claim about Countable, a truncated quotation that misrepresented the hyperlink
rule in a way that worked against you, two political pairings that did not hold up, and an
unsupported pitch-volume statistic. Anything that survived both passes carries a source.
Anything that did not is in section 10 or was removed.

The reason for saying so: this memo asks you to hold outreach to a standard where one
padded number ends the effort. It would be indefensible to write that in a document that
had not been held to the same standard.
