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
  // For Docker/VPS, files are stored in /app/public/audio
  // For Vercel, files would be in /tmp (but Vercel redirects to backend anyway)
  const audioDir = process.env.VERCEL ? "/tmp" : "/app/public/audio";
  const filePath = path.join(audioDir, safeFilename);

  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${filePath}`);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    
    // Check if this is a download request or a playback request
    const isDownload = searchParams.get("download") === "true";
    
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": stat.size.toString(),
        "Accept-Ranges": "bytes",
        // Only set Content-Disposition for explicit downloads
        ...(isDownload ? { "Content-Disposition": `attachment; filename="${safeFilename}"` } : {}),
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
  }
}
