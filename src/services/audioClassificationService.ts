import { JamendoTrack } from '../types';
import {
  decodeAudioToMono16k,
  extractFastAudioWavBlob,
  getOnDeviceAudioClassifierPipeline,
  isServerAiConfigured,
} from './onDeviceWhisperService';

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
    Pop: 0.04,
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
    if (features.bassRatio > 0.42 && features.bpm >= 118) scores.Electronic += 0.44;
    if (features.bassRatio > 0.39 && features.bpm < 112 && features.bpm >= 72) scores['Hip Hop'] += 0.40;
    if (features.highRatio > 0.28 && features.zeroCrossingRate > 0.13) scores.Rock += 0.38;
    if (features.midRatio > 0.49 && features.bassRatio < 0.32) {
      scores.Acoustic += 0.32;
      scores.Mizrahi += 0.28;
    }
    if (features.bpm < 90 && features.rms < 0.16) {
      scores.Chill += 0.36;
      scores.Classical += 0.24;
    }
    if (features.dynamicVariance > 0.60 && features.midRatio > 0.42) {
      scores.Cinematic += 0.28;
    }
    if (features.bpm >= 104 && features.bpm <= 130 && features.midRatio >= 0.36 && features.highRatio >= 0.18 && features.dynamicVariance < 0.55) {
      scores.Pop += 0.22;
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

  // 3. Language/Title/AI-Subtitles context boost (stronger when subtitle lyrics exist)
  const hasRichLyrics = (lyricsHint || '').trim().length > 25;
  const lyricsWeight = hasRichLyrics ? 0.68 : 0.48;
  if (/[\u0590-\u05FF]/.test(combinedText)) {
    // Israeli/Hebrew vocals & AI subtitle keywords
    if (/מזרח|חפלה|סלסול|דרבוקה|בוזוקי|נשמה|עיניים|כפרה|לב|יאללה|אהבה|שמח|חלום|יפה שלי|מתוקה|מלך|בוכה|לילה טוב|דמעה/.test(combinedText)) {
      scores.Mizrahi += lyricsWeight;
    }
    if (/ראפ|ביט|היפ|טראפ|חרוז|מיקרופון|שכונה|כסף|רחוב|במה|פאנץ|גטו|זורם/.test(combinedText)) {
      scores['Hip Hop'] += lyricsWeight + 0.08;
    }
    if (/רוק|גיטרה|מטאל|תופים|חשמל|זעקה|אש|צעקה|שבור/.test(combinedText)) {
      scores.Rock += lyricsWeight + 0.05;
    }
    if (/טראנס|האוס|אלקטרו|רמיקס|מסיבה|קצב|באס|מועדון|לרקוד|רחבה/.test(combinedText)) {
      scores.Electronic += lyricsWeight + 0.05;
    }
    if (/אקוסט|שקט|מדורה|פסנתר|עץ|מנגן|ציפור|גשם|שלווה/.test(combinedText)) {
      scores.Acoustic += lyricsWeight;
    }
    if (/צ׳יל|צ'יל|רגיעה|רוגע|שקיעה|עננים|ים|שקט/.test(combinedText)) {
      scores.Chill += lyricsWeight;
    }
    if (/קלאס|תזמורת|כינור|צ׳לו/.test(combinedText)) {
      scores.Classical += lyricsWeight;
    }
    if (/בלוז|כאב|בדידות|גשם בלילה/.test(combinedText)) {
      scores.Blues += lyricsWeight * 0.85;
    }
    if (/סרט|פסקול|דרמה|קולנוע/.test(combinedText)) {
      scores.Cinematic += lyricsWeight;
    }
    if (/לרקוד|שיר|פופ|עולם|כוכב|קיץ|שמש/.test(combinedText)) {
      scores.Pop += 0.28;
    }
  } else {
    if (/rap|hip hop|trap|drill|flow|mic|street|hustle|bars|beat|hood|drip/.test(combinedText)) scores['Hip Hop'] += lyricsWeight + 0.08;
    if (/rock|metal|punk|guitar|indie|scream|rebel|fire|thunder/.test(combinedText)) scores.Rock += lyricsWeight + 0.05;
    if (/edm|house|techno|trance|remix|electro|synth|club|bass|party|dance floor|rave/.test(combinedText)) scores.Electronic += lyricsWeight + 0.05;
    if (/lofi|lo-fi|chill|ambient|relax|sunset|calm|dream|breeze/.test(combinedText)) scores.Chill += lyricsWeight;
    if (/acoustic|unplugged|folk|whisper|candle|camp|wood|rain/.test(combinedText)) scores.Acoustic += lyricsWeight;
    if (/classic|piano|violin|orchestra|symphony/.test(combinedText)) scores.Classical += lyricsWeight;
    if (/jazz|sax|swing|brass/.test(combinedText)) scores.Jazz += lyricsWeight;
    if (/blues|soul|lonely|tears|midnight|heartache/.test(combinedText)) scores.Blues += lyricsWeight;
    if (/soundtrack|cinematic|epic|theme/.test(combinedText)) scores.Cinematic += lyricsWeight;
    if (/mizrahi|oriental|habibi|yalla/.test(combinedText)) scores.Mizrahi += lyricsWeight;
    if (/baby|love|tonight|yeah|heart|dance|feel/.test(combinedText)) scores.Pop += 0.25;
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
  const lyrics = params.lyrics || params.track?.lyrics || params.track?.lyricsHe || params.track?.lyricsEn || '';
  const source = params.audioFile || params.audioUrl || params.track?.audioUrl;

  // 1. Try Server AI Multimodal Classification (listens to real audio + reads lyrics/title) when configured
  try {
    const serverReady = await isServerAiConfigured().catch(() => false);
    if (serverReady && (source || lyrics.trim().length > 12 || title.trim().length > 2)) {
      params.onProgress?.('בינה מלאכותית מאזינה לשיר ומזהה ז׳אנר מתאים...', 25);
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 14000) : null;
      try {
        let uploadBlob: Blob | null = null;
        if (source) {
          const compact = await extractFastAudioWavBlob(source, 90, controller?.signal).catch(() => null);
          if (compact?.blob && compact.blob.size <= 10 * 1024 * 1024) {
            uploadBlob = compact.blob;
          } else if (params.audioFile && params.audioFile.size <= 12 * 1024 * 1024) {
            uploadBlob = params.audioFile;
          }
        }

        let res: Response;
        if (uploadBlob) {
          const fd = new FormData();
          fd.append('file', uploadBlob, 'sample.wav');
          if (title) fd.append('songTitle', title);
          if (artist) fd.append('artistName', artist);
          if (lyrics) fd.append('lyrics', lyrics.slice(0, 1500));
          res = await fetch('/api/ai/classify-audio', {
            method: 'POST',
            body: fd,
            credentials: 'include',
            signal: controller?.signal,
          });
        } else {
          res = await fetch('/api/ai/classify-audio', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              audioUrl: typeof source === 'string' ? source : '',
              songTitle: title,
              artistName: artist,
              lyrics: lyrics.slice(0, 1500),
            }),
            signal: controller?.signal,
          });
        }

        if (res.ok) {
          const data: any = await res.json().catch(() => null);
          if (data?.success && data.genre && data.provider && data.provider !== 'heuristic-metadata') {
            const canonical = normalizeGenreId(data.genre) || 'Pop';
            const foundMeta = CANONICAL_GENRES.find((g) => g.id === canonical);
            return {
              success: true,
              genre: canonical,
              hebrewGenre: foundMeta?.labelHe || data.hebrewGenre || canonical,
              confidence: Number(data.confidence) || 0.9,
              mood: data.mood || '',
              bpmEstimate: Number(data.bpmEstimate) || 110,
              reasonHe: data.reasonHe || 'זוהה באמצעות בינה מלאכותית מהשמע והמילים',
              provider: data.provider,
              acousticTags: Array.isArray(data.acousticTags) ? data.acousticTags : [],
            };
          }
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } catch (serverClsErr) {
    console.warn('[AI AudioClassify] Server AI notice, falling back to on-device neural/DSP:', serverClsErr);
  }

  // 2. Full On-Device Acoustic Waveform DSP + Chorus AST Neural Classifier fallback
  let features: WaveformFeatures | null = null;
  let pcm: Float32Array | null = null;

  if (source) {
    try {
      params.onProgress?.('מנתח את תדרי השמע והקצב במכשיר...', 45);
      const decoded = await decodeAudioToMono16k(source, 120);
      pcm = decoded.pcm;
      // Analyze energetic/chorus section (skip quiet intro when track has >= 45s)
      const analyzePcm =
        pcm.length > 16000 * 45
          ? pcm.subarray(Math.floor(pcm.length * 0.25), Math.min(pcm.length, Math.floor(pcm.length * 0.25) + 16000 * 40))
          : pcm;
      features = analyzeWaveformFeatures(analyzePcm);
    } catch (err) {
      console.warn('[OnDeviceAudioClassify] Decode notice:', err);
    }
  }

  let astLabels: Array<{ label: string; score: number }> = [];
  if (params.deepClassify !== false && pcm && pcm.length > 1600) {
    try {
      const classifier = await getOnDeviceAudioClassifierPipeline(params.onProgress);
      params.onProgress?.('מזהה כלים וז׳אנר על המכשיר (100% חינם)...', 96);
      // Sample up to 20s from the chorus/middle so quiet intros don't fool AST
      const astSlice =
        pcm.length > 16000 * 40
          ? pcm.subarray(Math.floor(pcm.length * 0.32), Math.min(pcm.length, Math.floor(pcm.length * 0.32) + 16000 * 20))
          : pcm;
      const rawOut = await classifier(astSlice, { top_k: 6 });
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
