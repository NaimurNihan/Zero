import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, FileText, X, Download, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { NameCombobox, rememberName } from "@/components/NameCombobox";

interface NameSubtitle {
  id: number;
  index: string;
  startTime: string;
  endTime: string;
  text: string;
  originalText: string;
  edited: boolean;
  replacedWith?: string;
}

function parseNameSrt(content: string): NameSubtitle[] {
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalizedContent.split(/\n{2,}/).filter(block => block.trim() !== '');

  return blocks.map((block, i) => {
    const lines = block.split('\n');
    const index = lines[0]?.trim() || String(i + 1);

    let timeLine = lines[1] || '';
    let textLines = lines.slice(2);

    if (lines[0] && lines[0].includes('-->')) {
      timeLine = lines[0];
      textLines = lines.slice(1);
    }

    const [startTime = '', endTime = ''] = timeLine.split(/\s*-->\s*/);
    const text = textLines.join('\n').trim();

    return {
      id: i,
      index,
      startTime: startTime.trim(),
      endTime: endTime.trim(),
      text,
      originalText: text,
      edited: false,
    };
  });
}

function serializeNameSrt(subtitles: NameSubtitle[]): string {
  return subtitles.map(sub => {
    return `${sub.index}\n${sub.startTime} --> ${sub.endTime}\n${sub.text}\n`;
  }).join('\n');
}

const FIND_STORE = "srt-name:find-names";
const REPLACE_STORE = "srt-name:replace-names";

interface SrtNameTabProps {
  incomingSrt?: string;
  incomingFilename?: string;
  incomingKey?: number;
  onConvertOutput?: (srt: string, filename: string) => void;
}

