import React, { useState, useEffect } from 'react';
import { ShieldAlert, Globe } from 'lucide-react';

interface SecurityGuardProps {
  children: React.ReactNode;
}

export const SecurityGuard: React.FC<SecurityGuardProps> = ({ children }) => {
  const [isGeoBlocked, setIsGeoBlocked] = useState(false);
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);
  const [isCheckingGeo, setIsCheckingGeo] = useState(true);

  // 1. GEO-LOCATION CHECK (ISRAEL ONLY)
  useEffect(() => {
    const checkGeoLocation = async () => {
      try {
        // Fast Timezone & Browser Locale Check
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        const userLangs = navigator.languages || [navigator.language || ''];
        const isHebrewLocale = userLangs.some(
          (l) => l.toLowerCase().includes('he') || l.toLowerCase().includes('il')
        );

        // If in Israel timezone (Asia/Jerusalem) or Hebrew locale, grant instant access
        if (timezone === 'Asia/Jerusalem' || isHebrewLocale) {
          setIsGeoBlocked(false);
          setIsCheckingGeo(false);
          return;
        }

        // IP-based Geo verification
        const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          if (data && data.country_code && data.country_code !== 'IL') {
            setIsGeoBlocked(true);
          } else {
            setIsGeoBlocked(false);
          }
        } else {
          // Fallback to secondary IP check
          const res2 = await fetch('https://ip-api.com/json/?fields=countryCode', {
            signal: AbortSignal.timeout(3000),
          });
          if (res2.ok) {
            const data2 = await res2.json();
            if (data2 && data2.countryCode && data2.countryCode !== 'IL') {
              setIsGeoBlocked(true);
            }
          }
        }
      } catch (err) {
        // On network timeout or local dev environment, allow access if Hebrew/Jerusalem
        console.warn('Geo check fallback:', err);
      } finally {
        setIsCheckingGeo(false);
      }
    };

    checkGeoLocation();
  }, []);

  // 2. DEVTOOLS PROTECTION & ANTI-TAMPERING GUARD (BLOCK INPECT & DEV SHORTCUTS WITHOUT FALSE POSITIVES)
  useEffect(() => {
    // A. Disable Context Menu (Right Click Inspect)
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };

    // B. Block Explicit Key Shortcuts for DevTools (F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Ctrl+U, Cmd+Opt+I)
    const handleKeyDown = (e: KeyboardEvent) => {
      const isF12 = e.keyCode === 123 || e.key === 'F12';
      const isCtrlShiftI = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.keyCode === 73);
      const isCtrlShiftJ = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'J' || e.key === 'j' || e.keyCode === 74);
      const isCtrlShiftC = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.keyCode === 67);
      const isCtrlU = (e.ctrlKey || e.metaKey) && (e.key === 'U' || e.key === 'u' || e.keyCode === 85);

      if (isF12 || isCtrlShiftI || isCtrlShiftJ || isCtrlShiftC || isCtrlU) {
        e.preventDefault();
        e.stopPropagation();
        setIsDevToolsOpen(true);
        return false;
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // DEVTOOLS BLOCKED SCREEN
  if (isDevToolsOpen) {
    return (
      <div className="fixed inset-0 z-[999999] bg-black flex flex-col items-center justify-center p-6 text-center text-white font-sans select-none">
        <div className="w-20 h-20 rounded-full bg-red-600/20 border border-red-500/40 flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(220,38,38,0.3)] animate-pulse">
          <ShieldAlert className="w-10 h-10 text-red-500" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-red-500 tracking-tight mb-3">
          שגיאת אבטחה: כלים למפתחים נחסמו
        </h1>

        <div className="max-w-md space-y-3 bg-red-950/30 border border-red-500/20 p-5 rounded-2xl backdrop-blur-xl">
          <p className="text-sm font-bold text-gray-200 leading-relaxed">
            מנגנון האבטחה זיהה ניסיון פתיחה של כלים למפתחים (DevTools) או מקשי קיצור לחשיפת קוד.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            כדי להגן על שרתי המערכת, מפתחות הגישה וזכויות המוזיקה של האמנים בפלטפורמה, הגישה לתוכן נחסמה.
          </p>
        </div>

        <button
          onClick={() => setIsDevToolsOpen(false)}
          className="mt-6 px-6 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 transition-all cursor-pointer"
        >
          חזור לגלישה באתר
        </button>

        <p className="text-[11px] text-gray-500 mt-4 font-mono">
          Security System Active • Press button to resume
        </p>
      </div>
    );
  }

  // GEO BLOCKED SCREEN (ISRAEL ONLY)
  if (isGeoBlocked && !isCheckingGeo) {
    return (
      <div className="fixed inset-0 z-[999999] bg-black flex flex-col items-center justify-center p-6 text-center text-white font-sans select-none">
        <div className="w-20 h-20 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(245,158,11,0.2)]">
          <Globe className="w-10 h-10 text-amber-400" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mb-3">
          לא זמין במדינתך
        </h1>

        <div className="max-w-md space-y-3 bg-white/5 border border-white/10 p-5 rounded-2xl backdrop-blur-xl">
          <p className="text-sm font-bold text-amber-200 leading-relaxed">
            השירות זמין לתושבי מדינת ישראל בלבד.
          </p>
          <p className="text-xs text-gray-400 leading-relaxed">
            הגישה לפלטפורמת המוזיקה מוגבלת גאוגרפית עקב זכויות יוצרים ורישויי סטרימינג אזוריים.
          </p>
        </div>

        <p className="text-[11px] text-gray-500 mt-6 font-mono">
          Service Restricted to Israel Region (IL)
        </p>
      </div>
    );
  }

  return <>{children}</>;
};
