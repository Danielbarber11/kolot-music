import { JamendoTrack, SubtitleSegment } from './types';

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
  const wordsRaw = text.split(/\s+/).filter((w) => w.length > 0);
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
 * Prioritizes real Whisper AI timestamped segments -> LRC timestamps -> distributed lyrics -> fallback.
 */
export function generateSynchronizedLyrics(
  track: JamendoTrack,
  overrideSegments?: SubtitleSegment[]
): SynchronizedLyrics {
  const segments =
    overrideSegments && overrideSegments.length > 0
      ? overrideSegments
      : track.subtitleSegments && track.subtitleSegments.length > 0
        ? track.subtitleSegments
        : undefined;

  if (segments && segments.length > 0) {
    const lines: SynchronizedLine[] = segments.map((seg, idx) => {
      const startTime = Math.max(0, Number(seg.startTime) || 0);
      const endTime = Math.max(startTime + 0.8, Number(seg.endTime) || startTime + 4);
      const words =
        seg.words && seg.words.length > 0
          ? seg.words
          : buildWordsForSegment(seg.text, startTime, endTime);

      return {
        id: seg.id || `whisper_line_${idx}`,
        startTime,
        endTime,
        text: seg.text,
        words,
      };
    });

    return {
      lines,
      previewText: lines.slice(0, 2).map((l) => l.text).join(' • '),
      isWhisperSynced: true,
    };
  }

  const duration = Math.max(30, track.duration || 180);
  const songName = track.name || 'שיר';
  const artistName = track.artistName || 'אמן';

  let rawLines: string[] = [];

  if (track.lyrics && typeof track.lyrics === 'string' && track.lyrics.trim().length > 0) {
    rawLines = track.lyrics
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0);

    // Parse [MM:SS] LRC timestamps if present inside track.lyrics
    const lrcParsed: SynchronizedLine[] = [];
    rawLines.forEach((line, idx) => {
      const match = line.match(/^\[(\d{1,2}:\d{2}(?:\.\d{1,2})?)\]\s*(.+)$/);
      if (match) {
        const startTime = parseLrcTimestamp(match[1]);
        const text = match[2].trim();
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
        previewText: finalized.slice(0, 2).map((l) => l.text).join(' • '),
        isWhisperSynced: true,
      };
    }
  }

  if (rawLines.length === 0) {
    const isHebrew = /[\u0590-\u05FF]/.test(songName) || /[\u0590-\u05FF]/.test(artistName);

    if (isHebrew) {
      rawLines = [
        `לחץ על "כתוביות Whisper AI" לתמלול אוטומטי מהשמע`,
        `שיר: ${songName} • ${artistName}`,
      ];
    } else {
      rawLines = [
        `Click "Whisper AI Subtitles" to transcribe synced captions from audio`,
        `Track: ${songName} • ${artistName}`,
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
    previewText: rawLines.slice(0, 2).join(' • '),
    isWhisperSynced: false,
  };
}

/**
 * Calls server-side Whisper AI audio transcription (/api/ai/transcribe) for a track or raw audio File.
 */
export async function transcribeTrackWithWhisperAI(
  options: {
    track?: JamendoTrack;
    audioFile?: File | Blob;
    language?: 'he' | 'en';
  }
): Promise<{
  success: boolean;
  segments?: SubtitleSegment[];
  lyrics?: string;
  provider?: string;
  error?: string;
}> {
  try {
    let res: Response;

    if (options.audioFile) {
      const formData = new FormData();
      formData.append('file', options.audioFile);
      formData.append('language', options.language || 'he');
      if (options.track?.name) formData.append('songTitle', options.track.name);
      if (options.track?.artistName) formData.append('artistName', options.track.artistName);
      if (options.track?.duration) formData.append('duration', String(options.track.duration));

      res = await fetch('/api/ai/transcribe', {
        method: 'POST',
        body: formData,
      });
    } else if (options.track?.audioUrl) {
      res = await fetch('/api/ai/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackId: options.track.id,
          audioUrl: options.track.audioUrl,
          songTitle: options.track.name,
          artistName: options.track.artistName,
          duration: options.track.duration || 180,
          language: options.language || 'he',
        }),
      });
    } else {
      return { success: false, error: 'אין קובץ שמע זמין לתמלול.' };
    }

    const rawText = await res.text();
    const trimmed = (rawText || '').trim();
    if (!trimmed || trimmed.startsWith('<')) {
      return {
        success: false,
        error: `שירות התמלול אינו זמין כרגע (HTTP ${res.status}). ודא ששרת ה-API מחובר.`,
      };
    }

    const data = JSON.parse(trimmed);
    if (!res.ok || !data.success) {
      return {
        success: false,
        error: data.error || 'שגיאה בתמלול הכתוביות מהשמע.',
      };
    }

    return {
      success: true,
      segments: Array.isArray(data.segments) ? data.segments : [],
      lyrics: data.lyrics || '',
      provider: data.provider || 'whisper-ai',
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'שגיאת תקשורת בעת תמלול Whisper AI.',
    };
  }
}
