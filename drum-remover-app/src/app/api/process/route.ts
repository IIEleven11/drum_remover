import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

const execAsync = promisify(exec);

// In-memory job storage (for demo - use Redis/DB in production)
const jobs = new Map<string, {
  status: "pending" | "downloading" | "processing" | "completed" | "failed";
  error?: string;
  downloadUrl?: string;
  title: string;
}>();

// Export jobs map for status route
export { jobs };

export async function POST(request: NextRequest) {
  try {
    const { videoId, title } = await request.json();

    if (!videoId) {
      return NextResponse.json({ error: "Video ID is required" }, { status: 400 });
    }

    // Vercel serverless cannot run Demucs/FFmpeg/Python reliably.
    // If a backend is configured, proxy the request there and return its jobId.
    const backendBaseUrl = process.env.DRUM_REMOVER_BACKEND_URL;
    if (process.env.VERCEL && backendBaseUrl) {
      const backendUrl = `${backendBaseUrl.replace(/\/$/, "")}/api/process`;
      const res = await fetch(backendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, title }),
      });

      const text = await res.text();
      return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
      });
    }

    const jobId = uuidv4();
    jobs.set(jobId, { status: "pending", title });

    // Start processing in background
    processAudio(jobId, videoId, title).catch(console.error);

    return NextResponse.json({ jobId, message: "Processing started" });
  } catch (error) {
    console.error("Process error:", error);
    return NextResponse.json(
      { error: "Failed to start processing" },
      { status: 500 }
    );
  }
}

async function downloadWithRapidApi(videoId: string, outputPath: string): Promise<boolean> {
  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost = process.env.RAPIDAPI_HOST || "youtube-search-and-download.p.rapidapi.com";

  if (!apiKey) return false;

  try {
    console.log("Attempting download with RapidAPI...");

    const url = `https://${apiHost}/video/download?id=${encodeURIComponent(videoId)}`;
    const response = await fetch(url, {
      headers: {
        "x-rapidapi-host": apiHost,
        "x-rapidapi-key": apiKey,
        "accept": "application/json",
      },
    });

    if (!response.ok) {
      console.log(`RapidAPI download endpoint returned ${response.status}`);
      return false;
    }

    const data: any = await response.json();

    // RapidAPI responses vary; try a few common shapes.
    // Prefer an audio-only URL when present.
    const candidateUrls: string[] = [];
    const pushUrl = (v: unknown) => {
      if (typeof v === "string" && v.startsWith("http")) candidateUrls.push(v);
    };

    pushUrl(data?.link);
    pushUrl(data?.url);
    pushUrl(data?.downloadUrl);
    pushUrl(data?.download_url);

    const collectFromList = (list: any[]) => {
      for (const item of list) {
        pushUrl(item?.url);
        pushUrl(item?.link);
        pushUrl(item?.downloadUrl);
      }
    };

    if (Array.isArray(data?.formats)) collectFromList(data.formats);
    if (Array.isArray(data?.adaptiveFormats)) collectFromList(data.adaptiveFormats);
    if (Array.isArray(data?.streams)) collectFromList(data.streams);
    if (Array.isArray(data?.audioStreams)) collectFromList(data.audioStreams);

    // Heuristic: pick first URL that looks like audio; else first URL.
    const chosen =
      candidateUrls.find((u) => /audio|mime=audio|\bm4a\b|\bmp3\b|\bwebm\b/i.test(u)) ||
      candidateUrls[0];

    if (!chosen) {
      console.log("RapidAPI response did not contain a usable download URL");
      return false;
    }

    const mediaRes = await fetch(chosen);
    if (!mediaRes.ok || !mediaRes.body) {
      console.log(`Failed to fetch media URL: ${mediaRes.status}`);
      return false;
    }

    await pipeline(Readable.fromWeb(mediaRes.body as any), fs.createWriteStream(outputPath));
    return fs.existsSync(outputPath);
  } catch (error) {
    console.log("RapidAPI download failed:", error);
    return false;
  }
}

