import { JamendoTrack } from '../types';

export interface CanonicalGenreMeta {
  id: string;
  labelHe: string;
  labelEn: string;
  descriptionHe: string;
}

export const CANONICAL_GENRES: CanonicalGenreMeta[] = [
  { id: 'Mizrahi', labelHe: 'מזרחית', labelEn: 'Mizrahi', descriptionHe: 'סלסולים, מקצבים ים-תיכוניים ודרבוקה' },
  { id: 'Pop', labelHe: 'פופ', labelEn: 'Pop', descriptionHe: 'להיטים קליטים והפקה עכשווית' },
  { id: 'Hip Hop', labelHe: 'היפ הופ / ראפ', labelEn: 'Hip Hop', descriptionHe: 'ביטים, פלואו וראפ מקורי' },
  { id: 'Rock', labelHe: 'רוק', labelEn: 'Rock', descriptionHe: 'גיטרות חשמליות ואנרגיה חיה' },
  { id: 'Electronic', labelHe: 'אלקטרוני', labelEn: 'Electronic', descriptionHe: 'דאנס, האוס, טכנו וסינתיסייזרים' },
  { id: 'Acoustic', labelHe: 'אקוסטי', labelEn: 'Acoustic', descriptionHe: 'גיטרה חמה, פסנתר וקול קרוב' },
  { id: 'Chill', labelHe: 'צ׳יל', labelEn: 'Chill', descriptionHe: 'רוגע, אווירה ומוזיקה לרקע' },
  { id: 'Classical', labelHe: 'קלאסי', labelEn: 'Classical', descriptionHe: 'כלים קלאסיים ותזמורתיים' },
  { id: 'Jazz', labelHe: 'ג׳אז', labelEn: 'Jazz', descriptionHe: 'סקסופון, גרוב ואלתור' },
  { id: 'Blues', labelHe: 'בלוז', labelEn: 'Blues', descriptionHe: 'נשמה, ריפים עמוקים ו-R&B' },
  { id: 'Cinematic', labelHe: 'קולנועי', labelEn: 'Cinematic', descriptionHe: 'פסקולים ומוזיקה אפית' },
];

const UNTAGGED_VALUES = new Set([
  '',
  'none',
  'general',
  'music',
  'ללא סגנון',
  'ללא סגנון מוזיקלי',
  'no style',
  'other',
  'אחר',
  'שונות',
]);

/**
 * Normalizes any Hebrew or English genre string to a canonical genre ID (or '' if untagged).
 */
export function normalizeGenreId(rawGenre?: string): string {
  const clean = (rawGenre || '').trim().toLowerCase();
  if (!clean || UNTAGGED_VALUES.has(clean)) return '';

  if (clean.includes('mizrahi') || clean.includes('מזרח') || clean.includes('ים תיכונ') || clean.includes('חפלה')) {
    return 'Mizrahi';
  }
  if (clean.includes('hip') || clean.includes('rap') || clean.includes('trap') || clean.includes('היפ') || clean.includes('ראפ')) {
    return 'Hip Hop';
  }
  if (clean.includes('rock') || clean.includes('metal') || clean.includes('punk') || clean.includes('רוק')) {
    return 'Rock';
  }
  if (clean.includes('elect') || clean.includes('edm') || clean.includes('house') || clean.includes('techno') || clean.includes('trance') || clean.includes('אלקטרונ')) {
    return 'Electronic';
  }
  if (clean.includes('acoust') || clean.includes('folk') || clean.includes('אקוסט')) {
    return 'Acoustic';
  }
  if (clean.includes('chill') || clean.includes('lofi') || clean.includes('lo-fi') || clean.includes('ambient') || clean.includes('צ׳יל') || clean.includes("צ'יל")) {
    return 'Chill';
  }
  if (clean.includes('classic') || clean.includes('קלאס')) {
    return 'Classical';
  }
  if (clean.includes('jazz') || clean.includes('ג׳אז') || clean.includes("ג'אז")) {
    return 'Jazz';
  }
  if (clean.includes('blues') || clean.includes('soul') || clean.includes('בלוז')) {
    return 'Blues';
  }
  if (clean.includes('cinematic') || clean.includes('soundtrack') || clean.includes('קולנוע')) {
    return 'Cinematic';
  }
  if (clean.includes('pop') || clean.includes('פופ')) {
    return 'Pop';
  }

  return rawGenre!.trim();
}

export function isUntaggedGenre(rawGenre?: string): boolean {
  return normalizeGenreId(rawGenre) === '';
}

export function getGenreDisplayLabel(rawGenre?: string, isHe = true): string {
  const canonical = normalizeGenreId(rawGenre);
  if (!canonical) {
    return isHe ? 'ללא סגנון' : 'Untagged';
  }
  const found = CANONICAL_GENRES.find((g) => g.id.toLowerCase() === canonical.toLowerCase());
  if (found) {
    return isHe ? found.labelHe : found.labelEn;
  }
  return canonical;
}

export interface AudioClassificationResult {
  success: boolean;
  genre: string;
  hebrewGenre: string;
  confidence: number;
  mood?: string;
  bpmEstimate?: number;
  reasonHe?: string;
  provider?: string;
  acousticTags?: string[];
  error?: string;
}

/**
 * Classifies the actual audio track via POST /api/ai/classify-audio
 */
export async function classifyTrackAudio(params: {
  audioFile?: File | Blob | null;
  track?: Partial<JamendoTrack>;
  audioUrl?: string;
  songTitle?: string;
  artistName?: string;
  lyrics?: string;
}): Promise<AudioClassificationResult> {
  try {
    const title = params.songTitle || params.track?.name || '';
    const artist = params.artistName || params.track?.artistName || '';
    const lyrics = params.lyrics || params.track?.lyrics || '';
    const audioUrl = params.audioUrl || params.track?.audioUrl || '';

    let response: Response;

    if (params.audioFile) {
      const formData = new FormData();
      formData.append('file', params.audioFile);
      formData.append('songTitle', title);
      formData.append('artistName', artist);
      formData.append('lyrics', lyrics.slice(0, 600));
      response = await fetch('/api/ai/classify-audio', {
        method: 'POST',
        body: formData,
      });
    } else {
      response = await fetch('/api/ai/classify-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioUrl,
          songTitle: title,
          artistName: artist,
          lyrics: lyrics.slice(0, 600),
        }),
      });
    }

    const rawText = await response.text();
    let parsed: any = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok || !parsed?.success) {
      return {
        success: false,
        genre: 'Pop',
        hebrewGenre: 'פופ',
        confidence: 0,
        error: parsed?.error || `שגיאה בזיהוי הז'אנר (${response.status})`,
      };
    }

    const canonical = normalizeGenreId(parsed.genre) || 'Pop';
    return {
      success: true,
      genre: canonical,
      hebrewGenre: parsed.hebrewGenre || getGenreDisplayLabel(canonical, true),
      confidence: Number(parsed.confidence) || 0.85,
      mood: parsed.mood || '',
      bpmEstimate: parsed.bpmEstimate,
      reasonHe: parsed.reasonHe || 'זוהה ישירות מתוך השמע',
      provider: parsed.provider,
      acousticTags: parsed.acousticTags || [],
    };
  } catch (err: any) {
    return {
      success: false,
      genre: 'Pop',
      hebrewGenre: 'פופ',
      confidence: 0,
      error: err?.message || 'שגיאת רשת בזיהוי הז׳אנר',
    };
  }
}
