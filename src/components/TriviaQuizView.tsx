import React, { useState, useEffect } from 'react';
import {
  HelpCircle,
  Award,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Sparkles,
  ChevronRight,
  Volume2,
  BookOpen,
  Wand2,
  Compass,
  Film,
  Trophy,
  Atom,
  Globe2,
  Music2,
  UtensilsCrossed,
  Laptop,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TriviaQuestion, TRIVIA_CATEGORIES, fetchTriviaQuestions } from '../services/triviaService';
import { Language } from '../types';
import { generateAIQuiz, AIModelType } from '../services/aiProviders';
import { AudioTTSPlayer } from './AudioTTSPlayer';

interface TriviaQuizViewProps {
  lang: Language;
}

interface CustomThemeCategory {
  id: number;
  slug: string;
  nameHe: string;
  nameEn: string;
  icon: any;
  color: string;
  descriptionHe: string;
}

const THEMED_DEPARTMENTS: CustomThemeCategory[] = [
  {
    id: 23,
    slug: 'history',
    nameHe: 'היסטוריה ותרבויות',
    nameEn: 'History & Civilization',
    icon: Compass,
    color: 'from-amber-500 to-amber-700',
    descriptionHe: 'אימפריות, מהפכות, מנהיגים ואירועים שעיצבו את האנושות',
  },
  {
    id: 17,
    slug: 'science',
    nameHe: 'מדע, טבע וחלל',
    nameEn: 'Science & Nature',
    icon: Atom,
    color: 'from-blue-500 to-indigo-700',
    descriptionHe: 'פיזיקה, אסטרונומיה, ביולוגיה וגילויים מרתקים',
  },
  {
    id: 11,
    slug: 'cinema',
    nameHe: 'קולנוע, סרטים וטלוויזיה',
    nameEn: 'Film & Cinema',
    icon: Film,
    color: 'from-rose-500 to-red-700',
    descriptionHe: 'שוברי קופות, במאים אגדיים, ציטוטים וסדרות מופת',
  },
  {
    id: 21,
    slug: 'sports',
    nameHe: 'ספורט ואלופים',
    nameEn: 'Sports & Champions',
    icon: Trophy,
    color: 'from-emerald-500 to-teal-700',
    descriptionHe: 'כדורגל עולמי, כדורסל, אולימפיאדות ושיאים היסטוריים',
  },
  {
    id: 22,
    slug: 'geography',
    nameHe: 'גאוגרפיה ועולם',
    nameEn: 'Geography & World',
    icon: Globe2,
    color: 'from-teal-500 to-cyan-700',
    descriptionHe: 'ערי בירה, דגלים, נהרות, רכסי הרים ותרבויות',
  },
  {
    id: 12,
    slug: 'music',
    nameHe: 'מוזיקה עולמית',
    nameEn: 'Music & Hits',
    icon: Music2,
    color: 'from-purple-500 to-violet-700',
    descriptionHe: 'להקות רוק, קלאסיקה, פופ, היפ-הופ ואלבומי מופת',
  },
  {
    id: 18,
    slug: 'tech',
    nameHe: 'מחשבים וטכנולוגיה',
    nameEn: 'Computers & Tech',
    icon: Laptop,
    color: 'from-sky-500 to-blue-700',
    descriptionHe: 'קוד, אינטרנט, חומרה, סייבר ובינה מלאכותית',
  },
  {
    id: 9,
    slug: 'general',
    nameHe: 'ידע כללי וטריוויה',
    nameEn: 'General Knowledge',
    icon: HelpCircle,
    color: 'from-orange-500 to-amber-700',
    descriptionHe: 'שאלות מפתיעות ומגוונות מכל תחומי החיים',
  },
];

