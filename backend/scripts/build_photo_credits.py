# CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""Build backend/app/data/photo_credits.json from the Wikimedia Commons API.

Run from backend/ whenever a Wikimedia photo is added or changed:

    python scripts/build_photo_credits.py            # dry run, prints a summary
    python scripts/build_photo_credits.py --write    # writes the credits file

Why (audit P2): most Wikimedia Commons photos are licensed CC BY or
CC BY-SA, which require the author, the license and a link wherever the
photo is shown. Public-domain photos (most official government
portraits) need none, but we credit them the same way so every photo
has a traceable source. The frontend shows the credit under large
profile photos and lists every photo on /photo-credits.

The script finds every upload.wikimedia.org URL in backend/app/data,
works out the Commons file each one is (thumbnail URLs included), asks
the Commons API for the author and license, and records who the photo
is of. It changes nothing else. tests/test_data_lint.py fails when a
Wikimedia URL in the data has no entry here, so a new photo cannot ship
without its credit.

It also refuses (exit 1, nothing written) when:
  * a photo's Commons title and description do not mention the surname
    of the person it is used for. On 2026-09-25 six congressional
    overrides showed the wrong person: hockey player Mark Messier for
    Rep. Mark Messmer, law professor John Manning for Rep. John Mannion,
    Judge Mark Norris for Rep. Mark Harris, an author photo of Michael
    J. Sullivan for Rep. Michael Rulli, and two that share the member's
    surname (a 1970 photo of Jonathan Peter Jackson for Rep. Jonathan L.
    Jackson, a minister named David Taylor for Rep. David J. Taylor).
    This check catches the first kind only. For the second, look at the
    photo: only a person can tell two Taylors apart.
  * a congress_photo_overrides.json entry shadows an official photo that
    now exists on the @unitedstates image mirror. Overrides are only for
    members the mirror has not added yet; remove them once it has. All
    six wrong photos above were in this situation.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlsplit

import httpx

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "app" / "data"
OUT_PATH = DATA_DIR / "photo_credits.json"
API = "https://commons.wikimedia.org/w/api.php"
LEGISLATORS_URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json"
MIRROR_IMAGE = "https://unitedstates.github.io/images/congress/225x275/{bioguide}.jpg"
SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}
# Wikimedia asks API clients to identify themselves.
USER_AGENT = "CivicViewPhotoCredits/1.0 (https://civicview.app; civicview@civicview.app)"
WIKIMEDIA_RE = re.compile(r"https://upload\.wikimedia\.org/wikipedia/commons/[^\s\"]+")
TAG_RE = re.compile(r"<[^>]+>")


def commons_file_title(url: str) -> str | None:
    """File:Name.jpg for an upload.wikimedia.org URL, thumbnails included.

    Originals: /wikipedia/commons/a/ab/Name.jpg
    Thumbnails: /wikipedia/commons/thumb/a/ab/Name.jpg/250px-Name.jpg
    """
    parts = urlsplit(url).path.split("/")
    try:
        i = parts.index("commons")
    except ValueError:
        return None
    rest = parts[i + 1:]
    if rest and rest[0] == "thumb":
        rest = rest[1:]
    if len(rest) < 3:
        return None
    return "File:" + unquote(rest[2]).replace("_", " ")


def _plain(value: str | None) -> str | None:
    if not value:
        return None
    text = html.unescape(TAG_RE.sub("", value))
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def _surname(name: str) -> str:
    words = [w.strip(".") for w in re.split(r"[\s,]+", name.lower()) if w.strip(".")]
    words = [w for w in words if w not in SUFFIXES]
    return words[-1] if words else ""


def _fold(text: str) -> str:
    import unicodedata
    text = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in text if not unicodedata.combining(ch)).lower()


def _shadowed_overrides(client: httpx.Client) -> list[str]:
    """Override entries whose member now has an official mirror photo."""
    path = DATA_DIR / "federal" / "congress_photo_overrides.json"
    overrides = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    out = []
    for bioguide in overrides:
        if bioguide.startswith("_"):
            continue
        try:
            r = client.get(MIRROR_IMAGE.format(bioguide=bioguide), follow_redirects=True)
        except httpx.HTTPError:
            continue
        if r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"):
            out.append(bioguide)
    return out


def _subjects() -> dict[str, set[str]]:
    """Map each Wikimedia URL in the data to the names of the people shown."""
    by_url: dict[str, set[str]] = {}
    # Names for the bioguide ids in congress_photo_overrides.json, from the
    # same @unitedstates roster the app loads at startup.
    bioguide_names: dict[str, str] = {}
    try:
        roster = httpx.get(LEGISLATORS_URL, headers={"User-Agent": USER_AGENT}, timeout=60).json()
        for rec in roster:
            bid = (rec.get("id") or {}).get("bioguide")
            name = (rec.get("name") or {}).get("official_full")
            if bid and name:
                bioguide_names[bid] = name
    except Exception as e:  # names are a nicety; credits still build
        print(f"WARNING: could not load the legislators roster ({e}); some photos will have no name")

    def walk(node):
        if isinstance(node, dict):
            url = node.get("photo_url")
            if isinstance(url, str) and WIKIMEDIA_RE.fullmatch(url) and node.get("name"):
                by_url.setdefault(url, set()).add(str(node["name"]))
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    for path in sorted(DATA_DIR.rglob("*.json")):
        if path == OUT_PATH:
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        walk(doc)
        if path.name == "congress_photo_overrides.json" and isinstance(doc, dict):
            for bid, url in doc.items():
                if isinstance(url, str) and WIKIMEDIA_RE.fullmatch(url):
                    name = bioguide_names.get(bid)
                    by_url.setdefault(url, set())
                    if name:
                        by_url[url].add(name)
    # Any other Wikimedia URL in the data, even without a name nearby.
    for path in sorted(DATA_DIR.rglob("*.json")):
        if path == OUT_PATH:
            continue
        for url in WIKIMEDIA_RE.findall(path.read_text(encoding="utf-8")):
            by_url.setdefault(url, set())
    return by_url


