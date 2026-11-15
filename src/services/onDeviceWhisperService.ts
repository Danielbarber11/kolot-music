import { pipeline, env } from '@huggingface/transformers';
import { SubtitleSegment } from '../types';

// Configure Transformers.js to run 100% in browser via Cache API + WASM (0 server cost, 0 API keys)
env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.proxy = false;
  // Single-thread WASM prevents iframe SharedArrayBuffer hangs when crossOriginIsolated is false
  if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
    env.backends.onnx.wasm.numThreads = 1;
  }
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
 * Optional free on-device Chrome Translator API (zero API keys, zero network quota).
 */
async function translateOnDeviceIfAvailable(
  texts: string[],
  sourceLanguage: 'en' | 'he',
  targetLanguage: 'en' | 'he'
): Promise<string[] | null> {
  try {
    const g: any = typeof self !== 'undefined' ? self : window;
    const TranslatorCtor = g?.Translator;
    if (!TranslatorCtor || typeof TranslatorCtor.create !== 'function') {
      return null;
    }
    if (typeof TranslatorCtor.availability === 'function') {
      const avail = await TranslatorCtor.availability({ sourceLanguage, targetLanguage });
      if (avail === 'unavailable') return null;
    }
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
    return out;
  } catch {
    return null;
  }
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
    // Cap raw slice for multi-hundred-MB files so browser RAM stays safe
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

/**
 * Loads or reuses cached On-Device Whisper AI pipeline via stable WASM q8 (100% free, zero API keys).
 * Uses WASM instead of WebGPU q8 to avoid Chrome WebGPU quantized ConvInteger crashes.
 */
async function getOnDeviceWhisperPipeline(
  onProgress?: (statusText: string, percent?: number) => void
) {
  if (!whisperPipelinePromise) {
    whisperPipelinePromise = (async () => {
      onProgress?.('מכין מנוע כתוביות מקומי במכשיר (ללא מפתח API)...', 5);

      return pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (info: any) => {
          if (info?.status === 'progress' && typeof info.progress === 'number') {
            const pct = Math.min(95, Math.max(5, Math.round(info.progress)));
            onProgress?.(`מוריד מנוע Whisper למכשיר (${pct}%)`, pct);
          } else if (info?.status === 'ready') {
            onProgress?.('מנוע Whisper המקומי מוכן', 96);
          }
        },
      });
    })().catch((err) => {
      whisperPipelinePromise = null;
      throw err;
    });
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
            const pct = Math.min(95, Math.max(10, Math.round(info.progress)));
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
  totalDuration: number,
  idPrefix: string
): SubtitleSegment[] {
  const rawChunks: Array<{ timestamp?: [number | null, number | null]; text?: string }> =
    Array.isArray(result?.chunks) ? result.chunks : [];

  let segments: SubtitleSegment[] = [];
  rawChunks.forEach((chunk, idx) => {
    const cleanText = sanitizeSubtitleLettersOnly(String(chunk?.text || ''));
    if (!cleanText) return;

    const start = typeof chunk.timestamp?.[0] === 'number' ? chunk.timestamp[0] : idx * 4;
    const nextChunkStart =
      typeof rawChunks[idx + 1]?.timestamp?.[0] === 'number'
        ? rawChunks[idx + 1].timestamp![0]!
        : start + 4.2;
    const end =
      typeof chunk.timestamp?.[1] === 'number' && chunk.timestamp[1]! > start
        ? chunk.timestamp[1]!
        : Math.min(totalDuration, Math.max(start + 1.2, nextChunkStart));

    // Skip adjacent identical segment loops
    const prevSeg = segments[segments.length - 1];
    if (prevSeg && prevSeg.text.toLowerCase() === cleanText.toLowerCase()) {
      prevSeg.endTime = Number(Math.max(prevSeg.endTime, end).toFixed(2));
      return;
    }

    segments.push({
      id: `${idPrefix}_${segments.length}`,
      startTime: Number(Math.max(0, start).toFixed(2)),
      endTime: Number(Math.min(totalDuration, Math.max(start + 0.8, end)).toFixed(2)),
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
      const step = Math.max(2, (totalDuration - 4) / Math.max(1, rawParts.length));
      segments = rawParts.map((text, idx) => ({
        id: `${idPrefix}_${idx}`,
        startTime: Number((2 + idx * step).toFixed(2)),
        endTime: Number((2 + (idx + 1) * step).toFixed(2)),
        text,
      }));
    }
  }

  return segments;
}

/**
 * Generates dual-language (Hebrew + English) timestamped subtitles 100% locally on device.
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
    const { pcm, duration } = await decodeAudioToMono16k(source, 240);
    const totalDuration = options.trackDuration && options.trackDuration > 10 ? options.trackDuration : duration || 180;

    const transcriber = await getOnDeviceWhisperPipeline(options.onProgress);

    // Pass 1: Transcribe native speech/Hebrew on device with anti-loop decoding
    options.onProgress?.('יוצר כתוביות בעברית על המכשיר...', 60);
    const baseOpts = {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      repetition_penalty: 1.25,
      no_repeat_ngram_size: 3,
    };

    const heResult: any = await transcriber(pcm, {
      ...baseOpts,
      language: 'hebrew',
      task: 'transcribe',
    });

    let segmentsHe = buildSanitizedSegmentsFromResult(heResult, totalDuration, 'whisper_he');

    // Pass 2: Translate / Transcribe English subtitles directly on device via Whisper's built-in translate task
    options.onProgress?.('יוצר כתוביות באנגלית על המכשיר...', 85);
    const enResult: any = await transcriber(pcm, {
      ...baseOpts,
      task: 'translate',
    });

    let segmentsEn = buildSanitizedSegmentsFromResult(enResult, totalDuration, 'whisper_en');

    // If song had clear English vocals and Whisper Hebrew transliterated weakly, try Chrome offline Translator En->He
    const hasHebrewChars = segmentsHe.some((s) => /[\u0590-\u05FF]/.test(s.text));
    if (segmentsEn.length > 0 && !hasHebrewChars) {
      const translatedHe = await translateOnDeviceIfAvailable(
        segmentsEn.map((s) => s.text),
        'en',
        'he'
      );
      if (translatedHe && translatedHe.some((t) => /[\u0590-\u05FF]/.test(t))) {
        segmentsHe = segmentsEn.map((seg, i) => ({
          id: `whisper_he_${i}`,
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: translatedHe[i] || seg.text,
        }));
      }
    }

    if (segmentsHe.length === 0 && segmentsEn.length > 0) {
      const translatedHe = await translateOnDeviceIfAvailable(
        segmentsEn.map((s) => s.text),
        'en',
        'he'
      );
      segmentsHe = segmentsEn.map((seg, i) => ({
        id: `whisper_he_${i}`,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: translatedHe?.[i] || seg.text,
      }));
    }

    if (segmentsEn.length === 0 && segmentsHe.length > 0) {
      const translatedEn = await translateOnDeviceIfAvailable(
        segmentsHe.map((s) => s.text),
        'he',
        'en'
      );
      segmentsEn = segmentsHe.map((seg, i) => ({
        id: `whisper_en_${i}`,
        startTime: seg.startTime,
        endTime: seg.endTime,
        text: translatedEn?.[i] || seg.text,
      }));
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
