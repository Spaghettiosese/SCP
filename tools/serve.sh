#!/bin/sh
# Serve the game locally (ES modules need http://)
cd "$(dirname "$0")/.." && npx --yes http-server -p ${PORT:-8080} -c-1 .
