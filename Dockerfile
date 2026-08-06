# ---- Build the React frontend ----
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci || npm install
COPY frontend/ .
RUN npm run build

# ---- Build the Python backend + copy built frontend ----
FROM python:3.12-slim AS backend
WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    MYLIFE_DB=/data/mylife.db \
    FRONTEND_DIST=/app/frontend/dist

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && mkdir -p /data

COPY backend/ ./backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist

EXPOSE 8000
WORKDIR /app/backend
CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
