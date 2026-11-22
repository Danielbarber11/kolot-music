import { JamendoTrack, SubtitleSegment } from '../types';
import { saveGeneratedSubtitlesToCloud, getStreamingMediaUrl } from './cloudStorageService';
import { syncTrackSubtitlesInMemory } from './multiMusicService';
import {
  decodeAudioToMono16k,
  generateSubtitlesWithGeminiMethod,
  isServerAiConfigured,
  transcribePcmWindowOnDevice,
} from './onDeviceWhisperService';

export interface SubtitleDraftSnapshot {
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
  completedUpTo: number;
  totalDuration: number;
  isComplete: boolean;
  progressText?: string;
  percent?: number;
}

interface ActiveUploadJob {
  key: string;
  controller: AbortController;
  snapshot: SubtitleDraftSnapshot | null;
  attachedTrack?: JamendoTrack;
  isComplete: boolean;
  promise: Promise<SubtitleDraftSnapshot | null>;
  listeners: Set<(snap: SubtitleDraftSnapshot) => void>;
}

const activeTrackJobs = new Map<string, Promise<void>>();
const trackListeners = new Map<string, Set<(track: JamendoTrack, snap: SubtitleDraftSnapshot) => void>>();
const activeUploadJobs = new Map<string, ActiveUploadJob>();
const failedTrackIds = new Set<string>();

function mergeSegLists(prev: SubtitleSegment[] = [], next: SubtitleSegment[] = []): SubtitleSegment[] {
  const combined = [...prev, ...next]
    .filter((s) => s && typeof s.text === 'string' && s.text.trim())
    .sort((a, b) => a.startTime - b.startTime);
  const out: SubtitleSegment[] = [];
  for (const seg of combined) {
    const last = out[out.length - 1];
    if (last && (Math.abs(seg.startTime - last.startTime) < 0.7 || seg.startTime < last.endTime - 0.35)) {
      const aTxt = last.text.trim().toLowerCase();
      const bTxt = seg.text.trim().toLowerCase();
      if (aTxt === bTxt || (bTxt.length <= aTxt.length && aTxt.includes(bTxt))) {
        last.endTime = Number(Math.max(last.endTime, seg.endTime).toFixed(2));
        if ((!last.words || !last.words.length) && seg.words?.length) {
          last.words = seg.words;
        }
        continue;
      }
    }
    out.push({ ...seg });
  }
  return out;
}

function buildSnapshotFromAccumulator(
  acc: {
    segmentsHe: SubtitleSegment[];
    segmentsEn: SubtitleSegment[];
    segmentsOrig?: SubtitleSegment[];
    detectedLanguageCode?: string;
    detectedLanguageLabel?: string;
    provider?: string;
    completedUpTo: number;
    totalDuration: number;
    isComplete: boolean;
    progressText?: string;
    percent?: number;
  },
  language: 'he' | 'en'
): SubtitleDraftSnapshot {
  const lyricsHe = acc.segmentsHe.map((s) => s.text).join('\n');
  const lyricsEn = acc.segmentsEn.map((s) => s.text).join('\n');
  const lyricsOrig = acc.segmentsOrig?.length ? acc.segmentsOrig.map((s) => s.text).join('\n') : undefined;
  const primarySegs = language === 'en' && acc.segmentsEn.length ? acc.segmentsEn : acc.segmentsHe;
  const primaryLyrics = language === 'en' && lyricsEn ? lyricsEn : lyricsHe;

  return {
    segments: primarySegs,
    segmentsHe: acc.segmentsHe,
    segmentsEn: acc.segmentsEn,
    segmentsOrig: acc.segmentsOrig,
    lyrics: primaryLyrics,
    lyricsHe,
    lyricsEn,
    lyricsOrig,
    detectedLanguageCode: acc.detectedLanguageCode,
    detectedLanguageLabel: acc.detectedLanguageLabel,
    provider: acc.provider,
    completedUpTo: Number(acc.completedUpTo.toFixed(1)),
    totalDuration: Math.max(10, Math.round(acc.totalDuration)),
    isComplete: acc.isComplete,
    progressText: acc.progressText,
    percent: acc.percent,
  };
}

