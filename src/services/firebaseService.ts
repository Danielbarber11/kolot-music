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
  User as FirebaseUser,
} from 'firebase/auth';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { ArtistProfile, JamendoTrack } from '../types';

export const firebaseConfig = Object.assign(
  {
    apiKey: "AIzaSyDE5Iw4C8F-YNSwlUGLn3B9pgi6ZpffnQI",
    authDomain: "soy-lore-461719-i9.firebaseapp.com",
    projectId: "soy-lore-461719-i9",
    storageBucket: "soy-lore-461719-i9.firebasestorage.app",
    messagingSenderId: "1029411846084",
    appId: "1:1029411846084:web:3d0fa2dca6338a9b981691",
  },
  firebaseAppletConfig || {}
);

// Initialize Firebase App
const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Firestore
export const db = getFirestore(app, (firebaseAppletConfig as any)?.firestoreDatabaseId || '(default)');

// Initialize Auth
export const auth = getAuth(app);

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
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

// Test connection on startup as required by skill guidelines
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

// -------------------------------------------------------------
// MULTI-PROVIDER AUTHENTICATION HELPERS
// (Google, Microsoft, Email/Password, Facebook, Yahoo)
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
      error?.code === 'auth/popup-blocked' ||
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      try {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        await signInWithRedirect(auth, provider);
        return auth.currentUser;
      } catch (redirectErr) {
        console.error('Redirect sign in error:', redirectErr);
      }
    }
    throw error;
  }
}