export const TriviaQuizView: React.FC<TriviaQuizViewProps> = ({ lang }) => {
  const isHe = lang === 'he';

  const [activeTab, setActiveTab] = useState<'departments' | 'ai_creator'>('departments');

  // Selected OpenTDB / Curated department
  const [selectedDeptId, setSelectedDeptId] = useState<number>(23);
  const [selectedDifficulty, setSelectedDifficulty] = useState('all');

  // AI Quiz Creator state
  const [aiTopicInput, setAiTopicInput] = useState('');
  const [aiModel] = useState<AIModelType>('perchance');
  const [isGeneratingAiQuiz, setIsGeneratingAiQuiz] = useState(false);

  // Game state
  const [questions, setQuestions] = useState<TriviaQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [activeQuizTitle, setActiveQuizTitle] = useState('היסטוריה ותרבויות');

  const loadDepartmentQuestions = async (catId: number, title?: string) => {
    setLoading(true);
    setCurrentIndex(0);
    setScore(0);
    setSelectedAnswer(null);
    setIsAnswered(false);
    setIsFinished(false);
    if (title) setActiveQuizTitle(title);

    try {
      const q = await fetchTriviaQuestions(10, catId, selectedDifficulty);
      setQuestions(q);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDepartmentQuestions(selectedDeptId);
  }, [selectedDeptId]);

  const currentQ = questions[currentIndex];

  const handleSelectAnswer = (ans: string) => {
    if (isAnswered || !currentQ) return;
    setSelectedAnswer(ans);
    setIsAnswered(true);

    if (ans === currentQ.correctAnswer) {
      setScore((s) => s + 1);
    }
  };

  const handleNextQuestion = () => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex((i) => i + 1);
      setSelectedAnswer(null);
      setIsAnswered(false);
    } else {
      setIsFinished(true);
    }
  };

  const handleCreateAiQuiz = async (topicToUse?: string) => {
    const finalTopic = (topicToUse || aiTopicInput).trim();
    if (!finalTopic || isGeneratingAiQuiz) return;

    setIsGeneratingAiQuiz(true);
    try {
      const generatedQuestions = await generateAIQuiz(finalTopic, aiModel, isHe);
      if (generatedQuestions && generatedQuestions.length > 0) {
        setQuestions(generatedQuestions);
        setActiveQuizTitle(`חידון AI בנושא: ${finalTopic}`);
        setCurrentIndex(0);
        setScore(0);
        setSelectedAnswer(null);
        setIsAnswered(false);
        setIsFinished(false);
        setActiveTab('departments'); // Switch to game screen
      }
    } catch (e) {
      console.error('Error generating AI quiz:', e);
    } finally {
      setIsGeneratingAiQuiz(false);
    }
  };

  const sampleAiTopics = [
    'מערכת השמש וחקר החלל',
    'היסטוריה של ירושלים',
    'הקולנוע הישראלי והוליווד',
    'דינוזאורים ותקופות פרהיסטוריות',
    'מונדיאל ואלופי כדורגל',
    'קינוחים ושוקולד בעולם',
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-100 text-amber-800 font-extrabold text-xs border border-amber-200">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>OPEN TRIVIA & POLLINATIONS AI QUIZ HUB</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
            {isHe ? 'מרכז החידונים והטריוויה' : 'Global Trivia & AI Quiz Center'}
          </h1>
          <p className="text-slate-600 text-xs sm:text-sm max-w-xl leading-relaxed">
            {isHe
              ? 'מדורים מקוטלגים לפי נושאי עולם, שאלות ידע כללי, ובניית חידונים מותאמים אישית באמצעות Pollinations.ai ו-Perchance AI כולל הקראה קולית!'
              : 'Categorized topic departments, global trivia, and AI-powered quiz generator with audio narration!'}
          </p>
        </div>

        {/* Score indicator */}
        <div className="bg-white border border-slate-200 px-5 py-3 rounded-2xl shadow-sm flex items-center gap-3">
          <Award className="w-7 h-7 text-amber-500" />
          <div>
            <span className="text-[10px] text-slate-400 font-bold block">
              {isHe ? 'ניקוד נוכחי' : 'Score'}
            </span>
            <span className="text-xl font-black text-slate-900">
              {score} / {questions.length || 10}
            </span>
          </div>
        </div>
      </div>

      {/* Mode Navigation Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3 gap-2 overflow-x-auto">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('departments')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'departments'
                ? 'bg-amber-600 text-white shadow-md'
                : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
            }`}
          >
            <Compass className="w-4 h-4" />
            <span>{isHe ? 'מדורים וקטגוריות נושא' : 'Quiz Categories'}</span>
          </button>

          <button
            onClick={() => setActiveTab('ai_creator')}
            className={`px-4 py-2 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'ai_creator'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>{isHe ? 'יצירת חידון מותאם עם AI' : 'Create AI Quiz'}</span>
          </button>
        </div>

        <div className="text-xs font-mono font-bold text-slate-500 hidden sm:block">
          {activeQuizTitle}
        </div>
      </div>

      {/* AI QUIZ CREATOR PANEL */}
      {activeTab === 'ai_creator' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-indigo-600" />
                <span>{isHe ? 'יוצר החידונים החכם' : 'Smart AI Quiz Creator'}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {isHe
                  ? 'הקלד כל נושא שבעולם, והבינה המלאכותית תיצור עבורך חידון מלא של 5 שאלות, תשובות והסברים.'
                  : 'Enter any topic, and AI will craft a 5-question trivia quiz with answers and trivia facts.'}
              </p>
            </div>

            {/* Perchance AI Badge */}
            <span className="px-3 py-1.5 rounded-2xl bg-purple-100 text-purple-800 border border-purple-200 text-xs font-bold flex items-center gap-1.5">
              🎲 Perchance AI
            </span>
          </div>

          {/* Prompt Input Form */}
          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-700 block">
              {isHe ? 'על איזה נושא תרצה שניצור חידון?' : 'What topic would you like a quiz about?'}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={aiTopicInput}
                onChange={(e) => setAiTopicInput(e.target.value)}
                placeholder={isHe ? 'לדוגמה: אסטרונומיה וחורים שחורים, ירושלים במלחמת העצמאות...' : 'e.g. Ancient Rome, Quantum Physics...'}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateAiQuiz();
                }}
              />
              <button
                onClick={() => handleCreateAiQuiz()}
                disabled={isGeneratingAiQuiz || !aiTopicInput.trim()}
                className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                {isGeneratingAiQuiz ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>{isHe ? 'ה-AI מייצר שאלות...' : 'Generating...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>{isHe ? 'צור חידון עכשיו' : 'Generate Quiz'}</span>
                  </>
                )}
              </button>
            </div>

            {/* Quick Inspiration Topics */}
            <div className="pt-2">
              <span className="text-[11px] font-bold text-slate-400 block mb-1.5">
                {isHe ? 'נושאים פופולריים לדוגמה:' : 'Popular topic ideas:'}
              </span>
              <div className="flex flex-wrap gap-2">
                {sampleAiTopics.map((topic, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setAiTopicInput(topic);
                      handleCreateAiQuiz(topic);
                    }}
                    className="px-3 py-1 rounded-full bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 text-xs font-semibold border border-slate-200 transition-colors"
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* DEPARTMENT SELECTION GRID */}
      {activeTab === 'departments' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {THEMED_DEPARTMENTS.map((dept) => {
            const Icon = dept.icon;
            const isSelected = selectedDeptId === dept.id;

            return (
              <motion.button
                whileHover={{ y: -2, scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                key={dept.id}
                onClick={() => {
                  setSelectedDeptId(dept.id);
                  loadDepartmentQuestions(dept.id, dept.nameHe);
                }}
                className={`p-4 rounded-3xl border text-right transition-all flex flex-col justify-between cursor-pointer ${
                  isSelected
                    ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-400/30 shadow-md'
                    : 'bg-white hover:bg-slate-50 border-slate-200 shadow-sm'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-3">
                  <div
                    className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${dept.color} text-white flex items-center justify-center shadow`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  {isSelected && (
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                  )}
                </div>

                <div>
                  <h3 className="font-black text-sm text-slate-900 line-clamp-1">
                    {dept.nameHe}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium line-clamp-2 mt-1 leading-snug">
                    {dept.descriptionHe}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* MAIN GAME QUESTION SCREEN */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-10 animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded-xl w-1/4" />
          <div className="h-16 bg-slate-200 rounded-xl w-full" />
          <div className="grid grid-cols-2 gap-3 pt-4">
            <div className="h-14 bg-slate-200 rounded-xl" />
            <div className="h-14 bg-slate-200 rounded-xl" />
          </div>
        </div>
      ) : isFinished ? (
        /* Game Over Result */
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-12 text-center shadow-sm space-y-6"
        >
          <div className="w-20 h-20 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto shadow-inner">
            <Award className="w-10 h-10" />
          </div>

          <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
            {isHe ? 'סיימת את החידון בהצלחה!' : 'Quiz Complete!'}
          </h2>

          <div className="max-w-md mx-auto p-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-700">
            <p className="text-lg font-extrabold text-slate-900">
              {score >= (questions.length || 5) * 0.7
                ? '🏆 תוצאה מעולה! כל הכבוד על הידע המרשים!'
                : '👍 יפה מאוד! תמיד יש עוד מה ללמוד ולגלות!'}
            </p>
            <p className="text-sm text-slate-500 font-mono font-bold mt-1">
              ענית נכון על {score} מתוך {questions.length} שאלות
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              onClick={() => loadDepartmentQuestions(selectedDeptId)}
              className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-2xl inline-flex items-center gap-2 shadow-lg transition-all cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{isHe ? 'שחק שוב עם שאלות חדשות' : 'Play Again'}</span>
            </button>

            <button
              onClick={() => setActiveTab('ai_creator')}
              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-2xl inline-flex items-center gap-2 shadow-lg transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>{isHe ? 'צור חידון בנושא אחר עם AI' : 'Create Custom AI Quiz'}</span>
            </button>
          </div>
        </motion.div>
      ) : currentQ ? (
        /* Question Card */
        <motion.div
          key={currentQ.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 shadow-sm space-y-6"
        >
          {/* Top Question Status Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono font-bold text-slate-500 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-700 border border-amber-300/40">
                שאלה {currentIndex + 1} מתוך {questions.length}
              </span>
              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                {currentQ.category}
              </span>
            </div>

            {/* Audio Voiceover for the question */}
            <AudioTTSPlayer
              text={`שאלה: ${currentQ.question}. אפשרויות: ${currentQ.allAnswers.join(', ')}`}
              label={isHe ? 'הקרא שאלה בקול' : 'Read question'}
            />
          </div>

          {/* Question Text */}
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 leading-relaxed">
            {currentQ.question}
          </h2>

          {/* Multiple Choice Answers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {currentQ.allAnswers.map((ans, idx) => {
              const isSelected = selectedAnswer === ans;
              const isCorrect = isAnswered && ans === currentQ.correctAnswer;
              const isWrong = isAnswered && isSelected && ans !== currentQ.correctAnswer;

              return (
                <button
                  key={idx}
                  onClick={() => handleSelectAnswer(ans)}
                  disabled={isAnswered}
                  className={`p-4 rounded-2xl border text-right font-bold text-sm transition-all flex items-center justify-between cursor-pointer ${
                    isCorrect
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900 shadow-md ring-2 ring-emerald-400/40'
                      : isWrong
                      ? 'bg-rose-50 border-rose-500 text-rose-900 ring-2 ring-rose-400/30'
                      : isAnswered
                      ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800 hover:border-amber-400 shadow-sm'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-600 text-xs font-mono flex items-center justify-center flex-shrink-0">
                      {idx + 1}
                    </span>
                    <span>{ans}</span>
                  </span>
                  {isCorrect && (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mr-2" />
                  )}
                  {isWrong && (
                    <XCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mr-2" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Explanation Banner on Answer */}
          {isAnswered && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 text-slate-800 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-amber-600" />
                  <span>{isHe ? 'הסבר ועובדת טריוויה:' : 'Trivia Explanation:'}</span>
                </span>
                <AudioTTSPlayer
                  text={currentQ.explanation || `התשובה הנכונה היא ${currentQ.correctAnswer}`}
                  label={isHe ? 'הקרא הסבר' : 'Read explanation'}
                />
              </div>
              <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                {currentQ.explanation || `התשובה הנכונה היא: ${currentQ.correctAnswer}`}
              </p>
            </motion.div>
          )}

          {/* Next button */}
          {isAnswered && (
            <div className="pt-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={handleNextQuestion}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-extrabold flex items-center gap-1.5 shadow-md transition-all cursor-pointer"
              >
                <span>
                  {currentIndex + 1 < questions.length
                    ? isHe
                      ? 'לשאלה הבאה'
                      : 'Next Question'
                    : isHe
                    ? 'לסיכום התוצאות'
                    : 'Finish'}
                </span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </motion.div>
      ) : null}
    </div>
  );
};
