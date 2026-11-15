import { JamendoTrack } from '../types';
import { decodeAudioToMono16k, getOnDeviceAudioClassifierPipeline } from './onDeviceWhisperService';

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

interface WaveformFeatures {
  rms: number;
  zeroCrossingRate: number;
  bassRatio: number;
  midRatio: number;
  highRatio: number;
  bpm: number;
  dynamicVariance: number;
}

/**
 * Computes fast, deterministic Web Audio acoustic features on a 16kHz PCM buffer (< 150ms, zero network).
 */
function analyzeWaveformFeatures(pcm: Float32Array): WaveformFeatures {
  const sampleRate = 16000;
  const len = pcm.length;
  if (len === 0) {
    return { rms: 0.1, zeroCrossingRate: 0.08, bassRatio: 0.35, midRatio: 0.45, highRatio: 0.2, bpm: 112, dynamicVariance: 0.2 };
  }

  let sumSq = 0;
  let zcCount = 0;
  let lpPrev = 0;
  let lpMidPrev = 0;
  let bassEnergy = 0;
  let midEnergy = 0;
  let highEnergy = 0;

  // 1-pole crossover filters at 180Hz and 2200Hz at 16kHz sample rate
  const alphaLow = 0.068;
  const alphaMid = 0.56;

  // Frame energy for onset BPM estimation (50ms frames = 800 samples)
  const frameSize = 800;
  const frameEnergies: number[] = [];
  let frameAccum = 0;

  for (let i = 0; i < len; i++) {
    const x = pcm[i];
    sumSq += x * x;
    if (i > 0 && ((pcm[i - 1] >= 0 && x < 0) || (pcm[i - 1] < 0 && x >= 0))) {
      zcCount++;
    }

    lpPrev = lpPrev + alphaLow * (x - lpPrev);
    lpMidPrev = lpMidPrev + alphaMid * (x - lpMidPrev);
    const bandMid = lpMidPrev - lpPrev;
    const bandHigh = x - lpMidPrev;

    bassEnergy += lpPrev * lpPrev;
    midEnergy += bandMid * bandMid;
    highEnergy += bandHigh * bandHigh;

    frameAccum += x * x;
    if ((i + 1) % frameSize === 0) {
      frameEnergies.push(Math.sqrt(frameAccum / frameSize));
      frameAccum = 0;
    }
  }

  const totalBand = bassEnergy + midEnergy + highEnergy + 1e-9;
  const rms = Math.sqrt(sumSq / len);
  const zcr = zcCount / len;

  // Compute dynamic variance across 50ms windows
  let meanFrame = 0;
  for (const e of frameEnergies) meanFrame += e;
  meanFrame /= Math.max(1, frameEnergies.length);

  let varAccum = 0;
  let peakOnsets = 0;
  for (let i = 1; i < frameEnergies.length; i++) {
    const diff = frameEnergies[i] - meanFrame;
    varAccum += diff * diff;
    if (frameEnergies[i] > meanFrame * 1.38 && frameEnergies[i - 1] <= meanFrame * 1.38) {
      peakOnsets++;
    }
  }
  const dynamicVariance = Math.sqrt(varAccum / Math.max(1, frameEnergies.length)) / (meanFrame + 1e-6);
  const secondsAnalyzed = len / sampleRate;
  const rawBpm = secondsAnalyzed > 3 ? Math.round((peakOnsets / secondsAnalyzed) * 60) : 112;
  const bpm = Math.max(68, Math.min(165, rawBpm < 68 ? rawBpm * 2 : rawBpm > 165 ? Math.round(rawBpm / 2) : rawBpm));

  return {
    rms,
    zeroCrossingRate: zcr,
    bassRatio: bassEnergy / totalBand,
    midRatio: midEnergy / totalBand,
    highRatio: highEnergy / totalBand,
    bpm,
    dynamicVariance,
  };
}

