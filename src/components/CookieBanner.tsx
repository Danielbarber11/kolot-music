import React, { useState, useEffect } from 'react';
import { Cookie, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Language } from '../types';

interface CookieBannerProps {
  lang: Language;
}

export const CookieBanner: React.FC<CookieBannerProps> = ({ lang }) => {
  const isHe = lang === 'he';
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem('kolot_cookie_consent_accepted');
    if (!accepted) {
      setIsVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem('kolot_cookie_consent_accepted', 'true');
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', bounce: 0.1, duration: 0.4 }}
        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 z-[160] max-w-md w-full p-4 rounded-2xl bg-slate-900/95 border border-white/20 backdrop-blur-2xl shadow-2xl text-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs"
        dir={isHe ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 flex-shrink-0">
            <Cookie className="w-5 h-5 text-amber-400" />
          </div>
          <p className="font-bold text-white/90 leading-snug">
            {isHe
              ? 'הישארותך באתר מהווה הסכמה לקבצי עוגיות ולתנאי שימוש באתר'
              : 'Your stay on the site constitutes consent to cookies and terms of use'}
          </p>
        </div>

        <button
          onClick={handleAccept}
          className="w-full sm:w-auto px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition-all shadow-lg cursor-pointer flex items-center justify-center gap-1.5 flex-shrink-0"
        >
          <Check className="w-4 h-4 text-slate-950" />
          <span>{isHe ? 'הבנתי' : 'Got it'}</span>
        </button>
      </motion.div>
    </AnimatePresence>
  );
};
