#!/usr/bin/env bash
# Stop hook: if TypeScript does not compile, block the turn from ending so Claude fixes it now.
# Only runs when there is a package.json with a typecheck script (i.e. after Phase 0 scaffold).
[ -f package.json ] || exit 0
grep -q '"typecheck"' package.json || exit 0
out=$(pnpm -s typecheck 2>&1)
if [ $? -ne 0 ]; then
  echo "$out" | grep -E 'error TS' | head -40 >&2
  echo "Typecheck failed. Fix the errors above before finishing." >&2
  exit 2
fi
exit 0
