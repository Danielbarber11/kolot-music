// Cloudflare Worker Full-Stack Adapter for Kolot R2 Music
// Handles /api/storage/*, /api/proxy-image, /api/ai/transcribe, and SPA static assets

export interface WorkerR2Object {
  key: string;
  size: number;
  httpEtag?: string;
  uploaded?: Date;
  httpMetadata?: { contentType?: string };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  body: ReadableStream | null;
}

export interface WorkerR2Bucket {
  put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream, options?: any): Promise<any>;
  get(key: string, options?: any): Promise<WorkerR2Object | null>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; cursor?: string }): Promise<{
    objects: Array<{ key: string; size: number; uploaded?: Date }>;
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  R2_BUCKET?: WorkerR2Bucket;
  R2_ENDPOINT?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_URL?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  Client_ID?: string;
  CLIENT_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  Client_secret?: string;
  CLIENT_SECRET?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_URL?: string;
}

const workerPendingViewDeltas = new Map<string, number>();
const workerInFlightViewFlushes = new Set<string>();
const workerOptimisticViewCounts = new Map<string, number>();

function sanitizeEndpoint(raw?: string): string {
  if (!raw) return '';
  let cleaned = raw.trim().replace(/^["']|["']$/g, '');
  if (!cleaned || cleaned.startsWith('cfat_') || !cleaned.includes('.r2.cloudflarestorage.com')) {
    return '';
  }
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned;
  }
  return cleaned.replace(/\/+$/, '');
}

function getR2Creds(env: Env) {
  return {
    endpoint: sanitizeEndpoint(env.R2_ENDPOINT),
    accessKeyId: (env.R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (env.R2_SECRET_ACCESS_KEY || '').trim(),
    bucket: (env.R2_BUCKET_NAME || 'kolot-music').trim(),
    publicUrl: (env.R2_PUBLIC_URL || '').trim().replace(/\/+$/, ''),
  };
}

function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

// --- Web Crypto AWS Signature V4 Helper for S3-Compatible R2 HTTP API ---
const encoder = new TextEncoder();

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hashBuffer = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const keyBytes = typeof key === 'string' ? encoder.encode(key) : key;
  const keyCopy = new Uint8Array(keyBytes.byteLength);
  keyCopy.set(keyBytes);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyCopy.buffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return new Uint8Array(sig);
}

async function hmacSha256Hex(key: Uint8Array, data: string): Promise<string> {
  const bytes = await hmacSha256(key, data);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function encodeS3Path(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

async function signedR2Fetch(
  creds: ReturnType<typeof getR2Creds>,
  method: string,
  pathWithLeadingSlash: string,
  queryParams: Record<string, string> = {},
  body?: Uint8Array | null,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  if (!creds.endpoint || !creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error('R2 S3 credentials are not configured in Worker secrets.');
  }
  const endpointUrl = new URL(creds.endpoint);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';

  const payloadHash = await sha256Hex(body || new Uint8Array(0));

  const sortedQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const host = endpointUrl.host;
  const headersToSign: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  for (const [k, v] of Object.entries(extraHeaders)) {
    const lk = k.toLowerCase();
    if (lk === 'content-type' || lk === 'range') {
      headersToSign[lk] = v;
    }
  }

  const sortedHeaderKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${headersToSign[k]}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    pathWithLeadingSlash,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmacSha256('AWS4' + creds.secretAccessKey, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  const authHeader = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const targetUrl = `${creds.endpoint}${pathWithLeadingSlash}${sortedQuery ? '?' + sortedQuery : ''}`;

  const fetchHeaders: Record<string, string> = {
    ...extraHeaders,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authHeader,
  };

  let requestBody: BodyInit | undefined;
  if (body && method !== 'GET' && method !== 'HEAD') {
    const bodyCopy = new Uint8Array(body.byteLength);
    bodyCopy.set(body);
    requestBody = bodyCopy;
  }

  return fetch(targetUrl, {
    method,
    headers: fetchHeaders,
    body: requestBody,
  });
}

function parseXmlTagValues(xml: string, blockTag: string, fields: string[]): Record<string, string>[] {
  const results: Record<string, string>[] = [];
  const blockRegex = new RegExp(`<${blockTag}>([\\s\\S]*?)<\\/${blockTag}>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(xml)) !== null) {
    const block = match[1];
    const obj: Record<string, string> = {};
    for (const f of fields) {
      const m = block.match(new RegExp(`<${f}>([\\s\\S]*?)<\\/${f}>`));
      if (m) obj[f] = m[1];
    }
    results.push(obj);
  }
  return results;
}

function isSafeExternalHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function parseTimestamp(ts: string): number {
  const parts = ts.trim().split(':').map((p) => parseFloat(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function buildSegmentsFromText(rawText: string, trackDuration: number) {
  const cleaned = rawText.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();
  if (!cleaned) return [];
  const rawLines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
  const timed: { startTime: number; endTime?: number; text: string }[] = [];
  const untimed: string[] = [];

  for (const line of rawLines) {
    const rangeMatch = line.match(/^[\[(]?(\d{1,2}:\d{2}(?:\.\d{1,2})?)\s*[-–>to]+\s*(\d{1,2}:\d{2}(?:\.\d{1,2})?)[\])]?\s*(.+)$/);
    if (rangeMatch) {
      const startTime = parseTimestamp(rangeMatch[1]);
      const endTime = parseTimestamp(rangeMatch[2]);
      const text = rangeMatch[3].replace(/^[-:|•\s]+/, '').trim();
      if (text) timed.push({ startTime, endTime: endTime > startTime ? endTime : startTime + 4, text });
      continue;
    }
    const singleMatch = line.match(/^[\[(](\d{1,2}:\d{2}(?:\.\d{1,2})?)[\])]\s*(.+)$/);
    if (singleMatch) {
      const startTime = parseTimestamp(singleMatch[1]);
      const text = singleMatch[2].replace(/^[-:|•\s]+/, '').trim();
      if (text) timed.push({ startTime, text });
      continue;
    }
    untimed.push(line);
  }

  if (timed.length > 0) {
    return timed.map((seg, idx) => ({
      id: `whisper_seg_${idx}`,
      startTime: Number(seg.startTime.toFixed(2)),
      endTime: Number((seg.endTime ?? (timed[idx + 1]?.startTime || seg.startTime + 4.5)).toFixed(2)),
      text: seg.text,
    }));
  }

  const safeDuration = Math.max(20, trackDuration || 120);
  const introOffset = safeDuration > 25 ? 4 : 0;
  const activeSpan = Math.max(10, safeDuration - introOffset - 2);
  const step = activeSpan / Math.max(1, untimed.length);
  return untimed.map((text, idx) => ({
    id: `whisper_seg_${idx}`,
    startTime: Number((introOffset + idx * step).toFixed(2)),
    endTime: Number((introOffset + (idx + 1) * step).toFixed(2)),
    text,
  }));
}

export default {
  async fetch(request: Request, env: Env, ctx?: { waitUntil(promise: Promise<any>): void }): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    if (request.method === 'GET' && pathname.startsWith('/google') && pathname.endsWith('.html')) {
      const tokenMatch = pathname.match(/\/google([a-zA-Z0-9_-]+)\.html$/);
      const token = tokenMatch ? tokenMatch[1] : 'Eg8ZRcchUYZiQIJOucZKvDNi2GWoJnnhG9O5JoiGxFY';
      return new Response(`google-site-verification: ${token}`, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      });
    }
    if (request.method === 'GET' && pathname === '/manifest.json') {
      const origin = url.origin;
      const relatedApps = [{ platform: 'webapp', url: `${origin}/manifest.json` }];
      if (origin !== 'https://kolot-music.kolot-music.workers.dev') {
        relatedApps.push({ platform: 'webapp', url: 'https://kolot-music.kolot-music.workers.dev/manifest.json' });
      }
      return new Response(
        JSON.stringify({
          id: '/',
          name: 'Kolot Music',
          short_name: 'Kolot Music',
          description: 'Kolot Music - פלטפורמת מוזיקה להאזנה, יצירה והפצת שירים ואלבומים',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          theme_color: '#000000',
          background_color: '#000000',
          lang: 'he',
          dir: 'rtl',
          prefer_related_applications: false,
          related_applications: relatedApps,
          icons: [
            { src: '/pwa-192x192.png?v=5', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/pwa-512x512.png?v=5', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/pwa-maskable-512x512.png?v=5', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: '/favicon.svg?v=5', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          ],
          categories: ['music', 'entertainment', 'audio'],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/manifest+json; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const creds = getR2Creds(env);

    const resolveGoogleCredsTop = () => {
      const envObj = (env as Record<string, any>) || {};
      const cleanVal = (raw: string) => raw.trim().replace(/^["']|["']$/g, '');
      const readEnvVar = (...names: string[]): string => {
        for (const name of names) {
          const direct = envObj[name];
          if (typeof direct === 'string' && direct.trim()) {
            return cleanVal(direct);
          }
        }
        const wanted = new Set(names.map((n) => n.toLowerCase()));
        for (const [k, v] of Object.entries(envObj)) {
          if (typeof v === 'string' && v.trim() && wanted.has(k.trim().toLowerCase())) {
            return cleanVal(v);
          }
        }
        return '';
      };

      let clientId = readEnvVar('Client_ID', 'CLIENT_ID', 'GOOGLE_CLIENT_ID', 'VITE_GOOGLE_CLIENT_ID');
      let clientSecret = readEnvVar('Client_secret', 'CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET');

      if (clientId) {
        const idMatch = clientId.match(/(\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com)/);
        if (idMatch) clientId = idMatch[1];
      }
      if (clientSecret) {
        const secMatch = clientSecret.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
        if (secMatch) clientSecret = secMatch[1];
      }

      if (!clientId || !clientSecret) {
        for (const [k, v] of Object.entries(envObj)) {
          if (!clientId) {
            const keyIdMatch = k.match(/(\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com)/);
            if (keyIdMatch) clientId = keyIdMatch[1];
          }
          if (typeof v === 'string' && v.trim()) {
            if (!clientId) {
              const valIdMatch = v.match(/(\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com)/);
              if (valIdMatch) clientId = valIdMatch[1];
            }
            if (!clientSecret) {
              const valSecMatch = v.match(/(GOCSPX-[A-Za-z0-9_-]+)/);
              if (valSecMatch) clientSecret = valSecMatch[1];
            }
          }
        }
      }

      const sessionSecret = clientSecret || creds.secretAccessKey || 'kolot-music-session-hmac-key';
      return { clientId, clientSecret, sessionSecret };
    };

    const resolveSessionSecretTop = () => resolveGoogleCredsTop().sessionSecret;

    const readR2JsonTop = async (key: string) => {
      try {
        if (env.R2_BUCKET) {
          const obj = await env.R2_BUCKET.get(key);
          return obj ? JSON.parse(await obj.text()) : null;
        }
        const r = await signedR2Fetch(creds, 'GET', `/${creds.bucket}/${encodeS3Path(key)}`);
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    };

    const verifyRawSessionTokenTop = async (token: string, secret: string): Promise<{ uid: string; email?: string; isAdmin?: boolean } | null> => {
      try {
        if (!token) return null;
        const parts = token.split('.');
        if (parts.length !== 2) return null;
        const [encoded, sig] = parts;
        const b64Sig = uint8ToBase64(await hmacSha256(secret, encoded))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/g, '');
        if (sig !== b64Sig) return null;
        const b64Payload = encoded.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((encoded.length + 3) % 4);
        const bin = atob(b64Payload);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        if (parsed?.exp && Date.now() > Number(parsed.exp)) return null;
        return parsed?.uid ? parsed : null;
      } catch {
        return null;
      }
    };

    const extractSessionTop = async (): Promise<{ uid: string; email?: string; isAdmin?: boolean } | null> => {
      try {
        const secret = resolveSessionSecretTop();
        const authHdr = (request.headers.get('authorization') || '').trim();
        const bearerToken = authHdr.toLowerCase().startsWith('bearer ') ? authHdr.slice(7).trim() : '';
        if (bearerToken) {
          const bearerSession = await verifyRawSessionTokenTop(bearerToken, secret);
          if (bearerSession) return bearerSession;
        }
        const cookieHdr = request.headers.get('cookie') || '';
        for (const pair of cookieHdr.split(';')) {
          const idx = pair.indexOf('=');
          if (idx > 0 && pair.slice(0, idx).trim() === 'kolot_session') {
            let cookieToken = pair.slice(idx + 1).trim();
            try {
              cookieToken = decodeURIComponent(cookieToken);
            } catch {}
            const cookieSession = await verifyRawSessionTokenTop(cookieToken, secret);
            if (cookieSession) return cookieSession;
          }
        }
        return null;
      } catch {
        return null;
      }
    };

    // 1. Storage status
    if (pathname === '/api/storage/status' && request.method === 'GET') {
      const aiConfigured = Boolean((env.GEMINI_API_KEY || '').trim() || (env.OPENAI_API_KEY || '').trim());
      if (env.R2_BUCKET) {
        return jsonResponse({ success: true, configured: true, aiConfigured, bucket: creds.bucket, endpoint: 'configured' });
      }
      try {
        const res = await signedR2Fetch(creds, 'GET', `/${creds.bucket}`, { 'list-type': '2', 'max-keys': '1' });
        if (res.ok) {
          return jsonResponse({ success: true, configured: true, aiConfigured, bucket: creds.bucket, endpoint: 'configured' });
        }
        return jsonResponse({ success: false, configured: false, aiConfigured, error: `Storage HTTP ${res.status}` });
      } catch (err: any) {
        return jsonResponse({ success: false, configured: false, aiConfigured, error: err?.message || 'Storage connection failed' });
      }
    }

    // 1b. Presign / Direct streaming upload URL for fast browser uploads
    if (pathname === '/api/storage/presign' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const rawPath = String(body?.path || '').trim().replace(/^\/+/, '');
        if (!rawPath) return jsonResponse({ success: false, error: 'Missing path' }, 400);
        const fileUrl = creds.publicUrl ? `${creds.publicUrl}/${rawPath}` : `/api/storage/raw/${rawPath}`;
        return jsonResponse({
          success: true,
          uploadUrl: `/api/storage/stream-upload?path=${encodeURIComponent(rawPath)}`,
          method: 'PUT',
          url: fileUrl,
          path: rawPath,
          bucket: creds.bucket,
        });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Presign failed' }, 500);
      }
    }

    if (pathname === '/api/storage/stream-upload' && request.method === 'PUT') {
      try {
        const rawPath = (url.searchParams.get('path') || '').trim().replace(/^\/+/, '');
        if (!rawPath || !request.body) {
          return jsonResponse({ success: false, error: 'Missing path or stream body' }, 400);
        }
        const contentType = request.headers.get('content-type') || 'application/octet-stream';
        if (env.R2_BUCKET) {
          await env.R2_BUCKET.put(rawPath, request.body, { httpMetadata: { contentType } });
        } else {
          const bytes = new Uint8Array(await request.arrayBuffer());
          const s3Path = `/${creds.bucket}/${encodeS3Path(rawPath)}`;
          const putRes = await signedR2Fetch(creds, 'PUT', s3Path, {}, bytes, { 'Content-Type': contentType });
          if (!putRes.ok) {
            return jsonResponse({ success: false, error: `Storage HTTP ${putRes.status}` }, 500);
          }
        }
        const outUrl = creds.publicUrl ? `${creds.publicUrl}/${rawPath}` : `/api/storage/raw/${rawPath}`;
        return jsonResponse({ success: true, url: outUrl, path: rawPath, bucket: creds.bucket, mode: 'r2' });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Stream upload failed' }, 500);
      }
    }

    // 2. Upload file (multipart or JSON)
    if (pathname === '/api/storage/upload' && request.method === 'POST') {
      try {
        const cType = request.headers.get('content-type') || '';
        let rawPath = '';
        let bodyBytes: Uint8Array | null = null;
        let contentType = 'application/octet-stream';

        if (cType.includes('multipart/form-data')) {
          const form = await request.formData();
          rawPath = String(form.get('path') || '').trim().replace(/^\/+/, '');
          const file = form.get('file') as File | null;
          if (file) {
            bodyBytes = new Uint8Array(await file.arrayBuffer());
            contentType = file.type || 'application/octet-stream';
          }
        } else {
          const json: any = await request.json();
          rawPath = String(json.path || '').trim().replace(/^\/+/, '');
          if (typeof json.content === 'string') {
            bodyBytes = encoder.encode(json.content);
            contentType = json.contentType || 'application/json';
          }
        }

        if (!rawPath || !bodyBytes) {
          return jsonResponse({ success: false, error: 'Missing path or file content' }, 400);
        }

        // Strict Ownership Enforcement on Profile, Track, and Album writes
        if (rawPath.startsWith('profiles/') && rawPath.endsWith('.json')) {
          const sess = await extractSessionTop();
          const targetUid = rawPath.replace(/^profiles\/(?:artist_)?/, '').replace(/\.json$/, '').trim();
          const cleanSessUid = String(sess?.uid || '').replace(/^artist_/, '').trim();
          if (!sess || !cleanSessUid || cleanSessUid !== targetUid) {
            return jsonResponse({ success: false, error: 'רק בעל הפרופיל רשאי לערוך פרופיל זה.' }, 403);
          }
        } else if (rawPath.startsWith('tracks/') && rawPath.endsWith('.json')) {
          let incoming: any = null;
          try {
            incoming = JSON.parse(new TextDecoder().decode(bodyBytes));
          } catch {}
          const existing = await readR2JsonTop(rawPath);
          const sess = await extractSessionTop();
          const cleanSessUid = String(sess?.uid || '').replace(/^artist_/, '').trim();
          const incomingUid = String(incoming?.uploadedByUid || '').replace(/^artist_/, '').trim();
          if (!existing) {
            if (!sess || !cleanSessUid || (incomingUid && incomingUid !== cleanSessUid)) {
              return jsonResponse({ success: false, error: 'רק בעל הפרופיל המחובר יכול להוסיף שירים.' }, 403);
            }
          } else {
            const existingUid = String(existing.uploadedByUid || '').replace(/^artist_/, '').trim();
            const isCoreEdit =
              (incoming?.name !== undefined && incoming.name !== existing.name) ||
              (incoming?.artistName !== undefined && incoming.artistName !== existing.artistName) ||
              (incoming?.audioUrl !== undefined && incoming.audioUrl !== existing.audioUrl) ||
              (incomingUid && existingUid && incomingUid !== existingUid);
            if (isCoreEdit && (!sess || !cleanSessUid || (existingUid && cleanSessUid !== existingUid))) {
              return jsonResponse({ success: false, error: 'רק בעל השיר רשאי לערוך שיר זה.' }, 403);
            }
            if (incoming && typeof incoming === 'object') {
              const trackId = rawPath.replace(/^tracks\//, '').replace(/\.json$/, '');
              incoming.viewsCount = Math.max(
                Number(existing.viewsCount) || 0,
                Number(incoming.viewsCount) || 0,
                workerOptimisticViewCounts.get(trackId) || 0
              );
              const incomingHasSubs = Boolean(
                (Array.isArray(incoming.subtitleSegments) && incoming.subtitleSegments.length > 0) ||
                (Array.isArray(incoming.subtitleSegmentsHe) && incoming.subtitleSegmentsHe.length > 0) ||
                (Array.isArray(incoming.subtitleSegmentsEn) && incoming.subtitleSegmentsEn.length > 0) ||
                (Array.isArray(incoming.subtitleSegmentsOrig) && incoming.subtitleSegmentsOrig.length > 0)
              );
              if (!incomingHasSubs && incoming.subtitlesDisabled !== true) {
                if (Array.isArray(existing.subtitleSegments) && existing.subtitleSegments.length > 0) incoming.subtitleSegments = existing.subtitleSegments;
                if (Array.isArray(existing.subtitleSegmentsHe) && existing.subtitleSegmentsHe.length > 0) incoming.subtitleSegmentsHe = existing.subtitleSegmentsHe;
                if (Array.isArray(existing.subtitleSegmentsEn) && existing.subtitleSegmentsEn.length > 0) incoming.subtitleSegmentsEn = existing.subtitleSegmentsEn;
                if (Array.isArray(existing.subtitleSegmentsOrig) && existing.subtitleSegmentsOrig.length > 0) incoming.subtitleSegmentsOrig = existing.subtitleSegmentsOrig;
                if (!incoming.lyrics && existing.lyrics) incoming.lyrics = existing.lyrics;
                if (!incoming.lyricsHe && existing.lyricsHe) incoming.lyricsHe = existing.lyricsHe;
                if (!incoming.lyricsEn && existing.lyricsEn) incoming.lyricsEn = existing.lyricsEn;
                if (!incoming.lyricsOrig && existing.lyricsOrig) incoming.lyricsOrig = existing.lyricsOrig;
                if (!incoming.detectedLanguageCode && existing.detectedLanguageCode) incoming.detectedLanguageCode = existing.detectedLanguageCode;
                if (!incoming.detectedLanguageLabel && existing.detectedLanguageLabel) incoming.detectedLanguageLabel = existing.detectedLanguageLabel;
                if (existing.hasWhisperSubtitles) incoming.hasWhisperSubtitles = true;
                if (incoming.subtitlesIncomplete === undefined && existing.subtitlesIncomplete !== undefined) incoming.subtitlesIncomplete = existing.subtitlesIncomplete;
                if (incoming.subtitlesCompletedUpTo === undefined && existing.subtitlesCompletedUpTo !== undefined) incoming.subtitlesCompletedUpTo = existing.subtitlesCompletedUpTo;
              }
              bodyBytes = encoder.encode(JSON.stringify(incoming, null, 2));
            }
          }
        } else if (rawPath.startsWith('albums/') && rawPath.endsWith('.json')) {
          const existing = await readR2JsonTop(rawPath);
          const sess = await extractSessionTop();
          const cleanSessUid = String(sess?.uid || '').replace(/^artist_/, '').trim();
          const ownerUid = String(existing?.uploadedByUid || existing?.artistId || '').replace(/^artist_/, '').trim();
          if (!sess || !cleanSessUid || (existing && ownerUid && ownerUid !== cleanSessUid)) {
            return jsonResponse({ success: false, error: 'רק בעל הפרופיל רשאי ליצור או לערוך אלבום זה.' }, 403);
          }
        }

        if (env.R2_BUCKET) {
          await env.R2_BUCKET.put(rawPath, bodyBytes, { httpMetadata: { contentType } });
        } else {
          const s3Path = `/${creds.bucket}/${encodeS3Path(rawPath)}`;
          const putRes = await signedR2Fetch(creds, 'PUT', s3Path, {}, bodyBytes, { 'Content-Type': contentType });
          if (!putRes.ok) {
            const errTxt = await putRes.text();
            return jsonResponse({ success: false, error: `שגיאת אחסון (${putRes.status}): ${errTxt}` }, 500);
          }
        }

        const outUrl = creds.publicUrl ? `${creds.publicUrl}/${rawPath}` : `/api/storage/raw/${rawPath}`;
        return jsonResponse({ success: true, url: outUrl, path: rawPath });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Upload failed' }, 500);
      }
    }

    // 3. List files
    if (pathname === '/api/storage/list' && request.method === 'GET') {
      try {
        const prefix = (url.searchParams.get('prefix') || '').replace(/^\/+/, '');
        const filesList: { key: string; size: number; url: string }[] = [];

        if (env.R2_BUCKET) {
          let cursor: string | undefined;
          do {
            const listed = await env.R2_BUCKET.list({ prefix, cursor });
            for (const obj of listed.objects) {
              filesList.push({
                key: obj.key,
                size: obj.size,
                url: creds.publicUrl ? `${creds.publicUrl}/${obj.key}` : `/api/storage/raw/${obj.key}`,
              });
            }
            cursor = listed.truncated ? listed.cursor : undefined;
          } while (cursor);
        } else {
          let token = '';
          do {
            const q: Record<string, string> = { 'list-type': '2', prefix };
            if (token) q['continuation-token'] = token;
            const listRes = await signedR2Fetch(creds, 'GET', `/${creds.bucket}`, q);
            if (!listRes.ok) {
              return jsonResponse({ success: false, error: `Storage list error ${listRes.status}` }, 500);
            }
            const xml = await listRes.text();
            const items = parseXmlTagValues(xml, 'Contents', ['Key', 'Size']);
            for (const it of items) {
              if (it.Key) {
                filesList.push({
                  key: it.Key,
                  size: Number(it.Size || 0),
                  url: creds.publicUrl ? `${creds.publicUrl}/${it.Key}` : `/api/storage/raw/${it.Key}`,
                });
              }
            }
            const truncMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/);
            const nextMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
            token = truncMatch?.[1] === 'true' && nextMatch?.[1] ? nextMatch[1] : '';
          } while (token);
        }

        return jsonResponse({ success: true, bucket: creds.bucket, files: filesList });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'List failed' }, 500);
      }
    }

    // 3a. Single Track Lookup directly from R2 (deep links & live subtitle hydration)
    if (pathname.startsWith('/api/storage/track/') && request.method === 'GET') {
      try {
        const rawParam = pathname.slice('/api/storage/track/'.length);
        const cleanId = decodeURIComponent(rawParam).replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!cleanId) {
          return jsonResponse({ success: false, error: 'Missing track id' }, 400);
        }
        let parsed: any = null;
        const key = `tracks/${cleanId}.json`;
        if (env.R2_BUCKET) {
          const obj = await env.R2_BUCKET.get(key);
          parsed = obj ? JSON.parse(await obj.text()) : null;
        } else {
          const r = await signedR2Fetch(creds, 'GET', `/${creds.bucket}/${encodeS3Path(key)}`);
          parsed = r.ok ? await r.json().catch(() => null) : null;
        }
        if (!parsed || typeof parsed !== 'object') {
          return jsonResponse({ success: false, error: 'Track not found' }, 404);
        }
        const { uploadedByEmail: _omitEmail, ...cleanTrack } = parsed;
        const mergedViews = Math.max(
          Number(cleanTrack.viewsCount) || 0,
          workerOptimisticViewCounts.get(cleanId) || 0
        );
        return jsonResponse({
          success: true,
          track: { ...cleanTrack, viewsCount: mergedViews },
        });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Track lookup failed' }, 500);
      }
    }

    // 3b. Fast Single-Roundtrip Tracks Feed (reads tracks_index.json + tracks/*.json directly inside Worker)
    if (pathname === '/api/storage/tracks-feed' && request.method === 'GET') {
      try {
        const trackMap = new Map<string, any>();
        const readJsonKey = async (key: string) => {
          try {
            if (env.R2_BUCKET) {
              const obj = await env.R2_BUCKET.get(key);
              return obj ? JSON.parse(await obj.text()) : null;
            }
            const r = await signedR2Fetch(creds, 'GET', `/${creds.bucket}/${encodeS3Path(key)}`);
            return r.ok ? await r.json() : null;
          } catch {
            return null;
          }
        };

        const indexData = await readJsonKey('tracks_index.json');
        if (Array.isArray(indexData)) {
          indexData.forEach((t: any) => {
            if (t?.id && t?.name && t?.audioUrl) {
              const opt = workerOptimisticViewCounts.get(t.id) || 0;
              trackMap.set(t.id, opt > (Number(t.viewsCount) || 0) ? { ...t, viewsCount: opt } : t);
            }
          });
        }

        const keys: string[] = [];
        if (env.R2_BUCKET) {
          const listed = await env.R2_BUCKET.list({ prefix: 'tracks/' });
          listed.objects.forEach((o) => {
            if (o.key.endsWith('.json')) keys.push(o.key);
          });
        } else {
          const listRes = await signedR2Fetch(creds, 'GET', `/${creds.bucket}`, { 'list-type': '2', prefix: 'tracks/' });
          if (listRes.ok) {
            const xml = await listRes.text();
            parseXmlTagValues(xml, 'Contents', ['Key']).forEach((it) => {
              if (it.Key?.endsWith('.json')) keys.push(it.Key);
            });
          }
        }

        for (let i = 0; i < keys.length; i += 25) {
          const slice = keys.slice(i, i + 25);
          const items = await Promise.all(slice.map((k) => readJsonKey(k)));
          items.forEach((t: any) => {
            if (t?.id && t?.name && t?.audioUrl) {
              const prev = trackMap.get(t.id);
              const mergedViews = Math.max(
                Number(prev?.viewsCount) || 0,
                Number(t.viewsCount) || 0,
                workerOptimisticViewCounts.get(t.id) || 0
              );
              trackMap.set(t.id, { ...t, viewsCount: mergedViews });
            }
          });
        }

        return jsonResponse({ success: true, tracks: Array.from(trackMap.values()) });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Tracks feed failed' }, 500);
      }
    }

    // 3c. Single Profile Lookup - 100% Pure Cloudflare R2
    if (pathname.startsWith('/api/storage/profile/') && request.method === 'GET') {
      try {
        const rawUid = decodeURIComponent(pathname.replace(/^\/api\/storage\/profile\//, '')).trim();
        const cleanUid = rawUid.replace(/^artist_/, '').replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!cleanUid) return jsonResponse({ success: false, error: 'Missing uid' }, 400);

        const readProfileKey = async (key: string) => {
          try {
            if (env.R2_BUCKET) {
              const obj = await env.R2_BUCKET.get(key);
              return obj ? JSON.parse(await obj.text()) : null;
            }
            const r = await signedR2Fetch(creds, 'GET', `/${creds.bucket}/${encodeS3Path(key)}`);
            return r.ok ? await r.json() : null;
          } catch {
            return null;
          }
        };

        const found = (await readProfileKey(`profiles/${cleanUid}.json`)) || (await readProfileKey(`profiles/artist_${cleanUid}.json`));
        if (!found || typeof found !== 'object') {
          return jsonResponse({ success: true, profile: null });
        }
        const { googleEmail: _omitEmail, ...cleanProfile } = found;
        return jsonResponse({ success: true, profile: cleanProfile });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Profile lookup failed' }, 500);
      }
    }

    // 3d. Fast Canonical Profiles Feed - 100% Pure Cloudflare R2
    if (pathname === '/api/storage/profiles-feed' && request.method === 'GET') {
      try {
        const readProfileKey = async (key: string) => {
          try {
            if (env.R2_BUCKET) {
              const obj = await env.R2_BUCKET.get(key);
              return obj ? JSON.parse(await obj.text()) : null;
            }
            const r = await signedR2Fetch(creds, 'GET', `/${creds.bucket}/${encodeS3Path(key)}`);
            return r.ok ? await r.json() : null;
          } catch {
            return null;
          }
        };

        const keys: string[] = [];
        if (env.R2_BUCKET) {
          let cursor: string | undefined;
          do {
            const listed = await env.R2_BUCKET.list({ prefix: 'profiles/', cursor });
            listed.objects.forEach((o) => {
              if (o.key.endsWith('.json')) keys.push(o.key);
            });
            cursor = listed.truncated ? listed.cursor : undefined;
          } while (cursor);
        } else {
          let token = '';
          do {
            const q: Record<string, string> = { 'list-type': '2', prefix: 'profiles/' };
            if (token) q['continuation-token'] = token;
            const listRes = await signedR2Fetch(creds, 'GET', `/${creds.bucket}`, q);
            if (!listRes.ok) break;
            const xml = await listRes.text();
            parseXmlTagValues(xml, 'Contents', ['Key']).forEach((it) => {
              if (it.Key?.endsWith('.json')) keys.push(it.Key);
            });
            const truncMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/);
            const nextMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
            token = truncMatch?.[1] === 'true' && nextMatch?.[1] ? nextMatch[1] : '';
          } while (token);
        }

        const profileMap = new Map<string, { data: any; ts: number; isCanonicalKey: boolean }>();
        for (let i = 0; i < keys.length; i += 25) {
          const slice = keys.slice(i, i + 25);
          const loaded = await Promise.all(slice.map(async (k) => ({ key: k, data: await readProfileKey(k) })));
          for (const item of loaded) {
            if (!item.data || typeof item.data !== 'object') continue;
            const { googleEmail: _omitEmail, ...clean } = item.data;
            const uid = String(clean.googleUid || clean.id || '').replace(/^artist_/, '').trim();
            if (!uid) continue;
            const ts = Math.max(
              Date.parse(String(clean.updatedAt || '')) || 0,
              Date.parse(String(clean.acceptedTermsAt || '')) || 0
            );
            const isCanonicalKey = !item.key.startsWith('profiles/artist_');
            const prev = profileMap.get(uid);
            if (!prev || ts > prev.ts || (ts === prev.ts && isCanonicalKey && !prev.isCanonicalKey)) {
              profileMap.set(uid, { data: { ...clean, id: uid, googleUid: uid }, ts, isCanonicalKey });
            }
          }
        }

        return jsonResponse({
          success: true,
          profiles: Array.from(profileMap.values()).map((entry) => entry.data),
        });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Profiles feed failed' }, 500);
      }
    }

    // 4. Delete file (strictly owner-verified; admin has NO song deletion permission)
    if (pathname === '/api/storage/delete' && request.method === 'DELETE') {
      try {
        const filePath = (url.searchParams.get('path') || '').trim().replace(/^\/+/, '');
        if (!filePath) return jsonResponse({ success: false, error: 'Missing path' }, 400);

        const sess = await extractSessionTop();
        const cleanSessUid = String(sess?.uid || '').replace(/^artist_/, '').trim();

        if (filePath.startsWith('tracks/') && filePath.endsWith('.json')) {
          const existing = await readR2JsonTop(filePath);
          const ownerUid = String(existing?.uploadedByUid || '').replace(/^artist_/, '').trim();
          if (!sess || !cleanSessUid || (existing && ownerUid && ownerUid !== cleanSessUid)) {
            return jsonResponse({ success: false, error: 'רק בעל השיר רשאי למחוק שיר זה.' }, 403);
          }
        } else if (filePath.startsWith('albums/') && filePath.endsWith('.json')) {
          const existing = await readR2JsonTop(filePath);
          const ownerUid = String(existing?.uploadedByUid || existing?.artistId || '').replace(/^artist_/, '').trim();
          if (!sess || !cleanSessUid || (existing && ownerUid && ownerUid !== cleanSessUid)) {
            return jsonResponse({ success: false, error: 'רק בעל האלבום רשאי למחוק אלבום זה.' }, 403);
          }
        } else if (filePath.startsWith('profiles/') && filePath.endsWith('.json')) {
          const targetUid = filePath.replace(/^profiles\/(?:artist_)?/, '').replace(/\.json$/, '').trim();
          if (!sess || (!sess.isAdmin && cleanSessUid !== targetUid)) {
            return jsonResponse({ success: false, error: 'אין הרשאה למחוק פרופיל זה.' }, 403);
          }
        }

        if (env.R2_BUCKET) {
          await env.R2_BUCKET.delete(filePath);
        } else {
          await signedR2Fetch(creds, 'DELETE', `/${creds.bucket}/${encodeS3Path(filePath)}`);
        }
        return jsonResponse({ success: true });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Delete failed' }, 500);
      }
    }

    // 5. Raw file streamer with Range support
    if (pathname.startsWith('/api/storage/raw/') && request.method === 'GET') {
      const filePath = decodeURIComponent(pathname.replace(/^\/api\/storage\/raw\//, '')).replace(/^\/+/, '');
      if (!filePath) return new Response('Missing path', { status: 400 });

      const rangeHeader = request.headers.get('range');
      if (env.R2_BUCKET) {
        const obj = await env.R2_BUCKET.get(filePath, rangeHeader ? { range: request.headers } : undefined);
        if (!obj) return new Response('File not found', { status: 404 });
        const headers = new Headers();
        headers.set('Accept-Ranges', 'bytes');
        headers.set('Access-Control-Allow-Origin', '*');
        headers.set('Content-Type', obj.httpMetadata?.contentType || (filePath.endsWith('.json') ? 'application/json; charset=utf-8' : 'application/octet-stream'));
        headers.set('Cache-Control', filePath.endsWith('.json') ? 'no-store' : 'public, max-age=31536000, immutable');
        return new Response(obj.body, { headers });
      }

      const s3Res = await signedR2Fetch(
        creds,
        'GET',
        `/${creds.bucket}/${encodeS3Path(filePath)}`,
        {},
        null,
        rangeHeader ? { Range: rangeHeader } : {}
      );
      if (!s3Res.ok && s3Res.status !== 206) {
        return new Response('File not found in storage', { status: 404 });
      }
      const headers = new Headers(s3Res.headers);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', filePath.endsWith('.json') ? 'no-store' : 'public, max-age=31536000, immutable');
      return new Response(s3Res.body, { status: s3Res.status, headers });
    }

    // 6. CORS-safe image proxy
    if (pathname === '/api/proxy-image' && request.method === 'GET') {
      const targetUrl = (url.searchParams.get('url') || '').trim();
      if (!targetUrl || !isSafeExternalHttpUrl(targetUrl)) {
        return new Response('Invalid image URL', { status: 400 });
      }
      const upstream = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Kolot-Music-ColorExtractor/1.0', Accept: 'image/*,*/*;q=0.8' },
      });
      if (!upstream.ok) return new Response('Upstream error', { status: upstream.status });
      const contentType = upstream.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) return new Response('Not an image', { status: 415 });
      const headers = new Headers();
      headers.set('Content-Type', contentType);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Cache-Control', 'public, max-age=86400');
      return new Response(upstream.body, { status: 200, headers });
    }

    // 7. Whisper AI Subtitles & Audio Transcription
    if (pathname === '/api/ai/transcribe' && request.method === 'POST') {
      try {
        const bodyData: any = (request.headers.get('content-type') || '').includes('multipart/form-data')
          ? Object.fromEntries((await request.formData()).entries())
          : await request.json();

        const audioUrl = String(bodyData.audioUrl || '').trim();
        const language = String(bodyData.language || 'he');
        const songTitle = String(bodyData.songTitle || '').trim();
        const artistName = String(bodyData.artistName || '').trim();
        const duration = Math.max(10, Number(bodyData.duration) || 180);

        let audioBytes: Uint8Array | null = null;
        let mimeType = 'audio/mp3';

        const resolvedRawPath = (() => {
          if (audioUrl.startsWith('/api/storage/raw/')) return audioUrl;
          try {
            const parsedAudio = new URL(audioUrl);
            const reqOrigin = new URL(request.url).origin;
            if (parsedAudio.origin === reqOrigin && parsedAudio.pathname.startsWith('/api/storage/raw/')) {
              return parsedAudio.pathname;
            }
          } catch {}
          return '';
        })();

        if (bodyData.file && typeof bodyData.file.arrayBuffer === 'function') {
          audioBytes = new Uint8Array(await bodyData.file.arrayBuffer());
          mimeType = bodyData.file.type || 'audio/mp3';
        } else if (resolvedRawPath) {
          const r2Key = decodeURIComponent(resolvedRawPath.replace(/^\/api\/storage\/raw\//, ''));
          if (env.R2_BUCKET) {
            const obj = await env.R2_BUCKET.get(r2Key);
            if (obj) {
              audioBytes = new Uint8Array(await obj.arrayBuffer());
              mimeType = obj.httpMetadata?.contentType || 'audio/mp3';
            }
          } else {
            const s3Res = await signedR2Fetch(creds, 'GET', `/${creds.bucket}/${encodeS3Path(r2Key)}`);
            if (s3Res.ok) {
              audioBytes = new Uint8Array(await s3Res.arrayBuffer());
              mimeType = s3Res.headers.get('content-type') || 'audio/mp3';
            }
          }
        } else if (audioUrl && isSafeExternalHttpUrl(audioUrl)) {
          const upstream = await fetch(audioUrl);
          if (upstream.ok) {
            audioBytes = new Uint8Array(await upstream.arrayBuffer());
            mimeType = upstream.headers.get('content-type') || 'audio/mp3';
          }
        }

        if (!audioBytes || audioBytes.length === 0) {
          return jsonResponse({ success: false, error: 'לא נמצא קובץ שמע זמין לתמלול.' }, 400);
        }

        const MAX_AUDIO = 15 * 1024 * 1024;
        if (audioBytes.length > MAX_AUDIO) audioBytes = audioBytes.subarray(0, MAX_AUDIO);

        if (env.OPENAI_API_KEY) {
          const fd = new FormData();
          const copy = new Uint8Array(audioBytes.byteLength);
          copy.set(audioBytes);
          fd.append('file', new Blob([copy.buffer], { type: mimeType }), 'track.mp3');
          fd.append('model', 'whisper-1');
          fd.append('response_format', 'verbose_json');
          const wRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
            body: fd,
          });
          if (wRes.ok) {
            const wData: any = await wRes.json();
            const segments = (wData.segments || []).map((s: any, idx: number) => ({
              id: `whisper_${idx}`,
              startTime: Number((s.start ?? 0).toFixed(2)),
              endTime: Number((s.end ?? (s.start ?? 0) + 4).toFixed(2)),
              text: String(s.text || '').trim(),
            })).filter((s: any) => s.text);
            return jsonResponse({
              success: true,
              provider: 'openai-whisper',
              segments,
              lyrics: segments.map((s: any) => s.text).join('\n'),
            });
          }
        }

        if (!env.GEMINI_API_KEY) {
          return jsonResponse(
            {
              success: false,
              missingKey: true,
              error: 'שירות התמלול בענן אינו מוגדר עדיין — ממשיך לתמלול מקומי במכשיר.',
            },
            503
          );
        }

        const b64 = uint8ToBase64(audioBytes);
        const parseSrtTs = (raw: string) => {
          const parts = raw.trim().replace(/,/g, '.').split(':').map((p) => parseFloat(p));
          if (parts.some((n) => Number.isNaN(n))) return 0;
          if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
          if (parts.length === 2) return parts[0] * 60 + parts[1];
          return parts[0] || 0;
        };

        const structuredPrompt =
          `זהה את השפה המרכזית שבה השיר מושר או מדובר בקובץ השמע ותמלל את המילים לשורות כתוביות קצרות ומסונכרנות היטב לקצב.\n` +
          `${songTitle ? `שם השיר: "${songTitle}". ` : ''}` +
          `${artistName ? `שם הזמר/אמן: "${artistName}". ` : ''}` +
          `חוקי חובה:\n` +
          `1. detectedLanguageCode: קוד שפה קצר (ISO-639-1) של השפה הנשמעת בשיר (he, en, ar, es, fr, ru, yi, it, pt, de, ja וכו').\n` +
          `2. detectedLanguageLabel: שם השפה לקורא (לדוגמה "עברית", "English", "العربية", "Español", "Français", "Русский", "ייִדיש").\n` +
          `3. עבור כל שורה ב-segments ספק start ו-end (HH:MM:SS,mmm), text (בשפת המקור בפועל), textHe (בעברית כברירת מחדל), ו-textEn (באנגלית כברירת מחדל).\n` +
          `אם הקובץ אינסטרומנטלי לחלוטין ללא שירה או דיבור, החזר segments ריק []. אל תמציא מילים.`;

        let detectedLanguageCode = '';
        let detectedLanguageLabel = '';
        let structuredItems: Array<{ start: string; end: string; text: string; textHe?: string; textEn?: string }> = [];

        const subtitleSchema = {
          type: 'OBJECT',
          description: 'זיהוי שפה ורשימת כתוביות מסודרת כרונולוגית',
          properties: {
            detectedLanguageCode: { type: 'STRING', description: 'קוד ISO-639-1 של שפת המקור המושרת בשיר' },
            detectedLanguageLabel: { type: 'STRING', description: 'שם שפת המקור בשפתה או בעברית' },
            segments: {
              type: 'ARRAY',
              description: 'רשימת כתוביות מסודרת כרונולוגית',
              items: {
                type: 'OBJECT',
                properties: {
                  start: { type: 'STRING', description: 'זמן התחלה בפורמט HH:MM:SS,mmm' },
                  end: { type: 'STRING', description: 'זמן סיום בפורמט HH:MM:SS,mmm' },
                  text: { type: 'STRING', description: 'הטקסט המושר בשפת המקור' },
                  textHe: { type: 'STRING', description: 'הטקסט בעברית' },
                  textEn: { type: 'STRING', description: 'הטקסט באנגלית' },
                },
                required: ['start', 'end', 'text', 'textHe', 'textEn'],
              },
            },
          },
          required: ['detectedLanguageCode', 'detectedLanguageLabel', 'segments'],
        };

        for (const candidate of [
          { model: 'gemini-3-flash-preview', timeoutMs: 22000, genConfig: { thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json', responseSchema: subtitleSchema } },
          { model: 'gemini-2.5-flash', timeoutMs: 20000, genConfig: { thinkingConfig: { thinkingBudget: 0 }, responseMimeType: 'application/json', responseSchema: subtitleSchema } },
          { model: 'gemini-2.5-flash-lite', timeoutMs: 14000, genConfig: { responseMimeType: 'application/json', responseSchema: subtitleSchema } },
        ]) {
          try {
            const gRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${candidate.model}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'aistudio-build' },
                signal: AbortSignal.timeout(candidate.timeoutMs),
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [{ text: structuredPrompt }, { inlineData: { mimeType, data: b64 } }] }],
                  generationConfig: candidate.genConfig,
                }),
              }
            );
            if (gRes.ok) {
              const gJson: any = await gRes.json();
              const rawJson = String(gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
              if (rawJson) {
                const parsed = JSON.parse(rawJson);
                if (Array.isArray(parsed)) {
                  structuredItems = parsed;
                } else if (parsed && Array.isArray(parsed.segments)) {
                  structuredItems = parsed.segments;
                  detectedLanguageCode = String(parsed.detectedLanguageCode || '').trim().toLowerCase().slice(0, 12);
                  detectedLanguageLabel = String(parsed.detectedLanguageLabel || '').trim().slice(0, 48);
                }
                if (structuredItems.length > 0) break;
              }
            }
          } catch {}
        }

        const buildWorkerPayload = (
          items: Array<{ start?: string; end?: string; startTime?: number; endTime?: number; text: string; textHe?: string; textEn?: string }>,
          provider: string
        ) => {
          const segments: any[] = [];
          const segmentsHe: any[] = [];
          const segmentsEn: any[] = [];
          const segmentsOrigRaw: any[] = [];

          items.forEach((item, idx) => {
            const mainText = String(item?.text || item?.textHe || item?.textEn || '').trim();
            if (!mainText || /^(?:\[?(?:instrumental|music|קטע אינסטרומנטלי)\]?)$/i.test(mainText)) return;
            const startTime =
              typeof item.startTime === 'number'
                ? Math.max(0, Number(item.startTime.toFixed(2)))
                : Math.max(0, Number(parseSrtTs(String(item?.start || '00:00:00,000')).toFixed(2)));
            const rawEnd =
              typeof item.endTime === 'number'
                ? Number(item.endTime.toFixed(2))
                : Number(parseSrtTs(String(item?.end || '')).toFixed(2));
            const endTime = rawEnd > startTime ? rawEnd : Number((startTime + 3.5).toFixed(2));

            segments.push({ id: `gem_seg_${idx}`, startTime, endTime, text: mainText });
            segmentsHe.push({ id: `gem_he_${idx}`, startTime, endTime, text: String(item?.textHe || mainText).trim() });
            segmentsEn.push({ id: `gem_en_${idx}`, startTime, endTime, text: String(item?.textEn || mainText).trim() });
            segmentsOrigRaw.push({ id: `gem_orig_${idx}`, startTime, endTime, text: mainText });
          });

          if (segments.length === 0) return null;
          const baseLang = detectedLanguageCode.split('-')[0];
          const isOrigNonHeEn = Boolean(baseLang && baseLang !== 'he' && baseLang !== 'iw' && baseLang !== 'en');
          return {
            success: true,
            provider,
            detectedLanguageCode: detectedLanguageCode || undefined,
            detectedLanguageLabel: detectedLanguageLabel || undefined,
            segments,
            segmentsHe,
            segmentsEn,
            ...(isOrigNonHeEn
              ? {
                  segmentsOrig: segmentsOrigRaw,
                  lyricsOrig: segmentsOrigRaw.map((s) => s.text).join('\n'),
                }
              : {}),
            lyrics: segments.map((s) => s.text).join('\n'),
            lyricsHe: segmentsHe.map((s) => s.text).join('\n'),
            lyricsEn: segmentsEn.map((s) => s.text).join('\n'),
          };
        };

        if (structuredItems.length > 0) {
          const payload = buildWorkerPayload(structuredItems, 'gemini-subtitles-srt');
          if (payload) {
            return jsonResponse(payload);
          }
        }

        const promptText =
          `Transcribe all sung lyrics word-for-word in the exact language sung. ` +
          `${songTitle ? `Song: "${songTitle}". ` : ''}${artistName ? `Artist: "${artistName}". ` : ''}` +
          `Format every line as [MM:SS - MM:SS] Lyric text. If purely instrumental output NOTHING.`;

        let textOut = '';
        try {
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'User-Agent': 'aistudio-build' },
              signal: AbortSignal.timeout(20000),
              body: JSON.stringify({
                contents: [{ parts: [{ inlineData: { mimeType, data: b64 } }, { text: promptText }] }],
              }),
            }
          );
          if (geminiRes.ok) {
            const gJson: any = await geminiRes.json();
            textOut = String(gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
          }
        } catch {}

        const segments = buildSegmentsFromText(textOut, duration);
        if (segments.length > 0) {
          try {
            const enrichRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': 'aistudio-build' },
                signal: AbortSignal.timeout(10000),
                body: JSON.stringify({
                  contents: [{
                    role: 'user',
                    parts: [{
                      text:
                        `לפניך ${segments.length} שורות תמלול של שיר. זהה את שפת המקור ותרגם לעברית (heLines) ולאנגלית (enLines) באותו אורך בדיוק:\n` +
                        JSON.stringify(segments.map((s: any) => s.text)),
                    }],
                  }],
                  generationConfig: {
                    thinkingConfig: { thinkingBudget: 0 },
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: 'OBJECT',
                      properties: {
                        detectedLanguageCode: { type: 'STRING' },
                        detectedLanguageLabel: { type: 'STRING' },
                        heLines: { type: 'ARRAY', items: { type: 'STRING' } },
                        enLines: { type: 'ARRAY', items: { type: 'STRING' } },
                      },
                      required: ['detectedLanguageCode', 'detectedLanguageLabel', 'heLines', 'enLines'],
                    },
                  },
                }),
              }
            );
            if (enrichRes.ok) {
              const ej: any = await enrichRes.json();
              const parsedE = JSON.parse(String(ej?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'));
              detectedLanguageCode = String(parsedE.detectedLanguageCode || '').trim().toLowerCase().slice(0, 12);
              detectedLanguageLabel = String(parsedE.detectedLanguageLabel || '').trim().slice(0, 48);
              const heLines = Array.isArray(parsedE.heLines) ? parsedE.heLines : [];
              const enLines = Array.isArray(parsedE.enLines) ? parsedE.enLines : [];
              const enriched = buildWorkerPayload(
                segments.map((s: any, idx: number) => ({
                  startTime: s.startTime,
                  endTime: s.endTime,
                  text: s.text,
                  textHe: String(heLines[idx] || s.text),
                  textEn: String(enLines[idx] || s.text),
                })),
                'gemini-3.5-transcribe'
              );
              if (enriched) return jsonResponse(enriched);
            }
          } catch {}
        }

        return jsonResponse({
          success: segments.length > 0,
          provider: 'gemini-3.5-transcribe',
          segments,
          lyrics: segments.map((s) => s.text).join('\n'),
          ...(segments.length === 0 ? { error: 'לא זוהו מילים בקובץ השמע.' } : {}),
        });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Transcribe error' }, 500);
      }
    }

    // 8. Audio Classification Endpoint
    if (pathname === '/api/ai/classify-audio' && request.method === 'POST') {
      try {
        const canonicalGenres = ['Pop', 'Mizrahi', 'Rock', 'Electronic', 'Hip Hop', 'Acoustic', 'Chill', 'Classical', 'Jazz', 'Blues', 'Cinematic'] as const;
        const hebrewLabels: Record<string, string> = {
          Pop: 'פופ',
          Mizrahi: 'מזרחית',
          Rock: 'רוק',
          Electronic: 'אלקטרוני',
          'Hip Hop': 'היפ הופ / ראפ',
          Acoustic: 'אקוסטי',
          Chill: 'צ׳יל',
          Classical: 'קלאסי',
          Jazz: 'ג׳אז',
          Blues: 'בלוז',
          Cinematic: 'קולנועי',
        };

        const bodyData: any = (request.headers.get('content-type') || '').includes('multipart/form-data')
          ? Object.fromEntries((await request.formData()).entries())
          : await request.json();

        const audioUrl = String(bodyData.audioUrl || '').trim();
        const songTitle = String(bodyData.songTitle || '').trim();
        const artistName = String(bodyData.artistName || '').trim();
        const lyrics = String(bodyData.lyrics || '').trim();

        let audioBytes: Uint8Array | null = null;
        let mimeType = 'audio/mp3';

        if (bodyData.file && typeof bodyData.file.arrayBuffer === 'function') {
          audioBytes = new Uint8Array(await bodyData.file.arrayBuffer());
          mimeType = bodyData.file.type || 'audio/mp3';
        } else if (audioUrl.startsWith('/api/storage/raw/')) {
          const r2Key = decodeURIComponent(audioUrl.replace(/^\/api\/storage\/raw\//, ''));
          if (env.R2_BUCKET) {
            const obj = await env.R2_BUCKET.get(r2Key);
            if (obj) {
              audioBytes = new Uint8Array(await obj.arrayBuffer());
              mimeType = obj.httpMetadata?.contentType || 'audio/mp3';
            }
          } else {
            const s3Res = await signedR2Fetch(creds, 'GET', `/${creds.bucket}/${encodeS3Path(r2Key)}`);
            if (s3Res.ok) {
              audioBytes = new Uint8Array(await s3Res.arrayBuffer());
              mimeType = s3Res.headers.get('content-type') || 'audio/mp3';
            }
          }
        } else if (audioUrl && isSafeExternalHttpUrl(audioUrl)) {
          const upstream = await fetch(audioUrl);
          if (upstream.ok) {
            audioBytes = new Uint8Array(await upstream.arrayBuffer());
            mimeType = upstream.headers.get('content-type') || 'audio/mp3';
          }
        }

        if (audioBytes && audioBytes.length > 15 * 1024 * 1024) {
          audioBytes = audioBytes.subarray(0, 15 * 1024 * 1024);
        }

        if (env.GEMINI_API_KEY && audioBytes && audioBytes.length > 0) {
          const b64 = uint8ToBase64(audioBytes);
          const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'User-Agent': 'aistudio-build' },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      { inlineData: { mimeType, data: b64 } },
                      {
                        text: `Listen to this song audio and classify its exact musical genre from: ${canonicalGenres.join(', ')}. Context: title="${songTitle}", artist="${artistName}". Return strict JSON with keys: genre, confidence (0..1), mood (Hebrew), bpmEstimate (number), reasonHe (Hebrew).`,
                      },
                    ],
                  },
                ],
                generationConfig: { responseMimeType: 'application/json' },
              }),
            }
          );

          if (geminiRes.ok) {
            const gJson: any = await geminiRes.json();
            const txt = gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
            const parsed = JSON.parse(txt);
            const detectedGenre = (canonicalGenres as readonly string[]).includes(parsed.genre) ? parsed.genre : 'Pop';
            return jsonResponse({
              success: true,
              provider: 'gemini-audio-classifier',
              genre: detectedGenre,
              hebrewGenre: hebrewLabels[detectedGenre] || detectedGenre,
              confidence: Number(parsed.confidence) || 0.9,
              mood: parsed.mood || '',
              bpmEstimate: Number(parsed.bpmEstimate) || 110,
              reasonHe: parsed.reasonHe || 'זוהה מתוך ניתוח השמע',
            });
          }
        }

        return jsonResponse({
          success: true,
          provider: 'heuristic-metadata',
          genre: 'Pop',
          hebrewGenre: 'פופ',
          confidence: 0.65,
          mood: 'קצבי',
          bpmEstimate: 112,
          reasonHe: 'סווג אוטומטית',
        });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Classification error' }, 500);
      }
    }

    // 9. Same-origin HuggingFace model proxy (avoids browser CORS/redirect Failed to fetch for Whisper WASM)
    if (pathname.startsWith('/api/hf-proxy/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const subPath = pathname.replace(/^\/api\/hf-proxy\//, '');
      if (!subPath || subPath.includes('..') || !/^[a-zA-Z0-9._\-\/@]+$/.test(subPath)) {
        return new Response('Invalid model path', { status: 400 });
      }
      const targetUrl = `https://huggingface.co/${subPath}${url.search || ''}`;
      const fetchHeaders = new Headers();
      fetchHeaders.set('User-Agent', 'Kolot-Whisper-Client/1.0');
      const rangeHdr = request.headers.get('range');
      if (rangeHdr) fetchHeaders.set('Range', rangeHdr);
      const upstream = await fetch(targetUrl, {
        method: request.method,
        headers: fetchHeaders,
        redirect: 'follow',
      });
      if (!upstream.ok && upstream.status !== 206) {
        return new Response('Upstream HuggingFace error', { status: upstream.status });
      }
      const outHeaders = new Headers();
      const ct = upstream.headers.get('content-type');
      const cl = upstream.headers.get('content-length');
      const cr = upstream.headers.get('content-range');
      const ce = upstream.headers.get('content-encoding');
      if (ct) outHeaders.set('Content-Type', ct);
      if (cl && !ce) outHeaders.set('Content-Length', cl);
      if (cr) outHeaders.set('Content-Range', cr);
      outHeaders.set('Accept-Ranges', 'bytes');
      outHeaders.set('Access-Control-Allow-Origin', '*');
      outHeaders.set('Cache-Control', 'public, max-age=86400');
      return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: outHeaders });
    }

    // 10. Same-origin ONNX Runtime Web WASM proxy (keeps dist under 25 MiB while preventing CDN fetch blocks)
    if (pathname.startsWith('/api/onnx-wasm/') && (request.method === 'GET' || request.method === 'HEAD')) {
      const fileName = pathname.replace(/^\/api\/onnx-wasm\//, '').split('?')[0];
      if (!fileName || !/^[a-zA-Z0-9._\-]+$/.test(fileName)) {
        return new Response('Invalid WASM asset', { status: 400 });
      }
      const cdnUrl = `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/${fileName}`;
      const upstream = await fetch(cdnUrl, { method: request.method, redirect: 'follow' });
      if (!upstream.ok) return new Response('WASM asset not found', { status: upstream.status });
      const outHeaders = new Headers();
      outHeaders.set(
        'Content-Type',
        fileName.endsWith('.wasm')
          ? 'application/wasm'
          : fileName.endsWith('.mjs') || fileName.endsWith('.js')
            ? 'application/javascript; charset=utf-8'
            : (upstream.headers.get('content-type') || 'application/octet-stream')
      );
      outHeaders.set('Access-Control-Allow-Origin', '*');
      outHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
      outHeaders.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: outHeaders });
    }

    // 11. Free Unlimited Subtitle Translator (Hebrew <-> English, zero API keys)
    if (pathname === '/api/ai/translate-subtitles' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const lines: string[] = Array.isArray(body?.lines) ? body.lines.map((x: any) => String(x || '').trim()).slice(0, 120) : [];
        const sl = body?.source === 'he' ? 'he' : 'en';
        const tl = body?.target === 'en' ? 'en' : 'he';
        if (lines.length === 0) return jsonResponse({ success: true, translations: [] });

        const joined = lines.join('\n');
        const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(joined)}`;
        const gtRes = await fetch(gtUrl, { headers: { 'User-Agent': 'Kolot-Subtitles/1.0' } });
        if (!gtRes.ok) {
          return jsonResponse({ success: false, translations: [] }, 502);
        }
        const rawData: any = await gtRes.json();
        const translatedFull = Array.isArray(rawData?.[0])
          ? rawData[0].map((part: any) => String(part?.[0] || '')).join('')
          : '';
        const splitLines = translatedFull.split('\n').map((l: string) => l.trim());
        const normalized = lines.map((_, idx) => splitLines[idx] || '');
        return jsonResponse({ success: true, translations: normalized });
      } catch (err: any) {
        return jsonResponse({ success: false, translations: [], error: err?.message || 'Translate failed' }, 500);
      }
    }

    // 12. Public Track Report endpoints (100% R2 reports/)
    if (pathname === '/api/storage/report' && request.method === 'POST') {
      try {
        const rep: any = await request.json();
        if (!rep?.id || !rep?.trackId || !rep?.trackName) {
          return jsonResponse({ success: false, error: 'Missing report fields' }, 400);
        }
        const key = `reports/${String(rep.id).replace(/[^a-zA-Z0-9_\-]/g, '')}.json`;
        const bodyBytes = encoder.encode(JSON.stringify(rep));
        if (env.R2_BUCKET) {
          await env.R2_BUCKET.put(key, bodyBytes, { httpMetadata: { contentType: 'application/json' } });
        } else {
          await signedR2Fetch(creds, 'PUT', `/${creds.bucket}/${encodeS3Path(key)}`, {}, bodyBytes, {
            'Content-Type': 'application/json',
          });
        }
        return jsonResponse({ success: true });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Report save failed' }, 500);
      }
    }

    const r2ReadJson = async (key: string) => {
      try {
        if (env.R2_BUCKET) {
          const obj = await env.R2_BUCKET.get(key);
          return obj ? JSON.parse(await obj.text()) : null;
        }
        const r = await signedR2Fetch(creds, 'GET', `/${creds.bucket}/${encodeS3Path(key)}`);
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    };

    const r2WriteJson = async (key: string, data: unknown) => {
      const bodyBytes = encoder.encode(JSON.stringify(data, null, 2));
      if (env.R2_BUCKET) {
        await env.R2_BUCKET.put(key, bodyBytes, { httpMetadata: { contentType: 'application/json' } });
      } else {
        await signedR2Fetch(creds, 'PUT', `/${creds.bucket}/${encodeS3Path(key)}`, {}, bodyBytes, {
          'Content-Type': 'application/json',
        });
      }
    };

    const r2DeleteKey = async (key: string) => {
      if (env.R2_BUCKET) {
        await env.R2_BUCKET.delete(key);
      } else {
        await signedR2Fetch(creds, 'DELETE', `/${creds.bucket}/${encodeS3Path(key)}`);
      }
    };

    const r2ListKeys = async (prefix: string): Promise<string[]> => {
      const keys: string[] = [];
      if (env.R2_BUCKET) {
        let cursor: string | undefined;
        do {
          const listed = await env.R2_BUCKET.list({ prefix, cursor });
          listed.objects.forEach((o) => keys.push(o.key));
          cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
      } else {
        let token = '';
        do {
          const q: Record<string, string> = { 'list-type': '2', prefix };
          if (token) q['continuation-token'] = token;
          const listRes = await signedR2Fetch(creds, 'GET', `/${creds.bucket}`, q);
          if (!listRes.ok) break;
          const xml = await listRes.text();
          parseXmlTagValues(xml, 'Contents', ['Key']).forEach((it) => {
            if (it.Key) keys.push(it.Key);
          });
          const truncMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/);
          const nextMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
          token = truncMatch?.[1] === 'true' && nextMatch?.[1] ? nextMatch[1] : '';
        } while (token);
      }
      return keys;
    };

    if (pathname === '/api/storage/reports' && request.method === 'GET') {
      try {
        const keys = (await r2ListKeys('reports/')).filter((k) => k.endsWith('.json'));
        const reports = (await Promise.all(keys.map((k) => r2ReadJson(k)))).filter(Boolean);
        return jsonResponse({ success: true, reports });
      } catch (err: any) {
        return jsonResponse({ success: false, reports: [], error: err?.message || 'Reports list failed' }, 500);
      }
    }

    if (pathname.startsWith('/api/storage/reports/') && request.method === 'DELETE') {
      try {
        const cleanId = pathname.replace(/^\/api\/storage\/reports\//, '').replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!cleanId) return jsonResponse({ success: false, error: 'Missing report id' }, 400);
        await r2DeleteKey(`reports/${cleanId}.json`);
        return jsonResponse({ success: true });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Report delete failed' }, 500);
      }
    }

    // 13. Fast Track Play Counter (100% R2)
    if (pathname === '/api/storage/track-play' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const cleanId = String(body?.trackId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!cleanId) return jsonResponse({ success: false }, 400);
        const key = `tracks/${cleanId}.json`;
        const trackData = await r2ReadJson(key);
        if (!trackData) return jsonResponse({ success: false, playsCount: 1 });
        const playsCount = (Number(trackData.playsCount) || 0) + 1;
        await r2WriteJson(key, { ...trackData, playsCount });
        return jsonResponse({ success: true, playsCount });
      } catch {
        return jsonResponse({ success: false, playsCount: 1 });
      }
    }

    // 13b. High-Load Coalesced & ETag-CAS Persistent Track Views Counter (starts at 0, increments per entry)
    if (pathname === '/api/storage/track-view' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const cleanId = String(body?.trackId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!cleanId) return jsonResponse({ success: false }, 400);

        workerPendingViewDeltas.set(cleanId, (workerPendingViewDeltas.get(cleanId) || 0) + 1);
        const nextOptimistic = (workerOptimisticViewCounts.get(cleanId) || 0) + 1;
        workerOptimisticViewCounts.set(cleanId, nextOptimistic);

        const flushWorkerTrackViews = async () => {
          if (workerInFlightViewFlushes.has(cleanId)) return;
          workerInFlightViewFlushes.add(cleanId);
          try {
            while ((workerPendingViewDeltas.get(cleanId) || 0) > 0) {
              const delta = workerPendingViewDeltas.get(cleanId) || 0;
              workerPendingViewDeltas.delete(cleanId);
              if (delta <= 0) break;

              let committed = false;
              const key = `tracks/${cleanId}.json`;

              if (env.R2_BUCKET) {
                for (let attempt = 0; attempt < 6; attempt++) {
                  const obj = await env.R2_BUCKET.get(key);
                  if (!obj) break;
                  const trackData = JSON.parse(await obj.text());
                  const viewsCount = (Number(trackData.viewsCount) || 0) + delta;
                  const bytes = encoder.encode(JSON.stringify({ ...trackData, viewsCount }, null, 2));
                  const putOpts: any = { httpMetadata: { contentType: 'application/json' } };
                  if (obj.httpEtag) putOpts.onlyIf = { etagMatches: obj.httpEtag };
                  const putRes = await env.R2_BUCKET.put(key, bytes, putOpts);
                  if (putRes !== null) {
                    workerOptimisticViewCounts.set(
                      cleanId,
                      Math.max(workerOptimisticViewCounts.get(cleanId) || 0, viewsCount)
                    );
                    committed = true;
                    break;
                  }
                  await new Promise((r) => setTimeout(r, 25 + Math.floor(Math.random() * 50)));
                }
              } else {
                const trackData = await r2ReadJson(key);
                if (trackData) {
                  const viewsCount = (Number(trackData.viewsCount) || 0) + delta;
                  await r2WriteJson(key, { ...trackData, viewsCount });
                  workerOptimisticViewCounts.set(
                    cleanId,
                    Math.max(workerOptimisticViewCounts.get(cleanId) || 0, viewsCount)
                  );
                  committed = true;
                }
              }

              if (!committed) {
                if (env.R2_BUCKET) {
                  for (let attempt = 0; attempt < 6; attempt++) {
                    const idxObj = await env.R2_BUCKET.get('tracks_index.json');
                    if (!idxObj) break;
                    const idxData = JSON.parse(await idxObj.text());
                    if (!Array.isArray(idxData)) break;
                    let found = false;
                    let nextViews = delta;
                    const nextArr = idxData.map((t: any) => {
                      if (t?.id === cleanId) {
                        found = true;
                        nextViews = (Number(t.viewsCount) || 0) + delta;
                        return { ...t, viewsCount: nextViews };
                      }
                      return t;
                    });
                    if (!found) break;
                    const bytes = encoder.encode(JSON.stringify(nextArr, null, 2));
                    const putOpts: any = { httpMetadata: { contentType: 'application/json' } };
                    if (idxObj.httpEtag) putOpts.onlyIf = { etagMatches: idxObj.httpEtag };
                    const putRes = await env.R2_BUCKET.put('tracks_index.json', bytes, putOpts);
                    if (putRes !== null) {
                      workerOptimisticViewCounts.set(
                        cleanId,
                        Math.max(workerOptimisticViewCounts.get(cleanId) || 0, nextViews)
                      );
                      committed = true;
                      break;
                    }
                    await new Promise((r) => setTimeout(r, 25 + Math.floor(Math.random() * 50)));
                  }
                } else {
                  const idxData = await r2ReadJson('tracks_index.json');
                  if (Array.isArray(idxData)) {
                    let nextViews = delta;
                    let found = false;
                    const nextArr = idxData.map((t: any) => {
                      if (t?.id === cleanId) {
                        found = true;
                        nextViews = (Number(t.viewsCount) || 0) + delta;
                        return { ...t, viewsCount: nextViews };
                      }
                      return t;
                    });
                    if (found) {
                      await r2WriteJson('tracks_index.json', nextArr);
                      workerOptimisticViewCounts.set(
                        cleanId,
                        Math.max(workerOptimisticViewCounts.get(cleanId) || 0, nextViews)
                      );
                      committed = true;
                    }
                  }
                }
              }

              if (!committed) {
                workerPendingViewDeltas.set(cleanId, (workerPendingViewDeltas.get(cleanId) || 0) + delta);
                break;
              }
            }
          } finally {
            workerInFlightViewFlushes.delete(cleanId);
          }
        };

        const flushPromise = flushWorkerTrackViews();
        if (ctx?.waitUntil) {
          ctx.waitUntil(flushPromise);
        } else {
          await flushPromise;
        }

        return jsonResponse({ success: true, viewsCount: workerOptimisticViewCounts.get(cleanId) || nextOptimistic });
      } catch {
        return jsonResponse({ success: false, viewsCount: 1 });
      }
    }

    // 13c. Listener Background Subtitles Persist Route
    if (pathname === '/api/storage/track-subtitles' && request.method === 'POST') {
      try {
        const body: any = await request.json();
        const cleanId = String(body?.trackId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!cleanId) return jsonResponse({ success: false, error: 'Missing trackId' }, 400);

        const incomingSegs = Array.isArray(body?.subtitleSegments) ? body.subtitleSegments : [];
        const incomingHe = Array.isArray(body?.subtitleSegmentsHe) ? body.subtitleSegmentsHe : [];
        const incomingEn = Array.isArray(body?.subtitleSegmentsEn) ? body.subtitleSegmentsEn : [];
        const incomingOrig = Array.isArray(body?.subtitleSegmentsOrig) ? body.subtitleSegmentsOrig : [];
        const incomingOrigCode = String(body?.detectedLanguageCode || '').trim().slice(0, 12);
        const incomingOrigLabel = String(body?.detectedLanguageLabel || '').trim().slice(0, 48);
        if (incomingSegs.length === 0 && incomingHe.length === 0 && incomingEn.length === 0 && incomingOrig.length === 0) {
          return jsonResponse({ success: false, error: 'Missing subtitles payload' }, 400);
        }

        const key = `tracks/${cleanId}.json`;
        const existing = await r2ReadJson(key);
        if (!existing) return jsonResponse({ success: false, error: 'Track not found' }, 404);
        if (existing.subtitlesDisabled === true) return jsonResponse({ success: false, disabled: true });

        const incomingIncomplete = Boolean(body?.subtitlesIncomplete);
        const incomingCompletedUpTo = Math.max(0, Number(body?.subtitlesCompletedUpTo) || 0);
        const existingHasSubs =
          (Array.isArray(existing.subtitleSegments) && existing.subtitleSegments.length > 0) ||
          (Array.isArray(existing.subtitleSegmentsHe) && existing.subtitleSegmentsHe.length > 0) ||
          (Array.isArray(existing.subtitleSegmentsEn) && existing.subtitleSegmentsEn.length > 0);
        const existingCompletedUpTo = Math.max(0, Number(existing.subtitlesCompletedUpTo) || 0);

        if (existingHasSubs && existing.subtitlesIncomplete !== true) {
          return jsonResponse({ success: true, alreadyExists: true, track: existing });
        }

        if (
          existingHasSubs &&
          existing.subtitlesIncomplete === true &&
          incomingCompletedUpTo > 0 &&
          incomingCompletedUpTo <= existingCompletedUpTo &&
          incomingIncomplete
        ) {
          return jsonResponse({ success: true, alreadyExists: true, track: existing });
        }

        const mergeSegmentArrays = (prevArr: any[], nextArr: any[]): any[] => {
          const combined = [...(Array.isArray(prevArr) ? prevArr : []), ...(Array.isArray(nextArr) ? nextArr : [])]
            .filter((s) => s && typeof s.text === 'string' && s.text.trim())
            .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
          const merged: any[] = [];
          for (const seg of combined) {
            const prev = merged[merged.length - 1];
            const sStart = Number(seg.startTime) || 0;
            const pStart = prev ? Number(prev.startTime) || 0 : -99;
            const pEnd = prev ? Number(prev.endTime) || 0 : -99;
            if (prev && (Math.abs(sStart - pStart) < 0.7 || sStart < pEnd - 0.35)) {
              const prevTxt = String(prev.text || '').trim().toLowerCase();
              const curTxt = String(seg.text || '').trim().toLowerCase();
              if (prevTxt === curTxt || (curTxt.length <= prevTxt.length && prevTxt.includes(curTxt))) {
                prev.endTime = Number(Math.max(pEnd, Number(seg.endTime) || 0).toFixed(2));
                if ((!prev.words || !prev.words.length) && Array.isArray(seg.words) && seg.words.length) {
                  prev.words = seg.words;
                }
                continue;
              }
            }
            merged.push(seg);
          }
          return merged;
        };

        const nextBase = incomingSegs.length > 0 ? incomingSegs : (incomingHe.length > 0 ? incomingHe : incomingEn);
        const mergedSegments = existingHasSubs ? mergeSegmentArrays(existing.subtitleSegments || [], nextBase) : nextBase;
        const mergedHe = incomingHe.length > 0
          ? (existingHasSubs ? mergeSegmentArrays(existing.subtitleSegmentsHe || [], incomingHe) : incomingHe)
          : existing.subtitleSegmentsHe;
        const mergedEn = incomingEn.length > 0
          ? (existingHasSubs ? mergeSegmentArrays(existing.subtitleSegmentsEn || [], incomingEn) : incomingEn)
          : existing.subtitleSegmentsEn;
        const mergedOrig = incomingOrig.length > 0
          ? (existingHasSubs ? mergeSegmentArrays(existing.subtitleSegmentsOrig || [], incomingOrig) : incomingOrig)
          : existing.subtitleSegmentsOrig;

        const nextCompletedUpTo = Math.max(existingCompletedUpTo, incomingCompletedUpTo);
        const nextIncomplete = incomingIncomplete;

        const nextLyricsHe = mergedHe?.length ? mergedHe.map((s: any) => s.text).join('\n') : (body?.lyricsHe ? String(body.lyricsHe) : existing.lyricsHe);
        const nextLyricsEn = mergedEn?.length ? mergedEn.map((s: any) => s.text).join('\n') : (body?.lyricsEn ? String(body.lyricsEn) : existing.lyricsEn);
        const nextLyricsOrig = mergedOrig?.length ? mergedOrig.map((s: any) => s.text).join('\n') : (body?.lyricsOrig ? String(body.lyricsOrig) : existing.lyricsOrig);
        const nextLyrics = mergedSegments?.length ? mergedSegments.map((s: any) => s.text).join('\n') : (body?.lyrics ? String(body.lyrics) : existing.lyrics);

        const updated = {
          ...existing,
          subtitleSegments: mergedSegments,
          ...(mergedHe?.length ? { subtitleSegmentsHe: mergedHe } : {}),
          ...(mergedEn?.length ? { subtitleSegmentsEn: mergedEn } : {}),
          ...(mergedOrig?.length ? { subtitleSegmentsOrig: mergedOrig } : {}),
          ...(nextLyrics ? { lyrics: nextLyrics } : {}),
          ...(nextLyricsHe ? { lyricsHe: nextLyricsHe } : {}),
          ...(nextLyricsEn ? { lyricsEn: nextLyricsEn } : {}),
          ...(nextLyricsOrig ? { lyricsOrig: nextLyricsOrig } : {}),
          ...(incomingOrigCode ? { detectedLanguageCode: incomingOrigCode } : {}),
          ...(incomingOrigLabel ? { detectedLanguageLabel: incomingOrigLabel } : {}),
          hasWhisperSubtitles: true,
          subtitlesIncomplete: nextIncomplete,
          ...(nextCompletedUpTo > 0 ? { subtitlesCompletedUpTo: nextCompletedUpTo } : {}),
          viewsCount: Math.max(Number(existing.viewsCount) || 0, workerOptimisticViewCounts.get(cleanId) || 0),
        };

        await r2WriteJson(key, updated);

        try {
          if (env.R2_BUCKET) {
            for (let attempt = 0; attempt < 5; attempt++) {
              const idxObj = await env.R2_BUCKET.get('tracks_index.json');
              if (!idxObj) break;
              const idxArr = JSON.parse(await idxObj.text());
              if (!Array.isArray(idxArr)) break;
              let changed = false;
              const nextArr = idxArr.map((t: any) => {
                if (t?.id === cleanId) {
                  changed = true;
                  return {
                    ...t,
                    subtitleSegments: updated.subtitleSegments,
                    ...(updated.subtitleSegmentsHe ? { subtitleSegmentsHe: updated.subtitleSegmentsHe } : {}),
                    ...(updated.subtitleSegmentsEn ? { subtitleSegmentsEn: updated.subtitleSegmentsEn } : {}),
                    ...(updated.subtitleSegmentsOrig ? { subtitleSegmentsOrig: updated.subtitleSegmentsOrig } : {}),
                    ...(updated.lyrics ? { lyrics: updated.lyrics } : {}),
                    ...(updated.lyricsHe ? { lyricsHe: updated.lyricsHe } : {}),
                    ...(updated.lyricsEn ? { lyricsEn: updated.lyricsEn } : {}),
                    ...(updated.lyricsOrig ? { lyricsOrig: updated.lyricsOrig } : {}),
                    ...(updated.detectedLanguageCode ? { detectedLanguageCode: updated.detectedLanguageCode } : {}),
                    ...(updated.detectedLanguageLabel ? { detectedLanguageLabel: updated.detectedLanguageLabel } : {}),
                    hasWhisperSubtitles: true,
                    subtitlesIncomplete: updated.subtitlesIncomplete,
                    ...(updated.subtitlesCompletedUpTo ? { subtitlesCompletedUpTo: updated.subtitlesCompletedUpTo } : {}),
                  };
                }
                return t;
              });
              if (!changed) break;
              const bytes = encoder.encode(JSON.stringify(nextArr, null, 2));
              const putOpts: any = { httpMetadata: { contentType: 'application/json' } };
              if (idxObj.httpEtag) putOpts.onlyIf = { etagMatches: idxObj.httpEtag };
              const putRes = await env.R2_BUCKET.put('tracks_index.json', bytes, putOpts);
              if (putRes !== null) break;
              await new Promise((r) => setTimeout(r, 25 + Math.floor(Math.random() * 45)));
            }
          } else {
            const idxArr = await r2ReadJson('tracks_index.json');
            if (Array.isArray(idxArr)) {
              const nextArr = idxArr.map((t: any) =>
                t?.id === cleanId
                  ? {
                      ...t,
                      subtitleSegments: updated.subtitleSegments,
                      ...(updated.subtitleSegmentsHe ? { subtitleSegmentsHe: updated.subtitleSegmentsHe } : {}),
                      ...(updated.subtitleSegmentsEn ? { subtitleSegmentsEn: updated.subtitleSegmentsEn } : {}),
                      ...(updated.subtitleSegmentsOrig ? { subtitleSegmentsOrig: updated.subtitleSegmentsOrig } : {}),
                      ...(updated.lyrics ? { lyrics: updated.lyrics } : {}),
                      ...(updated.lyricsHe ? { lyricsHe: updated.lyricsHe } : {}),
                      ...(updated.lyricsEn ? { lyricsEn: updated.lyricsEn } : {}),
                      ...(updated.lyricsOrig ? { lyricsOrig: updated.lyricsOrig } : {}),
                      ...(updated.detectedLanguageCode ? { detectedLanguageCode: updated.detectedLanguageCode } : {}),
                      ...(updated.detectedLanguageLabel ? { detectedLanguageLabel: updated.detectedLanguageLabel } : {}),
                      hasWhisperSubtitles: true,
                      subtitlesIncomplete: updated.subtitlesIncomplete,
                      ...(updated.subtitlesCompletedUpTo ? { subtitlesCompletedUpTo: updated.subtitlesCompletedUpTo } : {}),
                    }
                  : t
              );
              await r2WriteJson('tracks_index.json', nextArr);
            }
          }
        } catch {}

        const persisted = (await r2ReadJson(key)) || updated;
        return jsonResponse({ success: true, track: persisted });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'Subtitle persist error' }, 500);
      }
    }

    // 13c. Direct Contact Us Email Endpoint (saves to R2 contact_messages/ + dispatches behind the scenes to kolot-music@googlegroups.com)
    if (pathname === '/api/contact' && request.method === 'POST') {
      try {
        const body: any = await request.json().catch(() => ({}));
        const sess = await extractSessionTop();
        const rawSenderEmail = String(sess?.email || body?.senderEmail || '').trim();
        const category = String(body?.category || 'general').trim().slice(0, 48);
        const subject = String(body?.subject || '').trim().slice(0, 200);
        const message = String(body?.message || '').trim().slice(0, 5000);

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawSenderEmail)) {
          return jsonResponse({ success: false, error: 'יש להזין כתובת מייל אמיתית ותקינה' }, 400);
        }
        if (!subject || !message) {
          return jsonResponse({ success: false, error: 'יש למלא נושא ותוכן להודעה' }, 400);
        }

        const categoryLabels: Record<string, string> = {
          complaint: 'תלונה',
          request: 'בקשה / הצעה',
          support: 'תקלה טכנית',
          copyright: 'זכויות יוצרים',
          general: 'פנייה כללית',
        };
        const categoryLabel = categoryLabels[category] || category || 'פנייה';

        const randBytes = new Uint8Array(4);
        crypto.getRandomValues(randBytes);
        const randHex = Array.from(randBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
        const msgId = `msg_${Date.now()}_${randHex}`;
        const targetRecipient = 'kolot-music@googlegroups.com';
        const record = {
          id: msgId,
          to: targetRecipient,
          category,
          categoryLabel,
          senderEmail: rawSenderEmail,
          senderUid: sess?.uid || undefined,
          subject,
          message,
          createdAt: new Date().toISOString(),
          status: 'new',
        };

        const fullSubject = `[Kolot Music - ${categoryLabel}] ${subject}`;
        const plainBody =
          `פנייה חדשה מאתר Kolot Music\n` +
          `סוג הפנייה: ${categoryLabel}\n` +
          `מאת: ${rawSenderEmail}\n` +
          `נושא: ${subject}\n\n` +
          `${message}`;

        let storedInR2 = false;
        try {
          await r2WriteJson(`contact_messages/${msgId}.json`, record);
          storedInR2 = true;
        } catch {}

        let emailDispatched = false;
        let emailProvider = '';
        const resendKey = (env.RESEND_API_KEY || '').trim();
        if (resendKey && !emailDispatched) {
          try {
            const resendRes = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: env.RESEND_FROM_EMAIL || 'Kolot Music <onboarding@resend.dev>',
                to: [targetRecipient],
                reply_to: rawSenderEmail,
                subject: fullSubject,
                text: plainBody,
              }),
              signal: AbortSignal.timeout(4500),
            });
            if (resendRes.ok) {
              emailDispatched = true;
              emailProvider = 'resend';
            }
          } catch {}
        }

        const brevoKey = ((env as any).BREVO_API_KEY || '').trim();
        if (brevoKey && !emailDispatched) {
          try {
            const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
              method: 'POST',
              headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sender: { name: 'Kolot Music', email: ((env as any).BREVO_SENDER_EMAIL || '').trim() || 'kolot.music1@gmail.com' },
                to: [{ email: targetRecipient, name: 'Kolot Music' }],
                replyTo: { email: rawSenderEmail },
                subject: fullSubject,
                textContent: plainBody,
              }),
              signal: AbortSignal.timeout(4500),
            });
            if (brevoRes.ok) {
              emailDispatched = true;
              emailProvider = 'brevo';
            }
          } catch {}
        }

        const web3Key = ((env as any).WEB3FORMS_ACCESS_KEY || '').trim();
        if (web3Key && !emailDispatched) {
          try {
            const wRes = await fetch('https://api.web3forms.com/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({
                access_key: web3Key,
                from_name: rawSenderEmail,
                replyto: rawSenderEmail,
                subject: fullSubject,
                message: plainBody,
              }),
              signal: AbortSignal.timeout(4500),
            });
            const wData: any = await wRes.json().catch(() => null);
            if (wRes.ok && wData?.success === true) {
              emailDispatched = true;
              emailProvider = 'web3forms';
            }
          } catch {}
        }

        // 4. FormSubmit.co AJAX fallback (works without API keys once 1-time activation link in Google Group is confirmed)
        let activationPending = false;
        if (!emailDispatched) {
          try {
            const originUrl = request.headers.get('origin') || url.origin;
            const fRes = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(targetRecipient)}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Origin: originUrl,
                Referer: `${originUrl}/`,
              },
              body: JSON.stringify({
                name: rawSenderEmail,
                email: rawSenderEmail,
                _replyto: rawSenderEmail,
                _subject: fullSubject,
                category: categoryLabel,
                message: plainBody,
                _captcha: 'false',
              }),
              signal: AbortSignal.timeout(5000),
            });
            const fData: any = await fRes.json().catch(() => null);
            if (fRes.ok && (fData?.success === true || fData?.success === 'true')) {
              emailDispatched = true;
              emailProvider = 'formsubmit';
            } else if (String(fData?.message || '').toLowerCase().includes('activat')) {
              activationPending = true;
            }
          } catch {}
        }

        if (!storedInR2 && !emailDispatched) {
          return jsonResponse({ success: false, error: 'שליחת ההודעה נכשלה כרגע, אנא נסה שוב בעוד רגע' }, 502);
        }

        return jsonResponse({
          success: true,
          id: msgId,
          emailDispatched,
          emailProvider: emailProvider || undefined,
          activationPending: activationPending || undefined,
          storedInR2,
        });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'שליחת הפנייה נכשלה' }, 500);
      }
    }

    // 13d. Admin-only Contact Messages Inbox
    if (pathname === '/api/admin/contact-messages' && request.method === 'GET') {
      try {
        const sess = await extractSessionTop();
        if (!sess?.isAdmin) {
          return jsonResponse({ success: false, error: 'גישה מותרת למנהל המערכת בלבד.' }, 403);
        }
        const keys = (await r2ListKeys('contact_messages/')).filter((k) => k.endsWith('.json'));
        const messages = (await Promise.all(keys.map((k) => r2ReadJson(k).catch(() => null))))
          .filter(Boolean)
          .sort((a: any, b: any) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
        return jsonResponse({ success: true, messages });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'טעינת הפניות נכשלה' }, 500);
      }
    }

    if (pathname.startsWith('/api/admin/contact-messages/') && request.method === 'DELETE') {
      try {
        const sess = await extractSessionTop();
        if (!sess?.isAdmin) {
          return jsonResponse({ success: false, error: 'גישה מותרת למנהל המערכת בלבד.' }, 403);
        }
        const cleanId = pathname.replace('/api/admin/contact-messages/', '').replace(/[^a-zA-Z0-9_\-]/g, '');
        if (!cleanId) return jsonResponse({ success: false, error: 'Invalid message ID' }, 400);
        await r2DeleteKey(`contact_messages/${cleanId}.json`);
        return jsonResponse({ success: true, id: cleanId });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'מחיקת הפנייה נכשלה' }, 500);
      }
    }

    // 14. Single-Request Bootstrap Feed (tracks + profiles + albums loaded in parallel)
    if (pathname === '/api/bootstrap' && request.method === 'GET') {
      try {
        const [trackKeysAll, profileKeysAll, albumKeysAll, indexData] = await Promise.all([
          r2ListKeys('tracks/').catch(() => []),
          r2ListKeys('profiles/').catch(() => []),
          r2ListKeys('albums/').catch(() => []),
          r2ReadJson('tracks_index.json'),
        ]);

        const trackMap = new Map<string, any>();
        if (Array.isArray(indexData)) {
          indexData.forEach((t: any) => {
            if (t?.id && t?.name && t?.audioUrl) {
              const { uploadedByEmail: _omit, ...cleanTrack } = t;
              const opt = workerOptimisticViewCounts.get(cleanTrack.id) || 0;
              trackMap.set(
                cleanTrack.id,
                opt > (Number(cleanTrack.viewsCount) || 0) ? { ...cleanTrack, viewsCount: opt } : cleanTrack
              );
            }
          });
        }

        const trackKeys = trackKeysAll.filter((k) => k.endsWith('.json'));
        const profileKeys = profileKeysAll.filter((k) => k.endsWith('.json'));
        const albumKeys = albumKeysAll.filter((k) => k.endsWith('.json'));

        const [loadedTracks, loadedProfiles, loadedAlbums] = await Promise.all([
          Promise.all(trackKeys.map((k) => r2ReadJson(k))),
          Promise.all(profileKeys.map(async (k) => ({ key: k, data: await r2ReadJson(k) }))),
          Promise.all(albumKeys.map((k) => r2ReadJson(k))),
        ]);

        loadedTracks.forEach((t: any) => {
          if (t?.id && t?.name && t?.audioUrl) {
            const { uploadedByEmail: _omit, ...cleanTrack } = t;
            const prev = trackMap.get(cleanTrack.id);
            const mergedViews = Math.max(
              Number(prev?.viewsCount) || 0,
              Number(cleanTrack.viewsCount) || 0,
              workerOptimisticViewCounts.get(cleanTrack.id) || 0
            );
            trackMap.set(cleanTrack.id, { ...cleanTrack, viewsCount: mergedViews });
          }
        });

        const profileMap = new Map<string, { data: any; ts: number; isCanonicalKey: boolean }>();
        for (const item of loadedProfiles) {
          if (!item?.data || typeof item.data !== 'object') continue;
          const { googleEmail: _omitEmail, ...clean } = item.data;
          const uid = String(clean.googleUid || clean.id || '').replace(/^artist_/, '').trim();
          if (!uid) continue;
          const ts = Math.max(
            Date.parse(String(clean.updatedAt || '')) || 0,
            Date.parse(String(clean.acceptedTermsAt || '')) || 0
          );
          const isCanonicalKey = !item.key.startsWith('profiles/artist_');
          const prev = profileMap.get(uid);
          if (!prev || ts > prev.ts || (ts === prev.ts && isCanonicalKey && !prev.isCanonicalKey)) {
            profileMap.set(uid, {
              data: { ...clean, id: uid, googleUid: uid },
              ts,
              isCanonicalKey,
            });
          }
        }

        return jsonResponse({
          success: true,
          tracks: Array.from(trackMap.values()),
          profiles: Array.from(profileMap.values()).map((entry) => entry.data),
          albums: loadedAlbums.filter(Boolean),
        });
      } catch (err: any) {
        return jsonResponse(
          { success: false, tracks: [], profiles: [], albums: [], error: err?.message || 'Bootstrap failed' },
          500
        );
      }
    }

    // 15. Server-Side Google OAuth 2.0 + R2 Avatar Persistence
    const getGoogleCreds = resolveGoogleCredsTop;

    const toB64Url = (bytes: Uint8Array) =>
      uint8ToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

    const fromB64Url = (str: string) => {
      const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    };

    const signWorkerHmac = async (payloadObj: Record<string, any>, secret: string) => {
      const encoded = toB64Url(encoder.encode(JSON.stringify(payloadObj)));
      const sigBytes = await hmacSha256(secret, encoded);
      return `${encoded}.${toB64Url(sigBytes)}`;
    };

    const verifyWorkerHmac = async (token: string, secret: string): Promise<any | null> => {
      try {
        const parts = token.split('.');
        if (parts.length !== 2) return null;
        const [encoded, sig] = parts;
        const expected = toB64Url(await hmacSha256(secret, encoded));
        if (sig.length !== expected.length) return null;
        let diff = 0;
        for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
        if (diff !== 0) return null;
        const parsed = JSON.parse(new TextDecoder().decode(fromB64Url(encoded)));
        if (parsed?.exp && Date.now() > Number(parsed.exp)) return null;
        return parsed;
      } catch {
        return null;
      }
    };

    const extractWorkerSession = async (secret: string): Promise<{ session: any; token: string } | null> => {
      const authHdr = (request.headers.get('authorization') || '').trim();
      if (authHdr.toLowerCase().startsWith('bearer ')) {
        const bearerToken = authHdr.slice(7).trim();
        if (bearerToken) {
          const bearerSession = await verifyWorkerHmac(bearerToken, secret);
          if (bearerSession?.uid) return { session: bearerSession, token: bearerToken };
        }
      }
      const cookieHdr = request.headers.get('cookie') || '';
      for (const pair of cookieHdr.split(';')) {
        const idx = pair.indexOf('=');
        if (idx > 0 && pair.slice(0, idx).trim() === 'kolot_session') {
          let cookieToken = pair.slice(idx + 1).trim();
          try {
            cookieToken = decodeURIComponent(cookieToken);
          } catch {}
          if (cookieToken) {
            const cookieSession = await verifyWorkerHmac(cookieToken, secret);
            if (cookieSession?.uid) return { session: cookieSession, token: cookieToken };
          }
        }
      }
      return null;
    };

    const resolveSafeWorkerOrigin = (explicitOrigin?: string) => {
      const valid = (v?: string) =>
        !!v && (/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(v));
      const cleanExplicit = (explicitOrigin || '').trim().replace(/\/+$/, '');
      if (valid(cleanExplicit)) return cleanExplicit;
      const cleanAppUrl = (env.APP_URL || '').trim().replace(/\/+$/, '');
      if (valid(cleanAppUrl)) return cleanAppUrl;
      return url.origin;
    };

    const upgradeGooglePhotoWorker = (photoUrl?: string | null): string | undefined => {
      if (!photoUrl || typeof photoUrl !== 'string') return undefined;
      const trimmed = photoUrl.trim();
      if (!trimmed) return undefined;
      if (trimmed.includes('googleusercontent.com')) {
        if (/=s\d+(-c)?$/.test(trimmed)) return trimmed.replace(/=s\d+(-c)?$/, '=s400-c');
        if (/=w\d+-h\d+/.test(trimmed)) return trimmed.replace(/=w\d+-h\d+[^&]*/, '=s400-c');
      }
      return trimmed;
    };

    const purgeOldAvatarsWorker = async (uid: string, keepKey?: string) => {
      const cleanUid = uid.replace(/^artist_/, '').trim();
      for (const prefix of [`avatars/${cleanUid}`, `avatars/artist_${cleanUid}`]) {
        try {
          const existing = await r2ListKeys(prefix);
          await Promise.allSettled(existing.filter((k) => k && k !== keepKey).map((k) => r2DeleteKey(k)));
        } catch {}
      }
    };

    const importExternalAvatarWorker = async (uid: string, externalUrl: string): Promise<string | null> => {
      try {
        const cleanUid = uid.replace(/^artist_/, '').trim();
        const res = await fetch(externalUrl, {
          headers: { 'User-Agent': 'Kolot-Avatar-Sync/1.0', Accept: 'image/*' },
        });
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') || 'image/jpeg';
        if (!ct.startsWith('image/')) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > 6 * 1024 * 1024) return null;
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
        const newKey = `avatars/${cleanUid}_${Date.now()}.${ext}`;
        if (env.R2_BUCKET) {
          await env.R2_BUCKET.put(newKey, bytes, { httpMetadata: { contentType: ct } });
        } else {
          await signedR2Fetch(creds, 'PUT', `/${creds.bucket}/${encodeS3Path(newKey)}`, {}, bytes, { 'Content-Type': ct });
        }
        await purgeOldAvatarsWorker(cleanUid, newKey);
        return `/api/storage/raw/${newKey}`;
      } catch {
        return null;
      }
    };

    if (pathname === '/api/auth/google/start' && request.method === 'GET') {
      const { clientId, clientSecret, sessionSecret } = getGoogleCreds();
      if (!clientId || !clientSecret) {
        const missing = [!clientId ? 'Client_ID' : '', !clientSecret ? 'Client_secret' : ''].filter(Boolean).join(' + ');
        const envKeyList = Object.keys((env as Record<string, any>) || {}).join(', ') || 'none';
        const errMsg = `מזהה ההתחברות של Google (${missing}) אינו מוגדר בהגדרות השרת. (מפתחות פעילים: ${envKeyList})`;
        const html = `<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>Kolot Music Auth</title></head><body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px;"><div><p style="font-size:16px;font-weight:bold;color:#fda4af;">${errMsg}</p><script>try{if(window.opener){window.opener.postMessage({type:'OAUTH_AUTH_ERROR',error:${JSON.stringify(errMsg)}},'*');}}catch(e){}</script></div></body></html>`;
        return new Response(html, {
          status: 500,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }
      const appOrigin = resolveSafeWorkerOrigin(url.searchParams.get('origin') || '');
      const redirectUri = `${appOrigin}/auth/callback`;
      const nonceBytes = new Uint8Array(12);
      crypto.getRandomValues(nonceBytes);
      const state = await signWorkerHmac(
        {
          redirectUri,
          nonce: toB64Url(nonceBytes),
          exp: Date.now() + 10 * 60 * 1000,
        },
        sessionSecret
      );
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid profile email');
      authUrl.searchParams.set('prompt', 'select_account');
      authUrl.searchParams.set('access_type', 'online');
      authUrl.searchParams.set('state', state);
      return Response.redirect(authUrl.toString(), 302);
    }

    if (pathname === '/api/auth/google/url' && request.method === 'GET') {
      const { clientId, clientSecret, sessionSecret } = getGoogleCreds();
      if (!clientId || !clientSecret) {
        const missing = [!clientId ? 'Client_ID' : '', !clientSecret ? 'Client_secret' : ''].filter(Boolean).join(' + ');
        const envKeys = Object.keys((env as Record<string, any>) || {});
        return jsonResponse(
          {
            success: false,
            error: `מזהה ההתחברות של Google (${missing}) אינו מוגדר בהגדרות השרת.`,
            envKeys,
          },
          500
        );
      }
      const appOrigin = resolveSafeWorkerOrigin(url.searchParams.get('origin') || '');
      const redirectUri = `${appOrigin}/auth/callback`;
      const nonceBytes = new Uint8Array(12);
      crypto.getRandomValues(nonceBytes);
      const state = await signWorkerHmac(
        {
          redirectUri,
          nonce: toB64Url(nonceBytes),
          exp: Date.now() + 10 * 60 * 1000,
        },
        sessionSecret
      );
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', 'openid profile email');
      authUrl.searchParams.set('prompt', 'select_account');
      authUrl.searchParams.set('access_type', 'online');
      authUrl.searchParams.set('state', state);
      return jsonResponse({ success: true, url: authUrl.toString(), redirectUri });
    }

    if ((pathname === '/auth/callback' || pathname === '/auth/callback/') && request.method === 'GET') {
      const renderPopupResult = (ok: boolean, payload: any, errMsg?: string, extraHeaders: Record<string, string> = {}) => {
        const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
        const safeErr = JSON.stringify(errMsg || '').replace(/</g, '\\u003c');
        const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><title>Kolot Music Auth</title></head>
<body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;">
  <div>
    <p style="font-size:16px;font-weight:bold;">${ok ? 'ההתחברות עם Google הצליחה — החלון נסגר...' : 'ההתחברות בוטלה או נכשלה'}</p>
    ${errMsg ? `<p style="font-size:13px;color:#fda4af;">${errMsg}</p>` : ''}
  </div>
  <script>
    (function() {
      try {
        if (window.opener) {
          window.opener.postMessage(${ok ? safeJson : `{ type: 'OAUTH_AUTH_ERROR', error: ${safeErr} }`}, '*');
        }
      } catch (e) {}
      setTimeout(function() { window.close(); }, ${ok ? 250 : 1800});
    })();
  </script>
</body>
</html>`;
        return new Response(html, {
          status: ok ? 200 : 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders },
        });
      };

      try {
        const code = url.searchParams.get('code') || '';
        const stateRaw = url.searchParams.get('state') || '';
        const oauthErr = url.searchParams.get('error') || '';
        if (oauthErr) return renderPopupResult(false, {}, `Google החזיר שגיאה: ${oauthErr}`);
        if (!code || !stateRaw) return renderPopupResult(false, {}, 'חסרים פרטי אימות מהתחברות Google.');

        const { clientId, clientSecret, sessionSecret } = getGoogleCreds();
        if (!clientId || !clientSecret) {
          return renderPopupResult(false, {}, 'הגדרות השרת (Client_ID / Client_secret) חסרות.');
        }

        const verifiedState = await verifyWorkerHmac(stateRaw, sessionSecret);
        const redirectUri = verifiedState?.redirectUri || `${url.origin}/auth/callback`;

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        const tokenData: any = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData.access_token) {
          return renderPopupResult(
            false,
            {},
            tokenData?.error_description || tokenData?.error || 'שגיאה באימות הקוד מול Google'
          );
        }

        const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const googleUser: any = await userRes.json().catch(() => ({}));
        if (!userRes.ok || !googleUser?.sub) {
          return renderPopupResult(false, {}, 'לא ניתן היה לקרוא את פרטי החשבון מ-Google.');
        }

        const uid = String(googleUser.sub).replace(/[^a-zA-Z0-9_\-]/g, '');
        const displayName = String(googleUser.name || 'אמן').trim();
        const verifiedEmail = googleUser.email_verified ? String(googleUser.email || '').trim().toLowerCase() : '';
        const googlePhotoUrl = upgradeGooglePhotoWorker(googleUser.picture);

        let canonicalAvatarUrl = googlePhotoUrl;
        try {
          let existingProfile =
            (await r2ReadJson(`profiles/${uid}.json`)) || (await r2ReadJson(`profiles/artist_${uid}.json`));

          // Verified Legacy Account Migration (Firebase UID -> Google OAuth sub UID)
          // Scoped strictly to Google-verified email ownership (and specifically 'דניאל ברבר' for danielbarber1246@gmail.com)
          if (verifiedEmail) {
            const isDanielOwner = verifiedEmail === 'danielbarber1246@gmail.com';
            const legacyUids = new Set<string>();
            const allProfileKeys = (await r2ListKeys('profiles/').catch(() => [])).filter((k) => k.endsWith('.json'));
            const keysToDelete: string[] = [];

            for (const pKey of allProfileKeys) {
              if (pKey === `profiles/${uid}.json` || pKey === `profiles/artist_${uid}.json`) continue;
              const pData = await r2ReadJson(pKey);
              if (!pData || typeof pData !== 'object') continue;
              const pEmail = String(pData.googleEmail || pData.email || '').trim().toLowerCase();
              const pName = String(pData.name || '').trim();
              const pUid = String(pData.googleUid || pData.id || '')
                .replace(/^artist_/, '')
                .trim();
              const matchesEmail = !!pEmail && pEmail === verifiedEmail;
              const matchesDaniel = isDanielOwner && pName === 'דניאל ברבר';
              if (matchesEmail || matchesDaniel) {
                if (pUid && pUid !== uid) legacyUids.add(pUid);
                const keyUid = pKey.replace(/^profiles\/(?:artist_)?/, '').replace(/\.json$/, '').trim();
                if (keyUid && keyUid !== uid) legacyUids.add(keyUid);
                existingProfile = existingProfile
                  ? { ...pData, ...existingProfile, name: existingProfile.name || pData.name, bio: existingProfile.bio || pData.bio, avatarUrl: existingProfile.avatarUrl || pData.avatarUrl, genre: existingProfile.genre || pData.genre }
                  : pData;
                keysToDelete.push(pKey);
              }
            }

            // Migrate tracks/*.json & tracks_index.json belonging to legacy UID(s) or verified owner
            const shouldClaimTrack = (t: any) => {
              if (!t || typeof t !== 'object') return false;
              const tUid = String(t.uploadedByUid || '').replace(/^artist_/, '').trim();
              if (tUid === uid) return false;
              const tEmail = String(t.uploadedByEmail || '').trim().toLowerCase();
              const tArtist = String(t.artistName || '').trim();
              return (
                (!!tUid && legacyUids.has(tUid)) ||
                (!!tEmail && tEmail === verifiedEmail) ||
                (isDanielOwner && tArtist === 'דניאל ברבר')
              );
            };

            const trackKeys = (await r2ListKeys('tracks/').catch(() => [])).filter((k) => k.endsWith('.json'));
            for (const tKey of trackKeys) {
              const tData = await r2ReadJson(tKey);
              if (shouldClaimTrack(tData)) {
                const { uploadedByEmail: _omitEmail, ...cleanTrack } = tData;
                await r2WriteJson(tKey, {
                  ...cleanTrack,
                  uploadedByUid: uid,
                  artistId: uid,
                });
              }
            }

            const idxData = await r2ReadJson('tracks_index.json');
            if (Array.isArray(idxData)) {
              let idxChanged = false;
              const updatedIdx = idxData.map((t: any) => {
                if (shouldClaimTrack(t)) {
                  idxChanged = true;
                  const { uploadedByEmail: _omitEmail, ...cleanTrack } = t;
                  return { ...cleanTrack, uploadedByUid: uid, artistId: uid };
                }
                return t;
              });
              if (idxChanged) {
                await r2WriteJson('tracks_index.json', updatedIdx);
              }
            }

            // Migrate albums/*.json
            const albumKeys = (await r2ListKeys('albums/').catch(() => [])).filter((k) => k.endsWith('.json'));
            for (const aKey of albumKeys) {
              const aData = await r2ReadJson(aKey);
              if (!aData || typeof aData !== 'object') continue;
              const aUid = String(aData.uploadedByUid || aData.artistId || '').replace(/^artist_/, '').trim();
              const aArtist = String(aData.artistName || '').trim();
              if ((aUid && legacyUids.has(aUid)) || (isDanielOwner && aArtist === 'דניאל ברבר')) {
                await r2WriteJson(aKey, {
                  ...aData,
                  artistId: uid,
                  uploadedByUid: uid,
                });
              }
            }

            for (const oldKey of keysToDelete) {
              void r2DeleteKey(oldKey).catch(() => {});
            }
          }

          const existingAvatar = String(existingProfile?.avatarUrl || '').trim();
          const hasR2StoredAvatar =
            !!existingAvatar &&
            !existingAvatar.includes('googleusercontent.com') &&
            (existingAvatar.includes('/avatars/') || existingAvatar.includes('/api/storage/raw/'));

          if (hasR2StoredAvatar) {
            canonicalAvatarUrl = existingAvatar;
          } else if (googlePhotoUrl) {
            const importedUrl = await importExternalAvatarWorker(uid, googlePhotoUrl);
            if (importedUrl) canonicalAvatarUrl = importedUrl;
          }

          if (existingProfile || canonicalAvatarUrl) {
            const { googleEmail: _omitEmail, ...cleanExisting } = existingProfile || {};
            const nextProfile = {
              ...cleanExisting,
              id: uid,
              googleUid: uid,
              name: cleanExisting.name || displayName,
              avatarUrl: canonicalAvatarUrl || '',
              isConnected: true,
              isPrivate: cleanExisting.isPrivate ?? false,
              tracksCount: cleanExisting.tracksCount ?? 0,
              joinedDate: cleanExisting.joinedDate || new Date().getFullYear().toString(),
              providerPlatform: 'חשבון גוגל',
              updatedAt: new Date().toISOString(),
            };
            await r2WriteJson(`profiles/${uid}.json`, nextProfile);
            void r2DeleteKey(`profiles/artist_${uid}.json`).catch(() => {});
          }
        } catch {}

        const isAdmin = verifiedEmail === 'danielbarber1246@gmail.com';
        const sessionPayload = {
          uid,
          email: verifiedEmail || undefined,
          displayName,
          photoURL: canonicalAvatarUrl || googlePhotoUrl || undefined,
          googlePhotoUrl: googlePhotoUrl || undefined,
          isAdmin,
          exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
        };
        const sessionToken = await signWorkerHmac(sessionPayload, sessionSecret);
        const isHttps = redirectUri.startsWith('https://');
        return renderPopupResult(
          true,
          {
            type: 'OAUTH_AUTH_SUCCESS',
            sessionToken,
            user: {
              uid,
              email: sessionPayload.email,
              displayName,
              photoURL: sessionPayload.photoURL,
              googlePhotoUrl: sessionPayload.googlePhotoUrl,
              isAdmin,
            },
          },
          undefined,
          {
            'Set-Cookie': `kolot_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Max-Age=2592000; ${
              isHttps ? 'Secure; SameSite=None' : 'SameSite=Lax'
            }`,
          }
        );
      } catch (err: any) {
        return renderPopupResult(false, {}, err?.message || 'שגיאה בתהליך ההתחברות');
      }
    }

    if (pathname === '/api/auth/me' && request.method === 'GET') {
      const { sessionSecret } = getGoogleCreds();
      const parsed = await extractWorkerSession(sessionSecret);
      if (!parsed) return jsonResponse({ success: true, user: null });

      const { session } = parsed;
      let liveAvatar = session.photoURL;
      let liveName = session.displayName;
      try {
        const p = await r2ReadJson(`profiles/${session.uid}.json`);
        if (p?.avatarUrl) liveAvatar = p.avatarUrl;
        if (p?.name) liveName = p.name;
      } catch {}

      return jsonResponse({
        success: true,
        sessionToken: parsed.token,
        user: {
          uid: session.uid,
          email: session.email || undefined,
          displayName: liveName || session.displayName,
          photoURL: liveAvatar || session.googlePhotoUrl || undefined,
          googlePhotoUrl: session.googlePhotoUrl || undefined,
          isAdmin: !!session.isAdmin,
        },
      });
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      const isHttps = url.protocol === 'https:';
      return jsonResponse(
        { success: true },
        200,
        {
          'Set-Cookie': `kolot_session=; Path=/; HttpOnly; Max-Age=0; ${isHttps ? 'Secure; SameSite=None' : 'SameSite=Lax'}`,
        }
      );
    }

    if (pathname === '/api/auth/restore-google-avatar' && request.method === 'POST') {
      try {
        const { sessionSecret } = getGoogleCreds();
        const parsed = await extractWorkerSession(sessionSecret);
        if (!parsed) {
          return jsonResponse({ success: false, error: 'נדרש חיבור מחדש לחשבון Google.' }, 401);
        }
        const { session } = parsed;
        const body: any = await request.json().catch(() => ({}));
        const googlePhotoUrl = upgradeGooglePhotoWorker(session.googlePhotoUrl);
        if (!googlePhotoUrl) {
          return jsonResponse({ success: false, error: 'לא נמצאה תמונת פרופיל בחשבון Google שלך.' }, 404);
        }
        const r2AvatarUrl = await importExternalAvatarWorker(session.uid, googlePhotoUrl);
        if (!r2AvatarUrl) {
          return jsonResponse({ success: false, error: 'הורדת תמונת Google אל האחסון נכשלה.' }, 502);
        }
        const existingProfile = (await r2ReadJson(`profiles/${session.uid}.json`)) || {};
        const { googleEmail: _omitEmail, ...cleanExisting } = existingProfile;
        const updatedProfile = {
          ...cleanExisting,
          id: session.uid,
          googleUid: session.uid,
          name: String(body?.name || '').trim() || cleanExisting.name || session.displayName || 'אמן',
          avatarUrl: r2AvatarUrl,
          isConnected: true,
          hasAcceptedTerms: cleanExisting.hasAcceptedTerms ?? true,
          isPrivate: false,
          updatedAt: new Date().toISOString(),
        };
        await r2WriteJson(`profiles/${session.uid}.json`, updatedProfile);
        void r2DeleteKey(`profiles/artist_${session.uid}.json`).catch(() => {});
        return jsonResponse({ success: true, avatarUrl: r2AvatarUrl, profile: updatedProfile });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'שגיאה בשחזור תמונת Google' }, 500);
      }
    }

    // 16. Admin-Only Account Deletion (strictly removes account profile & avatars; does NOT delete songs)
    if (pathname === '/api/admin/delete-account' && request.method === 'POST') {
      try {
        const { sessionSecret } = getGoogleCreds();
        const parsed = await extractWorkerSession(sessionSecret);
        if (!parsed?.session?.isAdmin) {
          return jsonResponse({ success: false, error: 'גישה מותרת למנהל המערכת בלבד.' }, 403);
        }
        const body: any = await request.json().catch(() => ({}));
        const cleanUid = String(body?.uid || '').replace(/^artist_/, '').replace(/[^a-zA-Z0-9_\-]/g, '').trim();
        if (!cleanUid) {
          return jsonResponse({ success: false, error: 'חסר מזהה חשבון למחיקה.' }, 400);
        }
        await Promise.allSettled([
          r2DeleteKey(`profiles/${cleanUid}.json`),
          r2DeleteKey(`profiles/artist_${cleanUid}.json`),
          purgeOldAvatarsWorker(cleanUid),
        ]);
        return jsonResponse({ success: true, uid: cleanUid });
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'מחיקת החשבון נכשלה' }, 500);
      }
    }

    // 17. Self-Service Account Deletion for logged-in user
    if (pathname === '/api/account/delete' && request.method === 'POST') {
      try {
        const { sessionSecret } = getGoogleCreds();
        const parsed = await extractWorkerSession(sessionSecret);
        if (!parsed?.session?.uid) {
          return jsonResponse({ success: false, error: 'יש להתחבר לחשבון כדי למחוק אותו.' }, 401);
        }
        const cleanUid = String(parsed.session.uid).replace(/^artist_/, '').replace(/[^a-zA-Z0-9_\-]/g, '').trim();
        if (!cleanUid) {
          return jsonResponse({ success: false, error: 'מזהה חשבון אינו תקין.' }, 400);
        }
        await Promise.allSettled([
          r2DeleteKey(`profiles/${cleanUid}.json`),
          r2DeleteKey(`profiles/artist_${cleanUid}.json`),
          purgeOldAvatarsWorker(cleanUid),
        ]);
        const isHttps = url.protocol === 'https:';
        return jsonResponse(
          { success: true, uid: cleanUid },
          200,
          {
            'Set-Cookie': `kolot_session=; Path=/; HttpOnly; Max-Age=0; ${isHttps ? 'Secure; SameSite=None' : 'SameSite=Lax'}`,
          }
        );
      } catch (err: any) {
        return jsonResponse({ success: false, error: err?.message || 'מחיקת החשבון נכשלה' }, 500);
      }
    }

    // Fallback to static Vite assets & SPA index.html (NEVER return cached index.html or HTML for missing JS/CSS assets)
    if (env.ASSETS) {
      const isDocumentRequest = pathname === '/' || pathname === '/index.html';
      const isStaticAssetPath =
        pathname.startsWith('/assets/') ||
        /\.(?:js|mjs|css|wasm|map|json|svg|png|jpg|jpeg|webp|ico|woff2?)$/i.test(pathname);

      if (isDocumentRequest) {
        const docRes = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
        const headers = new Headers(docRes.headers);
        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        headers.set('Pragma', 'no-cache');
        return new Response(docRes.body, { status: docRes.status, headers });
      }

      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status === 404) {
        if (pathname.startsWith('/api/') || isStaticAssetPath) {
          return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
        }
        const spaRes = await env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
        const headers = new Headers(spaRes.headers);
        headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return new Response(spaRes.body, { status: spaRes.status, headers });
      }

      if (pathname.startsWith('/assets/')) {
        const headers = new Headers(assetRes.headers);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        return new Response(assetRes.body, { status: assetRes.status, headers });
      }

      return assetRes;
    }

    return new Response('Not Found', { status: 404 });
  },
};
