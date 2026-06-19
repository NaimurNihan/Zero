import { useCallback, useEffect, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import JSZip from "jszip";
import {
  Loader2,
  CheckCircle2,
  Download,
  X,
  Music,
  UploadCloud,
  Play,
  Pause,
  AlertCircle,
  Gauge,
  ArrowRight,
  Trash2,
} from "lucide-react";

// Speed limits — outside this range the result sounds too distorted
const MIN_SPEED = 0.25;
const MAX_SPEED = 4.0;
// If instrument and vocal durations are within this fraction, skip re-encode
const SPEED_EPSILON = 0.005;

const FFMPEG_BASE_URL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm";

// Build a chain of atempo filters for a given factor.
// Single atempo supports 0.5–100 in recent ffmpeg, but we chain
// to stay safe on the 0.5 lower bound edge.
function buildAtempoChain(factor: number): string {
  if (factor >= 0.5 && factor <= 2.0) return `atempo=${factor.toFixed(6)}`;
  const filters: string[] = [];
  let rem = factor;
  while (rem > 2.0) {
    filters.push("atempo=2.0");
    rem /= 2.0;
  }
  while (rem < 0.5) {
    filters.push("atempo=0.5");
    rem *= 2.0;
  }
  filters.push(`atempo=${rem.toFixed(6)}`);
  return filters.join(",");
}

function formatSec(s: number): string {
  if (!isFinite(s) || s < 0) return "?";
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2);
  return `${m}:${sec.padStart(5, "0")}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Read audio duration via HTMLAudioElement
function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("audio");
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      el.src = "";
      if (isFinite(d) && d > 0) resolve(d);
      else reject(new Error(`Could not read duration of ${file.name}`));
    };
    el.onloadedmetadata = () => {
      const d = el.duration;
      if (isFinite(d) && d > 0) { finish(d); return; }
      el.ontimeupdate = () => { el.ontimeupdate = null; finish(el.duration); };
      try { el.currentTime = 1e9; } catch { finish(NaN); }
    };
    el.onerror = () => { if (!settled) { settled = true; URL.revokeObjectURL(url); reject(new Error(`Failed to load ${file.name}`)); } };
    setTimeout(() => { if (!settled) { settled = true; URL.revokeObjectURL(url); reject(new Error(`Timeout reading ${file.name}`)); } }, 30000);
    el.src = url;
  });
}

type CardStage = "idle" | "reading" | "processing" | "done" | "error" | "skipped";

type CardState = {
  id: string;
  vocalFile: File | null;
  instrFile: File | null;
  vocalDuration: number | null;
  instrDuration: number | null;
  stage: CardStage;
  progress: number;
  error: string | null;
  speedFactor: number | null;
  outputBlob: Blob | null;
  outputName: string;
  outputDuration: number | null;
};

function makeId() {
  return Math.random().toString(36).slice(2);
}

function makeCard(): CardState {
  return {
    id: makeId(),
    vocalFile: null,
    instrFile: null,
    vocalDuration: null,
    instrDuration: null,
    stage: "idle",
    progress: 0,
    error: null,
    speedFactor: null,
    outputBlob: null,
    outputName: "",
    outputDuration: null,
  };
}

function SpeedBadge({ factor }: { factor: number | null }) {
  if (factor === null) return null;
  const pct = Math.round((factor - 1) * 100);
  const label = factor > 1 ? `+${pct}%` : `${pct}%`;
  const color =
    factor > 1.3
      ? "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
      : factor < 0.8
      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
      : "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${color}`}>
      <Gauge className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

function AudioPreviewBtn({ blob }: { blob: Blob | null }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggle() {
    if (!blob) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(URL.createObjectURL(blob));
      audioRef.current.onended = () => setPlaying(false);
    }
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { void audioRef.current.play(); setPlaying(true); }
  }

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  if (!blob) return null;
  return (
    <button
      onClick={toggle}
      className="w-7 h-7 rounded-md flex items-center justify-center bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-800 transition-colors"
      title={playing ? "Pause" : "Play output"}
    >
      {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
    </button>
  );
}

