#!/bin/bash
# clean-images.sh — Remove generated/temporary image files
# Usage: bash scripts/clean-images.sh

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

count=0
for f in "$PROJECT_DIR"/*.png "$PROJECT_DIR"/*.jpg "$PROJECT_DIR"/*.jpeg; do
  if [ -f "$f" ]; then
    rm "$f"
    echo "  Deleted: $(basename "$f")"
    count=$((count + 1))
  fi
done

if [ "$count" -eq 0 ]; then
  echo "  No image files found."
else
  echo "  Removed $count file(s)."
fi
