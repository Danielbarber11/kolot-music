import { pipeline, env } from '@huggingface/transformers';
import { SubtitleSegment } from '../types';

// Configure Transformers.js to load via our same-origin proxies (zero CORS/redirect Failed to fetch)
// while still running 100% in browser Cache API + WASM (0 API keys, $0 cost)
env.allowLocalModels = false;
env.useBrowserCache = true;
if (typeof window !== 'undefined' && window.location?.origin) {
  env.remoteHost = `${window.location.origin}/api/hf-proxy/`;
  env.remotePathTemplate = '{model}/resolve/{revision}/';
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = `${window.location.origin}/api/onnx-wasm/`;
  }
}
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
  // Single-thread WASM prevents iframe SharedArrayBuffer hangs & older Android WebView thread crashes
  env.backends.onnx.wasm.numThreads = 1;
}

import { primeServerAiStatus, isServerAiConfigured } from '../utils/aiStatusCache';
export { primeServerAiStatus, isServerAiConfigured };

let audioClassifierPipelinePromise: Promise<any> | null = null;
let sharedWhisperWorker: Worker | null = null;
let nextWhisperReqId = 1;

function getOrCreateWhisperWorker(): Worker {
  if (!sharedWhisperWorker) {
    sharedWhisperWorker = new Worker(new URL('../workers/whisperWorker.ts', import.meta.url), {
      type: 'module',
    });
  }
  return sharedWhisperWorker;
}

function disposeWhisperWorker() {
  if (sharedWhisperWorker) {
    try {
      sharedWhisperWorker.terminate();
    } catch {}
    sharedWhisperWorker = null;
  }
}

export interface LivePartialSubtitlesPayload {
  segments: SubtitleSegment[];
  segmentsHe: SubtitleSegment[];
  segmentsEn: SubtitleSegment[];
  lyricsHe: string;
  lyricsEn: string;
  completedChunks: number;
  totalChunks: number;
}

function isMobileOrConstrainedDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const mem = Number((navigator as any).deviceMemory || 0);
  const cores = Number(navigator.hardwareConcurrency || 0);
  if (/Android|iPhone|iPad|iPod|Mobile|Android 1[0-3]/i.test(ua)) return true;
  if (mem > 0 && mem <= 6) return true;
  if (cores > 0 && cores <= 4) return true;
  return false;
}

import { sanitizeSubtitleLettersOnly } from '../utils/subtitleTextUtils';
export { sanitizeSubtitleLettersOnly };

/**
 * 100% free unlimited En<->He translator: prefers browser on-device Translator API,
 * seamlessly falling back to /api/ai/translate-subtitles proxy.
 */
async function translateOnDeviceIfAvailable(
  texts: string[],
  sourceLanguage: 'en' | 'he',
  targetLanguage: 'en' | 'he'
): Promise<string[] | null> {
  if (!texts.length) return null;

  try {
    const g: any = typeof self !== 'undefined' ? self : window;
    const TranslatorCtor = g?.Translator;
    if (TranslatorCtor && typeof TranslatorCtor.create === 'function') {
      let avail = 'readily';
      if (typeof TranslatorCtor.availability === 'function') {
        avail = await TranslatorCtor.availability({ sourceLanguage, targetLanguage });
      }
      if (avail !== 'unavailable') {
        const translator = await TranslatorCtor.create({ sourceLanguage, targetLanguage });
        const out: string[] = [];
        for (const line of texts) {
          if (!line) {
            out.push('');
            continue;
          }
          const res = await translator.translate(line);
          out.push(sanitizeSubtitleLettersOnly(String(res || '')));
        }
        if (out.some((x) => x.length > 0)) return out;
      }
    }
  } catch {}

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 3200) : null;
    const res = await fetch('/api/ai/translate-subtitles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: texts, source: sourceLanguage, target: targetLanguage }),
      signal: controller?.signal,
    });
    if (timer) clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data?.success && Array.isArray(data.translations)) {
        return data.translations.map((t: any) => sanitizeSubtitleLettersOnly(String(t || '')));
      }
    }
  } catch {}

  return null;
}

function normalizePcmForVocals(pcm: Float32Array): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < pcm.length; i += 4) {
    const a = Math.abs(pcm[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs < 0.002 || maxAbs >= 0.88) return pcm;
  const gain = Math.min(6, 0.88 / maxAbs);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = Math.max(-1, Math.min(1, pcm[i] * gain));
  }
  return out;
}

function fallbackDownsampleDecodedTo16k(decoded: AudioBuffer, maxSeconds: number): Float32Array {
  const srcRate = decoded.sampleRate || 44100;
  const sampleDuration = maxSeconds > 0 ? Math.min(decoded.duration || 150, maxSeconds) : decoded.duration;
  const srcLength = Math.min(decoded.length, Math.floor(sampleDuration * srcRate));
  const numCh = Math.max(1, decoded.numberOfChannels || 1);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) {
    channels.push(decoded.getChannelData(c));
  }

  const ratio = srcRate / 16000;
  const dstLength = Math.max(1600, Math.floor(srcLength / ratio));
  const out = new Float32Array(dstLength);

  let hpPrevX = 0;
  let hpPrevY = 0;
  const hpAlpha = 0.965;

  for (let i = 0; i < dstLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.min(srcLength - 1, Math.floor(srcIdx));
    const idx1 = Math.min(srcLength - 1, idx0 + 1);
    const frac = srcIdx - idx0;

    let s0 = 0;
    let s1 = 0;
    for (let c = 0; c < numCh; c++) {
      s0 += channels[c][idx0];
      s1 += channels[c][idx1];
    }
    const sample = (s0 * (1 - frac) + s1 * frac) / numCh;
    const hp = hpAlpha * (hpPrevY + sample - hpPrevX);
    hpPrevX = sample;
    hpPrevY = hp;
    out[i] = hp;
  }

  return out;
}

interface CachedPcmEntry {
  pcm: Float32Array;
  duration: number;
  maxSeconds: number;
}
const decodedBlobPcmCache = new WeakMap<Blob, CachedPcmEntry>();
const decodedUrlPcmCache = new Map<string, CachedPcmEntry>();

function storeUrlPcmCache(urlKey: string, entry: CachedPcmEntry) {
  if (decodedUrlPcmCache.size >= 6) {
    const oldestKey = decodedUrlPcmCache.keys().next().value;
    if (oldestKey) decodedUrlPcmCache.delete(oldestKey);
  }
  decodedUrlPcmCache.set(urlKey, entry);
}

/**
 * Decodes audio into compact mono 16kHz PCM Float32Array safely on mobile and desktop.
 * Reuses cached PCM across classification and transcription fallbacks so AudioContext only runs once.
 */
