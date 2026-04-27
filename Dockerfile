FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY cyclops/ cyclops/
COPY config/ config/
RUN pip install --no-cache-dir .

ENTRYPOINT ["cyclops"]
