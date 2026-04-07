FROM node:20-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app/premium-bot

COPY premium-bot/package*.json ./
RUN npm ci

RUN python3 -m venv /opt/fragment-venv \
  && /opt/fragment-venv/bin/pip install --no-cache-dir requests aiohttp python-dotenv tonutils pytoniq-core

COPY premium-bot/ ./
COPY fragment_worker /app/fragment_worker
COPY fragment-api-py /app/fragment-api-py

ENV PYTHONPATH=/app/fragment-api-py
ENV FRAGMENT_WORKER_ROOT=/app/fragment_worker
ENV FRAGMENT_WORKER_PYTHON=/opt/fragment-venv/bin/python

CMD ["npm", "run", "dev"]
