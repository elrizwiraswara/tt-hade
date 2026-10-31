import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ffmpegAvailable = spawnSync('ffmpeg', ['-version']).status === 0;

export interface FixtureSet {
  dir: string;
  h264MoovEnd: Uint8Array;
  h264Faststart: Uint8Array;
  hevc: Uint8Array;
  noAudio: Uint8Array;
  mp3Audio: Uint8Array;
  cleanup(): void;
}

const BASE_INPUTS = [
  '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-t', '2',
];

function run(args: string[]): void {
  const result = spawnSync('ffmpeg', ['-y', '-v', 'error', ...args], { encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr}`);
  }
}

function encode(dir: string, name: string, args: string[]): Uint8Array {
  const path = join(dir, name);
  run([...args, path]);

  return new Uint8Array(readFileSync(path));
}

export function createFixtures(): FixtureSet {
  const dir = mkdtempSync(join(tmpdir(), 'tt-hade-test-'));
  const h264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest'];

  return {
    dir,
    h264MoovEnd: encode(dir, 'h264-moov-end.mp4', [...BASE_INPUTS, ...h264]),
    h264Faststart: encode(dir, 'h264-faststart.mp4', [...BASE_INPUTS, ...h264, '-movflags', '+faststart']),
    hevc: encode(dir, 'hevc.mp4', [
      ...BASE_INPUTS,
      '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error', '-tag:v', 'hvc1',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    ]),
    noAudio: encode(dir, 'no-audio.mp4', [
      '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-t', '2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    ]),
    mp3Audio: encode(dir, 'mp3-audio.mp4', [
      ...BASE_INPUTS,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-shortest',
    ]),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function decodesCleanly(dir: string, name: string, bytes: Uint8Array): { ok: boolean; stderr: string } {
  const path = join(dir, name);
  writeFileSync(path, bytes);

  const result = spawnSync('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'], { encoding: 'utf8' });

  return { ok: result.status === 0, stderr: result.stderr };
}
