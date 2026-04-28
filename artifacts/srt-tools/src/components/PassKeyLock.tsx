import { useEffect, useRef, useState } from "react";

const PASS_KEY = "943";
const STORAGE_KEY = "srt-tools-unlocked";

type Props = {
  unlocked: boolean;
  onUnlock: () => void;
  onLock: () => void;
};

export default function PassKeyLock({ unlocked, onUnlock, onLock }: Props) {
  const [digits, setDigits] = useState<string[]>(["", "", ""]);
  const [error, setError] = useState(false);
  const inputs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  useEffect(() => {
    if (!unlocked) {
      setDigits(["", "", ""]);
      setError(false);
    }
  }, [unlocked]);

  const handleChange = (idx: number, value: string) => {
    const v = value.replace(/[^0-9]/g, "").slice(-1);
    const next = [...digits];
    next[idx] = v;
    setDigits(next);
    setError(false);

    if (v && idx < 2) {
      inputs[idx + 1].current?.focus();
    }

    if (next.every((d) => d !== "")) {
      const code = next.join("");
      if (code === PASS_KEY) {
        try {
          localStorage.setItem(STORAGE_KEY, "1");
        } catch {}
        onUnlock();
      } else {
        setError(true);
        setTimeout(() => {
          setDigits(["", "", ""]);
          setError(false);
          inputs[0].current?.focus();
        }, 600);
      }
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[idx] && idx > 0) {
      inputs[idx - 1].current?.focus();
    }
  };

  const handleLockClick = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    onLock();
  };

  if (unlocked) {
    return (
      <button
        onClick={handleLockClick}
        title="Click to lock"
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 hover:bg-green-100 dark:hover:bg-green-900 transition-colors shrink-0"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        <span className="text-[0.7rem] font-semibold text-green-600 dark:text-green-400">
          Active
        </span>
      </button>
    );
  }

  return (
    <div
      className={`flex items-center gap-1 shrink-0 ${error ? "animate-shake" : ""}`}
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={inputs[i]}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          autoFocus={i === 0}
          className={`w-6 h-6 text-center text-xs font-bold rounded border transition-colors ${
            error
              ? "border-red-500 bg-red-50 dark:bg-red-950 text-red-600"
              : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:outline-none"
          }`}
        />
      ))}
    </div>
  );
}
