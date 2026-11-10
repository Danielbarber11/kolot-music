import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  AlertCircle,
  RefreshCw,
  Shield,
  CheckCircle2,
} from 'lucide-react';
import { Language } from '../types';
import { loginWithGoogle } from '../services/firebaseService';
import { User as FirebaseUser } from 'firebase/auth';
import { Logo } from './Logo';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  initialMode?: 'login' | 'register';
  onSuccess?: (user: FirebaseUser) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  lang,
  onSuccess,
}) => {
  if (!isOpen) return null;
  const isHe = lang === 'he';

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const user = await loginWithGoogle();
      if (user) {
        if (onSuccess) onSuccess(user);
        onClose();
      }
    } catch (err: any) {
      console.warn('Google sign-in error:', err);
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setErrorMessage(isHe ? 'חלון ההתחברות נסגר. נסה שוב.' : 'Sign-in window was closed. Try again.');
      } else if (code === 'auth/popup-blocked') {
        setErrorMessage(isHe ? 'חלון קופץ נחסם בדפדפן. אנא אפשר חלונות קופצים בדפדפן.' : 'Popup was blocked by browser. Please allow popups.');
      } else {
        setErrorMessage(
          isHe
            ? 'ההתחברות באמצעות Google נכשלה. אנא ודא חיבור לאינטרנט ונסה שוב.'
            : 'Google sign-in failed. Please check internet connection and try again.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[180] bg-black/85 backdrop-blur-xl flex items-center justify-center p-4 overflow-y-auto"
        dir={isHe ? 'rtl' : 'ltr'}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="relative w-full max-w-md rounded-[32px] bg-neutral-950/95 border border-white/20 p-6 sm:p-8 shadow-2xl space-y-6 text-white text-center"
        >
          {/* Top Close Button */}
          <button
            type="button"
            onClick={onClose}
            className="absolute top-5 end-5 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Header Title & Branding with Company Logo */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-center">
              <Logo className="h-10 w-auto" />
            </div>
            <h2 className="text-2xl font-black tracking-tight text-white">
              {isHe ? 'כניסה למערכת Kolot Music' : 'Sign in to Kolot Music'}
            </h2>
            <p className="text-xs text-neutral-400 leading-relaxed max-w-xs mx-auto">
              {isHe
                ? 'התחבר באמצעות חשבון Google שלך כדי להעלות שירים, ליצור אלבומים, לנהל פרופיל אמן ולשמור תוכן.'
                : 'Sign in with your Google account to upload songs, create albums, and manage your artist profile.'}
            </p>
          </div>

          {/* Error Alert */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2.5 animate-fadeIn text-start">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed font-medium">{errorMessage}</span>
            </div>
          )}

          {/* Main Google Sign-In Button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isLoading}
              className="w-full py-4 px-6 rounded-full bg-white hover:bg-neutral-100 active:scale-95 text-black font-black text-sm flex items-center justify-center gap-3 transition-all cursor-pointer shadow-[0_0_25px_rgba(255,255,255,0.2)] disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin text-black" />
                  <span>{isHe ? 'מתחבר ל-Google...' : 'Signing in with Google...'}</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                  </svg>
                  <span>{isHe ? 'המשך עם Google' : 'Continue with Google'}</span>
                </>
              )}
            </button>
          </div>

          <div className="pt-2 flex items-center justify-center gap-1.5 text-[11px] text-neutral-400 font-medium">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isHe ? 'אימות מאובטח ומהיר באמצעות Google Auth' : 'Secure instant authentication via Google Auth'}</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
