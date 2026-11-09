import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Play, Pause, Square, Gauge, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ttsService, TTSState } from '../services/ttsService';

interface AudioTTSPlayerProps {
  text: string;
  label?: string;
  lang?: string;
  className?: string;
  variant?: 'compact' | 'bar' | 'floating';
}

export const AudioTTSPlayer: React.FC<AudioTTSPlayerProps> = ({
  text,
  label = 'האזן בקול',
  lang,
  className = '',
  variant = 'compact',
}) => {
  const [ttsState, setTtsState] = useState<TTSState>(ttsService.getState());
  const [rate, setRate] = useState<number>(1.0);

  useEffect(() => {
    const unsubscribe = ttsService.subscribe((state) => {
      setTtsState(state);
    });
    return unsubscribe;
  }, []);

  const isCurrentText = ttsState.currentText === ttsService.cleanTextForSpeech(text);
  const isPlayingThis = ttsState.isPlaying && isCurrentText;
  const isPausedThis = ttsState.isPaused && isCurrentText;

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlayingThis) {
      ttsService.pause();
    } else if (isPausedThis) {
      ttsService.resume();
    } else {
      ttsService.speak(text, { lang, rate });
    }
  };

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
    ttsService.stop();
  };

  const toggleRate = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextRate = rate === 1.0 ? 1.25 : rate === 1.25 ? 0.85 : 1.0;
    setRate(nextRate);
    ttsService.setRate(nextRate);
  };

  if (variant === 'bar') {
    return (
      <div
        className={`flex items-center justify-between p-3 rounded-2xl bg-indigo-950/80 border border-indigo-500/30 text-white shadow-lg backdrop-blur-md ${className}`}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-600/60 border border-indigo-400/40 flex items-center justify-center">
            {isPlayingThis ? (
              <div className="flex items-end gap-0.5 h-4">
                <span className="w-1 bg-white animate-[bounce_0.8s_infinite_100ms] h-full rounded-full" />
                <span className="w-1 bg-white animate-[bounce_0.8s_infinite_200ms] h-3/4 rounded-full" />
                <span className="w-1 bg-white animate-[bounce_0.8s_infinite_300ms] h-full rounded-full" />
              </div>
            ) : (
              <Volume2 className="w-4 h-4 text-indigo-300" />
            )}
          </div>
          <div>
            <div className="text-xs font-black flex items-center gap-1.5">
              <span>{label}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 font-mono">
                Web Speech TTS
              </span>
            </div>
            <p className="text-[10px] text-white/60 truncate max-w-[200px] sm:max-w-xs">
              {isPlayingThis ? 'מקריא כעת...' : 'לחץ להאזנה להוראות והמצרכים'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={toggleRate}
            className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[10px] font-mono font-bold transition-all"
            title="מהירות הקראה"
          >
            {rate}x
          </button>

          <button
            onClick={handleTogglePlay}
            className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold transition-all shadow active:scale-95 flex items-center gap-1"
          >
            {isPlayingThis ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            <span className="text-xs font-bold">{isPlayingThis ? 'השהה' : 'הפעל'}</span>
          </button>

          {(isPlayingThis || isPausedThis) && (
            <button
              onClick={handleStop}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all active:scale-95"
              title="עצור"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={handleTogglePlay}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm active:scale-95 ${
        isPlayingThis
          ? 'bg-indigo-600 text-white ring-2 ring-indigo-400 animate-pulse'
          : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-200'
      } ${className}`}
      title="הקרא בקול"
    >
      {isPlayingThis ? (
        <>
          <div className="flex items-end gap-0.5 h-3 mr-0.5">
            <span className="w-0.5 bg-white animate-[bounce_0.6s_infinite_100ms] h-full rounded-full" />
            <span className="w-0.5 bg-white animate-[bounce_0.6s_infinite_200ms] h-2/3 rounded-full" />
            <span className="w-0.5 bg-white animate-[bounce_0.6s_infinite_300ms] h-full rounded-full" />
          </div>
          <span>השהה הקראה</span>
        </>
      ) : (
        <>
          <Volume2 className="w-3.5 h-3.5 text-indigo-600" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
};