export async function decodeAudioToMono16k(
  source: File | Blob | string,
  maxSeconds = 150,
  options?: { isolateVocals?: boolean; signal?: AbortSignal; fullSong?: boolean }
): Promise<{ pcm: Float32Array; duration: number }> {
  if (options?.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const isConstrained = isMobileOrConstrainedDevice();
  const isFullSong = Boolean(options?.fullSong || maxSeconds > 120);
  const requestedCapSec = isFullSong
    ? (maxSeconds || 600)
    : (isConstrained ? Math.min(maxSeconds, 44) : Math.min(maxSeconds, 88));

  const cachedEntry = typeof source === 'string'
    ? decodedUrlPcmCache.get(source)
    : decodedBlobPcmCache.get(source);

  if (
    cachedEntry &&
    (cachedEntry.maxSeconds >= requestedCapSec || cachedEntry.duration <= cachedEntry.maxSeconds + 0.5)
  ) {
    const neededSamples = Math.min(cachedEntry.pcm.length, Math.ceil(requestedCapSec * 16000));
    const sliced = neededSamples < cachedEntry.pcm.length
      ? cachedEntry.pcm.subarray(0, neededSamples)
      : cachedEntry.pcm;
    return {
      pcm: options?.isolateVocals ? normalizePcmForVocals(sliced) : sliced,
      duration: cachedEntry.duration,
    };
  }

  const maxBytes = isFullSong
    ? (isConstrained ? 36 * 1024 * 1024 : 60 * 1024 * 1024)
    : (isConstrained ? 4 * 1024 * 1024 : 8 * 1024 * 1024);
  let arrayBuffer: ArrayBuffer;

  if (typeof source === 'string') {
    let res: Response;
    try {
      res = await fetch(source, { signal: options?.signal });
    } catch (fetchErr: any) {
      if (fetchErr?.name === 'AbortError' || options?.signal?.aborted) throw fetchErr;
      throw new Error('לא ניתן לטעון את קובץ השמע לתמלול מקומי — ניתן להדביק מילים וללחוץ "סנכרן כתוביות מהטקסט"');
    }
    if (!res.ok) {
      throw new Error(`לא ניתן לטעון את קובץ השמע למכשיר (${res.status})`);
    }
    const rawBuf = await res.arrayBuffer();
    arrayBuffer = rawBuf.byteLength > maxBytes ? rawBuf.slice(0, maxBytes) : rawBuf;
  } else {
    const targetSlice = source.size > maxBytes ? source.slice(0, maxBytes) : source;
    arrayBuffer = await targetSlice.arrayBuffer();
  }

  if (options?.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('הדפדפן אינו תומך בפענוח שמע מקומי');
  }

  const decodeCtx = new AudioCtx();
  try {
    const decoded: AudioBuffer = await new Promise((resolve, reject) => {
      try {
        const p = decodeCtx.decodeAudioData(arrayBuffer, resolve, reject);
        if (p && typeof (p as Promise<AudioBuffer>).then === 'function') {
          (p as Promise<AudioBuffer>).then(resolve, reject);
        }
      } catch (err) {
        reject(err);
      }
    });

    const fullDuration = decoded.duration || 180;
    const effectiveMaxSec = isFullSong
      ? Math.min(maxSeconds || 600, fullDuration)
      : (isConstrained ? Math.min(maxSeconds, 44) : Math.min(maxSeconds, 88));
    const sampleDuration = effectiveMaxSec > 0 ? Math.min(decoded.duration, effectiveMaxSec) : decoded.duration;

    const manualPcm = fallbackDownsampleDecodedTo16k(decoded, sampleDuration);
    const cacheRecord: CachedPcmEntry = {
      pcm: manualPcm,
      duration: fullDuration,
      maxSeconds: sampleDuration,
    };
    if (typeof source === 'string') {
      storeUrlPcmCache(source, cacheRecord);
    } else {
      decodedBlobPcmCache.set(source, cacheRecord);
    }

    return {
      pcm: options?.isolateVocals ? normalizePcmForVocals(manualPcm) : manualPcm,
      duration: fullDuration,
    };
  } finally {
    decodeCtx.close().catch(() => {});
  }
}

/**
 * Loads or reuses cached On-Device Audio Spectrogram Transformer (Audio Classification) pipeline.
 */
export async function getOnDeviceAudioClassifierPipeline(
  onProgress?: (statusText: string, percent?: number) => void
) {
  if (!audioClassifierPipelinePromise) {
    audioClassifierPipelinePromise = (async () => {
      onProgress?.('טוען מודל זיהוי סגנון מקומי במכשיר...', 10);

      return pipeline('audio-classification', 'Xenova/ast-finetuned-audioset-10-10-0.4593', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (info: any) => {
          if (info?.status === 'progress' && typeof info.progress === 'number') {
            const pct = Math.min(92, Math.max(10, Math.round(info.progress)));
            onProgress?.(`טוען מודל זיהוי שמע מקומי (${pct}%)`, pct);
          }
        },
      });
    })().catch((err) => {
      audioClassifierPipelinePromise = null;
      throw err;
    });
  }

  return audioClassifierPipelinePromise;
}

function isHallucinationPhrase(cleanText: string): boolean {
  const lower = cleanText.toLowerCase().trim();
  if (!lower || lower.length < 2) return true;
  const blockedPatterns = [
    /^תודה שצפיתם/,
    /^תודה על הצפייה/,
    /^תירשמו לערוץ/,
    /^הירשמו לערוץ/,
    /^עשו לייק/,
    /^כתוביות על ידי/,
    /^thank you for watching/,
    /^thanks for watching/,
    /^please subscribe/,
    /^subscribe to/,
    /^subtitles by/,
    /^amara/,
    /^transcribed by/,
    /^music playing$/,
    /^instrumental$/,
  ];
  return blockedPatterns.some((re) => re.test(lower));
}

/**
 * Converts pasted plain lyrics into instant synchronized bilingual subtitle segments in < 10ms (zero lag).
 */
export async function buildInstantSubtitlesFromLyrics(
  rawLyrics: string,
  durationSeconds = 180,
  preferredLanguage: 'he' | 'en' = 'he'
): Promise<{
  success: boolean;
  segments: SubtitleSegment[];
  segmentsHe: SubtitleSegment[];
  segmentsEn: SubtitleSegment[];
  lyricsHe: string;
  lyricsEn: string;
}> {
  const cleanLines = rawLyrics
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]*\]\s*/, '').trim())
    .map((line) => sanitizeSubtitleLettersOnly(line))
    .filter(Boolean);

  if (cleanLines.length === 0) {
    return {
      success: false,
      segments: [],
      segmentsHe: [],
      segmentsEn: [],
      lyricsHe: '',
      lyricsEn: '',
    };
  }

  const dur = Math.max(20, durationSeconds || 180);
  const introOffset = Math.min(6, dur * 0.04);
  const activeSpan = Math.max(15, dur - introOffset - 2);
  const step = activeSpan / cleanLines.length;

  const baseSegments: SubtitleSegment[] = cleanLines.map((text, idx) => {
    const startTime = Number((introOffset + idx * step).toFixed(2));
    const endTime = Number(Math.min(dur, startTime + Math.max(1.5, step)).toFixed(2));
    return { id: `lyrics_seg_${idx}`, startTime, endTime, text };
  });

  const combinedText = cleanLines.join(' ');
  const heCount = (combinedText.match(/[\u0590-\u05FF]/g) || []).length;
  const enCount = (combinedText.match(/[a-zA-Z]/g) || []).length;
  const primaryIsHe = heCount >= enCount;

  const translated = await translateOnDeviceIfAvailable(
    cleanLines,
    primaryIsHe ? 'he' : 'en',
    primaryIsHe ? 'en' : 'he'
  ).catch(() => null);

  const segmentsHe = primaryIsHe
    ? baseSegments.map((s, i) => ({ ...s, id: `lyrics_he_${i}` }))
    : baseSegments.map((s, i) => ({ ...s, id: `lyrics_he_${i}`, text: translated?.[i] || s.text }));

  const segmentsEn = !primaryIsHe
    ? baseSegments.map((s, i) => ({ ...s, id: `lyrics_en_${i}` }))
    : baseSegments.map((s, i) => ({ ...s, id: `lyrics_en_${i}`, text: translated?.[i] || s.text }));

  return {
    success: true,
    segments: preferredLanguage === 'en' ? segmentsEn : segmentsHe,
    segmentsHe,
    segmentsEn,
    lyricsHe: segmentsHe.map((s) => s.text).join('\n'),
    lyricsEn: segmentsEn.map((s) => s.text).join('\n'),
  };
}

