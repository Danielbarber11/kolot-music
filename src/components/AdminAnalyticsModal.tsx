import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  BarChart3,
  RefreshCw,
  Users,
  Eye,
  Plus,
  Trash2,
  Search,
  Music,
  UserCheck,
  UserX,
  EyeOff,
  Sparkles,
  Loader2,
  AlertCircle,
  Disc,
  TrendingUp,
} from 'lucide-react';
import { Language } from '../types';
import {
  AdminAnalyticsDashboardData,
  AdminAnalyticsSongItem,
  AdminSongWindowRecord,
  fetchAdminAnalyticsDashboard,
  saveAdminAnalyticsWindows,
} from '../services/analyticsService';

interface AdminAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  onOpenSongById?: (trackId: string) => void;
}

type ProfileFilterTab = 'all' | 'active' | 'multi' | 'hidden' | 'no_profile';
type SongSortMode = 'ga_views' | 'plays' | 'name';

export const AdminAnalyticsModal: React.FC<AdminAnalyticsModalProps> = ({
  isOpen,
  onClose,
  lang,
  onOpenSongById,
}) => {
  const isHe = lang === 'he';
  const [data, setData] = useState<AdminAnalyticsDashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unlimited Custom Song View Windows state
  const [windows, setWindows] = useState<AdminSongWindowRecord[]>([]);
  const [isAddWindowOpen, setIsAddWindowOpen] = useState(false);
  const [newWinMode, setNewWinMode] = useState<'song' | 'artist' | 'genre' | 'all'>('song');
  const [newWinTarget, setNewWinTarget] = useState('');
  const [newWinTitle, setNewWinTitle] = useState('');
  const [isSavingWindows, setIsSavingWindows] = useState(false);

  // Profiles Directory filters
  const [profileTab, setProfileTab] = useState<ProfileFilterTab>('all');
  const [profileSearch, setProfileSearch] = useState('');

  // Songs Analytics filters (paginated unlimited catalog)
  const [songSearch, setSongSearch] = useState('');
  const [songSort, setSongSort] = useState<SongSortMode>('ga_views');
  const [songsVisibleLimit, setSongsVisibleLimit] = useState(50);

  const loadDashboard = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminAnalyticsDashboard(forceRefresh);
      setData(res);
      setWindows(Array.isArray(res.windows) ? res.windows : []);
    } catch (err: any) {
      setError(err?.message || (isHe ? 'טעינת הנתונים נכשלה' : 'Failed to load analytics'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadDashboard(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const songsList = data?.songsList || [];
  const profilesList = data?.profilesList || [];
  const signedInWithoutProfileList = data?.signedInWithoutProfileList || [];

  const uniqueArtists = useMemo(() => {
    const set = new Set<string>();
    songsList.forEach((s) => {
      const n = (s.artistName || '').trim();
      if (n) set.add(n);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
  }, [songsList]);

  const uniqueGenres = useMemo(() => {
    const set = new Set<string>();
    songsList.forEach((s) => {
      const g = (s.genre || '').trim();
      if (g) set.add(g);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
  }, [songsList]);

  const totalCatalogGaViews = useMemo(() => {
    if (!data?.ga?.configured || data?.ga?.error) return null;
    return songsList.reduce((sum, s) => sum + (s.gaViews ?? 0), 0);
  }, [data, songsList]);

  const sortedFilteredSongs = useMemo(() => {
    const q = songSearch.trim().toLowerCase();
    const filtered = q
      ? songsList.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.artistName.toLowerCase().includes(q) ||
            s.genre.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q)
        )
      : [...songsList];

    filtered.sort((a, b) => {
      if (songSort === 'ga_views') {
        const va = a.gaViews ?? -1;
        const vb = b.gaViews ?? -1;
        if (vb !== va) return vb - va;
        return b.playsCount - a.playsCount;
      }
      if (songSort === 'plays') {
        if (b.playsCount !== a.playsCount) return b.playsCount - a.playsCount;
        return (b.gaViews ?? 0) - (a.gaViews ?? 0);
      }
      return a.name.localeCompare(b.name, 'he');
    });
    return filtered;
  }, [songsList, songSearch, songSort]);

  const filteredProfiles = useMemo(() => {
    const q = profileSearch.trim().toLowerCase();
    return profilesList.filter((p) => {
      if (profileTab === 'active' && !p.isActive) return false;
      if (profileTab === 'multi' && !p.isMultiTrack) return false;
      if (profileTab === 'hidden' && !p.isHidden) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.uid.toLowerCase().includes(q);
    });
  }, [profilesList, profileTab, profileSearch]);

  const filteredNoProfileUsers = useMemo(() => {
    const q = profileSearch.trim().toLowerCase();
    return signedInWithoutProfileList.filter((u) => {
      if (!q) return true;
      return u.displayName.toLowerCase().includes(q) || u.uid.toLowerCase().includes(q);
    });
  }, [signedInWithoutProfileList, profileSearch]);

  const computeWindowMetrics = (win: AdminSongWindowRecord): {
    matchedSongs: AdminAnalyticsSongItem[];
    totalGaViews: number | null;
    totalPlays: number;
  } => {
    let matched: AdminAnalyticsSongItem[] = [];
    const targetLower = win.targetValue.trim().toLowerCase();
    if (win.mode === 'song') {
      matched = songsList.filter((s) => s.id === win.targetValue);
    } else if (win.mode === 'artist') {
      matched = songsList.filter((s) => s.artistName.trim().toLowerCase() === targetLower);
    } else if (win.mode === 'genre') {
      matched = songsList.filter((s) => s.genre.trim().toLowerCase() === targetLower);
    } else {
      matched = [...songsList].sort((a, b) => (b.gaViews ?? b.playsCount) - (a.gaViews ?? a.playsCount)).slice(0, 10);
    }

    const gaReady = Boolean(data?.ga?.configured && !data?.ga?.error);
    const totalGaViews = gaReady ? matched.reduce((sum, s) => sum + (s.gaViews ?? 0), 0) : null;
    const totalPlays = matched.reduce((sum, s) => sum + (s.playsCount || 0), 0);
    return {
      matchedSongs: [...matched].sort((a, b) => (b.gaViews ?? 0) - (a.gaViews ?? 0)),
      totalGaViews,
      totalPlays,
    };
  };

  const handleAddWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newWinMode !== 'all' && !newWinTarget.trim()) return;

    let resolvedTitle = newWinTitle.trim();
    if (!resolvedTitle) {
      if (newWinMode === 'song') {
        const s = songsList.find((x) => x.id === newWinTarget);
        resolvedTitle = s ? `${s.name} — ${s.artistName}` : newWinTarget;
      } else if (newWinMode === 'artist') {
        resolvedTitle = isHe ? `צפיות הזמר: ${newWinTarget}` : `Artist Views: ${newWinTarget}`;
      } else if (newWinMode === 'genre') {
        resolvedTitle = isHe ? `צפיות סגנון: ${newWinTarget}` : `Genre Views: ${newWinTarget}`;
      } else {
        resolvedTitle = isHe ? 'מובילים בצפיות (כל האתר)' : 'Top Viewed Across Site';
      }
    }

    const newRecord: AdminSongWindowRecord = {
      id: `win_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: resolvedTitle,
      mode: newWinMode,
      targetValue: newWinMode === 'all' ? 'all' : newWinTarget.trim(),
      createdAt: new Date().toISOString(),
    };

    const nextWindows = [newRecord, ...windows];
    setWindows(nextWindows);
    setNewWinTitle('');
    setNewWinTarget('');
    setIsAddWindowOpen(false);
    setIsSavingWindows(true);
    try {
      const saved = await saveAdminAnalyticsWindows(nextWindows);
      setWindows(saved);
    } catch (err: any) {
      setError(err?.message || (isHe ? 'שמירת החלון נכשלה' : 'Failed to save window'));
    } finally {
      setIsSavingWindows(false);
    }
  };

  const handleDeleteWindow = async (winId: string) => {
    const nextWindows = windows.filter((w) => w.id !== winId);
    setWindows(nextWindows);
    setIsSavingWindows(true);
    try {
      const saved = await saveAdminAnalyticsWindows(nextWindows);
      setWindows(saved);
    } catch (err: any) {
      setError(err?.message || (isHe ? 'מחיקת החלון נכשלה' : 'Failed to delete window'));
    } finally {
      setIsSavingWindows(false);
    }
  };

  if (!isOpen) return null;

  const formatNum = (val: number | null | undefined) =>
    typeof val === 'number' && Number.isFinite(val) ? val.toLocaleString(isHe ? 'he-IL' : 'en-US') : '—';

  const gaReady = Boolean(data?.ga?.configured && !data?.ga?.error);

  return (
    <div
      className="fixed inset-0 z-[180] bg-black/85 backdrop-blur-2xl flex items-center justify-center p-2 sm:p-5 overflow-hidden"
      dir={isHe ? 'rtl' : 'ltr'}
      onClick={onClose}
    >
      <div
        className="w-full max-w-6xl max-h-[94dvh] rounded-3xl bg-[#070b14]/95 border border-white/15 shadow-[0_25px_90px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-white/10 bg-white/[0.03] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold text-white truncate">
                {isHe ? 'ניהול צפיות Google Analytics ומשתמשים' : 'Google Analytics & Users Dashboard'}
              </h2>
              <p className="text-[11px] sm:text-xs text-white/60 truncate">
                {data?.ga?.updatedAt
                  ? isHe
                    ? `עדכון אחרון: ${new Date(data.ga.updatedAt).toLocaleString('he-IL')} • נסרקו ${formatNum(data.ga.totalRowsScanned)} נתיבי שירים (ללא מגבלת שירים)`
                    : `Last sync: ${new Date(data.ga.updatedAt).toLocaleString()} • Scanned ${formatNum(data.ga.totalRowsScanned)} song paths`
                  : isHe
                    ? 'צפיות שירים, חלונות צפייה ללא הגבלה, וניהול פרופילים'
                    : 'Song views, unlimited view windows, and user profiles'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => loadDashboard(true)}
              disabled={refreshing || loading}
              className="h-9 px-3.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold text-white flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{isHe ? 'רענן מ-Google Analytics' : 'Refresh GA4'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={isHe ? 'סגור' : 'Close'}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 flex items-center justify-center text-white cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-6 space-y-6">
          {loading && !data ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-white/70">
              <Loader2 className="w-7 h-7 animate-spin text-white" />
              <span className="text-sm font-medium">
                {isHe ? 'טוען נתוני Google Analytics ורשימת משתמשים...' : 'Loading Analytics & User Data...'}
              </span>
            </div>
          ) : (
            <>
              {error && (
                <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* GA4 Credentials Status Notice (if server env not configured yet) */}
              {data && !data.ga.configured && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-400/30 text-amber-100 text-xs space-y-1.5">
                  <div className="font-bold flex items-center gap-2 text-amber-200">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>
                      {isHe
                        ? 'חיבור קריאת הצפיות מ-Google Analytics עדיין לא הוגדר בשרת'
                        : 'Google Analytics Data API credentials are not configured on the server'}
                    </span>
                  </div>
                  <p className="text-amber-100/80 leading-relaxed">
                    {isHe
                      ? 'השליחה ל-Google Analytics (G-QMQF4QL9XX) כבר פעילה. כדי למשוך אוטומטית את מספרי הצפיות לתוך השירים והלוח הזה, הוסף במשתני השרת (Cloudflare Secrets) את מזהה הנכס GA_PROPERTY_ID ואת פרטי חשבון השירות (GA_SERVICE_ACCOUNT_JSON או GA_CLIENT_EMAIL + GA_PRIVATE_KEY) בעל הרשאת Viewer ב-GA4.'
                      : 'Configure GA_PROPERTY_ID and GA_SERVICE_ACCOUNT_JSON (or GA_CLIENT_EMAIL + GA_PRIVATE_KEY) in server secrets to display live GA4 counts.'}
                  </p>
                </div>
              )}

              {data?.ga?.configured && data?.ga?.error && (
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-400/30 text-amber-200 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>
                    {isHe ? `שגיאה במשיכה מ-Google Analytics: ${data.ga.error}` : `GA4 Error: ${data.ga.error}`}
                  </span>
                </div>
              )}

              {/* SUMMARY KPI CARDS */}
              {data && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  {/* Card 1: GA4 Total Views */}
                  <div className="p-4 rounded-2xl bg-white/[0.05] border border-white/15 space-y-1.5">
                    <div className="flex items-center justify-between text-white/60 text-xs font-bold">
                      <span>{isHe ? 'צפיות שירים (GA4)' : 'Song Views (GA4)'}</span>
                      <Eye className="w-4 h-4 text-sky-300" />
                    </div>
                    <div className="text-2xl font-black text-white">
                      {gaReady ? formatNum(totalCatalogGaViews) : '—'}
                    </div>
                    <div className="text-[11px] text-white/55">
                      {isHe
                        ? `סה״כ דפים באתר: ${gaReady ? formatNum(data.ga.gaTotalPageViews) : '—'}`
                        : `Total site views: ${gaReady ? formatNum(data.ga.gaTotalPageViews) : '—'}`}
                    </div>
                  </div>

                  {/* Card 2: Total GA4 Visitors + Realtime */}
                  <div className="p-4 rounded-2xl bg-white/[0.05] border border-white/15 space-y-1.5">
                    <div className="flex items-center justify-between text-white/60 text-xs font-bold">
                      <span>{isHe ? 'מבקרים באתר (GA4)' : 'Site Visitors (GA4)'}</span>
                      <TrendingUp className="w-4 h-4 text-emerald-300" />
                    </div>
                    <div className="text-2xl font-black text-white flex items-baseline gap-2">
                      <span>{gaReady ? formatNum(data.ga.gaTotalUsers) : '—'}</span>
                      {gaReady && (
                        <span className="text-[11px] font-bold text-emerald-300">
                          • {formatNum(data.ga.gaRealtimeActiveUsers)} {isHe ? 'אונליין' : 'live'}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-white/55">
                      {isHe
                        ? `פעילים: ${gaReady ? formatNum(data.ga.gaActiveUsers) : '—'} • חדשים: ${gaReady ? formatNum(data.ga.gaNewUsers) : '—'}`
                        : `Active: ${gaReady ? formatNum(data.ga.gaActiveUsers) : '—'}`}
                    </div>
                  </div>

                  {/* Card 3: Users With Profile + Active & 2+ Songs */}
                  <div className="p-4 rounded-2xl bg-white/[0.05] border border-white/15 space-y-1.5">
                    <div className="flex items-center justify-between text-white/60 text-xs font-bold">
                      <span>{isHe ? 'משתמשים עם פרופיל' : 'Users With Profile'}</span>
                      <Users className="w-4 h-4 text-white" />
                    </div>
                    <div className="text-2xl font-black text-white">
                      {formatNum(data.usersSummary.totalProfiles)}
                    </div>
                    <div className="text-[11px] text-emerald-200 font-medium flex flex-wrap gap-x-2">
                      <span>
                        {isHe ? `פעילים (1+): ${formatNum(data.usersSummary.activeProfiles)}` : `Active: ${formatNum(data.usersSummary.activeProfiles)}`}
                      </span>
                      <span className="text-sky-200">
                        {isHe ? `• מעל שיר אחד (2+): ${formatNum(data.usersSummary.multiTrackProfiles)}` : `• 2+ songs: ${formatNum(data.usersSummary.multiTrackProfiles)}`}
                      </span>
                    </div>
                  </div>

                  {/* Card 4: Hidden Profiles (0 Songs) */}
                  <div className="p-4 rounded-2xl bg-white/[0.05] border border-white/15 space-y-1.5">
                    <div className="flex items-center justify-between text-white/60 text-xs font-bold">
                      <span>{isHe ? 'פרופילים מוסתרים' : 'Hidden Profiles'}</span>
                      <EyeOff className="w-4 h-4 text-amber-300" />
                    </div>
                    <div className="text-2xl font-black text-amber-200">
                      {formatNum(data.usersSummary.hiddenProfiles)}
                    </div>
                    <div className="text-[11px] text-white/55">
                      {isHe ? 'פרופילים ללא אף שיר (מוסתרים באתר)' : '0 published tracks (hidden from feed)'}
                    </div>
                  </div>

                  {/* Card 5: Entered Without Profile */}
                  <div className="p-4 rounded-2xl bg-white/[0.05] border border-white/15 space-y-1.5">
                    <div className="flex items-center justify-between text-white/60 text-xs font-bold">
                      <span>{isHe ? 'נכנסו ללא פרופיל' : 'Entered Without Profile'}</span>
                      <UserX className="w-4 h-4 text-rose-300" />
                    </div>
                    <div className="text-2xl font-black text-white">
                      {gaReady ? formatNum(data.usersSummary.gaVisitorsWithoutProfile) : formatNum(data.usersSummary.signedInWithoutProfile)}
                    </div>
                    <div className="text-[11px] text-white/55">
                      {isHe
                        ? `התחברו עם Google ללא פרופיל: ${formatNum(data.usersSummary.signedInWithoutProfile)}`
                        : `Google signed-in no profile: ${formatNum(data.usersSummary.signedInWithoutProfile)}`}
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION 1: UNLIMITED SONG VIEW WINDOWS */}
              <section className="rounded-2xl bg-white/[0.04] border border-white/15 p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-sky-300" />
                      <span>{isHe ? 'חלונות צפיות שירים (ללא הגבלה)' : 'Song View Windows (Unlimited)'}</span>
                      <span className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] font-bold text-white/80">
                        {windows.length}
                      </span>
                    </h3>
                    <p className="text-xs text-white/55 mt-0.5">
                      {isHe
                        ? 'הוסף כמה חלונות מעקב שתרצה לפי שיר, אמן, סגנון או כל האתר — נשמר בענן ללא מגבלה.'
                        : 'Add unlimited custom view tracking windows by song, artist, genre, or catalog.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsAddWindowOpen((v) => !v)}
                    className="h-9 px-4 rounded-full bg-white hover:bg-neutral-200 text-black font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{isHe ? 'הוסף חלון צפיות' : 'Add View Window'}</span>
                  </button>
                </div>

                {isAddWindowOpen && (
                  <form
                    onSubmit={handleAddWindow}
                    className="p-4 rounded-2xl bg-black/50 border border-white/15 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
                  >
                    <div>
                      <label className="block text-[11px] font-bold text-white/70 mb-1">
                        {isHe ? 'סוג החלון' : 'Window Type'}
                      </label>
                      <select
                        value={newWinMode}
                        onChange={(e) => {
                          setNewWinMode(e.target.value as any);
                          setNewWinTarget('');
                        }}
                        className="w-full h-10 px-3 rounded-xl bg-white/10 border border-white/20 text-xs text-white focus:outline-none"
                      >
                        <option value="song" className="bg-[#0b101b] text-white">
                          {isHe ? 'שיר ספציפי' : 'Specific Song'}
                        </option>
                        <option value="artist" className="bg-[#0b101b] text-white">
                          {isHe ? 'לפי זמר / אמן' : 'By Artist'}
                        </option>
                        <option value="genre" className="bg-[#0b101b] text-white">
                          {isHe ? 'לפי סגנון' : 'By Genre'}
                        </option>
                        <option value="all" className="bg-[#0b101b] text-white">
                          {isHe ? 'מובילים מכל השירים' : 'Top Songs Overall'}
                        </option>
                      </select>
                    </div>

                    {newWinMode !== 'all' && (
                      <div>
                        <label className="block text-[11px] font-bold text-white/70 mb-1">
                          {newWinMode === 'song'
                            ? isHe
                              ? 'בחר שיר'
                              : 'Select Song'
                            : newWinMode === 'artist'
                              ? isHe
                                ? 'בחר אמן'
                                : 'Select Artist'
                              : isHe
                                ? 'בחר סגנון'
                                : 'Select Genre'}
                        </label>
                        <select
                          value={newWinTarget}
                          onChange={(e) => setNewWinTarget(e.target.value)}
                          required
                          className="w-full h-10 px-3 rounded-xl bg-white/10 border border-white/20 text-xs text-white focus:outline-none"
                        >
                          <option value="" className="bg-[#0b101b] text-white">
                            {isHe ? 'בחר מהרשימה...' : 'Choose...'}
                          </option>
                          {newWinMode === 'song' &&
                            songsList.map((s) => (
                              <option key={s.id} value={s.id} className="bg-[#0b101b] text-white">
                                {s.name} — {s.artistName}
                              </option>
                            ))}
                          {newWinMode === 'artist' &&
                            uniqueArtists.map((art) => (
                              <option key={art} value={art} className="bg-[#0b101b] text-white">
                                {art}
                              </option>
                            ))}
                          {newWinMode === 'genre' &&
                            uniqueGenres.map((g) => (
                              <option key={g} value={g} className="bg-[#0b101b] text-white">
                                {g}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] font-bold text-white/70 mb-1">
                        {isHe ? 'שם החלון (אופציונלי)' : 'Window Title (optional)'}
                      </label>
                      <input
                        type="text"
                        value={newWinTitle}
                        onChange={(e) => setNewWinTitle(e.target.value)}
                        placeholder={isHe ? 'לדוגמה: מעקב סינגל חדש...' : 'e.g. New Single Tracker'}
                        className="w-full h-10 px-3 rounded-xl bg-white/10 border border-white/20 text-xs text-white placeholder-white/40 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={isSavingWindows}
                        className="flex-1 h-10 px-4 rounded-xl bg-white hover:bg-neutral-200 text-black font-bold text-xs cursor-pointer transition-colors disabled:opacity-50"
                      >
                        {isSavingWindows
                          ? isHe
                            ? 'שומר...'
                            : 'Saving...'
                          : isHe
                            ? 'צור חלון'
                            : 'Create Window'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAddWindowOpen(false)}
                        className="h-10 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs cursor-pointer"
                      >
                        {isHe ? 'ביטול' : 'Cancel'}
                      </button>
                    </div>
                  </form>
                )}

                {windows.length === 0 ? (
                  <div className="p-6 rounded-2xl border border-dashed border-white/15 text-center text-xs text-white/55">
                    {isHe
                      ? 'טרם הוספת חלונות צפייה מותאמים אישית. לחץ על "הוסף חלון צפיות" למעלה כדי לפתוח כמה חלונות שתרצה.'
                      : 'No custom view windows yet. Click "Add View Window" to create unlimited windows.'}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {windows.map((win) => {
                      const metrics = computeWindowMetrics(win);
                      return (
                        <div
                          key={win.id}
                          className="p-4 rounded-2xl bg-black/45 border border-white/15 flex flex-col justify-between gap-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="inline-block px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-bold text-white/75 mb-1">
                                {win.mode === 'song'
                                  ? isHe
                                    ? 'שיר'
                                    : 'Song'
                                  : win.mode === 'artist'
                                    ? isHe
                                      ? 'אמן'
                                      : 'Artist'
                                    : win.mode === 'genre'
                                      ? isHe
                                        ? 'סגנון'
                                        : 'Genre'
                                      : isHe
                                        ? 'כל האתר'
                                        : 'All Catalog'}
                              </span>
                              <h4 className="text-sm font-bold text-white truncate">{win.title}</h4>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDeleteWindow(win.id)}
                              title={isHe ? 'מחק חלון' : 'Remove window'}
                              className="w-7 h-7 rounded-full bg-white/5 hover:bg-rose-500/25 text-white/60 hover:text-rose-200 flex items-center justify-center cursor-pointer transition-colors shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          <div className="flex items-baseline justify-between border-t border-white/10 pt-2.5">
                            <div>
                              <span className="text-[10px] text-white/55 block font-bold">
                                {isHe ? 'צפיות Google Analytics' : 'GA4 Views'}
                              </span>
                              <span className="text-xl font-black text-sky-200">
                                {gaReady ? formatNum(metrics.totalGaViews) : '—'}
                              </span>
                            </div>
                            <div className="text-end">
                              <span className="text-[10px] text-white/55 block font-bold">
                                {isHe ? 'שירים בחלון' : 'Tracks'}
                              </span>
                              <span className="text-sm font-bold text-white">
                                {formatNum(metrics.matchedSongs.length)}
                              </span>
                            </div>
                          </div>

                          {metrics.matchedSongs.length > 0 && win.mode !== 'song' && (
                            <div className="space-y-1 max-h-28 overflow-y-auto custom-scrollbar pt-1">
                              {metrics.matchedSongs.slice(0, 5).map((ms) => (
                                <div
                                  key={ms.id}
                                  className="flex items-center justify-between text-[11px] text-white/80 bg-white/[0.04] rounded-lg px-2 py-1 gap-2"
                                >
                                  <span className="truncate">{ms.name}</span>
                                  <span className="font-bold text-sky-200 shrink-0">
                                    {gaReady ? formatNum(ms.gaViews) : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* SECTION 2: ALL SONGS & GA4 VIEWS (UNLIMITED CATALOG) */}
              <section className="rounded-2xl bg-white/[0.04] border border-white/15 p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
                      <Music className="w-4 h-4 text-white" />
                      <span>{isHe ? 'צפיות כל השירים (Google Analytics)' : 'All Songs GA4 Views'}</span>
                      <span className="px-2 py-0.5 rounded-full bg-white/10 text-[11px] font-bold text-white/80">
                        {formatNum(sortedFilteredSongs.length)}
                      </span>
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-white/50 absolute top-1/2 -translate-y-1/2 start-3" />
                      <input
                        type="text"
                        value={songSearch}
                        onChange={(e) => {
                          setSongSearch(e.target.value);
                          setSongsVisibleLimit(50);
                        }}
                        placeholder={isHe ? 'חיפוש שיר או זמר...' : 'Search song or artist...'}
                        className="h-9 ps-8 pe-3 rounded-full bg-white/10 border border-white/20 text-xs text-white placeholder-white/45 focus:outline-none w-48 sm:w-56"
                      />
                    </div>
                    <select
                      value={songSort}
                      onChange={(e) => setSongSort(e.target.value as SongSortMode)}
                      className="h-9 px-3 rounded-full bg-white/10 border border-white/20 text-xs text-white focus:outline-none"
                    >
                      <option value="ga_views" className="bg-[#0b101b]">
                        {isHe ? 'מיין לפי צפיות GA4' : 'Sort: GA4 Views'}
                      </option>
                      <option value="plays" className="bg-[#0b101b]">
                        {isHe ? 'מיין לפי השמעות' : 'Sort: Plays'}
                      </option>
                      <option value="name" className="bg-[#0b101b]">
                        {isHe ? 'מיין לפי שם' : 'Sort: Name'}
                      </option>
                    </select>
                  </div>
                </div>

                {sortedFilteredSongs.length === 0 ? (
                  <div className="py-8 text-center text-xs text-white/55">
                    {isHe ? 'לא נמצאו שירים תואמים.' : 'No matching songs.'}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {sortedFilteredSongs.slice(0, songsVisibleLimit).map((song) => (
                        <div
                          key={song.id}
                          className="p-3 rounded-xl bg-black/45 border border-white/10 hover:border-white/25 transition-colors flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {song.coverUrl ? (
                              <img
                                src={song.coverUrl}
                                alt=""
                                loading="lazy"
                                className="w-10 h-10 rounded-lg object-cover shrink-0 bg-white/10"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                                <Disc className="w-4 h-4 text-white/60" />
                              </div>
                            )}
                            <div className="min-w-0">
                              {onOpenSongById ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    onOpenSongById(song.id);
                                  }}
                                  className="text-xs font-bold text-white hover:underline truncate block text-start cursor-pointer"
                                >
                                  {song.name}
                                </button>
                              ) : (
                                <div className="text-xs font-bold text-white truncate">{song.name}</div>
                              )}
                              <div className="text-[11px] text-white/55 truncate">
                                {song.artistName} • {song.genre || (isHe ? 'כללי' : 'General')}
                              </div>
                            </div>
                          </div>

                          <div className="text-end shrink-0">
                            <div className="text-sm font-black text-sky-200 flex items-center justify-end gap-1">
                              <Eye className="w-3.5 h-3.5 text-sky-300" />
                              <span>{gaReady ? formatNum(song.gaViews) : '—'}</span>
                            </div>
                            <div className="text-[10px] text-white/45">
                              {isHe ? `${formatNum(song.playsCount)} השמעות` : `${formatNum(song.playsCount)} plays`}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {sortedFilteredSongs.length > songsVisibleLimit && (
                      <div className="flex items-center justify-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setSongsVisibleLimit((n) => n + 100)}
                          className="h-9 px-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold text-white cursor-pointer"
                        >
                          {isHe
                            ? `הצג עוד (${Math.min(100, sortedFilteredSongs.length - songsVisibleLimit)})`
                            : 'Show more'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSongsVisibleLimit(sortedFilteredSongs.length)}
                          className="h-9 px-4 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold text-white cursor-pointer"
                        >
                          {isHe ? `הצג הכל (${sortedFilteredSongs.length})` : `Show all (${sortedFilteredSongs.length})`}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* SECTION 3: USERS & PROFILES BREAKDOWN */}
              {data && (
                <section className="rounded-2xl bg-white/[0.04] border border-white/15 p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm sm:text-base font-extrabold text-white flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-emerald-300" />
                        <span>{isHe ? 'פילוח פרופילים ומשתמשים' : 'Profiles & Visitors Breakdown'}</span>
                      </h3>
                      <p className="text-xs text-white/55 mt-0.5">
                        {isHe
                          ? 'פרופיל פעיל = בעל שיר אחד לפחות (מודגש גם מי שיש לו יותר משיר אחד). מוסתר = פרופיל עם 0 שירים.'
                          : 'Active = 1+ song (2+ highlighted). Hidden = 0 songs.'}
                      </p>
                    </div>

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-white/50 absolute top-1/2 -translate-y-1/2 start-3" />
                      <input
                        type="text"
                        value={profileSearch}
                        onChange={(e) => setProfileSearch(e.target.value)}
                        placeholder={isHe ? 'חיפוש משתמש או פרופיל...' : 'Search profile...'}
                        className="h-9 ps-8 pe-3 rounded-full bg-white/10 border border-white/20 text-xs text-white placeholder-white/45 focus:outline-none w-48 sm:w-56"
                      />
                    </div>
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      {
                        id: 'all' as ProfileFilterTab,
                        label: isHe
                          ? `כל הפרופילים (${formatNum(data.usersSummary.totalProfiles)})`
                          : `All (${formatNum(data.usersSummary.totalProfiles)})`,
                      },
                      {
                        id: 'active' as ProfileFilterTab,
                        label: isHe
                          ? `פעילים 1+ (${formatNum(data.usersSummary.activeProfiles)})`
                          : `Active 1+ (${formatNum(data.usersSummary.activeProfiles)})`,
                      },
                      {
                        id: 'multi' as ProfileFilterTab,
                        label: isHe
                          ? `מעל שיר אחד 2+ (${formatNum(data.usersSummary.multiTrackProfiles)})`
                          : `2+ Songs (${formatNum(data.usersSummary.multiTrackProfiles)})`,
                      },
                      {
                        id: 'hidden' as ProfileFilterTab,
                        label: isHe
                          ? `מוסתרים 0 שירים (${formatNum(data.usersSummary.hiddenProfiles)})`
                          : `Hidden 0 (${formatNum(data.usersSummary.hiddenProfiles)})`,
                      },
                      {
                        id: 'no_profile' as ProfileFilterTab,
                        label: isHe
                          ? `התחברו ללא פרופיל (${formatNum(data.usersSummary.signedInWithoutProfile)})`
                          : `No Profile (${formatNum(data.usersSummary.signedInWithoutProfile)})`,
                      },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setProfileTab(tab.id)}
                        className={`h-8 px-3.5 rounded-full text-xs font-bold transition-colors cursor-pointer border ${
                          profileTab === tab.id
                            ? 'bg-white text-black border-white'
                            : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/80 border-white/15'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {profileTab === 'no_profile' ? (
                    <div className="space-y-3">
                      {gaReady && (
                        <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-xs text-white/80">
                          {isHe
                            ? `סה״כ מבקרים ב-Google Analytics שנכנסו לאתר ללא פרופיל (מבקרים פחות פרופילים): ${formatNum(data.usersSummary.gaVisitorsWithoutProfile)}`
                            : `Total GA4 visitors without a profile: ${formatNum(data.usersSummary.gaVisitorsWithoutProfile)}`}
                        </div>
                      )}
                      {filteredNoProfileUsers.length === 0 ? (
                        <div className="py-6 text-center text-xs text-white/55">
                          {isHe
                            ? 'אין כרגע חשבונות Google שהתחברו ללא יצירת פרופיל.'
                            : 'No signed-in Google accounts without a profile yet.'}
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                          {filteredNoProfileUsers.map((u) => (
                            <div
                              key={u.uid}
                              className="p-3 rounded-xl bg-black/45 border border-white/10 flex items-center justify-between gap-3"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                {u.avatarUrl ? (
                                  <img
                                    src={u.avatarUrl}
                                    alt=""
                                    referrerPolicy="no-referrer"
                                    className="w-9 h-9 rounded-full object-cover shrink-0"
                                  />
                                ) : (
                                  <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0">
                                    {u.displayName?.[0] || 'G'}
                                  </div>
                                )}
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-white truncate">{u.displayName}</div>
                                  <div className="text-[10px] text-white/50 truncate">
                                    {u.lastSeenAt
                                      ? isHe
                                        ? `נראה לאחרונה: ${new Date(u.lastSeenAt).toLocaleDateString('he-IL')}`
                                        : new Date(u.lastSeenAt).toLocaleDateString()
                                      : u.uid}
                                  </div>
                                </div>
                              </div>
                              <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/30 text-[10px] font-bold text-rose-200 shrink-0">
                                {isHe ? 'ללא פרופיל' : 'No Profile'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : filteredProfiles.length === 0 ? (
                    <div className="py-6 text-center text-xs text-white/55">
                      {isHe ? 'לא נמצאו פרופילים בקטגוריה זו.' : 'No profiles found in this category.'}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                      {filteredProfiles.map((p) => (
                        <div
                          key={p.uid}
                          className="p-3 rounded-xl bg-black/45 border border-white/10 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {p.avatarUrl ? (
                              <img
                                src={p.avatarUrl}
                                alt=""
                                referrerPolicy="no-referrer"
                                className="w-9 h-9 rounded-full object-cover shrink-0 bg-white/10"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold shrink-0">
                                {p.name?.[0] || 'A'}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-white truncate">{p.name}</div>
                              <div className="text-[11px] text-white/55">
                                {isHe ? `${formatNum(p.tracksCount)} שירים` : `${formatNum(p.tracksCount)} songs`}
                                {gaReady ? ` • ${formatNum(p.totalGaViews)} ${isHe ? 'צפיות GA4' : 'views'}` : ''}
                              </div>
                            </div>
                          </div>

                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 border ${
                              p.isMultiTrack
                                ? 'bg-sky-500/20 border-sky-400/30 text-sky-200'
                                : p.isActive
                                  ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-200'
                                  : 'bg-amber-500/20 border-amber-400/30 text-amber-200'
                            }`}
                          >
                            {p.isMultiTrack
                              ? isHe
                                ? 'פעיל (2+)'
                                : 'Active (2+)'
                              : p.isActive
                                ? isHe
                                  ? 'פעיל'
                                  : 'Active'
                                : isHe
                                  ? 'מוסתר (0)'
                                  : 'Hidden (0)'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
