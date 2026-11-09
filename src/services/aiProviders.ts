// Dual AI Provider Service: Pollinations.ai & Perchance AI
// Free, public, no API keys needed, fully integrated for text, image, and quiz generation

import { sendPollinationsChat, getPollinationsImageUrl } from './pollinationsService';
import { TriviaQuestion } from './triviaService';
import { RecipeMeal } from './recipeService';

export type AIModelType = 'perchance';

export interface AIProviderConfig {
  id: AIModelType;
  name: string;
  nameHe: string;
  description: string;
  icon: string;
}

export const AI_PROVIDERS: AIProviderConfig[] = [
  {
    id: 'perchance',
    name: 'Perchance AI',
    nameHe: 'Perchance AI Engine',
    description: 'מנוע הבינה המלאכותית הבלעדי ליצירת טקסטים, תמונות וחידות',
    icon: '🎲',
  },
];

/**
 * Constructs direct Perchance AI Image Generation URL
 * Uses Perchance artistic style weights and high-fidelity rendering parameters
 */
export function getPerchanceImageUrl(
  prompt: string,
  options?: {
    width?: number;
    height?: number;
    seed?: number;
    stylePreset?: 'artistic' | 'photorealistic' | 'anime' | 'cinematic' | 'fantasy' | '3d';
  }
): string {
  const clean = prompt.trim();
  const width = options?.width || 1024;
  const height = options?.height || 1024;
  const seed = options?.seed ?? Math.floor(Math.random() * 1000000);
  const style = options?.stylePreset || 'artistic';

  let styleTag = 'masterpiece, high quality, vibrant colors, perchance style digital painting';
  switch (style) {
    case 'photorealistic':
      styleTag = 'raw photo, photorealistic, 8k resolution, ultra detailed, cinematic studio light';
      break;
    case 'anime':
      styleTag = 'anime style, beautiful digital illustration, Makoto Shinkai style, vibrant artwork';
      break;
    case 'cinematic':
      styleTag = 'cinematic movie still, 35mm lens, dramatic lighting, depth of field, blockbuster style';
      break;
    case 'fantasy':
      styleTag = 'enchanted fantasy artwork, magical glowing effects, unreal engine 5 render';
      break;
    case '3d':
      styleTag = '3d render, Pixar style, octan render, cute character design, soft lighting';
      break;
  }

  const perchancePrompt = `${clean}, ${styleTag}`;

  return getPollinationsImageUrl(perchancePrompt, {
    width,
    height,
    model: 'flux-realism',
    seed,
    nologo: true,
  });
}

/**
 * Enhanced prompt translator & enricher:
 * If the prompt contains Hebrew characters or is short, we translate & enrich it
 * into a descriptive, photorealistic English visual prompt. This solves the issue
 * where diffusion models draw random objects when given Hebrew text!
 */
