#!/usr/bin/env bash
# Runs prettier + eslint --fix on the file Claude just edited. Deterministic, cheap, keeps diffs clean.
input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0
case "$file" in
  *.ts|*.tsx|*.js|*.json|*.css|*.html)
    npx prettier --write "$file" >/dev/null 2>&1 || true
    case "$file" in *.ts|*.tsx) npx eslint --fix "$file" >/dev/null 2>&1 || true ;; esac
    ;;
esac
exit 0
