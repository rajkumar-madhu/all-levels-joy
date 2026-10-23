# Django API, Celery worker/beat and the one-shot schema job share this image.
# Built from the repository root so the legacy SQL (supabase/, drizzle/) ships inside it.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LEGACY_SQL_ROOT=/legacy
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ /app/
COPY supabase/ /legacy/supabase/
COPY drizzle/ /legacy/drizzle/
RUN useradd --system --uid 10001 app && mkdir -p /app/var/evidence && chown app /app/var/evidence
USER app
EXPOSE 8000
CMD ["gunicorn", "config.asgi:application", "-k", "uvicorn_worker.UvicornWorker", "-b", "0.0.0.0:8000", "-w", "4", "--access-logfile", "-"]
