import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filename = searchParams.get("file");

  if (!filename) {
    return NextResponse.json({ error: "Filename is required" }, { status: 400 });
  }

  const backendBaseUrl = process.env.DRUM_REMOVER_BACKEND_URL;
  if (process.env.VERCEL && backendBaseUrl) {
    const safeFilename = path.basename(filename);
    const location = `${backendBaseUrl.replace(/\/$/, "")}/api/download?file=${encodeURIComponent(safeFilename)}`;
    return NextResponse.redirect(location, 302);
  }

  // Security check: prevent directory traversal
  const safeFilename = path.basename(filename);
  // For Docker, files are in /app/public/audio/; for Vercel, they're in /tmp
  const audioDir = process.env.VERCEL ? "/tmp" : "/app/public/audio";
  const filePath = path.join(audioDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    console.log(`File not found at: ${filePath}`);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileStats = fs.statSync(filePath);
    
    // Check if this is a request for inline playback vs download
    const mode = searchParams.get("mode"); // "play" for inline, default is download
    const contentDisposition = mode === "play" 
      ? `inline; filename="${safeFilename}"`
      : `attachment; filename="${safeFilename}"`;
    
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": contentDisposition,
        "Content-Length": fileStats.size.toString(),
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
  }
}
