# Use a base image that has both Node and Python capabilities
FROM node:20-bookworm

# 1. Install System Dependencies (Python, FFmpeg)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    libsndfile1 \
    wget \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Python Tools (Demucs for drums, yt-dlp for downloading)
# Install CPU-only version of PyTorch to save space and build time
# Note: --break-system-packages is needed for Debian 12+ (Bookworm) inside containers
# Demucs removed to save space, using Spleeter instead.
# Start with numpy<2 to avoid Spleeter/TensorFlow compatibility issues
RUN pip3 install "numpy<2" --break-system-packages
RUN pip3 install -U yt-dlp spleeter --no-cache-dir --break-system-packages

# 3. Set up the App Directory
WORKDIR /app

# Optimize Spleeter/TensorFlow for low-memory environments
ENV MODEL_PATH=/app/pretrained_models
ENV OMP_NUM_THREADS=1
ENV TF_NUM_INTRAOP_THREADS=1
ENV TF_NUM_INTEROP_THREADS=1

# Limit Node.js memory usage to leave room for Spleeter (essential for 1GB VPS)
ENV NODE_OPTIONS="--max-old-space-size=256"

# 3.1 Pre-download Spleeter model (4stems) to avoid runtime download/extraction OOMs
# We download and extract it to /app/pretrained_models/4stems where Spleeter expects it
RUN mkdir -p /app/pretrained_models/4stems && \
    wget -q https://github.com/deezer/spleeter/releases/download/v1.4.0/4stems.tar.gz -O /tmp/4stems.tar.gz && \
    tar -xzf /tmp/4stems.tar.gz -C /app/pretrained_models/4stems && \
    rm /tmp/4stems.tar.gz

# 4. Install Node.js Dependencies
COPY package*.json ./
RUN npm ci

# 5. Copy the rest of your code
COPY . .

# 6. Build the Next.js application
RUN npm run build

# 7. Copy public folder to standalone (Next.js standalone doesn't include it automatically)
RUN cp -r public .next/standalone/public || true

# 8. Create audio directory with proper permissions
RUN mkdir -p /app/public/audio && chmod 777 /app/public/audio

# 9. Expose the port (default 3000)
EXPOSE 3000

# 11. Run Next.js standalone server
CMD ["node", ".next/standalone/server.js"]