function notifyTrackSubscribers(track: JamendoTrack, snap: SubtitleDraftSnapshot) {
  const set = trackListeners.get(track.id);
  if (set) {
    set.forEach((cb) => {
      try {
        cb(track, snap);
      } catch {}
    });
  }
}

export function subscribeTrackSubtitles(
  trackId: string,
  cb: (track: JamendoTrack, snap: SubtitleDraftSnapshot) => void
): () => void {
  if (!trackId) return () => {};
  let set = trackListeners.get(trackId);
  if (!set) {
    set = new Set();
    trackListeners.set(trackId, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) {
      trackListeners.delete(trackId);
    }
  };
}

export function isTrackSubtitleJobRunning(trackId: string): boolean {
  return activeTrackJobs.has(trackId);
}

/**
 * Persists an incremental batch snapshot to Cloudflare R2 + in-memory store.
 */
async function persistBatchToTrack(
  baseTrack: JamendoTrack,
  snap: SubtitleDraftSnapshot,
  forceReplace = false
): Promise<JamendoTrack | null> {
  if (!baseTrack.id || snap.segments.length === 0) return null;

  const saved = await saveGeneratedSubtitlesToCloud(baseTrack.id, {
    segments: snap.segments,
    segmentsHe: snap.segmentsHe,
    segmentsEn: snap.segmentsEn,
    segmentsOrig: snap.segmentsOrig,
    lyrics: snap.lyrics,
    lyricsHe: snap.lyricsHe,
    lyricsEn: snap.lyricsEn,
    lyricsOrig: snap.lyricsOrig,
    detectedLanguageCode: snap.detectedLanguageCode,
    detectedLanguageLabel: snap.detectedLanguageLabel,
    subtitlesIncomplete: !snap.isComplete,
    subtitlesCompletedUpTo: snap.completedUpTo,
    forceReplace,
  });

  if (saved) {
    syncTrackSubtitlesInMemory(saved);
    notifyTrackSubscribers(saved, snap);
    return saved;
  }

  // Still keep memory synced if network save transiently returned null
  const mergedLocal: JamendoTrack = {
    ...baseTrack,
    subtitleSegments: forceReplace ? snap.segments : mergeSegLists(baseTrack.subtitleSegments, snap.segments),
    subtitleSegmentsHe: forceReplace ? snap.segmentsHe : mergeSegLists(baseTrack.subtitleSegmentsHe, snap.segmentsHe),
    subtitleSegmentsEn: forceReplace ? snap.segmentsEn : mergeSegLists(baseTrack.subtitleSegmentsEn, snap.segmentsEn),
    subtitleSegmentsOrig: snap.segmentsOrig?.length
      ? (forceReplace ? snap.segmentsOrig : mergeSegLists(baseTrack.subtitleSegmentsOrig, snap.segmentsOrig))
      : (forceReplace ? undefined : baseTrack.subtitleSegmentsOrig),
    lyrics: snap.lyrics || baseTrack.lyrics,
    lyricsHe: snap.lyricsHe || baseTrack.lyricsHe,
    lyricsEn: snap.lyricsEn || baseTrack.lyricsEn,
    lyricsOrig: snap.lyricsOrig || baseTrack.lyricsOrig,
    detectedLanguageCode: snap.detectedLanguageCode || baseTrack.detectedLanguageCode,
    detectedLanguageLabel: snap.detectedLanguageLabel || baseTrack.detectedLanguageLabel,
    hasWhisperSubtitles: true,
    subtitlesDisabled: false,
    subtitlesIncomplete: !snap.isComplete,
    subtitlesCompletedUpTo: snap.completedUpTo,
  };
  syncTrackSubtitlesInMemory(mergedLocal);
  notifyTrackSubscribers(mergedLocal, snap);
  return mergedLocal;
}

/**
 * Starts silent full-song subtitle generation the instant a song file is picked in Upload UI.
 * Keeps running even after the user publishes the track, transferring updates straight to R2!
 */
