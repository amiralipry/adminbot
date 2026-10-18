import { existsSync, unlinkSync } from 'fs';
import { config } from '../config';
import type { ChannelProfile, PlatformResult, PostHistoryItem, MediaGroupItem } from '../types';
import { baleService } from './bale';
import { rubikaService } from './rubika';
import { eitaaService } from './eitaa';
import { statsService } from './stats';
import { mediaOptimizer } from './mediaOptimizer';
import { botDb } from './db';
import { eventBus } from './eventBus';

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

  private constructor() {
    this.history = botDb.getRecentHistory(50);
  }

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
      const isBlacklisted = keywords.some(kw => lower.includes(kw));
      if (isBlacklisted) {
        console.log(`[Dispatcher] Filtered ad line: "${line.slice(0, 50)}..."`);
        continue;
      }

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
      out = out.replace(new RegExp(`https?://t\\.me/${tgClean}\\b`, 'gi'), `https://ble.ir/${baleClean}`);
    } else if (platform === 'rubika' && channel.rubika_id) {
      const rubClean = channel.rubika_id.replace(/^@/, '');
      out = out.replace(new RegExp(`(?:https?://)?(?:t\\.me/|@)${tgClean}\\b`, 'gi'), `@${rubClean}`);
      out = out.replace(new RegExp(`https?://t\\.me/${tgClean}\\b`, 'gi'), `https://rubika.ir/${rubClean}`);
    } else if (platform === 'eitaa' && channel.eitaa_id) {
      const eitaaClean = channel.eitaa_id.replace(/^@/, '');
      out = out.replace(new RegExp(`(?:https?://)?(?:t\\.me/|@)${tgClean}\\b`, 'gi'), `@${eitaaClean}`);
      out = out.replace(new RegExp(`https?://t\\.me/${tgClean}\\b`, 'gi'), `https://eitaa.com/${eitaaClean}`);
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
      bale: baleRes.status === 'fulfilled' ? baleRes.value : { success: false, platform: 'bale', error: String(baleRes.reason) },
      rubika: rubikaRes.status === 'fulfilled' ? rubikaRes.value : { success: false, platform: 'rubika', error: String(rubikaRes.reason) },
      eitaa: eitaaRes.status === 'fulfilled' ? eitaaRes.value : { success: false, platform: 'eitaa', error: String(eitaaRes.reason) }
    };
  }

  private async executeWithRetry(
    platformName: string,
    action: () => Promise<PlatformResult>
  ): Promise<PlatformResult> {
    const maxAttempts = config.settings.auto_retry_enabled ? (config.settings.max_retry_attempts || 3) : 1;
    let lastResult: PlatformResult = { success: false, platform: platformName };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await action();
        result.attempts = attempt;
        if (result.success) {
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
        const waitMs = 2000 * attempt;
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
    filePath?: string;
    fileName?: string;
    caption?: string;
    perPlatformCaptions?: {
      bale?: string;
      rubika?: string;
      eitaa?: string;
    };
    source?: string;
    postId?: string;
    keepTempFile?: boolean;
  }): Promise<Record<string, PlatformResult>> {
    let {
      channel,
      mediaType = 'text',
      rawText = '',
      fileData,
      filePath,
      fileName = 'file',
      caption = '',
      perPlatformCaptions,
      source = 'Telegram',
      postId = 'post',
      keepTempFile = false
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

    // Determine payload source (Stream Bun.file from disk if filePath provided, else fileData in memory)
    const mediaPayload: any = filePath ? Bun.file(filePath) : fileData;

    console.log(`[Dispatcher] Dispatching [${mediaType}] for channel "${channel.title}" (${channel.telegram_id}) via ${filePath ? 'Disk-Stream' : 'Memory'}`);

    const results: Record<string, PlatformResult> = {};
    const promises: Promise<void>[] = [];

    // Caption determination
    const baleCaption = perPlatformCaptions?.bale || this.formatTextForChannel(caption, channel, 'bale');
    const rubikaCaption = perPlatformCaptions?.rubika || this.formatTextForChannel(caption, channel, 'rubika');
    const eitaaCaption = perPlatformCaptions?.eitaa || this.formatTextForChannel(caption, channel, 'eitaa');

    // 1. Bale
    if (baleService.isEnabled() && channel.bale_id) {
      promises.push((async () => {
        results.bale = await this.executeWithRetry('bale', async () => {
          if (mediaType === 'text') {
            const text = perPlatformCaptions?.bale || this.formatTextForChannel(rawText, channel, 'bale');
            return await baleService.sendText(text, channel.bale_id);
          } else if (mediaPayload) {
            return await baleService.sendMedia(mediaType, mediaPayload, fileName, baleCaption, channel.bale_id);
          }
          return { success: false, platform: 'bale', error: 'داده‌ای برای ارسال یافت نشد' };
        });
      })());
    } else {
      results.bale = { success: false, skipped: true, error: 'غیرفعال یا آیدی بله تنظیم نشده' };
    }

    // 2. Rubika
    if (rubikaService.isEnabled() && channel.rubika_id) {
      promises.push((async () => {
        results.rubika = await this.executeWithRetry('rubika', async () => {
          if (mediaType === 'text') {
            const text = perPlatformCaptions?.rubika || this.formatTextForChannel(rawText, channel, 'rubika');
            return await rubikaService.sendText(text, channel.rubika_id);
          } else if (mediaPayload) {
            return await rubikaService.sendMedia(mediaType, mediaPayload, fileName, rubikaCaption, channel.rubika_id);
          }
          return { success: false, platform: 'rubika', error: 'داده‌ای برای ارسال یافت نشد' };
        });
      })());
    } else {
      results.rubika = { success: false, skipped: true, error: 'غیرفعال یا آیدی روبیکا تنظیم نشده' };
    }

    // 3. Eitaa
    if (eitaaService.isEnabled() && channel.eitaa_id && eitaaService.isConfigured()) {
      promises.push((async () => {
        results.eitaa = await this.executeWithRetry('eitaa', async () => {
          if (mediaType === 'text') {
            const text = perPlatformCaptions?.eitaa || this.formatTextForChannel(rawText, channel, 'eitaa');
            return await eitaaService.sendText(text, channel.eitaa_id!);
          } else if (mediaPayload) {
            return await eitaaService.sendMedia(mediaType, mediaPayload, fileName, eitaaCaption, channel.eitaa_id!);
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

    // Check for platform failures: Trigger failure alerts & enqueue to smart retry queue
    let hasFailure = false;
    for (const [plat, res] of Object.entries(results)) {
      if (!res.success && !res.skipped) {
        hasFailure = true;

        // Auto enqueue to Smart Retry Queue if enabled
        if (config.settings.auto_retry_enabled) {
          botDb.enqueueRetry({
            channelId: channel.id,
            platform: plat as any,
            mediaType,
            rawText,
            caption: plat === 'bale' ? baleCaption : (plat === 'rubika' ? rubikaCaption : eitaaCaption),
            filePath,
            fileName,
            lastError: res.error,
            maxAttempts: config.settings.max_retry_attempts || 3
          });
        }

        if (this.onPlatformFailure) {
          try {
            this.onPlatformFailure({
              channel,
              platform: plat,
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

    // Clean up temporary disk file if not needed by retry queue
    if (filePath && !keepTempFile && !hasFailure && existsSync(filePath) && filePath.includes('temp')) {
      try {
        unlinkSync(filePath);
      } catch (err) {
        console.warn(`[Dispatcher] Could not unlink temp file: ${filePath}`);
      }
    }

    // Save to history and broadcast real-time event
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

    botDb.addPostHistory(historyItem);
    this.history.unshift(historyItem);
    if (this.history.length > 60) this.history.pop();

    eventBus.broadcast('post', {
      channelTitle: channel.title,
      mediaType,
      results,
      historyItem
    });

    console.log(`[Dispatcher] Broadcast completed for "${channel.title}":`, results);
    return results;
  }

  /**
   * Broadcast an album / media group sequentially with unified caption
   */
  public async broadcastAlbumForChannel(params: {
    channel: ChannelProfile;
    items: { mediaType: string; filePath?: string; fileName?: string }[];
    caption?: string;
    perPlatformCaptions?: { bale?: string; rubika?: string; eitaa?: string };
    source?: string;
    postId?: string;
  }): Promise<Record<string, PlatformResult>> {
    const { channel, items, caption = '', perPlatformCaptions, source = 'Telegram', postId = 'album' } = params;
    console.log(`[Dispatcher] 📸 Broadcasting Media Group Album (${items.length} items) to "${channel.title}"`);

    const aggregatedResults: Record<string, PlatformResult> = {
      bale: { success: true, platform: 'bale' },
      rubika: { success: true, platform: 'rubika' },
      eitaa: { success: true, platform: 'eitaa' }
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      // Attach caption only to the first item (standard Album behavior)
      const itemCaption = i === 0 ? caption : '';
      const itemPerPlatformCaptions = i === 0 ? perPlatformCaptions : undefined;

      const res = await this.broadcastForChannel({
        channel,
        mediaType: item.mediaType,
        filePath: item.filePath,
        fileName: item.fileName,
        caption: itemCaption,
        perPlatformCaptions: itemPerPlatformCaptions,
        source,
        postId: `${postId}_${i + 1}`
      });

      for (const [p, r] of Object.entries(res)) {
        if (!r.success && !r.skipped) {
          aggregatedResults[p] = r;
        }
      }

      // Small pause between album items to maintain sequence
      if (i < items.length - 1) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    return aggregatedResults;
  }

  public getRecentHistory(limit = 50): PostHistoryItem[] {
    return this.history.slice(0, limit);
  }
}

export const dispatcher = Dispatcher.getInstance();
