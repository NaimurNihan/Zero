import React, { useState, useRef, useEffect, KeyboardEvent, useMemo } from "react";
import { Copy, Scissors, Undo, Play, Square, Loader2, Download, ListMusic, RotateCcw, CloudDownload, Music, X, FolderInput, Lock, Unlock, Star, Mic, ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VoicePicker, EdgeVoice } from "./voice-picker";
import { FavoriteVoicesButton } from "./favorite-voices-button";
import { useVoices, getVoiceShortDisplay } from "@/hooks/use-voices";

const VOICE_STORAGE_KEY = "tts-selected-voice";
const VOICE_BY_LABEL_STORAGE_KEY = "tts-voice-by-label";
const LOCKED_LABELS_STORAGE_KEY = "tts-locked-labels";
const VOICE_SLOTS_STORAGE_KEY = "tts-voice-slot-labels";
const SLOT_COUNT = 5;

function findVoiceForLabel(label: string, map: Record<string, string>): string | null {
  if (!label) return null;
  const direct = map[label];
  if (direct) return direct;
  const target = label.trim().toLowerCase();
  if (!target) return null;
  for (const [k, v] of Object.entries(map)) {
    if (k.trim().toLowerCase() === target) return v;
  }
  return null;
}

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildHtml(lines: string[]) {
  if (lines.length === 0) return "<div><br></div>";
  return lines.map((l) => `<div>${l ? escapeHtml(l) : "<br>"}</div>`).join("");
}
function extractLines(el: HTMLDivElement): string[] {
  const children = Array.from(el.children) as HTMLElement[];
  if (children.length === 0) return [""];
  return children.map((c) => c.innerText.replace(/\n$/, ""));
}
function normalizePastedLines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
}

interface LineEditorProps {
  editorKey: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}
function LineEditor({ editorKey, value, onChange, placeholder }: LineEditorProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const internalChange = useRef(false);

  useEffect(() => {
    if (internalChange.current) { internalChange.current = false; return; }
    const el = innerRef.current;
    if (!el) return;
    const newHtml = buildHtml(value);
    if (el.innerHTML !== newHtml) el.innerHTML = newHtml;
  }, [value, editorKey]);

  const handleInput = () => {
    if (!innerRef.current) return;
    internalChange.current = true;
    onChange(extractLines(innerRef.current));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      document.execCommand("insertHTML", false, "<div><br></div>");
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text/plain");
    if (!innerRef.current || !pastedText) return;
    const pastedLines = normalizePastedLines(pastedText);
    if (pastedLines.length === 0) return;

    if (pastedLines.length === 1) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(pastedLines[0]);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        internalChange.current = true;
        onChange(extractLines(innerRef.current));
        return;
      }
    }

    const sel = window.getSelection();
    let insertAfterIdx = -1;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      let node: Node = range.startContainer;
      while (node.parentNode && node.parentNode !== innerRef.current) node = node.parentNode;
      if (node.parentNode === innerRef.current) insertAfterIdx = Array.from(innerRef.current.children).indexOf(node as Element);
    }

    const existingLines = Array.from(innerRef.current.children as HTMLCollectionOf<HTMLElement>).map((c) => c.innerText.replace(/\n$/, ""));
    let newLines: string[];
    if (existingLines.length === 0 || (existingLines.length === 1 && existingLines[0] === "")) {
      newLines = pastedLines;
    } else if (insertAfterIdx === -1) {
      newLines = [...existingLines, ...pastedLines];
    } else {
      newLines = [...existingLines.slice(0, insertAfterIdx + 1), ...pastedLines, ...existingLines.slice(insertAfterIdx + 1)];
    }
    innerRef.current.innerHTML = buildHtml(newLines);
    internalChange.current = true;
    onChange(extractLines(innerRef.current));
  };

  return (
    <div
      ref={(el) => {
        innerRef.current = el;
        if (el && el.innerHTML === "") el.innerHTML = buildHtml(value);
      }}
      key={editorKey}
      contentEditable
      suppressContentEditableWarning
      data-line-editor
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className="flex-1 min-h-0 overflow-y-auto outline-none px-5 pt-4 pb-14 text-sm text-foreground"
      style={{ minHeight: 0, scrollPaddingBottom: "3.5rem" }}
    />
  );
}

interface AudioEntry {
  url: string;
  text: string;
  sizeBytes: number;
  durationSeconds: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "0.00s";
  return `${seconds.toFixed(2)}s`;
}

function getAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    const cleanup = () => {
      a.onloadedmetadata = null;
      a.onerror = null;
    };
    a.onloadedmetadata = () => {
      const d = a.duration;
      cleanup();
      resolve(isFinite(d) ? d : 0);
    };
    a.onerror = () => { cleanup(); resolve(0); };
    a.src = url;
  });
}

interface AudioPoolProps {
  lines: string[];
  selectedVoice: string | null;
  onSendToSpliter?: (files: File[]) => void;
}

