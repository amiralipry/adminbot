import { config } from '../config';
import type { ChannelProfile, PlatformResult, PostHistoryItem } from '../types';
import { baleService } from './bale';
import { rubikaService } from './rubika';
import { eitaaService } from './eitaa';
import { statsService } from './stats';
import { mediaOptimizer } from './mediaOptimizer';

export interface FailureAlertInfo {
  channel: ChannelProfile;
  platform: string;
  error: string;
  mediaType: string;
  source: string;
  attempts: number;
}

export class Dispatcher {
  private static instance: Dispatcher;
  private history: PostHistoryItem[] = [];
  public onPlatformFailure?: (info: FailureAlertInfo) => void;

  private constructor() {}

  public static getInstance(): Dispatcher {
    if (!Dispatcher.instance) {
      Dispatcher.instance = new Dispatcher();
    }
    return Dispatcher.instance;
  }

  public cleanAdContent(text: string): string {
    if (!text || !config.settings.ad_filter_enabled) return text;

    const keywords = (config.settings.blacklist_keywords || []).map(k => k.trim().toLowerCase()).filter(Boolean);
    const lines = text.split('\n');
    const filteredLines: string[] = [];

    for (const line of lines) {
      const lower = line.toLowerCase();
      // Check if line contains any blacklist keyword
      const isBlacklisted = keywords.some(kw => lower.includes(kw));
      if (isBlacklisted) {
        console.log(`[Dispatcher] Filtered ad line: "${line.slice(0, 50)}..."`);
        continue;
      }

      // Filter standalone generic join/invite links if not belonging to Sikaap channels
      let cleanLine = line;
      if (cleanLine.includes('t.me/+') || cleanLine.includes('t.me/joinchat')) {
        console.log(`[Dispatcher] Filtered invite link: "${cleanLine.slice(0, 50)}..."`);
        continue;
      }

      filteredLines.push(cleanLine);
    }

    return filteredLines.join('\n').trim();
  }

  public formatTextForChannel(text: string | undefined, channel: ChannelProfile, platform: 'bale' | 'rubika' | 'eitaa'): string {
    if (!text) return '';

    // 1. Clean ads and unwanted keywords
    let out = this.cleanAdContent(text);

    // 2. Replace Telegram handles with destination handles
    const tgClean = channel.telegram_id.replace(/^@/, '');

    if (platform === 'bale' && channel.bale_id) {
      const baleClean = channel.bale_id.replace(/^@/, '');
      out = out.replace(new RegExp(`(?:https?://)?(?:t\\.me/|@)${tgClean}\\b`, 'gi'), `@${baleClean}`);
    } else if (platform === 'rubika' && channel.rubika_id) {
      const rubClean = channel.rubika_id.replace(/^@/, '');
      out = out.replace(new RegExp(`(?:https?://)?(?:t\\.me/|@)${tgClean}\\b`, 'gi'), `@${rubClean}`);
    } else if (platform === 'eitaa' && channel.eitaa_id) {
      const eitaaClean = channel.eitaa_id.replace(/^@/, '');
      out = out.replace(new RegExp(`(?:https?://)?(?:t\\.me/|@)${tgClean}\\b`, 'gi'), `@${eitaaClean}`);
    }

    if (config.settings.remove_telegram_links) {
      out = out.replace(/https?:\/\/t\.me\/[a-zA-Z0-9_+/]+/g, '');
    }

    // 3. Add platform footer if configured
    let footer = '';
    if (platform === 'bale' && channel.bale_footer) footer = channel.bale_footer;
    else if (platform === 'rubika' && channel.rubika_footer) footer = channel.rubika_footer;
    else if (platform === 'eitaa' && channel.eitaa_footer) footer = channel.eitaa_footer;

    if (footer) {
      out = `${out.trim()}\n\n${footer.trim()}`;
    }

    return out.trim();
  }

