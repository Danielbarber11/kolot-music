import React, { useState } from 'react';
import { X, ExternalLink, Download, Film, Volume2, BookOpen, Share2, Check } from 'lucide-react';
import { ArchiveItem, Language } from '../types';

interface MediaPlayerModalProps {
  item: ArchiveItem | null;
  onClose: () => void;
  lang: Language;
}

export const MediaPlayerModal: React.FC<MediaPlayerModalProps> = ({ item, onClose, lang }) => {
  if (!item) return null;
  const isHe = lang === 'he';

  const [copied, setCopied] = useState(false);

  const isVideo = item.mediaType === 'movies';
  const isAudio = item.mediaType === 'audio';

  const handleCopyLink = () => {
    navigator.clipboard.writeText(item.itemUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2 space-x-reverse min-w-0">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0">
              {isVideo ? <Film className="w-4 h-4" /> : isAudio ? <Volume2 className="w-4 h-4" /> : <BookOpen className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-sm text-white truncate">{item.title}</h3>
              <p className="text-[11px] text-slate-400">{item.year ? `שנת ${item.year}` : item.creator || 'Internet Archive'}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Player Body Container */}
        <div className="flex-1 bg-black overflow-hidden relative min-h-[320px] flex items-center justify-center">
          {item.embedUrl ? (
            <iframe
              src={item.embedUrl}
              title={item.title}
              className="w-full h-full min-h-[380px] border-0"
              allowFullScreen
            />
          ) : (
            <div className="p-8 text-center">
              <p className="text-slate-400 text-xs mb-3">{isHe ? 'אין אפשרות לנגן הטמעה ישירה' : 'Direct embed player not supported'}</p>
              <a
                href={item.itemUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold inline-flex items-center gap-2"
              >
                <span>{isHe ? 'צפה ב-Internet Archive' : 'Open on Archive.org'}</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2 space-x-reverse">
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Share2 className="w-4 h-4" />}
              <span>{copied ? (isHe ? 'הועתק!' : 'Copied') : (isHe ? 'שתף קישור' : 'Share Link')}</span>
            </button>

            <a
              href={item.itemUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-all"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Archive.org</span>
            </a>
          </div>

          <span className="text-[10px] text-slate-500 font-mono">
            {item.identifier}
          </span>
        </div>
      </div>
    </div>
  );
};
