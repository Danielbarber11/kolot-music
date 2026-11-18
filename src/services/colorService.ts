import { useState, useEffect } from 'react';
import { JamendoTrack } from '../types';
import { isAuthenticCover } from '../components/TrackCoverArt';
import { getStreamingMediaUrl } from './cloudStorageService';

// Global cache for sampled cover art RGB colors so songs open with the exact color instantly
export const globalTrackColorCache = new Map<string, { r: number; g: number; b: number }>();

export const GENRE_RGB_MAP: Record<string, { r: number; g: number; b: number }> = {
  Rock: { r: 220, g: 38, b: 38 }, // Red / Rose
  Jazz: { r: 217, g: 119, b: 6 }, // Amber / Warm Orange
  Classical: { r: 99, g: 102, b: 241 }, // Indigo / Deep Purple
  Electronic: { r: 6, g: 182, b: 212 }, // Cyan / Teal
  Acoustic: { r: 16, g: 185, b: 129 }, // Emerald
  Pop: { r: 59, g: 130, b: 246 }, // Vibrant Royal Blue (No pink)
  Blues: { r: 37, g: 99, b: 235 }, // Blue
  Chill: { r: 20, g: 184, b: 166 }, // Teal
  Cinematic: { r: 124, g: 58, b: 237 }, // Violet / Purple
  Mizrahi: { r: 245, g: 158, b: 11 }, // Golden Amber
  Rap: { r: 168, g: 85, b: 247 }, // Purple
};

export function stringToVibrantRGB(str: string): { r: number; g: number; b: number } {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  const s = 0.75;
  const l = 0.48;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (0 <= h && h < 60) { r1 = c; g1 = x; b1 = 0; }
  else if (60 <= h && h < 120) { r1 = x; g1 = c; b1 = 0; }
  else if (120 <= h && h < 180) { r1 = 0; g1 = c; b1 = x; }
  else if (180 <= h && h < 240) { r1 = 0; g1 = x; b1 = c; }
  else if (240 <= h && h < 300) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }

  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/**
 * Returns the exact RGB color matching the track.
 * If authentic cover image color was previously extracted, returns it instantly.
 * Otherwise returns a deterministic vibrant RGB matching the track artwork/title.
 */
export function getTrackInstantColor(track: Partial<JamendoTrack>): { r: number; g: number; b: number } {
  if (track.id && globalTrackColorCache.has(track.id)) {
    return globalTrackColorCache.get(track.id)!;
  }
  if (track.coverUrl && globalTrackColorCache.has(track.coverUrl)) {
    return globalTrackColorCache.get(track.coverUrl)!;
  }
  if (track.artistAvatarUrl && globalTrackColorCache.has(track.artistAvatarUrl)) {
    return globalTrackColorCache.get(track.artistAvatarUrl)!;
  }

  const genre = track.genre;
  if (genre) {
    for (const [g, rgb] of Object.entries(GENRE_RGB_MAP)) {
      if (genre.toLowerCase().includes(g.toLowerCase())) {
        return rgb;
      }
    }
  }

  const seed = track.coverUrl || track.name || track.id || track.artistName || 'music_track';
  return stringToVibrantRGB(seed);
}

/**
 * Dynamically samples an image URL via HTML Canvas to extract its dominant vibrant color.
 */
