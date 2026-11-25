import React, { useState, useEffect } from 'react';
import {
  Download,
  Smartphone,
  Laptop,
  CheckCircle2,
  HardDrive,
  Database,
  Sparkles,
  Bot,
  FileCode,
  ShieldCheck,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { Language } from '../types';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface AppDownloadViewProps {
  lang: Language;
}

export const AppDownloadView: React.FC<AppDownloadViewProps> = ({ lang }) => {
  const isHe = lang === 'he';

  const { isInstallable, isInstalled, isStandaloneMode, install, getAppLaunchUrl } = usePWAInstall();
  const [exportingBundle, setExportingBundle] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const handleInstallPWA = async () => {
    if (isInstallable) {
      await install();
      return;
    }
  };

  const handleDownloadStandaloneBot = () => {
    setExportingBundle(true);

    const standaloneHtmlContent = `<!DOCTYPE html>
<html lang="${isHe ? 'he' : 'en'}" dir="${isHe ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WikiArchive Standalone Offline Bot</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 font-sans p-4">
  <div class="max-w-3xl mx-auto space-y-4">
    <header class="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
      <h1 className="text-lg font-bold text-indigo-400">🤖 WikiArchive Standalone Bot</h1>
      <span class="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-1 rounded">Offline Client RAG Engine</span>
    </header>

    <div id="chat-box" class="h-96 bg-slate-900 border border-slate-800 rounded-2xl p-4 overflow-y-auto space-y-3">
      <div class="bg-indigo-950/60 p-3 rounded-xl border border-indigo-500/30 text-xs">
        ${
          isHe
            ? 'שלום! זהו הבוט הפנימי העצמאי של WikiArchive. הבוט עובד ישירות מול Wikipedia ו-Internet Archive ללא תלות בשרת!'
            : 'Hello! This is the standalone offline WikiArchive Bot running purely on your device.'
        }
      </div>
    </div>

    <form id="bot-form" class="flex gap-2">
      <input type="text" id="bot-input" placeholder="${
        isHe ? 'שאל משהו על היסטוריה, מדע או סרטוני ארכיון...' : 'Search any topic...'
      }" class="flex-1 px-4 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm focus:outline-none">
      <button type="submit" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl">
        ${isHe ? 'שלח' : 'Send'}
      </button>
    </form>
  </div>

  <script>
    const form = document.getElementById('bot-form');
    const input = document.getElementById('bot-input');
    const chat = document.getElementById('chat-box');

    function appendMessageBubble(className, text) {
      const div = document.createElement('div');
      div.className = className;
      div.textContent = text;
      chat.appendChild(div);
      chat.scrollTop = chat.scrollHeight;
      return div;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const query = input.value.trim();
      if (!query) return;

      appendMessageBubble('bg-purple-900/40 p-2.5 rounded-xl border border-purple-500/30 text-xs text-right', query);
      input.value = '';

      appendMessageBubble('bg-slate-800 p-2.5 rounded-xl text-xs text-indigo-300', '🔍 מחפש ב-Wikipedia ו-Internet Archive...');

      try {
        const wikiRes = await fetch(\`https://he.wikipedia.org/w/api.php?action=query&list=search&srsearch=\${encodeURIComponent(query)}&format=json&origin=*\`);
        const wikiData = await wikiRes.json();
        const firstWiki = wikiData.query?.search?.[0];

        const iaRes = await fetch(\`https://archive.org/advancedsearch.php?q=\${encodeURIComponent(query)}&fl[]=identifier,title,mediatype&rows=3&output=json\`);
        const iaData = await iaRes.json();
        const iaDocs = iaData.response?.docs || [];

        const card = document.createElement('div');
        card.className = 'bg-slate-900 p-3 rounded-xl border border-indigo-500/30 space-y-2 text-xs';

        const heading = document.createElement('p');
        heading.className = 'font-bold text-white';
        heading.textContent = \`🧠 תשובת הבוט הפנימי עבור: "\${query}"\`;
        card.appendChild(heading);

        if (firstWiki && typeof firstWiki.snippet === 'string') {
          const parsedDoc = new DOMParser().parseFromString(firstWiki.snippet, 'text/html');
          const cleanSnippet = (parsedDoc.body.textContent || '').trim();
          const wikiP = document.createElement('p');
          wikiP.className = 'text-slate-300';
          const boldLabel = document.createElement('b');
          boldLabel.textContent = '📖 Wikipedia: ';
          wikiP.appendChild(boldLabel);
          wikiP.appendChild(document.createTextNode(cleanSnippet));
          card.appendChild(wikiP);
        }

        if (iaDocs.length > 0) {
          const iaLabel = document.createElement('p');
          iaLabel.className = 'font-bold text-amber-300 mt-2';
          iaLabel.textContent = '🎥 מציאות בארכיון:';
          card.appendChild(iaLabel);

          const ul = document.createElement('ul');
          ul.className = 'list-disc pl-4 text-slate-400';
          iaDocs.forEach((d) => {
            const safeId = String(d.identifier || '').replace(/[^a-zA-Z0-9._-]/g, '');
            const li = document.createElement('li');
            li.appendChild(document.createTextNode(\`\${String(d.title || '')} (\${String(d.mediatype || '')}) - \`));
            if (safeId) {
              const a = document.createElement('a');
              a.href = \`https://archive.org/details/\${encodeURIComponent(safeId)}\`;
              a.target = '_blank';
              a.rel = 'noopener noreferrer';
              a.className = 'text-indigo-400 underline';
              a.textContent = 'Archive.org';
              li.appendChild(a);
            }
            ul.appendChild(li);
          });
          card.appendChild(ul);
        }

        chat.appendChild(card);
        chat.scrollTop = chat.scrollHeight;
      } catch (err) {
        appendMessageBubble('text-red-400 text-xs', 'שגיאה בתקשורת מול APIs.');
      }
    });
  </script>
</body>
</html>`;

    const blob = new Blob([standaloneHtmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `WikiArchive_Bot_Client_${Date.now()}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      setExportingBundle(false);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 4000);
    }, 800);
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-8">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-purple-950 border border-slate-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-mono mb-3">
            <Download className="w-3.5 h-3.5" />
            <span>DOWNLOADABLE CLIENT BOT & PWA</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {isHe ? 'הורדת האפליקציה והבוט הפנימי למכשיר' : 'Install PWA & Download Local Client Bot'}
          </h1>
          <p className="text-slate-300 text-sm mt-2 leading-relaxed">
            {isHe
              ? 'אתה יכול להתקין את האפליקציה בטלפון/מחשב כ-PWA, או להוריד את קובץ הבוט הפנימי העצמאי לקובץ HTML שרץ ישירות במכשיר שלך ללא צורך בשרתים!'
              : 'Install this application to your device as a PWA, or download the standalone offline client bot bundle to run locally with zero server dependency.'}
          </p>
        </div>
      </div>

      {/* Grid Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Option 1: PWA Installation */}
        <div className="bg-slate-900 border border-slate-800 hover:border-indigo-500/50 rounded-3xl p-6 shadow-xl flex flex-col justify-between transition-all">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center mb-4">
              <Smartphone className="w-6 h-6" />
            </div>

            <h2 className="text-lg font-bold text-white mb-2">
              {isHe ? '1. התקנת אפליקציה ניידת (PWA)' : '1. Progressive Web App (PWA)'}
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              {isHe
                ? 'התקן את WikiArchive כאפליקציה מלאה במסך הבית של ה-Android, iPhone או המחשב שלך.'
                : 'Install WikiArchive directly to your mobile home screen or computer application dock.'}
            </p>

            <div className="space-y-2 text-xs text-slate-400 bg-slate-950 p-4 rounded-2xl border border-slate-800/80 mb-6">
              <div className="flex items-center gap-2 text-slate-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{isHe ? 'תמיכה מלאה במסך מגע ומצב רוחב' : 'Touchscreen and native offline shell'}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>{isHe ? 'גישה מהירה בלחיצה אחת מלוח האפליקציות' : 'One-click home screen launcher'}</span>
              </div>
            </div>
          </div>

          {isStandaloneMode ? (
            <div className="w-full py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg bg-emerald-600 text-white">
              <ShieldCheck className="w-4 h-4" />
              <span>{isHe ? 'האפליקציה פתוחה ומותקנת במכשיר!' : 'App Installed & Running!'}</span>
            </div>
          ) : isInstalled ? (
            <a
              href={getAppLaunchUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg bg-white text-black hover:bg-neutral-200 transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              <span>{isHe ? 'פתח באפליקציה' : 'Open in App'}</span>
            </a>
          ) : (
            <button
              onClick={handleInstallPWA}
              className="w-full py-3 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg transition-all bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30"
            >
              <Download className="w-4 h-4" />
              <span>{isHe ? 'התקן אפליקציה כעת' : 'Install PWA Now'}</span>
            </button>
          )}
        </div>

        {/* Option 2: Standalone Local Bot Bundle Download */}
        <div className="bg-slate-900 border border-slate-800 hover:border-purple-500/50 rounded-3xl p-6 shadow-xl flex flex-col justify-between transition-all">
          <div>
            <div className="w-12 h-12 rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center mb-4">
              <Bot className="w-6 h-6" />
            </div>

            <h2 className="text-lg font-bold text-white mb-2">
              {isHe ? '2. הורדת הבוט הפנימי לקובץ HTML עצמאי' : '2. Download Standalone Offline Bot'}
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              {isHe
                ? 'הורד קובץ בוט פנימי יחיד (Single-File App) המכיל את מנוע ה-RAG והחיבור הישיר ל-Wikipedia ו-Internet Archive. הקובץ רץ בכל דפדפן ללא צורך בשרת!'
                : 'Download a completely self-contained offline HTML bot application file that runs locally on any browser.'}
            </p>

            <div className="space-y-2 text-xs text-slate-400 bg-slate-950 p-4 rounded-2xl border border-slate-800/80 mb-6">
              <div className="flex items-center gap-2 text-slate-200">
                <Zap className="w-4 h-4 text-purple-400" />
                <span>{isHe ? 'ללא צורך בשרת (Zero Server Backend Required)' : 'Zero server dependency'}</span>
              </div>
              <div className="flex items-center gap-2 text-slate-200">
                <FileCode className="w-4 h-4 text-purple-400" />
                <span>{isHe ? 'מחובר ישירות ל-Wikipedia API ו-Archive.org' : 'Direct API proxy to Wikipedia & Archive'}</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleDownloadStandaloneBot}
            disabled={exportingBundle}
            className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30 transition-all"
          >
            {exportingBundle ? (
              <Sparkles className="w-4 h-4 animate-spin" />
            ) : downloadSuccess ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                <span>{isHe ? 'הבוט יורד למכשיר שלך!' : 'Downloaded Successfully!'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>{isHe ? 'הורד קובץ בוט עצמאי (HTML)' : 'Download Standalone Bot (.html)'}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
