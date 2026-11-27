/**
 * Shared Google Analytics 4 Data API v1beta helper (Node.js & Cloudflare Workers compatible).
 * Uses Web Crypto RS256 Service Account JWT signing with zero external dependencies.
 * Solves GA4 per-report row caps and API quotas by:
 *   1. Using a single standard dimension (`pagePathPlusQueryString`) instead of custom dimensions (no 50-dim cap).
 *   2. Paginating with `limit: 100000` and `offset` loop across all rows (unlimited songs).
 *   3. Consolidating all results into a single cached snapshot shared across all visitors.
 */

export interface Ga4CredentialsConfig {
  configured: boolean;
  propertyId: string;
  clientEmail: string;
  privateKeyPem: string;
}

export interface Ga4AnalyticsSnapshot {
  configured: boolean;
  propertyId?: string;
  viewsByTrackId: Record<string, number>;
  gaTotalUsers: number;
  gaActiveUsers: number;
  gaNewUsers: number;
  gaTotalPageViews: number;
  gaRealtimeActiveUsers: number;
  totalRowsScanned: number;
  updatedAt: number;
  error?: string;
}

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeStr(str: string): string {
  return base64UrlEncodeBytes(new TextEncoder().encode(str));
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function resolveGa4Credentials(envObj: Record<string, any>): Ga4CredentialsConfig {
  const rawProp = String(
    envObj?.GA_PROPERTY_ID || envObj?.GA4_PROPERTY_ID || envObj?.GOOGLE_ANALYTICS_PROPERTY_ID || ''
  )
    .trim()
    .replace(/^properties\//i, '')
    .replace(/[^0-9]/g, '');

  let clientEmail = String(envObj?.GA_CLIENT_EMAIL || envObj?.GOOGLE_CLIENT_EMAIL || '').trim();
  let privateKeyPem = String(envObj?.GA_PRIVATE_KEY || envObj?.GOOGLE_PRIVATE_KEY || '').trim();

  const rawJson = String(envObj?.GA_SERVICE_ACCOUNT_JSON || envObj?.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (parsed && typeof parsed === 'object') {
        if (!clientEmail && typeof parsed.client_email === 'string') {
          clientEmail = parsed.client_email.trim();
        }
        if (!privateKeyPem && typeof parsed.private_key === 'string') {
          privateKeyPem = parsed.private_key.trim();
        }
      }
    } catch {
      // Ignore malformed JSON here; handled by configured check below
    }
  }

  if (privateKeyPem) {
    privateKeyPem = privateKeyPem.replace(/\\n/g, '\n').replace(/^["']|["']$/g, '').trim();
  }
  clientEmail = clientEmail.replace(/^["']|["']$/g, '').trim();

  const configured = Boolean(rawProp && clientEmail && privateKeyPem.includes('BEGIN PRIVATE KEY'));
  return {
    configured,
    propertyId: rawProp,
    clientEmail,
    privateKeyPem,
  };
}

async function getGoogleAnalyticsAccessToken(cfg: Ga4CredentialsConfig): Promise<string> {
  const cacheKey = `${cfg.clientEmail}:${cfg.propertyId}`;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - now > 120_000) {
    return cached.accessToken;
  }

  const header = base64UrlEncodeStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const claims = base64UrlEncodeStr(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp,
    })
  );

  const signingInput = `${header}.${claims}`;
  const keyBuffer = pemToArrayBuffer(cfg.privateKeyPem);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto subtle API unavailable');
  }

  const cryptoKey = await subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBuffer = await subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(sigBuffer))}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });

  const tokenData: any = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData?.access_token) {
    const errDetail = tokenData?.error_description || tokenData?.error || `HTTP ${tokenRes.status}`;
    throw new Error(`GA4 OAuth token exchange failed: ${errDetail}`);
  }

  const expiresInMs = Math.max(300, Number(tokenData.expires_in) || 3600) * 1000;
  tokenCache.set(cacheKey, {
    accessToken: String(tokenData.access_token),
    expiresAt: now + expiresInMs,
  });
  return String(tokenData.access_token);
}