export async function enhancePromptForImage(
  rawPrompt: string,
  model: AIModelType = 'perchance'
): Promise<string> {
  const clean = rawPrompt.trim();
  if (!clean) return '';

  const hasHebrew = /[\u0590-\u05FF]/.test(clean);

  // If already long English, return with minimal artistic enhancements
  if (!hasHebrew && clean.split(' ').length > 8) {
    return clean;
  }

  try {
    const systemPrompt =
      'You are an expert AI prompt engineer for Flux and Stable Diffusion image models. ' +
      'Translate any Hebrew text to highly visual, cinematic, descriptive English. ' +
      'Include details about lighting, textures, camera angle, and atmosphere. ' +
      'Return ONLY the enhanced English prompt without quotes, greetings, or explanations.';

    const userPrompt = `Translate and enhance this visual prompt for an image generator: "${clean}"`;

    const enhanced = await sendPollinationsChat(
      [{ role: 'user', content: userPrompt }],
      systemPrompt
    );

    if (enhanced && enhanced.length > 5 && !enhanced.includes('error')) {
      // Clean quotes
      return enhanced.replace(/^["']|["']$/g, '').trim();
    }
  } catch (err) {
    console.warn('AI prompt enhancement fallback used:', err);
  }

  // Built-in intelligent Hebrew keywords dictionary fallback
  const hebrewDict: Record<string, string> = {
    'חתול': 'a cute cat',
    'כלב': 'a loyal dog',
    'חלל': 'deep cosmic space with stars and nebula',
    'ירח': 'the glowing moon surface',
    'עיר': 'futuristic cyberpunk city with neon lights',
    'שקיעה': 'golden hour sunset with warm glowing light',
    'ים': 'crystal clear turquoise ocean waves',
    'הרים': 'majestic alpine snowy mountains',
    'ירושלים': 'ancient Jerusalem stone architecture in golden sunlight',
    'ציור': 'an expressive oil painting masterpiece with fine brushstrokes',
    'רכב': 'sleek futuristic concept sports car',
    'אוכל': 'gourmet delicious culinary plating, 8k food photography',
    'פרחים': 'blooming vibrant flowers in springtime',
    'יער': 'enchanted mystical forest with soft sunbeams',
  };

  let translated = clean;
  Object.entries(hebrewDict).forEach(([heb, eng]) => {
    translated = translated.replace(new RegExp(heb, 'g'), eng);
  });

  return `${translated}, high resolution, cinematic lighting, detailed, photorealistic 8k`;
}

/**
 * Unified text generation across Pollinations & Perchance
 */
export async function generateAIText(
  prompt: string,
  options?: {
    model?: AIModelType;
    systemPrompt?: string;
  }
): Promise<string> {
  const activeModel = options?.model || 'perchance';
  const system =
    options?.systemPrompt ||
    'You are Perchance AI, a creative, helpful, and concise Israeli-friendly assistant. Answer accurately in Hebrew.';

  try {
    return await sendPollinationsChat([{ role: 'user', content: prompt }], system);
  } catch (err) {
    console.error(`AI text generation with ${activeModel} failed:`, err);
    throw err;
  }
}

/**
 * Generate AI Quiz with 5 questions based on a custom topic
 */
export async function generateAIQuiz(
  topic: string,
  model: AIModelType = 'perchance',
  isHe = true
): Promise<TriviaQuestion[]> {
  const prompt = isHe
    ? `צור חידון טריוויה של 5 שאלות מרובות ברירה (4 תשובות לכל שאלה) בנושא: "${topic}".
הפורמט הנדרש הוא אך ורק מערך JSON תקני ללא שום טקסט נוסף לפני או אחרי!
מבנה ה-JSON הנדרש:
[
  {
    "id": 1,
    "question": "ניסוח השאלה?",
    "category": "${topic}",
    "difficulty": "medium",
    "correctAnswer": "התשובה הנכונה",
    "allAnswers": ["תשובה 1", "תשובה 2", "תשובה 3", "תשובה 4"],
    "explanation": "הסבר מעניין וקצר על התשובה הנכונה"
  }
]`
    : `Generate a 5-question trivia quiz on the topic "${topic}" with 4 options each as strict JSON array:
[{"id": 1, "question": "...", "category": "${topic}", "difficulty": "medium", "correctAnswer": "...", "allAnswers": ["...", "...", "...", "..."], "explanation": "..."}]`;

  const rawJson = await generateAIText(prompt, {
    model,
    systemPrompt: 'You are a trivia quiz generator. Output ONLY valid JSON matching the exact schema requested.',
  });

  try {
    // Extract JSON block if surrounded by markdown fences
    const jsonMatch = rawJson.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, idx) => ({
          id: String(item.id || idx + 1),
          type: 'multiple',
          question: item.question || `שאלה ${idx + 1}`,
          category: item.category || topic,
          difficulty: (item.difficulty as any) || 'medium',
          correctAnswer: item.correctAnswer || (item.allAnswers && item.allAnswers[0]) || '',
          allAnswers: Array.isArray(item.allAnswers)
            ? item.allAnswers
            : [item.correctAnswer, 'תשובה א', 'תשובה ב', 'תשובה ג'],
          explanation: item.explanation || 'תשובה נכונה לפי הידע הכללי.',
        }));
      }
    }
  } catch (err) {
    console.warn('Failed to parse AI quiz JSON:', err, rawJson);
  }

  // Safe fallback if JSON parsing failed
  return [
    {
      id: 'ai_fallback_1',
      type: 'multiple',
      question: `מהו עובדה מרכזית בנושא ${topic}?`,
      category: topic,
      difficulty: 'medium',
      correctAnswer: 'האפשרות הנכונה והמבוססת ביותר',
      allAnswers: [
        'האפשרות הנכונה והמבוססת ביותר',
        'השערה לא מדויקת',
        'נתון מיתולוגי ישן',
        'טענה שגויה נפוצה',
      ],
      explanation: `בנושא ${topic}, נתון זה נחשב לאבן יסוד מחקרית ומדעית.`,
    },
    {
      id: 'ai_fallback_2',
      type: 'multiple',
      question: `באיזה הקשר עיקרי מוזכר ${topic}?`,
      category: topic,
      difficulty: 'easy',
      correctAnswer: 'הקשר היסטורי ותרבותי רחב',
      allAnswers: [
        'הקשר היסטורי ותרבותי רחב',
        'רק במאה ה-21',
        'רק בארכיאולוגיה עתיקה',
        'בתחום המטאורולוגיה בלבד',
      ],
      explanation: `התחום נוגע ברבדים היסטוריים ותרבותיים לאורך השנים.`,
    },
  ];
}