def _fetch(client: httpx.Client, titles: list[str]) -> dict[str, dict]:
    """Commons imageinfo for up to 50 titles, keyed by the title we asked for."""
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "prop": "imageinfo", "iiprop": "extmetadata|url", "redirects": "1",
        "titles": "|".join(titles),
    }
    for attempt in range(6):
        r = client.get(API, params=params)
        if r.status_code != 429:
            break
        # Rate limited: wait as asked (or back off) and try again.
        wait = int(r.headers.get("retry-after") or 0) or 10 * (attempt + 1)
        print(f"Commons rate limit; waiting {wait}s")
        time.sleep(wait)
    r.raise_for_status()
    q = r.json().get("query", {})
    alias = {}
    for n in q.get("normalized", []):
        alias[n["to"]] = n["from"]
    for rd in q.get("redirects", []):
        alias[rd["to"]] = alias.get(rd["from"], rd["from"])
    out = {}
    for page in q.get("pages", []):
        asked = alias.get(page["title"], page["title"])
        out[asked] = page
    return out


def build() -> tuple[dict, list[str]]:
    subjects = _subjects()
    titles = {url: commons_file_title(url) for url in subjects}
    problems = [f"cannot parse a Commons file name from {u}" for u, t in titles.items() if not t]
    wanted = sorted({t for t in titles.values() if t})
    pages: dict[str, dict] = {}
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30) as client:
        for i in range(0, len(wanted), 20):
            pages.update(_fetch(client, wanted[i:i + 20]))
            time.sleep(3)
        for bioguide in _shadowed_overrides(client):
            problems.append(
                f"congress_photo_overrides.json entry {bioguide} shadows the official "
                "mirror photo that now exists; remove the override"
            )

    credits = {}
    for url in sorted(subjects):
        title = titles.get(url)
        page = pages.get(title) if title else None
        if not page or page.get("missing") or not page.get("imageinfo"):
            problems.append(f"no Commons file {title!r} for {url}")
            continue
        info = page["imageinfo"][0]
        meta = info.get("extmetadata", {})

        def m(key):
            return (meta.get(key) or {}).get("value")

        license_name = _plain(m("LicenseShortName")) or _plain(m("UsageTerms"))
        # Is this photo of the person it is used for? Their surname must
        # appear in the file's title or description.
        described = _fold(page["title"] + " " + (_plain(m("ImageDescription")) or ""))
        for person in subjects[url]:
            surname = _fold(_surname(person))
            if surname and surname not in described:
                problems.append(
                    f"{page['title']!r} is used for {person}, but its title and description "
                    f"do not mention {surname!r}; check that it is the right person"
                )
        credits[url] = {
            "subjects": sorted(subjects[url]),
            "file_title": page["title"],
            "file_page": info.get("descriptionurl"),
            # "Attribution" is the credit text the uploader requires, when
            # they set one; otherwise the author field.
            "author": _plain(m("Attribution")) or _plain(m("Artist")),
            "license": license_name,
            "license_url": m("LicenseUrl") or None,
            "attribution_required": (m("AttributionRequired") or "").strip().lower() == "true",
        }
    doc = {
        "_note": ("Credits for every Wikimedia Commons photo used in backend/app/data. Generated by "
                  "scripts/build_photo_credits.py from the Wikimedia Commons API; do not edit by "
                  "hand, rerun the script. Shown under profile photos and on /photo-credits."),
        "_source": "Wikimedia Commons API (commons.wikimedia.org/w/api.php), imageinfo extmetadata.",
        "retrieved": _dt.date.today().isoformat(),
        "credits": credits,
    }
    return doc, problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true", help="write backend/app/data/photo_credits.json")
    args = ap.parse_args()
    doc, problems = build()
    credits = doc["credits"]
    licenses: dict[str, int] = {}
    for c in credits.values():
        licenses[c["license"] or "unknown"] = licenses.get(c["license"] or "unknown", 0) + 1
    print(f"{len(credits)} photos credited. Licenses: {json.dumps(licenses, sort_keys=True)}")
    for p in problems:
        print("PROBLEM " + p)
    if args.write and problems:
        print("Not writing: fix the problems above first.")
    elif args.write:
        OUT_PATH.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"WROTE {OUT_PATH}")
    else:
        print("(dry run; pass --write to save)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
