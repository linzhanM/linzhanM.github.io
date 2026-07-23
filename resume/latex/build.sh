#!/usr/bin/env bash
#
# Build the resume and leave nothing behind.
#
#   ./build.sh
#
# Compiles resume.tex, publishes the PDF to ../resume.pdf (served at
# /resume/resume.pdf), then removes every intermediate file latexmk created.
# Run from anywhere — it cd's to its own directory first.

set -euo pipefail
cd "$(dirname "$0")"

# TeX Live's binaries aren't always on PATH in non-login shells.
export PATH="/Library/TeX/texbin:$PATH"

latexmk -pdf -interaction=nonstopmode -halt-on-error resume.tex
mv -f resume.pdf ../resume.pdf          # the served copy
latexmk -c resume.tex                    # delete aux/log/out/fls/fdb_latexmk

echo "Built ../resume.pdf"
