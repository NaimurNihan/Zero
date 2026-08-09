---
name: TTS engine boundaries
description: Durable distinction between browser speech playback and downloadable TTS audio.
---

Browser SpeechSynthesis is device/browser-dependent and does not provide a reliable direct MP3/WAV export API. Keep it as a live playback engine, while downloadable audio and Audio Pool files use the server-side Microsoft TTS engine.

**Why:** Recording browser speech output as a file is inconsistent across browsers, can require permissions, and can produce different results per device.

**How to apply:** When adding or changing TTS engines, keep playback selection separate from file-generation selection and make unsupported download behavior explicit in the UI.