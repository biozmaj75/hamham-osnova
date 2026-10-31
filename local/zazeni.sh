#!/bin/sh
# Zažene Dom Obroki (Linux). Ustavite s Ctrl+C.
cd "$(dirname "$0")/.." || exit 1
if [ ! -f local/nastavitve.env ]; then
  echo "Manjka local/nastavitve.env – glejte Kakoinstaliram.pdf, korak 4."
  exit 1
fi
[ -d node_modules/pg ] || npm install --omit=dev
exec node local/server.mjs
