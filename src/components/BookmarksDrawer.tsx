import React from 'react';
import { X, Bookmark, Trash2, ExternalLink, Download } from 'lucide-react';
import { BookmarkItem, Language } from '../types';

interface BookmarksDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  bookmarks: BookmarkItem[];
  onRemoveBookmark: (id: string) => void;
  lang: Language;
}

export const BookmarksDrawer: React.FC<BookmarksDrawerProps> = ({
  isOpen,
  onClose,
  bookmarks,
  onRemoveBookmark,
  lang,
}) => {
  if (!isOpen) return null;
  const isHe = lang === 'he';

  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(bookmarks, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `WikiArchive_Bookmarks_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
          {/* Drawer Header */}
          <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center space-x-2 space-x-reverse">
              <Bookmark className="w-5 h-5 text-amber-400" />
              <h2 className="font-bold text-base text-white">
                {isHe ? 'פריטים שמורים וסימניות' : 'Saved Bookmarks'}
              </h2>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {bookmarks.length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <Bookmark className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-xs">{isHe ? 'אין פריטים שמורים עדיין' : 'No bookmarks saved yet'}</p>
              </div>
            ) : (
              bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  className="bg-slate-950 border border-slate-800 rounded-2xl p-3.5 hover:border-amber-500/40 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-amber-500/10 text-amber-300 rounded">
                        {bm.type}
                      </span>
                      <span className="text-[10px] text-slate-500">{bm.dateAdded}</span>
                    </div>

                    <h4 className="font-bold text-xs text-white line-clamp-2">{bm.title}</h4>
                    <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">{bm.summary}</p>
                  </div>

                  <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between">
                    {bm.url ? (
                      <a
                        href={bm.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
                      >
                        <span>{isHe ? 'פפתח מקור' : 'Open Source'}</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    ) : (
                      <span />
                    )}

                    <button
                      onClick={() => onRemoveBookmark(bm.id)}
                      className="p-1.5 rounded text-slate-500 hover:text-rose-400 transition-colors"
                      title={isHe ? 'מחק' : 'Delete'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Drawer Footer Export */}
          {bookmarks.length > 0 && (
            <div className="p-4 bg-slate-950 border-t border-slate-800">
              <button
                onClick={handleExportJSON}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-300 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border border-slate-700 shadow"
              >
                <Download className="w-4 h-4" />
                <span>{isHe ? 'ייצא סימניות בקובץ JSON' : 'Export Bookmarks JSON'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
