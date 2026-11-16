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
  // Single-thread WASM prevents iframe SharedArrayBuffer hangs when crossOriginIsolated is false
  env.backends.onnx.wasm.numThreads = 1;
}

let whisperPipelinePromise: Promise<any> | null = null;
let audioClassifierPipelinePromise: Promise<any> | null = null;

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
    const res = await fetch('/api/ai/translate-subtitles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: texts, source: sourceLanguage, target: targetLanguage }),
    });
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
 * Decodes any audio File/Blob or URL directly on the device into mono 16kHz Float32Array PCM.
 * Caps huge audio files cleanly so memory stays responsive in-browser.
 */
export async function decodeAudioToMono16k(
  source: File | Blob | string,
  maxSeconds = 240
): Promise<{ pcm: Float32Array; duration: number }> {
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
        : source.size > 60 * 1024 * 1024
          ? source.slice(0, 60 * 1024 * 1024)
          : source;
    arrayBuffer = await targetSlice.arrayBuffer();
  }

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('הדפדפן אינו תומך בפענוח שמע מקומי');
  }

  const decodeCtx = new AudioCtx();
  try {
    const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
    const fullDuration = decoded.duration || 180;
    const sampleDuration = maxSeconds > 0 ? Math.min(decoded.duration, maxSeconds) : decoded.duration;
    const targetLength = Math.max(1600, Math.floor(sampleDuration * 16000));

    const offlineCtx = new OfflineAudioContext(1, targetLength, 16000);
    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = decoded;
    bufferSource.connect(offlineCtx.destination);
    bufferSource.start(0);

    const rendered = await offlineCtx.startRendering();
    return {
      pcm: rendered.getChannelData(0),
      duration: fullDuration,
    };
  } finally {
    decodeCtx.close().catch(() => {});
  }
}

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

/**
 * Loads or reuses cached On-Device Whisper AI pipeline via same-origin proxy + WASM q8 (100% free, zero API keys).
 */
