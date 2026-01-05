const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.post('/download', (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).send('URL is required');
    }

    console.log(`Requesting download for: ${url}`);

    // Use yt-dlp to stream the video directly to the response
    // -o - tells yt-dlp to write to stdout
    const ytDlp = spawn('yt-dlp', [
        '-f', 'bestaudio/best', // Best audio
        '-o', '-',              // Output to stdout
        url
    ]);

    // Set appropriate headers
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="download.mp3"');

    // Pipe yt-dlp stdout to response
    ytDlp.stdout.pipe(res);

    ytDlp.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    ytDlp.on('close', (code) => {
        console.log(`yt-dlp process exited with code ${code}`);
        if (code !== 0) {
            // If headers haven't been sent, send error
            if (!res.headersSent) {
                res.status(500).send('Download failed');
            }
        }
    });
});

app.get('/', (req, res) => {
    res.send('YouTube DL Proxy is running. POST to /download with { "url": "..." }');
});

app.listen(port, () => {
    console.log(`Proxy server running on port ${port}`);
});
