import { useState, useRef, useCallback } from "react";
import { Upload, Download, Sparkles, X, Music, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface AudioEntry {
  id: string;
  name: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}

function msToSrtTime(ms: number): string {
  const h = Math.floor(ms / 3600000).toString().padStart(2, "0");
  const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, "0");
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, "0");
  const msStr = (ms % 1000).toString().padStart(3, "0");
  return `${h}:${m}:${s},${msStr}`;
}

function msToDisplay(ms: number): string {
  const h = Math.floor(ms / 3600000).toString().padStart(2, "0");
  const m = Math.floor((ms % 3600000) / 60000).toString().padStart(2, "0");
  const s = Math.floor((ms % 60000) / 1000).toString().padStart(2, "0");
  const msStr = (ms % 1000).toString().padStart(3, "0");
  return `${h}:${m}:${s},${msStr}`;
}

const GAP_MS = 10;

async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const dur = audio.duration;
      URL.revokeObjectURL(url);
      resolve(isFinite(dur) ? Math.round(dur * 1000) : 0);
    };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    audio.src = url;
  });
}

function stripLeadingNumber(line: string): string {
  return line.replace(/^\s*[\(\[\{]?\s*\d+\s*[\)\]\}\.\:\-–—]\s*/, "");
}
function stripWrapperBraces(line: string): string {
  return line.replace(/^\s*[\{\[\(]\s*([\s\S]*?)\s*[\}\]\)]\s*$/, "$1");
}

