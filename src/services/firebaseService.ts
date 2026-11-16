import { initializeApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  getDocFromServer,
  query,
  where,
  increment,
} from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  User as FirebaseUser,
} from 'firebase/auth';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { ArtistProfile, CURRENT_TERMS_VERSION, JamendoTrack, TrackReport } from '../types';

export const firebaseConfig = {
  apiKey: (import.meta.env?.VITE_FIREBASE_API_KEY as string) || (firebaseAppletConfig as any)?.apiKey || '',
  authDomain: (import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN as string) || (firebaseAppletConfig as any)?.authDomain || '',
  projectId: (import.meta.env?.VITE_FIREBASE_PROJECT_ID as string) || (firebaseAppletConfig as any)?.projectId || '',
  storageBucket: (import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET as string) || (firebaseAppletConfig as any)?.storageBucket || '',
  messagingSenderId: (import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID as string) || (firebaseAppletConfig as any)?.messagingSenderId || '',
  appId: (import.meta.env?.VITE_FIREBASE_APP_ID as string) || (firebaseAppletConfig as any)?.appId || '',
};

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Firestore
export const db = getFirestore(app, (firebaseAppletConfig as any)?.firestoreDatabaseId || '(default)');

// Initialize Auth with Firebase SDK browser local persistence (zero custom PII in localStorage)
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: auth.currentUser?.uid || null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
    },
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

// Test connection on startup
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline or initializing.');
    }
    return false;
  }
}

export async function checkIsCurrentUserAdmin(): Promise<boolean> {
  const uid = auth.currentUser?.uid;
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

// -------------------------------------------------------------
// MULTI-PROVIDER AUTHENTICATION HELPERS
// -------------------------------------------------------------

export async function loginWithGoogle(): Promise<FirebaseUser | null> {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error: any) {
    console.warn('Google Sign In Popup notice:', error);
    if (
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      return null;
    }
    throw error;
  }
}

export async function loginWithMicrosoft(): Promise<FirebaseUser | null> {
  const provider = new OAuthProvider('microsoft.com');
  provider.addScope('openid');
  provider.addScope('profile');
  provider.setCustomParameters({ prompt: 'select_account' });

  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error: any) {
    console.warn('Microsoft Sign In popup notice:', error);
    if (
      error?.code === 'auth/popup-blocked' ||
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      try {
        await signInWithRedirect(auth, provider);
        return auth.currentUser;
      } catch (redirectErr) {
        console.error('Microsoft redirect error:', redirectErr);
      }
    }
    throw error;
  }
}

export async function loginWithEmailPassword(email: string, pass: string): Promise<FirebaseUser | null> {
  const result = await signInWithEmailAndPassword(auth, email.trim(), pass);
  return result.user;
}

export async function registerWithEmailPassword(
  email: string,
  pass: string,
  displayName?: string
): Promise<FirebaseUser | null> {
  const result = await createUserWithEmailAndPassword(auth, email.trim(), pass);
  if (displayName && result.user) {
    await updateProfile(result.user, { displayName });
  }
  return result.user;
}

export async function loginWithFacebook(): Promise<FirebaseUser | null> {
  const provider = new FacebookAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function loginWithYahoo(): Promise<FirebaseUser | null> {
  const provider = new OAuthProvider('yahoo.com');
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function resetAccountPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function logoutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Sign Out Error:', error);
  }
}

// Handle pending OAuth redirects silently without caching PII to localStorage
getRedirectResult(auth).catch((err) => {
  console.warn('OAuth redirect listener notice:', err);
});

/**
 * Upgrades Google avatar thumbnails (e.g. =s96-c) to high-resolution (=s400-c) for sharp clarity.
 */
export function upgradeGooglePhotoQuality(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('googleusercontent.com')) {
    if (/=s\d+(-c)?$/.test(trimmed)) {
      return trimmed.replace(/=s\d+(-c)?$/, '=s400-c');
    }
    if (/=w\d+-h\d+/.test(trimmed)) {
      return trimmed.replace(/=w\d+-h\d+[^&]*/, '=s400-c');
    }
  }
  return trimmed;
}

/**
 * Extracts the authentic Google / OAuth account photo URL (checking both user.photoURL and providerData).
 */
