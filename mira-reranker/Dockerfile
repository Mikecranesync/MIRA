FROM python:3.12.13-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir \
    onnxruntime==1.23.2 \
    tokenizers==0.22.1 \
    numpy==2.3.3 \
    fastapi==0.147.0 \
    uvicorn==0.54.0

# License gate (CU-RR1): fails the build if any installed package is neither MIT/Apache
# nor on the owner-approved exception list in check_licenses.py.
COPY check_licenses.py ./
RUN python check_licenses.py

COPY app.py fetch_model.py MODEL_SHA256 ./

# Build-time only: downloads the pinned model revision and verifies sha256.
# The service never downloads at runtime (fetch_model.py is not invoked by CMD).
RUN python fetch_model.py

RUN addgroup --system --gid 1001 mira && \
    adduser --system --uid 1001 --ingroup mira mira

USER mira

ENV MODEL_DIR=/models/ms-marco-MiniLM-L-6-v2

EXPOSE 8088
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8088"]
