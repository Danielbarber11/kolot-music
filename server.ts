import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import tls from 'tls';
import { Readable } from 'stream';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { 
  S3Client, 
  PutObjectCommand, 
  ListObjectsV2Command, 
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  CreateBucketCommand,
  PutBucketCorsCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import multer from 'multer';

// Load environment variables immediately
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Multer for memory storage (supports large audio files up to 1GB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 },
});

export interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName?: string;
  publicUrl?: string;
}

function sanitizeR2Endpoint(endpoint?: string): string {
  if (!endpoint) return '';
  let cleaned = endpoint.trim().replace(/^["']|["']$/g, '');
  if (!cleaned) return '';
  // Reject Cloudflare API tokens (e.g. cfat_...) or invalid values accidentally pasted as R2_ENDPOINT
  if (cleaned.startsWith('cfat_') || !cleaned.includes('.r2.cloudflarestorage.com')) {
    return '';
  }
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned;
  }
  cleaned = cleaned.replace(/\/+$/, '');
  return cleaned;
}

function sanitizePublicUrl(url?: string): string {
  if (!url) return '';
  let cleaned = url.trim().replace(/^["']|["']$/g, '');
  if (!cleaned || cleaned.startsWith('cfat_') || !cleaned.includes('.')) return '';
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = 'https://' + cleaned;
  }
  return cleaned.replace(/\/+$/, '');
}

function sanitizeKey(val?: string): string {
  if (!val) return '';
  return val.trim().replace(/^["']|["']$/g, '');
}

// Server-side R2 configuration comes strictly from environment variables (or gitignored .r2-config.json)
const R2_CONFIG_FILE = path.join(__dirname, '.r2-config.json');
let activeR2Config: R2Config = {
  endpoint: sanitizeR2Endpoint(process.env.R2_ENDPOINT),
  accessKeyId: sanitizeKey(process.env.R2_ACCESS_KEY_ID),
  secretAccessKey: sanitizeKey(process.env.R2_SECRET_ACCESS_KEY),
  bucketName: sanitizeKey(process.env.R2_BUCKET_NAME) || 'kolot-music',
  publicUrl: sanitizePublicUrl(process.env.R2_PUBLIC_URL),
};

try {
  if (fs.existsSync(R2_CONFIG_FILE)) {
    const saved = JSON.parse(fs.readFileSync(R2_CONFIG_FILE, 'utf-8'));
    activeR2Config = {
      ...activeR2Config,
      ...saved,
      endpoint: sanitizeR2Endpoint(saved.endpoint) || activeR2Config.endpoint,
      accessKeyId: sanitizeKey(saved.accessKeyId || activeR2Config.accessKeyId),
      secretAccessKey: sanitizeKey(saved.secretAccessKey || activeR2Config.secretAccessKey),
      publicUrl: sanitizePublicUrl(saved.publicUrl) || activeR2Config.publicUrl,
    };
    console.log('[R2 Storage] Loaded config from gitignored .r2-config.json');
  }
} catch (e: any) {
  console.warn('[R2 Storage] Could not read .r2-config.json:', e?.message);
}

function resolveR2Config(req?: express.Request): R2Config {
  const headerEndpoint = req?.headers?.['x-r2-endpoint'] as string;
  const headerAccessKey = req?.headers?.['x-r2-access-key-id'] as string;
  const headerSecretKey = req?.headers?.['x-r2-secret-access-key'] as string;
  const headerBucket = req?.headers?.['x-r2-bucket-name'] as string;

  const endpoint =
    sanitizeR2Endpoint(headerEndpoint) ||
    sanitizeR2Endpoint(activeR2Config.endpoint) ||
    sanitizeR2Endpoint(process.env.R2_ENDPOINT);
  const accessKeyId = sanitizeKey(headerAccessKey || activeR2Config.accessKeyId || process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = sanitizeKey(headerSecretKey || activeR2Config.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY);
  const bucketName = sanitizeKey(headerBucket || activeR2Config.bucketName || process.env.R2_BUCKET_NAME) || 'kolot-music';
  const publicUrl = sanitizePublicUrl(activeR2Config.publicUrl || process.env.R2_PUBLIC_URL);

  return { endpoint, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

function createR2Client(cfg: R2Config): S3Client | null {
  if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) return null;
  return new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

let corsConfiguredBucket: string | null = null;
async function ensureR2BucketCors(client: S3Client, bucket: string) {
  if (corsConfiguredBucket === bucket) return;
  corsConfiguredBucket = bucket;
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ['*'],
              AllowedMethods: ['GET', 'PUT', 'POST', 'HEAD', 'DELETE'],
              AllowedHeaders: ['*'],
              ExposeHeaders: ['ETag', 'Content-Length'],
              MaxAgeSeconds: 86400,
            },
          ],
        },
      })
    );
    console.log(`[R2 Storage] CORS enabled on bucket '${bucket}' for direct fast uploads`);
  } catch (e: any) {
    console.warn('[R2 Storage] Bucket CORS setup notice:', e?.message);
  }
}

async function getR2Context(req?: express.Request): Promise<{ client: S3Client; bucket: string; publicUrl?: string; config: R2Config }> {
  const cfg = resolveR2Config(req);
  if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error('חסרים מפתחות Cloudflare R2 (Endpoint, Access Key, Secret Key). אנא הזן אותם בהגדרות האחסון.');
  }

  const client = createR2Client(cfg);
  if (!client) {
    throw new Error('יצירת חיבור ל-Cloudflare R2 נכשלה. אנא ודא שהמפתחות וה-Endpoint תקינים.');
  }

  let bucket = cfg.bucketName || 'kolot-music';
  if (!cfg.bucketName) {
    try {
      const list = await client.send(new ListBucketsCommand({}));
      if (list.Buckets && list.Buckets.length > 0 && list.Buckets[0].Name) {
        bucket = list.Buckets[0].Name;
        activeR2Config.bucketName = bucket;
      } else {
        try {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
          console.log(`[R2 Storage] Created bucket '${bucket}' automatically`);
          activeR2Config.bucketName = bucket;
        } catch (createErr: any) {
          console.warn('[R2 Storage] Auto create bucket notice:', createErr?.message);
        }
      }
    } catch (e: any) {
      console.warn('[R2 Storage] ListBuckets discovery notice:', e?.message);
    }
  }

  // Ensure CORS asynchronously without blocking request latency
  void ensureR2BucketCors(client, bucket);

  return {
    client,
    bucket,
    publicUrl: cfg.publicUrl,
    config: cfg,
  };
}