export function getGoogleAccountPhotoUrl(user: FirebaseUser | null): string | undefined {
  if (!user) return undefined;
  if (user.photoURL && user.photoURL.trim()) {
    return upgradeGooglePhotoQuality(user.photoURL);
  }
  const googleProvider = user.providerData?.find((p) => p?.providerId?.includes('google') && p?.photoURL);
  if (googleProvider?.photoURL) {
    return upgradeGooglePhotoQuality(googleProvider.photoURL);
  }
  const anyProviderPhoto = user.providerData?.find((p) => !!p?.photoURL)?.photoURL;
  return upgradeGooglePhotoQuality(anyProviderPhoto);
}

export function getEffectiveUserAvatar(
  user: FirebaseUser | null,
  profile?: ArtistProfile | null
): string | undefined {
  // 1. Prefer explicitly uploaded non-Google custom avatar
  if (profile?.avatarUrl && profile.avatarUrl.trim() && !profile.avatarUrl.includes('googleusercontent.com')) {
    return profile.avatarUrl.trim();
  }

  // 2. Fallback to crisp Google / OAuth account photoURL
  const googlePhoto = getGoogleAccountPhotoUrl(user);
  if (googlePhoto) return googlePhoto;

  // 3. Fallback to any stored profile avatarUrl
  if (profile?.avatarUrl && profile.avatarUrl.trim()) {
    return upgradeGooglePhotoQuality(profile.avatarUrl);
  }

  return undefined;
}

export function getEffectiveArtistAvatarForTrack(
  track: JamendoTrack,
  artists: ArtistProfile[] = []
): string | undefined {
  const uid = (track.uploadedByUid || '').replace(/^artist_/, '').trim();
  const normName = (track.artistName || '').toLowerCase().trim();

  const matchedArtist =
    (uid
      ? artists.find(
          (a) =>
            a.id === uid ||
            a.id === `artist_${uid}` ||
            a.googleUid === uid ||
            a.id.replace(/^artist_/, '') === uid
        )
      : undefined) ||
    (normName ? artists.find((a) => (a.name || '').toLowerCase().trim() === normName) : undefined);

  if (matchedArtist?.avatarUrl && matchedArtist.avatarUrl.trim()) {
    return upgradeGooglePhotoQuality(matchedArtist.avatarUrl);
  }
  if (track.artistAvatarUrl && track.artistAvatarUrl.trim()) {
    return upgradeGooglePhotoQuality(track.artistAvatarUrl);
  }
  return undefined;
}

export function onAuthUserChanged(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}

// -------------------------------------------------------------
// ARTIST ACCOUNTS OPERATIONS (100% Cloudflare R2 — Firebase is Auth-only)
// -------------------------------------------------------------

import {
  uploadArtistProfileToCloud,
  fetchArtistProfileByUidFromCloud,
  fetchArtistProfilesFromCloud,
} from './cloudStorageService';

export async function saveArtistAccountToFirebase(artist: ArtistProfile): Promise<boolean> {
  const res = await uploadArtistProfileToCloud(artist);
  return res.success;
}

export async function getArtistAccountByGoogleUid(googleUid: string): Promise<ArtistProfile | null> {
  if (!googleUid) return null;
  return fetchArtistProfileByUidFromCloud(googleUid);
}

export async function getArtistAccountsFromFirebase(): Promise<ArtistProfile[]> {
  return fetchArtistProfilesFromCloud();
}

// -------------------------------------------------------------
// ARTIST TRACKS FIRESTORE OPERATIONS
// -------------------------------------------------------------

