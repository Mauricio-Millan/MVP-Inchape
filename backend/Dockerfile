FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY data ./data

# mvp.db se crea en runtime (init_db() es idempotente); MVP_DB_PATH apunta
# a /home en App Service porque es el único directorio persistido entre
# reinicios del contenedor.
ENV MVP_DB_PATH=/home/data/mvp.db
EXPOSE 8000
CMD mkdir -p "$(dirname "$MVP_DB_PATH")" && uvicorn app.main:app --host 0.0.0.0 --port 8000
