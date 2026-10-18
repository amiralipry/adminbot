import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { config } from '../config';
import type { ChannelProfile, PlatformResult, DayStatsRecord, ChannelDayStats, ChannelStreak } from '../types';

const BASE_DIR = process.cwd();
const DATA_DIR = join(BASE_DIR, 'data');
const STATS_FILE = join(DATA_DIR, 'daily_stats.json');

export interface StorageSchema {
  streaks: Record<string, ChannelStreak>;
  days: Record<string, DayStatsRecord>;
}

export function formatConsecutiveDaysFa(days: number): string {
  if (days <= 0) return '';
  if (days === 1) return 'روز اول بدون محتوا';
  const ordinals: Record<number, string> = {
    2: 'دوم',
    3: 'سوم',
    4: 'چهارم',
    5: 'پنجم',
    6: 'ششم',
    7: 'هفتم',
    8: 'هشتم',
    9: 'نهم',
    10: 'دهم'
  };
  const ord = ordinals[days] || `${days}ام`;
  return `روز ${ord} متوالی بدون محتوا`;
}

function getDaysDifference(olderDateStr: string, newerDateStr: string): number {
  try {
    const d1 = new Date(olderDateStr + 'T00:00:00Z').getTime();
    const d2 = new Date(newerDateStr + 'T00:00:00Z').getTime();
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    return diff >= 0 ? diff : 0;
  } catch {
    return 1;
  }
}

export class StatsManager {
  private static instance: StatsManager;
  private data: StorageSchema = {
    streaks: {},
    days: {}
  };

  private constructor() {
    this.ensureDataDir();
    this.load();
  }

  public static getInstance(): StatsManager {
    if (!StatsManager.instance) {
      StatsManager.instance = new StatsManager();
    }
    return StatsManager.instance;
  }

  private ensureDataDir(): void {
    if (!existsSync(DATA_DIR)) {
      try {
        mkdirSync(DATA_DIR, { recursive: true });
      } catch (err) {
        console.error('[Stats] Error creating data directory:', err);
      }
    }
  }

