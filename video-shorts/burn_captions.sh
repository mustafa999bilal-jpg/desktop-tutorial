#!/usr/bin/env bash
# Burn an SRT caption file onto the processed short, styled yellow with a
# white outline (classic shorts/reels caption look).
#
# 1. Edit captions_template.srt (or copy it) and replace the placeholder
#    text with the real spoken words, keeping the timestamps in sync with
#    final_short.mp4.
# 2. Run: ./burn_captions.sh captions_template.srt final_short.mp4 final_short_captioned.mp4

set -euo pipefail
cd "$(dirname "$0")"

SRT="${1:-captions_template.srt}"
IN="${2:-final_short.mp4}"
OUT="${3:-final_short_captioned.mp4}"

STYLE="FontName=Arial Black,FontSize=16,PrimaryColour=&H0000FFFF&,OutlineColour=&H00FFFFFF&,BorderStyle=1,Outline=3,Shadow=0,Alignment=2,MarginV=80"

ffmpeg -y -i "$IN" -vf "subtitles=${SRT}:force_style='${STYLE}'" \
  -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a copy "$OUT" -loglevel error

echo "Done: $OUT"
