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
        className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-950/95 backdrop-blur-3xl animate-fadeIn select-none"
        dir={isHe ? 'rtl' : 'ltr'}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="relative w-full max-w-xl bg-[#0f172a] border-2 border-emerald-500/50 rounded-3xl p-6 sm:p-8 shadow-2xl text-white space-y-6"
        >
          <div className="flex items-center gap-3 border-b border-white/10 pb-4">
            <div className="p-3 rounded-2xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <ShieldCheck className="w-7 h-7 text-emerald-400" />
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

          <div className="space-y-3 text-xs leading-relaxed text-white/85 max-h-60 overflow-y-auto p-4 rounded-2xl bg-slate-900 border border-white/10 custom-scrollbar">
            <h4 className="font-extrabold text-emerald-300 text-sm">
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
                  ? 'במקרה של הפרת זכויות יוצרים או דיווח פוגעני, לבעלי האתר שמורה הסמכות המלאה להסיר את השיר או לסגור את פרופיל האמן באופן מיידי.'
                  : 'Platform admins reserve full right to delete infringing tracks or suspend accounts.'}
              </li>
              <li>
                {isHe
                  ? 'השימוש באתר מיועד לתושבי ישראל בלבד בהתאם למדיניות הזמינות הגיאוגרפית.'
                  : 'Service is governed under standard geographical distribution terms.'}
              </li>
            </ul>
          </div>

          <button
            onClick={onAccept}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:brightness-110 text-slate-950 font-black text-sm transition-all shadow-xl cursor-pointer flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-95"
          >
            <Check className="w-5 h-5 text-slate-950" />
            <span>{isHe ? 'אני מאשר/ת את תנאי השימוש וממשיך/ה לאתר' : 'I Accept & Continue'}</span>
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
