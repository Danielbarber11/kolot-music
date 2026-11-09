import React from 'react';
import { motion } from 'motion/react';
import { Logo } from './Logo';

interface SplashScreenProps {
  isLoading: boolean;
  onFinish?: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ isLoading }) => {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: isLoading ? 1 : 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
      onAnimationComplete={() => {
        if (!isLoading && window.document.getElementById('splash-screen')) {
          window.document.getElementById('splash-screen')?.remove();
        }
      }}
      className="fixed inset-0 z-[9999] bg-black flex flex-col items-center justify-center overflow-hidden"
      id="splash-screen"
    >
      {/* Dynamic Ambient Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-white/[0.03] rounded-full blur-[120px] pointer-events-none" />
      
      <div className="relative flex flex-col items-center space-y-8">
        {/* Animated Logo */}
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            duration: 1.2,
            ease: "easeOut",
          }}
          className="relative"
        >
          <Logo className="h-24 sm:h-32 w-auto filter drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]" heartOnly={true} />
          
          {/* Pulsating Ring */}
          <motion.div
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.1, 0.3, 0.1],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute inset-0 rounded-full border border-white/20 -m-4 pointer-events-none"
          />
        </motion.div>

        {/* Text Brand */}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="text-center space-y-2"
        >
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-[0.2em] uppercase select-none">
            KOLOT
          </h1>
          <p className="text-white/40 text-xs sm:text-sm font-medium tracking-[0.3em] uppercase select-none" dir="rtl">
            מוזיקה ללא גבולות
          </p>
        </motion.div>

        {/* Premium Loading Indicator */}
        <div className="w-48 h-[1px] bg-white/10 relative overflow-hidden rounded-full">
          <motion.div
            animate={{
              x: ['-100%', '100%'],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent"
          />
        </div>
      </div>

      {/* Version Tag */}
      <div className="absolute bottom-10 text-[10px] text-white/20 font-mono tracking-widest uppercase">
        GitHub Storage Engine v4.0
      </div>
    </motion.div>
  );
};
