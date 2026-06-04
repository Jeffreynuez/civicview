# CivicView — Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
# Proprietary and confidential. See LICENSE at the repository root.

"""
Standardized demographic-question catalog for optional poll demographic forms.

Source of truth for the prompts, answer options, and tiers — the DB
(`poll_demographic_questions`) only stores which KEYS a poll attaches; this
module resolves keys -> prompts/options. Keep it append-mostly: renaming a key
or changing an option `value` orphans stored answers, so treat changes as
versioned migrations.

Privacy posture (see docs/polls-demographic-forms-prd.md):
  • Every question is single-select and OPTIONAL; "Prefer not to say" is the
    implicit non-answer (no row stored).
  • Two tiers: "standard" and "sensitive". Sensitive questions (party,
    race/ethnicity, religion, income) are grouped behind a notice and flagged
    for the pending ToS/Privacy attorney review. Same optionality + min-cell
    suppression rules apply to both tiers.
"""
from __future__ import annotations

CATALOG_VERSION = 1


def _q(prompt: str, tier: str, options: list[tuple[str, str]]) -> dict:
    return {
        "prompt": prompt,
        "tier": tier,
        "options": [{"value": v, "label": label} for v, label in options],
    }


# Ordered: standard tier first, then sensitive. Insertion order is the default
# display order in the creator picker.
DEMOGRAPHIC_CATALOG: dict[str, dict] = {
    "age_band": _q("Age", "standard", [
        ("18_24", "18–24"), ("25_34", "25–34"), ("35_44", "35–44"),
        ("45_54", "45–54"), ("55_64", "55–64"), ("65_plus", "65 or older"),
    ]),
    "sex": _q("Sex", "standard", [
        ("female", "Female"), ("male", "Male"),
    ]),
    "party": _q("Political party", "sensitive", [
        ("democrat", "Democrat"), ("republican", "Republican"),
        ("independent", "Independent / No party"), ("libertarian", "Libertarian"),
        ("green", "Green"), ("other", "Other"),
    ]),
    "parent_guardian": _q("Are you a parent or guardian?", "standard", [
        ("yes", "Yes"), ("no", "No"),
    ]),
    "education": _q("Highest education completed", "standard", [
        ("hs_or_less", "High school or less"), ("some_college", "Some college"),
        ("bachelors", "Bachelor's degree"), ("graduate", "Graduate degree"),
    ]),
    "employment": _q("Employment status", "standard", [
        ("employed", "Employed"), ("self_employed", "Self-employed"),
        ("student", "Student"), ("retired", "Retired"),
        ("not_employed", "Not employed"),
    ]),
    "homeownership": _q("Do you own or rent your home?", "standard", [
        ("own", "Own"), ("rent", "Rent"),
    ]),
    "veteran": _q("Have you served in the military?", "standard", [
        ("yes", "Yes"), ("no", "No"),
    ]),
    # ── Sensitive tier ──
    "race_ethnicity": _q("Race / ethnicity", "sensitive", [
        ("white", "White"), ("black", "Black or African American"),
        ("hispanic", "Hispanic or Latino"), ("asian", "Asian"),
        ("native_american", "Native American or Alaska Native"),
        ("pacific_islander", "Native Hawaiian or Pacific Islander"),
        ("two_or_more", "Two or more races"), ("other", "Other"),
    ]),
    "income": _q("Household income", "sensitive", [
        ("under_30k", "Under $30,000"), ("30_60k", "$30,000–$60,000"),
        ("60_100k", "$60,000–$100,000"), ("100_150k", "$100,000–$150,000"),
        ("150k_plus", "$150,000 or more"),
    ]),
    "religion": _q("Religion", "sensitive", [
        ("protestant", "Protestant"), ("catholic", "Catholic"),
        ("jewish", "Jewish"), ("muslim", "Muslim"),
        ("other_faith", "Other faith"), ("none", "None / Unaffiliated"),
    ]),
}

SENSITIVE_KEYS = {k for k, v in DEMOGRAPHIC_CATALOG.items() if v["tier"] == "sensitive"}


def is_valid_key(key: str) -> bool:
    return key in DEMOGRAPHIC_CATALOG


def valid_values(key: str) -> set[str]:
    q = DEMOGRAPHIC_CATALOG.get(key)
    return {o["value"] for o in q["options"]} if q else set()


def is_valid_answer(key: str, value: str) -> bool:
    return value in valid_values(key)


def prompt_for(key: str) -> str | None:
    q = DEMOGRAPHIC_CATALOG.get(key)
    return q["prompt"] if q else None


def label_for(key: str, value: str) -> str | None:
    q = DEMOGRAPHIC_CATALOG.get(key)
    if not q:
        return None
    for o in q["options"]:
        if o["value"] == value:
            return o["label"]
    return None


def normalize_keys(keys: list[str]) -> list[str]:
    """Filter to valid catalog keys, de-dupe, preserve the caller's order."""
    seen: set[str] = set()
    out: list[str] = []
    for k in keys or []:
        if k in DEMOGRAPHIC_CATALOG and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def serialize_catalog() -> list[dict]:
    """Frontend-facing catalog: ordered list with key, prompt, tier, options."""
    return [
        {"key": k, "prompt": q["prompt"], "tier": q["tier"], "options": q["options"]}
        for k, q in DEMOGRAPHIC_CATALOG.items()
    ]
