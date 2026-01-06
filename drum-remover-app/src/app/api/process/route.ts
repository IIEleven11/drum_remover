import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { exec, spawn } from "child_process";
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
  progress?: number; // 0-100 for processing progress
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
  const apiHost = process.env.RAPIDAPI_HOST || "yt-search-and-download-mp3.p.rapidapi.com";
  const hl = process.env.RAPIDAPI_HL;
  const gl = process.env.RAPIDAPI_GL;

  if (!apiKey) return false;





  try {
    console.log("Attempting download with RapidAPI...");

    const isYtSearchAndDownload = apiHost.includes("yt-search-and-download-mp3.p.rapidapi.com");
    let url: string;

    if (isYtSearchAndDownload) {
      const apiPath = "/mp3";
      const urlObj = new URL(`https://${apiHost}${apiPath}`);
      urlObj.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
      url = urlObj.toString();
    } else {
      const defaultPath = "/video/download";
      const apiPath = process.env.RAPIDAPI_DOWNLOAD_PATH || defaultPath;
      const urlObj = new URL(`https://${apiHost}${apiPath}`);
      urlObj.searchParams.set("id", videoId);
      if (hl) urlObj.searchParams.set("hl", hl);
      if (gl) urlObj.searchParams.set("gl", gl);
      url = urlObj.toString();
    }
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
    pushUrl(data?.download);
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
    if (Array.isArray(data?.streamingData?.formats)) collectFromList(data.streamingData.formats);
    if (Array.isArray(data?.streamingData?.adaptiveFormats)) collectFromList(data.streamingData.adaptiveFormats);

    // Heuristic: pick first URL that looks like audio; else first URL.
    const chosen =
      candidateUrls.find((u) => /audio|mime=audio|\bm4a\b|\bmp3\b|\bwebm\b/i.test(u)) ||
      candidateUrls[0];

    if (!chosen) {
      console.log("RapidAPI response did not contain a usable download URL");
      return false;
    }

    const chosenUrl = new URL(chosen);
    const mediaHeaders: Record<string, string> = {};
    // Some RapidAPI providers return a RapidAPI-hosted URL that still requires headers.
    if (chosenUrl.host === apiHost) {
      mediaHeaders["x-rapidapi-host"] = apiHost;
      mediaHeaders["x-rapidapi-key"] = apiKey;
    }

    const mediaRes = await fetch(chosen, { headers: mediaHeaders });
    if (!mediaRes.ok || !mediaRes.body) {
      console.log(`Failed to fetch media URL: ${mediaRes.status}`);
      return false;
    }

    const ctype = mediaRes.headers.get("content-type") || "";
    if (ctype.includes("application/json") || ctype.includes("text/html") || ctype.includes("text/plain")) {
      const body = await mediaRes.text().catch(() => "");
      console.log(`Media URL returned non-media content-type: ${ctype}`);
      console.log(body.slice(0, 300));
      return false;
    }

    await pipeline(Readable.fromWeb(mediaRes.body as any), fs.createWriteStream(outputPath));
    return fs.existsSync(outputPath);
  } catch (error) {
    console.log("RapidAPI download failed:", error);
    return false;
  }
}

type RapidApiAttempt =
  | { ok: true }
  | { ok: false; error: string };

