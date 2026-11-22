import React from 'react';
import { ShieldCheck, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Language } from '../types';

interface TermsModalProps {
  isOpen: boolean;
  onAccept: () => void;
  lang: Language;
}

export const TermsModal: React.FC<TermsModalProps> = ({ isOpen, onAccept, lang }) => {
  if (!isOpen) return null;
  const isHe = lang === 'he';

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center p-4 pt-6 overflow-y-auto bg-slate-950/95 backdrop-blur-3xl animate-fadeIn select-none"
        dir={isHe ? 'rtl' : 'ltr'}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="relative w-full max-w-xl bg-[#09090b] border border-white/25 rounded-3xl p-5 sm:p-8 shadow-2xl text-white space-y-5 my-auto"
        >
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <div className="p-3 rounded-2xl bg-white/10 text-white border border-white/20">
              <ShieldCheck className="w-7 h-7 text-white" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2">
                <span>{isHe ? 'אישור תנאי שימוש חובה - Kolot Music' : 'Mandatory Terms - Kolot Music'}</span>
              </h2>
              <p className="text-xs text-white/60">
                {isHe ? 'כדי להמשיך להשתמש ולהאזין בפלטפורמה יש לאשר את תנאי השימוש' : 'Must accept terms before using the platform'}
              </p>
            </div>
          </div>

          <div className="space-y-3 text-xs leading-relaxed text-white/85 max-h-60 overflow-y-auto p-4 rounded-2xl bg-neutral-900 border border-white/10 custom-scrollbar">
            <h4 className="font-extrabold text-white text-sm">
              {isHe ? 'תנאי ההפצה ואחסון השירים (Terms & Public Storage Rights):' : 'Music Streaming & Storage Terms:'}
            </h4>
            <ul className="space-y-2 list-disc list-inside text-[11px] text-white/80">
              <li>
                {isHe
                  ? 'העלאת שיר מהווה הרשאה מפורשת לבעלי הפלטפורמה להאזין, להפיץ ולאחסן את קבצי השמע והתמונות בשרת האחסון הציבורי של האתר (בנפח 1GB) ובשרתי הענן שבהם פועלת הפלטפורמה.'
                  : 'Uploading gives platform permission to host and stream your audio files in public cloud storage repositories (1GB capacity).'}
              </li>
              <li>
                {isHe
                  ? 'העולה מצהיר/ה כי התוכן הינו מקורי ובבעלותו מלאה או ברישיון שימוש תקף. אין להעלות תוכן המפר זכויות יוצרים.'
                  : 'You declare that uploaded content is original or legally licensed.'}
              </li>
              <li>
                {isHe
                  ? 'כל תוכן שהועלה לאתר הינו באחריות בעל הפרופיל המעלה בלבד. בכל תביעה או דרישה שתופנה כלפינו בקשר לתוכן שהועלה, האחריות המלאה חלה על המעלה בלבד, ואנו אחראים רק להסיר את התוכן מהפלטפורמה במידת הצורך. במקרה של תלונה על זכויות יוצרים או כל תלונה אחרת, המשתמש יקבל הודעה לכתובת המייל האישית שלו.'
                  : 'All uploaded content is under the sole responsibility of the uploading profile owner. For any claim directed against us regarding uploaded content, full responsibility rests solely with the uploader and our responsibility is limited strictly to removing the content from the platform if needed. If a copyright or other complaint is submitted, the user will receive a notification at their personal email address.'}
              </li>
              <li>
                {isHe
                  ? 'במקרה של הפרת זכויות יוצרים או דיווח פוגעני, לבעלי האתר שמורה הסמכות המלאה להסיר את השיר או לסגור את פרופיל האמן באופן מיידי.'
                  : 'Platform admins reserve full right to delete infringing tracks or suspend accounts.'}
              </li>
              <li>
                {isHe
                  ? 'השימוש באתר מיועד בהתאם לדין החל ולמדיניות הזמינות הגיאוגרפית.'
                  : 'Service is governed under standard geographical distribution terms.'}
              </li>
              <li>
                {isHe
                  ? 'הכתוביות, התמלולים והתרגומים המוצגים בנגן (לרבות אלו המופקים באמצעות בינה מלאכותית – AI וזיהוי דיבור אוטומטי) הינם משוערים ועלולים לכלול שגיאות כתיב, השמטות, טעויות תרגום או אי-דיוקים בתזמון. השירות ניתן כמות שהוא ("AS IS") ללא כל התחייבות או אחריות לדיוקם.'
                  : 'Synchronized subtitles, transcriptions, and translations (including those generated automatically via AI speech recognition) are provided "AS IS" and may contain errors, omissions, or timing offsets.'}
              </li>
              <li>
                {isHe
                  ? 'פרטי היצירות, ז׳אנרים, קרדיטים, תיאורי אמנים ונתוני מטא-דאטה המוצגים באתר עשויים להכיל אי-דיוקים, פערים או טעויות סופר, והנהלת האתר אינה נושאת באחריות לנכונותם.'
                  : 'Track metadata, credits, genres, and artist descriptions displayed on the platform may contain inaccuracies or typographical errors without liability.'}
              </li>
              <li>
                {isHe
                  ? 'מספרי הצפיות, ההשמעות, האהבות והמדדים הסטטיסטיים המוצגים באתר מהווים אומדן טכני ומשוער בלבד, מושפעים משמירה במטמון (Cache) והשהיית סנכרון, ואינם מהווים נתון רשמי, מחייב או ראיה משפטית.'
                  : 'View counts, play counts, likes, and analytical metrics displayed on the platform are technical estimates only, subject to caching and sync delays, and do not constitute official records.'}
              </li>
              <li>
                {isHe
                  ? 'פניות להנהלה, תלונות ודיווחי זכויות יוצרים מתקבלים באמצעות טופס יצירת הקשר ובכתובת קבוצת המייל הרשמית (Google Groups): kolot-music@googlegroups.com'
                  : 'Management inquiries, complaints, and copyright reports are handled via Contact Us and Google Groups at: kolot-music@googlegroups.com'}
              </li>
            </ul>
          </div>

          <button
            onClick={onAccept}
            className="w-full py-4 rounded-2xl bg-white hover:bg-neutral-200 text-black font-black text-sm transition-all shadow-xl cursor-pointer flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-95"
          >
            <Check className="w-5 h-5 text-black" />
            <span>{isHe ? 'אני מאשר/ת את תנאי השימוש וממשיך/ה לאתר' : 'I Accept & Continue'}</span>
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
