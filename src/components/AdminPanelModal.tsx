import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  ShieldAlert,
  Users,
  Music,
  CheckCircle2,
  Trash2,
  Eye,
  BarChart3,
  HardDrive,
  User,
  Mail,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, TrackReport, ArtistProfile, Language } from '../types';
import {
  getTrackReportsFromR2,
  dismissTrackReportInR2,
  deleteArtistAccountInAdmin,
  ContactMessageRecord,
  getContactMessagesInAdmin,
  dismissContactMessageInAdmin,
} from '../services/authService';
import {
  getCloudStorageConfig,
  calculateRealStorageUsage,
  getStreamingMediaUrl,
} from '../services/cloudStorageService';

interface AdminPanelModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  allTracks: JamendoTrack[];
  artistProfiles: ArtistProfile[];
  onAccountDeleted?: (uid: string) => void;
  initialTab?: 'accounts' | 'storage' | 'stats' | 'reports' | 'messages';
}

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  isOpen,
  onClose,
  lang,
  allTracks,
  artistProfiles,
  onAccountDeleted,
  initialTab = 'messages',
}) => {
  const isHe = lang === 'he';

  const [activeTab, setActiveTab] = useState<'storage' | 'accounts' | 'stats' | 'reports' | 'messages'>(initialTab);
  const [accountFilter, setAccountFilter] = useState<'all' | 'empty'>('all');
  const [reports, setReports] = useState<TrackReport[]>([]);
  const [contactMessages, setContactMessages] = useState<ContactMessageRecord[]>([]);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [accountActionError, setAccountActionError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const adminScrollRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (adminScrollRef.current) {
      adminScrollRef.current.scrollTop = 0;
    }
  }, [activeTab, isOpen]);

  const [cloudConfig] = useState(getCloudStorageConfig);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/storage/list?prefix=test')
      .then((r) => r.json())
      .then((data) => {
        if (data?.error) setConfigError(data.error);
        else setConfigError(null);
      })
      .catch(() => setConfigError('שגיאת תקשורת עם שרת האחסון'));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    const loadReportsAndMessages = async () => {
      const [r2Reports, r2Messages] = await Promise.all([
        getTrackReportsFromR2().catch(() => []),
        getContactMessagesInAdmin().catch(() => []),
      ]);
      if (active) {
        setReports(r2Reports);
        setContactMessages(r2Messages);
      }
    };
    loadReportsAndMessages().catch(() => {});
    return () => {
      active = false;
    };
  }, [isOpen]);

  const realStorageStats = useMemo(() => calculateRealStorageUsage(allTracks), [allTracks]);
  const realUsedMb = Math.round((cloudConfig.usedBytes + realStorageStats.usedBytes) / (1024 * 1024));
  const usedPercent = Math.min(100, Math.round((realUsedMb / cloudConfig.capacityMb) * 100));
  const uploadedTracksCount = useMemo(
    () => allTracks.filter((t) => t.id.startsWith('artist_track_') || t.uploadedByUid).length,
    [allTracks]
  );

  // Compute real song count per account UID (strict UID match first, name fallback only when UID missing)
  const accountsWithCounts = useMemo(() => {
    const uidCounts = new Map<string, number>();
    const nameCounts = new Map<string, number>();
    allTracks.forEach((t) => {
      const tUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
      const tName = (t.artistName || '').toLowerCase().trim();
      if (tUid) uidCounts.set(tUid, (uidCounts.get(tUid) || 0) + 1);
      if (tName) nameCounts.set(tName, (nameCounts.get(tName) || 0) + 1);
    });

    return artistProfiles.map((p) => {
      const cleanUid = (p.googleUid || p.id || '').replace(/^artist_/, '').trim();
      const lowerUid = cleanUid.toLowerCase();
      const lowerName = (p.name || '').toLowerCase().trim();
      const realCount = uidCounts.get(lowerUid) ?? (lowerName ? nameCounts.get(lowerName) || 0 : 0);
      return {
        profile: p,
        cleanUid,
        realCount,
      };
    });
  }, [artistProfiles, allTracks]);

  const publishedArtistsCount = useMemo(
    () => accountsWithCounts.filter((entry) => entry.realCount > 0).length,
    [accountsWithCounts]
  );

  const emptyAccountsCount = useMemo(
    () => accountsWithCounts.filter((entry) => entry.realCount === 0).length,
    [accountsWithCounts]
  );

  const visibleAccounts = useMemo(() => {
    if (accountFilter === 'empty') {
      return accountsWithCounts.filter((entry) => entry.realCount === 0);
    }
    return accountsWithCounts;
  }, [accountsWithCounts, accountFilter]);

  if (!isOpen) return null;

  const handleDismissReport = async (reportId: string) => {
    setReports((prev) => prev.filter((r) => r.id !== reportId));
    await Promise.allSettled([
      dismissTrackReportInR2(reportId),
      fetch(`/api/storage/delete?path=${encodeURIComponent(`reports/${reportId}.json`)}`, {
        method: 'DELETE',
        credentials: 'include',
      }).catch(() => {}),
    ]);
  };

  const handleDismissContactMessage = async (msgId: string) => {
    setContactMessages((prev) => prev.filter((m) => m.id !== msgId));
    await dismissContactMessageInAdmin(msgId).catch(() => false);
  };

  const handleDeleteAccount = async (uid: string) => {
    if (!uid) return;
    if (confirmDeleteUid !== uid) {
      setConfirmDeleteUid(uid);
      setAccountActionError(null);
      setTimeout(() => {
        setConfirmDeleteUid((cur) => (cur === uid ? null : cur));
      }, 4000);
      return;
    }

    setConfirmDeleteUid(null);
    setDeletingUid(uid);
    setAccountActionError(null);

    const res = await deleteArtistAccountInAdmin(uid);
    setDeletingUid(null);

    if (!res.success) {
      setAccountActionError(res.error || (isHe ? 'מחיקת החשבון נכשלה' : 'Account deletion failed'));
      return;
    }

    onAccountDeleted?.(uid);
  };

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[150] flex items-center justify-center p-3 sm:p-6 bg-black/95 backdrop-blur-3xl animate-fadeIn"
        dir={isHe ? 'rtl' : 'ltr'}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 20 }}
          className="relative w-full max-w-4xl bg-[#09090b] border border-white/20 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-white"
        >
          {/* ADMIN HEADER */}
          <div className="p-5 border-b border-white/10 flex items-center justify-between bg-neutral-950/90">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-2xl bg-white/10 text-white border border-white/20">
                <ShieldAlert className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-base font-normal text-white flex items-center gap-2">
                  <span>{isHe ? 'פאנל מנהל מערכת • Kolot Music' : 'System Admin Panel'}</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-white/15 text-white text-xs border border-white/25">
                    {isHe ? 'אחסון ענן פעיל' : 'Cloud Storage Active'}
                  </span>
                </h3>
                <p className="text-xs text-white/60">
                  {isHe
                    ? 'ניהול חשבונות, מצב אחסון ענן ודיווחים • עריכת ומחיקת שירים זמינה רק לבעל הפרופיל'
                    : 'Account management, cloud storage & reports • Songs can only be edited or removed by their owner'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* SUB TABS (NO SONG REMOVAL SCREEN) */}
          <div className="flex items-center gap-2 p-2 bg-neutral-950 border-b border-white/10 text-xs overflow-x-auto custom-scrollbar">
            <button
              type="button"
              onClick={() => setActiveTab('accounts')}
              className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'accounts'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/75 hover:text-white hover:bg-white/10'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>{isHe ? `ניהול חשבונות (${accountsWithCounts.length})` : `Accounts (${accountsWithCounts.length})`}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('storage')}
              className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'storage'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/75 hover:text-white hover:bg-white/10'
              }`}
            >
              <HardDrive className="w-4 h-4" />
              <span>{isHe ? 'מצב אחסון ענן' : 'Cloud Storage'}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('stats')}
              className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'stats'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/75 hover:text-white hover:bg-white/10'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>{isHe ? 'סטטיסטיקות אמת' : 'Analytics'}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('reports')}
              className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'reports'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/75 hover:text-white hover:bg-white/10'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>{isHe ? `דיווחים (${reports.length})` : `Reports (${reports.length})`}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('messages')}
              className={`flex-1 py-2.5 px-3 sm:px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
                activeTab === 'messages'
                  ? 'bg-white text-black shadow-md'
                  : 'text-white/75 hover:text-white hover:bg-white/10'
              }`}
            >
              <Mail className="w-4 h-4" />
              <span>{isHe ? `פניות (${contactMessages.length})` : `Inbox (${contactMessages.length})`}</span>
            </button>
          </div>

          {/* MAIN CONTENT */}
          <div
            ref={adminScrollRef}
            className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6 custom-scrollbar bg-[#09090b]"
          >
            <div key={activeTab} className="space-y-6 bg-[#09090b]">
            {/* TAB 1: ACCOUNT MANAGEMENT & DELETION */}
            {activeTab === 'accounts' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
                  <div>
                    <h4 className="text-sm text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-white" />
                      <span>{isHe ? 'ניהול ומחיקת חשבונות משתמשים' : 'User Account Management'}</span>
                    </h4>
                    <p className="text-xs text-white/55 mt-0.5">
                      {isHe
                        ? 'חשבונות ללא שירים מוסתרים אוטומטית מהקהל הרחב • ניתן למחוק חשבונות מכאן'
                        : 'Accounts with 0 songs are automatically hidden from public view • Delete accounts here'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAccountFilter('all')}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors cursor-pointer ${
                        accountFilter === 'all'
                          ? 'bg-white text-black border-white'
                          : 'bg-white/5 text-white/75 border-white/15 hover:bg-white/10'
                      }`}
                    >
                      {isHe ? `הכל (${accountsWithCounts.length})` : `All (${accountsWithCounts.length})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAccountFilter('empty')}
                      className={`px-3 py-1.5 rounded-full text-xs border transition-colors cursor-pointer ${
                        accountFilter === 'empty'
                          ? 'bg-amber-400 text-black border-amber-400'
                          : 'bg-white/5 text-white/75 border-white/15 hover:bg-white/10'
                      }`}
                    >
                      {isHe ? `חשבונות ריקים (${emptyAccountsCount})` : `Empty (${emptyAccountsCount})`}
                    </button>
                  </div>
                </div>

                {accountActionError && (
                  <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs">
                    {accountActionError}
                  </div>
                )}

                {visibleAccounts.length === 0 ? (
                  <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10 text-xs text-white/60 space-y-2">
                    <Users className="w-10 h-10 text-white/30 mx-auto" />
                    <p className="text-white">
                      {accountFilter === 'empty'
                        ? isHe
                          ? 'אין חשבונות ריקים (ללא שירים) במערכת.'
                          : 'No empty accounts found.'
                        : isHe
                        ? 'אין חשבונות רשומים כרגע.'
                        : 'No registered accounts found.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[55vh] overflow-y-auto custom-scrollbar p-1">
                    {visibleAccounts.map(({ profile, cleanUid, realCount }) => {
                      const avatar = profile.avatarUrl ? getStreamingMediaUrl(profile.avatarUrl) : '';
                      const isConfirming = confirmDeleteUid === cleanUid;
                      const isDeleting = deletingUid === cleanUid;

                      return (
                        <div
                          key={cleanUid || profile.name}
                          className="p-3.5 rounded-2xl bg-neutral-900/90 border border-white/10 hover:border-white/25 flex items-center justify-between gap-3 text-xs transition-all"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-full bg-neutral-800 overflow-hidden flex-shrink-0 border border-white/20 flex items-center justify-center">
                              {avatar ? (
                                <img
                                  src={avatar}
                                  alt={profile.name}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <User className="w-5 h-5 text-white/50" />
                              )}
                            </div>

                            <div className="min-w-0 space-y-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm text-white truncate">
                                  {profile.name || (isHe ? 'ללא שם' : 'Unnamed')}
                                </span>
                                {realCount === 0 ? (
                                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px]">
                                    {isHe ? '0 שירים • מוסתר מהקהל' : '0 songs • Hidden publicly'}
                                  </span>
                                ) : (
                                  <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/25 text-white text-[11px]">
                                    {realCount} {isHe ? 'שירים' : 'songs'}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-white/50 truncate" dir="ltr">
                                ID: {cleanUid}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => handleDeleteAccount(cleanUid)}
                              className={`px-3.5 py-2 rounded-xl text-xs transition-all cursor-pointer flex items-center gap-1.5 border disabled:opacity-50 ${
                                isConfirming
                                  ? 'bg-rose-600 hover:bg-rose-500 text-white border-rose-400 animate-pulse'
                                  : 'bg-rose-500/15 hover:bg-rose-600 text-rose-200 hover:text-white border-rose-500/30'
                              }`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>
                                {isDeleting
                                  ? isHe
                                    ? 'מוחק...'
                                    : 'Deleting...'
                                  : isConfirming
                                  ? isHe
                                    ? 'לחץ שוב לאישור מחיקה'
                                    : 'Confirm Delete'
                                  : isHe
                                  ? 'מחק חשבון'
                                  : 'Delete Account'}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: CLOUD STORAGE STATUS */}
            {activeTab === 'storage' && (
              <div className="space-y-6">
                {configError && (
                  <div className="p-4 rounded-2xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs text-center">
                    ⚠️ שגיאת הגדרת אחסון: {configError}
                  </div>
                )}
                <div className="p-5 rounded-3xl bg-neutral-900/90 border border-white/25 space-y-4 shadow-2xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-2xl bg-white/15 text-white border border-white/25">
                        <HardDrive className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="text-base text-white flex items-center gap-2">
                          <span>{isHe ? 'שרת אחסון ענן מאובטח' : 'Secure Cloud Storage'}</span>
                          <span className="px-2.5 py-0.5 rounded-full bg-white/15 text-white border border-white/25 text-[10px] flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-white" />
                            <span>{isHe ? 'מחובר ופעיל' : 'Connected'}</span>
                          </span>
                        </h4>
                        <p className="text-xs text-white/60 mt-0.5">
                          {isHe ? 'כל השירים והמדיה מאוחסנים בשרת מאובטח ומהיר' : 'All media stored on secure high-speed cloud server'}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-xs text-white/80 block">{isHe ? 'קיבולת אחסון:' : 'Storage Capacity:'}</span>
                      <span className="text-lg text-white">10 GB</span>
                    </div>
                  </div>

                  {/* STORAGE PROGRESS BAR */}
                  <div className="space-y-1.5 pt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white/90">
                        {isHe
                          ? `אחסון בשימוש: ${realUsedMb} MB מתוך 10,240 MB (${uploadedTracksCount} שירים)`
                          : `Used: ${realUsedMb} MB / 10,240 MB (${uploadedTracksCount} tracks)`}
                      </span>
                      <span className="text-white">{usedPercent}%</span>
                    </div>
                    <div className="w-full h-3.5 rounded-full bg-black/60 p-0.5 border border-white/10 relative overflow-hidden">
                      <div
                        className="h-full rounded-full bg-white transition-all duration-500"
                        style={{ width: `${Math.max(usedPercent, 1)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-xs space-y-2">
                  <h4 className="text-amber-300">{isHe ? 'מידע על האחסון והבעלות:' : 'Storage & Ownership Info:'}</h4>
                  <ul className="list-disc list-inside text-white/70 space-y-1 text-[11px]">
                    <li>{isHe ? 'האחסון פועל בתשתית ענן מאובטחת לאבטחה ומהירות מקסימלית.' : 'Storage powered by secure high-speed cloud infrastructure.'}</li>
                    <li>{isHe ? 'רק בעל הפרופיל המחובר יכול להוסיף, לערוך ולמחוק שירים בפרופיל שלו.' : 'Only the profile owner can add, edit, or delete songs on their profile.'}</li>
                    <li>{isHe ? 'פרופילים שלא העלו אפילו שיר אחד מוסתרים משאר המשתמשים.' : 'Profiles with 0 songs are hidden from other users.'}</li>
                  </ul>
                </div>
              </div>
            )}

            {/* TAB 3: REAL STATS */}
            {activeTab === 'stats' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="p-5 rounded-2xl bg-neutral-900/90 border border-white/15 space-y-2 shadow-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/75">{isHe ? 'סך הכל שירים בפלטפורמה' : 'Total Platform Songs'}</span>
                      <Music className="w-5 h-5 text-white/70" />
                    </div>
                    <div className="text-3xl text-white">{allTracks.length.toLocaleString()}</div>
                    <p className="text-[11px] text-white/50">{isHe ? 'זמינים להאזנה מיידית' : 'Available for streaming'}</p>
                  </div>

                  <div className="p-5 rounded-2xl bg-neutral-900/90 border border-white/15 space-y-2 shadow-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/85">{isHe ? 'פרופילי אמנים פעילים באתר' : 'Active Published Artists'}</span>
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-3xl text-white">{publishedArtistsCount}</div>
                    <p className="text-[11px] text-white/50">{isHe ? 'אמנים שהעלו לפחות שיר אחד' : 'Artists with at least 1 published track'}</p>
                  </div>

                  <div className="p-5 rounded-2xl bg-neutral-900/90 border border-white/15 space-y-2 shadow-xl">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-amber-300">{isHe ? 'חשבונות ריקים (ללא שירים)' : 'Empty Accounts'}</span>
                      <Eye className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="text-3xl text-white">{emptyAccountsCount}</div>
                    <p className="text-[11px] text-white/50">{isHe ? 'מוסתרים מהקהל הרחב' : 'Hidden from public browsing'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: REPORTS (DISMISS ONLY - NO ADMIN SONG DELETION) */}
            {activeTab === 'reports' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <h4 className="text-xs text-rose-300 flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-400" />
                    <span>{isHe ? 'דיווחים שהתקבלו מגולשים' : 'User Track Reports'}</span>
                  </h4>
                  <span className="text-xs text-rose-400">{reports.length} דיווחים</span>
                </div>

                {reports.length === 0 ? (
                  <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10 text-xs text-white/60 space-y-2">
                    <CheckCircle2 className="w-10 h-10 text-white mx-auto" />
                    <p className="text-white">{isHe ? 'אין דיווחים חדשים!' : 'No reported songs at this time!'}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {reports.map((report) => (
                      <div
                        key={report.id}
                        className="p-4 rounded-2xl bg-neutral-900 border border-rose-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm">{report.trackName}</span>
                            <span className="text-white/60">מאת</span>
                            <span className="text-amber-300">{report.artistName}</span>
                          </div>
                          <p className="text-rose-300">
                            {isHe ? 'סיבת הדיווח:' : 'Reason:'} {report.reason}
                          </p>
                          {report.details && <p className="text-white/70 text-[11px]">{report.details}</p>}
                          <span className="text-[10px] text-white/40 block">{report.reportedAt}</span>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDismissReport(report.id)}
                            className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/25 transition-all cursor-pointer"
                          >
                            {isHe ? 'אישור וביטול דיווח' : 'Dismiss'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: CONTACT & COMPLAINTS INBOX */}
            {activeTab === 'messages' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <h4 className="text-xs text-white flex items-center gap-2">
                    <Mail className="w-4 h-4 text-white" />
                    <span>{isHe ? 'פניות, תלונות ובקשות משתמשים' : 'User Inquiries & Complaints'}</span>
                  </h4>
                  <span className="text-xs text-white/60">
                    {contactMessages.length} {isHe ? 'פניות' : 'messages'}
                  </span>
                </div>

                {contactMessages.length === 0 ? (
                  <div className="p-8 text-center bg-white/5 rounded-2xl border border-white/10 text-xs text-white/60 space-y-2">
                    <CheckCircle2 className="w-10 h-10 text-white mx-auto" />
                    <p className="text-white">{isHe ? 'אין פניות חדשות בתיבה!' : 'No unread messages!'}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {contactMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className="p-4 rounded-2xl bg-neutral-900 border border-white/15 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs"
                      >
                        <div className="space-y-1.5 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {(msg.categoryLabel || msg.category) && (
                              <span className="px-2 py-0.5 rounded-full bg-white text-black font-bold text-[10px]">
                                {msg.categoryLabel || msg.category}
                              </span>
                            )}
                            <span className="text-white font-semibold text-sm">{msg.subject}</span>
                          </div>
                          <p className="text-white/75 font-mono text-[11px]" dir="ltr">
                            {msg.senderEmail}
                          </p>
                          <p className="text-white/90 text-xs whitespace-pre-wrap leading-relaxed bg-black/40 p-3 rounded-xl border border-white/10">
                            {msg.message}
                          </p>
                          <span className="text-[10px] text-white/40 block">
                            {msg.createdAt?.replace('T', ' ').substring(0, 19)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDismissContactMessage(msg.id)}
                            className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white border border-white/25 transition-all cursor-pointer"
                          >
                            {isHe ? 'סמן כטופל ומחק' : 'Mark Resolved'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
