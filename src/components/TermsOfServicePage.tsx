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
          <span>TERMS OF SERVICE, PRIVACY & LEGAL DISCLAIMER (v5)</span>
        </div>

        <h1 className="text-3xl font-black text-slate-900 tracking-tight">
          {isHe ? 'תנאי שימוש, מדיניות פרטיות והגבלת אחריות' : 'Terms of Service, Privacy & Legal Notice'}
        </h1>

        <div className="bg-slate-50 border border-slate-200 p-6 rounded-2xl text-slate-900 text-sm leading-relaxed font-medium space-y-3">
          <p className="font-bold text-base text-slate-950">
            הצהרת אחריות, זכויות יוצרים, פרטיות (תיקון 13) ובינה מלאכותית (AI):
          </p>
          <p>
            1. <strong>שירות "AS IS", כשירות וגיל:</strong> האתר ניתן בחינם לשימוש אישי ולא-מסחרי בלבד ללא התחייבות לזמינות רציפה או גיבוי. השימוש מתחת לגיל 13 אסור בהחלט; התחברות והעלאה מותרות לבני 18+ בלבד (או 13–17 באישור ופיקוח הורה/אפוטרופוס האחראי מלאה למעשי הקטין).
          </p>
          <p>
            2. <strong>אחריות בלעדית, אקו״ם, שיבוט קול ושיפוי מלא:</strong> כל תוכן שהועלה לאתר (שירים עד 5 דקות, קישורי שמע, מילים, עטיפות, תיאורים) הינו באחריות המעלה בלבד. האתר אינו מבצע סינון מוקדם ואינו חב בתמלוגים לאקו״ם/פדרציה/פי״ל. חל איסור על שיבוט קול או דמות (Deepfake) ללא היתר. בכל תביעה שתיטען כלפינו, האחריות והחובה לשפותנו במלואן חלות על המעלה בלבד, ואחריותנו מוגבלת להסרת התוכן ומשלוח הודעה למייל האישי של המעלה. אין בהעלאה יצירת יחסי עבודה, שותפות או זכאות לתשלום.
          </p>
          <p>
            3. <strong>ויתור על הזכות המוסרית ועיבוד כתוביות/אודיו:</strong> העלאת יצירה מעניקה רישיון שימוש והזרמה פומבית וכוללת הסכמה מראש לעיבוד ודחיסת אודיו, יצירת כתוביות ותרגומים, חילוץ צבעים ושמירת מטמון, תוך ויתור על טענות פגיעה בזכות המוסרית. הקבצים מאוחסנים בכתובות ענן ציבוריות ואינם מהווים כספת סודית או מוצפנת.
          </p>
          <p>
            4. <strong>איסור לשון הרע, התחזות, ספאם, נוזקות ודיווחי שווא:</strong> חל איסור מוחלט להעלות תכני לשון הרע, הסתה, אלימות, הטרדה, פגיעה בפרטיות, תוכן מיני, ספאם/הונאה, וירוסים או קוד זדוני, להתחזות לאמנים/מותגים או להגיש דיווחי סרק בחוסר תום לב.
          </p>
          <p>
            5. <strong>AI, כתוביות (עלולות לטעות), צריכת גלישה ומדדים:</strong> כתוביות מסונכרנות, תמלולים, תרגומים וסיווגי ז׳אנר מבוססי AI (בענן ובדפדפן WASM/ONNX) מסופקים "AS IS" ועלולים לטעות, לשבש מילים, להשמיט קטעים או לצאת מסנכרון ללא אחריות או עילת לשון הרע. הורדת מודלים בדפדפן והזרמת שמע צורכות חבילת גלישה סלולרית/אינטרנטית, מעבד, Cache וסוללה על חשבון המשתמש. מדדי צפיות הינם אומדן טכני בלבד.
          </p>
          <p>
            6. <strong>פרטיות (תיקון 13), אנליטיקה, MediaSession ומחיקת חשבון:</strong> האתר עושה שימוש באימות Google, בעוגיות, ב-Cache וב-Google Analytics 4 / GTM. אין למסור ת"ז או מידע רגיש מיותר במסמכים משפטיים או פניות. תכנים מעובדים בענן בינלאומי (Cloudflare R2 / Google Cloud) ועשויים להימסר על פי צו או דרישה מבוססת. מחיקת חשבון מסירה פרופיל ואווטאר ואינה מוחקת אוטומטית שירים ישנים (יש למחקם קודם לכן או לפנות במייל). הודעות תפעוליות/משפטיות למייל אינן "דבר פרסומת". המשתמש אחראי לבטיחות שמע, נזקי ציוד/רמקולים, בטיחות בנהיגה, Wake Lock ותצוגה במסך נעילה/Bluetooth.
          </p>
          <p>
            7. <strong>אבטחה, נגישות, כוח עליון, ויתור ייצוגית/צו מניעה ושיפוט בלעדי:</strong> האתר פטור מתקלות ספקי צד ג׳/כוח עליון, חסימות מניעת העתקה/DevTools, אי-תאימות נגישות בתוכן משתמשים או שגיאות TTS. סך אחריות המפעילים מוגבל ל-0 ש״ח. כל תביעה תוגש באופן אישי בלבד (ויתור על תובענה ייצוגית וצו מניעה בכפוף לדין) לאחר פנייה מוקדמת בכתב עם אסמכתאות ל-<span dir="ltr" className="font-mono">kolot-music@googlegroups.com</span> והמתנה 7–14 ימי עסקים. דין מדינת ישראל חל בלעדית, סמכות בלעדית בתל-אביב-יפו, התיישנות 12 חודשים, הפרדת סעיפים חלה והנוסח העברי קובע.
          </p>
          <p>
            8. <strong>היעדר סינון גיל, הסרה מיידית, הודעה והסרה והמחאת זכויות:</strong> האתר אינו כולל סינון גיל ומופעל באחריות הורים לקטינים. שירים שהוסרו אינם זמינים במועדפים/קישורים וההנהלה אינה שולטת במטמון תצוגה מקדימה ברשתות. האתר פטור מחובת ניטור כללית (פניות הסרה מחייבות זיהוי מדויק), רשאי להמחות זכויות בהעברת בעלות, ואי-אכיפה אינה ויתור.
          </p>
          <p>
            9. <strong>כרטיסים להופעות, אלבומים (iOS/Safari), פרופילי אמנים ומצעדים:</strong> פרטי מופעים וקישורים לאתרי הזמנות מוזנים באחריות האמן בלבד; האתר אינו צד לעסקה ואינו אחראי לביטולים או החזרים לפי חוק הגנת הצרכן. עריכת שם/תמונה ושחזור נתוני Google אסורים להתחזות. ניגון אלבומים רצוף במכשירים (לרבות iOS/Safari) וסיווגי ז׳אנר/דירוגי "השירים המובילים" אינם מובטחים ואינם יוצרים זכאות.
          </p>
          <p>
            10. <strong>מטמון "אין אינטרנט", רענון 48 שעות, סודיות דיווחים וקניין רוחני:</strong> הדפדפן עשוי לשמור מסך "אין אינטרנט" מקומי במטמון וליזום רענון אוטומטי בלשוניות פתוחות מעל 48 שעות. דיווחים מועברים בתיבה פרטית למנהל ולקבוצת הניהול בלבד מבלי לחשוף לציבור ומבלי לשלוח עותק למדווח (בחשבון מחובר נמסרים שם, אימייל ותמונת פרופיל למנהל). הממשק, הקוד והסימנים המסחריים שייכים לבעלי האתר (למעט קוד פתוח ברישיונו), לוגים עשויים להישמר להגנה משפטית, והודעות באתר או בדוא"ל מחייבות מרגע פרסומן או משלוחן.
          </p>
        </div>

        <div className="space-y-4 text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-6">
          <h3 className="font-bold text-sm text-slate-900">{isHe ? 'תשתיות ושירותי צד שלישי בשימוש הפלטפורמה:' : 'Infrastructure & Third-Party Services:'}</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Google OAuth & Google Analytics / GTM</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Cloudflare Workers & R2 Cloud Storage</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Gemini AI & In-Browser Whisper / ONNX WASM</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● External Media Streams & Web Cache API</li>
          </ul>
        </div>

        <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <Mail className="w-4 h-4 text-indigo-600" />
            <span>פניות, דיווחי זכויות ונגישות (Google Groups): <b dir="ltr">kolot-music@googlegroups.com</b></span>
          </div>

          <span className="text-[11px] font-mono text-slate-400">Kolot Music Legal v5</span>
        </div>
      </div>
    </div>
  );
};
