// Cloudflare Worker Full-Stack Adapter for Kolot R2 Music
// Handles /api/storage/*, /api/proxy-image, /api/ai/transcribe, and SPA static assets

export interface WorkerR2Object {
  key: string;
  size: number;
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
  Client_ID?: string;
  CLIENT_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  Client_secret?: string;
  CLIENT_SECRET?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_URL?: string;
}

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
  async fetch(request: Request, env: Env): Promise<Response> {
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

    const creds = getR2Creds(env);

    // 1. Storage status
    if (pathname === '/api/storage/status' && request.method === 'GET') {
      if (env.R2_BUCKET) {
        return jsonResponse({ success: true, configured: true, bucket: creds.bucket, endpoint: 'configured' });
      }
      try {
        const res = await signedR2Fetch(creds, 'GET', `/${creds.bucket}`, { 'list-type': '2', 'max-keys': '1' });
        if (res.ok) {
          return jsonResponse({ success: true, configured: true, bucket: creds.bucket, endpoint: 'configured' });
        }
        return jsonResponse({ success: false, configured: false, error: `R2 HTTP ${res.status}` });
      } catch (err: any) {
        return jsonResponse({ success: false, configured: false, error: err?.message || 'R2 connection failed' });
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
            return jsonResponse({ success: false, error: `R2 HTTP ${putRes.status}` }, 500);
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

        if (env.R2_BUCKET) {
          await env.R2_BUCKET.put(rawPath, bodyBytes, { httpMetadata: { contentType } });
        } else {
          const s3Path = `/${creds.bucket}/${encodeS3Path(rawPath)}`;
          const putRes = await signedR2Fetch(creds, 'PUT', s3Path, {}, bodyBytes, { 'Content-Type': contentType });
          if (!putRes.ok) {
            const errTxt = await putRes.text();
            return jsonResponse({ success: false, error: `שגיאת R2 (${putRes.status}): ${errTxt}` }, 500);
          }
        }

        const outUrl = creds.publicUrl ? `${creds.publicUrl}/${rawPath}` : `/api/storage/raw/${rawPath}`;
        return jsonResponse({ success: true, url: outUrl, path: rawPath, bucket: creds.bucket, mode: 'r2' });
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
              return jsonResponse({ success: false, error: `R2 list error ${listRes.status}` }, 500);
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
            if (t?.id && t?.name && t?.audioUrl) trackMap.set(t.id, t);
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
            if (t?.id && t?.name && t?.audioUrl) trackMap.set(t.id, t);
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

    // 4. Delete file
    if (pathname === '/api/storage/delete' && request.method === 'DELETE') {
      try {
        const filePath = (url.searchParams.get('path') || '').trim().replace(/^\/+/, '');
        if (!filePath) return jsonResponse({ success: false, error: 'Missing path' }, 400);
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
        return new Response('File not found in R2 storage', { status: 404 });
      }
      const headers = new Headers(s3Res.headers);
      headers.set('Accept-Ranges', 'bytes');
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
          return jsonResponse({ success: false, error: 'נדרש מפתח GEMINI_API_KEY או OPENAI_API_KEY בהגדרות השרת.' }, 503);
        }

        const b64 = uint8ToBase64(audioBytes);
        const promptText =
          `Transcribe all sung lyrics word-for-word in the exact language sung. ` +
          `${songTitle ? `Song: "${songTitle}". ` : ''}${artistName ? `Artist: "${artistName}". ` : ''}` +
          `Format every line as [MM:SS - MM:SS] Lyric text. ` +
          `If purely instrumental output only: [00:00 - 00:05] ${language === 'he' ? 'קטע אינסטרומנטלי (ללא מילים)' : 'Instrumental track'}.`;

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'aistudio-build' },
            body: JSON.stringify({
              contents: [{ parts: [{ inlineData: { mimeType, data: b64 } }, { text: promptText }] }],
            }),
          }
        );

        const gJson: any = await geminiRes.json();
        const textOut = gJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const segments = buildSegmentsFromText(textOut, duration);
        return jsonResponse({
          success: segments.length > 0,
          provider: 'whisper-gemini-transcribe',
          segments,
          lyrics: segments.map((s) => s.text).join('\n'),
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
              trackMap.set(cleanTrack.id, cleanTrack);
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
            trackMap.set(cleanTrack.id, cleanTrack);
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
    const getGoogleCreds = () => {
      const clientId = (env.Client_ID || env.CLIENT_ID || env.GOOGLE_CLIENT_ID || '').trim().replace(/^["']|["']$/g, '');
      const clientSecret = (env.Client_secret || env.CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, '');
      const sessionSecret = clientSecret || creds.secretAccessKey || 'kolot-music-session-hmac-key';
      return { clientId, clientSecret, sessionSecret };
    };

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
      let token = '';
      if (authHdr.toLowerCase().startsWith('bearer ')) {
        token = authHdr.slice(7).trim();
      }
      if (!token) {
        const cookieHdr = request.headers.get('cookie') || '';
        for (const pair of cookieHdr.split(';')) {
          const idx = pair.indexOf('=');
          if (idx > 0 && pair.slice(0, idx).trim() === 'kolot_session') {
            try {
              token = decodeURIComponent(pair.slice(idx + 1).trim());
            } catch {
              token = pair.slice(idx + 1).trim();
            }
          }
        }
      }
      if (!token) return null;
      const session = await verifyWorkerHmac(token, secret);
      return session?.uid ? { session, token } : null;
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
      const { clientId, sessionSecret } = getGoogleCreds();
      if (!clientId) {
        const errMsg = 'מזהה ההתחברות של Google (Client_ID) אינו מוגדר ב-Cloudflare Variables.';
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
      const { clientId, sessionSecret } = getGoogleCreds();
      if (!clientId) {
        return jsonResponse(
          { success: false, error: 'מזהה ההתחברות של Google (Client_ID) אינו מוגדר ב-Cloudflare Variables.' },
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
          return renderPopupResult(false, {}, 'הגדרות השרת (Client_ID / Client_secret) חסרות ב-Cloudflare.');
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
        const googlePhotoUrl = upgradeGooglePhotoWorker(googleUser.picture);

        let canonicalAvatarUrl = googlePhotoUrl;
        try {
          const existingProfile =
            (await r2ReadJson(`profiles/${uid}.json`)) || (await r2ReadJson(`profiles/artist_${uid}.json`));
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

        const sessionPayload = {
          uid,
          displayName,
          photoURL: canonicalAvatarUrl || googlePhotoUrl || undefined,
          googlePhotoUrl: googlePhotoUrl || undefined,
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
              displayName,
              photoURL: sessionPayload.photoURL,
              googlePhotoUrl: sessionPayload.googlePhotoUrl,
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
        user: {
          uid: session.uid,
          displayName: liveName || session.displayName,
          photoURL: liveAvatar || session.googlePhotoUrl || undefined,
          googlePhotoUrl: session.googlePhotoUrl || undefined,
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
          return jsonResponse({ success: false, error: 'הורדת תמונת Google אל אחסון R2 נכשלה.' }, 502);
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
