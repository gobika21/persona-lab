# Persona Lab: public demo image
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PUBLIC_MODE=1 TRUST_PROXY=1 PORT=8000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
 && playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

COPY . .
# Download axe-core at build time so checks don't depend on a CDN at runtime (optional; falls back to built-in rules)
RUN python -c "from personalab.sitecheck import load_axe; print('axe-core ready' if load_axe() else 'axe-core not downloaded; built-in checks will be used')"

RUN useradd -m app && chown -R app /app /ms-playwright
USER app
EXPOSE 8000

# One worker (state is in memory) with many threads; long timeout for site checks.
CMD gunicorn wsgi:app --workers 1 --threads 16 --timeout 180 --bind 0.0.0.0:${PORT}
