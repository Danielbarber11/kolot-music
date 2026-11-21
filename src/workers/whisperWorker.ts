import { pipeline, env } from '@huggingface/transformers';
import { SubtitleSegment, SubtitleWord } from '../types';

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

function estimateWordWeight(word: string): number {
  const letters = word.replace(/[^\p{L}]/gu, '');
  if (!letters) return 0.5;
  // Approximate vowel/syllable nuclei for Hebrew & Latin words
  const vowelMatches = letters.match(/[aeiouyאאהוי]/gi);
  const syllables = Math.max(1, vowelMatches ? vowelMatches.length : Math.ceil(letters.length / 2.6));
  const charFactor = Math.min(10, letters.length) * 0.11;
  // Short function words ("the", "a", "את", "של", "לא", "כי") are sung faster than long content words
  const lengthBoost = letters.length <= 2 ? 0.65 : letters.length >= 6 ? 1.22 : 1.0;
  return (0.45 + syllables * 0.42 + charFactor) * lengthBoost;
}

/**
 * Aligns individual words to real vocal-onset energy frames inside the 16kHz PCM window.
 * Trims leading/trailing instrumental/breath gaps so the first word lights up only when sung,
 * and snaps word boundaries onto local RMS energy valleys/attacks.
 */
function alignSegmentWordsToAudio(
  text: string,
  absStart: number,
  absEnd: number,
  windowPcm: Float32Array,
  windowOffsetSec: number
): SubtitleWord[] {
  const wordsRaw = text.split(/\s+/).filter((w) => w.length > 0);
  if (wordsRaw.length === 0) return [];

  const sampleRate = 16000;
  const relStart = Math.max(0, absStart - windowOffsetSec);
  const relEnd = Math.min(windowPcm.length / sampleRate, Math.max(relStart + 0.35, absEnd - windowOffsetSec));
  const startIdx = Math.max(0, Math.floor(relStart * sampleRate));
  const endIdx = Math.min(windowPcm.length, Math.ceil(relEnd * sampleRate));

  const frameSize = 320; // 20ms per RMS frame at 16kHz
  const frameRms: number[] = [];
  let maxRms = 0;

  for (let pos = startIdx; pos + frameSize <= endIdx; pos += frameSize) {
    let sumSq = 0;
    for (let k = 0; k < frameSize; k += 2) {
      const v = windowPcm[pos + k];
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / (frameSize / 2));
    frameRms.push(rms);
    if (rms > maxRms) maxRms = rms;
  }

  let vocalStart = absStart;
  let vocalEnd = Math.max(absStart + 0.4, absEnd);

  if (frameRms.length >= 6 && maxRms > 0.01) {
    const onsetThresh = Math.max(0.012, maxRms * 0.19);
    let firstActive = 0;
    while (firstActive < frameRms.length - 3 && frameRms[firstActive] < onsetThresh) {
      firstActive++;
    }
    let lastActive = frameRms.length - 1;
    while (lastActive > firstActive + 2 && frameRms[lastActive] < onsetThresh * 0.85) {
      lastActive--;
    }

    const trimLeadSec = Math.min(0.95, firstActive * 0.02);
    const trimTailSec = Math.min(0.9, Math.max(0, frameRms.length - 1 - lastActive) * 0.02);
    const candidateStart = absStart + trimLeadSec;
    const candidateEnd = absEnd - trimTailSec;
    if (candidateEnd - candidateStart >= Math.max(0.45, wordsRaw.length * 0.14)) {
      vocalStart = candidateStart;
      vocalEnd = candidateEnd;
    }
  }

  if (wordsRaw.length === 1) {
    return [{
      text: wordsRaw[0],
      startTime: Number(vocalStart.toFixed(2)),
      endTime: Number(Math.max(vocalStart + 0.25, vocalEnd).toFixed(2)),
    }];
  }

  const weights = wordsRaw.map(estimateWordWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || wordsRaw.length;
  const vocalSpan = Math.max(0.4, vocalEnd - vocalStart);

  // Cumulative initial boundaries [0 .. wordsRaw.length]
  const boundaries: number[] = [vocalStart];
  let accWeight = 0;
  for (let i = 0; i < wordsRaw.length - 1; i++) {
    accWeight += weights[i];
    const targetTime = vocalStart + (accWeight / totalWeight) * vocalSpan;

    // Search nearby 20ms RMS frames (+/- 18% of average word duration) for an inter-word energy valley/onset
    let snappedTime = targetTime;
    if (frameRms.length >= 8 && maxRms > 0.012) {
      const searchSec = Math.min(0.28, (vocalSpan / wordsRaw.length) * 0.42);
      const centerFrame = Math.round((targetTime - absStart) / 0.02);
      const radiusFrames = Math.max(1, Math.round(searchSec / 0.02));
      const fMin = Math.max(1, centerFrame - radiusFrames);
      const fMax = Math.min(frameRms.length - 2, centerFrame + radiusFrames);
      let bestScore = Infinity;
      let bestFrame = centerFrame;
      for (let f = fMin; f <= fMax; f++) {
        // Prefer low local energy just before an energy rise (new word attack)
        const riseBonus = frameRms[f + 1] > frameRms[f] ? (frameRms[f + 1] - frameRms[f]) * 0.65 : 0;
        const distPenalty = Math.abs(f - centerFrame) * 0.002 * maxRms;
        const score = frameRms[f] - riseBonus + distPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestFrame = f;
        }
      }
      const candidate = absStart + bestFrame * 0.02;
      const prevBound = boundaries[boundaries.length - 1];
      if (candidate > prevBound + 0.09 && candidate < vocalEnd - (wordsRaw.length - 1 - i) * 0.09) {
        snappedTime = candidate;
      }
    }

    const prevBound = boundaries[boundaries.length - 1];
    boundaries.push(Math.max(prevBound + 0.08, Math.min(vocalEnd - 0.08, snappedTime)));
  }
  boundaries.push(vocalEnd);

  return wordsRaw.map((w, idx) => ({
    text: w,
    startTime: Number(boundaries[idx].toFixed(2)),
    endTime: Number(Math.max(boundaries[idx] + 0.08, boundaries[idx + 1]).toFixed(2)),
  }));
}

