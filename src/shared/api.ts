import type { MediaReport, TrackReport } from '../mp4/inspect.js';
import type { DecoyAudioMode, JunkTailMode, PatchOptions, PatchPreset, PresetId } from '../mp4/techniques.js';
import type { VerificationCheck } from '../mp4/verify.js';

export type {
  DecoyAudioMode,
  JunkTailMode,
  MediaReport,
  PatchOptions,
  PatchPreset,
  PresetId,
  TrackReport,
  VerificationCheck,
};

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface HealthResponse {
  ffmpeg: boolean;
  tiktokConfigured: boolean;
  appAudited: boolean;
  marker: string;
  redirectUri: string;
  chunkSizeMb: number;
}

export interface PresetsResponse {
  presets: PatchPreset[];
  marker: string;
}

export interface AccountSummary {
  openId: string;
  displayName: string;
  avatarUrl: string | null;
  scopes: string[];
  connectedAt: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

export type PrivacyLevel = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';

export interface CreatorInfo {
  creatorAvatarUrl: string | null;
  creatorUsername: string;
  creatorNickname: string;
  privacyLevelOptions: PrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

export type PostMode = 'direct' | 'inbox';

export interface PublishRequest {
  openId: string;
  mode: PostMode;
  title?: string;
  privacyLevel?: PrivacyLevel;
  disableComment?: boolean;
  disableDuet?: boolean;
  disableStitch?: boolean;
  brandContentToggle?: boolean;
  brandOrganicToggle?: boolean;
  isAigc?: boolean;
}

export type PublicationStatus = 'initializing' | 'uploading' | 'processing' | 'inbox' | 'published' | 'failed';

export interface Publication {
  id: string;
  openId: string;
  accountName: string;
  mode: PostMode;
  status: PublicationStatus;
  publishId: string | null;
  uploadedBytes: number;
  totalBytes: number;
  tiktokStatus: string | null;
  failReason: string | null;
  postIds: string[];
  privacyLevel: PrivacyLevel | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServedRung {
  gearName: string;
  codec: string;
  qualityType: number | null;
  bitrateKbps: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
}

export interface ServedDownload {
  report: MediaReport;
  markerFound: boolean;
}

export interface ServedReport {
  id: string;
  url: string;
  videoId: string | null;
  checkedAt: string;
  rungs: ServedRung[];
  topRung: ServedRung | null;
  download: ServedDownload | null;
  downloadError: string | null;
  sourceBitrateKbps: number | null;
  retention: number | null;
}

export interface Variant {
  id: string;
  label: string;
  preset: PresetId | 'custom';
  options: PatchOptions;
  normalizedAudio: boolean;
  createdAt: string;
  fileName: string;
  size: number;
  applied: string[];
  report: MediaReport;
  checks: VerificationCheck[];
  publications: Publication[];
  servedChecks: ServedReport[];
}

export interface Job {
  id: string;
  originalName: string;
  sourceFileName: string;
  createdAt: string;
  sourceSize: number;
  sourceReport: MediaReport;
  variants: Variant[];
}

export interface CreateVariantRequest {
  preset: PresetId | 'custom';
  options: PatchOptions;
  normalizeAudio: boolean;
  decodeCheck: boolean;
  label?: string;
}

export interface ServedCheckRequest {
  url: string;
  download: boolean;
}

export interface InspectResponse {
  fileName: string;
  report: MediaReport;
  markerFound: boolean;
}
