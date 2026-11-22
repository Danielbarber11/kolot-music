import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Upload,
  Music,
  ShieldCheck,
  Check,
  LogOut,
  AlertCircle,
  FileAudio,
  FileImage,
  FolderUp,
  Settings,
  Plus,
  User,
  ArrowRight,
  ArrowLeft,
  Play,
  Disc,
  FolderPlus,
  Trash2,
  RefreshCw,
  Pencil,
  Edit3,
  Sparkles,
  Search,
  Keyboard,
  Mic2,
  Globe,
  Key,
  CheckCircle2,
  Cloud,
  Server,
  Captions,
  Loader2,
  Wand2,
  Mail,
  ShieldAlert,
  Paperclip,
  Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, ArtistProfile, Album, SubtitleSegment, TrackReport, CURRENT_TERMS_VERSION } from '../types';
import {
  AuthUser,
  getCurrentAuthUser,
  refreshCurrentAuthUser,
  loginWithGoogle,
  logoutUser,
  onAuthUserChanged,
  updateCurrentAuthUserProfile,
  restoreGoogleAvatarInCloud,
  deleteOwnAccountInCloud,
  getEffectiveUserAvatar,
  getGoogleAccountPhotoUrl,
  upgradeGooglePhotoQuality,
  ContactMessageRecord,
  getContactMessagesInAdmin,
  dismissContactMessageInAdmin,
  getTrackReportsFromR2,
  dismissTrackReportInR2,
  getAuthHeaders,
} from '../services/authService';
import {
  uploadTrackToCloud,
  deleteTrackFromCloud,
  uploadAlbumToCloud,
  deleteAlbumFromCloud,
  syncArtistAvatarToTracksInR2,
  getCloudStorageConfig,
  checkR2StorageStatus,
  getStreamingMediaUrl,
} from '../services/cloudStorageService';
import { TrackCoverArt } from './TrackCoverArt';
import { getTrackInstantColor, globalTrackColorCache, extractImageColor, useExtractedColor } from '../services/colorService';
import { sanitizeSubtitleLettersOnly } from '../services/onDeviceWhisperService';
import {
  startUploadPrefetchJob,
  getUploadPrefetchJob,
  attachUploadJobToPublishedTrack,
  stopUploadPrefetchJob,
  startProgressiveTrackSubtitleJob,
  ensureTrackSubtitlesInBackground,
  SubtitleDraftSnapshot,
} from '../services/backgroundSubtitleManager';
import { classifyTrackAudio, CANONICAL_GENRES, AudioClassificationResult } from '../services/audioClassificationService';
import { removeTrackFromStorage } from '../services/localTrackStorage';
import { markSongAsDeleted } from '../services/deletedTracksService';
import {
  getCachedAlbums,
  saveCachedAlbums,
  fetchAllRealSongs,
  getInstantSongPool,
  saveCachedCloudTracks,
  fetchAllArtistProfiles,
  getCachedArtistProfiles,
  getArtistAccountByUid,
  saveArtistAccountToR2,
  upsertMemoryArtistProfile,
  removeMemoryArtistProfile,
  updateMemoryTracksArtistAvatar,
  upsertTrackInMemory,
} from '../services/multiMusicService';
import { AlbumModal } from './AlbumModal';

interface ArtistPortalModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: Language;
  onTrackPublished: (track: JamendoTrack) => void;
  allTracks: JamendoTrack[];
  initialTab?: 'profile' | 'manual_upload' | 'account_settings' | 'albums';
  onPlayTrack?: (track: JamendoTrack) => void;
  onRemoveTrack?: (trackId: string) => void;
  onArtistUpdated?: (artist: ArtistProfile) => void;
  onAccountDeleted?: (deletedUid: string) => void;
  onOpenAdminPanel?: (tab?: 'accounts' | 'reports' | 'messages') => void;
}

export const ArtistPortalModal: React.FC<ArtistPortalModalProps> = (props) => {
  if (!props.isOpen) return null;
  return <ArtistPortalModalContent {...props} />;
};

