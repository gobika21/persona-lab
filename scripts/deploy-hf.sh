#!/bin/bash
# Deploy to a free Hugging Face Space (Docker):  scripts/deploy-hf.sh <hf-username>/<space-name>
#
# Uploads exactly what is committed (git archive), so .env, .venv and build folders never leave this machine.
# The Space's settings live in README front matter, added to the uploaded copy only. Needs `hf auth login` first
# (a token with write access). Set ANTHROPIC_API_KEY as a Space secret only if visitors should run on your key.
set -euo pipefail

SPACE=${1:?usage: scripts/deploy-hf.sh <hf-username>/<space-name>}
HF=${HF:-hf}
cd "$(git rev-parse --show-toplevel)"
git diff --quiet HEAD || echo "Note: uncommitted changes are not deployed (only committed files are uploaded)."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git archive HEAD | tar -x -C "$tmp"

# Hugging Face reads a Space's settings from the top of its README. The Dockerfile serves on port 8000.
{
  printf -- '---\n'
  printf 'title: Persona Lab\nemoji: ♿\ncolorFrom: yellow\ncolorTo: green\n'
  printf 'sdk: docker\napp_port: 8000\npinned: false\n'
  printf 'short_description: AI agents test sites the way disabled people browse\n'
  printf -- '---\n\n'
  cat "$tmp/README.md"
} > "$tmp/README.space.md"
mv "$tmp/README.space.md" "$tmp/README.md"

if [ "${DRY_RUN:-}" = 1 ]; then
  echo "Dry run: would upload $(find "$tmp" -type f | wc -l | tr -d ' ') files ($(du -sh "$tmp" | cut -f1)) to $SPACE"
  head -10 "$tmp/README.md"
  exit 0
fi

"$HF" repo create "$SPACE" --repo-type space --space-sdk docker --exist-ok
"$HF" upload "$SPACE" "$tmp" . --repo-type space --commit-message "Deploy $(git rev-parse --short HEAD)"
echo
echo "Deployed. The Space builds for a few minutes, then runs at: https://huggingface.co/spaces/$SPACE"