async function downloadWithRapidApiDetailed(videoId: string, outputPath: string): Promise<RapidApiAttempt> {
  const apiKey = process.env.RAPIDAPI_KEY;
  const apiHost = process.env.RAPIDAPI_HOST || "yt-search-and-download-mp3.p.rapidapi.com";
  const hl = process.env.RAPIDAPI_HL;
  const gl = process.env.RAPIDAPI_GL;
  const cgeo = process.env.RAPIDAPI_CGEO;

  if (!apiKey) {
    return {
      ok: false,
      error:
        "RAPIDAPI_KEY is not set on the backend. Set RAPIDAPI_KEY (and optionally RAPIDAPI_HOST) in the VPS container environment.",
    };
  }

  try {
    const maskedKey = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : "***";
    console.log(`Attempting download with RapidAPI... Host: ${apiHost}, Key: ${maskedKey}`);

    const isYtSearchAndDownload = apiHost.includes("yt-search-and-download-mp3.p.rapidapi.com");
    let url: string;

    if (isYtSearchAndDownload) {
      const apiPath = "/mp3";
      const urlObj = new URL(`https://${apiHost}${apiPath}`);
      urlObj.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
      url = urlObj.toString();
    } else {
      let defaultPath = "/video/download";
      // const isYtApi = apiHost.includes("yt-api.p.rapidapi.com");
      // if (isYtApi) defaultPath = "/dl";

      const apiPath = process.env.RAPIDAPI_DOWNLOAD_PATH || defaultPath;
      const urlObj = new URL(`https://${apiHost}${apiPath}`);
      urlObj.searchParams.set("id", videoId);
      if (hl) urlObj.searchParams.set("hl", hl);
      if (gl) urlObj.searchParams.set("gl", gl);
      if (cgeo) urlObj.searchParams.set("cgeo", cgeo);
      url = urlObj.toString();
    }
    
    // Log the constructed URL (masking sensitive parts if any, though query params here are usually safe)
    console.log(`Requesting RapidAPI URL: ${url}`);

    const response = await fetch(url, {
      headers: {
        "x-rapidapi-host": apiHost,
        "x-rapidapi-key": apiKey,
        "accept": "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        error: `RapidAPI download endpoint (${url}) returned ${response.status}. ${body ? `Body: ${body.slice(0, 300)}` : ""}`.trim(),
      };
    }

    const data: any = await response.json();

    const candidateUrls: string[] = [];
    const pushUrl = (v: unknown) => {
      if (typeof v === "string" && v.startsWith("http")) candidateUrls.push(v);
    };
    pushUrl(data?.link);
    pushUrl(data?.url);
    pushUrl(data?.download);
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
    if (Array.isArray(data?.streamingData?.formats)) collectFromList(data.streamingData.formats);
    if (Array.isArray(data?.streamingData?.adaptiveFormats)) collectFromList(data.streamingData.adaptiveFormats);

    const chosen =
      candidateUrls.find((u) => /audio|mime=audio|\bm4a\b|\bmp3\b|\bwebm\b/i.test(u)) || candidateUrls[0];

    if (!chosen) {
      return {
        ok: false,
        error:
          "RapidAPI response did not contain a usable download URL (no link/url/formats/audioStreams fields matched).",
      };
    }

    const chosenUrl = new URL(chosen);
    const mediaHeaders: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "*/*",
      "Accept-Encoding": "identity;q=1, *;q=0",
      "Range": "bytes=0-",
    };
    // Some RapidAPI providers return a RapidAPI-hosted URL that still requires headers.
    if (chosenUrl.host === apiHost) {
      mediaHeaders["x-rapidapi-host"] = apiHost;
      mediaHeaders["x-rapidapi-key"] = apiKey;
    }

    const mediaRes = await fetch(chosen, { headers: mediaHeaders });
    if (!mediaRes.ok || !mediaRes.body) {
      return { ok: false, error: `Failed to fetch media URL (${chosen}): ${mediaRes.status}` };
    }

    const ctype = mediaRes.headers.get("content-type") || "";
    if (ctype.includes("application/json") || ctype.includes("text/html") || ctype.includes("text/plain")) {
      const body = await mediaRes.text().catch(() => "");
      return {
        ok: false,
        error: `Media URL returned non-media content-type (${ctype}). Body: ${body.slice(0, 300)}`,
      };
    }

    await pipeline(Readable.fromWeb(mediaRes.body as any), fs.createWriteStream(outputPath));
    if (!fs.existsSync(outputPath)) {
      return { ok: false, error: "Media download completed but file was not created" };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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

async function processAudio(jobId: string, videoId: string, title: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  const homedir = process.env.HOME || "/drum-remover-app";
  // Use /tmp for Vercel/Serverless environments
  // For Docker standalone, use /app/public/audio (not process.cwd() which points to .next/standalone)
  const audioDir = process.env.VERCEL ? "/tmp" : "/app/public/audio";
  const processedDir = path.join(audioDir, "separated"); // Renamed for clarity
  const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
  const inputFile = path.join(audioDir, `${jobId}_input.mp3`);
  const finalOutputFile = path.join(audioDir, `${jobId}_no_drums.mp3`);

  try {
    if (process.env.VERCEL) {
      throw new Error(
        "Audio processing is not available on Vercel serverless. Configure DRUM_REMOVER_BACKEND_URL to a Docker/VPS backend."
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

    // Prefer RapidAPI (avoids bot-check issues on datacenter IPs)
    // Set RAPIDAPI_KEY in env vars. Do NOT hardcode it.
    let downloaded = false;
    let rapidError = "";

    // If RAPIDAPI_KEY is set, try it first.
    if (process.env.RAPIDAPI_KEY) {
      const rapid = await downloadWithRapidApiDetailed(videoId, inputFile);
      downloaded = rapid.ok;
      if (!rapid.ok) rapidError = rapid.error;
    }

    // Vercel serverless does NOT include python3; yt-dlp cannot run there.
    if (process.env.VERCEL && !downloaded) {
      throw new Error(
        `Download failed. On Vercel, yt-dlp cannot run because python3 is unavailable. Set RAPIDAPI_KEY (and optionally RAPIDAPI_HOST) in Vercel Environment Variables so the server can download audio via RapidAPI.${rapidError ? `\n\nRapidAPI error: ${rapidError}` : ""}`
      );
    }

    // On the VPS backend, do not silently fall back to yt-dlp unless explicitly enabled.
    // This avoids surprise bot-check failures when the goal is RapidAPI-only.
    //
    // We require TWO signals:
    // - ALLOW_YTDLP_FALLBACK=1 (feature flag)
    // - YTDLP_PATH set (explicitly opting into *where* yt-dlp should come from)
    //
    // This prevents accidental fallback when old env vars linger.
    const allowYtdlpFallback =
      process.env.ALLOW_YTDLP_FALLBACK === "1" &&
      typeof process.env.YTDLP_PATH === "string" &&
      process.env.YTDLP_PATH.trim().length > 0;

    // Fallback: yt-dlp (optional; set ALLOW_YTDLP_FALLBACK=1 and YTDLP_PATH=yt-dlp)
    if (!downloaded && allowYtdlpFallback) {
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

    // NEW: Self-hosted API fallback (e.g. Cobalt, or a custom yt-dlp wrapper on another server)
    // If configured, try this before giving up.
    const selfHostedApi = process.env.SELF_HOSTED_YTDLP_URL; // e.g. https://my-downloader.com/api/download
    if (!downloaded && selfHostedApi) {
       console.log(`Attempting download via self-hosted API: ${selfHostedApi}`);
       try {
         const res = await fetch(selfHostedApi, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: youtubeUrl })
         });
         if (res.ok) {
            // Assume the API returns the file stream directly
            await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(inputFile));
            downloaded = fs.existsSync(inputFile);
         } else {
            console.log(`Self-hosted API returned ${res.status}`);
         }
       } catch (e) {
         console.log("Self-hosted API failed:", e);
       }
    }

    if (!downloaded && !allowYtdlpFallback) {
      throw new Error(
        `RapidAPI download failed and yt-dlp fallback is disabled. ${rapidError ? `\n\nRapidAPI error: ${rapidError}` : ""}`.trim()
      );
    }

    if (!downloaded || !fs.existsSync(inputFile)) {
      throw new Error("Failed to download audio file");
    }

    // Quick sanity check: sometimes APIs return HTML/JSON instead of media.
    const header = peekFileHeader(inputFile);
    if (header.includes("<html") || header.trimStart().startsWith("{") || header.toLowerCase().includes("rate limit")) {
      throw new Error(
        `Download did not return media data (got HTML/JSON). Header snippet: ${header.slice(0, 100)}. Try again, or verify your RapidAPI plan/limits.`
      );
    }

    console.log(`Audio downloaded to: ${inputFile}`);

    // Step 2: Process audio with Spleeter
    job.status = "processing";
    job.progress = 0;
    jobs.set(jobId, job);

    console.log("Processing with Spleeter...");

    const spleeterOutputDir = path.join(processedDir, "spleeter");
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(spleeterOutputDir)) {
      fs.mkdirSync(spleeterOutputDir, { recursive: true });
    }
    
    console.log("Starting Spleeter separation...");
    console.log(`Debug - MODEL_PATH: ${process.env.MODEL_PATH}`);
    try {
        const modelPath = path.join(process.env.MODEL_PATH || "pretrained_models", "4stems");
        if (fs.existsSync(modelPath)) {
            console.log(`Debug - Model contents: ${fs.readdirSync(modelPath).join(", ")}`);
        } else {
            console.log(`Debug - Model path not found: ${modelPath}`);
        }
    } catch (e) {
        console.log("Debug - Failed to check model path", e);
    }
    
    await new Promise<void>((resolve, reject) => {
      // spleeter separate -p spleeter:4stems -o {outputDir} {inputFile}
      const spleeter = spawn("spleeter", [
        "separate",
        "-p", "spleeter:4stems", // 4stems = vocals, drums, bass, other
        "-o", spleeterOutputDir,
        inputFile
      ], {
         env: { ...process.env }
      });

      spleeter.stdout.on("data", (data) => {
          console.log(`Spleeter: ${data}`);
      });
      spleeter.stderr.on("data", (data) => console.log(`Spleeter stderr: ${data}`));
      
      spleeter.on("close", (code, signal) => {
        if (code === 0) resolve();
        else reject(new Error(`Spleeter exited with code ${code} and signal ${signal}`));
      });
      
      spleeter.on("error", (err) => reject(err));
    });

    // Spleeter outputs to: {outputDir}/{filename_without_ext}/{stem}.wav
    const inputBasename = path.basename(inputFile, ".mp3");
    const stemsDir = path.join(spleeterOutputDir, inputBasename);

    const vocalsFile = path.join(stemsDir, "vocals.wav");
    const bassFile = path.join(stemsDir, "bass.wav");
    const otherFile = path.join(stemsDir, "other.wav");
    // drumsFile is intentionally ignored to create "drumless" track

    if (!fs.existsSync(vocalsFile)) {
       throw new Error(`Spleeter failed to produce stems in ${stemsDir}. Output dir content: ${fs.readdirSync(spleeterOutputDir).join(", ")}`);
    }

    console.log("Mixing stems to remove drums (vocals + bass + other)...");
    
    // Combine 3 stems into one MP3
    await execAsync(
      `ffmpeg -y -i "${vocalsFile}" -i "${bassFile}" -i "${otherFile}" -filter_complex "amix=inputs=3:duration=first" -c:a libmp3lame -q:a 2 "${finalOutputFile}"`,
      { timeout: 120000 }
    );

    // Clean up Spleeter artifacts immediately to save space
    try {
      fs.unlinkSync(inputFile);
      fs.rmSync(stemsDir, { recursive: true, force: true });
    } catch (e) { console.error("Cleanup error:", e); }

    // Final checks
    if (!fs.existsSync(finalOutputFile)) {
      throw new Error("FFmpeg mixing failed to create output file");
    }

    job.status = "completed";
    const finalFileName = path.basename(finalOutputFile);
    
    // Always use /api/download
    job.downloadUrl = `/api/download?file=${encodeURIComponent(finalFileName)}`;
    
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