function buildSegmentsFromChunk(
  result: any,
  windowOffsetSec: number,
  windowDurationSec: number,
  totalDuration: number,
  idPrefix: string,
  chunkPcm: Float32Array
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
      prevSeg.words = alignSegmentWordsToAudio(prevSeg.text, prevSeg.startTime, prevSeg.endTime, chunkPcm, windowOffsetSec);
      return;
    }

    const finalStart = Number(absStart.toFixed(2));
    const finalEnd = Number(Math.max(absStart + 0.5, absEnd).toFixed(2));
    const alignedWords = alignSegmentWordsToAudio(cleanText, finalStart, finalEnd, chunkPcm, windowOffsetSec);
    const trimmedStart = alignedWords.length > 0 ? alignedWords[0].startTime : finalStart;
    const trimmedEnd = alignedWords.length > 0 ? alignedWords[alignedWords.length - 1].endTime : finalEnd;
    segments.push({
      id: `${idPrefix}_${segments.length}`,
      startTime: trimmedStart,
      endTime: Math.max(trimmedStart + 0.3, trimmedEnd),
      text: cleanText,
      words: alignedWords,
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
        const finalStart = Number(absStart.toFixed(2));
        const finalEnd = Number(Math.max(absStart + 0.5, absEnd).toFixed(2));
        const alignedWords = alignSegmentWordsToAudio(text, finalStart, finalEnd, chunkPcm, windowOffsetSec);
        const trimmedStart = alignedWords.length > 0 ? alignedWords[0].startTime : finalStart;
        const trimmedEnd = alignedWords.length > 0 ? alignedWords[alignedWords.length - 1].endTime : finalEnd;
        return {
          id: `${idPrefix}_${idx}`,
          startTime: trimmedStart,
          endTime: Math.max(trimmedStart + 0.3, trimmedEnd),
          text,
          words: alignedWords,
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
          if (seg.words?.length) prev.words = seg.words;
        }
        continue;
      }
    }
    if (prev && prev.text.toLowerCase() === seg.text.toLowerCase() && seg.startTime - prev.endTime < 2.0) {
      prev.endTime = Number(Math.max(prev.endTime, seg.endTime).toFixed(2));
    } else {
      if (prev && prev.endTime > seg.startTime) {
        prev.endTime = Number(Math.max(prev.startTime + 0.2, seg.startTime - 0.02).toFixed(2));
      }
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
  const requestId = data.requestId;

  const postWithId = (payload: Record<string, any>) => {
    self.postMessage(requestId !== undefined ? { ...payload, requestId } : payload);
  };

  try {
    const origin = String(data.origin || '');
    const pcm = new Float32Array(data.pcmBuffer);
    const totalDuration = Math.max(10, Number(data.duration) || 180);
    const pcmOffsetSec = Math.max(0, Number(data.pcmOffsetSec) || 0);
    const subtitleLanguageHint = data.subtitleLanguageHint as 'auto' | 'he' | 'en' | undefined;
    const hintTitle = String(data.hintTitle || '');

    let { transcriber, mode } = await getWorkerPipeline(origin);

    const SAMPLE_RATE = 16000;
    const CHUNK_SECONDS = 22;
    const STRIDE_SECONDS = 22;
    const CHUNK_SAMPLES = CHUNK_SECONDS * SAMPLE_RATE;
    const STRIDE_SAMPLES = STRIDE_SECONDS * SAMPLE_RATE;

    // Respect explicit batch window slice when supplied, else default fast 44s WASM / 88s WebGPU cap
    const maxAudioSec = Number(data.maxProcessSeconds) > 0
      ? Number(data.maxProcessSeconds)
      : (mode === 'webgpu' ? 88 : 44);
    const maxProcessSamples = Math.min(pcm.length, Math.floor(maxAudioSec * SAMPLE_RATE));
    const totalChunks = Math.max(1, Math.ceil(maxProcessSamples / STRIDE_SAMPLES));

    const titleHasHebrew = /[\u0590-\u05FF]/.test(hintTitle);
    let lockedWhisperLang: 'hebrew' | 'english' | undefined =
      subtitleLanguageHint === 'he'
        ? 'hebrew'
        : subtitleLanguageHint === 'en'
          ? 'english'
          : data.lockedWhisperLang === 'hebrew' || data.lockedWhisperLang === 'english'
            ? data.lockedWhisperLang
            : titleHasHebrew
              ? 'hebrew'
              : undefined;

    const rawSegments: SubtitleSegment[] = [];
    const inferStartMs = Date.now();
    const SOFT_INFER_DEADLINE_MS = Number(data.softDeadlineMs) > 0 ? Number(data.softDeadlineMs) : 34000;
    let processedUpToSec = pcmOffsetSec;

    for (let i = 0; i < totalChunks; i++) {
      if (i > 0 && Date.now() - inferStartMs > SOFT_INFER_DEADLINE_MS) {
        break;
      }

      const startSample = i * STRIDE_SAMPLES;
      if (startSample >= maxProcessSamples) continue;

      const endSample = Math.min(maxProcessSamples, startSample + CHUNK_SAMPLES);
      const chunkPcm = pcm.subarray(startSample, endSample);
      const offsetSec = pcmOffsetSec + startSample / SAMPLE_RATE;
      const chunkDurSec = chunkPcm.length / SAMPLE_RATE;
      processedUpToSec = Math.max(processedUpToSec, pcmOffsetSec + endSample / SAMPLE_RATE);

      const pct = Math.min(92, Math.max(52, Math.round(52 + ((i + 1) / totalChunks) * 40)));
      postWithId({
        type: 'progress',
        statusText: `מתמלל במכשיר ${mode === 'webgpu' ? 'ב-GPU ' : ''}(חלק ${i + 1}/${totalChunks})...`,
        percent: pct,
      });

      if (computeRms(chunkPcm) < 0.008 || chunkDurSec < 0.8) {
        continue;
      }

      const decodeOptions: Record<string, any> = {
        return_timestamps: true,
        max_new_tokens: 48,
        num_beams: 1,
        do_sample: false,
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
        `whisper_${Math.round(pcmOffsetSec)}_c${i}`,
        chunkPcm
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
        postWithId({
          type: 'partial',
          segments: mergeOrdered(rawSegments),
          completedChunks: i + 1,
          totalChunks,
          processedUpToSec: Number(processedUpToSec.toFixed(2)),
        });
      }
    }

    const finalOrdered = mergeOrdered(rawSegments);
    postWithId({
      type: 'done',
      segments: finalOrdered,
      lockedWhisperLang,
      backend: mode,
      processedUpToSec: Number(processedUpToSec.toFixed(2)),
    });
  } catch (err: any) {
    postWithId({
      type: 'error',
      error: err?.message || 'שגיאה בתמלול השמע ברקע',
    });
  }
};
