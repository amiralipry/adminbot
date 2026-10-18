import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { ScheduledPost } from '../types';
import { dispatcher } from './dispatcher';
import { statsService } from './stats';
import { config } from '../config';
import { botDb } from './db';

const BASE_DIR = process.cwd();
const DATA_DIR = join(BASE_DIR, 'data');
const SCHEDULE_FILE = join(DATA_DIR, 'scheduled_posts.json');

export class PostScheduleManager {
  private static instance: PostScheduleManager;
  private posts: ScheduledPost[] = [];
  private intervalTimer: any = null;
  private isProcessing = false;

  private constructor() {
    this.ensureDataDir();
    this.load();
  }

  public static getInstance(): PostScheduleManager {
    if (!PostScheduleManager.instance) {
      PostScheduleManager.instance = new PostScheduleManager();
    }
    return PostScheduleManager.instance;
  }

  private ensureDataDir(): void {
    if (!existsSync(DATA_DIR)) {
      try {
        mkdirSync(DATA_DIR, { recursive: true });
      } catch (err) {
        console.error('[PostScheduler] Error creating data dir:', err);
      }
    }
  }
  private load(): void {
    try {
      this.posts = botDb.getScheduledPosts();
    } catch (err) {
      console.error('[PostScheduler] Error reading scheduled posts from SQLite:', err);
      this.posts = [];
    }
  }

  private save(): void {
    try {
      for (const p of this.posts) {
        botDb.saveScheduledPost(p);
      }
    } catch (err) {
      console.error('[PostScheduler] Error saving scheduled posts to SQLite:', err);
    }
  }

  public start(): void {
    if (this.intervalTimer) return;
    console.log('[PostScheduler] Post scheduling background service started (check interval: 15s)');

    this.intervalTimer = setInterval(() => {
      this.checkAndExecuteDuePosts().catch((err) => {
        console.error('[PostScheduler] Error in checkAndExecuteDuePosts:', err);
      });
    }, 15000);

    // Initial check
    this.checkAndExecuteDuePosts().catch(() => {});
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      console.log('[PostScheduler] Post scheduling stopped.');
    }
  }

  public addScheduledPost(params: {
    targetChannelId: string;
    mediaType: string;
    fileId?: string;
    fileData?: string; // base64
    fileName?: string;
    caption?: string;
    rawText?: string;
    source: string;
    scheduledTime: number; // Unix timestamp in ms
    creatorUsername?: string;
  }): ScheduledPost {
    const d = new Date(params.scheduledTime);
    const { jalaliDate, timeStr } = statsService.getTehranInfo(d);
    const scheduledTimeStr = `${jalaliDate} ساعت ${timeStr}`;

    const newPost: ScheduledPost = {
      id: `sch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      targetChannelId: params.targetChannelId,
      mediaType: params.mediaType,
      fileId: params.fileId,
      fileData: params.fileData,
      fileName: params.fileName,
      caption: params.caption,
      rawText: params.rawText,
      source: params.source,
      scheduledTime: params.scheduledTime,
      scheduledTimeStr,
      status: 'pending',
      createdAt: Date.now(),
      creatorUsername: params.creatorUsername
    };

    this.posts.push(newPost);
    this.save();
    console.log(`[PostScheduler] ⏰ Post scheduled for ${newPost.targetChannelId} at ${scheduledTimeStr} (ID: ${newPost.id})`);
    return newPost;
  }

  public getPendingPosts(): ScheduledPost[] {
    return this.posts.filter(p => p.status === 'pending');
  }

  public getAllPosts(): ScheduledPost[] {
    return [...this.posts];
  }

  public cancelScheduledPost(id: string): boolean {
    const found = this.posts.find(p => p.id === id);
    if (found && found.status === 'pending') {
      found.status = 'cancelled';
      this.save();
      console.log(`[PostScheduler] Post ${id} cancelled.`);
      return true;
    }
    return false;
  }

  public async checkAndExecuteDuePosts(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = Date.now();
      const duePosts = this.posts.filter(p => p.status === 'pending' && p.scheduledTime <= now);

      for (const item of duePosts) {
        console.log(`[PostScheduler] 🚀 Executing scheduled post ${item.id} for channel ${item.targetChannelId}...`);
        
        const targetChannels = item.targetChannelId === 'all'
          ? config.settings.channels.filter(c => c.is_active)
          : config.settings.channels.filter(c => c.id === item.targetChannelId);

        if (targetChannels.length === 0) {
          item.status = 'failed';
          item.error = 'کانال مقصد یافت نشد یا غیرفعال است';
          this.save();
          continue;
        }

        try {
          let fileDataBuffer: ArrayBuffer | undefined;
          let fileName = item.fileName || 'file';

          if (item.fileData) {
            const buf = Buffer.from(item.fileData, 'base64');
            fileDataBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
          } else if (item.fileId) {
            const { telegramBot } = await import('../bot/telegram');
            const dl = await (telegramBot as any).downloadTelegramFile(item.fileId);
            fileDataBuffer = dl.data;
            fileName = dl.fileName || fileName;
          }

          for (const ch of targetChannels) {
            statsService.recordChannelPost({
              channel: ch,
              mediaType: item.mediaType,
              postId: `sch_${item.id}`
            });

            await dispatcher.broadcastForChannel({
              channel: ch,
              mediaType: item.mediaType,
              fileData: fileDataBuffer,
              fileName,
              caption: item.caption,
              rawText: item.rawText,
              source: item.source || `@${item.creatorUsername || 'Scheduler'}`
            });
          }

          item.status = 'completed';
          this.save();
          console.log(`[PostScheduler] ✅ Scheduled post ${item.id} successfully broadcasted!`);
        } catch (execErr: any) {
          console.error(`[PostScheduler] ❌ Failed to broadcast scheduled post ${item.id}:`, execErr);
          item.status = 'failed';
          item.error = execErr?.message || String(execErr);
          this.save();
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

export const postScheduler = PostScheduleManager.getInstance();
