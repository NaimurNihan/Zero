import { useEffect, useRef, useState } from "react";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import UploadBox from "@/tabs/trimmer/UploadBox";
import AudioCard from "@/tabs/trimmer/AudioCard";
import DownloadPanel from "@/tabs/trimmer/DownloadPanel";
import { Scissors, Trash2, FolderInput, Download, Check } from "lucide-react";
import JSZip from "jszip";

type SplitStage = "idle" | "preview" | "trimming" | "done";

interface VoiceTrimmerTabProps {
  onSendToCutting?: (files: File[]) => void;
  incomingAudioFiles?: { files: File[]; key: number; autoSplit?: boolean };
}

export default function VoiceTrimmerTab({ onSendToCutting, incomingAudioFiles }: VoiceTrimmerTabProps = {}) {
  const { audioFiles, addFiles, removeFile, trimAllFiles, resetTrim } = useAudioAnalysis();
  const [splitStage, setSplitStage] = useState<SplitStage>("idle");
  const [loaded, setLoaded] = useState(false);
  const [zipDownloaded, setZipDownloaded] = useState(false);
  const [zipAnimating, setZipAnimating] = useState(false);
  const lastIncomingKeyRef = useRef<number | null>(null);
  const audioFilesRef = useRef(audioFiles);
  audioFilesRef.current = audioFiles;
  const autoSplitPendingRef = useRef<{ key: number; expected: number } | null>(null);
  const autoSplitConfirmTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!incomingAudioFiles || incomingAudioFiles.files.length === 0) return;
    if (lastIncomingKeyRef.current === incomingAudioFiles.key) return;
    lastIncomingKeyRef.current = incomingAudioFiles.key;
    resetTrim();
    setSplitStage("idle");
    setLoaded(false);
    audioFilesRef.current.forEach((f) => removeFile(f.id));
    addFiles(incomingAudioFiles.files);
    if (incomingAudioFiles.autoSplit) {
      autoSplitPendingRef.current = {
        key: incomingAudioFiles.key,
        expected: incomingAudioFiles.files.length,
      };
    }
  }, [incomingAudioFiles, addFiles, removeFile, resetTrim]);

  useEffect(() => {
    const pending = autoSplitPendingRef.current;
    if (!pending) return;
    if (splitStage !== "idle") return;
    const readyNow = audioFiles.filter((f) => f.status === "ready" && !f.isTrimmed).length;
    if (readyNow < pending.expected) return;
    autoSplitPendingRef.current = null;
    setSplitStage("preview");
    autoSplitConfirmTimerRef.current = window.setTimeout(async () => {
      autoSplitConfirmTimerRef.current = null;
      setSplitStage("trimming");
      await trimAllFiles();
      setSplitStage("done");
    }, 5000);
  }, [audioFiles, splitStage, trimAllFiles]);

  useEffect(() => {
    return () => {
      if (autoSplitConfirmTimerRef.current !== null) {
        window.clearTimeout(autoSplitConfirmTimerRef.current);
      }
    };
  }, []);

  const readyCount = audioFiles.filter((f) => f.status === "ready" && !f.isTrimmed).length;
  const trimmedCount = audioFiles.filter((f) => f.isTrimmed).length;

  const handleSplitClick = async () => {
    if (splitStage === "idle") {
      setSplitStage("preview");
    } else if (splitStage === "preview") {
      setSplitStage("trimming");
      await trimAllFiles();
      setSplitStage("done");
    }
  };

  const handleClear = (broadcast: boolean = true) => {
    resetTrim();
    setSplitStage("idle");
    setLoaded(false);
    setZipDownloaded(false);
    setZipAnimating(false);
    audioFilesRef.current.forEach((f) => removeFile(f.id));
    if (broadcast) {
      window.dispatchEvent(
        new CustomEvent("srt-tools:clear-all-broadcast", {
          detail: { source: "audioSpliter" },
        }),
      );
    }
  };

  useEffect(() => {
    const onCrossClear = (e: Event) => {
      const detail = (e as CustomEvent<{ source?: string }>).detail;
      if (detail?.source === "audioSpliter") return;
      resetTrim();
      setSplitStage("idle");
      setLoaded(false);
      setZipDownloaded(false);
      setZipAnimating(false);
      audioFilesRef.current.forEach((f) => removeFile(f.id));
    };
    window.addEventListener("srt-tools:clear-all-broadcast", onCrossClear);
    return () =>
      window.removeEventListener("srt-tools:clear-all-broadcast", onCrossClear);
  }, [removeFile, resetTrim]);

  const isEmpty = audioFiles.length === 0;

  const handleDownloadZip = async () => {
    const trimmed = audioFiles.filter((f) => f.isTrimmed && f.trimmedBlob);
    if (trimmed.length === 0) return;
    setZipAnimating(true);
    const zip = new JSZip();
    for (const f of trimmed) {
      const baseName = f.name.replace(/\.[^.]+$/, "") + "_trimmed.wav";
      zip.file(baseName, f.trimmedBlob as Blob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trimmed_audios_${trimmed.length}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setZipDownloaded(true);
    window.setTimeout(() => setZipAnimating(false), 700);
  };

  const handleLoadToCutting = () => {
    if (!onSendToCutting) return;
    const trimmed = audioFiles.filter((f) => f.isTrimmed && f.trimmedBlob);
    if (trimmed.length === 0) return;
    const files: File[] = trimmed.map((f) => {
      const baseName = f.name.replace(/\.[^.]+$/, "") + "_trimmed.wav";
      return new File([f.trimmedBlob as Blob], baseName, { type: "audio/wav" });
    });
    onSendToCutting(files);
    setLoaded(true);
  };

  const splitLabel =
    splitStage === "idle" ? "Split" :
    splitStage === "preview" ? "Confirm Cut" :
    splitStage === "trimming" ? "Processing…" : "Split";

  const splitDisabled = splitStage === "trimming" || readyCount === 0;

  return (
    <div className="max-w-3xl mx-auto w-full px-6 py-5 flex flex-col gap-3">
      <UploadBox onFiles={addFiles} />

      {/* Controls bar */}
      <div className="rounded-xl flex items-center justify-between px-5 py-3" style={{
        background: "white",
        border: "1px solid hsl(220,15%,90%)",
        boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
      }}>
        <div>
          {audioFiles.length === 0 ? (
            <p className="text-xs" style={{ color: "hsl(220,10%,62%)" }}>Upload files to enable controls</p>
          ) : splitStage === "done" ? (
            <p className="text-xs" style={{ color: "hsl(185,65%,34%)" }}>
              ✓ {trimmedCount} file{trimmedCount !== 1 ? "s" : ""} trimmed — download each below
            </p>
          ) : splitStage === "preview" ? (
            <p className="text-xs" style={{ color: "hsl(220,10%,45%)" }}>
              {readyCount} file{readyCount !== 1 ? "s" : ""} ready to cut — click Confirm Cut to proceed
            </p>
          ) : (
            <p className="text-xs" style={{ color: "hsl(220,10%,55%)" }}>
              {audioFiles.length} file{audioFiles.length !== 1 ? "s" : ""} loaded — {readyCount} ready to trim
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {splitStage === "done" && trimmedCount > 0 && (
            <button
              onClick={handleDownloadZip}
              title={
                zipDownloaded
                  ? "ZIP downloaded — click to download again"
                  : `Download all ${trimmedCount} trimmed audios as ZIP`
              }
              className="zip-btn flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
              style={{
                background: zipDownloaded
                  ? "linear-gradient(90deg, hsl(142,72%,42%), hsl(155,75%,40%))"
                  : "linear-gradient(90deg, hsl(265,85%,58%), hsl(295,85%,55%))",
                boxShadow: zipDownloaded
                  ? "0 2px 10px rgba(34,197,94,0.45)"
                  : "0 1px 4px rgba(168,85,247,0.30)",
                transform: zipAnimating ? "scale(0.92)" : "scale(1)",
                transition:
                  "transform 0.18s cubic-bezier(0.34,1.56,0.64,1), background 0.35s ease, box-shadow 0.35s ease",
                animation: zipAnimating ? "zipPulse 0.7s ease" : undefined,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = zipAnimating
                  ? "scale(0.92)"
                  : "scale(1.06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = zipAnimating
                  ? "scale(0.92)"
                  : "scale(1)";
              }}
            >
              {zipDownloaded ? (
                <Check className="w-3 h-3" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              {zipDownloaded ? "ZIP ✓" : "ZIP"}
            </button>
          )}
          {splitStage === "done" && trimmedCount > 0 && onSendToCutting && (
            <button
              onClick={handleLoadToCutting}
              title="Send all trimmed audios to Cutting++ Audio Pool"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background: loaded ? "hsl(142,70%,40%)" : "hsl(220,90%,56%)",
                color: "white",
                boxShadow: loaded
                  ? "0 1px 4px rgba(34,197,94,0.30)"
                  : "0 1px 4px rgba(37,99,235,0.30)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = loaded
                  ? "hsl(142,70%,34%)"
                  : "hsl(220,90%,48%)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = loaded
                  ? "hsl(142,70%,40%)"
                  : "hsl(220,90%,56%)";
              }}
            >
              <FolderInput className="w-3 h-3" />
              {loaded ? "Loaded ✓" : "Load to Cutting++"}
            </button>
          )}
          <button
            onClick={() => handleClear(true)}
            title={
              isEmpty
                ? "Clear All — already empty (also clears Ai Audio)"
                : "Clear All (also clears Ai Audio)"
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border"
            style={{
              background: isEmpty
                ? "rgba(34,197,94,0.10)"
                : "rgba(239,68,68,0.10)",
              color: isEmpty ? "#16a34a" : "#ef4444",
              borderColor: isEmpty
                ? "rgba(34,197,94,0.35)"
                : "rgba(239,68,68,0.35)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isEmpty
                ? "rgba(34,197,94,0.18)"
                : "rgba(239,68,68,0.18)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isEmpty
                ? "rgba(34,197,94,0.10)"
                : "rgba(239,68,68,0.10)";
            }}
          >
            <Trash2 className="w-3 h-3" /> Clear All
          </button>
          {splitStage !== "done" && (
            <button
              onClick={handleSplitClick}
              disabled={splitDisabled}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: splitStage === "preview" ? "hsl(185,65%,30%)" : "hsl(185,65%,36%)",
                color: "white",
                boxShadow: splitStage === "preview"
                  ? "0 0 0 2px hsl(185,65%,70%)"
                  : "0 1px 4px rgba(15,160,155,0.25)",
              }}
              onMouseEnter={(e) => {
                if (!e.currentTarget.disabled) e.currentTarget.style.background = "hsl(185,65%,28%)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = splitStage === "preview"
                  ? "hsl(185,65%,30%)"
                  : "hsl(185,65%,36%)";
              }}
            >
              <Scissors className="w-3 h-3" /> {splitLabel}
            </button>
          )}
        </div>
      </div>

      {/* Audio Cards */}
      {audioFiles.length > 0 && (
        <div className="flex flex-col gap-2">
          {audioFiles.map((audio) => (
            <AudioCard
              key={audio.id}
              audio={audio}
              onRemove={removeFile}
              splitStage={splitStage}
            />
          ))}
        </div>
      )}

      {/* Download Panel */}
      {splitStage === "done" && <DownloadPanel files={audioFiles} />}
    </div>
  );
}