function parseClockTimestampSeconds(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':').map((p) => parseFloat(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * Parses uploaded .srt, .vtt, .lrc files or pasted timed/plain lyrics immediately (< 5ms).
 */
export async function parseSubtitleFileContent(
  rawContent: string,
  durationSeconds = 180,
  preferredLanguage: 'he' | 'en' = 'he'
): Promise<{
  success: boolean;
  segments: SubtitleSegment[];
  segmentsHe: SubtitleSegment[];
  segmentsEn: SubtitleSegment[];
  lyricsHe: string;
  lyricsEn: string;
}> {
  const text = (rawContent || '').replace(/^\uFEFF/, '').trim();
  if (!text) {
    return {
      success: false,
      segments: [],
      segmentsHe: [],
      segmentsEn: [],
      lyricsHe: '',
      lyricsEn: '',
    };
  }

  let parsedTimed: SubtitleSegment[] = [];

  // 1. Detect SRT / WebVTT cues (00:00:01,000 --> 00:00:04,500)
  if (/-->/.test(text)) {
    const blocks = text
      .replace(/^WEBVTT[^\n]*\n?/i, '')
      .split(/\r?\n\s*\r?\n/);

    blocks.forEach((block, idx) => {
      const lines = block
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const arrowIdx = lines.findIndex((l) => l.includes('-->'));
      if (arrowIdx < 0) return;

      const timeLine = lines[arrowIdx];
      const [rawStart, rawEndPart] = timeLine.split('-->');
      const rawEnd = (rawEndPart || '').trim().split(/\s+/)[0] || '';
      const startTime = Math.max(0, parseClockTimestampSeconds(rawStart));
      const endTime = Math.max(startTime + 0.8, parseClockTimestampSeconds(rawEnd) || startTime + 3.5);
      const captionRaw = lines.slice(arrowIdx + 1).join(' ').replace(/<[^>]+>/g, ' ');
      const cleanLine = sanitizeSubtitleLettersOnly(captionRaw);
      if (cleanLine) {
        parsedTimed.push({
          id: `sub_cue_${idx}`,
          startTime: Number(startTime.toFixed(2)),
          endTime: Number(endTime.toFixed(2)),
          text: cleanLine,
        });
      }
    });
  }

  // 2. Detect LRC lines ([01:12.34] lyric text)
  if (parsedTimed.length === 0) {
    const lrcLines: SubtitleSegment[] = [];
    const rawRows = text.split(/\r?\n/);
    rawRows.forEach((row, idx) => {
      const m = row.trim().match(/^\[(\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]\s*(.+)$/);
      if (!m) return;
      const startTime = Math.max(0, parseClockTimestampSeconds(m[1]));
      const cleanLine = sanitizeSubtitleLettersOnly(m[2]);
      if (cleanLine) {
        lrcLines.push({
          id: `lrc_cue_${idx}`,
          startTime: Number(startTime.toFixed(2)),
          endTime: Number((startTime + 4).toFixed(2)),
          text: cleanLine,
        });
      }
    });
    if (lrcLines.length > 0) {
      parsedTimed = lrcLines.map((seg, i) => {
        const next = lrcLines[i + 1];
        const end = next && next.startTime > seg.startTime
          ? next.startTime
          : Math.min(Math.max(durationSeconds, seg.startTime + 5), seg.startTime + 5);
        return { ...seg, endTime: Number(end.toFixed(2)) };
      });
    }
  }

  if (parsedTimed.length === 0) {
    return buildInstantSubtitlesFromLyrics(text, durationSeconds, preferredLanguage);
  }

  const combinedText = parsedTimed.map((s) => s.text).join(' ');
  const heCount = (combinedText.match(/[\u0590-\u05FF]/g) || []).length;
  const enCount = (combinedText.match(/[a-zA-Z]/g) || []).length;
  const primaryIsHe = heCount >= enCount;

  const translated = await translateOnDeviceIfAvailable(
    parsedTimed.map((s) => s.text),
    primaryIsHe ? 'he' : 'en',
    primaryIsHe ? 'en' : 'he'
  ).catch(() => null);

  const segmentsHe = primaryIsHe
    ? parsedTimed.map((s, i) => ({ ...s, id: `sub_he_${i}` }))
    : parsedTimed.map((s, i) => ({ ...s, id: `sub_he_${i}`, text: translated?.[i] || s.text }));

  const segmentsEn = !primaryIsHe
    ? parsedTimed.map((s, i) => ({ ...s, id: `sub_en_${i}` }))
    : parsedTimed.map((s, i) => ({ ...s, id: `sub_en_${i}`, text: translated?.[i] || s.text }));

  return {
    success: true,
    segments: preferredLanguage === 'en' ? segmentsEn : segmentsHe,
    segmentsHe,
    segmentsEn,
    lyricsHe: segmentsHe.map((s) => s.text).join('\n'),
    lyricsEn: segmentsEn.map((s) => s.text).join('\n'),
  };
}

function encodePcm16kToWavBlob(pcm: Float32Array): Blob {
  const numSamples = pcm.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function parseBrowserTimedTranscript(raw: string, durationSeconds: number): SubtitleSegment[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed: SubtitleSegment[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\[?(\d{1,2}):(\d{2})(?:\s*[-–]\s*(\d{1,2}):(\d{2}))?\]?\s*(.+)$/);
    if (m) {
      const startTime = Number(m[1]) * 60 + Number(m[2]);
      const endTime =
        m[3] && m[4]
          ? Number(m[3]) * 60 + Number(m[4])
          : Math.min(durationSeconds, startTime + 4);
      const text = sanitizeSubtitleLettersOnly(m[5]);
      if (text && !isHallucinationPhrase(text)) {
        parsed.push({
          id: `chrome_ai_${parsed.length}`,
          startTime: Number(Math.max(0, startTime).toFixed(2)),
          endTime: Number(Math.max(startTime + 0.9, endTime).toFixed(2)),
          text,
        });
      }
    }
  }
  if (parsed.length > 0) return parsed;
  const plainLines = lines
    .map((l) => sanitizeSubtitleLettersOnly(l))
    .filter((t) => t && !isHallucinationPhrase(t));
  if (plainLines.length === 0) return [];
  const step = Math.max(1.8, Math.min(durationSeconds, 90) / plainLines.length);
  return plainLines.map((text, idx) => ({
    id: `chrome_ai_${idx}`,
    startTime: Number((idx * step).toFixed(2)),
    endTime: Number(Math.min(durationSeconds, (idx + 1) * step).toFixed(2)),
    text,
  }));
}

async function tryChromeBuiltInAudioAi(
  pcm: Float32Array,
  totalDuration: number,
  hintTitle?: string,
  subtitleLanguageHint?: 'auto' | 'he' | 'en',
  signal?: AbortSignal
): Promise<SubtitleSegment[] | null> {
  try {
    const lm = (globalThis as any).LanguageModel;
    if (!lm || typeof lm.create !== 'function' || typeof lm.availability !== 'function') {
      return null;
    }
    const avail = await lm.availability({ expectedInputs: [{ type: 'audio' }] }).catch(() => 'unavailable');
    if (avail !== 'available' && avail !== 'readily') {
      return null;
    }
    const maxAudioSamples = Math.min(pcm.length, 90 * 16000);
    const wavBlob = encodePcm16kToWavBlob(pcm.subarray(0, maxAudioSamples));
    const session = await lm.create({
      expectedInputs: [{ type: 'audio' }],
      signal,
    });
    try {
      const langNote =
        subtitleLanguageHint === 'en'
          ? 'English'
          : subtitleLanguageHint === 'he'
            ? 'Hebrew'
            : 'the exact language sung (Hebrew or English)';
      const prompt = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              value:
                `Transcribe the sung lyrics in this audio in ${langNote}. ` +
                `${hintTitle ? `Song title: "${hintTitle}". ` : ''}` +
                `Format each lyric line strictly as [MM:SS - MM:SS] Lyric text with no commentary.`,
            },
            { type: 'audio', value: wavBlob },
          ],
        },
      ];
      const out = await Promise.race([
        session.prompt(prompt, { signal }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Chrome AI timeout')), 15000)),
      ]);
      const segs = parseBrowserTimedTranscript(String(out || ''), totalDuration);
      return segs.length > 0 ? segs : null;
    } finally {
      session.destroy?.();
    }
  } catch {
    return null;
  }
}

