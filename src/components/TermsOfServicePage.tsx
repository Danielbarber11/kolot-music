import React from 'react';
import { ShieldCheck, Mail, ExternalLink, Globe, Info } from 'lucide-react';
import { Language } from '../types';

interface TermsOfServicePageProps {
  lang: Language;
}

export const TermsOfServicePage: React.FC<TermsOfServicePageProps> = ({ lang }) => {
  const isHe = lang === 'he';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-12 shadow-sm space-y-6">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 text-slate-800 text-xs font-extrabold border border-slate-200">
          <ShieldCheck className="w-4 h-4 text-indigo-600" />
          <span>TERMS OF SERVICE & LEGAL DISCLAIMER</span>
        </div>

        <h1 className="text-3xl font-black text-slate-900 tracking-tight">
          {isHe ? 'תנאי שימוש והצהרה משפטית' : 'Terms of Service & Legal Notice'}
        </h1>

        {/* Exact Legal Disclaimer requested in Prompt */}
        <div className="bg-indigo-50/80 border border-indigo-200 p-6 rounded-2xl text-slate-900 text-sm leading-relaxed font-medium space-y-3">
          <p className="font-bold text-base text-indigo-950">
            📌 הצהרת אחריות ומאגרי מידע פתוחים:
          </p>
          <p>
            "האתר אינו מאחסן קבצים או תוכן בשרתיו. המידע, המדיה, השירים, הסרטונים והמשחקים מוצגים בזמן אמת מ-APIs ציבוריים וחינמיים (Wikipedia, Internet Archive, SoundCloud, Audius, DuckDuckGo וכדומה)."
          </p>
          <p>
            "האתר משמש כממשק תצוגה מונגש ומסודר בלבד. בכל פנייה לגבי הפרת זכויות יוצרים או תקלה, יש לפנות לבעלי המאגר המקורי. להסרת הצגת תוכן מסוים מהממשק, ניתן ליצור קשר במייל."
          </p>
        </div>

        <div className="space-y-4 text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-6">
          <h3 className="font-bold text-sm text-slate-900">{isHe ? 'רשימת ה-APIs הציבוריים שבשימוש האתר:' : 'Public APIs Integrated:'}</h3>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Wikipedia & Wikidata Public API</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Internet Archive & LMA API</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● DuckDuckGo Instant Answer API</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Audius Open Music API</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Jamendo CC Music API</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Radio Browser API</li>
            <li className="p-3 bg-slate-50 border border-slate-200 rounded-xl">● Project Gutenberg & OpenLibrary</li>
          </ul>
        </div>

        <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <Mail className="w-4 h-4 text-indigo-600" />
            <span>פניות בנושאי תוכן וזכויות: <b>contact@wikiarchive-open.org</b></span>
          </div>

          <span className="text-[11px] font-mono text-slate-400">Cloud-Native Architecture (R2 Ready)</span>
        </div>
      </div>
    </div>
  );
};
