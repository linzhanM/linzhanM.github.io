#!/usr/bin/env bash
# Render the homepage's UniMate thumbnail video in Blender and encode it.
#
#   ./resources/overview/render/render_unimate_video.sh                 # 4K, into assets/videos/unimate-lab.mp4
#   OUT=/tmp/x.mp4 RES_X=1280 RES_Y=720 SAMPLES=16 ./resources/overview/render/render_unimate_video.sh   # a look
#
# Two steps: render_unimate_video.py (Blender, the paper teaser's renderer
# animated — see its docstring) writes a beauty pass and a skeleton pass per
# frame, film transparent; then ffmpeg lays the skeleton over the beauty
# (the teaser's X-ray composite), both over the homepage's ivory plate, and
# encodes LOOPS passes of the 2 s clip as h264, Rec.709 tagged. The clip
# cuts back to its first frame as the lab's own loop does.
#
# Env: BLENDER (binary), OUT (mp4 path), OUT_DIR (frames), LOOPS (2), CRF (20),
# BG (#F0EEE6), and anything render_unimate_video.py reads (RES_X/RES_Y,
# SAMPLES, FRAMES, CAM_ELEV_RATIO, FILL_H, GAP, GRID_CELL, ...).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUT="${OUT:-$REPO/assets/videos/unimate-lab.mp4}"
export OUT_DIR="${OUT_DIR:-$HOME/Downloads/lab_renders/unimate-blender}"
export BG="${BG:-#F0EEE6}"
LOOPS="${LOOPS:-2}"
CRF="${CRF:-20}"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR" "$(dirname "$OUT")"
"$BLENDER" -b --factory-startup -P "$HERE/render_unimate_video.py"

# The frames are sRGB PNGs with alpha over nothing. overlay puts the skeleton
# through the mesh; the colour source is the plate; the h264 pass converts to
# Rec.709 limited range explicitly and tags it, or players guess (see
# unimate/tools/lib/output.mjs for why).
W="${RES_X:-3840}"; H="${RES_Y:-2160}"
BGHEX="0x${BG#\#}"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=${BGHEX}:s=${W}x${H}:r=30" \
  -stream_loop $((LOOPS - 1)) -framerate 30 -i "$OUT_DIR/mesh_%04d.png" \
  -stream_loop $((LOOPS - 1)) -framerate 30 -i "$OUT_DIR/skel_%04d.png" \
  -filter_complex "[1:v][2:v]overlay=format=auto[fig];[0:v][fig]overlay=format=auto:shortest=1,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709[out]" \
  -map "[out]" -c:v libx264 -preset slow -crf "$CRF" -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -movflags +faststart "$OUT"
echo "wrote $OUT"
