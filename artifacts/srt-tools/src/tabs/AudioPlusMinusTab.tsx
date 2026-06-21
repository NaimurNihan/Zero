import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast as sonnerToast } from "sonner";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import {
  Loader2,
  CheckCircle2,
  Play,
  Download,
  X,
  ArrowRight,
  Music,
  UploadCloud,
  Plus,
  Trash2,
  GripVertical,
  Upload,
  AlertTriangle,
  Activity,
  CheckCheck,
  AlertCircle,
  FastForward,
  Rewind,
  Equal,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────
const MIN_SPEED = 0.25;
const MAX_SPEED = 4.0;
const SPEED_EPSILON = 0.005;
const INITIAL_CARDS = 6;
const RECYCLE_EVERY = 35;

function ffmpegBaseUrl(mt: boolean): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${base}/ffmpeg/${mt ? "mt" : "st"}`;
}
function canUseMtCore(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof SharedArrayBuffer === "undefined") return false;
  return Boolean(
    (window as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated,
  );
}
function pickPoolSize(): number {
  if (typeof navigator === "undefined") return 2;
  const cores = navigator.hardwareConcurrency || 4;
  return cores <= 2 ? 1 : 2;
}
const ENGINE_POOL_SIZE = pickPoolSize();

// ── Types ─────────────────────────────────────────────────────────────────────
type PoolItem = {
  id: string;
  file: File;
  kind: "vocal" | "instrument";
};

type Stage = "idle" | "reading" | "processing" | "done" | "error";

type CardState = {
  canProcess: boolean;
  isWorking: boolean;
  mode: "speedup" | "slowdown" | "extreme" | "match" | null;
  hasVocal: boolean;
  hasInstrument: boolean;
  isDone: boolean;
  mergedBlob?: Blob | null;
  mergedName?: string;
  isArchived?: boolean;
  isReadingDuration?: boolean;
};

const DEFAULT_CARD_STATE: CardState = {
  canProcess: false,
  isWorking: false,
  mode: null,
  hasVocal: false,
  hasInstrument: false,
  isDone: false,
};

function sameCardState(a: CardState, b: CardState): boolean {
  return (
    a.canProcess === b.canProcess &&
    a.isWorking === b.isWorking &&
    a.hasVocal === b.hasVocal &&
    a.hasInstrument === b.hasInstrument &&
    a.isDone === b.isDone &&
    a.mode === b.mode &&
    !!a.isReadingDuration === !!b.isReadingDuration &&
    a.mergedBlob === b.mergedBlob &&
    a.mergedName === b.mergedName &&
    !!a.isArchived === !!b.isArchived
  );
}

// ── Pool context ──────────────────────────────────────────────────────────────
const PoolContext = createContext<{ getFile: (id: string) => File | undefined }>(
  { getFile: () => undefined },
);
const POOL_MIME_ID = "application/x-apm-pool-id";
const POOL_MIME_KIND = "application/x-apm-pool-kind";

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSeconds(s: number): string {
  if (!isFinite(s) || s < 0) return "0.00s";
  return `${s.toFixed(2)}s`;
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const DUR_CONCURRENCY = 8;
let _durActive = 0;
const _durQueue: (() => void)[] = [];
function acquireDurSlot(): Promise<void> {
  return new Promise((resolve) => {
    const tryAcq = () => {
      if (_durActive < DUR_CONCURRENCY) { _durActive++; resolve(); }
      else _durQueue.push(tryAcq);
    };
    tryAcq();
  });
}
function releaseDurSlot() {
  _durActive--;
  _durQueue.shift()?.();
}

function readDurOnce(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("audio") as HTMLAudioElement;
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    let settled = false;
    const cleanup = () => { URL.revokeObjectURL(url); el.src = ""; try { el.load(); } catch {} };
    const finish = (d: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!isFinite(d) || d <= 0) reject(new Error("Could not read audio duration"));
      else resolve(d);
    };
    el.onloadedmetadata = () => {
      const d = el.duration;
      if (isFinite(d) && d > 0) { finish(d); return; }
      el.ontimeupdate = () => { el.ontimeupdate = null; finish(el.duration); };
      try { el.currentTime = 1e9; } catch { finish(NaN); }
    };
    el.onerror = () => {
      if (!settled) { settled = true; cleanup(); reject(new Error("Failed to load audio")); }
    };
    setTimeout(() => {
      if (!settled) { settled = true; cleanup(); reject(new Error("Timed out")); }
    }, 45000);
    el.src = url;
  });
}

async function getAudioDuration(file: File): Promise<number> {
  await acquireDurSlot();
  try {
    try { return await readDurOnce(file); }
    catch { return await readDurOnce(file); }
  } finally { releaseDurSlot(); }
}

function buildAtempoFilter(factor: number): string {
  if (factor >= 0.5 && factor <= 2.0) return `atempo=${factor.toFixed(6)}`;
  if (factor > 2.0) {
    const chain: string[] = [];
    let rem = factor;
    while (rem > 2.0) { chain.push("atempo=2.0"); rem /= 2.0; }
    chain.push(`atempo=${rem.toFixed(6)}`);
    return chain.join(",");
  }
  const chain: string[] = [];
  let rem = factor;
  while (rem < 0.5) { chain.push("atempo=0.5"); rem /= 0.5; }
  chain.push(`atempo=${rem.toFixed(6)}`);
  return chain.join(",");
}

const MEM_PATTERNS = [
  "memory access out of bounds",
  "out of memory",
  "Cannot enlarge memory",
  "table index is out of bounds",
  "Aborted",
];
function isMemoryError(msg: string | undefined | null): boolean {
  if (!msg) return false;
  const l = msg.toLowerCase();
  return MEM_PATTERNS.some((p) => l.includes(p.toLowerCase()));
}

// ── Engine slot type ──────────────────────────────────────────────────────────
type EngineSlot = {
  id: number;
  ffmpeg: FFmpeg | null;
  jobsSinceRecycle: number;
  busy: boolean;
  loading: Promise<FFmpeg> | null;
  progressCb: ((p: number) => void) | null;
  nextFfmpeg: FFmpeg | null;
  preWarmLoading: Promise<void> | null;
};

// ── AudioCard handle ──────────────────────────────────────────────────────────
export type AudioCardHandle = {
  runProcess: () => Promise<{ blob: Blob; name: string } | null>;
  passThrough: () => Promise<{ blob: Blob; name: string } | null>;
  loadVocal: (file: File) => void;
  loadInstrument: (file: File) => void;
  markArchived: () => void;
  resetCard: () => void;
};

// ── UploadBox ─────────────────────────────────────────────────────────────────
function UploadBox({
  kind, file, duration, onChange, disabled, testIdSuffix = "",
}: {
  kind: "vocal" | "instrument";
  file: File | null;
  duration: number | null;
  onChange: (f: File | null) => void;
  disabled?: boolean;
  testIdSuffix?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFile = !!file;
  const poolCtx = useContext(PoolContext);
  const [dropActive, setDropActive] = useState(false);
  const [dropReject, setDropReject] = useState(false);

  const isVocal = kind === "vocal";
  const palette = isVocal
    ? {
        gradient: "from-emerald-50 via-white to-teal-50/60 hover:from-emerald-100/80 hover:via-white hover:to-teal-100/60",
        ring: "ring-emerald-200/70 hover:ring-emerald-300",
        ringActive: "ring-emerald-400 shadow-emerald-200/50",
        iconBg: "bg-gradient-to-br from-emerald-400 to-teal-500",
        accentText: "text-emerald-700",
        dot: "bg-emerald-500",
      }
    : {
        gradient: "from-violet-50 via-white to-purple-50/60 hover:from-violet-100/80 hover:via-white hover:to-purple-100/60",
        ring: "ring-violet-200/70 hover:ring-violet-300",
        ringActive: "ring-violet-400 shadow-violet-200/50",
        iconBg: "bg-gradient-to-br from-violet-400 to-purple-500",
        accentText: "text-violet-700",
        dot: "bg-violet-500",
      };

  const label = isVocal ? "Vocal" : "Instrument";

  return (
    <div
      className={`group relative cursor-pointer overflow-hidden rounded-xl bg-gradient-to-br ${palette.gradient} px-3 py-2.5 ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
        dropReject ? "ring-2 ring-rose-500 shadow-rose-200/60"
        : dropActive ? "ring-2 ring-indigo-500 shadow-indigo-200/60 scale-[1.02]"
        : hasFile ? `${palette.ringActive} shadow-md`
        : palette.ring
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        const types = Array.from(e.dataTransfer.types || []);
        if (types.includes(POOL_MIME_KIND)) {
          const k = e.dataTransfer.getData(POOL_MIME_KIND);
          if (k && k !== kind) { setDropReject(true); setDropActive(false); e.dataTransfer.dropEffect = "none"; return; }
        }
        setDropActive(true); setDropReject(false); e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => { setDropActive(false); setDropReject(false); }}
      onDrop={(e) => {
        e.preventDefault(); setDropActive(false); setDropReject(false);
        const poolId = e.dataTransfer.getData(POOL_MIME_ID);
        const poolKind = e.dataTransfer.getData(POOL_MIME_KIND);
        if (poolId) {
          if (poolKind && poolKind !== kind) return;
          const f = poolCtx.getFile(poolId);
          if (f) onChange(f);
          return;
        }
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith("audio/")) onChange(f);
      }}
      data-testid={`upload-box-${kind}${testIdSuffix}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onChange(f); if (e.target) e.target.value = ""; }}
        data-testid={`input-${kind}${testIdSuffix}`}
      />
      <div className="flex items-center gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${palette.iconBg} text-white shadow-md`}>
          <Music className="h-3.5 w-3.5" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          {hasFile ? (
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${palette.dot}`} />
              <span className="truncate text-[11px] font-semibold text-slate-700">{file!.name}</span>
              {duration !== null && (
                <span className={`shrink-0 font-mono text-[10px] ${palette.accentText}`}>{formatSeconds(duration)}</span>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className={`text-[11px] font-semibold ${palette.accentText}`}>{label}</span>
              <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                <UploadCloud className="h-3 w-3" />upload
              </span>
            </div>
          )}
          {!hasFile && <p className="text-[10px] text-slate-400">Drop or click to add an audio file</p>}
        </div>
      </div>
    </div>
  );
}

// ── ActionButton ──────────────────────────────────────────────────────────────
function ActionButton({
  onClick, disabled, icon, label, testId, variant = "cancel",
}: {
  onClick?: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  testId: string;
  variant?: "cancel" | "play" | "download";
}) {
  const cls =
    variant === "play"
      ? "border-emerald-300 bg-gradient-to-b from-emerald-50 to-emerald-100 text-emerald-700 hover:from-emerald-100 hover:to-emerald-200 hover:border-emerald-500"
      : variant === "download"
      ? "border-indigo-300 bg-gradient-to-b from-indigo-50 to-indigo-100 text-indigo-700 hover:from-indigo-100 hover:to-indigo-200 hover:border-indigo-500"
      : "border-rose-300 bg-gradient-to-b from-rose-50 to-rose-100 text-rose-700 hover:from-rose-100 hover:to-rose-200 hover:border-rose-500";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex flex-1 items-center justify-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-wide shadow-sm transition active:scale-95 ${cls} ${disabled ? "pointer-events-none opacity-40" : ""}`}
      data-testid={testId}
    >
      {icon}{label}
    </button>
  );
}