  public async testAllConnections(): Promise<Record<string, PlatformResult>> {
    const [baleRes, rubikaRes, eitaaRes] = await Promise.allSettled([
      baleService.testConnection(),
      rubikaService.testConnection(),
      eitaaService.testConnection()
    ]);

    return {
      bale: baleRes.status === 'fulfilled' ? baleRes.value : { success: false, error: String(baleRes.reason) },
      rubika: rubikaRes.status === 'fulfilled' ? rubikaRes.value : { success: false, error: String(rubikaRes.reason) },
      eitaa: eitaaRes.status === 'fulfilled' ? eitaaRes.value : { success: false, error: String(eitaaRes.reason) }
    };
  }

  private async executeWithRetry(
    platformName: string,
    action: () => Promise<PlatformResult>
  ): Promise<PlatformResult> {
    const maxAttempts = config.settings.auto_retry_enabled ? (config.settings.max_retry_attempts || 3) : 1;
    let lastResult: PlatformResult = { success: false, platform: platformName, error: 'تلاش انجام نشد' };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await action();
        result.attempts = attempt;
        if (result.success) {
          if (attempt > 1) {
            console.log(`[Dispatcher] [${platformName}] Succeeded on retry attempt ${attempt}/${maxAttempts}!`);
          }
          return result;
        }

        lastResult = result;
        console.warn(`[Dispatcher] [${platformName}] Attempt ${attempt}/${maxAttempts} failed: ${result.error}`);
      } catch (err: any) {
        lastResult = {
          success: false,
          platform: platformName,
          error: err.message || String(err),
          attempts: attempt
        };
        console.warn(`[Dispatcher] [${platformName}] Attempt ${attempt}/${maxAttempts} exception: ${err.message}`);
      }