export function startUploadPrefetchJob(options: {
  key: string;
  audioFile?: File | null;
  audioUrl?: string;
  songTitle?: string;
  artistName?: string;
  duration?: number;
  language?: 'he' | 'en';
  onUpdate?: (snap: SubtitleDraftSnapshot) => void;
}): Promise<SubtitleDraftSnapshot | null> {
  stopUploadPrefetchJob(options.key);
  const controller = new AbortController();
  const lang = options.language || 'he';

  const job: ActiveUploadJob = {
    key: options.key,
    controller,
    snapshot: null,
    isComplete: false,
    listeners: new Set(options.onUpdate ? [options.onUpdate] : []),
    promise: Promise.resolve(null),
  };

  const emitSnap = (snap: SubtitleDraftSnapshot) => {
    job.snapshot = snap;
    job.isComplete = snap.isComplete;
    job.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {}
    });
    if (job.attachedTrack && snap.segments.length > 0) {
      void persistBatchToTrack(job.attachedTrack, snap).catch(() => {});
    }
  };

  job.promise = (async (): Promise<SubtitleDraftSnapshot | null> => {
    try {
      const source = options.audioFile || options.audioUrl;
      if (!source) return null;

      // 1. Fast server AI when configured (produces full song in ~4-10s)
      const aiConfigured = await isServerAiConfigured().catch(() => false);
      if (aiConfigured && !controller.signal.aborted) {
        const gem = await generateSubtitlesWithGeminiMethod({
          audioFile: options.audioFile,
          audioUrl: options.audioUrl,
          duration: options.duration || 180,
          songTitle: options.songTitle,
          artistName: options.artistName,
          language: lang,
          signal: controller.signal,
        }).catch(() => null);

        if (gem?.success && gem.segments.length > 0 && !controller.signal.aborted) {
          const totalDur = Math.max(10, Math.round(options.duration || gem.segments[gem.segments.length - 1]?.endTime || 180));
          const fullSnap: SubtitleDraftSnapshot = {
            segments: gem.segments,
            segmentsHe: gem.segmentsHe,
            segmentsEn: gem.segmentsEn,
            segmentsOrig: gem.segmentsOrig,
            lyrics: gem.lyrics,
            lyricsHe: gem.lyricsHe,
            lyricsEn: gem.lyricsEn,
            lyricsOrig: gem.lyricsOrig,
            detectedLanguageCode: gem.detectedLanguageCode,
            detectedLanguageLabel: gem.detectedLanguageLabel,
            provider: gem.provider,
            completedUpTo: totalDur,
            totalDuration: totalDur,
            isComplete: true,
            percent: 100,
            progressText: 'הכתוביות הושלמו לכל השיר!',
          };
          emitSnap(fullSnap);
          return fullSnap;
        }
      }

      if (controller.signal.aborted) return null;

      // 2. Decode full song ONCE into 16kHz Mono PCM, then transcribe sequentially in 44s batches
      const { pcm, duration } = await decodeAudioToMono16k(source, 720, {
        isolateVocals: true,
        fullSong: true,
        signal: controller.signal,
      });
      const totalDur = Math.max(10, Math.round(options.duration && options.duration > 10 ? options.duration : duration));
      const actualDecodedDur = Math.max(10, pcm.length / 16000);
      const effectiveEnd = Math.min(totalDur, actualDecodedDur);
      const BATCH_SEC = 44;

      let cursor = 0;
      let lockedLang: 'hebrew' | 'english' | undefined;
      let accHe: SubtitleSegment[] = [];
      let accEn: SubtitleSegment[] = [];
      let lastSnap: SubtitleDraftSnapshot | null = null;

      while (cursor < effectiveEnd - 0.8 && !controller.signal.aborted) {
        const res = await transcribePcmWindowOnDevice({
          pcm,
          totalDuration: effectiveEnd,
          windowStartSec: cursor,
          windowDurationSec: BATCH_SEC,
          language: lang,
          lockedWhisperLang: lockedLang,
          hintTitle: options.songTitle,
          signal: controller.signal,
        });

        if (controller.signal.aborted) break;
        if (res.lockedWhisperLang && !lockedLang) {
          lockedLang = res.lockedWhisperLang;
        }

        accHe = mergeSegLists(accHe, res.segmentsHe);
        accEn = mergeSegLists(accEn, res.segmentsEn);

        const nextCursor = Math.max(cursor + BATCH_SEC, res.processedUpToSec || cursor + BATCH_SEC);
        const isLast = nextCursor >= effectiveEnd - 2;
        const pct = Math.min(100, Math.round((Math.min(effectiveEnd, nextCursor) / effectiveEnd) * 100));

        if (accHe.length > 0 || accEn.length > 0) {
          lastSnap = buildSnapshotFromAccumulator(
            {
              segmentsHe: accHe,
              segmentsEn: accEn,
              provider: res.provider,
              completedUpTo: Math.min(effectiveEnd, nextCursor),
              totalDuration: totalDur,
              isComplete: isLast,
              percent: pct,
              progressText: isLast
                ? 'נוצרו כתוביות מלאות לכל השיר!'
                : `מייצר כתוביות ברקע (${Math.round(Math.min(effectiveEnd, nextCursor))}/${Math.round(totalDur)} שנ׳)...`,
            },
            lang
          );
          emitSnap(lastSnap);
        }

        cursor = nextCursor;
      }

      if (lastSnap && !lastSnap.isComplete && !controller.signal.aborted) {
        const finalized = { ...lastSnap, completedUpTo: totalDur, isComplete: true, percent: 100 };
        emitSnap(finalized);
        return finalized;
      }

      return lastSnap;
    } catch {
      return job.snapshot;
    } finally {
      if (job.attachedTrack) {
        activeTrackJobs.delete(job.attachedTrack.id);
      }
      if (activeUploadJobs.get(options.key) === job) {
        activeUploadJobs.delete(options.key);
      }
    }
  })();

  activeUploadJobs.set(options.key, job);
  return job.promise;
}

