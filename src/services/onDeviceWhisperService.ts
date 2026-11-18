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

let whisperPipelinePromise: Promise<any> | null = null;
let audioClassifierPipelinePromise: Promise<any> | null = null;
let activeWhisperModelName = 'Xenova/whisper-tiny';

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

/**
 * Strips all punctuation, periods, question marks, numbers, brackets, and non-letter symbols,
 * leaving strictly letters and single spaces, while collapsing repetitive Whisper hallucination loops.
 */
export function sanitizeSubtitleLettersOnly(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') return '';

  // 1. Remove Whisper non-speech tags such as [Music], [BLANK_AUDIO], (Music), *singing*, ♪
  let cleaned = rawText
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ' ');

  // 2. Keep strictly Unicode letters and spaces (NO periods, NO question marks, NO punctuation)
  cleaned = cleaned
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  // 3. Collapse Whisper repetition hallucinations (e.g. "אתה אתה אתה אתה" -> "אתה אתה")
  const words = cleaned.split(' ').filter(Boolean);
  const dedupedWords: string[] = [];
  let repeatCount = 0;
  let prevLower = '';

  for (const w of words) {
    const lower = w.toLowerCase();
    if (lower === prevLower) {
      repeatCount += 1;
      if (repeatCount < 2) {
        dedupedWords.push(w);
      }
    } else {
      repeatCount = 0;
      prevLower = lower;
      dedupedWords.push(w);
    }
  }

  return dedupedWords.join(' ').trim();
}

/**
 * 100% free unlimited En<->He translator: prefers browser on-device Translator API,
 * seamlessly falling back to our free keyless /api/ai/translate-subtitles proxy.
 */
async function translateOnDeviceIfAvailable(
  texts: string[],
  sourceLanguage: 'en' | 'he',
  targetLanguage: 'en' | 'he'
): Promise<string[] | null> {
  if (!texts.length) return null;

  // 1. Try Chrome built-in offline Translator API first
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

  // 2. Fallback: Free unlimited keyless translation proxy (/api/ai/translate-subtitles)
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 5000) : null;
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

/**
 * Normalizes PCM audio cleanly so vocals sit at an optimal amplitude for Whisper.
 */
function normalizePcmForVocals(pcm: Float32Array): Float32Array {
  let maxAbs = 0;
  for (let i = 0; i < pcm.length; i++) {
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

/**
 * Universal linear-interpolation mono mixdown + 16kHz downsampler.
 * Guarantees compatibility on Android 12 & older WebViews where 16kHz OfflineAudioContext throws NotSupportedError.
 */
function fallbackDownsampleDecodedTo16k(decoded: AudioBuffer, maxSeconds: number): Float32Array {
  const srcRate = decoded.sampleRate || 44100;
  const sampleDuration = maxSeconds > 0 ? Math.min(decoded.duration || 180, maxSeconds) : decoded.duration;
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
  const hpAlpha = 0.965; // gentle ~90Hz highpass at 16kHz

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

/**
 * Decodes any audio File/Blob or URL directly on the device into mono 16kHz Float32Array PCM.
 * Works reliably from Android 12 WebView / Chrome up to newest iOS Safari and Desktop.
 */
export async function decodeAudioToMono16k(
  source: File | Blob | string,
  maxSeconds = 260,
  options?: { isolateVocals?: boolean }
): Promise<{ pcm: Float32Array; duration: number }> {
  const isConstrained = isMobileOrConstrainedDevice();
  const maxBytes = isConstrained ? 28 * 1024 * 1024 : 55 * 1024 * 1024;
  let arrayBuffer: ArrayBuffer;

  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`לא ניתן לטעון את קובץ השמע למכשיר (${res.status})`);
    }
    arrayBuffer = await res.arrayBuffer();
  } else {
    const targetSlice =
      maxSeconds > 0 && maxSeconds <= 60 && source.size > 12 * 1024 * 1024
        ? source.slice(0, 12 * 1024 * 1024)
        : source.size > maxBytes
          ? source.slice(0, maxBytes)
          : source;
    arrayBuffer = await targetSlice.arrayBuffer();
  }

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('הדפדפן אינו תומך בפענוח שמע מקומי');
  }

  const decodeCtx = new AudioCtx();
  try {
    // Support both Promise and legacy callback form of decodeAudioData (Android 12 Safari/older engines)
    const decoded: AudioBuffer = await new Promise((resolve, reject) => {
      try {
        const p = decodeCtx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
        if (p && typeof (p as Promise<AudioBuffer>).then === 'function') {
          (p as Promise<AudioBuffer>).then(resolve, reject);
        }
      } catch (err) {
        reject(err);
      }
    });

    const fullDuration = decoded.duration || 180;
    const effectiveMaxSec = isConstrained ? Math.min(maxSeconds, 240) : maxSeconds;
    const sampleDuration = effectiveMaxSec > 0 ? Math.min(decoded.duration, effectiveMaxSec) : decoded.duration;
    const targetLength = Math.max(1600, Math.floor(sampleDuration * 16000));

    try {
      const OfflineCtx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
      if (!OfflineCtx) {
        const manualPcm = fallbackDownsampleDecodedTo16k(decoded, sampleDuration);
        return { pcm: options?.isolateVocals ? normalizePcmForVocals(manualPcm) : manualPcm, duration: fullDuration };
      }

      const offlineCtx = new OfflineCtx(1, targetLength, 16000);
      const bufferSource = offlineCtx.createBufferSource();
      bufferSource.buffer = decoded;

      if (options?.isolateVocals) {
        const highpass = offlineCtx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 90;
        highpass.Q.value = 0.7;
        bufferSource.connect(highpass);
        highpass.connect(offlineCtx.destination);
      } else {
        bufferSource.connect(offlineCtx.destination);
      }
      bufferSource.start(0);

      const rendered = await offlineCtx.startRendering();
      const rawChannel = rendered.getChannelData(0);
      return {
        pcm: options?.isolateVocals ? normalizePcmForVocals(rawChannel) : rawChannel,
        duration: fullDuration,
      };
    } catch {
      // Fallback for older Android WebViews rejecting 16kHz OfflineAudioContext
      const manualPcm = fallbackDownsampleDecodedTo16k(decoded, sampleDuration);
      return {
        pcm: options?.isolateVocals ? normalizePcmForVocals(manualPcm) : manualPcm,
        duration: fullDuration,
      };
    }
  } finally {
    decodeCtx.close().catch(() => {});
  }
}

