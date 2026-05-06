import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PassKeyLock from "@/components/PassKeyLock";
import { type Subtitle, formatSrt, parseSrt } from "@/lib/srt";
import SrtEditorTab from "@/tabs/SrtEditorTab";
import SrtMakerTab from "@/tabs/SrtMakerTab";
import SrtNoteTab from "@/tabs/SrtNoteTab";
import SrtTimeSplitterTab from "@/tabs/SrtTimeSplitterTab";
import SrtMergerTab from "@/tabs/SrtMergerTab";
import VoiceTrimmerTab from "@/tabs/VoiceTrimmerTab";
import VideoSplitterTab from "@/tabs/VideoSplitterTab";
import CuttingPlusTab from "@/tabs/CuttingPlusTab";
import CuttingPlusPlusTab from "@/tabs/CuttingPlusPlusTab";
import SpeedPlusMinusTab from "@/tabs/SpeedPlusMinusTab";
import AiAudioTab from "@/tabs/AiAudioTab";
import AudioToSrtTab from "@/tabs/AudioToSrtTab";

type Tab = "editor" | "maker" | "note" | "splitter" | "merger" | "aiAudio" | "audio" | "video" | "cuttingPlus" | "cutting" | "speed" | "audioToSrt";
type Group = "A" | "B" | "C";

const GROUP_TABS: Record<Group, Tab[]> = {
  A: ["merger", "editor", "splitter", "note"],
  B: ["note", "aiAudio", "audio", "audioToSrt", "maker"],
  C: ["video", "cuttingPlus", "cutting", "speed"],
};

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "merger",
    label: "SRT Marger",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
      </svg>
    ),
  },
  {
    id: "editor",
    label: "SRT Editor",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: "splitter",
    label: "SRT Time Spliter",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
      </svg>
    ),
  },
  {
    id: "note",
    label: "SRT Note",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
      </svg>
    ),
  },
  {
    id: "aiAudio",
    label: "Ai Audio",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
  },
  {
    id: "audio",
    label: "Audio Spliter",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
      </svg>
    ),
  },
  {
    id: "audioToSrt",
    label: "Audio To SRT",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-8-12V5a4 4 0 118 0v5a4 4 0 11-8 0z" />
      </svg>
    ),
  },
  {
    id: "maker",
    label: "SRT Maker",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    ),
  },
  {
    id: "video",
    label: "Video Spliter",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    id: "cuttingPlus",
    label: "Cutting +",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
      </svg>
    ),
  },
  {
    id: "cutting",
    label: "Cutting ++",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
      </svg>
    ),
  },
  {
    id: "speed",
    label: "Speed +-",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
];

