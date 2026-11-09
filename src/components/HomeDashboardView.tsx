import React, { useState, useEffect } from 'react';
import {
  Search,
  BookOpen,
  Film,
  Code,
  Music,
  ExternalLink,
  Sparkles,
  Play,
  X,
  Star,
  Globe,
  RefreshCw,
  Keyboard,
  Delete,
  Lock,
  ArrowRight,
  ArrowLeft,
  Share2,
  Bot,
  Wand2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { WikiItem, ArchiveItem, JamendoTrack, Language } from '../types';
import { getWikipediaFeaturedOrRandom } from '../services/wikiService';
import { CURATED_ARCHIVE_ITEMS } from '../services/archiveService';
import { CURATED_JAMENDO_TRACKS } from '../services/jamendoService';
import { CURATED_GITHUB_REPOS } from '../services/githubService';
import { searchDuckDuckGoWeb, DuckDuckGoResponse, DuckDuckGoWebResult } from '../services/duckduckgoService';

interface HomeDashboardViewProps {
  lang: Language;
  onNavigateTab: (tab: string) => void;
  onPlayMedia: (item: ArchiveItem) => void;
  onPlayTrack: (track: JamendoTrack) => void;
}

export const HomeDashboardView: React.FC<HomeDashboardViewProps> = ({
  lang,
  onNavigateTab,
  onPlayMedia,
  onPlayTrack,
}) => {
  const isHe = lang === 'he';

  const [searchQuery, setSearchQuery] = useState('');
  const [webSearchResults, setWebSearchResults] = useState<DuckDuckGoResponse | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);

  // Virtual On-Screen Keyboard State
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [keyboardLang, setKeyboardLang] = useState<'he' | 'en'>(isHe ? 'he' : 'en');

  // In-App Web Browser Viewer Modal State ("שיפתח את האתר עצמו כאן בתוך האפליקציה")
  const [activeIframeSite, setActiveIframeSite] = useState<DuckDuckGoWebResult | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const [wikiCards, setWikiCards] = useState<WikiItem[]>([]);
  const [selectedWikiCard, setSelectedWikiCard] = useState<WikiItem | null>(null);

  useEffect(() => {
    const fetchWiki = async () => {
      try {
        const items = await getWikipediaFeaturedOrRandom(lang);
        setWikiCards(items);
      } catch (e) {
        console.error(e);
      }
    };
    fetchWiki();
  }, [lang]);

  const handleDuckDuckGoWebSearch = async (overrideQuery?: string) => {
    const q = (overrideQuery !== undefined ? overrideQuery : searchQuery).trim();
    if (!q) return;
    setLoadingSearch(true);
    setShowKeyboard(false);
    try {
      const res = await searchDuckDuckGoWeb(q);
      setWebSearchResults(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSearch(false);
    }
  };

  const handleKeyClick = (char: string) => {
    setSearchQuery((prev) => prev + char);
  };

  const handleBackspace = () => {
    setSearchQuery((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setSearchQuery('');
  };

  // Virtual Keyboard Layouts
  const hebrewKeysRow1 = ['ק', 'ר', 'א', 'ט', 'ו', 'ן', 'ם', 'פ'];
  const hebrewKeysRow2 = ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל', 'ך', 'ף'];
  const hebrewKeysRow3 = ['ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת', 'ץ'];

  const englishKeysRow1 = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'];
  const englishKeysRow2 = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'];
  const englishKeysRow3 = ['z', 'x', 'c', 'v', 'b', 'n', 'm'];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
      {/* GOOGLE-STYLE SEARCH HERO SECTION */}
      <div className="relative bg-gradient-to-b from-slate-50 via-white to-slate-50 border border-slate-200/90 rounded-3xl p-6 sm:p-10 shadow-sm text-center max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-black border border-indigo-200 mb-4 shadow-sm">
          <Sparkles className="w-4 h-4 text-indigo-600" />
          <span>{isHe ? 'מנוע חיפוש חופשי ואוצר ידע דיגיטלי' : 'Open Knowledge & Web Search Engine'}</span>
        </div>

        {/* Google-Style Logo Header */}
        <h1 className="text-3xl sm:text-5xl font-black text-slate-900 tracking-tight leading-tight flex items-center justify-center gap-2">
          <span>{isHe ? 'ויקי-ארכיון' : 'WikiArchive'}</span>
          <span className="text-indigo-600 font-extrabold text-2xl sm:text-4xl">.web</span>
        </h1>
        <p className="text-slate-600 text-xs sm:text-sm mt-2 max-w-xl mx-auto font-normal">
          {isHe
            ? 'חפש אתרים, ערכים, משחקים, סרטונים, מוזיקה ומידע חופשי מהרשת'
            : 'Search websites, encyclopedia entries, games, videos, and music from the open web'}
        </p>

        {/* GOOGLE-STYLE ROUNDED SEARCH BAR */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleDuckDuckGoWebSearch();
          }}
          className="relative max-w-2xl mx-auto mt-6 flex items-center shadow-lg hover:shadow-xl focus-within:shadow-xl transition-all rounded-full bg-white border border-slate-300 focus-within:border-indigo-600 p-1.5"
        >
          <div className="pr-4 pl-2 text-slate-400 flex items-center">
            <Search className="w-5 h-5 text-indigo-600" />
          </div>

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              isHe
                ? 'חפש אתר, מושג או נושא ברשת (כמו בגוגל, למשל: יוטיוב)...'
                : 'Search the web (like Google, e.g. YouTube)...'
            }
            className="w-full py-3 bg-transparent text-slate-900 placeholder-slate-400 text-sm sm:text-base font-medium focus:outline-none"
          />

          {searchQuery && (
            <button
              type="button"
              onClick={handleClear}
              className="p-2 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
              title={isHe ? 'נקה חיפוש' : 'Clear search'}
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* VIRTUAL KEYBOARD TOGGLE BUTTON */}
          <button
            type="button"
            onClick={() => setShowKeyboard((prev) => !prev)}
            className={`p-2.5 rounded-full border transition-all cursor-pointer mr-1 ml-1 ${
              showKeyboard
                ? 'bg-indigo-600 text-white border-indigo-600 shadow'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
            }`}
            title={isHe ? 'מקלדת וירטואלית על המסך' : 'On-Screen Virtual Keyboard'}
          >
            <Keyboard className="w-4 h-4" />
          </button>

          <button
            type="submit"
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-xs sm:text-sm font-extrabold shadow-md transition-all flex items-center gap-1.5 cursor-pointer flex-shrink-0"
          >
            <span>{isHe ? 'חפש ברשת' : 'Search'}</span>
          </button>
        </form>

        {/* QUICK SUGGESTIONS PILLS */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-xs">
          <span className="text-slate-400 text-[11px] font-bold">{isHe ? 'חיפושים פופולריים:' : 'Popular:'}</span>
          {['יוטיוב', 'ויקיפדיה', 'ארכיון האינטרנט', 'משחקי דוס', 'מזג אוויר', 'מתכונים'].map((s) => (
            <button
              key={s}
              onClick={() => {
                setSearchQuery(s);
                handleDuckDuckGoWebSearch(s);
              }}
              className="px-3 py-1 rounded-full bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 border border-slate-200 text-slate-600 text-[11px] font-bold transition-all cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>

        {/* POLLINATIONS AI SUITE CARDS */}
        <div className="max-w-2xl mx-auto mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-right">
          <div
            onClick={() => onNavigateTab('bot')}
            className="p-3.5 rounded-2xl bg-gradient-to-r from-indigo-50 to-indigo-100/60 border border-indigo-200/80 hover:border-indigo-400 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/30 group-hover:scale-105 transition-transform">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-black text-slate-900 group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">
                  <span>{isHe ? 'צאט בינה מלאכותית' : 'AI Chat Assistant'}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-200/80 text-indigo-800 font-bold">API</span>
                </h4>
                <p className="text-[11px] text-slate-500 font-medium">
                  {isHe ? 'מופעל ע"י Pollinations.ai' : 'Powered by Pollinations.ai'}
                </p>
              </div>
            </div>
            <ArrowLeft className={`w-4 h-4 text-indigo-600 ${!isHe ? 'rotate-180' : ''} group-hover:-translate-x-1 transition-transform`} />
          </div>

          <div
            onClick={() => onNavigateTab('imageGen')}
            className="p-3.5 rounded-2xl bg-gradient-to-r from-purple-50 to-pink-50/60 border border-purple-200/80 hover:border-purple-400 hover:shadow-md transition-all cursor-pointer flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-600/30 group-hover:scale-105 transition-transform">
                <Wand2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-black text-slate-900 group-hover:text-purple-600 transition-colors flex items-center gap-1.5">
                  <span>{isHe ? 'מחולל תמונות AI' : 'AI Image Generator'}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-200/80 text-purple-800 font-bold">Flux</span>
                </h4>
                <p className="text-[11px] text-slate-500 font-medium">
                  {isHe ? 'יצירת תמונות ב-Pollinations' : 'Create with Pollinations'}
                </p>
              </div>
            </div>
            <ArrowLeft className={`w-4 h-4 text-purple-600 ${!isHe ? 'rotate-180' : ''} group-hover:-translate-x-1 transition-transform`} />
          </div>
        </div>

        {/* ON-SCREEN VIRTUAL KEYBOARD (כמו מנוע חיפוש גוגל עם מקלדת) */}
        <AnimatePresence>
          {showKeyboard && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              className="mt-6 max-w-2xl mx-auto p-4 rounded-3xl bg-slate-900 text-white border border-slate-800 shadow-2xl space-y-2.5"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs">
                <span className="font-bold flex items-center gap-1.5 text-indigo-400">
                  <Keyboard className="w-3.5 h-3.5" />
                  <span>{isHe ? 'מקלדת וירטואלית חכמה' : 'Smart Virtual Keyboard'}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setKeyboardLang((l) => (l === 'he' ? 'en' : 'he'))}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-mono font-bold text-xs cursor-pointer shadow"
                  >
                    {keyboardLang === 'he' ? 'עברית (HE)' : 'English (EN)'}
                  </button>
                  <button
                    onClick={() => setShowKeyboard(false)}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Rows of keys */}
              <div className="space-y-1.5 dir-ltr select-none">
                {/* Row 1 */}
                <div className="flex justify-center gap-1 sm:gap-1.5">
                  {(keyboardLang === 'he' ? hebrewKeysRow1 : englishKeysRow1).map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKeyClick(key)}
                      className="w-8 h-10 sm:w-11 sm:h-11 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-indigo-600 text-white font-bold text-sm sm:text-base flex items-center justify-center transition-all shadow cursor-pointer"
                    >
                      {key}
                    </button>
                  ))}
                </div>

                {/* Row 2 */}
                <div className="flex justify-center gap-1 sm:gap-1.5">
                  {(keyboardLang === 'he' ? hebrewKeysRow2 : englishKeysRow2).map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKeyClick(key)}
                      className="w-8 h-10 sm:w-10 sm:h-11 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-indigo-600 text-white font-bold text-sm sm:text-base flex items-center justify-center transition-all shadow cursor-pointer"
                    >
                      {key}
                    </button>
                  ))}
                </div>

                {/* Row 3 */}
                <div className="flex justify-center gap-1 sm:gap-1.5">
                  {(keyboardLang === 'he' ? hebrewKeysRow3 : englishKeysRow3).map((key) => (
                    <button
                      key={key}
                      onClick={() => handleKeyClick(key)}
                      className="w-8 h-10 sm:w-10 sm:h-11 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-indigo-600 text-white font-bold text-sm sm:text-base flex items-center justify-center transition-all shadow cursor-pointer"
                    >
                      {key}
                    </button>
                  ))}
                </div>

                {/* Function Controls Row */}
                <div className="flex justify-center items-center gap-2 pt-1">
                  <button
                    onClick={() => handleKeyClick(' ')}
                    className="flex-1 max-w-xs h-10 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-indigo-600 text-slate-300 font-bold text-xs flex items-center justify-center transition-all cursor-pointer"
                  >
                    {isHe ? 'רווח (Space)' : 'Space'}
                  </button>

                  <button
                    onClick={handleBackspace}
                    className="px-4 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                    title={isHe ? 'מחק תו' : 'Backspace'}
                  >
                    <Delete className="w-4 h-4" />
                    <span>{isHe ? 'מחק' : 'Back'}</span>
                  </button>

                  <button
                    onClick={handleClear}
                    className="px-3 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    {isHe ? 'נקה' : 'Clear'}
                  </button>

                  <button
                    onClick={() => handleDuckDuckGoWebSearch()}
                    className="px-5 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{isHe ? 'בצע חיפוש' : 'Go'}</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* TOP ELLIPSE SEARCH CAPSULE & SEARCH RESULTS SECTION */}
      {/* "למעלה במיקום האליפסה היה אליפסת חיפוש אליה כתוב יוטיוב ומיתחת התוצאת האתרים שמצאה" */}
      {loadingSearch ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-8 text-center space-y-4 shadow-sm animate-pulse">
          <div className="w-10 h-10 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="font-extrabold text-sm text-slate-700">
            {isHe ? `מחפש תוצאות ברשת עבור "${searchQuery}"...` : `Searching web for "${searchQuery}"...`}
          </p>
        </div>
      ) : webSearchResults ? (
        <div className="space-y-6">
          {/* FLOATING ELLIPSE CAPSULE AT TOP (אליפסת חיפוש) */}
          <div className="flex justify-center">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="inline-flex items-center gap-3 px-6 py-2.5 rounded-full bg-slate-900 text-white shadow-xl border border-white/20"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-xs text-white/70">{isHe ? 'חיפוש ברשת:' : 'Search:'}</span>
              <span className="text-sm font-black text-white">{webSearchResults.heading}</span>
              <button
                onClick={() => setWebSearchResults(null)}
                className="p-1 hover:bg-white/20 rounded-full transition-colors cursor-pointer text-white/80 hover:text-white"
                title={isHe ? 'סגור תוצאות' : 'Close results'}
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          </div>

          {/* SEARCH RESULTS OF WEBSITES FOUND UNDERNEATH */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="font-extrabold text-base sm:text-lg text-slate-900 flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-600" />
                <span>
                  {isHe
                    ? `נמצאו ${webSearchResults.webResults.length} אתרים עבור "${webSearchResults.heading}"`
                    : `Found ${webSearchResults.webResults.length} websites for "${webSearchResults.heading}"`}
                </span>
              </h2>
              <span className="text-xs font-mono text-slate-400">DuckDuckGo Web Engine</span>
            </div>

            <div className="space-y-3">
              {webSearchResults.webResults.map((site, i) => (
                <div
                  key={i}
                  onClick={() => setActiveIframeSite(site)}
                  className="p-4 sm:p-5 bg-slate-50 hover:bg-indigo-50/40 border border-slate-200/90 hover:border-indigo-500 rounded-2xl transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer group shadow-xs"
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {site.favicon && (
                        <img src={site.favicon} alt="" className="w-4 h-4 rounded-sm" />
                      )}
                      <span className="text-xs font-mono text-indigo-700 font-bold dir-ltr">
                        {site.displayUrl}
                      </span>
                    </div>

                    <h3 className="font-black text-sm sm:text-base text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
                      {site.title}
                    </h3>
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {site.snippet}
                    </p>
                  </div>

                  {/* IN-APP OPEN BUTTON ("שיפתח את האתר בתוך האפליקציה על ולא בעמוד לחדש") */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveIframeSite(site);
                    }}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all flex-shrink-0 cursor-pointer"
                  >
                    <span>{isHe ? 'פתח אתר כאן' : 'Open In-App'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* SECTION 1: Wikipedia Featured Cards */}
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
              W
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                {isHe ? 'כרטיסיות מויקיפדיה' : 'Wikipedia Cards'}
              </h2>
              <p className="text-xs text-slate-500">
                {isHe ? 'לחץ על כרטיסייה לפתיחה מלאה של הערך בתוך העמוד' : 'Click card to read details in-page'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {wikiCards.map((wiki) => (
            <motion.div
              whileHover={{ y: -4 }}
              key={wiki.pageid}
              onClick={() => setSelectedWikiCard(wiki)}
              className="bg-white border border-slate-200 hover:border-amber-400 rounded-3xl p-5 shadow-sm hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start space-x-3 space-x-reverse mb-3">
                  {wiki.thumbnail && (
                    <img
                      src={wiki.thumbnail}
                      alt={wiki.title}
                      className="w-16 h-16 rounded-2xl object-cover border border-slate-200 flex-shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <h3 className="font-extrabold text-base text-slate-900 line-clamp-1">
                      {wiki.title}
                    </h3>
                    <span className="inline-block px-2 py-0.5 text-[10px] font-mono bg-amber-50 text-amber-700 border border-amber-200 rounded-md mt-1 font-bold">
                      ערך ויקיפדיה
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                  {wiki.extract || wiki.snippet}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-amber-700">
                <span>{isHe ? 'לחץ לקריאה מלאה בעמוד' : 'Read Details'}</span>
                <BookOpen className="w-4 h-4" />
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* SECTION 2: Songs & Videos Highlights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Songs */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Music className="w-5 h-5 text-indigo-600" />
              <span>{isHe ? 'שירים מומלצים' : 'Featured Songs'}</span>
            </h3>
            <button
              onClick={() => onNavigateTab('songs')}
              className="text-xs font-bold text-indigo-600 hover:underline"
            >
              {isHe ? 'לכל השירים' : 'View All'}
            </button>
          </div>

          <div className="space-y-3">
            {CURATED_JAMENDO_TRACKS.slice(0, 3).map((track) => (
              <div
                key={track.id}
                onClick={() => onPlayTrack(track)}
                className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 hover:bg-indigo-50 border border-slate-100 transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={track.coverUrl}
                    alt={track.artistName}
                    className="w-12 h-12 rounded-xl object-cover"
                  />
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm text-slate-900 truncate group-hover:text-indigo-600">
                      {track.name}
                    </h4>
                    <p className="text-xs text-slate-500 truncate">{track.artistName}</p>
                  </div>
                </div>

                <button className="w-8 h-8 rounded-full bg-white shadow flex items-center justify-center text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                  <Play className="w-4 h-4 fill-current translate-x-0.5" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Videos & Media */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
              <Film className="w-5 h-5 text-rose-600" />
              <span>{isHe ? 'סרטונים ומדיה היסטורית' : 'Historical Media'}</span>
            </h3>
            <button
              onClick={() => onNavigateTab('media')}
              className="text-xs font-bold text-rose-600 hover:underline"
            >
              {isHe ? 'לכל המדיה' : 'View All'}
            </button>
          </div>

          <div className="space-y-3">
            {CURATED_ARCHIVE_ITEMS.filter((i) => i.mediaType === 'movies')
              .slice(0, 3)
              .map((item) => (
                <div
                  key={item.identifier}
                  onClick={() => onPlayMedia(item)}
                  className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 hover:bg-rose-50 border border-slate-100 transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className="w-12 h-12 rounded-xl object-cover"
                    />
                    <div className="min-w-0">
                      <h4 className="font-bold text-sm text-slate-900 truncate group-hover:text-rose-600">
                        {item.title}
                      </h4>
                      <p className="text-xs text-slate-500 truncate">{item.creator}</p>
                    </div>
                  </div>

                  <button className="w-8 h-8 rounded-full bg-white shadow flex items-center justify-center text-rose-600 group-hover:bg-rose-600 group-hover:text-white transition-all">
                    <Play className="w-4 h-4 fill-current translate-x-0.5" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* SECTION 3: Open Software & Repos */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="font-bold text-base text-slate-900 flex items-center gap-2">
            <Code className="w-5 h-5 text-emerald-600" />
            <span>{isHe ? 'תוכנות קוד פתוח מובילות' : 'Top Open-Source Software'}</span>
          </h3>
          <button
            onClick={() => onNavigateTab('software')}
            className="text-xs font-bold text-emerald-600 hover:underline"
          >
            {isHe ? 'לכל התוכנות' : 'View All'}
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {CURATED_GITHUB_REPOS.slice(0, 4).map((repo) => (
            <div
              key={repo.name}
              className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 hover:border-emerald-500 transition-all space-y-2 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-slate-900">{repo.name}</span>
                  <div className="flex items-center gap-1 text-[11px] font-mono text-amber-600">
                    <Star className="w-3 h-3 fill-current" />
                    <span>{repo.stars}</span>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-1 line-clamp-2">{repo.description}</p>
              </div>

              <div className="pt-2 flex items-center justify-between text-[11px]">
                <span className="font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                  {repo.language}
                </span>
                <a
                  href={repo.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-600 hover:text-emerald-600 font-bold flex items-center gap-1"
                >
                  <span>קוד</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* IN-APP WEB BROWSER VIEWER MODAL ("שיפתח את האתר בתוך האפליקציה על ולא בעמוד לחדש") */}
      <AnimatePresence>
        {activeIframeSite && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-slate-950/75 backdrop-blur-2xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-6xl bg-white border border-slate-300 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[92vh]"
            >
              {/* Browser Address Bar Header */}
              <div className="p-3.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIframeKey((k) => k + 1)}
                    className="p-2 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all cursor-pointer shadow-xs"
                    title={isHe ? 'רענן דף' : 'Reload'}
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  {activeIframeSite.favicon && (
                    <img src={activeIframeSite.favicon} alt="" className="w-4 h-4 rounded-xs" />
                  )}
                </div>

                {/* Browser URL Bar with Lock */}
                <div className="flex-1 bg-white border border-slate-200 px-4 py-2 rounded-full text-xs font-mono text-slate-700 truncate shadow-inner text-left dir-ltr flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                  <span className="truncate">{activeIframeSite.url}</span>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={activeIframeSite.url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3.5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
                    title={isHe ? 'פתח בלשונית חיצונית אם האתר חוסם מסגרות' : 'Open in new tab'}
                  >
                    <span>{isHe ? 'לשונית חיצונית' : 'External'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    onClick={() => setActiveIframeSite(null)}
                    className="p-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 transition-all cursor-pointer"
                    title={isHe ? 'סגור דפדפן פנימי' : 'Close'}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Embedded In-App View Frame */}
              <div className="flex-1 bg-slate-50 relative flex flex-col">
                <iframe
                  key={iframeKey}
                  src={activeIframeSite.embedUrl || activeIframeSite.url}
                  title={activeIframeSite.title}
                  className="w-full flex-1 border-0"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />

                {/* Sub-bar providing summary preview */}
                <div className="p-3 bg-slate-900 text-white text-xs flex items-center justify-between border-t border-slate-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-indigo-400 truncate">{activeIframeSite.title}</span>
                    <span className="text-white/60 hidden sm:inline truncate">— {activeIframeSite.snippet}</span>
                  </div>
                  <span className="text-[10px] font-mono text-white/50 flex-shrink-0 mr-2">
                    {isHe ? 'מוצג בתוך האפליקציה' : 'In-App Web View'}
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Expanded Wikipedia Modal */}
      <AnimatePresence>
        {selectedWikiCard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-3xl bg-white border border-slate-200 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <h3 className="font-extrabold text-lg text-slate-900">{selectedWikiCard.title}</h3>
                <button
                  onClick={() => setSelectedWikiCard(null)}
                  className="p-2 rounded-2xl bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4 text-slate-800 custom-scrollbar">
                {selectedWikiCard.thumbnail && (
                  <img
                    src={selectedWikiCard.thumbnail}
                    alt={selectedWikiCard.title}
                    className="w-full max-h-72 object-cover rounded-2xl border border-slate-200"
                  />
                )}
                <div className="prose prose-slate max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                  {selectedWikiCard.extract || selectedWikiCard.snippet}
                </div>
              </div>

              <div className="p-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                <a
                  href={selectedWikiCard.pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-6 py-2.5 bg-indigo-600 text-white font-extrabold rounded-2xl text-xs inline-flex items-center gap-2 shadow"
                >
                  <span>פתח בויקיפדיה</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
