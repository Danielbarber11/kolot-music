import { pipeline, env } from '@huggingface/transformers';
import { SubtitleSegment } from '../types';

type WhisperBackendMode = 'webgpu' | 'wasm';

let cachedPipelinePromise: Promise<any> | null = null;
let cachedBackendMode: WhisperBackendMode | null = null;
let configuredOrigin = '';

function sanitizeLettersOnly(rawText: string): string {
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

function isHallucination(cleanText: string): boolean {
  const lower = cleanText.toLowerCase().trim();
  if (!lower || lower.length < 2) return true;
  const blocked = [
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
  return blocked.some((re) => re.test(lower));
}

function computeRms(samples: Float32Array): number {
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

function buildSegmentsFromChunk(
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
    const cleanText = sanitizeLettersOnly(String(chunk?.text || ''));
    if (!cleanText || isHallucination(cleanText)) return;

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
      endTime: Number(Math.max(absStart + 0.8, absEnd).toFixed(2)),
      text: cleanText,
    });
  });

  if (segments.length === 0) {
    const rawFull = String(result?.text || '').trim();
    const rawParts = rawFull
      .split(/[\n.!?]+/)
      .map((s) => sanitizeLettersOnly(s))
      .filter((p) => p && !isHallucination(p));

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

function mergeOrdered(allSegments: SubtitleSegment[]): SubtitleSegment[] {
  const sorted = [...allSegments].sort((a, b) => a.startTime - b.startTime);
  const merged: SubtitleSegment[] = [];
  for (const seg of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && seg.startTime < prev.endTime - 0.25) {
      const prevWords = new Set(prev.text.toLowerCase().split(/\s+/));
      const curWords = seg.text.toLowerCase().split(/\s+/);
      const overlapHits = curWords.filter((w) => prevWords.has(w)).length;
      if (
        overlapHits >= Math.max(1, Math.floor(curWords.length * 0.5)) ||
        prev.text.toLowerCase() === seg.text.toLowerCase()
      ) {
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

function configureEnv(origin: string) {
  if (configuredOrigin === origin) return;
  configuredOrigin = origin;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (origin) {
    env.remoteHost = `${origin}/api/hf-proxy/`;
    env.remotePathTemplate = '{model}/resolve/{revision}/';
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = `${origin}/api/onnx-wasm/`;
    }
  }
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.proxy = false;
    // Enable multi-threaded WASM only when Cross-Origin-Isolated (SharedArrayBuffer available)
    const threads =
      typeof self !== 'undefined' && (self as any).crossOriginIsolated
        ? Math.min(4, Math.max(1, Number(navigator?.hardwareConcurrency || 2)))
        : 1;
    env.backends.onnx.wasm.numThreads = threads;
  }
}

async function detectWebGpuF16(): Promise<boolean> {
  try {
    const gpu = (navigator as any)?.gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') return false;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return false;
    return Boolean(adapter.features?.has?.('shader-f16'));
  } catch {
    return false;
  }
}

function createProgressCallback(mode: WhisperBackendMode) {
  return (info: any) => {
    const modeLabel = mode === 'webgpu' ? 'GPU' : 'מכשיר';
    if (info?.status === 'progress' && typeof info.progress === 'number') {
      const rawPct = Math.min(100, Math.max(0, info.progress));
      const scaled = Math.min(48, Math.max(8, Math.round(8 + rawPct * 0.4)));
      self.postMessage({
        type: 'progress',
        statusText: `טוען מנוע כתוביות (${modeLabel} • ${Math.round(rawPct)}%)`,
        percent: scaled,
      });
    } else if (info?.status === 'initiate' || info?.status === 'download') {
      self.postMessage({
        type: 'progress',
        statusText: `מוריד מנוע כתוביות (${modeLabel})...`,
        percent: 10,
      });
    } else if (info?.status === 'ready') {
      self.postMessage({
        type: 'progress',
        statusText: `מנוע הכתוביות מוכן (${modeLabel}) — מתחיל תמלול...`,
        percent: 50,
      });
    }
  };
}

async function getWorkerPipeline(
  origin: string,
  preferredMode?: WhisperBackendMode
): Promise<{ transcriber: any; mode: WhisperBackendMode }> {
  configureEnv(origin);

  const canWebGpu = preferredMode !== 'wasm' && (await detectWebGpuF16());
  const targetMode: WhisperBackendMode = canWebGpu ? 'webgpu' : 'wasm';

  if (cachedPipelinePromise && cachedBackendMode === targetMode) {
    const transcriber = await cachedPipelinePromise;
    return { transcriber, mode: targetMode };
  }

  if (targetMode === 'webgpu') {
    try {
      cachedBackendMode = 'webgpu';
      cachedPipelinePromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
        dtype: 'q4f16',
        device: 'webgpu',
        progress_callback: createProgressCallback('webgpu'),
      });
      const transcriber = await cachedPipelinePromise;
      return { transcriber, mode: 'webgpu' };
    } catch {
      cachedPipelinePromise = null;
      cachedBackendMode = null;
    }
  }

  cachedBackendMode = 'wasm';
  cachedPipelinePromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: createProgressCallback('wasm'),
  }).catch((err) => {
    cachedPipelinePromise = null;
    cachedBackendMode = null;
    throw err;
  });

  const transcriber = await cachedPipelinePromise;
  return { transcriber, mode: 'wasm' };
}

