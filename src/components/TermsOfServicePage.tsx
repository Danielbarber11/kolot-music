import React from 'react';
import { ShieldCheck, Mail, ExternalLink, Globe, Info } from 'lucide-react';
import { Language } from '../types';

interface TermsOfServicePageProps {
  lang: Language;
}

export const TermsOfServicePage: React.FC<TermsOfServicePageProps> = ({ lang }) => {
  const isHe = lang === 'he';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8" dir={isHe ? 'rtl' : 'ltr'}>
      <div className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-12 shadow-sm space-y-6">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 text-slate-800 text-xs font-extrabold border border-slate-200">
          <ShieldCheck className="w-4 h-4 text-indigo-600" />
          <span>TERMS OF SERVICE, PRIVACY & LEGAL DISCLAIMER (v2)</span>
        </div>

        <h1 className="text-3xl font-black text-slate-900 tracking-tight">
          {isHe ? 'תנאי שימוש, מדיניות פרטיות והגבלת אחריות' : 'Terms of Service, Privacy & Legal Notice'}
        </h1>

        <div className="bg-slate-50 border border-slate-200 p-6 rounded-2xl text-slate-900 text-sm leading-relaxed font-medium space-y-3">
          <p className="font-bold text-base text-slate-950">
            הצהרת אחריות, זכויות יוצרים, פרטיות ובינה מלאכותית (AI):
          </p>
          <p>
            1. <strong>שירות "AS IS" וכמות שהוא:</strong> האתר ניתן בחינם לשימוש אישי ולא-מסחרי בלבד ללא כל מצג או התחייבות לזמינות רציפה, גיבוי קבצים או היעדר תקלות. השימוש מותר לבני 18+ בלבד (או 13+ בהסכמת הורה/אפוטרופוס ובאחריותו המלאה).
          </p>
          <p>
            2. <strong>אחריות בלעדית של המעלה ושיפוי מלא:</strong> כל תוכן שהועלה לאתר (שירים עד 5 דקות, קישורי שמע, מילים, עטיפות, תיאורים) הינו באחריותו הבלעדית של בעל הפרופיל המעלה בלבד. האתר אינו מבצע בדיקה משפטית מוקדמת ואינו נושא באחריות לתביעות, תמלוגים או נזקים. בכל תביעה שתיטען כלפינו, האחריות והחובה לשפותנו במלואם חלות על המעלה בלבד, ואחריותנו מוגבלת להסרת התוכן במידת הצורך ומשלוח הודעה למייל האישי של המעלה.
          </p>
          <p>
            3. <strong>איסור לשון הרע, התחזות, תכנים פוגעניים ודיווחי שווא:</strong> חל איסור מוחלט להעלות תכני לשון הרע, הסתה, אלימות, הטרדה, פגיעה בפרטיות, תוכן מיני, קוד זדוני, להתחזות לאמנים/מותגים או להגיש דיווחי סרק בחוסר תום לב.
          </p>
          <p>
            4. <strong>AI, כתוביות, תרגומים ומדדים:</strong> כתוביות מסונכרנות, תמלולים, תרגומים וסיווגי ז׳אנר מבוססי AI (בענן ובדפדפן) מסופקים "AS IS" ועלולים לכלול שגיאות טקסט/תזמון/תרגום או מילים שגויות ללא אחריות או עילת לשון הרע. מספרי צפיות והשמעות הינם אומדן טכני מושפע Cache בלבד.
          </p>
          <p>
            5. <strong>פרטיות, עוגיות, אנליטיקה וענן חוצה-גבולות:</strong> האתר עושה שימוש באימות Google, בעוגיות, באחסון מקומי בדפדפן וב-Google Analytics 4 / Tag Manager. תכנים, פניות ומסמכים משפטיים נשמרים בשרתי ענן בינלאומיים (Cloudflare R2 / Google Cloud) ועשויים להימסר על פי צו או דרישה מבוססת להפרת זכויות. המשתמש אחראי לבטיחות שמע (עוצמת קול) ולשימוש במנגנון Wake Lock.
          </p>
          <p>
            6. <strong>חובת פנייה מוקדמת ושיפוט בלעדי בישראל:</strong> סך אחריות מפעילי האתר מוגבל ל-0 ש״ח. טרם כל הליך משפטי חובה לפנות בכתב עם אסמכתאות ל-<span dir="ltr" className="font-mono">kolot-music@googlegroups.com</span> ולאפשר 7–14 ימי עסקים לטיפול. דין מדינת ישראל חל בלעדית, והסמכות הבלעדית נתונה לבתי המשפט במחוז תל-אביב-יפו.
          </p>
        </div>

        <div className="space-y-4 text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-6">
          <h3 className="font-bold text-sm text-slate-900">{isHe ? 'תשתיות ושירותי צד שלישי בשימוש הפלטפורמה:' : 'Infrastructure & Third-Party Services:'}</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Google OAuth & Google Analytics / GTM</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Cloudflare Workers & R2 Cloud Storage</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Gemini AI & In-Browser Whisper WASM</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Audius Protocol & External Audio Streams</li>
          </ul>
        </div>

        <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <Mail className="w-4 h-4 text-indigo-600" />
            <span>פניות, דיווחי זכויות ונגישות (Google Groups): <b dir="ltr">kolot-music@googlegroups.com</b></span>
          </div>

          <span className="text-[11px] font-mono text-slate-400">Kolot Music Legal v2</span>
        </div>
      </div>
    </div>
  );
};