async function getOnDeviceWhisperPipeline(
  onProgress?: (statusText: string, percent?: number) => void
) {
  if (!whisperPipelinePromise) {
    whisperPipelinePromise = (async () => {
      onProgress?.('טוען מודל כתוביות למכשיר (100% חינם)...', 5);

      const loadedPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (info: any) => {
          if (info?.status === 'progress' && typeof info.progress === 'number') {
            const rawPct = Math.min(100, Math.max(0, info.progress));
            const scaled = Math.min(48, Math.max(6, Math.round(6 + rawPct * 0.42)));
            onProgress?.(`מוריד ושומר מודל במכשיר (${Math.round(rawPct)}%)`, scaled);
          } else if (info?.status === 'initiate' || info?.status === 'download') {
            onProgress?.('מתחבר להורדת מודל Whisper למכשיר...', 8);
          } else if (info?.status === 'ready') {
            onProgress?.('מנוע Whisper המקומי מוכן לפעולה', 50);
          }
        },
      });

      onProgress?.('מנוע Whisper המקומי מוכן לפעולה', 50);
      return loadedPipeline;
    })().catch((err) => {
      whisperPipelinePromise = null;
      throw err;
    });
  } else {
    onProgress?.('טוען מנוע כתוביות שמור במכשיר...', 48);
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
    if (!cleanText) return;

    const localStart = typeof chunk.timestamp?.[0] === 'number' ? chunk.timestamp[0] : idx * 4;
    const nextLocalStart =
      typeof rawChunks[idx + 1]?.timestamp?.[0] === 'number'
        ? rawChunks[idx + 1].timestamp![0]!
        : localStart + 4;
    const localEnd =
      typeof chunk.timestamp?.[1] === 'number' && chunk.timestamp[1]! > localStart
        ? chunk.timestamp[1]!
        : Math.min(windowDurationSec, Math.max(localStart + 1.2, nextLocalStart));

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
      .filter(Boolean);

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
  const step = Math.max(1, Math.floor(samples.length / 4000));
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    const v = samples[i];
    sumSq += v * v;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

/**
 * Generates dual-language (Hebrew + English) timestamped subtitles 100% locally on device.
 * Non-blocking chunk-by-chunk decoding with event-loop yields so UI never hangs at 95%.
 * Strictly letters and spaces only — zero punctuation, periods, or question marks.
 */
export async function transcribeAudioOnDevice(options: {
  audioFile?: File | Blob | null;
  audioUrl?: string;
  language?: 'he' | 'en';
  trackDuration?: number;
  hintTitle?: string;
  onProgress?: (statusText: string, percent?: number) => void;
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

    options.onProgress?.('מפענח גלי שמע במכשיר...', 3);
    const { pcm, duration } = await decodeAudioToMono16k(source, 210);
    const totalDuration = options.trackDuration && options.trackDuration > 10 ? options.trackDuration : duration || 180;

    const transcriber = await getOnDeviceWhisperPipeline(options.onProgress);
    await yieldToUI();

    const SAMPLE_RATE = 16000;
    const CHUNK_SECONDS = 24;
    const CHUNK_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE;
    const totalChunks = Math.max(1, Math.ceil(pcm.length / CHUNK_SAMPLES));

    // Decide whether track title/hint strongly indicates Hebrew; otherwise let Whisper auto-detect per audio!
    const titleHasHebrew = /[\u0590-\u05FF]/.test(options.hintTitle || '');

    const rawSegments: SubtitleSegment[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const startSample = i * CHUNK_SAMPLES;
      const endSample = Math.min(pcm.length, startSample + CHUNK_SAMPLES);
      const chunkPcm = pcm.subarray(startSample, endSample);
      const offsetSec = startSample / SAMPLE_RATE;
      const chunkDurSec = chunkPcm.length / SAMPLE_RATE;

      const pct = Math.min(88, Math.max(52, Math.round(52 + ((i + 1) / totalChunks) * 36)));
      options.onProgress?.(`מתמלל שמע במכשיר (חלק ${i + 1} מתוך ${totalChunks})...`, pct);
      await yieldToUI();

      // Skip near-silent chunks to save CPU time and prevent Whisper hallucinations
      if (computeChunkRms(chunkPcm) < 0.004 || chunkDurSec < 0.8) {
        continue;
      }

      try {
        const decodeOptions: Record<string, any> = {
          return_timestamps: true,
          max_new_tokens: 96,
          repetition_penalty: 1.25,
          no_repeat_ngram_size: 3,
          task: 'transcribe',
        };
        if (titleHasHebrew) {
          decodeOptions.language = 'hebrew';
        }

        const chunkResult: any = await transcriber(chunkPcm, decodeOptions);
        const chunkSegs = buildSanitizedSegmentsFromResult(
          chunkResult,
          offsetSec,
          chunkDurSec,
          totalDuration,
          `whisper_c${i}`
        );

        for (const seg of chunkSegs) {
          const prev = rawSegments[rawSegments.length - 1];
          if (prev && prev.text.toLowerCase() === seg.text.toLowerCase()) {
            prev.endTime = Number(Math.max(prev.endTime, seg.endTime).toFixed(2));
          } else {
            rawSegments.push(seg);
          }
        }
      } catch (chunkErr) {
        console.warn(`[OnDeviceWhisper] Chunk ${i + 1} notice:`, chunkErr);
      }

      await yieldToUI();
    }

    // Separate Hebrew vs English and generate companion dual-language subtitles in 1 clean batch
    const hebrewCount = rawSegments.reduce((acc, s) => acc + (s.text.match(/[\u0590-\u05FF]/g)?.length || 0), 0);
    const latinCount = rawSegments.reduce((acc, s) => acc + (s.text.match(/[a-zA-Z]/g)?.length || 0), 0);
    const detectedPrimaryIsHe = hebrewCount >= latinCount;

    let segmentsHe: SubtitleSegment[] = [];
    let segmentsEn: SubtitleSegment[] = [];

    if (rawSegments.length > 0) {
      options.onProgress?.('מתרגם כתוביות לעברית ולאנגלית...', 92);
      await yieldToUI();

      if (detectedPrimaryIsHe) {
        segmentsHe = rawSegments.map((s, idx) => ({ ...s, id: `whisper_he_${idx}` }));
        const translatedEn = await translateOnDeviceIfAvailable(
          segmentsHe.map((s) => s.text),
          'he',
          'en'
        );
        segmentsEn = segmentsHe.map((seg, idx) => ({
          id: `whisper_en_${idx}`,
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: translatedEn?.[idx] || seg.text,
        }));
      } else {
        segmentsEn = rawSegments.map((s, idx) => ({ ...s, id: `whisper_en_${idx}` }));
        const translatedHe = await translateOnDeviceIfAvailable(
          segmentsEn.map((s) => s.text),
          'en',
          'he'
        );
        segmentsHe = segmentsEn.map((seg, idx) => ({
          id: `whisper_he_${idx}`,
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: translatedHe?.[idx] || seg.text,
        }));
      }
    }

    if (segmentsHe.length === 0 && segmentsEn.length === 0) {
      segmentsHe = [
        {
          id: 'whisper_he_inst',
          startTime: 0,
          endTime: Math.min(10, totalDuration),
          text: 'קטע אינסטרומנטלי לא זוהו מילים בשמע',
        },
      ];
      segmentsEn = [
        {
          id: 'whisper_en_inst',
          startTime: 0,
          endTime: Math.min(10, totalDuration),
          text: 'Instrumental audio no clear vocals detected',
        },
      ];
    }

    const lyricsHe = segmentsHe.map((s) => s.text).join('\n');
    const lyricsEn = segmentsEn.map((s) => s.text).join('\n');
    const primarySegments = options.language === 'en' ? segmentsEn : segmentsHe;
    const primaryLyrics = options.language === 'en' ? lyricsEn : lyricsHe;

    options.onProgress?.('הכתוביות מוכנות בעברית ובאנגלית', 100);

    return {
      success: true,
      segments: primarySegments,
      segmentsHe,
      segmentsEn,
      lyrics: primaryLyrics,
      lyricsHe,
      lyricsEn,
      provider: 'on-device-whisper-wasm',
    };
  } catch (err: any) {
    console.error('[OnDeviceWhisper] Error:', err);
    return {
      success: false,
      error: err?.message || 'שגיאה ביצירת כתוביות מקומיות על המכשיר',
    };
  }
}
