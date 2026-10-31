import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import type { MultipartFile } from '@fastify/multipart';

import {
  buildPatchPlan,
  inspectFile,
  PATCH_PRESETS,
  primaryVideo,
  verifyMediaIdentical,
  verifyPatchedFile,
  type PatchExpectation,
  type VerificationCheck,
} from '../../mp4/index.js';
import type { CreateVariantRequest, InspectResponse, Job, ServedReport, Variant } from '../../shared/api.js';
import { AppError } from '../errors.js';
import { writePlanToFile } from './assembler.js';
import type { FfmpegService } from './ffmpeg.service.js';
import { withFileSource } from './file-source.js';
import type { JobStore } from './job.store.js';
import type { ServedCheckResult } from './served-quality.service.js';
import { saveUpload, videoContentType, videoExtension } from './uploads.js';

export interface VariantDownload {
  path: string;
  fileName: string;
  contentType: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);

    return true;
  } catch {
    return false;
  }
}

export class JobService {
  private readonly preparing = new Map<string, Promise<string>>();

  constructor(
    private readonly store: JobStore,
    private readonly ffmpeg: FfmpegService,
    private readonly marker: string,
    private readonly tempDir: string,
  ) {}

  async createFromUpload(file: MultipartFile): Promise<Job> {
    const extension = videoExtension(file.filename);
    const id = randomUUID();
    const dir = this.store.jobDir(id);
    const sourceFileName = `source${extension}`;
    const sourcePath = join(dir, sourceFileName);

    await mkdir(dir, { recursive: true });

    try {
      await saveUpload(file, sourcePath);

      const sourceReport = await withFileSource(sourcePath, inspectFile);
      const { size } = await stat(sourcePath);

      return await this.store.create({
        id,
        originalName: file.filename,
        sourceFileName,
        createdAt: new Date().toISOString(),
        sourceSize: size,
        sourceReport,
        variants: [],
      });
    } catch (error) {
      await rm(dir, { recursive: true, force: true });

      throw error;
    }
  }

  async createVariant(jobId: string, request: CreateVariantRequest): Promise<Variant> {
    const job = this.store.require(jobId);
    const inputPath = request.normalizeAudio ? await this.preparedSource(job) : this.store.sourcePath(job);
    const id = randomBytes(5).toString('hex');
    const fileName = `${id}${request.normalizeAudio ? '.mp4' : extname(job.sourceFileName)}`;
    const outputPath = this.store.variantPath(jobId, { fileName });

    await mkdir(dirname(outputPath), { recursive: true });

    try {
      const result = await withFileSource(inputPath, (source) => buildPatchPlan(source, request.options));

      await writePlanToFile(result.plan, inputPath, outputPath);

      const checks = await this.verify(inputPath, outputPath, result.expectation, request.decodeCheck);
      const failed = checks.filter((entry) => !entry.ok);

      if (failed.length) {
        throw new AppError(
          422,
          'verification_failed',
          `The patched file failed ${failed.length} check(s): ${failed.map((entry) => entry.name).join(', ')}.`,
          checks,
        );
      }

      const variant: Variant = {
        id,
        label: request.label || this.defaultLabel(request),
        preset: request.preset,
        options: request.options,
        normalizedAudio: request.normalizeAudio,
        createdAt: new Date().toISOString(),
        fileName,
        size: result.plan.size,
        applied: request.normalizeAudio ? ['Audio normalized to AAC 48 kHz stereo', ...result.applied] : result.applied,
        report: await withFileSource(outputPath, inspectFile),
        checks,
        publications: [],
        servedChecks: [],
      };

      await this.store.update(jobId, (target) => target.variants.push(variant));

      return variant;
    } catch (error) {
      await rm(outputPath, { force: true });

      throw error;
    }
  }

  async deleteVariant(jobId: string, variantId: string): Promise<void> {
    const { variant } = this.store.requireVariant(jobId, variantId);

    await this.store.update(jobId, (job) => {
      job.variants = job.variants.filter((candidate) => candidate.id !== variantId);
    });
    await rm(this.store.variantPath(jobId, variant), { force: true });
  }

  async attachServedCheck(jobId: string, variantId: string, result: ServedCheckResult): Promise<ServedReport> {
    const { job } = this.store.requireVariant(jobId, variantId);
    const sourceBitrateKbps = primaryVideo(job.sourceReport)?.bitrateKbps ?? null;
    const servedBitrateKbps = result.topRung?.bitrateKbps ?? null;
    const report: ServedReport = {
      ...result,
      id: randomBytes(6).toString('hex'),
      sourceBitrateKbps,
      retention: sourceBitrateKbps && servedBitrateKbps ? Math.round((servedBitrateKbps / sourceBitrateKbps) * 1000) / 1000 : null,
    };

    await this.store.update(jobId, (target) => {
      target.variants.find((candidate) => candidate.id === variantId)!.servedChecks.unshift(report);
    });

    return report;
  }

  variantDownload(jobId: string, variantId: string): VariantDownload {
    const { job, variant } = this.store.requireVariant(jobId, variantId);
    const extension = extname(variant.fileName);
    const stem = basename(job.originalName, extname(job.originalName));

    return {
      path: this.store.variantPath(jobId, variant),
      fileName: `${stem}-${variant.preset}-${variant.id}${extension}`,
      contentType: videoContentType(variant.fileName),
    };
  }

  async inspectUpload(file: MultipartFile): Promise<InspectResponse> {
    const extension = videoExtension(file.filename);
    const path = join(this.tempDir, `inspect-${randomUUID()}${extension}`);

    await mkdir(this.tempDir, { recursive: true });

    try {
      await saveUpload(file, path);

      const report = await withFileSource(path, inspectFile);

      return { fileName: file.filename, report, markerFound: report.encoderTag === this.marker };
    } finally {
      await rm(path, { force: true });
    }
  }

  private defaultLabel(request: CreateVariantRequest): string {
    const preset = PATCH_PRESETS.find((candidate) => candidate.id === request.preset);
    const base = preset?.label ?? 'Custom';

    return request.normalizeAudio ? `${base} + audio` : base;
  }

  private async verify(
    inputPath: string,
    outputPath: string,
    expectation: PatchExpectation,
    decodeCheck: boolean,
  ): Promise<VerificationCheck[]> {
    const checks = await withFileSource(outputPath, async (output) => {
      const structural = await verifyPatchedFile(output, expectation);
      const media = await withFileSource(inputPath, (input) => verifyMediaIdentical(input, output, expectation));

      return [...structural, media];
    });

    if (decodeCheck) {
      checks.push(await this.ffmpeg.decodeCheck(outputPath));
    }

    return checks;
  }

  private preparedSource(job: Job): Promise<string> {
    const pending = this.preparing.get(job.id);

    if (pending) {
      return pending;
    }

    const task = this.prepare(job).finally(() => this.preparing.delete(job.id));
    this.preparing.set(job.id, task);

    return task;
  }

  private async prepare(job: Job): Promise<string> {
    const preparedPath = this.store.preparedPath(job.id);

    if (await exists(preparedPath)) {
      return preparedPath;
    }

    const tempPath = `${preparedPath}.part.mp4`;

    try {
      await this.ffmpeg.normalizeAudio(this.store.sourcePath(job), tempPath);
      await rename(tempPath, preparedPath);
    } catch (error) {
      await rm(tempPath, { force: true });

      throw error;
    }

    return preparedPath;
  }
}
