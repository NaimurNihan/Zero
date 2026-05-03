import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Download, Sparkles, X, ChevronUp, ChevronDown, Plus, Trash2, FileText, Scissors, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface SrtMergerTabProps {
  onSendToName?: (srt: string, filename: string) => void;
  onTransform?: () => void;
  clearKey?: number;
  incomingSrt?: string;
  incomingFilename?: string;
  incomingKey?: number;
}

interface SRTEntry {
  index: number;
  startTime: string;
  endTime: string;
  text: string;
}

function parseSRT(content: string): SRTEntry[] {
  const blocks = content.trim().split(/\n\s*\n/);
  const entries: SRTEntry[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;
    const indexLine = lines[0].trim();
    const timeLine = lines[1].trim();
    const textLines = lines.slice(2).join("\n").trim();
    const timeMatch = timeLine.match(
      /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/
    );
    if (!timeMatch) continue;
    entries.push({
      index: parseInt(indexLine, 10) || entries.length + 1,
      startTime: timeMatch[1].replace(".", ","),
      endTime: timeMatch[2].replace(".", ","),
      text: textLines,
    });
  }
  return entries;
}

function timeToMs(t: string): number {
  const [hms, ms] = t.split(",");
  const [h, m, s] = hms.split(":").map(Number);
  return h * 3600000 + m * 60000 + s * 1000 + Number(ms);
}

function msToTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(mil).padStart(3, "0")}`;
}

function hasOverlaps(entries: SRTEntry[]): boolean {
  for (let i = 0; i < entries.length - 1; i++) {
    if (timeToMs(entries[i].endTime) > timeToMs(entries[i + 1].startTime)) return true;
  }
  return false;
}

function fixOverlapsInEntries(entries: SRTEntry[]): SRTEntry[] {
  return entries.map((entry, i) => {
    if (i < entries.length - 1) {
      const nextStart = timeToMs(entries[i + 1].startTime);
      const currentEnd = timeToMs(entry.endTime);
      if (currentEnd > nextStart) {
        const newEnd = Math.max(nextStart - 1, timeToMs(entry.startTime) + 1);
        return { ...entry, endTime: msToTime(newEnd) };
      }
    }
    return entry;
  });
}

const GAP_THRESHOLD_MS = 1;

function hasGaps(entries: SRTEntry[]): boolean {
  for (let i = 0; i < entries.length - 1; i++) {
    const currentEnd = timeToMs(entries[i].endTime);
    const nextStart = timeToMs(entries[i + 1].startTime);
    if (nextStart - currentEnd > GAP_THRESHOLD_MS) return true;
  }
  return false;
}

function countGaps(entries: SRTEntry[]): number {
  let count = 0;
  for (let i = 0; i < entries.length - 1; i++) {
    const currentEnd = timeToMs(entries[i].endTime);
    const nextStart = timeToMs(entries[i + 1].startTime);
    if (nextStart - currentEnd > GAP_THRESHOLD_MS) count++;
  }
  return count;
}

function countOverlaps(entries: SRTEntry[]): number {
  let count = 0;
  for (let i = 0; i < entries.length - 1; i++) {
    if (timeToMs(entries[i].endTime) > timeToMs(entries[i + 1].startTime)) count++;
  }
  return count;
}

function closeGapsInEntries(entries: SRTEntry[]): SRTEntry[] {
  const result = entries.map((e) => ({ ...e }));
  for (let i = 0; i < result.length - 1; i++) {
    const currentEnd = timeToMs(result[i].endTime);
    const nextStart = timeToMs(result[i + 1].startTime);
    if (nextStart - currentEnd > GAP_THRESHOLD_MS) {
      const nextEnd = timeToMs(result[i + 1].endTime);
      const newStart = Math.min(currentEnd + 1, nextEnd - 1);
      result[i + 1].startTime = msToTime(newStart);
    }
  }
  return result;
}

function stripLeadingNumber(line: string): string {
  return line.replace(
    /^\s*[\(\[\{]?\s*\d+\s*[\)\]\}\.\:\-–—]\s*/,
    ""
  );
}

function stripWrapperBraces(line: string): string {
  return line.replace(/^\s*[\{\[\(]\s*([\s\S]*?)\s*[\}\]\)]\s*$/, "$1");
}

function generateSRT(entries: SRTEntry[], sentences: string[]): string {
  const lines: string[] = [];
  const count = Math.min(entries.length, sentences.length);
  for (let i = 0; i < count; i++) {
    lines.push(`${i + 1}`);
    lines.push(`${entries[i].startTime} --> ${entries[i].endTime}`);
    lines.push(sentences[i].trim());
    lines.push("");
  }
  return lines.join("\n");
}

export default function SrtMergerTab({ onSendToName, onTransform, clearKey, incomingSrt, incomingFilename, incomingKey }: SrtMergerTabProps = {}) {
  const [srtEntries, setSrtEntries] = useState<SRTEntry[]>([]);
  const [sentenceText, setSentenceText] = useState("");
  const [addMoreText, setAddMoreText] = useState("");
  const [sentenceHistory, setSentenceHistory] = useState<string[]>([]);
  const [isGenerated, setIsGenerated] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [loadedFiles, setLoadedFiles] = useState<{ name: string; count: number }[]>([]);
  const [showNotepad, setShowNotepad] = useState(false);
  const [notepadText, setNotepadText] = useState("");
  const [notepadSplit, setNotepadSplit] = useState(false);
  const [copiedChunks, setCopiedChunks] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const lastIncomingKey = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("srt-merger-notepad");
      if (saved !== null) setNotepadText(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("srt-merger-notepad", notepadText);
    } catch {}
  }, [notepadText]);

  useEffect(() => {
    if (!incomingSrt?.trim()) return;
    if (incomingKey === lastIncomingKey.current) return;
    lastIncomingKey.current = incomingKey;
    clearSRT();
    setSrtEntries(parseSRT(incomingSrt));
    setFileName(incomingFilename || "Bangla.srt");
  }, [incomingSrt, incomingFilename, incomingKey]);

  useEffect(() => {
    if (clearKey === undefined) return;
    clearSRT();
    setSentenceText("");
    setAddMoreText("");
    setSentenceHistory([]);
    setIsGenerated(false);
  }, [clearKey]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ srt?: string; filename?: string }>).detail;
      if (!detail?.srt?.trim()) return;
      clearSRT();
      setSrtEntries(parseSRT(detail.srt));
      setFileName(detail.filename || "Bangla.srt");
    };
    window.addEventListener("srt-tools:merger-load-srt", handler);
    return () => window.removeEventListener("srt-tools:merger-load-srt", handler);
  }, []);

  const appendLinesToSentences = (lines: string[]) => {
    if (lines.length === 0) return;
    setSentenceHistory((h) => [...h, sentenceText]);
    setSentenceText((prev) => {
      const existing = prev.trim();
      return existing ? existing + "\n" + lines.join("\n") : lines.join("\n");
    });
    setIsGenerated(false);
  };

  const handleAddMore = () => {
    const newLines = addMoreText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (newLines.length === 0) return;
    appendLinesToSentences(newLines);
    setAddMoreText("");
    toast({ title: `${newLines.length} sentences added`, description: "Appended to existing list" });
  };

  const handleAddOrPaste = async () => {
    if (addMoreText.trim()) {
      handleAddMore();
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const newLines = text
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (newLines.length === 0) {
        toast({ title: "Clipboard is empty", description: "Copy some text first or type in the box" });
        return;
      }
      appendLinesToSentences(newLines);
      toast({ title: `${newLines.length} sentences pasted & added`, description: "Pulled from clipboard" });
    } catch {
      toast({
        title: "Can't read clipboard",
        description: "Paste into the box first, then click Add",
      });
    }
  };

  const handleCleanSentences = () => {
    const cleaned = sentenceText
      .split("\n")
      .map((l) =>
        stripWrapperBraces(stripLeadingNumber(l))
          .replace(/>+|<+/g, "")
          .replace(/\s*—\s*/g, ", ")
          .trim()
      )
      .filter((l) => l.length > 0)
      .join("\n");
    if (cleaned === sentenceText) {
      toast({ title: "Already clean", description: "Nothing to remove" });
      return;
    }
    setSentenceHistory((h) => [...h, sentenceText]);
    setSentenceText(cleaned);
    setIsGenerated(false);
    toast({ title: "Cleaned", description: "Numbers & brackets removed" });
  };

  const handleUndo = () => {
    if (sentenceHistory.length === 0) return;
    const prev = sentenceHistory[sentenceHistory.length - 1];
    setSentenceHistory((h) => h.slice(0, -1));
    setSentenceText(prev);
    toast({ title: "Undone", description: "Last added batch removed" });
  };

  const sentences = sentenceText
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const outputEntries = srtEntries.slice(0, sentences.length).map((entry, i) => ({
    ...entry,
    newText: sentences[i],
  }));

  const srtEntriesRef = useRef<SRTEntry[]>([]);
  useEffect(() => {
    srtEntriesRef.current = srtEntries;
  }, [srtEntries]);

  const readFileAsText = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(file, "utf-8");
    });

  const handleFiles = useCallback(
    async (files: File[]) => {
      const srtFiles = files.filter((f) => f.name.toLowerCase().endsWith(".srt"));
      if (srtFiles.length === 0) {
        toast({ title: "Invalid file", description: "Please upload .srt file(s)", variant: "destructive" });
        return;
      }

      const startedEmpty = srtEntriesRef.current.length === 0;
      let combined: SRTEntry[] = [...srtEntriesRef.current];
      const fileSummaries: { name: string; count: number }[] = [];

      for (const file of srtFiles) {
        try {
          const content = await readFileAsText(file);
          const parsed = parseSRT(content);
          if (parsed.length === 0) {
            toast({
              title: "Empty SRT skipped",
              description: `${file.name} has no entries`,
              variant: "destructive",
            });
            continue;
          }
          const offsetMs =
            combined.length > 0 ? timeToMs(combined[combined.length - 1].endTime) : 0;
          const shifted = parsed.map((e, idx) => ({
            index: combined.length + idx + 1,
            startTime: msToTime(timeToMs(e.startTime) + offsetMs),
            endTime: msToTime(timeToMs(e.endTime) + offsetMs),
            text: e.text,
          }));
          combined = [...combined, ...shifted];
          fileSummaries.push({ name: file.name, count: parsed.length });
        } catch {
          toast({
            title: "Read failed",
            description: `Could not read ${file.name}`,
            variant: "destructive",
          });
        }
      }

      if (fileSummaries.length === 0) return;

      setSrtEntries(combined);
      setLoadedFiles((prev) => [...prev, ...fileSummaries]);
      setFileName((prev) => prev || fileSummaries[0].name);
      setIsGenerated(false);

      const totalAdded = fileSummaries.reduce((s, f) => s + f.count, 0);
      toast({
        title: startedEmpty ? "SRT loaded" : `${fileSummaries.length} SRT appended`,
        description: `${totalAdded} entries added (total ${combined.length})`,
      });
    },
    [toast]
  );

  const handleFile = useCallback(
    (file: File) => {
      handleFiles([file]);
    },
    [handleFiles]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) handleFiles(files);
    },
    [handleFiles]
  );

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) handleFiles(files);
    if (e.target) e.target.value = "";
  };

  const moveEntry = (i: number, dir: -1 | 1) => {
    const next = i + dir;
    if (next < 0 || next >= srtEntries.length) return;
    const updated = [...srtEntries];
    [updated[i], updated[next]] = [updated[next], updated[i]];
    setSrtEntries(updated);
  };

  const deleteEntry = (i: number) => {
    setSrtEntries(srtEntries.filter((_, idx) => idx !== i));
  };

  const addEntryAfter = (i: number) => {
    const prev = srtEntries[i];
    const newEntry: SRTEntry = {
      index: prev.index + 1,
      startTime: prev.endTime,
      endTime: prev.endTime,
      text: "",
    };
    const updated = [...srtEntries];
    updated.splice(i + 1, 0, newEntry);
    setSrtEntries(updated);
  };

  const clearSRT = () => {
    setSrtEntries([]);
    setFileName("");
    setLoadedFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const fixOverlap = () => {
    const fixed = fixOverlapsInEntries(srtEntries);
    setSrtEntries(fixed);
    toast({ title: "Overlaps fixed!", description: "End times adjusted to remove overlaps" });
  };

  const closeGaps = () => {
    const fixed = closeGapsInEntries(srtEntries);
    setSrtEntries(fixed);
    toast({ title: "Gaps closed!", description: "Start times adjusted to remove gaps" });
  };

  const overlapCount = srtEntries.length > 1 ? countOverlaps(srtEntries) : 0;
  const overlapsExist = overlapCount > 0;
  const gapCount = srtEntries.length > 1 && !overlapsExist ? countGaps(srtEntries) : 0;
  const gapsExist = gapCount > 0;

  const runGenerate = () => {
    if (outputEntries.length === 0) {
      toast({ title: "Not ready", description: "Upload SRT and add sentences first", variant: "destructive" });
      return;
    }
    setIsGenerated(true);
    const content = generateSRT(srtEntries, sentences);
    onSendToName?.(content, fileName || "merged.srt");
    toast({ title: "SRT Generated!", description: `${outputEntries.length} subtitles merged → sent to SRT Name` });
  };

  const runGenerateRef = useRef(runGenerate);
  runGenerateRef.current = runGenerate;
  useEffect(() => {
    const h = () => runGenerateRef.current();
    window.addEventListener("srt-tools:merger-generate", h);
    return () => window.removeEventListener("srt-tools:merger-generate", h);
  }, []);

  const handleDownload = () => {
    if (outputEntries.length === 0) {
      toast({ title: "Nothing to download", description: "Generate output first", variant: "destructive" });
      return;
    }
    const content = generateSRT(srtEntries, sentences);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "output.srt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearAll = () => {
    clearSRT();
    setSentenceText("");
    setAddMoreText("");
    setSentenceHistory([]);
    setIsGenerated(false);
    setNotepadText("");
    setNotepadSplit(false);
    setCopiedChunks(new Set());
    toast({ title: "Cleared", description: "All merger data removed" });
  };

  const matchCount = Math.min(srtEntries.length, sentences.length);

  return (
    <div className="h-screen flex flex-col bg-[#f5f7fa] font-sans overflow-hidden">
      {/* Header — top card */}
      <div className="w-full mx-auto px-6 pt-4 flex-shrink-0">
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (srtEntries.length > 0) {
                setNotepadText((prev) => {
                  const existing = prev.trimEnd();
                  const numberMatches = existing.match(/\((\d+)\)/g);
                  const lastNum = numberMatches
                    ? Math.max(...numberMatches.map((m) => parseInt(m.slice(1, -1), 10) || 0))
                    : 0;
                  const converted = srtEntries
                    .map((entry, i) => `(${lastNum + i + 1}) { ${entry.text.replace(/\n/g, " ")} }`)
                    .join("\n");
                  return existing ? existing + "\n" + converted : converted;
                });
              }
              setShowNotepad(true);
            }}
            title="Open notepad — appends current SRT with continued numbering"
            className="p-1 -m-1 rounded hover:bg-emerald-50 transition-colors"
          >
            <FileText className="w-5 h-5 text-emerald-500" />
          </button>
          <span className="font-semibold text-gray-800 dark:text-gray-100 text-sm">SRT Merger</span>
          {matchCount > 0 && (
            <span className="ml-2 bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs px-2 py-0.5 rounded-full font-medium">
              ✓ {matchCount} lines matched
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleClearAll}
            variant="outline"
            className="border-gray-200 text-gray-600 hover:text-red-600 hover:border-red-300 text-xs h-7 px-2.5 gap-1 rounded-md shadow-sm"
          >
            <Trash2 className="w-3 h-3" />
            Clear All
          </Button>
          <Button
            onClick={runGenerate}
            className="bg-orange-500 hover:bg-orange-600 text-white text-xs h-7 px-2.5 gap-1 rounded-md shadow-sm"
          >
            <Sparkles className="w-3 h-3" />
            Generate
          </Button>
          <Button
            onClick={handleDownload}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-7 px-2.5 gap-1 rounded-md shadow-sm"
          >
            <Download className="w-3 h-3" />
            Download
          </Button>
        </div>
      </div>

      </div>

      {/* Three Cards */}
      <div className="w-full mx-auto px-6 py-4 grid grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Card 1 — SRT Upload */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 bg-emerald-500 text-white rounded-full text-xs flex items-center justify-center font-bold">1</span>
              <div>
                <div className="font-semibold text-gray-800 dark:text-gray-100 text-sm">SRT Input</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">Upload your SRT file</div>
              </div>
            </div>
            {srtEntries.length > 0 && (
              <div className="flex items-center gap-3">
                {overlapsExist && (
                  <button
                    onClick={fixOverlap}
                    className="text-xs text-red-500 hover:text-red-600 font-medium border border-red-200 hover:border-red-400 bg-red-50 hover:bg-red-100 px-2 py-0.5 rounded transition-colors"
                  >
                    Fix Overlap ({overlapCount})
                  </button>
                )}
                {gapsExist && (
                  <button
                    onClick={closeGaps}
                    className="text-xs text-orange-500 hover:text-orange-600 font-medium border border-orange-200 hover:border-orange-400 bg-orange-50 hover:bg-orange-100 px-2 py-0.5 rounded transition-colors"
                  >
                    Close Gaps ({gapCount})
                  </button>
                )}
                <button
                  onClick={() => {
                    const text = srtEntries.map((e, i) => `(${i + 1}) { ${e.text.replace(/\n/g, " ")} }`).join("\n");
                    navigator.clipboard.writeText(text).then(
                      () => toast({ title: "Copied", description: `Copied ${srtEntries.length} lines to clipboard` }),
                      () => toast({ title: "Copy failed", description: "Could not copy to clipboard", variant: "destructive" })
                    );
                  }}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-600 transition-colors"
                >
                  Copy all
                </button>
                <button onClick={() => { clearSRT(); setNotepadText(""); }} className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors">
                  Clear all
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {/* Drop Zone */}
            {srtEntries.length === 0 ? (
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/50"
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <Upload className="w-5 h-5 text-emerald-500" />
                </div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Drop SRT file here</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">or click to browse</p>
                <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">.srt files only</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".srt"
                  multiple
                  className="hidden"
                  onChange={onFileChange}
                />
              </div>
            ) : (
              <>
                {/* Loaded files badges */}
                <div className="space-y-1 mb-2">
                  {loadedFiles.length > 0 ? (
                    loadedFiles.map((f, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 px-2 py-1.5 bg-emerald-50 rounded-lg border border-emerald-100"
                      >
                        <span className="w-4 h-4 bg-emerald-500 text-white rounded text-[10px] flex items-center justify-center font-bold flex-shrink-0">
                          {idx + 1}
                        </span>
                        <FileText className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        <span className="text-xs text-emerald-700 font-medium truncate">{f.name}</span>
                        <span className="ml-auto text-xs text-emerald-500 flex-shrink-0">{f.count} entries</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-emerald-50 rounded-lg border border-emerald-100">
                      <FileText className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <span className="text-xs text-emerald-700 font-medium truncate">{fileName}</span>
                      <span className="ml-auto text-xs text-emerald-500">{srtEntries.length} entries</span>
                    </div>
                  )}
                  {loadedFiles.length > 1 && (
                    <div className="text-[11px] text-emerald-600/70 px-2">
                      Total: {srtEntries.length} entries · timestamps & numbering chained
                    </div>
                  )}
                </div>

                {/* Subtitle cards */}
                {srtEntries.map((entry, i) => {
                  const nextEntry = srtEntries[i + 1];
                  const currentEndMs = timeToMs(entry.endTime);
                  const nextStartMs = nextEntry ? timeToMs(nextEntry.startTime) : null;
                  const isOverlapping = nextStartMs !== null && currentEndMs > nextStartMs;
                  const hasGap =
                    nextStartMs !== null &&
                    !isOverlapping &&
                    nextStartMs - currentEndMs > GAP_THRESHOLD_MS;
                  return (
                  <div key={i} className={`border rounded-lg p-3 transition-colors ${
                    isOverlapping
                      ? "border-red-200 bg-red-50/40 hover:bg-red-50"
                      : hasGap
                        ? "border-orange-200 bg-orange-50/40 hover:bg-orange-50"
                        : "border-gray-100 bg-gray-50/50 hover:bg-white"
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className={`w-5 h-5 rounded text-xs flex items-center justify-center font-bold flex-shrink-0 ${
                          isOverlapping
                            ? "bg-red-100 text-red-600"
                            : hasGap
                              ? "bg-orange-100 text-orange-600"
                              : "bg-blue-100 text-blue-600"
                        }`}>
                          {i + 1}
                        </span>
                        <span className={`text-xs font-mono tabular-nums truncate ${
                          isOverlapping
                            ? "text-red-500"
                            : hasGap
                              ? "text-orange-500"
                              : "text-gray-500"
                        }`}>
                          {entry.startTime} → {entry.endTime}
                          {isOverlapping && <span className="ml-1 text-red-400">⚠</span>}
                          {hasGap && <span className="ml-1 text-orange-400">⌛</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          onClick={() => moveEntry(i, -1)}
                          disabled={i === 0}
                          className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
                        >
                          <ChevronUp className="w-3 h-3 text-gray-500 dark:text-gray-400" />
                        </button>
                        <button
                          onClick={() => moveEntry(i, 1)}
                          disabled={i === srtEntries.length - 1}
                          className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors"
                        >
                          <ChevronDown className="w-3 h-3 text-gray-500 dark:text-gray-400" />
                        </button>
                        <button
                          onClick={() => addEntryAfter(i)}
                          className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        >
                          <Plus className="w-3 h-3 text-gray-500 dark:text-gray-400" />
                        </button>
                        <button
                          onClick={() => deleteEntry(i)}
                          className="p-0.5 rounded hover:bg-red-100 transition-colors"
                        >
                          <Trash2 className="w-3 h-3 text-red-400" />
                        </button>
                      </div>
                    </div>
                    {entry.text && (
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 ml-7 leading-relaxed line-clamp-2">{entry.text}</p>
                    )}
                  </div>
                  );
                })}

                {/* Add another SRT button — appends with chained timestamps & numbering */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full mt-1 flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border border-dashed border-emerald-300 hover:border-emerald-400 rounded-lg py-2.5 transition-colors"
                  title="Append another SRT — numbering and timestamps continue from the last entry"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add another SRT
                  <span className="text-[10px] text-emerald-400 font-normal">(continues from {srtEntries.length + 1})</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".srt"
                  multiple
                  className="hidden"
                  onChange={onFileChange}
                />
              </>
            )}
          </div>
        </div>

        {/* Card 2 — Sentence Input */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 bg-emerald-500 text-white rounded-full text-xs flex items-center justify-center font-bold">2</span>
              <div>
                <div className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Sentence Input</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">One sentence per line</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {sentences.length > 0 && (
                <span className="bg-blue-50 text-blue-600 border border-blue-100 text-xs px-2 py-0.5 rounded-full font-medium">
                  {sentences.length} lines
                </span>
              )}
              {sentenceText && (
                <button
                  onClick={handleCleanSentences}
                  title="Remove leading numbers like (1), 1., [2] and wrapper brackets like { }"
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium border border-emerald-200 hover:border-emerald-400 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded transition-colors"
                >
                  ✨ Clean
                </button>
              )}
              {sentenceHistory.length > 0 && (
                <button
                  onClick={handleUndo}
                  title="Undo last change"
                  className="text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors"
                >
                  ⟲ Undo
                </button>
              )}
              {sentenceText && (
                <button
                  onClick={() => { setSentenceText(""); setSentenceHistory([]); }}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {sentences.length === 0 ? (
              <div className="relative h-full min-h-[300px]">
                {!sentenceText && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2 text-gray-400 dark:text-gray-500">
                    <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                      <FileText className="w-4 h-4" />
                    </div>
                    <p className="text-sm">Type or paste your sentences below</p>
                    <p className="text-xs">One sentence per line</p>
                  </div>
                )}
                <Textarea
                  value={sentenceText}
                  onChange={(e) => setSentenceText(e.target.value)}
                  placeholder=""
                  className="absolute inset-0 w-full h-full text-sm resize-none border-gray-200 dark:border-gray-700 focus:border-emerald-400 focus:ring-emerald-400 bg-transparent"
                />
              </div>
            ) : (
              <div className="space-y-2">
                {/* Add more sentences — top */}
                <div className="pb-3 mb-2 border-b border-dashed border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">+ Add more sentences (from {sentences.length + 1})</p>
                  <Textarea
                    value={addMoreText}
                    onChange={(e) => setAddMoreText(e.target.value)}
                    placeholder={"Paste next batch here...\nOne sentence per line"}
                    className="min-h-[120px] text-sm resize-none border-gray-200 dark:border-gray-700 focus:border-emerald-400 focus:ring-emerald-400"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.ctrlKey) {
                        e.preventDefault();
                        handleAddMore();
                      }
                    }}
                  />
                  <button
                    onClick={handleAddOrPaste}
                    className="mt-1.5 w-full text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 rounded-md py-1.5 transition-colors font-medium"
                  >
                    {addMoreText.trim() ? "Add to list (Ctrl+Enter)" : "Paste & Add from clipboard"}
                  </button>
                </div>

                {sentences.map((sentence, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 p-2.5 rounded-lg border transition-colors ${
                      i < srtEntries.length
                        ? "border-emerald-100 bg-emerald-50/40"
                        : "border-orange-100 bg-orange-50/40"
                    }`}
                  >
                    <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 mt-0.5 w-5 flex-shrink-0 text-right">
                      {i + 1}.
                    </span>
                    <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{sentence}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Card 3 — Output SRT */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 bg-emerald-500 text-white rounded-full text-xs flex items-center justify-center font-bold">3</span>
              <div>
                <div className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Output SRT</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">Preview & download</div>
              </div>
            </div>
            {isGenerated && outputEntries.length > 0 && (
              <span className="bg-orange-50 text-orange-600 border border-orange-100 text-xs px-2 py-0.5 rounded-full font-medium">
                {outputEntries.length} cards
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {!isGenerated ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3 py-12">
                <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Output will appear here</p>
                  <p className="text-xs mt-1">
                    {outputEntries.length > 0
                      ? "Click \"Generate SRT\" to create output"
                      : "Upload SRT + add sentences, then click Generate"}
                  </p>
                  {outputEntries.length > 0 && (
                    <p className="text-xs mt-2 text-emerald-500 font-medium">
                      ✓ {outputEntries.length} subtitles ready to generate
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                {outputEntries.map((entry, i) => (
                  <div key={i} className="border border-gray-100 dark:border-gray-800 rounded-lg p-3 hover:border-emerald-200 hover:bg-emerald-50/20 transition-colors">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-5 h-5 bg-emerald-500 text-white rounded text-xs flex items-center justify-center font-bold flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                        {entry.startTime} → {entry.endTime}
                      </span>
                    </div>
                    <p className="text-sm text-gray-800 dark:text-gray-100 ml-7 leading-relaxed">{entry.newText}</p>
                  </div>
                ))}
                {/* Mismatch warning */}
                {srtEntries.length > 0 && sentences.length > 0 && srtEntries.length !== sentences.length && (
                  <div className={`rounded-lg p-2.5 text-xs border ${
                    srtEntries.length > sentences.length
                      ? "bg-amber-50 border-amber-200 text-amber-700"
                      : "bg-blue-50 border-blue-200 text-blue-700"
                  }`}>
                    {srtEntries.length > sentences.length
                      ? `⚠️ ${srtEntries.length - sentences.length} extra timecodes — add more sentences`
                      : `ℹ️ ${sentences.length - srtEntries.length} extra sentences — only ${srtEntries.length} will be used`}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {showNotepad && (
        <div
          className="fixed z-50 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col overflow-hidden"
          style={{
            width: "calc((100vw - 56px) / 3)",
            height: "calc(100vh - 96px)",
            top: "72px",
            left: "24px",
          }}
        >
          <div className="contents">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-500" />
                <div>
                  <div className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Notepad</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">Quick notes — auto-saved</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {notepadText && (() => {
                  const parsed = parseSRT(notepadText);
                  if (parsed.length > 0) {
                    return (
                      <button
                        onClick={() => {
                          const converted = parsed
                            .map((e, i) => `(${i + 1}) { ${e.text.replace(/\n/g, " ")} }`)
                            .join("\n");
                          setNotepadText(converted);
                          toast({ title: "Converted", description: `${parsed.length} SRT entries → sentences` });
                        }}
                        className="text-xs text-emerald-600 hover:text-emerald-700 font-medium border border-emerald-200 hover:border-emerald-400 bg-emerald-50 hover:bg-emerald-100 px-2 py-0.5 rounded transition-colors"
                      >
                        Convert SRT → Sentences
                      </button>
                    );
                  }
                  return null;
                })()}
                {notepadText && (
                  <button
                    onClick={() => setNotepadSplit((v) => !v)}
                    className={`p-1 rounded transition-colors ${notepadSplit ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"}`}
                    title={notepadSplit ? "Exit split view" : "Split into 40-line chunks"}
                  >
                    <Scissors className="w-4 h-4" />
                  </button>
                )}
                {notepadText && (
                  <button
                    onClick={() => setNotepadText("")}
                    className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={() => setShowNotepad(false)}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                  title="Close"
                >
                  <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
            </div>
            <div className="flex-1 p-3 min-h-0 overflow-auto">
              {notepadSplit && notepadText ? (
                <div className="flex flex-col gap-3">
                  {(() => {
                    const lines = notepadText.split("\n");
                    const CHUNK = 40;
                    const chunks: { start: number; end: number; text: string }[] = [];
                    for (let i = 0; i < lines.length; i += CHUNK) {
                      const slice = lines.slice(i, i + CHUNK);
                      chunks.push({ start: i + 1, end: i + slice.length, text: slice.join("\n") });
                    }
                    return chunks.map((c, idx) => {
                      const isCopied = copiedChunks.has(idx);
                      return (
                      <div key={idx} className={`border rounded-lg overflow-hidden transition-colors ${isCopied ? "border-emerald-400 dark:border-emerald-500 bg-emerald-50/60 dark:bg-emerald-900/20" : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40"}`}>
                        <div className={`flex items-center justify-between px-3 py-1.5 border-b transition-colors ${isCopied ? "border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"}`}>
                          <div className="text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2">
                            <span className="font-semibold">{c.start}–{c.end}</span>
                            <span className="text-gray-400 dark:text-gray-500">{c.end - c.start + 1} lines</span>
                            {isCopied && <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-0.5">✓ Copied</span>}
                          </div>
                          <button
                            onClick={() => {
                              setCopiedChunks((prev) => {
                                const next = new Set(prev);
                                if (next.has(idx)) {
                                  next.delete(idx);
                                } else {
                                  next.add(idx);
                                  navigator.clipboard.writeText(c.text);
                                  toast({ title: "Copied", description: `Lines ${c.start}–${c.end}` });
                                }
                                return next;
                              });
                            }}
                            className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${isCopied ? "text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40" : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"}`}
                            title={isCopied ? "Click to undo" : "Copy this chunk"}
                          >
                            <Copy className="w-3 h-3" />
                            {isCopied ? "Undo" : "Copy"}
                          </button>
                        </div>
                        <pre className="px-3 py-1.5 text-xs leading-snug text-gray-800 dark:text-gray-100 whitespace-pre-wrap font-sans max-h-40 overflow-y-auto">{c.text}</pre>
                      </div>
                      );
                    });
                  })()}
                </div>
              ) : (
              <Textarea
                value={notepadText}
                onChange={(e) => setNotepadText(e.target.value)}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text");
                  if (!pasted) return;
                  const parsed = parseSRT(pasted);
                  if (parsed.length === 0) return;
                  e.preventDefault();
                  const target = e.currentTarget;
                  const start = target.selectionStart ?? notepadText.length;
                  const end = target.selectionEnd ?? notepadText.length;
                  const before = notepadText.slice(0, start);
                  const after = notepadText.slice(end);
                  // Continue numbering from the highest (N) found before cursor
                  const numberMatches = before.match(/\((\d+)\)/g);
                  const lastNum = numberMatches
                    ? Math.max(...numberMatches.map((m) => parseInt(m.slice(1, -1), 10) || 0))
                    : 0;
                  const converted = parsed
                    .map((entry, i) => `(${lastNum + i + 1}) { ${entry.text.replace(/\n/g, " ")} }`)
                    .join("\n");
                  const needsLeadingNl = before.length > 0 && !before.endsWith("\n");
                  const insert = (needsLeadingNl ? "\n" : "") + converted;
                  setNotepadText(before + insert + after);
                  toast({
                    title: "Converted",
                    description:
                      lastNum > 0
                        ? `${parsed.length} entries → continued from (${lastNum + 1})`
                        : `${parsed.length} SRT entries → sentences`,
                  });
                }}
                placeholder="Paste SRT here — auto-converts to numbered sentences. Paste another SRT and numbering continues from where it left off."
                className="w-full h-full text-sm resize-none border-gray-200 dark:border-gray-700 focus:border-emerald-400 focus:ring-emerald-400"
              />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