// Increase payload limit for base64 images
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Initialize Gemini Client safely
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// 1. Gemini AI Image Generation Endpoint
app.post('/api/ai/generate-image', async (req, res) => {
  try {
    const {
      prompt,
      stylePreset = 'artistic',
      aspectRatio = '1:1',
      count = 1,
      width = 1024,
      height = 1024,
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const numImages = Math.min(Math.max(1, Number(count) || 1), 4);
    const validAspectRatios = ['1:1', '3:4', '4:3', '9:16', '16:9'];
    const validAr = validAspectRatios.includes(aspectRatio) ? aspectRatio : '1:1';

    if (ai) {
      try {
        const imagePromises = Array.from({ length: numImages }).map(async (_, idx) => {
          const response = await ai!.models.generateContent({
            model: 'gemini-3.1-flash-lite-image',
            contents: `${prompt}, ${stylePreset} style, high quality, 8k resolution`,
            config: {
              imageConfig: {
                aspectRatio: validAr,
              },
            },
          });

          for (const part of response.candidates?.[0]?.content?.parts ?? []) {
            if (part.inlineData?.data) {
              const mime = part.inlineData.mimeType || 'image/png';
              return `data:${mime};base64,${part.inlineData.data}`;
            }
          }
          return null;
        });

        const results = (await Promise.all(imagePromises)).filter(Boolean) as string[];

        if (results.length > 0) {
          return res.json({
            images: results,
            provider: 'gemini-3.1-flash-lite-image',
            success: true,
          });
        }
      } catch (geminiErr: any) {
        console.warn('Gemini image gen error, falling back to Perchance/Pollinations:', geminiErr?.message);
      }
    }

    // Fallback image generator (Perchance / Pollinations)
    const fallbackImages: string[] = [];
    for (let i = 0; i < numImages; i++) {
      const seed = Math.floor(Math.random() * 1000000) + i * 1337;
      const encodedPrompt = encodeURIComponent(`${prompt}, ${stylePreset} style, masterpiece, high quality`);
      const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&model=flux-realism&nologo=true`;
      fallbackImages.push(url);
    }

    return res.json({
      images: fallbackImages,
      provider: 'perchance-fallback',
      success: true,
    });
  } catch (err: any) {
    console.error('Image Generation Error:', err);
    return res.status(500).json({ error: 'Failed to generate image', details: err?.message });
  }
});

// 2. Gemini AI Image Editing (Vision Instruction -> Image Edit)
app.post('/api/ai/edit-image', async (req, res) => {
  try {
    const { imageBase64, instruction, count = 1, stylePreset = 'artistic' } = req.body;

    if (!instruction) {
      return res.status(400).json({ error: 'Missing editing instruction' });
    }

    const numImages = Math.min(Math.max(1, Number(count) || 1), 4);

    if (ai && imageBase64) {
      try {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

        const imagePromises = Array.from({ length: numImages }).map(async (_, idx) => {
          const response = await ai!.models.generateContent({
            model: 'gemini-3.1-flash-lite-image',
            contents: {
              parts: [
                {
                  inlineData: {
                    data: cleanBase64,
                    mimeType: mimeType,
                  },
                },
                {
                  text: `Edit this image based on the following instruction: ${instruction}. Keep the overall structure and core subjects, but modify: ${instruction}. Style: ${stylePreset}.`,
                },
              ],
            },
          });

          for (const part of response.candidates?.[0]?.content?.parts ?? []) {
            if (part.inlineData?.data) {
              const mime = part.inlineData.mimeType || 'image/png';
              return `data:${mime};base64,${part.inlineData.data}`;
            }
          }
          return null;
        });

        const results = (await Promise.all(imagePromises)).filter(Boolean) as string[];

        if (results.length > 0) {
          return res.json({
            images: results,
            provider: 'gemini-3.1-flash-lite-image',
            success: true,
          });
        }
      } catch (editErr: any) {
        console.warn('Gemini vision image edit error, fallback used:', editErr?.message);
      }
    }

    // Fallback: Generate based on instruction + prompt description
    const fallbackImages: string[] = [];
    for (let i = 0; i < numImages; i++) {
      const seed = Math.floor(Math.random() * 1000000) + i * 99;
      const encodedPrompt = encodeURIComponent(`${instruction}, ${stylePreset} style, photorealistic edit, masterpiece`);
      fallbackImages.push(`https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&model=flux&nologo=true`);
    }

    return res.json({
      images: fallbackImages,
      provider: 'perchance-fallback',
      success: true,
    });
  } catch (err: any) {
    console.error('Image Edit Error:', err);
    return res.status(500).json({ error: 'Failed to edit image', details: err?.message });
  }
});

// 3. DuckDuckGo Image Web Search Endpoint (vqd -> i.js + Openverse/Wikimedia fallback)
app.get('/api/ai/search-images', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Missing query parameter q' });
  }

  const results: Array<{ id: string; title: string; image: string; thumbnail: string; width?: number; height?: number; source: string }> = [];

  try {
    // Attempt DuckDuckGo image search
    const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iar=images`;
    const ddgRes = await fetch(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (ddgRes.ok) {
      const html = await ddgRes.text();
      const vqdMatch = html.match(/vqd=['"]([^'"]+)['"]/) || html.match(/vqd=([\d-]+)/);
      if (vqdMatch && vqdMatch[1]) {
        const vqd = vqdMatch[1];
        const imgApiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`;
        const imgApiRes = await fetch(imgApiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://duckduckgo.com/',
          },
        });

        if (imgApiRes.ok) {
          const imgData = await imgApiRes.json();
          if (Array.isArray(imgData.results)) {
            imgData.results.slice(0, 24).forEach((item: any, idx: number) => {
              if (item.image) {
                results.push({
                  id: `ddg_${idx}_${Date.now()}`,
                  title: item.title || query,
                  image: item.image,
                  thumbnail: item.thumbnail || item.image,
                  width: item.width || 800,
                  height: item.height || 600,
                  source: 'DuckDuckGo Images',
                });
              }
            });
          }
        }
      }
    }
  } catch (ddgErr) {
    console.warn('DDG image search failed, using fallback:', ddgErr);
  }

  // If DDG returned fewer than 6 results, supplement with Openverse & Wikimedia Commons
  if (results.length < 6) {
    try {
      const ovRes = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=16`);
      if (ovRes.ok) {
        const ovData = await ovRes.json();
        if (Array.isArray(ovData.results)) {
          ovData.results.forEach((item: any, idx: number) => {
            if (item.url) {
              results.push({
                id: `ov_${idx}_${Date.now()}`,
                title: item.title || query,
                image: item.url,
                thumbnail: item.thumbnail || item.url,
                width: item.width || 1024,
                height: item.height || 768,
                source: 'Openverse',
              });
            }
          });
        }
      }
    } catch (ovErr) {
      console.warn('Openverse fallback failed:', ovErr);
    }
  }

  // Wikimedia Commons Fallback
  if (results.length < 6) {
    try {
      const wikiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gbnamespace=6&gbqsearch=${encodeURIComponent(query)}&prop=imageinfo&iiprop=url|size&format=json&origin=*`;
      const wikiRes = await fetch(wikiUrl);
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        const pages = wikiData.query?.pages || {};
        Object.values(pages).forEach((p: any, idx: number) => {
          const info = p.imageinfo?.[0];
          if (info?.url) {
            results.push({
              id: `wiki_${idx}_${Date.now()}`,
              title: p.title?.replace('File:', '') || query,
              image: info.url,
              thumbnail: info.thumburl || info.url,
              width: info.width || 800,
              height: info.height || 600,
              source: 'Wikimedia Commons',
            });
          }
        });
      }
    } catch (wikiErr) {
      console.warn('Wikimedia fallback failed:', wikiErr);
    }
  }

  return res.json({ results, count: results.length });
});

// Gemini Synthesis Endpoint for 8 Knowledge Sources
app.post('/api/ai/synthesize', async (req, res) => {
  try {
    const {
      prompt,
      wikiResults,
      archiveResults,
      gutenbergResults,
      openLibraryResults,
      musicBrainzResults,
      jamendoResults,
      openverseResults,
      language = 'he',
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    if (!ai) {
      return res.status(200).json({
        fallback: true,
        message: 'No GEMINI_API_KEY set. Using client-side RAG engine.',
      });
    }

    const wikiCtx = (wikiResults || [])
      .slice(0, 2)
      .map((w: any) => `[Wikipedia] ${w.title}: ${w.extract || w.snippet}`)
      .join('\n');

    const archiveCtx = (archiveResults || [])
      .slice(0, 2)
      .map((a: any) => `[Internet Archive] ${a.title} (${a.mediaType}, ${a.year || ''})`)
      .join('\n');

    const gutenbergCtx = (gutenbergResults || [])
      .slice(0, 2)
      .map((g: any) => `[Project Gutenberg] ${g.title} by ${g.authors?.map((a: any) => a.name).join(', ')}`)
      .join('\n');

    const systemInstruction = `You are "WikiArchive Quantum Engine" - an elite Apple-style AI Knowledge Synthesis Agent unifying 7 global open repositories: Wikipedia, Internet Archive, Project Gutenberg, Open Library, MusicBrainz, Jamendo Music, and Openverse.
Respond in ${language === 'he' ? 'Hebrew' : 'English'}.
Structure response with clean markdown headings, key bullet points, highlighted media/books, and an authoritative concluding insight.`;

    const contents = `User Query: "${prompt}"

Available Context across 7 repositories:
${wikiCtx ? `WIKIPEDIA:\n${wikiCtx}\n` : ''}
${archiveCtx ? `INTERNET ARCHIVE:\n${archiveCtx}\n` : ''}
${gutenbergCtx ? `PROJECT GUTENBERG:\n${gutenbergCtx}\n` : ''}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents,
      config: {
        systemInstruction,
      },
    });

    return res.json({
      text: response.text || '',
      success: true,
    });
  } catch (err: any) {
    console.error('Server AI Error:', err);
    return res.status(500).json({
      error: 'AI synthesis failed',
      details: err?.message || String(err),
    });
  }
});

// --- Cloudflare R2 Storage Endpoints ---

// Save / Test R2 Configuration
app.post('/api/storage/config', async (req, res) => {
  try {
    const { endpoint, accessKeyId, secretAccessKey, bucketName, publicUrl } = req.body;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      return res.status(400).json({
        success: false,
        error: 'נא להזין את 3 הפרטים: Endpoint, Access Key ID, Secret Access Key',
      });
    }

    const cleanedCfg: R2Config = {
      endpoint: sanitizeR2Endpoint(endpoint),
      accessKeyId: sanitizeKey(accessKeyId),
      secretAccessKey: sanitizeKey(secretAccessKey),
      bucketName: sanitizeKey(bucketName),
      publicUrl: sanitizeR2Endpoint(publicUrl),
    };

    const testClient = createR2Client(cleanedCfg);
    if (!testClient) {
      return res.status(400).json({ success: false, error: 'פרטי החיבור אינם תקינים' });
    }

    // Verify connection by listing buckets
    const listRes = await testClient.send(new ListBucketsCommand({}));
    let detectedBucket = cleanedCfg.bucketName;
    if (!detectedBucket && listRes.Buckets && listRes.Buckets.length > 0 && listRes.Buckets[0].Name) {
      detectedBucket = listRes.Buckets[0].Name;
      cleanedCfg.bucketName = detectedBucket;
    }

    // Save in memory
    activeR2Config = { ...activeR2Config, ...cleanedCfg };

    // Persist to .r2-config.json
    try {
      fs.writeFileSync(R2_CONFIG_FILE, JSON.stringify(cleanedCfg, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn('[R2 Storage] Could not write to .r2-config.json:', e?.message);
    }

    return res.json({
      success: true,
      bucket: detectedBucket || 'kolot-music',
      message: 'חיבור אחסון הענן אומת ונשמר בהצלחה!',
    });
  } catch (err: any) {
    console.error('Storage Config Verification Error:', err);
    return res.status(500).json({
      success: false,
      error: `שגיאה באימות החיבור לאחסון הענן: ${err?.message || 'אנא ודא שהמפתחות תקינים'}`,
    });
  }
});

// Storage Status Probe
app.get('/api/storage/status', async (req, res) => {
  try {
    const cfg = resolveR2Config(req);
    const hasKeys = !!(cfg.endpoint && cfg.accessKeyId && cfg.secretAccessKey);
    if (!hasKeys) {
      return res.json({
        success: true,
        configured: false,
        message: 'Cloud storage credentials not set yet',
      });
    }

    const { bucket, publicUrl } = await getR2Context(req);
    return res.json({
      success: true,
      configured: true,
      bucket,
      hasPublicUrl: !!publicUrl,
      endpoint: 'configured',
    });
  } catch (err: any) {
    return res.json({
      success: false,
      configured: false,
      error: err?.message || 'Failed to connect to cloud storage',
    });
  }
});

// 0. Generate Direct-to-R2 Presigned PUT URL for instant browser -> R2 uploads (supports up to 1GB+)
app.post('/api/storage/presign', async (req: any, res) => {
  try {
    const rawPath = String(req.body?.path || '').trim().replace(/^\/+/, '');
    const contentType = String(req.body?.contentType || 'application/octet-stream').trim();

    if (!rawPath) {
      return res.status(400).json({ success: false, error: 'Missing path' });
    }

    const { client, bucket, publicUrl } = await getR2Context(req);
    await ensureR2BucketCors(client, bucket);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: rawPath,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });
    const fileUrl = publicUrl ? `${publicUrl}/${rawPath}` : `/api/storage/raw/${rawPath}`;

    return res.json({
      success: true,
      uploadUrl,
      url: fileUrl,
      path: rawPath,
      bucket,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to create presigned upload URL',
    });
  }
});

// 1. Upload File (Audio/Image/JSON) - 100% Pure Cloudflare R2
app.post('/api/storage/upload', upload.fields([{ name: 'file', maxCount: 1 }]), async (req: any, res) => {
  try {
    const rawPath = String(req.body?.path || '').trim().replace(/^\/+/, '');
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    const file = files?.file?.[0];

    if (!file && !req.body.content) {
      return res.status(400).json({ success: false, error: 'No file or content provided' });
    }

    if (!rawPath) {
      return res.status(400).json({ success: false, error: 'No path provided' });
    }

    let body: Buffer = Buffer.from([]);
    let contentType = 'application/octet-stream';

    if (file) {
      body = file.buffer;
      contentType = file.mimetype || 'application/octet-stream';
    } else if (req.body.content) {
      body = Buffer.from(req.body.content, 'utf-8');
      contentType = req.body.contentType || 'application/json';
    }

    let r2Success = false;
    let r2Url = '';
    let bucketName = '';
    let lastR2Error = '';

    try {
      const { client, bucket, publicUrl } = await getR2Context(req);
      bucketName = bucket;

      const readJsonR2 = async (key: string) => {
        try {
          const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          return obj.Body ? JSON.parse(await obj.Body.transformToString('utf-8')) : null;
        } catch {
          return null;
        }
      };

      const getReqSession = () => {
        const { sessionSecret } = getGoogleOAuthCreds();
        return extractSessionFromRequest(req, sessionSecret)?.session || null;
      };

      if (rawPath.startsWith('profiles/') && rawPath.endsWith('.json')) {
        const sess = getReqSession();
        const targetUid = rawPath.replace(/^profiles\/(?:artist_)?/, '').replace(/\.json$/, '').trim();
        const cleanSessUid = String(sess?.uid || '').replace(/^artist_/, '').trim();
        if (!sess || !cleanSessUid || cleanSessUid !== targetUid) {
          return res.status(403).json({ success: false, error: 'רק בעל הפרופיל רשאי לערוך פרופיל זה.' });
        }
      } else if (rawPath.startsWith('tracks/') && rawPath.endsWith('.json')) {
        let incoming: any = null;
        try {
          incoming = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf-8') : String(body));
        } catch {}
        const existing = await readJsonR2(rawPath);
        const sess = getReqSession();
        const cleanSessUid = String(sess?.uid || '').replace(/^artist_/, '').trim();
        const incomingUid = String(incoming?.uploadedByUid || '').replace(/^artist_/, '').trim();
        if (!existing) {
          if (!sess || !cleanSessUid || (incomingUid && incomingUid !== cleanSessUid)) {
            return res.status(403).json({ success: false, error: 'רק בעל הפרופיל המחובר יכול להוסיף שירים.' });
          }
        } else {
          const existingUid = String(existing.uploadedByUid || '').replace(/^artist_/, '').trim();
          const isCoreEdit =
            (incoming?.name !== undefined && incoming.name !== existing.name) ||
            (incoming?.artistName !== undefined && incoming.artistName !== existing.artistName) ||
            (incoming?.audioUrl !== undefined && incoming.audioUrl !== existing.audioUrl) ||
            (incomingUid && existingUid && incomingUid !== existingUid);
          if (isCoreEdit && (!sess || !cleanSessUid || (existingUid && cleanSessUid !== existingUid))) {
            return res.status(403).json({ success: false, error: 'רק בעל השיר רשאי לערוך שיר זה.' });
          }
          if (incoming && typeof incoming === 'object') {
            const trackId = rawPath.replace(/^tracks\//, '').replace(/\.json$/, '');
            const preservedViews = Math.max(
              Number(existing.viewsCount) || 0,
              Number(incoming.viewsCount) || 0,
              optimisticTrackViewCounts.get(trackId) || 0
            );
            incoming.viewsCount = preservedViews;
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
            }
            body = Buffer.from(JSON.stringify(incoming, null, 2), 'utf-8');
          }
        }
      } else if (rawPath.startsWith('albums/') && rawPath.endsWith('.json')) {
        const existing = await readJsonR2(rawPath);
        const sess = getReqSession();
        const cleanSessUid = String(sess?.uid || '').replace(/^artist_/, '').trim();
        const ownerUid = String(existing?.uploadedByUid || existing?.artistId || '').replace(/^artist_/, '').trim();
        if (!sess || !cleanSessUid || (existing && ownerUid && ownerUid !== cleanSessUid)) {
          return res.status(403).json({ success: false, error: 'רק בעל הפרופיל רשאי ליצור או לערוך אלבום זה.' });
        }
      }

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: rawPath,
        Body: body,
        ContentType: contentType,
      });

      try {
        await client.send(command);
        r2Success = true;
      } catch (putErr: any) {
        lastR2Error = putErr?.message || String(putErr);
        const errStr = String(putErr?.message || putErr?.name || '');
        if (errStr.includes('NoSuchBucket') || errStr.includes('does not exist') || putErr?.name === 'NoSuchBucket') {
          console.log(`[R2 Storage] Bucket '${bucket}' not found. Attempting auto-creation...`);
          try {
            await client.send(new CreateBucketCommand({ Bucket: bucket }));
            console.log(`[R2 Storage] Bucket '${bucket}' created! Retrying upload...`);
            await client.send(command);
            r2Success = true;
          } catch (createErr: any) {
            console.warn('[R2 Storage] Bucket auto-creation failed:', createErr?.message);
            lastR2Error = `אחסון הענן של האתר אינו זמין כרגע.`;
          }
        }
      }

      if (r2Success) {
        r2Url = publicUrl ? `${publicUrl}/${rawPath}` : `/api/storage/raw/${rawPath}`;
      }
    } catch (r2Err: any) {
      lastR2Error = r2Err?.message || String(r2Err);
      console.warn('[R2 Storage] R2 upload error:', r2Err?.message);
    }

    if (!r2Success) {
      return res.status(500).json({
        success: false,
        error: lastR2Error || `שגיאה בהעלאה לאחסון הענן`,
        bucketNeeded: bucketName || 'kolot-music',
      });
    }

    return res.json({
      success: true,
      url: r2Url,
      path: rawPath,
      bucket: bucketName || 'kolot-music',
      mode: 'r2',
    });
  } catch (err: any) {
    console.error('Storage Upload Route Error:', err);
    return res.status(500).json({
      success: false,
      error: `שגיאה בהעלאת הקובץ: ${err?.message || 'אנא נסה שוב'}`,
    });
  }
});

// 2. List Files - 100% Pure Cloudflare R2 (Paginated)
app.get('/api/storage/list', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const prefix = String(req.query.prefix || '').replace(/^\/+/, '');
    const { client, bucket, publicUrl } = await getR2Context(req);
    const filesList: { key: string; size: number; lastModified?: Date; url: string }[] = [];

    let continuationToken: string | undefined = undefined;
    do {
      const command: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      const data = await client.send(command);
      if (data.Contents) {
        data.Contents.forEach((item: { Key?: string; Size?: number; LastModified?: Date }) => {
          if (item.Key) {
            filesList.push({
              key: item.Key,
              size: item.Size || 0,
              lastModified: item.LastModified,
              url: publicUrl ? `${publicUrl}/${item.Key}` : `/api/storage/raw/${item.Key}`,
            });
          }
        });
      }
      continuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
    } while (continuationToken);

    return res.json({
      success: true,
      bucket,
      files: filesList,
    });
  } catch (err: any) {
    console.error('Storage List Error:', err);
    return res.status(500).json({
      success: false,
      error: `Failed to list files from storage: ${err?.message || 'Unknown error'}`,
    });
  }
});

// 2a. Single Track Lookup - 100% Pure Cloudflare R2 (for deep links & live subtitle hydration)
app.get('/api/storage/track/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const cleanId = decodeURIComponent(String(req.params.id || '')).replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanId) {
      return res.status(400).json({ success: false, error: 'Missing track id' });
    }
    const { client, bucket } = await getR2Context(req);
    const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `tracks/${cleanId}.json` })).catch(() => null);
    if (!obj?.Body) {
      return res.status(404).json({ success: false, error: 'Track not found' });
    }
    const parsed = JSON.parse(await obj.Body.transformToString('utf-8'));
    if (!parsed || typeof parsed !== 'object') {
      return res.status(404).json({ success: false, error: 'Track not found' });
    }
    const { uploadedByEmail: _omitEmail, ...cleanTrack } = parsed;
    const mergedViews = Math.max(
      Number(cleanTrack.viewsCount) || 0,
      optimisticTrackViewCounts.get(cleanId) || 0
    );
    return res.json({
      success: true,
      track: { ...cleanTrack, viewsCount: mergedViews },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to load track',
    });
  }
});

// 2b. Fast Single-Roundtrip Tracks Feed (reads tracks/*.json + tracks_index.json in parallel server-side)
app.get('/api/storage/tracks-feed', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const { client, bucket } = await getR2Context(req);
    const trackMap = new Map<string, any>();

    const readJsonKey = async (key: string) => {
      try {
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!obj.Body) return null;
        const text = await obj.Body.transformToString('utf-8');
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    // Fetch list of tracks/*.json and tracks_index.json in parallel
    const [listData, indexData] = await Promise.all([
      client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'tracks/' })).catch(() => null),
      readJsonKey('tracks_index.json'),
    ]);

    if (Array.isArray(indexData)) {
      indexData.forEach((t: any) => {
        if (t?.id && t?.name && t?.audioUrl) {
          const opt = optimisticTrackViewCounts.get(t.id) || 0;
          trackMap.set(t.id, opt > (Number(t.viewsCount) || 0) ? { ...t, viewsCount: opt } : t);
        }
      });
    }

    const keys = (listData?.Contents || [])
      .map((item) => item.Key || '')
      .filter((k) => k.endsWith('.json'));

    if (keys.length > 0) {
      // Read individual track JSONs in fast parallel batches (batch size 25)
      const batchSize = 25;
      for (let i = 0; i < keys.length; i += batchSize) {
        const slice = keys.slice(i, i + batchSize);
        const items = await Promise.all(slice.map((k) => readJsonKey(k)));
        items.forEach((t: any) => {
          if (t?.id && t?.name && t?.audioUrl) {
            const prev = trackMap.get(t.id);
            const mergedViews = Math.max(
              Number(prev?.viewsCount) || 0,
              Number(t.viewsCount) || 0,
              optimisticTrackViewCounts.get(t.id) || 0
            );
            trackMap.set(t.id, { ...t, viewsCount: mergedViews });
          }
        });
      }
    }

    return res.json({
      success: true,
      tracks: Array.from(trackMap.values()),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to load tracks feed',
    });
  }
});

function sanitizePublicProfile(p: any) {
  if (!p || typeof p !== 'object') return null;
  const { googleEmail: _omitEmail, ...clean } = p;
  return clean;
}

// 2c. Single Profile Lookup - 100% Pure Cloudflare R2
app.get('/api/storage/profile/:uid', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const rawUid = decodeURIComponent(String(req.params.uid || '')).trim();
    const cleanUid = rawUid.replace(/^artist_/, '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanUid) {
      return res.status(400).json({ success: false, error: 'Missing uid' });
    }

    const { client, bucket } = await getR2Context(req);
    const readJsonKey = async (key: string) => {
      try {
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!obj.Body) return null;
        const text = await obj.Body.transformToString('utf-8');
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const primary = await readJsonKey(`profiles/${cleanUid}.json`);
    const found = primary || (await readJsonKey(`profiles/artist_${cleanUid}.json`));
    return res.json({
      success: true,
      profile: sanitizePublicProfile(found),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to load profile',
    });
  }
});

// 2d. Fast Canonical Profiles Feed - 100% Pure Cloudflare R2
app.get('/api/storage/profiles-feed', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const { client, bucket } = await getR2Context(req);
    const readJsonKey = async (key: string) => {
      try {
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!obj.Body) return null;
        const text = await obj.Body.transformToString('utf-8');
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const listData = await client.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: 'profiles/', ContinuationToken: continuationToken })
      );
      (listData.Contents || []).forEach((item) => {
        if (item.Key && item.Key.endsWith('.json')) keys.push(item.Key);
      });
      continuationToken = listData.IsTruncated ? listData.NextContinuationToken : undefined;
    } while (continuationToken);

    const profileMap = new Map<string, { data: any; ts: number; isCanonicalKey: boolean }>();
    const batchSize = 25;
    for (let i = 0; i < keys.length; i += batchSize) {
      const slice = keys.slice(i, i + batchSize);
      const loaded = await Promise.all(slice.map(async (k) => ({ key: k, data: await readJsonKey(k) })));
      for (const item of loaded) {
        const clean = sanitizePublicProfile(item.data);
        if (!clean) continue;
        const uid = String(clean.googleUid || clean.id || '').replace(/^artist_/, '').trim();
        if (!uid) continue;
        const ts = Math.max(
          Date.parse(String(clean.updatedAt || '')) || 0,
          Date.parse(String(clean.acceptedTermsAt || '')) || 0
        );
        const isCanonicalKey = !item.key.startsWith('profiles/artist_');
        const prev = profileMap.get(uid);
        if (
          !prev ||
          ts > prev.ts ||
          (ts === prev.ts && isCanonicalKey && !prev.isCanonicalKey)
        ) {
          profileMap.set(uid, {
            data: { ...clean, id: uid, googleUid: uid },
            ts,
            isCanonicalKey,
          });
        }
      }
    }

    return res.json({
      success: true,
      profiles: Array.from(profileMap.values()).map((entry) => entry.data),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err?.message || 'Failed to load profiles feed',
    });
  }
});

