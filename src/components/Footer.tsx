import React, { useState } from 'react';
import {
  FileText,
  Mail,
  Smartphone,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Heart,
  Music2,
  Send,
  X,
  Share2,
  Sparkles,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Language } from '../types';

interface FooterProps {
  lang: Language;
  onOpenPortal?: () => void;
  onOpenTerms?: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  lang,
  onOpenPortal,
  onOpenTerms,
}) => {
  const isHe = lang === 'he';
  const { isInstalled, isInstallable, isIOS, install } = usePWAInstall();

  // Internal Modals state
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showIOSInstallGuide, setShowIOSInstallGuide] = useState(false);

  // Contact modal state
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [contactMessage, setContactMessage] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [messageSentSuccess, setMessageSentSuccess] = useState(false);

  const contactEmail = 'danielbarber1246@gmail.com';

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
    if (isIOS) {
      setShowIOSInstallGuide(true);
      return;
    }
    const success = await install();
    if (!success && !isInstallable) {
      // If prompt is not directly available on this browser, show guidance
      setShowIOSInstallGuide(true);
    }
  };

  const handleOpenTerms = () => {
    if (onOpenTerms) {
      onOpenTerms();
    } else {
      setShowTermsModal(true);
    }
  };

  const handleSendEmailMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const mailtoUrl = `mailto:${contactEmail}?subject=${encodeURIComponent(
      contactSubject || 'פנייה מתוך אתר Kolot Music'
    )}&body=${encodeURIComponent(contactMessage)}`;
    window.location.href = mailtoUrl;
    setMessageSentSuccess(true);
    setTimeout(() => {
      setMessageSentSuccess(false);
      setShowContactModal(false);
      setContactMessage('');
      setContactSubject('');
    }, 2000);
  };

  return (
    <>
      <footer className="w-full mt-16 border-t border-white/10 bg-[#040711]/90 backdrop-blur-2xl text-white relative z-20 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 sm:gap-10 pb-8 border-b border-white/10">
            {/* BRANDING SECTION */}
            <div className="md:col-span-5 space-y-3.5 text-right">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <Music2 className="w-5 h-5 text-black" />
                </div>
                <div>
                  <h3 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                    <span>Kolot Music</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium">
                      קולות
                    </span>
                  </h3>
                  <p className="text-[11px] text-white/50">פלטפורמת המוזיקה החופשית והעצמאית</p>
                </div>
              </div>

              <p className="text-xs text-white/70 leading-relaxed max-w-md font-normal">
                {isHe
                  ? 'האזנה חופשית לשירים, אלבומים ואמנים יוצרים. העלאת מוזיקה וניהול ישיר ומאובטח בענן Cloudflare R2 ללא הגבלה ובאיכות סאונד גבוהה.'
                  : 'Free music streaming and creator publishing platform powered by Cloudflare R2 storage.'}
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
              </div>
            </div>

            {/* PWA INSTALL CARD (HIDDEN IF ALREADY INSTALLED) */}
            <div className="md:col-span-3 text-right">
              {isInstalled ? (
                // Hidden completely or replaced with verified badge
                <div className="h-full p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col justify-center items-center text-center space-y-2">
                  <div className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <Check className="w-4 h-4" />
                  </div>
                  <p className="text-xs font-semibold text-white/90">
                    {isHe ? 'האפליקציה מותקנת במסך הבית' : 'App Installed on Home Screen'}
                  </p>
                  <p className="text-[11px] text-white/50 max-w-[200px]">
                    {isHe
                      ? 'האתר מוגדר כעת לגישה מהירה ישירות ממסך הבית שלך.'
                      : 'Kolot Music is ready on your home screen for quick access.'}
                  </p>
                </div>
              ) : (
                // PWA Install Button & Card
                <div className="p-4 rounded-2xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-emerald-500/30 shadow-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold text-white">
                      {isHe ? 'התקנה בגישה מהירה' : 'Install App'}
                    </span>
                  </div>

                  <p className="text-[11px] text-white/70 leading-relaxed font-normal">
                    {isHe
                      ? 'הוסף את Kolot למסך הבית שלך ופתח את הנגן והשירים כמו אפליקציה עצמאית, ללא סרגלי דפדפן.'
                      : 'Add Kolot to your home screen to launch full-screen like a native app.'}
                  </p>

                  <button
                    type="button"
                    onClick={handleInstallClick}
                    className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-black font-semibold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition-all transform hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  >
                    <Smartphone className="w-4 h-4 text-black" />
                    <span>{isHe ? 'הוסף למסך הבית' : 'Add to Home Screen'}</span>
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
                <Heart className="w-3 h-3 text-rose-500 fill-rose-500" />
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* MODAL 1: CONTACT VIA EMAIL MODAL */}
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
              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer"
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
                <div className="text-left font-mono text-sm text-teal-300 truncate">
                  {contactEmail}
                </div>
              </div>

              {messageSentSuccess ? (
                <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-center space-y-2">
                  <Check className="w-7 h-7 text-emerald-400 mx-auto" />
                  <p className="text-sm font-semibold text-white">
                    {isHe ? 'הודעתך מוכנה לשליחה בתוכנת המייל שלך!' : 'Opening email client...'}
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSendEmailMessage} className="space-y-3.5">
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

                  <div className="pt-2 flex items-center justify-between gap-3">
                    <a
                      href={`mailto:${contactEmail}`}
                      className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 underline underline-offset-4"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>{isHe ? 'פתיחה ישירה בתוכנת מייל' : 'Open email client directly'}</span>
                    </a>

                    <button
                      type="submit"
                      className="px-5 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-black font-semibold text-xs flex items-center gap-2 shadow-lg shadow-teal-500/25 transition-all cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isHe ? 'שלח פנייה' : 'Send Message'}</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: TERMS OF SERVICE MODAL */}
      {showTermsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-2xl max-h-[85vh] bg-[#0a0f1d] border border-white/20 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col text-right text-white">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2.5">
                <h3 className="text-lg font-bold">{isHe ? 'תנאי שימוש ומדיניות האתר' : 'Terms of Service'}</h3>
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
              </div>
            </div>

            <div className="overflow-y-auto space-y-4 text-xs sm:text-sm text-white/80 leading-relaxed pl-2 pr-1 custom-scrollbar">
              <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-2xl border border-white/5">
                <h4 className="font-semibold text-white text-sm">1. מטרת הפלטפורמה</h4>
                <p>
                  קולות מוזיקה (Kolot Music) הינה פלטפורמה חופשית המיועדת להאזנה, שיתוף והפצת יצירות מוזיקליות של אמנים עצמאיים. השימוש באתר הינו אישי, חופשי וללא תשלום.
                </p>
              </section>

              <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-2xl border border-white/5">
                <h4 className="font-semibold text-white text-sm">2. זכויות יוצרים והעלאת תכנים</h4>
                <p>
                  כל משתמש או אמן המעלה יצירה (שיר, מילים, עטיפה או אלבום) מצהיר כי הינו בעל הזכויות הבלעדיות ביצירה או קיבל הרשאה מפורשת כחוק להעלותה ולהפיצה. חל איסור מוחלט על העלאת תכנים המפרים זכויות צד שלישי או חוקי מדינת ישראל.
                </p>
              </section>

              <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-2xl border border-white/5">
                <h4 className="font-semibold text-white text-sm">3. אחסון ופרטיות מידע</h4>
                <p>
                  הקבצים והשירים מאוחסנים באופן מאובטח בתשתית ענן Cloudflare R2 ו-Firebase. פרטי ההתחברות (Google Auth) מנוהלים בצורה מאובטחת ללא שמירת סיסמאות אישיות באתר.
                </p>
              </section>

              <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-2xl border border-white/5">
                <h4 className="font-semibold text-white text-sm">4. הסרת תכנים ויצירת קשר</h4>
                <p>
                  הנהלת האתר שומרת לעצמה את הזכות להסיר כל תוכן שאינו עומד בתנאי השימוש. במידה ונתקלתם בתוכן המפר זכויות יוצרים או תוכן פוגעני, ניתן לפנות מיידית למייל ההנהלה: <strong className="text-teal-300 font-mono">danielbarber1246@gmail.com</strong> והנושא ייבדק ויטופל בהקדם האפשרי.
                </p>
              </section>
            </div>

            <div className="pt-4 mt-4 border-t border-white/10 flex justify-end">
              <button
                type="button"
                onClick={() => setShowTermsModal(false)}
                className="px-6 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {isHe ? 'הבנתי ואישרתי' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: IOS PWA INSTALL GUIDE MODAL */}
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
                <h3 className="text-base font-bold">{isHe ? 'הוספה למסך הבית' : 'Add to Home Screen'}</h3>
                <Smartphone className="w-5 h-5 text-emerald-400" />
              </div>
            </div>

            <p className="text-xs text-white/80 leading-relaxed font-normal">
              {isHe
                ? 'כדי להוסיף את Kolot Music למסך הבית שלך כאפליקציה:'
                : 'To install Kolot Music as an app on your device:'}
            </p>

            <ol className="space-y-3 text-xs text-white/80 pr-4 list-decimal">
              <li className="leading-relaxed">
                <span>{isHe ? 'לחץ על כפתור השיתוף ' : 'Tap the Share icon '}</span>
                <Share2 className="w-3.5 h-3.5 inline mx-1 text-teal-400" />
                <span>{isHe ? 'בתחתית סרגל הדפדפן (Safari/Chrome).' : 'in your browser menu.'}</span>
              </li>
              <li className="leading-relaxed">
                <span>{isHe ? 'גלול מטה ובחר ' : 'Scroll down and select '}</span>
                <strong className="text-white">"{isHe ? 'הוסף למסך הבית' : 'Add to Home Screen'}"</strong>.
              </li>
              <li className="leading-relaxed">
                <span>{isHe ? 'אשר בלחיצה על "הוסף" בפינה העליונה.' : 'Tap "Add" in the top corner.'}</span>
              </li>
            </ol>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.setItem('kolot_pwa_installed', 'true');
                  } catch {}
                  setShowIOSInstallGuide(false);
                }}
                className="w-full py-2.5 rounded-xl bg-emerald-500 text-black font-semibold text-xs hover:bg-emerald-400 transition-colors cursor-pointer"
              >
                {isHe ? 'הוספתי בהצלחה!' : 'Done!'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
