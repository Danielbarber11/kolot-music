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

export const EXTRA_GENRE_HEBREW_LABELS: Record<string, string> = {
  'r&b': 'אר אנד בי (R&B)',
  rnb: 'אר אנד בי (R&B)',
  soul: 'סול / נשמה',
  reggae: 'רגאיי',
  reggaeton: 'רגאטון',
  latin: 'לטיני',
  country: 'קאנטרי',
  metal: 'מטאל',
  'heavy metal': 'הבי מטאל',
  punk: 'פאנק רוק',
  indie: 'אינדי',
  folk: 'פולק',
  trance: 'טראנס',
  psytrance: 'פסי-טראנס',
  house: 'האוס',
  'deep house': 'דיפ האוס',
  techno: 'טכנו',
  edm: 'דאנס / EDM',
  trap: 'טראפ',
  drill: 'דריל',
  'lo-fi': 'לו-פיי (Lo-Fi)',
  lofi: 'לו-פיי (Lo-Fi)',
  ambient: 'אמביינט',
  funk: 'פאנק (Funk)',
  disco: 'דיסקו',
  hasidic: 'חסידי / יהודי',
  jewish: 'יהודי / דתי',
  piyut: 'פיוט',
  opera: 'אופרה',
  'k-pop': 'קיי-פופ (K-Pop)',
  kpop: 'קיי-פופ (K-Pop)',
  afrobeat: 'אפרוביט',
  afropop: 'אפרופופ',
  gospel: 'גוספל',
  'spoken word': 'ספוקן וורד',
  kids: 'שירי ילדים',
  world: 'מוזיקת עולם',
  ballad: 'בלדה',
  dancehall: 'דאנסהול',
  synthwave: 'סינת׳ווייב',
  bossa: 'בוסה נובה',
  flamenco: 'פלמנקו',
  mediterranean: 'ים-תיכוני',
  greek: 'יווני',
};

const DISTINCT_CUSTOM_GENRE_KEYS = new Set(Object.keys(EXTRA_GENRE_HEBREW_LABELS));

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
 * Normalizes any Hebrew or English genre string to a canonical or distinct custom genre ID (or '' if untagged).
 */
export function normalizeGenreId(rawGenre?: string): string {
  const trimmed = (rawGenre || '').trim();
  const clean = trimmed.toLowerCase();
  if (!clean || UNTAGGED_VALUES.has(clean)) return '';

  if (DISTINCT_CUSTOM_GENRE_KEYS.has(clean)) {
    return trimmed;
  }

  if (clean === 'mizrahi' || clean === 'מזרחית' || clean.includes('מזרח') || clean.includes('סלסול') || clean.includes('חפלה')) {
    return 'Mizrahi';
  }
  if (clean === 'hip hop' || clean === 'היפ הופ' || clean === 'היפ הופ / ראפ' || clean === 'ראפ' || clean === 'rap') {
    return 'Hip Hop';
  }
  if (clean === 'rock' || clean === 'רוק') {
    return 'Rock';
  }
  if (clean === 'electronic' || clean === 'אלקטרוני' || clean === 'אלקטרוניקה') {
    return 'Electronic';
  }
  if (clean === 'acoustic' || clean === 'אקוסטי') {
    return 'Acoustic';
  }
  if (clean === 'chill' || clean === 'צ׳יל' || clean === "צ'יל") {
    return 'Chill';
  }
  if (clean === 'classical' || clean === 'קלאסי' || clean.includes('תזמורת')) {
    return 'Classical';
  }
  if (clean === 'jazz' || clean === 'ג׳אז' || clean === "ג'אז") {
    return 'Jazz';
  }
  if (clean === 'blues' || clean === 'בלוז') {
    return 'Blues';
  }
  if (clean === 'cinematic' || clean === 'קולנועי' || clean === 'פסקול') {
    return 'Cinematic';
  }
  if (clean === 'pop' || clean === 'פופ') {
    return 'Pop';
  }

  return trimmed;
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
  if (isHe) {
    const heExtra = EXTRA_GENRE_HEBREW_LABELS[canonical.toLowerCase()];
    if (heExtra) return heExtra;
  }
  return canonical;
}
