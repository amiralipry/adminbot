import { existsSync, unlinkSync } from 'fs';
import { botDb } from './db';
import { config } from '../config';
import { baleService } from './bale';
import { rubikaService } from './rubika';
import { eitaaService } from './eitaa';
import { statsService } from './stats';
import { eventBus } from './eventBus';
import type { PlatformResult, RetryJob } from '../types';

export class RetryQueueService {
  private static instance: RetryQueueService;
  private timer: any = null;
  private isProcessing = false;

  private constructor() {}

  public static getInstance(): RetryQueueService {
    if (!RetryQueueService.instance) {
      RetryQueueService.instance = new RetryQueueService();
    }
    return RetryQueueService.instance;
  }

  public start(): void {
    if (this.timer) return;
    console.log('[RetryQueue] Smart Retry Queue worker started (Interval: 15s)');
    this.timer = setInterval(() => this.processQueue(), 15000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing || !config.settings.auto_retry_enabled) return;
    this.isProcessing = true;

    try {
      const pendingJobs = botDb.getPendingRetries();
      if (pendingJobs.length === 0) {
        this.isProcessing = false;
        return;
      }

      console.log(`[RetryQueue] Processing ${pendingJobs.length} retry job(s)...`);

      for (const job of pendingJobs) {
        await this.executeJob(job);
      }
    } catch (err) {
      console.error('[RetryQueue] Error in queue processing loop:', err);
    } finally {
      this.isProcessing = false;
    }
  }

  public async executeJob(job: RetryJob): Promise<boolean> {
    const channel = config.settings.channels.find(c => c.id === job.channel_id);
    if (!channel) {
      console.warn(`[RetryQueue] Channel "${job.channel_id}" no longer exists. Failing job #${job.id}`);
      botDb.failRetryJob(job.id, 'کانال مربوطه در تنظیمات یافت نشد.');
      return false;
    }

    const currentAttempt = job.attempts + 1;
    console.log(`[RetryQueue] Retrying job #${job.id} for [${job.platform}] on "${channel.title}" (Attempt ${currentAttempt}/${job.max_attempts})`);

    let result: PlatformResult = { success: false, platform: job.platform };

    try {
      if (job.platform === 'bale' && channel.bale_id) {
        if (job.media_type === 'text') {
          result = await baleService.sendText(job.raw_text || '', channel.bale_id);
        } else if (job.file_path && existsSync(job.file_path)) {
          result = await baleService.sendMedia(job.media_type, Bun.file(job.file_path), job.file_name || 'file', job.caption, channel.bale_id);
        } else {
          result = { success: false, platform: 'bale', error: 'فایل مدیا برای ارسال مجدد در دیسک یافت نشد.' };
        }
      } else if (job.platform === 'rubika' && channel.rubika_id) {
        if (job.media_type === 'text') {
          result = await rubikaService.sendText(job.raw_text || '', channel.rubika_id);
        } else if (job.file_path && existsSync(job.file_path)) {
          result = await rubikaService.sendMedia(job.media_type, Bun.file(job.file_path), job.file_name || 'file', job.caption, channel.rubika_id);
        } else {
          result = { success: false, platform: 'rubika', error: 'فایل مدیا برای ارسال مجدد در دیسک یافت نشد.' };
        }
      } else if (job.platform === 'eitaa' && channel.eitaa_id) {
        if (job.media_type === 'text') {
          result = await eitaaService.sendText(job.raw_text || '', channel.eitaa_id);
        } else if (job.file_path && existsSync(job.file_path)) {
          result = await eitaaService.sendMedia(job.media_type, Bun.file(job.file_path), job.file_name || 'file', job.caption, channel.eitaa_id);
        } else {
          result = { success: false, platform: 'eitaa', error: 'فایل مدیا برای ارسال مجدد در دیسک یافت نشد.' };
        }
      } else {
        result = { success: false, platform: job.platform, error: `شناسه کانال در ${job.platform} تعریف نشده است.` };
      }
    } catch (err: any) {
      result = { success: false, platform: job.platform, error: err.message || String(err) };
    }

    if (result.success) {
      console.log(`[RetryQueue] ✅ Job #${job.id} succeeded on attempt ${currentAttempt}!`);
      botDb.completeRetryJob(job.id);
      if (job.file_path && existsSync(job.file_path) && job.file_path.includes('temp')) {
        try { unlinkSync(job.file_path); } catch {}
      }
      statsService.recordPlatformResults({
        channel,
        mediaType: job.media_type,
        results: { [job.platform]: result }
      });
      eventBus.broadcast('retry', { jobId: job.id, status: 'completed', platform: job.platform, channel: channel.title });
      return true;
    } else {
      console.warn(`[RetryQueue] ❌ Job #${job.id} failed on attempt ${currentAttempt}: ${result.error || 'خطای نامشخص'}`);
      if (currentAttempt >= job.max_attempts) {
        botDb.failRetryJob(job.id, result.error || 'حداکثر تلاش‌ها انجام شد اما ارسال ناموفق بود.');
        if (job.file_path && existsSync(job.file_path) && job.file_path.includes('temp')) {
          try { unlinkSync(job.file_path); } catch {}
        }
        eventBus.broadcast('retry', { jobId: job.id, status: 'failed', platform: job.platform, error: result.error });
      } else {
        // Exponential backoff: 30s, 90s, 270s...
        const delaySeconds = Math.round(30 * Math.pow(2.5, currentAttempt - 1));
        const nextDate = new Date(Date.now() + delaySeconds * 1000).toISOString();
        botDb.updateRetryJob(job.id, currentAttempt, nextDate, result.error || 'خطای موقت در ارسال');
        eventBus.broadcast('retry', { jobId: job.id, status: 'pending', attempt: currentAttempt, nextRetryAt: nextDate });
      }
      return false;
    }
  }

  public async retryManually(jobId: number): Promise<boolean> {
    const jobs = botDb.getPendingRetries();
    const job = jobs.find(j => j.id === jobId);
    if (!job) return false;
    return await this.executeJob(job);
  }
}

export const retryQueue = RetryQueueService.getInstance();
