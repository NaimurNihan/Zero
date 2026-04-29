import { useEffect, useRef, useState } from "react";
import { Check, Plus, Search, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface NameComboboxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  storageKey: string;
  className?: string;
}

function loadNames(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
    return [];
  } catch {
    return [];
  }
}

function saveNames(key: string, names: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(names));
  } catch {
    // ignore
  }
}

export function NameCombobox({
  value,
  onChange,
  placeholder,
  storageKey,
  className,
}: NameComboboxProps) {
  const [open, setOpen] = useState(false);
  const [savedNames, setSavedNames] = useState<string[]>(() => loadNames(storageKey));
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === storageKey) setSavedNames(loadNames(storageKey));
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [storageKey]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchInputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const updateSaved = (next: string[]) => {
    setSavedNames(next);
    saveNames(storageKey, next);
  };

  const handleAddCurrent = () => {
    const trimmed = search.trim();
    if (!trimmed) return;
    onChange(trimmed);
    if (!savedNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      updateSaved([trimmed, ...savedNames]);
    }
    setSearch("");
    setOpen(false);
  };

  const handlePick = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const handleDelete = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    updateSaved(savedNames.filter((n) => n !== name));
  };

  const filtered = search.trim()
    ? savedNames.filter((n) => n.toLowerCase().includes(search.trim().toLowerCase()))
    : savedNames;

  const exactExists = savedNames.some(
    (n) => n.toLowerCase() === search.trim().toLowerCase()
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div ref={wrapperRef} className="relative w-full">
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              placeholder={placeholder}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              className={cn("bg-slate-50/50 dark:bg-gray-800 h-9 pr-8", className)}
            />
            {value ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                aria-label="Clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="p-0 w-[--radix-popover-trigger-width] min-w-[260px]"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-gray-800">
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length > 0) {
                    handlePick(filtered[0]);
                  } else {
                    handleAddCurrent();
                  }
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="Search saved names..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-slate-400">
                {savedNames.length === 0
                  ? "No saved names yet. Type one and press +"
                  : "No matches"}
              </div>
            ) : (
              filtered.map((name) => (
                <div
                  key={name}
                  onClick={() => handlePick(name)}
                  className={cn(
                    "group flex items-center justify-between px-3 py-1.5 mx-1 rounded-md cursor-pointer text-sm hover:bg-slate-100 dark:hover:bg-gray-800",
                    value === name && "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300"
                  )}
                >
                  <span className="flex items-center gap-2 truncate">
                    {value === name ? (
                      <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span className="truncate">{name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, name)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 shrink-0"
                    aria-label={`Delete ${name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {search.trim() && !exactExists && (
            <div className="border-t border-slate-100 dark:border-gray-800 p-1">
              <button
                type="button"
                onClick={handleAddCurrent}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="truncate">
                  Add &amp; use &quot;{search.trim()}&quot;
                </span>
              </button>
            </div>
          )}

          <div className="border-t border-slate-100 dark:border-gray-800 px-3 py-1.5 text-[10px] text-slate-400 flex items-center justify-between">
            <span>{savedNames.length} saved</span>
            <span>Enter to pick · Esc to close</span>
          </div>
        </PopoverContent>
      </div>
    </Popover>
  );
}

export function rememberName(storageKey: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  const current = loadNames(storageKey);
  if (current.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return;
  saveNames(storageKey, [trimmed, ...current]);
}
