import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Mail,
  Lock,
  User,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
  KeyRound,
  Shield,
} from 'lucide-react';
import { Language } from '../types';
import {
  loginWithGoogle,
  loginWithMicrosoft,
  loginWithEmailPassword,
  registerWithEmailPassword,
  loginWithFacebook,
  loginWithYahoo,
  resetAccountPassword,
} from '../services/firebaseService';
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
  initialMode = 'login',
  onSuccess,
}) => {
  const isHe = lang === 'he';

  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  if (!isOpen) return null;

  const translateAuthError = (err: any): string => {
    const code = err?.code || '';
    switch (code) {
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return isHe ? 'הסיסמה שהוזנה שגויה או שהפרטים אינם תואמים.' : 'Invalid email or password.';
      case 'auth/user-not-found':
        return isHe ? 'לא נמצא חשבון עם כתובת אימייל זו. לחץ על הרשמה ליצירת חשבון חדש.' : 'User not found. Please register.';
      case 'auth/email-already-in-use':
        return isHe ? 'כתובת האימייל כבר קיימת במערכת. נסה להתחבר.' : 'Email is already registered. Please sign in.';
      case 'auth/weak-password':
        return isHe ? 'הסיסמה קצרה מדי. יש להזין לפחות 6 תווים.' : 'Password must be at least 6 characters.';
      case 'auth/invalid-email':
        return isHe ? 'כתובת האימייל אינה תקינה.' : 'Invalid email address.';
      case 'auth/popup-closed-by-user':
        return isHe ? 'חלון ההתחברות נסגר לפני סיום התהליך.' : 'Sign-in window closed by user.';
      case 'auth/operation-not-allowed':
        return isHe
          ? 'ספק התחברות זה עדיין לא הופעל בלוח הבקרה של Firebase (Authentication > Sign-in method).'
          : 'This sign-in provider is not enabled yet in your Firebase console.';
      default:
        return err?.message || (isHe ? 'שגיאה בהתחברות. נסה שוב.' : 'Sign-in error. Please try again.');
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMessage(isHe ? 'נא למלא אימייל וסיסמה' : 'Please fill all fields');
      return;
    }

    if (mode === 'register') {
      if (password.length < 6) {
        setErrorMessage(isHe ? 'הסיסמה חייבת להכיל לפחות 6 תווים' : 'Password must be at least 6 characters');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage(isHe ? 'הסיסמאות אינן תואמות' : 'Passwords do not match');
        return;
      }
    }

    setIsLoading(true);
    try {
      let user: FirebaseUser | null = null;
      if (mode === 'login') {
        user = await loginWithEmailPassword(cleanEmail, password);
      } else {
        user = await registerWithEmailPassword(cleanEmail, password, displayName.trim() || undefined);
      }

      if (user) {
        if (onSuccess) onSuccess(user);
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(translateAuthError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = async (providerName: string, loginFn: () => Promise<FirebaseUser | null>) => {
    setErrorMessage(null);
    setInfoMessage(null);
    setLoadingProvider(providerName);

    try {
      const user = await loginFn();
      if (user) {
        if (onSuccess) onSuccess(user);
        onClose();
      }
    } catch (err: any) {
      const code = err?.code || '';
      if (
        code === 'auth/operation-not-allowed' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/configuration-not-found'
      ) {
        setErrorMessage(
          isHe
            ? `התחברות דרך ${providerName} מצריכה הפעלה והזנת מפתח אפליקציה (Client ID) בקונסולת Firebase (במסך Authentication > Sign-in method). כעת ניתן להתחבר ישירות דרך גוגל או אימייל וסיסמה.`
            : `${providerName} authentication requires Client ID configuration in Firebase Console. Please sign in via Google or Email.`
        );
      } else if (code === 'auth/account-exists-with-different-credential') {
        setErrorMessage(
          isHe
            ? `קיים כבר חשבון במערכת עם כתובת אימייל זו תחת ספק אחר (גוגל / אימייל וסיסמה). אנא התחבר דרך הספק המקורי.`
            : `An account already exists with this email address under another provider. Please sign in with your original provider.`
        );
      } else {
        setErrorMessage(translateAuthError(err));
      }
    } finally {
      setLoadingProvider(null);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setIsForgotLoading(true);
    setErrorMessage(null);

    try {
      await resetAccountPassword(forgotEmail.trim());
      setForgotSent(true);
    } catch (err: any) {
      setErrorMessage(translateAuthError(err));
    } finally {
      setIsForgotLoading(false);
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
          className="relative w-full max-w-md rounded-[32px] bg-neutral-950/95 border border-white/20 p-6 sm:p-8 shadow-2xl space-y-6 text-white"
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
          <div className="space-y-3 text-center pt-2">
            <div className="flex items-center justify-center">
              <Logo className="h-9 w-auto" />
            </div>
            <h2 className="text-xl font-bold tracking-tight text-white">
              {mode === 'login'
                ? (isHe ? 'כניסה לחשבון' : 'Sign In')
                : (isHe ? 'יצירת חשבון חדש' : 'Create Account')}
            </h2>
          </div>

          {/* Pill Capsule Switcher (אליפסה עם 2 לחצני אליפסה) */}
          <div className="p-1 rounded-full bg-white/10 border border-white/20 backdrop-blur-md flex items-center justify-between gap-1 shadow-inner select-none">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMessage(null);
              }}
              className={`flex-1 py-2.5 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                mode === 'login'
                  ? 'bg-white text-black shadow-lg scale-[1.01]'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              <span>{isHe ? 'כניסה' : 'Sign In'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMessage(null);
              }}
              className={`flex-1 py-2.5 rounded-full text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                mode === 'register'
                  ? 'bg-gradient-to-r from-emerald-500 to-teal-400 text-black shadow-lg scale-[1.01]'
                  : 'text-white/70 hover:text-white'
              }`}
            >
              <span>{isHe ? 'הרשמה' : 'Sign Up'}</span>
            </button>
          </div>

          {/* Error & Info Alerts */}
          {errorMessage && (
            <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-start gap-2.5 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed font-medium">{errorMessage}</span>
            </div>
          )}

          {infoMessage && (
            <div className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-start gap-2.5 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="leading-relaxed font-medium">{infoMessage}</span>
            </div>
          )}

          {/* Email / Password Form with Pill Inputs */}
          <form onSubmit={handleEmailAuth} className="space-y-3.5">
            {mode === 'register' && (
              <div>
                <label className="block text-[11px] font-bold text-neutral-300 mb-1 ps-3">
                  {isHe ? 'שם מלא או שם במה (אופציונלי)' : 'Display / Stage Name'}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 start-0 ps-4 flex items-center pointer-events-none text-neutral-400">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={isHe ? 'דניאל ברבר' : 'Daniel Barber'}
                    className="w-full ps-11 pe-4 py-3.5 rounded-full bg-neutral-900 border border-neutral-700 text-white text-xs font-normal focus:outline-none focus:border-emerald-400 placeholder-neutral-500 transition-colors"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-neutral-300 mb-1 ps-3">
                {isHe ? 'כתובת אימייל *' : 'Email Address *'}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 start-0 ps-4 flex items-center pointer-events-none text-neutral-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your-email@example.com"
                  className="w-full ps-11 pe-4 py-3.5 rounded-full bg-neutral-900 border border-neutral-700 text-white font-sans text-xs font-normal focus:outline-none focus:border-emerald-400 placeholder-neutral-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1 px-3">
                <label className="block text-[11px] font-bold text-neutral-300">
                  {isHe ? 'סיסמה (לפחות 6 תווים) *' : 'Password (min. 6 chars) *'}
                </label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(email);
                      setShowForgotModal(true);
                    }}
                    className="text-[10px] text-neutral-400 hover:text-emerald-400 transition-colors cursor-pointer"
                  >
                    {isHe ? 'שכחת סיסמה?' : 'Forgot?'}
                  </button>
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 start-0 ps-4 flex items-center pointer-events-none text-neutral-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full ps-11 pe-4 py-3.5 rounded-full bg-neutral-900 border border-neutral-700 text-white font-sans text-xs font-normal focus:outline-none focus:border-emerald-400 placeholder-neutral-500 transition-colors"
                />
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-[11px] font-bold text-neutral-300 mb-1 ps-3">
                  {isHe ? 'אימות סיסמה *' : 'Confirm Password *'}
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 start-0 ps-4 flex items-center pointer-events-none text-neutral-400">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full ps-11 pe-4 py-3.5 rounded-full bg-neutral-900 border border-neutral-700 text-white font-sans text-xs font-normal focus:outline-none focus:border-emerald-400 placeholder-neutral-500 transition-colors"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !email.trim() || !password}
              className={`w-full py-3.5 rounded-full font-bold text-xs transition-all cursor-pointer flex items-center justify-center gap-2 shadow-xl active:scale-95 disabled:opacity-40 ${
                mode === 'login'
                  ? 'bg-white hover:bg-neutral-200 text-black'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-black'
              }`}
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>{mode === 'login' ? (isHe ? 'מתחבר...' : 'Signing in...') : (isHe ? 'יוצר חשבון...' : 'Registering...')}</span>
                </>
              ) : (
                <span>
                  {mode === 'login'
                    ? (isHe ? 'התחבר באמצעות אימייל' : 'Sign in with Email')
                    : (isHe ? 'צור חשבון חדש' : 'Create Account')}
                </span>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-white/10" />
            <span className="flex-shrink mx-3 text-[11px] text-neutral-400 font-bold uppercase tracking-wider">
              {isHe ? 'או התחבר באמצעות' : 'Or continue with'}
            </span>
            <div className="flex-grow border-t border-white/10" />
          </div>

          {/* Social Provider Grid with Pill Buttons */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* 1. GOOGLE */}
            <button
              type="button"
              onClick={() => handleSocialLogin('Google', loginWithGoogle)}
              disabled={loadingProvider !== null}
              className="py-3 px-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 disabled:opacity-40 shadow-sm"
            >
              {loadingProvider === 'Google' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
              )}
              <span>Google</span>
            </button>

            {/* 2. MICROSOFT */}
            <button
              type="button"
              onClick={() => handleSocialLogin('Microsoft', loginWithMicrosoft)}
              disabled={loadingProvider !== null}
              className="py-3 px-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 disabled:opacity-40 shadow-sm"
            >
              {loadingProvider === 'Microsoft' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 21 21">
                  <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                </svg>
              )}
              <span>Microsoft</span>
            </button>

            {/* 3. FACEBOOK */}
            <button
              type="button"
              onClick={() => handleSocialLogin('Facebook', loginWithFacebook)}
              disabled={loadingProvider !== null}
              className="py-3 px-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 disabled:opacity-40 shadow-sm"
              title={isHe ? 'חיבור Facebook' : 'Facebook login'}
            >
              {loadingProvider === 'Facebook' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="#1877F2">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
              )}
              <span>Facebook</span>
            </button>

            {/* 4. YAHOO */}
            <button
              type="button"
              onClick={() => handleSocialLogin('Yahoo', loginWithYahoo)}
              disabled={loadingProvider !== null}
              className="py-3 px-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 disabled:opacity-40 shadow-sm"
              title={isHe ? 'חיבור Yahoo' : 'Yahoo login'}
            >
              {loadingProvider === 'Yahoo' ? (
                <RefreshCw className="w-4 h-4 animate-spin text-white" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="#6001D2">
                  <path d="M12.5 13.5l4.5-9.5h3L14.5 14v6h-3v-6L6 4h3l3.5 9.5z" />
                </svg>
              )}
              <span>Yahoo</span>
            </button>
          </div>
        </motion.div>

        {/* FORGOT PASSWORD SUB-MODAL */}
        <AnimatePresence>
          {showForgotModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[190] bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            >
              <div className="bg-neutral-950 border border-white/20 rounded-3xl p-6 sm:p-7 max-w-sm w-full space-y-4 text-white text-right">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-emerald-400" />
                    <span>{isHe ? 'איפוס סיסמה' : 'Reset Password'}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotModal(false);
                      setForgotSent(false);
                    }}
                    className="w-7 h-7 rounded-full bg-white/10 text-white flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {forgotSent ? (
                  <div className="space-y-3 py-2 text-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                    <p className="text-xs text-neutral-300">
                      {isHe
                        ? `קישור לאיפוס סיסמה נשלח אל ${forgotEmail}. בדוק את תיבת הדואר הנכנס או הספאם שלך.`
                        : `Password reset link sent to ${forgotEmail}. Check your inbox or spam.`}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setShowForgotModal(false);
                        setForgotSent(false);
                      }}
                      className="w-full py-2.5 rounded-xl bg-white text-black font-bold text-xs"
                    >
                      {isHe ? 'סגור' : 'Close'}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handlePasswordReset} className="space-y-3">
                    <p className="text-xs text-neutral-400">
                      {isHe ? 'הזן את כתובת האימייל שלך ונשלח לך קישור לאיפוס סיסמה:' : 'Enter your email to receive a password reset link:'}
                    </p>
                    <input
                      type="email"
                      required
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="your-email@example.com"
                      className="w-full px-4 py-2.5 rounded-xl bg-neutral-900 border border-neutral-700 text-white font-sans text-xs focus:outline-none focus:border-emerald-400"
                    />
                    <button
                      type="submit"
                      disabled={isForgotLoading || !forgotEmail.trim()}
                      className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {isForgotLoading ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-black" />
                          <span>{isHe ? 'שולח קישור...' : 'Sending...'}</span>
                        </>
                      ) : (
                        <span>{isHe ? 'שלח קישור איפוס' : 'Send Reset Link'}</span>
                      )}
                    </button>
                  </form>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </AnimatePresence>
  );
};
