#!/bin/sh
# AGENTS.md is the canonical text. Run this after editing it to regenerate SKILL.md.
cd "$(dirname "$0")" || exit 1
{
  sed -n '1,/^---$/p' SKILL.md | head -4
  echo
  echo "# Reply style"
  tail -n +2 AGENTS.md
} > SKILL.md.new && mv SKILL.md.new SKILL.md
echo "SKILL.md regenerated from AGENTS.md"
