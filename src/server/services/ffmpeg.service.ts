import { spawn } from 'node:child_process';

import type { VerificationCheck } from '../../mp4/index.js';
import { AppError } from '../errors.js';

const PROBE_TIMEOUT_MS = 60_000;
const PROCESS_TIMEOUT_MS = 30 * 60_000;
const MAX_CAPTURED_OUTPUT = 64 * 1024;

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface StreamProbe {
  hasAudio: boolean;
  audioCodec: string | null;
}

const AUDIO_ENCODE_ARGS = [
  '-c:v', 'copy',
  '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '320k',
  '-map_metadata', '-1', '-map_chapters', '-1',
  '-movflags', '+faststart',
];

function runProcess(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-MAX_CAPTURED_OUTPUT);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-MAX_CAPTURED_OUTPUT);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export class FfmpegService {
  private availability: Promise<boolean> | null = null;

  constructor(
    private readonly ffmpegPath: string,
    private readonly ffprobePath: string,
  ) {}

  available(): Promise<boolean> {
    this.availability ??= Promise.all([
      runProcess(this.ffmpegPath, ['-version'], PROBE_TIMEOUT_MS),
      runProcess(this.ffprobePath, ['-version'], PROBE_TIMEOUT_MS),
    ])
      .then((results) => results.every((result) => result.code === 0))
      .catch(() => false);

    return this.availability;
  }

  private async requireAvailable(): Promise<void> {
    if (!(await this.available())) {
      throw new AppError(503, 'ffmpeg_unavailable', 'ffmpeg and ffprobe are required for this step but were not found.');
    }
  }

  async probeAudio(path: string): Promise<StreamProbe> {
    await this.requireAvailable();

    const result = await runProcess(
      this.ffprobePath,
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'json', path],
      PROBE_TIMEOUT_MS,
    );

    if (result.code !== 0) {
      throw new AppError(422, 'probe_failed', `ffprobe could not read the file: ${result.stderr.trim()}`);
    }

    const streams = (JSON.parse(result.stdout) as { streams?: { codec_name?: string }[] }).streams ?? [];

    return { hasAudio: streams.length > 0, audioCodec: streams[0]?.codec_name ?? null };
  }

  async normalizeAudio(inputPath: string, outputPath: string): Promise<void> {
    const { hasAudio } = await this.probeAudio(inputPath);
    const args = hasAudio
      ? ['-y', '-v', 'error', '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0', ...AUDIO_ENCODE_ARGS, outputPath]
      : [
          '-y', '-v', 'error', '-i', inputPath,
          '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
          '-map', '0:v:0', '-map', '1:a:0', '-shortest', ...AUDIO_ENCODE_ARGS, outputPath,
        ];

    const result = await runProcess(this.ffmpegPath, args, PROCESS_TIMEOUT_MS);

    if (result.code !== 0) {
      throw new AppError(422, 'audio_normalization_failed', `ffmpeg could not prepare the audio: ${result.stderr.trim()}`);
    }
  }

  async decodeCheck(path: string): Promise<VerificationCheck> {
    await this.requireAvailable();

    const result = await runProcess(
      this.ffmpegPath,
      ['-v', 'error', '-xerror', '-i', path, '-map', '0:v:0', '-f', 'null', '-'],
      PROCESS_TIMEOUT_MS,
    );
    const errors = result.stderr.trim();

    return {
      name: 'Full decode',
      ok: result.code === 0 && errors === '',
      detail: result.code === 0 && errors === '' ? 'ffmpeg decoded every video frame without errors.' : errors || `ffmpeg exited with ${result.code}.`,
    };
  }
}