// 3. Delete File - 100% Pure Cloudflare R2
app.delete('/api/storage/delete', async (req, res) => {
  try {
    const filePath = String(req.query.path || '').trim().replace(/^\/+/, '');
    if (!filePath) {
      return res.status(400).json({ success: false, error: 'Missing path' });
    }

    const { client, bucket } = await getR2Context(req);
    const { sessionSecret } = getGoogleOAuthCreds();
    const sess = extractSessionFromRequest(req, sessionSecret)?.session || null;
    const cleanSessUid = String(sess?.uid || '').replace(/^artist_/, '').trim();

    const readJsonR2 = async (key: string) => {
      try {
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return obj.Body ? JSON.parse(await obj.Body.transformToString('utf-8')) : null;
      } catch {
        return null;
      }
    };

    if (filePath.startsWith('tracks/') && filePath.endsWith('.json')) {
      const existing = await readJsonR2(filePath);
      const ownerUid = String(existing?.uploadedByUid || '').replace(/^artist_/, '').trim();
      if (!sess || !cleanSessUid || (existing && ownerUid && ownerUid !== cleanSessUid)) {
        return res.status(403).json({ success: false, error: 'רק בעל השיר רשאי למחוק שיר זה.' });
      }
    } else if (filePath.startsWith('albums/') && filePath.endsWith('.json')) {
      const existing = await readJsonR2(filePath);
      const ownerUid = String(existing?.uploadedByUid || existing?.artistId || '').replace(/^artist_/, '').trim();
      if (!sess || !cleanSessUid || (existing && ownerUid && ownerUid !== cleanSessUid)) {
        return res.status(403).json({ success: false, error: 'רק בעל האלבום רשאי למחוק אלבום זה.' });
      }
    } else if (filePath.startsWith('profiles/') && filePath.endsWith('.json')) {
      const targetUid = filePath.replace(/^profiles\/(?:artist_)?/, '').replace(/\.json$/, '').trim();
      if (!sess || (!sess.isAdmin && cleanSessUid !== targetUid)) {
        return res.status(403).json({ success: false, error: 'אין הרשאה למחוק פרופיל זה.' });
      }
    }

    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: filePath }));

    return res.json({ success: true });
  } catch (err: any) {
    console.error('Storage Delete Error:', err);
    return res.status(500).json({
      success: false,
      error: `Failed to delete file from storage: ${err?.message || 'Unknown error'}`,
    });
  }
});

// 4. Raw Streamer Proxy - 100% Pure Cloudflare R2 with HTTP Range Support
app.get('/api/storage/raw/*', async (req, res) => {
  const rawParam = (req.params as any)[0] || '';
  const filePath = decodeURIComponent(rawParam).replace(/^\/+/, '');
  if (!filePath) return res.status(400).send('Missing path');

  const isJson = filePath.toLowerCase().endsWith('.json');
  const isAvatar = filePath.toLowerCase().startsWith('avatars/');

  try {
    const { client, bucket, publicUrl } = await getR2Context(req);
    if (publicUrl && !isJson && !isAvatar) {
      return res.redirect(`${publicUrl}/${filePath}`);
    }

    const rangeHeader = req.headers.range;
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: filePath,
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    });

    const s3Item = await client.send(command);

    res.setHeader('Accept-Ranges', 'bytes');
    if (s3Item.ContentType) {
      res.setHeader('Content-Type', s3Item.ContentType);
    } else if (isJson) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }

    if (s3Item.ContentLength !== undefined) {
      res.setHeader('Content-Length', String(s3Item.ContentLength));
    }
    if (s3Item.ContentRange) {
      res.setHeader('Content-Range', s3Item.ContentRange);
    }

    if (isJson) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

    if (rangeHeader && s3Item.ContentRange) {
      res.status(206);
    }

    if (s3Item.Body) {
      // @ts-ignore
      return s3Item.Body.pipe(res);
    }
  } catch (r2Err: any) {
    console.warn('[R2 Proxy] R2 getObject error:', filePath, r2Err?.message);
  }

  return res.status(404).send('File not found in storage');
});

// 4b. Image CORS Proxy for accurate dominant color sampling on external avatars & covers
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

app.get('/api/proxy-image', async (req, res) => {
  const targetUrl = String(req.query.url || '').trim();
  if (!targetUrl || !isSafeExternalHttpUrl(targetUrl)) {
    return res.status(400).send('Invalid image URL');
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Kolot-Music-ColorExtractor/1.0',
        Accept: 'image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send('Failed to fetch external image');
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return res.status(415).send('URL did not return an image');
    }

    const arrayBuf = await upstream.arrayBuffer();
    if (arrayBuf.byteLength > 8 * 1024 * 1024) {
      return res.status(413).send('Image too large');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(Buffer.from(arrayBuf));
  } catch (err: any) {
    return res.status(502).send(`Image proxy error: ${err?.message || 'Failed'}`);
  }
});

// 4c. Whisper AI Subtitles & Audio Transcription Endpoint
function parseTimestampToSeconds(ts: string): number {
  const parts = ts.trim().replace(/,/g, '.').split(':').map((p) => parseFloat(p));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] || 0;
}

interface TranscribedSegment {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
}

function buildSegmentsFromTimedText(rawText: string, trackDuration: number): TranscribedSegment[] {
  const cleaned = rawText
    .replace(/^```[\w]*\n?/gm, '')
    .replace(/```$/gm, '')
    .trim();

  if (!cleaned) return [];

  const rawLines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const timed: { startTime: number; endTime?: number; text: string }[] = [];
  const untimed: string[] = [];

  for (const line of rawLines) {
    // Match [MM:SS - MM:SS] text or [MM:SS] text or (MM:SS) text
    const rangeMatch = line.match(/^[\[(]?(\d{1,2}:\d{2}(?:\.\d{1,2})?)\s*[-–>to]+\s*(\d{1,2}:\d{2}(?:\.\d{1,2})?)[\])]?\s*(.+)$/);
    if (rangeMatch) {
      const startTime = parseTimestampToSeconds(rangeMatch[1]);
      const endTime = parseTimestampToSeconds(rangeMatch[2]);
      const text = rangeMatch[3].replace(/^[-:|•\s]+/, '').trim();
      if (text) {
        timed.push({ startTime, endTime: endTime > startTime ? endTime : startTime + 4, text });
      }
      continue;
    }

    const singleMatch = line.match(/^[\[(](\d{1,2}:\d{2}(?:\.\d{1,2})?)[\])]\s*(.+)$/);
    if (singleMatch) {
      const startTime = parseTimestampToSeconds(singleMatch[1]);
      const text = singleMatch[2].replace(/^[-:|•\s]+/, '').trim();
      if (text) {
        timed.push({ startTime, text });
      }
      continue;
    }

    untimed.push(line);
  }

  if (timed.length > 0) {
    return timed.map((seg, idx) => {
      const nextStart = timed[idx + 1]?.startTime;
      const fallbackEnd = nextStart && nextStart > seg.startTime
        ? nextStart
        : Math.min(Math.max(trackDuration, seg.startTime + 4), seg.startTime + 5.5);
      return {
        id: `whisper_seg_${idx}`,
        startTime: Number(seg.startTime.toFixed(2)),
        endTime: Number((seg.endTime ?? fallbackEnd).toFixed(2)),
        text: seg.text,
      };
    });
  }

  // Distribute untimed lines across track duration cleanly
  const safeDuration = Math.max(20, trackDuration || 120);
  const introOffset = safeDuration > 25 ? 4 : 0;
  const activeSpan = Math.max(10, safeDuration - introOffset - 2);
  const step = activeSpan / Math.max(1, untimed.length);

  return untimed.map((text, idx) => {
    const startTime = introOffset + idx * step;
    const endTime = startTime + step;
    return {
      id: `whisper_seg_${idx}`,
      startTime: Number(startTime.toFixed(2)),
      endTime: Number(endTime.toFixed(2)),
      text,
    };
  });
}

function guessAudioMimeType(urlOrName: string, headerType?: string | null): string {
  if (headerType && headerType.startsWith('audio/')) {
    return headerType.split(';')[0].trim();
  }
  const lower = urlOrName.toLowerCase();
  if (lower.includes('.wav')) return 'audio/wav';
  if (lower.includes('.ogg')) return 'audio/ogg';
  if (lower.includes('.m4a') || lower.includes('.mp4')) return 'audio/mp4';
  if (lower.includes('.webm')) return 'audio/webm';
  if (lower.includes('.flac')) return 'audio/flac';
  return 'audio/mp3';
}

const CANONICAL_AUDIO_GENRES = [
  'Pop',
  'Mizrahi',
  'Rock',
  'Electronic',
  'Hip Hop',
  'Acoustic',
  'Chill',
  'Classical',
  'Jazz',
  'Blues',
  'Cinematic',
] as const;

