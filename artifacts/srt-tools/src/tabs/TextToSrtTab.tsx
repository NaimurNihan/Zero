import { useMemo, useState } from "react";
import { ArrowRight, Copy, Download, FileText, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function parseTimestampMs(s: string): number | null {
  if (!s) return null;
  const norm = s.trim().replace(/\./g, ":");
  const parts = norm.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 1) return parts[0] * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return null;
}

function msToSrtTime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(mil).padStart(3, "0")}`;
}

const TS_PATTERN = "\\d{1,2}[:.:]\\d{2}(?:[:.:]\\d{2,3})?";
const LINE_RE = new RegExp(`^(${TS_PATTERN})\\s*[-–]\\s*(.+)$`);
const STANDALONE_RE = new RegExp(`^(${TS_PATTERN})$`);
const TRAILING_RE = new RegExp(`[\\s,]+(${TS_PATTERN})\\s*$`);

interface Entry {
  startMs: number;
  endMs: number;
  text: string;
}

function parseInput(raw: string): Entry[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const parsed: { startMs: number; text: string; trailingMs: number | null }[] = [];
  let standaloneEnd: number | null = null;

  for (const line of lines) {
    const lineMatch = line.match(LINE_RE);
    if (lineMatch) {
      const startMs = parseTimestampMs(lineMatch[1]);
      if (startMs === null) continue;
      let text = lineMatch[2].trim();
      let trailingMs: number | null = null;
      const trailMatch = text.match(TRAILING_RE);
      if (trailMatch) {
        const ms = parseTimestampMs(trailMatch[1]);
        if (ms !== null) {
          trailingMs = ms;
          text = text.slice(0, text.length - trailMatch[0].length).trim();
        }
      }
      parsed.push({ startMs, text, trailingMs });
      continue;
    }
    const soloMatch = line.match(STANDALONE_RE);
    if (soloMatch) {
      const ms = parseTimestampMs(soloMatch[1]);
      if (ms !== null) standaloneEnd = ms;
    }
  }

  if (parsed.length === 0) return [];

  return parsed.map((p, i) => {
    let endMs: number;
    if (i < parsed.length - 1) {
      endMs = parsed[i + 1].startMs;
    } else {
      if (p.trailingMs !== null && p.trailingMs > p.startMs) {
        endMs = p.trailingMs;
      } else if (standaloneEnd !== null && standaloneEnd > p.startMs) {
        endMs = standaloneEnd;
      } else {
        endMs = p.startMs + 5000;
      }
    }
    return { startMs: p.startMs, endMs, text: p.text };
  });
}

function toSrt(entries: Entry[]): string {
  return entries
    .map((e, i) => `${i + 1}\n${msToSrtTime(e.startMs)} --> ${msToSrtTime(e.endMs)}\n${e.text}`)
    .join("\n\n");
}

const PLACEHOLDER = `Example:

0:00 - Hello everyone, this is Mr. Junkie here!
0:10 - A long time ago in a fishing village of China...
0:18 - Seeing that the girl is upset... 0:25

Format: timestamp - text
Time formats accepted: 0:00 / 0.00 / 00:00:00
Each entry's end time = next entry's start time
Last entry end time (3 ways):
  1. At end of line: "0:18 - text 0:25"
  2. Separate line: "0:25"
  3. Omit: +5 seconds added automatically`;

export default function TextToSrtTab() {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const entries = useMemo(() => parseInput(input), [input]);
  const srtOutput = useMemo(() => (entries.length > 0 ? toSrt(entries) : ""), [entries]);

  const handleCopyAll = () => {
    if (!srtOutput) return;
    navigator.clipboard.writeText(srtOutput);
    toast({ title: "Copied!", description: `${entries.length} subtitles copied` });
  };

  const handleCopyCard = (idx: number) => {
    const e = entries[idx];
    const text = `${idx + 1}\n${msToSrtTime(e.startMs)} --> ${msToSrtTime(e.endMs)}\n${e.text}`;
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  };

  const handleDownload = () => {
    if (!srtOutput) return;
    const blob = new Blob([srtOutput], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "output.srt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="shrink-0 px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-800 dark:text-gray-100">Text → SRT</h1>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Convert timestamped text to SRT format</p>
          </div>
        </div>
        {input && (
          <button
            onClick={() => setInput("")}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 hover:border-red-300 transition-colors"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden gap-3 p-3">

        {/* Left: Input */}
        <div className="flex flex-1 flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
            <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Input</span>
            {entries.length > 0 && (
              <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full">
                {entries.length} {entries.length === 1 ? "subtitle" : "subtitles"}
              </span>
            )}
          </div>
          <textarea
            className="flex-1 w-full resize-none px-3 py-2.5 text-sm font-mono text-gray-800 dark:text-gray-100 bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none"
            placeholder={PLACEHOLDER}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* Arrow */}
        <div className="flex items-center justify-center shrink-0 self-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-500 dark:text-blue-400">
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>

        {/* Right: Output cards */}
        <div className="flex flex-1 flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
            <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">SRT Output</span>
            {srtOutput && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopyAll}
                  className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-300 border border-gray-200 dark:border-gray-700 rounded-md px-2 py-0.5 hover:border-blue-300 transition-colors"
                >
                  <Copy className="h-3 w-3" /> Copy All
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-1 text-[11px] text-white bg-blue-500 hover:bg-blue-600 rounded-md px-2 py-0.5 transition-colors"
                >
                  <Download className="h-3 w-3" /> Download
                </button>
              </div>
            )}
          </div>

          {entries.length > 0 ? (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {entries.map((entry, i) => (
                <div
                  key={i}
                  className="group border border-gray-100 dark:border-gray-800 rounded-lg p-3 hover:border-emerald-200 hover:bg-emerald-50/20 dark:hover:border-emerald-800 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 bg-emerald-500 text-white rounded text-xs flex items-center justify-center font-bold flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono tabular-nums">
                        {msToSrtTime(entry.startMs)} → {msToSrtTime(entry.endMs)}
                      </span>
                    </div>
                    <button
                      onClick={() => handleCopyCard(i)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 transition-all"
                    >
                      {copiedIdx === i ? <span className="text-[10px] text-emerald-500">✓</span> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                  <p className="text-sm text-gray-800 dark:text-gray-100 ml-7 leading-relaxed">
                    {entry.text}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-center px-6">
              <div className="text-gray-300 dark:text-gray-600">
                <FileText className="mx-auto mb-2 h-8 w-8" />
                <p className="text-xs">Type in the input box to see SRT cards here</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
