import { NextRequest, NextResponse } from "next/server";

interface YouTubeSearchResult {
  id: string;
  title: string;
  thumbnail: string;
  duration: string;
  channel: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q");

  if (!query) {
    return NextResponse.json({ error: "Search query is required" }, { status: 400 });
  }

  try {
    // Use YouTube's internal API (no API key needed)
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " official audio")}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const html = await response.text();
    
    // Extract the initial data JSON from the page
    const ytInitialDataMatch = html.match(/var ytInitialData = ({.+?});<\/script>/);
    
    if (!ytInitialDataMatch) {
      throw new Error("Could not parse YouTube results");
    }

    const ytInitialData = JSON.parse(ytInitialDataMatch[1]);
    
    // Navigate to the video results
    const contents = ytInitialData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    
    if (!contents) {
      return NextResponse.json({ results: [] });
    }

    const results: YouTubeSearchResult[] = [];
    
    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents;
      if (!items) continue;

      for (const item of items) {
        const video = item?.videoRenderer;
        if (!video) continue;

        const videoId = video.videoId;
        const title = video.title?.runs?.[0]?.text || "Unknown Title";
        const thumbnail = video.thumbnail?.thumbnails?.[0]?.url || "";
        const duration = video.lengthText?.simpleText || "Unknown";
        const channel = video.ownerText?.runs?.[0]?.text || "Unknown Channel";

        results.push({
          id: videoId,
          title,
          thumbnail,
          duration,
          channel,
        });

        if (results.length >= 5) break;
      }
      if (results.length >= 5) break;
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Failed to search for songs. Please try again." },
      { status: 500 }
    );
  }
}

