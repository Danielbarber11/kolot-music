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
              {isHe ? 'תנאי שימוש, מדיניות פרטיות והגבלת אחריות (v5):' : 'Terms of Service, Privacy & Liability (v5):'}
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
                  ? 'רישיון וויתור על "הזכות המוסרית": העלאה מעניקה רישיון לאחסן, לדחוס, לעבד כתוביות ותרגומים ולהזרים לציבור, תוך ויתור מראש על טענת פגיעה בזכות המוסרית. אין באחסון הקבצים הצפנת קצה-לקצה והשירים זמינים בכתובות ציבוריות; העלאה אינה יוצרת יחסי עבודה, שותפות או זכאות לתשלום.'
                  : 'License & Moral Rights Waiver: Uploading grants license for public streaming, compression, and automated subtitles with waiver of moral rights. Files use open cloud URLs; no agency/partnership/royalty relationship is created.'}
              </li>
              <li>
                {isHe
                  ? 'איסור לשון הרע, התחזות, ספאם, נוזקות ודיווחי שווא: חל איסור להעלות לשון הרע, הסתה, אלימות, פורנוגרפיה, ספאם/הונאה, קוד זדוני/ווירוסים, להתחזות לאחר או להגיש דיווחי סרק בחוסר תום לב.'
                  : 'Prohibited Conduct: Defamation, impersonation, hate speech, explicit/illegal content, spam, viruses/malware, and bad-faith false reports are strictly forbidden.'}
              </li>
              <li>
                {isHe
                  ? 'כתוביות AI (עלולות לטעות), צריכת גלישה וציוד קצה: תמלול, תרגום וסיווגי ז׳אנר מבוססי AI (לרבות מצעדי "השירים המובילים") מסופקים "AS IS" ועלולים לטעות ללא עילת לשון הרע. הורדת מודלים בדפדפן והזרמת אודיו צורכות חבילת גלישה, מעבד, Cache וסוללה על חשבון המשתמש בלבד. המאזין אחראי לבטיחות עוצמת השמע, בטיחות בנהיגה, Wake Lock ומניעת נזק לרמקולים/מסך.'
                  : 'AI Subtitles (May Contain Mistakes), Charts & Bandwidth: AI subtitles, genres, and ranked charts are "AS IS" and may contain errors without liability. Browser AI and audio consume user data, CPU, cache, and battery. Listeners bear sole risk for volume, driving laws, and Wake Lock.'}
              </li>
              <li>
                {isHe
                  ? 'כרטיסים להופעות, קישורים חיצוניים ואלבומים (iOS/Safari): פרטי הופעות וקישורים לאתרי הזמנות הינם באחריות האמן המפרסם בלבד; האתר אינו צד לעסקה ואינו אחראי לביטולים או החזרים. רצף הנגינה באלבומים ותאימות במכשירי iOS/Safari תלויים בדפדפן וללא התחייבות לרצף בלתי פוסק.'
                  : 'Concert Tickets, External Booking Links & Albums (iOS/Safari): Event details and external ticket links are solely artist-managed; platform is not a party or liable for refunds. Album auto-advance and iOS/Safari playback depend on OS/browser behavior.'}
              </li>
              <li>
                {isHe
                  ? 'עריכת פרופיל, שמירת מטמון Offline ורענון 48 שעות: המשתמש אחראי לשם ותמונת הפרופיל שיבחר (כולל כפתור השחזור מ-Google) ומתחייב שלא להשתמש בשמות/סמלים מטעים. הדפדפן עשוי לשמור מסך "אין אינטרנט" מקומי במטמון וליזום רענון אוטומטי בלשוניות פתוחות מעל 48 שעות.'
                  : 'Profile Editing, Local Offline Cache & 48h Refresh: Artists are solely liable for custom names/avatars and Google restore usage. Browsers may locally cache an offline screen and auto-refresh tabs idle over 48 hours.'}
              </li>
              <li>
                {isHe
                  ? 'סודיות דיווחים, פרטיות (תיקון 13 / GDPR) ומחיקת חשבון: דיווחים נשמרים בתיבה פרטית למנהל בלבד ונשלחים לקבוצת הניהול מבלי לחשוף לציבור ומבלי לשלוח עותק למדווח; חשבון מחובר מצרף שם, מייל ותמונת פרופיל למנהל. מסמכים משפטיים (יש להשחיר ת"ז/בנק), לוגי אבטחה ונתוני GA4/GTM עשויים להישמר להגנה משפטית אף לאחר מחיקת חשבון (שאינה מוחקת אוטומטית שירים קיימים).'
                  : 'Report Confidentiality & Privacy (Amendment 13 / GDPR): Reports go strictly to the private admin inbox and management group (never public or auto-emailed back); signed-in accounts attach Name, Email & Avatar for admin security. Redact unneeded IDs in legal proof. Logs/legal records may be retained for legal defense; account deletion does not auto-delete previously uploaded tracks.'}
              </li>
              <li>
                {isHe
                  ? 'אבטחה, קניין רוחני של האתר, הודעה והסרה והמחאת זכויות: כל קוד האתר, העיצוב והסימנים המסחריים שייכים לבעלי האתר (למעט קוד פתוח ברישיונו). השירות ניתן ללא אחריות גיבוי וללא חובת ניטור כללית (Notice & Takedown מחייב זיהוי מדויק). חסימות מניעת העתקה/DevTools ומגבלות קבצים/דפדפנים חלות ללא פיצוי.'
                  : 'Security, Platform IP, Notice-and-Takedown & Assignment: Site UI, code, and trademarks belong to operators (except open-source components). No backup warranty or general monitoring duty. Anti-copy/DevTools locks and format/device limits carry zero liability.'}
              </li>
              <li>
                {isHe
                  ? 'ציות לחוק, פנייה מוקדמת, ויתור ייצוגית/צו מניעה ושיפוט בישראל: אחריות ההנהלה מוגבלת ל-0 ש״ח. כל תביעה תתברר אישית בלבד (ויתור על תובענה ייצוגית וצו מניעה בכפוף לדין) לאחר פנייה מוקדמת בכתב ל-kolot-music@googlegroups.com והמתנה 7–14 ימי עסקים. הודעות באתר/למייל מחייבות, דין ישראל חל בלעדית, סמכות בלעדית בתל-אביב-יפו (תביעות עד 12 חודשים), הפרדת סעיפים חלה והנוסח העברי הוא הקובע.'
                  : 'Legal Compliance, Pre-Suit Notice, Individual Claims & Jurisdiction: Liability capped at 0 NIS. Individual claims only (class action & injunctive relief waiver) after 7–14 business days notice to kolot-music@googlegroups.com. Electronic notices bind upon dispatch/posting. Israeli law, Tel Aviv-Jaffa courts, 12-month limit; Hebrew text controls.'}
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
