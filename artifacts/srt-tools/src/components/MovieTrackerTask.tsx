import React, { useState, useEffect, useRef, useCallback } from "react";
import { Search, Plus, Trash2, Copy, ClipboardPaste, CheckCircle2, Circle, Film, X, RotateCcw, Type, Download, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LANGUAGES = ["ARABIC", "GERMAN", "ENGLISH", "SPANISH", "FRENCH"] as const;
type Language = typeof LANGUAGES[number];

const TITLE_SUFFIX: Record<Language, string> = {
  ENGLISH: "Explained in English",
  ARABIC: "ملخص فيلم - قصة الفيلم كاملة",
  GERMAN: "Die komplette Geschichte erklärt",
  SPANISH: "Resumen completo de la película",
  FRENCH: "L'histoire complète du film",
};

interface MovieEntry {
  id: string;
  number: string;
  names: Record<Language, string>;
  made: boolean;
}

function generateId() {
  return Math.random().toString(36).slice(2);
}

function formatNumber(n: number): string {
  return String(n).padStart(3, "0");
}

const STORAGE_KEY = "movie-names-data";
const TRASH_KEY = "movie-names-trash";

function loadData(): MovieEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [
    { id: generateId(), number: "001", names: { ARABIC: "", GERMAN: "", ENGLISH: "", SPANISH: "", FRENCH: "" }, made: false },
    { id: generateId(), number: "002", names: { ARABIC: "", GERMAN: "", ENGLISH: "", SPANISH: "", FRENCH: "" }, made: false },
  ];
}

