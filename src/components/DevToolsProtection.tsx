import React, { useEffect, useState } from 'react';
import { Lock, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const DevToolsProtection: React.FC = () => {
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);

  useEffect(() => {
    const checkDevTools = () => {
      const widthThreshold = window.outerWidth - window.innerWidth > 160;
      const heightThreshold = window.outerHeight - window.innerHeight > 160;

      if (widthThreshold || heightThreshold) {
        setIsDevToolsOpen(true);
      } else {
        setIsDevToolsOpen(false);
      }
    };

    // Keyboard shortcuts prevention for DevTools
    const handleKeyDown = (e: KeyboardEvent) => {
      // F12 key
      if (e.key === 'F12' || e.keyCode === 123) {
        e.preventDefault();
        setIsDevToolsOpen(true);
        return false;
      }
      // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C, Cmd+Option+I, Cmd+Option+J, Cmd+Option+C
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')
      ) {
        e.preventDefault();
        setIsDevToolsOpen(true);
        return false;
      }
      // Ctrl+U / Cmd+U (View source)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        setIsDevToolsOpen(true);
        return false;
      }
    };

    const interval = setInterval(checkDevTools, 800);
    window.addEventListener('resize', checkDevTools);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', checkDevTools);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!isDevToolsOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[99999] bg-black text-white flex flex-col items-center justify-center p-6 text-center select-none"
        dir="rtl"
      >
        <div className="max-w-md w-full bg-[#0a0a0a] border border-red-500/30 rounded-3xl p-8 shadow-[0_0_80px_rgba(239,68,68,0.2)] space-y-6 flex flex-col items-center">
          <div className="w-20 h-20 rounded-3xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-500 shadow-2xl">
            <Lock className="w-10 h-10 text-red-400 animate-pulse" />
          </div>

          <div className="space-y-3">
            <span className="px-3 py-1 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 text-xs font-bold uppercase tracking-wider inline-block">
              אבטחת Kolot Music
            </span>
            <h1 className="text-2xl font-black text-white tracking-tight">
              כלי מפתחים חסומים לגישה
            </h1>
            <p className="text-xs text-neutral-400 font-medium leading-relaxed">
              הפלטפורמה מגינה על מפתחות המערכת, זכויות היוצרים ונתוני האמנים. כלי המפתחים (DevTools) זוהו כפתוחים בדפדפן. אנא סגור אותם כדי להמשיך.
            </p>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="w-full py-3.5 rounded-2xl bg-white hover:bg-neutral-200 text-black font-black text-xs transition-all shadow-xl cursor-pointer flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4 text-black" />
            <span>סגור כלי מפתחים ורענן את העמוד</span>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
