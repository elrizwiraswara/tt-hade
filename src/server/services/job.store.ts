import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { Job, Variant } from '../../shared/api.js';
import { notFound } from '../errors.js';
import { readJsonFile, SerialQueue, writeJsonFile } from './json-file.js';

const JOB_FILE = 'job.json';

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly queues = new Map<string, SerialQueue>();

  constructor(private readonly root: string) {}

  async load(): Promise<void> {
    await mkdir(this.root, { recursive: true });

    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const job = await readJsonFile<Job | null>(join(this.root, entry.name, JOB_FILE), null);

      if (job) {
        this.jobs.set(job.id, job);
      }
    }
  }

  jobDir(jobId: string): string {
    return join(this.root, jobId);
  }

  sourcePath(job: Job): string {
    return join(this.jobDir(job.id), job.sourceFileName);
  }

  preparedPath(jobId: string): string {
    return join(this.jobDir(jobId), 'prepared.mp4');
  }

  variantPath(jobId: string, variant: Pick<Variant, 'fileName'>): string {
    return join(this.jobDir(jobId), 'variants', variant.fileName);
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  require(jobId: string): Job {
    const job = this.jobs.get(jobId);

    if (!job) {
      throw notFound('Job');
    }

    return job;
  }

  requireVariant(jobId: string, variantId: string): { job: Job; variant: Variant } {
    const job = this.require(jobId);
    const variant = job.variants.find((candidate) => candidate.id === variantId);

    if (!variant) {
      throw notFound('Variant');
    }

    return { job, variant };
  }

  async create(job: Job): Promise<Job> {
    this.jobs.set(job.id, job);
    await this.persist(job.id);

    return job;
  }

  async update(jobId: string, mutate: (job: Job) => void): Promise<Job> {
    const job = this.require(jobId);
    mutate(job);
    await this.persist(jobId);

    return job;
  }

  async remove(jobId: string): Promise<void> {
    this.require(jobId);
    this.jobs.delete(jobId);

    await this.queueFor(jobId).run(() => rm(this.jobDir(jobId), { recursive: true, force: true }));
    this.queues.delete(jobId);
  }

  private persist(jobId: string): Promise<void> {
    return this.queueFor(jobId).run(async () => {
      const job = this.jobs.get(jobId);

      if (job) {
        await writeJsonFile(join(this.jobDir(jobId), JOB_FILE), job);
      }
    });
  }

  private queueFor(jobId: string): SerialQueue {
    let queue = this.queues.get(jobId);

    if (!queue) {
      queue = new SerialQueue();
      this.queues.set(jobId, queue);
    }

    return queue;
  }
}