function AudioPool({ lines, selectedVoice, onSendToSpliter }: AudioPoolProps) {
  const [poolAudio, setPoolAudio] = useState<Record<number, AudioEntry>>({});
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isLoadingPool, setIsLoadingPool] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ done: 0, total: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayRef = useRef(false);
  const loadPoolRef = useRef(false);
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const poolAudioRef = useRef<Record<number, AudioEntry>>({});

  const validLines = lines.filter((l) => l.trim());

  useEffect(() => {
    return () => {
      autoPlayRef.current = false;
      if (audioRef.current) {
        audioRef.current.onerror = null;
        audioRef.current.onended = null;
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  const stopAll = () => {
    autoPlayRef.current = false;
    setIsAutoPlaying(false);
    if (audioRef.current) {
      audioRef.current.onerror = null;
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setPlayingIndex(null);
    setLoadingIndex(null);
  };

  const fetchAudio = async (index: number, text: string): Promise<string | null> => {
    if (poolAudioRef.current[index]) return poolAudioRef.current[index].url;
    const res = await fetch(`${import.meta.env.BASE_URL}api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim(), ...(selectedVoice ? { voice: selectedVoice } : {}) }),
    });
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const durationSeconds = await getAudioDuration(url);
    const entry: AudioEntry = { url, text, sizeBytes: blob.size, durationSeconds };
    poolAudioRef.current[index] = entry;
    setPoolAudio((prev) => ({ ...prev, [index]: entry }));
    return url;
  };

  const loadPool = async () => {
    if (isLoadingPool) {
      loadPoolRef.current = false;
      setIsLoadingPool(false);
      setLoadProgress({ done: 0, total: 0 });
      return;
    }
    const validEntries = lines.map((l, i) => ({ text: l, i })).filter((x) => x.text.trim());
    if (validEntries.length === 0) { toast.error("No lines"); return; }
    loadPoolRef.current = true;
    setIsLoadingPool(true);
    setLoadProgress({ done: 0, total: validEntries.length });
    let done = 0;
    const CONCURRENCY = 4;
    let cursor = 0;
    const worker = async () => {
      while (loadPoolRef.current) {
        const idx = cursor++;
        if (idx >= validEntries.length) break;
        const entry = validEntries[idx];
        try {
          await fetchAudio(entry.i, entry.text);
          done++;
          setLoadProgress({ done, total: validEntries.length });
          itemRefs.current[entry.i]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch {
          // skip failed lines silently
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, validEntries.length) }, () => worker())
    );
    loadPoolRef.current = false;
    setIsLoadingPool(false);
    if (done === validEntries.length) toast.success(`All ${done} saved to audio pool!`);
    else toast.success(`${done} saved to audio pool`);
    window.dispatchEvent(
      new CustomEvent("srt-tools:aiaudio-pool-loaded", {
        detail: { done, total: validEntries.length },
      })
    );
  };

  const playSingle = async (index: number) => {
    const line = lines[index];
    if (!line?.trim()) return;
    if (playingIndex === index && !isAutoPlaying) { stopAll(); return; }
    stopAll();
    setLoadingIndex(index);
    try {
      const url = await fetchAudio(index, line);
      if (!url) return;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlayingIndex(null); setLoadingIndex(null); };
      audio.onerror = () => { toast.error("Playback failed"); stopAll(); };
      await audio.play();
      setLoadingIndex(null);
      setPlayingIndex(index);
      itemRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch {
      toast.error("Could not generate voice");
      stopAll();
    }
  };

  const playNextAuto = async (index: number) => {
    if (!autoPlayRef.current) return;
    const realLines = lines.map((l, i) => ({ text: l, i })).filter((x) => x.text.trim());
    const entry = realLines.find((x) => x.i === index);
    if (!entry) { stopAll(); return; }

    setLoadingIndex(index);
    setPlayingIndex(null);
    itemRefs.current[index]?.scrollIntoView({ behavior: "smooth", block: "center" });

    try {
      const url = await fetchAudio(index, entry.text);
      if (!url || !autoPlayRef.current) { stopAll(); return; }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        if (!autoPlayRef.current) { setPlayingIndex(null); setLoadingIndex(null); return; }
        const nextEntry = realLines.find((x) => x.i > index);
        if (nextEntry) {
          playNextAuto(nextEntry.i);
        } else {
          stopAll();
          toast.success("All lines played!");
        }
      };
      audio.onerror = () => { toast.error("Playback failed"); stopAll(); };
      await audio.play();
      setLoadingIndex(null);
      setPlayingIndex(index);
    } catch {
      if (autoPlayRef.current) toast.error("Could not generate voice");
      stopAll();
    }
  };

  const startAutoPlay = () => {
    if (isAutoPlaying) { stopAll(); return; }
    const realLines = lines.map((l, i) => ({ text: l, i })).filter((x) => x.text.trim());
    if (realLines.length === 0) { toast.error("No lines to play"); return; }
    stopAll();
    autoPlayRef.current = true;
    setIsAutoPlaying(true);
    playNextAuto(realLines[0].i);
  };

  const resetPool = () => {
    loadPoolRef.current = false;
    setIsLoadingPool(false);
    setLoadProgress({ done: 0, total: 0 });
    stopAll();
    Object.values(poolAudioRef.current).forEach((e) => URL.revokeObjectURL(e.url));
    poolAudioRef.current = {};
    setPoolAudio({});
    toast.success("Pool reset");
  };

  const loadSpliter = async () => {
    if (!onSendToSpliter) return;
    const indices = Object.keys(poolAudioRef.current)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (indices.length === 0) {
      toast.error("Audio pool is empty. Click Load Pool first.");
      return;
    }
    try {
      const files: File[] = [];
      for (const idx of indices) {
        const entry = poolAudioRef.current[idx];
        if (!entry) continue;
        const res = await fetch(entry.url);
        const blob = await res.blob();
        const ext =
          blob.type.includes("wav") ? "wav" :
          blob.type.includes("ogg") ? "ogg" :
          blob.type.includes("mp4") || blob.type.includes("m4a") ? "m4a" :
          "mp3";
        const num = String(idx + 1).padStart(3, "0");
        const file = new File([blob], `${num}.${ext}`, {
          type: blob.type || "audio/mpeg",
        });
        files.push(file);
      }
      if (files.length === 0) {
        toast.error("No audio to send");
        return;
      }
      onSendToSpliter(files);
      toast.success(`Sent ${files.length} audio${files.length !== 1 ? "s" : ""} to Audio Spliter`);
    } catch {
      toast.error("Failed to send audio to Spliter");
    }
  };

  const silentResetPool = () => {
    loadPoolRef.current = false;
    setIsLoadingPool(false);
    setLoadProgress({ done: 0, total: 0 });
    stopAll();
    Object.values(poolAudioRef.current).forEach((e) => URL.revokeObjectURL(e.url));
    poolAudioRef.current = {};
    setPoolAudio({});
  };

  const loadPoolFnRef = useRef(loadPool);
  loadPoolFnRef.current = loadPool;
  const loadSpliterFnRef = useRef(loadSpliter);
  loadSpliterFnRef.current = loadSpliter;
  const silentResetPoolFnRef = useRef(silentResetPool);
  silentResetPoolFnRef.current = silentResetPool;
  useEffect(() => {
    const onLoad = () => { loadPoolFnRef.current(); };
    const onLoadSpliter = () => { loadSpliterFnRef.current(); };
    const onReset = () => { silentResetPoolFnRef.current(); };
    window.addEventListener("srt-tools:aiaudio-load-pool", onLoad);
    window.addEventListener("srt-tools:aiaudio-load-spliter", onLoadSpliter);
    window.addEventListener("srt-tools:aiaudio-reset-pool", onReset);
    return () => {
      window.removeEventListener("srt-tools:aiaudio-load-pool", onLoad);
      window.removeEventListener("srt-tools:aiaudio-load-spliter", onLoadSpliter);
      window.removeEventListener("srt-tools:aiaudio-reset-pool", onReset);
    };
  }, []);

  const total = validLines.length;
  const cached = Object.keys(poolAudio).length;

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: "340px" }}>
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card rounded-t-xl gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ListMusic size={14} className="text-emerald-500" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Audio Pool</span>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            Total : {total}
          </span>
          {cached > 0 && (
            <span className="text-[10px] text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-1.5 py-0.5 rounded-full">
              {cached} ready
            </span>
          )}
          {isLoadingPool && (
            <span className="text-[10px] text-blue-600 bg-blue-50 dark:bg-blue-950 px-1.5 py-0.5 rounded-full flex items-center gap-1">
              <Loader2 size={8} className="animate-spin" />
              {loadProgress.done}/{loadProgress.total} loading...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadPool}
            className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full transition-all ${
              isLoadingPool
                ? "bg-orange-100 text-orange-600 dark:bg-orange-950 hover:bg-orange-200"
                : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 hover:bg-blue-200"
            }`}
            disabled={isAutoPlaying}
          >
            {isLoadingPool ? (
              <><Square size={10} className="fill-current" /> Stop</>
            ) : (
              <><CloudDownload size={10} /> Load Pool</>
            )}
          </button>
          {onSendToSpliter && (
            <button
              onClick={loadSpliter}
              disabled={isLoadingPool || cached === 0}
              title="Send all pool audio to Audio Spliter"
              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 hover:bg-emerald-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FolderInput size={10} /> Load Spliter
            </button>
          )}
          <button
            onClick={resetPool}
            className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
          >
            <RotateCcw size={10} /> Reset
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {lines.length === 0 || (lines.length === 1 && !lines[0].trim()) ? (
          <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">
            Add lines in Cut view
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {lines.map((line, index) => {
              if (!line.trim()) return null;
              const isLoading = loadingIndex === index;
              const isPlaying = playingIndex === index;
              const cachedEntry = poolAudio[index];
              const isCached = !!cachedEntry;
              const num = String(index + 1).padStart(3, "0");
              const filename = num;
              return (
                <div
                  key={index}
                  ref={(el) => { itemRefs.current[index] = el; }}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 border transition-all ${
                    isPlaying
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 shadow-sm"
                      : isLoading
                      ? "border-emerald-300 bg-muted/50"
                      : "border-border bg-background hover:border-emerald-300"
                  }`}
                >
                  <div className="text-muted-foreground/60 font-mono text-[10px] select-none shrink-0">
                    {num}
                  </div>
                  <div className={`shrink-0 w-6 h-6 rounded flex items-center justify-center ${
                    isPlaying || isCached
                      ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-600"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {isLoading ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : isPlaying ? (
                      <div className="flex gap-0.5 items-end">
                        {[1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="w-0.5 bg-emerald-500 rounded-full animate-bounce"
                            style={{ height: `${3 + i * 1.5}px`, animationDelay: `${i * 0.1}s` }}
                          />
                        ))}
                      </div>
                    ) : (
                      <Music size={11} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium text-foreground truncate leading-tight">{filename}</p>
                    {isCached ? (
                      <p className="text-[9px] text-muted-foreground truncate leading-tight">
                        {formatBytes(cachedEntry.sizeBytes)} · {formatDuration(cachedEntry.durationSeconds)}
                      </p>
                    ) : (
                      <p className="text-[9px] text-muted-foreground/70 truncate leading-tight">
                        {isLoading ? "Generating..." : "Not cached"}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => playSingle(index)}
                    disabled={isAutoPlaying}
                    className={`shrink-0 p-1 rounded transition-colors ${
                      isPlaying
                        ? "text-emerald-600 hover:bg-emerald-100"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    } disabled:opacity-40`}
                    title={isPlaying ? "Stop" : "Play"}
                  >
                    {isLoading ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : isPlaying ? (
                      <Square size={11} className="fill-current" />
                    ) : (
                      <Play size={11} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface VoiceSlotPillProps {
  index: number;
  label: string;
  voice: string | null;
  locked: boolean;
  isActive: boolean;
  allVoices: EdgeVoice[] | null;
  onLabelChange: (s: string) => void;
  onVoiceChange: (v: string | null) => void;
  onToggleLock: () => void;
  onClear: () => void;
}

function VoiceSlotPill({
  index,
  label,
  voice,
  locked,
  isActive,
  allVoices,
  onLabelChange,
  onVoiceChange,
  onToggleLock,
  onClear,
}: VoiceSlotPillProps) {
  const [open, setOpen] = useState(false);
  const [localLabel, setLocalLabel] = useState(label);

  useEffect(() => {
    setLocalLabel(label);
  }, [label]);

  const voiceShort = useMemo(() => {
    if (!voice) return null;
    if (!allVoices) return voice;
    const v = allVoices.find((x) => x.ShortName === voice);
    return v ? getVoiceShortDisplay(v) : voice;
  }, [voice, allVoices]);

  const trimmed = label.trim();
  const displayLabel = trimmed || `Slot ${index + 1}`;
  const hasContent = !!trimmed || !!voice;

  const commitLabel = () => {
    const next = localLabel.trim();
    if (next !== label.trim()) {
      onLabelChange(next);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={
            hasContent
              ? `${displayLabel}${voiceShort ? ` · ${voiceShort}` : " · no voice"}${locked ? " (locked)" : ""}`
              : `Configure slot ${index + 1}`
          }
          className={`group relative inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-md border transition-colors min-w-[88px] max-w-[170px] ${
            isActive
              ? "bg-emerald-100 border-emerald-500 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 shadow-sm"
              : voice && trimmed
              ? "bg-emerald-50/70 border-emerald-300/70 text-emerald-700/90 dark:bg-emerald-950/40 dark:text-emerald-400/80 hover:brightness-110"
              : trimmed
              ? "bg-muted border-border text-muted-foreground hover:bg-accent"
              : "bg-muted/30 border-dashed border-border text-muted-foreground/70 hover:bg-muted"
          }`}
          data-testid={`button-voice-slot-${index}`}
        >
          {locked && <Lock className="h-2.5 w-2.5 shrink-0" />}
          {isActive && <Star className="h-2.5 w-2.5 fill-current shrink-0" />}
          <span className="truncate">{displayLabel}</span>
          {voiceShort && (
            <>
              <span className="opacity-50">·</span>
              <span className="normal-case tracking-normal font-medium truncate">
                {voiceShort}
              </span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Slot {index + 1} name
            </label>
            <Input
              value={localLabel}
              onChange={(e) => setLocalLabel(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitLabel();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="e.g. ARABIC, ENGLISH..."
              className="h-8 text-xs"
              data-testid={`input-voice-slot-label-${index}`}
            />
            <p className="text-[10px] text-muted-foreground">
              Match a card's name. The matching slot's voice is used automatically.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Voice
            </label>
            <VoicePicker
              selectedVoice={voice}
              onSelect={(v) => onVoiceChange(v)}
            />
          </div>
          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onToggleLock}
              disabled={!trimmed}
              className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border transition-colors ${
                locked
                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                  : "bg-transparent border-border text-muted-foreground hover:bg-accent"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              data-testid={`button-voice-slot-lock-${index}`}
            >
              {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
              {locked ? "Locked" : "Lock"}
            </button>
            <button
              type="button"
              onClick={() => {
                onClear();
                setLocalLabel("");
                setOpen(false);
              }}
              disabled={!hasContent}
              className="text-[11px] text-muted-foreground hover:text-red-600 px-2 py-1 rounded-md hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid={`button-voice-slot-clear-${index}`}
            >
              Clear
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface EditorProps {
  onSendToSpliter?: (files: File[]) => void;
}

export function Editor({ onSendToSpliter }: EditorProps = {}) {
  const [content, setContent] = useState<string[]>([""]);
  const [history, setHistory] = useState<string[][]>([[""]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isCutView, setIsCutView] = useState(false);
  const [cardLabel, setCardLabel] = useState<string>("Original");
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  const [selectedVoice, setSelectedVoice] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(VOICE_STORAGE_KEY);
    return stored && stored !== "null" ? stored : null;
  });
  const [voiceByLabel, setVoiceByLabel] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = localStorage.getItem(VOICE_BY_LABEL_STORAGE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string" && v) out[k] = v;
        }
        return out;
      }
      return {};
    } catch {
      return {};
    }
  });
  const [lockedLabels, setLockedLabels] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = localStorage.getItem(LOCKED_LABELS_STORAGE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === "object") {
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (v === true) out[k] = true;
        }
        return out;
      }
      return {};
    } catch {
      return {};
    }
  });
  const [voiceSlotLabels, setVoiceSlotLabels] = useState<string[]>(() => {
    const empty = Array.from({ length: SLOT_COUNT }, () => "");
    if (typeof window === "undefined") return empty;
    try {
      const stored = localStorage.getItem(VOICE_SLOTS_STORAGE_KEY);
      if (!stored) return empty;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const out = parsed
          .slice(0, SLOT_COUNT)
          .map((x) => (typeof x === "string" ? x : ""));
        while (out.length < SLOT_COUNT) out.push("");
        return out;
      }
      return empty;
    } catch {
      return empty;
    }
  });
  const allVoices = useVoices();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selectedVoice) {
      localStorage.setItem(VOICE_STORAGE_KEY, selectedVoice);
    } else {
      localStorage.removeItem(VOICE_STORAGE_KEY);
    }
  }, [selectedVoice]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(VOICE_BY_LABEL_STORAGE_KEY, JSON.stringify(voiceByLabel));
    } catch {
      // ignore quota errors
    }
  }, [voiceByLabel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LOCKED_LABELS_STORAGE_KEY, JSON.stringify(lockedLabels));
    } catch {
      // ignore quota errors
    }
  }, [lockedLabels]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(VOICE_SLOTS_STORAGE_KEY, JSON.stringify(voiceSlotLabels));
    } catch {
      // ignore quota errors
    }
  }, [voiceSlotLabels]);

  const updateSlotLabel = React.useCallback(
    (index: number, newLabel: string) => {
      setVoiceSlotLabels((prev) => {
        const oldLabel = (prev[index] ?? "").trim();
        const next = [...prev];
        next[index] = newLabel;
        if (oldLabel && oldLabel !== newLabel.trim()) {
          // Migrate the saved voice / lock from the old label to the new one
          setVoiceByLabel((prevMap) => {
            const nextMap = { ...prevMap };
            const savedVoice = nextMap[oldLabel];
            if (savedVoice) {
              delete nextMap[oldLabel];
              if (newLabel.trim()) nextMap[newLabel.trim()] = savedVoice;
            }
            return nextMap;
          });
          setLockedLabels((prevLocked) => {
            const nextLocked = { ...prevLocked };
            const wasLocked = nextLocked[oldLabel];
            if (wasLocked !== undefined) {
              delete nextLocked[oldLabel];
              if (newLabel.trim()) nextLocked[newLabel.trim()] = wasLocked;
            }
            return nextLocked;
          });
        }
        return next;
      });
    },
    [],
  );

  const setSlotVoice = React.useCallback(
    (index: number, voice: string | null) => {
      const label = (voiceSlotLabels[index] ?? "").trim();
      if (!label) {
        toast.error("Set a name for this slot first");
        return;
      }
      setVoiceByLabel((prev) => {
        const next = { ...prev };
        if (voice) next[label] = voice;
        else delete next[label];
        return next;
      });
      if (label.toLowerCase() === cardLabel.trim().toLowerCase()) {
        setSelectedVoice(voice);
      }
    },
    [voiceSlotLabels, cardLabel],
  );

  const toggleSlotLock = React.useCallback(
    (index: number) => {
      const label = (voiceSlotLabels[index] ?? "").trim();
      if (!label) return;
      setLockedLabels((prev) => {
        const next = { ...prev };
        if (next[label]) {
          delete next[label];
          toast.success(`Unlocked voice for ${label}`);
        } else {
          next[label] = true;
          toast.success(`Locked voice for ${label}`);
        }
        return next;
      });
    },
    [voiceSlotLabels],
  );

  const clearSlot = React.useCallback(
    (index: number) => {
      const label = (voiceSlotLabels[index] ?? "").trim();
      setVoiceSlotLabels((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      if (label) {
        setVoiceByLabel((prev) => {
          const next = { ...prev };
          delete next[label];
          return next;
        });
        setLockedLabels((prev) => {
          const next = { ...prev };
          delete next[label];
          return next;
        });
      }
    },
    [voiceSlotLabels],
  );

  const handleVoiceSelect = React.useCallback(
    (voice: string | null) => {
      setSelectedVoice(voice);
      if (lockedLabels[cardLabel]) {
        // Locked: keep the saved binding for this label untouched.
        return;
      }
      setVoiceByLabel((prev) => {
        const next = { ...prev };
        if (voice) {
          next[cardLabel] = voice;
        } else {
          delete next[cardLabel];
        }
        return next;
      });
    },
    [cardLabel, lockedLabels],
  );

  const stopPlayback = React.useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onerror = null;
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setPlayingIndex(null);
    setLoadingIndex(null);
  }, []);

  useEffect(() => {
    return () => { stopPlayback(); };
  }, [stopPlayback]);

  useEffect(() => {
    const onSetContent = (e: Event) => {
      const detail = (e as CustomEvent<{ lines: string[]; label?: string }>).detail;
      if (!detail || !Array.isArray(detail.lines)) return;
      const lines = detail.lines.length > 0 ? detail.lines : [""];
      setContent(lines);
      setHistory([lines]);
      setHistoryIndex(0);
      if (typeof detail.label === "string" && detail.label.trim()) {
        const label = detail.label;
        setCardLabel(label);
        setVoiceByLabel((prevMap) => {
          const saved = findVoiceForLabel(label, prevMap);
          if (saved) {
            setSelectedVoice(saved);
          }
          return prevMap;
        });
      }
    };
    const onCut = () => {
      stopPlayback();
      setIsCutView(true);
    };
    window.addEventListener("srt-tools:aiaudio-set-content", onSetContent);
    window.addEventListener("srt-tools:aiaudio-cut", onCut);
    return () => {
      window.removeEventListener("srt-tools:aiaudio-set-content", onSetContent);
      window.removeEventListener("srt-tools:aiaudio-cut", onCut);
    };
  }, [stopPlayback]);

  const downloadLine = async (index: number, text: string) => {
    if (downloadingIndex !== null) return;
    const trimmed = text.trim();
    if (!trimmed) { toast.error("Nothing to download"); return; }
    setDownloadingIndex(index);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, ...(selectedVoice ? { voice: selectedVoice } : {}) }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const filename = `note-${String(index + 1).padStart(3, "0")}.mp3`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Downloaded ${filename}`);
    } catch (err) {
      console.error(err);
      toast.error("Could not download voice");
    } finally {
      setDownloadingIndex(null);
    }
  };

  const playLine = async (index: number, text: string) => {
    if (playingIndex === index || loadingIndex === index) { stopPlayback(); return; }
    stopPlayback();
    const trimmed = text.trim();
    if (!trimmed) { toast.error("Nothing to read"); return; }
    setLoadingIndex(index);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed, ...(selectedVoice ? { voice: selectedVoice } : {}) }),
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => stopPlayback();
      audio.onerror = () => { toast.error("Playback failed"); stopPlayback(); };
      await audio.play();
      setLoadingIndex(null);
      setPlayingIndex(index);
    } catch (err) {
      console.error(err);
      toast.error("Could not generate voice");
      stopPlayback();
    }
  };

  const saveHistory = (newContent: string[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push([...newContent]);
    if (newHistory.length > 50) newHistory.shift();
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const handleLineChange = (index: number, text: string) => {
    const newContent = [...content];
    newContent[index] = text;
    setContent(newContent);
  };

  const handleLineBlur = () => { saveHistory(content); };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, index: number) => {
    const pastedText = e.clipboardData.getData("text");
    if (!pastedText) return;
    const lines = pastedText.split(/\r?\n/);
    const sentences: string[] = [];
    for (const line of lines) {
      if (line.trim() === "") continue;
      const parts = line.split(/(?<=[.!?])\s*(?=[A-Z])/);
      sentences.push(...parts.map((s) => s.trim()).filter((s) => s));
    }
    if (sentences.length <= 1) return;
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    const cursorPos = input.selectionStart || 0;
    const currentText = content[index];
    const before = currentText.slice(0, cursorPos);
    const after = currentText.slice(input.selectionEnd || cursorPos);
    const newContent = [...content];
    const firstSentence = before + sentences[0];
    const lastSentence = sentences[sentences.length - 1] + after;
    const middle = sentences.slice(1, -1);
    newContent.splice(index, 1, firstSentence, ...middle, lastSentence);
    setContent(newContent);
    saveHistory(newContent);
    setTimeout(() => {
      const nextIndex = index + sentences.length - 1;
      const nextInput = containerRef.current?.querySelector(`input[data-index="${nextIndex}"]`) as HTMLInputElement;
      if (nextInput) {
        nextInput.focus();
        const pos = sentences[sentences.length - 1].length;
        nextInput.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const newContent = [...content];
      const currentText = newContent[index];
      const cursorPosition = (e.target as HTMLInputElement).selectionStart || 0;
      const beforeCursor = currentText.slice(0, cursorPosition);
      const afterCursor = currentText.slice(cursorPosition);
      newContent[index] = beforeCursor;
      newContent.splice(index + 1, 0, afterCursor);
      setContent(newContent);
      saveHistory(newContent);
      setTimeout(() => {
        const nextInput = containerRef.current?.querySelector(`input[data-index="${index + 1}"]`) as HTMLInputElement;
        if (nextInput) nextInput.focus();
      }, 0);
    } else if (e.key === "Backspace") {
      if (content[index] === "" && content.length > 1) {
        e.preventDefault();
        const newContent = [...content];
        newContent.splice(index, 1);
        setContent(newContent);
        saveHistory(newContent);
        setTimeout(() => {
          const prevInput = containerRef.current?.querySelector(`input[data-index="${index - 1}"]`) as HTMLInputElement;
          if (prevInput) {
            prevInput.focus();
            const len = prevInput.value.length;
            prevInput.setSelectionRange(len, len);
          }
        }, 0);
      } else if ((e.target as HTMLInputElement).selectionStart === 0 && index > 0) {
        e.preventDefault();
        const newContent = [...content];
        const currentText = newContent[index];
        const prevText = newContent[index - 1];
        newContent[index - 1] = prevText + currentText;
        newContent.splice(index, 1);
        setContent(newContent);
        saveHistory(newContent);
        setTimeout(() => {
          const prevInput = containerRef.current?.querySelector(`input[data-index="${index - 1}"]`) as HTMLInputElement;
          if (prevInput) {
            prevInput.focus();
            prevInput.setSelectionRange(prevText.length, prevText.length);
          }
        }, 0);
      }
    } else if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      const prevInput = containerRef.current?.querySelector(`input[data-index="${index - 1}"]`) as HTMLInputElement;
      if (prevInput) prevInput.focus();
    } else if (e.key === "ArrowDown" && index < content.length - 1) {
      e.preventDefault();
      const nextInput = containerRef.current?.querySelector(`input[data-index="${index + 1}"]`) as HTMLInputElement;
      if (nextInput) nextInput.focus();
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(content.join("\n"));
    toast.success("Copied to clipboard");
  };

  const handleCut = () => {
    stopPlayback();
    setIsCutView((prev) => {
      const next = !prev;
      toast.success(next ? "Split into sub-cards" : "Back to single card");
      return next;
    });
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setContent(history[newIndex]);
    }
  };

  const handleCancelAll = () => {
    stopPlayback();
    setContent([""]);
    setHistory([[""]]);
    setHistoryIndex(0);
    setIsCutView(false);
    setCardLabel("Original");
    toast.success("All cancelled");
  };

  const handleClearAll = () => {
    stopPlayback();
    setContent([""]);
    setHistory([[""]]);
    setHistoryIndex(0);
    window.dispatchEvent(new CustomEvent("srt-tools:aiaudio-reset-pool"));
    toast.success("All cleared");
  };

  const totalLines = content.length;
  const totalPtu = (content.join("\n").match(/[.?।]/g) || []).length;

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full p-6 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Top card: AI Voice slots + voice picker */}
      <div className="bg-card border border-border rounded-xl shadow-sm px-4 py-2.5 flex flex-col gap-2">
        {/* Row 1: AI Voice label + Clear All button */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-foreground tracking-wide shrink-0">AI Voice</span>
          <button
            type="button"
            onClick={handleClearAll}
            title="Clear all text and audio"
            data-testid="button-clear-all"
            className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950 transition-all border border-red-200 dark:border-red-900"
          >
            <Trash2 size={11} /> Clear All
          </button>
        </div>
        {/* Row 2: Slot pills + compact voice picker + compact favorites */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {voiceSlotLabels.map((slotLabel, i) => {
            const trimmed = slotLabel.trim();
            const slotVoice = trimmed ? findVoiceForLabel(trimmed, voiceByLabel) : null;
            const isLocked = trimmed
              ? !!(lockedLabels[trimmed] ||
                  Object.keys(lockedLabels).some(
                    (k) => k.trim().toLowerCase() === trimmed.toLowerCase() && lockedLabels[k],
                  ))
              : false;
            const isActive =
              !!trimmed &&
              trimmed.toLowerCase() === cardLabel.trim().toLowerCase();
            return (
              <VoiceSlotPill
                key={i}
                index={i}
                label={slotLabel}
                voice={slotVoice}
                locked={isLocked}
                isActive={isActive}
                allVoices={allVoices}
                onLabelChange={(s) => updateSlotLabel(i, s)}
                onVoiceChange={(v) => setSlotVoice(i, v)}
                onToggleLock={() => toggleSlotLock(i)}
                onClear={() => clearSlot(i)}
              />
            );
          })}
          <VoicePicker
            selectedVoice={selectedVoice}
            onSelect={handleVoiceSelect}
            trigger={
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 max-w-[200px] truncate text-[10px] font-semibold uppercase tracking-wider rounded-md"
                data-testid="button-voice-picker"
              >
                <Mic className="h-3 w-3 shrink-0 text-primary" />
                <span className="truncate normal-case tracking-normal font-medium text-[11px]">
                  {selectedVoice ? selectedVoice.split("-").slice(-1)[0].replace(/Neural$/, "") : "Auto"}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
              </Button>
            }
          />
          <FavoriteVoicesButton
            selectedVoice={selectedVoice}
            onSelect={handleVoiceSelect}
            className="h-7 w-7 relative rounded-md"
            iconClassName="h-3.5 w-3.5"
          />
        </div>
      </div>

      {/* Editor Card */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card rounded-t-xl">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{cardLabel}</span>
            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
              {totalLines} {totalLines === 1 ? "line" : "lines"}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${totalPtu !== totalLines ? "text-red-500 bg-red-100 dark:bg-red-950" : "text-muted-foreground bg-muted"}`}>
              {totalPtu} ptu
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleCancelAll} title="Cancel all (clear both cards)" className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950 text-muted-foreground hover:text-red-600 transition-colors border border-transparent hover:border-red-300">
              <X size={14} />
            </button>
            <button onClick={handleCopy} title="Copy all text" className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <Copy size={14} />
            </button>
            <button onClick={handleCut} title="Split into sub-cards" className={`p-1.5 rounded-md hover:bg-muted transition-colors ${isCutView ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"}`}>
              <Scissors size={14} />
            </button>
            <button onClick={handleUndo} disabled={historyIndex === 0} title="Undo" className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
              <Undo size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden" ref={containerRef}>
          {isCutView ? (
            <div className="flex flex-col gap-3 overflow-y-auto p-6">
              {content.map((line, index) => {
                const isLoading = loadingIndex === index;
                const isPlaying = playingIndex === index;
                const isDownloading = downloadingIndex === index;
                const disabled = !line.trim();
                return (
                  <div
                    key={index}
                    className="flex items-center gap-3 bg-background border border-emerald-400/60 rounded-lg px-4 shadow-sm hover:border-emerald-500 transition-colors animate-in fade-in slide-in-from-bottom-2 duration-300 h-14"
                  >
                    <div className="text-muted-foreground/60 font-mono text-sm select-none shrink-0">
                      {String(index + 1).padStart(3, "0")}.
                    </div>
                    <input
                      data-index={index}
                      value={line}
                      onChange={(e) => handleLineChange(index, e.target.value)}
                      onBlur={handleLineBlur}
                      onKeyDown={(e) => handleKeyDown(e, index)}
                      onPaste={(e) => handlePaste(e, index)}
                      className="flex-1 bg-transparent border-none outline-none focus:ring-0 text-base"
                      placeholder={index === 0 && content.length === 1 ? "Start typing..." : ""}
                    />
                    <Button
                      type="button"
                      variant={isPlaying ? "default" : "ghost"}
                      size="icon"
                      className="h-8 w-8 rounded-md shrink-0"
                      onClick={() => playLine(index, line)}
                      disabled={disabled}
                      title={isPlaying ? "Stop" : "Play"}
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isPlaying ? <Square className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-md shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => downloadLine(index, line)}
                      disabled={disabled || isDownloading}
                      title="Download MP3"
                    >
                      {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : (
            <LineEditor
              editorKey="main"
              value={content}
              onChange={(lines) => { setContent(lines); saveHistory(lines); }}
              placeholder="Start typing..."
            />
          )}
        </div>
      </div>

      {/* Audio Pool Card */}
      {isCutView && (
        <AudioPool lines={content} selectedVoice={selectedVoice} onSendToSpliter={onSendToSpliter} />
      )}
    </div>
  );
}
