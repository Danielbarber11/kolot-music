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
  Github,
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { JamendoTrack, Language, ArtistProfile, Album } from '../types';
import {
  saveArtistAccountToFirebase,
  saveArtistTrackToFirebase,
  deleteArtistTrackFromFirebase,
  loginWithGoogle,
  logoutUser,
  onAuthUserChanged,
  getArtistAccountByGoogleUid,
} from '../services/firebaseService';
import { uploadTrackToGitHubRepo, deleteTrackFromGitHubRepo, uploadArtistProfileToGitHub } from '../services/githubStorageService';
import { User as FirebaseUser } from 'firebase/auth';
import { TrackCoverArt } from './TrackCoverArt';
import { getTrackInstantColor, useExtractedColor, globalTrackColorCache } from '../services/colorService';
import { persistTrackToStorage, removeTrackFromStorage } from '../services/localTrackStorage';
import { markSongAsDeleted } from '../services/deletedTracksService';
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
}

export const ArtistPortalModal: React.FC<ArtistPortalModalProps> = ({
  isOpen,
  onClose,
  lang,
  onTrackPublished,
  allTracks,
  initialTab = 'profile',
  onPlayTrack,
  onRemoveTrack,
}) => {
  if (!isOpen) return null;
  const isHe = lang === 'he';

  const [activeTab, setActiveTab] = useState<'profile' | 'manual_upload' | 'account_settings' | 'albums'>(initialTab);

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [currentArtist, setCurrentArtist] = useState<ArtistProfile>(() => {
    try {
      const saved = localStorage.getItem('wikiarchive_artist_account');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      id: 'artist_' + Date.now(),
      name: '',
      genre: 'Pop',
      isConnected: false,
      isPrivate: true,
      tracksCount: 0,
      joinedDate: new Date().getFullYear().toString(),
      providerPlatform: 'חשבון אמן',
    };
  });

  const resolvedArtistName = currentArtist.name || currentUser?.displayName || (isHe ? 'אמן' : 'Artist');

  const [connectionCodeInput, setConnectionCodeInput] = useState('');
  const [artistNameInput, setArtistNameInput] = useState('');
  const [genreInput, setGenreInput] = useState('ללא סגנון מוזיקלי');
  const [artistBioInput, setArtistBioInput] = useState('');
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
  const [audioUploadType, setAudioUploadType] = useState<'file' | 'url'>('file');
  const [coverUploadType, setCoverUploadType] = useState<'file' | 'url'>('file');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSuccess, setPublishSuccess] = useState(false);

  // File upload refs & drag-and-drop states
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [rawAudioFile, setRawAudioFile] = useState<File | null>(null);
  const [rawCoverFile, setRawCoverFile] = useState<File | null>(null);
  const [isAudioDragging, setIsAudioDragging] = useState(false);
  const [isCoverDragging, setIsCoverDragging] = useState(false);
  const [artistAvatarFile, setArtistAvatarFile] = useState<File | null>(null);
  const [artistAvatarPreview, setArtistAvatarPreview] = useState<string | null>(null);
  const [customGenreText, setCustomGenreText] = useState('');
  const [fileUploadError, setFileUploadError] = useState<string | null>(null);

  // 30MB file size limit for audio and image uploads
  const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30MB

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
    if (track.uploadedByUid && track.uploadedByUid === currentUser.uid) return true;
    if (currentArtist && track.artistName && currentArtist.name?.toLowerCase().trim() === track.artistName?.toLowerCase().trim()) return true;
    if (currentUser) return true;
    return false;
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

    // Update cloud tracks cache immediately
    try {
      const cached = localStorage.getItem('kolot_cloud_tracks_cache');
      let cloudList: JamendoTrack[] = cached ? JSON.parse(cached) : [];
      const cIdx = cloudList.findIndex((t) => t.id === updatedTrack.id);
      if (cIdx >= 0) {
        cloudList[cIdx] = updatedTrack;
      } else {
        cloudList.unshift(updatedTrack);
      }
      localStorage.setItem('kolot_cloud_tracks_cache', JSON.stringify(cloudList));
    } catch {}

    // Update uploaded tracks cache immediately
    try {
      const savedLocal = localStorage.getItem('kolot_uploaded_tracks');
      let localList: JamendoTrack[] = savedLocal ? JSON.parse(savedLocal) : [];
      const lIdx = localList.findIndex((t) => t.id === updatedTrack.id);
      if (lIdx >= 0) {
        localList[lIdx] = updatedTrack;
      } else {
        localList.unshift(updatedTrack);
      }
      localStorage.setItem('kolot_uploaded_tracks', JSON.stringify(localList));
    } catch {}

    await persistTrackToStorage(updatedTrack);
    try {
      await saveArtistTrackToFirebase(updatedTrack);
    } catch (err) {
      console.warn('Firestore edit update notice:', err);
    }

    try {
      await uploadTrackToGitHubRepo(updatedTrack);
    } catch (err) {
      console.warn('GitHub edit sync notice:', err);
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
      deleteArtistTrackFromFirebase(trackId),
      deleteTrackFromGitHubRepo(trackId),
    ]);
  };

  // Album creation states
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumCover, setNewAlbumCover] = useState('');
  const [newAlbumDescription, setNewAlbumDescription] = useState('');
  const [selectedTrackIdsForAlbum, setSelectedTrackIdsForAlbum] = useState<string[]>([]);
  const [myAlbums, setMyAlbums] = useState<Album[]>(() => {
    let stored: Album[] = [];
    try {
      const saved = localStorage.getItem('kolot_user_albums');
      if (saved) {
        stored = JSON.parse(saved);
      }
    } catch {}

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
  const [customServerUrlInput, setCustomServerUrlInput] = useState(() => {
    return localStorage.getItem('wikiarchive_custom_server_url') || '';
  });

  useEffect(() => {
    const unsubscribe = onAuthUserChanged(async (user) => {
      setCurrentUser(user);
      setIsAuthLoading(false);

      if (user) {
        if (!artistNameInput && user.displayName) {
          setArtistNameInput(user.displayName);
        }

        try {
          const remoteArtist = await getArtistAccountByGoogleUid(user.uid);
          if (remoteArtist) {
            setCurrentArtist(remoteArtist);
            localStorage.setItem('wikiarchive_artist_account', JSON.stringify(remoteArtist));
          } else {
            const autoPrivateArtist: ArtistProfile = {
              id: user.uid,
              name: user.displayName || (isHe ? 'משתמש גוגל' : 'Google User'),
              bio: isHe ? 'ממתין להעלאת שירים...' : 'Awaiting track upload...',
              avatarUrl: user.photoURL || undefined,
              joinedDate: new Date().getFullYear().toString(),
              googleUid: user.uid,
              googleEmail: user.email || undefined,
              isConnected: true,
              hasAcceptedTerms: true,
              acceptedTermsAt: new Date().toISOString(),
              isPrivate: true,
              tracksCount: 0,
              providerPlatform: 'חשבון גוגל (מצב פרטי)',
            };
            setCurrentArtist(autoPrivateArtist);
            await saveArtistAccountToFirebase(autoPrivateArtist);
          }
        } catch (e) {
          console.warn('Could not fetch artist profile for user:', e);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (currentArtist) {
      localStorage.setItem('wikiarchive_artist_account', JSON.stringify(currentArtist));
    } else {
      localStorage.removeItem('wikiarchive_artist_account');
    }
  }, [currentArtist]);

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setIsAuthLoading(true);
    try {
      const user = await loginWithGoogle();
      if (user) {
        if (!artistNameInput && user.displayName) {
          setArtistNameInput(user.displayName);
        }

        const existing = await getArtistAccountByGoogleUid(user.uid);
        if (existing) {
          setCurrentArtist(existing);
        } else {
          const autoPrivateArtist: ArtistProfile = {
            id: user.uid,
            name: user.displayName || (isHe ? 'משתמש גוגל' : 'Google User'),
            bio: isHe ? 'ממתין להעלאת שירים...' : 'Awaiting track upload...',
            avatarUrl: user.photoURL || undefined,
            joinedDate: new Date().getFullYear().toString(),
            googleUid: user.uid,
            googleEmail: user.email || undefined,
            isConnected: true,
            hasAcceptedTerms: true,
            acceptedTermsAt: new Date().toISOString(),
            isPrivate: true,
            tracksCount: 0,
            providerPlatform: 'חשבון גוגל (מצב פרטי)',
          };
          setCurrentArtist(autoPrivateArtist);
          await saveArtistAccountToFirebase(autoPrivateArtist);
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
    localStorage.removeItem('wikiarchive_artist_account');
    localStorage.removeItem('wikiarchive_cached_auth_user');
    localStorage.removeItem('kolot_terms_accepted');
  };

  const processAudioFile = (file: File) => {
    if (!file) return;
    setFileUploadError(null);
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileUploadError(isHe ? 'קובץ השמע חורג מ-30MB. יש לבחור קובץ עד 30MB.' : 'Audio file exceeds 30MB limit.');
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
      setFileUploadError(isHe ? 'קובץ התמונה חורג מ-30MB. יש לבחור תמונה עד 30MB.' : 'Cover image exceeds 30MB limit.');
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

  const handleDeleteAlbum = (albumId: string) => {
    const updated = myAlbums.filter((a) => a.id !== albumId);
    setMyAlbums(updated);
    localStorage.setItem('kolot_user_albums', JSON.stringify(updated));
    if (editingAlbum?.id === albumId) {
      handleCancelEditAlbum();
    }
  };

  const handleCreateAlbum = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAlbumTitle.trim()) return;

    if (editingAlbum) {
      const updated: Album = {
        ...editingAlbum,
        title: newAlbumTitle.trim(),
        coverUrl: newAlbumCover.trim() || undefined,
        description: newAlbumDescription.trim() || undefined,
        trackIds: selectedTrackIdsForAlbum,
      };
      const updatedAlbums = myAlbums.map((a) => (a.id === editingAlbum.id ? updated : a));
      setMyAlbums(updatedAlbums);
      localStorage.setItem('kolot_user_albums', JSON.stringify(updatedAlbums));
      setEditingAlbum(null);
    } else {
      const album: Album = {
        id: `album_${Date.now()}`,
        title: newAlbumTitle.trim(),
        artistName: currentArtist.name,
        coverUrl: newAlbumCover.trim() || coverArtUrl || undefined,
        description: newAlbumDescription.trim() || undefined,
        trackIds: selectedTrackIdsForAlbum,
        createdDate: new Date().toISOString().split('T')[0],
      };
      const updatedAlbums = [album, ...myAlbums];
      setMyAlbums(updatedAlbums);
      localStorage.setItem('kolot_user_albums', JSON.stringify(updatedAlbums));
    }

    setNewAlbumTitle('');
    setNewAlbumCover('');
    setNewAlbumDescription('');
    setSelectedTrackIdsForAlbum([]);
    setPublishSuccess(true);
    setTimeout(() => setPublishSuccess(false), 2000);
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

      const updatedArtist: ArtistProfile = {
        ...currentArtist,
        id: currentUser ? currentUser.uid : currentArtist.id,
        name: finalName,
        bio: artistBioInput.trim() || currentArtist.bio || (isHe ? 'אמן עצמאי בפלטפורמה' : 'Independent artist'),
        avatarUrl: currentUser?.photoURL || currentArtist.avatarUrl,
        genre: genreInput || currentArtist.genre,
        audiusHandle: cleanHandle || currentArtist.audiusHandle,
        archiveAccountUrl: accountUrl || currentArtist.archiveAccountUrl,
        googleUid: currentUser?.uid || currentArtist.googleUid,
        googleEmail: currentUser?.email || currentArtist.googleEmail,
        isConnected: true,
        hasAcceptedTerms: true,
        acceptedTermsAt: new Date().toISOString(),
        customServerUrl: customServerUrlInput.trim() || undefined,
      };

      setCurrentArtist(updatedArtist);
      await saveArtistAccountToFirebase(updatedArtist);
      
      // Save to GitHub as well
      await uploadArtistProfileToGitHub(updatedArtist, artistAvatarFile || undefined);
      
      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 2500);
      setActiveTab('profile');
    } catch (err: any) {
      console.error(err);
      setAuthError(isHe ? 'שמירת ההגדרות נכשלה. נסה שוב.' : 'Failed to save settings.');
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

  // Publish Track -> Push to Public GitHub Repo (Kolot Music1) & Save Firestore User Account
  const handlePublishTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentArtist || !songTitle.trim() || !audioStreamUrl.trim() || !coverArtUrl.trim() || !hasCertifiedRights) return;

    setIsPublishing(true);

    const effectiveGenre = genreInput === 'אחר' ? (customGenreText.trim() || (isHe ? 'שונות' : 'Other')) : genreInput;

    const tempTrackForColor: JamendoTrack = {
      id: 'temp',
      name: songTitle,
      artistName: currentArtist.name,
      albumName: albumTitle || 'Single',
      duration: 180,
      audioUrl: audioStreamUrl,
      coverUrl: coverArtUrl,
      genre: effectiveGenre,
    };
    const computedColor = getTrackInstantColor(tempTrackForColor);
    const cachedBgColor = `radial-gradient(circle at 50% 35%, rgba(${computedColor.r}, ${computedColor.g}, ${computedColor.b}, 0.65) 0%, rgba(${Math.round(computedColor.r * 0.18)}, ${Math.round(computedColor.g * 0.18)}, ${Math.round(computedColor.b * 0.18)}, 0.96) 55%, #030712 100%)`;

    const updatedArtist: ArtistProfile = {
      ...currentArtist,
      isPrivate: false,
      tracksCount: (currentArtist.tracksCount || 0) + 1,
    };
    setCurrentArtist(updatedArtist);
    saveArtistAccountToFirebase(updatedArtist).catch(() => {});

    const finalArtistName = performingArtistInput.trim() || currentArtist.name;

    const newTrack: JamendoTrack = {
      id: `artist_track_${Date.now()}`,
      name: songTitle.trim(),
      artistName: finalArtistName,
      featuredArtist: featuredArtistInput.trim() || undefined,
      writers: writersInput.trim() || undefined,
      albumName: albumTitle.trim() || (isHe ? 'סינגל עצמאי' : 'Independent Single'),
      duration: 180,
      audioUrl: audioStreamUrl.trim(),
      coverUrl: coverArtUrl.trim(),
      genre: effectiveGenre,
      license: 'אחסון ענן ציבורי (1GB)',
      licenseUrl: currentArtist.archiveAccountUrl || 'https://audius.co',
      source: 'Kolot Music Public Cloud Storage',
      lyrics: lyricsInput.trim() || (isHe ? 'מילות השיר נוצרות ומסונכרנות אוטומטית על גבי המכשיר' : 'Lyrics auto-generated on device'),
      artistBio: currentArtist.bio,
      artistAvatarUrl: currentArtist.avatarUrl || currentUser?.photoURL || undefined,
      publisherAccountUrl: currentArtist.archiveAccountUrl || 'https://audius.co',
      uploadedByUid: currentUser?.uid,
      isPrivate: false,
      customServerUrl: customServerUrlInput.trim() || undefined,
      bgColor: cachedBgColor,
      isAiGenerated: isAiGeneratedInput,
    };

    // Pre-cache color for 0ms color calculation in player
    globalTrackColorCache.set(newTrack.id, computedColor);
    if (newTrack.coverUrl) {
      globalTrackColorCache.set(newTrack.coverUrl, computedColor);
    }

    // Capture file references BEFORE resetting form state
    const currentAudioFile = rawAudioFile;
    const currentCoverFile = rawCoverFile;

    // 1. Save track to local storage & broadcast to UI immediately (0-lag UX)
    await persistTrackToStorage(newTrack, currentAudioFile || undefined);
    
    // Add to pending uploads for reliability
    try {
      const pending = JSON.parse(localStorage.getItem('kolot_pending_uploads') || '[]');
      localStorage.setItem('kolot_pending_uploads', JSON.stringify([...pending, newTrack.id]));
    } catch {}

    onTrackPublished(newTrack);

    setIsPublishing(false);
    setPublishSuccess(true);
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
    setLyricsInput('');
    setCustomGenreText('');
    setHasCertifiedRights(false);

    setTimeout(() => {
      setPublishSuccess(false);
      setActiveTab('profile');
    }, 1000);

    // 2. Background sync to GitHub repositories & Firebase Firestore
    Promise.allSettled([
      uploadTrackToGitHubRepo(newTrack, currentAudioFile || undefined, currentCoverFile || undefined).then((ghRes) => {
        if (ghRes.success) {
          // Remove from pending
          try {
            const pending = JSON.parse(localStorage.getItem('kolot_pending_uploads') || '[]');
            localStorage.setItem('kolot_pending_uploads', JSON.stringify(pending.filter((id: string) => id !== newTrack.id)));
          } catch {}

          let updated = false;
          if (ghRes.audioUrl) {
            newTrack.audioUrl = ghRes.audioUrl;
            updated = true;
          }
          if (ghRes.coverUrl) {
            newTrack.coverUrl = ghRes.coverUrl;
            updated = true;
          }
          if (updated) {
            onTrackPublished(newTrack);
            persistTrackToStorage(newTrack);
            saveArtistTrackToFirebase(newTrack).catch(() => {});
          }
        }
      }),
      saveArtistTrackToFirebase(newTrack),
    ]).catch((err) => {
      console.warn('Background cloud sync notice:', err);
    });


  };

  const myUploadedTracks = allTracks.filter((t) => {
    if (deletedTrackIds.includes(t.id)) return false;
    if (currentUser?.uid && t.uploadedByUid === currentUser.uid) return true;
    if (currentArtist?.name && t.artistName?.toLowerCase().trim() === currentArtist.name.toLowerCase().trim()) return true;
    if (currentUser?.displayName && t.artistName?.toLowerCase().trim() === currentUser.displayName.toLowerCase().trim()) return true;
    return false;
  });

  const sampleTrack = myUploadedTracks[0] || allTracks[0];
  const activeAvatar = currentArtist.avatarUrl || currentUser?.photoURL || undefined;
  const extractedArtistColor = useExtractedColor(activeAvatar, currentArtist.genre || 'Pop');
  const themeColor = extractedArtistColor || (sampleTrack ? getTrackInstantColor(sampleTrack) : { r: 99, g: 102, b: 241 });

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

          <div className="w-full max-w-md bg-[#0d1322] border border-amber-500/30 rounded-3xl p-8 shadow-2xl text-center space-y-6 animate-fadeIn">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-amber-500/20 via-indigo-500/20 to-purple-500/20 border border-amber-500/40 text-amber-300 flex items-center justify-center mx-auto shadow-2xl ring-4 ring-amber-500/10">
              <User className="w-10 h-10 text-amber-400" />
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

        {/* 1. PUBLIC ARTIST PROFILE SCREEN - COMPACT HEADER, NO DEAD GAP */}
        {activeTab === 'profile' && (
          <div className="w-full flex-1 flex flex-col">
            <div className="relative w-full overflow-hidden border-b border-white/10">
              <div
                className="relative w-full h-32 sm:h-40 overflow-hidden"
                style={{
                  background: `radial-gradient(ellipse at 50% 0%, rgba(${themeColor.r}, ${themeColor.g}, ${themeColor.b}, 0.55) 0%, rgba(7, 11, 20, 0.95) 85%)`,
                }}
              >
                <div
                  className="absolute -top-12 left-1/4 w-72 h-72 rounded-full blur-[90px] opacity-60 pointer-events-none"
                  style={{ background: `rgb(${themeColor.r}, ${themeColor.g}, ${themeColor.b})` }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#070b14]/60 to-[#070b14]" />
              </div>

              <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 -mt-12 sm:-mt-14 pb-5 flex flex-col sm:flex-row items-center sm:items-end gap-4">
                <div className="relative flex-shrink-0">
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-[#070b14] bg-slate-900 shadow-2xl overflow-hidden ring-2 ring-white/20 flex items-center justify-center">
                    {currentArtist.avatarUrl || currentUser?.photoURL ? (
                      <img
                        src={currentArtist.avatarUrl || currentUser?.photoURL || ''}
                        alt={currentArtist.name}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      <div
                        className="w-full h-full rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-inner select-none"
                        style={{
                          background: `linear-gradient(135deg, rgba(${themeColor.r}, ${themeColor.g}, ${themeColor.b}, 0.9), #0f172a)`,
                        }}
                      >
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
                              <img src={album.coverUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-neutral-800 to-black p-2">
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
                      <label className="block text-white/90 font-bold mb-1">{isHe ? 'מילות השיר / תיאור היצירה' : 'Lyrics'}</label>
                      <textarea
                        rows={4}
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

        {/* 2. FULL-SCREEN PURE BLACK ADD SONG SCREEN */}
        {activeTab === 'manual_upload' && (
          <div className="w-full min-h-screen bg-black text-white px-4 sm:px-8 py-6 sm:py-10 flex flex-col items-center">
            <div className="w-full max-w-2xl space-y-6 animate-fadeIn">
              {/* TOP HEADER: CIRCULAR BACK BUTTON & TITLE */}
              <div className="flex items-center justify-between pb-4 border-b border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveTab('profile')}
                  className="w-12 h-12 rounded-full border border-white/20 bg-neutral-900/90 hover:bg-neutral-800 text-white flex items-center justify-center cursor-pointer shadow-xl transition-all active:scale-95"
                  title={isHe ? 'חזור לפרופיל' : 'Back to Profile'}
                >
                  {isHe ? <ArrowRight className="w-5 h-5 text-white" /> : <ArrowLeft className="w-5 h-5 text-white" />}
                </button>

                <div className="text-center flex-1 pr-3 pl-3">
                  <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                    {isHe ? 'הוספת שיר חדש' : 'Add New Song'}
                  </h1>
                  <p className="text-xs text-neutral-400 font-medium mt-0.5">
                    {isHe ? 'העלה קובץ שיר, תמונת עטיפה ופרטים לעמוד שלך' : 'Upload track file, artwork and details to your profile'}
                  </p>
                </div>

                <div className="w-12 h-12 invisible" />
              </div>

              {publishSuccess && (
                <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fadeIn">
                  <Check className="w-5 h-5 flex-shrink-0" />
                  <span>{isHe ? 'השיר והתמונה פורסמו בהצלחה ונשמרו בפרופיל!' : 'Song published successfully!'}</span>
                </div>
              )}

              <form onSubmit={handlePublishTrack} className="space-y-6">
                {/* 1. TOP ROW: SQUARE IMAGE BUTTON & KEYBOARD SONG TITLE */}
                <div className="p-4 sm:p-5 rounded-2xl bg-neutral-950 border border-neutral-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-5">
                  {/* Square cover button: תעלה תמונה */}
                  <div className="flex-shrink-0 flex flex-col items-center sm:items-start">
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*,.jpg,.jpeg,.png,.webp"
                      onChange={handleCoverFileSelect}
                      className="hidden"
                    />

                    {coverArtUrl ? (
                      <div className="relative group w-32 h-32 sm:w-36 sm:h-36 rounded-2xl overflow-hidden border border-white/20 shadow-xl bg-neutral-900 flex-shrink-0">
                        <img
                          src={coverArtUrl}
                          alt="Cover preview"
                          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                          <button
                            type="button"
                            onClick={() => coverInputRef.current?.click()}
                            className="px-2.5 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-[11px] font-bold flex items-center gap-1 backdrop-blur-sm cursor-pointer transition-all"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{isHe ? 'החלף' : 'Change'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleResetCover}
                            className="p-1 rounded-lg bg-rose-500/30 hover:bg-rose-500/50 text-rose-200 cursor-pointer transition-all"
                            title={isHe ? 'הסר תמונה' : 'Remove'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
                            ? 'border-emerald-400 bg-emerald-500/15 scale-105'
                            : 'border-neutral-700 hover:border-emerald-400/80 bg-neutral-900/80 hover:bg-neutral-900'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-2 text-neutral-300 group-hover:text-emerald-400 transition-colors">
                          <FileImage className="w-5 h-5 text-emerald-400" />
                        </div>
                        <span className="text-xs font-black text-white leading-tight">
                          {isHe ? 'תעלה תמונה' : 'Upload Image'}
                        </span>
                        <span className="text-[10px] text-neutral-400 mt-1 font-mono">
                          {isHe ? 'ריבוע 1:1' : 'Square 1:1'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Keyboard Song Title Input */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <label className="text-xs font-extrabold text-white flex items-center gap-2">
                      <Keyboard className="w-4 h-4 text-emerald-400" />
                      <span>{isHe ? 'שם השיר (חובה) *' : 'Song Title (Required) *'}</span>
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={songTitle}
                        onChange={(e) => setSongTitle(e.target.value)}
                        placeholder={isHe ? 'הקלד את שם השיר...' : 'Type song title...'}
                        className="w-full px-4 py-3.5 rounded-xl bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400 font-bold text-sm transition-all"
                      />
                    </div>
                    <p className="text-[11px] text-neutral-400">
                      {isHe ? 'השם שיוצג בראש הנגן, ברשימות ההשמעה ובדף השיר' : 'Displayed in player and playlists'}
                    </p>
                  </div>
                </div>

                {/* 2. ARTIST, FEATURED ARTIST, WRITERS & COMPOSERS */}
                <div className="p-4 sm:p-5 rounded-2xl bg-neutral-950 border border-neutral-800 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* שם הזמר / אמן מבצע */}
                    <div>
                      <label className="text-xs font-extrabold text-white flex items-center gap-2 mb-1.5">
                        <User className="w-4 h-4 text-emerald-400" />
                        <span>{isHe ? 'שם הזמר / אמן מבצע' : 'Performing Artist'}</span>
                      </label>
                      <input
                        type="text"
                        value={performingArtistInput}
                        onChange={(e) => setPerformingArtistInput(e.target.value)}
                        placeholder={currentArtist.name || (isHe ? 'שם הזמר המבצע...' : 'Performing artist name...')}
                        className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400 font-bold text-xs"
                      />
                    </div>

                    {/* זמר אורח */}
                    <div>
                      <label className="text-xs font-extrabold text-white flex items-center gap-2 mb-1.5">
                        <Mic2 className="w-4 h-4 text-emerald-400" />
                        <span>{isHe ? 'זמר אורח (Feat.)' : 'Featured Artist'}</span>
                      </label>
                      <input
                        type="text"
                        value={featuredArtistInput}
                        onChange={(e) => setFeaturedArtistInput(e.target.value)}
                        placeholder={isHe ? 'שם הזמר האורח (אופציונלי)...' : 'Featured artist (optional)...'}
                        className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400 font-bold text-xs"
                      />
                    </div>
                  </div>

                  {/* כותבים ומלחינים */}
                  <div>
                    <label className="text-xs font-extrabold text-white flex items-center gap-2 mb-1.5">
                      <Edit3 className="w-4 h-4 text-emerald-400" />
                      <span>{isHe ? 'כותבים ומלחינים' : 'Writers & Composers'}</span>
                    </label>
                    <input
                      type="text"
                      value={writersInput}
                      onChange={(e) => setWritersInput(e.target.value)}
                      placeholder={isHe ? 'מילים: ... | לחן: ... | עיבוד: ...' : 'Writers, composers & arrangers...'}
                      className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400 font-bold text-xs"
                    />
                  </div>
                </div>

                {/* 2. AUDIO FILE UPLOAD */}
                <div className="p-4 sm:p-5 rounded-2xl bg-neutral-950 border border-neutral-800 space-y-3">
                  {fileUploadError && (
                    <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-normal text-center">
                      {fileUploadError}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <label className="text-xs font-normal text-white flex items-center gap-2">
                      <FileAudio className="w-4 h-4 text-emerald-400" />
                      <span>{isHe ? 'קובץ שמע / שיר (עד 30MB, חובה) *' : 'Audio File (up to 30MB, Required) *'}</span>
                    </label>

                    <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-lg text-[10px]">
                      <button
                        type="button"
                        onClick={() => setAudioUploadType('file')}
                        className={`px-2.5 py-1 rounded-md font-normal transition-all cursor-pointer ${
                          audioUploadType === 'file' ? 'bg-emerald-500 text-black font-bold' : 'text-neutral-400'
                        }`}
                      >
                        {isHe ? 'קובץ' : 'File'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAudioUploadType('url')}
                        className={`px-2.5 py-1 rounded-md font-normal transition-all cursor-pointer ${
                          audioUploadType === 'url' ? 'bg-emerald-500 text-black font-bold' : 'text-neutral-400'
                        }`}
                      >
                        {isHe ? 'קישור' : 'URL'}
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
                        <div className="p-4 rounded-xl bg-neutral-900 border border-emerald-500/40 space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
                                <FileAudio className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <span className="block text-xs font-bold text-white truncate">
                                  {audioFileName || (isHe ? 'קובץ שמע נבחר' : 'Audio file selected')}
                                </span>
                                <span className="block text-[10px] text-emerald-400 font-mono">
                                  {isHe ? '✓ הקובץ נטען ומוכן להשמעה ושמירה' : 'Ready'}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => audioInputRef.current?.click()}
                                className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-[11px] font-bold border border-neutral-700 cursor-pointer transition-all flex items-center gap-1"
                              >
                                <RefreshCw className="w-3 h-3 text-emerald-400" />
                                <span>{isHe ? 'החלף קובץ' : 'Replace'}</span>
                              </button>
                              <button
                                type="button"
                                onClick={handleResetAudio}
                                className="p-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 cursor-pointer transition-all"
                                title={isHe ? 'הסר קובץ' : 'Remove'}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-neutral-800">
                            <audio controls src={audioStreamUrl} className="w-full h-8 rounded opacity-90" />
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
                              ? 'border-emerald-400 bg-emerald-500/10 scale-[1.01]'
                              : 'border-neutral-800 hover:border-emerald-500/50 bg-neutral-900/60 hover:bg-neutral-900'
                          }`}
                        >
                          <FolderUp className="w-8 h-8 text-emerald-400 mb-2 transition-transform group-hover:scale-110" />
                          <span className="text-xs font-normal text-white">
                            {isHe ? 'גרור לכאן קובץ שיר או לחץ לבחירה מהמכשיר' : 'Drag & drop audio file or click to browse'}
                          </span>
                          <span className="text-[10px] text-neutral-400 mt-1 font-mono">
                            MP3, WAV, AAC, M4A, OGG, FLAC (עד 30MB)
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
                      className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400 text-xs font-mono"
                    />
                  )}
                </div>

                {/* 3. MUSICAL STYLE SELECTOR */}
                <div className="p-4 sm:p-5 rounded-2xl bg-neutral-950 border border-neutral-800 space-y-3">
                  <label className="block text-white font-extrabold text-xs">
                    {isHe ? 'סגנון מוזיקלי *' : 'Musical Style *'}
                  </label>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: 'ללא סגנון מוזיקלי', label: isHe ? 'ללא סגנון מוזיקלי' : 'No Style' },
                      { id: 'Pop', label: isHe ? 'פופ' : 'Pop' },
                      { id: 'Rock', label: isHe ? 'רוק' : 'Rock' },
                      { id: 'Mizrahi', label: isHe ? 'מזרחית' : 'Mizrahi' },
                      { id: 'Electronic', label: isHe ? 'אלקטרוני' : 'Electronic' },
                      { id: 'Hip Hop', label: isHe ? 'היפ הופ / ראפ' : 'Hip Hop' },
                      { id: 'Acoustic', label: isHe ? 'אקוסטי' : 'Acoustic' },
                      { id: 'Chill', label: isHe ? 'צ׳יל' : 'Chill' },
                      { id: 'Classical', label: isHe ? 'קלאסי' : 'Classical' },
                      { id: 'אחר', label: isHe ? 'אחר...' : 'Other...' },
                    ].map((g) => {
                      const isSelected = genreInput === g.id;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setGenreInput(g.id)}
                          className={`py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer border ${
                            isSelected
                              ? 'bg-emerald-500 text-black border-emerald-400 shadow-lg scale-[1.02]'
                              : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-neutral-700 hover:text-white'
                          }`}
                        >
                          {g.label}
                        </button>
                      );
                    })}
                  </div>

                  {genreInput === 'אחר' && (
                    <div className="pt-2">
                      <input
                        type="text"
                        value={customGenreText}
                        onChange={(e) => setCustomGenreText(e.target.value)}
                        placeholder={isHe ? 'פרט את סגנון השיר (למשל: אינדי, רגאיי, מטאל)...' : 'Specify custom genre...'}
                        className="w-full px-4 py-2.5 rounded-xl bg-neutral-900 border border-emerald-500/50 text-white placeholder-neutral-500 text-xs font-bold focus:outline-none focus:border-emerald-400"
                        autoFocus
                      />
                    </div>
                  )}
                </div>

                {/* 4. LYRICS - OPTIONAL CUSTOM LYRICS OR AUTO-GENERATION */}
                <div className="p-4 sm:p-5 rounded-2xl bg-neutral-950 border border-neutral-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-extrabold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      <span>{isHe ? 'מילות השיר (אופציונלי)' : 'Lyrics (Optional)'}</span>
                    </label>

                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                      lyricsInput.trim()
                        ? 'bg-purple-500/20 border-purple-500/30 text-purple-300'
                        : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                    }`}>
                      {lyricsInput.trim()
                        ? (isHe ? '✓ מילים אישיות' : '✓ Custom')
                        : (isHe ? '✨ מופעל אוטומטי' : '✨ Auto Generated')}
                    </span>
                  </div>

                  <textarea
                    rows={3}
                    value={lyricsInput}
                    onChange={(e) => setLyricsInput(e.target.value)}
                    placeholder={isHe
                      ? 'הקלד או הדבק מילות שיר (אם לא תכתוב מילים, המערכת תיצור ותסנכרן את המילים באופן אוטומטי)...'
                      : 'Type or paste lyrics (if left empty, device will automatically generate and sync lyrics)...'}
                    className="w-full px-4 py-3 rounded-xl bg-neutral-900 border border-neutral-700 text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-400 text-xs font-sans leading-relaxed transition-all"
                  />

                  <p className="text-[11px] text-neutral-400">
                    {lyricsInput.trim()
                      ? (isHe ? 'המילים שהזנת יוצגו במלואן בנגן השירים' : 'Custom lyrics will be saved and displayed in player')
                      : (isHe ? '✨ לא נכתבו מילים? המכשיר ייצר ויסנכרן את מילות השיר באופן אוטומטי בעת הנגינה' : '✨ Empty? The device will auto-generate and sync lyrics automatically during playback')}
                  </p>
                </div>

                {/* AI GENERATED TRACK TOGGLE */}
                <div className="p-4 sm:p-5 rounded-2xl bg-purple-950/30 border border-purple-500/40 space-y-2 text-xs">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="rightsAiCheck"
                      checked={isAiGeneratedInput}
                      onChange={(e) => setIsAiGeneratedInput(e.target.checked)}
                      className="w-5 h-5 rounded border-purple-400 bg-neutral-900 text-purple-500 focus:ring-purple-500 cursor-pointer flex-shrink-0"
                    />
                    <label htmlFor="rightsAiCheck" className="font-bold text-xs text-purple-200 cursor-pointer select-none flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <span>{isHe ? 'השיר נוצר באמצעות בינה מלאכותית (יסומן בתווית AI בנגן ובכרטיס)' : 'AI-generated song (Marked with AI badge)'}</span>
                    </label>
                  </div>
                </div>

                {/* 5. MANDATORY RIGHTS & COPYRIGHT CERTIFICATION CHECKBOX */}
                <div className="p-4 sm:p-5 rounded-2xl bg-neutral-950 border border-amber-500/40 space-y-2 text-xs">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      id="rightsCertCheck"
                      required
                      checked={hasCertifiedRights}
                      onChange={(e) => setHasCertifiedRights(e.target.checked)}
                      className="mt-1 w-5 h-5 rounded border-amber-400 bg-neutral-900 text-amber-500 focus:ring-amber-500 cursor-pointer flex-shrink-0"
                    />
                    <label htmlFor="rightsCertCheck" className="font-bold text-xs text-neutral-300 leading-relaxed cursor-pointer select-none">
                      <span className="text-amber-300 font-black block mb-0.5">
                        {isHe ? 'אישור זכויות יוצרים ותנאי שימוש (חובה) *' : 'Rights & Copyright Certification (Required) *'}
                      </span>
                      {isHe
                        ? 'אני מאשר/ת מפורשות שהשיר והתמונה תואמים את תנאי השימוש, מותרים ברישיון תקף ויש לי את כל הזכויות וההרשאות להעלותם לשרת ולהפיצם בפלטפורמה.'
                        : 'I certify that the track and artwork comply with terms, are legally licensed, and I hold full rights to upload and distribute them on the platform.'}
                    </label>
                  </div>
                </div>

                {/* 6. PUBLISH BUTTON */}
                <button
                  type="submit"
                  disabled={isPublishing || !audioStreamUrl || !songTitle || !coverArtUrl || !hasCertifiedRights}
                  className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-black font-black text-sm transition-all cursor-pointer shadow-2xl flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isPublishing ? (
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-5 h-5 animate-spin text-black" />
                      <span>{isHe ? 'מעלה ושומר את השיר...' : 'Publishing track...'}</span>
                    </span>
                  ) : (
                    <>
                      <Upload className="w-5 h-5 text-black" />
                      <span>{isHe ? 'פרסם שיר לפרופיל' : 'Publish Song to Profile'}</span>
                    </>
                  )}
                </button>
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

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={!newAlbumTitle.trim()}
                    className="flex-1 py-4 rounded-2xl bg-white hover:bg-neutral-200 text-black font-black text-xs sm:text-sm transition-all shadow-xl cursor-pointer disabled:opacity-50"
                  >
                    {editingAlbum
                      ? (isHe ? 'שמור שינויים באלבום' : 'Save Album Changes')
                      : (isHe ? 'צור אלבום ושמור' : 'Create Album')}
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
                      src={currentUser.photoURL}
                      alt={currentUser.displayName || 'User'}
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
                    {currentUser?.email || (isHe ? 'התחבר כדי לשמור ולסנכרן את המוזיקה שלך' : 'Sign in to sync your music')}
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
                    <span>{isHe ? 'התחבר עם Google' : 'Sign in with Google'}</span>
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
                            src={artistAvatarPreview || currentArtist.avatarUrl || currentUser?.photoURL || ''}
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
                    <div className="space-y-1 text-center sm:text-right">
                      <h4 className="text-white font-black text-sm">{isHe ? 'תמונת פרופיל' : 'Profile Photo'}</h4>
                      <p className="text-[10px] text-neutral-400">{isHe ? 'תמונה זו תוצג בעמוד האמן שלך ובחיפושים.' : 'This photo will be shown on your profile and search results.'}</p>
                      <p className="text-[9px] text-emerald-400/80 font-bold uppercase tracking-widest">{isHe ? 'נשמר ב-GitHub Storage' : 'Stored on GitHub'}</p>
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
                    localStorage.setItem('wikiarchive_custom_server_url', e.target.value);
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
