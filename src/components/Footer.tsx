import React, { useState, useEffect } from 'react';
import {
  FileText,
  Mail,
  Smartphone,
  Copy,
  Check,
  Heart,
  Send,
  X,
  Loader2,
  AlertCircle,
  Share2,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Language } from '../types';
import { Logo } from './Logo';
import { AccessibilityIcon } from './AccessibilityPage';
import { AuthUser, getCurrentAuthUser, onAuthUserChanged, getAuthHeaders } from '../services/authService';
import { trackEvent } from '../services/analyticsService';

type ContactCategory = 'complaint' | 'request' | 'support' | 'copyright' | 'general';

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
  const [contactCategory, setContactCategory] = useState<ContactCategory>('complaint');
  const [contactSenderEmail, setContactSenderEmail] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [isSendingContact, setIsSendingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState<{
    mode: 'email' | 'inbox';
    text: string;
  } | null>(null);

  const contactEmail = 'kolot-music@googlegroups.com';

  const handleCopyEmail = () => {
    try {
      navigator.clipboard.writeText(contactEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2500);
    } catch {}
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    try {
      const categoryLabelsHe: Record<ContactCategory, string> = {
        complaint: 'תלונה / דיווח',
        request: 'בקשה / הצעה',
        support: 'תקלה טכנית',
        copyright: 'זכויות יוצרים',
        general: 'פנייה כללית',
      };
      const categoryLabel = categoryLabelsHe[contactCategory];

      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          category: contactCategory,
          senderEmail,
          subject,
          message,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || (isHe ? 'שליחת הפנייה נכשלה, נסה שוב' : 'Failed to send message'));
      }

      let emailDispatched = Boolean(data.emailDispatched);
      let activationPending = Boolean(data.activationPending);

      // Browser-side FormSubmit fallback when backend environment has no SMTP/API key or datacenter IP was blocked
      if (!emailDispatched) {
        try {
          const directController = new AbortController();
          const directTimer = setTimeout(() => directController.abort(), 8000);
          try {
            const fsRes = await fetch(`https://formsubmit.co/ajax/${contactEmail}`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              signal: directController.signal,
              body: JSON.stringify({
                name: authUser?.displayName || senderEmail.split('@')[0] || 'Kolot Music User',
                email: senderEmail,
                _replyto: senderEmail,
                _subject: `[Kolot Music - ${categoryLabel}] ${subject}`,
                category: categoryLabel,
                message: `סוג פנייה: ${categoryLabel}\nשולח: ${senderEmail}\n\n${message}`,
                _captcha: 'false',
                _template: 'table',
              }),
            });
            const fsJson = await fsRes.json().catch(() => null);
            const fsMsg = String(fsJson?.message || '');
            if (fsRes.ok && (fsJson?.success === true || fsJson?.success === 'true')) {
              emailDispatched = true;
              activationPending = false;
            } else if (/activat/i.test(fsMsg)) {
              activationPending = true;
            }
          } finally {
            clearTimeout(directTimer);
          }
        } catch {
          // Non-fatal fallback; submission is already persisted in R2 admin inbox
        }
      }

      trackEvent('contact_submit', {
        category: contactCategory,
        email_dispatched: emailDispatched,
      });

      setSentNotice({
        mode: emailDispatched ? 'email' : 'inbox',
        text: emailDispatched
          ? (isHe
              ? `פנייתך (${categoryLabel}) נשלחה בהצלחה ישירות לקבוצת הפניות בכתובת ${contactEmail} ונשמרה במערכת לטיפול.`
              : `Your message has been sent directly to ${contactEmail} and saved in the system.`)
          : activationPending
            ? (isHe
                ? `הפנייה נשמרה במערכת ההנהלה. נשלח מייל הפעלה חד-פעמי אל ${contactEmail} — יש לפתוח את קבוצת Google Groups (תחת "שיחות" / "בהמתנה") או את ספאם המייל של בעל הקבוצה ולאשר פעם אחת את Activation כדי שהמיילים יגיעו אוטומטית.`
                : `Saved in management inbox. Please click the one-time FormSubmit activation link sent to ${contactEmail} (check Google Groups pending messages or owner spam) to enable automatic forwarding.`)
            : (isHe
                ? `הפנייה נשמרה בתיבת ההנהלה של האתר (זמינה להנהלה בפורטל האמן), ותועבר גם לקבוצת ${contactEmail}.`
                : `Saved in management inbox and queued for ${contactEmail}.`),
      });

      setContactSenderEmail('');
      setContactSubject('');
      setContactMessage('');
      setContactError(null);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setContactError(
          isHe
            ? `השרת התעכב בתגובה. ניתן לנסות שוב או לשלוח ישירות לקבוצת המייל ${contactEmail}`
            : `Request timed out. Please try again or email ${contactEmail} directly.`
        );
      } else {
        setContactError(err?.message || (isHe ? 'שגיאה בשליחת הפנייה' : 'Failed to send message'));
      }
    } finally {
      clearTimeout(timeoutId);
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
                  ? 'האזנה חופשית לשירים, אלבומים ואמנים יוצרים. העלאת מוזיקה וניהול ישיר בענן ללא הגבלה ובאיכות סאונד גבוהה.'
                  : 'Free music streaming and creator publishing platform.'}
              </p>
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
                    <FileText className="w-4 h-4 text-white/80 group-hover:scale-110 transition-transform" />
                    <span>{isHe ? 'תנאי שימוש ומדיניות' : 'Terms of Service'}</span>
                  </div>
                  <span className="text-[10px] text-white/40 group-hover:text-white/70">
                    {isHe ? 'קרא' : 'Read'}
                  </span>
                </button>

                {/* 2. CONTACT EMAIL BUTTON */}
                <button
                  type="button"
                  onClick={() => {
                    setSentNotice(null);
                    setContactError(null);
                    setShowContactModal(true);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 transition-all text-xs font-medium text-white/90 group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-4 h-4 text-white/80 group-hover:scale-110 transition-transform" />
                    <span>{isHe ? 'יצירת קשר ופניות' : 'Contact & Support'}</span>
                  </div>
                  <span className="text-[10px] text-white/40 group-hover:text-white/70 truncate max-w-[160px] sm:max-w-none" dir="ltr">
                    {contactEmail}
                  </span>
                </button>

                {/* 3. ACCESSIBILITY STATEMENT & TOOLS BUTTON */}
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
          <div className="pt-6 pb-8 md:pb-0 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/40 font-normal">
            <div className="flex items-center gap-2">
              <span>© {new Date().getFullYear()} Kolot Music • קולות מוזיקה. כל הזכויות שמורות.</span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-4 gap-y-2 text-white/50">
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
                onClick={() => {
                  setSentNotice(null);
                  setContactError(null);
                  setIsSendingContact(false);
                  setShowContactModal(true);
                }}
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

      {/* MODAL 1: CONTACT & COMPLAINTS MODAL (MONOCHROME) */}
      {showContactModal && (
        <div
          className="fixed inset-0 z-[180] flex items-start sm:items-center justify-center p-3 sm:p-4 pt-4 sm:pt-4 overflow-y-auto custom-scrollbar bg-black/90 backdrop-blur-md"
          dir={isHe ? 'rtl' : 'ltr'}
        >
          <div className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto custom-scrollbar bg-[#09090b] border border-white/20 rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5 text-start text-white my-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 text-white flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white">
                    {isHe ? 'יצירת קשר ותלונות להנהלה' : 'Contact & Support'}
                  </h3>
                  <p className="text-[11px] text-white/55">
                    {isHe ? 'תלונות, בקשות שירים, תקלות וזכויות יוצרים' : 'Complaints, requests, technical issues & copyright'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors cursor-pointer"
                aria-label={isHe ? 'סגור' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* 1. GOOGLE GROUPS EMAIL ADDRESS */}
              <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-[10px] text-white/55 block">
                    {isHe ? 'כתובת המייל לפניות (Google Groups):' : 'Contact Email (Google Groups):'}
                  </span>
                  <div className="font-mono text-xs sm:text-sm text-white truncate" dir="ltr">
                    {contactEmail}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopyEmail}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium text-white flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 border border-white/15"
                >
                  {copiedEmail ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-white" />
                      <span className="text-white">{isHe ? 'הועתק!' : 'Copied!'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-white" />
                      <span>{isHe ? 'העתק מייל' : 'Copy'}</span>
                    </>
                  )}
                </button>
              </div>

              {sentNotice ? (
                <div className="p-6 rounded-2xl bg-white/[0.07] border border-white/25 text-center space-y-3.5">
                  <div className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center mx-auto shadow-lg">
                    <Check className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-white">
                    {sentNotice.mode === 'email'
                      ? (isHe ? 'הפנייה נשלחה לקבוצת המייל' : 'Email Sent')
                      : (isHe ? 'הפנייה נשמרה במערכת' : 'Saved in System')}
                  </p>
                  <p className="text-xs text-white/80 leading-relaxed max-w-sm mx-auto">
                    {sentNotice.text}
                  </p>
                  <div className="pt-2 flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => {
                        setSentNotice(null);
                        setShowContactModal(false);
                      }}
                      className="w-full sm:w-auto px-8 py-2.5 rounded-xl font-bold text-xs transition-colors cursor-pointer bg-white hover:bg-neutral-200 text-black"
                    >
                      {isHe ? 'סגור' : 'Close'}
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSendEmailMessage} className="space-y-3.5">
                  {/* INQUIRY TYPE SELECTOR */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-white/75 block font-medium">
                      {isHe ? 'סוג הפנייה:' : 'Inquiry Type:'}
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'complaint', labelHe: 'תלונה / דיווח', labelEn: 'Complaint' },
                          { id: 'request', labelHe: 'בקשה / הצעה', labelEn: 'Request' },
                          { id: 'support', labelHe: 'תקלה טכנית', labelEn: 'Bug / Support' },
                          { id: 'copyright', labelHe: 'זכויות יוצרים', labelEn: 'Copyright' },
                          { id: 'general', labelHe: 'פנייה כללית', labelEn: 'General' },
                        ] as { id: ContactCategory; labelHe: string; labelEn: string }[]
                      ).map((cat) => {
                        const active = contactCategory === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setContactCategory(cat.id)}
                            className={`px-2.5 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                              active
                                ? 'bg-white text-black border-white shadow-sm'
                                : 'bg-white/[0.04] text-white/80 hover:bg-white/[0.1] border-white/10'
                            }`}
                          >
                            {isHe ? cat.labelHe : cat.labelEn}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. SENDER EMAIL ADDRESS */}
                  <div className="space-y-1">
                    <label className="text-xs text-white/75 block font-medium">
                      {authUser?.email
                        ? isHe
                          ? 'המייל שלך לחזרה (מהחשבון המחובר):'
                          : 'Your Reply Email (from signed-in account):'
                        : isHe
                          ? 'כתובת המייל שלך לחזרה *:'
                          : 'Your Real Email Address *:'}
                    </label>
                    {authUser?.email ? (
                      <div
                        dir="ltr"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/25 text-sm text-white font-mono text-left flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{authUser.email}</span>
                        <span className="text-[10px] font-sans text-white/75 shrink-0">
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
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/15 focus:border-white/60 focus:outline-none text-sm text-white placeholder-white/35 text-left font-mono"
                      />
                    )}
                  </div>

                  {/* 3. SUBJECT */}
                  <div className="space-y-1">
                    <label className="text-xs text-white/75 block font-medium">
                      {isHe ? 'נושא הפנייה *:' : 'Subject *:'}
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={
                        isHe
                          ? 'לדוגמה: תלונה על שיר / בקשה להוספת פיצ׳ר / תקלה'
                          : 'Subject...'
                      }
                      value={contactSubject}
                      onChange={(e) => setContactSubject(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/15 focus:border-white/60 focus:outline-none text-sm text-white placeholder-white/35"
                    />
                  </div>

                  {/* 4. MESSAGE CONTENT */}
                  <div className="space-y-1">
                    <label className="text-xs text-white/75 block font-medium">
                      {isHe ? 'פירוט התלונה או הבקשה *:' : 'Message *:'}
                    </label>
                    <textarea
                      required
                      rows={4}
                      placeholder={isHe ? 'כתוב כאן את פרטי הפנייה שלך בצורה ברורה...' : 'Your message...'}
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/15 focus:border-white/60 focus:outline-none text-sm text-white placeholder-white/35 resize-none"
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
                      className="w-full py-3 rounded-xl bg-white hover:bg-neutral-200 disabled:opacity-60 text-black font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer"
                    >
                      {isSendingContact ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      <span>
                        {isSendingContact
                          ? isHe
                            ? 'שולח פנייה להנהלה...'
                            : 'Sending...'
                          : isHe
                            ? 'שלח פנייה להנהלה'
                            : 'Send to Management'}
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
        <div className="fixed inset-0 z-[180] flex items-start sm:items-center justify-center p-4 pt-6 overflow-y-auto bg-black/90 backdrop-blur-md" dir={isHe ? 'rtl' : 'ltr'}>
          <div className="relative w-full max-w-md bg-[#09090b] border border-white/20 rounded-3xl p-6 shadow-2xl space-y-4 text-start text-white my-auto">
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
                <Smartphone className="w-5 h-5 text-white" />
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
                  <Share2 className="w-3.5 h-3.5 inline mx-1 text-white" />
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
                className="w-full py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
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
              הקבצים, הפרופילים והשירים מאוחסנים בתשתית הענן של האתר בלבד. ניהול ההתחברות מתבצע בצד השרת ללא שמירת סיסמאות או מידע אישי בדפדפן.
            </p>
          </section>

          <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-xl border border-white/10">
            <h4 className="font-semibold text-white text-sm">4. הסרת תכנים ויצירת קשר</h4>
            <p>
              הנהלת האתר שומרת לעצמה את הזכות להסיר כל תוכן שאינו עומד בתנאי השימוש. במידה ונתקלתם בתוכן המפר זכויות יוצרים או תוכן פוגעני, ניתן לפנות מיידית לכתובת הפניות הרשמית (Google Groups): <strong className="text-white font-mono" dir="ltr">kolot-music@googlegroups.com</strong> והנושא ייבדק ויטופל בהקדם האפשרי.
            </p>
          </section>

          <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-xl border border-white/10">
            <h4 className="font-semibold text-white text-sm">5. כתוביות, תמלול ובינה מלאכותית (AI)</h4>
            <p>
              הכתוביות המסונכרנות, תמלולי השמע והתרגומים באתר מופקים בחלקם באופן אוטומטי באמצעות מנגנוני בינה מלאכותית (AI) וזיהוי דיבור בדפדפן או בשרת, ועלולים לכלול שגיאות כתיב, אי-דיוקים בתוכן, השמטות, טעויות תרגום או סטיות בתזמון. כל תכני הכתוביות מסופקים כמות שהם ("AS IS") ללא כל מצג, התחייבות או אחריות לדיוקם או שלמותם.
            </p>
          </section>

          <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-xl border border-white/10">
            <h4 className="font-semibold text-white text-sm">6. פרטי יצירות, אמנים ואי-דיוקים במידע</h4>
            <p>
              פרטי השירים, האלבומים, הקרדיטים, הסיווגים לז׳אנרים, תיאורי האמנים ונתוני המטא-דאטה המופיעים באתר מוזנים על ידי משתמשים או נמשכים ממאגרי מידע חיצוניים וציבוריים, ועל כן עשויים להכיל אי-דיוקים, פערים או טעויות סופר. הנהלת האתר אינה נושאת באחריות משפטית לנכונות פרטים אלה.
            </p>
          </section>

          <section className="space-y-1.5 bg-white/[0.03] p-4 rounded-xl border border-white/10">
            <h4 className="font-semibold text-white text-sm">7. מספרי צפיות, השמעות ונתונים סטטיסטיים</h4>
            <p>
              מספרי הצפיות, ההשמעות, הסימונים כמועדפים והמדדים הסטטיסטיים המוצגים בפלטפורמה הינם אומדן טכני ומשוער בלבד; הם עלולים להיות מושפעים ממנגנוני מטמון (Cache), השהיית סנכרון, סינונים טכניים או מגבלות רשת, אינם משקפים בהכרח נתון בזמן אמת ואינם מהווים נתון רשמי, מחייב או ראיה לכל עניין מסחרי או משפטי.
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