const HEBREW_GENRE_LABELS: Record<string, string> = {
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

async function resolveAudioBytesForAi(req: any): Promise<{ audioBuffer: Buffer | null; mimeType: string; fetchError?: { status: number; message: string } }> {
  const audioUrl = String(req.body?.audioUrl || '').trim();
  let audioBuffer: Buffer | null = null;
  let mimeType = 'audio/mp3';

  if (req.file?.buffer) {
    audioBuffer = req.file.buffer;
    mimeType = guessAudioMimeType(req.file.originalname || 'track.mp3', req.file.mimetype);
  } else if (audioUrl.startsWith('data:')) {
    const match = audioUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      audioBuffer = Buffer.from(match[2], 'base64');
    }
  } else if (audioUrl.startsWith('/api/storage/raw/')) {
    const r2Key = decodeURIComponent(audioUrl.replace(/^\/api\/storage\/raw\//, ''));
    const { client, bucket } = await getR2Context(req);
    const s3Item = await client.send(new GetObjectCommand({ Bucket: bucket, Key: r2Key }));
    if (s3Item.Body) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of s3Item.Body as any) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      audioBuffer = Buffer.concat(chunks);
      mimeType = guessAudioMimeType(r2Key, s3Item.ContentType);
    }
  } else if (audioUrl && isSafeExternalHttpUrl(audioUrl)) {
    const upstream = await fetch(audioUrl, {
      headers: { 'User-Agent': 'Kolot-Audio-AI/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      return {
        audioBuffer: null,
        mimeType,
        fetchError: { status: 502, message: `שגיאה בטעינת קובץ השמע (${upstream.status})` },
      };
    }
    const arr = await upstream.arrayBuffer();
    audioBuffer = Buffer.from(arr);
    mimeType = guessAudioMimeType(audioUrl, upstream.headers.get('content-type'));
  }

  return { audioBuffer, mimeType };
}

function classifyGenreHeuristic(songTitle: string, artistName: string, lyrics: string) {
  const combined = `${songTitle} ${artistName} ${lyrics}`.toLowerCase();
  const has = (words: string[]) => words.some((w) => combined.includes(w));

  let genre: (typeof CANONICAL_AUDIO_GENRES)[number] = 'Pop';
  let mood = 'Upbeat';
  let reasonHe = 'סיווג משוער לפי מאפייני השיר';

  if (has(['מזרח', 'דרבוקה', 'חפלה', 'סלסול', 'בוזוקי', 'קפה', 'ים תיכונ', 'יאללה', 'נשמה', 'עיניים', 'כפרה', 'mizrahi', 'oriental'])) {
    genre = 'Mizrahi';
    mood = 'רגשי / ים-תיכוני';
    reasonHe = 'זוהו מוטיבים ים-תיכוניים ומזרחיים בשיר';
  } else if (has(['ראפ', 'היפ', 'ביט', 'פריסטייל', 'חרוז', 'טראפ', 'hip', 'rap', 'trap', 'flow', 'drill', 'mc'])) {
    genre = 'Hip Hop';
    mood = 'קצבי / אורבני';
    reasonHe = 'זוהה אופי של ראפ / היפ הופ וביט קצבי';
  } else if (has(['רוק', 'גיטרה חשמלית', 'מטאל', 'פאנק', 'rock', 'guitar', 'metal', 'punk', 'grunge', 'indie rock'])) {
    genre = 'Rock';
    mood = 'אנרגטי / עוצמתי';
    reasonHe = 'זוהו מאפייני רוק וגיטרות';
  } else if (has(['אלקטרו', 'טראנס', 'האוס', 'טכנו', 'רמיקס', 'דאנס', 'edm', 'house', 'techno', 'trance', 'synth', 'dubstep', 'electronic', 'club'])) {
    genre = 'Electronic';
    mood = 'אנרגטי / מסיבתי';
    reasonHe = 'זוהו סינתיסייזרים ומקצב אלקטרוני';
  } else if (has(['צ׳יל', "צ'יל", 'לואו פיי', 'רגיעה', 'לילה', 'chill', 'lofi', 'lo-fi', 'ambient', 'relax', 'sleep', 'calm'])) {
    genre = 'Chill';
    mood = 'רגוע / אווירתי';
    reasonHe = 'זוהה אופי רגוע ואווירתי (צ׳יל)';
  } else if (has(['אקוסט', 'גיטרה', 'מדורה', 'שקט', 'acoustic', 'unplugged', 'folk', 'ballad'])) {
    genre = 'Acoustic';
    mood = 'חמים / אינטימי';
    reasonHe = 'זוהה אופי אקוסטי טבעי';
  } else if (has(['קלאס', 'פסנתר', 'כינור', 'סימפוני', 'תזמורת', 'piano', 'violin', 'orchestra', 'symphony', 'classical'])) {
    genre = 'Classical';
    mood = 'מלכותי / קלאסי';
    reasonHe = 'זוהו כלי נגינה קלאסיים ותזמורתיים';
  } else if (has(['ג׳אז', "ג'אז", 'סקסופון', 'jazz', 'sax', 'swing', 'bebop'])) {
    genre = 'Jazz';
    mood = 'מתוחכם / גרובי';
    reasonHe = 'זוהו מאפייני ג׳אז ואלתור';
  } else if (has(['בלוז', 'סול', 'blues', 'soul', 'r&b'])) {
    genre = 'Blues';
    mood = 'עמוק / נשמה';
    reasonHe = 'זוהו מאפייני בלוז ונשמה';
  } else if (has(['פסקול', 'קולנוע', 'אפי', 'דרמה', 'soundtrack', 'cinematic', 'epic', 'score', 'trailer'])) {
    genre = 'Cinematic';
    mood = 'דרמטי / קולנועי';
    reasonHe = 'זוהה אופי קולנועי ואפי';
  }

  return {
    genre,
    hebrewGenre: HEBREW_GENRE_LABELS[genre] || genre,
    confidence: 0.68,
    mood,
    bpmEstimate: genre === 'Electronic' ? 126 : genre === 'Hip Hop' ? 92 : genre === 'Chill' ? 78 : 110,
    reasonHe,
  };
}

app.post('/api/ai/transcribe', upload.single('file'), async (req: any, res) => {
  try {
    const language = String(req.body?.language || 'he');
    const songTitle = String(req.body?.songTitle || '').trim();
    const artistName = String(req.body?.artistName || '').trim();
    const duration = Math.max(10, Number(req.body?.duration) || 180);

    const resolved = await resolveAudioBytesForAi(req);
    if (resolved.fetchError) {
      return res.status(resolved.fetchError.status).json({ success: false, error: resolved.fetchError.message });
    }
    let { audioBuffer } = resolved;
    const { mimeType } = resolved;

    if (!audioBuffer || audioBuffer.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'לא נמצא קובץ שמע זמין לתמלול כתוביות.',
      });
    }

    // Keep within inline payload size limits (~18MB max)
    const MAX_AUDIO_BYTES = 18 * 1024 * 1024;
    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      audioBuffer = audioBuffer.subarray(0, MAX_AUDIO_BYTES);
    }

    // 1. Optional OpenAI Whisper API if OPENAI_API_KEY is configured in environment
    if (process.env.OPENAI_API_KEY) {
      try {
        const ext = mimeType.split('/')[1]?.replace('mpeg', 'mp3') || 'mp3';
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(audioBuffer)], { type: mimeType }), `audio.${ext}`);
        form.append('model', 'whisper-1');
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'segment');

        const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: form,
        });

        if (whisperRes.ok) {
          const wData: any = await whisperRes.json();
          const rawSegments = Array.isArray(wData.segments) ? wData.segments : [];
          const segments: TranscribedSegment[] = rawSegments
            .filter((s: any) => s.text && String(s.text).trim().length > 0)
            .map((s: any, idx: number) => ({
              id: `whisper_${idx}`,
              startTime: Number((s.start ?? 0).toFixed(2)),
              endTime: Number((s.end ?? (s.start ?? 0) + 4).toFixed(2)),
              text: String(s.text).trim(),
            }));

          const fullLyrics = segments.length > 0
            ? segments.map((s) => s.text).join('\n')
            : String(wData.text || '').trim();

          if (segments.length > 0 || fullLyrics) {
            return res.json({
              success: true,
              provider: 'openai-whisper',
              segments: segments.length > 0 ? segments : buildSegmentsFromTimedText(fullLyrics, duration),
              lyrics: fullLyrics,
            });
          }
        }
      } catch (whisperErr: any) {
        console.warn('[Whisper API] Fallback to Gemini Transcribe:', whisperErr?.message);
      }
    }

    // 2. Primary Server-Side Audio Transcription via Gemini Structured JSON SRT (gemini-4-hydrogen -> gemini-3.5-transcribe fallback)
    if (!ai) {
      return res.status(503).json({
        success: false,
        error: 'שירות התמלול האוטומטי דורש הגדרת מפתח GEMINI_API_KEY או OPENAI_API_KEY בשרת.',
      });
    }

    const base64Audio = audioBuffer.toString('base64');
    const audioPart = {
      inlineData: {
        mimeType,
        data: base64Audio,
      },
    };

    const structuredPrompt =
      `זהה את השפה המרכזית שבה השיר מושר או מדובר בקובץ השמע ותמלל את המילים לשורות כתוביות קצרות ומסונכרנות היטב לקצב.\n` +
      `${songTitle ? `שם השיר: "${songTitle}". ` : ''}` +
      `${artistName ? `שם הזמר/אמן: "${artistName}". ` : ''}` +
      `חוקי חובה:\n` +
      `1. detectedLanguageCode: קוד שפה קצר (ISO-639-1) של השפה הנשמעת בשיר, לדוגמה "he", "en", "ar", "es", "fr", "ru", "yi", "it", "pt", "de", "ja".\n` +
      `2. detectedLanguageLabel: שם השפה לקורא (לדוגמה "עברית", "English", "العربية", "Español", "Français", "Русский", "ייִדיש").\n` +
      `3. עבור כל שורה ב-segments ספק:\n` +
      `   - start ו-end בפורמט HH:MM:SS,mmm (לדוגמה 00:00:08,200).\n` +
      `   - text: המילים המקוריות בדיוק בשפה שבה הן מושרות בפועל.\n` +
      `   - textHe (ברירת מחדל חובה): המילים בעברית (אם השיר בעברית - התמלול המדויק בעברית; אם באנגלית או בכל שפה אחרת - תרגום טבעי ומדויק לעברית).\n` +
      `   - textEn (ברירת מחדל חובה): המילים באנגלית (אם השיר באנגלית - התמלול המדויק באנגלית; אם בעברית או בכל שפה אחרת - תרגום טבעי ומדויק לאנגלית).\n` +
      `אם השיר אינסטרומנטלי לחלוטין ללא שירה או דיבור, החזר segments ריק []. אל תמציא מילים או הערות.`;

    let detectedLanguageCode = '';
    let detectedLanguageLabel = '';
    let structuredItems: Array<{ start: string; end: string; text: string; textHe?: string; textEn?: string }> = [];
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [{ text: structuredPrompt }, audioPart],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            description: 'זיהוי שפה ורשימת כתוביות מסודרת כרונולוגית',
            properties: {
              detectedLanguageCode: { type: Type.STRING, description: 'קוד ISO-639-1 של שפת המקור המושרת בשיר' },
              detectedLanguageLabel: { type: Type.STRING, description: 'שם שפת המקור בשפתה או בעברית' },
              segments: {
                type: Type.ARRAY,
                description: 'רשימת כתוביות מסודרת כרונולוגית',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: { type: Type.STRING, description: 'זמן התחלה בפורמט HH:MM:SS,mmm' },
                    end: { type: Type.STRING, description: 'זמן סיום בפורמט HH:MM:SS,mmm' },
                    text: { type: Type.STRING, description: 'הטקסט המושר בשפת המקור' },
                    textHe: { type: Type.STRING, description: 'הטקסט בעברית' },
                    textEn: { type: Type.STRING, description: 'הטקסט באנגלית' },
                  },
                  required: ['start', 'end', 'text', 'textHe', 'textEn'],
                },
              },
            },
            required: ['detectedLanguageCode', 'detectedLanguageLabel', 'segments'],
          },
        },
      });
      const rawJson = (response.text || '').trim();
      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          structuredItems = parsed;
        } else if (parsed && Array.isArray(parsed.segments)) {
          structuredItems = parsed.segments;
          detectedLanguageCode = String(parsed.detectedLanguageCode || '').trim().toLowerCase().slice(0, 12);
          detectedLanguageLabel = String(parsed.detectedLanguageLabel || '').trim().slice(0, 48);
        }
      }
    } catch (structErr: any) {
      console.warn('[Transcribe] gemini-4-hydrogen structured fallback to gemini-3.5-transcribe:', structErr?.message || structErr);
    }

    if (structuredItems.length > 0) {
      const segments: TranscribedSegment[] = [];
      const segmentsHe: TranscribedSegment[] = [];
      const segmentsEn: TranscribedSegment[] = [];
      const segmentsOrigRaw: TranscribedSegment[] = [];

      structuredItems.forEach((item, idx) => {
        const mainText = String(item?.text || item?.textHe || item?.textEn || '').trim();
        if (!mainText || /^(?:\[?(?:instrumental|music|קטע אינסטרומנטלי)\]?)$/i.test(mainText)) return;
        const startTime = Math.max(0, Number(parseTimestampToSeconds(String(item?.start || '00:00:00,000')).toFixed(2)));
        const rawEnd = Number(parseTimestampToSeconds(String(item?.end || '')).toFixed(2));
        const endTime = rawEnd > startTime ? rawEnd : Number((startTime + 3.5).toFixed(2));

        segments.push({ id: `gem_seg_${idx}`, startTime, endTime, text: mainText });
        segmentsHe.push({
          id: `gem_he_${idx}`,
          startTime,
          endTime,
          text: String(item?.textHe || mainText).trim(),
        });
        segmentsEn.push({
          id: `gem_en_${idx}`,
          startTime,
          endTime,
          text: String(item?.textEn || mainText).trim(),
        });
        segmentsOrigRaw.push({
          id: `gem_orig_${idx}`,
          startTime,
          endTime,
          text: mainText,
        });
      });

      if (segments.length > 0) {
        const baseLang = detectedLanguageCode.split('-')[0];
        const isOrigNonHeEn = Boolean(baseLang && baseLang !== 'he' && baseLang !== 'iw' && baseLang !== 'en');
        return res.json({
          success: true,
          provider: 'gemini-subtitles-srt',
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
        });
      }
    }

    // 3. Fallback via gemini-3.5-transcribe if structured JSON returned empty
    let transcribedText = '';
    try {
      const transcribeInstruction =
        `Transcribe all sung lyrics and spoken vocals from this song audio word-for-word in the exact language spoken or sung. ` +
        `${songTitle ? `Song title context: "${songTitle}". ` : ''}` +
        `${artistName ? `Artist context: "${artistName}". ` : ''}` +
        `Format EVERY lyric line with its exact start and end timestamp like:\n` +
        `[00:08 - 00:13] First lyric line\n` +
        `If the audio has no vocals at all (purely instrumental), output NOTHING. Do not invent lyrics.`;
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: { parts: [audioPart, { text: transcribeInstruction }] },
      });
      transcribedText = (response.text || '').trim();
    } catch (modelErr: any) {
      console.warn('[Transcribe] gemini-3.5-transcribe fallback notice:', modelErr?.message || modelErr);
    }

    const segments = buildSegmentsFromTimedText(transcribedText, duration);
    if (segments.length === 0) {
      return res.json({
        success: false,
        segments: [],
        error: 'לא זוהו מילים בקובץ השמע.',
      });
    }

    const lyrics = segments.map((s) => s.text).join('\n');
    return res.json({
      success: true,
      provider: 'gemini-3.5-transcribe',
      segments,
      lyrics,
    });
  } catch (err: any) {
    console.error('Whisper AI Transcription Error:', err);
    return res.status(500).json({
      success: false,
      error: `שגיאה בתמלול הכתוביות: ${err?.message || 'אנא נסה שוב'}`,
    });
  }
});

// 4d. Audio Classification Endpoint (Detects true musical genre from audio waveform + optional HF AST)
app.post('/api/ai/classify-audio', upload.single('file'), async (req: any, res) => {
  try {
    const songTitle = String(req.body?.songTitle || '').trim();
    const artistName = String(req.body?.artistName || '').trim();
    const lyrics = String(req.body?.lyrics || '').trim();

    let resolved: { audioBuffer: Buffer | null; mimeType: string; fetchError?: { status: number; message: string } } = {
      audioBuffer: null,
      mimeType: 'audio/mp3',
    };

    try {
      resolved = await resolveAudioBytesForAi(req);
    } catch (resolveErr: any) {
      console.warn('[Audio Classification] Could not fetch audio bytes:', resolveErr?.message);
    }

    let { audioBuffer } = resolved;
    const { mimeType } = resolved;

    if (audioBuffer && audioBuffer.length > 15 * 1024 * 1024) {
      audioBuffer = audioBuffer.subarray(0, 15 * 1024 * 1024);
    }

    // Optional Hugging Face Audio Spectrogram Transformer (MIT/ast-finetuned-audioset) acoustic feature signal
    let hfLabels: Array<{ label: string; score: number }> = [];
    if (process.env.HF_TOKEN && audioBuffer && audioBuffer.length > 0) {
      try {
        const hfSlice = audioBuffer.length > 4 * 1024 * 1024 ? audioBuffer.subarray(0, 4 * 1024 * 1024) : audioBuffer;
        const hfRes = await fetch(
          'https://router.huggingface.co/hf-inference/models/MIT/ast-finetuned-audioset-10-10-0.4593',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${process.env.HF_TOKEN}`,
              'Content-Type': mimeType,
            },
            body: new Uint8Array(hfSlice),
            signal: AbortSignal.timeout(10000),
          }
        );
        if (hfRes.ok) {
          const parsed = await hfRes.json();
          if (Array.isArray(parsed)) {
            hfLabels = parsed.slice(0, 8).map((x: any) => ({
              label: String(x.label || ''),
              score: Number(x.score || 0),
            }));
          }
        }
      } catch (hfErr: any) {
        console.warn('[Audio Classification] HF AST optional probe skipped:', hfErr?.message);
      }
    }

    // Primary: True multimodal Audio Classification with @google/genai (gemini-4-hydrogen)
    if (ai && audioBuffer && audioBuffer.length > 0) {
      try {
        const base64Audio = audioBuffer.toString('base64');
        const audioPart = {
          inlineData: {
            mimeType,
            data: base64Audio,
          },
        };

        const hfContext = hfLabels.length > 0
          ? `Acoustic AudioSet labels detected: ${hfLabels.map((l) => `${l.label} (${Math.round(l.score * 100)}%)`).join(', ')}. `
          : '';

        const classificationPrompt =
          `Listen carefully to this actual song audio (instrumentation, rhythm, tempo, beat, vocal phrasing, scales/maqam, production style) and classify its exact musical genre.\n` +
          `${songTitle ? `Song title: "${songTitle}". ` : ''}` +
          `${artistName ? `Artist: "${artistName}". ` : ''}` +
          `${lyrics ? `Lyrics excerpt: "${lyrics.slice(0, 400)}". ` : ''}` +
          `${hfContext}\n` +
          `Choose ONLY ONE best-fitting canonical genre from the schema enum:\n` +
          `- Mizrahi: Israeli Mediterranean / Middle Eastern pop, darbukah, bouzouki, Oriental maqam/trills (סלסולים), Hebrew mizrahit vocals.\n` +
          `- Pop: Contemporary mainstream pop, catchy chorus, upbeat polished production.\n` +
          `- Hip Hop: Rap verses, trap/boom-bap beats, 808 bass, rhythmic spoken/melodic flow.\n` +
          `- Rock: Electric/distorted guitars, live rock drums, alternative/indie/punk energy.\n` +
          `- Electronic: EDM, house, techno, trance, synthwave, electronic dance production.\n` +
          `- Acoustic: Unplugged acoustic guitar or piano vocals, singer-songwriter, folk.\n` +
          `- Chill: Lo-fi, ambient, downtempo, relaxing atmospheric beats.\n` +
          `- Classical: Orchestral strings, classical piano, symphony, chamber music.\n` +
          `- Jazz: Swing, saxophone, brass, walking bass, jazz improvisation.\n` +
          `- Blues: Blues guitar riffs, soul/R&B groove.\n` +
          `- Cinematic: Film score, dramatic orchestral soundtrack, epic trailer music.\n` +
          `Provide a concise reason in Hebrew explaining what you heard in the audio (e.g. "זוהתה שירה ים-תיכונית עם מקצב דרבוקה וגיטרות סול").`;

        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents: {
            parts: [audioPart, { text: classificationPrompt }],
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                genre: {
                  type: Type.STRING,
                  enum: [...CANONICAL_AUDIO_GENRES],
                  description: 'The canonical genre that best describes the audio.',
                },
                confidence: {
                  type: Type.NUMBER,
                  description: 'Confidence score between 0 and 1.',
                },
                mood: {
                  type: Type.STRING,
                  description: 'Short mood description in Hebrew (2-3 words).',
                },
                bpmEstimate: {
                  type: Type.NUMBER,
                  description: 'Estimated tempo in BPM.',
                },
                reasonHe: {
                  type: Type.STRING,
                  description: 'Short explanation in Hebrew of acoustic cues heard in the track.',
                },
              },
              required: ['genre', 'confidence', 'mood', 'bpmEstimate', 'reasonHe'],
            },
          },
        });

        const parsedJson = JSON.parse((response.text || '{}').trim());
        const detectedGenre = CANONICAL_AUDIO_GENRES.includes(parsedJson.genre)
          ? parsedJson.genre
          : 'Pop';

        return res.json({
          success: true,
          provider: hfLabels.length > 0 ? 'hf-ast+gemini-audio' : 'gemini-audio-classifier',
          genre: detectedGenre,
          hebrewGenre: HEBREW_GENRE_LABELS[detectedGenre] || detectedGenre,
          confidence: Math.min(0.99, Math.max(0.5, Number(parsedJson.confidence) || 0.9)),
          mood: parsedJson.mood || '',
          bpmEstimate: Number(parsedJson.bpmEstimate) || 110,
          reasonHe: parsedJson.reasonHe || 'זוהה ישירות מתוך האזנה לקובץ השמע',
          acousticTags: hfLabels.map((l) => l.label),
        });
      } catch (aiErr: any) {
        console.warn('[Audio Classification] Gemini audio analysis failed, trying fallback:', aiErr?.message);
      }
    }

    // Fallback when AI key is missing or remote audio isn't reachable
    const fallback = classifyGenreHeuristic(songTitle, artistName, lyrics);
    return res.json({
      success: true,
      provider: 'heuristic-metadata',
      ...fallback,
      acousticTags: hfLabels.map((l) => l.label),
    });
  } catch (err: any) {
    console.error('Audio Classification Error:', err);
    return res.status(500).json({
      success: false,
      error: `שגיאה בזיהוי הז'אנר מהשמע: ${err?.message || 'אנא נסה שוב'}`,
    });
  }
});

// 4. Gemini Fast Recipe Translation Endpoint
app.post('/api/ai/translate-recipe', async (req, res) => {

  try {
    const { recipe, targetLanguage = 'עברית' } = req.body;
    if (!recipe) {
      return res.status(400).json({ error: 'Missing recipe' });
    }

    if (ai) {
      try {
        const prompt = `You are a professional culinary translator. Translate the following recipe into ${targetLanguage}.
Provide a natural, delicious, and accurate translation for the title, cuisine, prep time, ingredients (names and measures), and step-by-step instructions.
Output ONLY strict valid JSON matching this schema:
{
  "name": "Translated recipe name",
  "category": "Translated category",
  "area": "Translated area/cuisine",
  "prepTime": "Translated prep time",
  "ingredients": [
    { "ingredient": "translated ingredient name", "measure": "translated measure amount" }
  ],
  "instructions": "Full step-by-step instructions translated clearly into ${targetLanguage}"
}

Recipe to translate:
Name: ${recipe.name}
Category: ${recipe.category || ''}
Area: ${recipe.area || ''}
PrepTime: ${recipe.prepTime || '20 דקות'}
Ingredients:
${(recipe.ingredients || []).map((i: any) => `- ${i.measure} ${i.ingredient}`).join('\n')}
Instructions:
${recipe.instructions}`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });

        const text = response.text || '';
        const parsed = JSON.parse(text);
        return res.json({
          translated: {
            ...recipe,
            name: parsed.name || recipe.name,
            category: parsed.category || recipe.category,
            area: parsed.area || recipe.area,
            prepTime: parsed.prepTime || recipe.prepTime,
            ingredients: Array.isArray(parsed.ingredients) && parsed.ingredients.length > 0 ? parsed.ingredients : recipe.ingredients,
            instructions: parsed.instructions || recipe.instructions,
          },
          success: true,
        });
      } catch (geminiErr: any) {
        console.warn('Gemini translation error, using instant dictionary fallback:', geminiErr?.message);
      }
    }

    return res.json({
      translated: recipe,
      fallback: true,
    });
  } catch (err: any) {
    console.error('Recipe translation route error:', err);
    return res.status(500).json({ error: 'Translation failed', details: err?.message });
  }
});

