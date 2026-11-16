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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, ArtistProfile, Album, SubtitleSegment, CURRENT_TERMS_VERSION } from '../types';
import {
  AuthUser,
  getCurrentAuthUser,
  loginWithGoogle,
  logoutUser,
  onAuthUserChanged,
  updateCurrentAuthUserProfile,
  restoreGoogleAvatarInCloud,
  getEffectiveUserAvatar,
  getGoogleAccountPhotoUrl,
  upgradeGooglePhotoQuality,
} from '../services/authService';
import {
  uploadTrackToCloud,
  deleteTrackFromCloud,
  uploadAlbumToCloud,
  deleteAlbumFromCloud,
  syncArtistAvatarToTracksInR2,
  getCloudStorageConfig,
  checkR2StorageStatus,
} from '../services/cloudStorageService';
import { TrackCoverArt } from './TrackCoverArt';
import { getTrackInstantColor, globalTrackColorCache, extractImageColor } from '../services/colorService';
import { transcribeTrackWithWhisperAI } from '../aiLyricsGenerator';
import { sanitizeSubtitleLettersOnly } from '../services/onDeviceWhisperService';
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
  updateMemoryTracksArtistAvatar,
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
}) => {
  const isHe = lang === 'he';

  const [activeTab, setActiveTab] = useState<'profile' | 'manual_upload' | 'account_settings' | 'albums'>(initialTab);

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
  const [genreInput, setGenreInput] = useState(() => initialCachedProfile?.genre || 'ללא סגנון מוזיקלי');
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
  const [lyricsInput, setLyricsInput] = useState('');
  const [whisperDraftSegments, setWhisperDraftSegments] = useState<SubtitleSegment[] | undefined>(undefined);
  const [whisperDraftSegmentsHe, setWhisperDraftSegmentsHe] = useState<SubtitleSegment[] | undefined>(undefined);
  const [whisperDraftSegmentsEn, setWhisperDraftSegmentsEn] = useState<SubtitleSegment[] | undefined>(undefined);
  const [whisperDraftLyricsHe, setWhisperDraftLyricsHe] = useState('');
  const [whisperDraftLyricsEn, setWhisperDraftLyricsEn] = useState('');
  const [uploadSubtitleLangTab, setUploadSubtitleLangTab] = useState<'he' | 'en'>('he');
  const [includeSubtitles, setIncludeSubtitles] = useState<boolean>(true);
  const [subtitleLangChoice, setSubtitleLangChoice] = useState<'auto' | 'he' | 'en'>('auto');
  const [isTranscribingUpload, setIsTranscribingUpload] = useState(false);
  const [whisperProgressText, setWhisperProgressText] = useState('');
  const [whisperUploadNotice, setWhisperUploadNotice] = useState<string | null>(null);
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


  // File upload refs & drag-and-drop states
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
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

  // 1GB file size limit for audio and image uploads (direct R2 presigned PUT)
  const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB

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
  const [editLyrics, setEditLyrics] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletedTrackIds, setDeletedTrackIds] = useState<string[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

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
    setEditLyrics(track.lyrics || '');
    setEditIsAiGenerated(!!track.isAiGenerated);
  };

  const handleSaveEditTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTrack) return;
    setIsSavingEdit(true);

    const updatedTrack: JamendoTrack = {
      ...editingTrack,
      name: editTitle.trim() || editingTrack.name,
      artistName: editPerformingArtist.trim() || editingTrack.artistName,
      featuredArtist: editFeaturedArtist.trim() || undefined,
      writers: editWriters.trim() || undefined,
      genre: editGenre.trim() || editingTrack.genre,
      albumName: editAlbum.trim() || editingTrack.albumName,
      lyrics: editLyrics.trim() || undefined,
      isAiGenerated: editIsAiGenerated,
    };

    try {
      await uploadTrackToCloud(updatedTrack);
    } catch (err) {
      console.warn('Cloud edit sync notice:', err);
    }

    onTrackPublished(updatedTrack);
    setIsSavingEdit(false);
    setEditingTrack(null);
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
  const [myAlbums, setMyAlbums] = useState<Album[]>(() => {
    const stored: Album[] = getCachedAlbums();

    const albumMap = new Map<string, Album>();
    stored.forEach((a) => {
      if (a.title && a.id) {
        albumMap.set(a.title.toLowerCase().trim(), a);
      }
    });

    const invalidNames = new Set(['single', 'single release', 'unknown album', 'סינגל', 'סינגל עצמאי', 'ללא אלבום', 'independent single', 'none']);

    allTracks.forEach((t) => {
      const cleanAlbum = (t.albumName || '').trim();
      const lower = cleanAlbum.toLowerCase();
      if (cleanAlbum && !invalidNames.has(lower) && !lower.startsWith('סינגל') && !lower.startsWith('single')) {
        const key = cleanAlbum.toLowerCase().trim();
        if (!albumMap.has(key)) {
          albumMap.set(key, {
            id: `album-${t.id}`,
            title: cleanAlbum,
            artistName: t.artistName,
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
  const [selectedAlbumForView, setSelectedAlbumForView] = useState<Album | null>(null);
  const [editingAlbum, setEditingAlbum] = useState<Album | null>(null);

  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(true);
  const [customServerUrlInput, setCustomServerUrlInput] = useState('');

  useEffect(() => {
    const hydrateFields = (artist: ArtistProfile, user: AuthUser) => {
      setArtistNameInput(artist.name || user.displayName || '');
      if (artist.bio) setArtistBioInput(artist.bio);
      if (artist.genre) setGenreInput(artist.genre);
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
  };

  const processAudioFile = (file: File) => {
    if (!file) return;
    setFileUploadError(null);
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileUploadError(isHe ? 'קובץ השמע חורג מ-1GB. יש לבחור קובץ עד 1GB.' : 'Audio file exceeds 1GB limit.');
      return;
    }
    setRawAudioFile(file);
    setAudioFileName(file.name);
    const blobUrl = URL.createObjectURL(file);
    setAudioStreamUrl(blobUrl);
    if (!songTitle.trim()) {
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      setSongTitle(cleanName);
    }
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

  const handleStartEditAlbum = (album: Album) => {
    setEditingAlbum(album);
    setNewAlbumTitle(album.title);
    setNewAlbumCover(album.coverUrl || '');
    setNewAlbumDescription(album.description || '');
    setSelectedTrackIdsForAlbum(album.trackIds || []);
    setActiveTab('albums');
  };

  const handleCancelEditAlbum = () => {
    setEditingAlbum(null);
    setNewAlbumTitle('');
    setNewAlbumCover('');
    setNewAlbumDescription('');
    setSelectedTrackIdsForAlbum([]);
  };

  const handleDeleteAlbum = async (albumId: string) => {
    const updated = myAlbums.filter((a) => a.id !== albumId);
    setMyAlbums(updated);
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
    if (!newAlbumTitle.trim()) return;

    setIsSavingAlbum(true);
    setAlbumErrorMessage(null);

    try {
      let album: Album;
      if (editingAlbum) {
        album = {
          ...editingAlbum,
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
          coverUrl: newAlbumCover.trim() || coverArtUrl || undefined,
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
        ? myAlbums.map((a) => (a.id === editingAlbum.id ? album : a))
        : [album, ...myAlbums];

      setMyAlbums(updatedAlbums);
      saveCachedAlbums(updatedAlbums);
      setEditingAlbum(null);
      setNewAlbumTitle('');
      setNewAlbumCover('');
      setNewAlbumDescription('');
      setRawAlbumCoverFile(null);
      setAlbumCoverFileName('');
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
    const finalName = artistNameInput.trim() || currentArtist.name || currentUser?.displayName || 'אמן מוזיקלי';
    if (!finalName) return;

    setIsPairing(true);
    setAuthError(null);

    try {
      const cleanHandle = connectionCodeInput.trim().replace(/^@/, '');
      const accountUrl = cleanHandle
        ? (cleanHandle.startsWith('http') ? cleanHandle : `https://audius.co/${cleanHandle}`)
        : undefined;

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
        bio: artistBioInput.trim() || currentArtist.bio || (isHe ? 'אמן עצמאי בפלטפורמה' : 'Independent artist'),
        avatarUrl: previewOrCurrent,
        genre: genreInput || currentArtist.genre,
        audiusHandle: cleanHandle || currentArtist.audiusHandle,
        archiveAccountUrl: accountUrl || currentArtist.archiveAccountUrl,
        googleUid: currentUser?.uid || currentArtist.googleUid || artistIdForUpload,
        isConnected: true,
        hasAcceptedTerms: true,
        termsVersionAccepted: currentArtist.termsVersionAccepted ?? CURRENT_TERMS_VERSION,
        acceptedTermsAt: currentArtist.acceptedTermsAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isPrivate: false,
        customServerUrl: customServerUrlInput.trim() || undefined,
      };

      const saveRes = await saveArtistAccountToR2(
        updatedArtistDraft,
        avatarBlobToUpload,
        { purgeOldAvatars: !!avatarBlobToUpload }
      );
      if (!saveRes.success) {
        setAuthError(saveRes.error || (isHe ? 'שמירת הפרופיל ל-Cloudflare R2 נכשלה.' : 'Failed to save profile to R2.'));
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
    setRawAudioFile(null);
    setAudioFileName('');
    setAudioStreamUrl('');
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
    const result = await classifyTrackAudio({
      audioFile: rawAudioFile || undefined,
      audioUrl: !rawAudioFile ? audioStreamUrl.trim() : undefined,
      songTitle: songTitle.trim(),
      artistName: performingArtistInput.trim() || currentArtist.name,
      lyrics: lyricsInput.trim(),
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

  // Publish Track -> Direct, Verified Fast Commit to Public Cloud Storage (< 10s)
  const handlePublishTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentArtist || !songTitle.trim() || !audioStreamUrl.trim() || !coverArtUrl.trim() || !hasCertifiedRights) return;

    setIsPublishing(true);
    setPublishErrorMessage(null);
    setUploadProgressPercent(4);
    setPublishProgressStep(isHe ? 'מכין העלאה ישירה ל-Cloudflare R2...' : 'Preparing direct Cloudflare R2 upload...');

    let effectiveGenre = genreInput === 'אחר' ? (customGenreText.trim() || (isHe ? 'שונות' : 'Other')) : genreInput;

    // Fast (<250ms) on-device DSP genre classification when untagged — zero network, zero model wait
    if (!effectiveGenre || effectiveGenre === 'ללא סגנון מוזיקלי') {
      try {
        const autoCls = await classifyTrackAudio({
          audioFile: rawAudioFile || undefined,
          audioUrl: !rawAudioFile ? audioStreamUrl.trim() : undefined,
          songTitle: songTitle.trim(),
          artistName: performingArtistInput.trim() || currentArtist.name,
          lyrics: lyricsInput.trim(),
          deepClassify: false,
        });
        if (autoCls.success && autoCls.genre) {
          effectiveGenre = autoCls.genre;
        }
      } catch {}
    }

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

    // Extract accurate color from the cover quickly (capped at 250ms so publish never stalls)
    let computedColor = getTrackInstantColor(tempTrackForColor);
    try {
      if (coverArtUrl.trim()) {
        const extractedBefore = await Promise.race([
          extractImageColor(coverArtUrl.trim()),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
        ]);
        if (extractedBefore) {
          computedColor = extractedBefore;
        }
      }
    } catch {}
    const cachedBgColor = `radial-gradient(circle at 50% 35%, rgba(${computedColor.r}, ${computedColor.g}, ${computedColor.b}, 0.8) 0%, rgba(${Math.round(computedColor.r * 0.18)}, ${Math.round(computedColor.g * 0.18)}, ${Math.round(computedColor.b * 0.18)}, 0.96) 55%, #030712 100%)`;

    const updatedArtist: ArtistProfile = {
      ...currentArtist,
      isPrivate: false,
      tracksCount: (currentArtist.tracksCount || 0) + 1,
    };
    setCurrentArtist(updatedArtist);
    saveArtistAccountToR2(updatedArtist).catch(() => {});

    const finalArtistName = performingArtistInput.trim() || currentArtist.name || currentUser?.displayName || (isHe ? 'אמן' : 'Artist');

    let finalDraftSegments = whisperDraftSegments;
    let finalDraftSegmentsHe = whisperDraftSegmentsHe;
    let finalDraftSegmentsEn = whisperDraftSegmentsEn;
    let finalDraftLyricsHe = whisperDraftLyricsHe;
    let finalDraftLyricsEn = whisperDraftLyricsEn;
    let sanitizedManualLyrics = lyricsInput.trim() ? sanitizeSubtitleLettersOnly(lyricsInput.trim()) : '';

    if (!includeSubtitles) {
      finalDraftSegments = undefined;
      finalDraftSegmentsHe = undefined;
      finalDraftSegmentsEn = undefined;
      finalDraftLyricsHe = '';
      finalDraftLyricsEn = '';
      sanitizedManualLyrics = '';
    } else {
      const hasDraftAlready =
        !!(finalDraftSegments && finalDraftSegments.length > 0) ||
        !!(finalDraftSegmentsHe && finalDraftSegmentsHe.length > 0) ||
        !!(finalDraftSegmentsEn && finalDraftSegmentsEn.length > 0);

      if (!hasDraftAlready && !sanitizedManualLyrics && (rawAudioFile || audioStreamUrl.trim())) {
        try {
          setPublishProgressStep(isHe ? 'יוצר כתוביות מדויקות על המכשיר...' : 'Generating on-device subtitles...');
          setUploadProgressPercent(12);
          const autoSubRes = await transcribeTrackWithWhisperAI({
            audioFile: rawAudioFile || undefined,
            track: !rawAudioFile && audioStreamUrl.trim() ? {
              id: trackId,
              name: songTitle.trim(),
              artistName: finalArtistName,
              albumName: albumTitle.trim() || 'Single',
              duration: 180,
              audioUrl: audioStreamUrl.trim(),
              coverUrl: coverArtUrl.trim(),
            } : undefined,
            language: isHe ? 'he' : 'en',
            subtitleLanguageHint: subtitleLangChoice,
            onProgress: (txt) => setPublishProgressStep(txt),
          });
          if (autoSubRes.success) {
            finalDraftSegments = autoSubRes.segments || autoSubRes.segmentsHe;
            finalDraftSegmentsHe = autoSubRes.segmentsHe;
            finalDraftSegmentsEn = autoSubRes.segmentsEn;
            finalDraftLyricsHe = autoSubRes.lyricsHe || '';
            finalDraftLyricsEn = autoSubRes.lyricsEn || '';
          }
        } catch (subErr) {
          console.warn('[PublishTrack] Auto-subtitle skipped gracefully:', subErr);
        }
      }
    }

    const hasAnyDraftSubtitles =
      includeSubtitles &&
      (!!(finalDraftSegments && finalDraftSegments.length > 0) ||
        !!(finalDraftSegmentsHe && finalDraftSegmentsHe.length > 0) ||
        !!(finalDraftSegmentsEn && finalDraftSegmentsEn.length > 0));

    const newTrack: JamendoTrack = {
      id: trackId,
      name: songTitle.trim(),
      artistName: finalArtistName,
      featuredArtist: featuredArtistInput.trim() || undefined,
      writers: writersInput.trim() || undefined,
      albumName: albumTitle.trim() || (isHe ? 'סינגל עצמאי' : 'Independent Single'),
      duration: 180,
      audioUrl: audioStreamUrl.trim(),
      coverUrl: coverArtUrl.trim(),
      genre: effectiveGenre,
      license: 'Kolot Music Cloud Storage (10GB)',
      licenseUrl: currentArtist.archiveAccountUrl || 'https://audius.co',
      source: 'Kolot R2 Storage',
      legalStatus: '100% שיר עצמאי מקורי ומאושר להאזנה',
      lyrics: includeSubtitles ? (sanitizedManualLyrics || finalDraftLyricsHe || finalDraftLyricsEn || undefined) : undefined,
      lyricsHe: includeSubtitles ? (finalDraftLyricsHe || sanitizedManualLyrics || undefined) : undefined,
      lyricsEn: includeSubtitles ? (finalDraftLyricsEn || undefined) : undefined,
      subtitleSegments: hasAnyDraftSubtitles ? (finalDraftSegments && finalDraftSegments.length > 0 ? finalDraftSegments : finalDraftSegmentsHe) : undefined,
      subtitleSegmentsHe: hasAnyDraftSubtitles && finalDraftSegmentsHe && finalDraftSegmentsHe.length > 0 ? finalDraftSegmentsHe : undefined,
      subtitleSegmentsEn: hasAnyDraftSubtitles && finalDraftSegmentsEn && finalDraftSegmentsEn.length > 0 ? finalDraftSegmentsEn : undefined,
      hasWhisperSubtitles: hasAnyDraftSubtitles,
      artistBio: currentArtist.bio,
      artistAvatarUrl: getEffectiveUserAvatar(currentUser, currentArtist) || undefined,
      publisherAccountUrl: currentArtist.archiveAccountUrl || 'https://audius.co',
      uploadedByUid: currentUser?.uid || currentArtist.googleUid || currentArtist.id,
      isPrivate: false,
      customServerUrl: customServerUrlInput.trim() || undefined,
      bgColor: cachedBgColor,
      isAiGenerated: isAiGeneratedInput,
    };

    const currentAudioFile = rawAudioFile;
    const currentCoverFile = rawCoverFile;

    try {
      setPublishProgressStep(isHe ? 'מעלה ישירות ל-Cloudflare R2...' : 'Uploading directly to Cloudflare R2...');

      // 1. DIRECT PARALLEL UPLOAD TO CLOUDFLARE R2 (audio + compressed cover + tracks/*.json)
      const cloudRes = await uploadTrackToCloud(
        newTrack,
        currentAudioFile || undefined,
        currentCoverFile || undefined,
        (pct, msg) => {
          setUploadProgressPercent(pct);
          setPublishProgressStep(msg);
        }
      );

      if (!cloudRes.success) {
        setIsPublishing(false);
        setUploadProgressPercent(0);
        setPublishErrorMessage(
          cloudRes.error ||
            (isHe
              ? 'שגיאה בשמירת השיר באחסון Cloudflare R2. אנא ודא שהדלי והמפתחות בשרת תקינים.'
              : 'Failed to publish track to Cloudflare R2.')
        );
        return;
      }

      if (cloudRes.audioUrl) {
        newTrack.audioUrl = cloudRes.audioUrl;
      }
      if (cloudRes.coverUrl) {
        newTrack.coverUrl = cloudRes.coverUrl;
      }

      // Pre-cache color under both track ID and final R2 cover URL
      globalTrackColorCache.set(newTrack.id, computedColor);
      if (newTrack.coverUrl) {
        globalTrackColorCache.set(newTrack.coverUrl, computedColor);
      }

      // 2. Sync artist profile in R2
      void saveArtistAccountToR2(updatedArtist).catch(() => {});

      // 3. Broadcast track immediately to UI
      saveCachedCloudTracks([newTrack, ...getInstantSongPool()]);
      onTrackPublished(newTrack);
      void fetchAllRealSongs().catch(() => {});
      void fetchAllArtistProfiles().catch(() => {});

      setUploadProgressPercent(100);
      setPublishProgressStep(isHe ? 'השיר נשמר ב-Cloudflare R2 וזמין בכל המכשירים!' : 'Track saved to Cloudflare R2!');
      setPublishSuccess(true);

      // Reset form
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
      setSubtitleLangChoice('auto');
      setLyricsInput('');
      setWhisperDraftSegments(undefined);
      setWhisperDraftSegmentsHe(undefined);
      setWhisperDraftSegmentsEn(undefined);
      setWhisperDraftLyricsHe('');
      setWhisperDraftLyricsEn('');
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

  if (!currentUser) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="fixed inset-0 z-[130] w-screen h-screen bg-[#070b14]/95 backdrop-blur-3xl overflow-y-auto text-white flex flex-col items-center justify-center p-4 sm:p-6"
          dir={isHe ? 'rtl' : 'ltr'}
        >
          <button
            onClick={onClose}
            className="absolute top-6 right-6 w-11 h-11 rounded-full flex items-center justify-center text-white border border-white/25 bg-slate-900/80 hover:bg-white/10 transition-all cursor-pointer shadow-2xl"
            title={isHe ? 'סגור' : 'Close'}
          >
            <X className="w-5 h-5 text-white/80" />
          </button>

          <div className="w-full max-w-md bg-[#0b0d12] border border-white/15 rounded-3xl p-8 shadow-2xl text-center space-y-6 animate-fadeIn">
            <div className="w-20 h-20 rounded-3xl bg-neutral-900 border border-white/20 text-white flex items-center justify-center mx-auto shadow-2xl">
              <User className="w-10 h-10 text-emerald-400" />
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
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className={`fixed inset-0 z-[120] w-screen h-screen ${
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
                className="px-3.5 sm:px-4 py-2 rounded-full flex items-center gap-2 text-xs sm:text-sm font-normal text-white border border-white/20 bg-white/10 hover:bg-white/20 backdrop-blur-xl shadow-xl cursor-pointer active:scale-95 transition-all"
              >
                <span>{isHe ? `חזור לפרופיל של ${resolvedArtistName}` : `Back to ${resolvedArtistName}`}</span>
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
            <button
              onClick={() => setActiveTab('account_settings')}
              className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-lg backdrop-blur-xl border ${
                activeTab === 'account_settings'
                  ? 'bg-white/25 text-white border-white/40'
                  : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
              }`}
              title={isHe ? 'הגדרות' : 'Settings'}
            >
              <Settings className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
        )}

        {/* 1. PUBLIC ARTIST PROFILE SCREEN - STEADY DARK HEADER, ZERO COLOR FLASHES */}
        {activeTab === 'profile' && (
          <div className="w-full flex-1 flex flex-col bg-[#08090d]">
            <div className="relative w-full overflow-hidden border-b border-white/10 bg-[#0b0d13]">
              <div className="relative w-full h-28 sm:h-36 overflow-hidden bg-gradient-to-b from-white/[0.04] to-[#08090d]" />

              <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 -mt-12 sm:-mt-14 pb-5 flex flex-col sm:flex-row items-center sm:items-end gap-4">
                <div className="relative flex-shrink-0">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-[#08090d] bg-neutral-900 shadow-2xl overflow-hidden ring-2 ring-white/20 flex items-center justify-center">
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
                      <div className="w-full h-full rounded-full flex items-center justify-center bg-neutral-900 text-white font-bold text-2xl select-none">
                        {currentArtist.name?.[0] || 'A'}
                      </div>
                    )}
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
                        className="group relative min-w-[170px] max-w-[190px] p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/15 transition-all shadow-xl space-y-2.5 flex flex-col justify-between"
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

            {/* EDIT SONG MODAL FOR PROFILE OWNER */}
            {editingTrack && (
              <div className="fixed inset-0 z-[160] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                <div className="w-full max-w-lg bg-neutral-900 border border-emerald-500/40 rounded-3xl p-6 shadow-2xl space-y-4 animate-fadeIn">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h3 className="text-base font-black text-white flex items-center gap-2">
                      <Pencil className="w-4 h-4 text-emerald-400" />
                      <span>{isHe ? `עריכת שיר: ${editingTrack.name}` : `Edit Track: ${editingTrack.name}`}</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setEditingTrack(null)}
                      className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <form onSubmit={handleSaveEditTrack} className="space-y-4 text-xs">
                    <div>
                      <label className="block text-white/90 font-bold mb-1">{isHe ? 'שם השיר' : 'Song Title'}</label>
                      <input
                        type="text"
                        required
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-800 border border-neutral-700 text-white font-bold focus:outline-none focus:border-emerald-400"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-white/90 font-bold mb-1">{isHe ? 'שם הזמר / אמן מבצע' : 'Performing Artist'}</label>
                        <input
                          type="text"
                          value={editPerformingArtist}
                          onChange={(e) => setEditPerformingArtist(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-800 border border-neutral-700 text-white font-bold focus:outline-none focus:border-emerald-400"
                        />
                      </div>

                      <div>
                        <label className="block text-white/90 font-bold mb-1">{isHe ? 'זמר אורח (Feat.)' : 'Featured Artist'}</label>
                        <input
                          type="text"
                          value={editFeaturedArtist}
                          onChange={(e) => setEditFeaturedArtist(e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-800 border border-neutral-700 text-white font-bold focus:outline-none focus:border-emerald-400"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-white/90 font-bold mb-1">{isHe ? 'כותבים ומלחינים' : 'Writers & Composers'}</label>
                      <input
                        type="text"
                        value={editWriters}
                        onChange={(e) => setEditWriters(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-800 border border-neutral-700 text-white font-bold focus:outline-none focus:border-emerald-400"
                      />
                    </div>

                    <div>
                      <label className="block text-white/90 font-bold mb-1">{isHe ? 'ז׳אנר / סגנון מוזיקלי' : 'Genre'}</label>
                      <input
                        type="text"
                        value={editGenre}
                        onChange={(e) => setEditGenre(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-800 border border-neutral-700 text-white font-bold focus:outline-none focus:border-emerald-400"
                      />
                    </div>

                    <div>
                      <label className="block text-white/90 font-bold mb-1">{isHe ? 'שם האלבום / סינגל' : 'Album Name'}</label>
                      <input
                        type="text"
                        value={editAlbum}
                        onChange={(e) => setEditAlbum(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-800 border border-neutral-700 text-white font-bold focus:outline-none focus:border-emerald-400"
                      />
                    </div>

                    <div>
                      <label className="block text-white/90 font-bold mb-1">{isHe ? 'תיאור היצירה / הערות' : 'Description / Notes'}</label>
                      <textarea
                        rows={3}
                        value={editLyrics}
                        onChange={(e) => setEditLyrics(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-800 border border-neutral-700 text-white focus:outline-none focus:border-emerald-400"
                      />
                    </div>

                    {/* AI GENERATED TRACK TOGGLE IN EDIT MODAL */}
                    <div className="flex items-center gap-3 p-3.5 rounded-xl bg-purple-950/40 border border-purple-500/40">
                      <input
                        type="checkbox"
                        id="editIsAiGeneratedCheck"
                        checked={editIsAiGenerated}
                        onChange={(e) => setEditIsAiGenerated(e.target.checked)}
                        className="w-4 h-4 rounded text-purple-500 bg-neutral-800 border-purple-400 focus:ring-purple-400 cursor-pointer"
                      />
                      <label htmlFor="editIsAiGeneratedCheck" className="text-white font-bold text-xs cursor-pointer flex items-center gap-2 select-none">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        <span>{isHe ? 'שיר שנוצר בבינה מלאכותית (יסומן בתווית AI)' : 'AI Generated track (Mark with AI badge)'}</span>
                      </label>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => setEditingTrack(null)}
                        className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-bold cursor-pointer"
                      >
                        {isHe ? 'ביטול' : 'Cancel'}
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingEdit}
                        className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black cursor-pointer shadow-lg disabled:opacity-50"
                      >
                        {isSavingEdit ? (isHe ? 'שומר...' : 'Saving...') : (isHe ? 'שמור שינויים' : 'Save Changes')}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            </main>
          </div>
        )}

        {/* 2. FULL-SCREEN MONOCHROME BLACK & WHITE ADD SONG SCREEN */}
        {activeTab === 'manual_upload' && (
          <div className="w-full min-h-screen bg-black text-white px-4 sm:px-8 py-6 sm:py-10 flex flex-col items-center">
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
                            MP3, WAV, AAC, M4A, OGG, FLAC (עד 1GB)
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
                      { id: 'ללא סגנון מוזיקלי', label: isHe ? 'זיהוי אוטומטי' : 'Auto Detect' },
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

                {/* 4. SUBTITLES SWITCH (DEFAULT ON) + ON-DEVICE TRANSCRIPTION ENGINE */}
                <div className="p-5 sm:p-6 rounded-2xl bg-neutral-950 border border-white/15 space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-white shrink-0 mt-0.5">
                        <Captions className="w-4.5 h-4.5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs sm:text-sm font-black text-white block">
                          {includeSubtitles
                            ? (isHe ? 'כתוביות לשיר (דלוק כברירת מחדל)' : 'Song Subtitles (On by default)')
                            : (isHe ? 'כתוביות לשיר (לא יתווספו לשיר זה כתוביות)' : 'Subtitles Off (No subtitles will be added)')}
                        </span>
                        <span className="text-[11px] text-neutral-400 block mt-0.5">
                          {includeSubtitles
                            ? (isHe
                                ? 'תמלול מדויק על המכשיר בעברית ובאנגלית • כבה כדי לפרסם בלי כתוביות (לא יוסיף לשיר זה כתוביות)'
                                : 'Accurate on-device Hebrew & English transcription • Toggle off to skip subtitles')
                            : (isHe
                                ? 'מצב כבוי — לא ייווצרו ולא יישמרו כתוביות לשיר זה'
                                : 'Subtitles disabled — this track will publish without subtitles')}
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
                      title={includeSubtitles ? (isHe ? 'כבה כתוביות לשיר זה' : 'Turn subtitles off') : (isHe ? 'הפעל כתוביות לשיר זה' : 'Turn subtitles on')}
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
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="inline-flex items-center rounded-xl bg-black border border-white/20 p-0.5 text-[11px] font-bold">
                          {([
                            { id: 'auto', label: isHe ? 'זיהוי שפה אוטומטי' : 'Auto' },
                            { id: 'he', label: 'עברית' },
                            { id: 'en', label: 'English' },
                          ] as const).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setSubtitleLangChoice(opt.id)}
                              className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                                subtitleLangChoice === opt.id ? 'bg-white text-black font-black' : 'text-neutral-400 hover:text-white'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          disabled={isTranscribingUpload || (!rawAudioFile && !audioStreamUrl.trim())}
                          onClick={async () => {
                            setIsTranscribingUpload(true);
                            setWhisperProgressText(isHe ? 'מפעיל מנוע כתוביות מדויק במכשיר...' : 'Starting on-device subtitles engine...');
                            setWhisperUploadNotice(null);
                            const wRes = await transcribeTrackWithWhisperAI({
                              audioFile: rawAudioFile || undefined,
                              track: !rawAudioFile && audioStreamUrl.trim() ? {
                                id: 'draft',
                                name: songTitle || 'שיר',
                                artistName: currentArtist.name || 'אמן',
                                albumName: albumTitle || 'Single',
                                duration: 180,
                                audioUrl: audioStreamUrl.trim(),
                                coverUrl: coverArtUrl.trim(),
                              } : undefined,
                              language: isHe ? 'he' : 'en',
                              subtitleLanguageHint: subtitleLangChoice,
                              onProgress: (txt) => setWhisperProgressText(txt),
                            });
                            setIsTranscribingUpload(false);
                            setWhisperProgressText('');
                            if (wRes.success && ((wRes.segmentsHe && wRes.segmentsHe.length > 0) || (wRes.segmentsEn && wRes.segmentsEn.length > 0) || (wRes.segments && wRes.segments.length > 0))) {
                              setWhisperDraftSegments(wRes.segments || wRes.segmentsHe);
                              setWhisperDraftSegmentsHe(wRes.segmentsHe);
                              setWhisperDraftSegmentsEn(wRes.segmentsEn);
                              setWhisperDraftLyricsHe(wRes.lyricsHe || '');
                              setWhisperDraftLyricsEn(wRes.lyricsEn || '');
                              setLyricsInput(wRes.lyricsHe || wRes.lyrics || '');
                              setWhisperUploadNotice(
                                isHe
                                  ? `נוצרו ${wRes.segmentsHe?.length || 0} שורות בעברית ו-${wRes.segmentsEn?.length || 0} שורות באנגלית — ניתן לערוך או לפרסם ישירות`
                                  : `Generated ${wRes.segmentsHe?.length || 0} Hebrew and ${wRes.segmentsEn?.length || 0} English lines`
                              );
                            } else {
                              setWhisperUploadNotice(wRes.error || (isHe ? 'לא ניתן לתמלל קובץ זה כרגע' : 'Transcription failed'));
                            }
                          }}
                          className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-neutral-200 text-black text-[11px] font-black flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                        >
                          {isTranscribingUpload ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {isTranscribingUpload
                              ? (whisperProgressText || (isHe ? 'מתמלל במכשיר...' : 'Transcribing...'))
                              : (isHe ? 'צור כתוביות עכשיו' : 'Generate Subtitles Now')}
                          </span>
                        </button>
                      </div>

                      {whisperUploadNotice && (
                        <p className="text-[11px] text-white font-bold bg-black border border-white/25 px-3 py-2 rounded-xl">
                          {whisperUploadNotice}
                        </p>
                      )}

                      {(whisperDraftLyricsHe || whisperDraftLyricsEn) && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setUploadSubtitleLangTab('he');
                              if (whisperDraftLyricsHe) setLyricsInput(whisperDraftLyricsHe);
                            }}
                            className={`px-3 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all ${
                              uploadSubtitleLangTab === 'he'
                                ? 'bg-white text-black border-white font-black'
                                : 'bg-black text-neutral-300 border-white/20'
                            }`}
                          >
                            עברית ({whisperDraftSegmentsHe?.length || 0})
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setUploadSubtitleLangTab('en');
                              if (whisperDraftLyricsEn) setLyricsInput(whisperDraftLyricsEn);
                            }}
                            className={`px-3 py-1 rounded-lg text-[11px] font-bold cursor-pointer border transition-all ${
                              uploadSubtitleLangTab === 'en'
                                ? 'bg-white text-black border-white font-black'
                                : 'bg-black text-neutral-300 border-white/20'
                            }`}
                          >
                            English ({whisperDraftSegmentsEn?.length || 0})
                          </button>
                        </div>
                      )}

                      <textarea
                        rows={3}
                        value={uploadSubtitleLangTab === 'en' && whisperDraftLyricsEn ? whisperDraftLyricsEn : lyricsInput}
                        onChange={(e) => {
                          if (uploadSubtitleLangTab === 'en' && whisperDraftLyricsEn) {
                            setWhisperDraftLyricsEn(e.target.value);
                          } else {
                            setLyricsInput(e.target.value);
                          }
                        }}
                        placeholder={isHe
                          ? 'אופציונלי: ערוך/הדבק מילים כאן, או השאר ריק והמערכת תיצור כתוביות אוטומטית בפרסום'
                          : 'Optional: edit/paste lyrics here, or leave empty to auto-transcribe on publish'}
                        className="w-full px-4 py-3 rounded-xl bg-black border border-white/20 text-white placeholder-neutral-500 focus:outline-none focus:border-white text-xs leading-relaxed transition-colors"
                      />
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
                      <span>{r2Status.configured ? 'אחסון Cloudflare R2 מחובר ומוכן' : 'אחסון ענן פעיל'}</span>
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

                {/* Live Progress Bar */}
                {isPublishing && (
                  <div className="p-4 rounded-2xl bg-neutral-950 border border-white/30 text-white text-xs space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <RefreshCw className="w-4 h-4 text-white animate-spin shrink-0" />
                        <span className="font-bold text-white text-xs truncate">{publishProgressStep}</span>
                      </div>
                      <span className="font-bold text-white text-xs shrink-0">
                        {uploadProgressPercent}%
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-black overflow-hidden border border-white/20">
                      <div
                        className="h-full bg-white transition-all duration-150"
                        style={{ width: `${Math.max(4, uploadProgressPercent)}%` }}
                      />
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
                    {isPublishing ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-5 h-5 animate-spin text-black" />
                        <span>{publishProgressStep || (isHe ? 'מפרסם שיר...' : 'Publishing...')}</span>
                      </span>
                    ) : (
                      <>
                        <Upload className="w-5 h-5 text-black" />
                        <span>{isHe ? 'פרסם שיר' : 'Publish Song'}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 3. FULL-SCREEN ALBUMS MANAGEMENT TAB (BG-BLACK) */}
        {activeTab === 'albums' && (
          <div className="w-full flex-1 flex flex-col bg-black text-white min-h-screen pt-20 pb-24 px-4 sm:px-8">
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
                    <Disc className="w-5 h-5 text-emerald-400" />
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
                      <Disc className="w-4 h-4 text-emerald-400" />
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
                              ? 'bg-emerald-500/10 border-emerald-400 shadow-lg'
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
                              <h4 className="font-bold text-xs text-white truncate hover:text-emerald-400 transition-colors">
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
                              <Pencil className="w-3.5 h-3.5 text-emerald-400" />
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
                    <Disc className="w-4 h-4 text-emerald-400" />
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
                    className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white font-normal text-xs sm:text-sm focus:outline-none focus:border-emerald-400 transition-all placeholder-neutral-500"
                  />
                </div>

                <div>
                  <label className="block text-white font-bold mb-1.5 text-xs sm:text-sm">
                    {isHe ? 'תמונת עטיפה לאלבום (URL אופציונלי)' : 'Album Cover URL'}
                  </label>
                  <input
                    type="url"
                    value={newAlbumCover}
                    onChange={(e) => setNewAlbumCover(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white font-mono text-xs focus:outline-none focus:border-emerald-400 transition-all placeholder-neutral-500"
                  />
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
                    className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white font-normal text-xs sm:text-sm focus:outline-none focus:border-emerald-400 transition-all placeholder-neutral-500"
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
                      <Plus className="w-4 h-4 text-emerald-400" />
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
                    disabled={isSavingAlbum || !newAlbumTitle.trim()}
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
                  className="fixed inset-0 z-[160] bg-black text-white flex flex-col overflow-hidden"
                  dir={isHe ? 'rtl' : 'ltr'}
                >
                  {/* Selector Top Bar */}
                  <div className="h-16 px-4 sm:px-8 border-b border-white/10 flex items-center justify-between gap-4 shrink-0 bg-black">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setIsAlbumSongSelectorOpen(false)}
                        className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center cursor-pointer transition-all"
                      >
                        <X className="w-4 h-4 text-white" />
                      </button>
                      <h3 className="text-base sm:text-lg font-normal text-white">
                        {isHe ? 'בחירת שירים לאלבום' : 'Select Songs for Album'}
                      </h3>
                    </div>

                    {/* Keyboard / Search Input inside Selector */}
                    <div className="relative flex-1 max-w-xs sm:max-w-md">
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
                      className="px-4 py-2 rounded-full bg-white hover:bg-neutral-200 text-black text-xs sm:text-sm font-normal cursor-pointer transition-all"
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

        {/* 4. LUXURY PROFESSIONAL ACCOUNT SETTINGS VIEW */}
        {activeTab === 'account_settings' && (
          <div className="max-w-2xl mx-auto px-4 py-20 sm:py-24 w-full space-y-7 animate-fadeIn">
            {/* Header */}
            <div className="space-y-2 border-b border-white/10 pb-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.05] border border-white/10 text-[11px] font-bold text-neutral-300">
                <Settings className="w-3.5 h-3.5 text-emerald-400" />
                <span>{isHe ? 'KOLOT STUDIO • הגדרות אמן ומערכת' : 'KOLOT STUDIO • Artist & Account Settings'}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                {isHe ? 'הגדרות חשבון ופרופיל' : 'Account & Profile Settings'}
              </h2>
              <p className="text-xs sm:text-sm text-neutral-400 leading-relaxed">
                {isHe
                  ? 'ניהול זהות האמן, פרטי הבמה, סנכרון Google ושרתי אחסון שירים בענן.'
                  : 'Manage your artist identity, stage details, Google sync, and cloud music storage.'}
              </p>
            </div>

            {/* Google Account Authentication Status Card */}
            <div className="p-5 sm:p-6 rounded-3xl bg-neutral-950/90 border border-white/10 shadow-2xl backdrop-blur-xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 w-full sm:w-auto">
                <div className="relative">
                  {currentUser?.photoURL ? (
                    <img
                      src={upgradeGooglePhotoQuality(currentUser.photoURL) || currentUser.photoURL}
                      alt={currentUser.displayName || 'User'}
                      referrerPolicy="no-referrer"
                      loading="eager"
                      decoding="async"
                      className="w-12 h-12 rounded-2xl object-cover border border-white/20 shadow-md"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-2xl bg-neutral-900 border border-white/15 flex items-center justify-center text-white">
                      <User className="w-6 h-6 text-emerald-400" />
                    </div>
                  )}
                  {currentUser && (
                    <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-neutral-950" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-white truncate">
                      {currentUser?.displayName || (isHe ? 'אמן אורח' : 'Guest Artist')}
                    </span>
                    {currentUser && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold">
                        {isHe ? 'מאומת' : 'Verified'}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-neutral-400 block truncate">
                    {currentUser
                      ? (isHe ? 'מחובר באמצעות Google • פרופיל שמור בענן' : 'Signed in with Google • Cloud synced')
                      : (isHe ? 'התחבר כדי לשמור ולסנכרן את המוזיקה שלך' : 'Sign in to sync your music')}
                  </span>
                </div>
              </div>

              <div className="w-full sm:w-auto flex justify-end">
                {currentUser ? (
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
                  >
                    <LogOut className="w-4 h-4 text-rose-400" />
                    <span>{isHe ? 'התנתק מחשבון Google' : 'Sign Out'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isAuthLoading}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-white hover:bg-neutral-200 active:scale-95 text-black font-black text-xs shadow-xl transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <span>{isHe ? 'המשך עם Google' : 'Continue with Google'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Main Settings Form */}
            <form onSubmit={handleSaveArtistAccount} className="space-y-6">
              {/* Section 1: Artist Identity */}
              <div className="p-5 sm:p-6 rounded-3xl bg-neutral-950/90 border border-neutral-800 space-y-4 shadow-xl">
                <div className="flex items-center gap-2 border-b border-neutral-800/80 pb-3">
                  <Mic2 className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-xs font-black text-white uppercase tracking-wider">
                    {isHe ? 'פרטי אמן ובמה' : 'Artist Identity & Stage'}
                  </h3>
                </div>

                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row gap-5 items-center pb-4 border-b border-neutral-800/50">
                    <div className="relative group">
                      <div className="w-24 h-24 rounded-full border-2 border-dashed border-neutral-700 hover:border-emerald-400 overflow-hidden flex items-center justify-center bg-neutral-900 transition-all cursor-pointer">
                        {artistAvatarPreview || currentArtist.avatarUrl || currentUser?.photoURL ? (
                          <img
                            src={artistAvatarPreview || currentArtist.avatarUrl || upgradeGooglePhotoQuality(currentUser?.photoURL) || ''}
                            referrerPolicy="no-referrer"
                            loading="eager"
                            decoding="async"
                            className="w-full h-full object-cover"
                            alt="Preview"
                          />
                        ) : (
                          <User className="w-8 h-8 text-neutral-600 group-hover:text-emerald-400 transition-colors" />
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
                      <div className="absolute -bottom-1 -right-1 bg-emerald-500 p-1.5 rounded-full shadow-lg border-2 border-neutral-950 pointer-events-none">
                        <Pencil className="w-3 h-3 text-white" />
                      </div>
                    </div>
                    <div className="space-y-1.5 text-center sm:text-right flex-1">
                      <h4 className="text-white font-black text-sm">{isHe ? 'תמונת פרופיל' : 'Profile Photo'}</h4>
                      <p className="text-[10px] text-neutral-400">{isHe ? 'ברירת המחדל היא תמונת חשבון Google שלך. ניתן להעלות תמונה חדשה והיא תישמר ב-Cloudflare R2 ובכל השירים.' : 'Defaults to your Google account photo. Upload a new one to save to Cloudflare R2 and all tracks.'}</p>
                      <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                        <span className="text-[9px] text-emerald-400/80 font-bold uppercase tracking-widest">{isHe ? 'נשמר ב-Cloudflare R2 ובפרופיל האמן' : 'Saved to Cloudflare R2'}</span>
                        {(() => {
                          const freshUser = getCurrentAuthUser() || currentUser;
                          const googlePhoto = getGoogleAccountPhotoUrl(freshUser);
                          if (!googlePhoto) return null;
                          return (
                            <button
                              type="button"
                              onClick={handleRestoreGoogleAvatar}
                              disabled={isRestoringGoogleAvatar}
                              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold border border-white/15 cursor-pointer transition-all disabled:opacity-50"
                            >
                              {isRestoringGoogleAvatar
                                ? (isHe ? 'משחזר תמונת Google...' : 'Restoring Google Photo...')
                                : (isHe ? 'החזר לתמונת Google' : 'Use Google Photo')}
                            </button>
                          );
                        })()}
                      </div>
                      {authError && (
                        <p className="text-[11px] text-rose-300 font-bold pt-1">{authError}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-white font-extrabold text-xs mb-2">
                      {isHe ? 'שם האמן / שם הבמה (חובה) *' : 'Artist / Stage Name (Required) *'}
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={artistNameInput || currentArtist.name}
                        onChange={(e) => setArtistNameInput(e.target.value)}
                        placeholder={currentUser?.displayName || 'שם אמן'}
                        className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white font-bold text-xs focus:outline-none focus:border-emerald-400 transition-all placeholder-neutral-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-white font-extrabold text-xs mb-2">
                        {isHe ? 'סגנון מוזיקלי מוביל' : 'Primary Musical Style'}
                      </label>
                      <select
                        value={genreInput}
                        onChange={(e) => setGenreInput(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white text-xs font-bold focus:outline-none focus:border-emerald-400 transition-all cursor-pointer"
                      >
                        <option value="ללא סגנון מוזיקלי">{isHe ? 'ללא סגנון מוזיקלי' : 'No Style'}</option>
                        <option value="Pop">{isHe ? 'Pop (פופ)' : 'Pop'}</option>
                        <option value="Electronic">{isHe ? 'Electronic (אלקטרוני)' : 'Electronic'}</option>
                        <option value="Rock">{isHe ? 'Rock (רוק)' : 'Rock'}</option>
                        <option value="Mizrahi">{isHe ? 'Mizrahi (מזרחית)' : 'Mizrahi'}</option>
                        <option value="Chill">{isHe ? 'Chill / Lo-Fi (צ׳יל מרגיע)' : 'Chill'}</option>
                        <option value="Hip Hop">{isHe ? 'Hip Hop (היפ הופ / ראפ)' : 'Hip Hop'}</option>
                        <option value="Classical">{isHe ? 'Classical (קלאסי)' : 'Classical'}</option>
                        <option value="Jazz">{isHe ? 'Jazz (ג׳אז)' : 'Jazz'}</option>
                        <option value="Acoustic">{isHe ? 'Acoustic (אקוסטי)' : 'Acoustic'}</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-white font-extrabold text-xs mb-2 flex items-center gap-1.5">
                        <Key className="w-3.5 h-3.5 text-neutral-400" />
                        <span>{isHe ? 'מפתח גישה / כינוי Audius' : 'Audius Handle / Key'}</span>
                      </label>
                      <input
                        type="text"
                        value={connectionCodeInput}
                        onChange={(e) => setConnectionCodeInput(e.target.value)}
                        placeholder="key_abc123 or @handle"
                        className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white font-mono text-xs focus:outline-none focus:border-emerald-400 transition-all placeholder-neutral-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-white font-extrabold text-xs mb-2">
                      {isHe ? 'ביוגרפיה ותיאור אמן (Bio)' : 'Artist Bio'}
                    </label>
                    <textarea
                      rows={3}
                      value={artistBioInput}
                      onChange={(e) => setArtistBioInput(e.target.value)}
                      placeholder={isHe ? 'כתוב תיאור קצר אודות האמן, הסגנון והיצירות...' : 'Short bio about the artist...'}
                      className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white text-xs leading-relaxed focus:outline-none focus:border-emerald-400 transition-all placeholder-neutral-500"
                    />
                  </div>
                </div>
              </div>

              {/* Section: Kolot Cloud Storage */}
              <div className="p-5 sm:p-6 rounded-3xl bg-neutral-950/90 border border-emerald-500/30 space-y-4 shadow-2xl">
                <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
                  <div className="flex items-center gap-2.5">
                    <Globe className="w-5 h-5 text-emerald-400" />
                    <div>
                      <h3 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-2">
                        <span>{isHe ? 'אחסון ענן מאובטח • Kolot Cloud Storage' : 'Secure Cloud Storage • Kolot Cloud'}</span>
                      </h3>
                      <p className="text-[10px] text-emerald-400 font-mono">
                        {isHe ? 'סנכרון ענן אוטומטי (1,000 MB)' : 'Auto Cloud Sync (1,000 MB)'}
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 bg-emerald-500/15 border-emerald-500/30 text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>{isHe ? 'אחסון מחובר ופעיל ✓' : 'Cloud Connected ✓'}</span>
                  </span>
                </div>

                <p className="text-[11px] text-neutral-300 leading-relaxed">
                  {isHe
                    ? 'כל השירים, האלבומים, התמונות והמטא-דאטה נשמרים ישירות באחסון הענן המוגן של קולות ומופצים בעולם דרך CDN מהיר. השרתים מחוברים אוטומטית בצורה מאובטחת ומוצפנת.'
                    : 'All songs, albums, and artwork are committed directly to Kolot Cloud Storage and served worldwide via CDN. Connection is secure and active automatically.'}
                </p>
              </div>

              {/* Section 2: Cloud Storage Server */}
              <div className="p-5 sm:p-6 rounded-3xl bg-neutral-950/90 border border-neutral-800 space-y-3 shadow-xl">
                <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-black text-white uppercase tracking-wider">
                      {isHe ? 'שרת אחסון מוזיקה פרטי' : 'Custom Music Server'}
                    </h3>
                  </div>
                  <span className="text-[10px] text-neutral-400 font-mono">
                    {isHe ? 'אופציונלי' : 'Optional'}
                  </span>
                </div>

                <p className="text-[11px] text-neutral-400">
                  {isHe
                    ? 'ניתן להזין כתובת שרת אישי או שרת ענן חיצוני לקריאת שירים וסטרימינג ישיר.'
                    : 'Optionally specify a custom streaming server endpoint for direct audio streaming.'}
                </p>

                <input
                  type="url"
                  value={customServerUrlInput}
                  onChange={(e) => {
                    setCustomServerUrlInput(e.target.value);
                  }}
                  placeholder="https://your-custom-music-server.com/api/tracks"
                  className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white font-mono text-xs focus:outline-none focus:border-emerald-400 transition-all placeholder-neutral-500"
                />
              </div>

              {/* Section 3: Terms of Use & Distribution Rights */}
              <div className="p-5 sm:p-6 rounded-3xl bg-neutral-950/90 border border-amber-500/30 space-y-2 text-xs shadow-xl">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="termsSettingsCheckPortal"
                    required
                    checked={hasAcceptedTerms}
                    onChange={(e) => setHasAcceptedTerms(e.target.checked)}
                    className="mt-1 w-5 h-5 rounded border-amber-400 bg-neutral-900 text-amber-500 focus:ring-amber-500 cursor-pointer flex-shrink-0"
                  />
                  <label htmlFor="termsSettingsCheckPortal" className="font-medium text-xs leading-relaxed cursor-pointer select-none">
                    <span className="font-extrabold text-amber-300 block mb-1">
                      {isHe ? 'תנאי שימוש והרשאת הפצה (חובה לאשר) *' : 'Terms of Use & Distribution Rights (Required) *'}
                    </span>
                    <span className="text-neutral-300">
                      {isHe
                        ? 'אני מאשר/ת כי העלאת השיר מהווה הרשאה לבעלי הפלטפורמה להשמיע, להפיץ ולאחסן את המוזיקה בשרתי האחסון הציבוריים ובשרתי הענן בהתאם לתנאי הפלטפורמה.'
                        : 'I certify and grant permission to host, stream, and store tracks on cloud and public storage servers.'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Section 4: Cloudflare R2 Cloud Storage Settings */}
              <div className="p-5 sm:p-6 rounded-3xl bg-neutral-950/90 border border-neutral-800 space-y-3 shadow-xl">
                <div className="flex items-center justify-between border-b border-neutral-800/80 pb-3">
                  <div className="flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-black text-white uppercase tracking-wider">
                      {isHe ? 'אחסון ענן מוגן Cloudflare R2' : 'Cloudflare R2 Storage'}
                    </h3>
                  </div>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    <span>{isHe ? 'מחובר ופעיל' : 'Connected'}</span>
                  </span>
                </div>

                <p className="text-xs text-neutral-400 leading-relaxed">
                  {isHe
                    ? 'אחסון השירים והתמונות מנוהל בצורה מאובטחת 100% בשרת דרך Cloudflare R2. מפתחות האחסון מוגנים בשרת ואינם נחשפים בדפדפן או בכלים למפתחים.'
                    : 'Storage is handled 100% server-side via Cloudflare R2. Credentials are secured on the server.'}
                </p>
              </div>

              {/* Submit Save Button */}
              <button
                type="submit"
                disabled={isPairing || !hasAcceptedTerms}
                className="w-full py-4 rounded-2xl bg-white hover:bg-neutral-200 active:scale-95 text-black font-black text-sm transition-all shadow-2xl cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40"
              >
                {isPairing ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-black" />
                    <span>{isHe ? 'שומר הגדרות...' : 'Saving settings...'}</span>
                  </span>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 text-black" />
                    <span>{isHe ? 'שמור שינויים והגדרות' : 'Save Settings'}</span>
                  </>
                )}
              </button>
            </form>
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

      </motion.div>
    </AnimatePresence>
  );
};