export function getFormattedPlayCount(track?: Partial<JamendoTrack> | null): string {
  if (!track) return '1.2K';
  if (track.playsCount && track.playsCount > 0) {
    if (track.playsCount >= 1000000) return `${(track.playsCount / 1000000).toFixed(1)}M`;
    if (track.playsCount >= 1000) return `${(track.playsCount / 1000).toFixed(1)}K`;
    return track.playsCount.toLocaleString();
  }
  let hash = 0;
  const str = track.id || track.name || 'track';
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const num = (Math.abs(hash) % 38000) + 1200;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Loads an HTMLImageElement cleanly with CORS support, falling back through /api/proxy-image if tainted/blocked.
 */
function loadImageForColorSampling(url: string): Promise<HTMLImageElement | null> {
  const tryLoad = (src: string, useCrossOrigin: boolean): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
      const img = new Image();
      if (useCrossOrigin) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  return (async () => {
    const direct = await tryLoad(url, true);
    if (direct) {
      // Quick probe whether canvas pixel read is allowed (CORS non-tainted)
      try {
        const probeCanvas = document.createElement('canvas');
        probeCanvas.width = 4;
        probeCanvas.height = 4;
        const probeCtx = probeCanvas.getContext('2d');
        if (probeCtx) {
          probeCtx.drawImage(direct, 0, 0, 4, 4);
          probeCtx.getImageData(0, 0, 1, 1);
          return direct;
        }
      } catch {
        // Canvas tainted — fall back to server CORS image proxy
      }
    }

    if (
      (url.startsWith('https://') || url.startsWith('http://')) &&
      !url.includes('/api/proxy-image')
    ) {
      const proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
      const proxied = await tryLoad(proxiedUrl, true);
      if (proxied) return proxied;
    }

    return null;
  })();
}

/**
 * Dynamically samples an image URL via HTML Canvas using quantized dominant-color clustering.
 */
const inFlightColorExtractions = new Map<string, Promise<{ r: number; g: number; b: number }>>();

export function parseRgbFromBgColor(bgColor?: string): { r: number; g: number; b: number } | null {
  if (!bgColor || typeof bgColor !== 'string') return null;
  const match = bgColor.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

export function extractImageColor(imageUrl?: string): Promise<{ r: number; g: number; b: number }> {
  if (!imageUrl || !imageUrl.trim()) {
    return Promise.resolve({ r: 59, g: 130, b: 246 });
  }
  const key = getStreamingMediaUrl(imageUrl).trim();
  if (globalTrackColorCache.has(key)) {
    return Promise.resolve(globalTrackColorCache.get(key)!);
  }
  if (inFlightColorExtractions.has(key)) {
    return inFlightColorExtractions.get(key)!;
  }

  const fallbackColor = stringToVibrantRGB(key);

  const pending = loadImageForColorSampling(key)
    .then((img) => {
      if (!img) {
        return fallbackColor;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        if (!ctx) return fallbackColor;

        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;

        const buckets = new Map<string, { rSum: number; gSum: number; bSum: number; count: number; satSum: number }>();
        let totalR = 0, totalG = 0, totalB = 0, totalCount = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 180) continue;

          const sum = r + g + b;
          if (sum <= 45 || sum >= 725) continue;

          totalR += r;
          totalG += g;
          totalB += b;
          totalCount++;

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;

          const qr = Math.floor(r / 24);
          const qg = Math.floor(g / 24);
          const qb = Math.floor(b / 24);
          const bKey = `${qr}_${qg}_${qb}`;
          const existing = buckets.get(bKey) || { rSum: 0, gSum: 0, bSum: 0, count: 0, satSum: 0 };
          existing.rSum += r;
          existing.gSum += g;
          existing.bSum += b;
          existing.count += 1;
          existing.satSum += sat;
          buckets.set(bKey, existing);
        }

        if (totalCount === 0) {
          let allR = 0, allG = 0, allB = 0, allCount = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] >= 180) {
              allR += data[i];
              allG += data[i + 1];
              allB += data[i + 2];
              allCount++;
            }
          }
          const neutral = allCount > 0
            ? {
                r: Math.max(35, Math.min(210, Math.round(allR / allCount))),
                g: Math.max(35, Math.min(210, Math.round(allG / allCount))),
                b: Math.max(40, Math.min(220, Math.round(allB / allCount))),
              }
            : fallbackColor;
          globalTrackColorCache.set(key, neutral);
          return neutral;
        }

        let bestBucket: { rSum: number; gSum: number; bSum: number; count: number; satSum: number } | null = null;
        let bestScore = -1;

        for (const bucket of buckets.values()) {
          const avgSat = bucket.satSum / bucket.count;
          const score = bucket.count * (0.4 + avgSat * 2.2);
          if (score > bestScore) {
            bestScore = score;
            bestBucket = bucket;
          }
        }

        const finalColor = bestBucket && bestBucket.count >= 2
          ? {
              r: Math.round(bestBucket.rSum / bestBucket.count),
              g: Math.round(bestBucket.gSum / bestBucket.count),
              b: Math.round(bestBucket.bSum / bestBucket.count),
            }
          : {
              r: Math.round(totalR / totalCount),
              g: Math.round(totalG / totalCount),
              b: Math.round(totalB / totalCount),
            };

        globalTrackColorCache.set(key, finalColor);
        return finalColor;
      } catch {
        return fallbackColor;
      }
    })
    .finally(() => {
      inFlightColorExtractions.delete(key);
    });

  inFlightColorExtractions.set(key, pending);
  return pending;
}