// ── PlayablePreview ───────────────────────────────────────────────────────────
function PlayablePreview({
  audioUrl, archived, playing, setPlaying, testId,
}: {
  audioUrl: string | null;
  archived: boolean;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  testId: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!audioRef.current) return;
    if (playing && audioUrl) { audioRef.current.src = audioUrl; void audioRef.current.play().catch(() => {}); }
    else { audioRef.current.pause(); }
  }, [playing, audioUrl]);

  if (archived) {
    return (
      <div className="flex h-[68px] w-[120px] shrink-0 items-center justify-center rounded-lg border-2 border-emerald-300 bg-emerald-50 text-[10px] font-bold text-emerald-700">
        <CheckCheck className="mr-1 h-3 w-3" />Archived
      </div>
    );
  }
  return (
    <div
      className={`relative flex h-[68px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition ${
        audioUrl ? "border-violet-300 bg-violet-50" : "border-slate-200 bg-slate-50"
      }`}
      data-testid={testId}
    >
      {audioUrl ? (
        <>
          <audio ref={audioRef} onEnded={() => setPlaying(false)} className="hidden" />
          <div className="flex flex-col items-center gap-1">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full ${playing ? "bg-violet-500" : "bg-violet-400"}`}>
              <Music className="h-4 w-4 text-white" />
            </div>
            <span className="text-[9px] font-semibold text-violet-600">{playing ? "Playing…" : "Ready"}</span>
          </div>
        </>
      ) : (
        <span className="text-[10px] text-slate-400">preview</span>
      )}
    </div>
  );
}

// ── AudioCard ─────────────────────────────────────────────────────────────────
const AudioCard = forwardRef<
  AudioCardHandle,
  {
    index: number;
    engineReady: boolean;
    acquireSlot: () => Promise<EngineSlot>;
    releaseSlot: (s: EngineSlot) => void;
    recycleSlot: (s: EngineSlot) => void;
    onStateChange: (idx: number, s: CardState) => void;
    onDownload: () => void;
    highlight: boolean;
  }
>(function AudioCard(
  { index, engineReady, acquireSlot, releaseSlot, recycleSlot, onStateChange, onDownload, highlight },
  ref,
) {
  const [vocalFile, setVocalFile] = useState<File | null>(null);
  const [instrFile, setInstrFile] = useState<File | null>(null);
  const [vocalDur, setVocalDur] = useState<number | null>(null);
  const [instrDur, setInstrDur] = useState<number | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mergedBlob, setMergedBlob] = useState<Blob | null>(null);
  const [mergedUrl, setMergedUrl] = useState<string | null>(null);
  const [mergedName, setMergedName] = useState<string>("");
  const [mergedSize, setMergedSize] = useState(0);
  const [mergedDuration, setMergedDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [archived, setArchived] = useState(false);
  const [isReadingDur, setIsReadingDur] = useState(false);

  const speedFactor =
    vocalDur !== null && instrDur !== null && vocalDur > 0
      ? instrDur / vocalDur
      : null;

  const mode: CardState["mode"] =
    speedFactor === null ? null
    : Math.abs(speedFactor - 1) < SPEED_EPSILON ? "match"
    : speedFactor < MIN_SPEED || speedFactor > MAX_SPEED ? "extreme"
    : speedFactor > 1 ? "speedup"
    : "slowdown";

  const canProcess =
    !!vocalFile && !!instrFile &&
    vocalDur !== null && instrDur !== null &&
    engineReady && mode !== null && mode !== "extreme";

  const isWorking = stage === "reading" || stage === "processing";

  const currentState: CardState = {
    canProcess,
    isWorking,
    mode,
    hasVocal: !!vocalFile,
    hasInstrument: !!instrFile,
    isDone: stage === "done",
    mergedBlob,
    mergedName: mergedName || undefined,
    isArchived: archived,
    isReadingDuration: isReadingDur,
  };

  const prevStateRef = useRef<CardState>(currentState);
  useEffect(() => {
    if (!sameCardState(prevStateRef.current, currentState)) {
      prevStateRef.current = currentState;
      onStateChange(index - 1, currentState);
    }
  });

  const reset = () => {
    if (mergedUrl) URL.revokeObjectURL(mergedUrl);
    setVocalFile(null); setInstrFile(null);
    setVocalDur(null); setInstrDur(null);
    setStage("idle"); setProgress(0); setErrorMsg(null);
    setMergedBlob(null); setMergedUrl(null); setMergedName(""); setMergedSize(0); setMergedDuration(0);
    setPlaying(false); setArchived(false);
  };

  const handleVocal = async (f: File | null) => {
    if (!f) return;
    if (mergedUrl) { URL.revokeObjectURL(mergedUrl); setMergedUrl(null); }
    setMergedBlob(null); setMergedName(""); setMergedSize(0); setMergedDuration(0);
    setStage("idle"); setErrorMsg(null); setProgress(0);
    setVocalFile(f); setVocalDur(null); setIsReadingDur(true);
    try { const d = await getAudioDuration(f); setVocalDur(d); }
    catch { setVocalDur(null); }
    finally { setIsReadingDur(false); }
  };

  const handleInstr = async (f: File | null) => {
    if (!f) return;
    if (mergedUrl) { URL.revokeObjectURL(mergedUrl); setMergedUrl(null); }
    setMergedBlob(null); setMergedName(""); setMergedSize(0); setMergedDuration(0);
    setStage("idle"); setErrorMsg(null); setProgress(0);
    setInstrFile(f); setInstrDur(null); setIsReadingDur(true);
    try { const d = await getAudioDuration(f); setInstrDur(d); }
    catch { setInstrDur(null); }
    finally { setIsReadingDur(false); }
  };

  const doProcess = async (
    ffmpeg: FFmpeg,
    sf: number,
  ): Promise<{ blob: Blob; name: string }> => {
    const ext = (instrFile!.name.split(".").pop() || "mp3").toLowerCase();
    const inputName = `instr_${index}.${ext}`;
    await ffmpeg.writeFile(inputName, await fetchFile(instrFile!));
    const atempoFilter = buildAtempoFilter(sf);
    await ffmpeg.exec([
      "-i", inputName,
      "-filter:a", atempoFilter,
      "-c:a", "libmp3lame", "-q:a", "2",
      `out_${index}.mp3`,
    ]);
    const data = await ffmpeg.readFile(`out_${index}.mp3`);
    const arr = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    const blob = new Blob([arr as unknown as BlobPart], { type: "audio/mpeg" });
    const baseName = instrFile!.name.replace(/\.[^.]+$/, "");
    const finalName = `${baseName}_adj${String(index).padStart(3, "0")}.mp3`;
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(`out_${index}.mp3`).catch(() => {});
    return { blob, name: finalName };
  };

  const runProcess = async (): Promise<{ blob: Blob; name: string } | null> => {
    if (!canProcess || !instrFile || speedFactor === null) return null;
    setStage("processing"); setProgress(0); setErrorMsg(null);
    const slot = await acquireSlot();
    slot.progressCb = (p) => setProgress(p);
    try {
      let result: { blob: Blob; name: string };
      try {
        result = await doProcess(slot.ffmpeg!, speedFactor);
      } catch (e) {
        if (isMemoryError((e as Error).message)) {
          recycleSlot(slot);
          const slot2 = await acquireSlot();
          slot2.progressCb = (p) => setProgress(p);
          try {
            result = await doProcess(slot2.ffmpeg!, speedFactor);
            slot2.jobsSinceRecycle++;
            if (slot2.jobsSinceRecycle >= RECYCLE_EVERY) recycleSlot(slot2); else releaseSlot(slot2);
          } catch (e2) {
            console.error(e2);
            setStage("error"); setErrorMsg("Out of memory. Try fewer cards at once.");
            releaseSlot(slot2);
            return null;
          }
        } else {
          throw e;
        }
      }
      const dur = await getAudioDuration(
        new File([result!.blob], result!.name, { type: "audio/mpeg" }),
      ).catch(() => 0);
      setMergedBlob(result!.blob); setMergedName(result!.name);
      setMergedSize(result!.blob.size); setMergedDuration(dur);
      setStage("done"); setProgress(100);
      slot.jobsSinceRecycle++;
      if (slot.jobsSinceRecycle >= RECYCLE_EVERY) recycleSlot(slot); else releaseSlot(slot);
      return result!;
    } catch (e) {
      console.error(e);
      const msg = (e as Error).message || String(e);
      setStage("error"); setErrorMsg(msg || "Processing failed.");
      releaseSlot(slot);
      return null;
    }
  };

  const passThrough = async (): Promise<{ blob: Blob; name: string } | null> => {
    if (!instrFile) return null;
    const ext = (instrFile.name.split(".").pop() || "mp3").toLowerCase();
    const finalName = `${instrFile.name.replace(/\.[^.]+$/, "")}_match${String(index).padStart(3, "0")}.${ext}`;
    const blob = new Blob([await instrFile.arrayBuffer()], { type: instrFile.type || "audio/mpeg" });
    setMergedBlob(blob); setMergedName(finalName); setMergedSize(blob.size);
    setMergedDuration(instrDur ?? 0);
    setStage("done"); setProgress(100);
    return { blob, name: finalName };
  };

  useImperativeHandle(ref, () => ({
    runProcess,
    passThrough,
    loadVocal: (file: File) => { void handleVocal(file); },
    loadInstrument: (file: File) => { void handleInstr(file); },
    markArchived: () => {
      if (mergedUrl) URL.revokeObjectURL(mergedUrl);
      setMergedUrl(null); setMergedBlob(null); setPlaying(false); setArchived(true);
    },
    resetCard: () => reset(),
  }));

  const cardBorder =
    (!!vocalFile !== !!instrFile)
      ? "border-rose-500 shadow-md shadow-rose-200/50 bg-rose-50/40"
      : mode === "extreme"
      ? "border-amber-500 shadow-md shadow-amber-200/50 bg-amber-50/40"
      : mode === "speedup"
      ? "border-green-500 shadow-md shadow-green-200/50 bg-green-50/40"
      : mode === "slowdown"
      ? "border-blue-500 shadow-md shadow-blue-200/50 bg-blue-50/40"
      : highlight
      ? "border-cyan-500 shadow-md"
      : "border-slate-300";

  return (
    <div className={`rounded-2xl border-2 bg-white p-4 shadow-sm transition-colors ${cardBorder}`}>
      <div className="flex items-stretch gap-3">
        {/* Number */}
        <div className="flex shrink-0 items-center justify-center">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-slate-400 font-mono text-sm font-bold text-slate-700">
            {String(index).padStart(3, "0")}
          </div>
        </div>

        {/* Stacked upload boxes */}
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <UploadBox kind="vocal" file={vocalFile} duration={vocalDur} onChange={handleVocal} disabled={isWorking} testIdSuffix={`-${index}`} />
          <UploadBox kind="instrument" file={instrFile} duration={instrDur} onChange={handleInstr} disabled={isWorking} testIdSuffix={`-${index}`} />
        </div>

        {/* Arrow */}
        <div className="flex shrink-0 items-center justify-center">
          <ArrowRight className="h-5 w-5 text-slate-500" />
        </div>

        {/* Preview + buttons */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <PlayablePreview
            audioUrl={mergedUrl}
            archived={archived}
            playing={playing}
            setPlaying={setPlaying}
            testId={`audio-merged-${index}`}
          />
          <div className="flex w-full items-center justify-center gap-1.5">
            <ActionButton
              onClick={reset}
              disabled={!vocalFile && !instrFile && !mergedBlob && !errorMsg}
              icon={<X className="h-3 w-3" />}
              label="cancel"
              testId={`button-cancel-${index}`}
              variant="cancel"
            />
            <ActionButton
              onClick={() => {
                if (!mergedBlob) return;
                if (!mergedUrl) { const u = URL.createObjectURL(mergedBlob); setMergedUrl(u); }
                setPlaying(true);
              }}
              disabled={!mergedBlob}
              icon={<Play className="h-3 w-3" />}
              label="play"
              testId={`button-play-${index}`}
              variant="play"
            />
            <ActionButton
              onClick={() => {
                if (!mergedBlob) return;
                const u = URL.createObjectURL(mergedBlob);
                const a = document.createElement("a");
                a.href = u; a.download = mergedName || `audio_adj_${index}.mp3`;
                a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
                onDownload();
              }}
              disabled={!mergedBlob}
              icon={<Download className="h-3 w-3" />}
              label="download"
              testId={`button-download-${index}`}
              variant="download"
            />
          </div>
        </div>
      </div>

      {/* Status row */}
      {(isWorking || errorMsg || mode !== null || mergedBlob) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {mode === "extreme" && !mergedBlob && speedFactor !== null && (
            <span className="inline-flex items-center gap-1.5 rounded border border-amber-400 bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
              <AlertTriangle className="h-3 w-3" />
              {`${speedFactor.toFixed(2)}× — out of range (0.25×–4.0×)`}
            </span>
          )}
          {mode === "speedup" && !mergedBlob && speedFactor !== null && (
            <span className="inline-flex items-center gap-1.5 rounded border border-green-500 bg-green-100 px-2 py-0.5 font-semibold text-green-800">
              <FastForward className="h-3 w-3" />speed +{speedFactor.toFixed(2)}× (faster)
            </span>
          )}
          {mode === "slowdown" && !mergedBlob && speedFactor !== null && (
            <span className="inline-flex items-center gap-1.5 rounded border border-blue-500 bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
              <Rewind className="h-3 w-3" />speed {speedFactor.toFixed(2)}× (slower)
            </span>
          )}
          {mode === "match" && !mergedBlob && (
            <span className="inline-flex items-center gap-1.5 rounded border border-teal-400 bg-teal-100 px-2 py-0.5 font-semibold text-teal-800">
              <Equal className="h-3 w-3" />durations match — pass-through
            </span>
          )}
          {isWorking && (
            <span className="flex flex-1 items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                <span className="block h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all" style={{ width: `${progress}%` }} />
              </span>
              <span className="font-mono">{progress}% · {stage}</span>
            </span>
          )}
          {mergedBlob && !isWorking && (
            <>
              <span className="truncate text-slate-700">{mergedName}</span>
              <span>·</span>
              <span>{formatBytes(mergedSize)}</span>
              <span>·</span>
              <span>{formatSeconds(mergedDuration)}</span>
            </>
          )}
          {errorMsg && <span className="text-rose-600">{errorMsg}</span>}
        </div>
      )}
    </div>
  );
});

// ── MediaPool ─────────────────────────────────────────────────────────────────
function MediaPool({
  kind, items, onAdd, onRemove, onClear, onLoad, onClearAll,
}: {
  kind: "vocal" | "instrument";
  items: PoolItem[];
  onAdd: (files: FileList | File[]) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onLoad: () => void;
  onClearAll?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const isVocal = kind === "vocal";
  const title = isVocal ? "VOCAL POOL" : "INSTRUMENT POOL";
  const headerGradient = isVocal ? "from-emerald-500 to-teal-500" : "from-violet-500 to-purple-500";

  const AUDIO_EXTS = /\.(mp3|wav|aac|m4a|ogg|flac|opus|weba|webm|caf|aiff|aif|wma|amr|3gp|3g2|mp4|m4b|m4p|mp2|mpa|mka)$/i;
  const handleAdd = (files: FileList | File[]) => {
    const arr = Array.from(files).filter(
      (f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || (!f.type && AUDIO_EXTS.test(f.name)),
    );
    if (arr.length) onAdd(arr);
  };

  return (
    <div className="rounded-2xl border-2 border-slate-300 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${headerGradient} text-white shadow-md`}>
            <Music className="h-4 w-4" strokeWidth={2.25} />
          </span>
          <div>
            <h2 className="text-sm font-bold tracking-wide text-slate-800">{title}</h2>
            <p className="font-mono text-[11px] text-slate-500">{items.length} file{items.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onLoad} disabled={items.length === 0}
            className="inline-flex h-8 items-center justify-center gap-1 rounded-full border border-sky-300 bg-sky-50 px-3 text-[11px] font-semibold uppercase tracking-wide text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-40">
            <Upload className="h-3.5 w-3.5" />Load
          </button>
          <button type="button" onClick={() => inputRef.current?.click()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
            <Plus className="h-4 w-4" />
          </button>
          {items.length > 0 && (
            <button type="button" onClick={onClear}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {onClearAll && (
            <button type="button" onClick={onClearAll}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-full border border-rose-400 bg-rose-100 px-2.5 text-[11px] font-semibold text-rose-700 hover:bg-rose-200">
              <Trash2 className="h-3 w-3" />Clear All
            </button>
          )}
          <input ref={inputRef} type="file" multiple accept="audio/*,.aac,.m4a,.aiff,.aif,.wma,.opus,.flac,.ogg,.wav,.mp3,.mp4,.webm" className="hidden"
            onChange={(e) => { if (e.target.files) handleAdd(e.target.files); e.target.value = ""; }} />
        </div>
      </div>
      <div
        onClick={() => { if (items.length === 0) inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) handleAdd(e.dataTransfer.files); }}
        className={`max-h-[220px] overflow-y-auto rounded-xl border-2 border-dashed p-3 transition ${dragOver ? "border-indigo-400 bg-indigo-50/60" : items.length === 0 ? "border-slate-200 bg-slate-50/40 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30" : "border-slate-200 bg-slate-50/40"}`}
      >
        {items.length === 0 ? (
          <div className="py-6 text-center text-[12px] text-slate-400">
            <UploadCloud className="mx-auto mb-1 h-5 w-5" />
            Drop audio files here, or click "Add files"
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <PoolItemCard key={item.id} item={item} onRemove={() => onRemove(item.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PoolItemCard({ item, onRemove }: { item: PoolItem; onRemove: () => void }) {
  const isVocal = item.kind === "vocal";
  const palette = isVocal
    ? "from-emerald-50 to-teal-50 ring-emerald-200 text-emerald-700"
    : "from-violet-50 to-purple-50 ring-violet-200 text-violet-700";
  const iconBg = isVocal
    ? "bg-gradient-to-br from-emerald-400 to-teal-500"
    : "bg-gradient-to-br from-violet-400 to-purple-500";
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(POOL_MIME_ID, item.id);
        e.dataTransfer.setData(POOL_MIME_KIND, item.kind);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`group relative flex cursor-grab items-center gap-2 rounded-lg bg-gradient-to-br ${palette} px-2.5 py-2 ring-1 transition active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md`}
      title={`${item.file.name} · drag onto a card's ${item.kind} slot`}
    >
      <GripVertical className="h-3 w-3 shrink-0 text-slate-400 group-hover:text-slate-600" />
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${iconBg} text-white shadow`}>
        <Music className="h-3.5 w-3.5" strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-slate-700">{item.file.name}</div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
          <span className="uppercase">{item.kind}</span>
          <span>·</span>
          <span>{formatBytes(item.file.size)}</span>
        </div>
      </div>
      <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-white/80 text-slate-400 shadow-sm hover:text-rose-500 group-hover:flex">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AudioPlusMinusTab() {
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(true);
  const [ffmpegError, setFfmpegError] = useState<string>("");

  const useMtRef = useRef<boolean>(canUseMtCore());
  const slotsRef = useRef<EngineSlot[]>([]);
  const slotWaitersRef = useRef<Array<() => void>>([]);

  const loadFreshFFmpeg = async (slot: EngineSlot): Promise<FFmpeg> => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      slot.progressCb?.(Math.min(100, Math.max(0, Math.round(progress * 100))));
    });
    const tryLoad = async (mt: boolean) => {
      const base = ffmpegBaseUrl(mt);
      const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
      const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");
      const opts: { coreURL: string; wasmURL: string; workerURL?: string } = { coreURL, wasmURL };
      if (mt) opts.workerURL = await toBlobURL(`${base}/ffmpeg-core.worker.js`, "text/javascript");
      await ffmpeg.load(opts);
    };
    if (useMtRef.current) {
      try { await tryLoad(true); return ffmpeg; }
      catch { useMtRef.current = false; }
    }
    await tryLoad(false);
    return ffmpeg;
  };

  useEffect(() => {
    let cancelled = false;
    const slots: EngineSlot[] = Array.from({ length: ENGINE_POOL_SIZE }, (_, i) => ({
      id: i, ffmpeg: null, jobsSinceRecycle: 0, busy: false,
      loading: null, progressCb: null, nextFfmpeg: null, preWarmLoading: null,
    }));
    slotsRef.current = slots;
    Promise.all(
      slots.map(async (slot) => {
        try {
          const ffmpeg = await loadFreshFFmpeg(slot);
          if (!cancelled) slot.ffmpeg = ffmpeg;
        } catch (err) {
          if (!cancelled) setFfmpegError((err as Error).message || "Engine failed to load");
        }
      }),
    ).then(() => {
      if (!cancelled) { setFfmpegReady(true); setFfmpegLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  const acquireSlot = useCallback((): Promise<EngineSlot> => {
    return new Promise((resolve) => {
      const tryGet = () => {
        const slot = slotsRef.current.find((s) => !s.busy && s.ffmpeg);
        if (slot) { slot.busy = true; resolve(slot); }
        else slotWaitersRef.current.push(tryGet);
      };
      tryGet();
    });
  }, []);

  const releaseSlot = useCallback((slot: EngineSlot) => {
    slot.busy = false;
    slotWaitersRef.current.shift()?.();
  }, []);

  const recycleSlot = useCallback((slot: EngineSlot) => {
    slot.busy = false; slot.ffmpeg = null; slot.jobsSinceRecycle = 0;
    loadFreshFFmpeg(slot).then((ff) => {
      slot.ffmpeg = ff;
      slotWaitersRef.current.shift()?.();
    }).catch(console.error);
  }, []);

  // ── Pools ───────────────────────────────────────────────────────────────────
  const [pool, setPool] = useState<PoolItem[]>([]);
  const poolRef = useRef<PoolItem[]>([]);
  poolRef.current = pool;

  const poolCtx = useMemo(() => ({
    getFile: (id: string) => poolRef.current.find((p) => p.id === id)?.file,
  }), []);

  const addPoolFiles = (files: FileList | File[], kind: "vocal" | "instrument") => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("audio/"));
    if (!arr.length) return;
    const newItems: PoolItem[] = arr.map((f, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      file: f, kind,
    }));
    setPool((p) => [...p, ...newItems]);
    setLoadLocked(false);
  };

  const removePoolItem = (id: string) => setPool((p) => p.filter((x) => x.id !== id));
  const [loadLocked, setLoadLocked] = useState(false);

  // ── Cards ───────────────────────────────────────────────────────────────────
  const [numCards, setNumCards] = useState(INITIAL_CARDS);
  const cardRefs = useRef<(AudioCardHandle | null)[]>(Array(INITIAL_CARDS).fill(null));
  const [cardStates, setCardStates] = useState<CardState[]>(
    Array.from({ length: INITIAL_CARDS }, () => ({ ...DEFAULT_CARD_STATE })),
  );
  const cardStatesRef = useRef<CardState[]>(cardStates);
  useEffect(() => { cardStatesRef.current = cardStates; }, [cardStates]);

  const pendingUpdatesRef = useRef<Map<number, CardState>>(new Map());
  const rafScheduledRef = useRef(false);
  const setCardState = useCallback((idx: number, s: CardState) => {
    pendingUpdatesRef.current.set(idx, s);
    if (rafScheduledRef.current) return;
    rafScheduledRef.current = true;
    requestAnimationFrame(() => {
      rafScheduledRef.current = false;
      const updates = pendingUpdatesRef.current;
      pendingUpdatesRef.current = new Map();
      if (!updates.size) return;
      setCardStates((prev) => {
        let maxIdx = prev.length - 1;
        updates.forEach((_, i) => { if (i > maxIdx) maxIdx = i; });
        const next = prev.slice();
        while (next.length <= maxIdx) next.push({ ...DEFAULT_CARD_STATE });
        let changed = false;
        updates.forEach((st, i) => {
          if (!sameCardState(next[i] ?? DEFAULT_CARD_STATE, st)) { next[i] = st; changed = true; }
        });
        if (!changed) return prev;
        cardStatesRef.current = next;
        return next;
      });
    });
  }, []);

  const addCard = () => {
    setNumCards((n) => { const next = n + 1; cardRefs.current.length = next; return next; });
    setCardStates((prev) => { const next = [...prev, { ...DEFAULT_CARD_STATE }]; cardStatesRef.current = next; return next; });
  };

  const ensureCards = (count: number) => {
    if (count <= numCards) return;
    cardRefs.current.length = count;
    setNumCards(count);
    setCardStates((prev) => {
      if (prev.length >= count) return prev;
      const next = prev.slice();
      while (next.length < count) next.push({ ...DEFAULT_CARD_STATE });
      cardStatesRef.current = next;
      return next;
    });
  };

  // ── Load pool to cards ──────────────────────────────────────────────────────
  type PendingLoad = {
    kind: "vocal" | "instrument";
    assignments: { cardIndex: number; file: File }[];
    fallbackFiles: File[];
    requiredCards: number;
  };
  const pendingVocalRef = useRef<PendingLoad | null>(null);
  const pendingInstrRef = useRef<PendingLoad | null>(null);

  const flushPendingKind = (
    pending: PendingLoad,
    ref: React.MutableRefObject<PendingLoad | null>,
  ) => {
    const { kind, assignments, fallbackFiles } = pending;
    const used = new Set<number>();
    let allAssigned = true;
    for (const { cardIndex, file } of assignments) {
      const h = cardRefs.current[cardIndex];
      if (!h) { allAssigned = false; continue; }
      if (kind === "vocal") h.loadVocal(file); else h.loadInstrument(file);
      used.add(cardIndex);
    }
    let nextSlot = 0;
    for (const file of fallbackFiles) {
      while (used.has(nextSlot)) nextSlot++;
      const h = cardRefs.current[nextSlot];
      if (!h) { allAssigned = false; break; }
      if (kind === "vocal") h.loadVocal(file); else h.loadInstrument(file);
      used.add(nextSlot); nextSlot++;
    }
    if (allAssigned) ref.current = null;
  };

  const flushPendingLoad = () => {
    if (pendingVocalRef.current) flushPendingKind(pendingVocalRef.current, pendingVocalRef);
    if (pendingInstrRef.current) flushPendingKind(pendingInstrRef.current, pendingInstrRef);
  };

  useEffect(() => {
    const vp = pendingVocalRef.current;
    const ip = pendingInstrRef.current;
    const maxReq = Math.max(vp ? vp.requiredCards : 0, ip ? ip.requiredCards : 0);
    if (!vp && !ip) return;
    if (numCards < maxReq) return;
    const id = requestAnimationFrame(() => flushPendingLoad());
    return () => cancelAnimationFrame(id);
  }, [numCards]);

  function extractCardNumber(filename: string): number | null {
    const m = filename.match(/(\d+)/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return isFinite(n) && n > 0 ? n : null;
  }

  const loadPoolToCards = (kind: "vocal" | "instrument") => {
    const items = poolRef.current.filter((p) => p.kind === kind);
    if (!items.length) return;
    const assignments: { cardIndex: number; file: File }[] = [];
    const fallbackFiles: File[] = [];
    for (const item of items) {
      const n = extractCardNumber(item.file.name);
      if (n !== null && n >= 1 && n <= 500) assignments.push({ cardIndex: n - 1, file: item.file });
      else fallbackFiles.push(item.file);
    }
    const maxAssigned = assignments.reduce((m, a) => Math.max(m, a.cardIndex + 1), 0);
    const requiredCards = Math.max(maxAssigned, assignments.length + fallbackFiles.length);
    const pending: PendingLoad = { kind, assignments, fallbackFiles, requiredCards };
    if (kind === "vocal") pendingVocalRef.current = pending;
    else pendingInstrRef.current = pending;
    ensureCards(requiredCards);
  };

  // ── Stats ───────────────────────────────────────────────────────────────────
  const vocalPoolCount = pool.filter((p) => p.kind === "vocal").length;
  const instrPoolCount = pool.filter((p) => p.kind === "instrument").length;
  const activeCount = cardStates.filter((c) => c.isWorking).length;
  const completeCount = cardStates.filter((c) => c.isDone && c.mergedBlob).length;
  const speedUpCount = cardStates.filter((c) => c.mode === "speedup").length;
  const slowDownCount = cardStates.filter((c) => c.mode === "slowdown").length;
  const matchCount = cardStates.filter((c) => c.mode === "match").length;
  const extremeCount = cardStates.filter((c) => c.mode === "extreme").length;
  const errorCount = cardStates.filter(
    (c) => !c.isDone && !c.isWorking && !c.isReadingDuration &&
            (c.hasVocal || c.hasInstrument) && !c.canProcess && c.mode !== "extreme",
  ).length;
  const [downloadCount, setDownloadCount] = useState(0);
  const incrementDownload = useCallback(() => setDownloadCount((n) => n + 1), []);

  // ── ZIP download ─────────────────────────────────────────────────────────────
  const [zipping, setZipping] = useState(false);

  const handleDownloadZip = async () => {
    const ready = cardStates
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.isDone && c.mergedBlob && c.mergedName);
    if (!ready.length) return;
    setZipping(true);
    try {
      const { default: JSZip } = await import("jszip");
      type ZL = { file: (n: string, b: Blob) => void; generateAsync: (o: { type: "blob" }) => Promise<Blob> };
      const zip = new JSZip() as unknown as ZL;
      const used = new Set<string>();
      for (const { c, i } of ready) {
        let name = c.mergedName || `audio_adj_${i + 1}.mp3`;
        if (used.has(name)) {
          const dot = name.lastIndexOf(".");
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : "";
          name = `${base}-${i + 1}${ext}`;
        }
        used.add(name);
        zip.file(name, c.mergedBlob!);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `instrument_adjusted_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setDownloadCount((n) => n + ready.length);
    } catch (e) {
      console.error("zip failed", e);
      sonnerToast.error("ZIP failed — check console for details.");
    } finally { setZipping(false); }
  };

  // ── Run all ─────────────────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const anyWorking = cardStates.some((c) => c.isWorking);
  const anyCanProcess = cardStates.some((c) => c.canProcess);
  const canRun = anyCanProcess && !running && ffmpegReady;

  const runAll = async () => {
    if (!canRun) return;
    setRunning(true);
    try {
      const equalQueue: number[] = [];
      const queue: number[] = [];
      cardStatesRef.current.forEach((c, i) => {
        if (!c.hasVocal || !c.hasInstrument || !cardRefs.current[i]) return;
        if (c.mode === "match") equalQueue.push(i);
        else if (c.canProcess) queue.push(i);
      });
      for (const cardIdx of equalQueue) {
        await cardRefs.current[cardIdx]!.passThrough();
      }
      let cursor = 0;
      const worker = async () => {
        while (true) {
          const myIdx = cursor++;
          if (myIdx >= queue.length) return;
          const cardIdx = queue[myIdx];
          await cardRefs.current[cardIdx]!.runProcess();
        }
      };
      const workerCount = Math.max(1, Math.min(ENGINE_POOL_SIZE, queue.length));
      if (workerCount > 0) await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally { setRunning(false); }
  };

  const clearAllCards = () => {
    cardRefs.current = [];
    cardStatesRef.current = [];
    pendingUpdatesRef.current.clear();
    setNumCards(0); setCardStates([]);
  };

  const handleVocalPoolClearAll = () => {
    setPool((p) => p.filter((x) => x.kind !== "vocal"));
    for (let i = 0; i < cardRefs.current.length; i++) cardRefs.current[i]?.resetCard();
    setDownloadCount(0);
  };

  const [showErrorCards, setShowErrorCards] = useState(false);
  const errorCardNumbers = cardStates
    .map((c, i) => ({ c, n: i + 1 }))
    .filter(({ c }) => !c.isDone && !c.isWorking && !c.isReadingDuration && (c.hasVocal || c.hasInstrument) && !c.canProcess && c.mode !== "extreme")
    .map(({ n }) => n);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <PoolContext.Provider value={poolCtx}>
      <div className="min-h-screen w-full bg-slate-50 text-slate-900">
        <style>{`
          .apm-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:8px 18px;min-width:110px;border:none;border-radius:9px;font-size:13px;font-weight:700;letter-spacing:.05em;cursor:pointer;color:#fff;white-space:nowrap;transition:filter .12s ease,opacity .12s ease;user-select:none;}
          .apm-btn:disabled{cursor:not-allowed;opacity:.38;filter:grayscale(.4);}
          .apm-btn:not(:disabled):hover{filter:brightness(1.12);}
          .apm-btn:not(:disabled):active{filter:brightness(.88);}
          .apm-btn-load{background:#22c55e;}
          .apm-btn-run{background:#7c3aed;}
          .apm-btn-download{background:#3b82f6;}
          .apm-btn-clear{background:#ef4444;}
        `}</style>
        <div className="mx-auto max-w-[1400px] px-4 py-6">

          {/* Header bar */}
          <div className="mb-8 flex items-center justify-between gap-4 rounded-2xl border-2 border-slate-300 bg-white px-6 py-3 shadow-sm">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-800">Audio +-</h1>
              {ffmpegLoading && (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />Loading engine…
                </span>
              )}
              {!ffmpegLoading && ffmpegReady && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />Ready
                </span>
              )}
              {ffmpegError && <span className="text-xs text-rose-600">{ffmpegError}</span>}
            </div>
            <div className="flex items-center gap-3">
              {completeCount > 0 ? (
                <>
                  <button onClick={handleDownloadZip} disabled={zipping} className="apm-btn apm-btn-download">
                    {zipping ? <><Loader2 className="h-4 w-4 animate-spin" />ZIPPING…</> : <><Download className="h-4 w-4" />ZIP ({completeCount})</>}
                  </button>
                  <button onClick={clearAllCards} disabled={numCards === 0} className="apm-btn apm-btn-clear">
                    <X className="h-4 w-4" />CLEAR ALL
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="apm-btn apm-btn-load"
                    style={{ opacity: loadLocked ? 0.5 : 1 }}
                    onClick={() => { loadPoolToCards("vocal"); loadPoolToCards("instrument"); setLoadLocked(true); }}
                    title="Load both pools into cards"
                  >
                    <UploadCloud className="h-4 w-4" />LOAD
                  </button>
                  <button onClick={() => { if (canRun) void runAll(); }} disabled={!canRun} className="apm-btn apm-btn-run">
                    {anyWorking
                      ? <><Loader2 className="h-4 w-4 animate-spin" />WORKING…</>
                      : <><Music className="h-4 w-4" />AUDIO +-</>}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Two pools side by side */}
          <div className="mb-6 grid gap-4 md:grid-cols-2">
            <MediaPool
              kind="vocal"
              items={pool.filter((p) => p.kind === "vocal")}
              onAdd={(files) => addPoolFiles(files, "vocal")}
              onRemove={removePoolItem}
              onClear={() => setPool((p) => p.filter((x) => x.kind !== "vocal"))}
              onLoad={() => loadPoolToCards("vocal")}
              onClearAll={handleVocalPoolClearAll}
            />
            <MediaPool
              kind="instrument"
              items={pool.filter((p) => p.kind === "instrument")}
              onAdd={(files) => addPoolFiles(files, "instrument")}
              onRemove={removePoolItem}
              onClear={() => setPool((p) => p.filter((x) => x.kind !== "instrument"))}
              onLoad={() => loadPoolToCards("instrument")}
            />
          </div>

          {/* Stats row */}
          <div className="relative mb-6 rounded-2xl border-2 border-slate-200 bg-white px-3 py-2 pr-10 shadow-sm">
            <button type="button" onClick={clearAllCards} disabled={numCards === 0}
              title="Remove all cards"
              className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-rose-300 bg-rose-50 text-rose-600 shadow-sm transition hover:border-rose-500 hover:bg-rose-100 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-30">
              <X className="h-3.5 w-3.5" />
            </button>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {/* Row 1 */}
              <Chip color="emerald" icon={<Music className="h-3 w-3" />} label="Vocal Pool" count={vocalPoolCount} unit="files" dim={vocalPoolCount === 0} />
              <Chip color="blue" icon={<Activity className="h-3 w-3" />} label="Active" count={activeCount} unit="cards" dim={activeCount === 0} />
              <Chip color="green" icon={<FastForward className="h-3 w-3" />} label="Speed +" count={speedUpCount} unit="cards" dim={speedUpCount === 0} />
              <Chip color="amber" icon={<AlertTriangle className="h-3 w-3" />} label="Extreme" count={extremeCount} unit="cards" dim={extremeCount === 0} />
              {/* Row 2 */}
              <Chip color="violet" icon={<Music className="h-3 w-3" />} label="Instr Pool" count={instrPoolCount} unit="files" dim={instrPoolCount === 0} />
              <div className="relative">
                <div
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 transition-all ${
                    errorCount === 0 ? "border-rose-200 bg-rose-50/60 opacity-20 cursor-default"
                    : showErrorCards ? "border-rose-500 bg-rose-100 cursor-pointer shadow-sm"
                    : "border-rose-200 bg-rose-50/60 cursor-pointer hover:border-rose-400 hover:bg-rose-100/80"
                  }`}
                  onClick={() => errorCount > 0 && setShowErrorCards((v) => !v)}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500 text-white"><AlertCircle className="h-3 w-3" /></span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-700">Error</span>
                  <span className="ml-auto text-sm font-bold text-slate-800">{errorCount} <span className="text-[10px] font-medium text-slate-500">cards</span></span>
                </div>
                {showErrorCards && errorCardNumbers.length > 0 && (
                  <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-rose-300 bg-white shadow-lg">
                    <div className="flex items-center justify-between border-b border-rose-100 px-3 py-2">
                      <span className="text-[11px] font-semibold text-rose-700">Error Cards</span>
                      <button className="text-slate-400 hover:text-slate-600" onClick={() => setShowErrorCards(false)}><X className="h-3 w-3" /></button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 p-2.5">
                      {errorCardNumbers.map((n) => (
                        <span key={n} className="inline-flex items-center rounded border border-rose-300 bg-rose-50 px-2 py-0.5 font-mono text-[11px] font-bold text-rose-700">
                          {String(n).padStart(3, "0")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <Chip color="blue2" icon={<Rewind className="h-3 w-3" />} label="Speed -" count={slowDownCount} unit="cards" dim={slowDownCount === 0} />
              <Chip color="teal" icon={<Equal className="h-3 w-3" />} label="Match" count={matchCount} unit="cards" dim={matchCount === 0} />
              {/* Row 3 */}
              <Chip color="green2" icon={<CheckCheck className="h-3 w-3" />} label="Complete" count={completeCount} unit="cards" dim={completeCount === 0} />
              <Chip color="indigo" icon={<Download className="h-3 w-3" />} label="Download" count={downloadCount} unit="files" dim={downloadCount === 0} />
            </div>
          </div>

          {/* 2-column card grid */}
          <div className="grid gap-5 md:grid-cols-2">
            {Array.from({ length: numCards }, (_, i) => (
              <AudioCard
                key={i}
                ref={(el) => { cardRefs.current[i] = el; }}
                index={i + 1}
                engineReady={ffmpegReady}
                acquireSlot={acquireSlot}
                releaseSlot={releaseSlot}
                recycleSlot={recycleSlot}
                onStateChange={setCardState}
                onDownload={incrementDownload}
                highlight={cardStates[i]?.isWorking ?? false}
              />
            ))}
            <button type="button" onClick={addCard}
              className="group flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 p-4 text-slate-500 transition hover:-translate-y-0.5 hover:border-violet-400 hover:bg-violet-50/50 hover:text-violet-600 hover:shadow-md">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-slate-300 transition group-hover:border-violet-400 group-hover:bg-white">
                <Plus className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold tracking-wide">Add card</span>
              <span className="text-[11px] text-slate-400">Create another pair slot</span>
            </button>
          </div>

          <div className="mt-10 text-center text-xs text-slate-500">
            Files never leave your device. All processing happens in your browser.
          </div>
        </div>
      </div>
    </PoolContext.Provider>
  );
}

// ── Chip helper ───────────────────────────────────────────────────────────────
type ChipColor = "emerald" | "violet" | "blue" | "blue2" | "green" | "green2" | "amber" | "teal" | "indigo";
function Chip({ color, icon, label, count, unit, dim }: {
  color: ChipColor; icon: React.ReactNode; label: string; count: number; unit: string; dim: boolean;
}) {
  const map: Record<ChipColor, { border: string; bg: string; iconBg: string; text: string }> = {
    emerald: { border: "border-emerald-200", bg: "bg-emerald-50/60", iconBg: "bg-emerald-500", text: "text-emerald-700" },
    violet:  { border: "border-violet-200",  bg: "bg-violet-50/60",  iconBg: "bg-violet-500",  text: "text-violet-700" },
    blue:    { border: "border-blue-200",    bg: "bg-blue-50/60",    iconBg: "bg-blue-500",    text: "text-blue-700" },
    blue2:   { border: "border-blue-200",    bg: "bg-blue-50/60",    iconBg: "bg-blue-500",    text: "text-blue-700" },
    green:   { border: "border-green-200",   bg: "bg-green-50/60",   iconBg: "bg-green-600",   text: "text-green-700" },
    green2:  { border: "border-green-200",   bg: "bg-green-50/60",   iconBg: "bg-green-600",   text: "text-green-700" },
    amber:   { border: "border-amber-200",   bg: "bg-amber-50/60",   iconBg: "bg-amber-500",   text: "text-amber-700" },
    teal:    { border: "border-teal-200",    bg: "bg-teal-50/60",    iconBg: "bg-teal-500",    text: "text-teal-700" },
    indigo:  { border: "border-indigo-200",  bg: "bg-indigo-50/60",  iconBg: "bg-indigo-500",  text: "text-indigo-700" },
  };
  const p = map[color];
  return (
    <div className={`flex items-center gap-2 rounded-lg border ${p.border} ${p.bg} px-2.5 py-1 transition-opacity ${dim ? "opacity-20" : ""}`}>
      <span className={`flex h-6 w-6 items-center justify-center rounded-md ${p.iconBg} text-white`}>{icon}</span>
      <span className={`text-[10px] font-semibold uppercase tracking-wider ${p.text}`}>{label}</span>
      <span className="ml-auto text-sm font-bold text-slate-800">{count} <span className="text-[10px] font-medium text-slate-500">{unit}</span></span>
    </div>
  );
}
