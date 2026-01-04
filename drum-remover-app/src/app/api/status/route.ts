import { NextRequest, NextResponse } from "next/server";
import { jobs } from "../process/route";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const jobId = searchParams.get("jobId");

  if (!jobId) {
    return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
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
  });
}

