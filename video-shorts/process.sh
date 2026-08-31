#!/usr/bin/env bash
# Pipeline: raw_video.mp4 -> cut silence -> crop/scale to 9:16 -> auto zoom-in
# on the spoken segments (keyword sentences) -> final_short.mp4
#
# Requires: ffmpeg, auto-editor (pip install auto-editor)
#
# Usage: ./process.sh [input.mp4] [output.mp4]

set -euo pipefail
cd "$(dirname "$0")"

IN="${1:-raw_video.mp4}"
OUT="${2:-final_short.mp4}"
TMP_SILENCE="$(mktemp --suffix=.mp4)"
TMP_CROP="$(mktemp --suffix=.mp4)"
trap 'rm -f "$TMP_SILENCE" "$TMP_CROP"' EXIT

echo "[1/3] Removing silent sections..."
auto-editor "$IN" --edit audio:threshold=4% --margin 0.2sec -o "$TMP_SILENCE" --no-open

echo "[2/3] Cropping/scaling to 9:16 (1080x1920)..."
ffmpeg -y -i "$TMP_SILENCE" \
  -vf "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920:flags=lanczos,setsar=1" \
  -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k "$TMP_CROP" -loglevel error

echo "[3/3] Detecting speech segments and applying auto zoom-in..."
# Re-detect silence on the trimmed clip so zoom windows line up with the new
# timeline, then punch in ~15% on every spoken segment (0.2s ease in/out).
mapfile -t BOUNDS < <(
  ffmpeg -i "$TMP_CROP" -af silencedetect=noise=-30dB:d=0.3 -f null - 2>&1 \
    | grep -oE '(silence_start|silence_end): [0-9.]+' | awk '{print $2}'
)
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TMP_CROP")

python3 - "$TMP_CROP" "$OUT" "$DURATION" "${BOUNDS[@]}" <<'PY'
import sys, subprocess

crop_path, out_path, duration = sys.argv[1], sys.argv[2], float(sys.argv[3])
bounds = [float(x) for x in sys.argv[4:]]

# bounds alternate silence_start, silence_end (silence at very start/end may be
# unpaired). Reconstruct speech segments as the gaps between silences.
points = [0.0] + bounds + [duration]
segs = []
i = 0
# points is start, [silence_start, silence_end]*, end -> speech segments are
# (points[0],points[1]), (points[2],points[3]), ... when len is even after the
# leading 0.0; simplest robust approach: speech = complement of silence pairs.
silences = list(zip(bounds[0::2], bounds[1::2])) if bounds else []
cursor = 0.0
for s, e in silences:
    if s > cursor + 0.05:
        segs.append((cursor, s))
    cursor = e
if cursor < duration - 0.05:
    segs.append((cursor, duration))

if not segs:
    segs = [(0.0, duration)]

R, Z = 0.2, 1.15

def trapezoid(a, b):
    rise = f"(t-({a}-{R}))/{R}"
    fall = f"(({b}+{R})-t)/{R}"
    inner = f"min({rise}\\,1)"
    inner2 = f"min({inner}\\,{fall})"
    return f"clip({inner2}\\,0\\,1)"

envs = [trapezoid(a, b) for a, b in segs]
combo = envs[0]
for e in envs[1:]:
    combo = f"max({combo}\\,{e})"

zt = f"(1+({Z}-1)*{combo})"
w_expr = f"trunc(iw*{zt}/2)*2"
h_expr = f"trunc(ih*{zt}/2)*2"

vf = (
    f"scale=w='{w_expr}':h='{h_expr}':eval=frame:flags=lanczos,"
    "crop=w=1080:h=1920:x='(in_w-1080)/2':y='(in_h-1920)/2',setsar=1"
)

subprocess.run([
    "ffmpeg", "-y", "-i", crop_path, "-vf", vf,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", out_path, "-loglevel", "error",
], check=True)
print(f"Speech segments used for zoom: {segs}")
PY

echo "Done: $OUT"
