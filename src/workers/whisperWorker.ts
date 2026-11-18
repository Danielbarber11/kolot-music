import { pipeline, env } from '@huggingface/transformers';
import { SubtitleSegment } from '../types';

let cachedPipelinePromise: Promise<any> | null = null;
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
      endTime: Number(absEnd.toFixed(2)),
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
    // Worker already runs on its own dedicated thread off the UI thread
    env.backends.onnx.wasm.proxy = false;
    env.backends.onnx.wasm.numThreads = 1;
  }
}

async function getWorkerPipeline(origin: string) {
  configureEnv(origin);
  if (!cachedPipelinePromise) {
    cachedPipelinePromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (info: any) => {
        if (info?.status === 'progress' && typeof info.progress === 'number') {
          const rawPct = Math.min(100, Math.max(0, info.progress));
          const scaled = Math.min(48, Math.max(8, Math.round(8 + rawPct * 0.4)));
          self.postMessage({
            type: 'progress',
            statusText: `טוען מנוע כתוביות ברקע (${Math.round(rawPct)}%)`,
            percent: scaled,
          });
        } else if (info?.status === 'initiate' || info?.status === 'download') {
          self.postMessage({
            type: 'progress',
            statusText: 'מכין מנוע כתוביות ברקע...',
            percent: 10,
          });
        } else if (info?.status === 'ready') {
          self.postMessage({
            type: 'progress',
            statusText: 'מנוע הכתוביות מוכן — מתחיל תמלול...',
            percent: 50,
          });
        }
      },
    }).catch((err) => {
      cachedPipelinePromise = null;
      throw err;
    });
  }
  return cachedPipelinePromise;
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

    const transcriber = await getWorkerPipeline(origin);

    const SAMPLE_RATE = 16000;
    const CHUNK_SECONDS = 28;
    const STRIDE_SECONDS = 26;
    const CHUNK_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE;
    const STRIDE_SAMPLES = STRIDE_SECONDS * SAMPLE_RATE;
    const totalChunks = Math.max(1, Math.ceil(Math.max(0, pcm.length - CHUNK_SAMPLES) / STRIDE_SAMPLES) + 1);

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
      if (startSample >= pcm.length) continue;

      const endSample = Math.min(pcm.length, startSample + CHUNK_SAMPLES);
      const chunkPcm = pcm.subarray(startSample, endSample);
      const offsetSec = startSample / SAMPLE_RATE;
      const chunkDurSec = chunkPcm.length / SAMPLE_RATE;

      const pct = Math.min(92, Math.max(52, Math.round(52 + ((i + 1) / totalChunks) * 40)));
      self.postMessage({
        type: 'progress',
        statusText: `מתמלל ברקע (${i + 1}/${totalChunks})...`,
        percent: pct,
      });

      if (computeRms(chunkPcm) < 0.008 || chunkDurSec < 0.8) {
        continue;
      }

      const decodeOptions: Record<string, any> = {
        return_timestamps: true,
        max_new_tokens: 96,
        repetition_penalty: 1.05,
        no_repeat_ngram_size: 4,
        condition_on_prev_tokens: false,
        task: 'transcribe',
      };
      if (lockedWhisperLang) {
        decodeOptions.language = lockedWhisperLang;
      }

      const chunkResult: any = await transcriber(chunkPcm, decodeOptions);
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
    });
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      error: err?.message || 'שגיאה בתמלול השמע ברקע',
    });
  }
};
