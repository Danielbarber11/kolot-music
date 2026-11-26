import { JamendoTrack, SubtitleSegment } from './types';
import { sanitizeSubtitleLettersOnly } from './utils/subtitleTextUtils';

export interface LyricWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface SynchronizedLine {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  words: LyricWord[];
}

export interface SynchronizedLyrics {
  lines: SynchronizedLine[];
  previewText: string;
  isWhisperSynced?: boolean;
}

function estimateFallbackWordWeight(word: string): number {
  const letters = word.replace(/[^\p{L}]/gu, '');
  if (!letters) return 0.5;
  const vowels = letters.match(/[aeiouyאאהוי]/gi);
  const syllables = Math.max(1, vowels ? vowels.length : Math.ceil(letters.length / 2.6));
  const lengthBoost = letters.length <= 2 ? 0.65 : letters.length >= 6 ? 1.2 : 1.0;
  return (0.45 + syllables * 0.42 + Math.min(10, letters.length) * 0.1) * lengthBoost;
}

export function buildWordsForSegment(text: string, startTime: number, endTime: number): LyricWord[] {
  const clean = sanitizeSubtitleLettersOnly(text);
  const wordsRaw = clean.split(/\s+/).filter((w) => w.length > 0);
  if (wordsRaw.length === 0) return [];
  const span = Math.max(0.45, endTime - startTime);
  if (wordsRaw.length === 1) {
    return [{ text: wordsRaw[0], startTime, endTime: startTime + span }];
  }

  const weights = wordsRaw.map(estimateFallbackWordWeight);
  const totalWeight = weights.reduce((a, b) => a + b, 0) || wordsRaw.length;
  let cursor = startTime;

  return wordsRaw.map((wordStr, idx) => {
    const share = (weights[idx] / totalWeight) * span;
    const wStart = cursor;
    const wEnd = idx === wordsRaw.length - 1 ? startTime + span : wStart + share;
    cursor = wEnd;
    return {
      text: wordStr,
      startTime: Number(wStart.toFixed(2)),
      endTime: Number(wEnd.toFixed(2)),
    };
  });
}