export async function saveArtistTrackToFirebase(track: JamendoTrack): Promise<boolean> {
  if (!auth.currentUser) return false;
  try {
    if (!track.audioUrl || !track.name || !track.artistName) return false;

    const trackDocRef = doc(db, 'artistTracks', track.id);
    const payload = {
      id: track.id,
      name: track.name.slice(0, 200),
      artistName: track.artistName.slice(0, 100),
      featuredArtist: (track.featuredArtist || '').slice(0, 100),
      writers: (track.writers || '').slice(0, 500),
      audioUrl: track.audioUrl.startsWith('data:') ? track.audioUrl.slice(0, 2000) : track.audioUrl.slice(0, 2000),
      coverUrl: track.coverUrl ? track.coverUrl.slice(0, 500000) : '',
      albumName: (track.albumName || 'Single').slice(0, 100),
      genre: (track.genre || 'Pop').slice(0, 50),
      lyrics: (track.lyrics || '').slice(0, 8000),
      lyricsHe: (track.lyricsHe || '').slice(0, 6000),
      lyricsEn: (track.lyricsEn || '').slice(0, 6000),
      subtitleSegments: Array.isArray(track.subtitleSegments) ? track.subtitleSegments.slice(0, 250) : [],
      subtitleSegmentsHe: Array.isArray(track.subtitleSegmentsHe) ? track.subtitleSegmentsHe.slice(0, 250) : [],
      subtitleSegmentsEn: Array.isArray(track.subtitleSegmentsEn) ? track.subtitleSegmentsEn.slice(0, 250) : [],
      hasWhisperSubtitles:
        !!track.hasWhisperSubtitles ||
        (Array.isArray(track.subtitleSegments) && track.subtitleSegments.length > 0) ||
        (Array.isArray(track.subtitleSegmentsHe) && track.subtitleSegmentsHe.length > 0) ||
        (Array.isArray(track.subtitleSegmentsEn) && track.subtitleSegmentsEn.length > 0),
      bgColor: (track.bgColor || '').slice(0, 500),
      uploadedByUid: (track.uploadedByUid || auth.currentUser.uid).slice(0, 128),
      artistAvatarUrl: (track.artistAvatarUrl || '').slice(0, 500000),
      publisherAccountUrl: (track.publisherAccountUrl || track.licenseUrl || 'https://audius.co').slice(0, 500),
      createdAt: (track.publishedDate || new Date().toISOString().split('T')[0]).slice(0, 50),
      isAiGenerated: !!track.isAiGenerated,
      playsCount: track.playsCount || 0,
    };

    await setDoc(trackDocRef, payload, { merge: true });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `artistTracks/${track.id}`);
    return false;
  }
}

export async function incrementTrackPlaysInFirebase(trackId: string): Promise<number> {
  if (!auth.currentUser) return 1;
  try {
    const trackDocRef = doc(db, 'artistTracks', trackId);
    await setDoc(trackDocRef, { playsCount: increment(1) }, { merge: true });
    const snap = await getDoc(trackDocRef);
    if (snap.exists()) {
      return snap.data().playsCount || 1;
    }
  } catch {
    // Non-fatal
  }
  return 1;
}

export async function getArtistTracksFromFirebase(): Promise<JamendoTrack[]> {
  try {
    const snapshot = await getDocs(collection(db, 'artistTracks'));
    const tracks: JamendoTrack[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (
        data &&
        !data.isDeleted &&
        data.audioUrl &&
        typeof data.audioUrl === 'string' &&
        !data.audioUrl.startsWith('blob:') &&
        !data.audioUrl.startsWith('/uploads/') &&
        data.name &&
        data.artistName
      ) {
        tracks.push({
          id: data.id || docSnap.id,
          name: data.name,
          artistName: data.artistName,
          featuredArtist: data.featuredArtist || undefined,
          writers: data.writers || undefined,
          albumName: data.albumName || 'Single',
          duration: 180,
          audioUrl: data.audioUrl,
          coverUrl: data.coverUrl || '',
          genre: data.genre || 'Pop',
          license: 'Kolot Music Cloud Storage (10GB)',
          source: 'Kolot R2 Storage',
          legalStatus: '100% שיר עצמאי מקורי ומאושר להאזנה',
          lyrics: data.lyrics || undefined,
          lyricsHe: data.lyricsHe || undefined,
          lyricsEn: data.lyricsEn || undefined,
          subtitleSegments: Array.isArray(data.subtitleSegments) && data.subtitleSegments.length > 0 ? data.subtitleSegments : undefined,
          subtitleSegmentsHe: Array.isArray(data.subtitleSegmentsHe) && data.subtitleSegmentsHe.length > 0 ? data.subtitleSegmentsHe : undefined,
          subtitleSegmentsEn: Array.isArray(data.subtitleSegmentsEn) && data.subtitleSegmentsEn.length > 0 ? data.subtitleSegmentsEn : undefined,
          hasWhisperSubtitles:
            !!data.hasWhisperSubtitles ||
            (Array.isArray(data.subtitleSegments) && data.subtitleSegments.length > 0) ||
            (Array.isArray(data.subtitleSegmentsHe) && data.subtitleSegmentsHe.length > 0) ||
            (Array.isArray(data.subtitleSegmentsEn) && data.subtitleSegmentsEn.length > 0),
          publishedDate: data.createdAt || '2024',
          publisherAccountUrl: data.publisherAccountUrl || 'https://audius.co',
          uploadedByUid: data.uploadedByUid || undefined,
          bgColor: data.bgColor || undefined,
          artistAvatarUrl: upgradeGooglePhotoQuality(data.artistAvatarUrl) || undefined,
          isAiGenerated: !!data.isAiGenerated,
          playsCount: data.playsCount || 0,
        });
      }
    });
    return tracks;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'artistTracks');
    return [];
  }
}