function peekFileHeader(filePath: string, maxBytes: number = 512): string {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const n = fs.readSync(fd, buf, 0, maxBytes, 0);
      return buf.subarray(0, n).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

async function normalizeForDemucs(inputPath: string, outputWavPath: string): Promise<string> {
  // Demucs uses torchaudio/ffmpeg to decode. Some RapidAPI URLs return non-audio
  // or containers that decode unreliably; normalizing via ffmpeg makes this robust.
  try {
    await execAsync(
      `ffmpeg -y -hide_banner -loglevel error -i "${inputPath}" -vn -ac 2 -ar 44100 "${outputWavPath}"`,
      { timeout: 180000 }
    );
    if (fs.existsSync(outputWavPath)) return outputWavPath;
  } catch (e: any) {
    const stderr = typeof e?.stderr === "string" ? e.stderr : String(e);
    throw new Error(
      `Failed to normalize downloaded media for Demucs (ffmpeg). This usually means the downloaded file is not valid audio.\n\nffmpeg error:\n${stderr}`
    );
  }

  throw new Error("Failed to normalize downloaded media for Demucs");
}

async function processAudio(jobId: string, videoId: string, title: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  const homedir = process.env.HOME || "/drum-remover-app";
  // Use /tmp for Vercel/Serverless environments
  const audioDir = process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "public", "audio");
  const demucsOutputDir = path.join(audioDir, "separated");
  const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
  const inputFile = path.join(audioDir, `${jobId}_input.mp3`);
  const normalizedInputFile = path.join(audioDir, `${jobId}_input.wav`);
  const finalOutputFile = path.join(audioDir, `${jobId}_no_drums.mp3`);

  try {
    if (process.env.VERCEL) {
      throw new Error(
        "Demucs is not available on Vercel serverless. Configure DRUM_REMOVER_BACKEND_URL to a Docker/VPS backend, or switch to a non-serverless host for processing."
      );
    }

    // Ensure directories exist
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    // Step 1: Download audio from YouTube
    job.status = "downloading";
    jobs.set(jobId, job);

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Downloading audio from: ${youtubeUrl}`);

    // Prefer RapidAPI on serverless (avoids bundling yt-dlp/deno and reduces bot-check issues)
    // Set RAPIDAPI_KEY in Vercel env vars. Do NOT hardcode it.
    let downloaded = await downloadWithRapidApi(videoId, inputFile);

    // Vercel serverless does NOT include python3; yt-dlp cannot run there.
    if (process.env.VERCEL && !downloaded) {
      throw new Error(
        "Download failed. On Vercel, yt-dlp cannot run because python3 is unavailable. Set RAPIDAPI_KEY (and optionally RAPIDAPI_HOST) in Vercel Environment Variables so the server can download audio via RapidAPI."
      );
    }

    // Fallback: yt-dlp (works in Docker/local)
    if (!downloaded) {
      // Determine yt-dlp path:
      // Prefer system yt-dlp (installed via pip in Docker/VPS). The bundled file
      // under .next/standalone/yt_dlp may lose executable permissions.
      const ytdlpPath = process.env.YTDLP_PATH || "yt-dlp";

      const ytdlpCommand = `${ytdlpPath} --remote-components ejs:npm -x --audio-format mp3 --audio-quality 0 -o "${inputFile}" "${youtubeUrl}"`;

      const { stdout: ytdlpOut, stderr: ytdlpErr } = await execAsync(ytdlpCommand, {
        timeout: 600000, // 10 min timeout
        env: { ...process.env, PATH: `${homedir}/.local/bin:${homedir}/.deno/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` }
      });

      console.log("yt-dlp stdout:", ytdlpOut);
      if (ytdlpErr) console.log("yt-dlp stderr:", ytdlpErr);
      downloaded = fs.existsSync(inputFile);
    }

    if (!downloaded || !fs.existsSync(inputFile)) {
      throw new Error("Failed to download audio file");
    }

    // Quick sanity check: sometimes APIs return HTML/JSON instead of media.
    const header = peekFileHeader(inputFile);
    if (header.includes("<html") || header.trimStart().startsWith("{") || header.toLowerCase().includes("rate limit")) {
      throw new Error(
        "Download did not return media data (got HTML/JSON). Try again, or verify your RapidAPI plan/limits."
      );
    }

    console.log(`Audio downloaded to: ${inputFile}`);

    // Normalize to WAV for Demucs to avoid torchaudio decode edge cases
    const demucsInput = await normalizeForDemucs(inputFile, normalizedInputFile);
    console.log(`Normalized audio for Demucs: ${demucsInput}`);

    // Step 2: Process with local Demucs
    job.status = "processing";
    jobs.set(jobId, job);

    console.log("Processing with Demucs (this may take a few minutes)...");

    // Determine Demucs command:
    // 1. Virtual Environment (local dev)
    // 2. System command (Docker/Global install)
    const venvPath = `${homedir}/.drum-remover-venv`;
    let demucsCommand;
    
    if (fs.existsSync(path.join(venvPath, "bin", "activate"))) {
       demucsCommand = `source ${venvPath}/bin/activate && python -m demucs -j 0 --segment 4 --two-stems drums -o "${demucsOutputDir}" "${demucsInput}"`;
    } else {
       // Assume system install (e.g. Docker)
       // Use -j 0 to disable multiprocessing (saves memory)
       // Use --segment 4 to reduce memory usage (default is 10)
       // Use OMP_NUM_THREADS=1 to further restrict parallelism
       demucsCommand = `export OMP_NUM_THREADS=1 && demucs -j 0 --segment 4 --two-stems drums -o "${demucsOutputDir}" "${demucsInput}"`;
    }

    const { stdout: demucsOut, stderr: demucsErr } = await execAsync(demucsCommand, {
      timeout: 1800000, // 30 min timeout for processing
      shell: "/bin/bash",
      env: { ...process.env }
    });

    console.log("Demucs stdout:", demucsOut);
    if (demucsErr) console.log("Demucs stderr:", demucsErr);

    // Demucs outputs to: separated/htdemucs/{filename}/no_drums.wav
    // Find the output file
    const inputBasename = path.basename(inputFile, ".mp3");
    const possiblePaths = [
      path.join(demucsOutputDir, "htdemucs", inputBasename, "no_drums.wav"),
      path.join(demucsOutputDir, "htdemucs", inputBasename, "no_drums.mp3"),
      path.join(demucsOutputDir, "htdemucs_6s", inputBasename, "no_drums.wav"),
    ];

    let drumlessWavFile = "";
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        drumlessWavFile = p;
        break;
      }
    }

    if (!drumlessWavFile) {
      // List what was actually created for debugging
      const separatedDir = path.join(demucsOutputDir, "htdemucs", inputBasename);
      if (fs.existsSync(separatedDir)) {
        const files = fs.readdirSync(separatedDir);
        console.log("Files in separated dir:", files);
      }
      throw new Error("Demucs processing completed but output file not found");
    }

    console.log(`Drumless audio created at: ${drumlessWavFile}`);

    // Convert WAV to MP3 for smaller file size (if ffmpeg available)
    try {
      await execAsync(`ffmpeg -i "${drumlessWavFile}" -codec:a libmp3lame -qscale:a 2 "${finalOutputFile}" -y`, {
        timeout: 120000
      });
      console.log(`Converted to MP3: ${finalOutputFile}`);
    } catch {
      // If ffmpeg not available, just copy the WAV file
      const wavOutput = finalOutputFile.replace(".mp3", ".wav");
      fs.copyFileSync(drumlessWavFile, wavOutput);
      console.log(`Copied WAV to: ${wavOutput}`);
    }

    // Clean up intermediate files
    try {
      fs.unlinkSync(inputFile);
      if (fs.existsSync(normalizedInputFile)) {
        fs.unlinkSync(normalizedInputFile);
      }
      // Clean up demucs output directory for this job
      const jobDemucsDir = path.join(demucsOutputDir, "htdemucs", inputBasename);
      if (fs.existsSync(jobDemucsDir)) {
        fs.rmSync(jobDemucsDir, { recursive: true });
      }
    } catch {
      // Ignore cleanup errors
    }

    // Determine the final output path for download
    const outputExists = fs.existsSync(finalOutputFile);
    const wavOutput = finalOutputFile.replace(".mp3", ".wav");
    const wavExists = fs.existsSync(wavOutput);

    if (!outputExists && !wavExists) {
      throw new Error("Failed to create final output file");
    }

    job.status = "completed";
    const finalFileName = path.basename(outputExists ? finalOutputFile : wavOutput);
    
    if (process.env.VERCEL) {
      job.downloadUrl = `/api/download?file=${finalFileName}`;
    } else {
      job.downloadUrl = `/audio/${finalFileName}`;
    }
    
    jobs.set(jobId, job);

    console.log(`Processing complete! Download URL: ${job.downloadUrl}`);

  } catch (error) {
    console.error("Processing error:", error);

    // Clean up on error
    try {
      if (fs.existsSync(inputFile)) {
        fs.unlinkSync(inputFile);
      }
    } catch {
      // Ignore cleanup errors
    }

    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Processing failed";
    jobs.set(jobId, job);
  }
}

