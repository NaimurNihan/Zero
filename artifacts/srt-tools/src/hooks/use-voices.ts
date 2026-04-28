import { useEffect, useState } from "react";
import type { EdgeVoice } from "@/components/editor/voice-picker";

let cache: EdgeVoice[] | null = null;
let inflight: Promise<EdgeVoice[]> | null = null;
const subscribers = new Set<(voices: EdgeVoice[]) => void>();

function loadVoices(): Promise<EdgeVoice[]> {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = fetch(`${import.meta.env.BASE_URL}api/tts/voices`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      const voices: EdgeVoice[] = Array.isArray(data?.voices) ? data.voices : [];
      cache = voices;
      subscribers.forEach((cb) => {
        try {
          cb(voices);
        } catch {
          // ignore subscriber errors
        }
      });
      return voices;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

export function useVoices(): EdgeVoice[] | null {
  const [voices, setVoices] = useState<EdgeVoice[] | null>(cache);

  useEffect(() => {
    let cancelled = false;
    if (cache) {
      if (voices !== cache) setVoices(cache);
      return;
    }
    const cb = (v: EdgeVoice[]) => {
      if (!cancelled) setVoices(v);
    };
    subscribers.add(cb);
    loadVoices().catch(() => {
      // silent — pickers surface their own errors
    });
    return () => {
      cancelled = true;
      subscribers.delete(cb);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return voices;
}

export function getVoiceShortDisplay(voice: EdgeVoice): string {
  const parts = voice.ShortName.split("-");
  const last = parts[parts.length - 1] || voice.ShortName;
  return last.replace(/Neural$/, "").replace(/Multilingual$/, " (Multi)");
}
