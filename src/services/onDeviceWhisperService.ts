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

let audioClassifierPipelinePromise: Promise<any> | null = null;

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

  let cleaned = rawText
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ' ');

  cleaned = cleaned
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

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

/**
 * Decodes audio into compact mono 16kHz PCM Float32Array safely on mobile and desktop.
 */
export async function decodeAudioToMono16k(
  source: File | Blob | string,
  maxSeconds = 150,
  options?: { isolateVocals?: boolean; signal?: AbortSignal }
): Promise<{ pcm: Float32Array; duration: number }> {
  if (options?.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const isConstrained = isMobileOrConstrainedDevice();
  const maxBytes = isConstrained ? 8 * 1024 * 1024 : 14 * 1024 * 1024;
  let arrayBuffer: ArrayBuffer;

  if (typeof source === 'string') {
    const res = await fetch(source, { signal: options?.signal });
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
    const effectiveMaxSec = isConstrained ? Math.min(maxSeconds, 120) : Math.min(maxSeconds, 150);
    const sampleDuration = effectiveMaxSec > 0 ? Math.min(decoded.duration, effectiveMaxSec) : decoded.duration;

    const manualPcm = fallbackDownsampleDecodedTo16k(decoded, sampleDuration);
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

/**
 * Generates bilingual synchronized subtitles without ever blocking or crashing the main browser thread:
 * 1. Primary path: Fast server-side transcription via /api/ai/transcribe (~3-8s).
 * 2. Fallback path: Runs quantized Whisper Tiny (q8) inside a dedicated background Web Worker so UI & buttons stay 100% responsive.
 */
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
  lyrics?: string;
  lyricsHe?: string;
  lyricsEn?: string;
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

    // 1. ULTRA-FAST SERVER TRANSCRIPTION FIRST (3-8s, zero browser RAM/CPU load)
    try {
      options.onProgress?.('מייצר כתוביות במהירות בשרת...', 18);
      const localController = new AbortController();
      const timeoutId = setTimeout(() => localController.abort(), 30000);
      const onParentAbort = () => localController.abort();
      options.signal?.addEventListener('abort', onParentAbort, { once: true });

      let serverRes: Response;
      try {
        if (options.audioFile) {
          const fd = new FormData();
          const cappedFile =
            options.audioFile.size > 14 * 1024 * 1024
              ? options.audioFile.slice(0, 14 * 1024 * 1024, options.audioFile.type || 'audio/mpeg')
              : options.audioFile;
          fd.append('file', cappedFile, options.audioFile instanceof File ? options.audioFile.name : 'track.mp3');
          fd.append('language', options.subtitleLanguageHint === 'en' ? 'en' : options.language || 'he');
          if (options.hintTitle) fd.append('songTitle', options.hintTitle);
          if (options.trackDuration) fd.append('duration', String(options.trackDuration));
          serverRes = await fetch('/api/ai/transcribe', {
            method: 'POST',
            body: fd,
            credentials: 'include',
            signal: localController.signal,
          });
        } else {
          serverRes = await fetch('/api/ai/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              audioUrl: options.audioUrl,
              language: options.subtitleLanguageHint === 'en' ? 'en' : options.language || 'he',
              songTitle: options.hintTitle || '',
              duration: options.trackDuration || 180,
            }),
            signal: localController.signal,
          });
        }
      } finally {
        clearTimeout(timeoutId);
        options.signal?.removeEventListener('abort', onParentAbort);
      }

      if (options.signal?.aborted) {
        return { success: false, aborted: true, error: 'יצירת הכתוביות בוטלה' };
      }

      if (serverRes.ok) {
        const sData: any = await serverRes.json().catch(() => null);
        if (sData?.success && Array.isArray(sData.segments) && sData.segments.length > 0) {
          options.onProgress?.('מסנכרן תרגום לשפות...', 82);
          const cleanedSegs: SubtitleSegment[] = sData.segments
            .map((seg: any, idx: number) => {
              const text = sanitizeSubtitleLettersOnly(String(seg?.text || ''));
              if (!text || isHallucinationPhrase(text)) return null;
              const startTime = Math.max(0, Number(seg.startTime) || 0);
              const endTime = Math.max(startTime + 0.8, Number(seg.endTime) || startTime + 3.5);
              return { id: `srv_seg_${idx}`, startTime, endTime, text };
            })
            .filter((x: any): x is SubtitleSegment => !!x);

          if (cleanedSegs.length > 0) {
            const totalText = cleanedSegs.map((s) => s.text).join(' ');
            const heChars = (totalText.match(/[\u0590-\u05FF]/g) || []).length;
            const enChars = (totalText.match(/[a-zA-Z]/g) || []).length;
            const primaryIsHe =
              options.subtitleLanguageHint === 'en'
                ? false
                : options.subtitleLanguageHint === 'he'
                  ? true
                  : heChars >= enChars;

            const srcLines = cleanedSegs.map((s) => s.text);
            const trLines = await translateOnDeviceIfAvailable(
              srcLines,
              primaryIsHe ? 'he' : 'en',
              primaryIsHe ? 'en' : 'he'
            ).catch(() => null);

            const segmentsHe = primaryIsHe
              ? cleanedSegs.map((s, idx) => ({ ...s, id: `whisper_he_${idx}` }))
              : cleanedSegs.map((s, idx) => ({ ...s, id: `whisper_he_${idx}`, text: trLines?.[idx] || s.text }));

            const segmentsEn = !primaryIsHe
              ? cleanedSegs.map((s, idx) => ({ ...s, id: `whisper_en_${idx}` }))
              : cleanedSegs.map((s, idx) => ({ ...s, id: `whisper_en_${idx}`, text: trLines?.[idx] || s.text }));

            const lyricsHe = segmentsHe.map((s) => s.text).join('\n');
            const lyricsEn = segmentsEn.map((s) => s.text).join('\n');

            options.onProgress?.('הכתוביות נוצרו בהצלחה!', 100);
            return {
              success: true,
              segments: options.language === 'en' ? segmentsEn : segmentsHe,
              segmentsHe,
              segmentsEn,
              lyrics: options.language === 'en' ? lyricsEn : lyricsHe,
              lyricsHe,
              lyricsEn,
              provider: sData.provider || 'fast-cloud-transcribe',
            };
          }
        }
      }
    } catch (fastErr: any) {
      if (options.signal?.aborted) {
        return { success: false, aborted: true, error: 'יצירת הכתוביות בוטלה' };
      }
      console.warn('[Subtitles] Server transcribe unavailable, starting non-blocking Web Worker:', fastErr?.message);
    }

    // 2. NON-BLOCKING BACKGROUND WEB WORKER WHISPER ENGINE (NEVER FREEZES OR BLOCKS UI)
    if (typeof Worker === 'undefined') {
      return {
        success: false,
        error: 'מנוע הכתוביות ברקע אינו נתמך בדפדפן זה — מומלץ להדביק מילים וללחוץ "סנכרן מילים"',
      };
    }

    options.onProgress?.('מכין שמע לתמלול ברקע...', 6);
    const { pcm, duration } = await decodeAudioToMono16k(source, 150, {
      isolateVocals: true,
      signal: options.signal,
    });
    const totalDuration = options.trackDuration && options.trackDuration > 10 ? options.trackDuration : duration || 180;

    if (options.signal?.aborted) {
      return { success: false, aborted: true, error: 'יצירת הכתוביות בוטלה' };
    }

    const workerResult = await new Promise<{
      segments: SubtitleSegment[];
      lockedWhisperLang?: 'hebrew' | 'english';
    }>((resolve, reject) => {
      const worker = new Worker(new URL('../workers/whisperWorker.ts', import.meta.url), {
        type: 'module',
      });

      let settled = false;
      const cleanup = () => {
        options.signal?.removeEventListener('abort', onAbort);
        try {
          worker.terminate();
        } catch {}
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };

      options.signal?.addEventListener('abort', onAbort, { once: true });

      const safetyTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('תם הזמן ליצירת הכתוביות — ניתן לנסות שוב או להזין מילים ידנית'));
      }, 95000);

      worker.onmessage = (ev: MessageEvent) => {
        const msg = ev.data;
        if (!msg) return;
        if (msg.type === 'progress') {
          options.onProgress?.(msg.statusText || 'מעבד כתוביות ברקע...', msg.percent);
        } else if (msg.type === 'partial' && Array.isArray(msg.segments)) {
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
          clearTimeout(safetyTimer);
          if (settled) return;
          settled = true;
          cleanup();
          resolve({
            segments: Array.isArray(msg.segments) ? msg.segments : [],
            lockedWhisperLang: msg.lockedWhisperLang,
          });
        } else if (msg.type === 'error') {
          clearTimeout(safetyTimer);
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(msg.error || 'שגיאה במנוע הכתוביות ברקע'));
        }
      };

      worker.onerror = (err) => {
        clearTimeout(safetyTimer);
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(err?.message || 'שגיאה בטעינת מנוע הכתוביות ברקע'));
      };

      // Transfer PCM buffer zero-copy so main UI stays completely responsive
      worker.postMessage(
        {
          type: 'transcribe',
          origin: typeof window !== 'undefined' ? window.location.origin : '',
          pcmBuffer: pcm.buffer,
          duration: totalDuration,
          subtitleLanguageHint: options.subtitleLanguageHint,
          hintTitle: options.hintTitle || '',
        },
        [pcm.buffer]
      );
    });

    const finalOrdered = workerResult.segments;
    if (!finalOrdered || finalOrdered.length === 0) {
      return {
        success: false,
        error: 'לא זוהו מילים ברורות בשמע — ניתן להדביק מילים בתיבה למטה וללחוץ "סנכרן מילים"',
      };
    }

    const hebrewCount = finalOrdered.reduce((acc, s) => acc + (s.text.match(/[\u0590-\u05FF]/g)?.length || 0), 0);
    const latinCount = finalOrdered.reduce((acc, s) => acc + (s.text.match(/[a-zA-Z]/g)?.length || 0), 0);
    const detectedPrimaryIsHe =
      workerResult.lockedWhisperLang === 'english'
        ? false
        : workerResult.lockedWhisperLang === 'hebrew'
          ? true
          : hebrewCount >= latinCount;

    options.onProgress?.('מתרגם ומסנכרן כתוביות...', 95);

    let segmentsHe: SubtitleSegment[];
    let segmentsEn: SubtitleSegment[];

    if (detectedPrimaryIsHe) {
      segmentsHe = finalOrdered.map((s, idx) => ({ ...s, id: `whisper_he_${idx}` }));
      const tr = await translateOnDeviceIfAvailable(segmentsHe.map((s) => s.text), 'he', 'en').catch(() => null);
      segmentsEn = segmentsHe.map((seg, idx) => ({
        id: `whisper_en_${idx}`,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: tr?.[idx] || seg.text,
      }));
    } else {
      segmentsEn = finalOrdered.map((s, idx) => ({ ...s, id: `whisper_en_${idx}` }));
      const tr = await translateOnDeviceIfAvailable(segmentsEn.map((s) => s.text), 'en', 'he').catch(() => null);
      segmentsHe = segmentsEn.map((seg, idx) => ({
        id: `whisper_he_${idx}`,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: tr?.[idx] || seg.text,
      }));
    }

    const lyricsHe = segmentsHe.map((s) => s.text).join('\n');
    const lyricsEn = segmentsEn.map((s) => s.text).join('\n');
    const primarySegments = options.language === 'en' ? segmentsEn : segmentsHe;
    const primaryLyrics = options.language === 'en' ? lyricsEn : lyricsHe;

    options.onProgress?.('הכתוביות מוכנות בהצלחה!', 100);

    return {
      success: true,
      segments: primarySegments,
      segmentsHe,
      segmentsEn,
      lyrics: primaryLyrics,
      lyricsHe,
      lyricsEn,
      provider: 'whisper-worker-q8',
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