export async function loginWithMicrosoft(): Promise<FirebaseUser | null> {
  try {
    const provider = new OAuthProvider('microsoft.com');
    provider.addScope('openid');
    provider.addScope('email');
    provider.addScope('profile');
    provider.setCustomParameters({
      prompt: 'select_account',
      tenant: 'common',
    });
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error: any) {
    console.warn('Microsoft Sign In notice:', error);
    if (
      error?.code === 'auth/popup-blocked' ||
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      try {
        const provider = new OAuthProvider('microsoft.com');
        provider.addScope('openid');
        provider.addScope('email');
        provider.addScope('profile');
        provider.setCustomParameters({
          prompt: 'select_account',
          tenant: 'common',
        });
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

// Handle pending OAuth redirects (Microsoft / Google / Facebook / Yahoo)
getRedirectResult(auth)
  .then((result) => {
    if (result?.user) {
      console.log('Successfully signed in via OAuth redirect:', result.user);
      try {
        localStorage.setItem(
          'wikiarchive_cached_auth_user',
          JSON.stringify({
            uid: result.user.uid,
            displayName: result.user.displayName,
            photoURL: result.user.photoURL,
            email: result.user.email,
          })
        );
      } catch {}
    }
  })
  .catch((err) => {
    console.warn('OAuth redirect listener notice:', err);
  });

export function onAuthUserChanged(callback: (user: FirebaseUser | null) => void) {
  return onAuthStateChanged(auth, callback);
}

// -------------------------------------------------------------
// ARTIST ACCOUNTS FIRESTORE OPERATIONS
// -------------------------------------------------------------

export async function saveArtistAccountToFirebase(artist: ArtistProfile): Promise<boolean> {
  try {
    const docId = artist.googleUid || artist.id;
    const artistDocRef = doc(db, 'artistAccounts', docId);

    const accountUrl =
      artist.archiveAccountUrl ||
      (artist.audiusHandle ? `https://audius.co/${artist.audiusHandle.replace(/^@/, '')}` : 'https://audius.co');

    const payload = {
      id: docId,
      name: artist.name.slice(0, 100),
      avatarUrl: (artist.avatarUrl || '').slice(0, 500000),
      genre: (artist.genre || 'General').slice(0, 50),
      accountUrl: accountUrl.slice(0, 500),
      connectionCode: (artist.connectionCode || '').slice(0, 50),
      googleUid: artist.googleUid || '',
      googleEmail: artist.googleEmail || '',
      audiusHandle: (artist.audiusHandle || '').slice(0, 80),
      isConnected: true,
      hasAcceptedTerms: artist.hasAcceptedTerms ?? true,
      acceptedTermsAt: artist.acceptedTermsAt || new Date().toISOString(),
      isPrivate: artist.isPrivate ?? false,
      tracksCount: artist.tracksCount ?? 0,
      providerPlatform: artist.providerPlatform || 'Audius Protocol (Decentralized Open Audio)',
      createdAt: artist.joinedDate || new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString().split('T')[0],
    };

    await setDoc(artistDocRef, payload, { merge: true });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `artistAccounts/${artist.googleUid || artist.id}`);
    return false;
  }
}

export async function getArtistAccountByGoogleUid(googleUid: string): Promise<ArtistProfile | null> {
  try {
    const directDocRef = doc(db, 'artistAccounts', googleUid);
    const directSnap = await getDoc(directDocRef);
    if (directSnap.exists()) {
      const data = directSnap.data();
      return {
        id: directSnap.id,
        name: data.name || '',
        bio: data.bio || '',
        avatarUrl: data.avatarUrl || undefined,
        genre: data.genre || 'General',
        archiveAccountUrl: data.accountUrl,
        audiusHandle: data.audiusHandle,
        connectionCode: data.connectionCode,
        googleUid: data.googleUid || googleUid,
        googleEmail: data.googleEmail || '',
        isConnected: true,
        hasAcceptedTerms: !!data.hasAcceptedTerms,
        acceptedTermsAt: data.acceptedTermsAt,
        isPrivate: data.isPrivate !== undefined ? data.isPrivate : false,
        tracksCount: data.tracksCount || 0,
        providerPlatform: data.providerPlatform || 'Audius',
        joinedDate: data.createdAt || '2024',
        totalPlays: 0,
        followersCount: 0,
      };
    }

    const q = query(collection(db, 'artistAccounts'), where('googleUid', '==', googleUid));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const docSnap = querySnap.docs[0];
      const data = docSnap.data();
      return {
        id: docSnap.id,
        name: data.name || '',
        bio: data.bio || '',
        avatarUrl: data.avatarUrl || undefined,
        genre: data.genre || 'General',
        archiveAccountUrl: data.accountUrl,
        audiusHandle: data.audiusHandle,
        connectionCode: data.connectionCode,
        googleUid: data.googleUid || googleUid,
        googleEmail: data.googleEmail || '',
        isConnected: true,
        hasAcceptedTerms: !!data.hasAcceptedTerms,
        acceptedTermsAt: data.acceptedTermsAt,
        isPrivate: data.isPrivate !== undefined ? data.isPrivate : false,
        tracksCount: data.tracksCount || 0,
        providerPlatform: data.providerPlatform || 'Audius',
        joinedDate: data.createdAt || '2024',
        totalPlays: 0,
        followersCount: 0,
      };
    }

    return null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `artistAccounts/${googleUid}`);
    return null;
  }
}

export async function getArtistAccountsFromFirebase(): Promise<ArtistProfile[]> {
  try {
    const snapshot = await getDocs(collection(db, 'artistAccounts'));
    const results: ArtistProfile[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      // "עם לא העלת כלום לא יופיע הפרופיל שלך" - Hide profiles that have 0 tracks and are marked private
      if (data && data.name && data.id) {
        if (data.isPrivate && (!data.tracksCount || data.tracksCount === 0)) {
          return; // Hide empty private profiles from public listing
        }
        results.push({
          id: data.id,
          name: data.name,
          bio: data.bio,
          avatarUrl: data.avatarUrl,
          genre: data.genre || 'Pop',
          archiveAccountUrl: data.accountUrl || undefined,
          audiusHandle: data.audiusHandle || undefined,
          connectionCode: data.connectionCode || undefined,
          googleUid: data.googleUid || undefined,
          googleEmail: data.googleEmail || undefined,
          isConnected: true,
          hasAcceptedTerms: !!data.hasAcceptedTerms,
          isPrivate: !!data.isPrivate,
          tracksCount: data.tracksCount || 0,
          providerPlatform: data.providerPlatform || 'Audius',
          joinedDate: data.createdAt || '2024',
          totalPlays: 0,
          followersCount: 0,
        });
      }
    });
    return results;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'artistAccounts');
    return [];
  }
}

