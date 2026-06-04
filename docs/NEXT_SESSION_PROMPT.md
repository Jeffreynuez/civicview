# CivicView — Next-Session Kickoff Prompt

Paste the block below into a new Cowork session (with the `CivicLens` folder mounted) to pick up exactly where we left off.

---

Continue the CivicView project. Before doing any work, run the standard session start-up, and this time **load every open task into the Progress list**:

1. **Read `CLAUDE.md` top-to-bottom**, including the new "Current state & open work (snapshot 2026-06-03)" section.
2. **Read the README "Pending tasks" table** (the canonical open-tasks list).
3. **Search Pinecone both namespaces** (pinecone-memory plugin): `search-records` on `default` (top_k=5) and `shared` (top_k=3). Start with the query "session handoff open tasks 2026-06-03" to pull the handoff record, and mention any hit ≥ 0.70 before starting.
4. **Recreate EVERY open task into the Cowork Progress widget** via `TaskCreate` — one task per open row in the README Pending table: **#25** (in progress — state photos / other-states judiciary / local officials), **#95** Vote Smart API (blocked on budget, $4,850/yr), **#96** OpenFEC candidate pass for other big states (TX/CA/NY…), **#97** state judiciary for the other 49 states (CourtListener, 5 req/min limit), **#98** full candidate depth incl. minor filers + endorsements (paid Ballotpedia/BallotReady), **#99** local officials — sheriffs/judges/DAs (paid), plus the standing rows **#71** /stats page, **#84** Capacitor mobile, **#90** Benefit Corp amendment, **#91** Vercel AI Gateway, **#93** unify comment rendering, **#94** threat-detection v2, **#26** SPF/DMARC, **#49** threat-detection Phase 1+.
5. **Verify `git status`** for the candidate-data work that may still be uncommitted from the last session: `backend/app/services/fec_service.py`, `backend/app/data/fl/candidates.json`, `backend/app/data/fl/elections.json`. If uncommitted, give me ready commit messages (don't push — I decide pushes).

Then summarize the open backlog and recommend where to start (lead with your recommendation). Likely candidates: **#96** (re-run the OpenFEC federal-candidate + races pass for the next big state — fast, free, the pattern is built in `fec_service.py`), or **#97** (FL-style state-supreme-court wiring for more states).

Reminders (durable hard rules): non-partisan platform — all stated positions factual, sourced, neutral; use **AskUserQuestion** before ambiguous multi-step work with the **recommended option first**; commit locally with detailed bodies + the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer and **let me decide the push**; don't fabricate candidate data (real/sourced or honest skeleton); for large source files use Python/heredoc writes, **not the Edit tool** (it truncates files of a few hundred lines).
