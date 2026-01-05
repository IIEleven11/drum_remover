# YouTube DL Home Proxy

This is a simple Node.js server that uses `yt-dlp` to download YouTube audio.
Run this on a residential network (like your home computer) to avoid "Datacenter IP" blocks from YouTube.

## Setup

1.  **Install Node.js** (if not already installed).
2.  **Install yt-dlp**:
    -   Mac: `brew install yt-dlp`
    -   Windows: `winget install yt-dlp` or download from GitHub.
    -   Linux: `sudo apt install yt-dlp` (or download latest binary).
3.  **Install dependencies**:
    ```bash
    npm install
    ```

## Running

1.  Start the server:
    ```bash
    node server.js
    ```
    It will run on port 3001.

2.  **Expose to the Internet**:
    Use [ngrok](https://ngrok.com/) or similar to create a public URL for your local server.
    ```bash
    ngrok http 3001
    ```
    Copy the HTTPS URL (e.g., `https://1234-56-78.ngrok-free.app`).

## Configure VPS

On your VPS (in the `drum-remover-app` directory), update your `.env` or Docker environment:

```env
SELF_HOSTED_YTDLP_URL=https://YOUR-NGROK-URL.ngrok-free.app/download
```

(You can keep `RAPIDAPI_KEY` set; the app will try RapidAPI first, fail, and then automatically fall back to this proxy).
