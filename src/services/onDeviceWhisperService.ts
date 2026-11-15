import { pipeline, env } from '@huggingface/transformers';
import { SubtitleSegment } from '../types';

// Configure Transformers.js to run 100% in browser via Cache API + WASM/WebGPU (0 server cost, 0 API keys)
env.allowLocalModels = false;
env.useBrowserCache = true;

let whisperPipelinePromise: Promise<any> | null = null;
let audioClassifierPipelinePromise: Promise<any> | null = null;

async function hasWebGpuSupport(): Promise<boolean> {
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav?.gpu) return false;
    const adapter = await nav.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Decodes any audio File/Blob or URL directly on the device into mono 16kHz Float32Array PCM.
 * Works cleanly for MP3, WAV, M4A, AAC, OGG, FLAC without uploading anything to external AI APIs.
 */
export async function decodeAudioToMono16k(
  source: File | Blob | string,
  maxSeconds = 0
): Promise<{ pcm: Float32Array; duration: number }> {
  let arrayBuffer: ArrayBuffer;

  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(`לא ניתן לטעון את קובץ השמע למכשיר (${res.status})`);
    }
    arrayBuffer = await res.arrayBuffer();
  } else {
    // If maxSeconds is requested on a very large file (>40MB), reading the first 12MB gives >45s cleanly
    const targetSlice =
      maxSeconds > 0 && source.size > 12 * 1024 * 1024
        ? source.slice(0, 12 * 1024 * 1024)
        : source;
    arrayBuffer = await targetSlice.arrayBuffer();
  }

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('הדפדפן אינו תומך בפענוח שמע מקומי (Web Audio API)');
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
 * Loads or reuses cached On-Device Whisper AI pipeline (100% free, unlimited, zero API keys).
 */
async function getOnDeviceWhisperPipeline(
  onProgress?: (statusText: string, percent?: number) => void
) {
  if (!whisperPipelinePromise) {
    whisperPipelinePromise = (async () => {
      const useGpu = await hasWebGpuSupport();
      onProgress?.('מכין מנוע כתוביות מקומי במכשיר (ללא מפתח API)...', 5);

      return pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        dtype: 'q8',
        device: useGpu ? 'webgpu' : 'wasm',
        progress_callback: (info: any) => {
          if (info?.status === 'progress' && typeof info.progress === 'number') {
            const pct = Math.min(95, Math.max(5, Math.round(info.progress)));
            onProgress?.(`מוריד מנוע Whisper למכשיר (${pct}%) — חד-פעמי וחינמי...`, pct);
          } else if (info?.status === 'ready') {
            onProgress?.('מנוע Whisper המקומי מוכן — מתחיל תמלול במכשיר...', 98);
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
      const useGpu = await hasWebGpuSupport();
      onProgress?.('טוען מודל זיהוי סגנון מקומי במכשיר (חינם)...', 10);

      return pipeline('audio-classification', 'Xenova/ast-finetuned-audioset-10-10-0.4593', {
        dtype: 'q8',
        device: useGpu ? 'webgpu' : 'wasm',
        progress_callback: (info: any) => {
          if (info?.status === 'progress' && typeof info.progress === 'number') {
            const pct = Math.min(95, Math.max(10, Math.round(info.progress)));
            onProgress?.(`טוען מודל זיהוי שמע מקומי (${pct}%)...`, pct);
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

/**
 * Generates timestamped subtitles 100% locally on the user's device using Transformers.js Whisper.
 * Zero backend cost, zero API keys, unlimited usage.
 */
export async function transcribeAudioOnDevice(options: {
  audioFile?: File | Blob | null;
  audioUrl?: string;
  language?: 'he' | 'en';
  trackDuration?: number;
  onProgress?: (statusText: string, percent?: number) => void;
}): Promise<{
  success: boolean;
  segments?: SubtitleSegment[];
  lyrics?: string;
  provider?: string;
  error?: string;
}> {
  try {
    const source = options.audioFile || options.audioUrl;
    if (!source) {
      return { success: false, error: 'לא נבחר קובץ שמע לתמלול מקומי.' };
    }

    options.onProgress?.('מפענח גלי שמע מקומית במכשיר...', 3);
    const { pcm, duration } = await decodeAudioToMono16k(source);
    const totalDuration = options.trackDuration || duration || 180;

    const transcriber = await getOnDeviceWhisperPipeline(options.onProgress);

    options.onProgress?.('מתמלל מילים וכתוביות על המכשיר (100% חינם)...', 99);

    const langName = options.language === 'en' ? 'english' : 'hebrew';
    const result: any = await transcriber(pcm, {
      language: langName,
      task: 'transcribe',
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    const rawChunks: Array<{ timestamp?: [number | null, number | null]; text?: string }> =
      Array.isArray(result?.chunks) ? result.chunks : [];

    let segments: SubtitleSegment[] = rawChunks
      .map((chunk, idx) => {
        const cleanText = String(chunk?.text || '').trim();
        if (!cleanText) return null;
        const start = typeof chunk.timestamp?.[0] === 'number' ? chunk.timestamp[0] : idx * 4;
        const nextChunkStart =
          typeof rawChunks[idx + 1]?.timestamp?.[0] === 'number'
            ? rawChunks[idx + 1].timestamp![0]!
            : start + 4.2;
        const end =
          typeof chunk.timestamp?.[1] === 'number' && chunk.timestamp[1]! > start
            ? chunk.timestamp[1]!
            : Math.min(totalDuration, Math.max(start + 1.2, nextChunkStart));

        return {
          id: `local_whisper_${idx}`,
          startTime: Number(start.toFixed(2)),
          endTime: Number(end.toFixed(2)),
          text: cleanText,
        } as SubtitleSegment;
      })
      .filter((s): s is SubtitleSegment => !!s);

    const fullText = String(result?.text || '').trim();
    if (segments.length === 0 && fullText) {
      const sentenceParts = fullText
        .split(/(?<=[.!?,\n])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const step = Math.max(2, (totalDuration - 4) / Math.max(1, sentenceParts.length));
      segments = sentenceParts.map((text, idx) => ({
        id: `local_whisper_${idx}`,
        startTime: Number((2 + idx * step).toFixed(2)),
        endTime: Number((2 + (idx + 1) * step).toFixed(2)),
        text,
      }));
    }

    if (segments.length === 0) {
      segments = [
        {
          id: 'local_whisper_inst',
          startTime: 0,
          endTime: Math.min(10, totalDuration),
          text: options.language === 'en' ? 'Instrumental audio / no clear vocals detected' : 'קטע אינסטרומנטלי / לא זוהו מילים ברורות בשמע',
        },
      ];
    }

    const lyrics = segments.map((s) => s.text).join('\n');

    return {
      success: true,
      segments,
      lyrics,
      provider: 'on-device-whisper-wasm',
    };
  } catch (err: any) {
    console.error('[OnDeviceWhisper] Error:', err);
    return {
      success: false,
      error: err?.message || 'שגיאה ביצירת כתוביות מקומיות על המכשיר.',
    };
  }
}
