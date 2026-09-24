#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/am_pet"
OUT="$APP/src/assets/frames"
TMP="$APP/.tmp_frames"

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is required"; exit 1; }
command -v magick >/dev/null 2>&1 || { echo "ImageMagick 'magick' is required"; exit 1; }

process_clip() {
  local name="$1"
  local src="$ROOT/$name.mov"
  local raw="$TMP/$name/raw"
  local dst="$OUT/$name"

  if [[ ! -f "$src" ]]; then
    echo "Missing $src"
    exit 1
  fi

  mkdir -p "$raw" "$dst"
  find "$raw" -type f -name '*.png' -delete
  find "$dst" -type f -name '*.png' -delete

  ffmpeg -hide_banner -loglevel error -y -i "$src" -an -vsync 0 "$raw/%03d.png"

  local frame
  for frame in "$raw"/*.png; do
    local base
    base="$(basename "$frame")"
    magick "$frame" \
      -alpha set \
      -fuzz 1% \
      -fill none \
      -draw 'color 0,0 floodfill' \
      -draw 'color 295,0 floodfill' \
      -draw 'color 0,339 floodfill' \
      -draw 'color 295,339 floodfill' \
      -channel A -blur 0x0.45 +channel \
      "$dst/$base"
  done

  local count
  count="$(find "$dst" -type f -name '*.png' | wc -l | tr -d ' ')"
  echo "processed $name -> $count frame(s)"
}

mkdir -p "$OUT" "$TMP"

process_clip idle
process_clip jump
process_clip shake
process_clip shake2
process_clip shy_shake

node "$APP/scripts/rebuild-manifest.js"

echo "done"