export default function SrtMakerTab() {
  const [audioEntries, setAudioEntries] = useState<AudioEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [sentenceText, setSentenceText] = useState("");
  const [addMoreText, setAddMoreText] = useState("");
  const [sentenceHistory, setSentenceHistory] = useState<string[]>([]);
  const [generated, setGenerated] = useState(false);
  const [lang, setLang] = useState<"en" | "ar" | "de">("en");
  const [langOpen, setLangOpen] = useState(false);
  const langDir = lang === "ar" ? "rtl" : "ltr";
  const audioInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const appendLinesToSentences = (lines: string[]) => {
    if (lines.length === 0) return;
    setSentenceHistory((h) => [...h, sentenceText]);
    setSentenceText((prev) => {
      const existing = prev.trim();
      return existing ? existing + "\n" + lines.join("\n") : lines.join("\n");
    });
    setGenerated(false);
  };

  const handleAddMore = () => {
    const newLines = addMoreText.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
    if (newLines.length === 0) return;
    appendLinesToSentences(newLines);
    setAddMoreText("");
    toast({ title: `${newLines.length} sentences added`, description: "Appended to existing list" });
  };

  const handleAddOrPaste = async () => {
    if (addMoreText.trim()) { handleAddMore(); return; }
    try {
      const text = await navigator.clipboard.readText();
      const newLines = text.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
      if (newLines.length === 0) { toast({ title: "Clipboard is empty", description: "Copy some text first or type in the box" }); return; }
      appendLinesToSentences(newLines);
      toast({ title: `${newLines.length} sentences pasted & added`, description: "Pulled from clipboard" });
    } catch {
      toast({ title: "Can't read clipboard", description: "Paste into the box first, then click Add" });
    }
  };

  const handleCleanSentences = () => {
    const cleaned = sentenceText
      .split("\n")
      .map((l) => stripWrapperBraces(stripLeadingNumber(l)).replace(/>+|<+/g, "").replace(/\s*—\s*/g, ", ").trim())
      .filter((l) => l.length > 0)
      .join("\n");
    if (cleaned === sentenceText) { toast({ title: "Already clean", description: "Nothing to remove" }); return; }
    setSentenceHistory((h) => [...h, sentenceText]);
    setSentenceText(cleaned);
    setGenerated(false);
    toast({ title: "Cleaned", description: "Numbers & brackets removed" });
  };

  const handleUndo = () => {
    if (sentenceHistory.length === 0) return;
    const prev = sentenceHistory[sentenceHistory.length - 1];
    setSentenceHistory((h) => h.slice(0, -1));
    setSentenceText(prev);
    toast({ title: "Undone", description: "Last added batch removed" });
  };

  const processFiles = useCallback(async (files: File[]) => {
    const audioFiles = files.filter((f) =>
      f.type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac|wma)$/i.test(f.name)
    );
    if (!audioFiles.length) return;
    audioFiles.sort((a, b) => a.name.localeCompare(b.name));
    setLoadingFiles(true);
    let cumulative = 0;
    const entries: AudioEntry[] = [];
    for (const file of audioFiles) {
      const durationMs = await getAudioDuration(file);
      entries.push({ id: `${file.name}-${file.size}`, name: file.name, startMs: cumulative, endMs: cumulative + durationMs, durationMs });
      cumulative += durationMs + GAP_MS;
    }
    setAudioEntries((prev) => {
      const existingIds = new Set(prev.map((e) => e.id));
      const combined = [...prev, ...entries.filter((e) => !existingIds.has(e.id))];
      let offset = 0;
      return combined.map((e) => { const s = offset; const end = s + e.durationMs; offset = end + GAP_MS; return { ...e, startMs: s, endMs: end }; });
    });
    setGenerated(false);
    setLoadingFiles(false);
  }, []);

  function handleDrop(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); processFiles(Array.from(e.dataTransfer.files)); }
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) { processFiles(Array.from(e.target.files || [])); e.target.value = ""; }

  function removeEntry(id: string) {
    setAudioEntries((prev) => {
      const filtered = prev.filter((e) => e.id !== id);
      let offset = 0;
      return filtered.map((e) => { const s = offset; const end = s + e.durationMs; offset = end + GAP_MS; return { ...e, startMs: s, endMs: end }; });
    });
    setGenerated(false);
  }

  const removeSentence = (i: number) => {
    const lines = sentenceText.split("\n").map((l) => l.trim()).filter(Boolean);
    const updated = lines.filter((_, idx) => idx !== i);
    setSentenceHistory((h) => [...h, sentenceText]);
    setSentenceText(updated.join("\n"));
  };

  const updateSentence = (i: number, value: string) => {
    const lines = sentenceText.split("\n").map((l) => l.trim()).filter(Boolean);
    const updated = lines.map((s, idx) => (idx === i ? value : s));
    setSentenceText(updated.join("\n"));
  };

  const sentenceLines = sentenceText.split("\n").map((l) => l.trim()).filter(Boolean);
  const srtCards = audioEntries.map((entry, i) => ({
    index: i + 1,
    startTime: msToSrtTime(entry.startMs),
    endTime: msToSrtTime(entry.endMs),
    text: sentenceLines[i] ?? "",
    name: entry.name,
  }));

  function handleDownload() {
    if (srtCards.length === 0) return;
    const content = srtCards.map((c) => `${c.index}\n${c.startTime} --> ${c.endTime}\n${c.text}`).join("\n\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "output.srt"; a.click();
    URL.revokeObjectURL(url);
  }

  const canGenerate = audioEntries.length > 0 && sentenceLines.length > 0;
  const mismatch = audioEntries.length > 0 && sentenceLines.length > 0 && audioEntries.length !== sentenceLines.length;
  const matchCount = Math.min(audioEntries.length, sentenceLines.length);

  return (
    <div className="h-screen flex flex-col bg-[#f5f7fa] font-sans overflow-hidden">
      {/* Header — top card */}
      <div className="w-full mx-auto px-6 pt-4 flex-shrink-0">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl px-6 py-3 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <Music className="w-5 h-5 text-emerald-500" />
            <span className="font-semibold text-gray-800 dark:text-gray-100 text-sm">SRT Maker</span>
            {matchCount > 0 && !mismatch && (
              <span className="ml-2 bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs px-2 py-0.5 rounded-full font-medium">
                ✓ {matchCount} files matched
              </span>
            )}
            {mismatch && (
              <span className="ml-2 bg-amber-50 text-amber-700 border border-amber-200 text-xs px-2 py-0.5 rounded-full font-medium">
                ⚠ {audioEntries.length} files · {sentenceLines.length} sentences
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => { if (canGenerate) setGenerated(true); }}
              disabled={!canGenerate}
              className="bg-orange-500 hover:bg-orange-600 text-white text-sm h-8 px-3 gap-1.5 disabled:opacity-40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Generate SRT
            </Button>
            <Button
              onClick={handleDownload}
              disabled={!generated || srtCards.length === 0}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm h-8 px-3 gap-1.5 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              Download SRT
            </Button>
          </div>
        </div>
      </div>

      {/* Three Cards */}
      <div className="w-full mx-auto px-6 py-4 grid grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Card 1 — Voice Input */}
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 bg-emerald-500 text-white rounded-full text-xs flex items-center justify-center font-bold">1</span>
              <div>
                <div className="font-semibold text-gray-800 dark:text-gray-100 text-sm">Voice Input</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">MP3 / Audio files</div>
              </div>
            </div>
            {audioEntries.length > 0 && (
              <button
                onClick={() => { setAudioEntries([]); setGenerated(false); }}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac" multiple className="hidden" onChange={handleFileInput} />
            {audioEntries.length === 0 ? (
              <div
                onClick={() => audioInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-emerald-400 bg-emerald-50" : "border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/50"
                }`}
              >
                {loadingFiles ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-4">
                    <svg className="w-4 h-4 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                    </svg>
                    Reading durations...
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Upload className="w-5 h-5 text-emerald-500" />
                    </div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Drop audio files here</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">or click to browse</p>
                    <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">MP3, WAV, M4A, OGG</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 px-2 py-1.5 bg-emerald-50 rounded-lg border border-emerald-100 mb-2">
                  <Music className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span className="text-xs text-emerald-700 font-medium truncate">Audio queue</span>
                  <span className="ml-auto text-xs text-emerald-500">{audioEntries.length} files</span>
                </div>

                {audioEntries.map((entry, i) => (
                  <div key={entry.id} className="border border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 hover:bg-white dark:hover:bg-gray-900 rounded-lg p-3 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded text-xs flex items-center justify-center font-bold flex-shrink-0">
                          {i + 1}
                        </span>
                        <span className="text-xs font-mono tabular-nums truncate text-gray-500 dark:text-gray-400">
                          {msToDisplay(entry.startMs)} → {msToDisplay(entry.endMs)}
                        </span>
                      </div>
                      <button
                        onClick={() => removeEntry(entry.id)}
                        className="p-0.5 rounded hover:bg-red-100 transition-colors flex-shrink-0"
                      >
                        <X className="w-3 h-3 text-red-400" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 ml-7 leading-relaxed truncate">{entry.name}</p>
                  </div>
                ))}

                <button
                  onClick={() => audioInputRef.current?.click()}
                  className="w-full text-xs text-gray-400 dark:text-gray-500 hover:text-emerald-500 py-2 transition-colors"
                >
                  + Add more audio files
                </button>
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
              <div className="relative">
                <button
                  onClick={() => setLangOpen((o) => !o)}
                  title="Select language direction"
                  className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-bold text-blue-500 hover:border-blue-300 transition-all"
                >
                  {lang.toUpperCase()}
                  <svg className="w-2.5 h-2.5 text-gray-400 dark:text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </button>
                {langOpen && (
                  <div className="absolute top-full right-0 mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 overflow-hidden min-w-[120px]">
                    {([
                      { code: "en", label: "EN", desc: "English" },
                      { code: "ar", label: "AR", desc: "Arabic (RTL)" },
                      { code: "de", label: "DE", desc: "German" },
                    ] as const).map(({ code, label, desc }) => (
                      <button key={code} onClick={() => { setLang(code); setLangOpen(false); }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-blue-50 ${lang === code ? "bg-blue-50 text-blue-600" : "text-gray-600"}`}>
                        <span className="font-bold">{label}</span>
                        <span className="text-gray-400 dark:text-gray-500 font-normal">{desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {sentenceLines.length > 0 && (
                <span className="bg-blue-50 text-blue-600 border border-blue-100 text-xs px-2 py-0.5 rounded-full font-medium">
                  {sentenceLines.length} lines
                </span>
              )}
              {sentenceText && (
                <button
                  onClick={handleCleanSentences}
                  title="Remove leading numbers and wrapper brackets"
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
                  onClick={() => { setSentenceText(""); setSentenceHistory([]); setGenerated(false); }}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {sentenceLines.length === 0 ? (
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
                  onChange={(e) => { setSentenceText(e.target.value); setGenerated(false); }}
                  placeholder=""
                  dir={langDir}
                  className="absolute inset-0 w-full h-full text-sm resize-none border-gray-200 dark:border-gray-700 focus:border-emerald-400 focus:ring-emerald-400 bg-transparent"
                />
              </div>
            ) : (
              <div className="space-y-2">
                {/* Add more sentences — top */}
                <div className="pb-3 mb-2 border-b border-dashed border-gray-200 dark:border-gray-700">
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">+ Add more sentences (from {sentenceLines.length + 1})</p>
                  <Textarea
                    value={addMoreText}
                    onChange={(e) => setAddMoreText(e.target.value)}
                    placeholder={"Paste next batch here...\nOne sentence per line"}
                    dir={langDir}
                    className="min-h-[120px] text-sm resize-none border-gray-200 dark:border-gray-700 focus:border-emerald-400 focus:ring-emerald-400"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); handleAddMore(); }
                    }}
                  />
                  <button
                    onClick={handleAddOrPaste}
                    className="mt-1.5 w-full text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 rounded-md py-1.5 transition-colors font-medium"
                  >
                    {addMoreText.trim() ? "Add to list (Ctrl+Enter)" : "Paste & Add from clipboard"}
                  </button>
                </div>

                {sentenceLines.map((sentence, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 p-2.5 rounded-lg border transition-colors group ${
                      i < audioEntries.length
                        ? "border-emerald-100 bg-emerald-50/40 hover:border-emerald-200"
                        : "border-orange-100 bg-orange-50/40 hover:border-orange-200"
                    }`}
                    dir={langDir}
                  >
                    <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 mt-1.5 w-5 flex-shrink-0 text-right">
                      {i + 1}.
                    </span>
                    <textarea
                      value={sentence}
                      onChange={(e) => updateSentence(i, e.target.value)}
                      rows={Math.max(1, Math.ceil(sentence.length / 55))}
                      className="flex-1 text-sm text-gray-700 dark:text-gray-200 leading-relaxed bg-transparent border-none outline-none resize-none focus:ring-1 focus:ring-emerald-300 focus:bg-white dark:focus:bg-gray-800 rounded px-1 -mx-1 transition-colors"
                    />
                    <button
                      onClick={() => removeSentence(i)}
                      title="Remove this sentence"
                      className="flex-shrink-0 mt-0.5 w-5 h-5 flex items-center justify-center rounded-full text-gray-300 hover:text-white hover:bg-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <X className="w-3 h-3" />
                    </button>
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
            {generated && srtCards.length > 0 && (
              <span className="bg-orange-50 text-orange-600 border border-orange-100 text-xs px-2 py-0.5 rounded-full font-medium">
                {srtCards.length} cards
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {!generated ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500 gap-3 py-12">
                <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">Output will appear here</p>
                  <p className="text-xs mt-1">
                    {canGenerate
                      ? "Click \"Generate SRT\" to create output"
                      : "Add audio files + sentences, then click Generate"}
                  </p>
                  {canGenerate && (
                    <p className="text-xs mt-2 text-emerald-500 font-medium">
                      ✓ {srtCards.length} subtitles ready to generate
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                {srtCards.map((card) => (
                  <div
                    key={card.index}
                    className={`border rounded-lg p-3 transition-colors ${
                      !card.text
                        ? "border-amber-200 bg-amber-50/40"
                        : "border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/20"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-5 h-5 bg-emerald-500 text-white rounded text-xs flex items-center justify-center font-bold flex-shrink-0">
                        {card.index}
                      </span>
                      <span className="text-xs font-mono tabular-nums text-gray-500 dark:text-gray-400 truncate">
                        {card.startTime} → {card.endTime}
                      </span>
                      {!card.text && (
                        <span className="ml-auto text-xs bg-amber-100 text-amber-600 px-1.5 rounded font-medium">no text</span>
                      )}
                    </div>
                    <p className={`text-sm leading-relaxed ml-7 ${card.text ? "text-gray-800" : "text-gray-300 italic"}`} dir={langDir}>
                      {card.text || "—"}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 ml-7 truncate flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {card.name}
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