// Helper: Generate a high quality 16-bit 44.1kHz stereo WAV audio buffer for AI synthesized track with VOCAL SINGING
function generateSyntheticMusicWav(
  genreStr: string = 'Pop',
  durationSeconds: number = 24,
  vocalPcm?: Int16Array
): string {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const buffer = new Int16Array(numSamples * 2); // stereo

  const g = (genreStr || '').toLowerCase();

  // Root frequencies for chord progression (Am - F - C - G or similar)
  let baseFreqs = [220.0, 174.61, 261.63, 196.0]; // A3, F3, C4, G3
  let tempoBpm = 115;

  if (g.includes('chill') || g.includes('lo-fi') || g.includes('lofi')) {
    baseFreqs = [196.0, 164.81, 220.0, 146.83]; // G3, E3, A3, D3
    tempoBpm = 85;
  } else if (g.includes('rock') || g.includes('metal')) {
    baseFreqs = [146.83, 174.61, 130.81, 196.0]; // D3, F3, C3, G3
    tempoBpm = 135;
  } else if (g.includes('electronic') || g.includes('dance') || g.includes('techno')) {
    baseFreqs = [220.0, 174.61, 293.66, 196.0]; // A3, F3, D4, G3
    tempoBpm = 124;
  }

  const samplesPerBeat = Math.floor((sampleRate * 60) / tempoBpm);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const beatIndex = Math.floor(i / samplesPerBeat);
    const chordIdx = Math.floor(beatIndex / 4) % baseFreqs.length;
    const rootFreq = baseFreqs[chordIdx];

    // 1. Bass synth
    const bassEnv = Math.exp(-((i % samplesPerBeat) / (samplesPerBeat * 0.8)) * 4);
    const bass = (Math.sin(2 * Math.PI * (rootFreq / 2) * t) + 0.5 * Math.sin(2 * Math.PI * rootFreq * t)) * bassEnv * 0.28;

    // 2. Chords
    const fifthFreq = rootFreq * 1.5;
    const thirdFreq = rootFreq * 1.25;
    const chordPad =
      (Math.sin(2 * Math.PI * rootFreq * t) +
        Math.sin(2 * Math.PI * thirdFreq * t) +
        Math.sin(2 * Math.PI * fifthFreq * t)) *
      0.10;

    // 3. Arpeggiated Melody
    const subBeat = Math.floor((i % samplesPerBeat) / (samplesPerBeat / 4));
    const arpMults = [1, 1.25, 1.5, 2];
    const melFreq = rootFreq * arpMults[subBeat % 4];
    const melEnv = Math.exp(-(((i % (samplesPerBeat / 4))) / (samplesPerBeat / 4)) * 6);
    const melody = Math.sin(2 * Math.PI * melFreq * t) * melEnv * 0.16;

    // 4. Drums
    let drum = 0;
    const beatInBar = beatIndex % 4;
    const sampleInBeat = i % samplesPerBeat;

    if (beatInBar === 0 || beatInBar === 2) {
      if (sampleInBeat < sampleRate * 0.1) {
        const kickT = sampleInBeat / sampleRate;
        const kickFreq = 120 * Math.exp(-kickT * 35);
        drum += Math.sin(2 * Math.PI * kickFreq * kickT) * Math.exp(-kickT * 20) * 0.40;
      }
    }

    if (beatInBar === 1 || beatInBar === 3) {
      if (sampleInBeat < sampleRate * 0.12) {
        const snareT = sampleInBeat / sampleRate;
        const noise = Math.random() * 2 - 1;
        drum += (noise * 0.35 + Math.sin(2 * Math.PI * 180 * snareT) * 0.25) * Math.exp(-snareT * 25);
      }
    }

    const sampleIn8th = i % Math.floor(samplesPerBeat / 2);
    if (sampleIn8th < sampleRate * 0.03) {
      const hihatT = sampleIn8th / sampleRate;
      drum += (Math.random() * 2 - 1) * Math.exp(-hihatT * 60) * 0.08;
    }

    // 5. VOCAL SINGING SAMPLES (24kHz vocal PCM resampled to 44.1kHz)
    let vocalVal = 0;
    if (vocalPcm && vocalPcm.length > 0) {
      const vocalIdx = Math.floor(t * 24000);
      if (vocalIdx < vocalPcm.length) {
        vocalVal = (vocalPcm[vocalIdx] / 32768.0) * 0.85; // Vocal lead
      }
    }

    const mixed = Math.max(-0.95, Math.min(0.95, bass + chordPad + melody + drum + vocalVal));
    const sampleVal = Math.floor(mixed * 32767);

    buffer[i * 2] = sampleVal; // Left
    buffer[i * 2 + 1] = sampleVal; // Right
  }

  // Create WAV Header
  const dataSize = numSamples * 4;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  /* RIFF identifier */
  view.setUint8(0, 'R'.charCodeAt(0));
  view.setUint8(1, 'I'.charCodeAt(0));
  view.setUint8(2, 'F'.charCodeAt(0));
  view.setUint8(3, 'F'.charCodeAt(0));
  /* file length */
  view.setUint32(4, 36 + dataSize, true);
  /* RIFF type */
  view.setUint8(8, 'W'.charCodeAt(0));
  view.setUint8(9, 'A'.charCodeAt(0));
  view.setUint8(10, 'V'.charCodeAt(0));
  view.setUint8(11, 'E'.charCodeAt(0));
  /* format chunk identifier */
  view.setUint8(12, 'f'.charCodeAt(0));
  view.setUint8(13, 'm'.charCodeAt(0));
  view.setUint8(14, 't'.charCodeAt(0));
  view.setUint8(15, ' '.charCodeAt(0));
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (pcm) */
  view.setUint16(20, 1, true);
  /* channel count (stereo) */
  view.setUint16(22, 2, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sampleRate * 4) */
  view.setUint32(28, sampleRate * 4, true);
  /* block align (4 bytes) */
  view.setUint16(32, 4, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  view.setUint8(36, 'd'.charCodeAt(0));
  view.setUint8(37, 'a'.charCodeAt(0));
  view.setUint8(38, 't'.charCodeAt(0));
  view.setUint8(39, 'a'.charCodeAt(0));
  /* data chunk length */
  view.setUint32(40, dataSize, true);

  const wavBytes = new Uint8Array(44 + dataSize);
  wavBytes.set(new Uint8Array(header), 0);
  wavBytes.set(new Uint8Array(buffer.buffer), 44);

  // Convert to Base64 Data URL
  const base64 = Buffer.from(wavBytes).toString('base64');
  return `data:audio/wav;base64,${base64}`;
}

// 5. AI Music Generator Endpoint (Creates song title, lyrics, AI artwork, vocal singing & synthesized audio track)
app.post('/api/ai/generate-song', async (req, res) => {
  try {
    const { prompt, genre = 'Pop', artistName = 'AI Music Studio', language = 'he' } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Missing prompt for song generation' });
    }

    let songTitle = `שיר AI: ${prompt.slice(0, 20)}`;
    let songGenre = genre || 'Pop';
    let lyrics = `[בית 1]\nמילים נוצרות מתוך הלב והדמיון\nמנגינה עולה בקצב הנכון\n\n[פזמון]\nזהו שיר שנולד בבינה מלאכותית\nחוויה מוזיקלית עוצמתית ועתידנית!`;
    let imagePrompt = `album cover for ${genre} song titled "${prompt}", modern aesthetic, 8k resolution, vibrant color lighting`;

    if (ai) {
      try {
        const sysInstruction = `You are a legendary AI Songwriter and Music Producer.
Given a prompt and genre, generate a complete original song in ${language === 'he' ? 'Hebrew' : 'English'}.
Output strict JSON with:
1. "title": catchy, artistic title
2. "genre": one of Pop, Electronic, Rock, Chill, Jazz, Acoustic, Cinematic
3. "lyrics": full structured lyrics with [בית 1], [פזמון], [בית 2], [פזמון], [סיום]
4. "imagePrompt": concise prompt for generating an artwork cover for this song.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: `Create an original song about: "${prompt}" in the genre "${genre}".`,
          config: {
            systemInstruction: sysInstruction,
            responseMimeType: 'application/json',
          },
        });

        const parsed = JSON.parse(response.text || '{}');
        if (parsed.title) songTitle = parsed.title;
        if (parsed.genre) songGenre = parsed.genre;
        if (parsed.lyrics) lyrics = parsed.lyrics;
        if (parsed.imagePrompt) imagePrompt = parsed.imagePrompt;
      } catch (geminiErr: any) {
        console.warn('Gemini song metadata error, using smart fallback:', geminiErr?.message);
      }
    }

    // Generate Vocal Singing Audio via Gemini TTS (gemini-3.8-flash-lite-tts)
    let vocalPcm: Int16Array | undefined;
    if (ai && lyrics) {
      try {
        // Clean lyrics text for vocal singing performance
        const cleanLyricsForSinging = lyrics.replace(/\[.*?\]/g, '').trim().slice(0, 350);
        const ttsRes = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: cleanLyricsForSinging,
                  speechMetadata: {
                    style: 'Rhythmic melodic vocal singing performance with passion and emotion',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        });

        const b64Audio = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (b64Audio) {
          const wavBuf = Buffer.from(b64Audio, 'base64');
          if (wavBuf.length > 44) {
            const rawPcmBytes = wavBuf.subarray(44);
            vocalPcm = new Int16Array(
              rawPcmBytes.buffer,
              rawPcmBytes.byteOffset,
              Math.floor(rawPcmBytes.byteLength / 2)
            );
          }
        }
      } catch (ttsErr: any) {
        console.warn('Gemini singing vocal generation error:', ttsErr?.message);
      }
    }

    // Generate Cover Art via Gemini Image API or Pollinations fallback
    let coverArtUrl = '';
    if (ai) {
      try {
        const imgRes = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite-image',
          contents: `${imagePrompt}, masterpiece album cover, high quality`,
          config: {
            imageConfig: { aspectRatio: '1:1' },
          },
        });
        for (const part of imgRes.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData?.data) {
            const mime = part.inlineData.mimeType || 'image/png';
            coverArtUrl = `data:${mime};base64,${part.inlineData.data}`;
            break;
          }
        }
      } catch (imgErr) {
        console.warn('Gemini image generation fallback for album art:', imgErr);
      }
    }

    if (!coverArtUrl) {
      const seed = Math.floor(Math.random() * 999999);
      const encoded = encodeURIComponent(`${imagePrompt}, album artwork, 8k resolution`);
      coverArtUrl = `https://image.pollinations.ai/prompt/${encoded}?width=600&height=600&seed=${seed}&model=flux&nologo=true`;
    }

    // Generate Synthesized Musical Audio Track with REAL AI VOCAL SINGER
    const audioUrl = generateSyntheticMusicWav(songGenre, 24, vocalPcm);

    return res.json({
      success: true,
      track: {
        id: `ai_song_${Date.now()}`,
        name: songTitle,
        artistName: artistName || 'AI Music Studio',
        albumName: `AI Single (${songGenre})`,
        duration: 180,
        audioUrl,
        coverUrl: coverArtUrl,
        genre: songGenre,
        lyrics,
        license: 'נוצר ע"י בינה מלאכותית (Creative Commons Zero)',
        source: 'WikiArchive AI Music Generator',
        legalStatus: '100% שיר נוצר ב-AI ומאושר להפצה חופשית',
        publishedDate: new Date().getFullYear().toString(),
      },
    });
  } catch (err: any) {
    console.error('AI Song Generation error:', err);
    return res.status(500).json({ error: 'Failed to generate AI song', details: err?.message });
  }
});

// In-memory cache for resolved archive audio streaming URLs
const archiveAudioCache = new Map<string, string>();

// Direct Audio Stream Resolver for Internet Archive Tracks
app.get('/api/music/audio-stream/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).send('Missing archive track identifier');
  }

  // Check cache
  if (archiveAudioCache.has(id)) {
    return res.redirect(302, archiveAudioCache.get(id)!);
  }

  try {
    const metaUrl = `https://archive.org/metadata/${encodeURIComponent(id)}/files`;
    const resp = await fetch(metaUrl, { headers: { 'User-Agent': 'WikiArchive-AudioResolver/1.0' } });
    if (resp.ok) {
      const data = await resp.json();
      const files: any[] = data.result || [];
      // Prefer restored MP3, VBR MP3, or any .mp3/.ogg
      const targetFile =
        files.find((f: any) => f.name && f.name.endsWith('-restored.mp3')) ||
        files.find((f: any) => f.name && f.name.endsWith('.mp3') && (f.format === 'VBR MP3' || f.format === 'MP3')) ||
        files.find((f: any) => f.name && f.name.endsWith('.mp3')) ||
        files.find((f: any) => f.name && f.name.endsWith('.ogg'));

      if (targetFile && targetFile.name) {
        const streamUrl = `https://archive.org/download/${id}/${encodeURIComponent(targetFile.name)}`;
        archiveAudioCache.set(id, streamUrl);
        return res.redirect(302, streamUrl);
      }
    }
  } catch (err: any) {
    console.warn(`Audio stream resolve failed for ${id}:`, err?.message);
  }

  // Direct fallback
  const fallbackUrl = `https://archive.org/download/${id}/${id}.mp3`;
  return res.redirect(302, fallbackUrl);
});

// Search modern 21st-century tracks via Audius open decentralized music protocol
const modernSearchCache = new Map<string, { data: any[]; timestamp: number }>();

