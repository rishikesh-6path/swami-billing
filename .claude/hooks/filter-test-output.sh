#!/usr/bin/env bash
# Rewrites test commands so only failures reach Claude's context. Saves tokens on every test run.
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')
if [[ "$cmd" =~ ^pnpm\ (test|test:core|e2e) ]]; then
  filtered="$cmd 2>&1 | grep -E -A 8 '(FAIL|✗|×|Error|error TS|AssertionError|Tests:|Test Files|[0-9]+ (passed|failed))' | head -150"
  echo "$input" | jq --arg f "$filtered" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"allow",updatedInput:(.tool_input + {command:$f})}}'
else
  echo "{}"
fi
