# Iconography — Lucide (proposed substitution)

CivicLens today hand-rolls inline SVGs. The DESIGN_HANDOFF.md explicitly invites bringing in `lucide-react` (already used in the project's other artifacts) for consistency. We adopt **Lucide** as the canonical set in the design system.

## Web (CDN)

```html
<script src="https://unpkg.com/lucide@latest"></script>
<i data-lucide="bell"></i>
<script>lucide.createIcons();</script>
```

## React (production)

```bash
npm i lucide-react
```

```jsx
import { Bell, Search, Bookmark, ChevronLeft } from 'lucide-react';

<Bell size={14} strokeWidth={2.4} />
```

## Style rules

- 14px icons inside chips and buttons; 18px in the navbar search; 24px for hero/marketing.
- `strokeWidth={2}` default; `2.4` on small icons rendered against navy chrome.
- `stroke="currentColor"` always — color the parent, not the icon.
- Fill is `none` everywhere except active reactions (where the up/down arrow fills with the reaction accent).

## Mapping from existing inline SVGs

| Codebase (hand-rolled)                       | Lucide name      |
|----------------------------------------------|------------------|
| Clock-circle logo (12:08 hands)              | `clock`          |
| Search magnifier                              | `search`         |
| Notification bell                             | `bell`           |
| User-pair (Citizen login)                     | `user`           |
| Subscribe envelope                            | `mail-plus`      |
| Committees columns                            | `landmark`       |
| Bookmark (My Tracked)                         | `bookmark`       |
| Back chevron                                  | `chevron-left`   |
| Comment bubble                                | `message-square` |
| Up-vote / thumbs up                           | `thumbs-up`      |
| Down-vote / thumbs down                       | `thumbs-down`    |
| Ballot box / elections                        | `vote`           |

## Emoji we keep (do not replace with Lucide)

- 🇺🇸 / 📍 / 🎯 / 🏙 — scope chips on polls and the dashboard. The flag is load-bearing for "country" — a generic globe icon doesn't carry the right civic meaning.
- 👍 / 👎 — only inside the dashboard's reactions header where they read as emoji-as-emoji, not as button affordances.
- 🗳 — elections tab + poll-vote stat.
