import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileText,
  Loader2,
  StopCircle,
  Upload,
  X,
  Languages,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

// ─── Free Google Translate (unofficial endpoint, no API key needed) ────────────
async function gtTranslate(text: string, from: string, to: string): Promise<string> {
  const sl = from === "auto" ? "auto" : from;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  // data[0] is array of [translatedSegment, original, ...]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data[0] as any[]).map((seg: any) => (typeof seg[0] === "string" ? seg[0] : "")).join("");
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Parse SRT keeping raw time strings ───────────────────────────────────────
interface SrtEntry {
  index: number;
  start: string; // "00:00:14,500"
  end: string;   // "00:00:16,500"
  text: string;  // possibly multi-line
}

function parseSrtRaw(content: string): SrtEntry[] {
  const blocks = content.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const entries: SrtEntry[] = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const idx = parseInt(lines[0].trim(), 10);
    if (isNaN(idx)) continue;
    const timeMatch = lines[1].match(
      /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/
    );
    if (!timeMatch) continue;
    const text = lines
      .slice(2)
      .join("\n")
      .replace(/<[^>]+>/g, "") // strip HTML tags (e.g. <i>)
      .trim();
    if (!text) continue;
    entries.push({ index: idx, start: timeMatch[1], end: timeMatch[2], text });
  }
  return entries;
}

function buildSrtOutput(entries: SrtEntry[], translations: (string | null)[]): string {
  return entries
    .map((e, i) => {
      const t = translations[i] ?? e.text;
      return `${e.index}\n${e.start} --> ${e.end}\n${t}`;
    })
    .join("\n\n") + "\n";
}

// ─── Language list ─────────────────────────────────────────────────────────────
const LANGUAGES = [
  { code: "auto", label: "Auto Detect" },
  { code: "ar", label: "Arabic" },
  { code: "bn", label: "Bengali" },
  { code: "zh-CN", label: "Chinese (Simplified)" },
  { code: "zh-TW", label: "Chinese (Traditional)" },
  { code: "nl", label: "Dutch" },
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ms", label: "Malay" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "es", label: "Spanish" },
  { code: "tr", label: "Turkish" },
  { code: "ur", label: "Urdu" },
];

