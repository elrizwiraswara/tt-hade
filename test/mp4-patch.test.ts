import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assemblePlanInMemory,
  buildPatchPlan,
  inspectFile,
  MemorySource,
  Mp4Error,
  PATCH_PRESETS,
  presetOptions,
  primaryVideo,
  verifyMediaIdentical,
  verifyPatchedFile,
  type PatchOptions,
} from '../src/mp4/index.js';
import { createFixtures, decodesCleanly, ffmpegAvailable, type FixtureSet } from './fixtures.js';

const MARKER = 'tt-hade-test';

async function patch(bytes: Uint8Array, options: PatchOptions) {
  const source = new MemorySource(bytes);
  const result = await buildPatchPlan(source, options);
  const output = assemblePlanInMemory(result.plan, bytes);

  return { result, output, outputSource: new MemorySource(output), source };
}

describe.skipIf(!ffmpegAvailable)('mp4 patching', () => {
  let fixtures: FixtureSet;

  beforeAll(() => {
    fixtures = createFixtures();
  });

  afterAll(() => {
    fixtures?.cleanup();
  });

  it('inspects an ffmpeg export', async () => {
    const report = await inspectFile(new MemorySource(fixtures.h264MoovEnd));
    const video = primaryVideo(report);

    expect(report.headerFirst).toBe(false);
    expect(report.durationUnknown).toBe(false);
    expect(report.encoderTag).toMatch(/^Lavf/);
    expect(video).toMatchObject({ codec: 'avc1', codecName: 'H.264', width: 360, height: 640, fps: 30 });
    expect(report.tracks.find((track) => track.kind === 'audio')).toMatchObject({ codec: 'mp4a', codecName: 'AAC' });
    expect(report.issues).toEqual([]);
  });

  it('tells MP3-in-MP4 apart from AAC', async () => {
    const report = await inspectFile(new MemorySource(fixtures.mp3Audio));

    expect(report.tracks.find((track) => track.kind === 'audio')).toMatchObject({ codec: 'mp4a', codecName: 'MP3' });
    await expect(buildPatchPlan(new MemorySource(fixtures.mp3Audio), presetOptions('full', MARKER))).rejects.toMatchObject({
      code: 'missing_audio',
    });
  });

  const cases = [
    ['h264 with moov at the end', (set: FixtureSet) => set.h264MoovEnd],
    ['h264 with faststart', (set: FixtureSet) => set.h264Faststart],
    ['hevc', (set: FixtureSet) => set.hevc],
  ] as const;

  for (const [label, pick] of cases) {
    for (const preset of PATCH_PRESETS) {
      it(`patches ${label} with the ${preset.id} preset`, async () => {
        const bytes = pick(fixtures);
        const { result, output, outputSource, source } = await patch(bytes, presetOptions(preset.id, MARKER));

        expect(output.length).toBe(result.plan.size);

        const checks = await verifyPatchedFile(outputSource, result.expectation);
        const failed = checks.filter((entry) => !entry.ok);

        expect(failed).toEqual([]);
        expect((await verifyMediaIdentical(source, outputSource, result.expectation)).ok).toBe(true);

        const decoded = decodesCleanly(fixtures.dir, `${preset.id}-${label.replace(/\W+/g, '-')}.mp4`, output);

        expect(decoded.stderr).toBe('');
        expect(decoded.ok).toBe(true);
      });
    }
  }

  it('applies every technique of the full preset', async () => {
    const { output } = await patch(fixtures.h264MoovEnd, presetOptions('full', MARKER));
    const report = await inspectFile(new MemorySource(output));
    const video = primaryVideo(report)!;
    const audioTracks = report.tracks.filter((track) => track.kind === 'audio');

    expect(report.headerFirst).toBe(true);
    expect(report.durationUnknown).toBe(true);
    expect(report.encoderTag).toBe(MARKER);
    expect(report.trailingBytes).toBe(1024 * 1024);
    expect(video).toMatchObject({ width: 0, height: 0, trackWidth: 360, trackHeight: 640 });
    expect(audioTracks).toHaveLength(2);
    expect(audioTracks[1]!.enabled).toBe(false);
    expect(audioTracks[1]!.alternateGroup).toBe(audioTracks[0]!.alternateGroup);
    expect(audioTracks[1]!.alternateGroup).toBeGreaterThan(0);
    expect(audioTracks[1]!.sampleCount).toBe(audioTracks[0]!.sampleCount);
    expect(report.nextTrackId).toBeGreaterThan(Math.max(...report.tracks.map((track) => track.id)));
  });

  it('wraps the junk tail in a free box when asked', async () => {
    const options: PatchOptions = { ...presetOptions('full', MARKER), junkTailMode: 'free-box', junkTailPattern: 'deadbeef' };
    const { output, outputSource, result } = await patch(fixtures.h264Faststart, options);
    const report = await inspectFile(new MemorySource(output));

    expect(report.trailingBytes).toBe(0);
    expect(report.topLevel.at(-1)).toEqual({ type: 'free', size: 8 + 1024 * 1024 });
    expect(Array.from(output.subarray(output.length - 4))).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect((await verifyPatchedFile(outputSource, result.expectation)).every((entry) => entry.ok)).toBe(true);
  });

  it('zeroes the track header size only when asked', async () => {
    const options: PatchOptions = { ...presetOptions('light', MARKER), zeroTrackHeaderSize: true };
    const { output } = await patch(fixtures.h264Faststart, options);

    expect(primaryVideo(await inspectFile(new MemorySource(output)))).toMatchObject({ trackWidth: 0, trackHeight: 0 });
  });

  it('refuses to patch an already patched file', async () => {
    const { output } = await patch(fixtures.h264MoovEnd, presetOptions('light', MARKER));

    await expect(buildPatchPlan(new MemorySource(output), presetOptions('light', MARKER))).rejects.toMatchObject({
      code: 'already_patched',
    });
  });

  it('refuses a file with a junk tail', async () => {
    const { output } = await patch(fixtures.h264MoovEnd, { ...presetOptions('control', MARKER), junkTailBytes: 4096 });

    await expect(buildPatchPlan(new MemorySource(output), presetOptions('control', 'other'))).rejects.toMatchObject({
      code: 'unsupported_layout',
    });
  });

  it('needs an AAC track for the decoy', async () => {
    await expect(buildPatchPlan(new MemorySource(fixtures.noAudio), presetOptions('full', MARKER))).rejects.toBeInstanceOf(
      Mp4Error,
    );
    await expect(buildPatchPlan(new MemorySource(fixtures.noAudio), presetOptions('full', MARKER))).rejects.toMatchObject({
      code: 'missing_audio',
    });
  });

  it('patches a video-only file when no decoy is requested', async () => {
    const { output, outputSource, result } = await patch(fixtures.noAudio, presetOptions('light', MARKER));

    expect((await verifyPatchedFile(outputSource, result.expectation)).every((entry) => entry.ok)).toBe(true);
    expect(decodesCleanly(fixtures.dir, 'no-audio-light.mp4', output).ok).toBe(true);
  });

  it('rejects files that are not MP4', async () => {
    await expect(buildPatchPlan(new MemorySource(new TextEncoder().encode('not a video at all')), presetOptions('light', MARKER))).rejects.toMatchObject({
      code: 'not_mp4',
    });
  });
});