const ArtistPortalModalContent: React.FC<ArtistPortalModalProps> = ({
  isOpen,
  onClose,
  lang,
  onTrackPublished,
  allTracks,
  initialTab = 'profile',
  onPlayTrack,
  onRemoveTrack,
  onArtistUpdated,
  onAccountDeleted,
  onOpenAdminPanel,
}) => {
  const isHe = lang === 'he';

  const [activeTab, setActiveTab] = useState<'profile' | 'manual_upload' | 'account_settings' | 'albums'>(initialTab);
  const portalScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (portalScrollRef.current) {
      portalScrollRef.current.scrollTop = 0;
    }
  }, [activeTab, isOpen]);

  const initialAuthUser = getCurrentAuthUser();
  const initialCachedProfile = initialAuthUser
    ? getCachedArtistProfiles().find(
        (p) => (p.googleUid || p.id || '').replace(/^artist_/, '') === initialAuthUser.uid
      )
    : undefined;

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => initialAuthUser);
  const [isAuthLoading, setIsAuthLoading] = useState(!initialAuthUser);
  const [authError, setAuthError] = useState<string | null>(null);

  const [currentArtist, setCurrentArtist] = useState<ArtistProfile>(() =>
    initialCachedProfile
      ? {
          ...initialCachedProfile,
          id: initialAuthUser?.uid || initialCachedProfile.id,
          googleUid: initialAuthUser?.uid || initialCachedProfile.googleUid,
        }
      : {
          id: initialAuthUser?.uid || 'artist_' + Date.now(),
          googleUid: initialAuthUser?.uid,
          name: initialAuthUser?.displayName || '',
          avatarUrl: initialAuthUser?.photoURL || undefined,
          genre: 'Pop',
          isConnected: !!initialAuthUser,
          isPrivate: !initialAuthUser,
          tracksCount: 0,
          joinedDate: new Date().getFullYear().toString(),
          providerPlatform: 'חשבון גוגל',
        }
  );
  const [isRestoringGoogleAvatar, setIsRestoringGoogleAvatar] = useState(false);

  const resolvedArtistName = currentArtist.name || currentUser?.displayName || (isHe ? 'אמן' : 'Artist');

  const [connectionCodeInput, setConnectionCodeInput] = useState(
    () => initialCachedProfile?.audiusHandle || initialCachedProfile?.connectionCode || ''
  );
  const [artistNameInput, setArtistNameInput] = useState(
    () => initialCachedProfile?.name || initialAuthUser?.displayName || ''
  );
  const [genreInput, setGenreInput] = useState('ללא סגנון מוזיקלי');
  const [artistBioInput, setArtistBioInput] = useState(() => initialCachedProfile?.bio || '');
  const [isPairing, setIsPairing] = useState(false);

  // Track upload inputs & metadata states
  const [songTitle, setSongTitle] = useState('');
  const [performingArtistInput, setPerformingArtistInput] = useState('');
  const [featuredArtistInput, setFeaturedArtistInput] = useState('');
  const [writersInput, setWritersInput] = useState('');
  const [audioStreamUrl, setAudioStreamUrl] = useState('');
  const [audioFileName, setAudioFileName] = useState('');
  const [coverArtUrl, setCoverArtUrl] = useState('');
  const [coverFileName, setCoverFileName] = useState('');
  const [albumTitle, setAlbumTitle] = useState('');
  const [whisperDraftSegments, setWhisperDraftSegments] = useState<SubtitleSegment[] | undefined>(undefined);
  const [whisperDraftSegmentsHe, setWhisperDraftSegmentsHe] = useState<SubtitleSegment[] | undefined>(undefined);
  const [whisperDraftSegmentsEn, setWhisperDraftSegmentsEn] = useState<SubtitleSegment[] | undefined>(undefined);
  const [whisperDraftSegmentsOrig, setWhisperDraftSegmentsOrig] = useState<SubtitleSegment[] | undefined>(undefined);
  const [whisperDraftLyricsHe, setWhisperDraftLyricsHe] = useState('');
  const [whisperDraftLyricsEn, setWhisperDraftLyricsEn] = useState('');
  const [whisperDraftLyricsOrig, setWhisperDraftLyricsOrig] = useState('');
  const [detectedSubLangCode, setDetectedSubLangCode] = useState<string | undefined>(undefined);
  const [detectedSubLangLabel, setDetectedSubLangLabel] = useState<string | undefined>(undefined);
  const [uploadSubPercent, setUploadSubPercent] = useState<number>(0);
  const [uploadSubComplete, setUploadSubComplete] = useState<boolean>(false);
  const [includeSubtitles, setIncludeSubtitles] = useState<boolean>(true);
  const [whisperUploadNotice, setWhisperUploadNotice] = useState<string | null>(null);
  const autoSubAbortRef = useRef<AbortController | null>(null);
  const autoSubJobIdRef = useRef<number>(0);
  const autoSubPromiseRef = useRef<Promise<SubtitleDraftSnapshot | null> | null>(null);
  const autoSubResultRef = useRef<SubtitleDraftSnapshot | null>(null);
  const uploadJobKeyRef = useRef<string>('');
  const includeSubtitlesRef = useRef<boolean>(true);
  const audioDurationRef = useRef<number>(180);
  const [isClassifyingGenre, setIsClassifyingGenre] = useState(false);
  const [genreProgressText, setGenreProgressText] = useState('');
  const [genreDetectionNotice, setGenreDetectionNotice] = useState<AudioClassificationResult | null>(null);
  const [audioUploadType, setAudioUploadType] = useState<'file' | 'url'>('file');
  const [coverUploadType, setCoverUploadType] = useState<'file' | 'url'>('file');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [publishProgressStep, setPublishProgressStep] = useState<string>('');
  const [uploadProgressPercent, setUploadProgressPercent] = useState<number>(0);
  const [publishErrorMessage, setPublishErrorMessage] = useState<string | null>(null);

  // Cloud Storage Status
  const [cloudConfig] = useState(getCloudStorageConfig);
  const [isCloudConnected] = useState<boolean>(true);

  // Cloudflare R2 Status (Checked 100% server-side)
  const [r2Status, setR2Status] = useState<{ configured: boolean; bucket?: string; error?: string }>({
    configured: true,
  });

  useEffect(() => {
    if (isOpen) {
      checkR2StorageStatus().then((status) => {
        setR2Status(status);
      });
    }
  }, [isOpen]);

  // Album creation extra states
  const [isSavingAlbum, setIsSavingAlbum] = useState<boolean>(false);
  const [albumErrorMessage, setAlbumErrorMessage] = useState<string | null>(null);
  const [rawAlbumCoverFile, setRawAlbumCoverFile] = useState<File | null>(null);
  const [albumCoverFileName, setAlbumCoverFileName] = useState<string>('');
  const [isAlbumCoverDragging, setIsAlbumCoverDragging] = useState<boolean>(false);


  // File upload refs & drag-and-drop states
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const albumCoverInputRef = useRef<HTMLInputElement>(null);
  const [rawAudioFile, setRawAudioFile] = useState<File | null>(null);
  const [rawCoverFile, setRawCoverFile] = useState<File | null>(null);
  const [isAudioDragging, setIsAudioDragging] = useState(false);
  const [isCoverDragging, setIsCoverDragging] = useState(false);
  const [artistAvatarFile, setArtistAvatarFile] = useState<File | null>(null);
  const [artistAvatarPreview, setArtistAvatarPreview] = useState<string | null>(
    () => initialCachedProfile?.avatarUrl || initialAuthUser?.photoURL || null
  );
  const [customGenreText, setCustomGenreText] = useState('');
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);
  const [selectedAudioDurationSec, setSelectedAudioDurationSec] = useState<number | null>(null);

  // 1GB file size limit + strict 5-minute (300s) song duration limit
  const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB
  const MAX_SONG_DURATION_SECONDS = 300; // 5 minutes max

  // Album creation song selector modal & search states
  const [isAlbumSongSelectorOpen, setIsAlbumSongSelectorOpen] = useState(false);
  const [albumSongSearchQuery, setAlbumSongSearchQuery] = useState('');

  // Mandatory upload copyright certification checkbox
  const [hasCertifiedRights, setHasCertifiedRights] = useState(false);

  // AI generation marker state
  const [isAiGeneratedInput, setIsAiGeneratedInput] = useState(false);
  const [editIsAiGenerated, setEditIsAiGenerated] = useState(false);

  // Song editing & deletion states
  const [editingTrack, setEditingTrack] = useState<JamendoTrack | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPerformingArtist, setEditPerformingArtist] = useState('');
  const [editFeaturedArtist, setEditFeaturedArtist] = useState('');
  const [editWriters, setEditWriters] = useState('');
  const [editGenre, setEditGenre] = useState('');
  const [editAlbum, setEditAlbum] = useState('');
  const [editIncludeSubtitles, setEditIncludeSubtitles] = useState<boolean>(true);
  const [editWhisperSegments, setEditWhisperSegments] = useState<SubtitleSegment[] | undefined>(undefined);
  const [editWhisperSegmentsHe, setEditWhisperSegmentsHe] = useState<SubtitleSegment[] | undefined>(undefined);
  const [editWhisperSegmentsEn, setEditWhisperSegmentsEn] = useState<SubtitleSegment[] | undefined>(undefined);
  const [editWhisperSegmentsOrig, setEditWhisperSegmentsOrig] = useState<SubtitleSegment[] | undefined>(undefined);
  const [editLyricsHe, setEditLyricsHe] = useState('');
  const [editLyricsEn, setEditLyricsEn] = useState('');
  const [editLyricsOrig, setEditLyricsOrig] = useState('');
  const [editDetectedLangCode, setEditDetectedLangCode] = useState<string | undefined>(undefined);
  const [editDetectedLangLabel, setEditDetectedLangLabel] = useState<string | undefined>(undefined);
  const [editSubComplete, setEditSubComplete] = useState<boolean>(false);
  const [isGeneratingEditSubs, setIsGeneratingEditSubs] = useState(false);
  const [editWhisperNotice, setEditWhisperNotice] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editSaveProgressText, setEditSaveProgressText] = useState<string>('');
  const [editProgressPercent, setEditProgressPercent] = useState<number>(0);
  const [deletedTrackIds, setDeletedTrackIds] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [adminMessages, setAdminMessages] = useState<ContactMessageRecord[]>([]);
  const [adminReports, setAdminReports] = useState<TrackReport[]>([]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    return () => {
      autoSubAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    includeSubtitlesRef.current = includeSubtitles;
  }, [includeSubtitles]);

  useEffect(() => {
    if (isOpen && currentUser?.isAdmin) {
      Promise.all([
        getContactMessagesInAdmin().catch(() => []),
        getTrackReportsFromR2().catch(() => []),
      ])
        .then(([msgs, reps]) => {
          setAdminMessages(msgs);
          setAdminReports(reps);
        })
        .catch(() => {});
    }
  }, [isOpen, activeTab, currentUser?.isAdmin]);

  const stopSilentAutoSubtitles = () => {
    autoSubJobIdRef.current += 1;
    autoSubAbortRef.current?.abort();
    autoSubAbortRef.current = null;
    autoSubPromiseRef.current = null;
    autoSubResultRef.current = null;
    setUploadSubComplete(false);
    setUploadSubPercent(0);
    if (uploadJobKeyRef.current) {
      stopUploadPrefetchJob(uploadJobKeyRef.current);
      uploadJobKeyRef.current = '';
    }
  };

  const applyDraftSnapshotToUploadState = (snap: SubtitleDraftSnapshot) => {
    if (!includeSubtitlesRef.current) return;
    autoSubResultRef.current = snap;
    if (typeof snap.percent === 'number') {
      setUploadSubPercent(snap.percent);
    }
    if (snap.isComplete) {
      setUploadSubComplete(true);
      setUploadSubPercent(100);
    }
    if (snap.segments.length > 0) {
      setWhisperDraftSegments(snap.segments);
      setWhisperDraftSegmentsHe(snap.segmentsHe);
      setWhisperDraftSegmentsEn(snap.segmentsEn);
      setWhisperDraftSegmentsOrig(snap.segmentsOrig);
      setWhisperDraftLyricsHe(snap.lyricsHe);
      setWhisperDraftLyricsEn(snap.lyricsEn);
      setWhisperDraftLyricsOrig(snap.lyricsOrig || '');
      setDetectedSubLangCode(snap.detectedLanguageCode);
      setDetectedSubLangLabel(snap.detectedLanguageLabel);
    }
  };

  const startSilentAutoSubtitles = (
    file?: File | null,
    urlFallback?: string,
    titleHint?: string
  ): Promise<SubtitleDraftSnapshot | null> => {
    stopSilentAutoSubtitles();
    if (!file && !urlFallback) return Promise.resolve(null);

    const jobId = ++autoSubJobIdRef.current;
    const key = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    uploadJobKeyRef.current = key;
    setWhisperUploadNotice(
      isHe
        ? 'מכין אוטומטית ברקע כתוביות מלאות ומסונכרנות לכל השיר...'
        : 'Generating full-song AI subtitles in background...'
    );

    const promise = startUploadPrefetchJob({
      key,
      audioFile: file || null,
      audioUrl: !file ? urlFallback : undefined,
      songTitle: titleHint || songTitle.trim(),
      artistName: performingArtistInput.trim() || currentArtist.name,
      duration: audioDurationRef.current || 180,
      language: isHe ? 'he' : 'en',
      onUpdate: (snap) => {
        if (jobId !== autoSubJobIdRef.current) return;
        applyDraftSnapshotToUploadState(snap);
        if (snap.progressText) {
          setWhisperUploadNotice(snap.progressText);
        }
      },
    }).then((finalSnap) => {
      if (jobId === autoSubJobIdRef.current && finalSnap) {
        applyDraftSnapshotToUploadState(finalSnap);
        setWhisperUploadNotice(
          isHe
            ? 'כתוביות מלאות ומסונכרנות מוכנות לשמירה לכל אורך השיר!'
            : 'Full-song subtitles ready!'
        );
      }
      return finalSnap;
    });

    autoSubPromiseRef.current = promise;
    return promise;
  };

  const canManageTrack = (track: JamendoTrack) => {
    if (!currentUser) return false;
    const cleanUserUid = (currentUser.uid || '').replace(/^artist_/, '').toLowerCase().trim();
    const cleanTrackUid = (track.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
    return !!(cleanTrackUid && cleanUserUid && cleanTrackUid === cleanUserUid);
  };

  const handleStartEditTrack = (track: JamendoTrack, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canManageTrack(track)) return;
    setEditingTrack(track);
    setEditTitle(track.name);
    setEditPerformingArtist(track.artistName || '');
    setEditFeaturedArtist(track.featuredArtist || '');
    setEditWriters(track.writers || '');
    setEditGenre(track.genre || 'Pop');
    setEditAlbum(track.albumName || '');
    setEditWhisperSegments(track.subtitleSegments);
    setEditWhisperSegmentsHe(track.subtitleSegmentsHe);
    setEditWhisperSegmentsEn(track.subtitleSegmentsEn);
    setEditWhisperSegmentsOrig(track.subtitleSegmentsOrig);
    setEditLyricsHe(track.lyricsHe || track.lyrics || '');
    setEditLyricsEn(track.lyricsEn || '');
    setEditLyricsOrig(track.lyricsOrig || '');
    setEditDetectedLangCode(track.detectedLanguageCode);
    setEditDetectedLangLabel(track.detectedLanguageLabel);
    const hasExistingSubs = !!(
      track.subtitleSegments?.length ||
      track.subtitleSegmentsHe?.length ||
      track.subtitleSegmentsEn?.length ||
      track.subtitleSegmentsOrig?.length
    );
    setEditSubComplete(hasExistingSubs && track.subtitlesIncomplete !== true);
    setIsGeneratingEditSubs(false);
    setEditSaveProgressText('');
    setEditProgressPercent(0);
    setEditIncludeSubtitles(track.subtitlesDisabled !== true);
    setEditWhisperNotice(null);
    setEditIsAiGenerated(!!track.isAiGenerated);
  };

  const applySavedTrackToEditUi = (savedTrack: JamendoTrack, snap?: SubtitleDraftSnapshot) => {
    const segs =
      snap && snap.segments.length >= (savedTrack.subtitleSegments?.length || 0)
        ? snap.segments
        : savedTrack.subtitleSegments;
    const segsHe =
      snap && snap.segmentsHe.length >= (savedTrack.subtitleSegmentsHe?.length || 0)
        ? snap.segmentsHe
        : savedTrack.subtitleSegmentsHe || segs;
    const segsEn =
      snap && snap.segmentsEn.length >= (savedTrack.subtitleSegmentsEn?.length || 0)
        ? snap.segmentsEn
        : savedTrack.subtitleSegmentsEn;
    const segsOrig =
      snap && snap.segmentsOrig && snap.segmentsOrig.length >= (savedTrack.subtitleSegmentsOrig?.length || 0)
        ? snap.segmentsOrig
        : savedTrack.subtitleSegmentsOrig;

    const mergedSavedTrack: JamendoTrack = {
      ...savedTrack,
      subtitleSegments: segs,
      subtitleSegmentsHe: segsHe,
      subtitleSegmentsEn: segsEn,
      subtitleSegmentsOrig: segsOrig,
      lyrics: snap?.lyrics || savedTrack.lyrics,
      lyricsHe: snap?.lyricsHe || savedTrack.lyricsHe,
      lyricsEn: snap?.lyricsEn || savedTrack.lyricsEn,
      lyricsOrig: snap?.lyricsOrig || savedTrack.lyricsOrig,
      detectedLanguageCode: snap?.detectedLanguageCode || savedTrack.detectedLanguageCode,
      detectedLanguageLabel: snap?.detectedLanguageLabel || savedTrack.detectedLanguageLabel,
      hasWhisperSubtitles: !!(segs?.length || segsHe?.length || segsEn?.length),
      subtitlesDisabled: false,
      subtitlesIncomplete: snap ? !snap.isComplete : savedTrack.subtitlesIncomplete,
      subtitlesCompletedUpTo: snap ? snap.completedUpTo : savedTrack.subtitlesCompletedUpTo,
    };

    const primaryTxt = mergedSavedTrack.lyricsHe || mergedSavedTrack.lyrics || mergedSavedTrack.lyricsEn || '';
    setEditWhisperSegments(segs);
    setEditWhisperSegmentsHe(segsHe);
    setEditWhisperSegmentsEn(segsEn);
    setEditWhisperSegmentsOrig(segsOrig);
    setEditLyricsHe(mergedSavedTrack.lyricsHe || primaryTxt);
    setEditLyricsEn(mergedSavedTrack.lyricsEn || '');
    setEditLyricsOrig(mergedSavedTrack.lyricsOrig || '');
    setEditDetectedLangCode(mergedSavedTrack.detectedLanguageCode);
    setEditDetectedLangLabel(mergedSavedTrack.detectedLanguageLabel);
    setEditSubComplete(
      !!(segs?.length || segsHe?.length || segsEn?.length) && mergedSavedTrack.subtitlesIncomplete !== true
    );
    upsertTrackInMemory(mergedSavedTrack);
    onTrackPublished(mergedSavedTrack);
    setEditingTrack((prev) => (prev && prev.id === mergedSavedTrack.id ? { ...prev, ...mergedSavedTrack } : prev));
  };

  const handleGenerateEditSubtitles = async () => {
    if (!editingTrack || !canManageTrack(editingTrack) || isGeneratingEditSubs) return;
    const resolvedAudioUrl = getStreamingMediaUrl(editingTrack.audioUrl);
    if (!resolvedAudioUrl) {
      setEditWhisperNotice(isHe ? 'לא נמצא קובץ שמע זמין לשיר זה' : 'No audio source available for this track');
      return;
    }

    setIsGeneratingEditSubs(true);
    setEditIncludeSubtitles(true);
    setEditSubComplete(false);
    setEditWhisperSegments(undefined);
    setEditWhisperSegmentsHe(undefined);
    setEditWhisperSegmentsEn(undefined);
    setEditWhisperSegmentsOrig(undefined);
    setEditWhisperNotice(
      isHe
        ? 'מייצר כתוביות מסונכרנות לכל השיר (100%) ושומר בענן...'
        : 'Generating full-song synchronized subtitles (100%) and saving to cloud...'
    );

    try {
      const targetTrackForJob: JamendoTrack = {
        ...editingTrack,
        name: editTitle.trim() || editingTrack.name,
        artistName: editPerformingArtist.trim() || editingTrack.artistName,
        subtitlesDisabled: false,
        subtitlesIncomplete: undefined,
        subtitlesCompletedUpTo: undefined,
        subtitleSegments: undefined,
        subtitleSegmentsHe: undefined,
        subtitleSegmentsEn: undefined,
        subtitleSegmentsOrig: undefined,
      };

      let latestSnap: SubtitleDraftSnapshot | null = null;
      await startProgressiveTrackSubtitleJob({
        track: targetTrackForJob,
        language: isHe ? 'he' : 'en',
        forceRestart: true,
        onProgress: (statusText) => {
          if (statusText) setEditWhisperNotice(statusText);
        },
        onBatchSaved: (savedTrack, snap) => {
          latestSnap = snap;
          applySavedTrackToEditUi(savedTrack, snap);
        },
      });

      if (latestSnap && (latestSnap as SubtitleDraftSnapshot).segments.length > 0) {
        setEditSubComplete(true);
        setEditWhisperNotice(
          isHe
            ? 'כתוביות מלאות (100% מהשיר) נוצרו ונשמרו בענן בהצלחה!'
            : 'Full-song subtitles (100%) generated & saved to cloud!'
        );
      } else {
        setEditWhisperNotice(
          isHe ? 'לא זוהו מילים בקובץ השמע ליצירת כתוביות' : 'No lyrics detected in audio'
        );
      }
    } catch (err: any) {
      setEditWhisperNotice(
        err?.message || (isHe ? 'שגיאה ביצירת הכתוביות' : 'Failed to generate subtitles')
      );
    } finally {
      setIsGeneratingEditSubs(false);
    }
  };

  const sanitizeMultilineLyrics = (raw: string) =>
    raw
      .split(/\r?\n/)
      .map((line) => sanitizeSubtitleLettersOnly(line))
      .filter(Boolean)
      .join('\n');

  const handleSaveEditTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrack || !canManageTrack(editingTrack) || isSavingEdit) return;
    setIsSavingEdit(true);
    setEditProgressPercent(10);
    setEditSaveProgressText(isHe ? 'שומר שינויים...' : 'Saving changes...');

    let nextSegments = editWhisperSegments;
    let nextSegmentsHe = editWhisperSegmentsHe;
    let nextSegmentsEn = editWhisperSegmentsEn;
    let nextSegmentsOrig = editIncludeSubtitles ? editWhisperSegmentsOrig : undefined;
    let nextLyricsHe = editIncludeSubtitles ? sanitizeMultilineLyrics((editLyricsHe || '').trim()) : '';
    let nextLyricsEn = editIncludeSubtitles ? sanitizeMultilineLyrics((editLyricsEn || '').trim()) : '';
    let nextLyricsOrig = editIncludeSubtitles && editLyricsOrig.trim() ? sanitizeMultilineLyrics(editLyricsOrig.trim()) : '';
    let nextDetectedCode = editIncludeSubtitles ? editDetectedLangCode : undefined;
    let nextDetectedLabel = editIncludeSubtitles ? editDetectedLangLabel : undefined;
    let completedFullSubs = editSubComplete;

    const resolvedAudioUrl = getStreamingMediaUrl(editingTrack.audioUrl);

    if (resolvedAudioUrl) {
      const needsFullSubs =
        editIncludeSubtitles &&
        (!completedFullSubs ||
          !(nextSegments?.length || nextSegmentsHe?.length || nextSegmentsEn?.length) ||
          editingTrack.subtitlesIncomplete === true ||
          editingTrack.subtitlesDisabled === true);

      if (needsFullSubs) {
        setEditProgressPercent(22);
        try {
          await startProgressiveTrackSubtitleJob({
            track: {
              ...editingTrack,
              name: editTitle.trim() || editingTrack.name,
              artistName: editPerformingArtist.trim() || editingTrack.artistName,
              subtitlesDisabled: false,
              subtitlesIncomplete: undefined,
              subtitlesCompletedUpTo: undefined,
            },
            language: isHe ? 'he' : 'en',
            forceRestart: true,
            onProgress: () => {
              setEditProgressPercent((p) => (p < 72 ? p + 6 : p));
            },
            onBatchSaved: (savedTrack, snap) => {
              nextSegments =
                snap.segments.length >= (savedTrack.subtitleSegments?.length || 0)
                  ? snap.segments
                  : savedTrack.subtitleSegments;
              nextSegmentsHe =
                snap.segmentsHe.length >= (savedTrack.subtitleSegmentsHe?.length || 0)
                  ? snap.segmentsHe
                  : savedTrack.subtitleSegmentsHe || savedTrack.subtitleSegments;
              nextSegmentsEn =
                snap.segmentsEn.length >= (savedTrack.subtitleSegmentsEn?.length || 0)
                  ? snap.segmentsEn
                  : savedTrack.subtitleSegmentsEn;
              nextSegmentsOrig =
                snap.segmentsOrig && snap.segmentsOrig.length >= (savedTrack.subtitleSegmentsOrig?.length || 0)
                  ? snap.segmentsOrig
                  : savedTrack.subtitleSegmentsOrig;
              nextLyricsHe = snap.lyricsHe || savedTrack.lyricsHe || savedTrack.lyrics || '';
              nextLyricsEn = snap.lyricsEn || savedTrack.lyricsEn || '';
              nextLyricsOrig = snap.lyricsOrig || savedTrack.lyricsOrig || '';
              nextDetectedCode = snap.detectedLanguageCode || savedTrack.detectedLanguageCode;
              nextDetectedLabel = snap.detectedLanguageLabel || savedTrack.detectedLanguageLabel;
              if (snap.isComplete) completedFullSubs = true;
              setEditProgressPercent((p) => Math.max(p, snap.isComplete ? 78 : 50));
            },
          });
        } catch {}
      }
    }

    setEditProgressPercent((p) => Math.max(p, 82));

    let nextGenre = editGenre.trim() || editingTrack.genre;
    if (!nextGenre || nextGenre === 'ללא סגנון מוזיקלי') {
      const combinedSubLyrics = [nextLyricsOrig, nextLyricsHe, nextLyricsEn].filter(Boolean).join('\n').trim();
      setEditSaveProgressText(isHe ? 'מנתח את השיר לבחירת הז׳אנר המתאים ביותר...' : 'Analyzing track for best AI genre...');
      try {
        const cls = await Promise.race([
          classifyTrackAudio({
            audioUrl: resolvedAudioUrl || undefined,
            songTitle: editTitle.trim() || editingTrack.name,
            artistName: editPerformingArtist.trim() || editingTrack.artistName,
            lyrics: combinedSubLyrics,
            deepClassify: true,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
        ]);
        if (cls?.success && cls.genre) {
          nextGenre = cls.genre;
        }
      } catch {}
    }

    const hasSubSegments =
      editIncludeSubtitles &&
      (!!(nextSegments && nextSegments.length > 0) ||
        !!(nextSegmentsHe && nextSegmentsHe.length > 0) ||
        !!(nextSegmentsEn && nextSegmentsEn.length > 0) ||
        !!(nextSegmentsOrig && nextSegmentsOrig.length > 0));

    const updatedTrack: JamendoTrack = {
      ...editingTrack,
      name: editTitle.trim() || editingTrack.name,
      artistName: editPerformingArtist.trim() || editingTrack.artistName,
      featuredArtist: editFeaturedArtist.trim() || undefined,
      writers: editWriters.trim() || undefined,
      genre: nextGenre,
      albumName: editAlbum.trim() || editingTrack.albumName,
      lyrics: editIncludeSubtitles ? (nextLyricsHe || nextLyricsEn || undefined) : undefined,
      lyricsHe: editIncludeSubtitles ? (nextLyricsHe || undefined) : undefined,
      lyricsEn: editIncludeSubtitles ? (nextLyricsEn || undefined) : undefined,
      lyricsOrig: editIncludeSubtitles ? (nextLyricsOrig || undefined) : undefined,
      subtitleSegments: hasSubSegments ? (nextSegments && nextSegments.length > 0 ? nextSegments : nextSegmentsHe) : undefined,
      subtitleSegmentsHe: hasSubSegments && nextSegmentsHe && nextSegmentsHe.length > 0 ? nextSegmentsHe : undefined,
      subtitleSegmentsEn: hasSubSegments && nextSegmentsEn && nextSegmentsEn.length > 0 ? nextSegmentsEn : undefined,
      subtitleSegmentsOrig: hasSubSegments && nextSegmentsOrig && nextSegmentsOrig.length > 0 ? nextSegmentsOrig : undefined,
      detectedLanguageCode: nextDetectedCode,
      detectedLanguageLabel: nextDetectedLabel,
      hasWhisperSubtitles: hasSubSegments,
      subtitlesIncomplete: editIncludeSubtitles ? false : undefined,
      subtitlesCompletedUpTo: hasSubSegments ? Math.round(editingTrack.duration || 180) : undefined,
      subtitlesDisabled: !editIncludeSubtitles,
      karaokeEnabled: false,
      karaokeAudioUrl: undefined,
      isAiGenerated: editIsAiGenerated,
    };

    // Apply edits immediately across the UI before waiting on R2 commit
    upsertTrackInMemory(updatedTrack);
    onTrackPublished(updatedTrack);

    setEditProgressPercent(92);
    try {
      await uploadTrackToCloud(updatedTrack);
    } catch (err) {
      console.warn('Cloud edit sync notice:', err);
    }

    setEditProgressPercent(100);
    setTimeout(() => {
      setEditSaveProgressText('');
      setEditProgressPercent(0);
      setIsSavingEdit(false);
      setEditingTrack(null);
    }, 350);
  };

  const handleDeleteTrack = async (track: JamendoTrack, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canManageTrack(track)) return;
    const trackId = track.id;

    // Safe inline confirmation without blocking window.confirm in iframe
    if (confirmDeleteId !== trackId) {
      setConfirmDeleteId(trackId);
      setTimeout(() => {
        setConfirmDeleteId((cur) => (cur === trackId ? null : cur));
      }, 4000);
      return;
    }

    // Mark permanently deleted across the whole app
    markSongAsDeleted(trackId, track.name, track.artistName);
    setConfirmDeleteId(null);
    setDeletedTrackIds((prev) => [...prev, trackId]);

    if (onRemoveTrack) {
      onRemoveTrack(trackId);
    }

    await Promise.allSettled([
      removeTrackFromStorage(trackId),
      deleteTrackFromCloud(trackId),
    ]);
  };

  // Album creation states
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumCover, setNewAlbumCover] = useState('');
  const [newAlbumDescription, setNewAlbumDescription] = useState('');
  const [selectedTrackIdsForAlbum, setSelectedTrackIdsForAlbum] = useState<string[]>([]);
  const [allAlbums, setAllAlbums] = useState<Album[]>(() => {
    const stored: Album[] = getCachedAlbums();

    const albumMap = new Map<string, Album>();
    stored.forEach((a) => {
      if (a.title && a.id) {
        const ownerKey = (a.uploadedByUid || a.artistId || '').replace(/^artist_/, '').toLowerCase().trim();
        albumMap.set(`${ownerKey}::${a.title.toLowerCase().trim()}`, a);
      }
    });

    const invalidNames = new Set(['single', 'single release', 'unknown album', 'סינגל', 'סינגל עצמאי', 'ללא אלבום', 'independent single', 'none']);

    allTracks.forEach((t) => {
      const cleanAlbum = (t.albumName || '').trim();
      const lower = cleanAlbum.toLowerCase();
      if (cleanAlbum && !invalidNames.has(lower) && !lower.startsWith('סינגל') && !lower.startsWith('single')) {
        const ownerKey = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
        const key = `${ownerKey}::${lower}`;
        if (!albumMap.has(key)) {
          albumMap.set(key, {
            id: `album-${t.id}`,
            title: cleanAlbum,
            artistName: t.artistName,
            artistId: t.uploadedByUid,
            uploadedByUid: t.uploadedByUid,
            coverUrl: t.coverUrl,
            trackIds: [t.id],
            createdDate: t.publishedDate || new Date().toISOString().split('T')[0],
          });
        } else {
          const alb = albumMap.get(key)!;
          if (!alb.trackIds.includes(t.id)) {
            alb.trackIds.push(t.id);
          }
          if (!alb.coverUrl && t.coverUrl) {
            alb.coverUrl = t.coverUrl;
          }
        }
      }
    });

    return Array.from(albumMap.values());
  });

  const canManageAlbum = (album: Album): boolean => {
    if (!currentUser?.uid) return false;
    const cleanUserUid = currentUser.uid.replace(/^artist_/, '').toLowerCase().trim();
    const albumOwnerUid = (album.uploadedByUid || album.artistId || '').replace(/^artist_/, '').toLowerCase().trim();
    if (albumOwnerUid) return albumOwnerUid === cleanUserUid;
    const myTrackIds = new Set(
      allTracks
        .filter((t) => (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim() === cleanUserUid)
        .map((t) => t.id)
    );
    const ids = (album.trackIds || []).filter(Boolean);
    return ids.length > 0 && ids.every((id) => myTrackIds.has(id));
  };

  const myAlbums = allAlbums.filter(canManageAlbum);
  const [selectedAlbumForView, setSelectedAlbumForView] = useState<Album | null>(null);
  const [editingAlbum, setEditingAlbum] = useState<Album | null>(null);

  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(true);
  const [customServerUrlInput, setCustomServerUrlInput] = useState('');

  useEffect(() => {
    const hydrateFields = (artist: ArtistProfile, user: AuthUser) => {
      setArtistNameInput(artist.name || user.displayName || '');
      if (artist.bio) setArtistBioInput(artist.bio);
      if (artist.audiusHandle || artist.connectionCode) {
        setConnectionCodeInput(artist.audiusHandle || artist.connectionCode || '');
      }
      if (artist.customServerUrl) setCustomServerUrlInput(artist.customServerUrl);
      const effAvatar = getEffectiveUserAvatar(user, artist);
      setArtistAvatarPreview(effAvatar || null);
    };

    const unsubscribe = onAuthUserChanged(async (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);

      if (user) {
        try {
          const remoteArtist = await getArtistAccountByUid(user.uid);
          const googlePhoto = getGoogleAccountPhotoUrl(user);
          if (remoteArtist) {
            const mergedAvatar = upgradeGooglePhotoQuality(remoteArtist.avatarUrl) || googlePhoto || undefined;
            const syncedArtist: ArtistProfile = {
              ...remoteArtist,
              avatarUrl: mergedAvatar,
              googleUid: user.uid,
            };
            setCurrentArtist(syncedArtist);
            upsertMemoryArtistProfile(syncedArtist);
            hydrateFields(syncedArtist, user);
            if (mergedAvatar && user.photoURL !== mergedAvatar) {
              updateCurrentAuthUserProfile({ displayName: syncedArtist.name, photoURL: mergedAvatar });
            }
          } else {
            const autoPrivateArtist: ArtistProfile = {
              id: user.uid,
              name: user.displayName || (isHe ? 'אמן חדש' : 'New Artist'),
              bio: isHe ? 'אמן עצמאי בפלטפורמת Kolot Music' : 'Independent artist on Kolot Music',
              avatarUrl: googlePhoto,
              joinedDate: new Date().getFullYear().toString(),
              googleUid: user.uid,
              isConnected: true,
              hasAcceptedTerms: false,
              termsVersionAccepted: 0,
              isPrivate: false,
              tracksCount: 0,
              providerPlatform: 'חשבון גוגל',
            };
            setCurrentArtist(autoPrivateArtist);
            upsertMemoryArtistProfile(autoPrivateArtist);
            hydrateFields(autoPrivateArtist, user);
          }
        } catch (e) {
          console.warn('Could not fetch artist profile from R2:', e);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setIsAuthLoading(true);
    try {
      const user = await loginWithGoogle();
      if (user) {
        if (!artistNameInput && user.displayName) {
          setArtistNameInput(user.displayName);
        }

        const googlePhoto = getGoogleAccountPhotoUrl(user);
        const existing = await getArtistAccountByUid(user.uid);
        if (existing) {
          const synced: ArtistProfile = {
            ...existing,
            avatarUrl: upgradeGooglePhotoQuality(existing.avatarUrl) || googlePhoto || undefined,
            googleUid: user.uid,
          };
          setCurrentArtist(synced);
          upsertMemoryArtistProfile(synced);
          if (synced.bio) setArtistBioInput(synced.bio);
          if (synced.avatarUrl) setArtistAvatarPreview(synced.avatarUrl);
        } else {
          const autoPrivateArtist: ArtistProfile = {
            id: user.uid,
            name: user.displayName || (isHe ? 'משתמש גוגל' : 'Google User'),
            bio: isHe ? 'אמן עצמאי בפלטפורמת Kolot Music' : 'Independent artist on Kolot Music',
            avatarUrl: googlePhoto,
            joinedDate: new Date().getFullYear().toString(),
            googleUid: user.uid,
            isConnected: true,
            hasAcceptedTerms: false,
            termsVersionAccepted: 0,
            isPrivate: false,
            tracksCount: 0,
            providerPlatform: 'חשבון גוגל',
          };
          setCurrentArtist(autoPrivateArtist);
          upsertMemoryArtistProfile(autoPrivateArtist);
          if (autoPrivateArtist.avatarUrl) setArtistAvatarPreview(autoPrivateArtist.avatarUrl);
        }
      }
    } catch (err: any) {
      console.error(err);
      setAuthError(
        isHe
          ? 'ההתחברות באמצעות Google נכשלה או בוטלה. נסה שוב.'
          : 'Google sign-in failed or was cancelled. Please try again.'
      );
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
    setConfirmDeleteAccount(false);
    setDeleteAccountError(null);
    onClose();
  };

  const handleDeleteOwnAccount = async () => {
    if (!currentUser || isDeletingAccount) return;
    setDeleteAccountError(null);
    setIsDeletingAccount(true);
    try {
      const deletedUid = currentUser.uid;
      await deleteOwnAccountInCloud();
      removeMemoryArtistProfile(deletedUid);
      setCurrentUser(null);
      setArtistAvatarPreview(null);
      setArtistAvatarFile(null);
      setConfirmDeleteAccount(false);
      onAccountDeleted?.(deletedUid);
      onClose();
    } catch (err: any) {
      setDeleteAccountError(
        err?.message || (isHe ? 'מחיקת החשבון נכשלה. נסה שוב.' : 'Failed to delete account. Please try again.')
      );
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const probeAudioDurationSeconds = (src: string): Promise<number | null> => {
    return new Promise((resolve) => {
      try {
        const probe = new Audio();
        probe.preload = 'metadata';
        let done = false;
        const finish = (val: number | null) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          probe.onloadedmetadata = null;
          probe.onerror = null;
          probe.src = '';
          resolve(val);
        };
        const timer = setTimeout(() => finish(null), 5000);
        probe.onloadedmetadata = () => {
          const d = probe.duration;
          finish(d && Number.isFinite(d) && d > 0 ? d : null);
        };
        probe.onerror = () => finish(null);
        probe.src = src;
      } catch {
        resolve(null);
      }
    });
  };

  const processAudioFile = (file: File) => {
    if (!file) return;
    setFileUploadError(null);
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileUploadError(isHe ? 'קובץ השמע חורג מ-1GB. יש לבחור קובץ עד 1GB.' : 'Audio file exceeds 1GB limit.');
      return;
    }

    const blobUrl = URL.createObjectURL(file);
    const cleanName = file.name.replace(/\.[^/.]+$/, '');
    audioDurationRef.current = 180;
    setSelectedAudioDurationSec(null);

    void probeAudioDurationSeconds(blobUrl).then((probedDur) => {
      if (probedDur !== null && probedDur > MAX_SONG_DURATION_SECONDS + 0.9) {
        stopSilentAutoSubtitles();
        try {
          URL.revokeObjectURL(blobUrl);
        } catch {}
        audioDurationRef.current = 180;
        setSelectedAudioDurationSec(null);
        setRawAudioFile(null);
        setAudioFileName('');
        setAudioStreamUrl('');
        setWhisperUploadNotice(null);
        if (audioInputRef.current) audioInputRef.current.value = '';
        setFileUploadError(
          isHe
            ? 'ניתן להעלות לאתר שירים באורך של עד 5 דקות בלבד (הקובץ שנבחר ארוך מ-5:00).'
            : 'Songs up to 5 minutes (5:00) max are allowed.'
        );
        return;
      }

      const validDur = probedDur !== null ? Math.max(10, Math.round(probedDur)) : 180;
      audioDurationRef.current = validDur;
      if (probedDur !== null) {
        setSelectedAudioDurationSec(Math.round(probedDur));
      }

      setRawAudioFile(file);
      setAudioFileName(file.name);
      setAudioStreamUrl(blobUrl);
      if (!songTitle.trim()) {
        setSongTitle(cleanName);
      }

      // Trigger invisible background subtitle generation once duration <= 5:00 is confirmed
      void startSilentAutoSubtitles(file, undefined, songTitle.trim() || cleanName);
    });
  };

  const processCoverFile = (file: File) => {
    if (!file) return;
    setFileUploadError(null);
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileUploadError(isHe ? 'קובץ התמונה חורג מ-1GB. יש לבחור תמונה עד 1GB.' : 'Cover image exceeds 1GB limit.');
      return;
    }
    setRawCoverFile(file);
    setCoverFileName(file.name);

    // Compress to crisp lightweight WebP/JPEG data URL (~600x600, ~80KB)
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 600;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          setCoverArtUrl(canvas.toDataURL('image/jpeg', 0.85));
        } else {
          setCoverArtUrl(typeof e.target?.result === 'string' ? e.target.result : '');
        }
      };
      img.onerror = () => {
        setCoverArtUrl(typeof e.target?.result === 'string' ? e.target.result : '');
      };
      img.src = typeof e.target?.result === 'string' ? e.target.result : '';
    };
    reader.readAsDataURL(file);
  };

  const processAlbumCoverFile = (file: File) => {
    if (!file) return;
    setAlbumErrorMessage(null);
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setAlbumErrorMessage(isHe ? 'קובץ התמונה חורג מ-1GB. יש לבחור תמונה קטנה יותר.' : 'Album cover file exceeds limit.');
      return;
    }
    setRawAlbumCoverFile(file);
    setAlbumCoverFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 600;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          setNewAlbumCover(canvas.toDataURL('image/jpeg', 0.85));
        } else {
          setNewAlbumCover(typeof e.target?.result === 'string' ? e.target.result : '');
        }
      };
      img.onerror = () => {
        setNewAlbumCover(typeof e.target?.result === 'string' ? e.target.result : '');
      };
      img.src = typeof e.target?.result === 'string' ? e.target.result : '';
    };
    reader.readAsDataURL(file);
  };

  const handleAlbumCoverFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processAlbumCoverFile(file);
  };

  const handleAlbumCoverDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsAlbumCoverDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(file.name))) {
      processAlbumCoverFile(file);
    }
  };

  const handleResetAlbumCover = () => {
    setRawAlbumCoverFile(null);
    setAlbumCoverFileName('');
    setNewAlbumCover('');
    if (albumCoverInputRef.current) albumCoverInputRef.current.value = '';
  };

  const handleStartEditAlbum = (album: Album) => {
    if (!canManageAlbum(album)) return;
    setEditingAlbum(album);
    setNewAlbumTitle(album.title);
    setNewAlbumCover(album.coverUrl || '');
    setRawAlbumCoverFile(null);
    setAlbumCoverFileName('');
    setNewAlbumDescription(album.description || '');
    setSelectedTrackIdsForAlbum(album.trackIds || []);
    setActiveTab('albums');
  };

  const handleCancelEditAlbum = () => {
    setEditingAlbum(null);
    setNewAlbumTitle('');
    setNewAlbumCover('');
    setRawAlbumCoverFile(null);
    setAlbumCoverFileName('');
    if (albumCoverInputRef.current) albumCoverInputRef.current.value = '';
    setNewAlbumDescription('');
    setSelectedTrackIdsForAlbum([]);
    setAlbumErrorMessage(null);
  };

  const handleDeleteAlbum = async (albumId: string) => {
    const target = allAlbums.find((a) => a.id === albumId);
    if (!target || !canManageAlbum(target)) return;
    const updated = allAlbums.filter((a) => a.id !== albumId);
    setAllAlbums(updated);
    saveCachedAlbums(updated);
    if (editingAlbum?.id === albumId) {
      handleCancelEditAlbum();
    }
    deleteAlbumFromCloud(albumId).catch((err) => {
      console.warn('Failed to delete album from cloud:', err);
    });
  };

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser?.uid) return;
    if (editingAlbum && !canManageAlbum(editingAlbum)) return;
    if (!newAlbumTitle.trim()) return;
    if (!newAlbumCover.trim() && !rawAlbumCoverFile) {
      setAlbumErrorMessage(isHe ? 'חובה להעלות תמונת עטיפה לאלבום מהמכשיר' : 'Album cover image upload is required');
      return;
    }

    setIsSavingAlbum(true);
    setAlbumErrorMessage(null);

    try {
      let album: Album;
      if (editingAlbum) {
        album = {
          ...editingAlbum,
          artistId: editingAlbum.artistId || currentUser.uid,
          uploadedByUid: editingAlbum.uploadedByUid || currentUser.uid,
          title: newAlbumTitle.trim(),
          coverUrl: newAlbumCover.trim() || undefined,
          description: newAlbumDescription.trim() || undefined,
          trackIds: selectedTrackIdsForAlbum,
        };
      } else {
        album = {
          id: `album_${Date.now()}`,
          title: newAlbumTitle.trim(),
          artistName: currentArtist.name || currentUser?.displayName || (isHe ? 'אמן' : 'Artist'),
          artistId: currentUser.uid,
          uploadedByUid: currentUser.uid,
          coverUrl: newAlbumCover.trim() || undefined,
          description: newAlbumDescription.trim() || undefined,
          trackIds: selectedTrackIdsForAlbum,
          createdDate: new Date().toISOString().split('T')[0],
        };
      }

      const res = await uploadAlbumToCloud(album, rawAlbumCoverFile || undefined);
      if (!res.success) {
        setAlbumErrorMessage(res.error || (isHe ? 'שגיאה בשמירת האלבום בענן.' : 'Failed to save album to cloud.'));
        setIsSavingAlbum(false);
        return;
      }

      if (res.coverUrl) {
        album.coverUrl = res.coverUrl;
      }

      const updatedAlbums = editingAlbum
        ? allAlbums.map((a) => (a.id === editingAlbum.id ? album : a))
        : [album, ...allAlbums];

      setAllAlbums(updatedAlbums);
      saveCachedAlbums(updatedAlbums);
      setEditingAlbum(null);
      setNewAlbumTitle('');
      setNewAlbumCover('');
      setNewAlbumDescription('');
      setRawAlbumCoverFile(null);
      setAlbumCoverFileName('');
      if (albumCoverInputRef.current) albumCoverInputRef.current.value = '';
      setSelectedTrackIdsForAlbum([]);
      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 2000);
    } catch (err: any) {
      setAlbumErrorMessage(err.message || String(err));
    } finally {
      setIsSavingAlbum(false);
    }
  };

  const compressAvatarBlob = (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          const maxDim = 512;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(file);
            return;
          }
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (blob) => resolve(blob || file),
            'image/jpeg',
            0.9
          );
        };
        img.onerror = () => resolve(file);
        img.src = typeof ev.target?.result === 'string' ? ev.target.result : '';
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  };

  const handleRestoreGoogleAvatar = async () => {
    if (!currentUser || isRestoringGoogleAvatar) return;

    setIsRestoringGoogleAvatar(true);
    setAuthError(null);

    try {
      const desiredName =
        artistNameInput.trim() || currentArtist.name || currentUser.displayName || (isHe ? 'אמן' : 'Artist');
      const restoreRes = await restoreGoogleAvatarInCloud(desiredName);
      if (!restoreRes.success || !restoreRes.avatarUrl) {
        setAuthError(
          restoreRes.error || (isHe ? 'לא נמצאה תמונת פרופיל בחשבון Google שלך.' : 'No Google profile photo found.')
        );
        return;
      }

      const uid = currentUser.uid;
      const canonicalAvatar = restoreRes.avatarUrl;
      const savedProfile: ArtistProfile = restoreRes.profile || {
        ...currentArtist,
        id: uid,
        googleUid: uid,
        name: desiredName,
        avatarUrl: canonicalAvatar,
        hasAcceptedTerms: currentArtist.hasAcceptedTerms ?? true,
        termsVersionAccepted: currentArtist.termsVersionAccepted ?? CURRENT_TERMS_VERSION,
        acceptedTermsAt: currentArtist.acceptedTermsAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isConnected: true,
        isPrivate: false,
      };

      setArtistAvatarFile(null);
      setCurrentArtist(savedProfile);
      setArtistAvatarPreview(canonicalAvatar);
      updateCurrentAuthUserProfile({ displayName: savedProfile.name, photoURL: canonicalAvatar });
      upsertMemoryArtistProfile(savedProfile);
      updateMemoryTracksArtistAvatar(uid, canonicalAvatar, savedProfile.name);
      onArtistUpdated?.(savedProfile);

      void Promise.allSettled([
        syncArtistAvatarToTracksInR2(uid, canonicalAvatar, allTracks, savedProfile.name),
        fetchAllArtistProfiles(),
      ]);

      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 2000);
    } catch (err: any) {
      setAuthError(err?.message || (isHe ? 'שחזור תמונת Google נכשל. נסה שוב.' : 'Failed to restore Google photo.'));
    } finally {
      setIsRestoringGoogleAvatar(false);
    }
  };

  const handleSaveArtistAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = currentArtist.name || currentUser?.displayName || artistNameInput.trim() || 'אמן מוזיקלי';
    if (!finalName) return;

    setIsPairing(true);
    setAuthError(null);

    try {
      const freshUser = getCurrentAuthUser() || currentUser;
      const googlePhoto = getGoogleAccountPhotoUrl(freshUser);
      const previewOrCurrent = artistAvatarPreview || currentArtist.avatarUrl || googlePhoto || undefined;

      const artistIdForUpload = currentUser ? currentUser.uid : currentArtist.id;
      let avatarBlobToUpload: Blob | undefined;
      if (artistAvatarFile) {
        avatarBlobToUpload = await compressAvatarBlob(artistAvatarFile);
      }

      const updatedArtistDraft: ArtistProfile = {
        ...currentArtist,
        id: artistIdForUpload,
        name: finalName,
        bio: currentArtist.bio || (isHe ? 'אמן עצמאי בפלטפורמה' : 'Independent artist'),
        avatarUrl: previewOrCurrent,
        genre: currentArtist.genre || 'Pop',
        googleUid: currentUser?.uid || currentArtist.googleUid || artistIdForUpload,
        isConnected: true,
        hasAcceptedTerms: true,
        termsVersionAccepted: currentArtist.termsVersionAccepted ?? CURRENT_TERMS_VERSION,
        acceptedTermsAt: currentArtist.acceptedTermsAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPrivate: false,
      };

      const saveRes = await saveArtistAccountToR2(
        updatedArtistDraft,
        avatarBlobToUpload,
        { purgeOldAvatars: !!avatarBlobToUpload }
      );
      if (!saveRes.success) {
        setAuthError(saveRes.error || (isHe ? 'שמירת הפרופיל באחסון הענן נכשלה.' : 'Failed to save profile to cloud storage.'));
        return;
      }

      const savedProfile: ArtistProfile = saveRes.profile || updatedArtistDraft;
      const finalAvatarUrl = savedProfile.avatarUrl || previewOrCurrent;

      if (finalAvatarUrl) {
        await extractImageColor(finalAvatarUrl).catch(() => {});
      }

      setCurrentArtist(savedProfile);
      setArtistAvatarFile(null);
      setArtistAvatarPreview(finalAvatarUrl || null);
      updateCurrentAuthUserProfile({
        displayName: savedProfile.name,
        photoURL: finalAvatarUrl || null,
      });
      upsertMemoryArtistProfile(savedProfile);
      updateMemoryTracksArtistAvatar(currentUser?.uid || artistIdForUpload, finalAvatarUrl, savedProfile.name);
      onArtistUpdated?.(savedProfile);

      void Promise.allSettled([
        syncArtistAvatarToTracksInR2(currentUser?.uid || artistIdForUpload, finalAvatarUrl, allTracks, savedProfile.name),
        fetchAllArtistProfiles(),
      ]);

      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 2500);
      setActiveTab('profile');
    } catch (err: any) {
      console.error(err);
      setAuthError(err?.message || (isHe ? 'שמירת ההגדרות נכשלה. נסה שוב.' : 'Failed to save settings.'));
    } finally {
      setIsPairing(false);
    }
  };

  const handleAudioFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processAudioFile(file);
    }
  };

  const handleCoverFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processCoverFile(file);
    }
  };

  const handleAudioDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsAudioDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(file.name))) {
      processAudioFile(file);
    }
  };

  const handleCoverDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsCoverDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(file.name))) {
      processCoverFile(file);
    }
  };

  const handleResetAudio = () => {
    stopSilentAutoSubtitles();
    audioDurationRef.current = 180;
    setSelectedAudioDurationSec(null);
    setRawAudioFile(null);
    setAudioFileName('');
    setAudioStreamUrl('');
    setWhisperUploadNotice(null);
    if (audioInputRef.current) audioInputRef.current.value = '';
  };

  const handleResetCover = () => {
    setRawCoverFile(null);
    setCoverFileName('');
    setCoverArtUrl('');
    if (coverInputRef.current) coverInputRef.current.value = '';
  };

  const handleAutoDetectGenre = async () => {
    if (!rawAudioFile && !audioStreamUrl.trim() && !songTitle.trim()) return;
    setIsClassifyingGenre(true);
    setGenreProgressText(isHe ? 'מנתח שמע על המכשיר (100% חינם)...' : 'Analyzing audio on device...');
    setGenreDetectionNotice(null);
    const combinedSubLyrics = includeSubtitles
      ? [whisperDraftLyricsOrig, whisperDraftLyricsHe, whisperDraftLyricsEn].filter(Boolean).join('\n').trim()
      : '';
    const result = await classifyTrackAudio({
      audioFile: rawAudioFile || undefined,
      audioUrl: !rawAudioFile ? audioStreamUrl.trim() : undefined,
      songTitle: songTitle.trim(),
      artistName: performingArtistInput.trim() || currentArtist.name,
      lyrics: combinedSubLyrics,
      deepClassify: true,
      onProgress: (txt) => setGenreProgressText(txt),
    });
    setIsClassifyingGenre(false);
    setGenreProgressText('');
    setGenreDetectionNotice(result);
    if (result.success && result.genre) {
      setGenreInput(result.genre);
    }
  };

  // Publish Track -> Direct, Verified Fast Commit to Public Cloud Storage
  const handlePublishTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPublishing || !currentArtist || !songTitle.trim() || !audioStreamUrl.trim() || !coverArtUrl.trim() || !hasCertifiedRights) return;

    setIsPublishing(true);
    setPublishErrorMessage(null);
    setUploadProgressPercent(4);
    setPublishProgressStep('');

    // Verify 5-minute max duration for both file uploads and direct URLs
    const probedDur = await probeAudioDurationSeconds(audioStreamUrl.trim()).catch(() => null);
    const checkedDur = probedDur !== null ? probedDur : (selectedAudioDurationSec ?? audioDurationRef.current);
    if (checkedDur > MAX_SONG_DURATION_SECONDS + 0.9) {
      setIsPublishing(false);
      setUploadProgressPercent(0);
      setPublishErrorMessage(
        isHe
          ? 'ניתן להעלות לאתר שירים באורך של עד 5 דקות בלבד.'
          : 'Only songs up to 5 minutes (5:00) can be uploaded.'
      );
      return;
    }
    if (probedDur !== null && probedDur > 0) {
      audioDurationRef.current = Math.max(10, Math.round(probedDur));
    }

    setUploadProgressPercent(6);

    let verifiedUser = getCurrentAuthUser() || currentUser;
    if (!verifiedUser?.uid) {
      verifiedUser = await refreshCurrentAuthUser();
      if (verifiedUser) {
        setCurrentUser(verifiedUser);
      }
    }
    if (!verifiedUser?.uid) {
      setIsPublishing(false);
      setUploadProgressPercent(0);
      setPublishErrorMessage(
        isHe
          ? 'לא זוהה חיבור פעיל לחשבון. אנא התחבר מחדש ונסה לפרסם שוב.'
          : 'No active account session found. Please sign in again and retry.'
      );
      return;
    }

    let effectiveGenre = genreInput === 'אחר' ? (customGenreText.trim() || (isHe ? 'שונות' : 'Other')) : genreInput;
    const isAutoGenreSelected = !effectiveGenre || effectiveGenre === 'ללא סגנון מוזיקלי';

    const trackId = `artist_track_${Date.now()}`;
    const tempTrackForColor: JamendoTrack = {
      id: trackId,
      name: songTitle,
      artistName: currentArtist.name,
      albumName: albumTitle || 'Single',
      duration: 180,
      audioUrl: audioStreamUrl,
      coverUrl: coverArtUrl,
      genre: effectiveGenre,
    };

    // Cover color extraction (capped at <= 250ms)
    let computedColor = getTrackInstantColor(tempTrackForColor);
    if (coverArtUrl.trim()) {
      try {
        const extractedBefore = await Promise.race([
          extractImageColor(coverArtUrl.trim()),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
        ]);
        if (extractedBefore) {
          computedColor = extractedBefore;
        }
      } catch {}
    }

    setUploadProgressPercent(10);
    const cachedBgColor = `radial-gradient(circle at 50% 35%, rgba(${computedColor.r}, ${computedColor.g}, ${computedColor.b}, 0.8) 0%, rgba(${Math.round(computedColor.r * 0.18)}, ${Math.round(computedColor.g * 0.18)}, ${Math.round(computedColor.b * 0.18)}, 0.96) 55%, #030712 100%)`;

    const updatedArtist: ArtistProfile = {
      ...currentArtist,
      id: verifiedUser.uid,
      googleUid: verifiedUser.uid,
      isPrivate: false,
      tracksCount: (currentArtist.tracksCount || 0) + 1,
    };
    setCurrentArtist(updatedArtist);

    const finalArtistName = performingArtistInput.trim() || currentArtist.name || verifiedUser.displayName || (isHe ? 'אמן' : 'Artist');

    let finalDraftSegments = whisperDraftSegments;
    let finalDraftSegmentsHe = whisperDraftSegmentsHe;
    let finalDraftSegmentsEn = whisperDraftSegmentsEn;
    let finalDraftLyricsHe = whisperDraftLyricsHe;
    let finalDraftLyricsEn = whisperDraftLyricsEn;
    const trackDurationSeconds = Math.max(10, Math.round(audioDurationRef.current || 180));
    let progressFloor = 15;

    let finalDraftSegmentsOrig: JamendoTrack['subtitleSegmentsOrig'] = whisperDraftSegmentsOrig;
    let finalDraftLyricsOrig = whisperDraftLyricsOrig;
    let finalDetectedLangCode: string | undefined = detectedSubLangCode;
    let finalDetectedLangLabel: string | undefined = detectedSubLangLabel;

    let uploadJobIsComplete = false;
    let uploadCompletedUpTo = 0;

    if (!includeSubtitles) {
      autoSubJobIdRef.current += 1;
      autoSubAbortRef.current?.abort();
      autoSubAbortRef.current = null;
      autoSubPromiseRef.current = null;
      autoSubResultRef.current = null;
      if (uploadJobKeyRef.current) {
        stopUploadPrefetchJob(uploadJobKeyRef.current);
        uploadJobKeyRef.current = '';
      }
      finalDraftSegments = undefined;
      finalDraftSegmentsHe = undefined;
      finalDraftSegmentsEn = undefined;
      finalDraftSegmentsOrig = undefined;
      finalDraftLyricsHe = '';
      finalDraftLyricsEn = '';
      finalDraftLyricsOrig = '';
      finalDetectedLangCode = undefined;
      finalDetectedLangLabel = undefined;

      // When AI Subtitles are OFF, run genuine AI audio classification (Gemini audio or full-chorus AST/DSP)
      if (isAutoGenreSelected) {
        setUploadProgressPercent(18);
        setPublishProgressStep(isHe ? 'הבינה המלאכותית בוחרת את הז׳אנר המתאים ביותר...' : 'AI selecting best matching genre...');
        try {
          const audioOnlyCls = await Promise.race([
            classifyTrackAudio({
              audioFile: rawAudioFile && rawAudioFile.size <= 15 * 1024 * 1024 ? rawAudioFile : undefined,
              audioUrl: !rawAudioFile ? audioStreamUrl.trim() : undefined,
              songTitle: songTitle.trim(),
              artistName: finalArtistName,
              lyrics: '',
              deepClassify: true,
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
          ]);
          if (audioOnlyCls?.success && audioOnlyCls.genre) {
            effectiveGenre = audioOnlyCls.genre;
          } else {
            const fastAudioCls = await classifyTrackAudio({
              songTitle: songTitle.trim(),
              artistName: finalArtistName,
              lyrics: '',
              deepClassify: false,
            });
            if (fastAudioCls.success && fastAudioCls.genre) {
              effectiveGenre = fastAudioCls.genre;
            }
          }
        } catch {}
      }
      progressFloor = 28;
      setUploadProgressPercent(28);
    } else {
      // Wait for AI Subtitles Model first so we have transcribed lyrics for Automatic Genre inference
      setUploadProgressPercent(14);

      let subPromise = autoSubPromiseRef.current;
      const existingSnap =
        (uploadJobKeyRef.current ? getUploadPrefetchJob(uploadJobKeyRef.current)?.snapshot : null) ||
        autoSubResultRef.current;

      if (!subPromise && !existingSnap?.isComplete) {
        subPromise = startSilentAutoSubtitles(
          rawAudioFile,
          !rawAudioFile ? audioStreamUrl.trim() : undefined,
          songTitle.trim()
        );
      }

      const finalSnap = subPromise ? await subPromise.catch(() => null) : existingSnap;
      const resolvedSnap = finalSnap || existingSnap;
      if (resolvedSnap && resolvedSnap.segments.length > 0) {
        finalDraftSegments = resolvedSnap.segments;
        finalDraftSegmentsHe = resolvedSnap.segmentsHe;
        finalDraftSegmentsEn = resolvedSnap.segmentsEn;
        finalDraftSegmentsOrig = resolvedSnap.segmentsOrig;
        finalDraftLyricsHe = resolvedSnap.lyricsHe;
        finalDraftLyricsEn = resolvedSnap.lyricsEn;
        finalDraftLyricsOrig = resolvedSnap.lyricsOrig || '';
        finalDetectedLangCode = resolvedSnap.detectedLanguageCode;
        finalDetectedLangLabel = resolvedSnap.detectedLanguageLabel;
        uploadJobIsComplete = !!resolvedSnap.isComplete;
        uploadCompletedUpTo = resolvedSnap.completedUpTo || trackDurationSeconds;
      }

      setUploadProgressPercent(40);

      // Automatic Genre using BOTH real audio + AI transcribed lyrics (generous timeout so AI picks accurately, never randomly)
      if (isAutoGenreSelected) {
        setPublishProgressStep(isHe ? 'הבינה המלאכותית בוחרת את הז׳אנר המתאים ביותר...' : 'AI selecting best matching genre...');
        const aiSubtitlesText = [finalDraftLyricsOrig, finalDraftLyricsHe, finalDraftLyricsEn]
          .filter(Boolean)
          .join('\n')
          .trim();
        try {
          const subGenreCls = await Promise.race([
            classifyTrackAudio({
              audioFile: rawAudioFile && rawAudioFile.size <= 15 * 1024 * 1024 ? rawAudioFile : undefined,
              audioUrl: !rawAudioFile ? audioStreamUrl.trim() : undefined,
              songTitle: songTitle.trim(),
              artistName: finalArtistName,
              lyrics: aiSubtitlesText,
              deepClassify: true,
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
          ]);
          if (subGenreCls?.success && subGenreCls.genre) {
            effectiveGenre = subGenreCls.genre;
          } else {
            const subLyricsOnlyCls = await classifyTrackAudio({
              songTitle: songTitle.trim(),
              artistName: finalArtistName,
              lyrics: aiSubtitlesText,
              deepClassify: false,
            });
            if (subLyricsOnlyCls.success && subLyricsOnlyCls.genre) {
              effectiveGenre = subLyricsOnlyCls.genre;
            }
          }
        } catch {}
      }

      progressFloor = 45;
      setUploadProgressPercent(45);
    }

    const sanitizedPrimaryHe = finalDraftLyricsHe ? sanitizeMultilineLyrics(finalDraftLyricsHe) : '';
    const sanitizedPrimaryEn = finalDraftLyricsEn ? sanitizeMultilineLyrics(finalDraftLyricsEn) : '';
    const sanitizedPrimaryOrig = finalDraftLyricsOrig ? sanitizeMultilineLyrics(finalDraftLyricsOrig) : '';

    const hasAnyDraftSubtitles =
      includeSubtitles &&
      (!!(finalDraftSegments && finalDraftSegments.length > 0) ||
        !!(finalDraftSegmentsHe && finalDraftSegmentsHe.length > 0) ||
        !!(finalDraftSegmentsEn && finalDraftSegmentsEn.length > 0) ||
        !!(finalDraftSegmentsOrig && finalDraftSegmentsOrig.length > 0));

    const newTrack: JamendoTrack = {
      id: trackId,
      name: songTitle.trim(),
      artistName: finalArtistName,
      featuredArtist: featuredArtistInput.trim() || undefined,
      writers: writersInput.trim() || undefined,
      albumName: albumTitle.trim() || (isHe ? 'סינגל עצמאי' : 'Independent Single'),
      duration: trackDurationSeconds,
      audioUrl: audioStreamUrl.trim(),
      coverUrl: coverArtUrl.trim(),
      genre: effectiveGenre,
      license: 'Kolot Music Cloud Storage (10GB)',
      licenseUrl: currentArtist.archiveAccountUrl || 'https://audius.co',
      source: 'Kolot Cloud Storage',
      legalStatus: '100% שיר עצמאי מקורי ומאושר להאזנה',
      lyrics: includeSubtitles ? (sanitizedPrimaryHe || sanitizedPrimaryEn || undefined) : undefined,
      lyricsHe: includeSubtitles ? (sanitizedPrimaryHe || undefined) : undefined,
      lyricsEn: includeSubtitles ? (sanitizedPrimaryEn || undefined) : undefined,
      lyricsOrig: includeSubtitles ? (sanitizedPrimaryOrig || undefined) : undefined,
      subtitleSegments: hasAnyDraftSubtitles ? (finalDraftSegments && finalDraftSegments.length > 0 ? finalDraftSegments : finalDraftSegmentsHe) : undefined,
      subtitleSegmentsHe: hasAnyDraftSubtitles && finalDraftSegmentsHe && finalDraftSegmentsHe.length > 0 ? finalDraftSegmentsHe : undefined,
      subtitleSegmentsEn: hasAnyDraftSubtitles && finalDraftSegmentsEn && finalDraftSegmentsEn.length > 0 ? finalDraftSegmentsEn : undefined,
      subtitleSegmentsOrig: hasAnyDraftSubtitles && finalDraftSegmentsOrig && finalDraftSegmentsOrig.length > 0 ? finalDraftSegmentsOrig : undefined,
      detectedLanguageCode: includeSubtitles ? finalDetectedLangCode : undefined,
      detectedLanguageLabel: includeSubtitles ? finalDetectedLangLabel : undefined,
      hasWhisperSubtitles: hasAnyDraftSubtitles,
      subtitlesIncomplete: includeSubtitles ? !uploadJobIsComplete && !hasAnyDraftSubtitles : false,
      ...(uploadCompletedUpTo > 0 ? { subtitlesCompletedUpTo: uploadCompletedUpTo } : {}),
      ...(includeSubtitles ? {} : { subtitlesDisabled: true }),
      karaokeEnabled: false,
      artistBio: currentArtist.bio,
      artistAvatarUrl: getEffectiveUserAvatar(verifiedUser, currentArtist) || undefined,
      publisherAccountUrl: currentArtist.archiveAccountUrl || 'https://audius.co',
      uploadedByUid: verifiedUser.uid,
      isPrivate: false,
      customServerUrl: customServerUrlInput.trim() || undefined,
      bgColor: cachedBgColor,
      isAiGenerated: isAiGeneratedInput,
    };

    const currentAudioFile = rawAudioFile;
    const currentCoverFile = rawCoverFile;
    const activeUploadJobKey = uploadJobKeyRef.current;

    try {
      setPublishProgressStep(isHe ? 'מעלה לאחסון האתר...' : 'Uploading to cloud storage...');

      // 1. DIRECT PARALLEL UPLOAD (audio + compressed cover + tracks/*.json)
      const cloudRes = await uploadTrackToCloud(
        newTrack,
        currentAudioFile || undefined,
        currentCoverFile || undefined,
        (pct, msg) => {
          setUploadProgressPercent(Math.max(progressFloor, pct));
          setPublishProgressStep(msg);
        }
      );

      if (!cloudRes.success) {
        setIsPublishing(false);
        setUploadProgressPercent(0);
        setPublishErrorMessage(
          cloudRes.error ||
            (isHe
              ? 'שגיאה בשמירת השיר באחסון הענן. אנא נסה שוב.'
              : 'Failed to publish track to cloud storage.')
        );
        return;
      }

      if (cloudRes.audioUrl) {
        newTrack.audioUrl = cloudRes.audioUrl;
      }
      if (cloudRes.coverUrl) {
        newTrack.coverUrl = cloudRes.coverUrl;
      }

      if (includeSubtitles && !uploadJobIsComplete && !hasAnyDraftSubtitles) {
        const attached = activeUploadJobKey
          ? attachUploadJobToPublishedTrack(activeUploadJobKey, newTrack)
          : false;
        if (!attached) {
          void ensureTrackSubtitlesInBackground(newTrack, isHe ? 'he' : 'en');
        }
      }

      // Pre-cache color under both track ID and final cover URL
      globalTrackColorCache.set(newTrack.id, computedColor);
      if (newTrack.coverUrl) {
        globalTrackColorCache.set(newTrack.coverUrl, computedColor);
      }

      // 2. Sync artist profile
      void saveArtistAccountToR2(updatedArtist).catch(() => {});

      // 3. Broadcast track immediately to UI
      upsertTrackInMemory(newTrack);
      onTrackPublished(newTrack);
      void fetchAllRealSongs().catch(() => {});
      void fetchAllArtistProfiles().catch(() => {});

      setUploadProgressPercent(100);
      setPublishProgressStep(isHe ? 'השיר נשמר ופורסם במלואו בענן!' : 'Track published & saved to cloud!');
      setPublishSuccess(true);

      // Reset form state cleanly
      stopSilentAutoSubtitles();
      audioDurationRef.current = 180;
      setSongTitle('');
      setPerformingArtistInput('');
      setFeaturedArtistInput('');
      setWritersInput('');
      setAudioStreamUrl('');
      setAudioFileName('');
      setCoverArtUrl('');
      setCoverFileName('');
      setRawAudioFile(null);
      setRawCoverFile(null);
      setAlbumTitle('');
      setIsAiGeneratedInput(false);
      setIncludeSubtitles(true);
      setWhisperDraftSegments(undefined);
      setWhisperDraftSegmentsHe(undefined);
      setWhisperDraftSegmentsEn(undefined);
      setWhisperDraftSegmentsOrig(undefined);
      setWhisperDraftLyricsHe('');
      setWhisperDraftLyricsEn('');
      setWhisperDraftLyricsOrig('');
      setDetectedSubLangCode(undefined);
      setDetectedSubLangLabel(undefined);
      setWhisperUploadNotice(null);
      setGenreDetectionNotice(null);
      setGenreInput('ללא סגנון מוזיקלי');
      setCustomGenreText('');
      setHasCertifiedRights(false);

      setTimeout(() => {
        setPublishSuccess(false);
        setIsPublishing(false);
        setPublishProgressStep('');
        setActiveTab('profile');
      }, 1200);
    } catch (publishErr: any) {
      console.error('Publishing error:', publishErr);
      setIsPublishing(false);
      setPublishErrorMessage(publishErr.message || (isHe ? 'שגיאה בשמירה. נסה שוב.' : 'Failed to publish.'));
    }
  };

  const myUploadedTracks = allTracks.filter((t) => {
    if (deletedTrackIds.includes(t.id)) return false;
    if (!currentUser) return false;
    const cleanUserUid = (currentUser.uid || '').replace(/^artist_/, '').toLowerCase().trim();
    const cleanTrackUid = (t.uploadedByUid || '').replace(/^artist_/, '').toLowerCase().trim();
    return !!(cleanTrackUid && cleanUserUid && cleanTrackUid === cleanUserUid);
  });

  const activeAvatar = artistAvatarPreview || getEffectiveUserAvatar(currentUser, currentArtist);
  const profileThemeColor = useExtractedColor(activeAvatar, currentArtist.genre || 'Pop');

  if (!currentUser) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="fixed inset-0 z-[130] w-full h-[100dvh] bg-[#070b14]/95 backdrop-blur-3xl overflow-y-auto text-white flex flex-col items-center justify-start sm:justify-center p-4 pt-16 sm:p-6"
          dir={isHe ? 'rtl' : 'ltr'}
        >
          <button
            onClick={onClose}
            className="absolute top-5 end-5 sm:top-6 sm:end-6 w-11 h-11 rounded-full flex items-center justify-center text-white border border-white/25 bg-slate-900/80 hover:bg-white/10 transition-all cursor-pointer shadow-2xl"
            title={isHe ? 'סגור' : 'Close'}
          >
            <X className="w-5 h-5 text-white/80" />
          </button>

          <div className="w-full max-w-md bg-[#0b0d12] border border-white/15 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6 animate-fadeIn my-auto">
            <div className="w-20 h-20 rounded-3xl bg-neutral-900 border border-white/20 text-white flex items-center justify-center mx-auto shadow-2xl">
              <User className="w-10 h-10 text-white/60" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white tracking-tight">
                {isHe ? 'התחברות ל-Kolot Music' : 'Sign in to Kolot Music'}
              </h2>
              <p className="text-xs text-white/70 leading-relaxed font-medium">
                {isHe
                  ? 'חשבון ה-Google שלך הוא הפרופיל האישי שלך בפלטפורמה. התחבר כדי להעלות שירים, ליצור אלבומים ולנהל את המוזיקה שלך.'
                  : 'Your Google Account is your personal profile. Sign in to upload tracks, create albums, and manage your music.'}
              </p>
            </div>

            {authError && (
              <div className="p-3.5 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-bold text-center">
                {authError}
              </div>
            )}

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isAuthLoading}
              className="w-full py-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-950 font-black text-sm transition-all shadow-2xl cursor-pointer flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 disabled:opacity-50"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{isHe ? 'המשך עם Google' : 'Continue with Google'}</span>
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        ref={portalScrollRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={`fixed inset-0 z-[140] w-full h-[100dvh] ${
          activeTab === 'manual_upload' || activeTab === 'albums' ? 'bg-black' : 'bg-[#070b14]'
        } overflow-y-auto text-white custom-scrollbar flex flex-col`}
        dir={isHe ? 'rtl' : 'ltr'}
      >
        {/* FLOATING TOP CONTROL BAR (HIDDEN IN FULL-SCREEN MANUAL UPLOAD) */}
        {activeTab !== 'manual_upload' && (
          <div className="fixed top-4 left-4 right-4 sm:top-6 sm:left-6 sm:right-6 z-50 pointer-events-none flex items-center justify-between gap-3">
          <div className="pointer-events-auto">
            {activeTab !== 'profile' ? (
              <button
                onClick={() => setActiveTab('profile')}
                className="px-4 py-2 rounded-full flex items-center gap-2 text-xs sm:text-sm font-semibold text-white border border-white/20 bg-white/10 hover:bg-white/20 backdrop-blur-xl shadow-xl cursor-pointer active:scale-95 transition-all"
              >
                {isHe ? <ArrowRight className="w-4 h-4 text-white" /> : <ArrowLeft className="w-4 h-4 text-white" />}
                <span>{isHe ? 'חזור' : 'Back'}</span>
              </button>
            ) : (
              <button
                onClick={onClose}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-white border border-white/20 bg-white/10 hover:bg-white/20 backdrop-blur-xl shadow-xl cursor-pointer hover:bg-white/20 active:scale-95 transition-all"
                title={isHe ? 'יציאה' : 'Exit'}
              >
                <X className="w-5 h-5 text-white" />
              </button>
            )}
          </div>

          <div className="pointer-events-auto flex items-center gap-2 sm:gap-3">
            {currentUser?.isAdmin && onOpenAdminPanel && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAdminPanel(adminReports.length > 0 && adminMessages.length === 0 ? 'reports' : 'messages');
                }}
                className="h-10 sm:h-11 px-3.5 rounded-full flex items-center gap-2 text-xs font-bold text-white border border-white/25 bg-white/15 hover:bg-white/25 backdrop-blur-xl shadow-lg cursor-pointer transition-all"
                title={isHe ? 'דיווחים והודעות (מנהל בלבד)' : 'Reports & Messages (Admin Only)'}
              >
                <ShieldAlert className="w-4 h-4 text-white" />
                <span>{isHe ? 'דיווחים והודעות' : 'Reports'}</span>
                {adminMessages.length + adminReports.length > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-white text-black text-[10px] font-mono leading-none">
                    {adminMessages.length + adminReports.length}
                  </span>
                )}
              </button>
            )}
            {activeTab !== 'account_settings' && (
              <button
                onClick={() => setActiveTab('account_settings')}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg backdrop-blur-xl border bg-white/10 hover:bg-white/20 text-white border-white/20"
                title={isHe ? 'הגדרות' : 'Settings'}
              >
                <Settings className="w-5 h-5 text-white" />
              </button>
            )}
          </div>
        </div>
        )}

        {/* 1. PUBLIC ARTIST PROFILE SCREEN - SEAMLESS AMBIENT HEADER BLEND, ZERO DIVIDER LINE */}
        {activeTab === 'profile' && (
          <div key="portal-tab-profile" className="relative w-full flex-1 flex flex-col bg-[#070b14]">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-[330px] sm:h-[370px] transition-all duration-500"
              style={{
                background: `radial-gradient(ellipse 85% 65% at 50% 0%, rgba(${profileThemeColor.r}, ${profileThemeColor.g}, ${profileThemeColor.b}, 0.5) 0%, rgba(${profileThemeColor.r}, ${profileThemeColor.g}, ${profileThemeColor.b}, 0.22) 45%, rgba(7, 11, 20, 0) 100%), linear-gradient(180deg, rgba(${profileThemeColor.r}, ${profileThemeColor.g}, ${profileThemeColor.b}, 0.34) 0%, rgba(${profileThemeColor.r}, ${profileThemeColor.g}, ${profileThemeColor.b}, 0.1) 58%, rgba(7, 11, 20, 0) 100%)`,
              }}
            />

            <div className="relative z-10 w-full pt-16 sm:pt-22">
              <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 pb-5 flex flex-col sm:flex-row items-center sm:items-end gap-4">
                <div className="relative flex-shrink-0">
                  <div
                    className="p-1.5 rounded-full bg-white/[0.12] backdrop-blur-2xl border border-white/35 transition-shadow duration-500"
                    style={{
                      boxShadow: `0 10px 38px rgba(${profileThemeColor.r}, ${profileThemeColor.g}, ${profileThemeColor.b}, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.45)`,
                    }}
                  >
                    <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-black/40 border border-white/20 overflow-hidden flex items-center justify-center">
                      {activeAvatar ? (
                        <img
                          src={activeAvatar}
                          alt={currentArtist.name}
                          referrerPolicy="no-referrer"
                          loading="eager"
                          decoding="async"
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full rounded-full flex items-center justify-center bg-white/[0.06] text-white font-normal text-2xl select-none">
                          {currentArtist.name?.[0] || 'A'}
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/20 via-transparent to-transparent" />
                    </div>
                  </div>
                </div>

                <div className="space-y-1 text-center sm:text-right flex-1 min-w-0 pb-1">
                  <h1 className="text-xl sm:text-3xl font-normal text-white tracking-tight drop-shadow truncate">
                    {currentArtist.name || currentUser?.displayName || (isHe ? 'אמן' : 'Artist')}
                  </h1>

                  {/* Profile subtitle: number of songs • number of albums */}
                  <p className="text-xs sm:text-sm text-white/80 font-normal">
                    {myUploadedTracks.length} {isHe ? 'שירים' : 'tracks'}
                    {` • ${myAlbums.length} ${isHe ? 'אלבומים' : 'albums'}`}
                  </p>

                  {/* Add Song & Add Album buttons right underneath artist name and counts */}
                  <div className="pt-2.5 flex flex-wrap items-center justify-center sm:justify-start gap-2.5">
                    <button
                      type="button"
                      onClick={() => setActiveTab('manual_upload')}
                      className="px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-all flex items-center gap-2 cursor-pointer shadow-lg bg-white text-black hover:bg-neutral-200 active:scale-95"
                    >
                      <Plus className="w-4 h-4 text-black" />
                      <span>{isHe ? 'הוסף שיר' : 'Add Song'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('albums')}
                      className="px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-all flex items-center gap-2 cursor-pointer shadow-lg bg-white/15 hover:bg-white/25 text-white border border-white/25 backdrop-blur-md active:scale-95"
                    >
                      <Disc className="w-4 h-4 text-white" />
                      <span>{isHe ? 'הוסף אלבום' : 'Add Album'}</span>
                    </button>
                  </div>

                  {currentArtist.bio && (
                    <p className="text-xs text-white/60 max-w-xl font-normal leading-relaxed pt-1">{currentArtist.bio}</p>
                  )}
                </div>
              </div>
            </div>

            {/* ALBUMS ROW IF CREATED */}
            {myAlbums.length > 0 && (
              <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-5 w-full space-y-3">
                <h3 className="text-sm font-normal text-white flex items-center gap-2">
                  <Disc className="w-4 h-4 text-white" />
                  <span>{isHe ? 'אלבומים שנוצרו' : 'Created Albums'}</span>
                </h3>

                <div className="flex items-center gap-4 overflow-x-auto pb-3 custom-scrollbar">
                  {myAlbums.map((album) => {
                    const validTrackIdSet = new Set(myUploadedTracks.map((t) => t.id));
                    const filteredTrackCount = (album.trackIds || []).filter((id) => validTrackIdSet.has(id)).length;
                    return (
                      <div
                        key={album.id}
                        className="group relative min-w-[146px] max-w-[172px] sm:min-w-[170px] sm:max-w-[190px] shrink-0 p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/15 transition-all shadow-xl space-y-2.5 flex flex-col justify-between"
                      >
                        <div
                          onClick={() => setSelectedAlbumForView(album)}
                          className="cursor-pointer"
                        >
                          <div className="w-full aspect-square rounded-xl bg-neutral-900 overflow-hidden flex items-center justify-center border border-white/10 relative group-hover:scale-[1.02] transition-transform">
                            {album.coverUrl ? (
                              <img src={album.coverUrl} alt="" loading="eager" decoding="async" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 p-2">
                                <Disc className="w-8 h-8 text-white/50" />
                              </div>
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <span className="px-2.5 py-1 rounded-full bg-white text-black text-[10px] font-bold shadow">
                                {isHe ? 'צפה באלבום' : 'View'}
                              </span>
                            </div>
                          </div>
                          <h4 className="font-bold text-xs text-white truncate pt-1">{album.title}</h4>
                          <p className="text-[10px] text-white/60 font-normal">{filteredTrackCount} {isHe ? 'שירים' : 'tracks'}</p>
                        </div>

                        {/* Actions: Edit & Delete */}
                        <div className="flex items-center gap-1.5 pt-1 border-t border-white/10">
                          <button
                            type="button"
                            onClick={() => handleStartEditAlbum(album)}
                            className="flex-1 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                          >
                            <Pencil className="w-3 h-3 text-white" />
                            <span>{isHe ? 'ערוך' : 'Edit'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAlbum(album.id)}
                            className="p-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/30 cursor-pointer transition-colors"
                            title={isHe ? 'מחק אלבום' : 'Delete'}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ALL SONGS OF THE SINGER DIRECTLY UNDERNEATH */}
            <main className="max-w-7xl mx-auto px-4 sm:px-8 py-6 w-full flex-1 space-y-5">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <h2 className="text-base sm:text-lg font-normal text-white flex items-center gap-2">
                  <Music className="w-4 h-4 text-white" />
                  <span>{isHe ? `כל השירים של ${currentArtist.name}` : `Songs by ${currentArtist.name}`}</span>
                </h2>
                <span className="text-xs font-normal text-white/70 bg-white/10 px-3 py-1 rounded-full border border-white/15">
                  {myUploadedTracks.length} {isHe ? 'שירים' : 'tracks'}
                </span>
              </div>

              {myUploadedTracks.length === 0 ? (
                <div className="text-center py-16 bg-white/[0.03] rounded-3xl border border-white/10 space-y-4 max-w-lg mx-auto p-6">
                  <Music className="w-10 h-10 text-white/30 mx-auto" />
                  <div>
                    <h3 className="text-base font-normal text-white">
                      {isHe ? 'עדיין לא העלית שירים לעמוד זה' : 'No songs uploaded yet'}
                    </h3>
                    <p className="text-xs text-white/60 mt-1 font-normal">
                      {isHe
                        ? 'לחץ על לחצן "הוספת שיר" למעלה כדי להעלות את השיר הראשון שלך מהמכשיר עם תמונת עטיפה!'
                        : 'Click "Add Song" at the top to upload your first song with cover artwork!'}
                    </p>
                  </div>

                  <button
                    onClick={() => setActiveTab('manual_upload')}
                    className="px-6 py-2.5 rounded-full bg-white hover:bg-neutral-200 text-black font-normal text-xs transition-all shadow-xl cursor-pointer inline-flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4 text-black" />
                    <span>{isHe ? 'העלה שיר ראשון עכשיו' : 'Upload First Song'}</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
                  {myUploadedTracks.map((track) => {
                    const trackColor = getTrackInstantColor(track);
                    const hoverShadow = `0 0 25px rgba(${trackColor.r}, ${trackColor.g}, ${trackColor.b}, 0.35)`;
                    return (
                      <div
                        key={track.id}
                        onClick={() => {
                          if (onPlayTrack) onPlayTrack(track);
                          onClose();
                        }}
                        style={{
                          boxShadow: 'none',
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = hoverShadow;
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                        }}
                        className="group bg-white/[0.06] hover:bg-white/[0.12] backdrop-blur-2xl border border-white/10 hover:border-white/25 rounded-2xl p-2.5 transition-shadow duration-300 cursor-pointer flex flex-col justify-between text-white relative"
                      >
                        <div>
                          <div className="mb-2 shadow-inner aspect-square rounded-xl overflow-hidden relative">
                            <TrackCoverArt
                              coverUrl={track.coverUrl}
                              artistName={track.artistName}
                              trackName={track.name}
                              genre={track.genre}
                            />

                            {/* TOP CORNER OVERLAY BUTTONS (VISIBLE FOR OWNER ONLY) */}
                            {canManageTrack(track) && (
                              <div className="absolute top-1.5 left-1.5 right-1.5 flex items-center justify-between z-10">
                                <button
                                  type="button"
                                  onClick={(e) => handleStartEditTrack(track, e)}
                                  className="p-1.5 rounded-lg bg-black/80 hover:bg-white/20 text-white backdrop-blur-md shadow-lg cursor-pointer transition-all border border-white/20"
                                  title={isHe ? 'ערוך פרטי שיר' : 'Edit Track'}
                                >
                                  <Pencil className="w-3.5 h-3.5 text-white" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteTrack(track, e)}
                                  className={`p-1.5 rounded-lg text-white backdrop-blur-md shadow-lg cursor-pointer transition-all border ${
                                    confirmDeleteId === track.id
                                      ? 'bg-rose-600 border-rose-400 animate-pulse'
                                      : 'bg-black/80 hover:bg-rose-600 border-white/20'
                                  }`}
                                  title={
                                    confirmDeleteId === track.id
                                      ? isHe
                                        ? 'לחץ שוב למחיקה סופית'
                                        : 'Click again to confirm delete'
                                      : isHe
                                      ? 'מחק שיר'
                                      : 'Delete Track'
                                  }
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-white" />
                                </button>
                              </div>
                            )}

                            {track.isAiGenerated && (
                              <div className="absolute bottom-1.5 right-1.5 z-10">
                                <span className="px-1.5 py-0.5 rounded-md bg-purple-600/90 text-[9px] font-normal text-white shadow-md flex items-center gap-0.5 backdrop-blur-sm border border-purple-400/40">
                                  <Sparkles className="w-2.5 h-2.5 text-purple-200" />
                                  AI
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <h3 className="font-normal text-xs text-white group-hover:text-white/90 transition-colors line-clamp-1 flex-1">
                              {track.name}
                            </h3>
                            {track.isAiGenerated && (
                              <span className="px-1 py-0.2 rounded bg-purple-500/25 border border-purple-400/40 text-purple-300 text-[9px] font-normal shrink-0">
                                AI
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] font-normal text-white/60 truncate mt-0.5">
                            {track.artistName}
                          </p>
                        </div>

                        {/* CARD FOOTER WITH EXPLICIT EDIT / DELETE ACTION BUTTONS (FOR OWNER) */}
                        <div className="pt-2 mt-2 border-t border-white/10 space-y-1.5">
                          <div className="flex items-center justify-between text-[9px] text-white/50 font-normal">
                            <span className="inline-flex items-center gap-1 text-white/70 font-normal truncate">
                              <ShieldCheck className="w-2.5 h-2.5 flex-shrink-0 text-white" />
                              <span className="truncate">{track.genre || 'Music'}</span>
                            </span>
                            <Play className="w-3.5 h-3.5 text-white flex-shrink-0" />
                          </div>

                          {canManageTrack(track) && (
                            <div className="flex items-center gap-1 pt-1">
                              <button
                                type="button"
                                onClick={(e) => handleStartEditTrack(track, e)}
                                className="flex-1 py-1 px-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 text-[10px] font-normal flex items-center justify-center gap-1 transition-all cursor-pointer"
                              >
                                <Pencil className="w-3 h-3 text-white" />
                                <span>{isHe ? 'ערוך' : 'Edit'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDeleteTrack(track, e)}
                                className={`flex-1 py-1 px-1.5 rounded-lg text-[10px] font-normal flex items-center justify-center gap-1 transition-all cursor-pointer ${
                                  confirmDeleteId === track.id
                                    ? 'bg-rose-600 hover:bg-rose-700 text-white border border-rose-400 animate-pulse shadow-md'
                                    : 'bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>{confirmDeleteId === track.id ? (isHe ? 'בטוח?' : 'Confirm?') : (isHe ? 'מחק' : 'Delete')}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            {/* RECREATED EDIT SONG STUDIO MODAL */}
            {editingTrack && (
              <div
                className="fixed inset-0 z-[160] bg-black/85 backdrop-blur-xl flex items-start sm:items-center justify-center p-2.5 sm:p-6 pt-3 overflow-y-auto"
                dir={isHe ? 'rtl' : 'ltr'}
              >
                <div className="w-full max-w-3xl max-h-[92dvh] bg-[#09090b] border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-fadeIn my-auto">
                  {/* Top Studio Header */}
                  <div className="px-5 sm:px-7 py-4 border-b border-white/10 flex items-center justify-between gap-4 shrink-0 bg-[#09090b]">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-neutral-900 border border-white/15 shrink-0">
                        <TrackCoverArt
                          coverUrl={editingTrack.coverUrl}
                          artistName={editingTrack.artistName}
                          trackName={editingTrack.name}
                          genre={editingTrack.genre}
                        />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-base sm:text-lg font-bold text-white truncate">
                          {isHe ? 'עריכת יצירה' : 'Edit Release'}
                        </h3>
                        <p className="text-xs text-neutral-400 truncate mt-0.5">
                          {editTitle || editingTrack.name} · {editPerformingArtist || editingTrack.artistName} · {editGenre || editingTrack.genre || (isHe ? 'מוזיקה' : 'Music')}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isSavingEdit}
                      onClick={() => {
                        if (!isSavingEdit) setEditingTrack(null);
                      }}
                      className="w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 text-neutral-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label={isHe ? 'סגור' : 'Close'}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Scrollable Studio Form Body */}
                  <form id="editTrackStudioForm" onSubmit={handleSaveEditTrack} className="flex-1 overflow-y-auto custom-scrollbar divide-y divide-white/8 text-xs">
                    {/* Section 1: Track Credits & Metadata */}
                    <div className="p-5 sm:p-7 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                          {isHe ? 'פרטי היצירה והקרדיטים' : 'Track Metadata & Credits'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-neutral-300 font-medium mb-1.5">
                            {isHe ? 'שם השיר *' : 'Song Title *'}
                          </label>
                          <input
                            type="text"
                            required
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/15 text-white text-xs sm:text-sm focus:outline-none focus:border-white/50 transition-colors"
                          />
                        </div>

                        <div>
                          <label className="block text-neutral-300 font-medium mb-1.5">
                            {isHe ? 'שם האמן המבצע' : 'Performing Artist'}
                          </label>
                          <input
                            type="text"
                            value={editPerformingArtist}
                            onChange={(e) => setEditPerformingArtist(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/15 text-white text-xs sm:text-sm focus:outline-none focus:border-white/50 transition-colors"
                          />
                        </div>

                        <div>
                          <label className="block text-neutral-300 font-medium mb-1.5">
                            {isHe ? 'אמן אורח (Feat.)' : 'Featured Artist'}
                          </label>
                          <input
                            type="text"
                            value={editFeaturedArtist}
                            onChange={(e) => setEditFeaturedArtist(e.target.value)}
                            placeholder={isHe ? 'אופציונלי' : 'Optional'}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/15 text-white placeholder-neutral-600 text-xs sm:text-sm focus:outline-none focus:border-white/50 transition-colors"
                          />
                        </div>

                        <div>
                          <label className="block text-neutral-300 font-medium mb-1.5">
                            {isHe ? 'מילים ולחן / יוצרים' : 'Writers & Composers'}
                          </label>
                          <input
                            type="text"
                            value={editWriters}
                            onChange={(e) => setEditWriters(e.target.value)}
                            placeholder={isHe ? 'אופציונלי' : 'Optional'}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/15 text-white placeholder-neutral-600 text-xs sm:text-sm focus:outline-none focus:border-white/50 transition-colors"
                          />
                        </div>

                        <div>
                          <label className="block text-neutral-300 font-medium mb-1.5">
                            {isHe ? 'ז׳אנר מוזיקלי' : 'Genre'}
                          </label>
                          <select
                            value={
                              editGenre === 'ללא סגנון מוזיקלי'
                                ? 'ללא סגנון מוזיקלי'
                                : CANONICAL_GENRES.some((g) => g.id === editGenre)
                                  ? editGenre
                                  : 'custom'
                            }
                            onChange={(e) => {
                              if (e.target.value !== 'custom') setEditGenre(e.target.value);
                            }}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/15 text-white text-xs sm:text-sm focus:outline-none focus:border-white/50 transition-colors cursor-pointer"
                          >
                            <option value="ללא סגנון מוזיקלי">
                              {isHe ? 'אוטומטי (בחירת ז׳אנר ע״י בינה מלאכותית)' : 'Automatic (Smart AI Genre)'}
                            </option>
                            {CANONICAL_GENRES.map((g) => (
                              <option key={g.id} value={g.id}>
                                {isHe ? `${g.labelHe} (${g.id})` : g.labelEn}
                              </option>
                            ))}
                            {editGenre !== 'ללא סגנון מוזיקלי' && !CANONICAL_GENRES.some((g) => g.id === editGenre) && (
                              <option value="custom">{editGenre || (isHe ? 'מותאם אישית' : 'Custom')}</option>
                            )}
                          </select>
                        </div>

                        <div>
                          <label className="block text-neutral-300 font-medium mb-1.5">
                            {isHe ? 'שם האלבום / סינגל' : 'Album / Single'}
                          </label>
                          <input
                            type="text"
                            value={editAlbum}
                            onChange={(e) => setEditAlbum(e.target.value)}
                            className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/15 text-white text-xs sm:text-sm focus:outline-none focus:border-white/50 transition-colors"
                          />
                        </div>
                      </div>

                      <label
                        htmlFor="editIsAiGeneratedCheck"
                        className="flex items-center justify-between gap-3 pt-2 cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-2.5 text-neutral-200">
                          <Sparkles className="w-4 h-4 text-neutral-400 shrink-0" />
                          <span className="font-medium">
                            {isHe ? 'היצירה נוצרה באמצעות בינה מלאכותית (תג AI)' : 'AI Generated Release (AI Badge)'}
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          id="editIsAiGeneratedCheck"
                          checked={editIsAiGenerated}
                          onChange={(e) => setEditIsAiGenerated(e.target.checked)}
                          className="w-4.5 h-4.5 rounded border-white/30 bg-black accent-white cursor-pointer"
                        />
                      </label>
                    </div>

                    {/* Section 2: Automatic AI Subtitles (Publisher controlled) */}
                    <div className="p-5 sm:p-7 space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Captions className="w-4 h-4 text-white shrink-0" />
                          <div className="min-w-0">
                            <span className="font-semibold text-white block text-sm">
                              {isHe ? 'כתוביות מסונכרנות אוטומטיות (AI)' : 'Automatic AI Subtitles'}
                            </span>
                            <span className="text-[11px] text-neutral-400 block">
                              {editIncludeSubtitles
                                ? (isHe
                                    ? 'המערכת יוצרת ושומרת בענן כתוביות מסונכרנות למילות השיר לכל 100% מאורכו'
                                    : 'Automatically generates and saves full-song synchronized subtitles in the cloud')
                                : (isHe ? 'מצב כבוי — כתוביות יוסרו בעת השמירה' : 'Disabled — subtitles will be removed on save')}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={editIncludeSubtitles}
                          onClick={() => setEditIncludeSubtitles((v) => !v)}
                          dir="ltr"
                          className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center cursor-pointer shrink-0 border ${
                            editIncludeSubtitles ? 'bg-white border-white justify-end' : 'bg-neutral-800 border-white/25 justify-start'
                          }`}
                        >
                          <span className={`w-4.5 h-4.5 rounded-full transition-transform ${editIncludeSubtitles ? 'bg-black' : 'bg-white'}`} />
                        </button>
                      </div>

                      {editIncludeSubtitles && (
                        <div className="space-y-3 pt-1">
                          <div className="p-3.5 rounded-2xl bg-black border border-white/15 space-y-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-neutral-200 font-semibold flex items-center gap-2">
                                <CheckCircle2 className={`w-4 h-4 ${editSubComplete ? 'text-emerald-400' : 'text-neutral-500'}`} />
                                <span>
                                  {editSubComplete
                                    ? (isHe ? 'כתוביות מלאות (100% מהשיר) מוכנות בענן' : 'Full-song subtitles (100%) ready in cloud')
                                    : (isHe ? 'יושלם אוטומטית ל-100% בעת שמירה או לחיצה מטה' : 'Will complete to 100% on save or generate below')}
                                </span>
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={isGeneratingEditSubs || isSavingEdit || !editingTrack?.audioUrl}
                              onClick={handleGenerateEditSubtitles}
                              className="px-4 py-2 rounded-full bg-white hover:bg-neutral-200 text-black text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {isGeneratingEditSubs ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Wand2 className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {isGeneratingEditSubs
                                  ? (isHe ? 'יוצר כתוביות מלאות...' : 'Generating full subtitles...')
                                  : (isHe ? 'צור / עדכן כתוביות לכל השיר' : 'Generate / Update Full Subtitles')}
                              </span>
                            </button>
                          </div>

                          {editWhisperNotice && (
                            <p className="text-[11px] text-neutral-200 bg-white/[0.05] border border-white/15 px-3.5 py-2 rounded-xl">
                              {editWhisperNotice}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </form>

                  {/* Sticky Bottom Studio Bar */}
                  <div className="px-5 sm:px-7 py-4 border-t border-white/10 bg-[#09090b] flex items-center justify-end gap-3 shrink-0">
                    <button
                      type="button"
                      disabled={isSavingEdit}
                      onClick={() => {
                        setEditingTrack(null);
                      }}
                      className="px-5 py-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
                    >
                      {isHe ? 'ביטול' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      form="editTrackStudioForm"
                      disabled={isSavingEdit}
                      className="px-6 py-2.5 rounded-full bg-white hover:bg-neutral-200 text-black text-xs font-bold cursor-pointer shadow-lg transition-colors disabled:opacity-50"
                    >
                      {isHe ? 'שמור שינויים' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}
            </main>
          </div>
        )}

        {/* 2. FULL-SCREEN MONOCHROME BLACK & WHITE ADD SONG SCREEN */}
        {activeTab === 'manual_upload' && (
          <div key="portal-tab-upload" className="w-full min-h-screen bg-black text-white px-4 sm:px-8 py-6 sm:py-10 flex flex-col items-center">
            <div className="w-full max-w-2xl space-y-5 animate-fadeIn">
              {/* TOP HEADER */}
              <div className="flex items-center justify-between gap-3 pb-4 border-b border-white/15">
                <button
                  type="button"
                  onClick={() => setActiveTab('profile')}
                  className="w-11 h-11 rounded-full border border-white/25 bg-neutral-950 hover:bg-white hover:text-black text-white flex items-center justify-center cursor-pointer transition-all active:scale-95 shrink-0"
                  title={isHe ? 'חזור לפרופיל' : 'Back to Profile'}
                >
                  {isHe ? <ArrowRight className="w-5 h-5" /> : <ArrowLeft className="w-5 h-5" />}
                </button>

                <div className="text-center flex-1 min-w-0">
                  <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    {isHe ? 'הוספת שיר חדש' : 'Add New Song'}
                  </h1>
                  <p className="text-xs text-neutral-400 font-medium mt-0.5 truncate">
                    {isHe ? 'העלה שיר, עטיפה וכתוביות ישירות לענן של Kolot' : 'Upload audio, artwork and subtitles to Kolot'}
                  </p>
                </div>

                <div className="w-11 h-11 shrink-0" />
              </div>

              {publishSuccess && (
                <div className="p-4 rounded-2xl bg-white text-black text-xs font-black flex items-center gap-2.5 shadow-lg animate-fadeIn">
                  <Check className="w-5 h-5 shrink-0" />
                  <span>{isHe ? 'השיר פורסם בהצלחה ונשמר בפרופיל!' : 'Song published successfully!'}</span>
                </div>
              )}

              <form onSubmit={handlePublishTrack} className="space-y-5">
                {/* 1. COVER ART + TITLE + ARTIST CREDITS */}
                <div className="p-5 sm:p-6 rounded-2xl bg-neutral-950 border border-white/15 space-y-5">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-5">
                    {/* Square 1:1 Cover Art */}
                    <div className="flex-shrink-0 flex flex-col items-center sm:items-start">
                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.webp"
                        onChange={handleCoverFileSelect}
                        className="hidden"
                      />

                      {coverArtUrl ? (
                        <div className="relative group w-32 h-32 sm:w-36 sm:h-36 rounded-2xl overflow-hidden border border-white/30 bg-black flex-shrink-0">
                          <img
                            src={coverArtUrl}
                            alt="Cover preview"
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-black/75 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                            <button
                              type="button"
                              onClick={() => coverInputRef.current?.click()}
                              className="px-3 py-1.5 rounded-lg bg-white text-black hover:bg-neutral-200 text-[11px] font-black flex items-center gap-1.5 cursor-pointer transition-all"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>{isHe ? 'החלף תמונה' : 'Change'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleResetCover}
                              className="px-2.5 py-1 rounded-lg bg-neutral-900 border border-white/25 hover:bg-neutral-800 text-white text-[11px] font-bold cursor-pointer transition-all flex items-center gap-1"
                              title={isHe ? 'הסר תמונה' : 'Remove'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{isHe ? 'הסר' : 'Remove'}</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsCoverDragging(true);
                          }}
                          onDragLeave={() => setIsCoverDragging(false)}
                          onDrop={handleCoverDrop}
                          onClick={() => coverInputRef.current?.click()}
                          className={`w-32 h-32 sm:w-36 sm:h-36 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-3 text-center cursor-pointer transition-all select-none ${
                            isCoverDragging
                              ? 'border-white bg-white/10 scale-[1.02]'
                              : 'border-white/25 hover:border-white bg-black hover:bg-neutral-900'
                          }`}
                        >
                          <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center mb-2 text-white">
                            <FileImage className="w-5 h-5" />
                          </div>
                          <span className="text-xs font-black text-white leading-tight">
                            {isHe ? 'בחר עטיפה *' : 'Upload Cover *'}
                          </span>
                          <span className="text-[10px] text-neutral-400 mt-1">
                            {isHe ? 'תמונה 1:1' : 'Square 1:1'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Title & Main Artist */}
                    <div className="flex-1 min-w-0 space-y-4">
                      <div>
                        <label className="text-xs font-extrabold text-white flex items-center gap-2 mb-1.5">
                          <Keyboard className="w-4 h-4 text-white" />
                          <span>{isHe ? 'שם השיר (חובה) *' : 'Song Title (Required) *'}</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={songTitle}
                          onChange={(e) => setSongTitle(e.target.value)}
                          placeholder={isHe ? 'הקלד את שם השיר...' : 'Type song title...'}
                          className="w-full px-4 py-3 rounded-xl bg-black border border-white/20 text-white placeholder-neutral-500 focus:outline-none focus:border-white font-bold text-sm transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-extrabold text-white flex items-center gap-2 mb-1.5">
                          <User className="w-4 h-4 text-white" />
                          <span>{isHe ? 'שם הזמר / אמן מבצע' : 'Performing Artist'}</span>
                        </label>
                        <input
                          type="text"
                          value={performingArtistInput}
                          onChange={(e) => setPerformingArtistInput(e.target.value)}
                          placeholder={currentArtist.name || (isHe ? 'שם הזמר המבצע...' : 'Artist name...')}
                          className="w-full px-4 py-2.5 rounded-xl bg-black border border-white/20 text-white placeholder-neutral-500 focus:outline-none focus:border-white font-bold text-xs transition-colors"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Secondary Metadata Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-white/10">
                    <div>
                      <label className="text-[11px] font-bold text-neutral-300 flex items-center gap-1.5 mb-1.5">
                        <Mic2 className="w-3.5 h-3.5 text-white" />
                        <span>{isHe ? 'זמר אורח (Feat.)' : 'Featured Artist'}</span>
                      </label>
                      <input
                        type="text"
                        value={featuredArtistInput}
                        onChange={(e) => setFeaturedArtistInput(e.target.value)}
                        placeholder={isHe ? 'אופציונלי...' : 'Optional...'}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/20 text-white placeholder-neutral-500 focus:outline-none focus:border-white font-medium text-xs"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-neutral-300 flex items-center gap-1.5 mb-1.5">
                        <Disc className="w-3.5 h-3.5 text-white" />
                        <span>{isHe ? 'אלבום / סינגל' : 'Album / Single'}</span>
                      </label>
                      <input
                        type="text"
                        value={albumTitle}
                        onChange={(e) => setAlbumTitle(e.target.value)}
                        placeholder={isHe ? 'סינגל עצמאי' : 'Single'}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/20 text-white placeholder-neutral-500 focus:outline-none focus:border-white font-medium text-xs"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-bold text-neutral-300 flex items-center gap-1.5 mb-1.5">
                        <Edit3 className="w-3.5 h-3.5 text-white" />
                        <span>{isHe ? 'כותבים ומלחינים' : 'Writers & Composers'}</span>
                      </label>
                      <input
                        type="text"
                        value={writersInput}
                        onChange={(e) => setWritersInput(e.target.value)}
                        placeholder={isHe ? 'מילים / לחן...' : 'Writers...'}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-black border border-white/20 text-white placeholder-neutral-500 focus:outline-none focus:border-white font-medium text-xs"
                      />
                    </div>
                  </div>
                </div>

                {/* 2. AUDIO SOURCE */}
                <div className="p-5 sm:p-6 rounded-2xl bg-neutral-950 border border-white/15 space-y-3.5">
                  {fileUploadError && (
                    <div className="p-3 rounded-xl bg-neutral-900 border border-white/30 text-white text-xs font-bold text-center">
                      {fileUploadError}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-extrabold text-white flex items-center gap-2">
                      <FileAudio className="w-4 h-4 text-white" />
                      <span>{isHe ? 'קובץ שמע / שיר (חובה) *' : 'Audio Source (Required) *'}</span>
                    </label>

                    <div className="inline-flex items-center gap-1 bg-black border border-white/20 p-0.5 rounded-xl text-[11px]">
                      <button
                        type="button"
                        onClick={() => setAudioUploadType('file')}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer font-bold ${
                          audioUploadType === 'file' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        {isHe ? 'העלאת קובץ' : 'File'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAudioUploadType('url')}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer font-bold ${
                          audioUploadType === 'url' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        {isHe ? 'קישור ישיר' : 'URL'}
                      </button>
                    </div>
                  </div>

                  {audioUploadType === 'file' ? (
                    <div>
                      <input
                        ref={audioInputRef}
                        type="file"
                        accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.aac"
                        onChange={handleAudioFileSelect}
                        className="hidden"
                      />

                      {audioStreamUrl ? (
                        <div className="p-4 rounded-xl bg-black border border-white/30 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-lg bg-white text-black flex items-center justify-center flex-shrink-0">
                                <FileAudio className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <span className="block text-xs font-bold text-white truncate">
                                  {audioFileName || (isHe ? 'קובץ שמע נבחר' : 'Audio file selected')}
                                </span>
                                <span className="block text-[11px] text-neutral-300">
                                  {isHe ? 'מוכן להשמעה ולפרסום' : 'Ready for playback & publish'}
                                  {selectedAudioDurationSec
                                    ? ` · ${Math.floor(selectedAudioDurationSec / 60)}:${String(selectedAudioDurationSec % 60).padStart(2, '0')} / 05:00`
                                    : ''}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => audioInputRef.current?.click()}
                                className="px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-white hover:text-black text-white text-[11px] font-bold border border-white/25 cursor-pointer transition-all flex items-center gap-1.5"
                              >
                                <RefreshCw className="w-3.5 h-3.5" />
                                <span>{isHe ? 'החלף קובץ' : 'Replace'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleResetAudio}
                                className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white border border-white/20 cursor-pointer transition-all"
                                title={isHe ? 'הסר קובץ' : 'Remove'}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-white/10">
                            <audio controls src={audioStreamUrl} className="w-full h-8 rounded" />
                          </div>
                        </div>
                      ) : (
                        <div
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsAudioDragging(true);
                          }}
                          onDragLeave={() => setIsAudioDragging(false)}
                          onDrop={handleAudioDrop}
                          onClick={() => audioInputRef.current?.click()}
                          className={`p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                            isAudioDragging
                              ? 'border-white bg-white/10 scale-[1.01]'
                              : 'border-white/20 hover:border-white bg-black hover:bg-neutral-900'
                          }`}
                        >
                          <FolderUp className="w-8 h-8 text-white mb-2" />
                          <span className="text-xs font-bold text-white">
                            {isHe ? 'גרור לכאן קובץ שיר או לחץ לבחירה מהמכשיר' : 'Drag & drop audio file or click to browse'}
                          </span>
                          <span className="text-[11px] text-neutral-400 mt-1">
                            {isHe
                              ? 'MP3, WAV, AAC, M4A, OGG, FLAC (אורך מרבי: עד 5 דקות)'
                              : 'MP3, WAV, AAC, M4A, OGG, FLAC (Max duration: 5 minutes)'}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      type="url"
                      required
                      value={audioStreamUrl}
                      onChange={(e) => setAudioStreamUrl(e.target.value)}
                      placeholder="https://... (קישור ישיר לקובץ MP3 / שמע)"
                      className="w-full px-4 py-3 rounded-xl bg-black border border-white/20 text-white placeholder-neutral-500 focus:outline-none focus:border-white text-xs"
                    />
                  )}
                </div>

                {/* 3. MUSICAL STYLE + ON-DEVICE AUDIO CLASSIFICATION */}
                <div className="p-5 sm:p-6 rounded-2xl bg-neutral-950 border border-white/15 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-white font-extrabold text-xs flex items-center gap-2">
                      <Music className="w-4 h-4 text-white" />
                      <span>{isHe ? 'סגנון מוזיקלי *' : 'Musical Style *'}</span>
                    </label>

                    <button
                      type="button"
                      disabled={isClassifyingGenre || (!rawAudioFile && !audioStreamUrl.trim() && !songTitle.trim())}
                      onClick={handleAutoDetectGenre}
                      className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-neutral-200 text-black text-[11px] font-black flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                    >
                      {isClassifyingGenre ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Wand2 className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {isClassifyingGenre
                          ? (genreProgressText || (isHe ? 'מזהה סגנון במכשיר...' : 'Detecting genre...'))
                          : (isHe ? 'מצא ז׳אנר אוטומטי במכשיר' : 'Auto-Detect Genre')}
                      </span>
                    </button>
                  </div>

                  {genreDetectionNotice && (
                    <div className="p-3 rounded-xl border border-white/25 bg-black text-white text-[11px] flex flex-wrap items-center justify-between gap-2">
                      {genreDetectionNotice.success ? (
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
                          <span>
                            {isHe
                              ? `זוהה סגנון: ${genreDetectionNotice.hebrewGenre} (${Math.round(genreDetectionNotice.confidence * 100)}% התאמה)`
                              : `Detected: ${genreDetectionNotice.genre} (${Math.round(genreDetectionNotice.confidence * 100)}%)`}
                            {genreDetectionNotice.bpmEstimate ? ` • ~${genreDetectionNotice.bpmEstimate} BPM` : ''}
                          </span>
                        </div>
                      ) : (
                        <span className="text-neutral-300">{genreDetectionNotice.error}</span>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'ללא סגנון מוזיקלי', label: isHe ? 'אוטומטי' : 'Automatic' },
                      ...CANONICAL_GENRES.map((g) => ({
                        id: g.id,
                        label: isHe ? g.labelHe : g.labelEn,
                      })),
                      { id: 'אחר', label: isHe ? 'אחר...' : 'Other...' },
                    ].map((g) => {
                      const isSelected = genreInput === g.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setGenreInput(g.id)}
                          className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                            isSelected
                              ? 'bg-white text-black border-white font-black shadow-md'
                              : 'bg-black text-neutral-300 border-white/15 hover:border-white/50 hover:text-white'
                          }`}
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>

                  {genreInput === 'אחר' && (
                    <div className="pt-1">
                      <input
                        type="text"
                        value={customGenreText}
                        onChange={(e) => setCustomGenreText(e.target.value)}
                        placeholder={isHe ? 'פרט את סגנון השיר (למשל: אינדי, רגאיי, מטאל)...' : 'Specify custom genre...'}
                        className="w-full px-4 py-2.5 rounded-xl bg-black border border-white/30 text-white placeholder-neutral-500 text-xs font-bold focus:outline-none focus:border-white"
                        autoFocus
                      />
                    </div>
                  )}
                </div>

                {/* 4. SUBTITLES SWITCH (DEFAULT ON) */}
                <div className="p-5 sm:p-6 rounded-2xl bg-neutral-950 border border-white/15 space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white shrink-0 mt-0.5">
                        <Captions className="w-4.5 h-4.5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs sm:text-sm font-black text-white block">
                          {includeSubtitles
                            ? (isHe ? 'יצירה אוטומטית של כתוביות מסונכרנות (דלוק)' : 'Automatic Full-Song Subtitles (On)')
                            : (isHe ? 'כתוביות כבויות לשיר זה' : 'Subtitles Off')}
                        </span>
                        <span className="text-[11px] text-neutral-400 block mt-0.5">
                          {includeSubtitles
                            ? (isHe
                                ? 'המערכת יוצרת ושומרת אוטומטית כתוביות מסונכרנות למילות השיר לכל 100% מאורכו בעת הפרסום'
                                : 'Automatically creates and saves 100% full-song subtitles during creation & publish')
                            : (isHe
                                ? 'מצב כבוי — לא יישמרו כתוביות לשיר זה'
                                : 'Disabled — no subtitles will be saved for this song')}
                        </span>
                      </div>
                    </div>

                    {/* Interactive Black/White Toggle Switch (ON by default) */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={includeSubtitles}
                      onClick={() => setIncludeSubtitles((prev) => !prev)}
                      dir="ltr"
                      className={`w-13 h-7 rounded-full p-1 transition-colors flex items-center cursor-pointer shrink-0 border ${
                        includeSubtitles
                          ? 'bg-white border-white justify-end'
                          : 'bg-neutral-800 border-white/25 justify-start'
                      }`}
                      title={includeSubtitles ? (isHe ? 'כבה כתוביות לשיר זה' : 'Turn off') : (isHe ? 'הפעל כתוביות לשיר זה' : 'Turn on')}
                    >
                      <span
                        className={`w-5 h-5 rounded-full transition-transform shadow-sm ${
                          includeSubtitles ? 'bg-black' : 'bg-white'
                        }`}
                      />
                    </button>
                  </div>

                  {includeSubtitles ? (
                    <div className="space-y-3 pt-3 border-t border-white/10">
                      <div className="p-3.5 rounded-xl bg-black border border-white/15 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-neutral-200 font-semibold flex items-center gap-2">
                            {uploadSubComplete ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : (
                              <Captions className="w-4 h-4 text-neutral-400 shrink-0" />
                            )}
                            <span>
                              {uploadSubComplete
                                ? (isHe ? 'כתוביות מלאות לכל השיר מוכנות (100%)' : 'Full-song subtitles ready (100%)')
                                : (rawAudioFile || audioStreamUrl.trim())
                                  ? (isHe ? `מכין כתוביות מלאות אוטומטית ברקע... ${uploadSubPercent}%` : `Preparing full-song subtitles automatically... ${uploadSubPercent}%`)
                                  : (isHe ? 'העלה קובץ שמע והכתוביות ייווצרו אוטומטית לכל אורך השיר' : 'Upload audio to automatically generate full-song subtitles')}
                            </span>
                          </span>
                        </div>

                        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-white rounded-full transition-all duration-300"
                            style={{ width: `${uploadSubComplete ? 100 : uploadSubPercent}%` }}
                          />
                        </div>
                      </div>

                      {whisperUploadNotice && (
                        <p className="text-[11px] text-white/90 font-semibold bg-black border border-white/20 px-3 py-2 rounded-xl">
                          {whisperUploadNotice}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>

                {/* 5. AI BADGE + COPYRIGHT CERTIFICATION */}
                <div className="p-5 sm:p-6 rounded-2xl bg-neutral-950 border border-white/15 space-y-4 text-xs">
                  <label htmlFor="rightsAiCheck" className="flex items-center gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      id="rightsAiCheck"
                      checked={isAiGeneratedInput}
                      onChange={(e) => setIsAiGeneratedInput(e.target.checked)}
                      className="w-4.5 h-4.5 rounded border-white/40 bg-black accent-white cursor-pointer flex-shrink-0"
                    />
                    <span className="font-bold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-white" />
                      <span>{isHe ? 'השיר נוצר באמצעות בינה מלאכותית (יסומן בתווית AI)' : 'AI-generated song (Marked with AI badge)'}</span>
                    </span>
                  </label>

                  <div className="pt-3 border-t border-white/10">
                    <label htmlFor="rightsCertCheck" className="flex items-start gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        id="rightsCertCheck"
                        required
                        checked={hasCertifiedRights}
                        onChange={(e) => setHasCertifiedRights(e.target.checked)}
                        className="mt-1 w-4.5 h-4.5 rounded border-white/40 bg-black accent-white cursor-pointer flex-shrink-0"
                      />
                      <span className="text-xs text-neutral-300 leading-relaxed">
                        <span className="text-white font-black block mb-0.5">
                          {isHe ? 'אישור זכויות יוצרים ותנאי שימוש (חובה) *' : 'Rights & Copyright Certification (Required) *'}
                        </span>
                        {isHe
                          ? 'אני מאשר/ת שהשיר והעטיפה תואמים את תנאי השימוש, מותרים ברישיון תקף ויש לי את כל הזכויות להעלותם ולהפיצם בפלטפורמה.'
                          : 'I certify that the track and artwork comply with terms and I hold full rights to upload and distribute them.'}
                      </span>
                    </label>
                  </div>

                  <div className="pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-neutral-400">
                    <div className="flex items-center gap-2">
                      <Cloud className="w-4 h-4 text-white" />
                      <span>{r2Status.configured ? 'אחסון הענן של האתר מחובר ומוכן' : 'אחסון ענן פעיל'}</span>
                    </div>
                    <Check className="w-4 h-4 text-white" />
                  </div>
                </div>

                {/* Live Error Notification */}
                {publishErrorMessage && (
                  <div className="p-4 rounded-2xl bg-neutral-950 border border-white/35 text-white text-xs flex items-start gap-3 animate-fadeIn">
                    <AlertCircle className="w-5 h-5 text-white shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-black mb-1">{isHe ? 'שגיאה בפרסום' : 'Publishing Error'}</p>
                      <p className="text-neutral-300 leading-relaxed">{publishErrorMessage}</p>
                      <button
                        type="button"
                        onClick={() => setPublishErrorMessage(null)}
                        className="mt-2 text-white font-bold underline cursor-pointer text-[11px]"
                      >
                        {isHe ? 'סגור הודעה' : 'Dismiss'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 6. BOTTOM ACTION ROW: CANCEL + PUBLISH */}
                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                  <button
                    type="button"
                    disabled={isPublishing}
                    onClick={() => setActiveTab('profile')}
                    className="sm:w-36 py-4 rounded-2xl bg-neutral-950 hover:bg-neutral-900 border border-white/20 text-white font-bold text-sm transition-all cursor-pointer disabled:opacity-40"
                  >
                    {isHe ? 'ביטול' : 'Cancel'}
                  </button>

                  <button
                    type="submit"
                    disabled={isPublishing || !audioStreamUrl || !songTitle || !coverArtUrl || !hasCertifiedRights}
                    className="flex-1 py-4 rounded-2xl bg-white hover:bg-neutral-200 active:scale-[0.99] text-black font-black text-sm transition-all cursor-pointer shadow-[0_0_30px_rgba(255,255,255,0.16)] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Upload className="w-5 h-5 text-black" />
                    <span>{isHe ? 'פרסם שיר' : 'Publish Song'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 3. FULL-SCREEN ALBUMS MANAGEMENT TAB (BG-BLACK) */}
        {activeTab === 'albums' && (
          <div key="portal-tab-albums" className="w-full flex-1 flex flex-col bg-black text-white min-h-screen pt-20 pb-24 px-4 sm:px-8">
            <div className="max-w-3xl mx-auto w-full space-y-6">
              {/* Top Title & Back to Profile */}
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      handleCancelEditAlbum();
                      setActiveTab('profile');
                    }}
                    className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center cursor-pointer transition-all"
                  >
                    {isHe ? <ArrowRight className="w-4 h-4 text-white" /> : <ArrowLeft className="w-4 h-4 text-white" />}
                  </button>
                  <h2 className="text-lg sm:text-xl font-normal text-white flex items-center gap-2">
                    <Disc className="w-5 h-5 text-white" />
                    <span>{isHe ? 'ניהול אלבומים' : 'Album Management'}</span>
                  </h2>
                </div>

                {editingAlbum && (
                  <button
                    type="button"
                    onClick={handleCancelEditAlbum}
                    className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-amber-300 text-xs font-bold transition-all cursor-pointer border border-amber-300/30"
                  >
                    {isHe ? 'ביטול עריכה' : 'Cancel Edit'}
                  </button>
                )}
              </div>

              {/* 1. LIST OF CREATED ALBUMS (IF ANY) */}
              {myAlbums.length > 0 && (
                <div className="p-5 sm:p-6 rounded-3xl bg-neutral-950/80 border border-white/10 space-y-4 shadow-xl">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                      <Disc className="w-4 h-4 text-white" />
                      <span>{isHe ? `האלבומים הקיימים שלך (${myAlbums.length})` : `Your Albums (${myAlbums.length})`}</span>
                    </h3>
                    <span className="text-[11px] text-neutral-400">
                      {isHe ? 'לחץ על אלבום כדי לצפות בשירים ולהאזין' : 'Click album to view & play'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {myAlbums.map((album) => {
                      const validTrackIdSet = new Set(myUploadedTracks.map((t) => t.id));
                      const filteredTrackCount = (album.trackIds || []).filter((id) => validTrackIdSet.has(id)).length;
                      const isCurrentlyEditing = editingAlbum?.id === album.id;

                      return (
                        <div
                          key={album.id}
                          className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                            isCurrentlyEditing
                              ? 'bg-white/15 border-white shadow-lg'
                              : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/10'
                          }`}
                        >
                          <div
                            onClick={() => setSelectedAlbumForView(album)}
                            className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
                          >
                            <div className="w-12 h-12 rounded-xl bg-neutral-900 border border-white/15 overflow-hidden flex items-center justify-center shrink-0">
                              {album.coverUrl ? (
                                <img src={album.coverUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <Disc className="w-6 h-6 text-white/40" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-xs text-white truncate hover:text-white/80 transition-colors">
                                {album.title}
                              </h4>
                              <p className="text-[10px] text-neutral-400">
                                {filteredTrackCount} {isHe ? 'שירים' : 'tracks'} • {isHe ? 'לחץ לפתיחה' : 'Click to open'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleStartEditAlbum(album)}
                              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                              title={isHe ? 'ערוך אלבום' : 'Edit'}
                            >
                              <Pencil className="w-3.5 h-3.5 text-white" />
                              <span>{isHe ? 'ערוך' : 'Edit'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAlbum(album.id)}
                              className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/40 text-rose-300 border border-rose-500/30 cursor-pointer transition-colors"
                              title={isHe ? 'מחק אלבום' : 'Delete'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. ALBUM CREATION / EDITING FORM */}
              <form onSubmit={handleCreateAlbum} className="p-5 sm:p-7 rounded-3xl bg-neutral-950/90 border border-white/15 space-y-5 text-xs shadow-2xl backdrop-blur-2xl">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <Disc className="w-4 h-4 text-white" />
                    <span>
                      {editingAlbum
                        ? (isHe ? `עריכת אלבום: ${editingAlbum.title}` : `Edit Album: ${editingAlbum.title}`)
                        : (isHe ? 'יצירת אלבום חדש' : 'Create New Album')}
                    </span>
                  </h3>
                  {editingAlbum && (
                    <span className="text-[10px] text-amber-300 font-bold px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30">
                      {isHe ? 'מצב עריכה' : 'Editing Mode'}
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-white font-bold mb-1.5 text-xs sm:text-sm">
                    {isHe ? 'שם האלבום (חובה) *' : 'Album Title (Required) *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={newAlbumTitle}
                    onChange={(e) => setNewAlbumTitle(e.target.value)}
                    placeholder={isHe ? 'למשל: אלבום הבכורה 2024' : 'Album Title'}
                    className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white font-normal text-xs sm:text-sm focus:outline-none focus:border-white transition-all placeholder-neutral-500"
                  />
                </div>

                <div>
                  <label className="block text-white font-bold mb-1.5 text-xs sm:text-sm">
                    {isHe ? 'תמונת עטיפה לאלבום (חובה) *' : 'Album Cover Image (Required) *'}
                  </label>
                  <input
                    ref={albumCoverInputRef}
                    type="file"
                    accept="image/*,.jpg,.jpeg,.png,.webp,.gif"
                    onChange={handleAlbumCoverFileSelect}
                    className="hidden"
                  />

                  {newAlbumCover ? (
                    <div className="p-3.5 rounded-2xl bg-neutral-900 border border-white/25 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={newAlbumCover}
                          alt="Album Cover Preview"
                          className="w-16 h-16 rounded-xl object-cover border border-white/20 shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="block text-xs font-bold text-white truncate">
                            {albumCoverFileName || (isHe ? 'תמונת עטיפה נבחרה' : 'Cover image selected')}
                          </span>
                          <span className="block text-[11px] text-neutral-400">
                            {isHe ? 'מוכנה לשמירה בענן' : 'Ready for cloud upload'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => albumCoverInputRef.current?.click()}
                          className="px-3 py-1.5 rounded-lg bg-black hover:bg-white hover:text-black text-white text-[11px] font-bold border border-white/25 cursor-pointer transition-all flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>{isHe ? 'החלף תמונה' : 'Replace'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleResetAlbumCover}
                          className="p-1.5 rounded-lg bg-black hover:bg-neutral-800 text-neutral-300 hover:text-white border border-white/20 cursor-pointer transition-all"
                          title={isHe ? 'הסר תמונה' : 'Remove'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsAlbumCoverDragging(true);
                      }}
                      onDragLeave={() => setIsAlbumCoverDragging(false)}
                      onDrop={handleAlbumCoverDrop}
                      onClick={() => albumCoverInputRef.current?.click()}
                      className={`p-6 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                        isAlbumCoverDragging
                          ? 'border-white bg-white/10 scale-[1.01]'
                          : 'border-white/20 hover:border-white bg-neutral-900/70 hover:bg-neutral-900'
                      }`}
                    >
                      <FileImage className="w-8 h-8 text-white mb-2" />
                      <span className="text-xs font-bold text-white">
                        {isHe ? 'גרור תמונת עטיפה או לחץ לבחירה מהמכשיר *' : 'Drag album cover image or click to browse *'}
                      </span>
                      <span className="text-[11px] text-neutral-400 mt-1">
                        JPG, PNG, WEBP (חובה לבחור תמונה)
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-white font-bold mb-1.5 text-xs sm:text-sm">
                    {isHe ? 'תיאור האלבום (אופציונלי)' : 'Album Description'}
                  </label>
                  <textarea
                    rows={2}
                    value={newAlbumDescription}
                    onChange={(e) => setNewAlbumDescription(e.target.value)}
                    placeholder={isHe ? 'סיפור האלבום והשירים...' : 'Album story...'}
                    className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white font-normal text-xs sm:text-sm focus:outline-none focus:border-white transition-all placeholder-neutral-500"
                  />
                </div>

                {/* Add Songs to Album Button -> opens full screen selector */}
                <div className="space-y-3 pt-2 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <label className="block text-white font-bold text-xs sm:text-sm">
                      {isHe ? 'שירים באלבום' : 'Songs in Album'}
                    </label>
                    <span className="text-xs text-white/60 font-bold">
                      {selectedTrackIdsForAlbum.length} {isHe ? 'שירים נבחרו' : 'selected'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsAlbumSongSelectorOpen(true)}
                    className="w-full py-3.5 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white font-normal text-xs sm:text-sm flex items-center justify-between transition-all cursor-pointer shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Plus className="w-4 h-4 text-white" />
                      <span>{isHe ? 'בחירת / הוספת שירים לאלבום' : 'Select / Add Songs to Album'}</span>
                    </div>
                    <span className="text-white/70 text-xs font-normal">
                      {isHe ? 'לחץ לבחירת שירים ממסך מלא ←' : 'Click to select tracks →'}
                    </span>
                  </button>

                  {/* Selected Tracks Preview */}
                  {selectedTrackIdsForAlbum.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {selectedTrackIdsForAlbum.map((id) => {
                        const track = myUploadedTracks.find((t) => t.id === id);
                        if (!track) return null;
                        return (
                          <div
                            key={id}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-white text-xs font-normal"
                          >
                            <span className="max-w-[150px] truncate">{track.name}</span>
                            <button
                              type="button"
                              onClick={() => setSelectedTrackIdsForAlbum((prev) => prev.filter((i) => i !== id))}
                              className="w-4 h-4 rounded-full flex items-center justify-center text-white/60 hover:text-white cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {albumErrorMessage && (
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{albumErrorMessage}</span>
                    </div>
                )}

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSavingAlbum || !newAlbumTitle.trim() || (!newAlbumCover.trim() && !rawAlbumCoverFile)}
                    className="flex-1 py-4 rounded-2xl bg-white hover:bg-neutral-200 text-black font-black text-xs sm:text-sm transition-all shadow-xl cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSavingAlbum ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin text-black" />
                        <span>{isHe ? 'שומר באחסון הענן...' : 'Saving to Cloud...'}</span>
                      </>
                    ) : (
                      editingAlbum
                        ? (isHe ? 'שמור שינויים באלבום' : 'Save Album Changes')
                        : (isHe ? 'צור אלבום ושמור' : 'Create Album')
                    )}
                  </button>

                  {editingAlbum && (
                    <button
                      type="button"
                      onClick={handleCancelEditAlbum}
                      className="px-6 py-4 rounded-2xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs sm:text-sm transition-all cursor-pointer"
                    >
                      {isHe ? 'ביטול' : 'Cancel'}
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* FULL-SCREEN SONG SELECTOR MODAL FOR ALBUM */}
            <AnimatePresence>
              {isAlbumSongSelectorOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 z-[175] bg-black text-white flex flex-col overflow-hidden"
                  dir={isHe ? 'rtl' : 'ltr'}
                >
                  {/* Selector Top Bar */}
                  <div className="min-h-16 py-2.5 px-3 sm:px-8 border-b border-white/10 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 sm:gap-4 shrink-0 bg-black">
                    <div className="flex items-center gap-2.5 sm:gap-3 order-1">
                      <button
                        type="button"
                        onClick={() => setIsAlbumSongSelectorOpen(false)}
                        className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center cursor-pointer transition-all shrink-0"
                        aria-label={isHe ? 'סגור' : 'Close'}
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                      <h3 className="text-sm sm:text-lg font-normal text-white truncate">
                        {isHe ? 'בחירת שירים לאלבום' : 'Select Songs for Album'}
                      </h3>
                    </div>

                    {/* Keyboard / Search Input inside Selector */}
                    <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-md order-3 sm:order-2">
                      <div className="absolute inset-y-0 start-3 flex items-center pointer-events-none text-white/50">
                        <Search className="w-4 h-4 text-white/50" />
                      </div>
                      <input
                        type="text"
                        value={albumSongSearchQuery}
                        onChange={(e) => setAlbumSongSearchQuery(e.target.value)}
                        placeholder={isHe ? 'חיפוש ברשימת השירים...' : 'Search tracks...'}
                        className="w-full h-9 ps-9 pe-4 rounded-full bg-white/10 border border-white/20 text-white placeholder-white/40 text-xs font-normal focus:outline-none focus:border-white/50"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsAlbumSongSelectorOpen(false)}
                      className="order-2 sm:order-3 px-4 py-2 rounded-full bg-white hover:bg-neutral-200 text-black text-xs sm:text-sm font-normal cursor-pointer transition-all whitespace-nowrap shrink-0"
                    >
                      {isHe ? 'אישור ובחירה' : 'Confirm'}
                    </button>
                  </div>

                  {/* Songs List */}
                  <div className="flex-1 overflow-y-auto p-4 sm:p-8 max-w-4xl mx-auto w-full custom-scrollbar space-y-2">
                    {myUploadedTracks
                      .filter((t) => {
                        if (!albumSongSearchQuery.trim()) return true;
                        const q = albumSongSearchQuery.toLowerCase().trim();
                        return t.name.toLowerCase().includes(q) || (t.genre || '').toLowerCase().includes(q);
                      })
                      .map((track) => {
                        const isSelected = selectedTrackIdsForAlbum.includes(track.id);
                        return (
                          <div
                            key={track.id}
                            onClick={() => {
                              setSelectedTrackIdsForAlbum((prev) =>
                                isSelected ? prev.filter((id) => id !== track.id) : [...prev, track.id]
                              );
                            }}
                            className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                              isSelected
                                ? 'bg-white/15 border-white/50 text-white shadow-lg'
                                : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.08] text-white/80'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-12 h-12 rounded-xl overflow-hidden bg-neutral-900 border border-white/10 shrink-0">
                                <TrackCoverArt
                                  coverUrl={track.coverUrl}
                                  artistName={track.artistName}
                                  trackName={track.name}
                                  genre={track.genre}
                                />
                              </div>
                              <div className="min-w-0">
                                <h4 className="font-normal text-sm text-white truncate">{track.name}</h4>
                                <p className="text-xs text-white/60 truncate font-normal">{track.artistName} • {track.genre || 'Music'}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                              <div
                                className={`w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
                                  isSelected ? 'bg-white border-white text-black' : 'border-white/40 text-transparent'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5 stroke-[3]" />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Selector Bottom Bar */}
                  <div className="h-16 px-4 sm:px-8 border-t border-white/10 flex items-center justify-between shrink-0 bg-black">
                    <span className="text-xs sm:text-sm text-white/70 font-normal">
                      {isHe ? `נבחרו ${selectedTrackIdsForAlbum.length} שירים לאלבום` : `${selectedTrackIdsForAlbum.length} songs selected`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsAlbumSongSelectorOpen(false)}
                      className="px-6 py-2.5 rounded-full bg-white hover:bg-neutral-200 text-black font-normal text-xs sm:text-sm cursor-pointer shadow-lg transition-all"
                    >
                      {isHe ? 'סיום ובחירה' : 'Done & Confirm'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* 4. SIMPLIFIED ACCOUNT SETTINGS VIEW (Photo, Terms Confirmed, Sign Out, Delete Account — No Google text, No Bio/Style/Handle/Server) */}
        {activeTab === 'account_settings' && (
          <div key="portal-tab-settings" className="w-full min-h-screen bg-[#070b14]">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-20 pb-28 w-full space-y-6 animate-fadeIn">
            {/* Editorial Header */}
            <div className="border-b border-white/10 pb-5 space-y-1.5">
              <p className="text-[11px] font-semibold tracking-widest uppercase text-neutral-400">
                {isHe ? 'KOLOT STUDIO · הגדרות' : 'KOLOT STUDIO · SETTINGS'}
              </p>
              <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                {isHe ? 'הגדרות חשבון' : 'Account Settings'}
              </h2>
              <p className="text-xs sm:text-sm text-neutral-400">
                {isHe
                  ? 'תמונת פרופיל, אישור תנאי שימוש וניהול החשבון.'
                  : 'Profile photo, terms confirmation, and account management.'}
              </p>
            </div>

            {/* Unified Elevated Container */}
            <form
              onSubmit={handleSaveArtistAccount}
              className="rounded-2xl bg-[#09090b] border border-white/12 divide-y divide-white/8 overflow-hidden shadow-2xl"
            >
              {/* Row 1: Connected Account & Sign Out (Zero "Google" branding) */}
              <div className="p-5 sm:p-7 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5 min-w-0">
                  {activeAvatar ? (
                    <img
                      src={activeAvatar}
                      alt={resolvedArtistName}
                      referrerPolicy="no-referrer"
                      loading="eager"
                      decoding="async"
                      className="w-11 h-11 rounded-full object-cover border border-white/20 shrink-0"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-neutral-900 border border-white/15 flex items-center justify-center text-white shrink-0">
                      <User className="w-5 h-5 text-neutral-300" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white truncate">
                        {resolvedArtistName}
                      </span>
                      {currentUser && (
                        <span className="text-[11px] font-medium text-neutral-400">
                          · {isHe ? 'מאומת' : 'Verified'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-400 truncate mt-0.5">
                      {currentUser
                        ? (isHe ? 'חשבון מחובר · השירים והפרופיל מסונכרנים בענן' : 'Account connected · Synced to cloud')
                        : (isHe ? 'התחבר כדי לשמור שירים ולנהל את החשבון' : 'Sign in to publish tracks and manage account')}
                    </p>
                  </div>
                </div>

                <div className="shrink-0">
                  {currentUser ? (
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="w-full sm:w-auto px-4 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-neutral-200 border border-white/15 text-xs font-medium flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{isHe ? 'התנתק מהחשבון' : 'Sign Out'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleGoogleLogin}
                      disabled={isAuthLoading}
                      className="w-full sm:w-auto px-5 py-2 rounded-full bg-white hover:bg-neutral-200 text-black font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <span>{isHe ? 'התחבר לחשבון' : 'Sign In'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: Profile Photo Change Only */}
              <div className="p-5 sm:p-7">
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div className="relative group shrink-0">
                    <div
                      className="p-1.5 rounded-full bg-white/[0.1] backdrop-blur-2xl border border-white/30 group-hover:border-white/55 transition-all cursor-pointer"
                      style={{
                        boxShadow: `0 8px 28px rgba(${profileThemeColor.r}, ${profileThemeColor.g}, ${profileThemeColor.b}, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.4)`,
                      }}
                    >
                      <div className="relative w-20 h-20 sm:w-22 sm:h-22 rounded-full border border-white/20 overflow-hidden flex items-center justify-center bg-black">
                        {artistAvatarPreview || currentArtist.avatarUrl || currentUser?.photoURL ? (
                          <img
                            src={artistAvatarPreview || currentArtist.avatarUrl || upgradeGooglePhotoQuality(currentUser?.photoURL) || ''}
                            referrerPolicy="no-referrer"
                            loading="eager"
                            decoding="async"
                            className="w-full h-full object-cover"
                            alt="Avatar"
                          />
                        ) : (
                          <User className="w-8 h-8 text-white/50" />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setArtistAvatarFile(file);
                              const reader = new FileReader();
                              reader.onload = (ev) => setArtistAvatarPreview(ev.target?.result as string);
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                      </div>
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 bg-white text-black p-1.5 rounded-full shadow-lg border-2 border-[#09090b] pointer-events-none">
                      <Pencil className="w-3 h-3" />
                    </div>
                  </div>

                  <div className="flex-1 text-center sm:text-start space-y-1.5 min-w-0">
                    <h3 className="text-sm font-semibold text-white">{isHe ? 'שינוי תמונת פרופיל' : 'Change Profile Photo'}</h3>
                    <p className="text-xs text-neutral-400 leading-relaxed">
                      {isHe
                        ? 'לחץ על התמונה כדי לבחור תמונת פרופיל חדשה, ולחץ שמור שינויים לעדכון בענן.'
                        : 'Click the frame to pick a new photo and click Save to update.'}
                    </p>
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                      {(() => {
                        const freshUser = getCurrentAuthUser() || currentUser;
                        const accountPhoto = getGoogleAccountPhotoUrl(freshUser);
                        if (!accountPhoto) return null;
                        return (
                          <button
                            type="button"
                            onClick={handleRestoreGoogleAvatar}
                            disabled={isRestoringGoogleAvatar}
                            className="px-3 py-1 rounded-full bg-white/[0.07] hover:bg-white/[0.15] text-white text-[11px] font-medium border border-white/15 cursor-pointer transition-colors disabled:opacity-50"
                          >
                            {isRestoringGoogleAvatar
                              ? (isHe ? 'משחזר...' : 'Restoring...')
                              : (isHe ? 'שחזר תמונת חשבון' : 'Restore Account Photo')}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 3: Locked Terms Accepted Indicator (Cannot be cancelled) */}
              <div className="p-5 sm:p-7 space-y-4 text-xs">
                <div className="flex items-start gap-3 select-none opacity-95">
                  <input
                    type="checkbox"
                    id="termsSettingsCheckPortal"
                    checked={true}
                    disabled={true}
                    readOnly
                    className="mt-0.5 w-4.5 h-4.5 rounded border-white/40 bg-white accent-white cursor-not-allowed flex-shrink-0"
                  />
                  <div className="text-xs leading-relaxed text-neutral-300">
                    <span className="font-semibold text-white block mb-0.5">
                      {isHe ? 'תנאי השימוש אושרו' : 'Terms of Service Accepted'}
                    </span>
                    <span className="text-neutral-400">
                      {isHe
                        ? 'אישור תנאי השימוש ומדיניות הפלטפורמה קבוע לחשבון זה ואינו ניתן לביטול.'
                        : 'Acceptance of platform terms is permanent for this account and cannot be revoked.'}
                    </span>
                  </div>
                </div>

                {authError && (
                  <p className="text-xs text-rose-300 font-medium bg-rose-500/10 border border-rose-500/25 px-3.5 py-2.5 rounded-xl">
                    {authError}
                  </p>
                )}
              </div>

              {/* Row 4: Footer Submit Bar */}
              <div className="px-5 sm:px-7 py-4 bg-white/[0.02] flex items-center justify-end gap-3">
                <button
                  type="submit"
                  disabled={isPairing}
                  className="px-7 py-2.5 rounded-full bg-white hover:bg-neutral-200 text-black font-bold text-xs sm:text-sm transition-colors shadow-lg cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  {isPairing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-black" />
                      <span>{isHe ? 'שומר...' : 'Saving...'}</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-black" />
                      <span>{isHe ? 'שמור שינויים' : 'Save Changes'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {/* Admin Reports & Messages Inbox Preview in Settings (STRICTLY ADMIN ONLY) */}
            {currentUser?.isAdmin && (
              <div className="rounded-2xl bg-[#09090b] border border-white/15 p-5 sm:p-7 space-y-4 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-white shrink-0" />
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        {isHe ? 'תיבת דיווחים והודעות (למנהל בלבד)' : 'Reports & Messages Inbox (Admin Only)'}
                      </h3>
                      <p className="text-[11px] text-neutral-400">
                        {isHe
                          ? 'כל ההודעות והדיווחים מהמשתמשים בתוך האפליקציה — חשופים אך ורק לחשבון המנהל שלך.'
                          : 'All user reports and messages inside the app — strictly visible to your admin account only.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-white/70">
                      {adminMessages.length + adminReports.length}
                    </span>
                    {onOpenAdminPanel && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenAdminPanel('messages');
                        }}
                        className="px-3 py-1.5 rounded-full bg-white text-black text-[11px] font-bold hover:bg-neutral-200 transition-colors cursor-pointer"
                      >
                        {isHe ? 'פתח לוח ניהול מלא' : 'Open Admin Panel'}
                      </button>
                    )}
                  </div>
                </div>

                {adminMessages.length === 0 && adminReports.length === 0 ? (
                  <p className="text-xs text-neutral-500">
                    {isHe ? 'אין כרגע דיווחים או הודעות פתוחות.' : 'No open reports or messages.'}
                  </p>
                ) : (
                  <div className="space-y-2.5 max-h-72 overflow-y-auto custom-scrollbar">
                    {adminReports.map((rep) => (
                      <div key={rep.id} className="p-3.5 rounded-xl bg-black border border-rose-500/30 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white truncate">
                            {isHe ? `דיווח על שיר: ${rep.trackName}` : `Report: ${rep.trackName}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setAdminReports((prev) => prev.filter((r) => r.id !== rep.id));
                              void dismissTrackReportInR2(rep.id);
                            }}
                            className="text-[11px] text-neutral-400 hover:text-white cursor-pointer shrink-0"
                          >
                            {isHe ? 'טופל / מחק' : 'Dismiss'}
                          </button>
                        </div>
                        <div className="text-[11px] text-neutral-400">
                          {rep.artistName} · {rep.reason}
                        </div>
                        {(rep.uploaderEmail || rep.reporterEmail) && (
                          <div className="space-y-0.5 text-[11px] text-neutral-300">
                            {rep.uploaderEmail && (
                              <div>
                                <span className="text-neutral-500">{isHe ? 'מייל בעל הפרופיל שהעלה את השיר: ' : 'Uploader Email: '}</span>
                                <span className="font-mono text-white" dir="ltr">{rep.uploaderEmail}</span>
                              </div>
                            )}
                            {rep.reporterEmail && (
                              <div>
                                <span className="text-neutral-500">{isHe ? 'מייל מפרסם הדיווח: ' : 'Reporter Email: '}</span>
                                <span className="font-mono text-white" dir="ltr">{rep.reporterEmail}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {rep.details && <p className="text-xs text-neutral-200 whitespace-pre-wrap">{rep.details}</p>}
                        {rep.legalDocumentKey && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await fetch(
                                  `/api/admin/legal-doc?key=${encodeURIComponent(rep.legalDocumentKey!)}`,
                                  { headers: getAuthHeaders(), credentials: 'include' }
                                );
                                if (!res.ok) return;
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = rep.legalDocumentName || 'legal-document';
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                                setTimeout(() => URL.revokeObjectURL(url), 2500);
                              } catch {}
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-black hover:bg-neutral-200 font-bold text-[11px] transition-colors cursor-pointer"
                          >
                            <Paperclip className="w-3 h-3" />
                            <span>
                              {isHe
                                ? `הורד מסמך משפטי (${rep.legalDocumentName || 'קובץ'})`
                                : `Download Legal Doc (${rep.legalDocumentName || 'File'})`}
                            </span>
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                    {adminMessages.map((msg) => (
                      <div key={msg.id} className="p-3.5 rounded-xl bg-black border border-white/12 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white truncate">{msg.subject}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setAdminMessages((prev) => prev.filter((m) => m.id !== msg.id));
                              void dismissContactMessageInAdmin(msg.id);
                            }}
                            className="text-[11px] text-neutral-400 hover:text-white cursor-pointer shrink-0"
                          >
                            {isHe ? 'טופל / מחק' : 'Dismiss'}
                          </button>
                        </div>
                        <div className="text-[11px] text-neutral-400">
                          {msg.reporterEmail || msg.senderEmail} · {msg.categoryLabel || msg.category}
                        </div>
                        {(msg.uploaderEmail || msg.reporterEmail) && (
                          <div className="space-y-0.5 text-[11px] text-neutral-300">
                            {msg.uploaderEmail && (
                              <div>
                                <span className="text-neutral-500">{isHe ? 'מייל בעל הפרופיל שהעלה את השיר: ' : 'Uploader Email: '}</span>
                                <span className="font-mono text-white" dir="ltr">{msg.uploaderEmail}</span>
                              </div>
                            )}
                            {msg.reporterEmail && (
                              <div>
                                <span className="text-neutral-500">{isHe ? 'מייל מפרסם הדיווח: ' : 'Reporter Email: '}</span>
                                <span className="font-mono text-white" dir="ltr">{msg.reporterEmail}</span>
                              </div>
                            )}
                          </div>
                        )}
                        <p className="text-xs text-neutral-200 whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                        {msg.legalDocumentKey && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const res = await fetch(
                                  `/api/admin/legal-doc?key=${encodeURIComponent(msg.legalDocumentKey!)}`,
                                  { headers: getAuthHeaders(), credentials: 'include' }
                                );
                                if (!res.ok) return;
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = msg.legalDocumentName || 'legal-document';
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                                setTimeout(() => URL.revokeObjectURL(url), 2500);
                              } catch {}
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white text-black hover:bg-neutral-200 font-bold text-[11px] transition-colors cursor-pointer"
                          >
                            <Paperclip className="w-3 h-3" />
                            <span>
                              {isHe
                                ? `הורד מסמך משפטי (${msg.legalDocumentName || 'קובץ'})`
                                : `Download Legal Doc (${msg.legalDocumentName || 'File'})`}
                            </span>
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Danger Zone: Self-Service Account Deletion */}
            {currentUser && (
              <div className="rounded-2xl bg-[#120b0d] border border-rose-500/25 p-5 sm:p-7 space-y-4 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-sm sm:text-base font-bold text-rose-200 flex items-center gap-2">
                      <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>{isHe ? 'מחיקת חשבון' : 'Delete Account'}</span>
                    </h3>
                    <p className="text-xs text-neutral-400 leading-relaxed max-w-xl">
                      {isHe
                        ? 'מחיקת החשבון תסיר את פרופיל המשתמש והאמן שלך ותנתק אותך מהאתר לצמיתות. שירים שכבר העלית יישארו זמינים בנגן.'
                        : 'Deleting your account permanently removes your profile and avatar and signs you out. Published tracks remain available.'}
                    </p>
                  </div>

                  {!confirmDeleteAccount && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteAccountError(null);
                        setConfirmDeleteAccount(true);
                      }}
                      className="self-start sm:self-auto px-5 py-2.5 rounded-full bg-rose-600/20 hover:bg-rose-600/35 border border-rose-500/40 text-rose-200 text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isHe ? 'מחיקת חשבון' : 'Delete Account'}</span>
                    </button>
                  )}
                </div>

                {deleteAccountError && (
                  <p className="text-xs text-rose-300 bg-rose-950/60 border border-rose-500/35 px-3.5 py-2.5 rounded-xl">
                    {deleteAccountError}
                  </p>
                )}

                {confirmDeleteAccount && (
                  <div className="rounded-xl bg-black/70 border border-rose-500/35 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-rose-100 leading-relaxed">
                      <span className="font-bold block">
                        {isHe ? 'האם אתה בטוח שברצונך למחוק את החשבון?' : 'Are you sure you want to delete your account?'}
                      </span>
                      <span className="text-neutral-400">
                        {isHe ? 'פעולה זו אינה הפיכה ותסיים את ההתחברות שלך מיידית.' : 'This action cannot be undone and signs you out immediately.'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isDeletingAccount}
                        onClick={() => {
                          setConfirmDeleteAccount(false);
                          setDeleteAccountError(null);
                        }}
                        className="px-4 py-2 rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/15 text-white text-xs font-medium cursor-pointer transition-colors disabled:opacity-50"
                      >
                        {isHe ? 'ביטול' : 'Cancel'}
                      </button>
                      <button
                        type="button"
                        disabled={isDeletingAccount}
                        onClick={handleDeleteOwnAccount}
                        className="px-5 py-2 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer transition-colors flex items-center gap-2 disabled:opacity-50"
                      >
                        {isDeletingAccount ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>{isHe ? 'מוחק חשבון...' : 'Deleting...'}</span>
                          </>
                        ) : (
                          <>
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{isHe ? 'אשר מחיקת חשבון' : 'Confirm Delete'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        )}

        {/* DEDICATED ALBUM MODAL INSIDE ARTIST PORTAL */}
        {selectedAlbumForView && (
          <AlbumModal
            isOpen={!!selectedAlbumForView}
            onClose={() => setSelectedAlbumForView(null)}
            album={selectedAlbumForView}
            allTracks={allTracks}
            onPlayTrack={(track) => {
              if (onPlayTrack) {
                onPlayTrack(track);
              }
            }}
            lang={lang}
            onToggleLike={() => {}}
            likedSongIds={[]}
            onOpenArtistProfile={() => {
              setSelectedAlbumForView(null);
              setActiveTab('profile');
            }}
          />
        )}

        {/* BLOCKING CENTERED FLOATING SQUARE PROGRESS OVERLAY ("מפרסם..." / "שומר שינויים...") */}
        {(isPublishing || isSavingEdit) && (() => {
          const rawPct = isPublishing ? uploadProgressPercent : editProgressPercent;
          const pct = Math.max(0, Math.min(100, Math.round(rawPct || 0)));
          const radius = 44;
          const circumference = 2 * Math.PI * radius;
          const dashOffset = circumference - (pct / 100) * circumference;

          return (
            <div
              className="fixed inset-0 z-[260] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none"
              aria-modal="true"
              role="dialog"
              dir={isHe ? 'rtl' : 'ltr'}
            >
              <div className="w-56 h-56 sm:w-64 sm:h-64 rounded-3xl bg-[#09090b] border border-white/25 shadow-[0_24px_80px_rgba(0,0,0,0.95)] flex flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="relative w-28 h-28 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
                    <circle
                      cx="50"
                      cy="50"
                      r={radius}
                      fill="none"
                      stroke="rgba(255,255,255,0.14)"
                      strokeWidth="6"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r={radius}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={dashOffset}
                      className="transition-[stroke-dashoffset] duration-300 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-black text-white font-mono tabular-nums">
                      {pct}%
                    </span>
                  </div>
                </div>

                <p className="text-sm sm:text-base font-bold text-white tracking-tight">
                  {isPublishing
                    ? (isHe ? 'מפרסם...' : 'Publishing...')
                    : (isHe ? 'שומר שינויים...' : 'Saving changes...')}
                </p>
              </div>
            </div>
          );
        })()}

      </motion.div>
    </AnimatePresence>
  );
};
