#!/usr/bin/env bash
# cleanup-local-branches.sh
#
# Safely delete local branches whose tip is fully merged into
# origin/main (so the work is preserved upstream and a local delete
# loses nothing). Refuses to delete the current branch, refuses to
# delete `main` itself, and prints what it's about to do before
# touching anything — pass --yes to skip the confirm prompt.
#
# Usage:
#   cd ~/Desktop/"US apps"/CivicLens
#   bash /path/to/cleanup-local-branches.sh           # dry-run summary + interactive confirm
#   bash /path/to/cleanup-local-branches.sh --yes     # skip the confirm and just delete

set -euo pipefail

YES=0
if [[ "${1:-}" == "--yes" ]]; then YES=1; fi

# Make sure we're in a git repo
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "error: not a git repository" >&2
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "current branch: $CURRENT_BRANCH"

# Refresh origin so 'merged into origin/main' is accurate
echo "fetching origin..."
git fetch --quiet --prune origin

# Build the candidate list: branches fully merged into origin/main,
# minus protected/special names + the current branch.
EXCLUDE_REGEX='^\*|^\s*main\s*$|^\s*'"$CURRENT_BRANCH"'\s*$'
CANDIDATES=$(git branch --merged origin/main \
  | grep -vE "$EXCLUDE_REGEX" \
  | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
  | grep -v '^$' || true)

if [[ -z "$CANDIDATES" ]]; then
  echo "nothing to clean up — no fully-merged local branches found."
  exit 0
fi

echo ""
echo "branches that are fully merged into origin/main and safe to delete:"
echo "$CANDIDATES" | sed 's/^/  - /'
echo ""

# Also report unmerged branches so the user knows what's NOT being touched
UNMERGED=$(git branch --no-merged origin/main \
  | grep -vE "$EXCLUDE_REGEX" \
  | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
  | grep -v '^$' || true)
if [[ -n "$UNMERGED" ]]; then
  echo "branches NOT merged into origin/main (left alone):"
  echo "$UNMERGED" | sed 's/^/  - /'
  echo ""
fi

if [[ $YES -eq 0 ]]; then
  read -p "delete the merged branches listed above? [y/N] " ANSWER
  case "$ANSWER" in
    y|Y|yes|YES) ;;
    *) echo "aborted."; exit 0 ;;
  esac
fi

echo ""
echo "deleting..."
echo "$CANDIDATES" | while IFS= read -r BRANCH; do
  if [[ -n "$BRANCH" ]]; then
    git branch -d "$BRANCH" || echo "  ! could not delete $BRANCH (use 'git branch -D' if you're sure)"
  fi
done

echo ""
echo "done. remaining local branches:"
git branch | sed 's/^/  /'
