FROM python:3.11-slim

WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=600 \
    QT_QPA_PLATFORM=offscreen \
    DISPLAY=:99

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libglib2.0-0 \
    libgl1 \
    libglx0 \
    && rm -rf /var/lib/apt/lists/*

# CUDA-enabled PyTorch (for RTX 4060 Ti) — use cu121 wheels
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir --retries 15 --timeout 600 \
      torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

COPY requirements.txt .
RUN pip install --no-cache-dir --retries 15 --timeout 600 -r requirements.txt

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
