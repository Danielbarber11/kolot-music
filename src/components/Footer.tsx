import React, { useState, useEffect } from 'react';
import {
  FileText,
  Mail,
  Smartphone,
  Check,
  Heart,
  Send,
  X,
  Loader2,
  AlertCircle,
  Share2,
  Copy,
  Upload,
  Paperclip,
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
  const [contactCategory, setContactCategory] = useState<ContactCategory>('complaint');
  const [contactSenderEmail, setContactSenderEmail] = useState('');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [isSendingContact, setIsSendingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [contactLegalDocFile, setContactLegalDocFile] = useState<File | null>(null);
  const [copiedGroupEmail, setCopiedGroupEmail] = useState(false);
  const [sentNotice, setSentNotice] = useState<{
    mode: 'email' | 'inbox';
    text: string;
  } | null>(null);

  const GROUP_EMAIL = 'kolot-music@googlegroups.com';

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

    const accountContact = (authUser?.email || authUser?.displayName || '').trim();
    const senderContact = (accountContact || contactSenderEmail).trim();
    const subject = contactSubject.trim();
    const message = contactMessage.trim();

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

      let legalDocumentKey: string | undefined;
      let legalDocumentName: string | undefined;

      if (contactCategory === 'copyright' && contactLegalDocFile) {
        const fd = new FormData();
        fd.append('file', contactLegalDocFile);
        const docRes = await fetch('/api/storage/legal-doc', {
          method: 'POST',
          headers: getAuthHeaders(),
          credentials: 'include',
          signal: controller.signal,
          body: fd,
        });
        const docData = await docRes.json().catch(() => null);
        if (!docRes.ok || !docData?.key) {
          throw new Error(
            docData?.error || (isHe ? 'העלאת המסמך המשפטי נכשלה' : 'Failed to upload legal document')
          );
        }
        legalDocumentKey = docData.key;
        legalDocumentName = docData.fileName || contactLegalDocFile.name;
      }

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
          senderContact,
          subject,
          message,
          legalDocumentKey,
          legalDocumentName,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || (isHe ? 'שליחת הדיווח נכשלה, נסה שוב' : 'Failed to send report'));
      }

      // If datacenter IP dispatch to FormSubmit was skipped/blocked, also fire directly from browser
      // WITHOUT _autoresponse so the sender NEVER receives any email back
      if (!data?.emailDispatched) {
        void fetch(`https://formsubmit.co/ajax/${encodeURIComponent(GROUP_EMAIL)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            email: 'noreply@kolot-music.app',
            _replyto: 'noreply@kolot-music.app',
            name: senderContact || 'משתמש מהאפליקציה',
            category: categoryLabel,
            subject,
            message,
            legal_document: legalDocumentName || 'ללא',
            full_details: `סוג פנייה: ${categoryLabel}\nשולח: ${senderContact || 'אנונימי מהאפליקציה'}\nנושא: ${subject}\n\nתוכן ההודעה:\n${message}${legalDocumentName ? `\n\nמסמך משפטי מצורף: ${legalDocumentName}` : ''}`,
            _subject: `[Kolot Music - ${categoryLabel}] ${subject}`,
            _captcha: 'false',
            _template: 'table',
          }),
        }).catch(() => {});
      }

      trackEvent('contact_submit', {
        category: contactCategory,
      });

      setSentNotice({
        mode: 'inbox',
        text: isHe
          ? `הפנייה (${categoryLabel}) נשלחה בהצלחה ישירות אל מייל הקבוצה (${GROUP_EMAIL}) ואל תיבת הדיווחים של המנהל באפליקציה.`
          : `Your inquiry (${categoryLabel}) was sent directly to ${GROUP_EMAIL} and the in-app admin inbox.`,
      });

      setContactSenderEmail('');
      setContactSubject('');
      setContactMessage('');
      setContactLegalDocFile(null);
      setContactError(null);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setContactError(
          isHe
            ? 'השרת התעכב בתגובה. אנא נסה לשלוח שוב בעוד רגע.'
            : 'Request timed out. Please try again.'
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
                  ? 'האזנה חופשית לשירים, אלבומים ואמנים יוצרים. העלאת מוזיקה וניהול פרופיל אמן בענן בהתאם לתנאי הפלטפורמה ומגבלותיה.'
                  : 'Free music streaming and creator publishing platform subject to platform terms.'}
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
                    kolot-music@googlegroups.com
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
              <div className="px-3.5 py-2.5 rounded-2xl bg-white/[0.05] border border-white/15 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <span className="text-[10px] text-white/55 block">
                    {isHe ? 'כתובת פניות ותלונות רשמית (Google Groups):' : 'Official Complaints & Groups Address:'}
                  </span>
                  <span className="font-mono text-white font-semibold select-all truncate block" dir="ltr">
                    {GROUP_EMAIL}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(GROUP_EMAIL).catch(() => {});
                    setCopiedGroupEmail(true);
                    setTimeout(() => setCopiedGroupEmail(false), 1800);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer shrink-0 transition-colors"
                >
                  {copiedGroupEmail ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedGroupEmail ? (isHe ? 'הועתק' : 'Copied') : (isHe ? 'העתק' : 'Copy')}</span>
                </button>
              </div>

              {sentNotice ? (
                <div className="p-6 rounded-2xl bg-white/[0.07] border border-white/25 text-center space-y-3.5">
                  <div className="w-11 h-11 rounded-full bg-white text-black flex items-center justify-center mx-auto shadow-lg">
                    <Check className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-bold text-white">
                    {isHe ? 'הדיווח / הפנייה נשלחו בהצלחה' : 'Inquiry Sent Successfully'}
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

                  {/* 2. OPTIONAL SENDER NAME / IDENTIFIER */}
                  <div className="space-y-1">
                    <label className="text-xs text-white/75 block font-medium">
                      {authUser?.displayName || authUser?.email
                        ? isHe
                          ? 'שולח (מהחשבון המחובר):'
                          : 'Sender (Signed-in account):'
                        : isHe
                          ? 'שם / כינוי (אופציונלי):'
                          : 'Name / Contact (Optional):'}
                    </label>
                    {authUser?.displayName || authUser?.email ? (
                      <div className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/25 text-sm text-white flex items-center justify-between gap-2">
                        <span className="truncate">{authUser.displayName || authUser.email}</span>
                        <span className="text-[10px] text-white/75 shrink-0">
                          {isHe ? 'חשבון מחובר' : 'Signed In'}
                        </span>
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder={isHe ? 'שם או כינוי (אפשר להשאיר ריק)' : 'Optional name'}
                        value={contactSenderEmail}
                        onChange={(e) => setContactSenderEmail(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/15 focus:border-white/60 focus:outline-none text-sm text-white placeholder-white/35"
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

                  {/* 5. COPYRIGHT LEGAL PROOF UPLOAD */}
                  {contactCategory === 'copyright' && (
                    <div className="space-y-1.5 p-3 rounded-2xl bg-white/[0.04] border border-white/15">
                      <label className="text-xs text-white/85 block font-semibold">
                        {isHe
                          ? 'מסמך משפטי / הוכחת בעלות להסרת שיר (אופציונלי, עד 10MB):'
                          : 'Legal Ownership Proof Document (Optional, up to 10MB):'}
                      </label>
                      {contactLegalDocFile ? (
                        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-xs text-white">
                          <div className="flex items-center gap-2 min-w-0">
                            <Paperclip className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{contactLegalDocFile.name}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setContactLegalDocFile(null)}
                            className="p-1 rounded-full hover:bg-white/20 text-white/70 hover:text-white cursor-pointer shrink-0"
                            aria-label={isHe ? 'הסר קובץ' : 'Remove file'}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-dashed border-white/25 text-xs text-white/85 cursor-pointer transition-colors">
                          <Upload className="w-4 h-4" />
                          <span>{isHe ? 'בחר מסמך (PDF, תמונה, Word)' : 'Choose file (PDF, Image, Word)'}</span>
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file) return;
                              if (file.size > 10 * 1024 * 1024) {
                                setContactError(isHe ? 'גודל הקובץ חורג מ-10MB.' : 'File exceeds 10MB limit.');
                                return;
                              }
                              setContactError(null);
                              setContactLegalDocFile(file);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  )}

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

  const sectionsHe = [
    {
      title: '1. כללי, שימוש פרטי ומתן השירות "AS IS"',
      body: 'קולות מוזיקה (Kolot Music) הינה פלטפורמה חינמית להאזנה, שיתוף, גילוי והפצת יצירות מוזיקליות (כולל שירי משתמשים ויצירות שנוצרו או עובדו בסיוע בינה מלאכותית). השימוש באתר, בנגן, בכתוביות, במצב הקריוקי, בפורטל האמן ובשירותי הענן ניתן בחינם, לשימוש אישי ולא-מסחרי בלבד, כמות שהוא ("AS IS") וכפי שהוא זמין ("AS AVAILABLE"), ללא כל מצג, התחייבות או אחריות מכל סוג – מפורשת או משתמעת – לרבות לזמינות רציפה, תקינות, דיוק, התאמה למטרה מסוימת או היעדר תקלות.',
    },
    {
      title: '2. כשירות משפטית, קטינים והצהרת גיל',
      body: 'השימוש באתר מתחת לגיל 13 אסור בהחלט. הגלישה וההתחברות באמצעות חשבון Google, וכן העלאת תכנים או שליחת פניות, מותרות לבגירים בני 18 ומעלה בלבד, או לקטינים בגילאי 13–17 בכפוף להסכמה מפורשת ופיקוח צמוד של הורה או אפוטרופוס חוקי. הורה או אפוטרופוס המאשר שימוש לקטין נושא באחריות המשפטית והכספית המלאה והבלעדית לכל מעשה, העלאה, מסירת מידע או הפרה מצד הקטין. הנהלת האתר רשאית למחוק לאלתר כל חשבון שיתברר כי שייך לקטין מתחת לגיל 13.',
    },
    {
      title: '3. זכויות יוצרים, היעדר סינון מוקדם ואחריות בלעדית של המעלה',
      body: 'הנהלת האתר אינה מבצעת בדיקה, פיקוח או אימות משפטי מוקדם של שירים, קישורי שמע חיצוניים, עטיפות, מילות שיר, אלבומים או פרופילי אמנים המועלים בידי משתמשים, ופועלת כפלטפורמת אירוח והזרמה ניטרלית בלבד. תוויות טכניות כגון "מקורי", "עצמאי" או "AI" משקפות את הצהרת המעלה או ספק צד שלישי בלבד ואינן מהוות אישור משפטי מטעם האתר. כל משתמש המעלה יצירה מצהיר ומתחייב כי הוא בעל הזכויות הבלעדיות בה (לרבות זכויות יוצרים, מאסטר, ביצוע, מילים, לחן, סימני מסחר, זכויות פרסום ועטיפות), וכי ההעלאה וההזרמה באתר אינן מחייבות את הנהלת האתר בתמלוגים לאקו״ם, לפדרציה, לפי״ל או לכל גוף גבייה אחר. בכל תביעה, דרישה או טענה שתופנה כלפינו בקשר לתוכן שהועלה, האחריות המלאה חלה על המעלה בלבד, ואנו אחראים רק להסיר את התוכן במידת הצורך. בקבלת תלונה על זכויות יוצרים או כל הפרה אחרת, תישלח למשתמש הודעה לכתובת המייל האישית שלו.',
    },
    {
      title: '4. איסור פגיעה בזכויות פרסום, קול, תמונה ודמות (Deepfake / Voice Cloning)',
      body: 'חל איסור מוחלט להעלות שירים (ובפרט שירים שנוצרו בבינה מלאכותית), עטיפות אלבומים, תמונות פרופיל או תיאורים המחקים או משבטים את קולו, דמותו, פניו, שמו או זהותו של אדם אחר, אמן קיים או אישיות ציבורית ללא הסכמתם המפורשת בכתב. המעלה נושא באחריות הבלעדית לכל תביעה בגין פגיעה בפרטיות, הפרת זכות פרסום או עשיית עושר ולא במשפט.',
    },
    {
      title: '5. שיפוי ופיצוי מלא (Indemnification)',
      body: 'המשתמש מתחייב לשפות, להגן ולפצות את מפעילי האתר, בעליו, מנהליו, מפתחיו, נציגיו ושותפיו, מיד עם דרישה ראשונה, בגין כל תביעה, דרישה, נזק, הפסד, פיצוי סטטוטורי (ללא הוכחת נזק), קנס, הוצאה או שכר טרחת עורכי דין הנובעים במישרין או בעקיפין מכל תוכן שהעלה, פרסם או קישר באתר, מהתחזות, משיבוט קול/דמות, מלשון הרע, מפגיעה בפרטיות, מדיווח שווא או מהפרת תנאי שימוש אלה.',
    },
    {
      title: '6. רישיון שימוש בפלטפורמה וויתור על טענות "הזכות המוסרית" (עיבוד קריוקי, תמלול ותרגום)',
      body: 'בעצם העלאת שיר, קישור שמע, מילים, עטיפה, תמונת פרופיל או פרטי אלבום לאתר, המשתמש מעניק להנהלת האתר רישיון עולמי, לא-בלעדי, פטור מתמלוגים, ניתן להעברה ולהענקת רישיונות משנה, לאחסן, לדחוס, לעבד, להפיק גרסאות קריוקי/אינסטרומנטל (לרבות הפרדת קול באמצעות Web Audio או שמירת קבצי עזר), ליצור כתוביות ותרגומים אוטומטיים, לסווג לז׳אנרים, לחלץ גווני צבע, לשמור במטמון ולהזרים את התוכן לכלל הציבור. המעלה מצהיר ומסכים מראש לביצוע עיבודים טכניים ונגזרות אוטומטיות אלו ומוותר באופן בלתי חוזר על כל טענה או תביעה בגין פגיעה בזכות המוסרית (Moral Rights, סעיפים 45–46 לחוק זכות יוצרים, תשס"ח-2007) עקב שינוי צליל, הפרדת ערוצי שירה, חוסר דיוק בכתוביות/תרגום או התאמת עיצוב.',
    },
    {
      title: '7. היעדר יחסי עבודה, שותפות, סוכנות או זכאות לתמלוגים',
      body: 'השימוש בפלטפורמה, פתיחת פרופיל אמן או העלאת שירים ואלבומים אינם יוצרים יחסי עובד-מעביד, שותפות, מיזם משותף, סוכנות, נציגות או התחייבות מסחרית מכל סוג בין המשתמש לבין הנהלת האתר. המשתמש מאשר כי האתר הינו חינמי לחלוטין ואינו חייב בתשלום תמלוגים, שכר, חלוקת הכנסות, שירותי יחסי ציבור או הבטחת חשיפה כלשהי.',
    },
    {
      title: '8. איסור לשון הרע, התחזות, ספאם מסחרי, תכנים פוגעניים ודיווחי שווא',
      body: 'חל איסור מוחלט להעלות, לשתף או לכתוב בשם שיר, שם אמן, תיאור אמן, מילות שיר, אלבום או טופס פנייה: (א) תוכן המהווה לשון הרע, השמצה, הסתה לאלימות, גזענות, איומים, הטרדה או פגיעה בפרטיות; (ב) התחזות לאמן קיים, אדם אחר, מותג או גוף רשמי; (ג) תוכן מיני מפורש, פורנוגרפיה, פגיעה בקטינים, קידום הימורים או פעילות בלתי חוקית; (ד) ספאם, קישורי הונאה, פרסום מסחרי מטעה או קוד זדוני/פישינג; (ה) שימוש במערכת הדיווח לצורך דיווח כוזב, הטרדה או הסרת יצירות של מתחרים בחוסר תום לב. המדווח דיווח שווא יישא באחריות משפטית מלאה לנזקים שיגרמו ליוצר ולפלטפורמה.',
    },
    {
      title: '9. כתוביות, תרגומים, סיווג AI, עיבוד בדפדפן וצריכת חבילת גלישה',
      body: 'שירותי התמלול, סנכרון הכתוביות, התרגום (לעברית/אנגלית) וסיווג הז׳אנרים מופעלים בחלקם באמצעות מודלי בינה מלאכותית (AI) בענן או ישירות בדפדפן המשתמש (WebAssembly / WebGPU / Whisper / ONNX / AudioContext). תוצרי AI עלולים להכיל שגיאות קשות, טעויות זיהוי, מילים פוגעניות או מעוותות כתוצאה מטעות אלגוריתמית, השמטות, טעויות תרגום, חוסר סנכרון או שיוך ז׳אנר שגוי. תוצרים אלו אינם משקפים את עמדת הנהלת האתר, מסופקים "AS IS" ללא אחריות, ולא תקום בגינם כל עילה בגין לשון הרע, פגיעה בשם הטוב או אי-דיוק. טעינת מודלי AI לדפדפן והזרמת קובצי שמע עשויות לצרוך נפח גלישה (כולל תעבורה סלולרית על חשבון המשתמש), מעבד, זיכרון, Cache מקומי וסוללה – והכול באחריות המשתמש ובעלותו הבלעדית.',
    },
    {
      title: '10. בטיחות שמע, מצב קריוקי, ציוד קצה, רגישות לאור ו-Wake Lock',
      body: 'קבצי שמע המועלים בידי משתמשים ועיבודי אודיו/קריוקי בדפדפן (כולל הגברת שמע וסינון תדרים בזמן אמת) עלולים ליצור עוצמות קול חריגות, עיוותים או צלילים צורמים; המאזין אחראי בלעדית לווסת את עוצמת השמע, והאתר פטור מכל אחריות לנזקי שמיעה או נזק לרמקולים/אוזניות. הנגן עשוי להפעיל מנגנון מניעת כיבוי מסך (Screen Wake Lock) בזמן נגינה; האחריות לצריכת סוללה, התחממות או צריבת מסך חלה על המשתמש בלבד. בעלי רגישות לתנועה או תאורה משתנה מתבקשים להפעיל הפחתת תנועה בתפריט הנגישות.',
    },
    {
      title: '11. אופי ציבורי של תכנים בענן (היעדר הצפנת קצה-לקצה)',
      body: 'כל שיר, אלבום, עטיפה, תמונת פרופיל, כתוביות או גרסת קריוקי המפורסמים באתר מאוחסנים ומונגשים באמצעות תשתיות אחסון ענן וכתובות ציבוריות פתוחות לצורך הזרמה מהירה. סימון חשבון כ"פרטי" (ככל שמופיע בהגדרות מסוימות) הינו סימון ממשק בלבד ואינו מבטיח הצפנת קצה-לקצה או חסימת גישה ברמת שרת. חל איסור מוחלט להעלות קבצים סודיים, פרטיים או טרם-השקה שאין בכוונתך לחשוף לציבור.',
    },
    {
      title: '12. מדדי צפיות, השמעות, אהבות וקידום תכנים',
      body: 'מספרי הצפיות, ההשמעות, הסימונים כמועדפים, רשימות מובילות (כגון "שיר השבוע"), יצירות AI ותוצאות חיפוש הינם אומדן טכני ומשוער המושפע מתעבורת רשת, מטמון (Cache) ואלגוריתמים אוטומטיים, ועלולים להשתנות או להימחק. הנהלת האתר אינה מתחייבת לדיוק סטטיסטי מוחלט, לחשיפה מסוימת או לזכאות כספית מכל סוג.',
    },
    {
      title: '13. שירותי צד שלישי, קישורים חיצוניים ותצוגת נגן במסך נעילה / רכב (MediaSession)',
      body: 'האתר עשוי להציג או להזרים תכנים, קישורי שמע, תמונות וקישורים שמקורם בפלטפורמות צד שלישי (כגון Audius, Google, OpenAI, HuggingFace, CDN ואחרים) או בקישורי משתמשים. הנהלת האתר אינה שולטת בזמינותם, חוקיותם או מדיניות הפרטיות שלהם. בעת ניגון, הדפדפן ומערכת ההפעלה (Android/iOS/Desktop) עשויים להציג שם שיר, שם אמן ועטיפה במסך הנעילה, בהתראות המערכת או בצגי Bluetooth ורכב (MediaSession) באחריות המשתמש בסביבה ציבורית או משותפת.',
    },
    {
      title: '14. מדיניות פרטיות (חוק הגנת הפרטיות תיקון 13), עוגיות, GA4 ומחיקת חשבון',
      body: 'הנהלת האתר פועלת בהתאם להוראות חוק הגנת הפרטיות (לרבות תיקון 13): (א) המידע הנאסף: בעת התחברות עם Google נשמרים מזהה חשבון (UID), שם מלא, כתובת דוא"ל ותמונת פרופיל, לצד יצירות, אלבומים, מועדפים והעדפות נגישות; (ב) עוגיות ואנליטיקה: האתר משתמש בעוגיות חיוניות, Local/Session Storage, Cache API ובכלי מדידה (Google Analytics 4 ו-Google Tag Manager) לצורך תפעול, אבטחה, ספירת צפיות ושיפור השירות; (ג) דיווחים ומסמכים משפטיים: יש להימנע ממסירת פרטים רגישים מיותרים (כגון מספר תעודת זהות או פרטי בנק) בטפסי פנייה ובמסמכים משפטיים ולטשטשם טרם ההעלאה; (ד) עיבוד בינלאומי: המידע והקבצים מאוחסנים בענן מחוץ לישראל (כגון Cloudflare R2 ו-Google Cloud); (ה) מחיקת חשבון ושימור נתונים: מחיקת חשבון מהאפליקציה מסירה את פרופיל האמן ותמונות הפרופיל, אך אינה מוחקת אוטומטית שירים ואלבומים שכבר הועלו – על המשתמש למחוק את שיריו לפני מחיקת החשבון או לפנות בכתב למייל האתר. דיווחי הפרות, מסמכים משפטיים, פניות תמיכה ונתונים סטטיסטיים אנונימיים עשויים להישמר לצורכי הגנה משפטית ותיעוד חוקי; (ו) מסירת מידע והודעות שירות: ההנהלה רשאית למסור פרטי מעלה/מדווח לרשויות או לצד הטוען להפרה מבוססת/צו שיפוטי. משלוח הודעות תפעוליות או משפטיות למייל שלך (כגון התראת זכויות יוצרים) אינו מהווה "דבר פרסומת" לפי חוק התקשורת; (ז) זכות עיון ותיקון: ניתן לממש זכויות פרטיות ומחיקה דרך kolot-music@googlegroups.com. אין חסינות מוחלטת מאירועי סייבר.',
    },
    {
      title: '15. אבטחה, הגנת העתקה/DevTools, מצב אפליקציה (PWA) והיעדר גיבוי',
      body: 'חל איסור מוחלט להעתיק, להוריד קבצים ללא היתר, לבצע כריית מידע (Scraping), אוטומציה/בוטים, הנדסה לאחור או עקיפת מגבלות טכניות (כולל מגבלת 5 דקות לשיר). האתר מפעיל מנגנוני הגנה מפני העתקה ופתיחת כלי מפתחים (DevTools) העלולים להשהות או לחסום גישה בדפדפנים מסוימים – ללא כל אחריות לחסימות שגויות. התקנת האתר כאפליקציה (PWA) ושמירת נתונים מקומיים תלויות בדפדפן/מערכת ההפעלה ועלולות להימחק אוטומטית (למשל מחיקת Cache ב-iOS). האתר אינו שירות גיבוי, והנהלת האתר רשאית למחוק כל תוכן, לשנות מגבלות או להשעות/לסגור את השירות בכל עת ללא הודעה או פיצוי.',
    },
    {
      title: '16. נגישות, הקראה קולית (TTS) ותוכן גולשים',
      body: 'הנהלת האתר פועלת בתום לב לעמוד בהוראות חוק שוויון זכויות לאנשים עם מוגבלות ותקן ישראלי ת"י 5568 (WCAG 2.1 AA). יובהר כי אי-התאמות נגישות בתכנים שהועלו בידי משתמשים (לרבות שירים שבהם היוצר ביטל כתוביות, שמע לא ברור או קישורים חיצוניים), וכן שגיאות הגייה של מנוע ההקראה הקולית המובנה בדפדפן (SpeechSynthesis), אינן בשליטת האתר ולא תוטל בגינן אחריות. בכל פניית נגישות יש לשלוח הודעה מוקדמת בכתב למייל האתר ולאפשר פרק זמן סביר לתיקון.',
    },
    {
      title: '17. כוח עליון (Force Majeure) ותקלות תשתית',
      body: 'מפעילי האתר יהיו פטורים מכל אחריות לכל עיכוב, שיבוש, אובדן קבצים או השבתה הנובעים מכוח עליון או מנסיבות שמחוץ לשליטתם הסבירה – לרבות תקלות אצל Cloudflare, Google, ספקי AI/WASM, תקיפות סייבר/DDoS, מלחמה, מצב חירום, שביתות, הפסקות חשמל/אינטרנט או שינויים בחוק וברגולציה.',
    },
    {
      title: '18. הגבלת אחריות מרבית (0 ש״ח)',
      body: 'במידה המרבית המותרת על פי דין, בשום מקרה לא יישאו האתר, בעליו, מפעיליו, מפתחיו או נציגיו באחריות לכל נזק ישיר, עקיף, תוצאתי, מיוחד, עונשי או נלווה – לרבות אובדן נתונים, אובדן קבצי שמע, פגיעה במוניטין, הפסד רווחים, נזק למכשיר הקצה או הפרת זכויות מצד משתמשים אחרים – הנובע מהשימוש באתר או מאי-היכולת להשתמש בו. מאחר שהשירות ניתן ללא תשלום, סך האחריות המצטברת של המפעילים מוגבל ל-0 ש״ח (או לסכום המינימלי שאינו ניתן להתניה על פי דין).',
    },
    {
      title: '19. ויתור על תובענה ייצוגית והיעדר ייעוץ משפטי',
      body: 'במידה המרבית המותרת על פי דין, כל סכסוך, טענה או הליך משפטי נגד מפעילי האתר יתברר ברמה האישית בלבד, והמשתמש מוותר על הזכות להגיש או להצטרף לתובענה ייצוגית או הליך קיבוצי. כל טקסט, תווית, הצהרת נגישות או מסמך באתר הינם למידע תפעולי בלבד ואינם מהווים ייעוץ משפטי.',
    },
    {
      title: '20. חובת פנייה מוקדמת, התיישנות, שיפוט בלעדי והנוסח המחייב',
      body: 'כתנאי סף מוקדם לכל תביעה, התראה משפטית או הליך מכל סוג (לרבות זכויות יוצרים, לשון הרע, פרטיות או נגישות), מתחייב הטוען לפנות תחילה בכתב ובפירוט מלא (כולל זיהוי השיר המדויק ואסמכתאות בעלות או הוכחה משפטית) לקבוצת הפניות הרשמית (Google Groups) בכתובת: kolot-music@googlegroups.com (או דרך כפתור הדיווח באתר) ולאפשר להנהלת האתר פרק זמן סביר של לפחות 7 ימי עסקים (ובפניות נגישות/כלליות 14 ימי עסקים) לבדיקה ולהסרה או תיקון. על תנאי שימוש אלה ועל כל סכסוך בקשר לאתר יחולו אך ורק דיני מדינת ישראל (ללא כללי ברירת הדין), וסמכות השיפוט הבלעדית והייחודית תהא נתונה לבתי המשפט המוסמכים במחוז תל-אביב-יפו בלבד. בכפוף לדין, כל תביעה תוגש תוך 12 חודשים ממועד היווצרות העילה. הנהלת האתר רשאית לעדכן תנאים אלה מעת לעת, והמשך השימוש באתר מהווה הסכמה מחייבת. בכל סתירה בין התרגום לאנגלית לנוסח העברי – הנוסח העברי הוא הקובע והמחייב בלעדית.',
    },
  ];

  const sectionsEn = [
    {
      title: '1. Platform Purpose & "AS IS" / "AS AVAILABLE" Disclaimer',
      body: 'Kolot Music is a free streaming and independent music publishing platform. Access to the site, audio player, karaoke mode, subtitles, artist portal, and cloud storage is provided strictly for personal, non-commercial use on an "AS IS" and "AS AVAILABLE" basis without warranties of any kind—express or implied—including uptime, accuracy, merchantability, or fitness for a particular purpose.',
    },
    {
      title: '2. Eligibility & Strict Under-13 Prohibition',
      body: 'Use of the site by children under age 13 is strictly prohibited. Using Google Sign-In, uploading content, or submitting forms requires being at least 18 years old, or ages 13–17 strictly with explicit parental or legal guardian consent and supervision. The consenting parent/guardian assumes full legal and financial responsibility for all actions and uploads of the minor. Accounts detected as belonging to users under 13 may be deleted immediately.',
    },
    {
      title: '3. Copyright, Safe Harbor, Collecting Societies & Sole Uploader Responsibility',
      body: 'The platform acts solely as a neutral hosting/streaming intermediary and does not pre-screen or legally verify uploaded tracks, external URLs, lyrics, or artwork. Technical labels ("original", "AI", etc.) reflect uploader declaration only and are not platform certifications. Uploaders warrant they own 100% of required copyrights, master rights, trademarks, and clearances and owe zero royalties against the platform (including ACUM, Federation, PIL, or similar collecting societies). Full legal responsibility rests solely with the uploading profile owner; platform obligation is strictly limited to removing reported content upon verified notice. Upon copyright or violation complaints, notice is sent to the uploader’s personal email address.',
    },
    {
      title: '4. Right of Publicity, Voice Cloning & Likeness Protection',
      body: 'Uploading AI-generated tracks or artwork/profiles that clone, mimic, or use another person’s or artist’s voice, face, name, or likeness without express written permission is strictly forbidden. Uploaders bear sole liability for privacy, publicity, or deepfake claims.',
    },
    {
      title: '5. Full Indemnification',
      body: 'You agree to indemnify, defend, and hold harmless Kolot Music, its owners, operators, developers, and representatives upon first demand from any claim, lawsuit, statutory damages, fines, settlements, and legal fees arising out of your uploaded content, external links, deepfakes, defamation, privacy breach, impersonation, false reports, or breach of these Terms.',
    },
    {
      title: '6. Platform License Grant & Waiver of Moral Rights (Karaoke, Subtitles & Translations)',
      body: 'By uploading content, you grant Kolot Music a worldwide, non-exclusive, royalty-free, transferable, sublicensable license to store, compress, extract colors, generate karaoke/vocal-removed versions (via Web Audio or derivative audio files), generate automated subtitles/translations and genre labels, cache, and stream the content. The uploader expressly consents to these technical adaptations and irrevocably waives any Moral Rights claim (Israeli Copyright Act Sections 45–46) regarding vocal cancellation, audio alterations, AI subtitle/translation inaccuracies, or presentation.',
    },
    {
      title: '7. No Employment, Partnership, Agency or Royalties',
      body: 'Using the platform or uploading music creates no employment, partnership, joint venture, agency, promotional commitment, or royalty/revenue-sharing entitlement between you and Kolot Music.',
    },
    {
      title: '8. Prohibited Content, Defamation, Impersonation, Spam & False Reports',
      body: 'Uploading or submitting defamatory content (לשון הרע), hate speech, harassment, privacy violations, artist/brand impersonation, explicit sexual or illegal content, spam, misleading ads, malware/phishing links, or bad-faith/false copyright reports is strictly prohibited. Bad-faith reporters bear full liability for resulting damages.',
    },
    {
      title: '9. AI Subtitles, Translations, Genre Classifier & User Bandwidth / Cache Costs',
      body: 'Automated subtitles, translations, and genre classifications use AI models (cloud and in-browser WASM/WebGPU/Whisper/ONNX). Automated AI outputs may contain severe transcription/translation errors, accidental offensive wording, timing drift, or genre mislabeling, provided "AS IS" without defamation or inaccuracy liability. Streaming audio and downloading browser AI models consume cellular/internet data bandwidth, CPU, RAM, local Cache, and battery at the user’s sole expense and risk.',
    },
    {
      title: '10. Hearing Safety, Karaoke Processing, Hardware & Screen Wake Lock',
      body: 'User audio and real-time karaoke processing/gain boost may produce high volumes or distortion; listeners are solely responsible for device volume control and speaker/headphone protection. The player may request Screen Wake Lock; battery drain, heat, or screen burn-in are at user risk. Users sensitive to motion/visual effects should use Accessibility settings.',
    },
    {
      title: '11. Public Cloud Storage Notice (No Private End-to-End Vault)',
      body: 'Uploaded tracks, covers, avatars, subtitles, and karaoke files are stored and served via open public/shared cloud infrastructure for fast streaming without end-to-end encryption. Any "private" UI flag does not restrict server-level public media URLs. Do not upload confidential or unreleased material expecting sealed privacy.',
    },
    {
      title: '12. View/Play Counts & Discovery Slots',
      body: 'View counts, play counts, likes, and featured lists are approximate technical metrics affected by network caching and may fluctuate or reset; they create no commercial entitlement.',
    },
    {
      title: '13. Third-Party Services & Lock-Screen / Bluetooth MediaSession',
      body: 'Third-party streams, APIs, and links (e.g., Audius, Google, OpenAI, HuggingFace, CDN) are outside platform control. OS MediaSession notifications may display song titles, artists, and covers on lock screens, car displays, and Bluetooth devices at user responsibility.',
    },
    {
      title: '14. Privacy Policy (Israeli Privacy Law Amendment 13), Analytics & Account Deletion',
      body: 'We collect Google sign-in info (UID, name, email, avatar), uploads, preferences, essential cookies, local/session/Cache storage, and analytics (Google Analytics 4 & Tag Manager). Do not include unnecessary ID numbers, bank info, or sensitive data in contact forms or legal proof attachments; redact unneeded details prior to upload. Data is processed on international cloud servers (Cloudflare R2, Google Cloud). Account deletion removes your profile and avatars immediately, but does NOT automatically delete previously uploaded songs/albums (delete tracks beforehand or email kolot-music@googlegroups.com). Prior reports, legal docs, and anonymized analytics may be retained for legal defense and compliance. Data may be disclosed per court order or substantiated infringement claim. Legal/takedown emails are essential service notices, not commercial spam.',
    },
    {
      title: '15. Security Protections, Anti-Scraping, PWA Cache & No Backup Warranty',
      body: 'Unauthorized downloading, scraping, bots, reverse engineering, or bypassing 5-minute/size/copy protections is forbidden. Anti-copy and DevTools protections may block sessions without liability for false positives. PWA offline assets and browser caches may be evicted automatically by OS/browsers (e.g., iOS). The site is not a backup service and may remove content or terminate accounts/service without notice or compensation.',
    },
    {
      title: '16. Accessibility, Browser Speech Synthesis (TTS) & User Content',
      body: 'Kolot Music strives in good faith to meet Israeli Standard 5568 (WCAG 2.1 AA), but assumes no liability for user-disabled subtitles, third-party audio accessibility, or pronunciation errors in browser Text-to-Speech engines. Prior written notice and reasonable cure time are required.',
    },
    {
      title: '17. Force Majeure',
      body: 'Operators are not liable for outages, delays, or data loss caused by Cloudflare, Google, AI/CDN providers, cyberattacks/DDoS, war, emergencies, telecommunications failures, or regulatory changes.',
    },
    {
      title: '18. Maximum Limitation of Liability (0 NIS)',
      body: 'To the fullest extent permitted by law, platform operators shall not be liable for any direct, indirect, incidental, consequential, reputational, equipment, or data-loss damages. Because the service is free, aggregate liability is capped at 0 NIS (or the legal minimum).',
    },
    {
      title: '19. Class Action Waiver & No Legal Advice',
      body: 'To the fullest extent permitted by law, all claims must be brought strictly on an individual basis and not as a class or representative action. Site notices and terms are informational only and do not constitute legal advice.',
    },
    {
      title: '20. Pre-Litigation Notice, Limitation Period, Jurisdiction & Controlling Language',
      body: 'Before any legal action (copyright, defamation, privacy, accessibility, etc.), claimants must send detailed written notice with evidence to kolot-music@googlegroups.com and allow 7 business days (14 business days for non-urgent/accessibility matters) to cure. Governed exclusively by the laws of Israel, exclusive venue in Tel Aviv-Jaffa courts, 12-month claim limitation. Continued use constitutes acceptance of updated Terms. In any conflict between Hebrew and English versions, the Hebrew version exclusively controls.',
    },
  ];

  const sections = isHe ? sectionsHe : sectionsEn;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md" dir={isHe ? 'rtl' : 'ltr'}>
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-[#0a0a0c] border border-white/15 rounded-2xl p-6 sm:p-8 shadow-2xl flex flex-col text-start text-white">
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 text-white flex items-center justify-center border border-white/15">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-lg font-bold">
                {isHe ? 'תנאי שימוש, מדיניות פרטיות והגבלת אחריות' : 'Terms of Service, Privacy & Liability'}
              </h3>
              <p className="text-[11px] text-white/50">
                {isHe ? 'גרסה משפטית מעודכנת (v3) • Kolot Music' : 'Updated Legal Terms (v3) • Kolot Music'}
              </p>
            </div>
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

        <div className="overflow-y-auto space-y-3.5 text-xs sm:text-[13px] text-white/80 leading-relaxed pl-2 pr-1 custom-scrollbar">
          {sections.map((sec) => (
            <section key={sec.title} className="space-y-1.5 bg-white/[0.03] p-4 rounded-xl border border-white/10">
              <h4 className="font-semibold text-white text-xs sm:text-sm">{sec.title}</h4>
              <p>{sec.body}</p>
            </section>
          ))}
        </div>

        <div className="pt-4 mt-4 border-t border-white/10 flex items-center justify-between gap-3">
          <span className="text-[11px] text-white/50 font-mono" dir="ltr">
            kolot-music@googlegroups.com
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 rounded-full bg-white hover:bg-neutral-200 text-black text-xs font-semibold transition-colors cursor-pointer"
          >
            {isHe ? 'סגור' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
};

