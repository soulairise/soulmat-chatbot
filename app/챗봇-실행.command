#!/bin/zsh
set -eu
cd '/Users/soulmat/Documents/소울매트워크스페이스/30_앱·자동화/01_서비스/소울매트업무__soulmat-chatbot/app'
exec /Users/soulmat/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
