import { z } from 'zod';

import { MAX_JUNK_TAIL_BYTES } from '../mp4/index.js';

export const patchOptionsSchema = z.object({
  faststart: z.boolean(),
  unknownMovieDuration: z.boolean(),
  zeroSampleEntrySize: z.boolean(),
  zeroTrackHeaderSize: z.boolean(),
  decoyAudio: z.enum(['off', 'disabled', 'enabled']),
  encoderTag: z.string().trim().min(1).max(100).nullable(),
  junkTailBytes: z.number().int().min(0).max(MAX_JUNK_TAIL_BYTES),
  junkTailMode: z.enum(['raw', 'free-box']),
  junkTailPattern: z.string().regex(/^(?:[0-9a-fA-F]{2}){1,64}$/, 'Use 1 to 64 bytes of hex, e.g. "00" or "deadbeef".'),
});

export const createVariantSchema = z.object({
  preset: z.enum(['control', 'light', 'full', 'custom']),
  options: patchOptionsSchema,
  normalizeAudio: z.boolean(),
  decodeCheck: z.boolean(),
  label: z.string().trim().max(80).optional(),
});

export const privacyLevelSchema = z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']);

export const publishSchema = z.object({
  openId: z.string().min(1),
  mode: z.enum(['direct', 'inbox']),
  title: z.string().max(2200).optional(),
  privacyLevel: privacyLevelSchema.optional(),
  disableComment: z.boolean().optional(),
  disableDuet: z.boolean().optional(),
  disableStitch: z.boolean().optional(),
  brandContentToggle: z.boolean().optional(),
  brandOrganicToggle: z.boolean().optional(),
  isAigc: z.boolean().optional(),
});

export const servedCheckSchema = z.object({
  url: z.string().trim().url(),
  download: z.boolean().default(true),
});

export const jobParamsSchema = z.object({ jobId: z.string().uuid() });

export const variantParamsSchema = jobParamsSchema.extend({ variantId: z.string().regex(/^[0-9a-f]{10}$/) });

export const publicationParamsSchema = variantParamsSchema.extend({ publicationId: z.string().min(1) });

export const accountParamsSchema = z.object({ openId: z.string().min(1) });
