FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --system --uid 10001 app
USER app
EXPOSE 8000
# Uvicorn workers serve ASGI so long-running responses (assistant streaming) do not block a worker.
CMD ["gunicorn", "config.asgi:application", "-k", "uvicorn_worker.UvicornWorker", "-b", "0.0.0.0:8000", "-w", "4", "--access-logfile", "-"]
