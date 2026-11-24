export type MediaType = 
  | 'all' 
  | 'movies' 
  | 'audio' 
  | 'texts'
  | 'software'
  | 'web'
  | 'gutenberg' 
  | 'openlibrary' 
  | 'musicbrainz' 
  | 'jamendo' 
  | 'openverse' 
  | 'wiki' 
  | 'archive';

export interface WikiItem {
  pageid: number;
  title: string;
  snippet: string;
  extract?: string;
  pageUrl: string;
  thumbnail?: string;
  language: 'he' | 'en';
  lastModified?: string;
}

export interface ArchiveFile {
  name: string;
  format: string;
  size?: number;
  url: string;
}

export interface ArchiveItem {
  identifier: string;
  title: string;
  description?: string;
  mediaType: MediaType | string;
  year?: string;
  date?: string;
  creator?: string;
  downloads?: number;
  thumbnail?: string;
  embedUrl?: string;
  directMediaUrl?: string;
  itemUrl: string;
  files?: ArchiveFile[];
}

export interface WaybackSnapshot {
  originalUrl: string;
  timestamp: string;
  archiveUrl: string;
  status?: string;
}

export interface GutenbergBook {
  id: number;
  title: string;
  authors: { name: string; birth_year?: number; death_year?: number }[];
  subjects: string[];
  languages: string[];
  downloadCount: number;
  coverUrl?: string;
  readUrl?: string;
  epubUrl?: string;
  txtUrl?: string;
}

export interface OpenLibraryBook {
  key: string;
  title: string;
  authorNames: string[];
  firstPublishYear?: number;
  coverUrl?: string;
  editionCount?: number;
  subjects?: string[];
  isbn?: string[];
}

export interface MusicBrainzRelease {
  id: string;
  title: string;
  artistName: string;
  type?: string;
  date?: string;
  country?: string;
  trackCount?: number;
  musicBrainzUrl: string;
}

export interface TrackReport {
  id: string;
  trackId: string;
  trackName: string;
  artistName: string;
  reason: string;
  details?: string;
  reportedAt: string;
  status: 'pending' | 'reviewed' | 'dismissed';
  reporterUid?: string;
  reporterName?: string;
  reporterEmail?: string;
  reporterAvatarUrl?: string;
  uploaderEmail?: string;
  uploadedByUid?: string;
  legalDocumentKey?: string;
  legalDocumentName?: string;
}

export interface Album {
  id: string;
  title: string;
  artistName: string;
  artistId?: string;
  uploadedByUid?: string;
  coverUrl?: string;
  description?: string;
  trackIds: string[];
  releaseDate?: string;
  createdDate: string;
}

export interface SubtitleWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface SubtitleSegment {
  id?: string;
  startTime: number;
  endTime: number;
  text: string;
  words?: SubtitleWord[];
}

export interface JamendoTrack {
  id: string;
  name: string;
  artistName: string;
  albumName: string;
  duration: number;
  audioUrl: string;
  coverUrl: string;
  licenseUrl?: string;
  license?: string;
  source?: string;
  legalStatus?: string;
  lyrics?: string;
  lyricsHe?: string;
  lyricsEn?: string;
  lyricsOrig?: string;
  subtitleSegments?: SubtitleSegment[];
  subtitleSegmentsHe?: SubtitleSegment[];
  subtitleSegmentsEn?: SubtitleSegment[];
  subtitleSegmentsOrig?: SubtitleSegment[];
  detectedLanguageCode?: string;
  detectedLanguageLabel?: string;
  hasWhisperSubtitles?: boolean;
  subtitlesDisabled?: boolean;
  subtitlesIncomplete?: boolean;
  subtitlesCompletedUpTo?: number;
  artistId?: string;
  albumId?: string;
  genre?: string;
  liked?: boolean;
  publishedDate?: string;
  artistBio?: string;
  artistAvatarUrl?: string;
  publisherAccountUrl?: string;
  uploadedByUid?: string;
  uploadedByEmail?: string;
  isPrivate?: boolean;
  customServerUrl?: string;
  bgColor?: string;
  isAiGenerated?: boolean;
  hasAutoLyrics?: boolean;
  playsCount?: number;
  viewsCount?: number;
  featuredArtist?: string;
  writers?: string;
  karaokeAudioUrl?: string;
  karaokeEnabled?: boolean;
  concertName?: string;
  concertDate?: string;
  concertTicketUrl?: string;
}

export const CURRENT_TERMS_VERSION = 4;

export interface ConcertShow {
  id: string;
  title: string;
  date: string;
  ticketUrl: string;
  venue?: string;
  createdAt?: string;
}

export interface ArtistProfile {
  id: string;
  name: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  joinedDate?: string;
  genre?: string;
  audiusHandle?: string;
  archiveAccountUrl?: string;
  connectionCode?: string;
  googleUid?: string;
  uid?: string;
  googleEmail?: string;
  isConnected?: boolean;
  hasAcceptedTerms?: boolean;
  termsVersionAccepted?: number;
  acceptedTermsAt?: string;
  updatedAt?: string;
  isPrivate?: boolean;
  tracksCount?: number;
  providerPlatform?: string;
  totalPlays?: number;
  followersCount?: number;
  customServerUrl?: string;
  concertShows?: ConcertShow[];
  tracks?: JamendoTrack[];
  albums?: Album[];
}

export interface OpenverseImage {
  id: string;
  title: string;
  creator?: string;
  url: string;
  thumbnailUrl: string;
  license: string;
  licenseUrl?: string;
  source: string;
}

export interface BotMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  wikiItems?: WikiItem[];
  archiveItems?: ArchiveItem[];
  gutenbergBooks?: GutenbergBook[];
  openLibraryBooks?: OpenLibraryBook[];
  musicBrainzReleases?: MusicBrainzRelease[];
  jamendoTracks?: JamendoTrack[];
  openverseImages?: OpenverseImage[];
  suggestedQuestions?: string[];
  mediaAttachment?: JamendoTrack | ArchiveItem;
}

export interface BookmarkItem {
  id: string;
  type: 'wiki' | 'archive' | 'gutenberg' | 'openlibrary' | 'jamendo' | 'openverse' | 'bot_answer';
  title: string;
  summary: string;
  url: string;
  dateAdded: string;
  thumbnail?: string;
  extra?: any;
}

export interface KnowledgeNode {
  id: string;
  label: string;
  type: 'wiki' | 'archive' | 'topic' | 'year';
  x: number;
  y: number;
  color: string;
  connections: string[];
  details?: string;
  mediaType?: MediaType;
  url?: string;
  identifier?: string;
}

export type Language = 'he' | 'en';
export type EngineMode = 'server' | 'client_offline';

