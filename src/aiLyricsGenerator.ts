import { JamendoTrack, SubtitleSegment } from './types';
import { transcribeAudioOnDevice, sanitizeSubtitleLettersOnly } from './services/onDeviceWhisperService';

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

function buildWordsForSegment(text: string, startTime: number, endTime: number): LyricWord[] {
  const clean = sanitizeSubtitleLettersOnly(text);
  const wordsRaw = clean.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = Math.max(1, wordsRaw.length);
  const span = Math.max(0.5, endTime - startTime);
  const timePerWord = span / wordCount;

  return wordsRaw.map((wordStr, wIdx) => {
    const wStart = startTime + wIdx * timePerWord;
    const wEnd = wStart + timePerWord;
    return {
      text: wordStr,
      startTime: wStart,
      endTime: wEnd,
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
  preferredLang: 'he' | 'en' = 'he'
): SynchronizedLyrics {
  const segments =
    overrideSegments && overrideSegments.length > 0
      ? overrideSegments
      : preferredLang === 'en' && track.subtitleSegmentsEn && track.subtitleSegmentsEn.length > 0
        ? track.subtitleSegmentsEn
        : preferredLang === 'he' && track.subtitleSegmentsHe && track.subtitleSegmentsHe.length > 0
          ? track.subtitleSegmentsHe
          : track.subtitleSegments && track.subtitleSegments.length > 0
            ? track.subtitleSegments
            : undefined;

  if (segments && segments.length > 0) {
    const lines: SynchronizedLine[] = segments
      .map((seg, idx) => {
        const cleanText = sanitizeSubtitleLettersOnly(seg.text);
        if (!cleanText) return null;
        const startTime = Math.max(0, Number(seg.startTime) || 0);
        const endTime = Math.max(startTime + 0.8, Number(seg.endTime) || startTime + 4);
        const words =
          seg.words && seg.words.length > 0
            ? seg.words
                .map((w) => ({
                  ...w,
                  text: sanitizeSubtitleLettersOnly(w.text),
                }))
                .filter((w) => w.text.length > 0)
            : buildWordsForSegment(cleanText, startTime, endTime);

        return {
          id: seg.id || `whisper_line_${idx}`,
          startTime,
          endTime,
          text: cleanText,
          words,
        };
      })
      .filter((l): l is SynchronizedLine => !!l);

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
    preferredLang === 'en'
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
    if (preferredLang === 'en') {
      rawLines = [
        'Click Generate Subtitles to transcribe locally for free',
        `${songName} ${artistName}`.trim(),
      ];
    } else {
      rawLines = [
        'לחץ על צור כתוביות על המכשיר לתמלול אוטומטי',
        `${songName} ${artistName}`.trim(),
      ];
    }
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

/**
 * Runs 100% On-Device Whisper AI transcription directly inside the browser (WASM).
 * Produces BOTH Hebrew and English letters-only subtitle tracks.
 */
export async function transcribeTrackWithWhisperAI(
  options: {
    track?: JamendoTrack;
    audioFile?: File | Blob;
    language?: 'he' | 'en';
    onProgress?: (statusText: string, percent?: number) => void;
  }
): Promise<{
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
  return transcribeAudioOnDevice({
    audioFile: options.audioFile,
    audioUrl: options.track?.audioUrl,
    language: options.language || 'he',
    trackDuration: options.track?.duration || 180,
    hintTitle: options.track?.name,
    onProgress: options.onProgress,
  });
}