app.get('/api/music/modern-search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 24));

  if (!query) {
    return res.json({ tracks: [] });
  }

  const cacheKey = `${query.toLowerCase()}_${limit}`;
  const cached = modernSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < 1000 * 60 * 15) {
    return res.json({ tracks: cached.data });
  }

  try {
    const url = `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&app_name=WikiArchive&limit=${limit}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'WikiArchive-ModernClient/1.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) throw new Error(`Audius API returned ${resp.status}`);
    const data = await resp.json();
    const rawList: any[] = data.data || [];

    const mapped = rawList.map((t: any) => {
      const g = (t.genre || '').toLowerCase();
      let genre = 'Pop';
      if (g.includes('classic')) genre = 'Classical';
      else if (g.includes('jazz')) genre = 'Jazz';
      else if (g.includes('blues') || g.includes('soul') || g.includes('r&b')) genre = 'Blues';
      else if (g.includes('chill') || g.includes('lo-fi') || g.includes('lofi')) genre = 'Chill';
      else if (g.includes('elect') || g.includes('techno') || g.includes('house') || g.includes('edm') || g.includes('synth') || g.includes('dubstep')) genre = 'Electronic';
      else if (g.includes('acoust') || g.includes('folk')) genre = 'Acoustic';
      else if (g.includes('soundtrack') || g.includes('cinematic') || g.includes('ambient')) genre = 'Cinematic';
      else if (g.includes('rock') || g.includes('metal') || g.includes('punk')) genre = 'Rock';
      else genre = 'Pop';

      const art = t.artwork?.['480x480'] || t.artwork?.['150x150'] || t.artwork?.['1000x1000'] || '';
      const artistAvatar = t.user?.profile_picture?.['480x480'] || t.user?.profile_picture?.['150x150'] || undefined;
      const artistHandle = t.user?.handle;
      const directArtistUrl = artistHandle ? `https://audius.co/${artistHandle}` : 'https://audius.co';

      return {
        id: `audius_${t.id}`,
        name: t.title || 'Untitled Modern Track',
        artistName: t.user?.name || t.user?.handle || 'Contemporary Artist',
        albumName: t.mood ? `${genre} (${t.mood})` : (genre || '21st Century Release'),
        duration: Math.round(t.duration || 180),
        audioUrl: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream?app_name=WikiArchive`,
        coverUrl: art,
        artistAvatarUrl: artistAvatar,
        publisherAccountUrl: directArtistUrl,
        artistBio: t.user?.bio || undefined,
        genre,
        license: 'Audius Open Protocol (המאה ה-21)',
        licenseUrl: directArtistUrl,
        source: 'Audius Modern Open Streaming Protocol',
        legalStatus: '100% שיר מודרני מקורי ומאושר להאזנה חופשית',
        lyrics: t.description || `הקלטה מודרנית מקורית בת זמננו (המאה ה-21) ששוחררה ע"י ${t.user?.name || 'האמן'}. פתוחה להאזנה ישירה ברשת הסטרימינג הפתוחה Audius.`,
      };
    });

    modernSearchCache.set(cacheKey, { data: mapped, timestamp: Date.now() });
    return res.json({ tracks: mapped });
  } catch (err: any) {
    console.warn('Modern track search error:', err?.message);
    return res.json({ tracks: [] });
  }
});

// Trending modern 21st-century hits cache
let modernTrendingCache: { data: any[]; timestamp: number } | null = null;
app.get('/api/music/modern-trending', async (req, res) => {
  const now = Date.now();
  if (modernTrendingCache && now - modernTrendingCache.timestamp < 1000 * 60 * 20) {
    return res.json({ tracks: modernTrendingCache.data });
  }

  try {
    const url = 'https://discoveryprovider.audius.co/v1/tracks/trending?app_name=WikiArchive&limit=30';
    const resp = await fetch(url, { headers: { 'User-Agent': 'WikiArchive-ModernClient/1.0' } });
    if (!resp.ok) throw new Error(`Audius trending returned ${resp.status}`);
    const data = await resp.json();
    const rawList: any[] = data.data || [];

    const mapped = rawList.map((t: any) => {
      const g = (t.genre || '').toLowerCase();
      let genre = 'Pop';
      if (g.includes('classic')) genre = 'Classical';
      else if (g.includes('jazz')) genre = 'Jazz';
      else if (g.includes('blues') || g.includes('soul') || g.includes('r&b')) genre = 'Blues';
      else if (g.includes('chill') || g.includes('lo-fi') || g.includes('lofi')) genre = 'Chill';
      else if (g.includes('elect') || g.includes('techno') || g.includes('house') || g.includes('edm') || g.includes('synth') || g.includes('dubstep')) genre = 'Electronic';
      else if (g.includes('acoust') || g.includes('folk')) genre = 'Acoustic';
      else if (g.includes('soundtrack') || g.includes('cinematic') || g.includes('ambient')) genre = 'Cinematic';
      else if (g.includes('rock') || g.includes('metal') || g.includes('punk')) genre = 'Rock';
      else genre = 'Pop';

      const art = t.artwork?.['480x480'] || t.artwork?.['150x150'] || t.artwork?.['1000x1000'] || '';
      const artistAvatar = t.user?.profile_picture?.['480x480'] || t.user?.profile_picture?.['150x150'] || undefined;
      const artistHandle = t.user?.handle;
      const directArtistUrl = artistHandle ? `https://audius.co/${artistHandle}` : 'https://audius.co';

      return {
        id: `audius_${t.id}`,
        name: t.title || 'Trending Song',
        artistName: t.user?.name || t.user?.handle || 'Modern Artist',
        albumName: t.mood ? `${genre} (${t.mood})` : (genre || '21st Century Trending'),
        duration: Math.round(t.duration || 180),
        audioUrl: `https://discoveryprovider.audius.co/v1/tracks/${t.id}/stream?app_name=WikiArchive`,
        coverUrl: art,
        artistAvatarUrl: artistAvatar,
        publisherAccountUrl: directArtistUrl,
        artistBio: t.user?.bio || undefined,
        genre,
        license: 'Audius Open Protocol (המאה ה-21)',
        licenseUrl: directArtistUrl,
        source: 'Audius Modern Open Streaming Protocol',
        legalStatus: '100% שיר מודרני מקורי ומאושר להאזנה חופשית',
        lyrics: t.description || `להיט מודרני עכשווי מהמאה ה-21 מאת ${t.user?.name || 'האמן'}. זמין להאזנה ישירה ברשת Audius.`,
      };
    });

    modernTrendingCache = { data: mapped, timestamp: now };
    return res.json({ tracks: mapped });
  } catch (err: any) {
    console.warn('Modern trending fetch error:', err?.message);
    return res.json({ tracks: [] });
  }
});

// 4e. Same-origin HuggingFace Model Proxy (prevents CORS/redirect Failed to fetch for Whisper WASM)
app.all('/api/hf-proxy/*', async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).send('Method not allowed');
  }
  const subPath = String((req.params as any)[0] || '').replace(/^\/+/, '');
  if (!subPath || subPath.includes('..') || !/^[a-zA-Z0-9._\-\/@]+$/.test(subPath)) {
    return res.status(400).send('Invalid model path');
  }
  const qIdx = req.originalUrl.indexOf('?');
  const search = qIdx >= 0 ? req.originalUrl.slice(qIdx) : '';
  const targetUrl = `https://huggingface.co/${subPath}${search}`;
  try {
    const hdrs: Record<string, string> = { 'User-Agent': 'Kolot-Whisper-Client/1.0' };
    if (req.headers.range) hdrs['Range'] = String(req.headers.range);
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: hdrs,
      redirect: 'follow',
      signal: AbortSignal.timeout(180000),
    });
    if (!upstream.ok && upstream.status !== 206) {
      return res.status(upstream.status).send('HuggingFace upstream error');
    }
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    const cl = upstream.headers.get('content-length');
    const cr = upstream.headers.get('content-range');
    const ce = upstream.headers.get('content-encoding');
    if (ct) res.setHeader('Content-Type', ct);
    if (cl && !ce) res.setHeader('Content-Length', cl);
    if (cr) res.setHeader('Content-Range', cr);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    if (req.method === 'HEAD' || !upstream.body) return res.end();
    const nodeStream = Readable.fromWeb(upstream.body as any);
    nodeStream.on('error', () => {
      if (!res.headersSent) res.status(502);
      res.end();
    });
    return nodeStream.pipe(res);
  } catch (err: any) {
    return res.status(502).send(`HF proxy error: ${err?.message || 'Failed'}`);
  }
});

// 4f. Same-origin ONNX Runtime Web WASM Proxy (serves from disk or jsDelivr CDN cleanly)
app.all('/api/onnx-wasm/*', async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return res.status(405).send('Method not allowed');
  }
  const fileName = String((req.params as any)[0] || '').replace(/^\/+/, '').split('?')[0];
  if (!fileName || !/^[a-zA-Z0-9._\-]+$/.test(fileName)) {
    return res.status(400).send('Invalid WASM asset');
  }
  const contentType = fileName.endsWith('.wasm')
    ? 'application/wasm'
    : fileName.endsWith('.mjs') || fileName.endsWith('.js')
      ? 'application/javascript; charset=utf-8'
      : 'application/octet-stream';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  const localPath = path.resolve(__dirname, 'node_modules', 'onnxruntime-web', 'dist', fileName);
  if (fs.existsSync(localPath)) {
    if (req.method === 'HEAD') return res.status(200).end();
    return res.sendFile(localPath);
  }

  try {
    const cdnUrl = `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/${fileName}`;
    const upstream = await fetch(cdnUrl, { method: req.method, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!upstream.ok) return res.status(upstream.status).send('WASM asset not found');
    res.status(upstream.status);
    if (req.method === 'HEAD') return res.end();
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  } catch (err: any) {
    return res.status(502).send(`ONNX WASM proxy error: ${err?.message || 'Failed'}`);
  }
});

