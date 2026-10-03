#!/bin/bash
# Builds the Half-Life game libraries (client + server) as WebAssembly side
# modules for the xash3d-fwgs web engine. Runs inside emscripten/emsdk; the
# Emscripten version has to match the one the engine was built with.
#
# Usage: build-hlsdk.sh <hlsdk-portable source dir> <output dir>
set -euo pipefail

src=$1
out=$2

cd "$src"
emconfigure ./waf configure --emscripten -T release
emmake ./waf
emconfigure ./waf install --destdir install

mkdir -p "$out"
cp install/valve/cl_dlls/client_emscripten_wasm32.wasm install/valve/dlls/hl_emscripten_wasm32.wasm "$out/"
ls -la "$out"