function parseLrcTimestamp(ts: string): number {
  const parts = ts.split(':').map((n) => parseFloat(n));
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/**
 * Smart Whisper AI Subtitles & Karaoke Sync Generator
 * Reads saved timestamped segments and enforces clean letters-only subtitles.
 */
export function generateSynchronizedLyrics(
  track: JamendoTrack,
  overrideSegments?: SubtitleSegment[],
  preferredLang: 'he' | 'en' | 'orig' = 'he'
): SynchronizedLyrics {
  const segments =
    overrideSegments && overrideSegments.length > 0
      ? overrideSegments
      : preferredLang === 'orig' && track.subtitleSegmentsOrig && track.subtitleSegmentsOrig.length > 0
        ? track.subtitleSegmentsOrig
        : preferredLang === 'en' && track.subtitleSegmentsEn && track.subtitleSegmentsEn.length > 0
          ? track.subtitleSegmentsEn
          : preferredLang === 'he' && track.subtitleSegmentsHe && track.subtitleSegmentsHe.length > 0
            ? track.subtitleSegmentsHe
            : track.subtitleSegments && track.subtitleSegments.length > 0
              ? track.subtitleSegments
              : undefined;

  if (segments && segments.length > 0) {
    const rawLines: SynchronizedLine[] = segments
      .map((seg, idx) => {
        const cleanText = sanitizeSubtitleLettersOnly(seg.text);
        if (!cleanText) return null;
        let startTime = Math.max(0, Number(seg.startTime) || 0);
        let endTime = Math.max(startTime + 0.45, Number(seg.endTime) || startTime + 3.5);
        const rawWords =
          seg.words && seg.words.length > 0
            ? seg.words
                .map((w) => ({
                  ...w,
                  text: sanitizeSubtitleLettersOnly(w.text),
                }))
                .filter((w) => w.text.length > 0)
            : buildWordsForSegment(cleanText, startTime, endTime);

        if (rawWords.length > 0) {
          const wStart = Number(rawWords[0].startTime);
          const wEnd = Number(rawWords[rawWords.length - 1].endTime);
          if (Number.isFinite(wStart) && wStart > startTime && wStart < endTime - 0.25) {
            startTime = wStart;
          }
          if (Number.isFinite(wEnd) && wEnd > startTime + 0.25 && wEnd < endTime) {
            endTime = wEnd;
          }
        }

        return {
          id: seg.id || `whisper_line_${idx}`,
          startTime,
          endTime,
          text: cleanText,
          words: rawWords,
        };
      })
      .filter((l): l is SynchronizedLine => !!l)
      .sort((a, b) => a.startTime - b.startTime);

    // Clamp overlapping boundaries cleanly so as soon as next line starts, previous line finishes
    const lines: SynchronizedLine[] = rawLines.map((line, idx) => {
      const next = rawLines[idx + 1];
      let clampedEnd = line.endTime;
      if (next && clampedEnd > next.startTime) {
        clampedEnd = Math.max(line.startTime + 0.2, next.startTime - 0.02);
      }
      const clampedWords = line.words.map((w) => ({
        ...w,
        startTime: Math.max(line.startTime, Math.min(clampedEnd - 0.05, w.startTime)),
        endTime: Math.max(line.startTime + 0.05, Math.min(clampedEnd, w.endTime)),
      }));
      return {
        ...line,
        endTime: clampedEnd,
        words: clampedWords,
      };
    });

    if (lines.length > 0) {
      return {
        lines,
        previewText: lines.slice(0, 2).map((l) => l.text).join(' '),
        isWhisperSynced: true,
      };
    }
  }

  const duration = Math.max(30, track.duration || 180);
  const songName = sanitizeSubtitleLettersOnly(track.name || 'שיר');
  const artistName = sanitizeSubtitleLettersOnly(track.artistName || 'אמן');

  const sourceLyrics =
    preferredLang === 'orig'
      ? track.lyricsOrig || track.lyrics
      : preferredLang === 'en'
        ? track.lyricsEn || track.lyrics
        : track.lyricsHe || track.lyrics;

  let rawLines: string[] = [];

  if (sourceLyrics && typeof sourceLyrics === 'string' && sourceLyrics.trim().length > 0) {
    const splitRaw = sourceLyrics
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);

    // Parse [MM:SS] LRC timestamps if present inside lyrics
    const lrcParsed: SynchronizedLine[] = [];
    splitRaw.forEach((line, idx) => {
      const match = line.match(/^\[(\d{1,2}:\d{2}(?:\.\d{1,2})?)\]\s*(.+)$/);
      if (match) {
        const startTime = parseLrcTimestamp(match[1]);
        const text = sanitizeSubtitleLettersOnly(match[2]);
        if (text) {
          lrcParsed.push({
            id: `lrc_${idx}`,
            startTime,
            endTime: startTime + 4,
            text,
            words: [],
          });
        }
      }
    });

    if (lrcParsed.length > 0) {
      const finalized = lrcParsed.map((line, idx) => {
        const next = lrcParsed[idx + 1];
        const endTime = next && next.startTime > line.startTime ? next.startTime : Math.min(duration, line.startTime + 5);
        return {
          ...line,
          endTime,
          words: buildWordsForSegment(line.text, line.startTime, endTime),
        };
      });
      return {
        lines: finalized,
        previewText: finalized.slice(0, 2).map((l) => l.text).join(' '),
        isWhisperSynced: true,
      };
    }

    rawLines = splitRaw.map(sanitizeSubtitleLettersOnly).filter(Boolean);
  }

  if (rawLines.length === 0) {
    return {
      lines: [],
      previewText: '',
      isWhisperSynced: false,
    };
  }

  const lineCount = rawLines.length;
  const intro = rawLines.length > 2 && duration > 30 ? 6 : 0;
  const activeDuration = Math.max(8, duration - intro - 4);
  const timePerLine = activeDuration / Math.max(1, lineCount);

  const lines: SynchronizedLine[] = rawLines.map((lineText, idx) => {
    const startTime = intro + idx * timePerLine;
    const endTime = startTime + timePerLine;

    return {
      id: `line_${idx}_${Math.round(startTime)}`,
      startTime,
      endTime,
      text: lineText,
      words: buildWordsForSegment(lineText, startTime, endTime),
    };
  });

  return {
    lines,
    previewText: rawLines.slice(0, 2).join(' '),
    isWhisperSynced: false,
  };
}

export async function buildInstantSubtitlesFromLyrics(
  ...args: Parameters<typeof import('./services/onDeviceWhisperService').buildInstantSubtitlesFromLyrics>
) {
  const m = await import('./services/onDeviceWhisperService');
  return m.buildInstantSubtitlesFromLyrics(...args);
}

export async function parseSubtitleFileContent(
  ...args: Parameters<typeof import('./services/onDeviceWhisperService').parseSubtitleFileContent>
) {
  const m = await import('./services/onDeviceWhisperService');
  return m.parseSubtitleFileContent(...args);
}

/**
 * Generates bilingual letters-only subtitle tracks without blocking the main UI thread.
 */
export async function transcribeTrackWithWhisperAI(
  options: {
    track?: JamendoTrack;
    audioFile?: File | Blob;
    language?: 'he' | 'en';
    subtitleLanguageHint?: 'auto' | 'he' | 'en';
    startTimeSeconds?: number;
    signal?: AbortSignal;
    onProgress?: (statusText: string, percent?: number) => void;
    onPartialSegments?: (partial: {
      segments: SubtitleSegment[];
      segmentsHe: SubtitleSegment[];
      segmentsEn: SubtitleSegment[];
      lyricsHe: string;
      lyricsEn: string;
      completedChunks: number;
      totalChunks: number;
    }) => void;
  }
): Promise<{
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
  const { transcribeAudioOnDevice } = await import('./services/onDeviceWhisperService');
  return transcribeAudioOnDevice({
    audioFile: options.audioFile,
    audioUrl: options.track?.audioUrl,
    language: options.language || 'he',
    subtitleLanguageHint: options.subtitleLanguageHint,
    trackDuration: options.track?.duration || 180,
    hintTitle: options.track?.name,
    startTimeSeconds: options.startTimeSeconds,
    signal: options.signal,
    onProgress: options.onProgress,
    onPartialSegments: options.onPartialSegments,
  });
}