const yieldToUI = (ms = 24) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Loads device-optimal On-Device Whisper AI pipeline:
 * - Mobile / Android 12 / <=6GB RAM: Whisper Tiny (~40MB) for fast real-time playback sync & zero OOM crashes.
 * - Desktop (>6GB RAM): Whisper Base (~75MB) with automatic Whisper Tiny fallback.
 */
async function getOnDeviceWhisperPipeline(
  onProgress?: (statusText: string, percent?: number) => void
) {
  if (!whisperPipelinePromise) {
    whisperPipelinePromise = (async () => {
      const mobileOrConstrained = isMobileOrConstrainedDevice();
      const candidates = mobileOrConstrained
        ? [
            { id: 'Xenova/whisper-tiny', label: 'Whisper Fast' },
          ]
        : [
            { id: 'Xenova/whisper-base', label: 'Whisper Base' },
            { id: 'Xenova/whisper-tiny', label: 'Whisper Fast' },
          ];

      onProgress?.(
        mobileOrConstrained
          ? 'מכין מנוע כתוביות מהיר למכשיר נייד...'
          : 'מכין מנוע כתוביות בזמן אמת למכשיר...',
        6
      );

      const loadModel = async (modelId: string, label: string, dtype: 'q8' | 'fp32') =>
        pipeline('automatic-speech-recognition', modelId, {
          dtype,
          device: 'wasm',
          progress_callback: (info: any) => {
            if (info?.status === 'progress' && typeof info.progress === 'number') {
              const rawPct = Math.min(100, Math.max(0, info.progress));
              const scaled = Math.min(48, Math.max(6, Math.round(6 + rawPct * 0.42)));
              onProgress?.(`מוריד ושומר מנוע כתוביות (${Math.round(rawPct)}%)`, scaled);
            } else if (info?.status === 'initiate' || info?.status === 'download') {
              onProgress?.(`מתחבר להורדת מנוע ${label}...`, 8);
            } else if (info?.status === 'ready') {
              onProgress?.(`מנוע הכתוביות מוכן`, 50);
            }
          },
        });

      let lastErr: any = null;
      for (const candidate of candidates) {
        for (const dtype of ['q8', 'fp32'] as const) {
          try {
            activeWhisperModelName = candidate.id;
            const loaded = await loadModel(candidate.id, candidate.label, dtype);
            onProgress?.('מנוע הכתוביות מוכן — מתמלל בזמן אמת...', 50);
            return loaded;
          } catch (err) {
            lastErr = err;
            console.warn(`[OnDeviceWhisper] Failed ${candidate.id} (${dtype}):`, err);
          }
        }
      }

      throw lastErr || new Error('לא ניתן היה לטעון את מנוע הכתוביות על מכשיר זה');
    })().catch((err) => {
      whisperPipelinePromise = null;
      throw err;
    });
  } else {
    onProgress?.('מנוע הכתוביות מוכן — מתחיל תמלול בזמן אמת...', 48);
  }

  return whisperPipelinePromise;
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

function buildSanitizedSegmentsFromResult(
  result: any,
  windowOffsetSec: number,
  windowDurationSec: number,
  totalDuration: number,
  idPrefix: string
): SubtitleSegment[] {
  const rawChunks: Array<{ timestamp?: [number | null, number | null]; text?: string }> =
    Array.isArray(result?.chunks) ? result.chunks : [];

  let segments: SubtitleSegment[] = [];
  rawChunks.forEach((chunk, idx) => {
    const cleanText = sanitizeSubtitleLettersOnly(String(chunk?.text || ''));
    if (!cleanText || isHallucinationPhrase(cleanText)) return;

    const localStart = typeof chunk.timestamp?.[0] === 'number' ? chunk.timestamp[0] : idx * 3;
    const nextLocalStart =
      typeof rawChunks[idx + 1]?.timestamp?.[0] === 'number'
        ? rawChunks[idx + 1].timestamp![0]!
        : localStart + 3.2;
    const localEnd =
      typeof chunk.timestamp?.[1] === 'number' && chunk.timestamp[1]! > localStart
        ? chunk.timestamp[1]!
        : Math.min(windowDurationSec, Math.max(localStart + 1.0, nextLocalStart));

    const absStart = Math.max(0, windowOffsetSec + localStart);
    const absEnd = Math.min(totalDuration, Math.max(absStart + 0.8, windowOffsetSec + localEnd));

    const prevSeg = segments[segments.length - 1];
    if (prevSeg && prevSeg.text.toLowerCase() === cleanText.toLowerCase()) {
      prevSeg.endTime = Number(Math.max(prevSeg.endTime, absEnd).toFixed(2));
      return;
    }

    segments.push({
      id: `${idPrefix}_${segments.length}`,
      startTime: Number(absStart.toFixed(2)),
      endTime: Number(absEnd.toFixed(2)),
      text: cleanText,
    });
  });

  if (segments.length === 0) {
    const rawFull = String(result?.text || '').trim();
    const rawParts = rawFull
      .split(/[\n.!?]+/)
      .map((s) => sanitizeSubtitleLettersOnly(s))
      .filter((p) => p && !isHallucinationPhrase(p));

    if (rawParts.length > 0) {
      const step = Math.max(1.8, windowDurationSec / Math.max(1, rawParts.length));
      segments = rawParts.map((text, idx) => {
        const absStart = windowOffsetSec + idx * step;
        const absEnd = Math.min(totalDuration, windowOffsetSec + (idx + 1) * step);
        return {
          id: `${idPrefix}_${idx}`,
          startTime: Number(absStart.toFixed(2)),
          endTime: Number(Math.max(absStart + 0.8, absEnd).toFixed(2)),
          text,
        };
      });
    }
  }

  return segments;
}

function computeChunkRms(samples: Float32Array): number {
  let sumSq = 0;
  const step = Math.max(1, Math.floor(samples.length / 2000));
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    const v = samples[i];
    sumSq += v * v;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

function mergeOrderedSegments(allSegments: SubtitleSegment[]): SubtitleSegment[] {
  const sorted = [...allSegments].sort((a, b) => a.startTime - b.startTime);
  const merged: SubtitleSegment[] = [];
  for (const seg of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && seg.startTime < prev.endTime - 0.25) {
      const prevWords = new Set(prev.text.toLowerCase().split(/\s+/));
      const curWords = seg.text.toLowerCase().split(/\s+/);
      const overlapHits = curWords.filter((w) => prevWords.has(w)).length;
      if (overlapHits >= Math.max(1, Math.floor(curWords.length * 0.5)) || prev.text.toLowerCase() === seg.text.toLowerCase()) {
        prev.endTime = Number(Math.max(prev.endTime, seg.endTime).toFixed(2));
        if (seg.text.length > prev.text.length + 4 && seg.startTime >= prev.startTime) {
          prev.text = seg.text;
        }
        continue;
      }
    }
    if (prev && prev.text.toLowerCase() === seg.text.toLowerCase() && seg.startTime - prev.endTime < 2.0) {
      prev.endTime = Number(Math.max(prev.endTime, seg.endTime).toFixed(2));
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

/**
 * Generates real-time YouTube-style live streaming dual-language subtitles on ALL devices (Android 12 through newest Desktop/iOS).
 * Prioritizes chunks starting at `startTimeSeconds` (current playback position) and emits live incremental segments via `onPartialSegments`.
 */
export async function transcribeAudioOnDevice(options: {
  audioFile?: File | Blob | null;
  audioUrl?: string;
  language?: 'he' | 'en';
  subtitleLanguageHint?: 'auto' | 'he' | 'en';
  trackDuration?: number;
  hintTitle?: string;
  startTimeSeconds?: number;
  onProgress?: (statusText: string, percent?: number) => void;
  onPartialSegments?: (partial: LivePartialSubtitlesPayload) => void;
}): Promise<{
  success: boolean;
  segments?: SubtitleSegment[];
  segmentsHe?: SubtitleSegment[];
  segmentsEn?: SubtitleSegment[];
  lyrics?: string;
  lyricsHe?: string;
  lyricsEn?: string;
  provider?: string;
  error?: string;
}> {
  try {
    const source = options.audioFile || options.audioUrl;
    if (!source) {
      return { success: false, error: 'לא נבחר קובץ שמע לתמלול מקומי' };
    }

    options.onProgress?.('מפענח שמע בצורה מהירה במכשיר...', 3);
    const { pcm, duration } = await decodeAudioToMono16k(source, 260, { isolateVocals: true });
    const totalDuration = options.trackDuration && options.trackDuration > 10 ? options.trackDuration : duration || 180;

    const transcriber = await getOnDeviceWhisperPipeline(options.onProgress);
    await yieldToUI(20);

    // Compact 12-second windows (10s stride, 2s overlap) emit live lines within ~2-4 seconds per chunk across all devices!
    const SAMPLE_RATE = 16000;
    const CHUNK_SECONDS = 12;
    const STRIDE_SECONDS = 10;
    const CHUNK_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE;
    const STRIDE_SAMPLES = STRIDE_SECONDS * SAMPLE_RATE;
    const totalChunks = Math.max(1, Math.ceil(Math.max(0, pcm.length - CHUNK_SAMPLES) / STRIDE_SAMPLES) + 1);

    // Order chunks starting from current playback position -> forward to end -> back-fill beginning
    const startSec = Math.max(0, Number(options.startTimeSeconds || 0));
    const startIdx = Math.min(totalChunks - 1, Math.max(0, Math.floor(startSec / STRIDE_SECONDS)));
    const orderedChunkIndices: number[] = [];
    for (let i = startIdx; i < totalChunks; i++) orderedChunkIndices.push(i);
    for (let i = 0; i < startIdx; i++) orderedChunkIndices.push(i);

    const titleHasHebrew = /[\u0590-\u05FF]/.test(options.hintTitle || '');
    let lockedWhisperLang: 'hebrew' | 'english' | undefined =
      options.subtitleLanguageHint === 'he'
        ? 'hebrew'
        : options.subtitleLanguageHint === 'en'
          ? 'english'
          : titleHasHebrew
            ? 'hebrew'
            : undefined;

    const rawSegments: SubtitleSegment[] = [];
    const translationCache = new Map<string, string>();
    let completedChunks = 0;

    const buildBilingualSnapshot = (orderedRaw: SubtitleSegment[], liveTranslateFallback = true) => {
      const hebrewCount = orderedRaw.reduce((acc, s) => acc + (s.text.match(/[\u0590-\u05FF]/g)?.length || 0), 0);
      const latinCount = orderedRaw.reduce((acc, s) => acc + (s.text.match(/[a-zA-Z]/g)?.length || 0), 0);
      const detectedPrimaryIsHe = lockedWhisperLang === 'english' ? false : lockedWhisperLang === 'hebrew' ? true : hebrewCount >= latinCount;

      if (detectedPrimaryIsHe) {
        const segmentsHe = orderedRaw.map((s, idx) => ({ ...s, id: `whisper_he_${idx}` }));
        const segmentsEn = segmentsHe.map((s, idx) => ({
          id: `whisper_en_${idx}`,
          startTime: s.startTime,
          endTime: s.endTime,
          text: translationCache.get(`he->en:${s.text}`) || (liveTranslateFallback ? s.text : s.text),
        }));
        return { detectedPrimaryIsHe, segmentsHe, segmentsEn };
      } else {
        const segmentsEn = orderedRaw.map((s, idx) => ({ ...s, id: `whisper_en_${idx}` }));
        const segmentsHe = segmentsEn.map((s, idx) => ({
          id: `whisper_he_${idx}`,
          startTime: s.startTime,
          endTime: s.endTime,
          text: translationCache.get(`en->he:${s.text}`) || (liveTranslateFallback ? s.text : s.text),
        }));
        return { detectedPrimaryIsHe, segmentsHe, segmentsEn };
      }
    };

    for (const i of orderedChunkIndices) {
      const startSample = i * STRIDE_SAMPLES;
      if (startSample >= pcm.length) {
        completedChunks++;
        continue;
      }
      const endSample = Math.min(pcm.length, startSample + CHUNK_SAMPLES);
      const chunkPcm = pcm.subarray(startSample, endSample);
      const offsetSec = startSample / SAMPLE_RATE;
      const chunkDurSec = chunkPcm.length / SAMPLE_RATE;

      const pct = Math.min(92, Math.max(52, Math.round(52 + ((completedChunks + 1) / totalChunks) * 40)));
      options.onProgress?.(
        `יוצר כתוביות תוך כדי נגינה (${completedChunks + 1}/${totalChunks})...`,
        pct
      );
      await yieldToUI(28);

      if (computeChunkRms(chunkPcm) < 0.008 || chunkDurSec < 0.8) {
        completedChunks++;
        continue;
      }

      try {
        const decodeOptions: Record<string, any> = {
          return_timestamps: true,
          max_new_tokens: 140,
          repetition_penalty: 1.05,
          no_repeat_ngram_size: 4,
          condition_on_prev_tokens: false,
          task: 'transcribe',
        };
        if (lockedWhisperLang) {
          decodeOptions.language = lockedWhisperLang;
        }

        const chunkResult: any = await transcriber(chunkPcm, decodeOptions);
        const chunkSegs = buildSanitizedSegmentsFromResult(
          chunkResult,
          offsetSec,
          chunkDurSec,
          totalDuration,
          `whisper_c${i}`
        );

        if (!lockedWhisperLang && chunkSegs.length > 0 && (!options.subtitleLanguageHint || options.subtitleLanguageHint === 'auto')) {
          const joined = chunkSegs.map((s) => s.text).join(' ');
          const heChars = (joined.match(/[\u0590-\u05FF]/g) || []).length;
          const enChars = (joined.match(/[a-zA-Z]/g) || []).length;
          if (heChars >= 5 && heChars > enChars * 1.4) {
            lockedWhisperLang = 'hebrew';
          } else if (enChars >= 7 && enChars > heChars * 1.4) {
            lockedWhisperLang = 'english';
          }
        }

        if (chunkSegs.length > 0) {
          rawSegments.push(...chunkSegs);
          const orderedNow = mergeOrderedSegments(rawSegments);

          // Opportunistically translate only newly added lines if viewer chose opposite language, fast non-blocking batch
          const isHeAudio = lockedWhisperLang === 'english' ? false : lockedWhisperLang === 'hebrew' ? true : /[\u0590-\u05FF]/.test(chunkSegs.map((c) => c.text).join(''));
          const pairPrefix = isHeAudio ? 'he->en:' : 'en->he:';
          const missingTexts = chunkSegs.map((c) => c.text).filter((txt) => !translationCache.has(pairPrefix + txt));
          if (missingTexts.length > 0 && ((options.language === 'en' && isHeAudio) || (options.language !== 'en' && !isHeAudio))) {
            const tr = await translateOnDeviceIfAvailable(missingTexts, isHeAudio ? 'he' : 'en', isHeAudio ? 'en' : 'he').catch(() => null);
            if (tr) {
              missingTexts.forEach((srcTxt, idx) => {
                if (tr[idx]) translationCache.set(pairPrefix + srcTxt, tr[idx]);
              });
            }
          }

          const liveSnap = buildBilingualSnapshot(orderedNow, true);
          const lyricsHe = liveSnap.segmentsHe.map((s) => s.text).join('\n');
          const lyricsEn = liveSnap.segmentsEn.map((s) => s.text).join('\n');
          options.onPartialSegments?.({
            segments: options.language === 'en' ? liveSnap.segmentsEn : liveSnap.segmentsHe,
            segmentsHe: liveSnap.segmentsHe,
            segmentsEn: liveSnap.segmentsEn,
            lyricsHe,
            lyricsEn,
            completedChunks: completedChunks + 1,
            totalChunks,
          });
        }
      } catch (chunkErr) {
        console.warn(`[OnDeviceWhisper] Chunk ${i + 1} notice:`, chunkErr);
      }

      completedChunks++;
      await yieldToUI(32);
    }

    const finalOrdered = mergeOrderedSegments(rawSegments);
    if (finalOrdered.length === 0) {
      return {
        success: false,
        error: 'לא זוהו מילים ברורות בשמע זה — ודא שיש שירה ברורה או הזן כתוביות ידנית',
      };
    }

    // Complete full bilingual translation pass cleanly before persisting permanently
    const hebrewCount = finalOrdered.reduce((acc, s) => acc + (s.text.match(/[\u0590-\u05FF]/g)?.length || 0), 0);
    const latinCount = finalOrdered.reduce((acc, s) => acc + (s.text.match(/[a-zA-Z]/g)?.length || 0), 0);
    const detectedPrimaryIsHe = lockedWhisperLang === 'english' ? false : lockedWhisperLang === 'hebrew' ? true : hebrewCount >= latinCount;

    let segmentsHe: SubtitleSegment[] = [];
    let segmentsEn: SubtitleSegment[] = [];

    options.onProgress?.('שומר ומסיים סנכרון כתוביות מלא...', 95);
    await yieldToUI(15);

    if (detectedPrimaryIsHe) {
      segmentsHe = finalOrdered.map((s, idx) => ({ ...s, id: `whisper_he_${idx}` }));
      const uncachedHe = segmentsHe.map((s) => s.text).filter((t) => !translationCache.has(`he->en:${t}`));
      if (uncachedHe.length > 0) {
        const tr = await translateOnDeviceIfAvailable(uncachedHe, 'he', 'en').catch(() => null);
        if (tr) {
          uncachedHe.forEach((txt, idx) => {
            if (tr[idx]) translationCache.set(`he->en:${txt}`, tr[idx]);
          });
        }
      }
      segmentsEn = segmentsHe.map((seg, idx) => ({
        id: `whisper_en_${idx}`,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: translationCache.get(`he->en:${seg.text}`) || seg.text,
      }));
    } else {
      segmentsEn = finalOrdered.map((s, idx) => ({ ...s, id: `whisper_en_${idx}` }));
      const uncachedEn = segmentsEn.map((s) => s.text).filter((t) => !translationCache.has(`en->he:${t}`));
      if (uncachedEn.length > 0) {
        const tr = await translateOnDeviceIfAvailable(uncachedEn, 'en', 'he').catch(() => null);
        if (tr) {
          uncachedEn.forEach((txt, idx) => {
            if (tr[idx]) translationCache.set(`en->he:${txt}`, tr[idx]);
          });
        }
      }
      segmentsHe = segmentsEn.map((seg, idx) => ({
        id: `whisper_he_${idx}`,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: translationCache.get(`en->he:${seg.text}`) || seg.text,
      }));
    }

    const lyricsHe = segmentsHe.map((s) => s.text).join('\n');
    const lyricsEn = segmentsEn.map((s) => s.text).join('\n');
    const primarySegments = options.language === 'en' ? segmentsEn : segmentsHe;
    const primaryLyrics = options.language === 'en' ? lyricsEn : lyricsHe;

    options.onProgress?.('הכתוביות מוכנות ונשמרו באחסון', 100);

    return {
      success: true,
      segments: primarySegments,
      segmentsHe,
      segmentsEn,
      lyrics: primaryLyrics,
      lyricsHe,
      lyricsEn,
      provider: activeWhisperModelName,
    };
  } catch (err: any) {
    console.error('[OnDeviceWhisper] Error:', err);
    return {
      success: false,
      error: err?.message || 'שגיאה ביצירת כתוביות מקומיות על המכשיר',
    };
  }
}
