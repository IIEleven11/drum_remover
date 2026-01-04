# Use a base image that has both Node and Python capabilities
FROM node:20-bullseye

# 1. Install System Dependencies (Python, FFmpeg)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Python Tools (Demucs for drums, yt-dlp for downloading)
RUN pip3 install -U demucs yt-dlp

# 3. Set up the App Directory
WORKDIR /app

# 4. Install Node.js Dependencies
COPY package*.json ./
RUN npm install

# 5. Copy the rest of your code
COPY . .

# 6. Build the Next.js application
RUN npm run build

# 7. Expose the port
EXPOSE 3000

# 8. Start the server
CMD ["npm", "start"]