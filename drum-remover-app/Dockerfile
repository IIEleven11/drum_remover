# Use a base image that has both Node and Python capabilities
FROM node:20-bookworm

# 1. Install System Dependencies (Python, FFmpeg)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Python Tools (Demucs for drums, yt-dlp for downloading)
# Install CPU-only version of PyTorch to save space and build time
# Note: --break-system-packages is needed for Debian 12+ (Bookworm) inside containers
RUN pip3 install torch torchaudio --index-url https://download.pytorch.org/whl/cpu --break-system-packages
RUN pip3 install -U demucs yt-dlp spleeter --break-system-packages

# 2.1. Pre-download the Demucs model to avoid first-run delay
# This caches the model in the image so the first request is fast
ARG DEMUCS_MODEL=htdemucs
RUN python3 -c "from demucs.pretrained import get_model; get_model('${DEMUCS_MODEL}')"

# 3. Set up the App Directory
WORKDIR /app

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

# 10. Performance tuning environment variables (can be overridden at runtime)
# DEMUCS_MODEL: htdemucs (default, best quality), hdemucs_mmi (faster), mdx_extra (fastest)
# DEMUCS_SEGMENT: smaller = faster but lower quality (default 5, range 3-10)
# DEMUCS_JOBS: parallel segment processing (default 2, increase with more RAM)
# OMP_NUM_THREADS: CPU threads per job (default 4, match your VPS cores)
ENV NODE_ENV=production
ENV PORT=3000
ENV DEMUCS_MODEL=htdemucs
ENV DEMUCS_SEGMENT=5
ENV DEMUCS_JOBS=2
ENV OMP_NUM_THREADS=4
ENV DEMUCS_MP3_BITRATE=192

# 11. Run Next.js standalone server
CMD ["node", ".next/standalone/server.js"]