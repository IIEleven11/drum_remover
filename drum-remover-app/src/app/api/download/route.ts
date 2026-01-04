import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filename = searchParams.get("file");

  if (!filename) {
    return NextResponse.json({ error: "Filename is required" }, { status: 400 });
  }

  // Security check: prevent directory traversal
  const safeFilename = path.basename(filename);
  const filePath = path.join("/tmp", safeFilename);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json({ error: "Failed to download file" }, { status: 500 });
  }
}
