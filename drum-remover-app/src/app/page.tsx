"use client";

import { useState } from "react";

interface SearchResult {
  id: string;
  title: string;
  thumbnail: string;
  duration: string;
  channel: string;
}

interface HistoryItem extends SearchResult {
  downloadUrl: string;
  timestamp: number;
}

type ProcessingStep = "idle" | "searching" | "downloading" | "processing" | "done" | "error";

export default function Home() {
  const [songName, setSongName] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [step, setStep] = useState<ProcessingStep>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [progress, setProgress] = useState(0);

  const handleSearch = async () => {
    if (!songName.trim()) return;

    setStep("searching");
    setStatusMessage("SEARCHING DATABASE...");
    setError("");
    setSearchResults([]);
    setDownloadUrl("");

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(songName)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "SEARCH FAILED");
      }

      setSearchResults(data.results);
      setStep("idle");
      setStatusMessage("");
    } catch (err) {
      setStep("error");
      setError(err instanceof Error ? err.message : "SYSTEM ERROR");
    }
  };

  const handleProcess = async (result: SearchResult) => {
    setStep("downloading");
    setStatusMessage("INITIATING DOWNLOAD...");
    setError("");

    try {
      // Start processing
      const response = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: result.id, title: result.title }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "PROCESS FAILED");
      }

      // Poll for status
      const jobId = data.jobId;
      setStep("processing");
      setProgress(0);
      setStatusMessage("SEPARATING AUDIO TRACKS...");

      const pollStatus = async () => {
        const statusRes = await fetch(`/api/status?jobId=${jobId}`);
        const statusData = await statusRes.json();

        if (statusData.status === "completed") {
          setProgress(100);
          setStep("done");
          setStatusMessage("PROCESS COMPLETE");
          setDownloadUrl(statusData.downloadUrl);
          
          // Add to history
          setHistory(prev => {
            // Avoid duplicates
            if (prev.some(item => item.id === result.id)) return prev;
            return [{
              ...result,
              downloadUrl: statusData.downloadUrl,
              timestamp: Date.now()
            }, ...prev];
          });
        } else if (statusData.status === "failed") {
          throw new Error(statusData.error || "PROCESSING FAILED");
        } else {
          // Update progress if available
          if (typeof statusData.progress === "number") {
            setProgress(statusData.progress);
            if (statusData.status === "downloading") {
              setStatusMessage("DOWNLOADING AUDIO...");
            } else {
              setStatusMessage(`SEPARATING AUDIO... ${statusData.progress}%`);
            }
          }
          // Still processing, poll again
          setTimeout(pollStatus, 2000);
        }
      };

      await pollStatus();
    } catch (err) {
      setStep("error");
      setError(err instanceof Error ? err.message : "SYSTEM ERROR");
    }
  };

  const handleReset = () => {
    setSongName("");
    setSearchResults([]);
    setStep("idle");
    setStatusMessage("");
    setDownloadUrl("");
    setError("");
    setProgress(0);
  };

  const restoreFromHistory = (item: HistoryItem) => {
    setDownloadUrl(item.downloadUrl);
    setStep("done");
    setStatusMessage("RESTORED FROM LOG");
    setSearchResults([]);
  };

  const isProcessing = step === "searching" || step === "downloading" || step === "processing";

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center p-6 overflow-hidden">
      
      {/* Corner Navigation / Decoration */}
      <div className="absolute top-8 left-8 corner-text font-bold">
        DRUM REMOVER
      </div>
      <div className="absolute top-8 right-8 corner-text">
        V 1.0
      </div>
      <div className="absolute bottom-8 left-8 corner-text hidden md:block">
        <a href="https://github.com/IIEleven11" target="_blank" rel="noopener noreferrer" className="underline">
          https://github.com/IIEleven11
        </a>
      </div>
      <div className="absolute bottom-8 right-8 corner-text hidden md:block">
        Engineer: Jake Mottola
      </div>

      {/* Side Decorations */}
      <div className="absolute left-8 top-1/2 -translate-y-1/2 -rotate-90 origin-left corner-text hidden lg:block text-neutral-600">
        SYSTEM READY
      </div>
      <div className="absolute right-8 top-1/2 -translate-y-1/2 rotate-90 origin-right corner-text hidden lg:block text-neutral-600">
        AUDIO PROCESSING UNIT
      </div>

      <main className="w-full max-w-2xl z-10">
        
        {/* Central "Device" Interface */}
        <div className="relative">
          
          {/* Decorative Elements around the center */}
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 text-xs text-neutral-500 tracking-widest uppercase">
            Input Sequence
          </div>

          {/* Main Input Area */}
          <div className="bg-neutral-900/50 border border-neutral-800 p-1 backdrop-blur-sm">
            <div className="flex flex-col md:flex-row">
              <input
                type="text"
                value={songName}
                onChange={(e) => setSongName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="ENTER SONG TITLE..."
                className="flex-1 bg-black border-none text-white px-6 py-4 text-lg font-mono placeholder-neutral-600 focus:ring-1 focus:ring-accent outline-none uppercase"
                disabled={isProcessing}
              />
              <button
                onClick={handleSearch}
                disabled={isProcessing || !songName.trim()}
                className="bg-accent hover:bg-accent-hover disabled:bg-neutral-800 disabled:text-neutral-600 text-black font-bold px-8 py-4 transition-colors uppercase tracking-wider"
              >
                {step === "searching" ? "SCANNING" : "SEARCH"}
              </button>
            </div>
          </div>

          {/* Status Display */}
          <div className="mt-4 h-8 flex items-center justify-center">
            {statusMessage && (
              <div className="text-accent text-sm font-mono tracking-widest animate-pulse uppercase">
                [{statusMessage}]
              </div>
            )}
          </div>

          {/* Progress Bar */}
          {step === "processing" && (
            <div className="mt-4">
              <div className="h-2 bg-neutral-800 border border-neutral-700 overflow-hidden">
                <div 
                  className="h-full bg-accent transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 text-center text-xs text-neutral-500 font-mono">
                {progress > 0 ? `${progress}% COMPLETE` : "INITIALIZING..."}
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mt-4 border border-red-900 bg-red-900/20 p-4 text-center">
              <p className="text-red-500 font-mono text-sm uppercase tracking-wider mb-2">ERROR: {error}</p>
              <button
                onClick={handleReset}
                className="text-xs text-red-400 hover:text-red-300 underline uppercase"
              >
                RESET SYSTEM
              </button>
            </div>
          )}

        </div>

        {/* Processing Video Overlay */}
        {step === "processing" && (
          <div className="mt-12 border border-accent/20 bg-black p-2 animate-fade-in relative flex justify-center">
            <div className="absolute top-0 left-0 w-full h-1 bg-accent/50 animate-pulse"></div>
            <div className="relative overflow-hidden bg-neutral-900 max-w-[252px]">
              <video
                src="/me_and_father.webm"
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-auto opacity-80"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-6">
                <div className="font-mono text-xs text-accent uppercase tracking-widest animate-pulse">
                  /// PROCESSING AUDIO STREAMS ///
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results List */}
        {searchResults.length > 0 && step === "idle" && (
          <div className="mt-12 border-t border-neutral-800 pt-8 animate-fade-in">
            <div className="text-xs text-neutral-500 mb-6 uppercase tracking-widest text-center">
              Select Target Track
            </div>
            <div className="grid gap-4">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleProcess(result)}
                  className="group flex items-center gap-4 p-2 hover:bg-neutral-900 border border-transparent hover:border-neutral-800 transition-all text-left"
                >
                  <div className="w-16 h-16 bg-neutral-800 overflow-hidden relative grayscale group-hover:grayscale-0 transition-all">
                    <img
                      src={result.thumbnail}
                      alt={result.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate group-hover:text-accent transition-colors uppercase">
                      {result.title}
                    </p>
                    <p className="text-xs text-neutral-500 mt-1 font-mono">
                      {result.channel} // {result.duration}
                    </p>
                  </div>
                  <div className="text-neutral-600 group-hover:text-accent transition-colors">
                    →
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Download Section */}
        {downloadUrl && (
          <div className="mt-12 border border-accent/20 bg-accent/5 p-8 text-center animate-fade-in relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-accent"></div>
            
            <h2 className="text-2xl font-bold text-white mb-8 uppercase tracking-tight">
              Separation Complete
            </h2>

            {/* Audio Player */}
            <div className="mb-8 bg-black border border-neutral-800 p-4">
              <div className="text-xs text-neutral-500 mb-2 uppercase tracking-widest text-left">
                Audio Preview
              </div>
              <audio
                controls
                src={downloadUrl}
                className="w-full h-8 invert opacity-80 hover:opacity-100 transition-opacity"
                preload="metadata"
              >
                Your browser does not support the audio element.
              </audio>
            </div>

            <div className="flex flex-col gap-4 items-center">
              <a
                href={downloadUrl}
                download
                className="w-full md:w-auto bg-accent hover:bg-accent-hover text-black font-bold px-10 py-4 uppercase tracking-wider transition-all hover:scale-105"
              >
                Download Track
              </a>
            </div>
          </div>
        )}

        {/* History / Session Log */}
        {history.length > 0 && (
          <div className="mt-16 border-t border-neutral-800 pt-8">
            <div className="text-xs text-neutral-500 mb-6 uppercase tracking-widest text-center">
              Session Log
            </div>
            <div className="space-y-2">
              {history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => restoreFromHistory(item)}
                  className="w-full flex items-center justify-between p-3 bg-neutral-900/30 hover:bg-neutral-900 border border-transparent hover:border-neutral-800 transition-all group text-left"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-2 h-2 bg-accent rounded-full opacity-50 group-hover:opacity-100"></div>
                    <span className="text-xs font-mono text-neutral-400 group-hover:text-white truncate uppercase">
                      {item.title}
                    </span>
                  </div>
                  <span className="text-[10px] text-neutral-600 font-mono uppercase">
                    RESTORE
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
