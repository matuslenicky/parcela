#!/bin/sh
# Postaví autá zo špecifikácie a hneď vykreslí náhľad: sh kempy/models/go.sh <spec.json> <out dir> <id,id> [voľby preview.js]
set -e
here="$(cd "$(dirname "$0")" && pwd)"; spec="$1"; out="$2"; ids="$3"; shift 3
"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P "$here/car.py" -- "$spec" "$out" --only "$ids" 2>&1 | grep -E "MODEL|Error|error|Traceback|File \"|^[A-Za-z]+Error" || true
glbs=""; for i in $(echo "$ids" | tr ',' ' '); do glbs="$glbs $out/$i.glb"; done
node "$here/preview.js" "$out/nahlad.png" $glbs "$@"
