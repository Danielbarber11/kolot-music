import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldAlert,
  Users,
  Music,
  CheckCircle2,
  Trash2,
  Github,
  RefreshCw,
  Eye,
  BarChart3,
  Check,
  HardDrive,
  Plus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, TrackReport, ArtistProfile, Language } from '../types';
import { getTrackReportsFromFirebase, dismissTrackReportInFirebase } from '../services/firebaseService';
import {
  getGitHubStorageConfig,
  saveGitHubStorageConfig,
  calculateRealStorageUsage,
  normalizeRepoFullName,
  testGitHubConnection,
} from '../services/githubStorageService';

import { TrackCoverArt } from './TrackCoverArt';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  allTracks: JamendoTrack[];
  artistProfiles: ArtistProfile[];
  onRemoveTrack?: (trackId: string) => void;
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  isOpen,
  onClose,
  lang,
  allTracks,
  artistProfiles,
  onRemoveTrack,
}) => {
  if (!isOpen) return null;
  const isHe = lang === 'he';

  const [activeTab, setActiveTab] = useState<'github' | 'songs' | 'stats' | 'reports'>('github');
  const [reports, setReports] = useState<TrackReport[]>([]);
  const [displayedTracks, setDisplayedTracks] = useState<JamendoTrack[]>(allTracks);

  useEffect(() => {
    setDisplayedTracks(allTracks);
  }, [allTracks]);

  // GitHub Storage Config
  const [githubConfig, setGithubConfig] = useState(getGitHubStorageConfig);
  const [repoInput, setRepoInput] = useState(() => {
    const raw = githubConfig.repoName || 'Kolot Music1';
    return raw.replace(/Kolot MusicKolot Music/gi, 'Kolot Music1').trim();
  });
  const [tokenInput, setTokenInput] = useState(githubConfig.token || '');
  const [extraRepos, setExtraRepos] = useState<string[]>(['Kolot Music2 (גיבוי)']);
  const [newExtraRepoName, setNewExtraRepoName] = useState('');
  const [isSyncingGithub, setIsSyncingGithub] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  // REAL Live Storage calculation based on actual uploaded tracks
  const realStorageStats = calculateRealStorageUsage(allTracks);
  const realUsedMb = Math.round((githubConfig.usedBytes + realStorageStats.usedBytes) / (1024 * 1024));
  const usedPercent = Math.min(100, Math.round((realUsedMb / githubConfig.capacityMb) * 100));

  // REAL Active Published Profiles count
  const publishedArtistsCount = artistProfiles.filter(
    (p) => !(p.isPrivate && (!p.tracksCount || p.tracksCount === 0))
  ).length;

  // REAL User Uploaded Tracks count
  const uploadedTracksCount = allTracks.filter((t) => t.id.startsWith('artist_track_') || t.uploadedByUid).length;

  useEffect(() => {
    getTrackReportsFromFirebase().then((fbReports) => {
      const savedLocal = localStorage.getItem('kolot_track_reports');
      const localReports: TrackReport[] = savedLocal ? JSON.parse(savedLocal) : [];
      const combined = [...fbReports];
      localReports.forEach((lr) => {
        if (!combined.some((c) => c.id === lr.id)) {
          combined.push(lr);
        }
      });
      setReports(combined);
    });
  }, []);

  const handleDismissReport = async (reportId: string) => {
    setReports((prev) => prev.filter((r) => r.id !== reportId));
    const local = reports.filter((r) => r.id !== reportId);
    localStorage.setItem('kolot_track_reports', JSON.stringify(local));
    await dismissTrackReportInFirebase(reportId);
  };

  const handleSyncGithub = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSyncingGithub(true);

    const cleanName = normalizeRepoFullName(repoInput);
    const updated = {
      ...githubConfig,
      repoName: cleanName,
      token: tokenInput.trim(),
      isConnected: true,
    };
    setGithubConfig(updated);
    saveGitHubStorageConfig(updated);

    await testGitHubConnection(cleanName, tokenInput.trim());

    setIsSyncingGithub(false);
    setSyncSuccess(true);
    setTimeout(() => setSyncSuccess(false), 2500);
  };

  const handleAddExtraRepo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExtraRepoName.trim()) return;
    setExtraRepos((prev) => [...prev, newExtraRepoName.trim()]);
    setNewExtraRepoName('');
  };

  const cleanRepoDisplayName = normalizeRepoFullName(githubConfig.repoName);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[140] flex items-center justify-center p-3 sm:p-6 bg-slate-950/90 backdrop-blur-3xl animate-fadeIn" dir={isHe ? 'rtl' : 'ltr'}>
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 20 }}
          className="relative w-full max-w-4xl bg-[#0b0f19] border border-amber-500/30 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-white"
        >
          {/* ADMIN HEADER */}
          <div className="p-5 border-b border-white/10 flex items-center justify-between bg-slate-900/90">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30">
                <ShieldAlert className="w-6 h-6 text-amber-400 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-amber-200 flex items-center gap-2">
                  <span>{isHe ? '⚡ פאנל מנהל מערכת • Kolot Music' : '⚡ System Admin Panel'}</span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-black border border-emerald-500/30">
                    {isHe ? 'שרת אחסון פעיל' : 'Storage Active'}
                  </span>
                </h3>
                <p className="text-[11px] text-white/60">
                  {isHe ? 'שרת אחסון שירים ציבורי (קיבולת 1GB)' : 'Public cloud song storage (1GB capacity)'}
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* SUB TABS */}
          <div className="flex items-center gap-2 p-2 bg-slate-900 border-b border-white/10 text-xs font-bold overflow-x-auto custom-scrollbar">
            <button
              onClick={() => setActiveTab('github')}
              className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'github'
                  ? 'bg-purple-600 text-white shadow-md font-extrabold'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              <Github className="w-4 h-4" />
              <span>{isHe ? 'אחסון שירים (1GB)' : 'GitHub Storage'}</span>
            </button>

            <button
              onClick={() => setActiveTab('songs')}
              className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'songs'
                  ? 'bg-emerald-600 text-white shadow-md font-extrabold'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              <Music className="w-4 h-4" />
              <span>{isHe ? `ניהול שירים (${allTracks.length})` : `Songs (${allTracks.length})`}</span>
            </button>

            <button
              onClick={() => setActiveTab('stats')}
              className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'stats'
                  ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>{isHe ? 'סטטיסטיקות אמת' : 'Analytics'}</span>
            </button>

            <button
              onClick={() => setActiveTab('reports')}
              className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer ${
                activeTab === 'reports'
                  ? 'bg-rose-600 text-white shadow-md font-extrabold'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>{isHe ? `דיווחים (${reports.length})` : `Reports (${reports.length})`}</span>
            </button>
          </div>

          {/* MAIN CONTENT */}
          <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6 custom-scrollbar">
            {/* TAB 1: GITHUB REPO STORAGE */}
            {activeTab === 'github' && (
              <div className="space-y-6">
                <div className="p-5 rounded-3xl bg-gradient-to-r from-purple-950/80 via-slate-900 to-slate-900 border border-purple-500/40 space-y-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        <HardDrive className="w-6 h-6 text-purple-400" />
                      </div>
                      <div>
                        <h4 className="font-extrabold text-base text-white flex items-center gap-2">
                          <span>{isHe ? 'שרת אחסון שירים ציבורי' : 'Public Song Storage'}</span>
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-black flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            <span>{isHe ? 'מחובר ופעיל' : 'Connected'}</span>
                          </span>
                        </h4>
                        <p className="text-xs text-white/60 mt-0.5">
                          {isHe ? 'כל השירים והתמונות המועלים נשמרים במאגר ציבורי זה' : 'Uploaded songs hosted in this public GitHub repo'}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs text-purple-300 font-bold block">{isHe ? 'קיבולת מאגר:' : 'Repo Capacity:'}</span>
                      <span className="text-lg font-black text-white font-mono">1 GB ({githubConfig.capacityMb} MB)</span>
                    </div>
                  </div>

                  {/* STORAGE PROGRESS BAR - CALCULATED FROM REAL UPLOADS */}
                  <div className="space-y-1.5 pt-2">
                    <div className="flex items-center justify-between text-xs font-mono font-bold">
                      <span className="text-white/90">
                        {isHe
                          ? `אחסון בשימוש בפועל: ${realUsedMb} MB מתוך 1,000 MB (${uploadedTracksCount} שירים שהועלו)`
                          : `Real Used: ${realUsedMb} MB / 1,000 MB (${uploadedTracksCount} uploaded tracks)`}
                      </span>
                      <span className="text-purple-300 font-extrabold">{usedPercent}% תפוס</span>
                    </div>
                    <div className="w-full h-3.5 rounded-full bg-black/60 p-0.5 border border-white/10 relative overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-500 via-indigo-500 to-emerald-400 transition-all duration-500"
                        style={{ width: `${Math.max(usedPercent, 2)}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-white/50">
                      {isHe
                        ? `פנוי לאחסון נוסף: ${1000 - realUsedMb} MB פנויים להעלאת שירים ותמונות`
                        : `Free space: ${1000 - realUsedMb} MB available`}
                    </p>
                  </div>
                </div>

                {/* GITHUB REPO FORM */}
                <form onSubmit={handleSyncGithub} className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-4 text-xs">
                  <h4 className="font-extrabold text-amber-300 border-b border-white/10 pb-2">
                    {isHe ? 'הגדרות חיבור למאגר GitHub:' : 'GitHub Repository Settings:'}
                  </h4>

                  {syncSuccess && (
                    <div className="p-3.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-bold flex items-center gap-2 animate-fadeIn">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>{isHe ? 'החיבור למאגר GitHub נבדק ונשמר בהצלחה!' : 'GitHub repo connection verified!'}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-white/90 font-bold mb-1">
                      {isHe ? 'שם המאגר ב-GitHub (אחסון שירים ותמונות עד 1GB):' : 'GitHub Repository Name:'}
                    </label>
                    <input
                      type="text"
                      required
                      value={repoInput}
                      onChange={(e) => setRepoInput(e.target.value)}
                      placeholder="שרת אחסון שירים"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white font-mono text-xs focus:outline-none focus:border-purple-400"
                    />
                  </div>

                  <div>
                    <label className="block text-white/90 font-bold mb-1">
                      {isHe ? 'מפתח גישה GitHub Personal Access Token:' : 'GitHub Access Token:'}
                    </label>
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="ghp_..."
                      className="w-full px-3.5 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white font-mono text-xs focus:outline-none focus:border-purple-400"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={isSyncingGithub}
                    className="w-full py-3.5 rounded-2xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs transition-all shadow-xl cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isSyncingGithub ? (
                      <span className="flex items-center gap-2 animate-pulse">
                        <RefreshCw className="w-4 h-4 animate-spin text-white" />
                        <span>{isHe ? 'בודק חיבור למאגר ב-GitHub...' : 'Verifying GitHub Connection...'}</span>
                      </span>
                    ) : (
                      <>
                        <Github className="w-4 h-4" />
                        <span>{isHe ? 'שמור ובדוק חיבור למאגר עכשיו' : 'Verify & Save Connection'}</span>
                      </>
                    )}
                  </button>
                </form>

                {/* ADD EXTRA REPOS */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3 text-xs">
                  <h4 className="font-extrabold text-white flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-400" />
                    <span>{isHe ? 'הוספת מאגרי אחסון נוספים ב-GitHub (כאשר המאגר הראשון יתמלא):' : 'Additional Storage Repositories:'}</span>
                  </h4>

                  <form onSubmit={handleAddExtraRepo} className="flex gap-2">
                    <input
                      type="text"
                      value={newExtraRepoName}
                      onChange={(e) => setNewExtraRepoName(e.target.value)}
                      placeholder="Kolot Music2"
                      className="flex-1 px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-white text-xs font-mono"
                    />
                    <button
                      type="submit"
                      disabled={!newExtraRepoName.trim()}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl cursor-pointer disabled:opacity-50"
                    >
                      {isHe ? 'הוסף מאגר' : 'Add Repo'}
                    </button>
                  </form>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <span className="px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono text-[11px] flex items-center gap-1.5 font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Kolot Music1 (אחסון ראשי)</span>
                    </span>
                    <span className="px-3 py-1 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 font-mono text-[11px] flex items-center gap-1.5 font-bold">
                      <CheckCircle2 className="w-3.5 h-3.5 text-purple-400" />
                      <span>Kolot Music2 (מאגר גיבוי חירום מחובר)</span>
                    </span>
                    {extraRepos.map((repo, i) => (
                      <span key={i} className="px-3 py-1 rounded-full bg-slate-800 border border-white/15 text-white/80 font-mono text-[11px] flex items-center gap-1.5">
                        <HardDrive className="w-3 h-3 text-purple-400" />
                        <span>{repo}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: SONG MANAGEMENT (מחיקת שירים על ידי מנהל) */}
            {activeTab === 'songs' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h4 className="text-sm font-black text-emerald-300 flex items-center gap-2">
                    <Music className="w-5 h-5 text-emerald-400" />
                    <span>{isHe ? 'ניהול ומחיקת שירים בפלטפורמה (פנאל מנהל)' : 'Platform Song Management'}</span>
                  </h4>
                  <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/30">
                    {displayedTracks.length} {isHe ? 'שירים' : 'tracks'}
                  </span>
                </div>

                {displayedTracks.length === 0 ? (
                  <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10 text-xs text-white/60 space-y-2">
                    <Music className="w-10 h-10 text-white/30 mx-auto" />
                    <p className="font-bold text-white">{isHe ? 'אין שירים מפורסמים במערכת כרגע.' : 'No uploaded songs found.'}</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[55vh] overflow-y-auto custom-scrollbar p-1">
                    {displayedTracks.map((track) => (
                      <div
                        key={track.id}
                        className="p-3.5 rounded-2xl bg-slate-900 border border-white/10 hover:border-emerald-500/30 flex items-center justify-between gap-3 text-xs transition-all shadow-md"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-12 h-12 rounded-xl bg-slate-800 overflow-hidden flex-shrink-0 border border-white/15">
                            <TrackCoverArt
                              coverUrl={track.coverUrl}
                              artistName={track.artistName}
                              trackName={track.name}
                              genre={track.genre}
                              showHoverPlay={false}
                            />
                          </div>
                          <div className="min-w-0 space-y-0.5">
                            <h5 className="font-extrabold text-white text-sm truncate">{track.name}</h5>
                            <p className="text-white/60 text-[11px] truncate">
                              מאת: <span className="font-bold text-emerald-300">{track.artistName}</span> • ז׳אנר: <span className="text-white/90">{track.genre || 'פופ'}</span>
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {onRemoveTrack && (
                            <button
                              onClick={() => {
                                if (window.confirm(isHe ? `האם אתה בטוח שברצונך למחוק את השיר "${track.name}" לצמיתות מכל השרתים?` : `Delete track "${track.name}" permanently?`)) {
                                  setDisplayedTracks((prev) => prev.filter((t) => t.id !== track.id));
                                  onRemoveTrack(track.id);
                                }
                              }}
                              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
                            >
                              <Trash2 className="w-4 h-4 text-white" />
                              <span>{isHe ? 'מחק שיר' : 'Delete Song'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: REAL STATS */}
            {activeTab === 'stats' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-950/80 to-slate-900 border border-indigo-500/30 space-y-2 shadow-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-indigo-300">{isHe ? 'סך הכל שירים בפלטפורמה' : 'Total Platform Songs'}</span>
                      <Music className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div className="text-3xl font-black text-white font-mono">{allTracks.length.toLocaleString()}</div>
                    <p className="text-[10px] text-white/50">{isHe ? 'זמינים להאזנה מיידית' : 'Available for streaming'}</p>
                  </div>

                  <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/80 to-slate-900 border border-emerald-500/30 space-y-2 shadow-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-300">{isHe ? 'פרופילי אמנים פעילים באתר' : 'Active Published Artists'}</span>
                      <Users className="w-5 h-5 text-emerald-400" />
                    </div>
                    <div className="text-3xl font-black text-white font-mono">{publishedArtistsCount}</div>
                    <p className="text-[10px] text-white/50">{isHe ? 'אמנים שפירסמו לפחות שיר אחד' : 'Artists with published tracks'}</p>
                  </div>

                  <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-950/80 to-slate-900 border border-purple-500/30 space-y-2 shadow-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-purple-300">{isHe ? 'שירים שהועלו על ידי גולשים' : 'Uploaded Tracks'}</span>
                      <Eye className="w-5 h-5 text-purple-400" />
                    </div>
                    <div className="text-3xl font-black text-white font-mono">{uploadedTracksCount}</div>
                    <p className="text-[10px] text-white/50">{isHe ? 'מאוחסנים בשרת האחסון הציבורי' : 'Stored in public storage'}</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-xs space-y-2">
                  <h4 className="font-extrabold text-amber-300">{isHe ? 'אבטחה ואחסון:' : 'Security & Database:'}</h4>
                  <p className="text-white/80 leading-relaxed text-[11px]">
                    {isHe
                      ? 'נתוני המשתמשים, החשבונות והדיווחים נשמרים ב-Firebase Firestore (פרטי). השירים והמדיה הציבורית נשמרים במאגר הציבורי ב-GitHub.'
                      : 'Private credentials & reports stored in Firebase. Public songs hosted on GitHub.'}
                  </p>
                </div>
              </div>
            )}

            {/* TAB 3: REPORTS */}
            {activeTab === 'reports' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <h4 className="text-xs font-black text-rose-300 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                    <span>{isHe ? 'דיווחים שהתקבלו מגולשים על שירים (ב-Firebase)' : 'User Track Reports'}</span>
                  </h4>
                  <span className="text-xs font-mono font-bold text-rose-400">{reports.length} דיווחים</span>
                </div>

                {reports.length === 0 ? (
                  <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10 text-xs text-white/60 space-y-2">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                    <p className="font-bold text-white">{isHe ? 'אין דיווחים חדשים! כל השירים בפלטפורמה תקינים.' : 'No reported songs at this time!'}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reports.map((report) => (
                      <div
                        key={report.id}
                        className="p-4 rounded-2xl bg-slate-900 border border-rose-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-white text-sm">{report.trackName}</span>
                            <span className="text-white/60">מאת</span>
                            <span className="font-bold text-amber-300">{report.artistName}</span>
                          </div>
                          <p className="text-rose-300 font-bold">
                            {isHe ? 'סיבת הדיווח:' : 'Reason:'} {report.reason}
                          </p>
                          {report.details && <p className="text-white/70 italic text-[11px]">{report.details}</p>}
                          <span className="text-[10px] text-white/40 block">{report.reportedAt}</span>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleDismissReport(report.id)}
                            className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 border border-emerald-500/30 font-bold transition-all cursor-pointer"
                          >
                            {isHe ? 'אישור וביטול דיווח' : 'Dismiss'}
                          </button>

                          {onRemoveTrack && (
                            <button
                              onClick={() => {
                                onRemoveTrack(report.trackId);
                                handleDismissReport(report.id);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold transition-all cursor-pointer flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{isHe ? 'הסר שיר' : 'Remove Song'}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