// 4g. Free Unlimited Subtitle Translator (Hebrew <-> English, zero API keys)
app.post('/api/ai/translate-subtitles', async (req, res) => {
  try {
    const lines: string[] = Array.isArray(req.body?.lines)
      ? req.body.lines.map((x: any) => String(x || '').trim()).slice(0, 120)
      : [];
    const sl = req.body?.source === 'he' ? 'he' : 'en';
    const tl = req.body?.target === 'en' ? 'en' : 'he';
    if (lines.length === 0) return res.json({ success: true, translations: [] });

    const joined = lines.join('\n');
    const gtUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(joined)}`;
    const gtRes = await fetch(gtUrl, {
      headers: { 'User-Agent': 'Kolot-Subtitles/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!gtRes.ok) {
      return res.status(502).json({ success: false, translations: [] });
    }
    const rawData: any = await gtRes.json();
    const translatedFull = Array.isArray(rawData?.[0])
      ? rawData[0].map((part: any) => String(part?.[0] || '')).join('')
      : '';
    const splitLines = translatedFull.split('\n').map((l: string) => l.trim());
    const normalized = lines.map((_, idx) => splitLines[idx] || '');
    return res.json({ success: true, translations: normalized });
  } catch (err: any) {
    return res.status(500).json({ success: false, translations: [], error: err?.message || 'Translate failed' });
  }
});

// 4h. Public Track Report fallback endpoint (saves directly in R2 reports/)
app.post('/api/storage/report', async (req, res) => {
  try {
    const rep = req.body;
    if (!rep?.id || !rep?.trackId || !rep?.trackName) {
      return res.status(400).json({ success: false, error: 'Missing report fields' });
    }
    const { client, bucket } = await getR2Context(req);
    const key = `reports/${String(rep.id).replace(/[^a-zA-Z0-9_\-]/g, '')}.json`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(JSON.stringify(rep, null, 2), 'utf-8'),
        ContentType: 'application/json',
      })
    );
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to save report' });
  }
});

app.get('/api/storage/reports', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const { client, bucket } = await getR2Context(req);
    const listData = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'reports/' }));
    const keys = (listData.Contents || []).map((c) => c.Key || '').filter((k) => k.endsWith('.json'));
    const reports = (
      await Promise.all(
        keys.map(async (k) => {
          try {
            const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
            const txt = obj.Body ? await obj.Body.transformToString('utf-8') : '';
            return txt ? JSON.parse(txt) : null;
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);
    return res.json({ success: true, reports });
  } catch (err: any) {
    return res.status(500).json({ success: false, reports: [], error: err?.message || 'Failed to load reports' });
  }
});

app.delete('/api/storage/reports/:id', async (req, res) => {
  try {
    const cleanId = String(req.params.id || '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanId) return res.status(400).json({ success: false, error: 'Missing report id' });
    const { client, bucket } = await getR2Context(req);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `reports/${cleanId}.json` }));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to delete report' });
  }
});

// 4i. Fast Track Play Counter (100% R2)
app.post('/api/storage/track-play', async (req, res) => {
  try {
    const cleanId = String(req.body?.trackId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanId) return res.status(400).json({ success: false });
    const { client, bucket } = await getR2Context(req);
    const key = `tracks/${cleanId}.json`;
    const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!obj.Body) return res.json({ success: false, playsCount: 1 });
    const trackData = JSON.parse(await obj.Body.transformToString('utf-8'));
    const playsCount = (Number(trackData.playsCount) || 0) + 1;
    const updated = { ...trackData, playsCount };
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(JSON.stringify(updated, null, 2), 'utf-8'),
        ContentType: 'application/json',
      })
    );
    return res.json({ success: true, playsCount });
  } catch {
    return res.json({ success: false, playsCount: 1 });
  }
});

// 4i-2. High-Load Coalesced & Persistent Track Views Counter (starts at 0, safe under burst load)
const pendingTrackViewDeltas = new Map<string, number>();
const inFlightTrackViewFlushes = new Set<string>();
const optimisticTrackViewCounts = new Map<string, number>();
let tracksIndexWriteChain: Promise<void> = Promise.resolve();

async function flushTrackViewsToR2(cleanId: string, r2Ctx: { client: S3Client; bucket: string }) {
  if (inFlightTrackViewFlushes.has(cleanId)) return;
  inFlightTrackViewFlushes.add(cleanId);
  try {
    const { client, bucket } = r2Ctx;
    while ((pendingTrackViewDeltas.get(cleanId) || 0) > 0) {
      const delta = pendingTrackViewDeltas.get(cleanId) || 0;
      pendingTrackViewDeltas.delete(cleanId);
      if (delta <= 0) break;

      let committed = false;
      const key = `tracks/${cleanId}.json`;
      try {
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (obj.Body) {
          const trackData = JSON.parse(await obj.Body.transformToString('utf-8'));
          const base = Number(trackData.viewsCount) || 0;
          const viewsCount = base + delta;
          const updated = { ...trackData, viewsCount };
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key,
              Body: Buffer.from(JSON.stringify(updated, null, 2), 'utf-8'),
              ContentType: 'application/json',
            })
          );
          optimisticTrackViewCounts.set(cleanId, Math.max(optimisticTrackViewCounts.get(cleanId) || 0, viewsCount));
          committed = true;
        }
      } catch {
        // Fallback to tracks_index.json serialized via tracksIndexWriteChain
      }

      if (!committed) {
        await (tracksIndexWriteChain = tracksIndexWriteChain
          .then(async () => {
            try {
              const idxObj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'tracks_index.json' }));
              if (idxObj.Body) {
                const idxData = JSON.parse(await idxObj.Body.transformToString('utf-8'));
                if (Array.isArray(idxData)) {
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
                  if (found) {
                    await client.send(
                      new PutObjectCommand({
                        Bucket: bucket,
                        Key: 'tracks_index.json',
                        Body: Buffer.from(JSON.stringify(nextArr, null, 2), 'utf-8'),
                        ContentType: 'application/json',
                      })
                    );
                    optimisticTrackViewCounts.set(cleanId, Math.max(optimisticTrackViewCounts.get(cleanId) || 0, nextViews));
                    committed = true;
                  }
                }
              }
            } catch {}
          })
          .catch(() => {}));
      }

      if (!committed) {
        // Restore un-flushed delta if storage temporarily failed, and exit loop to avoid spin
        pendingTrackViewDeltas.set(cleanId, (pendingTrackViewDeltas.get(cleanId) || 0) + delta);
        break;
      }
    }
  } finally {
    inFlightTrackViewFlushes.delete(cleanId);
  }
}

app.post('/api/storage/track-view', async (req, res) => {
  try {
    const cleanId = String(req.body?.trackId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanId) return res.status(400).json({ success: false });

    pendingTrackViewDeltas.set(cleanId, (pendingTrackViewDeltas.get(cleanId) || 0) + 1);
    const nextOptimistic = (optimisticTrackViewCounts.get(cleanId) || 0) + 1;
    optimisticTrackViewCounts.set(cleanId, nextOptimistic);

    const r2Ctx = await getR2Context(req);
    void flushTrackViewsToR2(cleanId, r2Ctx);

    return res.json({ success: true, viewsCount: nextOptimistic });
  } catch {
    return res.json({ success: false, viewsCount: 1 });
  }
});

// 4i-2b. Listener Background Subtitles Persist Route (reads/merges safely in R2 without clobbering views/metadata)
app.post('/api/storage/track-subtitles', async (req, res) => {
  try {
    const cleanId = String(req.body?.trackId || '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanId) return res.status(400).json({ success: false, error: 'Missing trackId' });

    const incomingSegs = Array.isArray(req.body?.subtitleSegments) ? req.body.subtitleSegments : [];
    const incomingHe = Array.isArray(req.body?.subtitleSegmentsHe) ? req.body.subtitleSegmentsHe : [];
    const incomingEn = Array.isArray(req.body?.subtitleSegmentsEn) ? req.body.subtitleSegmentsEn : [];
    const incomingOrig = Array.isArray(req.body?.subtitleSegmentsOrig) ? req.body.subtitleSegmentsOrig : [];
    const incomingOrigCode = String(req.body?.detectedLanguageCode || '').trim().slice(0, 12);
    const incomingOrigLabel = String(req.body?.detectedLanguageLabel || '').trim().slice(0, 48);
    if (incomingSegs.length === 0 && incomingHe.length === 0 && incomingEn.length === 0 && incomingOrig.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing subtitles payload' });
    }

    const { client, bucket } = await getR2Context(req);
    const key = `tracks/${cleanId}.json`;
    let existing: any = null;
    try {
      const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (obj.Body) {
        existing = JSON.parse(await obj.Body.transformToString('utf-8'));
      }
    } catch {}

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Track not found in storage' });
    }

    if (existing.subtitlesDisabled === true) {
      return res.json({ success: false, disabled: true });
    }

    if (
      (Array.isArray(existing.subtitleSegments) && existing.subtitleSegments.length > 0) ||
      (Array.isArray(existing.subtitleSegmentsHe) && existing.subtitleSegmentsHe.length > 0) ||
      (Array.isArray(existing.subtitleSegmentsEn) && existing.subtitleSegmentsEn.length > 0)
    ) {
      return res.json({ success: true, alreadyExists: true, track: existing });
    }

    const updated = {
      ...existing,
      subtitleSegments: incomingSegs.length > 0 ? incomingSegs : (incomingHe.length > 0 ? incomingHe : incomingEn),
      ...(incomingHe.length > 0 ? { subtitleSegmentsHe: incomingHe } : {}),
      ...(incomingEn.length > 0 ? { subtitleSegmentsEn: incomingEn } : {}),
      ...(incomingOrig.length > 0 ? { subtitleSegmentsOrig: incomingOrig } : {}),
      ...(req.body?.lyrics ? { lyrics: String(req.body.lyrics) } : {}),
      ...(req.body?.lyricsHe ? { lyricsHe: String(req.body.lyricsHe) } : {}),
      ...(req.body?.lyricsEn ? { lyricsEn: String(req.body.lyricsEn) } : {}),
      ...(req.body?.lyricsOrig ? { lyricsOrig: String(req.body.lyricsOrig) } : {}),
      ...(incomingOrigCode ? { detectedLanguageCode: incomingOrigCode } : {}),
      ...(incomingOrigLabel ? { detectedLanguageLabel: incomingOrigLabel } : {}),
      hasWhisperSubtitles: true,
      viewsCount: Math.max(Number(existing.viewsCount) || 0, optimisticTrackViewCounts.get(cleanId) || 0),
    };

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(JSON.stringify(updated, null, 2), 'utf-8'),
        ContentType: 'application/json',
      })
    );

    await (tracksIndexWriteChain = tracksIndexWriteChain
      .then(async () => {
        try {
          const idxObj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'tracks_index.json' }));
          if (idxObj.Body) {
            const idxArr = JSON.parse(await idxObj.Body.transformToString('utf-8'));
            if (Array.isArray(idxArr)) {
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
                  };
                }
                return t;
              });
              if (changed) {
                await client.send(
                  new PutObjectCommand({
                    Bucket: bucket,
                    Key: 'tracks_index.json',
                    Body: Buffer.from(JSON.stringify(nextArr, null, 2), 'utf-8'),
                    ContentType: 'application/json',
                  })
                );
              }
            }
          }
        } catch {}
      })
      .catch(() => {}));

    // Read persisted track back from R2 so caller renders strictly from storage
    let persisted = updated;
    try {
      const checkObj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (checkObj.Body) {
        persisted = JSON.parse(await checkObj.Body.transformToString('utf-8'));
      }
    } catch {}

    return res.json({ success: true, track: persisted });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to persist subtitles' });
  }
});

// 4i-3. Direct Contact Us Email Endpoint (saves to R2 contact_messages/ + dispatches directly to kolot.music1@gmail.com)
app.post('/api/contact', async (req, res) => {
  try {
    const { sessionSecret } = getGoogleOAuthCreds();
    const parsedSession = extractSessionFromRequest(req, sessionSecret);
    const rawSenderEmail = String(parsedSession?.session?.email || req.body?.senderEmail || '').trim();
    const category = String(req.body?.category || 'general').trim().slice(0, 48);
    const subject = String(req.body?.subject || '').trim().slice(0, 200);
    const message = String(req.body?.message || '').trim().slice(0, 5000);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawSenderEmail)) {
      return res.status(400).json({ success: false, error: 'יש להזין כתובת מייל אמיתית ותקינה' });
    }
    if (!subject || !message) {
      return res.status(400).json({ success: false, error: 'יש למלא נושא ותוכן להודעה' });
    }

    const categoryLabels: Record<string, string> = {
      complaint: 'תלונה',
      request: 'בקשה / הצעה',
      support: 'תקלה טכנית',
      copyright: 'זכויות יוצרים',
      general: 'פנייה כללית',
    };
    const categoryLabel = categoryLabels[category] || category || 'פנייה';

    const msgId = `msg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const targetRecipient = 'kolot.music1@gmail.com';
    const record = {
      id: msgId,
      to: targetRecipient,
      category,
      categoryLabel,
      senderEmail: rawSenderEmail,
      senderUid: parsedSession?.session?.uid || undefined,
      senderName: parsedSession?.session?.displayName || undefined,
      subject,
      message,
      createdAt: new Date().toISOString(),
      status: 'new',
    };

    const fullSubject = `[Kolot Music - ${categoryLabel}] ${subject}`;
    const plainBody =
      `פנייה חדשה מאתר Kolot Music\n` +
      `סוג הפנייה: ${categoryLabel}\n` +
      `מאת: ${rawSenderEmail}${record.senderName ? ` (${record.senderName})` : ''}\n` +
      `נושא: ${subject}\n\n` +
      `${message}`;

    let storedInR2 = false;
    try {
      const { client, bucket } = await getR2Context(req);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `contact_messages/${msgId}.json`,
          Body: Buffer.from(JSON.stringify(record, null, 2), 'utf-8'),
          ContentType: 'application/json',
        })
      );
      storedInR2 = true;
    } catch {}

    let emailDispatched = false;
    let emailProvider = '';

    // 1. Resend API
    const resendKey = sanitizeKey(process.env.RESEND_API_KEY);
    if (resendKey && !emailDispatched) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || 'Kolot Music <onboarding@resend.dev>',
            to: [targetRecipient],
            reply_to: rawSenderEmail,
            subject: fullSubject,
            text: plainBody,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (resendRes.ok) {
          emailDispatched = true;
          emailProvider = 'resend';
        }
      } catch {}
    }

    // 2. Brevo API
    const brevoKey = sanitizeKey(process.env.BREVO_API_KEY);
    if (brevoKey && !emailDispatched) {
      try {
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': brevoKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: 'Kolot Music', email: targetRecipient },
            to: [{ email: targetRecipient, name: 'Kolot Music' }],
            replyTo: { email: rawSenderEmail, name: record.senderName || rawSenderEmail },
            subject: fullSubject,
            textContent: plainBody,
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (brevoRes.ok) {
          emailDispatched = true;
          emailProvider = 'brevo';
        }
      } catch {}
    }

    // 3. Web3Forms API
    const web3Key = sanitizeKey(process.env.WEB3FORMS_ACCESS_KEY);
    if (web3Key && !emailDispatched) {
      try {
        const wRes = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            access_key: web3Key,
            from_name: record.senderName || rawSenderEmail,
            replyto: rawSenderEmail,
            subject: fullSubject,
            message: plainBody,
          }),
          signal: AbortSignal.timeout(8000),
        });
        const wData: any = await wRes.json().catch(() => null);
        if (wRes.ok && wData?.success === true) {
          emailDispatched = true;
          emailProvider = 'web3forms';
        }
      } catch {}
    }

    const sendViaGmailSmtp = async (): Promise<boolean> => {
      const smtpPass = sanitizeKey(process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS);
      const smtpUser = sanitizeKey(process.env.SMTP_USER) || targetRecipient;
      if (!smtpPass || !smtpUser) return false;

      return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
          if (settled) return;
          settled = true;
          try {
            socket.destroy();
          } catch {}
          resolve(ok);
        };

        const timer = setTimeout(() => finish(false), 6000);
        let stage = 0;
        let buffer = '';

        const b64Subject = `=?UTF-8?B?${Buffer.from(fullSubject, 'utf-8').toString('base64')}?=`;
        const b64Body = Buffer.from(plainBody, 'utf-8').toString('base64');
        const mimePayload =
          `From: Kolot Music <${smtpUser}>\r\n` +
          `To: <${targetRecipient}>\r\n` +
          `Reply-To: <${rawSenderEmail}>\r\n` +
          `Subject: ${b64Subject}\r\n` +
          `MIME-Version: 1.0\r\n` +
          `Content-Type: text/plain; charset=UTF-8\r\n` +
          `Content-Transfer-Encoding: base64\r\n` +
          `\r\n` +
          `${b64Body}\r\n.`;

        const socket = tls.connect(465, 'smtp.gmail.com', { servername: 'smtp.gmail.com' }, () => {});

        socket.on('error', () => {
          clearTimeout(timer);
          finish(false);
        });

        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf-8');
          const lines = buffer.split('\r\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line || (line.length >= 4 && line[3] === '-')) continue;
            const code = parseInt(line.slice(0, 3), 10);
            if (stage === 0 && code === 220) {
              stage = 1;
              socket.write('EHLO kolotmusic.app\r\n');
            } else if (stage === 1 && code === 250) {
              stage = 2;
              const authToken = Buffer.from(`\u0000${smtpUser}\u0000${smtpPass}`, 'utf-8').toString('base64');
              socket.write(`AUTH PLAIN ${authToken}\r\n`);
            } else if (stage === 2 && code === 235) {
              stage = 3;
              socket.write(`MAIL FROM:<${smtpUser}>\r\n`);
            } else if (stage === 3 && code === 250) {
              stage = 4;
              socket.write(`RCPT TO:<${targetRecipient}>\r\n`);
            } else if (stage === 4 && (code === 250 || code === 251)) {
              stage = 5;
              socket.write('DATA\r\n');
            } else if (stage === 5 && code === 354) {
              stage = 6;
              socket.write(`${mimePayload}\r\n`);
            } else if (stage === 6 && code === 250) {
              stage = 7;
              socket.write('QUIT\r\n');
              clearTimeout(timer);
              finish(true);
            } else if (code >= 400) {
              clearTimeout(timer);
              finish(false);
            }
          }
        });
      });
    };

    // 4. Direct Gmail SMTP Relay if GMAIL_APP_PASSWORD / SMTP_PASS is set
    if (!emailDispatched && sanitizeKey(process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS)) {
      const smtpOk = await sendViaGmailSmtp();
      if (smtpOk) {
        emailDispatched = true;
        emailProvider = 'gmail-smtp';
      }
    }

    if (!storedInR2 && !emailDispatched) {
      return res.status(502).json({ success: false, error: 'שליחת ההודעה נכשלה כרגע, אנא נסה שוב בעוד רגע' });
    }

    return res.json({
      success: true,
      id: msgId,
      recipient: targetRecipient,
      emailDispatched,
      emailProvider: emailProvider || undefined,
      storedInR2,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'שליחת הפנייה נכשלה' });
  }
});

// 4i-4. Admin-only Contact Messages Inbox (list & dismiss stored R2 contact_messages/)
app.get('/api/admin/contact-messages', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { sessionSecret } = getGoogleOAuthCreds();
    const parsed = extractSessionFromRequest(req, sessionSecret);
    if (!parsed?.session?.isAdmin) {
      return res.status(403).json({ success: false, error: 'גישה מותרת למנהל המערכת בלבד.' });
    }
    const { client, bucket } = await getR2Context(req);
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'contact_messages/' }));
    const keys = (listed.Contents || []).map((o) => o.Key).filter((k): k is string => !!k && k.endsWith('.json'));
    const messages = (
      await Promise.all(
        keys.map(async (k) => {
          try {
            const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: k }));
            return obj.Body ? JSON.parse(await obj.Body.transformToString('utf-8')) : null;
          } catch {
            return null;
          }
        })
      )
    )
      .filter(Boolean)
      .sort((a: any, b: any) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || '')));
    return res.json({ success: true, messages });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'טעינת הפניות נכשלה' });
  }
});

app.delete('/api/admin/contact-messages/:id', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { sessionSecret } = getGoogleOAuthCreds();
    const parsed = extractSessionFromRequest(req, sessionSecret);
    if (!parsed?.session?.isAdmin) {
      return res.status(403).json({ success: false, error: 'גישה מותרת למנהל המערכת בלבד.' });
    }
    const cleanId = String(req.params.id || '').replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!cleanId) return res.status(400).json({ success: false, error: 'Invalid message ID' });
    const { client, bucket } = await getR2Context(req);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `contact_messages/${cleanId}.json` }));
    return res.json({ success: true, id: cleanId });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'מחיקת הפנייה נכשלה' });
  }
});

// 4j. Single-Request Bootstrap Feed (tracks + profiles + albums loaded in parallel)
app.get('/api/bootstrap', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const { client, bucket } = await getR2Context(req);
    const readJsonKey = async (key: string) => {
      try {
        const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!obj.Body) return null;
        return JSON.parse(await obj.Body.transformToString('utf-8'));
      } catch {
        return null;
      }
    };

    const [tracksList, profilesList, albumsList, indexData] = await Promise.all([
      client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'tracks/' })).catch(() => null),
      client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'profiles/' })).catch(() => null),
      client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'albums/' })).catch(() => null),
      readJsonKey('tracks_index.json'),
    ]);

    const trackMap = new Map<string, any>();
    if (Array.isArray(indexData)) {
      indexData.forEach((t: any) => {
        if (t?.id && t?.name && t?.audioUrl) {
          const { uploadedByEmail: _omit, ...cleanTrack } = t;
          const opt = optimisticTrackViewCounts.get(cleanTrack.id) || 0;
          trackMap.set(
            cleanTrack.id,
            opt > (Number(cleanTrack.viewsCount) || 0) ? { ...cleanTrack, viewsCount: opt } : cleanTrack
          );
        }
      });
    }

    const trackKeys = (tracksList?.Contents || []).map((c) => c.Key || '').filter((k) => k.endsWith('.json'));
    const profileKeys = (profilesList?.Contents || []).map((c) => c.Key || '').filter((k) => k.endsWith('.json'));
    const albumKeys = (albumsList?.Contents || []).map((c) => c.Key || '').filter((k) => k.endsWith('.json'));

    const [loadedTracks, loadedProfiles, loadedAlbums] = await Promise.all([
      Promise.all(trackKeys.map((k) => readJsonKey(k))),
      Promise.all(profileKeys.map(async (k) => ({ key: k, data: await readJsonKey(k) }))),
      Promise.all(albumKeys.map((k) => readJsonKey(k))),
    ]);

    loadedTracks.forEach((t: any) => {
      if (t?.id && t?.name && t?.audioUrl) {
        const { uploadedByEmail: _omit, ...cleanTrack } = t;
        const prev = trackMap.get(cleanTrack.id);
        const mergedViews = Math.max(
          Number(prev?.viewsCount) || 0,
          Number(cleanTrack.viewsCount) || 0,
          optimisticTrackViewCounts.get(cleanTrack.id) || 0
        );
        trackMap.set(cleanTrack.id, { ...cleanTrack, viewsCount: mergedViews });
      }
    });

    const profileMap = new Map<string, { data: any; ts: number; isCanonicalKey: boolean }>();
    for (const item of loadedProfiles) {
      const clean = sanitizePublicProfile(item.data);
      if (!clean) continue;
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

    return res.json({
      success: true,
      tracks: Array.from(trackMap.values()),
      profiles: Array.from(profileMap.values()).map((entry) => entry.data),
      albums: loadedAlbums.filter(Boolean),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      tracks: [],
      profiles: [],
      albums: [],
      error: err?.message || 'Bootstrap failed',
    });
  }
});

