import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronUp, Copy, Download, FileText, Menu, Plus, Search, Trash2, Upload, Clipboard, X } from "lucide-react";
import { parseInput, processBlocks, mergeBlocksByMarkers, generateSrtString, msToTime, type SubtitleBlock } from "@/lib/srt-splitter";
import { useToast } from "@/hooks/use-toast";
import { NameCombobox, rememberName } from "@/components/NameCombobox";

const SPLITTER_FIND_STORE = "srt-splitter:find-names";
const SPLITTER_REPLACE_STORE = "srt-splitter:replace-names";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Props {
  incomingSrt?: string;
  incomingFilename?: string;
  incomingKey?: number;
  onFinalOutput?: (srt: string, filename: string) => void;
  onSendToNote?: (text: string, sourceName: string) => void;
}

const STORAGE_KEY = "srt-tools:splitter-state:v1";

type PersistedState = {
  input: string;
  fileName: string;
  outputBlocks: SubtitleBlock[];
  dotDone: boolean;
  splitDone: boolean;
  trimDone: boolean;
};

function loadPersisted(): PersistedState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function SrtTimeSplitterTab({ incomingSrt, incomingFilename, incomingKey, onFinalOutput, onSendToNote }: Props = {}) {
  const persisted = useRef<PersistedState | null>(loadPersisted()).current;
  const [input, setInput] = useState(persisted?.input ?? "");
  const lastIncomingKey = useRef<number | undefined>(undefined);
  const [pasteText, setPasteText] = useState("");
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [outputBlocks, setOutputBlocks] = useState<SubtitleBlock[]>(persisted?.outputBlocks ?? []);
  const [fileName, setFileName] = useState(persisted?.fileName ?? "");
  const [isDragging, setIsDragging] = useState(false);
  const [dotDone, setDotDone] = useState(persisted?.dotDone ?? false);
  const [splitDone, setSplitDone] = useState(persisted?.splitDone ?? false);
  const [trimDone, setTrimDone] = useState(persisted?.trimDone ?? false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [jumpText, setJumpText] = useState("");
  const [highlightedJumpId, setHighlightedJumpId] = useState<number | null>(null);
  const [editedMap, setEditedMap] = useState<Record<number, string>>({});
  const cardRefs = useRef(new Map<number, HTMLDivElement | null>());
  const finalSentRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const data: PersistedState = { input, fileName, outputBlocks, dotDone, splitDone, trimDone };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // ignore quota / serialization errors
    }
  }, [input, fileName, outputBlocks, dotDone, splitDone, trimDone]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const inputBlocks = useMemo(() => parseInput(input), [input]);
  const activeBlocks = outputBlocks.length > 0 ? outputBlocks : inputBlocks;
  const markerCount = useMemo(() => (input.match(/✅/g) ?? []).length, [input]);
  const hasInput = input.trim().length > 0;
  const isOutputView = outputBlocks.length > 0;

  const loadSrtText = (text: string, name: string) => {
    setInput(text);
    setFileName(name);
    setOutputBlocks([]);
    setPasteText("");
    setShowPasteBox(false);
    setDotDone(false);
    setSplitDone(false);
    setTrimDone(false);
    setFindText("");
    setReplaceText("");
    setJumpText("");
    setHighlightedJumpId(null);
    setEditedMap({});
    finalSentRef.current = false;
  };

  const handleConvertReplace = () => {
    const term = findText.trim();
    if (!term) return;
    const replacement = replaceText;
    const flags = "gi";

    let replacements = 0;

    if (outputBlocks.length > 0) {
      setOutputBlocks(prev =>
        prev.map(b => {
          const re = new RegExp(escapeRegex(term), flags);
          if (re.test(b.text)) {
            replacements += 1;
            const newText = b.text.replace(new RegExp(escapeRegex(term), flags), replacement);
            setEditedMap(prevMap => ({ ...prevMap, [b.id]: replacement }));
            return { ...b, text: newText };
          }
          return b;
        })
      );
    } else {
      const re = new RegExp(escapeRegex(term), flags);
      if (re.test(input)) {
        replacements = (input.match(new RegExp(escapeRegex(term), flags)) || []).length;
        setInput(prev => prev.replace(new RegExp(escapeRegex(term), flags), replacement));
      }
    }

    if (term) rememberName(SPLITTER_FIND_STORE, term);
    if (replacement.trim()) rememberName(SPLITTER_REPLACE_STORE, replacement);

    if (replacements > 0) {
      toast({
        title: "Replaced",
        description: `${replacements} card${replacements === 1 ? "" : "s"} updated.`,
      });
    } else {
      toast({
        title: "No matches found",
        description: `"${term}" was not found in any subtitle.`,
        variant: "destructive",
      });
    }

    setFindText("");
    setReplaceText("");
  };

  useEffect(() => {
    if (!incomingSrt || !incomingSrt.trim()) return;
    if (incomingKey === lastIncomingKey.current) return;
    lastIncomingKey.current = incomingKey;
    loadSrtText(incomingSrt, incomingFilename || "from-editor.srt");
  }, [incomingSrt, incomingFilename, incomingKey]);

  useEffect(() => {
    if (!onFinalOutput) return;
    if (finalSentRef.current) return;
    if (!splitDone || !trimDone || !dotDone) return;
    if (outputBlocks.length === 0) return;
    finalSentRef.current = true;
    const srt = generateSrtString(outputBlocks);
    onFinalOutput(srt, "Bangla.srt");
    toast({
      title: "Sent to Video Spliter",
      description: "Final SRT auto-loaded into Video Spliter.",
    });
  }, [splitDone, trimDone, dotDone, outputBlocks, onFinalOutput, fileName, toast]);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".srt") && !file.name.toLowerCase().endsWith(".txt")) {
      toast({
        title: "Please upload an SRT file",
        description: "Only .srt and .txt subtitle files are supported.",
        variant: "destructive",
      });
      return;
    }

    try {
      const text = await file.text();
      loadSrtText(text, file.name);
      toast({
        title: "SRT file loaded",
        description: `${file.name} is ready for Split Lines.`,
      });
    } catch {
      toast({
        title: "Could not read file",
        description: "Please try another SRT file.",
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleFile(file);
    event.target.value = "";
  };

  const handleDrop = async (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const handlePasteLoad = () => {
    if (!pasteText.trim()) {
      toast({
        title: "Paste SRT text first",
        description: "Add subtitle text before loading it.",
        variant: "destructive",
      });
      return;
    }
    loadSrtText(pasteText, "pasted-input.srt");
    toast({
      title: "SRT text loaded",
      description: "Your pasted subtitle text is ready for Split Lines.",
    });
  };

  const handleSplitLine = () => {
    try {
      const parsed = parseInput(input);
      if (parsed.length === 0) {
        toast({
          title: "No valid timestamps found",
          description: "Please check your SRT file format.",
          variant: "destructive",
        });
        return;
      }
      const cutBlocks = processBlocks(parsed);
      const merged = mergeBlocksByMarkers(cutBlocks);
      setOutputBlocks(merged);
      setSplitDone(true);
      toast({
        title: "Split Lines applied",
        description: `${merged.length} clean cards created.`,
      });
    } catch {
      toast({
        title: "Error processing Split Lines",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    if (outputBlocks.length === 0) return;
    const srt = generateSrtString(outputBlocks);
    const blob = new Blob([srt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Bangla.srt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyAll = async () => {
    if (!hasInput) return;
    let text: string;
    if (outputBlocks.length > 0) {
      text = outputBlocks.map(b => b.text).join('\n');
    } else {
      const parsed = parseInput(input);
      text = parsed.map(b => b.text).join('\n');
    }
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Text copied to clipboard.",
    });
  };

  const handleTrimEnd10 = () => {
    if (trimDone) return;
    if (outputBlocks.length === 0) {
      toast({
        title: "Run Split Lines first",
        description: "Trim works on the generated cards.",
        variant: "destructive",
      });
      return;
    }
    setOutputBlocks(prev =>
      prev.map(b => ({
        ...b,
        endTime: Math.max(b.startTime, b.endTime - 10),
      }))
    );
    setTrimDone(true);
    toast({
      title: "Trimmed -10ms",
      description: "Every card's end time reduced by 10 milliseconds.",
    });
  };

  const handleShiftMinus1s = () => {
    if (outputBlocks.length === 0) {
      toast({
        title: "No output cards",
        description: "Run Split Lines first to generate cards.",
        variant: "destructive",
      });
      return;
    }
    setOutputBlocks(prev =>
      prev.map((b, idx) => {
        if (idx === 0) {
          return {
            ...b,
            startTime: 0,
            endTime: Math.max(0, b.endTime - 1000),
          };
        }
        return {
          ...b,
          startTime: b.startTime - 1000,
          endTime: b.endTime - 1000,
        };
      })
    );
    toast({
      title: "Shifted -1s",
      description: "All cards shifted back 1 second. First card start kept at 0.",
    });
  };

  const handleEmojiToDot = () => {
    if (outputBlocks.length > 0) {
      setOutputBlocks(prev => prev.map(b => ({ ...b, text: b.text.replace(/✅/g, ".") })));
    }
    setInput(prev => prev.replace(/✅/g, "."));
    setDotDone(true);
  };

  const handleRunAll = () => {
    if (!hasInput) return;
    try {
      const parsed = parseInput(input);
      const cutBlocks = processBlocks(parsed);
      const merged = mergeBlocksByMarkers(cutBlocks);
      const processed = merged.map(b => ({
        ...b,
        endTime: Math.max(b.startTime, b.endTime - 10),
        text: b.text.replace(/✅/g, "."),
      }));
      setInput(prev => prev.replace(/✅/g, "."));
      setOutputBlocks(processed);
      setSplitDone(true);
      setTrimDone(true);
      setDotDone(true);
      toast({
        title: "All steps applied",
        description: `${processed.length} cards created, -10ms trimmed, ✅ → .`,
      });
    } catch {
      toast({
        title: "Error processing",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
    }
  };

  const splitRef = useRef(handleSplitLine);
  const dotRef = useRef(handleEmojiToDot);
  const trimRef = useRef(handleTrimEnd10);
  splitRef.current = handleSplitLine;
  dotRef.current = handleEmojiToDot;
  trimRef.current = handleTrimEnd10;
  useEffect(() => {
    const hSplit = () => splitRef.current();
    const hDot = () => dotRef.current();
    const hTrim = () => trimRef.current();
    window.addEventListener("srt-tools:splitter-split", hSplit);
    window.addEventListener("srt-tools:splitter-dot", hDot);
    window.addEventListener("srt-tools:splitter-trim10", hTrim);
    return () => {
      window.removeEventListener("srt-tools:splitter-split", hSplit);
      window.removeEventListener("srt-tools:splitter-dot", hDot);
      window.removeEventListener("srt-tools:splitter-trim10", hTrim);
    };
  }, []);

  const handleClear = () => {
    setInput("");
    setFileName("");
    setOutputBlocks([]);
    setPasteText("");
    setShowPasteBox(false);
    setDotDone(false);
    setSplitDone(false);
    setTrimDone(false);
    setFindText("");
    setReplaceText("");
    setJumpText("");
    setHighlightedJumpId(null);
    setEditedMap({});
    finalSentRef.current = false;
  };

  useEffect(() => {
    const term = jumpText.trim().toLowerCase();
    if (!term) {
      setHighlightedJumpId(null);
      return;
    }
    const match = activeBlocks.find((b) => b.text.toLowerCase().includes(term));
    if (!match) {
      setHighlightedJumpId(null);
      return;
    }
    const el = cardRefs.current.get(match.id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightedJumpId(match.id);
    }
  }, [jumpText, activeBlocks]);


  return (
    <div className="min-h-full bg-[#f6f7fb] font-sans text-slate-900">
      <main className="mx-auto flex w-full max-w-[1280px] flex-col px-7 py-8">
        <div className="mb-5 flex min-h-[68px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900 px-6 py-3.5 shadow-[0_4px_18px_rgba(15,23,42,0.08)]">
          <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
            <span className="text-[19px] font-normal tracking-tight text-black">SRT Time Spliter</span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[13px] text-slate-700 shadow-sm">{activeBlocks.length} subtitles</span>
            {hasInput && (
              <span className={`rounded-full border px-2.5 py-1 text-[13px] shadow-sm ${isOutputView ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}>
                {isOutputView ? `+${outputBlocks.length} cards` : `${markerCount} emoji sentence breaks found`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            {isOutputView && (
              <Button
                onClick={handleShiftMinus1s}
                title="Shift all cards back by 1 second (first card start stays at 0)"
                className="h-9 rounded-lg bg-gradient-to-b from-[#8b5cf6] to-[#7c3aed] px-3.5 text-xs font-semibold tracking-wide text-white shadow-[0_3px_10px_rgba(124,58,237,0.28)] ring-1 ring-white/15 transition-all duration-200 hover:-translate-y-px hover:from-[#7c3aed] hover:to-[#6d28d9] hover:shadow-[0_5px_14px_rgba(124,58,237,0.32)]"
              >
                -1s
              </Button>
            )}
            <Button
              onClick={handleRunAll}
              disabled={!hasInput}
              title="Convert ✅ → . , Split Lines, and trim -10ms"
              className={`h-9 rounded-lg bg-gradient-to-b from-[#f97316] to-[#ea580c] px-3.5 text-xs font-semibold tracking-wide text-white shadow-[0_3px_10px_rgba(234,88,12,0.28)] ring-1 ring-white/15 transition-all duration-200 hover:-translate-y-px hover:from-[#ea580c] hover:to-[#c2410c] hover:shadow-[0_5px_14px_rgba(234,88,12,0.32)] disabled:bg-orange-300 ${splitDone ? "opacity-60 hover:opacity-60" : ""}`}
            >
              <Menu className="h-3.5 w-3.5" /> Split Lines
            </Button>
            <Button
              onClick={handleCopyAll}
              disabled={!hasInput}
              className="h-9 rounded-lg bg-gradient-to-b from-[#22c55e] to-[#16a34a] px-3.5 text-xs font-semibold tracking-wide text-white shadow-[0_3px_10px_rgba(22,163,74,0.28)] ring-1 ring-white/15 transition-all duration-200 hover:-translate-y-px hover:from-[#16a34a] hover:to-[#15803d] hover:shadow-[0_5px_14px_rgba(22,163,74,0.32)] disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5" /> Copy All
            </Button>
            <Button
              onClick={handleDownload}
              disabled={outputBlocks.length === 0}
              className="h-9 rounded-lg bg-gradient-to-b from-[#3b82f6] to-[#2563eb] px-3.5 text-xs font-semibold tracking-wide text-white shadow-[0_3px_10px_rgba(37,99,235,0.26)] ring-1 ring-white/15 transition-all duration-200 hover:-translate-y-px hover:from-[#2563eb] hover:to-[#1d4ed8] hover:shadow-[0_5px_14px_rgba(37,99,235,0.32)] disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> Download SRT
            </Button>
          </div>
        </div>

        {!hasInput ? (
          <UploadPanel
            fileInputRef={fileInputRef}
            isDragging={isDragging}
            showPasteBox={showPasteBox}
            pasteText={pasteText}
            onFileUpload={handleFileUpload}
            onDrop={handleDrop}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onPasteTextChange={setPasteText}
            onShowPaste={() => setShowPasteBox((value) => !value)}
            onLoadPaste={handlePasteLoad}
          />
        ) : (
          <section className="min-h-0 flex-1 overflow-hidden">
            <div className="mb-4 flex min-h-[51px] flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white dark:bg-gray-900 px-5 py-2.5 shadow-[0_2px_8px_rgba(15,23,42,0.07)]">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-4 w-4 shrink-0 text-blue-500" />
                <div className="truncate text-[15px] font-bold text-slate-800">{isOutputView ? "Bangla.srt" : fileName || "input.srt"}</div>
              </div>
              <div className="flex flex-1 flex-nowrap items-center justify-end gap-2">
                <div className="relative w-[150px] shrink-0">
                  <Input
                    type="text"
                    value={jumpText}
                    onChange={(e) => setJumpText(e.target.value)}
                    placeholder="Jump to text..."
                    title="Type a sentence — matching subtitle scrolls into view"
                    className="bg-slate-50/50 dark:bg-gray-800 h-9 pr-8"
                  />
                  {jumpText ? (
                    <button
                      type="button"
                      onClick={() => setJumpText("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      title="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <Search className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  )}
                </div>
                <div className="w-[150px] shrink-0">
                  <NameCombobox
                    placeholder="Find (e.g. max)"
                    value={findText}
                    onChange={setFindText}
                    storageKey={SPLITTER_FIND_STORE}
                  />
                </div>
                <div className="w-[150px] shrink-0">
                  <NameCombobox
                    placeholder="Replace with"
                    value={replaceText}
                    onChange={setReplaceText}
                    storageKey={SPLITTER_REPLACE_STORE}
                  />
                </div>
                <Button
                  onClick={handleConvertReplace}
                  disabled={!findText.trim()}
                  title="Find & replace text in all subtitles"
                  className="h-9 rounded-lg bg-gradient-to-b from-[#3b82f6] to-[#2563eb] px-4 text-xs font-semibold tracking-wide text-white shadow-[0_3px_10px_rgba(37,99,235,0.26)] ring-1 ring-white/15 transition-all duration-200 hover:-translate-y-px hover:from-[#2563eb] hover:to-[#1d4ed8] hover:shadow-[0_5px_14px_rgba(37,99,235,0.32)] disabled:opacity-50"
                >
                  Convert
                </Button>
                <Button variant="ghost" onClick={handleClear} className="h-8 rounded-lg border border-slate-200 bg-white dark:bg-gray-900 px-3 text-xs font-semibold text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800">
                  <X className="h-3.5 w-3.5" /> Clear
                </Button>
                <Button variant="ghost" onClick={() => {
                  const text = activeBlocks.map(b => b.text).join("\n").trim();
                  if (!text) {
                    toast({ title: "Nothing to send", description: "There is no text in the cards yet.", variant: "destructive" });
                    return;
                  }
                  if (onSendToNote) {
                    const baseName = (fileName || "output.srt").replace(/\.(srt|txt)$/i, "");
                    onSendToNote(text, baseName || "Note");
                    toast({ title: "Sent to SRT Note", description: "Opened a new project with text in ORIGINAL." });
                  }
                }} className="h-8 rounded-lg border border-slate-200 bg-white dark:bg-gray-900 px-3 text-xs font-semibold text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-800">
                  <Upload className="h-3.5 w-3.5" /> Load Note
                </Button>
                <input ref={fileInputRef} type="file" accept=".srt,.txt" onChange={handleFileUpload} className="hidden" />
              </div>
            </div>

            <ScrollArea className="h-[calc(100vh-260px)]">
              <div className="space-y-4 pb-6">
                {activeBlocks.map((block) => (
                  <div
                    key={`${isOutputView ? "out" : "in"}-${block.id}`}
                    ref={(el) => {
                      if (el) cardRefs.current.set(block.id, el);
                      else cardRefs.current.delete(block.id);
                    }}
                    className={`scroll-mt-2 rounded-2xl transition-all duration-300 ${
                      highlightedJumpId === block.id
                        ? "ring-2 ring-red-500 ring-offset-2 ring-offset-[#f6f7fb] dark:ring-offset-gray-950"
                        : ""
                    }`}
                  >
                    <SubtitleRow
                      block={block}
                      findText={findText}
                      replacedWith={editedMap[block.id]}
                      onTextChange={(newText) => {
                        if (isOutputView) {
                          setOutputBlocks((prev) =>
                            prev.map((b) => (b.id === block.id ? { ...b, text: newText } : b)),
                          );
                        } else {
                          setOutputBlocks(
                            inputBlocks.map((b) =>
                              b.id === block.id ? { ...b, text: newText } : b,
                            ),
                          );
                        }
                      }}
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </section>
        )}
      </main>
    </div>
  );
}

function UploadPanel({
  fileInputRef,
  isDragging,
  showPasteBox,
  pasteText,
  onFileUpload,
  onDrop,
  onDragEnter,
  onDragLeave,
  onPasteTextChange,
  onShowPaste,
  onLoadPaste,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  showPasteBox: boolean;
  pasteText: string;
  onFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: React.DragEvent<HTMLLabelElement>) => void;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onPasteTextChange: (value: string) => void;
  onShowPaste: () => void;
  onLoadPaste: () => void;
}) {
  return (
    <section className="rounded-xl bg-white dark:bg-gray-900 p-4 shadow-sm ring-1 ring-slate-200/70">
      <label
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        className={`flex min-h-[235px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 text-center transition ${
          isDragging ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-slate-50/50 hover:bg-slate-50"
        }`}
      >
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white dark:bg-gray-900 text-slate-600 shadow-sm ring-1 ring-slate-200">
          <Upload className="h-6 w-6" />
        </span>
        <span className="text-lg font-bold text-slate-800">Drop your SRT file here</span>
        <span className="mt-2 text-sm text-slate-500">or click to browse — supports .srt and .txt files</span>
        <input ref={fileInputRef} type="file" accept=".srt,.txt" onChange={onFileUpload} className="hidden" />
      </label>

      <div className="my-7 flex items-center gap-4 text-sm text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        <span>or</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>

      <div className="flex justify-center">
        <Button onClick={onShowPaste} variant="outline" className="h-11 rounded-lg border-slate-200 bg-white dark:bg-gray-900 px-6 font-semibold text-slate-700 shadow-sm">
          <Clipboard className="h-4 w-4" /> Paste SRT text
        </Button>
      </div>

      {showPasteBox && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <textarea
            value={pasteText}
            onChange={(event) => onPasteTextChange(event.target.value)}
            placeholder="Paste SRT text here..."
            className="min-h-40 w-full resize-y rounded-lg border border-slate-200 bg-white dark:bg-gray-900 p-3 text-sm text-slate-800 outline-none focus:border-blue-400"
          />
          <div className="mt-3 flex justify-end">
            <Button onClick={onLoadPaste} className="rounded-md bg-blue-600 px-5 font-bold text-white hover:bg-blue-700">
              Load pasted SRT
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SubtitleRow({
  block,
  onTextChange,
  findText,
  replacedWith,
}: {
  block: SubtitleBlock;
  onTextChange: (newText: string) => void;
  findText: string;
  replacedWith?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isEditing, setIsEditing] = useState(false);

  const autoSize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    autoSize();
  });

  useEffect(() => {
    autoSize();
  }, [block.text, autoSize]);

  const trimmedFind = findText.trim();
  const hasFindHighlight = trimmedFind.length > 0;
  const hasReplaceHighlight = !!replacedWith && replacedWith.length > 0;

  const renderHighlighted = useCallback(
    (text: string) => {
      const segments: { text: string; type: "green" | "plain" }[] = [];

      if (hasReplaceHighlight) {
        const greenRegex = new RegExp(`(${escapeRegex(replacedWith!)})`, "gi");
        const parts = text.split(greenRegex);
        parts.forEach((part) => {
          if (!part) return;
          if (part.toLowerCase() === replacedWith!.toLowerCase()) {
            segments.push({ text: part, type: "green" });
          } else {
            segments.push({ text: part, type: "plain" });
          }
        });
      } else {
        segments.push({ text, type: "plain" });
      }

      const finalNodes: React.ReactNode[] = [];
      let key = 0;

      segments.forEach((seg) => {
        if (seg.type === "green") {
          finalNodes.push(
            <span
              key={key++}
              className="rounded bg-emerald-100 px-1 font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
            >
              {seg.text}
            </span>,
          );
        } else if (hasFindHighlight) {
          const findRegex = new RegExp(`(${escapeRegex(trimmedFind)})`, "gi");
          const subParts = seg.text.split(findRegex);
          subParts.forEach((part) => {
            if (!part) return;
            if (part.toLowerCase() === trimmedFind.toLowerCase()) {
              finalNodes.push(
                <span
                  key={key++}
                  className="rounded bg-red-100 px-1 font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-200"
                >
                  {part}
                </span>,
              );
            } else {
              finalNodes.push(<span key={key++}>{part}</span>);
            }
          });
        } else {
          finalNodes.push(<span key={key++}>{seg.text}</span>);
        }
      });

      return finalNodes;
    },
    [hasFindHighlight, hasReplaceHighlight, replacedWith, trimmedFind],
  );

  const showHighlightedView = !isEditing && (hasFindHighlight || hasReplaceHighlight);

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:bg-gray-900 shadow-[0_2px_9px_rgba(15,23,42,0.08)]">
      <div className="flex h-11 items-center justify-between border-b border-slate-100 px-5">
        <div className="flex items-center gap-4">
          <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
            {block.id}
          </span>
          <span className="font-mono text-[13px] font-bold tracking-wide text-slate-400">
            {msToTime(block.startTime)} → {msToTime(block.endTime)}
          </span>
          {hasReplaceHighlight && (
            <Badge className="border-0 bg-emerald-100 px-2 py-0 text-[10px] uppercase tracking-wider text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">
              Edited
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-slate-300">
          <ChevronUp className="h-4 w-4" />
          <ChevronDown className="h-4 w-4" />
          <Plus className="h-4 w-4" />
          <Trash2 className="h-4 w-4 text-slate-300" />
        </div>
      </div>
      {showHighlightedView ? (
        <div
          onClick={() => setIsEditing(true)}
          className="block min-h-[36px] w-full cursor-text whitespace-pre-wrap px-5 py-3 text-[15px] font-medium leading-snug text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gray-800/40"
          title="Click to edit"
        >
          {renderHighlighted(block.text)}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={block.text}
          autoFocus={isEditing}
          onChange={(e) => {
            onTextChange(e.target.value);
            autoSize();
          }}
          onInput={autoSize}
          onBlur={() => setIsEditing(false)}
          rows={1}
          spellCheck={false}
          className="block min-h-[36px] w-full resize-none whitespace-pre-wrap border-0 bg-transparent px-5 py-3 text-[15px] font-medium leading-snug text-slate-700 outline-none focus:bg-blue-50/30 dark:focus:bg-blue-950/20"
        />
      )}
    </article>
  );
}
