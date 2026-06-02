# PRD — Semantic Discovery (Pinecone) — post-launch

**Status:** Draft for review · **Owner:** Jeffrey De La Nuez · **Drafted:** 2026-06-01 (Claude Opus 4.8)
**Related:** Task #91 (Vercel AI Gateway — cost/observability), `backend/app/services/ai_service.py`, `backend/app/services/bill_summary_service.py`, `backend/app/routers/ai.py` (existing `/api/ai/filter-*`), `frontend/app/polls/page.js` (AI filter row)

---

## 1. Problem & goals

CivicView's AI today is **single-provider Anthropic (Haiku) + exact-match Postgres caching**: bill CRS summaries + plain-English translations (`bill_summaries`), vote explainers (`vote_explainers`), EO/post summaries, and comment classification. That cache is precise and cheap and should stay as-is.

What it *cannot* do is **semantic** retrieval — "find things that mean the same" rather than "find this exact id." That gap shows up as:
- No "related bills / related legislation" surfacing.
- Search that scales: today's `/api/ai/filter-*` endpoints re-run an LLM over the *currently-loaded set* per request (great for a small feed, not for "search all bills/polls about housing").
- No cross-content discovery (a poll → related bills, a bill → related polls).

**Goal:** add a semantic-discovery layer (vector embeddings + Pinecone) that powers (a) related-content surfacing and (b) scalable semantic search, **without** replacing the Postgres summary cache.

### Explicit non-goal
**Do not** use Pinecone to cache or dedup AI summaries. Summaries are keyed by exact identity (congress/type/number, vote_id) — Postgres exact-match is faster, cheaper, and correct; vector similarity is the wrong tool for an exact cache. The recent summary-quality issue was a data-grounding bug (vote explainer not fed the CRS summary), already fixed — not a missing vector layer.

---

## 2. Scope

**In scope (v1):**
- Embed and index three content types: **bills** (CRS summary + title), **polls** (question + options), **posts** (body).
- **Related content** modules: "Related bills" on a bill/vote surface; "Related polls" on a poll.
- **Semantic search**: a query box that returns the most relevant bills/polls/posts across the whole corpus (not just the loaded page).

**Out of scope (v1):** per-user personalization/recommendations, embedding comments, multilingual embedding tuning, RAG-rewriting of summaries.

---

## 3. Why a NEW system (not the cowork memory index)

The Pinecone index used for Cowork dev-session memory (`claude-memory`, the `pinecone-memory` plugin) is **not** the app's store. Production needs its own:
- **Separate index** (proposed name `civicview-content`), isolated from dev memory.
- **Backend Pinecone client** in FastAPI (new dependency + `PINECONE_API_KEY` env var), behind a service abstraction like the existing env-gated services (R2/Postmark/Stripe/IdMe) so it **degrades gracefully** (no key → discovery features hide, app boots fine).
- **An embedding model.** Anthropic does not offer embeddings, so this is a second provider decision:
  - Pinecone-hosted inference (`multilingual-e5-large`, 1024-dim) — fewest moving parts, keeps embeddings inside Pinecone.
  - or a third-party embedder (OpenAI `text-embedding-3-small`, Cohere) — more control, another key/provider.
  - Recommendation: start with Pinecone-hosted inference to avoid a third vendor; revisit if quality warrants.

---

## 4. Architecture

**Ingest / backfill (write path):**
- On create/update of a bill summary, poll, or post, enqueue an embed+upsert to `civicview-content` (record id = `bill:{congress}:{type}:{number}` / `poll:{id}` / `post:{id}`; scalar fields: `kind`, `congress`, `state`, `created_at`; text = the embeddable blob).
- One-time backfill script (`backend/scripts/embed_backfill.py`) for existing rows. Mirror the idempotent pattern of `bill_summary_service` / `reset_summary_cache.py`.
- Keep in sync on edit/delete (delete the vector when content is removed/hidden).

**Query (read path):**
- `GET /api/discovery/related?kind=bill&id=...` → top-k similar of a target kind, filtered by `kind`/recency.
- `GET /api/discovery/search?q=...&kind=bill|poll|post|all` → semantic search; embed the query, vector search, hydrate rows from Postgres, return in score order (same hydrate-then-reorder pattern the Saved/feed code already uses).
- Both fail-soft: on Pinecone error/no-key, return empty + the UI hides the module.

**Frontend:**
- "Related bills/polls" module reusing existing card components (`FeedCard` / bill cards).
- Optional: upgrade the polls AI filter row to offer a true semantic search across the corpus (today it filters the loaded set).

---

## 5. Cost / ops considerations
- Pinecone serverless: pay per read/write unit + storage; the corpus (hundreds–thousands of bills + polls) is small, so cost is low, but it is **non-zero ongoing** and adds a provider + key to rotate.
- Embedding cost: one embed per content create/update + the backfill.
- Latency: query embed + vector search adds ~100–300ms; acceptable for a discovery surface, and reads are cacheable.
- Ops: keep the index in sync (the hardest part) — wire embed/delete into the same code paths that write/hide content; add a reconcile script.

---

## 6. Phasing
1. **Phase 0 — infra:** add the env-gated Pinecone service abstraction + `civicview-content` index + embedding choice. No UI. Verify boot-without-key degrades cleanly.
2. **Phase 1 — bills:** embed + backfill bills; ship "Related bills" + bill semantic search.
3. **Phase 2 — polls/posts:** extend embedding to polls + posts; add cross-content related modules + unified search.
4. **Phase 3 — tuning:** evaluate embedding quality, consider re-ranking, decide on the third-party embedder question.

---

## 7. Open decisions (need Jeffrey's call before build)
- Embedding provider: Pinecone-hosted inference vs OpenAI/Cohere.
- Index name + region (align with the existing AWS us-east-1 serverless setup).
- Whether to route the embedding/AI calls through the Vercel AI Gateway (Task #91) for unified cost/observability — these two AI-infra decisions are best made together.
- Launch gating: this is **post-launch** per the agreed sequencing; confirm it stays behind the GoFundMe-funded infra phase.

---

## 8. Success metrics
- Related-content click-through rate on bill/poll surfaces.
- Semantic-search usage + zero-result rate (lower is better).
- No regressions to AI summary quality/cost (the Postgres cache path is untouched).

---

*Built with Claude Cowork. This spec scopes a post-launch feature; no production infra is added until approved.*