export function getUploadPrefetchJob(key: string): ActiveUploadJob | undefined {
  return activeUploadJobs.get(key);
}

/**
 * When artist publishes while upload prefetch is still working on the rest of the song,
 * binds the live prefetch job to the published track ID so remaining batches continue & auto-save to R2!
 */
export function attachUploadJobToPublishedTrack(uploadKey: string, publishedTrack: JamendoTrack): boolean {
  const job = activeUploadJobs.get(uploadKey);
  if (!job || job.isComplete || job.controller.signal.aborted) {
    return false;
  }
  job.attachedTrack = publishedTrack;
  if (!activeTrackJobs.has(publishedTrack.id)) {
    activeTrackJobs.set(
      publishedTrack.id,
      job.promise.then(() => {}).catch(() => {})
    );
  }
  return true;
}

export function stopUploadPrefetchJob(key: string): void {
  const existing = activeUploadJobs.get(key);
  if (existing && !existing.attachedTrack) {
    existing.controller.abort();
    activeUploadJobs.delete(key);
  }
}

/**
 * Edit & Playback Collaborative Progressive Subtitle Runner:
 * - Processes song sequentially in ~44s batches starting from `resumeFromSec` (or 0).
 * - Saves EVERY completed batch incrementally to R2 (`subtitlesIncomplete: !isLastBatch`, `subtitlesCompletedUpTo`).
 * - `onFirstBatchReady` resolves cleanly in < 1 minute so Edit modal finishes promptly & stays non-blocking while the rest continues in the background!
 * - Survives Player unmount so if user exits mid-song, remaining chunks keep transcribing until tab closes; if user closes mid-song, next listener resumes from `subtitlesCompletedUpTo` in R2!
 */
