import React, { useState, useEffect } from 'react';
import {
  FileText,
  Mail,
  Smartphone,
  Copy,
  Check,
  ShieldCheck,
  Heart,
  Send,
  X,
  Sparkles,
  Loader2,
  AlertCircle,
  Share2,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Language } from '../types';
import { Logo } from './Logo';
import { AccessibilityIcon } from './AccessibilityPage';
import { AuthUser, getCurrentAuthUser, onAuthUserChanged, getAuthHeaders } from '../services/authService';

interface FooterProps {
  lang: Language;
  onOpenPortal?: () => void;
  onOpenTerms?: () => void;
  onOpenAccessibility?: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  lang,
  onOpenPortal,
  onOpenTerms,
  onOpenAccessibility,
}) => {
  const isHe = lang === 'he';
  const { isInstalled, isInstallable, isIOS, isAndroid, install } = usePWAInstall();

  // Internal Modals state
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showIOSInstallGuide, setShowIOSInstallGuide] = useState(false);

  // Auth state for sender email pre-fill when signed in
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCurrentAuthUser());
  useEffect(() => onAuthUserChanged(setAuthUser), []);

  // Contact modal state
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [contactSenderEmail, setContactSenderEmail] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [isSendingContact, setIsSendingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [messageSentSuccess, setMessageSentSuccess] = useState(false);

  const contactEmail = 'kolot.music1@gmail.com';

  const handleCopyEmail = () => {
    try {
      navigator.clipboard.writeText(contactEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleInstallClick = async () => {
    if (isInstallable) {
      const success = await install();
      if (success) return;
    }
    setShowIOSInstallGuide(true);
  };

  const handleOpenTerms = () => {
    if (onOpenTerms) {
      onOpenTerms();
    } else {
      setShowTermsModal(true);
    }
  };

  const handleSendEmailMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactError(null);

    const accountEmail = (authUser?.email || '').trim();
    const senderEmail = (accountEmail || contactSenderEmail).trim();
    const subject = contactSubject.trim();
    const message = contactMessage.trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(senderEmail)) {
      setContactError(
        isHe ? 'יש להזין כתובת מייל אמיתית ותקינה' : 'Please enter a valid email address'
      );
      return;
    }
    if (!subject || !message) {
      setContactError(
        isHe ? 'נא למלא נושא ותוכן הודעה' : 'Please fill in both subject and message'
      );
      return;
    }

    setIsSendingContact(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        body: JSON.stringify({
          senderEmail,
          subject,
          message,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || (isHe ? 'שליחת הפנייה נכשלה, נסה שוב' : 'Failed to send message'));
      }

      setMessageSentSuccess(true);
      setTimeout(() => {
        setMessageSentSuccess(false);
        setShowContactModal(false);
        setContactSenderEmail('');
        setContactSubject('');
        setContactMessage('');
        setContactError(null);
      }, 2200);
    } catch (err: any) {
      setContactError(err?.message || (isHe ? 'שגיאה בשליחת הפנייה' : 'Failed to send message'));
    } finally {
      setIsSendingContact(false);
    }
  };

  return (
    <>
      <footer className="w-full mt-16 border-t border-white/10 bg-[#040711]/90 backdrop-blur-2xl text-white relative z-20 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 sm:gap-10 pb-8 border-b border-white/10">
            {/* BRANDING SECTION */}
            <div className="md:col-span-5 space-y-3.5 text-right">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-black border border-white/15 flex items-center justify-center shadow-lg shrink-0 p-1.5">
                  <Logo heartOnly={true} className="w-full h-full" />
                </div>
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                    <span>Kolot Music</span>
                  </h3>
                  <p className="text-[11px] text-white/50">פלטפורמת המוזיקה החופשית והעצמאית</p>
                </div>
              </div>

              <p className="text-xs text-white/70 leading-relaxed max-w-md font-normal">
                {isHe
                  ? 'האזנה חופשית לשירים, אלבומים ואמנים יוצרים. העלאת מוזיקה וניהול ישיר ומאובטח בענן ללא הגבלה ובאיכות סאונד גבוהה.'
                  : 'Free music streaming and creator publishing platform powered by secure cloud storage.'}
              </p>

              <div className="flex items-center gap-2 text-xs text-white/50 pt-1">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>{isHe ? 'אחסון ענן מאובטח • כניסה מהירה עם Google' : 'Secure Cloud Storage • Google Auth'}</span>
              </div>
            </div>

            {/* ACTION BUTTONS & LINKS */}
            <div className="md:col-span-4 space-y-3 text-right">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-white/60">
                {isHe ? 'פעולות וקישורים' : 'Quick Actions'}
              </h4>

              <div className="flex flex-col gap-2">
                {/* 1. TERMS OF SERVICE BUTTON */}
                <button
                  type="button"
                  onClick={handleOpenTerms}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 transition-all text-xs font-medium text-white/90 group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <FileText className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                    <span>{isHe ? 'תנאי שימוש ומדיניות' : 'Terms of Service'}</span>
                  </div>
                  <span className="text-[10px] text-white/40 group-hover:text-white/70">
                    {isHe ? 'קרא' : 'Read'}
                  </span>
                </button>

                {/* 2. CONTACT EMAIL BUTTON */}
                <button
                  type="button"
                  onClick={() => setShowContactModal(true)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 transition-all text-xs font-medium text-white/90 group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-teal-400 group-hover:scale-110 transition-transform" />
                    <span>{isHe ? 'יצירת קשר במייל' : 'Contact Us via Email'}</span>
                  </div>
                  <span className="text-[10px] text-white/40 group-hover:text-white/70">
                    {contactEmail}
                  </span>
                </button>

                {/* 3. ARTIST PORTAL BUTTON IF AVAILABLE */}
                {onOpenPortal && (
                  <button
                    type="button"
                    onClick={onOpenPortal}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 transition-all text-xs font-medium text-white/90 group cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <Sparkles className="w-4 h-4 text-purple-400 group-hover:scale-110 transition-transform" />
                      <span>{isHe ? 'פורטל יוצרים והעלאת שירים' : 'Creator & Artist Studio'}</span>
                    </div>
                    <span className="text-[10px] text-white/40 group-hover:text-white/70">
                      {isHe ? 'פתח' : 'Open'}
                    </span>
                  </button>
                )}

                {/* 4. ACCESSIBILITY STATEMENT & TOOLS BUTTON */}
                {onOpenAccessibility && (
                  <button
                    type="button"
                    onClick={onOpenAccessibility}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 transition-all text-xs font-medium text-white/90 group cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <AccessibilityIcon className="w-4 h-4 text-white group-hover:scale-110 transition-transform" />
                      <span>{isHe ? 'נגישות והצהרת נגישות' : 'Accessibility & Statement'}</span>
                    </div>
                    <span className="text-[10px] text-white/40 group-hover:text-white/70">
                      {isHe ? 'פתח' : 'Open'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* PWA INSTALL CARD (ALWAYS SHOWN WHEN NOT INSTALLED ON THIS DEVICE) */}
            <div className="md:col-span-3 text-right">
              {isInstalled ? (
                <div className="h-full p-4 rounded-2xl bg-white/[0.02] border border-white/10 flex flex-col justify-center items-center text-center space-y-2">
                  <div className="w-9 h-9 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white">
                    <Check className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-semibold text-white/90">
                    {isHe ? 'האפליקציה מותקנת במכשיר' : 'App Installed on Device'}
                  </p>
                  <p className="text-[11px] text-white/50 max-w-[210px]">
                    {isHe
                      ? 'ניתן לפתוח את Kolot Music ישירות דרך אייקון האפליקציה או כפתור "פתח ביישום" בשורת הכתובת.'
                      : 'Launch Kolot Music directly from your device or the Open in App button.'}
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/15 shadow-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-white/10 text-white flex items-center justify-center">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-white">
                      {isHe ? 'התקנת אפליקציה' : 'Install App'}
                    </span>
                  </div>

                  <p className="text-[11px] text-white/70 leading-relaxed font-normal">
                    {isHe
                      ? 'התקן את אפליקציית Kolot במכשיר שלך לגישה מהירה מהמסך הראשי, ללא סרגלי דפדפן.'
                      : 'Install Kolot on your device for instant app access without browser bars.'}
                  </p>

                  <button
                    type="button"
                    onClick={handleInstallClick}
                    className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-neutral-200 text-black font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] cursor-pointer"
                  >
                    <Smartphone className="w-4 h-4 text-black" />
                    <span>{isHe ? 'התקנת אפליקציה' : 'Install App'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* BOTTOM COPYRIGHT ROW */}
          <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/40 font-normal">
            <div className="flex items-center gap-2">
              <span>© {new Date().getFullYear()} Kolot Music • קולות מוזיקה. כל הזכויות שמורות.</span>
            </div>

            <div className="flex items-center gap-4 text-white/50">
              <button
                type="button"
                onClick={handleOpenTerms}
                className="hover:text-white transition-colors cursor-pointer"
              >
                {isHe ? 'תנאי שימוש' : 'Terms'}
              </button>
              {onOpenAccessibility && (
                <>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={onOpenAccessibility}
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    {isHe ? 'הצהרת נגישות' : 'Accessibility'}
                  </button>
                </>
              )}
              <span>•</span>
              <button
                type="button"
                onClick={() => setShowContactModal(true)}
                className="hover:text-white transition-colors cursor-pointer"
              >
                {isHe ? 'יצירת קשר' : 'Contact'}
              </button>
              <span>•</span>
              <span className="flex items-center gap-1">
                <span>{isHe ? 'נוצר באהבה למוזיקה' : 'Made for music'}</span>
                <Heart className="w-3 h-3 text-white fill-white" />
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* MODAL 1: CONTACT VIA DIRECT BACKEND EMAIL MODAL */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-[#0a0f1d] border border-white/20 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 text-right text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-bold">{isHe ? 'יצירת קשר עם ההנהלה' : 'Contact Us'}</h3>
                <div className="w-8 h-8 rounded-xl bg-teal-500/20 text-teal-400 flex items-center justify-center">
                  <Mail className="w-4 h-4" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {/* 1. SITE EMAIL ADDRESS */}
              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                >
                  {copiedEmail ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">{isHe ? 'הועתק!' : 'Copied!'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{isHe ? 'העתק מייל' : 'Copy'}</span>
                    </>
                  )}
                </button>
                <div className="min-w-0 flex-1 text-left">
                  <span className="text-[10px] text-white/50 block text-right">
                    {isHe ? 'כתובת המייל של האתר:' : 'Site Email:'}
                  </span>
                  <div className="font-mono text-sm text-teal-300 truncate" dir="ltr">
                    {contactEmail}
                  </div>
                </div>
              </div>

              {messageSentSuccess ? (
                <div className="p-5 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-center space-y-2">
                  <Check className="w-7 h-7 text-emerald-400 mx-auto" />
                  <p className="text-sm font-semibold text-white">
                    {isHe
                      ? `פנייתך נשלחה ישירות אל ${contactEmail}!`
                      : `Your message has been sent directly to ${contactEmail}!`}
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSendEmailMessage} className="space-y-3.5">
                  {/* 2. SENDER EMAIL ADDRESS (ACCOUNT EMAIL IF SIGNED IN, OR REQUIRED REAL EMAIL INPUT) */}
                  <div className="space-y-1">
                    <label className="text-xs text-white/70 block">
                      {authUser?.email
                        ? isHe
                          ? 'המייל שלך (מהחשבון המחובר):'
                          : 'Your Email (from signed-in account):'
                        : isHe
                          ? 'כתובת המייל האמיתית שלך *:'
                          : 'Your Real Email Address *:'}
                    </label>
                    {authUser?.email ? (
                      <div
                        dir="ltr"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-emerald-500/35 text-sm text-white/95 font-mono text-left flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{authUser.email}</span>
                        <span className="text-[10px] font-sans text-emerald-400 shrink-0">
                          {isHe ? 'חשבון מחובר' : 'Verified'}
                        </span>
                      </div>
                    ) : (
                      <input
                        type="email"
                        required
                        dir="ltr"
                        placeholder="name@example.com"
                        value={contactSenderEmail}
                        onChange={(e) => setContactSenderEmail(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 focus:border-teal-400 focus:outline-none text-sm text-white placeholder-white/30 text-left font-mono"
                      />
                    )}
                  </div>

                  {/* 3. SUBJECT */}
                  <div className="space-y-1">
                    <label className="text-xs text-white/70 block">
                      {isHe ? 'נושא הפנייה:' : 'Subject:'}
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={isHe ? 'לדוגמה: שאלה לגבי העלאת שיר או משוב' : 'Subject...'}
                      value={contactSubject}
                      onChange={(e) => setContactSubject(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 focus:border-teal-400 focus:outline-none text-sm text-white placeholder-white/30 text-right"
                    />
                  </div>

                  {/* 4. MESSAGE CONTENT */}
                  <div className="space-y-1">
                    <label className="text-xs text-white/70 block">
                      {isHe ? 'תוכן ההודעה:' : 'Message:'}
                    </label>
                    <textarea
                      required
                      rows={4}
                      placeholder={isHe ? 'כתוב את תוכן הודעתך כאן...' : 'Your message...'}
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 focus:border-teal-400 focus:outline-none text-sm text-white placeholder-white/30 text-right resize-none"
                    />
                  </div>

                  {contactError && (
                    <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-rose-200 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{contactError}</span>
                    </div>
                  )}

                  <div className="pt-2 flex items-center justify-end gap-3">
                    <button
                      type="submit"
                      disabled={isSendingContact}
                      className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-black font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-teal-500/25 transition-all cursor-pointer"
                    >
                      {isSendingContact ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isSendingContact
                          ? isHe
                            ? 'שולח פנייה...'
                            : 'Sending...'
                          : isHe
                            ? 'שלח'
                            : 'Send'}
                      </span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: TERMS OF SERVICE MODAL */}
      <TermsReaderModal isOpen={showTermsModal} onClose={() => setShowTermsModal(false)} lang={lang} />

      {/* MODAL 3: DEVICE-AWARE PWA INSTALL GUIDE MODAL */}
      {showIOSInstallGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-md bg-[#0a0f1d] border border-white/20 rounded-3xl p-6 shadow-2xl space-y-4 text-right text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <button
                type="button"
                onClick={() => setShowIOSInstallGuide(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold">{isHe ? 'התקנת אפליקציה' : 'Install App'}</h3>
                <Smartphone className="w-5 h-5 text-emerald-400" />
              </div>
            </div>

            <p className="text-xs text-white/80 leading-relaxed font-normal">
              {isHe
                ? 'כדי להתקין את Kolot Music כאפליקציה עצמאית במכשיר זה:'
                : 'To install Kolot Music as a standalone app on this device:'}
            </p>

            {isIOS ? (
              <ol className="space-y-3 text-xs text-white/80 pr-4 list-decimal">
                <li className="leading-relaxed">
                  <span>{isHe ? 'לחץ על כפתור השיתוף ' : 'Tap the Share icon '}</span>
                  <Share2 className="w-3.5 h-3.5 inline mx-1 text-teal-400" />
                  <span>{isHe ? 'בתחתית סרגל הדפדפן (Safari).' : 'in the Safari toolbar.'}</span>
                </li>
                <li className="leading-relaxed">
                  <span>{isHe ? 'גלול מטה ובחר ' : 'Scroll down and select '}</span>
                  <strong className="text-white">"{isHe ? 'הוסף למסך הבית' : 'Add to Home Screen'}"</strong>.
                </li>
                <li className="leading-relaxed">
                  <span>{isHe ? 'אשר בלחיצה על "הוסף" בפינה העליונה.' : 'Tap "Add" in the top corner.'}</span>
                </li>
              </ol>
            ) : isAndroid ? (
              <ol className="space-y-3 text-xs text-white/80 pr-4 list-decimal">
                <li className="leading-relaxed">
                  <span>{isHe ? 'לחץ על תפריט 3 הנקודות (⋮) בפינת הדפדפן (Chrome / Samsung).' : 'Tap the 3-dot menu (⋮) in your browser corner.'}</span>
                </li>
                <li className="leading-relaxed">
                  <span>{isHe ? 'בחר ' : 'Select '}</span>
                  <strong className="text-white">"{isHe ? 'התקן אפליקציה' : 'Install App'}"</strong>
                  <span>{isHe ? ' או ' : ' or '}</span>
                  <strong className="text-white">"{isHe ? 'הוסף למסך הבית' : 'Add to Home Screen'}"</strong>.
                </li>
                <li className="leading-relaxed">
                  <span>{isHe ? 'אשר את ההתקנה ליצירת אייקון אפליקציה במסך הבית.' : 'Confirm installation to add the app icon.'}</span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-xs text-white/80 pr-4 list-decimal">
                <li className="leading-relaxed">
                  <span>{isHe ? 'לחץ על אייקון ההתקנה בצד שורת הכתובת בדפדפן (Chrome / Edge), או פתח את תפריט הדפדפן.' : 'Click the Install icon in the browser address bar or open the browser menu.'}</span>
                </li>
                <li className="leading-relaxed">
                  <span>{isHe ? 'בחר ' : 'Select '}</span>
                  <strong className="text-white">"{isHe ? 'התקן את Kolot Music' : 'Install Kolot Music'}"</strong>
                  <span>{isHe ? ' (או "הוסף למסך הבית").' : '.'}</span>
                </li>
              </ol>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowIOSInstallGuide(false)}
                className="w-full py-2.5 rounded-xl bg-emerald-500 text-black font-semibold text-xs hover:bg-emerald-400 transition-colors cursor-pointer"
              >
                {isHe ? 'הבנתי' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const TermsReaderModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
}> = ({ isOpen, onClose, lang }) => {
  if (!isOpen) return null;
  const isHe = lang === 'he';

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" dir={isHe ? 'rtl' : 'ltr'}>
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-[#0a0a0c] border border-white/15 rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col text-start text-white">
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center border border-white/15">
              <FileText className="w-4 h-4" />
            </div>
            <h3 className="text-lg font-bold">{isHe ? 'תנאי שימוש ומדיניות האתר' : 'Terms of Service'}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
            aria-label={isHe ? 'סגור' : 'Close'}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto space-y-4 text-xs sm:text-sm text-white/80 leading-relaxed pl-2 pr-1 custom-scrollbar">
          <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-xl border border-white/10">
            <h4 className="font-semibold text-white text-sm">1. מטרת הפלטפורמה</h4>
            <p>
              קולות מוזיקה (Kolot Music) הינה פלטפורמה חופשית המיועדת להאזנה, שיתוף והפצת יצירות מוזיקליות של אמנים עצמאיים. השימוש באתר הינו אישי, חופשי וללא תשלום.
            </p>
          </section>

          <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-xl border border-white/10">
            <h4 className="font-semibold text-white text-sm">2. זכויות יוצרים והעלאת תכנים</h4>
            <p>
              כל משתמש או אמן המעלה יצירה (שיר, מילים, עטיפה או אלבום) מצהיר כי הינו בעל הזכויות הבלעדיות ביצירה או קיבל הרשאה מפורשת כחוק להעלותה ולהפיצה. חל איסור מוחלט על העלאת תכנים המפרים זכויות צד שלישי או חוקי מדינת ישראל.
            </p>
          </section>

          <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-xl border border-white/10">
            <h4 className="font-semibold text-white text-sm">3. אחסון ופרטיות מידע</h4>
            <p>
              הקבצים, הפרופילים והשירים מאוחסנים באופן מאובטח בתשתית הענן של האתר בלבד. פרטי ההתחברות (Google OAuth) מנוהלים בצד השרת ללא שמירת סיסמאות או מידע אישי בדפדפן.
            </p>
          </section>

          <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-xl border border-white/10">
            <h4 className="font-semibold text-white text-sm">4. הסרת תכנים ויצירת קשר</h4>
            <p>
              הנהלת האתר שומרת לעצמה את הזכות להסיר כל תוכן שאינו עומד בתנאי השימוש. במידה ונתקלתם בתוכן המפר זכויות יוצרים או תוכן פוגעני, ניתן לפנות מיידית למייל ההנהלה: <strong className="text-white font-mono">kolot.music1@gmail.com</strong> והנושא ייבדק ויטופל בהקדם האפשרי.
            </p>
          </section>
        </div>

        <div className="pt-4 mt-4 border-t border-white/10 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-full bg-white hover:bg-neutral-200 text-black text-xs font-normal transition-colors cursor-pointer"
          >
            {isHe ? 'סגור' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

