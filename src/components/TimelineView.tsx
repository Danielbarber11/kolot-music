import React, { useState } from 'react';
import { Clock, Film, BookOpen, Play, Sparkles } from 'lucide-react';
import { Language, ArchiveItem } from '../types';

interface TimelineViewProps {
  lang: Language;
  onPlayMedia: (item: ArchiveItem) => void;
  onAskBotAbout: (topic: string) => void;
}

interface TimelineEra {
  id: string;
  yearRange: string;
  titleHe: string;
  titleEn: string;
  descHe: string;
  descEn: string;
  archiveItems: ArchiveItem[];
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  lang,
  onPlayMedia,
  onAskBotAbout,
}) => {
  const isHe = lang === 'he';

  const eras: TimelineEra[] = [
    {
      id: 'era_1900',
      yearRange: '1900 - 1920',
      titleHe: 'ראשית הקולנוע והרדיו',
      titleEn: 'Birth of Cinema & Radio',
      descHe: 'סרטים אלמים ראשונים, קולנוע Georges Méliès והקלטות גרמופון ראשונות',
      descEn: 'Early silent films, Georges Méliès cinema, and earliest gramophone audio transfers.',
      archiveItems: [
        {
          identifier: 'A_Trip_to_the_Moon_1902',
          title: 'A Trip to the Moon (1902)',
          mediaType: 'movies',
          year: '1902',
          creator: 'Georges Méliès',
          thumbnail: 'https://archive.org/services/img/A_Trip_to_the_Moon_1902',
          itemUrl: 'https://archive.org/details/A_Trip_to_the_Moon_1902',
        },
        {
          identifier: 'RelativityByAlbertEinstein',
          title: 'Albert Einstein Relativity Publication',
          mediaType: 'texts',
          year: '1920',
          creator: 'Albert Einstein',
          thumbnail: 'https://archive.org/services/img/RelativityByAlbertEinstein',
          itemUrl: 'https://archive.org/details/RelativityByAlbertEinstein',
        },
      ],
    },
    {
      id: 'era_1930',
      yearRange: '1930 - 1950',
      titleHe: 'מלחמת העולם השנייה ותקופת הג’אז',
      titleEn: 'World War II & The Swing Era',
      descHe: 'תסכיתי רדיו היסטוריים, שידורי חדשות 78rpm וסרטים תיעודיים של WWII',
      descEn: 'Historic radio broadcasts, 78rpm swing jazz classics, and WWII documentary newsreels.',
      archiveItems: [
        {
          identifier: '78_sing-sing-sing-with-a-swing_benny-goodman-and-his-orchestra-louis-prima_gbia0011853a',
          title: 'Sing, Sing, Sing (Benny Goodman 1937)',
          mediaType: 'audio',
          year: '1937',
          creator: 'Benny Goodman',
          thumbnail: 'https://archive.org/services/img/george-blood-78s',
          itemUrl: 'https://archive.org/details/78_sing-sing-sing-with-a-swing_benny-goodman-and-his-orchestra-louis-prima_gbia0011853a',
        },
      ],
    },
    {
      id: 'era_1960',
      yearRange: '1960 - 1980',
      titleHe: 'מרוץ לחלל ומהפכת המחשבים',
      titleEn: 'Space Race & Computer Genesis',
      descHe: 'שידור הנחיתה על הירח באפולו 11 ולידת המיקרו-מעבד הראשון',
      descEn: 'Live lunar landing TV broadcasts, NASA space history, and microcomputer revolution.',
      archiveItems: [
        {
          identifier: 'Apollo11Moonlanding',
          title: 'Apollo 11 Live Broadcast (1969)',
          mediaType: 'movies',
          year: '1969',
          creator: 'NASA',
          thumbnail: 'https://archive.org/services/img/Apollo11Moonlanding',
          itemUrl: 'https://archive.org/details/Apollo11Moonlanding',
        },
        {
          identifier: 'computer_history_museum_demo',
          title: 'Computing Microprocessor Birth (1977)',
          mediaType: 'movies',
          year: '1977',
          creator: 'Computer History Museum',
          thumbnail: 'https://archive.org/services/img/computer_history_museum_demo',
          itemUrl: 'https://archive.org/details/computer_history_museum_demo',
        },
      ],
    },
    {
      id: 'era_1980',
      yearRange: '1980 - 2000',
      titleHe: 'עידן האינטרנט ומשחקי הווידאו',
      titleEn: 'Internet Birth & Arcade Games',
      descHe: 'תחילת הרשת העולמית, צילומי מסך ראשונים ב-Wayback Machine ומשחקי MS-DOS',
      descEn: 'Early World Wide Web, early Wayback Machine web snapshots, and MS-DOS arcade classics.',
      archiveItems: [
        {
          identifier: 'msdos_Pac-Man_1983',
          title: 'Pac-Man (MS-DOS Arcade 1983)',
          mediaType: 'software',
          year: '1983',
          creator: 'Namco / Midway',
          thumbnail: 'https://archive.org/services/img/msdos_Pac-Man_1983',
          itemUrl: 'https://archive.org/details/msdos_Pac-Man_1983',
        },
      ],
    },
  ];

  const [selectedEra, setSelectedEra] = useState<TimelineEra>(eras[2]);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
          <Clock className="w-6 h-6 text-amber-400" />
          <span>{isHe ? 'מכונת הזמן: ציר זמן היסטורי משולב' : 'Time Machine: Historical Timeline'}</span>
        </h2>
        <p className="text-xs text-slate-400 mb-6">
          {isHe
            ? 'סייר בין התקופות ההיסטוריות וצפה בקטעי וידיאו ואודיו מקוריים מכל עשור'
            : 'Select an era to stream historical media clips and primary source documents.'}
        </p>

        {/* Timeline Era Selector Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {eras.map((era) => {
            const isActive = selectedEra.id === era.id;
            return (
              <button
                key={era.id}
                onClick={() => setSelectedEra(era)}
                className={`p-4 rounded-2xl border text-right transition-all flex flex-col justify-between ${
                  isActive
                    ? 'bg-gradient-to-br from-indigo-900/90 to-purple-900/90 border-indigo-500 shadow-xl text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                <span className="text-xs font-mono font-bold text-amber-400">{era.yearRange}</span>
                <h3 className="text-sm font-bold mt-1">{isHe ? era.titleHe : era.titleEn}</h3>
              </button>
            );
          })}
        </div>

        {/* Era Active Showcase */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800 mb-6">
            <div>
              <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
                {selectedEra.yearRange}
              </span>
              <h3 className="text-xl font-extrabold text-white mt-2">
                {isHe ? selectedEra.titleHe : selectedEra.titleEn}
              </h3>
              <p className="text-xs text-slate-300 mt-1">
                {isHe ? selectedEra.descHe : selectedEra.descEn}
              </p>
            </div>

            <button
              onClick={() => onAskBotAbout(isHe ? selectedEra.titleHe : selectedEra.titleEn)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow"
            >
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>{isHe ? 'סקור תקופה זו עם בוט AI' : 'Explore Era with Bot'}</span>
            </button>
          </div>

          <h4 className="text-xs font-bold text-slate-400 mb-4">
            {isHe ? 'פריטי ארכיון שמורים מתקופה זו:' : 'Archival Media Items from this Era:'}
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {selectedEra.archiveItems.map((item) => (
              <div
                key={item.identifier}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center justify-between hover:border-indigo-500/50 transition-all"
              >
                <div className="flex items-center space-x-3 space-x-reverse min-w-0">
                  {item.thumbnail && (
                    <img src={item.thumbnail} alt={item.title} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <h5 className="font-bold text-xs text-white truncate">{item.title}</h5>
                    <p className="text-[11px] text-slate-400">{item.creator || 'Internet Archive'}</p>
                  </div>
                </div>

                <button
                  onClick={() => onPlayMedia(item)}
                  className="p-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl flex-shrink-0 shadow"
                >
                  <Play className="w-4 h-4 fill-current" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