// -------------------------------------------------------------
// ARTIST TRACKS FIRESTORE OPERATIONS
// -------------------------------------------------------------

export async function saveArtistTrackToFirebase(track: JamendoTrack): Promise<boolean> {
  try {
    if (!track.audioUrl || !track.name || !track.artistName) return false;

    const trackDocRef = doc(db, 'artistTracks', track.id);
    const payload = {
      id: track.id,
      name: track.name.slice(0, 200),
      artistName: track.artistName.slice(0, 100),
      featuredArtist: (track.featuredArtist || '').slice(0, 100),
      writers: (track.writers || '').slice(0, 500),
      audioUrl: track.audioUrl.startsWith('data:') ? track.audioUrl.slice(0, 500000) : track.audioUrl,
      coverUrl: track.coverUrl ? track.coverUrl.slice(0, 500000) : '',
      albumName: (track.albumName || 'Single').slice(0, 100),
      genre: (track.genre || 'Pop').slice(0, 50),
      lyrics: (track.lyrics || '').slice(0, 8000),
      bgColor: track.bgColor || '',
      uploadedByUid: track.uploadedByUid || '',
      artistAvatarUrl: track.artistAvatarUrl || '',
      publisherAccountUrl: (track.publisherAccountUrl || track.licenseUrl || 'https://audius.co').slice(0, 500),
      createdAt: track.publishedDate || new Date().toISOString().split('T')[0],
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
  try {
    const trackDocRef = doc(db, 'artistTracks', trackId);
    await setDoc(trackDocRef, { playsCount: increment(1) }, { merge: true });
    const snap = await getDoc(trackDocRef);
    if (snap.exists()) {
      return snap.data().playsCount || 1;
    }
  } catch (error) {
    console.warn('Atomic plays increment notice:', error);
  }
  return 1;
}

export async function getArtistTracksFromFirebase(): Promise<JamendoTrack[]> {
  try {
    const snapshot = await getDocs(collection(db, 'artistTracks'));
    const tracks: JamendoTrack[] = [];
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data && data.audioUrl && data.name && data.artistName) {
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
          license: 'Kolot Music Cloud Storage (1GB)',
          source: 'Kolot Music Open Storage',
          legalStatus: '100% שיר עצמאי מקורי ומאושר להאזנה',
          lyrics: data.lyrics || undefined,
          publishedDate: data.createdAt || '2024',
          publisherAccountUrl: data.publisherAccountUrl || 'https://audius.co',
          uploadedByUid: data.uploadedByUid || undefined,
          bgColor: data.bgColor || undefined,
          artistAvatarUrl: data.artistAvatarUrl || undefined,
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

// -------------------------------------------------------------
// TRACK REPORTS FIRESTORE OPERATIONS
// -------------------------------------------------------------

export async function saveTrackReportToFirebase(report: import('../types').TrackReport): Promise<boolean> {
  try {
    const reportDocRef = doc(db, 'trackReports', report.id);
    await setDoc(reportDocRef, {
      id: report.id,
      trackId: report.trackId,
      trackName: report.trackName,
      artistName: report.artistName,
      reason: report.reason,
      details: report.details || '',
      reportedAt: report.reportedAt,
      status: report.status || 'pending',
      reporterUid: report.reporterUid || '',
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `trackReports/${report.id}`);
    return false;
  }
}

export async function getTrackReportsFromFirebase(): Promise<import('../types').TrackReport[]> {
  try {
    const snapshot = await getDocs(collection(db, 'trackReports'));
    const reports: import('../types').TrackReport[] = [];
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
  try {
    const trackDocRef = doc(db, 'artistTracks', trackId);
    await deleteDoc(trackDocRef);

    try {
      const q = query(collection(db, 'artistTracks'), where('id', '==', trackId));
      const snap = await getDocs(q);
      const deletePromises: Promise<void>[] = [];
      snap.forEach((d) => {
        deletePromises.push(deleteDoc(d.ref));
      });
      await Promise.allSettled(deletePromises);
    } catch {}

    return true;
  } catch (error) {
    console.warn('Firestore track delete error:', error);
    return false;
  }
}

