import { useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import JSZip from "jszip";
import {
  Music,
  FileText,
  Scissors,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Play,
  Pause,
} from "lucide-react";

const FFMPEG_BASE_URL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";
const BATCH_SIZE = 20;
const RECYCLE_EVERY = 10;
const MEMORY_ERROR_PATTERNS = [
  "memory access out of bounds",
  "out of memory",
  "abort",
  "RuntimeError",
  "not loaded",
];

interface SrtCue {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

interface SrtPreview {
  count: number;
  totalSeconds: number;
  sample: { index: number; startSec: number; endSec: number; text: string }[];
}

interface ClipMeta {
  index: number;
  text: string;
  startSec: number;
  endSec: number;
  filename: string;
}

interface ClipStatus {
  index: number;
  status: "pending" | "running" | "done" | "error";
  error?: string;
}

interface JobStatus {
  total: number;
  done: number;
  errors: number;
  finished: boolean;
  clips: ClipStatus[];
}

function timestampToSeconds(ts: string): number {
  const m = ts.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!m) throw new Error(`Invalid SRT timestamp: ${ts}`);
  return (
    Number(m[1]) * 3600 +
    Number(m[2]) * 60 +
    Number(m[3]) +
    Number(m[4]) / 1000
  );
}

function parseSrtCues(content: string): SrtCue[] {
  const normalized = content.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  const blocks = normalized.split(/\n\s*\n/);
  const cues: SrtCue[] = [];
  for (const rawBlock of blocks) {
    const block = rawBlock.trim();
    if (!block) continue;
    const lines = block.split("\n");
    let cursor = 0;
    if (lines[cursor] && /^\d+$/.test(lines[cursor]!.trim())) cursor++;
    const timeLine = lines[cursor];
    if (!timeLine) continue;
    const tm = timeLine.match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/,
    );
    if (!tm) continue;
    cursor++;
    const text = lines.slice(cursor).join("\n").trim();
    const startSec = timestampToSeconds(tm[1]!);
    const endSec = timestampToSeconds(tm[2]!);
    if (endSec <= startSec) continue;
    cues.push({ index: cues.length + 1, startSec, endSec, text });
  }
  return cues;
}

function buildSrtPreview(cues: SrtCue[]): SrtPreview {
  return {
    count: cues.length,
    totalSeconds: cues.reduce((s, c) => s + (c.endSec - c.startSec), 0),
    sample: cues.slice(0, 5).map((c) => ({
      index: c.index,
      startSec: c.startSec,
      endSec: c.endSec,
      text: c.text,
    })),
  };
}

function sanitizeForFilename(text: string, max = 40): string {
  const cleaned = text
    .replace(/<[^>]*>/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\w\s\-]+/g, "")
    .trim()
    .slice(0, max)
    .replace(/\s+/g, "_");
  return cleaned || "clip";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