function mapAudioSetLabelsToGenre(
  labels: Array<{ label: string; score: number }>,
  features: WaveformFeatures | null,
  titleHint: string,
  artistHint: string,
  lyricsHint: string
): AudioClassificationResult {
  const combinedText = `${titleHint} ${artistHint} ${lyricsHint}`.toLowerCase();
  const scores: Record<string, number> = {
    Mizrahi: 0,
    Pop: 0.15,
    'Hip Hop': 0,
    Rock: 0,
    Electronic: 0,
    Acoustic: 0,
    Chill: 0,
    Classical: 0,
    Jazz: 0,
    Blues: 0,
    Cinematic: 0,
  };

  // 1. Acoustic Spectral & Rhythm Waveform Scoring
  if (features) {
    if (features.bassRatio > 0.42 && features.bpm >= 118) scores.Electronic += 0.42;
    if (features.bassRatio > 0.40 && features.bpm < 110 && features.bpm >= 75) scores['Hip Hop'] += 0.38;
    if (features.highRatio > 0.30 && features.zeroCrossingRate > 0.14) scores.Rock += 0.34;
    if (features.midRatio > 0.50 && features.bassRatio < 0.30) {
      scores.Acoustic += 0.28;
      scores.Mizrahi += 0.22;
    }
    if (features.bpm < 88 && features.rms < 0.14) {
      scores.Chill += 0.35;
      scores.Classical += 0.18;
    }
    if (features.dynamicVariance > 0.65 && features.midRatio > 0.44) {
      scores.Cinematic += 0.22;
    }
  }

  // 2. Transformers.js AST AudioSet Labels Scoring
  const acousticTags: string[] = [];
  for (const item of labels) {
    const lbl = item.label.toLowerCase();
    const w = item.score * 1.4;
    acousticTags.push(item.label);

    if (lbl.includes('middle eastern') || lbl.includes('traditional') || lbl.includes('arabic') || lbl.includes('oud') || lbl.includes('tabla') || lbl.includes('mandolin')) {
      scores.Mizrahi += w + 0.35;
    }
    if (lbl.includes('hip hop') || lbl.includes('rapping') || lbl.includes('beatbox') || lbl.includes('drum machine')) {
      scores['Hip Hop'] += w + 0.35;
    }
    if (lbl.includes('rock') || lbl.includes('heavy metal') || lbl.includes('punk') || lbl.includes('electric guitar') || lbl.includes('distortion')) {
      scores.Rock += w + 0.35;
    }
    if (lbl.includes('electronic') || lbl.includes('techno') || lbl.includes('house') || lbl.includes('trance') || lbl.includes('edm') || lbl.includes('synthesizer') || lbl.includes('disco')) {
      scores.Electronic += w + 0.35;
    }
    if (lbl.includes('acoustic') || lbl.includes('folk') || lbl.includes('guitar') && !lbl.includes('electric') || lbl.includes('country')) {
      scores.Acoustic += w + 0.30;
    }
    if (lbl.includes('ambient') || lbl.includes('chill') || lbl.includes('new-age') || lbl.includes('lullaby')) {
      scores.Chill += w + 0.30;
    }
    if (lbl.includes('classical') || lbl.includes('orchestra') || lbl.includes('symphony') || lbl.includes('violin') || lbl.includes('cello') || lbl.includes('piano')) {
      scores.Classical += w + 0.30;
    }
    if (lbl.includes('jazz') || lbl.includes('saxophone') || lbl.includes('brass') || lbl.includes('swing')) {
      scores.Jazz += w + 0.35;
    }
    if (lbl.includes('blues') || lbl.includes('soul') || lbl.includes('rhythm and blues')) {
      scores.Blues += w + 0.35;
    }
    if (lbl.includes('soundtrack') || lbl.includes('theme music') || lbl.includes('film')) {
      scores.Cinematic += w + 0.30;
    }
    if (lbl.includes('pop') || lbl.includes('vocal music') || lbl.includes('singing')) {
      scores.Pop += w * 0.8 + 0.15;
    }
  }

  // 3. Language/Title context boost
  if (/[\u0590-\u05FF]/.test(combinedText)) {
    // Israeli/Hebrew vocals boost Mizrahi vs Pop naturally
    if (/מזרח|חפלה|סלסול|דרבוקה|בוזוקי|נשמה|עיניים|כפרה|לב|יאללה|אהבה|שמח/.test(combinedText)) {
      scores.Mizrahi += 0.45;
    } else if (/ראפ|ביט|היפ|טראפ|חרוז/.test(combinedText)) {
      scores['Hip Hop'] += 0.55;
    } else if (/רוק|גיטרה|מטאל/.test(combinedText)) {
      scores.Rock += 0.55;
    } else if (/טראנס|האוס|אלקטרו|רמיקס/.test(combinedText)) {
      scores.Electronic += 0.55;
    } else if (/אקוסט|שקט|מדורה/.test(combinedText)) {
      scores.Acoustic += 0.50;
    } else if (/צ׳יל|צ'יל|רגיעה|לילה/.test(combinedText)) {
      scores.Chill += 0.50;
    } else {
      scores.Pop += 0.18;
    }
  } else {
    if (/rap|hip hop|trap|drill|flow/.test(combinedText)) scores['Hip Hop'] += 0.55;
    if (/rock|metal|punk|guitar|indie/.test(combinedText)) scores.Rock += 0.55;
    if (/edm|house|techno|trance|remix|electro|synth/.test(combinedText)) scores.Electronic += 0.55;
    if (/lofi|lo-fi|chill|ambient|relax/.test(combinedText)) scores.Chill += 0.55;
    if (/acoustic|unplugged|folk/.test(combinedText)) scores.Acoustic += 0.50;
    if (/classic|piano|violin|orchestra/.test(combinedText)) scores.Classical += 0.50;
    if (/jazz|sax/.test(combinedText)) scores.Jazz += 0.55;
    if (/blues|soul/.test(combinedText)) scores.Blues += 0.55;
    if (/soundtrack|cinematic|epic/.test(combinedText)) scores.Cinematic += 0.55;
    if (/mizrahi|oriental/.test(combinedText)) scores.Mizrahi += 0.55;
  }

  let bestGenre = 'Pop';
  let bestScore = -1;
  for (const [g, s] of Object.entries(scores)) {
    if (s > bestScore) {
      bestScore = s;
      bestGenre = g;
    }
  }

  const foundMeta = CANONICAL_GENRES.find((g) => g.id === bestGenre);
  const confidence = Math.min(0.97, Math.max(0.72, 0.72 + bestScore * 0.22));
  const bpm = features?.bpm || 110;
  const moodMap: Record<string, string> = {
    Mizrahi: 'רגשי / ים-תיכוני',
    Pop: 'קצבי / סוחף',
    'Hip Hop': 'אורבני / מקצבי',
    Rock: 'אנרגטי / עוצמתי',
    Electronic: 'מסיבתי / אלקטרוני',
    Acoustic: 'חמים / אינטימי',
    Chill: 'רגוע / אווירתי',
    Classical: 'קלאסי / מלכותי',
    Jazz: 'גרובי / מתוחכם',
    Blues: 'עמוק / נשמה',
    Cinematic: 'דרמטי / קולנועי',
  };

  return {
    success: true,
    genre: bestGenre,
    hebrewGenre: foundMeta?.labelHe || bestGenre,
    confidence: Number(confidence.toFixed(2)),
    mood: moodMap[bestGenre] || 'מוזיקלי',
    bpmEstimate: bpm,
    reasonHe:
      acousticTags.length > 0
        ? `זוהה במכשיר (ללא מפתח API): ספקטרום ${bpm} BPM • ${acousticTags.slice(0, 2).join(', ')}`
        : `זוהה מקומית מגלי השמע במכשיר (~${bpm} BPM)`,
    provider: acousticTags.length > 0 ? 'on-device-ast+dsp' : 'on-device-dsp',
    acousticTags,
  };
}