export function startProgressiveTrackSubtitleJob(options: {
  track: JamendoTrack;
  language?: 'he' | 'en';
  forceRestart?: boolean;
  onBatchSaved?: (updatedTrack: JamendoTrack, snap: SubtitleDraftSnapshot) => void;
  onFirstBatchReady?: (updatedTrack: JamendoTrack | null, snap: SubtitleDraftSnapshot | null) => void;
  onProgress?: (statusText: string, percent?: number) => void;
}): Promise<void> {
  const targetTrack = options.track;
  const trackId = targetTrack?.id;
  if (!trackId || (targetTrack.subtitlesDisabled && !options.forceRestart)) {
    options.onFirstBatchReady?.(null, null);
    return Promise.resolve();
  }

  if (options.forceRestart) {
    failedTrackIds.delete(trackId);
  }

  const audioUrl = getStreamingMediaUrl(targetTrack.audioUrl);
  if (!audioUrl) {
    options.onFirstBatchReady?.(null, null);
    return Promise.resolve();
  }

  const existingJob = activeTrackJobs.get(trackId);
  if (existingJob && !options.forceRestart) {
    if (options.onBatchSaved) {
      const unsub = subscribeTrackSubtitles(trackId, (t, s) => options.onBatchSaved?.(t, s));
      existingJob.finally(unsub);
    }
    return existingJob;
  }

  const lang = options.language || 'he';
  let firstBatchNotified = false;
  let isFirstPersist = true;
  const notifyFirst = (t: JamendoTrack | null, s: SubtitleDraftSnapshot | null) => {
    if (firstBatchNotified) return;
    firstBatchNotified = true;
    try {
      options.onFirstBatchReady?.(t, s);
    } catch {}
  };

  const runner = (async () => {
    try {
      const hasExistingSubs = Boolean(
        !options.forceRestart &&
        (targetTrack.subtitleSegments?.length ||
          targetTrack.subtitleSegmentsHe?.length ||
          targetTrack.subtitleSegmentsEn?.length)
      );
      const startFromSec = hasExistingSubs ? Math.max(0, Number(targetTrack.subtitlesCompletedUpTo) || 0) : 0;

      // 1. Try instant full-song cloud SRT if server AI key is configured and starting fresh
      if (startFromSec < 10) {
        const aiConfigured = await isServerAiConfigured().catch(() => false);
        if (aiConfigured) {
          options.onProgress?.('מתמלל שיר מלא במהירות בענן...', 25);
          const gem = await generateSubtitlesWithGeminiMethod({
            audioUrl,
            duration: targetTrack.duration || 180,
            songTitle: targetTrack.name,
            artistName: targetTrack.artistName,
            language: lang,
          }).catch(() => null);

          if (gem?.success && gem.segments.length > 0) {
            const fullDur = Math.max(10, Math.round(targetTrack.duration || gem.segments[gem.segments.length - 1]?.endTime || 180));
            const snap: SubtitleDraftSnapshot = {
              segments: gem.segments,
              segmentsHe: gem.segmentsHe,
              segmentsEn: gem.segmentsEn,
              segmentsOrig: gem.segmentsOrig,
              lyrics: gem.lyrics,
              lyricsHe: gem.lyricsHe,
              lyricsEn: gem.lyricsEn,
              lyricsOrig: gem.lyricsOrig,
              detectedLanguageCode: gem.detectedLanguageCode,
              detectedLanguageLabel: gem.detectedLanguageLabel,
              provider: gem.provider,
              completedUpTo: fullDur,
              totalDuration: fullDur,
              isComplete: true,
              percent: 100,
              progressText: 'נוצרו כתוביות מלאות לכל השיר!',
            };
            const saved = await persistBatchToTrack(targetTrack, snap, Boolean(options.forceRestart && isFirstPersist));
            isFirstPersist = false;
            options.onBatchSaved?.(saved || targetTrack, snap);
            notifyFirst(saved || targetTrack, snap);
            return;
          }
        }
      }

      // 2. Decode audio once and process sequential 44s windows from startFromSec -> end
      options.onProgress?.('טוען את השמע לתמלול חכם בדפדפן...', 12);
      const { pcm, duration } = await decodeAudioToMono16k(audioUrl, 720, {
        isolateVocals: true,
        fullSong: true,
      });

      const actualDecodedDur = Math.max(10, pcm.length / 16000);
      const totalDur = Math.max(10, targetTrack.duration && targetTrack.duration > 10 ? targetTrack.duration : duration);
      const effectiveEnd = Math.min(totalDur, actualDecodedDur);
      const BATCH_SEC = 44;

      if (startFromSec >= effectiveEnd - 2) {
        notifyFirst(targetTrack, null);
        return;
      }

      let accHe: SubtitleSegment[] = hasExistingSubs ? [...(targetTrack.subtitleSegmentsHe || targetTrack.subtitleSegments || [])] : [];
      let accEn: SubtitleSegment[] = hasExistingSubs ? [...(targetTrack.subtitleSegmentsEn || [])] : [];
      let lockedLang: 'hebrew' | 'english' | undefined;
      let latestTrack = targetTrack;
      let cursor = startFromSec;

      while (cursor < effectiveEnd - 0.8) {
        const res = await transcribePcmWindowOnDevice({
          pcm,
          totalDuration: effectiveEnd,
          windowStartSec: cursor,
          windowDurationSec: BATCH_SEC,
          language: lang,
          lockedWhisperLang: lockedLang,
          hintTitle: targetTrack.name,
          onProgress: options.onProgress,
        });

        if (res.lockedWhisperLang && !lockedLang) {
          lockedLang = res.lockedWhisperLang;
        }

        accHe = mergeSegLists(accHe, res.segmentsHe);
        accEn = mergeSegLists(accEn, res.segmentsEn);

        const nextCursor = Math.max(cursor + BATCH_SEC, res.processedUpToSec || cursor + BATCH_SEC);
        const isLastBatch = nextCursor >= effectiveEnd - 3;
        const pct = Math.min(100, Math.round((Math.min(effectiveEnd, nextCursor) / effectiveEnd) * 100));

        if (accHe.length > 0 || accEn.length > 0) {
          const snap = buildSnapshotFromAccumulator(
            {
              segmentsHe: accHe,
              segmentsEn: accEn,
              provider: res.provider,
              completedUpTo: isLastBatch ? Math.round(totalDur) : Math.round(Math.min(effectiveEnd, nextCursor)),
              totalDuration: totalDur,
              isComplete: isLastBatch,
              percent: pct,
              progressText: isLastBatch
                ? `נוצרו ונשמרו ${accHe.length} שורות כתוביות לכל השיר!`
                : `הדקה הראשונה מוכנה ונשמרה — ממשיך להשלים ברקע (${pct}%)...`,
            },
            lang
          );

          const saved = await persistBatchToTrack(latestTrack, snap, Boolean(options.forceRestart && isFirstPersist));
          isFirstPersist = false;
          if (saved) latestTrack = saved;
          options.onBatchSaved?.(latestTrack, snap);
          notifyFirst(latestTrack, snap);
        } else if (!firstBatchNotified && isLastBatch) {
          notifyFirst(null, null);
        }

        cursor = nextCursor;
      }

      if (!firstBatchNotified) {
        notifyFirst(null, null);
      }
    } catch {
      failedTrackIds.add(trackId);
      notifyFirst(null, null);
    } finally {
      activeTrackJobs.delete(trackId);
    }
  })();

  activeTrackJobs.set(trackId, runner);
  return runner;
}

