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
              {isHe ? 'תנאי שימוש, מדיניות פרטיות והגבלת אחריות (v2):' : 'Terms of Service, Privacy & Liability (v2):'}
            </h4>
            <ul className="space-y-2 list-disc list-inside text-[11px] text-white/80">
              <li>
                {isHe
                  ? 'כשירות וגיל: השימוש וההתחברות לאתר מיועדים לבני 18+ בלבד (או בני 13+ באישור ופיקוח מלא של הורה/אפוטרופוס האחראי לכל פעולה של הקטין).'
                  : 'Eligibility: Use and upload require age 18+ (or 13+ with explicit parent/guardian consent and responsibility).'}
              </li>
              <li>
                {isHe
                  ? 'אחריות בלעדית ושיפוי מלא: כל תוכן המועלה (קבצי שמע עד 5 דקות/1GB, קישורים חיצוניים, עטיפות, מילים, שמות וז׳אנרים) הינו באחריות בעל הפרופיל המעלה בלבד. הנהלת האתר אינה מבצעת סינון או אימות משפטי מוקדם, ואינה אחראית לתביעות, תמלוגים או נזקים. המשתמש מתחייב לשפות ולפצות את הנהלת האתר בגין כל תביעה, נזק, קנס או הוצאה משפטית עקב תוכן שהעלה או הפרת התנאים.'
                  : 'Sole Uploader Responsibility & Indemnification: Platform does not pre-screen uploads. Uploader bears sole responsibility and agrees to fully indemnify the platform against any claim, royalties, or legal fees.'}
              </li>
              <li>
                {isHe
                  ? 'רישיון שימוש והסרת תכנים: העלאת תוכן מעניקה לפלטפורמה רישיון לאחסן, לעבד (כולל תמלול/תרגום/ז׳אנר), לשמור במטמון ולהזרים את התוכן בענן. במקרה של תלונת זכויות יוצרים או הפרה, חובתנו מוגבלת להסרת התוכן במידת הצורך, ולמעלה תישלח הודעה לכתובת המייל האישית שלו.'
                  : 'Platform License & Removal: Uploading grants a royalty-free license to host, process, and stream content. On copyright or violation complaints, our sole duty is content removal and notice is emailed to the uploader.'}
              </li>
              <li>
                {isHe
                  ? 'איסור לשון הרע, התחזות, תוכן פוגעני ודיווחי שווא: חל איסור מוחלט להעלות תכני לשון הרע, הסתה, אלימות, פגיעה בפרטיות, תוכן מיני/בלתי חוקי, קוד זדוני, להתחזות לאמן/אחר או להגיש דיווחי סרק פוגעניים.'
                  : 'Prohibited Conduct: Defamation, impersonation, hate speech, explicit/illegal content, malware, and bad-faith false reports are strictly forbidden.'}
              </li>
              <li>
                {isHe
                  ? 'בינה מלאכותית (AI) וכתוביות: כתוביות, תמלולים, תרגומים וסיווגי ז׳אנר (בענן ובדפדפן) מסופקים "AS IS" ועלולים לכלול שגיאות טקסט/תזמון/תרגום ואף מילים שגויות – ללא כל אחריות או עילת לשון הרע. עיבוד בדפדפן (WASM/WebGPU/AudioContext) צורך משאבי מכשיר על אחריות המשתמש.'
                  : 'AI Features "AS IS": AI subtitles, translations, and genre tags may contain errors or misinterpretations without liability. In-browser processing runs at user device risk.'}
              </li>
              <li>
                {isHe
                  ? 'פרטיות, אנליטיקה ואחסון ענן חוצה-גבולות: פרטי Google (שם, מייל, תמונה, UID), יצירות, פניות ומסמכים משפטיים מעובדים ונשמרים בענן (כולל Cloudflare R2 ו-Google Analytics / Tag Manager) ובאחסון מקומי בדפדפן. הנהלת האתר רשאית למסור פרטי מעלה/מדווח לרשויות או לבעל זכויות במסגרת טענה משפטית מבוססת. למרות אמצעי הגנה, אין חסינות מוחלטת מפני אירועי סייבר.'
                  : 'Privacy & Cloud: Google profile data, uploads, legal docs, cookies, local storage, and GA4/GTM analytics are processed on international cloud infrastructure. Details may be disclosed upon court order or substantiated infringement claims.'}
              </li>
              <li>
                {isHe
                  ? 'בטיחות, מניעת כיבוי מסך, קישורים חיצוניים והיעדר גיבוי: האתר מסופק "AS IS" ואינו שירות גיבוי; ההנהלה רשאית למחוק תוכן, לשנות מגבלות או לסגור חשבון/אתר ללא הודעה או פיצוי. המשתמש אחראי לעוצמת השמע, למנגנון Wake Lock, ולגלישה בקישורים/מאגרים חיצוניים (כגון Audius). מדדי צפיות/אהבות הינם אומדן טכני בלבד, והאתר פטור מתאימות נגישות בתוכן משתמשים (כגון ביטול כתוביות).'
                  : 'Service Availability & Safety: Provided "AS IS" with no backup warranty. Users are responsible for audio volume, Wake Lock battery usage, and external links. View counters are estimates; platform is not liable for user-disabled accessibility.'}
              </li>
              <li>
                {isHe
                  ? 'חובת פנייה מוקדמת, הגבלת אחריות ושיפוט בלעדי בישראל: האחריות הכספית של המפעילים מוגבלת ל-0 ש״ח. טרם כל הליך משפטי (זכויות יוצרים, לשון הרע, פרטיות, נגישות וכו׳) חובה לפנות בכתב עם אסמכתאות ל-kolot-music@googlegroups.com ולאפשר לפחות 7–14 ימי עסקים לטיפול. דין מדינת ישראל חל בלעדית, והסמכות הבלעדית הינה לבתי המשפט במחוז תל-אביב-יפו (תביעות עד 12 חודשים).'
                  : 'Pre-Litigation Notice & Jurisdiction: Aggregate liability is 0 NIS. Written notice & cure period (7–14 business days) to kolot-music@googlegroups.com is mandatory before any legal claim. Governed by Israeli law; exclusive jurisdiction in Tel Aviv-Jaffa courts.'}
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
