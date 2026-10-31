export { Mp4Error, type Mp4ErrorCode } from './errors.js';
export { inspectFile, primaryVideo, type MediaReport, type TrackReport } from './inspect.js';
export { buildPatchPlan, prepareFile, type PatchExpectation, type PatchResult } from './patch.js';
export { assemblePlanInMemory, fillBytes, type AssemblyPlan, type PlanPart } from './plan.js';
export { MemorySource, type RandomAccessSource } from './source.js';
export {
  describeOptions,
  MAX_JUNK_PATTERN_BYTES,
  MAX_JUNK_TAIL_BYTES,
  PATCH_PRESETS,
  presetOptions,
  type DecoyAudioMode,
  type JunkTailMode,
  type PatchOptions,
  type PatchPreset,
  type PresetId,
} from './techniques.js';
export { verifyMediaIdentical, verifyPatchedFile, type VerificationCheck } from './verify.js';