function loadTrash(): MovieEntry[] {
  try {
    const raw = localStorage.getItem(TRASH_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveData(entries: MovieEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function saveTrash(entries: MovieEntry[]) {
  localStorage.setItem(TRASH_KEY, JSON.stringify(entries));
}

export default function MovieTrackerTask({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<MovieEntry[]>(loadData);
  const [trash, setTrash] = useState<MovieEntry[]>(loadTrash);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [titleMode, setTitleMode] = useState(false);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const uploadRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => { saveData(entries); }, [entries]);
  useEffect(() => { saveTrash(trash); }, [trash]);

  const renumber = (arr: MovieEntry[]): MovieEntry[] =>
    arr.map((e, i) => ({ ...e, number: formatNumber(arr.length - i) }));

  const addRow = useCallback(() => {
    setEntries(prev => {
      const newEntry: MovieEntry = {
        id: generateId(),
        number: formatNumber(prev.length + 1),
        names: { ARABIC: "", GERMAN: "", ENGLISH: "", SPANISH: "", FRENCH: "" },
        made: false,
      };
      return renumber([newEntry, ...prev]);
    });
  }, []);

  const updateName = useCallback((id: string, lang: Language, value: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, names: { ...e.names, [lang]: value } } : e));
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setEntries(prev => {
      const target = prev.find(e => e.id === id);
      if (target) {
        setTrash(t => [target, ...t]);
        toast({ description: `Row ${target.number} moved to trash` });
      }
      return renumber(prev.filter(e => e.id !== id));
    });
  }, [toast]);

  const recoverEntry = useCallback((id: string) => {
    setTrash(prev => {
      const target = prev.find(e => e.id === id);
      if (target) {
        setEntries(e => {
          const nextNum = e.length + 1;
          const recovered = { ...target, number: formatNumber(nextNum) };
          toast({ description: `Row recovered as ${recovered.number}` });
          return [...e, recovered];
        });
      }
      return prev.filter(e => e.id !== id);
    });
  }, [toast]);

  const permanentDelete = useCallback((id: string) => {
    setTrash(prev => prev.filter(e => e.id !== id));
    toast({ description: "Permanently deleted" });
  }, [toast]);

  const emptyTrash = useCallback(() => {
    setTrash([]);
    toast({ description: "Trash emptied" });
  }, [toast]);

  const copyCell = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ description: "Copied to clipboard" });
    } catch {
      toast({ description: "Could not copy", variant: "destructive" });
    }
  }, [toast]);

  const pasteCell = useCallback(async (id: string, lang: Language) => {
    try {
      const text = await navigator.clipboard.readText();
      updateName(id, lang, text);
      toast({ description: "Pasted from clipboard" });
    } catch {
      toast({ description: "Could not paste", variant: "destructive" });
    }
  }, [updateName, toast]);

  const clearCell = useCallback((id: string, lang: Language) => {
    updateName(id, lang, "");
  }, [updateName]);

  const toggleMade = useCallback((id: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, made: !e.made } : e));
  }, []);

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!query.trim()) { setHighlightedId(null); return; }
    const q = query.trim().toLowerCase();
    const found = entries.find(e => {
      if (e.number.toLowerCase().includes(q)) return true;
      return LANGUAGES.some(lang => e.names[lang].toLowerCase().includes(q));
    });
    if (found) {
      setHighlightedId(found.id);
      setTimeout(() => {
        const el = rowRefs.current[found.id];
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("highlight-row");
          setTimeout(() => el.classList.remove("highlight-row"), 1000);
        }
      }, 50);
    } else {
      setHighlightedId(null);
    }
  }, [entries]);

  const clearSearch = () => { setSearchQuery(""); setHighlightedId(null); };

  const handleDownload = useCallback(() => {
    const data = JSON.stringify({ entries, trash }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `movie-names-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ description: "Backup downloaded" });
  }, [entries, trash, toast]);

  const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (Array.isArray(parsed.entries)) {
          setEntries(parsed.entries);
          if (Array.isArray(parsed.trash)) setTrash(parsed.trash);
          toast({ description: "Data restored successfully" });
        } else {
          toast({ description: "Invalid backup file", variant: "destructive" });
        }
      } catch {
        toast({ description: "Could not read file", variant: "destructive" });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [toast]);

  const filteredEntries = searchQuery.trim()
    ? entries.filter(e => {
        const q = searchQuery.trim().toLowerCase();
        if (e.number.toLowerCase().includes(q)) return true;
        return LANGUAGES.some(lang => e.names[lang].toLowerCase().includes(q));
      })
    : entries;

  const totalCount = entries.length;
  const madeCount = entries.filter(e => e.made).length;

  function trashLabel(e: MovieEntry) {
    const name = LANGUAGES.map(l => e.names[l]).find(v => v.trim()) || "(empty)";
    return `${e.number} — ${name}`;
  }

  return (
    <div className="relative flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 bg-card border-b border-border shadow-sm">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            {/* LEFT: Logo + Title + Stats */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Film className="w-4 h-4 text-primary-foreground" />
              </div>
              <h1 className="text-lg font-bold text-foreground">Movie Names</h1>
              <span className="bg-accent/15 text-accent px-2.5 py-1 rounded-md text-xs font-semibold">{madeCount} Made</span>
              <span className="bg-muted text-muted-foreground px-2.5 py-1 rounded-md text-xs font-medium">{totalCount - madeCount} Pending</span>
            </div>

            {/* RIGHT: Search + Title Mode + Add Row + Download + Upload + Close */}
            <div className="flex items-center gap-2 ml-auto">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="search"
                  className="w-full pl-9 pr-8 py-2 text-sm bg-white border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 placeholder:text-slate-400 text-slate-700 transition-all"
                  placeholder="Search by name or number..."
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                />
                {searchQuery && (
                  <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <button
                onClick={() => setTitleMode(m => !m)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 border ${
                  titleMode
                    ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-600"
                    : "bg-card text-foreground border-border hover:bg-secondary/60"
                }`}
                title={titleMode ? "Exit Title Mode to edit" : "Enable Title Mode"}
              >
                {titleMode ? <X className="w-4 h-4" /> : <Type className="w-4 h-4" />}
                {titleMode ? "Exit Title Mode" : "Title Mode"}
              </button>
              <button
                onClick={addRow}
                className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors shrink-0"
              >
                <Plus className="w-4 h-4" />
                Add Row
              </button>
              <button
                onClick={handleDownload}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
                title="Download backup"
              >
                <Download className="w-4 h-4" />
              </button>
              <button
                onClick={() => uploadRef.current?.click()}
                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0"
                title="Upload backup"
              >
                <Upload className="w-4 h-4" />
              </button>
              <input
                ref={uploadRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={handleUpload}
              />
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto pb-20">
        <div className="px-4 py-4">
          <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div>
              <table className="w-full table-fixed">
                <thead>
                  <tr className="bg-secondary/60 border-b border-border">
                    <th className="text-left px-3 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider w-14">NO</th>
                    {LANGUAGES.map(lang => (
                      <th key={lang} className="text-center px-2 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {lang}
                      </th>
                    ))}
                    <th className="w-9 px-1 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry, idx) => (
                    <React.Fragment key={entry.id}>
                      {idx > 0 && Math.ceil(parseInt(entry.number, 10) / 5) !== Math.ceil(parseInt(filteredEntries[idx - 1].number, 10) / 5) && (
                        <tr aria-hidden="true">
                          <td colSpan={7} className="p-0">
                            <div className="h-3 bg-slate-100 border-y border-slate-200" />
                          </td>
                        </tr>
                      )}
                      <tr
                        ref={el => { rowRefs.current[entry.id] = el; }}
                        className={`group transition-colors border-b border-slate-100 ${
                          highlightedId === entry.id
                            ? "bg-primary/8"
                            : "bg-white hover:bg-slate-50"
                        }`}
                      >
                        <td className="px-3 py-2 align-middle">
                          <span className={`inline-flex items-center justify-center w-10 h-8 rounded-md text-xs font-bold tabular-nums ${
                            entry.made ? "bg-accent/15 text-accent" : "bg-secondary/50 text-muted-foreground/70"
                          }`}>
                            {entry.number}
                          </span>
                        </td>
                        {LANGUAGES.map(lang => {
                          const raw = entry.names[lang];
                          const isRtl = lang === "ARABIC";
                          const titled = raw.trim()
                            ? `${raw.trim()} ${TITLE_SUFFIX[lang]}`
                            : "";
                          return (
                            <td key={lang} className="px-2 py-2 align-middle">
                              {titleMode ? (
                                <TitleCell
                                  value={titled}
                                  made={entry.made}
                                  onCopy={() => copyCell(titled)}
                                  isRtl={isRtl}
                                />
                              ) : (
                                <CellInput
                                  value={raw}
                                  onChange={val => updateName(entry.id, lang, val)}
                                  onCopy={() => copyCell(raw)}
                                  onPaste={() => pasteCell(entry.id, lang)}
                                  onClear={() => clearCell(entry.id, lang)}
                                  disabled={entry.made}
                                  made={entry.made}
                                  isRtl={isRtl}
                                />
                              )}
                            </td>
                          );
                        })}
                        <td className="px-1 py-2 align-middle">
                          <div className="flex flex-col items-center gap-0.5">
                            <button
                              onClick={() => toggleMade(entry.id)}
                              className={`inline-flex items-center justify-center w-6 h-6 rounded transition-all ${
                                entry.made
                                  ? "text-accent hover:bg-accent/20"
                                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                              }`}
                              title={entry.made ? "Mark as not made" : "Mark as made"}
                            >
                              {entry.made
                                ? <CheckCircle2 className="w-4 h-4" />
                                : <Circle className="w-4 h-4" />
                              }
                            </button>
                            <button
                              onClick={() => deleteEntry(entry.id)}
                              className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                              title="Move to trash"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                  {filteredEntries.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                        {searchQuery ? `No results found for "${searchQuery}"` : "No entries yet. Add a row to get started."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Trash — small icon button, expands to full panel on click */}
      <div className="absolute bottom-4 left-4 z-40">
        {/* Collapsed: icon-only button */}
        {!trashOpen && (
          <button
            onClick={() => setTrashOpen(true)}
            className="relative w-10 h-10 bg-card border border-border rounded-xl shadow-lg flex items-center justify-center hover:bg-secondary/50 transition-colors"
            title="Open Trash"
          >
            <Trash2 className="w-5 h-5 text-muted-foreground" />
            {trash.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
                {trash.length > 9 ? "9+" : trash.length}
              </span>
            )}
          </button>
        )}

        {/* Expanded: full panel */}
        {trashOpen && (
          <div className="w-96 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/30">
              <Trash2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold text-foreground flex-1">
                Trash {trash.length > 0 ? `(${trash.length})` : ""}
              </span>
              {trash.length > 0 && (
                <button
                  onClick={emptyTrash}
                  className="text-xs text-destructive hover:text-destructive/80 font-medium transition-colors"
                >
                  Empty All
                </button>
              )}
              <button
                onClick={() => setTrashOpen(false)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Panel body */}
            {trash.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">Trash is empty</p>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-border">
                {trash.map(e => (
                  <div key={e.id} className="px-3 py-3 hover:bg-secondary/20 transition-colors">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold font-mono bg-secondary px-2 py-0.5 rounded text-muted-foreground">{e.number}</span>
                      <span className="flex-1" />
                      <button
                        onClick={() => recoverEntry(e.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-accent bg-accent/10 hover:bg-accent/20 font-medium transition-colors"
                        title="Recover"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Recover
                      </button>
                      <button
                        onClick={() => permanentDelete(e.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-destructive bg-destructive/10 hover:bg-destructive/20 font-medium transition-colors"
                        title="Delete permanently"
                      >
                        <X className="w-3 h-3" />
                        Delete
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {LANGUAGES.map(lang => (
                        <div key={lang} className="flex items-start gap-1.5">
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase w-12 shrink-0 pt-0.5">{lang.slice(0,3)}</span>
                          <span className="text-xs text-foreground break-words">
                            {e.names[lang] || <span className="text-muted-foreground/50 italic">—</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface CellInputProps {
  value: string;
  onChange: (val: string) => void;
  onCopy: () => void;
  onPaste: () => void;
  onClear: () => void;
  disabled?: boolean;
  made?: boolean;
  isRtl?: boolean;
}

interface TitleCellProps {
  value: string;
  made?: boolean;
  onCopy: () => void;
  isRtl?: boolean;
}

function TitleCell({ value, made, onCopy, isRtl }: TitleCellProps) {
  const [copied, setCopied] = useState(false);

  const handleDoubleClick = () => {
    if (!value) return;
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      dir={isRtl ? "rtl" : undefined}
      onDoubleClick={handleDoubleClick}
      title={value ? "Double-click to copy" : undefined}
      className={`w-full px-2.5 py-2 text-sm rounded-lg border leading-snug min-h-[36px] select-none transition-colors duration-300 ${isRtl ? "text-right" : ""} ${
        copied
          ? "border-green-400 bg-green-50 text-green-800"
          : made
            ? "border-accent/30 bg-accent/10 text-accent"
            : "border-border bg-background text-foreground"
      } ${value ? "cursor-pointer" : "text-muted-foreground/40 italic"}`}
    >
      {value || "—"}
    </div>
  );
}

function CellInput({ value, onChange, onCopy, onPaste, onClear, disabled, made, isRtl }: CellInputProps) {
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);

  return (
    <div className="relative">
      {/* Floating toolbar above — only when focused */}
      {focused && !disabled && (
        <div className="absolute -top-8 left-0 right-0 z-30 flex items-center bg-card border border-border rounded-md shadow-md overflow-hidden">
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); onCopy(); }}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            tabIndex={-1}
          >
            <Copy className="w-3 h-3" />
            <span>Copy</span>
          </button>
          <div className="w-px h-4 bg-border" />
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); onPaste(); }}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            tabIndex={-1}
          >
            <ClipboardPaste className="w-3 h-3" />
            <span>Paste</span>
          </button>
          <div className="w-px h-4 bg-border" />
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); onClear(); }}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            tabIndex={-1}
          >
            <X className="w-3 h-3" />
            <span>Cancel</span>
          </button>
        </div>
      )}

      {/* Auto-grow textarea */}
      <textarea
        ref={textareaRef}
        value={value}
        rows={1}
        dir={isRtl ? "rtl" : undefined}
        onChange={e => !disabled && onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        className={`w-full px-2.5 py-2 text-sm rounded-lg border transition-all focus:outline-none focus:ring-2 resize-none overflow-hidden leading-snug ${isRtl ? "text-right" : ""} ${
          made
            ? "border-accent/30 bg-accent/10 text-accent focus:ring-accent/20 focus:border-accent/50"
            : focused
              ? "border-ring bg-slate-50"
              : "border-border bg-slate-50"
        } ${disabled ? "cursor-not-allowed" : ""}`}
      />
    </div>
  );
}