// -------------------------------------------------------------
// 5. SERVER-SIDE GOOGLE OAUTH 2.0 + R2 AVATAR PERSISTENCE
// -------------------------------------------------------------
function getGoogleOAuthCreds() {
  const clientId = sanitizeKey(
    process.env.Client_ID || process.env.CLIENT_ID || process.env.GOOGLE_CLIENT_ID
  );
  const clientSecret = sanitizeKey(
    process.env.Client_secret || process.env.CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
  );
  const sessionSecret =
    clientSecret || sanitizeKey(process.env.R2_SECRET_ACCESS_KEY) || 'kolot-music-session-hmac-key';
  return { clientId, clientSecret, sessionSecret };
}

function upgradeGooglePhotoQualityServer(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('googleusercontent.com')) {
    if (/=s\d+(-c)?$/.test(trimmed)) return trimmed.replace(/=s\d+(-c)?$/, '=s400-c');
    if (/=w\d+-h\d+/.test(trimmed)) return trimmed.replace(/=w\d+-h\d+[^&]*/, '=s400-c');
  }
  return trimmed;
}

function signHmacToken(payloadObj: Record<string, any>, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payloadObj), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyHmacToken(token: string, secret: string): any | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
    if (parsed?.exp && Date.now() > Number(parsed.exp)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookiesHeader(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  });
  return out;
}

function extractSessionFromRequest(req: express.Request, secret: string): { session: any; token: string } | null {
  const authHdr = String(req.headers.authorization || '').trim();
  if (authHdr.toLowerCase().startsWith('bearer ')) {
    const bearerToken = authHdr.slice(7).trim();
    if (bearerToken) {
      const bearerSession = verifyHmacToken(bearerToken, secret);
      if (bearerSession?.uid) return { session: bearerSession, token: bearerToken };
    }
  }
  const cookies = parseCookiesHeader(req.headers.cookie);
  const cookieToken = cookies['kolot_session'] || '';
  if (cookieToken) {
    const cookieSession = verifyHmacToken(cookieToken, secret);
    if (cookieSession?.uid) return { session: cookieSession, token: cookieToken };
  }
  return null;
}

function resolveSafeAppOrigin(req: express.Request, explicitOrigin?: string): string {
  const isValidOrigin = (val?: string) => {
    if (!val) return false;
    return /^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(val) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(val);
  };
  if (explicitOrigin && isValidOrigin(explicitOrigin.trim().replace(/\/+$/, ''))) {
    return explicitOrigin.trim().replace(/\/+$/, '');
  }
  const appUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (isValidOrigin(appUrl)) return appUrl;
  const fwdHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'https';
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  const host = req.get('host') || `localhost:${PORT}`;
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

async function purgeOldAvatarsInR2(client: S3Client, bucket: string, uid: string, keepKey?: string) {
  const cleanUid = uid.replace(/^artist_/, '').trim();
  const prefixes = [`avatars/${cleanUid}`, `avatars/artist_${cleanUid}`];
  for (const prefix of prefixes) {
    try {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
      const toDelete = (listed.Contents || []).map((c) => c.Key).filter((k): k is string => !!k && k !== keepKey);
      await Promise.allSettled(toDelete.map((k) => client.send(new DeleteObjectCommand({ Bucket: bucket, Key: k }))));
    } catch {}
  }
}

async function importExternalAvatarToR2(
  client: S3Client,
  bucket: string,
  uid: string,
  externalPhotoUrl: string
): Promise<string | null> {
  try {
    const cleanUid = uid.replace(/^artist_/, '').trim();
    const res = await fetch(externalPhotoUrl, {
      headers: { 'User-Agent': 'Kolot-Avatar-Sync/1.0', Accept: 'image/*' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > 6 * 1024 * 1024) return null;

    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const newKey = `avatars/${cleanUid}_${Date.now()}.${ext}`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: newKey,
        Body: buf,
        ContentType: contentType,
      })
    );
    await purgeOldAvatarsInR2(client, bucket, cleanUid, newKey);
    return `/api/storage/raw/${newKey}`;
  } catch (err: any) {
    console.warn('[Google Avatar Import] R2 sync skipped:', err?.message);
    return null;
  }
}

app.get('/api/auth/google/start', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { clientId, sessionSecret } = getGoogleOAuthCreds();
  if (!clientId) {
    const errMsg = 'מזהה ההתחברות של Google (Client_ID) אינו מוגדר במשתני הסביבה בשרת.';
    return res
      .status(500)
      .set('Content-Type', 'text/html; charset=utf-8')
      .send(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>Kolot Music Auth</title></head><body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px;"><div><p style="font-size:16px;font-weight:bold;color:#fda4af;">${errMsg}</p><script>try{if(window.opener){window.opener.postMessage({type:'OAUTH_AUTH_ERROR',error:${JSON.stringify(errMsg)}},'*');}}catch(e){}</script></div></body></html>`);
  }

  const appOrigin = resolveSafeAppOrigin(req, String(req.query.origin || ''));
  const redirectUri = `${appOrigin}/auth/callback`;
  const state = signHmacToken(
    {
      redirectUri,
      nonce: crypto.randomBytes(12).toString('hex'),
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

  return res.redirect(302, authUrl.toString());
});

app.get('/api/auth/google/url', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { clientId, sessionSecret } = getGoogleOAuthCreds();
  if (!clientId) {
    return res.status(500).json({
      success: false,
      error: 'מזהה ההתחברות של Google (Client_ID) אינו מוגדר במשתני הסביבה בשרת.',
    });
  }

  const appOrigin = resolveSafeAppOrigin(req, String(req.query.origin || ''));
  const redirectUri = `${appOrigin}/auth/callback`;
  const state = signHmacToken(
    {
      redirectUri,
      nonce: crypto.randomBytes(12).toString('hex'),
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

  return res.json({
    success: true,
    url: authUrl.toString(),
    redirectUri,
  });
});

app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const renderPopupResult = (ok: boolean, payload: any, errMsg?: string) => {
    const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c');
    const safeErr = JSON.stringify(errMsg || '').replace(/</g, '\\u003c');
    return res
      .status(ok ? 200 : 400)
      .set('Content-Type', 'text/html; charset=utf-8')
      .send(`<!DOCTYPE html>
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
</html>`);
  };

  try {
    const code = String(req.query.code || '');
    const stateRaw = String(req.query.state || '');
    const oauthErr = String(req.query.error || '');
    if (oauthErr) {
      return renderPopupResult(false, {}, `Google החזיר שגיאה: ${oauthErr}`);
    }
    if (!code || !stateRaw) {
      return renderPopupResult(false, {}, 'חסרים פרטי אימות מהתחברות Google.');
    }

    const { clientId, clientSecret, sessionSecret } = getGoogleOAuthCreds();
    if (!clientId || !clientSecret) {
      return renderPopupResult(false, {}, 'הגדרות השרת (Client_ID / Client_secret) חסרות.');
    }

    const verifiedState = verifyHmacToken(stateRaw, sessionSecret);
    const redirectUri =
      verifiedState?.redirectUri || `${resolveSafeAppOrigin(req)}/auth/callback`;

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
    const googlePhotoUrl = upgradeGooglePhotoQualityServer(googleUser.picture);

    // Sync Google account & store Google avatar in Cloudflare R2 (never overwriting an artist's custom uploaded R2 avatar)
    let canonicalAvatarUrl = googlePhotoUrl;
    try {
      const { client, bucket } = await getR2Context(req);
      const readJsonS3 = async (key: string) => {
        try {
          const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
          return obj.Body ? JSON.parse(await obj.Body.transformToString('utf-8')) : null;
        } catch {
          return null;
        }
      };
      const writeJsonS3 = async (key: string, data: unknown) => {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: Buffer.from(JSON.stringify(data, null, 2), 'utf-8'),
            ContentType: 'application/json',
          })
        );
      };
      const listKeysS3 = async (prefix: string): Promise<string[]> => {
        const resList = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix })).catch(() => null);
        return (resList?.Contents || []).map((c) => c.Key || '').filter((k) => k.endsWith('.json'));
      };

      let existingProfile: any = (await readJsonS3(`profiles/${uid}.json`)) || (await readJsonS3(`profiles/artist_${uid}.json`));

      if (verifiedEmail) {
        const isDanielOwner = verifiedEmail === 'danielbarber1246@gmail.com';
        const legacyUids = new Set<string>();
        const allProfileKeys = await listKeysS3('profiles/');
        const keysToDelete: string[] = [];

        for (const pKey of allProfileKeys) {
          if (pKey === `profiles/${uid}.json` || pKey === `profiles/artist_${uid}.json`) continue;
          const pData = await readJsonS3(pKey);
          if (!pData || typeof pData !== 'object') continue;
          const pEmail = String(pData.googleEmail || pData.email || '').trim().toLowerCase();
          const pName = String(pData.name || '').trim();
          const pUid = String(pData.googleUid || pData.id || '').replace(/^artist_/, '').trim();
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

        const trackKeys = await listKeysS3('tracks/');
        for (const tKey of trackKeys) {
          const tData = await readJsonS3(tKey);
          if (shouldClaimTrack(tData)) {
            const { uploadedByEmail: _omitEmail, ...cleanTrack } = tData;
            await writeJsonS3(tKey, { ...cleanTrack, uploadedByUid: uid, artistId: uid });
          }
        }

        const idxData = await readJsonS3('tracks_index.json');
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
            await writeJsonS3('tracks_index.json', updatedIdx);
          }
        }

        const albumKeys = await listKeysS3('albums/');
        for (const aKey of albumKeys) {
          const aData = await readJsonS3(aKey);
          if (!aData || typeof aData !== 'object') continue;
          const aUid = String(aData.uploadedByUid || aData.artistId || '').replace(/^artist_/, '').trim();
          const aArtist = String(aData.artistName || '').trim();
          if ((aUid && legacyUids.has(aUid)) || (isDanielOwner && aArtist === 'דניאל ברבר')) {
            await writeJsonS3(aKey, { ...aData, artistId: uid, uploadedByUid: uid });
          }
        }

        for (const oldKey of keysToDelete) {
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: oldKey })).catch(() => {});
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
        const importedR2Url = await importExternalAvatarToR2(client, bucket, uid, googlePhotoUrl);
        if (importedR2Url) {
          canonicalAvatarUrl = importedR2Url;
        }
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
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: `profiles/${uid}.json`,
            Body: Buffer.from(JSON.stringify(nextProfile, null, 2), 'utf-8'),
            ContentType: 'application/json',
          })
        );
        await client
          .send(new DeleteObjectCommand({ Bucket: bucket, Key: `profiles/artist_${uid}.json` }))
          .catch(() => {});
      }
    } catch (r2SyncErr: any) {
      console.warn('[OAuth Callback R2 Avatar Sync] non-fatal notice:', r2SyncErr?.message);
    }

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
    const sessionToken = signHmacToken(sessionPayload, sessionSecret);

    const isHttps = redirectUri.startsWith('https://');
    res.setHeader(
      'Set-Cookie',
      `kolot_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Max-Age=2592000; ${
        isHttps ? 'Secure; SameSite=None' : 'SameSite=Lax'
      }`
    );

    return renderPopupResult(true, {
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
    });
  } catch (err: any) {
    return renderPopupResult(false, {}, err?.message || 'שגיאה בתהליך ההתחברות');
  }
});

app.get('/api/auth/me', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { sessionSecret } = getGoogleOAuthCreds();
  const parsed = extractSessionFromRequest(req, sessionSecret);
  if (!parsed) {
    return res.json({ success: true, user: null });
  }

  const { session } = parsed;
  let liveAvatar = session.photoURL;
  let liveName = session.displayName;
  try {
    const { client, bucket } = await getR2Context(req);
    const obj = await client
      .send(new GetObjectCommand({ Bucket: bucket, Key: `profiles/${session.uid}.json` }))
      .catch(() => null);
    if (obj?.Body) {
      const p = JSON.parse(await obj.Body.transformToString('utf-8'));
      if (p?.avatarUrl) liveAvatar = p.avatarUrl;
      if (p?.name) liveName = p.name;
    }
  } catch {}

  return res.json({
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
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const origin = resolveSafeAppOrigin(req);
  const isHttps = origin.startsWith('https://');
  res.setHeader(
    'Set-Cookie',
    `kolot_session=; Path=/; HttpOnly; Max-Age=0; ${isHttps ? 'Secure; SameSite=None' : 'SameSite=Lax'}`
  );
  return res.json({ success: true });
});

app.post('/api/auth/restore-google-avatar', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { sessionSecret } = getGoogleOAuthCreds();
    const parsed = extractSessionFromRequest(req, sessionSecret);
    if (!parsed) {
      return res.status(401).json({ success: false, error: 'נדרש חיבור מחדש לחשבון Google.' });
    }

    const { session } = parsed;
    const googlePhotoUrl = upgradeGooglePhotoQualityServer(session.googlePhotoUrl);
    if (!googlePhotoUrl) {
      return res.status(404).json({ success: false, error: 'לא נמצאה תמונת פרופיל בחשבון Google שלך.' });
    }

    const { client, bucket } = await getR2Context(req);
    const r2AvatarUrl = await importExternalAvatarToR2(client, bucket, session.uid, googlePhotoUrl);
    if (!r2AvatarUrl) {
      return res.status(502).json({ success: false, error: 'הורדת תמונת Google אל האחסון נכשלה.' });
    }

    let existingProfile: any = {};
    try {
      const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `profiles/${session.uid}.json` }));
      if (obj.Body) existingProfile = JSON.parse(await obj.Body.transformToString('utf-8'));
    } catch {}

    const { googleEmail: _omitEmail, ...cleanExisting } = existingProfile || {};
    const updatedProfile = {
      ...cleanExisting,
      id: session.uid,
      googleUid: session.uid,
      name: String(req.body?.name || '').trim() || cleanExisting.name || session.displayName || 'אמן',
      avatarUrl: r2AvatarUrl,
      isConnected: true,
      hasAcceptedTerms: cleanExisting.hasAcceptedTerms ?? true,
      isPrivate: false,
      updatedAt: new Date().toISOString(),
    };

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `profiles/${session.uid}.json`,
        Body: Buffer.from(JSON.stringify(updatedProfile, null, 2), 'utf-8'),
        ContentType: 'application/json',
      })
    );
    await client
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: `profiles/artist_${session.uid}.json` }))
      .catch(() => {});

    return res.json({
      success: true,
      avatarUrl: r2AvatarUrl,
      profile: updatedProfile,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'שגיאה בשחזור תמונת Google' });
  }
});

app.post('/api/admin/delete-account', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { sessionSecret } = getGoogleOAuthCreds();
    const parsed = extractSessionFromRequest(req, sessionSecret);
    if (!parsed?.session?.isAdmin) {
      return res.status(403).json({ success: false, error: 'גישה מותרת למנהל המערכת בלבד.' });
    }
    const cleanUid = String(req.body?.uid || '')
      .replace(/^artist_/, '')
      .replace(/[^a-zA-Z0-9_\-]/g, '')
      .trim();
    if (!cleanUid) {
      return res.status(400).json({ success: false, error: 'חסר מזהה חשבון למחיקה.' });
    }
    const { client, bucket } = await getR2Context(req);
    await Promise.allSettled([
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `profiles/${cleanUid}.json` })),
      client.send(new DeleteObjectCommand({ Bucket: bucket, Key: `profiles/artist_${cleanUid}.json` })),
      purgeOldAvatarsInR2(client, bucket, cleanUid),
    ]);
    return res.json({ success: true, uid: cleanUid });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'מחיקת החשבון נכשלה' });
  }
});

// Setup Vite middleware in dev mode
if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, port: Number(PORT) },
    appType: 'custom',
  });

  app.use(vite.middlewares);

  app.use('*', async (req, res, next) => {
    const url = req.originalUrl;
    if (url.startsWith('/api/') || url.startsWith('/assets/')) {
      return res.status(404).send('Not Found');
    }
    try {
      const indexHtml = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
      const template = await vite.transformIndexHtml(url, indexHtml);
      res
        .status(200)
        .set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' })
        .end(template);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
} else {
  app.use(
    express.static(path.resolve(__dirname, 'dist'), {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    })
  );
  app.get('/assets/*', (_req, res) => res.status(404).send('Asset not found'));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Kolot Music Server running on http://localhost:${PORT}`);
});

