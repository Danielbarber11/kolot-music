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

          <div className="space-y-3 text-xs leading-relaxed text-white/85 max-h-64 overflow-y-auto p-4 rounded-2xl bg-neutral-900 border border-white/10 custom-scrollbar">
            <h4 className="font-extrabold text-white text-sm">
              {isHe ? 'תנאי שימוש, מדיניות פרטיות והגבלת אחריות (v3):' : 'Terms of Service, Privacy & Liability (v3):'}
            </h4>
            <ul className="space-y-2 list-disc list-inside text-[11px] text-white/80">
              <li>
                {isHe
                  ? 'כשירות וגיל: השימוש מתחת לגיל 13 אסור בהחלט. ההתחברות והעלאה מותרות לבני 18+ בלבד (או 13–17 באישור ופיקוח מלא של הורה/אפוטרופוס האחראי משפטית וכספית לכל פעולה).'
                  : 'Eligibility: Under 13 strictly prohibited. Use and upload require age 18+ (or 13–17 with parent/guardian consent and full legal responsibility).'}
              </li>
              <li>
                {isHe
                  ? 'אחריות בלעדית, אקו״ם ושיפוי מלא: הפלטפורמה אינה מבצעת סינון מוקדם ואינה חבה בתמלוגים (אקו״ם/פדרציה/פי״ל). כל תוכן (שירים עד 5 דקות, קישורים, עטיפות, קולות AI) הינו באחריות המעלה בלבד, המתחייב לשפות ולפצות את ההנהלה במלואה בגין כל תביעה או נזק. חל איסור על שיבוט קול/דמות (Deepfake) ללא אישור.'
                  : 'Sole Responsibility, Collecting Societies & Indemnification: Platform does not pre-screen and owes zero royalties. Uploader bears sole liability (including AI voice/likeness) and agrees to indemnify the platform.'}
              </li>
              <li>
                {isHe
                  ? 'רישיון, ויתור על "הזכות המוסרית" ועיבוד קריוקי: העלאה מעניקה רישיון לאחסן, לעבד קריוקי/הסרת שירה, להפיק כתוביות ותרגומים ולהזרים לציבור, תוך ויתור מראש על טענת פגיעה בזכות המוסרית. אין באחסון הקבצים הצפנת קצה-לקצה והשירים זמינים בכתובות ציבוריות; העלאה אינה יוצרת יחסי עבודה, שותפות או זכאות לתשלום.'
                  : 'License & Moral Rights Waiver: Uploading grants license for public streaming, karaoke vocal processing, and automated subtitles with waiver of moral rights. Files use open cloud URLs; no agency/partnership/royalty relationship is created.'}
              </li>
              <li>
                {isHe
                  ? 'איסור לשון הרע, התחזות, ספאם ודיווחי שווא: חל איסור להעלות לשון הרע, הסתה, אלימות, פורנוגרפיה, ספאם/הונאה, קוד זדוני, להתחזות לאחר או להגיש דיווחי סרק בחוסר תום לב.'
                  : 'Prohibited Conduct: Defamation, impersonation, hate speech, explicit/illegal content, spam, malware, and bad-faith false reports are strictly forbidden.'}
              </li>
              <li>
                {isHe
                  ? 'AI, כתוביות, צריכת גלישה וציוד קצה: תמלול, תרגום וסיווגי AI מסופקים "AS IS" ועלולים לכלול שגיאות ללא עילת לשון הרע. הורדת מודלים בדפדפן והזרמת אודיו צורכות חבילת גלישה, מעבד, Cache וסוללה על חשבון המשתמש בלבד. המאזין אחראי לבטיחות עוצמת השמע, מצב קריוקי, Wake Lock ומניעת נזק לרמקולים/מסך.'
                  : 'AI "AS IS", Bandwidth & Safety: AI outputs may contain errors without defamation liability. In-browser AI and audio use user cellular data, CPU, cache, and battery. Listeners bear sole risk for volume, karaoke gain, speaker protection, and Wake Lock.'}
              </li>
              <li>
                {isHe
                  ? 'פרטיות (תיקון 13), אנליטיקה ומחיקת חשבון: נתוני Google (UID, מייל, תמונה), לוגים, עוגיות, GA4/GTM, דיווחים ומסמכים משפטיים (יש להשחיר ת"ז/פרטים מיותרים) מעובדים בענן בינלאומי. מחיקת חשבון מסירה פרופיל ואווטאר ואינה מוחקת אוטומטית שירים קיימים (יש למחקם קודם לכן או לפנות במייל). תצוגת נגן במסך נעילה/רכב היא באחריות המשתמש.'
                  : 'Privacy (Amendment 13) & Account Deletion: Google data, cookies, GA4/GTM, and legal docs (redact unneeded IDs) are stored on international clouds. Account deletion removes profile/avatars but not previously uploaded tracks (delete tracks first or email us). Lock-screen/Bluetooth MediaSession metadata is at user risk.'}
              </li>
              <li>
                {isHe
                  ? 'אבטחה, PWA, כוח עליון ואין גיבוי: השירות ניתן ללא אחריות גיבוי. חסימות מניעת העתקה/DevTools, נפילות ספקי צד שלישי (Cloudflare/Google/Audius) ומחיקת Cache ע"י הדפדפן הינן ללא פיצוי. האתר פטור מאי-התאמות נגישות בתוכן משתמשים או במנוע הקראה קולית (TTS).'
                  : 'Security, Force Majeure & No Backup: No backup warranty; anti-copy/DevTools locks, browser cache eviction, third-party outages, user-disabled accessibility, and TTS pronunciation errors carry zero liability.'}
              </li>
              <li>
                {isHe
                  ? 'חובת פנייה מוקדמת, ויתור ייצוגית, שיפוט בישראל והנוסח המחייב: אחריות ההנהלה מוגבלת ל-0 ש״ח. כל תביעה תתברר אישית בלבד (ויתור על תובענה ייצוגית בכפוף לדין) לאחר פנייה מוקדמת בכתב ל-kolot-music@googlegroups.com והמתנה 7–14 ימי עסקים. דין מדינת ישראל חל בלעדית, סמכות בלעדית בתל-אביב-יפו (תביעות עד 12 חודשים), והנוסח העברי הוא המחייב.'
                  : 'Notice, Individual Claims & Jurisdiction: Liability capped at 0 NIS. Individual claims only (class action waiver) after 7–14 business days written notice to kolot-music@googlegroups.com. Israeli law, Tel Aviv-Jaffa courts, 12-month limit; Hebrew text controls.'}
              </li>
            </ul>
          </div>

          <button
            onClick={onAccept}
            className="w-full py-4 rounded-2xl bg-white hover:bg-neutral-200 text-black font-black text-sm transition-all shadow-xl cursor-pointer flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-95"
          >
            <Check className="w-5 h-5 text-black" />
            <span>{isHe ? 'קראתי ואני מאשר/ת את כל תנאי השימוש ומדיניות הפרטיות' : 'I Have Read & Accept All Terms & Privacy Policy'}</span>
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
