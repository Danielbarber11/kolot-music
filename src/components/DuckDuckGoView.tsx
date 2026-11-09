import React, { useState } from 'react';
import { Search, Globe, ExternalLink } from 'lucide-react';
import { DuckDuckGoResponse, searchDuckDuckGoWeb } from '../services/duckduckgoService';
import { Language } from '../types';

interface DuckDuckGoViewProps {
  lang: Language;
}

export const DuckDuckGoView: React.FC<DuckDuckGoViewProps> = ({ lang }) => {
  const isHe = lang === 'he';

  const [query, setQuery] = useState('DuckDuckGo');
  const [result, setResult] = useState<DuckDuckGoResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await searchDuckDuckGoWeb(query);
      setResult(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-amber-50 via-white to-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-amber-100 text-amber-800 font-extrabold text-xs mb-3 border border-amber-200">
          <Globe className="w-3.5 h-3.5" />
          <span>DUCKDUCKGO INSTANT ANSWER API</span>
        </div>

        <h1 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
          {isHe ? 'חיפוש תשובות ברשת עם DuckDuckGo' : 'DuckDuckGo Instant Answer Search'}
        </h1>
        <p className="text-slate-600 text-xs sm:text-sm mt-2 max-w-xl leading-relaxed font-normal">
          {isHe
            ? 'קבל תשובות אינסטנט מנוהלות, תקצירים מורחבים ונושאים קשורים ישירות מ-DuckDuckGo Search API.'
            : 'Get instant Web answers, abstracts, and topic links directly from DuckDuckGo.'}
        </p>

        {/* Search Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
          className="relative max-w-xl mt-6 flex items-center"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isHe ? 'חפש כל דבר ברשת עם DuckDuckGo...' : 'Search DuckDuckGo...'}
            className="w-full pr-12 pl-12 py-3.5 bg-white border border-slate-300 focus:border-amber-500 rounded-2xl text-slate-900 text-sm font-medium focus:outline-none shadow-sm"
          />
          <Search className="w-5 h-5 text-amber-600 absolute right-4 top-1/2 -translate-y-1/2" />
          <button
            type="submit"
            className="absolute left-2 top-1/2 -translate-y-1/2 px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-extrabold shadow"
          >
            {isHe ? 'חפש' : 'Search'}
          </button>
        </form>
      </div>

      {/* Search Output */}
      {loading ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-8 animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded-xl w-1/3" />
          <div className="h-20 bg-slate-200 rounded-xl w-full" />
        </div>
      ) : result ? (
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                {result.source}
              </span>
              <h2 className="text-2xl font-black text-slate-900 mt-2">{result.heading}</h2>
            </div>

            {result.abstractUrl && (
              <a
                href={result.abstractUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold flex items-center gap-1.5"
              >
                <span>{isHe ? 'פתיחה במקור' : 'Open Source'}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          <p className="text-slate-700 text-sm leading-relaxed">{result.abstract || (isHe ? 'אין תקציר זמין עבור מונח זה' : 'No abstract available')}</p>

          {result.webResults && result.webResults.length > 0 && (
            <div className="pt-4 border-t border-slate-100 space-y-3">
              <h3 className="font-bold text-xs text-slate-900">{isHe ? 'תוצאות אתרים ברשת:' : 'Web Search Results:'}</h3>
              <div className="space-y-2">
                {result.webResults.map((site, idx) => (
                  <div key={idx} className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs text-slate-700 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-mono text-indigo-700 font-bold block">{site.displayUrl}</span>
                      <h4 className="font-bold text-slate-900 text-xs mt-0.5">{site.title}</h4>
                      <p className="text-slate-600 text-[11px] mt-0.5">{site.snippet}</p>
                    </div>

                    <a
                      href={site.url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow flex-shrink-0"
                    >
                      <span>כניסה</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};
