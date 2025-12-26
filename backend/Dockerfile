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

# upgrade pip tooling
RUN python -m pip install --upgrade pip setuptools wheel

# IMPORTANT: pre-install CPU-only torch and torchvision so ultralytics doesn't pull CUDA+nvidia wheels
# Install torch first, then let pip resolve compatible torchvision version
ARG TORCH_VER=2.9.1
RUN pip install --no-cache-dir --retries 15 --timeout 600 \
    --index-url https://download.pytorch.org/whl/cpu \
    torch==${TORCH_VER} && \
    pip install --no-cache-dir --retries 15 --timeout 600 \
    --index-url https://download.pytorch.org/whl/cpu \
    torchvision

COPY requirements.txt .
RUN pip install --no-cache-dir --retries 15 --timeout 600 -r requirements.txt

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
