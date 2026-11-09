export interface TriviaQuestion {
  id: string;
  category: string;
  type: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  correctAnswer: string;
  allAnswers: string[];
  explanation?: string;
}

export const TRIVIA_CATEGORIES = [
  { id: 0, name: 'כל הנושאים' },
  { id: 9, name: 'ידע כללי' },
  { id: 17, name: 'מדע וטבע' },
  { id: 18, name: 'מחשבים וטכנולוגיה' },
  { id: 23, name: 'היסטוריה' },
  { id: 21, name: 'ספורט' },
  { id: 11, name: 'קולנוע וסרטים' },
  { id: 12, name: 'מוזיקה' },
  { id: 22, name: 'גיאוגרפיה' },
];

function decodeHtml(html: string): string {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
}

export async function fetchTriviaQuestions(
  amount: number = 10,
  categoryId: number = 0,
  difficulty?: string
): Promise<TriviaQuestion[]> {
  let url = `https://opentdb.com/api.php?amount=${amount}&type=multiple`;
  if (categoryId > 0) url += `&category=${categoryId}`;
  if (difficulty && difficulty !== 'all') url += `&difficulty=${difficulty}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('OpenTDB request failed');
    const data = await res.json();

    const results = data.results || [];
    return results.map((item: any, idx: number) => {
      const correct = decodeHtml(item.correct_answer);
      const incorrect = (item.incorrect_answers || []).map((ans: string) => decodeHtml(ans));
      // Shuffle answers
      const all = [...incorrect, correct].sort(() => Math.random() - 0.5);

      return {
        id: `q_${Date.now()}_${idx}`,
        category: decodeHtml(item.category),
        type: item.type,
        difficulty: item.difficulty,
        question: decodeHtml(item.question),
        correctAnswer: correct,
        allAnswers: all,
      };
    });
  } catch (err) {
    console.error('Trivia fetch error:', err);
    return [];
  }
}
