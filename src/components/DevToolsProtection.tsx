import React, { useEffect, useState } from 'react';
import { Lock, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Check if running in AI Studio preview or local dev environment
const isPreviewEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  const host = (window.location.hostname || '').toLowerCase();
  const href = (window.location.href || '').toLowerCase();
  return (
    host.includes('ais-dev') ||
    host.includes('ais-pre') ||
    host.includes('run.app') ||
    host.includes('localhost') ||
    host.includes('127.0.0.1') ||
    href.includes('aistudio') ||
    href.includes('google')
  );
};

const isMobileOrStandalonePWA = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const ua = (navigator.userAgent || '').toLowerCase();
    const isTouchDevice =
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches ||
      /android|iphone|ipad|ipod|mobile|tablet/.test(ua);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    return isTouchDevice || isStandalone;
  } catch {
    return false;
  }
};

export const DevToolsProtection: React.FC = () => {
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);
  const isPreview = isPreviewEnvironment();
  const skipDimensionCheck = isPreview || isMobileOrStandalonePWA();

  useEffect(() => {
    // If in preview or mobile/tablet/standalone PWA, never run outer/inner window size heuristics
    if (skipDimensionCheck) {
      setIsDevToolsOpen(false);
      return;
    }

    const checkDevTools = () => {
      if (document.visibilityState !== 'visible') {
        setIsDevToolsOpen(false);
        return;
      }
      const widthThreshold = window.outerWidth - window.innerWidth > 220;
      const heightThreshold = window.outerHeight - window.innerHeight > 220;

      if (widthThreshold || heightThreshold) {
        setIsDevToolsOpen(true);
      } else {
        setIsDevToolsOpen(false);
      }
    };

    // Keyboard shortcuts prevention for DevTools in desktop production
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        setIsDevToolsOpen(true);
        return false;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')
      ) {
        e.preventDefault();
        setIsDevToolsOpen(true);
        return false;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        setIsDevToolsOpen(true);
        return false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        setIsDevToolsOpen(false);
      }
    };

    const interval = setInterval(checkDevTools, 700);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [skipDimensionCheck]);

  // Completely inactive in AI Studio preview, mobile devices, and standalone PWA
  if (skipDimensionCheck || !isDevToolsOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[999999] bg-black text-white flex flex-col items-center justify-center p-6 text-center select-none"
        dir="rtl"
      >
        <div className="max-w-md w-full bg-[#080808] border border-red-500/40 rounded-3xl p-8 shadow-[0_0_90px_rgba(239,68,68,0.25)] space-y-6 flex flex-col items-center">
          <div className="w-20 h-20 rounded-3xl bg-red-500/10 border border-red-500/40 flex items-center justify-center text-red-500 shadow-2xl">
            <Lock className="w-10 h-10 text-red-400 animate-pulse" />
          </div>

          <div className="space-y-3">
            <span className="px-3 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/40 text-xs font-black uppercase tracking-wider inline-block">
              אבטחת Kolot Music
            </span>
            <h1 className="text-2xl font-black text-white tracking-tight">
              כלי מפתחים חסומים לגישה
            </h1>
            <p className="text-xs text-neutral-400 font-medium leading-relaxed">
              פלטפורמת Kolot Music מגינה על מפתחות המערכת, זכויות היוצרים ונתוני האמנים. כלי המפתחים (DevTools) זוהו כפתוחים בדפדפן. אנא סגור אותם כדי להמשיך להשתמש באתר.
            </p>
          </div>

          <div className="p-3 rounded-2xl bg-white/5 border border-white/10 text-white/70 text-[11px] font-bold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
            <span>סגירת כלי המפתחים בדפדפן תעליים מסך זה באופן אוטומטי</span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
