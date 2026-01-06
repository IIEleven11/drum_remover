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
RUN pip3 install -U demucs yt-dlp --break-system-packages

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

# 10. Run Next.js standalone server
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", ".next/standalone/server.js"]