self.onmessage = async (event: MessageEvent) => {
  const data = event.data;
  if (!data || data.type !== 'transcribe') return;

  try {
    const origin = String(data.origin || '');
    const pcm = new Float32Array(data.pcmBuffer);
    const totalDuration = Math.max(10, Number(data.duration) || 180);
    const subtitleLanguageHint = data.subtitleLanguageHint as 'auto' | 'he' | 'en' | undefined;
    const hintTitle = String(data.hintTitle || '');

    let { transcriber, mode } = await getWorkerPipeline(origin);

    const SAMPLE_RATE = 16000;
    // Fast contiguous non-overlapping 28s windows (eliminates duplicate work)
    const CHUNK_SECONDS = 28;
    const STRIDE_SECONDS = 28;
    const CHUNK_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE;
    const STRIDE_SAMPLES = STRIDE_SECONDS * SAMPLE_RATE;

    // On CPU WASM limit to first 84s (3 fast chunks < 1 min) while WebGPU handles up to 150s cleanly
    const maxProcessSamples = mode === 'webgpu' ? pcm.length : Math.min(pcm.length, 84 * SAMPLE_RATE);
    const totalChunks = Math.max(1, Math.ceil(maxProcessSamples / STRIDE_SAMPLES));

    const titleHasHebrew = /[\u0590-\u05FF]/.test(hintTitle);
    let lockedWhisperLang: 'hebrew' | 'english' | undefined =
      subtitleLanguageHint === 'he'
        ? 'hebrew'
        : subtitleLanguageHint === 'en'
          ? 'english'
          : titleHasHebrew
            ? 'hebrew'
            : undefined;

    const rawSegments: SubtitleSegment[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const startSample = i * STRIDE_SAMPLES;
      if (startSample >= maxProcessSamples) continue;

      const endSample = Math.min(maxProcessSamples, startSample + CHUNK_SAMPLES);
      const chunkPcm = pcm.subarray(startSample, endSample);
      const offsetSec = startSample / SAMPLE_RATE;
      const chunkDurSec = chunkPcm.length / SAMPLE_RATE;

      const pct = Math.min(92, Math.max(52, Math.round(52 + ((i + 1) / totalChunks) * 40)));
      self.postMessage({
        type: 'progress',
        statusText: `מתמלל ${mode === 'webgpu' ? 'ב-GPU ' : ''}(חלק ${i + 1}/${totalChunks})...`,
        percent: pct,
      });

      if (computeRms(chunkPcm) < 0.008 || chunkDurSec < 0.8) {
        continue;
      }

      const decodeOptions: Record<string, any> = {
        return_timestamps: true,
        max_new_tokens: 72,
        repetition_penalty: 1.05,
        no_repeat_ngram_size: 4,
        condition_on_prev_tokens: false,
        task: 'transcribe',
      };
      if (lockedWhisperLang) {
        decodeOptions.language = lockedWhisperLang;
      }

      let chunkResult: any;
      try {
        chunkResult = await transcriber(chunkPcm, decodeOptions);
      } catch (inferErr) {
        if (mode === 'webgpu') {
          // Seamless automatic fallback to WASM if GPU shader execution fails mid-run
          cachedPipelinePromise = null;
          cachedBackendMode = null;
          const fallback = await getWorkerPipeline(origin, 'wasm');
          transcriber = fallback.transcriber;
          mode = 'wasm';
          chunkResult = await transcriber(chunkPcm, decodeOptions);
        } else {
          throw inferErr;
        }
      }

      const chunkSegs = buildSegmentsFromChunk(
        chunkResult,
        offsetSec,
        chunkDurSec,
        totalDuration,
        `whisper_c${i}`
      );

      if (!lockedWhisperLang && chunkSegs.length > 0 && (!subtitleLanguageHint || subtitleLanguageHint === 'auto')) {
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
        self.postMessage({
          type: 'partial',
          segments: mergeOrdered(rawSegments),
          completedChunks: i + 1,
          totalChunks,
        });
      }
    }

    const finalOrdered = mergeOrdered(rawSegments);
    self.postMessage({
      type: 'done',
      segments: finalOrdered,
      lockedWhisperLang,
      backend: mode,
    });
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      error: err?.message || 'שגיאה בתמלול השמע ברקע',
    });
  }
};
