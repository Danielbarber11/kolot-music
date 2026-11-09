import React, { useState, useEffect } from 'react';
import {
  Trophy,
  Search,
  ExternalLink,
  Shield,
  MapPin,
  Calendar,
  Users,
  X,
  Globe,
  Youtube,
  Twitter,
  Sparkles,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  SportsTeam,
  POPULAR_LEAGUES,
  fetchTeamsByLeague,
  searchTeams,
  searchPlayers,
  SportsPlayer,
  CURATED_POPULAR_TEAMS,
} from '../services/sportsService';
import { Language } from '../types';

interface SportsViewProps {
  lang: Language;
}

export const SportsView: React.FC<SportsViewProps> = ({ lang }) => {
  const isHe = lang === 'he';

  const [selectedLeague, setSelectedLeague] = useState<string>(POPULAR_LEAGUES[0].name);
  const [teams, setTeams] = useState<SportsTeam[]>(CURATED_POPULAR_TEAMS);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTeamModal, setActiveTeamModal] = useState<SportsTeam | null>(null);

  useEffect(() => {
    loadLeagueTeams(selectedLeague);
  }, [selectedLeague]);

  const loadLeagueTeams = async (leagueName: string) => {
    setLoading(true);
    const data = await fetchTeamsByLeague(leagueName);
    setTeams(data);
    setLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setLoading(true);
    const results = await searchTeams(searchQuery);
    setTeams(results);
    setLoading(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-emerald-100 text-emerald-600">
              <Trophy className="w-6 h-6" />
            </span>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
              {isHe ? 'מאגר הספורט העולמי הפתוח' : 'TheSportsDB Open Sports Hub'}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 font-medium">
            {isHe
              ? 'מידע מקיף על קבוצות, לוגואים, אצטדיונים, ליגות והיסטוריית ספורט בחסות TheSportsDB'
              : 'Open database for sports clubs, logos, stadiums, rosters, and leagues powered by TheSportsDB'}
          </p>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex items-center gap-2 max-w-md w-full">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isHe ? 'חפש קבוצה (למשל: Real Madrid, Lakers, Arsenal)...' : 'Search club or team...'}
              className="w-full pl-4 pr-10 py-2.5 rounded-full bg-white border border-slate-200 shadow-sm text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm shadow-md transition-all cursor-pointer"
          >
            {isHe ? 'חיפוש' : 'Search'}
          </button>
        </form>
      </div>

      {/* League Filter Capsule Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 custom-scrollbar">
        {POPULAR_LEAGUES.map((league) => (
          <button
            key={league.id}
            onClick={() => {
              setSelectedLeague(league.name);
              setSearchQuery('');
            }}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex-shrink-0 cursor-pointer ${
              selectedLeague === league.name && !searchQuery
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {isHe ? league.heName : league.name}
          </button>
        ))}
      </div>

      {/* Teams Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 pt-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-white rounded-3xl border border-slate-200 p-6 animate-pulse space-y-4">
              <div className="w-20 h-20 bg-slate-200 rounded-full mx-auto" />
              <div className="h-4 bg-slate-200 rounded w-3/4 mx-auto" />
              <div className="h-3 bg-slate-200 rounded w-1/2 mx-auto" />
            </div>
          ))}
        </div>
      ) : teams.length === 0 ? (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-3xl space-y-3">
          <Shield className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-base font-bold text-slate-700">
            {isHe ? 'לא נמצאו קבוצות תואמות' : 'No teams found'}
          </h3>
          <p className="text-xs text-slate-400">
            {isHe ? 'נסה לחפש שם קבוצה באנגלית או לבחור ליגה אחרת' : 'Try searching another team name'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
          {teams.map((team) => (
            <motion.div
              whileHover={{ y: -4, scale: 1.01 }}
              key={team.idTeam}
              onClick={() => setActiveTeamModal(team)}
              className="group bg-white rounded-3xl border border-slate-200/90 hover:border-emerald-500 p-5 shadow-sm hover:shadow-xl transition-all cursor-pointer flex flex-col justify-between text-center relative overflow-hidden"
            >
              <div>
                {/* Team Badge Logo */}
                <div className="w-24 h-24 mx-auto mb-4 p-2 bg-slate-50 rounded-2xl flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
                  <img
                    src={team.strBadge}
                    alt={team.strTeam}
                    className="max-w-full max-h-full object-contain filter drop-shadow-sm"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">
                    {team.strSport} • {team.strCountry}
                  </span>
                  <h3 className="font-black text-base text-slate-900 group-hover:text-emerald-600 transition-colors truncate">
                    {team.strTeam}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium truncate">
                    {team.strLeague}
                  </p>
                </div>

                {team.strStadium && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                    <MapPin className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{team.strStadium}</span>
                  </div>
                )}
              </div>

              <div className="mt-4 pt-2">
                <button className="w-full py-2 rounded-xl bg-emerald-50 group-hover:bg-emerald-600 group-hover:text-white text-emerald-700 text-xs font-bold transition-all flex items-center justify-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  <span>{isHe ? 'מידע מועדון מלא' : 'View Club Details'}</span>
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Team Details Modal */}
      <AnimatePresence>
        {activeTeamModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden my-8 max-h-[90vh] flex flex-col"
            >
              {/* Header */}
              <div className="relative p-6 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl p-2 flex items-center justify-center flex-shrink-0">
                    <img
                      src={activeTeamModal.strBadge}
                      alt={activeTeamModal.strTeam}
                      className="max-w-full max-h-full object-contain filter drop-shadow"
                    />
                  </div>
                  <div>
                    <h2 className="text-xl sm:text-2xl font-black">{activeTeamModal.strTeam}</h2>
                    <p className="text-xs text-white/80 font-medium">
                      {activeTeamModal.strLeague} • {activeTeamModal.strCountry}
                      {activeTeamModal.intFormedYear && ` (נוסדה ב-${activeTeamModal.intFormedYear})`}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setActiveTeamModal(null)}
                  className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
                {/* Stadium & Location */}
                {activeTeamModal.strStadium && (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-100 text-emerald-700">
                        <MapPin className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-500 uppercase">{isHe ? 'אצטדיון ביתי' : 'Home Stadium'}</h4>
                        <p className="text-sm font-extrabold text-slate-900">{activeTeamModal.strStadium}</p>
                        {activeTeamModal.strStadiumLocation && (
                          <p className="text-xs text-slate-500">{activeTeamModal.strStadiumLocation}</p>
                        )}
                      </div>
                    </div>
                    {activeTeamModal.intStadiumCapacity && (
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 font-bold uppercase">{isHe ? 'תכולה' : 'Capacity'}</span>
                        <p className="text-sm font-mono font-bold text-emerald-600">
                          {Number(activeTeamModal.intStadiumCapacity).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                {activeTeamModal.strDescriptionEN && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-slate-500 uppercase">{isHe ? 'אודות המועדון' : 'About the Club'}</h4>
                    <p className="text-xs sm:text-sm text-slate-700 leading-relaxed max-h-48 overflow-y-auto custom-scrollbar p-3 rounded-xl bg-slate-50">
                      {activeTeamModal.strDescriptionEN}
                    </p>
                  </div>
                )}

                {/* Social & Official Links */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  {activeTeamModal.strWebsite && (
                    <a
                      href={`https://${activeTeamModal.strWebsite.replace('https://', '').replace('http://', '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      <span>{isHe ? 'אתר רשמי' : 'Official Site'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  {activeTeamModal.strYoutube && (
                    <a
                      href={`https://${activeTeamModal.strYoutube.replace('https://', '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition-all"
                    >
                      <Youtube className="w-3.5 h-3.5" />
                      <span>YouTube</span>
                    </a>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
                <button
                  onClick={() => setActiveTeamModal(null)}
                  className="px-5 py-2 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold transition-all cursor-pointer"
                >
                  {isHe ? 'סגור' : 'Close'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
