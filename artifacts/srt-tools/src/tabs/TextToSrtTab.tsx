import { useMemo, useState } from "react";
import { ArrowRight, Copy, Download, FileText, Send, Sparkles, Wand2, X, Zap } from "lucide-react";
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

// Cleans messy raw transcripts (YouTube auto-caption style) into "0:00 - text" format.
// Handles: duplicate time descriptions ("13 seconds", "1 minute, 7 seconds"),
// fused timestamps ("0:1313 seconds"), and missing " - " separator.
function cleanRawTranscript(raw: string): string {
  const lines = raw.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(""); continue; }

    // Match H:MM:SS or M:SS timestamp at start, then any extra fused digits after
    // e.g. "0:1313 seconds…" → ts="0:13", extra="13"
    // e.g. "1:00:001 hour" → ts="1:00:00", extra="1"
    const m = trimmed.match(/^(\d+:\d{2}(?::\d{2})?)(\d*)([\s\S]*)$/);
    if (!m) { out.push(trimmed); continue; }

    const ts = m[1];
    let rest = m[2] + m[3]; // extra fused digits + rest of line

    // Remove duplicate time description at the very start of rest.
    // Order matters: longest/most-specific first.
    // Hours: "1 hour", "1 hour, 8 seconds", "1 hour, 2 minutes, 8 seconds"
    rest = rest.replace(/^\s*\d+\s+hours?(?:,\s*\d+\s+minutes?(?:,\s*\d+\s+seconds?)?)?(?:,\s*\d+\s+seconds?)?/i, "");
    // Minutes+seconds: "2 minutes, 34 seconds"
    rest = rest.replace(/^\s*\d+\s+minutes?,\s*\d+\s+seconds?/i, "");
    // Minutes only: "1 minute"
    rest = rest.replace(/^\s*\d+\s+minutes?/i, "");
    // Seconds only: "13 seconds"
    rest = rest.replace(/^\s*\d+\s+seconds?/i, "");

    // Strip leading " - " or just a dash
    rest = rest.replace(/^\s*[-–]\s*/, "").trim();

    if (rest) out.push(`${ts} - ${rest}`);
  }

  // Remove trailing blank lines
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

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

interface Props {
  onLoadToMerger?: (srt: string, filename: string) => void;
  onLoadToEditor?: (srt: string, filename: string) => void;
}

export default function TextToSrtTab({ onLoadToMerger, onLoadToEditor }: Props) {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [generatedEntries, setGeneratedEntries] = useState<Entry[]>([]);
  const [isGenerated, setIsGenerated] = useState(false);

  const parsedEntries = useMemo(() => parseInput(input), [input]);
  const entries = isGenerated ? generatedEntries : [];
  const srtOutput = useMemo(
    () => (generatedEntries.length > 0 ? toSrt(generatedEntries) : ""),
    [generatedEntries]
  );

  const handleGenerate = () => {
    const result = parseInput(input);
    if (result.length === 0) {
      toast({ title: "Nothing to generate", description: "Add some timestamped lines first" });
      return;
    }
    setGeneratedEntries(result);
    setIsGenerated(true);
    toast({ title: "Generated!", description: `${result.length} subtitle${result.length !== 1 ? "s" : ""}` });
  };

  const handleCopyAll = () => {
    if (!srtOutput) return;
    navigator.clipboard.writeText(srtOutput);
    toast({ title: "Copied!", description: `${generatedEntries.length} subtitles copied` });
  };

  const handleCopyCard = (idx: number) => {
    const e = generatedEntries[idx];
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
        <div className="flex items-center gap-2">
          {isGenerated && srtOutput && onLoadToEditor && (
            <button
              onClick={() => onLoadToEditor(srtOutput, "text-to-srt.srt")}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-violet-500 hover:bg-violet-600 rounded-lg px-3 py-1.5 shadow-sm transition-colors"
            >
              <Send className="h-3.5 w-3.5" /> L Editor
            </button>
          )}
          {isGenerated && srtOutput && onLoadToMerger && (
            <button
              onClick={() => onLoadToMerger(srtOutput, "text-to-srt.srt")}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg px-3 py-1.5 shadow-sm transition-colors"
            >
              <Send className="h-3.5 w-3.5" /> L Marger
            </button>
          )}
          {parsedEntries.length > 0 && (
            <button
              onClick={handleGenerate}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg px-3 py-1.5 shadow-sm transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" /> Generate
            </button>
          )}
          {input && (
            <button
              onClick={() => { setInput(""); setGeneratedEntries([]); setIsGenerated(false); }}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 border border-gray-200 dark:border-gray-700 rounded-lg px-2.5 py-1 hover:border-red-300 transition-colors"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          )}
          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg px-3 py-1.5 shadow-sm transition-colors"
          >
            <Zap className="h-3.5 w-3.5" /> Auto Gen
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden gap-3 p-3">

        {/* Left: Input */}
        <div className="flex flex-1 flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between shrink-0">
            <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Input</span>
            <div className="flex items-center gap-1.5">
              {input.trim() && (
                <button
                  onClick={() => {
                    const cleaned = cleanRawTranscript(input);
                    setInput(cleaned);
                    setGeneratedEntries([]);
                    setIsGenerated(false);
                    toast({ title: "Transcript cleaned", description: "Duplicate timestamps and format issues removed." });
                  }}
                  className="flex items-center gap-1 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-md px-2 py-0.5 transition-colors"
                  title="Remove duplicate time descriptions and fix format (e.g. 0:1313 seconds → 0:13 - text)"
                >
                  <Wand2 className="h-3 w-3" /> Clean
                </button>
              )}
              {parsedEntries.length > 0 && (
                <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded-full">
                  {parsedEntries.length} {parsedEntries.length === 1 ? "subtitle" : "subtitles"}
                </span>
              )}
            </div>
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
