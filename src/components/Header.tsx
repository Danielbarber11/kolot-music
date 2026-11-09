import React from 'react';
import {
  Home,
  Bot,
  Film,
  Gamepad2,
  Radio,
  Smartphone,
  Code,
  Music,
  Info,
  ShieldCheck,
  Bookmark,
  Wifi,
  WifiOff,
  CloudSun,
  HelpCircle,
  Utensils,
  Trophy,
  Mic,
  Wand2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Language, EngineMode } from '../types';

interface HeaderProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  lang: Language;
  setLang: (lang: Language) => void;
  engineMode: EngineMode;
  setEngineMode: (mode: EngineMode) => void;
  bookmarkCount: number;
  onOpenBookmarks: () => void;
  aiModel?: 'pollinations' | 'perchance';
  setAiModel?: (m: 'pollinations' | 'perchance') => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  lang,
  setLang,
  engineMode,
  setEngineMode,
  bookmarkCount,
  onOpenBookmarks,
  aiModel = 'pollinations',
  setAiModel,
}) => {
  const isHe = lang === 'he';

  const capsuleItems = [
    { id: 'home', label: isHe ? 'בית' : 'Home', icon: Home },
    { id: 'bot', label: isHe ? 'בוט AI' : 'AI Bot', icon: Bot },
    { id: 'imageGen', label: isHe ? 'יצירת תמונות AI' : 'AI Images', icon: Wand2 },
    { id: 'songs', label: isHe ? 'שירים' : 'Songs', icon: Music },
    { id: 'media', label: isHe ? 'מדיה' : 'Media', icon: Film },
    { id: 'games', label: isHe ? 'משחקים' : 'Games', icon: Gamepad2 },
    { id: 'radio', label: isHe ? 'רדיו' : 'Radio', icon: Radio },
    { id: 'podcasts', label: isHe ? 'פודקאסטים' : 'Podcasts', icon: Mic },
    { id: 'sports', label: isHe ? 'ספורט' : 'Sports', icon: Trophy },
    { id: 'recipes', label: isHe ? 'מתכונים' : 'Recipes', icon: Utensils },
    { id: 'weather', label: isHe ? 'מזג אוויר ומפות' : 'Weather & Maps', icon: CloudSun },
    { id: 'trivia', label: isHe ? 'טריוויה' : 'Trivia', icon: HelpCircle },
    { id: 'apps', label: isHe ? 'אפליקציות' : 'Apps', icon: Smartphone },
    { id: 'software', label: isHe ? 'תוכנות' : 'Software', icon: Code },
    { id: 'info', label: isHe ? 'מידע' : 'Info', icon: Info },
    { id: 'terms', label: isHe ? 'תנאי שימוש' : 'Terms', icon: ShieldCheck },
  ];


  return (
    <div className="sticky top-3 z-50 flex items-center justify-center px-3 pointer-events-none transition-all">
      {/* FREELY FLOATING ELLIPSE CAPSULE NAVBAR WITH NO BACKGROUND HEADER */}
      <div className="pointer-events-auto relative inline-flex items-center gap-1 sm:gap-1.5 px-3 sm:px-4 py-2 rounded-full bg-white/90 backdrop-blur-2xl border border-slate-200/90 shadow-xl shadow-slate-900/5 max-w-full overflow-x-auto custom-scrollbar">
        {capsuleItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                isActive
                  ? 'text-white'
                  : 'text-slate-700 hover:text-slate-950 hover:bg-slate-200/70'
              }`}
            >
              {isActive && (
                <motion.div
                  layoutId="capsuleHighlight"
                  className="absolute inset-0 bg-indigo-600 rounded-full shadow-md shadow-indigo-600/30"
                  transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </span>
            </button>
          );
        })}

        {/* Action Tools */}
        <div className="flex items-center space-x-1.5 space-x-reverse pr-2 border-r border-slate-200 mr-1">
          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
            🎲 Perchance AI
          </span>

          <button
            onClick={() => setLang(lang === 'he' ? 'en' : 'he')}
            className="px-2 py-1 rounded-full text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all"
          >
            {lang === 'he' ? 'עברית' : 'EN'}
          </button>

          <button
            onClick={onOpenBookmarks}
            className="relative p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all"
          >
            <Bookmark className="w-3.5 h-3.5" />
            {bookmarkCount > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-indigo-600 text-white font-bold text-[8px] rounded-full flex items-center justify-center">
                {bookmarkCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