      if (attempt < maxAttempts) {
        const waitMs = 2500 * attempt;
        console.log(`[Dispatcher] [${platformName}] Waiting ${waitMs}ms before retry...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }

    return lastResult;
  }

  public async broadcastForChannel(params: {
    channel: ChannelProfile;
    mediaType?: string;
    rawText?: string;
    fileData?: Blob | Uint8Array | ArrayBuffer;
    fileName?: string;
    caption?: string;
    source?: string;
    postId?: string;
  }): Promise<Record<string, PlatformResult>> {
    let {
      channel,
      mediaType = 'text',
      rawText = '',
      fileData,
      fileName = 'file',
      caption = '',
      source = 'Telegram',
      postId = 'post'
    } = params;

    if (config.settings.is_paused) {
      console.log(`[Dispatcher] Broadcast skipped: System is globally paused.`);
      const skippedRes = {
        bale: { success: false, skipped: true, error: 'سیستم موقتاً متوقف شده است (Pause).' },
        rubika: { success: false, skipped: true, error: 'سیستم موقتاً متوقف شده است (Pause).' }
      };
      statsService.recordPlatformResults({ channel, mediaType, results: skippedRes });
      return skippedRes;
    }

    if (!channel.is_active) {
      console.log(`[Dispatcher] Broadcast skipped: Channel "${channel.title}" is paused.`);
      const skippedRes = {
        bale: { success: false, skipped: true, error: `کانال ${channel.title} غیرفعال است.` },
        rubika: { success: false, skipped: true, error: `کانال ${channel.title} غیرفعال است.` }
      };
      statsService.recordPlatformResults({ channel, mediaType, results: skippedRes });
      return skippedRes;
    }

    // 0. Video Compression & Optimization if needed (> 50MB)
    if (mediaType === 'video' && fileData) {
      try {
        const opt = await mediaOptimizer.optimizeVideo(fileData, fileName);
        fileData = opt.data;
        fileName = opt.fileName;
        if (opt.warning) {
          console.warn(`[Dispatcher] Video warning for "${channel.title}": ${opt.warning}`);
        }
      } catch (err) {
        console.error('[Dispatcher] Error during video optimization:', err);
      }
    }

    console.log(`[Dispatcher] Dispatching [${mediaType}] for channel "${channel.title}" (${channel.telegram_id})`);

    const results: Record<string, PlatformResult> = {};
    const promises: Promise<void>[] = [];

    // 1. Bale with smart queue retry
    if (baleService.isEnabled() && channel.bale_id) {
      promises.push((async () => {
        results.bale = await this.executeWithRetry('bale', async () => {
          if (mediaType === 'text') {
            const text = this.formatTextForChannel(rawText, channel, 'bale');
            return await baleService.sendText(text, channel.bale_id);
          } else if (fileData) {
            const cap = this.formatTextForChannel(caption, channel, 'bale');
            return await baleService.sendMedia(mediaType, fileData, fileName, cap, channel.bale_id);
          }
          return { success: false, platform: 'bale', error: 'داده‌ای برای ارسال یافت نشد' };
        });
      })());
    } else {
      results.bale = { success: false, skipped: true, error: 'غیرفعال یا آیدی بله تنظیم نشده' };
    }

    // 2. Rubika with smart queue retry
    if (rubikaService.isEnabled() && channel.rubika_id) {
      promises.push((async () => {
        results.rubika = await this.executeWithRetry('rubika', async () => {
          if (mediaType === 'text') {
            const text = this.formatTextForChannel(rawText, channel, 'rubika');
            return await rubikaService.sendText(text, channel.rubika_id);
          } else if (fileData) {
            const cap = this.formatTextForChannel(caption, channel, 'rubika');
            return await rubikaService.sendMedia(mediaType, fileData, fileName, cap, channel.rubika_id);
          }
          return { success: false, platform: 'rubika', error: 'داده‌ای برای ارسال یافت نشد' };
        });
      })());
    } else {
      results.rubika = { success: false, skipped: true, error: 'غیرفعال یا آیدی روبیکا تنظیم نشده' };
    }

    // 3. Eitaa with smart queue retry
    if (eitaaService.isEnabled() && channel.eitaa_id && eitaaService.isConfigured()) {
      promises.push((async () => {
        results.eitaa = await this.executeWithRetry('eitaa', async () => {
          if (mediaType === 'text') {
            const text = this.formatTextForChannel(rawText, channel, 'eitaa');
            return await eitaaService.sendText(text, channel.eitaa_id!);
          } else if (fileData) {
            const cap = this.formatTextForChannel(caption, channel, 'eitaa');
            return await eitaaService.sendMedia(mediaType, fileData, fileName, cap, channel.eitaa_id!);
          }
          return { success: false, platform: 'eitaa', error: 'داده‌ای برای ارسال یافت نشد' };
        });
      })());
    } else {
      results.eitaa = { success: false, skipped: true, error: 'غیرفعال یا توکن ایتا تنظیم نشده' };
    }

    await Promise.allSettled(promises);

    // Record to daily statistics
    statsService.recordPlatformResults({
      channel,
      mediaType,
      results
    });

    // Check for platform failures and trigger instant failure alert
    for (const [platform, res] of Object.entries(results)) {
      if (!res.success && !res.skipped) {
        if (this.onPlatformFailure) {
          try {
            this.onPlatformFailure({
              channel,
              platform,
              error: res.error || 'خطای نامشخص در ارسال',
              mediaType,
              source,
              attempts: res.attempts || 1
            });
          } catch (err) {
            console.error('[Dispatcher] Error triggering failure alert callback:', err);
          }
        }
      }
    }

    // Save to history
    const preview = mediaType === 'text' ? rawText : (caption || `[${mediaType.toUpperCase()}]`);
    const historyItem: PostHistoryItem = {
      post_id: postId,
      source,
      channel_name: channel.title,
      media_type: mediaType,
      content_preview: preview.slice(0, 100),
      timestamp: new Date().toLocaleString('fa-IR'),
      results
    };

    this.history.unshift(historyItem);
    if (this.history.length > 60) {
      this.history.pop();
    }

    console.log(`[Dispatcher] Broadcast completed for "${channel.title}":`, results);
    return results;
  }

  public getRecentHistory(limit = 50): PostHistoryItem[] {
    return this.history.slice(0, limit);
  }
}

export const dispatcher = Dispatcher.getInstance();