  public getTehranInfo(dateObj: Date = new Date()): { dateKey: string; jalaliDate: string; timeStr: string } {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tehran',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const dateKey = formatter.format(dateObj); // "2026-10-02"

      const jalaliDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        timeZone: 'Asia/Tehran',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(dateObj);

      const timeStr = new Intl.DateTimeFormat('fa-IR', {
        timeZone: 'Asia/Tehran',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(dateObj);

      return { dateKey, jalaliDate, timeStr };
    } catch {
      const fallbackKey = dateObj.toISOString().slice(0, 10);
      return { dateKey: fallbackKey, jalaliDate: fallbackKey, timeStr: '19:00' };
    }
  }

  private load(): void {
    if (existsSync(STATS_FILE)) {
      try {
        const raw = readFileSync(STATS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.days) {
          this.data = parsed;
        } else {
          // Backward compatibility if root was Record<string, DayStatsRecord>
          this.data = {
            streaks: {},
            days: parsed
          };
        }
      } catch (err) {
        console.error('[Stats] Error reading daily_stats.json:', err);
        this.data = { streaks: {}, days: {} };
      }
    }
  }

  private save(): void {
    try {
      this.ensureDataDir();
      writeFileSync(STATS_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Stats] Error saving daily_stats.json:', err);
    }
  }

  public getDayStats(dateKey?: string): DayStatsRecord {
    const { dateKey: todayKey, jalaliDate } = this.getTehranInfo();
    const key = dateKey || todayKey;

    if (!this.data.days[key]) {
      this.data.days[key] = {
        date: key,
        jalali_date: jalaliDate,
        total_posts: 0,
        channels: {}
      };
    }

    // Ensure all configured channels are initialized
    for (const ch of config.settings.channels) {
      if (!this.data.days[key].channels[ch.id]) {
        this.data.days[key].channels[ch.id] = {
          channel_id: ch.id,
          channel_title: ch.title,
          telegram_id: ch.telegram_id,
          total_posts: 0,
          platforms: {
            bale: { success: 0, failed: 0, skipped: 0 },
            rubika: { success: 0, failed: 0, skipped: 0 },
            eitaa: { success: 0, failed: 0, skipped: 0 }
          },
          media_types: {},
          consecutive_empty_days: 0
        };
      }
    }

    return this.data.days[key];
  }

  /**
   * Registers that a post was published in the Telegram channel today.
   * This is called IMMEDIATELY when Telegram sends a channel_post,
   * guaranteeing that the channel is marked as having published content
   * even if cross-posting to other platforms subsequently fails or is skipped.
   */
  public recordChannelPost(params: {
    channel: ChannelProfile;
    mediaType?: string;
    postId?: string;
  }): void {
    const { channel, mediaType = 'text' } = params;
    const { dateKey, jalaliDate } = this.getTehranInfo();

    const dayRecord = this.getDayStats(dateKey);
    dayRecord.jalali_date = jalaliDate;

    let chStats = dayRecord.channels[channel.id];
    if (!chStats) {
      chStats = {
        channel_id: channel.id,
        channel_title: channel.title,
        telegram_id: channel.telegram_id,
        total_posts: 0,
        platforms: {
          bale: { success: 0, failed: 0, skipped: 0 },
          rubika: { success: 0, failed: 0, skipped: 0 },
          eitaa: { success: 0, failed: 0, skipped: 0 }
        },
        media_types: {},
        consecutive_empty_days: 0
      };
      dayRecord.channels[channel.id] = chStats;
    }

    chStats.total_posts += 1;
    dayRecord.total_posts += 1;
    chStats.media_types[mediaType] = (chStats.media_types[mediaType] || 0) + 1;
    chStats.consecutive_empty_days = 0;

    // Reset inactive streak
    this.data.streaks[channel.id] = {
      channel_id: channel.id,
      last_active_date: dateKey,
      consecutive_inactive_days: 0
    };

    this.save();
    console.log(`[Stats] Content published on Telegram channel "${channel.title}". Today's posts: ${chStats.total_posts}`);
  }

  /**
   * Updates platform dispatch results (Bale, Rubika, Eitaa) after broadcast.
   */
  public recordPlatformResults(params: {
    channel: ChannelProfile;
    mediaType?: string;
    results: Record<string, PlatformResult>;
  }): void {
    const { channel, results } = params;
    const { dateKey } = this.getTehranInfo();

    const dayRecord = this.getDayStats(dateKey);
    const chStats = dayRecord.channels[channel.id];
    if (!chStats) return;

    if (results.bale) {
      if (results.bale.skipped) chStats.platforms.bale.skipped += 1;
      else if (results.bale.success) chStats.platforms.bale.success += 1;
      else {
        chStats.platforms.bale.failed += 1;
        chStats.platforms.bale.last_error = results.bale.error;
      }
    }

    if (results.rubika) {
      if (results.rubika.skipped) chStats.platforms.rubika.skipped += 1;
      else if (results.rubika.success) chStats.platforms.rubika.success += 1;
      else {
        chStats.platforms.rubika.failed += 1;
        chStats.platforms.rubika.last_error = results.rubika.error;
      }
    }

    if (results.eitaa) {
      if (results.eitaa.skipped) chStats.platforms.eitaa.skipped += 1;
      else if (results.eitaa.success) chStats.platforms.eitaa.success += 1;
      else {
        chStats.platforms.eitaa.failed += 1;
        chStats.platforms.eitaa.last_error = results.eitaa.error;
      }
    }

    this.save();
  }

  /**
   * Backwards-compatible broadcast recorder (combines post recording & platform results)
   */
  public recordBroadcast(params: {
    channel: ChannelProfile;
    mediaType?: string;
    results: Record<string, PlatformResult>;
  }): void {
    const { channel, mediaType = 'text', results } = params;
    const { dateKey } = this.getTehranInfo();
    const dayRecord = this.getDayStats(dateKey);
    const chStats = dayRecord.channels[channel.id];

    // If channel post wasn't already recorded, record it now
    if (!chStats || chStats.total_posts === 0) {
      this.recordChannelPost({ channel, mediaType });
    }

    this.recordPlatformResults({ channel, mediaType, results });
  }

  /**
   * Computes consecutive inactive days for a channel today.
   */
  public getConsecutiveInactiveDays(channelId: string, todayKey: string): number {
    const streak = this.data.streaks[channelId];
    if (!streak || !streak.last_active_date) {
      // If we don't have a recorded active date yet, look through existing day records
      let daysCount = 1;
      const sortedDays = Object.keys(this.data.days).sort().reverse();
      for (const d of sortedDays) {
        if (d >= todayKey) continue;
        const rec = this.data.days[d]?.channels[channelId];
        if (rec && rec.total_posts > 0) {
          return getDaysDifference(d, todayKey);
        }
        daysCount += 1;
      }
      return Math.min(daysCount, 2); // Default to at least 1 or 2 if previous day was also empty
    }

    if (streak.last_active_date === todayKey) {
      return 0; // Active today!
    }

    const diff = getDaysDifference(streak.last_active_date, todayKey);
    return Math.max(diff, 1);
  }

  /**
   * Checks if bot has access to a Telegram channel and whether posts exist today
   * (Even if the bot was offline, inspecting public web preview `t.me/s/...` for posts published today).
   */
  public async checkTelegramChannelStatus(channel: ChannelProfile, todayKey: string): Promise<{ accessible: boolean; hasPost: boolean }> {
    const tgBot = (await import('../bot/telegram')).telegramBot.bot;
    let accessible = false;

    if (tgBot) {
      try {
        const chat = await tgBot.api.getChat(channel.telegram_id);
        if (chat) {
          accessible = true;
        }
      } catch (err: any) {
        // Chat not accessible via bot API directly
      }
    }

    const dayStats = this.getDayStats(todayKey);
    const stats = dayStats.channels[channel.id];
    let hasPost = (stats ? stats.total_posts : 0) > 0;

    // If bot was offline or hasn't recorded a post today yet, check public channel feed!
    if (!hasPost && channel.telegram_id && !channel.telegram_id.startsWith('-')) {
      const handle = channel.telegram_id.replace(/^@/, '').trim();
      if (handle) {
        try {
          const res = await fetch(`https://t.me/s/${handle}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            signal: AbortSignal.timeout(6000)
          });

          if (res.ok) {
            accessible = true; // Confirmed accessible
            const html = await res.text();
            // Find all datetime="..." in page
            const matches = [...html.matchAll(/datetime="([^"]+)"/g)];
            for (const m of matches) {
              const dtIso = m[1]; // e.g. "2026-10-13T11:30:48+00:00"
              if (!dtIso) continue;
              const postDate = new Date(dtIso);
              if (!isNaN(postDate.getTime())) {
                const { dateKey: postDateKey } = this.getTehranInfo(postDate);
                if (postDateKey === todayKey) {
                  hasPost = true;
                  // Retroactively record post so daily stats file is also synchronized
                  this.recordChannelPost({
                    channel,
                    mediaType: 'text',
                    postId: `scraped_${dtIso}`
                  });
                  break;
                }
              }
            }
          }
        } catch (scrapeErr) {
          // Ignore network scrape errors and keep current status
        }
      }
    }

    return { accessible, hasPost };
  }

  /**
   * Generates the Persian HTML report formatted per channel and per platform.
   */
  public async generateReportHtml(dateKey?: string): Promise<string> {
    const { dateKey: todayKey, jalaliDate } = this.getTehranInfo();
    const key = dateKey || todayKey;
    const dayStats = this.getDayStats(key);

    const reportLines: string[] = [];

    for (const ch of config.settings.channels) {
      if (!ch.is_active) continue;

      const stats = dayStats.channels[ch.id];
      const chLines: string[] = [];

      // 1. Telegram
      if (ch.telegram_id) {
        const status = await this.checkTelegramChannelStatus(ch, key);
        if (!status.accessible) {
          chLines.push(`◀️تلگرام ${ch.title} ⚠️ (دسترسی ندارم)`);
        } else {
          chLines.push(`◀️تلگرام ${ch.title} ${status.hasPost ? '✅' : '❌'}`);
        }
      }

      // 2. Bale
      if (ch.bale_id) {
        if (!config.settings.enable_bale || !config.settings.bale_bot_token) {
          chLines.push(`◀️بله ${ch.title} ⚠️ (دسترسی ندارم)`);
        } else {
          const baleSuccess = (stats?.platforms.bale?.success || 0) > 0;
          const hasTg = (stats?.total_posts || 0) > 0;
          const icon = baleSuccess ? '✅' : (hasTg && stats?.platforms.bale?.failed ? '❌' : (hasTg ? '✅' : '❌'));
          chLines.push(`◀️بله ${ch.title} ${icon}`);
        }
      }

      // 3. Rubika
      if (ch.rubika_id) {
        if (!config.settings.enable_rubika || !config.settings.rubika_bot_token) {
          chLines.push(`◀️روبیکا ${ch.title} ⚠️ (دسترسی ندارم)`);
        } else {
          const rubikaSuccess = (stats?.platforms.rubika?.success || 0) > 0;
          const hasTg = (stats?.total_posts || 0) > 0;
          const icon = rubikaSuccess ? '✅' : (hasTg && stats?.platforms.rubika?.failed ? '❌' : (hasTg ? '✅' : '❌'));
          chLines.push(`◀️روبیکا ${ch.title} ${icon}`);
        }
      }

      // 4. Eitaa (if configured)
      if (ch.eitaa_id) {
        if (!config.settings.enable_eitaa || !config.settings.eitaa_token) {
          chLines.push(`◀️ایتا ${ch.title} ⚠️ (دسترسی ندارم)`);
        } else {
          const eitaaSuccess = (stats?.platforms.eitaa?.success || 0) > 0;
          const hasTg = (stats?.total_posts || 0) > 0;
          const icon = eitaaSuccess ? '✅' : (hasTg && stats?.platforms.eitaa?.failed ? '❌' : (hasTg ? '✅' : '❌'));
          chLines.push(`◀️ایتا ${ch.title} ${icon}`);
        }
      }

      if (chLines.length > 0) {
        reportLines.push(chLines.join('\n'));
      }
    }

    const header = `کانال‌ها و پیج‌ها: ${dayStats.jalali_date || jalaliDate}\n\n`;
    return header + reportLines.join('\n\n');
  }

  public getWeeklyAnalytics(): import('../types').WeeklyAnalyticsData {
    const dates: string[] = [];
    const labels: string[] = [];
    const now = new Date();

    // Prepare 7 days keys (from 6 days ago to today)
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const info = this.getTehranInfo(d);
      dates.push(info.dateKey);

      // Short jalali label (e.g. "شنبه ۱۴ مهر" or short day name + day number)
      try {
        const shortDay = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
          timeZone: 'Asia/Tehran',
          weekday: 'short',
          day: 'numeric',
          month: 'short'
        }).format(d);
        labels.push(shortDay);
      } catch {
        labels.push(info.jalaliDate.split(' ').slice(0, 3).join(' '));
      }
    }

    const channelMap: Record<string, { id: string; title: string; data: number[] }> = {};
    for (const ch of config.settings.channels) {
      channelMap[ch.id] = { id: ch.id, title: ch.title, data: [] };
    }

    const platformBale: number[] = [];
    const platformRubika: number[] = [];
    const platformEitaa: number[] = [];

    const mediaTotals = { photo: 0, video: 0, text: 0, other: 0 };
    let totalWeekPosts = 0;
    let totalSuccessPlatforms = 0;
    let totalAttemptsPlatforms = 0;

    for (const dKey of dates) {
      const dayRecord = this.getDayStats(dKey);
      totalWeekPosts += dayRecord.total_posts || 0;

      let dayBale = 0;
      let dayRubika = 0;
      let dayEitaa = 0;

      for (const ch of config.settings.channels) {
        const chStats = dayRecord.channels[ch.id];
        const postCount = chStats?.total_posts || 0;
        const mapEntry = channelMap[ch.id] || { id: ch.id, title: ch.title, data: [] };
        channelMap[ch.id] = mapEntry;
        mapEntry.data.push(postCount);

        if (chStats?.platforms) {
          const bSucc = chStats.platforms.bale?.success || 0;
          const bFail = chStats.platforms.bale?.failed || 0;
          const rSucc = chStats.platforms.rubika?.success || 0;
          const rFail = chStats.platforms.rubika?.failed || 0;
          const eSucc = chStats.platforms.eitaa?.success || 0;
          const eFail = chStats.platforms.eitaa?.failed || 0;

          dayBale += bSucc;
          dayRubika += rSucc;
          dayEitaa += eSucc;

          totalSuccessPlatforms += (bSucc + rSucc + eSucc);
          totalAttemptsPlatforms += (bSucc + bFail + rSucc + rFail + eSucc + eFail);
        }

        if (chStats?.media_types) {
          mediaTotals.photo += chStats.media_types['photo'] || 0;
          mediaTotals.video += chStats.media_types['video'] || 0;
          mediaTotals.text += chStats.media_types['text'] || 0;
          const otherCount = (chStats.media_types['document'] || 0) +
            (chStats.media_types['voice'] || 0) +
            (chStats.media_types['audio'] || 0) +
            (chStats.media_types['animation'] || 0);
          mediaTotals.other += otherCount;
        }
      }

      platformBale.push(dayBale);
      platformRubika.push(dayRubika);
      platformEitaa.push(dayEitaa);
    }

    const successRate = totalAttemptsPlatforms > 0
      ? Math.round((totalSuccessPlatforms / totalAttemptsPlatforms) * 100)
      : 100;

    return {
      labels,
      dates,
      channels: Object.values(channelMap),
      platforms: {
        bale: platformBale,
        rubika: platformRubika,
        eitaa: platformEitaa
      },
      mediaTypes: mediaTotals,
      summary: {
        totalWeekPosts,
        successRate
      }
    };
  }
}

export const statsService = StatsManager.getInstance();