async function hasWebGpuQuick(): Promise<boolean> {
  try {
    const gpu = (navigator as any)?.gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') return false;
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter?.features?.has?.('shader-f16'));
  } catch {
    return false;
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
  signal?: AbortSignal
): Promise<Response> {
  let delay = 900;
  let lastResponse: Response | null = null;
  let lastErr: any;
  for (let i = 0; i < maxRetries; i++) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      const response = await fetch(url, { ...init, signal });
      if (response.ok) return response;
      lastResponse = response;
      if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        return response;
      }
      if (response.status === 501 || response.status === 503) {
        const peek = await response.clone().json().catch(() => null);
        const errText = String(peek?.error || '');
        if (peek?.missingKey || /GEMINI_API_KEY|OPENAI_API_KEY/i.test(errText)) {
          return response;
        }
      }
      if (i === maxRetries - 1) {
        return response;
      }
      lastErr = new Error(`שגיאת שרת זמנית (${response.status})`);
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
      lastErr = err;
    }
    if (i < maxRetries - 1) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, delay);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
      delay *= 2;
    }
  }
  if (lastResponse) return lastResponse;
  throw lastErr || new Error('שירות התמלול בענן אינו זמין כרגע');
}

/**
 * Extracts compact 16kHz Mono 16-bit PCM WAV track via AudioContext + OfflineAudioContext
 * for ultra-fast Gemini structured transcription (mirrors user HTML extractFastAudioBase64).
 */
export async function extractFastAudioWavBlob(
  source: File | Blob | string,
  maxSeconds = 400,
  signal?: AbortSignal
): Promise<{ blob: Blob; duration: number } | null> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  let decodeCtx: AudioContext | null = null;
  try {
    let arrayBuffer: ArrayBuffer;
    if (typeof source === 'string') {
      const res = await fetch(source, { signal });
      if (!res.ok) return null;
      arrayBuffer = await res.arrayBuffer();
    } else {
      arrayBuffer = await source.arrayBuffer();
    }

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;

    decodeCtx = new AudioCtx();
    const decodedBuffer: AudioBuffer = await new Promise((resolve, reject) => {
      try {
        const p = decodeCtx!.decodeAudioData(arrayBuffer, resolve, reject);
        if (p && typeof (p as Promise<AudioBuffer>).then === 'function') {
          (p as Promise<AudioBuffer>).then(resolve, reject);
        }
      } catch (err) {
        reject(err);
      }
    });

    const fullDuration = decodedBuffer.duration || 180;
    const renderDuration = maxSeconds > 0 ? Math.min(fullDuration, maxSeconds) : fullDuration;
    const targetRate = 16000;
    const targetLength = Math.max(targetRate, Math.ceil(renderDuration * targetRate));

    let samples: Float32Array;
    const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (OfflineCtx) {
      const offlineCtx = new OfflineCtx(1, targetLength, targetRate);
      const bufferSource = offlineCtx.createBufferSource();
      bufferSource.buffer = decodedBuffer;
      bufferSource.connect(offlineCtx.destination);
      bufferSource.start(0, 0, renderDuration);
      const rendered = await offlineCtx.startRendering();
      samples = rendered.getChannelData(0);
    } else {
      samples = fallbackDownsampleDecodedTo16k(decodedBuffer, renderDuration);
    }

    return {
      blob: encodePcm16kToWavBlob(samples),
      duration: fullDuration,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    return null;
  } finally {
    decodeCtx?.close().catch(() => {});
  }
}

export interface GeminiSubtitlesResult {
  success: boolean;
  aborted?: boolean;
  segments: SubtitleSegment[];
  segmentsHe: SubtitleSegment[];
  segmentsEn: SubtitleSegment[];
  segmentsOrig?: SubtitleSegment[];
  lyrics: string;
  lyricsHe: string;
  lyricsEn: string;
  lyricsOrig?: string;
  detectedLanguageCode?: string;
  detectedLanguageLabel?: string;
  provider?: string;
  error?: string;
}

/**
 * Primary Gemini Structured SRT subtitle generator:
 * Compresses audio to compact 16kHz Mono WAV in browser (when decodable),
 * calls /api/ai/transcribe with exponential backoff, and sanitizes bilingual SRT cues.
 */
