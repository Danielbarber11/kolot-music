let cachedAiStatus: { aiConfigured: boolean; ts: number } | null = null;
let inFlightAiStatusPromise: Promise<boolean> | null = null;

export function primeServerAiStatus(aiConfigured: boolean): void {
  cachedAiStatus = { aiConfigured: Boolean(aiConfigured), ts: Date.now() };
}

export async function isServerAiConfigured(): Promise<boolean> {
  if (cachedAiStatus && Date.now() - cachedAiStatus.ts < 300000) {
    return cachedAiStatus.aiConfigured;
  }
  if (inFlightAiStatusPromise) {
    return inFlightAiStatusPromise;
  }
  inFlightAiStatusPromise = (async () => {
    try {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 1800) : null;
      const res = await fetch('/api/ai/status', { signal: controller?.signal, cache: 'no-store' });
      if (timer) clearTimeout(timer);
      if (!res.ok) return false;
      const data: any = await res.json().catch(() => null);
      const configured = Boolean(data?.aiConfigured);
      cachedAiStatus = { aiConfigured: configured, ts: Date.now() };
      return configured;
    } catch {
      return false;
    } finally {
      inFlightAiStatusPromise = null;
    }
  })();
  return inFlightAiStatusPromise;
}
