import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  X,
  ArrowRight,
  RotateCcw,
  Contrast,
  Eye,
  Link2,
  Focus,
  Type,
  AlignJustify,
  PauseCircle,
  MousePointer2,
  Minus,
  Highlighter,
  ShieldCheck,
  Copy,
  Keyboard,
  FileCheck2,
  Check,
  Plus,
  Hand,
} from 'lucide-react';
import {
  AccessibilitySettings,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  PointerCapabilities,
  countActiveAccessibilityFeatures,
  detectPointerCapabilities,
  subscribePointerCapabilities,
} from '../services/accessibilityService';
import { Language } from '../types';

export const AccessibilityIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="7.2" r="1.25" fill="currentColor" stroke="none" />
    <path d="M7.5 10.5h9" />
    <path d="M12 10.5v3.7" />
    <path d="M10 18.2l2-4 2 4" />
  </svg>
);

interface AccessibilityPageProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AccessibilitySettings;
  onUpdateSettings: (next: AccessibilitySettings) => void;
  lang: Language;
}

export const AccessibilityPage: React.FC<AccessibilityPageProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  lang,
}) => {
  const isHe = lang === 'he';
  const [caps, setCaps] = useState<PointerCapabilities>(() => detectPointerCapabilities());
  const [copiedA11yEmail, setCopiedA11yEmail] = useState(false);

  useEffect(() => subscribePointerCapabilities(setCaps), []);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const { hasFinePointer, hasCoarsePointer } = caps;
  const activeCount = countActiveAccessibilityFeatures(settings, caps);
  const scales: Array<100 | 115 | 130 | 145> = [100, 115, 130, 145];

  const toggle = (key: keyof Omit<AccessibilitySettings, 'fontScale'>) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key],
    });
  };

  const resetAll = () => {
    onUpdateSettings({ ...DEFAULT_ACCESSIBILITY_SETTINGS });
  };

  const stepScale = (dir: -1 | 1) => {
    const idx = scales.indexOf(settings.fontScale);
    const nextIdx = Math.max(0, Math.min(scales.length - 1, idx + dir));
    onUpdateSettings({ ...settings, fontScale: scales[nextIdx] });
  };

  const featureCards: Array<{
    key: keyof Omit<AccessibilitySettings, 'fontScale'>;
    titleHe: string;
    titleEn: string;
    descHe: string;
    descEn: string;
    icon: React.ReactNode;
    hardware?: 'all' | 'fine' | 'coarse';
  }> = [
    {
      key: 'highContrast',
      titleHe: 'ניגודיות גבוהה',
      titleEn: 'High Contrast',
      descHe: 'חדות מרבית של טקסט לבן, מסגרות בולטות ורקע שחור מוחלט.',
      descEn: 'Maximum white-on-black contrast and crisp borders.',
      icon: <Contrast className="w-5 h-5" />,
      hardware: 'all',
    },
    {
      key: 'grayscale',
      titleHe: 'מצב גווני אפור',
      titleEn: 'Grayscale Mode',
      descHe: 'הצגת האתר בגווני שחור-לבן להקלה על רגישות לצבעים.',
      descEn: 'Display the interface in monochrome grayscale.',
      icon: <Eye className="w-5 h-5" />,
      hardware: 'all',
    },
    {
      key: 'stopAnimations',
      titleHe: 'עצירת אנימציות ותנועה',
      titleEn: 'Stop Animations',
      descHe: 'ביטול תנועה, גלילות אוטומטיות והבהובים בכל חלקי האתר.',
      descEn: 'Disable motion, marquees, and UI transitions.',
      icon: <PauseCircle className="w-5 h-5" />,
      hardware: 'all',
    },
    {
      key: 'highlightLinks',
      titleHe: 'הדגשת קישורים וכפתורים',
      titleEn: 'Highlight Links & Buttons',
      descHe: 'סימון ברור עם מסגרת וקו תחתון סביב כל אלמנט לחיץ.',
      descEn: 'Clear borders and underlines around interactive elements.',
      icon: <Link2 className="w-5 h-5" />,
      hardware: 'all',
    },
    {
      key: 'touchTargets',
      titleHe: 'הגדלת אזורי לחיצה (מסך מגע)',
      titleEn: 'Large Touch Targets',
      descHe: 'מגדיל כפתורים ורווחי לחיצה לנוחות מלאה בהפעלה באצבע על מסך מגע.',
      descEn: 'Enlarge tap areas and spacing for comfortable touch control.',
      icon: <Hand className="w-5 h-5" />,
      hardware: 'coarse',
    },
    {
      key: 'strongFocus',
      titleHe: 'הדגשת פוקוס מקלדת',
      titleEn: 'Keyboard Focus Ring',
      descHe: 'מסגרת לבנה עבה ובולטת בעת מעבר בין כפתורים באמצעות Tab.',
      descEn: 'Thick visible focus ring when navigating with Tab.',
      icon: <Focus className="w-5 h-5" />,
      hardware: 'fine',
    },
    {
      key: 'readableFont',
      titleHe: 'גופן קריא וברור',
      titleEn: 'Readable Font',
      descHe: 'החלפת הגופנים לגופן מערכת חד וקל לקריאה ללא עיטורים.',
      descEn: 'Switch to clean high-legibility sans-serif typography.',
      icon: <Type className="w-5 h-5" />,
      hardware: 'all',
    },
    {
      key: 'extraSpacing',
      titleHe: 'ריווח שורות ואותיות מוגדל',
      titleEn: 'Extra Line & Letter Spacing',
      descHe: 'מגדיל מרווחים בין אותיות, מילים ושורות לקריאה נוחה.',
      descEn: 'Increase line height and letter spacing across text.',
      icon: <AlignJustify className="w-5 h-5" />,
      hardware: 'all',
    },
    {
      key: 'largeCursor',
      titleHe: 'סמן עכבר מוגדל',
      titleEn: 'Large Cursor',
      descHe: 'הגדלת סמן העכבר והוספת ניגודיות גבוהה לזיהוי מהיר.',
      descEn: 'Enlarge the mouse pointer for easier visibility.',
      icon: <MousePointer2 className="w-5 h-5" />,
      hardware: 'fine',
    },
    {
      key: 'readingGuide',
      titleHe: 'סרגל עזר לקריאה',
      titleEn: 'Reading Guide',
      descHe: 'פס אופקי מואר העוקב אחר תנועת העכבר ומסייע בהתמקדות בשורה.',
      descEn: 'Horizontal reading line following the mouse pointer.',
      icon: <Minus className="w-5 h-5" />,
      hardware: 'fine',
    },
    {
      key: 'allowTextSelection',
      titleHe: 'סימון טקסט לקריאה (ללא העתקה)',
      titleEn: 'Allow Text Highlighting (No Copy)',
      descHe: hasFinePointer
        ? 'מאפשר לסמן שורות עם העכבר לצורך מעקב וקריאה בלבד. העתקת תוכן ושמירת תמונות נשארות חסומות.'
        : 'מאפשר לסמן שורות בלחיצה ממושכת לצורך מעקב וקריאה בלבד. העתקת תוכן ושמירת תמונות נשארות חסומות.',
      descEn: 'Allows marking text visually for reading while keeping clipboard copying and image saving disabled.',
      icon: <Highlighter className="w-5 h-5" />,
      hardware: 'all',
    },
  ];

  const visibleCards = featureCards.filter((card) => {
    if (card.hardware === 'fine') return hasFinePointer;
    if (card.hardware === 'coarse') return hasCoarsePointer;
    return true;
  });

  const hardwareLabelHe =
    hasFinePointer && hasCoarsePointer
      ? 'זוהו מסך מגע + עכבר/מקלדת — מוצגות הגדרות מגע וגם עכבר'
      : hasFinePointer
        ? 'זוהתה סביבת עכבר ומקלדת — מוצגות הגדרות מותאמות'
        : 'זוהה מסך מגע בלבד — הגדרות עכבר הוסרו אוטומטית';

  const hardwareLabelEn =
    hasFinePointer && hasCoarsePointer
      ? 'Touch + Mouse detected — showing both'
      : hasFinePointer
        ? 'Mouse & Keyboard detected'
        : 'Touch screen only — mouse-only tools hidden';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      role="dialog"
      aria-modal="true"
      aria-label={isHe ? 'דף והצהרת נגישות' : 'Accessibility Settings & Statement'}
      dir={isHe ? 'rtl' : 'ltr'}
      className="fixed inset-0 z-[170] bg-black text-white font-sans font-normal h-[100dvh] overflow-y-auto custom-scrollbar"
    >
      {/* Top Bar */}
      <header className="sticky top-0 z-20 bg-black/95 backdrop-blur-xl border-b border-white/15">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
              aria-label={isHe ? 'חזור לאתר' : 'Back to site'}
              title={isHe ? 'חזור לאתר' : 'Back to site'}
            >
              <ArrowRight className={`w-4 h-4 ${isHe ? '' : 'rotate-180'}`} />
            </button>

            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-white text-black flex items-center justify-center shrink-0">
                <AccessibilityIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-lg font-normal tracking-normal text-white truncate">
                  {isHe ? 'נגישות האתר והתאמה אישית' : 'Accessibility Center'}
                </h1>
                <p className="text-[11px] font-normal text-neutral-400 truncate">
                  {isHe
                    ? `תקן ישראלי ת"י 5568 (WCAG 2.1 AA) • ${activeCount > 0 ? `${activeCount} התאמות פעילות` : 'מצב ברירת מחדל'}`
                    : `WCAG 2.1 AA Compliant • ${activeCount} active adjustments`}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {activeCount > 0 && (
              <button
                type="button"
                onClick={resetAll}
                className="h-9 px-3 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white text-xs font-normal flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isHe ? 'איפוס הגדרות' : 'Reset'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 pb-20 font-normal">
        {/* Section 1: Font Size Control */}
        <section className="rounded-2xl bg-[#0a0a0a] border border-white/15 p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-base sm:text-lg font-normal text-white flex items-center gap-2">
                <Type className="w-5 h-5 text-white" />
                <span>{isHe ? 'גודל טקסט ותצוגה' : 'Text & Display Size'}</span>
              </h2>
              <p className="text-xs font-normal text-neutral-400">
                {isHe
                  ? 'הגדלה או הקטנה פרופורציונלית של כלל הטקסטים, הכפתורים והנגן באתר.'
                  : 'Proportionally scale typography and UI controls across the platform.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 shrink-0 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => stepScale(-1)}
                disabled={settings.fontScale === 100}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-35 border border-white/15 text-white flex items-center justify-center cursor-pointer disabled:cursor-not-allowed transition-colors"
                aria-label={isHe ? 'הקטן טקסט' : 'Decrease text size'}
              >
                <Minus className="w-4 h-4" />
              </button>

              <div className="grid grid-cols-4 gap-1 bg-black p-1 rounded-xl border border-white/15 flex-1 sm:flex-none max-w-[260px]">
                {scales.map((scale) => {
                  const selected = settings.fontScale === scale;
                  return (
                    <button
                      key={scale}
                      type="button"
                      onClick={() => onUpdateSettings({ ...settings, fontScale: scale })}
                      aria-pressed={selected}
                      className={`px-2 sm:px-3 py-1.5 rounded-lg text-xs font-normal transition-all cursor-pointer ${
                        selected
                          ? 'bg-white text-black shadow-sm'
                          : 'text-neutral-300 hover:text-white hover:bg-white/10'
                      }`}
                    >
                      {scale}%
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => stepScale(1)}
                disabled={settings.fontScale === 145}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-35 border border-white/15 text-white flex items-center justify-center cursor-pointer disabled:cursor-not-allowed transition-colors"
                aria-label={isHe ? 'הגדל טקסט' : 'Increase text size'}
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Section 2: Interactive Accessibility Adjustments (Hardware-Aware) */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-normal text-white">
                {isHe ? 'כלי התאמת נגישות באתר' : 'Site Accessibility Tools'}
              </h2>
              <p className="text-[11px] font-normal text-neutral-400">
                {isHe ? hardwareLabelHe : hardwareLabelEn}
              </p>
            </div>
            <span className="text-xs font-normal text-neutral-400">
              {isHe ? 'השינויים נשמרים אוטומטית בדפדפן' : 'Saved automatically'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {visibleCards.map((card) => {
              const isActive = Boolean(settings[card.key]);
              return (
                <button
                  key={card.key}
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  onClick={() => toggle(card.key)}
                  className={`text-start p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-4 font-normal ${
                    isActive
                      ? 'bg-white text-black border-white shadow-[0_0_24px_rgba(255,255,255,0.16)]'
                      : 'bg-[#0a0a0a] text-white border-white/15 hover:border-white/35 hover:bg-[#111111]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 w-full">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isActive ? 'bg-black text-white' : 'bg-white/10 text-white'
                      }`}
                    >
                      {card.icon}
                    </div>

                    <div
                      className={`px-2.5 py-1 rounded-lg text-xs font-normal flex items-center gap-1 border ${
                        isActive
                          ? 'bg-black text-white border-black'
                          : 'bg-black/60 text-neutral-300 border-white/15'
                      }`}
                    >
                      {isActive && <Check className="w-3 h-3" />}
                      <span>{isActive ? (isHe ? 'פעיל' : 'ON') : (isHe ? 'כבוי' : 'OFF')}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <h3 className={`text-sm font-normal ${isActive ? 'text-black' : 'text-white'}`}>
                      {isHe ? card.titleHe : card.titleEn}
                    </h3>
                    <p
                      className={`text-xs font-normal leading-relaxed ${
                        isActive ? 'text-neutral-700' : 'text-neutral-400'
                      }`}
                    >
                      {isHe ? card.descHe : card.descEn}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Section 3: Keyboard Navigation Shortcuts (Shown only when Mouse/Keyboard hardware is available) */}
        {hasFinePointer && (
          <section className="rounded-2xl bg-[#0a0a0a] border border-white/15 p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Keyboard className="w-5 h-5 text-white" />
              <h2 className="text-base sm:text-lg font-normal text-white">
                {isHe ? 'ניווט מקלדת מהיר באתר ובנגן' : 'Keyboard Navigation'}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-normal">
              {[
                { key: 'Tab / Shift + Tab', desc: 'מעבר קדימה ואחורה בין כפתורים, שירים וקישורים' },
                { key: 'Enter / Space', desc: 'הפעלת כפתור, בחירת שיר, או השהייה/ניגון' },
                { key: 'Escape', desc: 'סגירת חלון הנגישות, חלונות קופצים או תפריטים' },
                { key: 'חיצים שמאלה / ימינה', desc: 'דילוג קדימה או אחורה של 10 שניות בנגן' },
                { key: 'חיצים למעלה / למטה', desc: 'התאמת עוצמת השמע (Volume) בנגן' },
                { key: 'קורא מסך (ARIA)', desc: 'תמיכה מלאה בתגיות סמנטיות ובתיאורי ARIA' },
              ].map((item) => (
                <div
                  key={item.key}
                  className="p-3.5 rounded-xl bg-black border border-white/10 flex flex-col gap-1.5"
                >
                  <span className="font-normal text-white text-xs">{item.key}</span>
                  <span className="font-normal text-neutral-400 leading-relaxed">{item.desc}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 4: Legal Accessibility Statement (Israeli Standard 5568 / WCAG 2.1 AA) */}
        <section className="rounded-2xl bg-[#0a0a0a] border border-white/15 p-5 sm:p-7 space-y-5 font-normal">
          <div className="flex items-center justify-between flex-wrap gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-2.5">
              <FileCheck2 className="w-5 h-5 text-white" />
              <h2 className="text-base sm:text-lg font-normal text-white">
                {isHe ? 'הצהרת נגישות לפי החוק — Kolot Music' : 'Legal Accessibility Statement'}
              </h2>
            </div>
            <span className="text-xs font-normal text-neutral-400">
              תאריך עדכון אחרון: 21.11.2026
            </span>
          </div>

          <div className="space-y-4 text-xs sm:text-sm font-normal text-neutral-300 leading-relaxed">
            <div className="space-y-1.5">
              <h3 className="text-white font-normal text-sm">1. מחויבות לנגישות ועמידה בתקן</h3>
              <p>
                פלטפורמת Kolot Music (קולות מוזיקה) רואה חשיבות עליונה במתן שירות שוויוני, מכבד ונגיש לכלל המשתמשים, לרבות אנשים עם מוגבלויות. האתר והנגן הותאמו בהתאם להוראות חוק שוויון זכויות לאנשים עם מוגבלות (תשנ"ח-1998), לתקנות הנגישות לשירות, ולהנחיות התקן הישראלי ת"י 5568 ברמת AA (המבוסס על WCAG 2.1).
              </p>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-white font-normal text-sm">2. התאמות הנגישות שבוצעו באתר</h3>
              <ul className="list-disc ps-5 space-y-1 text-neutral-300">
                <li>התאמה דינמית חכמה למכשירי מגע ולמחשבים עם עכבר/מקלדת.</li>
                <li>תמיכה בקוראי מסך באמצעות היררכיית כותרות תקנית, תגיות סמנטיות ותיאורי aria-label.</li>
                <li>כתוביות מתוזמנות בנגן המוזיקה עבור כבדי שמיעה וחירשים.</li>
                <li>תפריט נגישות מובנה המאפשר הגדלת טקסט עד 145%, ניגודיות גבוהה, גווני אפור, עצירת אנימציות, גופן קריא והגדלת אזורי מגע.</li>
                <li>מניעת הבהובים או תנועה מהירה העלולים להפריע למשתמשים רגישים.</li>
                <li>הגנת זכויות יוצרים על קבצי שמע ותמונות ללא פגיעה בקריאות האתר לקוראי מסך ולמקלדת.</li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-white font-normal text-sm">3. שמירת זכויות יוצרים וסימון טקסט</h3>
              <p>
                לצורך הגנה על זכויות האמנים והיוצרים באתר, העתקת טקסטים ללוח והורדת/גרירת תמונות חסומות כברירת מחדל. חסימות אלו אינן פוגעות בפעולת קוראי המסך ובניווט המקלדת. בנוסף, משתמשים הזקוקים להדגשה חזותית של טקסט בזמן הקריאה יכולים להפעיל בדף זה את האפשרות „סימון טקסט לקריאה (ללא העתקה)”.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-black border border-white/15 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h3 className="text-white font-normal text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-white" />
                  <span>רכז נגישות ופניות בנושא נגישות</span>
                </h3>
                <p className="text-xs font-normal text-neutral-400">
                  נתקלתם בבעיית נגישות או יש לכם הצעה לשיפור? פנו אלינו ונטפל בפנייה בהקדם האפשרי:
                </p>
                <p className="text-xs font-normal text-white font-mono" dir="ltr">kolot-music@googlegroups.com</p>
              </div>

              <button
                type="button"
                onClick={() => {
                  try {
                    navigator.clipboard.writeText('kolot-music@googlegroups.com');
                    setCopiedA11yEmail(true);
                    setTimeout(() => setCopiedA11yEmail(false), 2500);
                  } catch {}
                }}
                className="h-10 px-4 rounded-xl bg-white hover:bg-neutral-200 text-black font-normal text-xs flex items-center justify-center gap-2 shrink-0 transition-colors cursor-pointer"
              >
                {copiedA11yEmail ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>
                  {copiedA11yEmail
                    ? isHe ? 'כתובת המייל הועתקה!' : 'Copied!'
                    : isHe ? 'העתק כתובת מייל לפניות' : 'Copy Accessibility Email'}
                </span>
              </button>
            </div>
          </div>
        </section>
      </main>
    </motion.div>
  );
};
