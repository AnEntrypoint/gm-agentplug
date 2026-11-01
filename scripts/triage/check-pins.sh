#!/usr/bin/env bash
# Platform: POSIX shell only; no Windows port. Run under Git Bash on Windows.
PIN_TIMEOUT=${PIN_TIMEOUT:-60}
export GIT_TERMINAL_PROMPT=0

bounded() {
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 5 "$PIN_TIMEOUT" "$@"
  elif command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV or exit 127' "$PIN_TIMEOUT" "$@"
  else
    "$@"
  fi
}

fetched_by_sha() {
  local tmp rc=1
  tmp=$(mktemp -d) || return 1
  if git init -q --bare "$tmp" && bounded git -C "$tmp" fetch -q "$1" "$2" 2>/dev/null; then rc=0; fi
  rm -rf "$tmp"
  return $rc
}

bad=0
while read -r _ type sha path; do
  [ "$type" = commit ] || continue
  url=$(git config -f .gitmodules --get "submodule.$path.url") || { echo "MISSING  $path ${sha:0:8} -- no .gitmodules url keyed by path"; bad=1; continue; }
  if refs=$(bounded git ls-remote "$url" 2>/dev/null) && printf '%s\n' "$refs" | cut -f1 | grep -q "^$sha"; then echo "ok       $path ${sha:0:8}"
  elif fetched_by_sha "$url" "$sha"; then echo "ok       $path ${sha:0:8} (reachable by sha)"
  else echo "MISSING  $path ${sha:0:8} -- not on $url (or no answer within ${PIN_TIMEOUT}s)"; bad=1; fi
done < <(git ls-tree HEAD)
exit $bad
