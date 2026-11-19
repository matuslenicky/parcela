#!/bin/sh
# Celá prestavba ukážky kempu: Blender (model + obrázky) → render_3d.jpg → 3D prehliadka → stránka.
#   sh kempy/rebuild.sh <slug> [<slug> …]      (premenná NORENDER=1 vynechá vykreslenie obrázkov)
set -e
here="$(cd "$(dirname "$0")" && pwd)"
for slug in "$@"; do
  echo "== $slug"
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P "$here/build_camp.py" -- "$here/$slug" ${NORENDER:+--no-render} 2>&1 | grep -E "Error|Traceback|File \"|Saved:|Finished glTF" || true
  if [ -z "$NORENDER" ]; then python -c "import sys; from PIL import Image; im = Image.open(sys.argv[1]).convert('RGB'); im.save(sys.argv[2], quality=86, optimize=True, progressive=True)" "$here/$slug/render_3d.png" "$here/$slug/render_3d.jpg"; fi
  node "$here/build-viewer.js" "$slug" | tail -1
  node "$here/build-demo.js" "$slug" | tail -1
done