import { syncArtistAvatarToTracksInR2 } from './cloudStorageService';

export async function syncArtistAvatarToTracks(
  artistUid: string,
  _artistEmail: string | undefined,
  avatarUrl: string | undefined,
  tracks: JamendoTrack[],
  artistNameHint?: string
): Promise<void> {
  await syncArtistAvatarToTracksInR2(artistUid, avatarUrl, tracks, artistNameHint);
}

// -------------------------------------------------------------
// TRACK REPORTS FIRESTORE OPERATIONS
// -------------------------------------------------------------

export async function saveTrackReportToFirebase(report: TrackReport): Promise<boolean> {
  if (!auth.currentUser) {
    // Non-signed-in listeners submit safely via backend API to R2 reports/
    try {
      const res = await fetch('/api/storage/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  try {
    const reportDocRef = doc(db, 'trackReports', report.id);
    await setDoc(reportDocRef, {
      id: report.id.slice(0, 128),
      trackId: report.trackId.slice(0, 128),
      trackName: report.trackName.slice(0, 200),
      artistName: report.artistName.slice(0, 100),
      reason: report.reason.slice(0, 200),
      details: (report.details || '').slice(0, 2000),
      reportedAt: report.reportedAt.slice(0, 50),
      status: report.status || 'pending',
      reporterUid: auth.currentUser.uid,
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `trackReports/${report.id}`);
    return false;
  }
}

export async function getTrackReportsFromFirebase(): Promise<TrackReport[]> {
  if (!auth.currentUser) return [];
  try {
    const snapshot = await getDocs(collection(db, 'trackReports'));
    const reports: TrackReport[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.trackName) {
        reports.push({
          id: data.id || docSnap.id,
          trackId: data.trackId,
          trackName: data.trackName,
          artistName: data.artistName,
          reason: data.reason,
          details: data.details,
          reportedAt: data.reportedAt,
          status: data.status || 'pending',
          reporterUid: data.reporterUid,
        });
      }
    });
    return reports;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'trackReports');
    return [];
  }
}

export async function dismissTrackReportInFirebase(reportId: string): Promise<boolean> {
  if (!auth.currentUser) return false;
  try {
    const reportDocRef = doc(db, 'trackReports', reportId);
    await setDoc(reportDocRef, { status: 'dismissed' }, { merge: true });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `trackReports/${reportId}`);
    return false;
  }
}

export async function deleteArtistTrackFromFirebase(trackId: string): Promise<boolean> {
  if (!auth.currentUser) return false;
  try {
    const trackDocRef = doc(db, 'artistTracks', trackId);
    try {
      await deleteDoc(trackDocRef);
    } catch {
      await setDoc(trackDocRef, { isDeleted: true }, { merge: true });
    }

    try {
      const q = query(collection(db, 'artistTracks'), where('id', '==', trackId));
      const snap = await getDocs(q);
      const deletePromises: Promise<void>[] = [];
      snap.forEach((d) => {
        deletePromises.push(
          deleteDoc(d.ref).catch(() => setDoc(d.ref, { isDeleted: true }, { merge: true }))
        );
      });
      await Promise.allSettled(deletePromises);
    } catch {}

    return true;
  } catch (error) {
    console.warn('Firestore track delete error:', error);
    return false;
  }
}
