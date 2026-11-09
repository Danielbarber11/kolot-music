import React, { useState, useEffect, useRef } from 'react';
import { Radio, Search, Play, Pause, Volume2, VolumeX, Globe, RadioTower, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import { RadioStation, searchRadioStations } from '../services/radioBrowserService';
import { Language } from '../types';

interface RadioViewProps {
  lang: Language;
}

export const RadioView: React.FC<RadioViewProps> = ({ lang }) => {
  const isHe = lang === 'he';

  const [query, setQuery] = useState('');
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [loading, setLoading] = useState(false);

  // Active playing radio station
  const [activeStation, setActiveStation] = useState<RadioStation | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  const fetchStations = async (searchTerm?: string) => {
    setLoading(true);
    try {
      const res = await searchRadioStations(searchTerm || query, 24);
      setStations(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStations();
  }, []);

  const playStation = (st: RadioStation) => {
    setActiveStation(st);
    setIsPlaying(true);
    if (audioRef.current) {
      audioRef.current.src = st.url_resolved;
      audioRef.current.play().catch(() => setIsPlaying(false));
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <audio ref={audioRef} />

      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-extrabold text-xs mb-3 border border-emerald-200">
            <RadioTower className="w-3.5 h-3.5" />
            <span>RADIO BROWSER OPEN API</span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
            {isHe ? 'שידורי רדיו חיים מכל העולם' : 'Live World Radio Stations'}
          </h1>
          <p className="text-slate-600 text-xs sm:text-sm mt-2 max-w-xl leading-relaxed">
            {isHe
              ? 'האזן לתחנות רדיו בלייב בישראל וברחבי העולם. מוזיקה, חדשות, ג’אז, פופ ופודקאסטים בשידור חי.'
              : 'Stream thousands of live radio stations globally powered by Radio Browser API.'}
          </p>
        </div>

        {/* Search */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchStations();
          }}
          className="relative w-full md:w-80"
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isHe ? 'חפש תחנת רדיו...' : 'Search radio station...'}
            className="w-full pr-10 pl-10 py-3 bg-white border border-slate-300 focus:border-emerald-600 rounded-2xl text-slate-900 text-xs font-medium focus:outline-none shadow-sm"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        </form>
      </div>

      {/* Persistent Radio Player Bar if playing */}
      {activeStation && (
        <div className="bg-emerald-900 text-white p-4 rounded-3xl shadow-xl flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <img src={activeStation.favicon} alt={activeStation.name} className="w-12 h-12 rounded-2xl object-cover bg-white p-1" />
            <div className="min-w-0">
              <span className="text-[10px] font-mono text-emerald-300 uppercase">● LIVE RADIO</span>
              <h3 className="font-extrabold text-sm truncate">{activeStation.name}</h3>
              <p className="text-xs text-emerald-200 truncate">{activeStation.country} • {activeStation.tags}</p>
            </div>
          </div>

          <button
            onClick={togglePlay}
            className="w-12 h-12 rounded-full bg-white text-emerald-950 flex items-center justify-center font-bold shadow-lg"
          >
            {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current translate-x-0.5" />}
          </button>
        </div>
      )}

      {/* Stations Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 animate-pulse">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map((n) => (
            <div key={n} className="h-44 bg-slate-200/70 rounded-3xl p-3" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {stations.map((st) => (
            <motion.div
              whileHover={{ y: -4 }}
              key={st.stationuuid}
              onClick={() => playStation(st)}
              className="bg-white border border-slate-200 hover:border-emerald-500 rounded-3xl p-4 shadow-sm hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between"
            >
              <div className="space-y-2">
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-slate-100 p-1 border border-slate-200">
                  <img src={st.favicon} alt={st.name} className="w-full h-full object-contain" />
                </div>

                <h3 className="font-extrabold text-xs text-slate-900 line-clamp-1">{st.name}</h3>
                <p className="text-[10px] font-semibold text-slate-500 truncate">{st.country}</p>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-emerald-700 font-bold">
                <span>שידור חי</span>
                <Play className="w-3.5 h-3.5 fill-current" />
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};
