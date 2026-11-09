import React, { useState, useEffect } from 'react';
import {
  Utensils,
  Search,
  Sparkles,
  ExternalLink,
  X,
  Play,
  Clock,
  BookOpen,
  ChefHat,
  Globe,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Share2,
  Volume2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  RecipeMeal,
  HEBREW_RECIPE_CATEGORIES,
  CURATED_HEBREW_RECIPES,
  searchMeals,
  filterMealsByCategory,
  getMealById,
  fetchWikibooksRecipes,
} from '../services/recipeService';
import { Language } from '../types';
import { AudioTTSPlayer } from './AudioTTSPlayer';
import { translateRecipeWithAI } from '../services/aiProviders';

interface RecipesViewProps {
  lang: Language;
  onNavigateHome: () => void;
}

export const RecipesView: React.FC<RecipesViewProps> = ({ lang, onNavigateHome }) => {
  const isHe = lang === 'he';

  const [meals, setMeals] = useState<RecipeMeal[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeMeal, setActiveMeal] = useState<RecipeMeal | null>(null);
  const [originalMeal, setOriginalMeal] = useState<RecipeMeal | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<boolean>(false);
  const [isTranslating, setIsTranslating] = useState<boolean>(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('עברית');
  const [copiedLink, setCopiedLink] = useState(false);

  // Initial load
  useEffect(() => {
    loadInitialMeals();
  }, []);

  const loadInitialMeals = async () => {
    setIsLoading(true);
    const results = await searchMeals('');
    setMeals(results);
    setIsLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsLoading(true);
    setSelectedCategory('Custom');
    const results = await searchMeals(searchQuery);
    setMeals(results);
    setIsLoading(false);
  };

  const handleCategoryClick = async (category: string) => {
    setSelectedCategory(category);
    setSearchQuery('');
    setIsLoading(true);
    if (category === 'all') {
      const results = await searchMeals('');
      setMeals(results);
    } else if (category === 'wikibooks') {
      const results = await fetchWikibooksRecipes();
      setMeals(results);
    } else {
      const results = await filterMealsByCategory(category);
      setMeals(results);
    }
    setIsLoading(false);
  };

  const openMealDetails = async (meal: RecipeMeal) => {
    setActiveMeal(meal);
    setOriginalMeal(meal);
    if (meal.ingredients.length === 0 || !meal.instructions || meal.instructions.startsWith('לחץ')) {
      setLoadingDetail(true);
      const full = await getMealById(meal.id);
      if (full) {
        setActiveMeal(full);
        setOriginalMeal(full);
      }
      setLoadingDetail(false);
    }
  };

  const handleTranslateMeal = async () => {
    if (!activeMeal || isTranslating) return;
    setIsTranslating(true);
    try {
      const translated = await translateRecipeWithAI(activeMeal, selectedLanguage);
      setActiveMeal(translated);
    } catch (e) {
      console.error('Translation error:', e);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleRestoreOriginal = () => {
    if (originalMeal) {
      setActiveMeal(originalMeal);
    }
  };

  const handleShare = () => {
    navigator.clipboard?.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 pb-24">
      {/* ------------------------------------------------------------- */}
      {/* FULL SCREEN RECIPE PAGE VIEW (דף מתכון על כל המסך ללא כרטיסיה)   */}
      {/* ------------------------------------------------------------- */}
      <AnimatePresence>
        {activeMeal && (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 15 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-50 bg-[#090d16] text-white overflow-y-auto w-full min-h-screen custom-scrollbar flex flex-col"
          >
            {/* FLOATING POPPING BACK BUTTON (לחצן חזור צץ למעלה) */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: 'spring', bounce: 0.2 }}
              className="fixed top-5 right-5 sm:right-8 z-50 flex items-center gap-2"
            >
              <button
                onClick={() => setActiveMeal(null)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white border border-white/20 backdrop-blur-xl shadow-2xl transition-all text-sm font-bold cursor-pointer"
                title={isHe ? 'חזור לרשימת המתכונים' : 'Back to recipes'}
              >
                {isHe ? <ArrowRight className="w-4 h-4 text-orange-400" /> : <ArrowLeft className="w-4 h-4 text-orange-400" />}
                <span>{isHe ? 'חזור למתכונים' : 'Back to Recipes'}</span>
              </button>

              <button
                onClick={handleShare}
                className="p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white border border-white/20 backdrop-blur-xl shadow-2xl transition-all cursor-pointer"
                title="Share"
              >
                <Share2 className="w-4 h-4" />
              </button>
            </motion.div>

            {/* FULL SCREEN HERO HEADER */}
            <div className="relative w-full h-[380px] sm:h-[460px] bg-slate-950 overflow-hidden flex-shrink-0">
              <img
                src={activeMeal.thumbnail}
                alt={activeMeal.name}
                className="w-full h-full object-cover object-center opacity-85"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#090d16] via-[#090d16]/50 to-transparent" />

              <div className="absolute bottom-6 right-0 left-0 max-w-5xl mx-auto px-4 sm:px-8 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3.5 py-1 rounded-full bg-orange-600 text-white text-xs font-black shadow-lg">
                    {activeMeal.category}
                  </span>
                  <span className="px-3.5 py-1 rounded-full bg-white/15 backdrop-blur-md text-white text-xs font-bold border border-white/20">
                    {activeMeal.area || 'International'}
                  </span>
                  {activeMeal.difficulty && (
                    <span className="px-3.5 py-1 rounded-full bg-emerald-600 text-white text-xs font-bold shadow">
                      {activeMeal.difficulty}
                    </span>
                  )}
                  {activeMeal.prepTime && (
                    <span className="px-3.5 py-1 rounded-full bg-white/10 backdrop-blur-md text-white text-xs font-bold border border-white/15 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-orange-400" />
                      <span>{activeMeal.prepTime}</span>
                    </span>
                  )}
                </div>

                <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight drop-shadow-md leading-tight">
                  {activeMeal.name}
                </h1>

                {activeMeal.sourceName && (
                  <p className="text-xs sm:text-sm text-orange-300 font-bold flex items-center gap-1.5">
                    <BookOpen className="w-4 h-4" />
                    <span>{activeMeal.sourceName}</span>
                  </p>
                )}
              </div>
            </div>

            {/* FULL SCREEN CONTENT CONTAINER */}
            <div className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-8 py-8 space-y-8">
              {loadingDetail ? (
                <div className="py-24 text-center text-slate-300 space-y-3">
                  <div className="w-10 h-10 border-3 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-sm font-bold">{isHe ? 'טוען מתכון מלא ומצרכים...' : 'Loading full recipe...'}</p>
                </div>
              ) : (
                <>
                  {/* FAST AI TRANSLATION BAR & AUDIO PLAYER */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    {/* TTS Player */}
                    <div className="md:col-span-6 bg-slate-900/80 border border-white/10 p-4 rounded-3xl backdrop-blur-xl">
                      <AudioTTSPlayer
                        variant="bar"
                        label={isHe ? 'האזן להוראות המתכון והמצרכים (TTS)' : 'Listen to recipe voiceover'}
                        text={`${activeMeal.name}. ${activeMeal.area ? `מטבח: ${activeMeal.area}. ` : ''}מצרכים: ${activeMeal.ingredients.map((i) => `${i.measure} ${i.ingredient}`).join(', ')}. אופן ההכנה: ${activeMeal.instructions}`}
                      />
                    </div>

                    {/* AI Translation Bar */}
                    <div className="md:col-span-6 bg-slate-900/80 border border-white/10 p-4 rounded-3xl backdrop-blur-xl flex flex-col justify-between gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-amber-400" />
                          <span>{isHe ? 'תרגום מתכון מהיר ב-Gemini AI' : 'Fast AI Recipe Translation'}</span>
                        </span>

                        {originalMeal && activeMeal.name !== originalMeal.name && (
                          <button
                            onClick={handleRestoreOriginal}
                            className="text-xs text-amber-400 hover:underline font-bold cursor-pointer"
                          >
                            {isHe ? 'שחזר למקור' : 'Restore original'}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={selectedLanguage}
                          onChange={(e) => setSelectedLanguage(e.target.value)}
                          className="bg-slate-800 border border-white/15 text-white rounded-2xl px-3 py-2 text-xs font-bold focus:outline-none cursor-pointer flex-1"
                        >
                          <option value="עברית">עברית (Hebrew)</option>
                          <option value="English">English</option>
                          <option value="Français">Français</option>
                          <option value="Español">Español</option>
                          <option value="العربية">العربية</option>
                          <option value="Русский">Русский</option>
                        </select>

                        <button
                          onClick={handleTranslateMeal}
                          disabled={isTranslating}
                          className="px-5 py-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black text-xs transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-md"
                        >
                          {isTranslating ? (
                            <>
                              <div className="w-3.5 h-3.5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                              <span>{isHe ? 'מתרגם מהר...' : 'Translating...'}</span>
                            </>
                          ) : (
                            <>
                              <Globe className="w-4 h-4" />
                              <span>{isHe ? 'תרגם עכשיו' : 'Translate Now'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* INGREDIENTS SECTION */}
                  {activeMeal.ingredients && activeMeal.ingredients.length > 0 && (
                    <div className="bg-slate-900/60 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xl">
                      <div className="flex items-center justify-between border-b border-white/10 pb-4">
                        <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                          <Utensils className="w-5 h-5 text-orange-400" />
                          <span>{isHe ? 'מצרכים ורכיבים נדרשים' : 'Ingredients'}</span>
                        </h2>
                        <span className="text-xs text-slate-400 font-bold">
                          {activeMeal.ingredients.length} {isHe ? 'מצרכים' : 'items'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {activeMeal.ingredients.map((ing, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/10 text-xs sm:text-sm hover:bg-white/10 transition-colors"
                          >
                            <span className="font-bold text-white flex items-center gap-2 truncate">
                              <CheckCircle2 className="w-4 h-4 text-orange-400 flex-shrink-0" />
                              <span className="truncate">{ing.ingredient}</span>
                            </span>
                            <span className="font-mono text-orange-300 font-bold text-xs flex-shrink-0 mr-2 bg-orange-950/60 px-2 py-0.5 rounded-lg border border-orange-500/20">
                              {ing.measure}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* STEP-BY-STEP INSTRUCTIONS */}
                  <div className="bg-slate-900/60 border border-white/10 rounded-3xl p-6 sm:p-8 space-y-4 shadow-xl">
                    <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2 border-b border-white/10 pb-4">
                      <BookOpen className="w-5 h-5 text-orange-400" />
                      <span>{isHe ? 'אופן ההכנה וההוראות' : 'Step-by-Step Instructions'}</span>
                    </h2>

                    <div className="p-4 sm:p-6 rounded-2xl bg-white/5 border border-white/10 text-sm sm:text-base leading-relaxed text-slate-200 whitespace-pre-line font-medium space-y-3">
                      {activeMeal.instructions}
                    </div>
                  </div>

                  {/* VIDEO TUTORIAL & WIKIBOOKS LINKS */}
                  <div className="flex flex-wrap items-center gap-4 pt-2">
                    {activeMeal.youtubeUrl && (
                      <a
                        href={activeMeal.youtubeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-bold shadow-lg transition-all cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>{isHe ? 'צפה בהדרכת וידאו ב-YouTube' : 'Watch Video Tutorial'}</span>
                        <ExternalLink className="w-4 h-4 ml-1" />
                      </a>
                    )}
                    {activeMeal.sourceUrl && (
                      <a
                        href={activeMeal.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-orange-600 hover:bg-orange-700 text-white text-xs sm:text-sm font-bold shadow-lg transition-all cursor-pointer"
                      >
                        <BookOpen className="w-4 h-4" />
                        <span>{isHe ? 'פתח דף מקור מלא בויקיספר' : 'Open in Wikibooks'}</span>
                        <ExternalLink className="w-4 h-4 ml-1" />
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Browse Catalog View */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 rounded-xl bg-orange-100 text-orange-600">
                <ChefHat className="w-6 h-6" />
              </span>
              <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                {isHe ? 'מאגר מתכונים עברי פתוח (ויקיספר)' : 'Hebrew Open Culinary Archive'}
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              {isHe
                ? 'אלפי מתכונים פתוחים בעברית מתוך ויקיספר וארכיונים עולמיים — מצרכים, אופן הכנה ותרגום מהיר'
                : 'Thousands of free open recipes in Hebrew from Wikibooks and global culinary archives'}
            </p>
          </div>

          {/* Search Bar */}
          <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-md w-full">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isHe ? 'חפש מתכון (למשל: שקשוקה, חלה, עוגה, עוף)...' : 'Search recipe...'}
                className="w-full pl-4 pr-10 py-2.5 rounded-full bg-white border border-slate-200 shadow-sm text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-full bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs sm:text-sm shadow-md transition-all cursor-pointer"
            >
              {isHe ? 'חיפוש' : 'Search'}
            </button>
          </form>
        </div>

        {/* Categories Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
          {HEBREW_RECIPE_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => handleCategoryClick(cat.id)}
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex-shrink-0 cursor-pointer ${
                selectedCategory === cat.id
                  ? 'bg-orange-600 text-white shadow-md'
                  : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {cat.label}
            </button>
          ))}
          <button
            onClick={() => handleCategoryClick('wikibooks')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex-shrink-0 cursor-pointer ${
              selectedCategory === 'wikibooks'
                ? 'bg-orange-600 text-white shadow-md'
                : 'bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100'
            }`}
          >
            📖 ספר מתכונים ויקיספר
          </button>
        </div>

        {/* Recipes Grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 pt-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-200 p-4 animate-pulse space-y-3">
                <div className="aspect-video bg-slate-200 rounded-xl" />
                <div className="h-4 bg-slate-200 rounded w-3/4" />
                <div className="h-3 bg-slate-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : meals.length === 0 ? (
          <div className="text-center py-20 bg-white border border-slate-200 rounded-3xl space-y-3">
            <Utensils className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-700">
              {isHe ? 'לא נמצאו מתכונים תואמים' : 'No recipes found'}
            </h3>
            <p className="text-xs text-slate-400">
              {isHe ? 'נסה לחפש מילה אחרת או בחר קטגוריה שונה' : 'Try searching another keyword or choose a category'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {meals.map((meal) => (
              <motion.div
                whileHover={{ y: -4, scale: 1.01 }}
                key={meal.id}
                onClick={() => openMealDetails(meal)}
                className="group bg-white rounded-2xl border border-slate-200/90 hover:border-orange-500 overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <div className="relative aspect-video sm:aspect-square overflow-hidden bg-slate-100">
                    <img
                      src={meal.thumbnail}
                      alt={meal.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/75 backdrop-blur-md text-white text-[10px] font-bold">
                      <Globe className="w-3 h-3 text-orange-400" />
                      <span>{meal.area || 'Global'}</span>
                    </div>
                  </div>

                  <div className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md">
                        {meal.category || 'Recipe'}
                      </span>
                      {meal.prepTime && (
                        <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{meal.prepTime}</span>
                        </span>
                      )}
                      {meal.difficulty && (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                          {meal.difficulty}
                        </span>
                      )}
                    </div>
                    <h3 className="font-extrabold text-sm text-slate-900 group-hover:text-orange-600 transition-colors line-clamp-1">
                      {meal.name}
                    </h3>
                    <p className="text-xs text-slate-500 line-clamp-2">
                      {meal.instructions}
                    </p>
                    {meal.sourceName && (
                      <p className="text-[10px] font-bold text-orange-700/80">
                        {meal.sourceName}
                      </p>
                    )}
                  </div>
                </div>

                <div className="p-4 pt-0">
                  <button className="w-full py-2.5 rounded-xl bg-orange-50 group-hover:bg-orange-600 group-hover:text-white text-orange-700 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>{isHe ? 'פתח מתכון מלא על כל המסך' : 'View Full Screen Recipe'}</span>
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