// ─── Main Component ────────────────────────────────────────────────────────────
export default function SrtTrnsTab() {
  const [file, setFile] = useState<File | null>(null);
  const [entries, setEntries] = useState<SrtEntry[]>([]);
  const [translations, setTranslations] = useState<(string | null)[]>([]);
  const [errors, setErrors] = useState<boolean[]>([]);
  const [translating, setTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fromLang, setFromLang] = useState("auto");
  const [toLang, setToLang] = useState("en");
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const cancelRef = useRef(false);
  const outputEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll output panel as new cards arrive
  useEffect(() => {
    if (translating) {
      outputEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [progress, translating]);

  const loadFile = useCallback(async (f: File) => {
    setParseError(null);
    setTranslations([]);
    setErrors([]);
    setProgress(0);
    try {
      const text = await f.text();
      const parsed = parseSrtRaw(text);
      if (parsed.length === 0) {
        setParseError("কোনো valid subtitle পাওয়া যায়নি। SRT file টি সঠিক কিনা দেখুন।");
        setFile(null);
        setEntries([]);
        return;
      }
      setFile(f);
      setEntries(parsed);
    } catch {
      setParseError("File পড়তে সমস্যা হয়েছে।");
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) void loadFile(f);
    },
    [loadFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) void loadFile(f);
      e.target.value = "";
    },
    [loadFile]
  );

  const startTranslation = useCallback(async () => {
    if (!entries.length || translating) return;
    cancelRef.current = false;
    setTranslating(true);
    setProgress(0);
    setTranslations(new Array(entries.length).fill(null));
    setErrors(new Array(entries.length).fill(false));

    const results: (string | null)[] = new Array(entries.length).fill(null);
    const errs: boolean[] = new Array(entries.length).fill(false);

    for (let i = 0; i < entries.length; i++) {
      if (cancelRef.current) break;

      const entry = entries[i];
      let attempt = 0;
      let success = false;

      while (attempt < 3 && !success && !cancelRef.current) {
        try {
          const translated = await gtTranslate(entry.text, fromLang, toLang);
          results[i] = translated;
          success = true;
        } catch {
          attempt++;
          if (attempt < 3) await sleep(800 * attempt);
        }
      }

      if (!success) {
        errs[i] = true;
        results[i] = entry.text; // keep original on failure
      }

      setTranslations([...results]);
      setErrors([...errs]);
      setProgress(i + 1);

      // Small delay to avoid rate limiting
      if (!cancelRef.current && i < entries.length - 1) {
        await sleep(120);
      }
    }

    setTranslating(false);
  }, [entries, fromLang, toLang, translating]);

  const stopTranslation = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const downloadSrt = useCallback(() => {
    if (!entries.length) return;
    const content = buildSrtOutput(entries, translations);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const baseName = file?.name.replace(/\.srt$/i, "") ?? "translated";
    a.href = url;
    a.download = `${baseName}_${toLang}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [entries, translations, file, toLang]);

  const clearAll = useCallback(() => {
    cancelRef.current = true;
    setFile(null);
    setEntries([]);
    setTranslations([]);
    setErrors([]);
    setProgress(0);
    setTranslating(false);
    setParseError(null);
  }, []);

  const translatedCount = translations.filter((t) => t !== null).length;
  const errorCount = errors.filter(Boolean).length;
  const isDone = !translating && translatedCount > 0 && translatedCount === entries.length;

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-gray-50 dark:bg-gray-950">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex-shrink-0 flex-wrap">
        {/* From lang */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">From</span>
          <select
            value={fromLang}
            onChange={(e) => setFromLang(e.target.value)}
            disabled={translating}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />

        {/* To lang */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">To</span>
          <select
            value={toLang}
            onChange={(e) => setToLang(e.target.value)}
            disabled={translating}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 disabled:opacity-50"
          >
            {LANGUAGES.filter((l) => l.code !== "auto").map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        {/* Progress */}
        {entries.length > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums whitespace-nowrap">
            {translatedCount} / {entries.length}
            {errorCount > 0 && (
              <span className="ml-1.5 text-red-500">{errorCount} error</span>
            )}
          </span>
        )}

        {/* Stop button */}
        {translating && (
          <button
            onClick={stopTranslation}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <StopCircle className="w-3.5 h-3.5" />
            Stop
          </button>
        )}

        {/* Download button */}
        {translatedCount > 0 && !translating && (
          <button
            onClick={downloadSrt}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download SRT
          </button>
        )}

        {/* Translate button */}
        <button
          onClick={startTranslation}
          disabled={!entries.length || translating}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
        >
          {translating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Translating…
            </>
          ) : (
            <>
              <Languages className="w-3.5 h-3.5" />
              Translate
            </>
          )}
        </button>
      </div>

      {/* Progress bar */}
      {translating && entries.length > 0 && (
        <div className="h-0.5 bg-gray-200 dark:bg-gray-800 flex-shrink-0">
          <div
            className="h-full bg-orange-500 transition-all duration-300"
            style={{ width: `${(translatedCount / entries.length) * 100}%` }}
          />
        </div>
      )}

      {/* ── Two panels ── */}
      <div className="flex flex-1 min-h-0 gap-0 overflow-hidden">
        {/* ── LEFT: INPUT ── */}
        <div className="flex flex-col flex-1 min-w-0 border-r border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              INPUT
              {entries.length > 0 && (
                <span className="ml-2 font-normal text-gray-400 normal-case tracking-normal">
                  {entries.length} subtitles
                </span>
              )}
            </span>
            {file && (
              <button
                onClick={clearAll}
                disabled={translating}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-40 transition-colors"
                title="Clear"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {/* Upload area */}
            {!file ? (
              <div
                onDrop={handleDrop}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`flex flex-col items-center justify-center h-full min-h-[200px] border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                  isDragging
                    ? "border-orange-400 bg-orange-50 dark:bg-orange-950/30"
                    : "border-gray-300 dark:border-gray-700 hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-950/20"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".srt"
                  className="hidden"
                  onChange={handleFileInput}
                />
                <Upload className="w-8 h-8 text-gray-400 mb-2" />
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">SRT file upload করুন</p>
                <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">Click or drag & drop</p>
                {parseError && (
                  <p className="mt-3 text-xs text-red-500 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {parseError}
                  </p>
                )}
              </div>
            ) : (
              /* Subtitle subcards */
              <div className="flex flex-col gap-1.5">
                {entries.map((entry) => (
                  <div
                    key={entry.index}
                    className="flex gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2 text-sm"
                  >
                    <span className="text-xs font-bold text-gray-400 dark:text-gray-600 w-7 flex-shrink-0 pt-0.5 tabular-nums">
                      {entry.index}
                    </span>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums font-mono">
                        {entry.start} → {entry.end}
                      </span>
                      <span className="text-gray-700 dark:text-gray-300 leading-snug break-words whitespace-pre-wrap">
                        {entry.text}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: OUTPUT ── */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              OUTPUT
              {translatedCount > 0 && (
                <span className="ml-2 font-normal text-gray-400 normal-case tracking-normal">
                  {translatedCount} translated
                  {isDone && errorCount === 0 && (
                    <CheckCircle2 className="inline w-3 h-3 ml-1 text-emerald-500" />
                  )}
                </span>
              )}
            </span>
            {isDone && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Done
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {translatedCount === 0 && !translating ? (
              /* Empty state */
              <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-center">
                <FileText className="w-8 h-8 text-gray-300 dark:text-gray-700 mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-600">
                  {entries.length > 0
                    ? "Translate button চাপুন"
                    : "SRT file upload করলে এখানে translation দেখাবে"}
                </p>
              </div>
            ) : (
              /* Translated subcards */
              <div className="flex flex-col gap-1.5">
                {entries.slice(0, Math.max(translatedCount, translating ? translatedCount + 1 : 0)).map((entry, i) => {
                  const t = translations[i];
                  const hasError = errors[i];
                  const isLoading = translating && i === translatedCount && t === null;

                  return (
                    <div
                      key={entry.index}
                      className={`flex gap-2 border rounded-lg px-3 py-2 text-sm transition-colors ${
                        hasError
                          ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900"
                          : isLoading
                          ? "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800 animate-pulse"
                          : "bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800"
                      }`}
                    >
                      <span className="text-xs font-bold text-gray-400 dark:text-gray-600 w-7 flex-shrink-0 pt-0.5 tabular-nums">
                        {entry.index}
                      </span>
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <span className="text-[10px] text-gray-400 dark:text-gray-600 tabular-nums font-mono">
                          {entry.start} → {entry.end}
                        </span>
                        {isLoading ? (
                          <div className="flex items-center gap-1.5 text-orange-500">
                            <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                            <span className="text-xs">Translating…</span>
                          </div>
                        ) : (
                          <span
                            className={`leading-snug break-words whitespace-pre-wrap ${
                              hasError
                                ? "text-red-600 dark:text-red-400"
                                : "text-gray-800 dark:text-gray-200"
                            }`}
                          >
                            {t ?? entry.text}
                          </span>
                        )}
                        {hasError && (
                          <span className="text-[10px] text-red-400 flex items-center gap-0.5 mt-0.5">
                            <AlertCircle className="w-3 h-3" />
                            Translation failed — original kept
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={outputEndRef} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