export function extractTrackIdFromGaPagePath(pagePath: string): string | null {
  if (!pagePath) return null;
  const match = pagePath.match(/[?&]song=([^&#]+)/i);
  if (!match) return null;
  try {
    const decoded = decodeURIComponent(match[1]).replace(/[^a-zA-Z0-9_-]/g, '');
    return decoded || null;
  } catch {
    const clean = match[1].replace(/[^a-zA-Z0-9_-]/g, '');
    return clean || null;
  }
}

export async function fetchFullGa4AnalyticsSnapshot(
  envObj: Record<string, any>
): Promise<Ga4AnalyticsSnapshot> {
  const cfg = resolveGa4Credentials(envObj);
  if (!cfg.configured) {
    return {
      configured: false,
      viewsByTrackId: {},
      gaTotalUsers: 0,
      gaActiveUsers: 0,
      gaNewUsers: 0,
      gaTotalPageViews: 0,
      gaRealtimeActiveUsers: 0,
      totalRowsScanned: 0,
      updatedAt: Date.now(),
    };
  }

  try {
    const accessToken = await getGoogleAnalyticsAccessToken(cfg);
    const reportUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runReport`;
    const realtimeUrl = `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.propertyId}:runRealtimeReport`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    const viewsByTrackId: Record<string, number> = {};
    let totalRowsScanned = 0;

    // 1. Paginated query across ALL ?song= paths (100,000 rows per page, unlimited pages)
    let offset = 0;
    const pageSize = 100000;
    let totalRowCount = 1;

    while (offset < totalRowCount) {
      const songRes = await fetch(reportUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          dateRanges: [{ startDate: '2020-01-01', endDate: 'today' }],
          dimensions: [{ name: 'pagePathPlusQueryString' }],
          metrics: [{ name: 'screenPageViews' }],
          dimensionFilter: {
            filter: {
              fieldName: 'pagePathPlusQueryString',
              stringFilter: {
                matchType: 'CONTAINS',
                value: 'song=',
              },
            },
          },
          limit: pageSize,
          offset,
        }),
      });

      const songData: any = await songRes.json().catch(() => null);
      if (!songRes.ok) {
        const msg = songData?.error?.message || `GA4 runReport HTTP ${songRes.status}`;
        throw new Error(msg);
      }

      totalRowCount = Number(songData?.rowCount) || 0;
      const rows = Array.isArray(songData?.rows) ? songData.rows : [];
      if (rows.length === 0) break;

      for (const row of rows) {
        const rawPath = String(row?.dimensionValues?.[0]?.value || '');
        const trackId = extractTrackIdFromGaPagePath(rawPath);
        if (!trackId) continue;
        const count = Number(row?.metricValues?.[0]?.value) || 0;
        if (count > 0) {
          viewsByTrackId[trackId] = (viewsByTrackId[trackId] || 0) + count;
        }
      }

      totalRowsScanned += rows.length;
      offset += rows.length;
      if (rows.length < pageSize) break;
    }

    // 2. Sitewide Totals (Total Users, Active Users, New Users, Total Page Views)
    const [summaryRes, realtimeRes] = await Promise.all([
      fetch(reportUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          dateRanges: [{ startDate: '2020-01-01', endDate: 'today' }],
          metrics: [
            { name: 'totalUsers' },
            { name: 'activeUsers' },
            { name: 'newUsers' },
            { name: 'screenPageViews' },
          ],
        }),
      }),
      fetch(realtimeUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          metrics: [{ name: 'activeUsers' }],
        }),
      }).catch(() => null),
    ]);

    const summaryData: any = await summaryRes.json().catch(() => null);
    const summaryVals = summaryData?.rows?.[0]?.metricValues || [];
    const gaTotalUsers = Number(summaryVals[0]?.value) || 0;
    const gaActiveUsers = Number(summaryVals[1]?.value) || 0;
    const gaNewUsers = Number(summaryVals[2]?.value) || 0;
    const gaTotalPageViews = Number(summaryVals[3]?.value) || 0;

    let gaRealtimeActiveUsers = 0;
    if (realtimeRes && realtimeRes.ok) {
      const rtData: any = await realtimeRes.json().catch(() => null);
      gaRealtimeActiveUsers = Number(rtData?.rows?.[0]?.metricValues?.[0]?.value) || 0;
    }

    return {
      configured: true,
      propertyId: cfg.propertyId,
      viewsByTrackId,
      gaTotalUsers,
      gaActiveUsers,
      gaNewUsers,
      gaTotalPageViews,
      gaRealtimeActiveUsers,
      totalRowsScanned,
      updatedAt: Date.now(),
    };
  } catch (err: any) {
    return {
      configured: true,
      propertyId: cfg.propertyId,
      viewsByTrackId: {},
      gaTotalUsers: 0,
      gaActiveUsers: 0,
      gaNewUsers: 0,
      gaTotalPageViews: 0,
      gaRealtimeActiveUsers: 0,
      totalRowsScanned: 0,
      updatedAt: Date.now(),
      error: err?.message || 'Failed to query Google Analytics Data API',
    };
  }
}

export interface AdminSongWindowRecord {
  id: string;
  title: string;
  mode: 'song' | 'artist' | 'genre' | 'all';
  targetValue: string;
  createdAt: string;
}

export function sanitizeAdminWindows(input: unknown): AdminSongWindowRecord[] {
  if (!Array.isArray(input)) return [];
  const out: AdminSongWindowRecord[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, any>;
    const id = String(item.id || '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64);
    const title = String(item.title || '').trim().slice(0, 120);
    const mode =
      item.mode === 'song' || item.mode === 'artist' || item.mode === 'genre' || item.mode === 'all'
        ? item.mode
        : 'song';
    const targetValue = String(item.targetValue || '').trim().slice(0, 160);
    const createdAt = String(item.createdAt || new Date().toISOString()).slice(0, 40);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, mode, targetValue, createdAt });
  }
  return out;
}

export function buildAdminAnalyticsPayload(params: {
  tracks: any[];
  profiles: any[];
  accountsSeen: any[];
  gaSnapshot: Ga4AnalyticsSnapshot;
  windows: AdminSongWindowRecord[];
}) {
  const { tracks, profiles, accountsSeen, gaSnapshot, windows } = params;
  const viewsMap = gaSnapshot.viewsByTrackId || {};

  const tracksByUid = new Map<string, any[]>();
  const ownerlessTracksByName = new Map<string, any[]>();

  const songsList = (Array.isArray(tracks) ? tracks : [])
    .filter((t) => t?.id && t?.name)
    .map((t) => {
      const id = String(t.id);
      const tUid = String(t.uploadedByUid || '')
        .replace(/^artist_/, '')
        .toLowerCase()
        .trim();
      const tName = String(t.artistName || '')
        .toLowerCase()
        .trim();
      if (tUid) {
        const arr = tracksByUid.get(tUid);
        if (arr) arr.push(t);
        else tracksByUid.set(tUid, [t]);
      } else if (tName) {
        const arr = ownerlessTracksByName.get(tName);
        if (arr) arr.push(t);
        else ownerlessTracksByName.set(tName, [t]);
      }
      return {
        id,
        name: String(t.name),
        artistName: String(t.artistName || ''),
        genre: String(t.genre || ''),
        coverUrl: t.coverUrl ? String(t.coverUrl) : undefined,
        uploadedByUid: tUid || undefined,
        playsCount: Number(t.playsCount) || 0,
        gaViews: gaSnapshot.configured && !gaSnapshot.error ? (viewsMap[id] ?? 0) : null,
      };
    });

  const profileUidSet = new Set<string>();
  const profilesList = (Array.isArray(profiles) ? profiles : [])
    .map((p) => {
      const uid = String(p?.googleUid || p?.id || '')
        .replace(/^artist_/, '')
        .trim();
      const lowerUid = uid.toLowerCase();
      if (!uid) return null;
      profileUidSet.add(lowerUid);
      const name = String(p?.name || '').trim() || 'אמן';
      const normName = name.toLowerCase();
      const matchedTracks =
        tracksByUid.get(lowerUid) || (!lowerUid && normName ? ownerlessTracksByName.get(normName) : undefined) || [];
      const tracksCount = matchedTracks.length;
      const totalGaViews =
        gaSnapshot.configured && !gaSnapshot.error
          ? matchedTracks.reduce((sum, tr) => sum + (viewsMap[String(tr.id)] || 0), 0)
          : null;
      const isActive = tracksCount >= 1;
      const isMultiTrack = tracksCount > 1;
      const isHidden = tracksCount === 0;
      return {
        uid,
        name,
        avatarUrl: p?.avatarUrl ? String(p.avatarUrl) : undefined,
        tracksCount,
        totalGaViews,
        isActive,
        isMultiTrack,
        isHidden,
        joinedDate: p?.joinedDate ? String(p.joinedDate) : undefined,
        updatedAt: p?.updatedAt ? String(p.updatedAt) : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => b.tracksCount - a.tracksCount || (b.totalGaViews ?? 0) - (a.totalGaViews ?? 0));

  const totalProfiles = profilesList.length;
  const activeProfiles = profilesList.filter((p) => p.isActive).length;
  const multiTrackProfiles = profilesList.filter((p) => p.isMultiTrack).length;
  const hiddenProfiles = profilesList.filter((p) => p.isHidden).length;

  const signedInWithoutProfileList = (Array.isArray(accountsSeen) ? accountsSeen : [])
    .map((acc) => {
      const uid = String(acc?.uid || '')
        .replace(/^artist_/, '')
        .trim();
      if (!uid || profileUidSet.has(uid.toLowerCase())) return null;
      return {
        uid,
        displayName: String(acc?.displayName || 'משתמש Google'),
        avatarUrl: acc?.avatarUrl ? String(acc.avatarUrl) : undefined,
        lastSeenAt: acc?.lastSeenAt ? String(acc.lastSeenAt) : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const signedInWithoutProfile = signedInWithoutProfileList.length;
  const gaVisitorsWithoutProfile =
    gaSnapshot.configured && !gaSnapshot.error ? Math.max(0, gaSnapshot.gaTotalUsers - totalProfiles) : null;

  return {
    success: true,
    ga: {
      configured: gaSnapshot.configured,
      propertyId: gaSnapshot.propertyId || undefined,
      gaTotalUsers: gaSnapshot.gaTotalUsers,
      gaActiveUsers: gaSnapshot.gaActiveUsers,
      gaNewUsers: gaSnapshot.gaNewUsers,
      gaTotalPageViews: gaSnapshot.gaTotalPageViews,
      gaRealtimeActiveUsers: gaSnapshot.gaRealtimeActiveUsers,
      totalRowsScanned: gaSnapshot.totalRowsScanned,
      updatedAt: gaSnapshot.updatedAt,
      error: gaSnapshot.error,
    },
    usersSummary: {
      totalProfiles,
      activeProfiles,
      multiTrackProfiles,
      hiddenProfiles,
      signedInWithoutProfile,
      gaVisitorsWithoutProfile,
    },
    profilesList,
    signedInWithoutProfileList,
    songsList,
    windows,
  };
}

