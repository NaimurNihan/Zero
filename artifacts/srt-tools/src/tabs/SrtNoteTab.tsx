import { useState, useRef, useCallback, useEffect, type ClipboardEvent as ReactClipboardEvent } from "react";
import { Plus, Search, FileText, RotateCcw, X, ScanSearch, Download, Trash2, Scissors, Copy, Folder, FolderOpen, ArchiveRestore, ChevronDown, ChevronRight, MoreVertical, Play, Menu, PanelLeftOpen, Zap, Loader2, ClipboardPaste, SendToBack, CheckCircle2, Circle, Type } from "lucide-react";
interface TaskRow { id: string; number: string; values: string[]; made: boolean; trashed?: boolean; }
interface Project {
  id: string;
  name: string;
  updatedAt: string;
  langs: { label: string; content: string }[];
  trashed?: boolean;
  tasks?: TaskRow[];
}
interface SavedState {
  projects: Project[];
  activeId: string;
  darkMode: boolean;
  copiedChunks: { [key: string]: boolean };
}
const DEFAULT_LANGS = [
  { label: "Original", content: "" },
  { label: "Arabic", content: "" },
  { label: "German", content: "" },
  { label: "English", content: "" },
  { label: "Spanish", content: "" },
  { label: "French", content: "" },
];
const SAMPLE_PROJECTS: Project[] = [
  {
    id: "1",
    name: "Harry Potter and the Philosopher's Stone",
    updatedAt: "Today",
    langs: [
      { label: "Original", content: "It is shown at the beginning of the film, the Principal and a female professor of the school of witchcraft, They place a child before the gate of the house of his uncle.\nThat child name is \"Harry Potter\".\nMany years later, \"Harry\" has grown up 10 years old.\nHis uncle family's attitude with him was rough.\nHe used to beat him and lock in his room downstairs." },
      { label: "Arabic", content: "\u064A\u064F\u0638\u0647\u0631 \u0628\u062F\u0627\u064A\u0629 \u0627\u0644\u0641\u064A\u0644\u0645 \u0627\u0644\u0645\u062F\u064A\u0631 \u0648\u0623\u0633\u062A\u0627\u0630\u0629 \u0645\u0646 \u0645\u062F\u0631\u0633\u0629 \u0627\u0644\u0633\u062D\u0631\u060C \u064A\u0636\u0639\u0627\u0646 \u0637\u0641\u0644\u0627\u064B \u0623\u0645\u0627\u0645 \u0628\u0648\u0627\u0628\u0629 \u0645\u0646\u0632\u0644 \u0639\u0645\u0647.\n\u0627\u0633\u0645 \u0647\u0630\u0627 \u0627\u0644\u0637\u0641\u0644 \"\u0647\u0627\u0631\u064A \u0628\u0648\u062A\u0631\".\n\u0628\u0639\u062F \u0633\u0646\u0648\u0627\u062A \u0639\u062F\u064A\u062F\u0629\u060C \u0643\u0628\u0631 \"\u0647\u0627\u0631\u064A\" \u0648\u0623\u0635\u0628\u062D \u0641\u064A \u0627\u0644\u0639\u0627\u0634\u0631\u0629 \u0645\u0646 \u0639\u0645\u0631\u0647.\n\u0643\u0627\u0646\u062A \u0639\u0627\u0626\u0644\u0629 \u0639\u0645\u0647 \u062A\u0639\u0627\u0645\u0644\u0647 \u0628\u0642\u0633\u0648\u0629.\n\u0643\u0627\u0646 \u064A\u0636\u0631\u0628\u0647 \u0648\u064A\u062D\u0628\u0633\u0647 \u0641\u064A \u063A\u0631\u0641\u062A\u0647 \u0641\u064A \u0627\u0644\u0637\u0627\u0628\u0642 \u0627\u0644\u0633\u0641\u0644\u064A." },
      { label: "German", content: "Am Anfang des Films sieht man den Direktor und eine Professorin der Hexenschule, die ein Kind vor das Tor des Hauses seines Onkels bringen.\nDer Name des Kindes ist Harry Potter.\nViele Jahre sp\u00E4ter ist Harry zehn Jahre alt.\nDie Familie seines Onkels behandelt ihn schlecht.\nEr schlug ihn und sperrte ihn in sein Zimmer im Erdgeschoss." },
      { label: "English", content: "" },
      { label: "Spanish", content: "" },
      { label: "French", content: "" },
    ],
  },
  { id: "2", name: "The Dark Knight", updatedAt: "Yesterday", langs: DEFAULT_LANGS.map((l) => ({ ...l })) },
  { id: "3", name: "Inception", updatedAt: "3 days ago", langs: DEFAULT_LANGS.map((l) => ({ ...l })) },
];
function getTaskTitleSuffix(langLabel: string): string {
  const l = langLabel.toLowerCase();
  if (l.includes("arabic")) return "شرح الفيلم باللغة العربية";
  if (l.includes("german")) return "Film auf Deutsch erklärt";
  if (l.includes("english")) return "Movie Explained in English";
  if (l.includes("spanish")) return "Película explicada en español";
  if (l.includes("french")) return "Film expliqué en français";
  return "";
}
function generateTaskId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
const STORAGE_KEY = "srt-note-autosave-v1";
function getDefaultState(): SavedState {
  return { projects: SAMPLE_PROJECTS, activeId: "1", darkMode: false, copiedChunks: {} };
}
function readSavedState(): SavedState {
  if (typeof window === "undefined") return getDefaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) return getDefaultState();
    const activeId = parsed.projects.some((project) => project.id === parsed.activeId)
      ? parsed.activeId ?? parsed.projects[0].id
      : parsed.projects[0].id;
    const migratedProjects = parsed.projects.map((p) => {
      const existing = Array.isArray(p.langs) ? p.langs : [];
      const padded = DEFAULT_LANGS.map((def, i) => existing[i] ? { label: existing[i].label || def.label, content: existing[i].content ?? "" } : { ...def });
      const rawTasks = Array.isArray((p as any).tasks) ? (p as any).tasks : [];
      let activeIdx = 0;
      const tasks: TaskRow[] = rawTasks.map((t: any) => {
        const trashed = t.trashed ?? false;
        if (!trashed) activeIdx++;
        return {
          id: t.id ?? generateTaskId(),
          number: t.number ?? String(activeIdx).padStart(3, "0"),
          values: Array.isArray(t.values) ? t.values : [],
          made: t.made ?? t.checked ?? false,
          trashed,
        };
      });
      return { ...p, langs: padded, tasks };
    });
    return {
      projects: migratedProjects,
      activeId,
      darkMode: Boolean(parsed.darkMode),
      copiedChunks: (parsed.copiedChunks && typeof parsed.copiedChunks === "object") ? parsed.copiedChunks : {},
    };
  } catch {
    return getDefaultState();
  }
}
const PTU_RE = /[.?।]/g;
function linePtuCount(line: string): number {
  return (line.match(PTU_RE) || []).length;
}
function isLineBlue(line: string): boolean {
  const count = linePtuCount(line);
  return count === 0 || count > 1;
}
function applyPtuHighlighting(el: HTMLDivElement) {
  const children = Array.from(el.children) as HTMLElement[];
  children.forEach((child) => {
    const lineText = child.innerText.replace(/\n$/, "");
    if (!lineText.trim()) { child.style.color = ""; return; }
    child.style.color = isLineBlue(lineText) ? "#3b82f6" : "";
  });
}
function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildHtml(lines: string[]) {
  if (lines.length === 0) return "<div><br></div>";
  return lines.map((l) => {
    const style = l.trim() && isLineBlue(l) ? ' style="color:#3b82f6"' : '';
    return `<div${style}>${l ? escapeHtml(l) : "<br>"}</div>`;
  }).join("");
}
function extractLines(el: HTMLDivElement): string {
  const children = Array.from(el.children) as HTMLElement[];
  if (children.length === 0) return "";
  return children.map((c) => c.innerText.replace(/\n$/, "")).join("\n");
}
const LEADING_BULLET_RE = /^\s*(?:\(\s*\d+\s*\)|\[\s*\d+\s*\]|\{\s*\d+\s*\}|\d+\s*[.)])\s*/;
function stripLeadingBullet(line: string): string {
  let out = line;
  while (LEADING_BULLET_RE.test(out)) {
    out = out.replace(LEADING_BULLET_RE, "");
  }
  return out;
}
function removeEmDash(text: string): string {
  return text.replace(/—/g, "");
}
function normalizePastedLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => removeEmDash(stripLeadingBullet(line.trim()).trim()).trim())
    .filter(Boolean);
}
function copyOriginalSelectionWithNumbers(e: ReactClipboardEvent<HTMLElement>, startLine: number) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const editor = e.currentTarget;
  if (!editor.contains(range.commonAncestorContainer)) return;
  const children = Array.from(editor.children) as HTMLElement[];
  const parts: string[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!range.intersectsNode(child)) continue;
    const childRange = document.createRange();
    childRange.selectNodeContents(child);
    if (child === range.startContainer || child.contains(range.startContainer)) {
      try { childRange.setStart(range.startContainer, range.startOffset); } catch {}
    }
    if (child === range.endContainer || child.contains(range.endContainer)) {
      try { childRange.setEnd(range.endContainer, range.endOffset); } catch {}
    }
    const text = childRange.toString();
    parts.push(`${startLine + i}. ${text}`);
  }
  if (parts.length === 0) return;
  e.clipboardData.setData("text/plain", parts.join("\n"));
  e.preventDefault();
}
interface LineEditorProps {
  editorKey: string; value: string;
  onChange: (v: string) => void;
  placeholder: string;
  divRef: (el: HTMLDivElement | null) => void;
  onCopy?: (e: ReactClipboardEvent<HTMLDivElement>) => void;
}
function LineEditor({ editorKey, value, onChange, placeholder, divRef, onCopy }: LineEditorProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const internalChange = useRef(false);
  useEffect(() => {
    if (internalChange.current) { internalChange.current = false; return; }
    const el = innerRef.current;
    if (!el) return;
    const newHtml = buildHtml(value.split("\n"));
    if (el.innerHTML !== newHtml) el.innerHTML = newHtml;
    applyPtuHighlighting(el);
  }, [value, editorKey]);
  const handleInput = () => {
    if (!innerRef.current) return;
    internalChange.current = true;
    const raw = extractLines(innerRef.current);
    const cleaned = removeEmDash(raw);
    if (cleaned !== raw) {
      const cleanedLines = cleaned.split("\n");
      const sel = window.getSelection();
      let cursorLineIdx = -1;
      let cursorOffset = 0;
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        let node: Node = range.startContainer;
        while (node.parentNode && node.parentNode !== innerRef.current) node = node.parentNode;
        cursorLineIdx = Array.from(innerRef.current.children).indexOf(node as Element);
        cursorOffset = range.startOffset;
      }
      innerRef.current.innerHTML = buildHtml(cleanedLines);
      applyPtuHighlighting(innerRef.current);
      const targetEl = innerRef.current.children[Math.max(0, cursorLineIdx)] as HTMLElement | undefined;
      if (targetEl) {
        const newSel = window.getSelection();
        const newRange = document.createRange();
        const textNode = targetEl.firstChild;
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          const safeOffset = Math.min(cursorOffset, (textNode as Text).length);
          newRange.setStart(textNode, safeOffset);
          newRange.collapse(true);
        } else {
          newRange.selectNodeContents(targetEl);
          newRange.collapse(false);
        }
        newSel?.removeAllRanges();
        newSel?.addRange(newRange);
      }
      onChange(cleaned);
    } else {
      onChange(raw);
      applyPtuHighlighting(innerRef.current);
    }
  };
  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertHTML", false, "<div><br></div>"); } };
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
    if (existingLines.length === 0 || (existingLines.length === 1 && existingLines[0] === "")) { newLines = pastedLines; }
    else if (insertAfterIdx === -1) { newLines = [...existingLines, ...pastedLines]; }
    else { newLines = [...existingLines.slice(0, insertAfterIdx + 1), ...pastedLines, ...existingLines.slice(insertAfterIdx + 1)]; }
    innerRef.current.innerHTML = buildHtml(newLines);
    applyPtuHighlighting(innerRef.current);
    const targetIdx = insertAfterIdx === -1 ? newLines.length - 1 : insertAfterIdx + pastedLines.length;
    const targetEl = innerRef.current.children[Math.min(targetIdx, newLines.length - 1)] as HTMLElement | undefined;
    if (targetEl) {
      const newSel = window.getSelection(); const newRange = document.createRange();
      newRange.selectNodeContents(targetEl); newRange.collapse(false);
      newSel?.removeAllRanges(); newSel?.addRange(newRange);
    }
    internalChange.current = true;
    onChange(extractLines(innerRef.current));
  };
  return (
    <div
      ref={(el) => { innerRef.current = el; divRef(el); if (el && el.innerHTML === "") { el.innerHTML = buildHtml(value.split("\n")); applyPtuHighlighting(el); } }}
      key={editorKey} contentEditable suppressContentEditableWarning
      data-line-editor data-placeholder={placeholder}
      onInput={handleInput} onKeyDown={handleKeyDown} onPaste={handlePaste} onCopy={onCopy}
      className="flex-1 min-h-0 overflow-y-auto outline-none px-5 pt-4 pb-14 text-sm text-foreground"
      style={{ minHeight: 0, scrollPaddingBottom: "3.5rem" }}
    />
  );
}
interface TaskTitleCellProps { value: string; made?: boolean; isRtl?: boolean; onCopy: () => void; }
function TaskTitleCell({ value, made, isRtl, onCopy }: TaskTitleCellProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {hovered && value && (
        <div className="absolute -top-8 left-0 z-30 flex items-center gap-0.5 bg-card border border-border rounded-md shadow-md px-1 py-0.5">
          <button type="button" onMouseDown={e => { e.preventDefault(); onCopy(); }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" tabIndex={-1}>
            <Copy size={11} /><span>Copy</span>
          </button>
        </div>
      )}
      <div dir={isRtl ? "rtl" : undefined}
        className={`w-full px-2.5 py-2 text-sm rounded-lg border leading-snug min-h-[36px] ${isRtl ? "text-right" : ""} ${made ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200" : "border-border bg-background text-foreground"} ${value ? "" : "text-muted-foreground/40 italic"}`}>
        {value || "—"}
      </div>
    </div>
  );
}

