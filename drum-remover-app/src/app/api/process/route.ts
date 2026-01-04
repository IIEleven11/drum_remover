import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

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

async function processAudio(jobId: string, videoId: string, title: string) {
  const job = jobs.get(jobId);
  if (!job) return;

  const homedir = process.env.HOME || "/home/eleven";
  // Use /tmp for Vercel/Serverless environments
  const audioDir = process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "public", "audio");
  const demucsOutputDir = path.join(audioDir, "separated");
  const safeTitle = title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50);
  const inputFile = path.join(audioDir, `${jobId}_input.mp3`);
  const finalOutputFile = path.join(audioDir, `${jobId}_no_drums.mp3`);

  try {
    // Ensure directories exist
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    // Step 1: Download audio from YouTube using yt-dlp
    job.status = "downloading";
    jobs.set(jobId, job);

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`Downloading audio from: ${youtubeUrl}`);

    // Use the updated yt-dlp with EJS support for YouTube bot detection
    const ytdlpPath = process.env.YTDLP_PATH || `/yt_dlp/yt-dlp`;
    const ytdlpCommand = `${ytdlpPath} --remote-components ejs:npm -x --audio-format mp3 --audio-quality 0 -o "${inputFile}" "${youtubeUrl}"`;

    const { stdout: ytdlpOut, stderr: ytdlpErr } = await execAsync(ytdlpCommand, {
      timeout: 600000, // 10 min timeout
      env: { ...process.env, PATH: `${homedir}/.local/bin:${homedir}/.deno/bin:${process.env.PATH}` }
    });

    console.log("yt-dlp stdout:", ytdlpOut);
    if (ytdlpErr) console.log("yt-dlp stderr:", ytdlpErr);

    if (!fs.existsSync(inputFile)) {
      throw new Error("Failed to download audio file");
    }

    console.log(`Audio downloaded to: ${inputFile}`);

    // Step 2: Process with local Demucs
    job.status = "processing";
    jobs.set(jobId, job);

    console.log("Processing with Demucs (this may take a few minutes)...");

    // Use the virtual environment's demucs
    const venvPath = `${homedir}/.drum-remover-venv`;
    const demucsCommand = `source ${venvPath}/bin/activate && python -m demucs --two-stems drums -o "${demucsOutputDir}" "${inputFile}"`;

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

