import { NextRequest, NextResponse } from "next/server";
import { jobs } from "../process/route";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
  }

  const backendBaseUrl = process.env.DRUM_REMOVER_BACKEND_URL;
  if (process.env.VERCEL && backendBaseUrl) {
    const backendUrl = `${backendBaseUrl.replace(/\/$/, "")}/api/status?jobId=${encodeURIComponent(jobId)}`;
    const res = await fetch(backendUrl, { cache: "no-store" });
    const text = await res.text();
    return new NextResponse(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") || "application/json" },
    });
  }

  const job = jobs.get(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    error: job.error,
    downloadUrl: job.downloadUrl,
    title: job.title,
    progress: job.progress,
  });
}

