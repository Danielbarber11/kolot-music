import React, { useState, useEffect } from 'react';
import { Cookie, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Language, ArtistProfile } from '../types';
import { AuthUser } from '../services/authService';
import { saveArtistAccountToR2 } from '../services/multiMusicService';

interface CookieBannerProps {
  lang: Language;
  currentUser?: AuthUser | null;
  artistProfile?: ArtistProfile | null;
  onOpenTerms?: () => void;
}

export const CookieBanner: React.FC<CookieBannerProps> = ({ lang, currentUser, artistProfile, onOpenTerms }) => {
  const isHe = lang === 'he';
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const localAccepted = localStorage.getItem('kolot_cookie_consent_accepted') === 'true';
    const hasAccount = !!currentUser || !!artistProfile;
    const profileAccepted = !!artistProfile?.hasAcceptedTerms;

    if (localAccepted || hasAccount || profileAccepted) {
      setIsVisible(false);
    } else {
      setIsVisible(true);
    }
  }, [currentUser, artistProfile]);

  const handleAccept = async () => {
    try {
      localStorage.setItem('kolot_cookie_consent_accepted', 'true');
    } catch {}
    setIsVisible(false);

    if (artistProfile && !artistProfile.hasAcceptedTerms) {
      const updated: ArtistProfile = {
        ...artistProfile,
        hasAcceptedTerms: true,
        acceptedTermsAt: artistProfile.acceptedTermsAt || new Date().toISOString(),
      };
      try {
        await saveArtistAccountToR2(updated);
      } catch (err) {
        console.warn('Failed to update consent in account:', err);
      }
    }
  };

  if (!isVisible) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', bounce: 0.1, duration: 0.4 }}
        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 z-[160] max-w-md w-full p-4 rounded-2xl bg-[#0a0a0c]/95 border border-white/15 backdrop-blur-2xl shadow-2xl text-white flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-normal"
        dir={isHe ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-white/10 border border-white/15 flex-shrink-0 text-white">
            <Cookie className="w-5 h-5 text-white" />
          </div>
          <p className="font-normal text-white/85 leading-relaxed">
            {isHe ? (
              <>
                המשך גלישתך באתר מהווה הסכמה לשימוש בקבצי עוגיות, אחסון מקומי וכלי מדידה ואנליטיקה (Google Analytics / Tag Manager), וכן ל
                <button
                  type="button"
                  onClick={onOpenTerms}
                  className="font-normal text-white underline underline-offset-4 decoration-white/80 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 mx-0.5 rounded transition-colors cursor-pointer"
                >
                  תנאי השימוש ומדיניות הפרטיות
                </button>
                {' '}באתר
              </>
            ) : (
              <>
                Continuing to browse constitutes consent to cookies, local storage, measurement analytics (Google Analytics / Tag Manager), and our{' '}
                <button
                  type="button"
                  onClick={onOpenTerms}
                  className="font-normal text-white underline underline-offset-4 decoration-white/80 bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                >
                  Terms of Service & Privacy Policy
                </button>
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={handleAccept}
          className="w-full sm:w-auto px-5 py-2 rounded-full bg-white hover:bg-neutral-200 text-black font-normal text-xs transition-all shadow-lg cursor-pointer flex items-center justify-center gap-1.5 flex-shrink-0 active:scale-95"
        >
          <Check className="w-4 h-4 text-black" />
          <span>{isHe ? 'הבנתי' : 'Got it'}</span>
        </button>
      </motion.div>
    </AnimatePresence>
  );
};

