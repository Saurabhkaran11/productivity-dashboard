#!/bin/bash
# Start the full productivity dashboard (backend + frontend)
# Usage: ./start.sh             -> dev mode (backend :8000, frontend :3000)
#        ./start.sh --prod      -> single server on :8000 serving the built app
# Stop: press Ctrl+C (kills both servers)

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Pre-flight checks
if [ ! -f "$ROOT/backend/venv/bin/python" ]; then
  echo "[ERROR] Backend venv not found. Run:"
  echo "  cd \"$ROOT/backend\" && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "[ERROR] Frontend deps not found. Run:"
  echo "  cd \"$ROOT/frontend\" && npm install"
  exit 1
fi

if [ "$1" = "--prod" ]; then
  if [ ! -d "$ROOT/frontend/dist" ]; then
    echo "[INFO] Building frontend (first run)..."
    (cd "$ROOT/frontend" && npm run build) || { echo "[ERROR] Build failed"; exit 1; }
  fi
  echo "Starting MyLife on :8000 (serves the built app)..."
  ("$ROOT/backend/venv/bin/python" -m uvicorn main:app --port 8000 --app-dir "$ROOT/backend") &
  trap "kill $! 2>/dev/null" EXIT INT TERM
  echo ""
  echo "App:  http://localhost:8000"
  echo "Docs: http://localhost:8000/docs"
  echo "Press Ctrl+C to stop."
  wait
  exit 0
fi

echo "Starting backend on :8000..."
("$ROOT/backend/venv/bin/python" -m uvicorn main:app --reload --port 8000 --app-dir "$ROOT/backend") &
BACKEND_PID=$!

echo "Starting frontend on :3000..."
(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT INT TERM

echo ""
echo "Backend API: http://localhost:8000  (docs at http://localhost:8000/docs)"
echo "App:         http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both servers."
wait
