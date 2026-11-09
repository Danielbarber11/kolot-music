// Pollinations.ai Free Public API Service (Text & Image Generation)
// Requires NO API keys or external authentication.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ImageGenOptions {
  width?: number;
  height?: number;
  model?: 'flux' | 'flux-realism' | 'turbo';
  seed?: number;
  nologo?: boolean;
}

/**
 * Send text chat message to Pollinations.ai Text API
 */
export async function sendPollinationsChat(
  messages: ChatMessage[],
  systemPrompt?: string
): Promise<string> {
  const fullMessages: ChatMessage[] = [];

  if (systemPrompt) {
    fullMessages.push({ role: 'system', content: systemPrompt });
  }

  fullMessages.push(...messages);

  try {
    const response = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: fullMessages,
        model: 'openai',
        jsonMode: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Pollinations HTTP error ${response.status}`);
    }

    const text = await response.text();
    return text.trim();
  } catch (err) {
    console.warn('Pollinations POST failed, attempting GET fallback...', err);

    // GET fallback
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || 'שלום';
    const encodedPrompt = encodeURIComponent(lastUserMsg);
    const sysParam = systemPrompt ? `&system=${encodeURIComponent(systemPrompt)}` : '';
    const getRes = await fetch(`https://text.pollinations.ai/${encodedPrompt}?model=openai${sysParam}`);

    if (!getRes.ok) {
      throw new Error(`Pollinations GET fallback failed: ${getRes.status}`);
    }

    const fallbackText = await getRes.text();
    return fallbackText.trim();
  }
}

/**
 * Construct direct Pollinations.ai Image Generation URL
 */
export function getPollinationsImageUrl(
  prompt: string,
  options?: ImageGenOptions
): string {
  const cleanPrompt = prompt.trim().replace(/\s+/g, ' ');
  const width = options?.width || 1024;
  const height = options?.height || 1024;
  const model = options?.model || 'flux';
  const seed = options?.seed ?? Math.floor(Math.random() * 1000000);

  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    cleanPrompt
  )}?width=${width}&height=${height}&model=${model}&seed=${seed}&nologo=true&nofeed=true`;
}