function UploadTile({
  tone,
  icon,
  title,
  hint,
  file,
  onPick,
  onClear,
  accept,
}: {
  tone: "emerald" | "rose";
  icon: React.ReactNode;
  title: string;
  hint: string;
  file: File | null;
  onPick: (f: File | null) => void;
  onClear: () => void;
  accept: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const palette =
    tone === "emerald"
      ? {
          bg: "bg-emerald-50/80 dark:bg-emerald-950/30",
          border: "border-emerald-200/80 dark:border-emerald-900/60",
          hover: "hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40",
          chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300",
          icon: "text-emerald-600 dark:text-emerald-400",
        }
      : {
          bg: "bg-rose-50/80 dark:bg-rose-950/30",
          border: "border-rose-200/80 dark:border-rose-900/60",
          hover: "hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40",
          chip: "bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300",
          icon: "text-rose-600 dark:text-rose-400",
        };

  const idle = {
    bg: "bg-[#f7f6f2] dark:bg-slate-900/60",
    border: "border-slate-200/80 dark:border-slate-800",
    hover: "hover:border-slate-300 hover:bg-[#f3f2ed] dark:hover:bg-slate-900/80",
    icon: "text-slate-500 dark:text-slate-400",
  };

  const active = !!file;
  const containerClasses = active
    ? `${palette.border} ${palette.bg}`
    : `${idle.border} ${idle.bg}`;
  const hoverClasses = active ? palette.hover : idle.hover;
  const iconColor = active ? palette.icon : idle.icon;

  return (
    <div
      onClick={() => inputRef.current?.click()}
      className={`relative cursor-pointer rounded-2xl border ${containerClasses} ${hoverClasses} px-5 py-4 transition-all`}
    >
      <Input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <div className="flex items-center gap-4">
        <div
          className={`shrink-0 w-11 h-11 rounded-xl bg-white/80 dark:bg-slate-900/60 flex items-center justify-center ${iconColor} shadow-sm`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          {file ? (
            <>
              <p className="font-semibold text-sm text-slate-900 dark:text-slate-100 truncate">
                {file.name}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {formatBytes(file.size)} · click to replace
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 tracking-wide uppercase">
                {title}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>
            </>
          )}
        </div>
        {file && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="shrink-0 w-7 h-7 rounded-md inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-white dark:hover:bg-slate-800"
            aria-label="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function ClipCard({
  clip,
  status,
  url,
  onDownload,
}: {
  clip: ClipMeta;
  status: ClipStatus;
  url: string | null;
  onDownload: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function togglePlay() {
    if (!url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      void audioRef.current.play();
      setPlaying(true);
    }
  }

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  const dur = (clip.endSec - clip.startSec).toFixed(1);

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 transition-all ${
        status.status === "done"
          ? "border-violet-200 bg-violet-50/60 dark:border-violet-800 dark:bg-violet-950/30"
          : status.status === "running"
          ? "border-indigo-300 bg-indigo-50/60 dark:border-indigo-700 dark:bg-indigo-950/30 animate-pulse"
          : status.status === "error"
          ? "border-red-300 bg-red-50/60 dark:border-red-800 dark:bg-red-950/30"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40"
      }`}
    >
      <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-400 font-mono text-[11px]">
        {status.status === "running" ? (
          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
        ) : status.status === "error" ? (
          <AlertCircle className="w-4 h-4 text-red-500" />
        ) : status.status === "done" ? (
          <CheckCircle2 className="w-4 h-4 text-violet-500" />
        ) : (
          <Music className="w-4 h-4 text-slate-400" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">
          {clip.text || `Clip ${clip.index}`}
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          {formatSec(clip.startSec)} → {formatSec(clip.endSec)} · {dur}s
        </p>
        {status.status === "error" && (
          <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 truncate">{status.error}</p>
        )}
      </div>

      <span className="text-[10px] font-mono text-slate-400 shrink-0">#{clip.index}</span>

      {status.status === "done" && url && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={togglePlay}
            className="w-7 h-7 rounded-md flex items-center justify-center bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-800 transition-colors"
            title={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <button
            onClick={onDownload}
            className="w-7 h-7 rounded-md flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            title="Download"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function AudioSrtSplitterHome() {
  const { toast } = useToast();

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [srtFile, setSrtFile] = useState<File | null>(null);
  const [srtPreview, setSrtPreview] = useState<SrtPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadPct, setLoadPct] = useState(0);

  const [clips, setClips] = useState<ClipMeta[]>([]);
  const [statuses, setStatuses] = useState<Map<number, ClipStatus>>(new Map());
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);

  const ffmpegRef = useRef<FFmpeg | null>(null);
  const clipBlobsRef = useRef<Map<number, Blob>>(new Map());
  const clipUrlsRef = useRef<Map<number, string>>(new Map());
  const cancelRef = useRef(false);
  const jobIdRef = useRef<string | null>(null);

  function revokeAll() {
    for (const url of clipUrlsRef.current.values()) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    clipUrlsRef.current.clear();
    clipBlobsRef.current.clear();
  }

  useEffect(() => {
    return () => {
      revokeAll();
      try { ffmpegRef.current?.terminate(); } catch { /* ignore */ }
    };
  }, []);

  async function getFFmpeg(): Promise<FFmpeg> {
    if (ffmpegRef.current) return ffmpegRef.current;
    const ffmpeg = new FFmpeg();
    const coreURL = await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.wasm`, "application/wasm");
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }

  async function recycleFFmpeg(): Promise<FFmpeg> {
    const old = ffmpegRef.current;
    ffmpegRef.current = null;
    if (old) { try { old.terminate(); } catch { /* ignore */ } }
    return getFFmpeg();
  }

  function isMemoryError(msg: string | null | undefined): boolean {
    if (!msg) return false;
    const lower = msg.toLowerCase();
    return MEMORY_ERROR_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
  }

  async function readFileWithProgress(file: File, onProgress: (pct: number) => void): Promise<Uint8Array> {
    const total = file.size;
    const reader = file.stream().getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    onProgress(0);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        if (total > 0) onProgress(Math.min(99, Math.round((loaded / total) * 100)));
      }
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
    onProgress(100);
    return out;
  }

  async function handleSrtChange(f: File | null) {
    setSrtFile(f);
    setSrtPreview(null);
    if (!f) return;
    setPreviewing(true);
    try {
      const text = await f.text();
      const cues = parseSrtCues(text);
      setSrtPreview(buildSrtPreview(cues));
    } catch (err) {
      toast({ title: "Couldn't read SRT", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  function reset() {
    cancelRef.current = true;
    jobIdRef.current = null;
    revokeAll();
    setClips([]);
    setStatuses(new Map());
    setJobStatus(null);
    setLoading(false);
    setLoadPct(0);
  }

  async function startSplit() {
    if (!audioFile || !srtFile) return;

    reset();
    cancelRef.current = false;

    const jobId = String(Date.now());
    jobIdRef.current = jobId;

    let cues: SrtCue[];
    try {
      const srtText = await srtFile.text();
      cues = parseSrtCues(srtText);
    } catch (err) {
      toast({ title: "Couldn't parse SRT", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      return;
    }

    if (cues.length === 0) {
      toast({ title: "No subtitle cues found in SRT.", variant: "destructive" });
      return;
    }

    const ext = (() => {
      const m = audioFile.name.match(/\.[A-Za-z0-9]+$/);
      return m ? m[0].toLowerCase() : ".mp3";
    })();
    const outExt = ".wav";
    const baseName = audioFile.name.replace(/\.[^.]+$/, "") || "audio";
    const padWidth = String(cues.length).length;

    const clipMetas: ClipMeta[] = cues.map((c) => ({
      index: c.index,
      text: c.text,
      startSec: c.startSec,
      endSec: c.endSec,
      filename: `${String(c.index).padStart(padWidth, "0")}_${baseName}_${sanitizeForFilename(c.text)}${outExt}`,
    }));

    setClips(clipMetas);
    const initStatuses = new Map<number, ClipStatus>(
      clipMetas.map((c) => [c.index, { index: c.index, status: "pending" }])
    );
    setStatuses(new Map(initStatuses));
    setJobStatus({ total: cues.length, done: 0, errors: 0, finished: false, clips: [...initStatuses.values()] });

    setLoading(true);
    setLoadPct(0);

    let eng: FFmpeg;
    try {
      eng = await getFFmpeg();
    } catch (err) {
      toast({ title: "Failed to load FFmpeg", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      setLoading(false);
      return;
    }

    const inputName = `input${ext}`;
    try {
      const data = await readFileWithProgress(audioFile, setLoadPct);
      await eng.writeFile(inputName, data);
    } catch (err) {
      toast({ title: "Failed to load audio", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      setLoading(false);
      return;
    }

    setLoading(false);

    let done = 0;
    let errors = 0;

    const updateStatus = (index: number, update: Partial<ClipStatus>) => {
      setStatuses((prev) => {
        const next = new Map(prev);
        const cur = next.get(index) ?? { index, status: "pending" };
        next.set(index, { ...cur, ...update });
        return next;
      });
    };

    for (let batchStart = 0; batchStart < clipMetas.length; batchStart += BATCH_SIZE) {
      if (cancelRef.current || jobIdRef.current !== jobId) break;

      const batch = clipMetas.slice(batchStart, batchStart + BATCH_SIZE);

      for (let i = 0; i < batch.length; i++) {
        if (cancelRef.current || jobIdRef.current !== jobId) break;

        const clip = batch[i]!;
        const globalIdx = batchStart + i;

        if (globalIdx > 0 && globalIdx % RECYCLE_EVERY === 0) {
          try {
            eng = await recycleFFmpeg();
            const data = await readFileWithProgress(audioFile, () => {});
            await eng.writeFile(inputName, data);
          } catch (err) {
            toast({ title: "Failed to recycle FFmpeg engine", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
            break;
          }
        }

        updateStatus(clip.index, { status: "running" });

        const outName = `out_${clip.index}${outExt}`;
        let attempt = 0;
        let success = false;

        while (attempt < 2 && !success) {
          attempt++;
          try {
            await eng.exec([
              "-hide_banner",
              "-loglevel", "error",
              "-i", inputName,
              "-af", `atrim=start=${clip.startSec}:end=${clip.endSec},asetpts=PTS-STARTPTS`,
              "-c:a", "pcm_s16le",
              "-vn",
              outName,
            ]);

            const outData = await eng.readFile(outName) as Uint8Array;
            await eng.deleteFile(outName);

            const blob = new Blob([outData], { type: "audio/wav" });
            const url = URL.createObjectURL(blob);
            clipBlobsRef.current.set(clip.index, blob);
            clipUrlsRef.current.set(clip.index, url);
            updateStatus(clip.index, { status: "done" });
            done++;
            success = true;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (isMemoryError(msg) && attempt < 2) {
              try {
                eng = await recycleFFmpeg();
                const data = await readFileWithProgress(audioFile, () => {});
                await eng.writeFile(inputName, data);
              } catch {
                /* ignore recycle error */
              }
            } else {
              updateStatus(clip.index, { status: "error", error: msg });
              errors++;
              break;
            }
          }
        }

        setJobStatus((prev) =>
          prev
            ? { ...prev, done, errors, finished: done + errors === clipMetas.length }
            : null
        );
      }
    }

    setJobStatus((prev) =>
      prev ? { ...prev, done, errors, finished: true } : null
    );

    if (done > 0) {
      toast({ title: `✅ Done! ${done} clip${done !== 1 ? "s" : ""} cut from audio.` });
    }
    if (errors > 0) {
      toast({ title: `${errors} clip${errors !== 1 ? "s" : ""} failed.`, variant: "destructive" });
    }
  }

  async function downloadAll() {
    const entries = [...clipBlobsRef.current.entries()].sort((a, b) => a[0] - b[0]);
    if (entries.length === 0) return;

    const zip = new JSZip();
    for (const [idx, blob] of entries) {
      const meta = clips.find((c) => c.index === idx);
      if (meta) zip.file(meta.filename, blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    const baseName = audioFile?.name.replace(/\.[^.]+$/, "") || "audio";
    a.href = url;
    a.download = `${baseName}_clips.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadClip(clip: ClipMeta) {
    const url = clipUrlsRef.current.get(clip.index);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = clip.filename;
    a.click();
  }

  const canStart = !!audioFile && !!srtFile && !loading;
  const doneCount = jobStatus?.done ?? 0;
  const isRunning = jobStatus !== null && !jobStatus.finished;

  return (
    <div className="min-h-full w-full bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.10),transparent_60%),radial-gradient(ellipse_at_bottom_right,_rgba(244,114,182,0.10),transparent_55%)] bg-slate-50 dark:bg-slate-950">
      <div className="max-w-6xl mx-auto px-6 py-8">

        {/* Top bar */}
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md shadow-sm px-5 py-3 flex items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white flex items-center justify-center shadow-md">
              <Scissors className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-slate-900 dark:text-slate-50 leading-tight">
                Audio Splitter
              </h1>
              <p className="text-[11px] text-slate-500 leading-tight">
                {jobStatus ? (
                  <>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{doneCount}</span>
                    {" "}of {jobStatus.total} clips ready
                    {jobStatus.errors > 0 && <span className="text-red-500"> · {jobStatus.errors} failed</span>}
                    {jobStatus.finished && doneCount === jobStatus.total && (
                      <span className="text-emerald-600 dark:text-emerald-400"> · all done</span>
                    )}
                  </>
                ) : (
                  <>One clip per subtitle cue</>
                )}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {srtPreview && !jobStatus && (
              <div className="hidden sm:flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                <span>
                  <span className="font-semibold text-slate-900 dark:text-slate-50">{srtPreview.count}</span> cues
                </span>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <span>{formatDuration(srtPreview.totalSeconds)}</span>
              </div>
            )}

            {doneCount > 0 && jobStatus?.finished && (
              <button
                type="button"
                onClick={() => void downloadAll()}
                className="inline-flex items-center gap-1.5 px-3 h-7 rounded-md bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 hover:from-indigo-700 hover:via-violet-700 hover:to-fuchsia-700 text-white text-xs font-bold tracking-wider uppercase shadow-md transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                ZIP ({doneCount})
              </button>
            )}

            {jobStatus ? (
              <Button
                variant="outline"
                size="sm"
                onClick={reset}
                className={
                  !jobStatus.finished
                    ? "h-7 rounded-md text-xs px-3 border-red-500 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-500/60 dark:text-red-400 dark:hover:bg-red-500/10"
                    : "h-7 rounded-md text-xs px-3"
                }
              >
                <X className="w-3.5 h-3.5 mr-1" />
                {!jobStatus.finished ? "Cancel" : "New job"}
              </Button>
            ) : (
              <Button
                onClick={() => void startSplit()}
                disabled={!canStart || isRunning}
                className="h-9 rounded-lg px-4 text-xs font-bold tracking-wider uppercase bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 hover:from-indigo-700 hover:via-violet-700 hover:to-fuchsia-700 text-white shadow-md disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                    Loading {loadPct}%
                  </>
                ) : (
                  <>
                    <Scissors className="w-3.5 h-3.5 mr-2" />
                    Audio Split
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Upload tiles */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <UploadTile
            tone="emerald"
            icon={<Music className="w-5 h-5" />}
            title="Upload Audio"
            hint="MP3, WAV, AAC, M4A, OGG, FLAC…"
            file={audioFile}
            accept="audio/*,.mp3,.wav,.aac,.m4a,.ogg,.flac,.opus"
            onPick={(f) => setAudioFile(f)}
            onClear={() => setAudioFile(null)}
          />
          <UploadTile
            tone="rose"
            icon={<FileText className="w-5 h-5" />}
            title="Upload SRT"
            hint={previewing ? "Parsing…" : "Subtitle file with timestamps"}
            file={srtFile}
            accept=".srt,.txt"
            onPick={(f) => void handleSrtChange(f)}
            onClear={() => { setSrtFile(null); setSrtPreview(null); }}
          />
        </div>

        {/* Hint text when nothing uploaded */}
        {!audioFile && !srtFile && (
          <p className="mt-4 text-center text-xs text-slate-400 dark:text-slate-600">
            Drop an audio and its <span className="font-mono">.srt</span> above, then hit <span className="font-semibold uppercase tracking-wider">Audio Split</span>.
          </p>
        )}

        {/* Loading progress */}
        {loading && (
          <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur p-4">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 mb-2">
              <span>Loading audio into engine…</span>
              <span className="font-mono">{loadPct}%</span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5">
              <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${loadPct}%` }} />
            </div>
          </div>
        )}

        {/* Job progress bar */}
        {jobStatus && !jobStatus.finished && (
          <div className="mt-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2 text-xs text-slate-500">
              <span>{jobStatus.done + jobStatus.errors} / {jobStatus.total} clips</span>
              <span className="font-mono">{Math.round(((jobStatus.done + jobStatus.errors) / jobStatus.total) * 100)}%</span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 h-2 rounded-full transition-all"
                style={{ width: `${Math.round(((jobStatus.done + jobStatus.errors) / jobStatus.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Clips list */}
        {clips.length > 0 && (
          <div className="mt-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/60 dark:bg-slate-900/50 backdrop-blur-md p-4 shadow-sm">
            <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-1">
              {clips.map((clip) => {
                const st = statuses.get(clip.index) ?? { index: clip.index, status: "pending" };
                const url = clipUrlsRef.current.get(clip.index) ?? null;
                return (
                  <ClipCard
                    key={clip.index}
                    clip={clip}
                    status={st}
                    url={url}
                    onDownload={() => downloadClip(clip)}
                  />
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function AudioSrtSplitterTab() {
  return (
    <>
      <AudioSrtSplitterHome />
      <Toaster />
    </>
  );
}