export async function generateSubtitlesWithGeminiMethod(options: {
  audioFile?: File | Blob | null;
  audioUrl?: string;
  duration?: number;
  songTitle?: string;
  artistName?: string;
  language?: 'he' | 'en';
  subtitleLanguageHint?: 'auto' | 'he' | 'en';
  signal?: AbortSignal;
}): Promise<GeminiSubtitlesResult> {
  const emptyFail = (error?: string, aborted = false): GeminiSubtitlesResult => ({
    success: false,
    aborted,
    segments: [],
    segmentsHe: [],
    segmentsEn: [],
    lyrics: '',
    lyricsHe: '',
    lyricsEn: '',
    error,
  });

  if (options.signal?.aborted) {
    return emptyFail('יצירת הכתוביות בוטלה', true);
  }

  try {
    const source = options.audioFile || options.audioUrl;
    if (!source) {
      return emptyFail('לא סופק מקור שמע');
    }

    const controller = new AbortController();
    const hardTimeout = setTimeout(() => controller.abort(), 115000);
    const onParentAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onParentAbort, { once: true });

    let serverRes: Response;
    try {
      const langParam = options.subtitleLanguageHint === 'en' ? 'en' : options.language || 'he';
      const defaultDuration = Math.max(10, Math.round(options.duration || 180));

      const isDirectSmallFile = Boolean(
        options.audioFile &&
        options.audioFile.size > 0 &&
        ((!options.audioFile.type.includes('wav') && options.audioFile.size <= 14 * 1024 * 1024) ||
          (options.audioFile.type.includes('wav') && options.audioFile.size <= 10 * 1024 * 1024))
      );

      const isRemoteAudioUrl = Boolean(
        !options.audioFile &&
        options.audioUrl &&
        !/^(?:blob:|data:)/i.test(options.audioUrl)
      );

      if (isDirectSmallFile && options.audioFile) {
        // Fast path 1: Upload compressed local audio (MP3/M4A/AAC/OGG/small WAV) directly without client WAV decode
        const fd = new FormData();
        const fileName = options.audioFile instanceof File ? options.audioFile.name : 'track.mp3';
        fd.append('file', options.audioFile, fileName);
        fd.append('language', langParam);
        if (options.songTitle) fd.append('songTitle', options.songTitle);
        if (options.artistName) fd.append('artistName', options.artistName);
        fd.append('duration', String(defaultDuration));

        serverRes = await fetchWithRetry(
          '/api/ai/transcribe',
          { method: 'POST', body: fd, credentials: 'include' },
          2,
          controller.signal
        );
      } else if (isRemoteAudioUrl && options.audioUrl) {
        // Fast path 2: Remote R2/HTTP URL -> let server/Worker read audio directly from R2 (0 bytes uploaded!)
        serverRes = await fetchWithRetry(
          '/api/ai/transcribe',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              audioUrl: options.audioUrl,
              language: langParam,
              songTitle: options.songTitle || '',
              artistName: options.artistName || '',
              duration: defaultDuration,
            }),
          },
          2,
          controller.signal
        );
      } else {
        // Slow-file fallback: oversized local file (>14MB / big WAV) or blob:/data: URL -> compact WAV extract or sliced upload
        const extracted = await extractFastAudioWavBlob(source, 600, controller.signal).catch(() => null);
        if (options.signal?.aborted) {
          return emptyFail('יצירת הכתוביות בוטלה', true);
        }
        const detectedDuration = Math.max(10, Math.round(extracted?.duration || defaultDuration));

        if (extracted?.blob && extracted.blob.size <= 12 * 1024 * 1024) {
          const fd = new FormData();
          fd.append('file', extracted.blob, 'track-16k.wav');
          fd.append('language', langParam);
          if (options.songTitle) fd.append('songTitle', options.songTitle);
          if (options.artistName) fd.append('artistName', options.artistName);
          fd.append('duration', String(detectedDuration));

          serverRes = await fetchWithRetry(
            '/api/ai/transcribe',
            { method: 'POST', body: fd, credentials: 'include' },
            2,
            controller.signal
          );
        } else if (options.audioFile) {
          const uploadBlob =
            options.audioFile.size > 14 * 1024 * 1024
              ? options.audioFile.slice(0, 14 * 1024 * 1024, options.audioFile.type || 'audio/mpeg')
              : options.audioFile;
          const uploadName = options.audioFile instanceof File ? options.audioFile.name : 'track.mp3';
          const fd = new FormData();
          fd.append('file', uploadBlob, uploadName);
          fd.append('language', langParam);
          if (options.songTitle) fd.append('songTitle', options.songTitle);
          if (options.artistName) fd.append('artistName', options.artistName);
          fd.append('duration', String(detectedDuration));

          serverRes = await fetchWithRetry(
            '/api/ai/transcribe',
            { method: 'POST', body: fd, credentials: 'include' },
            2,
            controller.signal
          );
        } else {
          serverRes = await fetchWithRetry(
            '/api/ai/transcribe',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                audioUrl: options.audioUrl,
                language: langParam,
                songTitle: options.songTitle || '',
                artistName: options.artistName || '',
                duration: detectedDuration,
              }),
            },
            2,
            controller.signal
          );
        }
      }
    } finally {
      clearTimeout(hardTimeout);
      options.signal?.removeEventListener('abort', onParentAbort);
    }

    if (options.signal?.aborted) {
      return emptyFail('יצירת הכתוביות בוטלה', true);
    }

    if (!serverRes.ok) {
      const errBody: any = await serverRes.json().catch(() => null);
      const serverMsg = String(errBody?.error || '').trim();
      const friendlyMsg =
        serverRes.status === 503
          ? (serverMsg || 'שירות התמלול בענן אינו זמין כרגע')
          : (serverMsg || `שגיאה בשרת התמלול (${serverRes.status})`);
      return emptyFail(friendlyMsg);
    }

    const sData: any = await serverRes.json().catch(() => null);
    if (!sData?.success || !Array.isArray(sData.segments) || sData.segments.length === 0) {
      return emptyFail(sData?.error || 'לא זוהו מילים בשמע');
    }

    const normalizeList = (rawList: any[], idPrefix: string): SubtitleSegment[] =>
      rawList
        .map((seg: any, idx: number): SubtitleSegment | null => {
          const text = sanitizeSubtitleLettersOnly(String(seg?.text || ''));
          if (!text || isHallucinationPhrase(text)) return null;
          const startTime = Math.max(0, Number(seg?.startTime) || 0);
          const endTime = Math.max(startTime + 0.8, Number(seg?.endTime) || startTime + 3.5);
          return {
            id: `${idPrefix}_${idx}`,
            startTime: Number(startTime.toFixed(2)),
            endTime: Number(endTime.toFixed(2)),
            text,
          };
        })
        .filter((x): x is SubtitleSegment => x !== null);

    const cleanedBase = normalizeList(sData.segments, 'gem_seg');
    if (cleanedBase.length === 0) {
      return emptyFail('לא זוהו מילים בשמע');
    }

    let segmentsHe =
      Array.isArray(sData.segmentsHe) && sData.segmentsHe.length > 0
        ? normalizeList(sData.segmentsHe, 'gem_he')
        : [];
    let segmentsEn =
      Array.isArray(sData.segmentsEn) && sData.segmentsEn.length > 0
        ? normalizeList(sData.segmentsEn, 'gem_en')
        : [];

    if (segmentsHe.length === 0 && segmentsEn.length === 0) {
      const totalText = cleanedBase.map((s) => s.text).join(' ');
      const heChars = (totalText.match(/[\u0590-\u05FF]/g) || []).length;
      const enChars = (totalText.match(/[a-zA-Z]/g) || []).length;
      const primaryIsHe =
        options.subtitleLanguageHint === 'en'
          ? false
          : options.subtitleLanguageHint === 'he'
            ? true
            : heChars >= enChars;

      const srcLines = cleanedBase.map((s) => s.text);
      const trLines = await translateOnDeviceIfAvailable(
        srcLines,
        primaryIsHe ? 'he' : 'en',
        primaryIsHe ? 'en' : 'he'
      ).catch(() => null);

      segmentsHe = primaryIsHe
        ? cleanedBase.map((s, idx) => ({ ...s, id: `gem_he_${idx}` }))
        : cleanedBase.map((s, idx) => ({ ...s, id: `gem_he_${idx}`, text: trLines?.[idx] || s.text }));

      segmentsEn = !primaryIsHe
        ? cleanedBase.map((s, idx) => ({ ...s, id: `gem_en_${idx}` }))
        : cleanedBase.map((s, idx) => ({ ...s, id: `gem_en_${idx}`, text: trLines?.[idx] || s.text }));
    } else if (segmentsHe.length === 0 && segmentsEn.length > 0) {
      const trLines = await translateOnDeviceIfAvailable(segmentsEn.map((s) => s.text), 'en', 'he').catch(() => null);
      segmentsHe = segmentsEn.map((s, idx) => ({ ...s, id: `gem_he_${idx}`, text: trLines?.[idx] || s.text }));
    } else if (segmentsEn.length === 0 && segmentsHe.length > 0) {
      const trLines = await translateOnDeviceIfAvailable(segmentsHe.map((s) => s.text), 'he', 'en').catch(() => null);
      segmentsEn = segmentsHe.map((s, idx) => ({ ...s, id: `gem_en_${idx}`, text: trLines?.[idx] || s.text }));
    }

    const detectedCode = String(sData.detectedLanguageCode || '').trim().toLowerCase();
    const detectedBase = detectedCode.split('-')[0];
    const detectedLabel = String(sData.detectedLanguageLabel || '').trim();
    const isDetectedNonHeEn = Boolean(detectedBase && detectedBase !== 'he' && detectedBase !== 'iw' && detectedBase !== 'en');

    let segmentsOrig: SubtitleSegment[] | undefined;
    if (isDetectedNonHeEn) {
      const rawOrig = Array.isArray(sData.segmentsOrig) && sData.segmentsOrig.length > 0 ? sData.segmentsOrig : sData.segments;
      const cleanedOrig = normalizeList(rawOrig, 'gem_orig');
      if (cleanedOrig.length > 0) {
        segmentsOrig = cleanedOrig;
      }
    }

    const lyricsHe = segmentsHe.map((s) => s.text).join('\n');
    const lyricsEn = segmentsEn.map((s) => s.text).join('\n');
    const lyricsOrig = segmentsOrig ? segmentsOrig.map((s) => s.text).join('\n') : undefined;
    const isEn = options.language === 'en';

    return {
      success: true,
      segments: isEn ? segmentsEn : segmentsHe,
      segmentsHe,
      segmentsEn,
      ...(segmentsOrig ? { segmentsOrig, lyricsOrig } : {}),
      ...(detectedCode ? { detectedLanguageCode: detectedCode } : {}),
      ...(detectedLabel ? { detectedLanguageLabel: detectedLabel } : {}),
      lyrics: isEn ? lyricsEn : lyricsHe,
      lyricsHe,
      lyricsEn,
      provider: sData.provider || 'gemini-subtitles-srt',
    };
  } catch (err: any) {
    if (err?.name === 'AbortError' || options.signal?.aborted) {
      return emptyFail('יצירת הכתוביות בוטלה', true);
    }
    return emptyFail(err?.message || 'שגיאה ביצירת כתוביות');
  }
}