interface TaskCellInputProps { value: string; made?: boolean; isRtl?: boolean; placeholder?: string; onChange: (v: string) => void; onCopy: () => void; onPaste: () => void; onClear: () => void; }
function TaskCellInput({ value, made, isRtl, placeholder, onChange, onCopy, onPaste, onClear }: TaskCellInputProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);
  return (
    <div className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {(hovered || focused) && (
        <div className="absolute -top-8 left-0 z-30 flex items-center gap-0.5 bg-card border border-border rounded-md shadow-md px-1 py-0.5">
          <button type="button" onMouseDown={e => { e.preventDefault(); onCopy(); }}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" tabIndex={-1}>
            <Copy size={11} /><span>Copy</span>
          </button>
          {!made && (<>
            <div className="w-px h-3 bg-border" />
            <button type="button" onMouseDown={e => { e.preventDefault(); onPaste(); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" tabIndex={-1}>
              <ClipboardPaste size={11} /><span>Paste</span>
            </button>
            <div className="w-px h-3 bg-border" />
            <button type="button" onMouseDown={e => { e.preventDefault(); onClear(); }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-muted-foreground hover:text-red-500 hover:bg-muted transition-colors" tabIndex={-1}>
              <X size={11} /><span>Clear</span>
            </button>
          </>)}
        </div>
      )}
      <textarea ref={textareaRef} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} disabled={made} dir={isRtl ? "rtl" : undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        rows={1}
        className={`w-full px-2.5 py-2 text-sm rounded-lg border bg-background text-foreground outline-none resize-none leading-snug min-h-[36px] overflow-hidden transition-colors ${isRtl ? "text-right" : ""} ${made ? "opacity-50 line-through border-border cursor-not-allowed" : "border-emerald-200 dark:border-emerald-800 focus:border-emerald-400 dark:focus:border-emerald-600"}`} />
    </div>
  );
}

interface SrtNoteTabProps {
  incomingText?: string;
  incomingName?: string;
  incomingKey?: number;
  onRunToAiAudio?: (lines: string[], label?: string) => void;
  onAutoRunAll?: (langs: { label: string; lines: string[] }[]) => void;
  onAutoRun2?: (langs: { label: string; lines: string[] }[]) => void;
  onSendToSrtMaker?: (text: string, label: string) => void;
}
export default function SrtNoteTab({ incomingText, incomingName, incomingKey, onRunToAiAudio, onAutoRunAll, onAutoRun2, onSendToSrtMaker }: SrtNoteTabProps = {}) {
  const initialStateRef = useRef<SavedState | null>(null);
  if (initialStateRef.current === null) initialStateRef.current = readSavedState();
  const initialState = initialStateRef.current;
  const [projects, setProjects] = useState<Project[]>(initialState.projects);
  const [activeId, setActiveId] = useState(initialState.activeId);
  const [search, setSearch] = useState("");
  const [findText, setFindText] = useState<{ [k: string]: string }>({});
  const [showFind, setShowFind] = useState<{ [k: string]: boolean }>({});
  const [splitView, setSplitView] = useState<{ [k: string]: boolean }>({});
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const darkMode = initialState.darkMode;
  const [copiedChunks, setCopiedChunks] = useState<{ [key: string]: boolean }>(initialState.copiedChunks);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashDragOver, setTrashDragOver] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskTitleMode, setTaskTitleMode] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [taskTrashOpen, setTaskTrashOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isAutoRun2Running, setIsAutoRun2Running] = useState(false);

  useEffect(() => {
    const onComplete = () => setIsAutoRunning(false);
    window.addEventListener("srt-tools:autorun-complete", onComplete);
    return () => window.removeEventListener("srt-tools:autorun-complete", onComplete);
  }, []);

  useEffect(() => {
    const onComplete = () => setIsAutoRun2Running(false);
    window.addEventListener("srt-tools:autorun2-complete", onComplete);
    return () => window.removeEventListener("srt-tools:autorun2-complete", onComplete);
  }, []);
  useEffect(() => {
    if (!openMenu) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-card-menu]")) setOpenMenu(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openMenu]);
  const editorRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<{ [k: number]: string[] }>({});
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const scrollToCard = useCallback((idx: number) => {
    const container = scrollContainerRef.current;
    const card = cardRefs.current[idx];
    if (!container || !card) return;
    const containerRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const scrollLeft = container.scrollLeft + (cardRect.left - containerRect.left) - 16;
    container.scrollTo({ left: scrollLeft, behavior: "smooth" });
  }, []);
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects, activeId, darkMode, copiedChunks }));
  }, [projects, activeId, darkMode, copiedChunks]);
  useEffect(() => {
    const visible = projects.filter((p) => !p.trashed);
    if (visible.length > 0 && !projects.some((project) => project.id === activeId)) setActiveId(visible[0].id);
  }, [projects, activeId]);
  const activeProject = projects.find((p) => p.id === activeId) ?? projects.find((p) => !p.trashed) ?? projects[0];
  const filtered = projects.filter((p) => !p.trashed && p.name.toLowerCase().includes(search.toLowerCase()));
  const trashedProjects = projects.filter((p) => p.trashed);
  useEffect(() => { setEditingName(false); }, [activeId]);
  function createProject() {
    const newId = Date.now().toString();
    setProjects((prev) => [{ id: newId, name: `New Project ${prev.length + 1}`, updatedAt: "Just now", langs: DEFAULT_LANGS.map((l) => ({ ...l })) }, ...prev]);
    setActiveId(newId);
  }
  const lastIncomingKeyRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (incomingKey === undefined) return;
    if (incomingKey === lastIncomingKeyRef.current) return;
    if (!incomingText || !incomingText.trim()) return;
    lastIncomingKeyRef.current = incomingKey;
    const newId = Date.now().toString();
    setProjects((prev) => {
      const baseName = (incomingName && incomingName.trim()) || `New Project ${prev.length + 1}`;
      const langs = DEFAULT_LANGS.map((l) => ({ ...l }));
      langs[0] = { ...langs[0], content: incomingText };
      return [{ id: newId, name: baseName, updatedAt: "Just now", langs }, ...prev];
    });
    setActiveId(newId);
  }, [incomingKey, incomingText, incomingName]);
  function updateContent(langIdx: number, value: string) {
    setProjects((prev) => prev.map((p) => {
      if (p.id !== activeId) return p;
      const langs = [...p.langs];
      const old = langs[langIdx].content;
      historyRef.current[langIdx] = historyRef.current[langIdx] ?? [];
      historyRef.current[langIdx].push(old);
      langs[langIdx] = { ...langs[langIdx], content: value };
      return { ...p, langs, updatedAt: "Just now" };
    }));
  }
  const handleUndo = useCallback((idx: number) => {
    const hist = historyRef.current[idx];
    if (!hist || hist.length === 0) return;
    const prev = hist.pop()!;
    setProjects((p) => p.map((proj) => { if (proj.id !== activeId) return proj; const langs = [...proj.langs]; langs[idx] = { ...langs[idx], content: prev }; return { ...proj, langs }; }));
  }, [activeId]);
  const handleCopy = useCallback((idx: number) => {
    const lang = activeProject?.langs[idx];
    const content = lang?.content ?? "";
    const text = lang?.label === "Original"
      ? content.split("\n").map((line, i) => `${i + 1}. ${line}`).join("\n")
      : content;
    navigator.clipboard.writeText(text).catch(() => {});
  }, [activeProject]);
  const handleClear = useCallback((idx: number) => { updateContent(idx, ""); }, [activeId]);
  const handlePasteFromClipboard = useCallback(async (idx: number) => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const pastedLines = normalizePastedLines(text);
      if (pastedLines.length === 0) return;
      const existing = activeProject?.langs[idx]?.content ?? "";
      const existingLines = existing === "" ? [] : existing.split("\n").filter((l) => l.trim() !== "");
      const newLines = [...existingLines, ...pastedLines];
      updateContent(idx, newLines.join("\n"));
      requestAnimationFrame(() => {
        const el = editorRefs.current[idx];
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch {
      // clipboard read failed silently
    }
  }, [activeProject, activeId]);
  const handleEdit = useCallback((idx: number) => { editorRefs.current[idx]?.focus(); }, []);
  const handleFind = useCallback((idx: number) => { const k = `${activeId}:${idx}`; setShowFind((prev) => ({ ...prev, [k]: !prev[k] })); }, [activeId]);
  const handleSplit = useCallback((idx: number) => { const k = `${activeId}:${idx}`; setSplitView((prev) => ({ ...prev, [k]: !prev[k] })); }, [activeId]);
  const handleExport = useCallback(() => {
    if (!activeProject) return;
    const content = activeProject.langs.map((l) => `=== ${l.label} ===\n${l.content}`).join("\n\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${activeProject.name}.txt`; a.click();
    URL.revokeObjectURL(url);
  }, [activeProject]);
  const handleDelete = useCallback(() => {
    setProjects((prev) => {
      const updated = prev.map((p) => p.id === activeId ? { ...p, trashed: true } : p);
      const next = updated.find((p) => !p.trashed);
      setActiveId(next?.id ?? "");
      return updated;
    });
  }, [activeId]);
  const moveToTrash = useCallback((id: string) => {
    setProjects((prev) => {
      const updated = prev.map((p) => p.id === id ? { ...p, trashed: true } : p);
      if (id === activeId) {
        const next = updated.find((p) => !p.trashed);
        setActiveId(next?.id ?? "");
      }
      return updated;
    });
  }, [activeId]);
  const restoreFromTrash = useCallback((id: string) => {
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, trashed: false } : p));
  }, []);
  const deleteForever = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  }, []);
  const numLangs = activeProject?.langs.length ?? 3;
  const activeTasks: TaskRow[] = (activeProject?.tasks ?? []).filter(t => !t.trashed);
  const activeTaskTrash: TaskRow[] = (activeProject?.tasks ?? []).filter(t => !!t.trashed);
  const updateTasks = useCallback((updater: (prev: TaskRow[]) => TaskRow[]) => {
    setProjects((prev) => prev.map((p) => p.id === activeId ? { ...p, tasks: updater(p.tasks ?? []), updatedAt: "Just now" } : p));
  }, [activeId]);
  const addTaskRow = useCallback(() => {
    updateTasks((prev) => {
      const activeCount = prev.filter(t => !t.trashed).length;
      return [...prev, { id: generateTaskId(), number: String(activeCount + 1).padStart(3, "0"), values: Array(numLangs).fill(""), made: false }];
    });
  }, [updateTasks, numLangs]);
  const toggleTaskMade = useCallback((id: string) => {
    updateTasks((prev) => prev.map(t => t.id === id ? { ...t, made: !t.made } : t));
  }, [updateTasks]);
  const updateTaskValue = useCallback((id: string, col: number, value: string) => {
    updateTasks((prev) => prev.map((t) => {
      if (t.id !== id) return t;
      const values = [...t.values];
      while (values.length < numLangs) values.push("");
      values[col] = value;
      return { ...t, values };
    }));
  }, [updateTasks, numLangs]);
  const moveTaskToTrash = useCallback((id: string) => {
    updateTasks((prev) => {
      const updated = prev.map(t => t.id === id ? { ...t, trashed: true } : t);
      let n = 0;
      return updated.map(t => t.trashed ? t : { ...t, number: String(++n).padStart(3, "0") });
    });
  }, [updateTasks]);
  const recoverTask = useCallback((id: string) => {
    updateTasks((prev) => {
      const activeCount = prev.filter(t => !t.trashed).length;
      return prev.map(t => t.id === id ? { ...t, trashed: false, number: String(activeCount + 1).padStart(3, "0") } : t);
    });
  }, [updateTasks]);
  const deleteTaskForever = useCallback((id: string) => {
    updateTasks((prev) => prev.filter(t => t.id !== id));
  }, [updateTasks]);
  const emptyTaskTrash = useCallback(() => {
    updateTasks((prev) => prev.filter(t => !t.trashed));
  }, [updateTasks]);
  const copyTaskCell = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  }, []);
  const pasteTaskCell = useCallback(async (id: string, col: number) => {
    try { const text = await navigator.clipboard.readText(); updateTaskValue(id, col, text); } catch {}
  }, [updateTaskValue]);
  const filteredTaskRows = taskSearch.trim()
    ? activeTasks.filter(t => {
        const q = taskSearch.trim().toLowerCase();
        return t.number.includes(q) || t.values.some(v => v.toLowerCase().includes(q));
      })
    : activeTasks;
  const startEditingName = useCallback(() => { setNameInput(activeProject?.name ?? ""); setEditingName(true); setTimeout(() => nameInputRef.current?.select(), 0); }, [activeProject]);
  const saveName = useCallback(() => {
    const trimmed = nameInput.trim();
    if (trimmed) setProjects((prev) => prev.map((p) => p.id === activeId ? { ...p, name: trimmed, updatedAt: "Just now" } : p));
    setEditingName(false);
  }, [nameInput, activeId]);
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {sidebarHidden && (
        <button
          onClick={() => setSidebarHidden(false)}
          title="Show sidebar"
          className="absolute top-3 left-3 z-30 p-1.5 rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shadow-sm"
        >
          <PanelLeftOpen size={16} />
        </button>
      )}
      {!sidebarHidden && (
      <aside className="w-64 shrink-0 flex flex-col h-full bg-[hsl(var(--sidebar))] border-r border-[hsl(var(--sidebar-border))]">
        <div className="px-4 pt-5 pb-3 border-b border-[hsl(var(--sidebar-border))]">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setTaskOpen(true)} title="Open Task Note"
              className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-[hsl(var(--sidebar-accent))] transition-colors">
              <span className="text-lg leading-none">📑</span>
              <span className="font-semibold text-sm text-[hsl(var(--sidebar-foreground))] tracking-wide">Task</span>
            </button>
            <button onClick={() => setSidebarHidden(true)} title="Hide sidebar"
              className="p-1.5 rounded-md bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-foreground))] hover:opacity-80 transition-opacity">
              <Menu size={14} />
            </button>
          </div>
          <button onClick={createProject} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-[hsl(var(--sidebar-primary))] text-[hsl(var(--sidebar-primary-foreground))] text-sm font-medium hover:opacity-90 transition-opacity">
            <Plus size={14} />New Project
          </button>
        </div>
        <div className="px-3 py-3 border-b border-[hsl(var(--sidebar-border))]">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[hsl(var(--sidebar-accent))]">
            <Search size={13} className="text-[hsl(var(--sidebar-foreground))] opacity-50 shrink-0" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects..."
              className="bg-transparent text-sm text-[hsl(var(--sidebar-foreground))] placeholder:opacity-40 w-full outline-none" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-3 px-3 flex flex-col gap-2">
          {filtered.length === 0 && <p className="text-xs text-[hsl(var(--sidebar-foreground))] opacity-40 text-center mt-6">No projects found</p>}
          {filtered.map((project) => (
            <button key={project.id} onClick={() => setActiveId(project.id)}
              draggable
              onDragStart={(e) => { setDraggingId(project.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", project.id); }}
              onDragEnd={() => { setDraggingId(null); setTrashDragOver(false); }}
              className={`w-full text-left rounded-lg border transition-all p-3 cursor-grab active:cursor-grabbing ${draggingId === project.id ? "opacity-40" : ""} ${activeId === project.id ? "bg-[hsl(var(--sidebar-accent))] border-[hsl(var(--sidebar-primary)/0.5)] text-[hsl(var(--sidebar-accent-foreground))]" : "bg-[hsl(var(--sidebar-accent)/0.4)] border-[hsl(var(--sidebar-border))] text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent)/0.7)]"}`}>
              <div className="flex items-start gap-2">
                <FileText size={13} className="shrink-0 mt-0.5 opacity-60" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-snug break-words whitespace-normal">{project.name}</p>
                  <p className="text-[10px] opacity-40 mt-1">{project.updatedAt}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="shrink-0 border-t border-[hsl(var(--sidebar-border))] p-3">
          <div
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setTrashDragOver(true); }}
            onDragEnter={(e) => { e.preventDefault(); setTrashDragOver(true); }}
            onDragLeave={() => setTrashDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain") || draggingId;
              if (id) { moveToTrash(id); setTrashOpen(true); }
              setTrashDragOver(false); setDraggingId(null);
            }}
            className={`rounded-lg border-2 border-dashed transition-colors ${trashDragOver ? "border-destructive bg-destructive/10" : "border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-accent)/0.3)]"}`}>
            <button onClick={() => setTrashOpen((o) => !o)} className="w-full flex items-center gap-2 px-3 py-2 text-[hsl(var(--sidebar-foreground))]">
              {trashOpen ? <ChevronDown size={12} className="opacity-60" /> : <ChevronRight size={12} className="opacity-60" />}
              {trashOpen ? <FolderOpen size={14} className={trashDragOver ? "text-destructive" : "opacity-70"} /> : <Folder size={14} className={trashDragOver ? "text-destructive" : "opacity-70"} />}
              <span className="text-xs font-semibold tracking-wide flex-1 text-left">Trash</span>
              <span className="text-[10px] opacity-50 bg-[hsl(var(--sidebar-accent))] px-1.5 py-0.5 rounded-full">{trashedProjects.length}</span>
            </button>
            {trashOpen && (
              <div className="px-2 pb-2 flex flex-col gap-1 max-h-48 overflow-y-auto">
                {trashedProjects.length === 0 ? (
                  <p className="text-[10px] text-center opacity-40 py-2 text-[hsl(var(--sidebar-foreground))]">
                    {trashDragOver ? "Drop here to move to trash" : "Drag projects here"}
                  </p>
                ) : (
                  trashedProjects.map((project) => (
                    <div key={project.id} className="group flex items-center gap-1 px-2 py-1.5 rounded-md bg-[hsl(var(--sidebar-accent)/0.5)] text-[hsl(var(--sidebar-foreground))]">
                      <FileText size={11} className="shrink-0 opacity-50" />
                      <span className="text-[11px] flex-1 truncate opacity-70" title={project.name}>{project.name}</span>
                      <button onClick={() => restoreFromTrash(project.id)} title="Restore"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[hsl(var(--sidebar-accent))] text-muted-foreground hover:text-foreground transition-opacity">
                        <ArchiveRestore size={11} />
                      </button>
                      <button onClick={() => deleteForever(project.id)} title="Delete forever"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-opacity">
                        <X size={11} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
      )}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="shrink-0 px-6 py-4 border-b border-border bg-card flex items-center justify-between gap-4">
          <div className="shrink-0">
            {editingName ? (
              <input ref={nameInputRef} value={nameInput} onChange={(e) => setNameInput(e.target.value)}
                onBlur={saveName} onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
                className="text-base font-semibold text-foreground bg-muted border border-primary rounded px-2 py-0.5 outline-none w-72" autoFocus />
            ) : (
              <h1 className="text-base font-semibold text-foreground cursor-pointer hover:text-primary transition-colors" onClick={startEditingName} title="Click to rename">
                {activeProject?.name}
              </h1>
            )}
            <p className="text-xs text-muted-foreground mt-0.5">Updated {activeProject?.updatedAt} · Auto-saved locally</p>
          </div>
          <div className="flex items-center gap-2 flex-1 justify-center flex-wrap">
            {(activeProject?.langs ?? []).map((lang, idx) => {
              const lineCount = lang.content === "" ? 0 : lang.content.split("\n").filter((l) => l.trim() !== "").length;
              const origCount = (activeProject?.langs[0]?.content === "" ? 0 : (activeProject?.langs[0]?.content.split("\n").filter((l) => l.trim() !== "").length ?? 0));
              const isMismatch = idx !== 0 && lineCount !== origCount;
              const letter = lang.label.charAt(0).toUpperCase();
              return (
                <button
                  key={idx}
                  onClick={() => scrollToCard(idx)}
                  title={`${lang.label}: ${lineCount} lines${isMismatch ? ` (Original has ${origCount})` : ""}`}
                  className={`flex flex-col items-center justify-center rounded border transition-all cursor-pointer shrink-0 hover:scale-105 active:scale-95 shadow-sm ${
                    isMismatch
                      ? "border-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50"
                      : "border-border bg-muted/60 hover:bg-muted"
                  }`}
                  style={{ width: "30px", height: "42px" }}
                >
                  <span className={`font-bold leading-none ${isMismatch ? "text-red-500" : "text-primary"}`} style={{ fontSize: "13px" }}>{letter}</span>
                  <span className={`font-semibold leading-none mt-1 ${isMismatch ? "text-red-500" : "text-foreground"}`} style={{ fontSize: "11px" }}>{lineCount}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onAutoRunAll && (
              <button
                disabled={isAutoRunning || isAutoRun2Running}
                onClick={() => {
                  const langs = activeProject?.langs ?? [];
                  const toRun = langs
                    .filter((l) => l.label !== "Original")
                    .map((l) => ({
                      label: l.label,
                      lines: l.content.split("\n").map((x) => x.trim()).filter(Boolean),
                    }))
                    .filter((l) => l.lines.length > 0);
                  if (toRun.length === 0) return;
                  setIsAutoRunning(true);
                  onAutoRunAll(toRun);
                }}
                title="Auto Run All: runs each language through AI Audio → Audio Splitter → ZIP sequentially"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isAutoRunning
                    ? "bg-violet-100 text-violet-500 dark:bg-violet-950 cursor-not-allowed opacity-70"
                    : (isAutoRun2Running ? "opacity-40 cursor-not-allowed bg-violet-600 text-white" : "bg-violet-600 text-white hover:bg-violet-700 shadow-sm")
                }`}
              >
                {isAutoRunning ? (
                  <><Loader2 size={12} className="animate-spin" />Running…</>
                ) : (
                  <><Zap size={12} />Auto Run All</>
                )}
              </button>
            )}
            {onAutoRun2 && (
              <button
                disabled={isAutoRun2Running || isAutoRunning}
                onClick={() => {
                  const langs = activeProject?.langs ?? [];
                  const toRun = langs
                    .filter((l) => l.label !== "Original")
                    .map((l) => ({
                      label: l.label,
                      lines: l.content.split("\n").map((x) => x.trim()).filter(Boolean),
                    }))
                    .filter((l) => l.lines.length > 0);
                  if (toRun.length === 0) return;
                  setIsAutoRun2Running(true);
                  onAutoRun2(toRun);
                }}
                title="Auto Run 2: AI Audio → Splitter → ZIP → Speed+- → Download ZIP (with video)"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  isAutoRun2Running
                    ? "bg-orange-100 text-orange-500 dark:bg-orange-950 cursor-not-allowed opacity-70"
                    : (isAutoRunning ? "opacity-40 cursor-not-allowed bg-orange-500 text-white" : "bg-orange-500 text-white hover:bg-orange-600 shadow-sm")
                }`}
              >
                {isAutoRun2Running ? (
                  <><Loader2 size={12} className="animate-spin" />Running…</>
                ) : (
                  <><Zap size={12} />Auto Run 2</>
                )}
              </button>
            )}
            <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-muted transition-colors">
              <Download size={12} />Export
            </button>
            <button onClick={handleDelete} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-destructive text-xs text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 size={12} />Delete
            </button>
          </div>
        </header>
        {(() => {
          const langs = activeProject?.langs ?? [];
          const allSplit = langs.length > 0 && langs.every((_, i) => splitView[`${activeId}:${i}`]);
          const chunkSizeFor = (langIdx: number) => (langs[langIdx]?.label === "Original" ? 40 : 20);
          const renderChunkCard = (chunk: string[], chunkIdx: number, langIdx: number) => {
            const startLine = chunkIdx * chunkSizeFor(langIdx) + 1;
            const endLine = chunk.length > 0 ? startLine + chunk.length - 1 : startLine;
            const copyKey = `${activeId}:${langIdx}:${chunkIdx}`;
            const isCopied = !!copiedChunks[copyKey];
            const handleChunkCopy = () => {
              if (isCopied) {
                setCopiedChunks((prev) => { const n = { ...prev }; delete n[copyKey]; return n; });
                return;
              }
              const isOriginal = langs[langIdx]?.label === "Original";
              const text = isOriginal
                ? chunk.map((line, i) => `${startLine + i}. ${line}`).join("\n")
                : chunk.join("\n");
              navigator.clipboard.writeText(text).catch(() => {});
              setCopiedChunks((prev) => ({ ...prev, [copyKey]: true }));
            };
            return (
              <div className={`flex flex-col rounded-lg border-2 shadow-sm overflow-hidden transition-colors ${isCopied ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 shadow-emerald-200 dark:shadow-emerald-900/40" : "border-border bg-background"}`} style={{ height: "140px" }}>
                <div className={`shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b ${isCopied ? "border-emerald-500/40 bg-emerald-100/60 dark:bg-emerald-900/30" : "border-border bg-muted/60"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isCopied ? "text-emerald-700 dark:text-emerald-300" : "text-primary"}`}>
                      {chunk.length === 0 ? `${startLine}` : `${startLine}–${endLine}`}
                    </span>
                    <span className={`text-[10px] ${isCopied ? "text-emerald-700/80 dark:text-emerald-300/80" : "text-muted-foreground"}`}>{chunk.length}L</span>
                    {isCopied && <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">✓ Copied</span>}
                  </div>
                  <button onClick={handleChunkCopy} title={isCopied ? "Copy again" : "Copy this section"}
                    className={`p-1 rounded transition-colors ${isCopied ? "text-emerald-700 hover:bg-emerald-200 dark:text-emerald-300 dark:hover:bg-emerald-900/50" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                    <Copy size={12} />
                  </button>
                </div>
                <div
                  data-line-editor
                  className="flex-1 min-h-0 overflow-y-auto px-4 py-3 text-sm text-foreground"
                  style={{ counterReset: `line-num ${startLine - 1}` }}
                  onCopy={(e) => {
                    if (langs[langIdx]?.label === "Original") copyOriginalSelectionWithNumbers(e, startLine);
                  }}
                >
                  {chunk.length === 0 ? (
                    <div className="opacity-25">—</div>
                  ) : (
                    chunk.map((line, lineIdx) => (
                      <div key={lineIdx}>{line || <span className="opacity-25">—</span>}</div>
                    ))
                  )}
                </div>
              </div>
            );
          };
          const renderLangHeader = (lang: { label: string; content: string }, idx: number) => {
            const lineCount = lang.content === "" ? 0 : lang.content.split("\n").length;
            const ptuCount = (lang.content.match(/[.?।]/g) || []).length;
            return (
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border bg-card rounded-t-xl">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wider">{lang.label}</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{lineCount}L</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ptuCount !== lineCount ? "text-red-500 bg-red-100 dark:bg-red-950" : "text-muted-foreground bg-muted"}`}>{ptuCount}P</span>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {onSendToSrtMaker && (
                    <button
                      title="Send to SRT Maker"
                      onClick={() => {
                        const text = activeProject?.langs[idx]?.content ?? "";
                        if (!text.trim()) return;
                        onSendToSrtMaker(text, lang.label);
                      }}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <SendToBack size={14} />
                    </button>
                  )}
                  <button
                    title="Paste from clipboard (append to end)"
                    onClick={() => handlePasteFromClipboard(idx)}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ClipboardPaste size={14} />
                  </button>
                  <button
                    title="Run: send to Ai Audio, split, and load pool"
                    onClick={() => {
                      const text = activeProject?.langs[idx]?.content ?? "";
                      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
                      if (lines.length === 0) return;
                      onRunToAiAudio?.(lines, lang.label);
                    }}
                    className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Play size={14} />
                  </button>
                  <div className="relative" data-card-menu>
                    <button
                      onClick={() => {
                        const key = `${activeId}:${idx}`;
                        setOpenMenu((cur) => (cur === key ? null : key));
                      }}
                      title="More actions"
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <MoreVertical size={14} />
                    </button>
                    {openMenu === `${activeId}:${idx}` && (
                      <div className="absolute right-0 top-full mt-1 z-30 flex items-center gap-1 rounded-md border border-border bg-popover shadow-md p-1">
                        <button
                          onClick={() => { handleCopy(idx); setOpenMenu(null); }}
                          title="Copy all text"
                          className="p-1.5 rounded-md text-foreground hover:bg-muted transition-colors"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => { handleSplit(idx); setOpenMenu(null); }}
                          title="Split into sub-cards"
                          className={`p-1.5 rounded-md transition-colors hover:bg-muted ${splitView[`${activeId}:${idx}`] ? "text-primary" : "text-foreground"}`}
                        >
                          <Scissors size={16} />
                        </button>
                        <button
                          onClick={() => { handleUndo(idx); setOpenMenu(null); }}
                          title="Undo"
                          className="p-1.5 rounded-md text-foreground hover:bg-muted transition-colors"
                        >
                          <RotateCcw size={16} />
                        </button>
                        <button
                          onClick={() => { handleClear(idx); setOpenMenu(null); }}
                          title="Clear"
                          className="p-1.5 rounded-md text-destructive hover:bg-muted transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          };

          if (allSplit) {
            const langChunks = langs.map((lang, langIdx) => {
              const lines = lang.content === "" ? [] : lang.content.split("\n");
              const size = chunkSizeFor(langIdx);
              const chunks: string[][] = [];
              for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
              if (chunks.length === 0) chunks.push([]);
              return chunks;
            });
            const maxChunks = Math.max(...langChunks.map((c) => c.length));
            return (
              <div className="flex-1 min-h-0 flex flex-col overflow-x-auto overflow-y-hidden p-4 gap-3">
                <div className="grid gap-4 shrink-0" style={{ gridTemplateColumns: `repeat(${langs.length}, minmax(280px, 1fr))` }}>
                  {langs.map((lang, idx) => (
                    <div key={idx} className="rounded-xl border border-border overflow-hidden">
                      {renderLangHeader(lang, idx)}
                      {showFind[`${activeId}:${idx}`] && (
                        <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/50">
                          <ScanSearch size={13} className="text-muted-foreground shrink-0" />
                          <input autoFocus type="text" value={findText[`${activeId}:${idx}`] ?? ""} onChange={(e) => setFindText((prev) => ({ ...prev, [`${activeId}:${idx}`]: e.target.value }))}
                            placeholder="Find in text..." className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground" />
                          <button onClick={() => setShowFind((prev) => ({ ...prev, [`${activeId}:${idx}`]: false }))} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  <div className="grid gap-4 auto-rows-min" style={{ gridTemplateColumns: `repeat(${langs.length}, minmax(280px, 1fr))` }}>
                    {Array.from({ length: maxChunks }).flatMap((_, chunkIdx) =>
                      langs.map((_, langIdx) => (
                        <div key={`${chunkIdx}-${langIdx}`} className="min-w-0">
                          {renderChunkCard(langChunks[langIdx][chunkIdx] ?? [], chunkIdx, langIdx)}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div ref={scrollContainerRef} className="flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden p-4 gap-4">
              {langs.map((lang, idx) => (
                <div key={idx} ref={(el) => { cardRefs.current[idx] = el; }} className="flex-1 min-h-0 flex flex-col rounded-xl border border-border bg-card shadow-sm overflow-hidden basis-[340px] min-w-[340px]">
                  {renderLangHeader(lang, idx)}
                  {showFind[`${activeId}:${idx}`] && (
                    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/50">
                      <ScanSearch size={13} className="text-muted-foreground shrink-0" />
                      <input autoFocus type="text" value={findText[`${activeId}:${idx}`] ?? ""} onChange={(e) => setFindText((prev) => ({ ...prev, [`${activeId}:${idx}`]: e.target.value }))}
                        placeholder="Find in text..." className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground" />
                      <button onClick={() => setShowFind((prev) => ({ ...prev, [`${activeId}:${idx}`]: false }))} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
                    </div>
                  )}
                  {splitView[`${activeId}:${idx}`] ? (
                    <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
                      {(() => {
                        const lines = lang.content === "" ? [] : lang.content.split("\n");
                        const size = chunkSizeFor(idx);
                        const chunks: string[][] = [];
                        for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
                        if (chunks.length === 0) chunks.push([]);
                        return chunks.map((chunk, chunkIdx) => (
                          <div key={chunkIdx}>{renderChunkCard(chunk, chunkIdx, idx)}</div>
                        ));
                      })()}
                    </div>
                  ) : (
                    <LineEditor key={`${activeId}-${idx}`} editorKey={`${activeId}-${idx}`}
                      value={lang.content} onChange={(v) => updateContent(idx, v)}
                      placeholder={`Enter ${lang.label} subtitle text here...`}
                      divRef={(el) => { editorRefs.current[idx] = el; }}
                      onCopy={lang.label === "Original" ? (e) => copyOriginalSelectionWithNumbers(e, 1) : undefined} />
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </main>
      {taskOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => setTaskOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full max-w-7xl max-h-[95vh] h-[92vh] flex flex-col rounded-2xl border-2 border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-emerald-200 dark:border-emerald-800 bg-emerald-100/60 dark:bg-emerald-900/40">
              <span className="bg-emerald-600 text-white text-xs font-semibold px-2.5 py-1 rounded-md shrink-0">{activeTasks.filter(t => t.made).length} Made</span>
              <span className="bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs font-medium px-2.5 py-1 rounded-md shrink-0">{activeTasks.filter(t => !t.made).length} Pending</span>
              <h2 className="flex-1 text-center text-xl font-bold tracking-[0.3em] text-emerald-900 dark:text-emerald-100" style={{ fontFamily: "Georgia, serif" }}>TASK NOTE</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setTaskTitleMode(m => !m)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${taskTitleMode ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-600" : "bg-white dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-800"}`}>
                  {taskTitleMode ? <X size={12} /> : <Type size={12} />}
                  {taskTitleMode ? "Exit Title Mode" : "Title Mode"}
                </button>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" />
                  <input type="text" value={taskSearch} onChange={e => setTaskSearch(e.target.value)} placeholder="Search..."
                    className="pl-8 pr-6 py-1.5 text-xs rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-emerald-900 text-foreground outline-none focus:border-emerald-500 w-40" />
                  {taskSearch && <button onClick={() => setTaskSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-400 hover:text-emerald-700"><X size={10} /></button>}
                </div>
                <button onClick={() => setTaskOpen(false)} className="p-1.5 rounded-md hover:bg-emerald-200 dark:hover:bg-emerald-800 text-emerald-900 dark:text-emerald-100 transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>
            {/* Title Mode banner */}
            {taskTitleMode && (
              <div className="shrink-0 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 px-5 py-2 flex items-center justify-between">
                <span className="text-amber-800 dark:text-amber-200 text-xs font-medium">Title Mode ON — cells are read-only with formatted titles. Click any cell's Copy to copy.</span>
                <button onClick={() => setTaskTitleMode(false)} className="text-amber-700 dark:text-amber-300 text-xs font-semibold underline hover:no-underline">Exit</button>
              </div>
            )}
            {/* Table */}
            <div className="flex-1 overflow-auto">
              <table className="w-full table-fixed">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-emerald-100 dark:bg-emerald-900/60 border-b border-emerald-200 dark:border-emerald-800">
                    <th className="text-left px-3 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider w-14">No</th>
                    {(activeProject?.langs ?? []).map((lang, i) => (
                      <th key={i} className="text-center px-2 py-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">
                        {lang.label}
                      </th>
                    ))}
                    <th className="w-10 px-1 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-emerald-100 dark:divide-emerald-900/60">
                  {filteredTaskRows.length === 0 && (
                    <tr>
                      <td colSpan={(activeProject?.langs.length ?? 0) + 2} className="text-center py-14 text-emerald-600/50 dark:text-emerald-400/40 text-sm">
                        {taskSearch ? `No results for "${taskSearch}"` : "No tasks yet — click Add Row to get started"}
                      </td>
                    </tr>
                  )}
                  {filteredTaskRows.map((task) => (
                    <tr key={task.id} className={`group transition-colors ${task.made ? "bg-emerald-50/40 dark:bg-emerald-950/20" : "hover:bg-white dark:hover:bg-emerald-900/20"}`}>
                      <td className="px-3 py-2 align-middle">
                        <span className={`inline-flex items-center justify-center w-10 h-8 rounded-md text-xs font-bold tabular-nums ${task.made ? "bg-emerald-200 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-300" : "bg-emerald-100 dark:bg-emerald-900/60 text-emerald-500 dark:text-emerald-400"}`}>
                          {task.number}
                        </span>
                      </td>
                      {(activeProject?.langs ?? []).map((lang, col) => {
                        const raw = task.values[col] ?? "";
                        const isRtl = lang.label.toLowerCase().includes("arabic");
                        const suffix = getTaskTitleSuffix(lang.label);
                        const titled = raw.trim() ? (isRtl ? `${suffix} (${raw.trim()})` : suffix ? `(${raw.trim()}) ${suffix}` : raw.trim()) : "";
                        return (
                          <td key={col} className="px-2 py-2 align-middle">
                            {taskTitleMode ? (
                              <TaskTitleCell value={titled} made={task.made} isRtl={isRtl} onCopy={() => copyTaskCell(titled)} />
                            ) : (
                              <TaskCellInput
                                value={raw} made={task.made} isRtl={isRtl} placeholder={lang.label}
                                onChange={val => updateTaskValue(task.id, col, val)}
                                onCopy={() => copyTaskCell(raw)}
                                onPaste={() => pasteTaskCell(task.id, col)}
                                onClear={() => updateTaskValue(task.id, col, "")}
                              />
                            )}
                          </td>
                        );
                      })}
                      <td className="px-1 py-2 align-middle">
                        <div className="flex flex-col items-center gap-0.5">
                          <button onClick={() => toggleTaskMade(task.id)} title={task.made ? "Mark as pending" : "Mark as made"}
                            className={`w-6 h-6 flex items-center justify-center rounded transition-all ${task.made ? "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800" : "text-emerald-300 dark:text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-900"}`}>
                            {task.made ? <CheckCircle2 size={15} /> : <Circle size={15} />}
                          </button>
                          <button onClick={() => moveTaskToTrash(task.id)} title="Move to trash"
                            className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center rounded text-emerald-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Footer: Add Row + Trash toggle */}
            <div className="shrink-0 border-t border-emerald-200 dark:border-emerald-800 px-5 py-3 flex items-center gap-3 bg-emerald-50/80 dark:bg-emerald-950/60">
              <button onClick={addTaskRow}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 text-sm font-medium hover:bg-emerald-100 dark:hover:bg-emerald-800 transition-colors">
                <Plus size={15} />Add Row
              </button>
              <button onClick={() => setTaskTrashOpen(o => !o)}
                className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${taskTrashOpen ? "bg-red-100 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300" : "bg-white dark:bg-emerald-900 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50"}`}>
                <Trash2 size={14} />
                <span className="text-xs font-medium">Trash</span>
                {activeTaskTrash.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {activeTaskTrash.length > 9 ? "9+" : activeTaskTrash.length}
                  </span>
                )}
              </button>
            </div>
            {/* Trash panel */}
            {taskTrashOpen && (
              <div className="shrink-0 border-t-2 border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 max-h-52 flex flex-col overflow-hidden">
                <div className="shrink-0 flex items-center gap-2 px-5 py-2.5 border-b border-red-200 dark:border-red-900">
                  <Trash2 size={14} className="text-red-500 shrink-0" />
                  <span className="text-sm font-semibold text-red-800 dark:text-red-300 flex-1">Trash {activeTaskTrash.length > 0 ? `(${activeTaskTrash.length})` : ""}</span>
                  {activeTaskTrash.length > 0 && <button onClick={emptyTaskTrash} className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 font-medium transition-colors">Empty All</button>}
                  <button onClick={() => setTaskTrashOpen(false)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-500 transition-colors"><X size={14} /></button>
                </div>
                {activeTaskTrash.length === 0 ? (
                  <p className="text-center text-xs text-red-400 py-6">Trash is empty</p>
                ) : (
                  <div className="overflow-y-auto divide-y divide-red-100 dark:divide-red-900/50">
                    {activeTaskTrash.map(task => (
                      <div key={task.id} className="px-5 py-2.5 flex items-center gap-3 hover:bg-red-100/50 dark:hover:bg-red-900/10 transition-colors">
                        <span className="text-xs font-bold font-mono bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-2 py-0.5 rounded shrink-0">{task.number}</span>
                        <span className="flex-1 text-xs text-red-700 dark:text-red-300 truncate">{task.values.filter(Boolean).join(" · ") || "(empty)"}</span>
                        <button onClick={() => recoverTask(task.id)} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 hover:bg-emerald-200 dark:hover:bg-emerald-800 font-medium transition-colors shrink-0">
                          <RotateCcw size={11} />Recover
                        </button>
                        <button onClick={() => deleteTaskForever(task.id)} className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/60 font-medium transition-colors shrink-0">
                          <X size={11} />Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

