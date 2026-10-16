"""The ballot tab says "Your district: FL-10", never "registered to vote" (2026-10-16).

Run:  cd backend && python3 tests/test_ballot_district_wording.py   (exit 0 = pass)

Before: every signed-in citizen browsing their own state's ballot saw
"You're registered to vote in FL-10". CivicView can't know whether
anyone is registered to vote, and a demo account's district is
self-entered.

Now the banner reads "Your district: FL-10" (frontend/lib/usStates.js
yourDistrictLine), worded the same for every state:
1. the helper, run in Node, gives "Your district: <district>" for a
   district in every state, "WY at-large" for an at-large seat, and the
   state when the account has no district;
2. BallotTab uses the helper, and no file in the frontend claims anyone
   is "registered to vote".
"""
import json
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
US_STATES = FRONTEND / "lib" / "usStates.js"
BALLOT_TAB = FRONTEND / "components" / "BallotTab.js"

# Loaded through a data: URL so it runs as an ES module on any Node
# version, whatever the frontend's package.json says about module type.
NODE_SCRIPT = r"""
import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[1], 'utf8');
const m = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const states = Object.keys(m.default);
const out = {
  states,
  each: states.map((st) => m.yourDistrictLine(`${st}-1`, st)),
  cases: [
    m.yourDistrictLine('FL-10', 'FL'),
    m.yourDistrictLine('fl-10', 'fl'),
    m.yourDistrictLine('WY-AL', 'WY'),
    m.yourDistrictLine('', 'TX'),
    m.yourDistrictLine(null, 'tx'),
  ],
};
console.log(JSON.stringify(out));
"""


def main() -> int:
    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)

    node = shutil.which("node")
    check(node is not None, "node is needed to run the frontend helper (it ships on CI runners)")
    if node:
        proc = subprocess.run(
            [node, "--input-type=module", "-e", NODE_SCRIPT, str(US_STATES)],
            capture_output=True, text=True, timeout=60,
        )
        check(proc.returncode == 0, f"node failed: {proc.stderr[-400:]}")
        if proc.returncode == 0:
            out = json.loads(proc.stdout)
            states = out["states"]
            check(len(states) >= 50, f"expected every state in STATE_NAMES, got {len(states)}")
            for st, line in zip(states, out["each"]):
                check(line == f"Your district: {st}-1", f"{st}: {line!r}")
            want = [
                "Your district: FL-10",
                "Your district: FL-10",
                "Your district: WY at-large",
                "Your district: TX",
                "Your district: TX",
            ]
            check(out["cases"] == want, f"cases: {out['cases']!r}")

    ballot = BALLOT_TAB.read_text(encoding="utf-8")
    check("yourDistrictLine(status.district, status.state)" in ballot,
          "BallotTab should build the in-state line with yourDistrictLine")
    for path in sorted(FRONTEND.glob("*/**/*.js")):
        if "node_modules" in path.parts or ".next" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore").lower()
        for phrase in ("registered to vote in", "you're registered to vote", "you&rsquo;re registered to vote"):
            check(phrase not in text, f"{path.relative_to(ROOT)} still says {phrase!r}")

    if failures:
        for f in failures:
            print("FAIL:", f)
        return 1
    print("ok: the ballot tab names the district and claims no registration")
    return 0


if __name__ == "__main__":
    sys.exit(main())