async function runWorkerOnPcmSlice(options: {
  pcmSlice: Float32Array;
  pcmOffsetSec: number;
  totalDuration: number;
  maxProcessSeconds: number;
  hintTitle?: string;
  subtitleLanguageHint?: 'auto' | 'he' | 'en';
  lockedWhisperLang?: 'hebrew' | 'english';
  signal?: AbortSignal;
  onProgress?: (statusText: string, percent?: number) => void;
  onPartialSegments?: (partial: LivePartialSubtitlesPayload) => void;
}): Promise<{
  segments: SubtitleSegment[];
  lockedWhisperLang?: 'hebrew' | 'english';
  backend?: string;
  processedUpToSec: number;
}> {
  if (typeof Worker === 'undefined') {
    throw new Error('מנוע הכתוביות ברקע אינו נתמך בדפדפן זה');
  }

  return new Promise((resolve, reject) => {
    const worker = getOrCreateWhisperWorker();
    const requestId = nextWhisperReqId++;
    let settled = false;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const clearStallTimer = () => {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    };

    const cleanupListeners = (terminateWorker = false) => {
      clearStallTimer();
      options.signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      if (terminateWorker) {
        disposeWhisperWorker();
      }
    };

    const resetStallWatchdog = () => {
      clearStallTimer();
      stallTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanupListeners(true);
        reject(new Error('מנוע הכתוביות התעכב מעבר לזמן המצופה — נסה שוב'));
      }, 50000);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanupListeners(true);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    resetStallWatchdog();

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || (msg.requestId !== undefined && msg.requestId !== requestId)) return;
      if (msg.type === 'progress') {
        resetStallWatchdog();
        options.onProgress?.(msg.statusText || 'מעבד כתוביות ברקע...', msg.percent);
      } else if (msg.type === 'partial' && Array.isArray(msg.segments)) {
        resetStallWatchdog();
        const partialList: SubtitleSegment[] = msg.segments;
        const partialLyrics = partialList.map((s) => s.text).join('\n');
        options.onPartialSegments?.({
          segments: partialList,
          segmentsHe: partialList,
          segmentsEn: partialList,
          lyricsHe: partialLyrics,
          lyricsEn: '',
          completedChunks: msg.completedChunks || 1,
          totalChunks: msg.totalChunks || 1,
        });
      } else if (msg.type === 'done') {
        if (settled) return;
        settled = true;
        cleanupListeners(false);
        resolve({
          segments: Array.isArray(msg.segments) ? msg.segments : [],
          lockedWhisperLang: msg.lockedWhisperLang,
          backend: msg.backend,
          processedUpToSec: Number(msg.processedUpToSec || options.pcmOffsetSec + options.pcmSlice.length / 16000),
        });
      } else if (msg.type === 'error') {
        if (settled) return;
        settled = true;
        cleanupListeners(true);
        reject(new Error(msg.error || 'שגיאה במנוע הכתוביות ברקע'));
      }
    };

    worker.onerror = (err) => {
      if (settled) return;
      settled = true;
      cleanupListeners(true);
      reject(new Error(err?.message || 'שגיאה בטעינת מנוע הכתוביות ברקע'));
    };

    // Always transfer a clean copy so cached full-song PCM in the caller stays intact
    const transferable = new Float32Array(options.pcmSlice);
    worker.postMessage(
      {
        type: 'transcribe',
        requestId,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        pcmBuffer: transferable.buffer,
        pcmOffsetSec: options.pcmOffsetSec,
        maxProcessSeconds: options.maxProcessSeconds,
        duration: options.totalDuration,
        subtitleLanguageHint: options.subtitleLanguageHint,
        lockedWhisperLang: options.lockedWhisperLang,
        hintTitle: options.hintTitle || '',
        softDeadlineMs: 42000,
      },
      [transferable.buffer]
    );
  });
}