/**
 * React Hook that dynamically calculates the matching vibrant color from an image without initial color snaps.
 */
export function useExtractedColor(imageUrl?: string, fallbackGenre: string = 'Acoustic', bgColorHint?: string) {
  const normalizedKey = imageUrl ? getStreamingMediaUrl(imageUrl).trim() : '';
  const hintedRgb = parseRgbFromBgColor(bgColorHint);
  if (normalizedKey && hintedRgb && !globalTrackColorCache.has(normalizedKey)) {
    globalTrackColorCache.set(normalizedKey, hintedRgb);
  }

  const [color, setColor] = useState<{ r: number; g: number; b: number }>(() => {
    if (normalizedKey && globalTrackColorCache.has(normalizedKey)) {
      return globalTrackColorCache.get(normalizedKey)!;
    }
    if (hintedRgb) {
      return hintedRgb;
    }
    if (normalizedKey) {
      return stringToVibrantRGB(normalizedKey);
    }
    return GENRE_RGB_MAP[fallbackGenre] || stringToVibrantRGB(fallbackGenre);
  });

  useEffect(() => {
    let cancelled = false;
    if (!normalizedKey) {
      setColor(hintedRgb || GENRE_RGB_MAP[fallbackGenre] || stringToVibrantRGB(fallbackGenre));
      return;
    }

    if (globalTrackColorCache.has(normalizedKey)) {
      setColor(globalTrackColorCache.get(normalizedKey)!);
      return;
    }

    extractImageColor(normalizedKey).then((extracted) => {
      if (!cancelled && extracted) {
        setColor(extracted);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [normalizedKey, fallbackGenre]);

  return color;
}

export function prewarmTrackColor(track: JamendoTrack) {
  if (track.coverUrl) {
    const hinted = parseRgbFromBgColor(track.bgColor);
    const key = getStreamingMediaUrl(track.coverUrl).trim();
    if (hinted && key && !globalTrackColorCache.has(key)) {
      globalTrackColorCache.set(key, hinted);
    } else {
      extractImageColor(track.coverUrl);
    }
  }
  if (track.artistAvatarUrl) {
    extractImageColor(track.artistAvatarUrl);
  }
}

/**
 * Curated rich, harmonious theme colors for artists
 */
export const ARTIST_CURATED_PALETTES: { r: number; g: number; b: number }[] = [
  { r: 20, g: 184, b: 166 }, // Emerald Teal
  { r: 99, g: 102, b: 241 }, // Indigo
  { r: 245, g: 158, b: 11 }, // Warm Amber
  { r: 168, g: 85, b: 247 }, // Royal Purple
  { r: 59, g: 130, b: 246 }, // Deep Ocean Blue
  { r: 16, g: 185, b: 129 }, // Vibrant Mint
  { r: 239, g: 68, b: 68 },  // Ruby Red
  { r: 14, g: 165, b: 233 }, // Sky Cyan
  { r: 217, g: 70, b: 239 }, // Electric Fuchsia
  { r: 249, g: 115, b: 22 }, // Sunset Coral
  { r: 132, g: 204, b: 22 }, // Lime Accent
];

/**
 * Returns a deterministic/cached color palette for an artist matching avatar image.
 */
export function getArtistStableTheme(artistName?: string, avatarUrl?: string): { r: number; g: number; b: number } {
  const normalized = avatarUrl ? getStreamingMediaUrl(avatarUrl).trim() : '';
  if (normalized && globalTrackColorCache.has(normalized)) {
    return globalTrackColorCache.get(normalized)!;
  }
  if (normalized) {
    return stringToVibrantRGB(normalized);
  }

  const cleanName = (artistName || '').trim().toLowerCase();
  if (!cleanName) {
    return { r: 16, g: 185, b: 129 };
  }

  return stringToVibrantRGB(cleanName);
}