function FileDropZone({
  label,
  sublabel,
  color,
  file,
  duration,
  onFile,
  onClear,
  disabled,
}: {
  label: string;
  sublabel: string;
  color: "violet" | "emerald";
  file: File | null;
  duration: number | null;
  onFile: (f: File) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const palette =
    color === "violet"
      ? { bg: "bg-violet-50 dark:bg-violet-950/30", border: "border-violet-200 dark:border-violet-800", icon: "text-violet-500", chip: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300" }
      : { bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800", icon: "text-emerald-500", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" };

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      className={`relative cursor-pointer rounded-xl border-2 border-dashed ${palette.border} ${palette.bg} px-3 py-2.5 transition-all hover:opacity-80 ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.aac,.m4a,.ogg,.flac,.opus"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        disabled={disabled}
      />
      <div className="flex items-center gap-2">
        <Music className={`w-4 h-4 shrink-0 ${palette.icon}`} />
        <div className="flex-1 min-w-0">
          {file ? (
            <>
              <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{file.name}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {formatBytes(file.size)}
                {duration !== null && <> · <span className="font-mono">{formatSec(duration)}</span></>}
              </p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">{label}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{sublabel}</p>
            </>
          )}
        </div>
        {file && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-slate-700"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function CardRow({
  card,
  index,
  onVocalFile,
  onInstrFile,
  onClearVocal,
  onClearInstr,
  onRemove,
  onDownload,
  running,
}: {
  card: CardState;
  index: number;
  onVocalFile: (f: File) => void;
  onInstrFile: (f: File) => void;
  onClearVocal: () => void;
  onClearInstr: () => void;
  onRemove: () => void;
  onDownload: () => void;
  running: boolean;
}) {
  const borderColor =
    card.stage === "done"
      ? "border-violet-200 dark:border-violet-800"
      : card.stage === "error"
      ? "border-red-300 dark:border-red-800"
      : card.stage === "skipped"
      ? "border-slate-200 dark:border-slate-700"
      : card.stage === "processing" || card.stage === "reading"
      ? "border-indigo-300 dark:border-indigo-700"
      : "border-slate-200 dark:border-slate-800";

  const bgColor =
    card.stage === "done"
      ? "bg-violet-50/50 dark:bg-violet-950/20"
      : card.stage === "error"
      ? "bg-red-50/50 dark:bg-red-950/20"
      : card.stage === "processing" || card.stage === "reading"
      ? "bg-indigo-50/50 dark:bg-indigo-950/20"
      : "bg-white dark:bg-slate-900/40";

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} p-3 transition-all`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-500 shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 grid grid-cols-2 gap-2">
          <FileDropZone
            label="Vocal"
            sublabel="Reference duration"
            color="emerald"
            file={card.vocalFile}
            duration={card.vocalDuration}
            onFile={onVocalFile}
            onClear={onClearVocal}
            disabled={running}
          />
          <FileDropZone
            label="Instrument"
            sublabel="File to speed-adjust"
            color="violet"
            file={card.instrFile}
            duration={card.instrDuration}
            onFile={onInstrFile}
            onClear={onClearInstr}
            disabled={running}
          />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {card.stage === "done" && (
            <>
              <SpeedBadge factor={card.speedFactor} />
              <AudioPreviewBtn blob={card.outputBlob} />
              <button
                onClick={onDownload}
                className="w-7 h-7 rounded-md flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                title="Download"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {card.stage === "skipped" && (
            <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-full px-2 py-0.5">≈ same</span>
          )}
          {(card.stage === "processing" || card.stage === "reading") && (
            <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
          )}
          {card.stage === "error" && (
            <AlertCircle className="w-4 h-4 text-red-500" title={card.error ?? ""} />
          )}
          {!running && (
            <button
              onClick={onRemove}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              title="Remove card"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {(card.stage === "processing" || card.stage === "reading") && (
        <div className="mt-1">
          <div className="w-full bg-indigo-100 dark:bg-indigo-900/30 rounded-full h-1.5">
            <div
              className="bg-indigo-500 h-1.5 rounded-full transition-all"
              style={{ width: `${card.progress}%` }}
            />
          </div>
          <p className="text-[10px] text-indigo-500 mt-0.5">
            {card.stage === "reading" ? "Reading durations…" : `Processing… ${card.progress}%`}
          </p>
        </div>
      )}

      {/* Result info */}
      {card.stage === "done" && card.vocalDuration !== null && card.instrDuration !== null && (
        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
          <span className="font-mono text-emerald-600 dark:text-emerald-400">{formatSec(card.instrDuration)}</span>
          <ArrowRight className="w-3 h-3" />
          <span className="font-mono text-violet-600 dark:text-violet-400">{formatSec(card.vocalDuration)}</span>
          {card.speedFactor !== null && (
            <span className="text-slate-400">({card.speedFactor.toFixed(3)}x)</span>
          )}
        </div>
      )}

      {/* Error message */}
      {card.stage === "error" && card.error && (
        <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 truncate">{card.error}</p>
      )}
    </div>
  );
}

// Shared FFmpeg engine (single instance, recycled as needed)
const MEMORY_ERROR_PATTERNS = ["memory access out of bounds", "out of memory", "abort", "RuntimeError", "not loaded"];

function isMemoryError(msg: string) {
  return MEMORY_ERROR_PATTERNS.some((p) => msg.toLowerCase().includes(p.toLowerCase()));
}

export default function AudioPlusMinusTab() {
  const { toast } = useToast();
  const [cards, setCards] = useState<CardState[]>([makeCard(), makeCard(), makeCard()]);
  const [running, setRunning] = useState(false);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    return () => {
      try { ffmpegRef.current?.terminate(); } catch { /* ignore */ }
    };
  }, []);

  function updateCard(id: string, patch: Partial<CardState>) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function loadVocalDuration(id: string, file: File) {
    updateCard(id, { vocalFile: file, vocalDuration: null });
    try {
      const d = await readAudioDuration(file);
      updateCard(id, { vocalDuration: d });
    } catch {
      updateCard(id, { vocalDuration: null });
    }
  }

  async function loadInstrDuration(id: string, file: File) {
    updateCard(id, { instrFile: file, instrDuration: null });
    try {
      const d = await readAudioDuration(file);
      updateCard(id, { instrDuration: d });
    } catch {
      updateCard(id, { instrDuration: null });
    }
  }

  function addCard() {
    setCards((prev) => [...prev, makeCard()]);
  }

  function removeCard(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  async function getFFmpeg(): Promise<FFmpeg> {
    if (ffmpegRef.current) return ffmpegRef.current;
    const ff = new FFmpeg();
    const coreURL = await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${FFMPEG_BASE_URL}/ffmpeg-core.wasm`, "application/wasm");
    await ff.load({ coreURL, wasmURL });
    ffmpegRef.current = ff;
    return ff;
  }

  async function recycleFFmpeg(): Promise<FFmpeg> {
    const old = ffmpegRef.current;
    ffmpegRef.current = null;
    if (old) { try { old.terminate(); } catch { /* ignore */ } }
    return getFFmpeg();
  }

  const processCard = useCallback(async (card: CardState): Promise<CardState> => {
    if (!card.vocalFile || !card.instrFile) return card;

    const id = card.id;
    updateCard(id, { stage: "reading", progress: 0, error: null });

    // Read durations if not already available
    let vocalDur = card.vocalDuration;
    let instrDur = card.instrDuration;

    try {
      if (!vocalDur) vocalDur = await readAudioDuration(card.vocalFile);
      if (!instrDur) instrDur = await readAudioDuration(card.instrFile);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateCard(id, { stage: "error", error: msg });
      return { ...card, stage: "error", error: msg };
    }

    updateCard(id, { vocalDuration: vocalDur, instrDuration: instrDur });

    // speedFactor: how much to speed up/down the instrument
    // instrument at 1.5x speed → plays in instrDur/1.5 = vocalDur
    // so speedFactor = instrDur / vocalDur
    const speedFactor = instrDur / vocalDur;

    if (Math.abs(speedFactor - 1.0) < SPEED_EPSILON) {
      // Already matching — just copy
      const blob = new Blob([await card.instrFile.arrayBuffer()], { type: card.instrFile.type || "audio/mpeg" });
      const name = card.instrFile.name;
      updateCard(id, { stage: "skipped", speedFactor, outputBlob: blob, outputName: name, outputDuration: instrDur });
      return { ...card, stage: "skipped", speedFactor, outputBlob: blob, outputName: name };
    }

    if (speedFactor < MIN_SPEED || speedFactor > MAX_SPEED) {
      const msg = `Speed factor ${speedFactor.toFixed(2)}x is out of range (${MIN_SPEED}x–${MAX_SPEED}x). Duration mismatch is too large.`;
      updateCard(id, { stage: "error", error: msg, speedFactor });
      return { ...card, stage: "error", error: msg };
    }

    updateCard(id, { stage: "processing", progress: 10, speedFactor });

    const ext = (card.instrFile.name.split(".").pop() || "mp3").toLowerCase();
    const baseName = card.instrFile.name.replace(/\.[^.]+$/, "");
    const outExt = "mp3";
    const outName = `${baseName}_speed${speedFactor.toFixed(3)}x.${outExt}`;
    const inputName = `instr_${id}.${ext}`;
    const outputName = `out_${id}.${outExt}`;

    let eng: FFmpeg;
    try {
      eng = await getFFmpeg();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateCard(id, { stage: "error", error: `FFmpeg load failed: ${msg}` });
      return { ...card, stage: "error", error: msg };
    }

    // Progress handler
    const onLog = ({ message }: { message: string }) => {
      const m = /time=(\d+):(\d+):([\d.]+)/.exec(message);
      if (m && instrDur) {
        const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        const pct = Math.min(95, Math.round((t / instrDur) * 90) + 10);
        updateCard(id, { progress: pct });
      }
    };
    eng.on("log", onLog);

    try {
      const data = await fetchFile(card.instrFile);
      await eng.writeFile(inputName, data);

      const atempoChain = buildAtempoChain(speedFactor);

      await eng.exec([
        "-hide_banner",
        "-loglevel", "info",
        "-i", inputName,
        "-af", atempoChain,
        "-c:a", "libmp3lame",
        "-q:a", "2",
        outputName,
      ]);

      const outData = await eng.readFile(outputName) as Uint8Array;
      const blob = new Blob([outData], { type: "audio/mpeg" });

      try { await eng.deleteFile(inputName); } catch { /* ignore */ }
      try { await eng.deleteFile(outputName); } catch { /* ignore */ }

      updateCard(id, {
        stage: "done",
        progress: 100,
        speedFactor,
        outputBlob: blob,
        outputName: outName,
        outputDuration: vocalDur,
        vocalDuration: vocalDur,
        instrDuration: instrDur,
      });

      return { ...card, stage: "done", speedFactor, outputBlob: blob, outputName: outName };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMemoryError(msg)) {
        // Retry after recycle
        try {
          eng = await recycleFFmpeg();
          const data = await fetchFile(card.instrFile);
          await eng.writeFile(inputName, data);
          const atempoChain = buildAtempoChain(speedFactor);
          await eng.exec(["-hide_banner", "-loglevel", "error", "-i", inputName, "-af", atempoChain, "-c:a", "libmp3lame", "-q:a", "2", outputName]);
          const outData = await eng.readFile(outputName) as Uint8Array;
          const blob = new Blob([outData], { type: "audio/mpeg" });
          try { await eng.deleteFile(inputName); } catch { /* ignore */ }
          try { await eng.deleteFile(outputName); } catch { /* ignore */ }
          updateCard(id, { stage: "done", progress: 100, speedFactor, outputBlob: blob, outputName: outName, outputDuration: vocalDur });
          return { ...card, stage: "done", speedFactor, outputBlob: blob, outputName: outName };
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          updateCard(id, { stage: "error", error: retryMsg });
          return { ...card, stage: "error", error: retryMsg };
        }
      }
      updateCard(id, { stage: "error", error: msg });
      return { ...card, stage: "error", error: msg };
    } finally {
      eng.off("log", onLog);
    }
  }, []);

  async function runAll() {
    const readyCards = cards.filter((c) => c.vocalFile && c.instrFile);
    if (readyCards.length === 0) {
      toast({ title: "No cards ready", description: "Add vocal + instrument files to at least one card.", variant: "destructive" });
      return;
    }

    setRunning(true);
    cancelRef.current = false;

    let done = 0;
    let errors = 0;

    for (const card of readyCards) {
      if (cancelRef.current) break;
      const result = await processCard(card);
      if (result.stage === "done" || result.stage === "skipped") done++;
      else if (result.stage === "error") errors++;
    }

    setRunning(false);

    if (done > 0) toast({ title: `✅ Done! ${done} instrument clip${done !== 1 ? "s" : ""} speed-adjusted.` });
    if (errors > 0) toast({ title: `${errors} clip${errors !== 1 ? "s" : ""} failed.`, variant: "destructive" });
  }

  function downloadCard(card: CardState) {
    if (!card.outputBlob) return;
    const url = URL.createObjectURL(card.outputBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = card.outputName;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadAll() {
    const done = cards.filter((c) => c.outputBlob);
    if (done.length === 0) return;
    const zip = new JSZip();
    for (const c of done) {
      if (c.outputBlob) zip.file(c.outputName, c.outputBlob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audio_adjusted.zip";
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearAll() {
    cancelRef.current = true;
    setRunning(false);
    setCards([makeCard(), makeCard(), makeCard()]);
    try { ffmpegRef.current?.terminate(); } catch { /* ignore */ }
    ffmpegRef.current = null;
  }

  const doneCount = cards.filter((c) => c.outputBlob).length;
  const readyCount = cards.filter((c) => c.vocalFile && c.instrFile).length;

  return (
    <div className="flex flex-col flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="mb-5">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-1">Audio +-</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Upload a <span className="font-medium text-emerald-600 dark:text-emerald-400">Vocal</span> clip as the duration reference and an{" "}
            <span className="font-medium text-violet-600 dark:text-violet-400">Instrument</span> clip to speed-adjust — the instrument will be stretched or compressed to match the vocal length.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mb-4 text-[11px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            Vocal = duration reference
          </span>
          <ArrowRight className="w-3 h-3" />
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-400" />
            Instrument = gets speed-adjusted
          </span>
        </div>

        {/* Cards */}
        <div className="space-y-3 mb-5">
          {cards.map((card, i) => (
            <CardRow
              key={card.id}
              card={card}
              index={i}
              onVocalFile={(f) => void loadVocalDuration(card.id, f)}
              onInstrFile={(f) => void loadInstrDuration(card.id, f)}
              onClearVocal={() => updateCard(card.id, { vocalFile: null, vocalDuration: null })}
              onClearInstr={() => updateCard(card.id, { instrFile: null, instrDuration: null, outputBlob: null, stage: "idle" })}
              onRemove={() => removeCard(card.id)}
              onDownload={() => downloadCard(card)}
              running={running}
            />
          ))}
        </div>

        {/* Add card button */}
        {!running && (
          <button
            onClick={addCard}
            className="w-full rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 py-2.5 text-sm text-slate-400 hover:border-violet-300 hover:text-violet-500 dark:hover:border-violet-700 dark:hover:text-violet-400 transition-colors flex items-center justify-center gap-2 mb-5"
          >
            <UploadCloud className="w-4 h-4" />
            Add another pair
          </button>
        )}

        {/* Action bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => void runAll()}
            disabled={running || readyCount === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 transition-colors"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gauge className="w-4 h-4" />}
            {running ? "Processing…" : `Run ${readyCount > 0 ? `(${readyCount})` : ""}`}
          </button>

          {running && (
            <button
              onClick={() => { cancelRef.current = true; setRunning(false); }}
              className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 text-red-600 dark:text-red-400 text-sm font-medium px-3 py-2 hover:bg-red-100 transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          )}

          {doneCount > 0 && !running && (
            <button
              onClick={() => void downloadAll()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm font-medium px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <Download className="w-4 h-4" />
              Download All ZIP ({doneCount})
            </button>
          )}

          {!running && cards.some((c) => c.vocalFile || c.instrFile || c.outputBlob) && (
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 text-sm px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Clear All
            </button>
          )}
        </div>

        {/* Summary */}
        {doneCount > 0 && (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <CheckCircle2 className="w-4 h-4 text-violet-500" />
            {doneCount} clip{doneCount !== 1 ? "s" : ""} ready
          </div>
        )}
      </div>
      <Toaster />
    </div>
  );
}
