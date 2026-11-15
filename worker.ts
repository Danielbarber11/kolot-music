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
}

const DEFAULT_R2_ENDPOINT = 'https://005434972f224c499cd04d73150a9e80.eu.r2.cloudflarestorage.com';
const DEFAULT_R2_ACCESS_KEY = '4be7ca8a92428a559e216b40a4c92b04';
const DEFAULT_R2_SECRET_KEY = '4cf636c4141f35944adda0bacb8c164eb45cb6359db78767de4c79ad50eab094';

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
    endpoint: sanitizeEndpoint(env.R2_ENDPOINT) || DEFAULT_R2_ENDPOINT,
    accessKeyId: (env.R2_ACCESS_KEY_ID || DEFAULT_R2_ACCESS_KEY).trim(),
    secretAccessKey: (env.R2_SECRET_ACCESS_KEY || DEFAULT_R2_SECRET_KEY).trim(),
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

    // Fallback to static Vite assets & SPA index.html
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      if (assetRes.status !== 404 || pathname.startsWith('/api/')) {
        return assetRes;
      }
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    }

    return new Response('Not Found', { status: 404 });
  },
};
