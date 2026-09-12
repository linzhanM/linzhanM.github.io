#!/usr/bin/env bash
# Render the homepage's DIMO thumbnail video in Blender and encode it.
#
#   ./resources/overview/render/render_dimo_video.sh                  # 4K, into assets/videos/dimo-lab.mp4
#   OUT=/tmp/x.mp4 RES_X=1280 RES_Y=720 SAMPLES=16 ./resources/overview/render/render_dimo_video.sh   # a look
#
# Two steps: render_dimo_video.py (Blender, the DIMO lab's two stages on the
# paper teaser's stage — see its docstring) writes one 90-frame loop of the
# ducks and one of the arms, film transparent; then ffmpeg lays each over the
# homepage's ivory plate, plays each LOOPS times, fades the cut between them
# over 180 ms in that ivory (the live thumbnail's own fade; the ends are cuts,
# like its loop), and encodes h264, Rec.709 tagged.
#
# Frames go to ~/Downloads/renders/ by default (the owner's render folder,
# outside the repo: every file under assets/** is referenced by a page).
# Env: BLENDER, OUT, OUT_DIR, LOOPS (2), CRF (20), BG (#F0EEE6), and whatever
# render_dimo_video.py reads (RES_X/RES_Y, SAMPLES, FRAMES, ONLY, FILL, ...).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
OUT="${OUT:-$REPO/assets/videos/dimo-lab.mp4}"
export OUT_DIR="${OUT_DIR:-$HOME/Downloads/renders/dimo-blender}"
export BG="${BG:-#F0EEE6}"
LOOPS="${LOOPS:-2}"
CRF="${CRF:-20}"
FADE=0.18
CLIP=3          # 90 frames at 30 fps

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR" "$(dirname "$OUT")"
"$BLENDER" -b --factory-startup -P "$HERE/render_dimo_video.py"

W="${RES_X:-3840}"; H="${RES_Y:-2160}"
BGHEX="0x${BG#\#}"
SEG=$(python3 -c "print($CLIP * $LOOPS)")
FOUT=$(python3 -c "print($CLIP * $LOOPS - $FADE)")
# Each object: its frames over the plate, looped; the ducks fade out at their
# end and the arms fade in at their start, both to the plate's colour, then
# the two are joined.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "color=c=${BGHEX}:s=${W}x${H}:r=30" \
  -stream_loop $((LOOPS - 1)) -framerate 30 -i "$OUT_DIR/duck_%04d.png" \
  -stream_loop $((LOOPS - 1)) -framerate 30 -i "$OUT_DIR/arm_%04d.png" \
  -filter_complex "[0:v]split[bg1][bg2];\
[bg1][1:v]overlay=format=auto:shortest=1,fade=t=out:st=${FOUT}:d=${FADE}:color=${BGHEX}[ducks];\
[bg2][2:v]overlay=format=auto:shortest=1,fade=t=in:st=0:d=${FADE}:color=${BGHEX}[arms];\
[ducks][arms]concat=n=2:v=1:a=0,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709[out]" \
  -map "[out]" -c:v libx264 -preset slow -crf "$CRF" -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -movflags +faststart "$OUT"
echo "wrote $OUT"