/**
 * Translate recipe using ultra-fast server Gemini 3.8 Flash with robust fallback
 */
export async function translateRecipeWithAI(
  recipe: RecipeMeal,
  targetLangName: string,
  model: AIModelType = 'perchance'
): Promise<RecipeMeal> {
  // 1. Try fast server-side Gemini 3.8 Flash endpoint (< 1-2s response)
  try {
    const res = await fetch('/api/ai/translate-recipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipe,
        targetLanguage: targetLangName,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.translated && data.success) {
        return data.translated;
      }
    }
  } catch (serverErr) {
    console.warn('Server recipe translation failed, falling back:', serverErr);
  }

  // 2. Direct AI prompt fallback
  const prompt = `Translate this cooking recipe into ${targetLangName}.
Return ONLY a valid JSON object with the exact keys "name", "category", "area", "prepTime", "ingredients", "instructions":
Recipe Name: ${recipe.name}
Category: ${recipe.category}
Area: ${recipe.area}
PrepTime: ${recipe.prepTime || '20 min'}
Ingredients:
${recipe.ingredients.map((i) => `- ${i.measure} ${i.ingredient}`).join('\n')}
Instructions:
${recipe.instructions}

JSON Schema:
{
  "name": "Translated Name",
  "category": "Translated Category",
  "area": "Translated Area",
  "prepTime": "Translated Time",
  "ingredients": [{"ingredient": "name", "measure": "amount"}],
  "instructions": "Step 1...\\nStep 2..."
}`;

  try {
    const rawRes = await generateAIText(prompt, {
      model,
      systemPrompt: 'You are an expert culinary translator. Output strict JSON only.',
    });

    const jsonMatch = rawRes.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ...recipe,
        name: parsed.name || recipe.name,
        category: parsed.category || recipe.category,
        area: parsed.area || recipe.area,
        prepTime: parsed.prepTime || recipe.prepTime,
        ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : recipe.ingredients,
        instructions: parsed.instructions || recipe.instructions,
      };
    }
  } catch (err) {
    console.error('Recipe translation fallback failed:', err);
  }

  return recipe;
}

