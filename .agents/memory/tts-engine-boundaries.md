---
name: TTS engine boundaries
description: Durable distinction between browser speech playback and downloadable TTS audio.
---

Browser SpeechSynthesis is device/browser-dependent and does not provide a reliable direct MP3/WAV export API. Keep it as a live playback engine, while downloadable audio and Audio Pool files use the server-side Microsoft TTS engine.

**Why:** Recording browser speech output as a file is inconsistent across browsers, can require permissions, and can produce different results per device.

**How to apply:** When adding or changing TTS engines, keep playback selection separate from file-generation selection and make unsupported download behavior explicit in the UI.

Microsoft Edge Read Aloud is an undocumented service whose synthesis protocol can change separately from its voice-list API. A successful voice-list request does not prove audio generation works; verify synthesis returns non-empty `audio/mpeg`.

**Why:** The voice list continued to return successfully while Microsoft changed the synthesis endpoint/token requirements, causing every audio-generation request to fail.

**How to apply:** After changing the TTS dependency or request protocol, test a real synthesis request in addition to checking that voices load.