export default function SrtNameTab({ incomingSrt, incomingFilename, incomingKey, onConvertOutput }: SrtNameTabProps = {}) {
  const [subtitles, setSubtitles] = useState<NameSubtitle[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [findName, setFindName] = useState("");
  const [replaceName, setReplaceName] = useState("");
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteContent, setPasteContent] = useState("");

  useEffect(() => {
    if (!incomingKey || !incomingSrt) return;
    setSubtitles(parseNameSrt(incomingSrt));
    setFileName(incomingFilename || "from-merger.srt");
    setShowPasteArea(false);
  }, [incomingKey, incomingSrt, incomingFilename]);
  const [editingField, setEditingField] = useState<{ id: number; field: 'text' | 'startTime' | 'endTime' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateSubtitle = (id: number, field: 'text' | 'startTime' | 'endTime', value: string) => {
    setSubtitles(prev => prev.map(sub => sub.id === id ? { ...sub, [field]: value } : sub));
  };

  const editedCount = subtitles.filter(s => s.edited).length;
  const hasFile = subtitles.length > 0;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setSubtitles(parseNameSrt(content));
        setFileName(file.name);
        setShowPasteArea(false);
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.srt') || file.name.endsWith('.txt')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          setSubtitles(parseNameSrt(content));
          setFileName(file.name);
          setShowPasteArea(false);
        }
      };
      reader.readAsText(file);
    }
  };

  const handlePasteLoad = () => {
    if (pasteContent.trim()) {
      setSubtitles(parseNameSrt(pasteContent));
      setFileName("pasted-text.srt");
      setShowPasteArea(false);
    }
  };

  const handleClearAll = () => {
    setSubtitles([]);
    setFileName(null);
    setFindName("");
    setReplaceName("");
    setShowPasteArea(false);
    setPasteContent("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleConvert = () => {
    if (!hasFile) return;

    const updated = findName
      ? subtitles.map(sub => {
          const testRegex = new RegExp(findName, "gi");
          if (testRegex.test(sub.text)) {
            const replaceRegex = new RegExp(findName, "gi");
            return {
              ...sub,
              text: sub.text.replace(replaceRegex, replaceName),
              edited: true,
              replacedWith: replaceName,
            };
          }
          return sub;
        })
      : subtitles;

    setSubtitles(updated);

    if (findName) {
      rememberName(FIND_STORE, findName);
      if (replaceName.trim()) rememberName(REPLACE_STORE, replaceName);
    }

    setFindName("");
    setReplaceName("");

    if (onConvertOutput) {
      const serialized = serializeNameSrt(updated);
      onConvertOutput(serialized, fileName || "converted.srt");
    }
  };

  const handleDownload = () => {
    if (!hasFile) return;

    const content = serializeNameSrt(subtitles);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName ? `converted-${fileName}` : "converted.srt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const renderHighlightedText = useCallback((text: string, isEdited: boolean, replacedWith?: string) => {
    const segments: { text: string; type: 'green' | 'red' | 'plain' }[] = [];

    if (isEdited && replacedWith && replacedWith.length > 0) {
      const greenRegex = new RegExp(`(${escapeRegex(replacedWith)})`, 'gi');
      const parts = text.split(greenRegex);
      parts.forEach(part => {
        if (!part) return;
        if (part.toLowerCase() === replacedWith.toLowerCase()) {
          segments.push({ text: part, type: 'green' });
        } else {
          segments.push({ text: part, type: 'plain' });
        }
      });
    } else {
      segments.push({ text, type: 'plain' });
    }

    if (!findName) {
      return segments.map((seg, i) =>
        seg.type === 'green' ? (
          <span key={i} className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 px-1 rounded mx-0.5 font-medium">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      );
    }

    const findRegex = new RegExp(`(${escapeRegex(findName)})`, 'gi');
    const finalNodes: React.ReactNode[] = [];
    let key = 0;

    segments.forEach(seg => {
      if (seg.type === 'green') {
        finalNodes.push(
          <span key={key++} className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 px-1 rounded mx-0.5 font-medium">
            {seg.text}
          </span>
        );
      } else {
        const subParts = seg.text.split(findRegex);
        subParts.forEach(part => {
          if (!part) return;
          if (part.toLowerCase() === findName.toLowerCase()) {
            finalNodes.push(
              <span key={key++} className="bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 px-1 rounded mx-0.5 font-medium">
                {part}
              </span>
            );
          } else {
            finalNodes.push(<span key={key++}>{part}</span>);
          }
        });
      }
    });

    return finalNodes;
  }, [findName]);

  return (
    <div className="min-h-full w-full bg-slate-50 dark:bg-gray-900 py-8 px-4 font-sans flex justify-center">
      <div className="w-full max-w-4xl flex flex-col gap-4">

        {/* CARD 1: Header */}
        <Card className="shadow-sm border-slate-200 dark:border-gray-800">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">SRT Name Converter</h1>
              <Badge variant="secondary" className="bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100">
                {hasFile ? (editedCount > 0 ? `${editedCount} edited` : `${subtitles.length} subtitles`) : "0 subtitles"}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {hasFile && (
                <Button
                  onClick={handleDownload}
                  className="bg-blue-600 text-white border border-blue-700 hover:bg-blue-700 hover:shadow-md transition-all duration-150 font-medium"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download SRT
                </Button>
              )}
              <Button
                onClick={handleClearAll}
                variant="outline"
                className={
                  hasFile
                    ? "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 hover:border-rose-300 hover:shadow-sm transition-all duration-150 font-medium dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900"
                    : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 hover:shadow-sm transition-all duration-150 font-medium dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900"
                }
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear All
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* CARD 2: Controls */}
        <Card className="shadow-sm border-slate-200 dark:border-gray-800">
          <CardContent className="px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex-1 flex flex-col sm:flex-row items-center gap-3 w-full">
              <NameCombobox
                placeholder="Find name (e.g. John)"
                value={findName}
                onChange={setFindName}
                storageKey={FIND_STORE}
              />
              <NameCombobox
                placeholder="Replace with (e.g. Rahim)"
                value={replaceName}
                onChange={setReplaceName}
                storageKey={REPLACE_STORE}
              />
            </div>
            <div className="w-full sm:w-auto">
              <Button
                onClick={handleConvert}
                disabled={!hasFile || !findName}
                className="w-full sm:w-auto px-8 bg-blue-600 hover:bg-blue-700 text-white font-medium h-9"
              >
                Convert
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* CARD 3: File Area */}
        <Card className="shadow-sm border-slate-200 dark:border-gray-800 min-h-[250px] flex flex-col overflow-hidden">
          {!hasFile ? (
            <CardContent className="p-8 flex-1 flex flex-col items-center justify-center">
              <div
                className="w-full max-w-xl p-12 border-2 border-dashed border-slate-300 dark:border-gray-700 rounded-xl bg-slate-50 dark:bg-gray-800/50 flex flex-col items-center justify-center text-center hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-10 h-10 text-slate-400 mb-4" />
                <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-200 mb-1">Drop your SRT file here</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">or click to browse — supports .srt and .txt files</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept=".srt,.txt"
                  onChange={handleFileUpload}
                />
              </div>

              <div className="flex items-center gap-4 w-full max-w-xl my-6">
                <div className="h-px bg-slate-200 dark:bg-gray-700 flex-1"></div>
                <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">or</span>
                <div className="h-px bg-slate-200 dark:bg-gray-700 flex-1"></div>
              </div>

              {!showPasteArea ? (
                <Button variant="outline" onClick={() => setShowPasteArea(true)} className="text-slate-600 dark:text-slate-300">
                  Paste SRT text
                </Button>
              ) : (
                <div className="w-full max-w-xl flex flex-col gap-3">
                  <Textarea
                    placeholder="Paste your SRT content here..."
                    className="min-h-[200px] font-mono text-sm"
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setShowPasteArea(false)}>Cancel</Button>
                    <Button onClick={handlePasteLoad} disabled={!pasteContent.trim()}>Load Text</Button>
                  </div>
                </div>
              )}
            </CardContent>
          ) : (
            <>
              <div className="border-b border-slate-100 dark:border-gray-800 bg-slate-50/80 dark:bg-gray-900/50 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <FileText className="w-4 h-4 text-blue-600" />
                  {fileName}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => { setSubtitles([]); setFileName(null); }} className="h-8 px-2 text-slate-500 dark:text-slate-400">
                    <X className="w-4 h-4 mr-1" /> Clear
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="h-8 bg-white dark:bg-gray-800">
                    Load New
                  </Button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept=".srt,.txt"
                    onChange={handleFileUpload}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-auto p-4 bg-slate-100/50 dark:bg-gray-900/40">
                <div className="max-w-4xl mx-auto space-y-3">
                  {subtitles.map((sub) => (
                    <Card key={sub.id} className="shadow-sm border-slate-200/60 dark:border-gray-800 overflow-hidden hover:border-slate-300 dark:hover:border-gray-700 transition-colors group">
                      <div className="flex">
                        {/* Left Info Bar */}
                        <div className="w-14 bg-slate-50 dark:bg-gray-800/50 border-r border-slate-100 dark:border-gray-800 flex flex-col items-center py-2 shrink-0">
                          <div className="w-7 h-7 rounded-full bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 shadow-sm flex items-center justify-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                            {sub.index}
                          </div>
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 px-4 py-2 flex flex-col sm:flex-row gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="font-mono text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-gray-800 px-2 py-0.5 rounded inline-flex items-center gap-1">
                                {editingField?.id === sub.id && editingField?.field === 'startTime' ? (
                                  <Input
                                    autoFocus
                                    value={sub.startTime}
                                    onChange={(e) => updateSubtitle(sub.id, 'startTime', e.target.value)}
                                    onBlur={() => setEditingField(null)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingField(null); }}
                                    className="h-5 px-1 py-0 text-xs font-mono w-[110px] bg-white dark:bg-gray-900"
                                  />
                                ) : (
                                  <span
                                    className="cursor-text hover:bg-slate-200 dark:hover:bg-gray-700 px-1 rounded"
                                    onClick={() => setEditingField({ id: sub.id, field: 'startTime' })}
                                    title="Click to edit"
                                  >
                                    {sub.startTime}
                                  </span>
                                )}
                                <span className="text-slate-400">&rarr;</span>
                                {editingField?.id === sub.id && editingField?.field === 'endTime' ? (
                                  <Input
                                    autoFocus
                                    value={sub.endTime}
                                    onChange={(e) => updateSubtitle(sub.id, 'endTime', e.target.value)}
                                    onBlur={() => setEditingField(null)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingField(null); }}
                                    className="h-5 px-1 py-0 text-xs font-mono w-[110px] bg-white dark:bg-gray-900"
                                  />
                                ) : (
                                  <span
                                    className="cursor-text hover:bg-slate-200 dark:hover:bg-gray-700 px-1 rounded"
                                    onClick={() => setEditingField({ id: sub.id, field: 'endTime' })}
                                    title="Click to edit"
                                  >
                                    {sub.endTime}
                                  </span>
                                )}
                              </span>
                              {sub.edited && (
                                <Badge className="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 border-0 text-[10px] uppercase tracking-wider px-2 py-0">
                                  Edited
                                </Badge>
                              )}
                            </div>
                            {editingField?.id === sub.id && editingField?.field === 'text' ? (
                              <Textarea
                                autoFocus
                                value={sub.text}
                                onChange={(e) => updateSubtitle(sub.id, 'text', e.target.value)}
                                onBlur={() => setEditingField(null)}
                                onKeyDown={(e) => { if (e.key === 'Escape') setEditingField(null); }}
                                className="text-sm font-sans leading-snug min-h-[60px] bg-white dark:bg-gray-900"
                              />
                            ) : (
                              <p
                                className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-snug cursor-text hover:bg-slate-50 dark:hover:bg-gray-800 rounded px-1 -mx-1"
                                onClick={() => setEditingField({ id: sub.id, field: 'text' })}
                                title="Click to edit"
                              >
                                {renderHighlightedText(sub.text, sub.edited, sub.replacedWith)}
                              </p>
                            )}
                          </div>

                          {/* Placeholder Actions */}
                          <div className="flex flex-row sm:flex-col items-center justify-start gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                              <ChevronUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                              <ChevronDown className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-blue-600">
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-red-600">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