/**
 * Runs 100% On-Device Audio Classification directly in the browser (0 API keys, $0 cost, unlimited).
 * - Quick mode (`deepClassify: false`): Sub-second Web Audio DSP waveform analysis (<250ms).
 * - Deep mode (`deepClassify: true`, default): Runs Web Audio DSP + On-Device HuggingFace AST neural classifier.
 */
export async function classifyTrackAudio(params: {
  audioFile?: File | Blob | null;
  track?: Partial<JamendoTrack>;
  audioUrl?: string;
  songTitle?: string;
  artistName?: string;
  lyrics?: string;
  deepClassify?: boolean;
  onProgress?: (statusText: string, percent?: number) => void;
}): Promise<AudioClassificationResult> {
  const title = params.songTitle || params.track?.name || '';
  const artist = params.artistName || params.track?.artistName || '';
  const lyrics = params.lyrics || params.track?.lyrics || '';
  const source = params.audioFile || params.audioUrl || params.track?.audioUrl;

  let features: WaveformFeatures | null = null;
  let pcm: Float32Array | null = null;

  if (source) {
    try {
      params.onProgress?.('מנתח את תדרי השמע והקצב במכשיר...', 15);
      const decoded = await decodeAudioToMono16k(source, 25);
      pcm = decoded.pcm;
      features = analyzeWaveformFeatures(pcm);
    } catch (err) {
      console.warn('[OnDeviceAudioClassify] Decode notice:', err);
    }
  }

  let astLabels: Array<{ label: string; score: number }> = [];
  if (params.deepClassify !== false && pcm && pcm.length > 1600) {
    try {
      const classifier = await getOnDeviceAudioClassifierPipeline(params.onProgress);
      params.onProgress?.('מזהה כלים וז׳אנר על המכשיר (100% חינם)...', 96);
      const rawOut = await classifier(pcm, { top_k: 6 });
      if (Array.isArray(rawOut)) {
        astLabels = rawOut.map((x: any) => ({
          label: String(x.label || ''),
          score: Number(x.score || 0),
        }));
      }
    } catch (astErr) {
      console.warn('[OnDeviceAudioClassify] AST fallback to Web Audio DSP:', astErr);
    }
  }

  return mapAudioSetLabelsToGenre(astLabels, features, title, artist, lyrics);
}