/**
 * Called by SongPlayerPage on play: automatically starts or resumes full-song subtitles
 * if missing or marked subtitlesIncomplete in R2 storage.
 */
export function ensureTrackSubtitlesInBackground(
  track: JamendoTrack,
  language: 'he' | 'en' = 'he'
): Promise<void> {
  if (!track?.id || track.subtitlesDisabled || failedTrackIds.has(track.id)) {
    return Promise.resolve();
  }
  const hasAnySubs = Boolean(
    track.subtitleSegments?.length ||
    track.subtitleSegmentsHe?.length ||
    track.subtitleSegmentsEn?.length ||
    track.subtitleSegmentsOrig?.length ||
    track.lyrics?.trim() ||
    track.lyricsHe?.trim() ||
    track.lyricsEn?.trim() ||
    track.lyricsOrig?.trim()
  );
  const completedUpTo = Math.max(0, Number(track.subtitlesCompletedUpTo) || 0);
  const totalDur = Math.max(30, Number(track.duration) || 180);
  const needsCompletion = Boolean(
    track.subtitlesIncomplete === true &&
    completedUpTo > 0 &&
    completedUpTo < totalDur - 8
  );

  if (hasAnySubs && !needsCompletion) {
    return Promise.resolve();
  }

  return startProgressiveTrackSubtitleJob({
    track,
    language,
  });
}