function remapWordsToTranslatedLine(
  translatedText: string,
  seg: SubtitleSegment
): SubtitleSegment['words'] {
  const words = translatedText.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const activeStart = seg.words?.[0]?.startTime ?? seg.startTime;
  const activeEnd = seg.words?.[seg.words.length - 1]?.endTime ?? seg.endTime;
  const span = Math.max(0.35, activeEnd - activeStart);
  const weights = words.map((w) => {
    const clean = w.replace(/[^\p{L}]/gu, '');
    return Math.max(0.5, 0.5 + Math.min(10, clean.length) * 0.22);
  });
  const totalW = weights.reduce((a, b) => a + b, 0) || words.length;
  let cur = activeStart;
  return words.map((text, idx) => {
    const share = (weights[idx] / totalW) * span;
    const s = cur;
    const e = idx === words.length - 1 ? activeStart + span : s + share;
    cur = e;
    return { text, startTime: Number(s.toFixed(2)), endTime: Number(e.toFixed(2)) };
  });
}

async function buildBilingualFromOrdered(
  ordered: SubtitleSegment[],
  lockedLang?: 'hebrew' | 'english',
  preferredLang: 'he' | 'en' = 'he',
  idSalt = 'w'
): Promise<{
  segments: SubtitleSegment[];
  segmentsHe: SubtitleSegment[];
  segmentsEn: SubtitleSegment[];
  lyrics: string;
  lyricsHe: string;
  lyricsEn: string;
}> {
  const hebrewCount = ordered.reduce((acc, s) => acc + (s.text.match(/[\u0590-\u05FF]/g)?.length || 0), 0);
  const latinCount = ordered.reduce((acc, s) => acc + (s.text.match(/[a-zA-Z]/g)?.length || 0), 0);
  const detectedPrimaryIsHe =
    lockedLang === 'english'
      ? false
      : lockedLang === 'hebrew'
        ? true
        : hebrewCount >= latinCount;

  let segmentsHe: SubtitleSegment[];
  let segmentsEn: SubtitleSegment[];

  if (detectedPrimaryIsHe) {
    segmentsHe = ordered.map((s, idx) => ({ ...s, id: `${idSalt}_he_${idx}` }));
    const tr = await translateOnDeviceIfAvailable(segmentsHe.map((s) => s.text), 'he', 'en').catch(() => null);
    segmentsEn = segmentsHe.map((seg, idx) => {
      const trText = tr?.[idx];
      const finalTxt = trText || seg.text;
      return {
        id: `${idSalt}_en_${idx}`,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: finalTxt,
        words: trText ? remapWordsToTranslatedLine(trText, seg) : seg.words,
      };
    });
  } else {
    segmentsEn = ordered.map((s, idx) => ({ ...s, id: `${idSalt}_en_${idx}` }));
    const tr = await translateOnDeviceIfAvailable(segmentsEn.map((s) => s.text), 'en', 'he').catch(() => null);
    segmentsHe = segmentsEn.map((seg, idx) => {
      const trText = tr?.[idx];
      const finalTxt = trText || seg.text;
      return {
        id: `${idSalt}_he_${idx}`,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: finalTxt,
        words: trText ? remapWordsToTranslatedLine(trText, seg) : seg.words,
      };
    });
  }

  const lyricsHe = segmentsHe.map((s) => s.text).join('\n');
  const lyricsEn = segmentsEn.map((s) => s.text).join('\n');
  const primarySegments = preferredLang === 'en' ? segmentsEn : segmentsHe;
  const primaryLyrics = preferredLang === 'en' ? lyricsEn : lyricsHe;

  return {
    segments: primarySegments,
    segmentsHe,
    segmentsEn,
    lyrics: primaryLyrics,
    lyricsHe,
    lyricsEn,
  };
}

/**
 * Transcribes a single time window [windowStartSec .. windowStartSec + windowDurationSec] from cached 16kHz PCM.
 * Returns word-aligned bilingual segments + processedUpToSec for full-song progressive jobs.
 */
export async function transcribePcmWindowOnDevice(options: {
  pcm: Float32Array;
  totalDuration: number;
  windowStartSec: number;
  windowDurationSec?: number;
  language?: 'he' | 'en';
  subtitleLanguageHint?: 'auto' | 'he' | 'en';
  lockedWhisperLang?: 'hebrew' | 'english';
  hintTitle?: string;
  signal?: AbortSignal;
  onProgress?: (statusText: string, percent?: number) => void;
}): Promise<{
  success: boolean;
  aborted?: boolean;
  segments: SubtitleSegment[];
  segmentsHe: SubtitleSegment[];
  segmentsEn: SubtitleSegment[];
  lyrics: string;
  lyricsHe: string;
  lyricsEn: string;
  lockedWhisperLang?: 'hebrew' | 'english';
  processedUpToSec: number;
  provider: string;
}> {
  const SAMPLE_RATE = 16000;
  const gpuAvailable = await hasWebGpuQuick();
  const defaultWindowSec = gpuAvailable ? 66 : 44;
  const windowDur = Math.max(12, options.windowDurationSec || defaultWindowSec);
  const startSample = Math.max(0, Math.floor(options.windowStartSec * SAMPLE_RATE));
  const endSample = Math.min(options.pcm.length, Math.ceil((options.windowStartSec + windowDur) * SAMPLE_RATE));

  if (startSample >= options.pcm.length) {
    return {
      success: true,
      segments: [],
      segmentsHe: [],
      segmentsEn: [],
      lyrics: '',
      lyricsHe: '',
      lyricsEn: '',
      lockedWhisperLang: options.lockedWhisperLang,
      processedUpToSec: options.totalDuration,
      provider: gpuAvailable ? 'whisper-worker-webgpu' : 'whisper-worker-wasm',
    };
  }

  const pcmSlice = options.pcm.subarray(startSample, endSample);
  const workerRes = await runWorkerOnPcmSlice({
    pcmSlice,
    pcmOffsetSec: options.windowStartSec,
    totalDuration: options.totalDuration,
    maxProcessSeconds: Math.ceil(pcmSlice.length / SAMPLE_RATE) + 1,
    hintTitle: options.hintTitle,
    subtitleLanguageHint: options.subtitleLanguageHint,
    lockedWhisperLang: options.lockedWhisperLang,
    signal: options.signal,
    onProgress: options.onProgress,
  });

  if (!workerRes.segments || workerRes.segments.length === 0) {
    return {
      success: true,
      segments: [],
      segmentsHe: [],
      segmentsEn: [],
      lyrics: '',
      lyricsHe: '',
      lyricsEn: '',
      lockedWhisperLang: workerRes.lockedWhisperLang || options.lockedWhisperLang,
      processedUpToSec: workerRes.processedUpToSec,
      provider: workerRes.backend === 'webgpu' ? 'whisper-worker-webgpu' : 'whisper-worker-wasm',
    };
  }

  const bilingual = await buildBilingualFromOrdered(
    workerRes.segments,
    workerRes.lockedWhisperLang || options.lockedWhisperLang,
    options.language || 'he',
    `w_${Math.round(options.windowStartSec)}`
  );

  return {
    success: true,
    ...bilingual,
    lockedWhisperLang: workerRes.lockedWhisperLang || options.lockedWhisperLang,
    processedUpToSec: workerRes.processedUpToSec,
    provider: workerRes.backend === 'webgpu' ? 'whisper-worker-webgpu' : 'whisper-worker-wasm',
  };
}