const GROUP_CONFIG: { id: Group; label: string; icon: React.ReactNode; activeColor: string; activeBg: string; activeBorder: string }[] = [
  {
    id: "A",
    label: "SRT",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    activeColor: "text-emerald-700 dark:text-emerald-300",
    activeBg: "bg-emerald-50 dark:bg-emerald-950",
    activeBorder: "border-emerald-400 dark:border-emerald-600",
  },
  {
    id: "B",
    label: "Audio",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
      </svg>
    ),
    activeColor: "text-violet-700 dark:text-violet-300",
    activeBg: "bg-violet-50 dark:bg-violet-950",
    activeBorder: "border-violet-400 dark:border-violet-600",
  },
  {
    id: "C",
    label: "Video",
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
    activeColor: "text-orange-700 dark:text-orange-300",
    activeBg: "bg-orange-50 dark:bg-orange-950",
    activeBorder: "border-orange-400 dark:border-orange-600",
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("merger");
  const [activeGroups, setActiveGroups] = useState<Set<Group>>(new Set(["A", "B", "C"]));
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [filename, setFilename] = useState("");
  const [splitterIncomingKey, setSplitterIncomingKey] = useState(0);
  const [videoIncomingSrt, setVideoIncomingSrt] = useState("");
  const [videoIncomingSrtFilename, setVideoIncomingSrtFilename] = useState("");
  const [videoIncomingSrtKey, setVideoIncomingSrtKey] = useState(0);
  const [mergerClearKey, setMergerClearKey] = useState(0);
  const [noteIncomingText, setNoteIncomingText] = useState("");
  const [noteIncomingName, setNoteIncomingName] = useState("");
  const [noteIncomingKey, setNoteIncomingKey] = useState(0);
  const [cuttingIncomingAudio, setCuttingIncomingAudio] = useState<{ files: File[]; key: number }>({ files: [], key: 0 });
  const [spliterIncomingAudio, setSpliterIncomingAudio] = useState<{ files: File[]; key: number; autoSplit?: boolean; label?: string }>({ files: [], key: 0 });
  const autoRunRef = useRef(false);
  const currentRunLabelRef = useRef<string>("");
  const autoRunQueueRef = useRef<{ label: string; lines: string[] }[]>([]);
  // Auto Run 2 state
  const autoRunModeRef = useRef<"run1" | "run2">("run1");
  const autoRun2QueueRef = useRef<{ label: string; lines: string[] }[]>([]);
  const autoRun2PausedRef = useRef(false);
  const autoRun2UserPausedRef = useRef(false);
  const autoRun2ResumeCallbackRef = useRef<(() => void) | null>(null);
  const [isAutoRun2Active, setIsAutoRun2Active] = useState(false);
  const [isAutoRun2Paused, setIsAutoRun2Paused] = useState(false);
  const [cuttingPlusIncomingVideos, setCuttingPlusIncomingVideos] = useState<{ files: File[]; key: number; autoLoad?: boolean; extras?: number[] }>({ files: [], key: 0 });
  const [speedIncomingVideos, setSpeedIncomingVideos] = useState<{ files: File[]; key: number }>({ files: [], key: 0 });
  const [speedIncomingAudio, setSpeedIncomingAudio] = useState<{ files: File[]; key: number; label?: string }>({ files: [], key: 0 });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = localStorage.getItem("srt-tools-theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("srt-tools-unlocked") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    localStorage.setItem("srt-tools-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const toggleGroup = (group: Group) => {
    setActiveGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        if (next.size === 1) return prev;
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const visibleTabs = useMemo(() => {
    const seen = new Set<Tab>();
    const result: typeof TABS = [];
    for (const tab of TABS) {
      if (seen.has(tab.id)) continue;
      for (const group of (["A", "B", "C"] as Group[])) {
        if (activeGroups.has(group) && GROUP_TABS[group].includes(tab.id)) {
          seen.add(tab.id);
          result.push(tab);
          break;
        }
      }
    }
    return result;
  }, [activeGroups]);

  useEffect(() => {
    if (!visibleTabs.find((t) => t.id === activeTab)) {
      if (visibleTabs.length > 0) {
        setActiveTab(visibleTabs[0].id);
      }
    }
  }, [visibleTabs, activeTab]);

  const handleVideoSplitterOutputs = useCallback((files: File[]) => {
    setCuttingPlusIncomingVideos((prev) => {
      const sameLength = prev.files.length === files.length;
      const sameNames =
        sameLength &&
        prev.files.every((f, i) => f.name === files[i]?.name && f.size === files[i]?.size);
      if (sameNames) return prev;
      return { files, key: Date.now() };
    });
  }, []);

  const hasFile = subtitles.length > 0;

  const triggerRunForLang = useCallback((lines: string[], label: string) => {
    currentRunLabelRef.current = label;
    autoRunRef.current = true;
    window.dispatchEvent(new CustomEvent("srt-tools:aiaudio-set-content", { detail: { lines, label } }));
    handleSelectTab("aiAudio");
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("srt-tools:aiaudio-cut"));
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("srt-tools:aiaudio-load-pool"));
      }, 250);
    }, 250);
  }, []);

  const processNextInQueue = useCallback(() => {
    const queue = autoRunQueueRef.current;
    if (queue.length === 0) {
      window.dispatchEvent(new CustomEvent("srt-tools:autorun-complete"));
      return;
    }
    const next = queue.shift()!;
    autoRunModeRef.current = "run1";
    triggerRunForLang(next.lines, next.label);
  }, [triggerRunForLang]);

  const processNext2InQueue = useCallback(() => {
    const queue = autoRun2QueueRef.current;
    if (queue.length === 0) {
      setIsAutoRun2Active(false);
      setIsAutoRun2Paused(false);
      autoRun2PausedRef.current = false;
      autoRun2UserPausedRef.current = false;
      autoRun2ResumeCallbackRef.current = null;
      window.dispatchEvent(new CustomEvent("srt-tools:autorun2-complete"));
      return;
    }
    // User manually requested pause — hold here between languages
    if (autoRun2UserPausedRef.current) {
      autoRun2PausedRef.current = true;
      setIsAutoRun2Paused(true);
      // Resume will call processNext2InQueueRef.current()
      return;
    }
    const next = queue.shift()!;
    autoRunModeRef.current = "run2";
    triggerRunForLang(next.lines, next.label);
  }, [triggerRunForLang]);

  // Stable ref so the play button click handler always calls the latest version
  const processNext2InQueueRef = useRef(processNext2InQueue);
  processNext2InQueueRef.current = processNext2InQueue;

  // Auto Run 2 speed sequence: triggered from onSendToSpeed when in run2 mode
  const startSpeedSequence = useCallback(() => {
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("srt-tools:speed-load-audio-pool"));
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("srt-tools:speed-load-video-pool"));
      }, 600);
    }, 600);
  }, []);

  useEffect(() => {
    const onZipDone = () => {
      if (autoRunModeRef.current === "run2") {
        // Auto Run 2: load trimmed audio to Speed+- instead of clearing
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("srt-tools:trimmer-load-to-speed"));
        }, 400);
      } else {
        // Auto Run All (existing flow)
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("srt-tools:clear-all-broadcast", { detail: { source: "autorun" } }));
          window.setTimeout(() => {
            processNextInQueue();
          }, 800);
        }, 400);
      }
    };
    window.addEventListener("srt-tools:trimmer-zip-done", onZipDone);
    return () => window.removeEventListener("srt-tools:trimmer-zip-done", onZipDone);
  }, [processNextInQueue]);

  // Auto Run 2: Speed+- event chain
  useEffect(() => {
    const onVideoPoolEmpty = () => {
      autoRun2PausedRef.current = true;
      setIsAutoRun2Paused(true);
      // Store specific resume action for video-pool-empty case
      autoRun2ResumeCallbackRef.current = () => {
        window.dispatchEvent(new CustomEvent("srt-tools:speed-load-video-pool"));
      };
    };
    const onVideoPoolLoaded = () => {
      // Give cards time to read durations before running
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("srt-tools:speed-run"));
      }, 2500);
    };
    const onProcessingDone = () => {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("srt-tools:speed-download-zip"));
      }, 500);
    };
    const onZipDone = () => {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("srt-tools:speed-audio-clear-all"));
      }, 400);
    };
    const onAudioCleared = () => {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("srt-tools:clear-all-broadcast", { detail: { source: "autorun" } }));
        window.setTimeout(() => {
          processNext2InQueue();
        }, 800);
      }, 300);
    };
    window.addEventListener("srt-tools:speed-video-pool-empty", onVideoPoolEmpty);
    window.addEventListener("srt-tools:speed-video-pool-loaded", onVideoPoolLoaded);
    window.addEventListener("srt-tools:speed-processing-done", onProcessingDone);
    window.addEventListener("srt-tools:speed-zip-done", onZipDone);
    window.addEventListener("srt-tools:speed-audio-cleared", onAudioCleared);
    return () => {
      window.removeEventListener("srt-tools:speed-video-pool-empty", onVideoPoolEmpty);
      window.removeEventListener("srt-tools:speed-video-pool-loaded", onVideoPoolLoaded);
      window.removeEventListener("srt-tools:speed-processing-done", onProcessingDone);
      window.removeEventListener("srt-tools:speed-zip-done", onZipDone);
      window.removeEventListener("srt-tools:speed-audio-cleared", onAudioCleared);
    };
  }, [processNext2InQueue]);

  const incomingSrtForSplitter = useMemo(
    () => (subtitles.length > 0 ? formatSrt(subtitles) : ""),
    [subtitles]
  );

  useEffect(() => {
    if (subtitles.length > 0) {
      setSplitterIncomingKey((k) => k + 1);
    }
  }, [subtitles]);

  useEffect(() => {
    const onPoolLoaded = (e: Event) => {
      if (!autoRunRef.current) return;
      const detail = (e as CustomEvent<{ done: number; total: number }>).detail;
      if (!detail || detail.done === 0) {
        autoRunRef.current = false;
        return;
      }
      window.dispatchEvent(new CustomEvent("srt-tools:aiaudio-load-spliter"));
    };
    window.addEventListener("srt-tools:aiaudio-pool-loaded", onPoolLoaded);
    return () => window.removeEventListener("srt-tools:aiaudio-pool-loaded", onPoolLoaded);
  }, []);

  const handleSelectTab = (id: Tab) => {
    setActiveTab(id);
  };

  const handleLoadSplitterToMerger = useCallback((srt: string, filename: string) => {
    setActiveTab("merger");
    setVideoIncomingSrt(srt);
    setVideoIncomingSrtFilename(filename);
    setVideoIncomingSrtKey((k) => k + 1);
  }, []);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runTransformSequence = async () => {
    await sleep(1000);
    window.dispatchEvent(new CustomEvent("srt-tools:merger-generate"));
    await sleep(1000);
    handleSelectTab("editor");
    await sleep(200);
    window.dispatchEvent(new CustomEvent("srt-tools:editor-convert"));
    await sleep(800);
    handleSelectTab("splitter");
    await sleep(1000);
    window.dispatchEvent(new CustomEvent("srt-tools:splitter-split"));
    await sleep(500);
    window.dispatchEvent(new CustomEvent("srt-tools:splitter-dot"));
    await sleep(500);
    window.dispatchEvent(new CustomEvent("srt-tools:splitter-trim10"));
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900 overflow-hidden">
      <header className="bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-20 shrink-0">
        <div className="px-4">
          <div className="max-w-5xl mx-auto flex items-center gap-3 py-3">
            <PassKeyLock
              unlocked={unlocked}
              onUnlock={() => setUnlocked(true)}
              onLock={() => setUnlocked(false)}
            />
            <div className="flex items-center justify-center w-8 h-8 bg-blue-600 rounded-lg shrink-0">
              <svg className="w-4.5 h-4.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14.5 2.5a2 2 0 00-2-2h-1a2 2 0 00-2 2v1h5v-1zm-5 3v1.5a.5.5 0 01-.5.5H7.5A2.5 2.5 0 005 10v9a2.5 2.5 0 002.5 2.5h9A2.5 2.5 0 0019 19v-9a2.5 2.5 0 00-2.5-2.5H15a.5.5 0 01-.5-.5V5.5h-5z" />
              </svg>
            </div>
            <span className="text-base font-bold text-gray-900 dark:text-gray-100">SRT Tools</span>
            <button
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Switch to day mode" : "Switch to night mode"}
              title={theme === "dark" ? "Day mode" : "Night mode"}
              className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            <div className="flex items-center gap-1 ml-1">
              {GROUP_CONFIG.map((g) => {
                const isActive = activeGroups.has(g.id);
                return (
                  <button
                    key={g.id}
                    onClick={() => toggleGroup(g.id)}
                    title={`${isActive ? "Hide" : "Show"} ${g.label} tabs`}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-semibold transition-all duration-150 select-none ${
                      isActive
                        ? `${g.activeBg} ${g.activeColor} ${g.activeBorder}`
                        : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {g.icon}
                    <span className="hidden sm:inline">{g.label}</span>
                  </button>
                );
              })}
            </div>

            {isAutoRun2Active && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (isAutoRun2Paused) {
                      // ▶ → Resume
                      setIsAutoRun2Paused(false);
                      autoRun2PausedRef.current = false;
                      autoRun2UserPausedRef.current = false;
                      const cb = autoRun2ResumeCallbackRef.current;
                      autoRun2ResumeCallbackRef.current = null;
                      if (cb) {
                        cb();
                      } else {
                        processNext2InQueueRef.current();
                      }
                    } else {
                      // ⏸ → Request pause at next language boundary
                      autoRun2UserPausedRef.current = true;
                    }
                  }}
                  title={isAutoRun2Paused ? "Paused — click to resume Auto Run 2" : "Click to pause Auto Run 2 after current language finishes"}
                  className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-all ${
                    isAutoRun2Paused
                      ? "bg-orange-500 border-orange-400 text-white animate-pulse shadow-lg"
                      : "bg-orange-100 border-orange-300 text-orange-500 dark:bg-orange-950 dark:border-orange-800 hover:bg-orange-200 dark:hover:bg-orange-900"
                  }`}
                >
                  {isAutoRun2Paused ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  )}
                </button>
                <button
                  onClick={() => {
                    autoRun2QueueRef.current = [];
                    autoRun2PausedRef.current = false;
                    autoRun2UserPausedRef.current = false;
                    autoRun2ResumeCallbackRef.current = null;
                    autoRunModeRef.current = "run1";
                    setIsAutoRun2Active(false);
                    setIsAutoRun2Paused(false);
                  }}
                  title="Stop Auto Run 2 — cancel all remaining languages"
                  className="flex items-center justify-center w-8 h-8 rounded-lg border border-red-300 bg-red-50 text-red-500 dark:bg-red-950 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900 transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.59 14L12 11.41 7.41 16 6 14.59 10.59 10 6 5.41 7.41 4 12 8.59 16.59 4 18 5.41 13.41 10 18 14.59 14.59 16z"/>
                  </svg>
                </button>
              </div>
            )}
            {hasFile && (
              <span className="text-xs bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-300 border border-blue-200 dark:border-blue-900 px-2.5 py-0.5 rounded-full font-medium">
                {subtitles.length} subtitles loaded
              </span>
            )}
          </div>

          <nav className="flex gap-0 -mb-px -mx-4 px-2 flex-wrap justify-center">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => unlocked && handleSelectTab(tab.id)}
                disabled={!unlocked}
                className={`flex items-center gap-1 px-2 py-2.5 text-[0.525rem] sm:text-[0.6125rem] font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  !unlocked
                    ? "border-transparent text-gray-300 dark:text-gray-600 cursor-not-allowed"
                    : activeTab === tab.id
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.label.split(" ")[1] ?? tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className={`flex flex-col flex-1 overflow-hidden relative ${!unlocked ? "pointer-events-none select-none" : ""}`}>
        {!unlocked && (
          <div className="absolute inset-0 z-10 bg-white/60 dark:bg-gray-900/70 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center px-4">
              <svg className="w-10 h-10 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 11c0-1.657 1.343-3 3-3s3 1.343 3 3v2H6v-2a3 3 0 016 0zM5 13h14v8H5v-8z" />
              </svg>
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Enter pass key at the top to unlock
              </p>
            </div>
          </div>
        )}

      {/* SRT Maker — always mounted, hidden when inactive */}
      <div style={{ display: activeTab === "maker" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <SrtMakerTab />
      </div>

      {/* SRT Note — always mounted, full width, hidden when inactive */}
      <div style={{ display: activeTab === "note" ? "flex" : "none" }} className="flex-col flex-1 overflow-hidden">
        <SrtNoteTab
          incomingText={noteIncomingText}
          incomingName={noteIncomingName}
          incomingKey={noteIncomingKey}
          onRunToAiAudio={(lines, label) => {
            autoRunModeRef.current = "run2";
            autoRun2PausedRef.current = false;
            autoRun2QueueRef.current = [];
            setIsAutoRun2Active(true);
            setIsAutoRun2Paused(false);
            triggerRunForLang(lines, label ?? "");
          }}
          onAutoRunAll={(langs) => {
            if (langs.length === 0) return;
            autoRunModeRef.current = "run1";
            autoRunQueueRef.current = langs.slice(1).map((l) => ({ label: l.label, lines: l.lines }));
            triggerRunForLang(langs[0].lines, langs[0].label);
          }}
          onAutoRun2={(langs) => {
            if (langs.length === 0) return;
            autoRunModeRef.current = "run2";
            autoRun2PausedRef.current = false;
            setIsAutoRun2Active(true);
            setIsAutoRun2Paused(false);
            autoRun2QueueRef.current = langs.slice(1).map((l) => ({ label: l.label, lines: l.lines }));
            triggerRunForLang(langs[0].lines, langs[0].label);
          }}
        />
      </div>

      {/* SRT Time Spliter — full width, hidden when inactive */}
      <div style={{ display: activeTab === "splitter" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <SrtTimeSplitterTab
          incomingSrt={incomingSrtForSplitter}
          incomingFilename={filename || "from-editor.srt"}
          incomingKey={splitterIncomingKey}
          onSendToMerger={handleLoadSplitterToMerger}
          onFinalOutput={(srt, name) => {
            setVideoIncomingSrt(srt);
            setVideoIncomingSrtFilename(name);
            setVideoIncomingSrtKey((k) => k + 1);
          }}
          onSendToNote={(text, sourceName) => {
            setNoteIncomingText(text);
            setNoteIncomingName(sourceName);
            setNoteIncomingKey((k) => k + 1);
            handleSelectTab("note");
          }}
        />
      </div>

      {/* SRT Marger — full width, hidden when inactive */}
      <div style={{ display: activeTab === "merger" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <SrtMergerTab
          clearKey={mergerClearKey}
          incomingSrt={videoIncomingSrt}
          incomingFilename={videoIncomingSrtFilename}
          incomingKey={videoIncomingSrtKey}
          onSendToName={(srt, name) => {
            const parsed = parseSrt(srt);
            setSubtitles(parsed);
            setFilename(name);
            handleSelectTab("editor");
          }}
          onTransform={runTransformSequence}
        />
      </div>

      {/* Ai Audio — full width, hidden when inactive */}
      <div style={{ display: activeTab === "aiAudio" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <AiAudioTab
          onSendToSpliter={(files) => {
            const autoSplit = autoRunRef.current;
            autoRunRef.current = false;
            const label = currentRunLabelRef.current;
            setSpliterIncomingAudio({ files, key: Date.now(), autoSplit, label });
            handleSelectTab("audio");
          }}
        />
      </div>

      {/* Audio Spliter — full width, hidden when inactive */}
      <div style={{ display: activeTab === "audio" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <VoiceTrimmerTab
          incomingAudioFiles={spliterIncomingAudio}
          onSendToSpeed={(files) => {
            setSpeedIncomingAudio({ files, key: Date.now(), label: currentRunLabelRef.current });
            handleSelectTab("speed");
            if (autoRunModeRef.current === "run2") {
              startSpeedSequence();
            }
          }}
        />
      </div>

      {/* Video Spliter — full width, hidden when inactive */}
      <div style={{ display: activeTab === "video" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <VideoSplitterTab
          incomingSrt={videoIncomingSrt}
          incomingSrtFilename={videoIncomingSrtFilename}
          incomingSrtKey={videoIncomingSrtKey}
          onSendToCutting={(files, extras) => {
            setCuttingPlusIncomingVideos({ files, key: Date.now(), autoLoad: true, extras });
            handleSelectTab("cuttingPlus");
          }}
          onOutputsChange={handleVideoSplitterOutputs}
        />
      </div>

      {/* Cutting + — full width, hidden when inactive */}
      <div style={{ display: activeTab === "cuttingPlus" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <CuttingPlusTab
          incomingVideoFiles={cuttingPlusIncomingVideos}
          onSendToCuttingPlusPlus={(files) => {
            setCuttingIncomingAudio({ files, key: Date.now() });
            handleSelectTab("cutting");
          }}
          onSendToSpeedPlusMinus={(files) => {
            setSpeedIncomingVideos({ files, key: Date.now() });
            handleSelectTab("speed");
          }}
        />
      </div>

      {/* Cutting ++ — full width, hidden when inactive */}
      <div style={{ display: activeTab === "cutting" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <CuttingPlusPlusTab incomingAudioFiles={cuttingIncomingAudio} />
      </div>

      {/* Speed +- — full width, hidden when inactive */}
      <div style={{ display: activeTab === "speed" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <SpeedPlusMinusTab incomingVideoFiles={speedIncomingVideos} incomingAudioFiles={speedIncomingAudio} />
      </div>

      {/* Audio To SRT — full width, hidden when inactive */}
      <div style={{ display: activeTab === "audioToSrt" ? "flex" : "none" }} className="flex-col flex-1 overflow-y-auto">
        <AudioToSrtTab />
      </div>

      {/* Other tabs */}
      <main
        style={{ display: activeTab === "maker" || activeTab === "note" || activeTab === "splitter" || activeTab === "merger" || activeTab === "aiAudio" || activeTab === "audio" || activeTab === "video" || activeTab === "cuttingPlus" || activeTab === "cutting" || activeTab === "speed" || activeTab === "audioToSrt" ? "none" : "block" }}
        className="max-w-5xl mx-auto px-4 py-5 flex-1 overflow-y-auto w-full min-h-0"
      >
        {activeTab === "editor" && (
          <SrtEditorTab
            subtitles={subtitles}
            filename={filename}
            setSubtitles={setSubtitles}
            setFilename={setFilename}
            onNext={() => handleSelectTab("maker")}
          />
        )}
      </main>
      </div>
    </div>
  );
}