export async function transcribeAudioOnDevice(options: {
  audioFile?: File | Blob | null;
  audioUrl?: string;
  language?: 'he' | 'en';
  subtitleLanguageHint?: 'auto' | 'he' | 'en';
  trackDuration?: number;
  hintTitle?: string;
  startTimeSeconds?: number;
  signal?: AbortSignal;
  onProgress?: (statusText: string, percent?: number) => void;
  onPartialSegments?: (partial: LivePartialSubtitlesPayload) => void;
}): Promise<{
  success: boolean;
  aborted?: boolean;
  segments?: SubtitleSegment[];
  segmentsHe?: SubtitleSegment[];
  segmentsEn?: SubtitleSegment[];
  segmentsOrig?: SubtitleSegment[];
  lyrics?: string;
  lyricsHe?: string;
  lyricsEn?: string;
  lyricsOrig?: string;
  detectedLanguageCode?: string;
  detectedLanguageLabel?: string;
  provider?: string;
  error?: string;
}> {
  if (options.signal?.aborted) {
    return { success: false, aborted: true, error: 'יצירת הכתוביות בוטלה' };
  }

  try {
    const source = options.audioFile || options.audioUrl;
    if (!source) {
      return { success: false, error: 'לא נבחר קובץ שמע ליצירת כתוביות' };
    }

    // 1. ULTRA-FAST CLOUD SRT WHEN SERVER KEY IS CONFIGURED (gracefully falls through to on-device if unavailable)
    const serverAiReady = await isServerAiConfigured();
    if (serverAiReady) {
      options.onProgress?.('בודק תמלול מהיר בשרת...', 10);
      const geminiResult = await generateSubtitlesWithGeminiMethod({
        audioFile: options.audioFile,
        audioUrl: options.audioUrl,
        duration: options.trackDuration,
        songTitle: options.hintTitle,
        language: options.language,
        subtitleLanguageHint: options.subtitleLanguageHint,
        signal: options.signal,
      }).catch(() => null);
      if (geminiResult?.aborted || options.signal?.aborted) {
        return { success: false, aborted: true, error: 'יצירת הכתוביות בוטלה' };
      }
      if (geminiResult?.success && geminiResult.segments.length > 0) {
        options.onProgress?.('הכתוביות נוצרו בהצלחה!', 100);
        return geminiResult;
      }
    }

    const gpuAvailable = await hasWebGpuQuick();
    options.onProgress?.('מכין את כל השיר לתמלול חינמי בדפדפן...', 12);
    const { pcm, duration } = await decodeAudioToMono16k(source, 600, {
      isolateVocals: true,
      fullSong: true,
      signal: options.signal,
    });
    const actualDecodedDur = Math.max(10, pcm.length / 16000);
    const totalDuration = options.trackDuration && options.trackDuration > 10 ? options.trackDuration : duration || actualDecodedDur || 180;
    const effectiveEnd = Math.min(totalDuration, actualDecodedDur);

    if (options.signal?.aborted) {
      return { success: false, aborted: true, error: 'יצירת הכתוביות בוטלה' };
    }

    // 2. INSTANT BROWSER BUILT-IN AUDIO AI (Chrome Prompt API, 0MB download when active in browser)
    const chromeNativeSegs = await tryChromeBuiltInAudioAi(
      pcm,
      totalDuration,
      options.hintTitle,
      options.subtitleLanguageHint,
      options.signal
    );

    let finalOrdered: SubtitleSegment[] = [];
    let lockedLang: 'hebrew' | 'english' | undefined =
      options.subtitleLanguageHint === 'he'
        ? 'hebrew'
        : options.subtitleLanguageHint === 'en'
          ? 'english'
          : undefined;
    let usedProvider = 'whisper-worker';

    if (chromeNativeSegs && chromeNativeSegs.length > 0) {
      finalOrdered = chromeNativeSegs;
      usedProvider = 'chrome-built-in-audio-ai';
      options.onProgress?.('תומלל במהירות במנוע הדפדפן!', 88);
    } else {
      const BATCH_SEC = gpuAvailable ? 66 : 44;
      let cursor = Math.max(0, options.startTimeSeconds || 0);
      while (cursor < effectiveEnd - 0.8 && !options.signal?.aborted) {
        const startSample = Math.floor(cursor * 16000);
        const endSample = Math.min(pcm.length, Math.ceil((cursor + BATCH_SEC) * 16000));
        if (startSample >= pcm.length) break;
        const pcmSlice = pcm.subarray(startSample, endSample);
        const workerResult = await runWorkerOnPcmSlice({
          pcmSlice,
          pcmOffsetSec: cursor,
          totalDuration: effectiveEnd,
          maxProcessSeconds: Math.ceil(pcmSlice.length / 16000) + 1,
          hintTitle: options.hintTitle,
          subtitleLanguageHint: options.subtitleLanguageHint,
          lockedWhisperLang: lockedLang,
          signal: options.signal,
          onProgress: (statusText, pct) => {
            const overallPct = Math.min(
              92,
              Math.max(15, Math.round(((cursor + ((pct || 50) / 100) * BATCH_SEC) / Math.max(10, effectiveEnd)) * 88))
            );
            options.onProgress?.(statusText, overallPct);
          },
          onPartialSegments: (partial) => {
            const combinedPartial = [...finalOrdered, ...partial.segments].sort((a, b) => a.startTime - b.startTime);
            const partialText = combinedPartial.map((s) => s.text).join('\n');
            options.onPartialSegments?.({
              segments: combinedPartial,
              segmentsHe: combinedPartial,
              segmentsEn: combinedPartial,
              lyricsHe: partialText,
              lyricsEn: '',
              completedChunks: partial.completedChunks,
              totalChunks: Math.max(1, Math.ceil(effectiveEnd / 22)),
            });
          },
        });
        if (workerResult.segments?.length) {
          finalOrdered = [...finalOrdered, ...workerResult.segments].sort((a, b) => a.startTime - b.startTime);
        }
        if (workerResult.lockedWhisperLang && !lockedLang) {
          lockedLang = workerResult.lockedWhisperLang;
        }
        usedProvider = workerResult.backend === 'webgpu' ? 'whisper-worker-webgpu' : 'whisper-worker-wasm';
        const nextPos = workerResult.processedUpToSec > cursor + 2 ? workerResult.processedUpToSec : cursor + BATCH_SEC;
        cursor = nextPos;
      }
    }

    if (!finalOrdered || finalOrdered.length === 0) {
      return {
        success: false,
        error: 'לא זוהו מילים ברורות בשמע — ניתן להדביק מילים בתיבה למטה וללחוץ "סנכרן מילים"',
      };
    }

    options.onProgress?.('מתרגם ומסנכרן כתוביות...', 95);

    const bilingual = await buildBilingualFromOrdered(
      finalOrdered,
      lockedLang,
      options.language || 'he',
      'whisper'
    );

    options.onProgress?.('הכתוביות מוכנות בהצלחה!', 100);

    return {
      success: true,
      ...bilingual,
      provider: usedProvider,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError' || options.signal?.aborted) {
      return { success: false, aborted: true, error: 'יצירת הכתוביות בוטלה' };
    }
    console.error('[Subtitles] Error:', err);
    return {
      success: false,
      error: err?.message || 'שגיאה ביצירת כתוביות — ניתן להדביק מילים ולסנכרן מיידית',
    };
  }
}
