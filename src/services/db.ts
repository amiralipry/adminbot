import { Database } from 'bun:sqlite';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import type {
  ChannelStreak,
  DayStatsRecord,
  PostHistoryItem,
  ScheduledPost,
  PendingApprovalPost,
  RetryJob
} from '../types';

const BASE_DIR = process.cwd();
const DATA_DIR = join(BASE_DIR, 'data');
const DB_FILE = join(DATA_DIR, 'bot.db');

export class BotDatabase {
  private static instance: BotDatabase;
  private db: Database;

  private constructor() {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    this.db = new Database(DB_FILE, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');

    this.initTables();
    this.autoMigrateLegacyData();
  }

  public static getInstance(): BotDatabase {
    if (!BotDatabase.instance) {
      BotDatabase.instance = new BotDatabase();
    }
    return BotDatabase.instance;
  }

  private initTables(): void {
    // 1. Channel streaks
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streaks (
        channel_id TEXT PRIMARY KEY,
        current_empty_streak INTEGER NOT NULL DEFAULT 0,
        last_post_date TEXT
      );
    `);

    // 2. Daily Stats records
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        date_key TEXT PRIMARY KEY,
        jalali_date TEXT,
        data_json TEXT NOT NULL,
        updated_at TEXT
      );
    `);

    // 3. Post history logs
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS posts_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT,
        channel_id TEXT,
        channel_name TEXT,
        media_type TEXT,
        content_preview TEXT,
        timestamp TEXT,
        results_json TEXT
      );
    `);

    // 4. Scheduled Posts
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id TEXT PRIMARY KEY,
        target_channel_id TEXT,
        media_type TEXT,
        scheduled_time INTEGER,
        scheduled_time_str TEXT,
        status TEXT,
        creator_username TEXT,
        raw_data_json TEXT NOT NULL,
        created_at INTEGER
      );
    `);

    // 5. Pending Approvals
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_approvals (
        id TEXT PRIMARY KEY,
        channel_id TEXT,
        post_id TEXT,
        data_json TEXT NOT NULL,
        created_at INTEGER
      );
    `);

    // 6. Smart Retry Queue
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS retry_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT,
        platform TEXT,
        media_type TEXT,
        raw_text TEXT,
        caption TEXT,
        file_path TEXT,
        file_name TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        next_retry_at TEXT NOT NULL,
        last_error TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
    `);
  }

  private autoMigrateLegacyData(): void {
    try {
      // 1. Migrate daily_stats.json if database is fresh
      const countStats = (this.db.query('SELECT count(*) as cnt FROM daily_stats').get() as any)?.cnt || 0;
      const statsJsonFile = join(DATA_DIR, 'daily_stats.json');

      if (countStats === 0 && existsSync(statsJsonFile)) {
        console.log('[SQLite] Migrating legacy daily_stats.json into SQLite...');
        const raw = readFileSync(statsJsonFile, 'utf-8');
        const parsed = JSON.parse(raw);

        if (parsed.streaks) {
          const insertStreak = this.db.prepare(
            'INSERT OR REPLACE INTO streaks (channel_id, current_empty_streak, last_post_date) VALUES (?, ?, ?)'
          );
          for (const [chId, s] of Object.entries(parsed.streaks as Record<string, ChannelStreak>)) {
            insertStreak.run(chId, s.current_empty_streak || 0, s.last_post_date || null);
          }
        }

        if (parsed.days) {
          const insertDay = this.db.prepare(
            'INSERT OR REPLACE INTO daily_stats (date_key, jalali_date, data_json, updated_at) VALUES (?, ?, ?, ?)'
          );
          for (const [dateKey, dayRec] of Object.entries(parsed.days as Record<string, DayStatsRecord>)) {
            insertDay.run(dateKey, dayRec.jalali_date || '', JSON.stringify(dayRec), new Date().toISOString());
          }
        }
        console.log('[SQLite] Successfully migrated daily_stats.json!');
      }

      // 2. Migrate scheduled_posts.json
      const countPosts = (this.db.query('SELECT count(*) as cnt FROM scheduled_posts').get() as any)?.cnt || 0;
      const scheduleJsonFile = join(DATA_DIR, 'scheduled_posts.json');

      if (countPosts === 0 && existsSync(scheduleJsonFile)) {
        console.log('[SQLite] Migrating legacy scheduled_posts.json into SQLite...');
        const raw = readFileSync(scheduleJsonFile, 'utf-8');
        const posts = JSON.parse(raw) as ScheduledPost[];

        const insertPost = this.db.prepare(`
          INSERT OR REPLACE INTO scheduled_posts (
            id, target_channel_id, media_type, scheduled_time, scheduled_time_str, status, creator_username, raw_data_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const p of posts) {
          insertPost.run(
            p.id,
            p.targetChannelId,
            p.mediaType,
            p.scheduledTime,
            p.scheduledTimeStr,
            p.status,
            p.creatorUsername || null,
            JSON.stringify(p),
            p.createdAt || Date.now()
          );
        }
        console.log('[SQLite] Successfully migrated scheduled_posts.json!');
      }
    } catch (err) {
      console.error('[SQLite] Error during auto-migration:', err);
    }
  }

  // ================= Streaks =================
  public getStreaks(): Record<string, ChannelStreak> {
    const rows = this.db.query('SELECT * FROM streaks').all() as any[];
    const result: Record<string, ChannelStreak> = {};
    for (const r of rows) {
      result[r.channel_id] = {
        channel_id: r.channel_id,
        current_empty_streak: r.current_empty_streak,
        last_post_date: r.last_post_date
      };
    }
    return result;
  }

  public setStreak(channelId: string, currentEmptyStreak: number, lastPostDate?: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO streaks (channel_id, current_empty_streak, last_post_date) VALUES (?, ?, ?)')
      .run(channelId, currentEmptyStreak, lastPostDate || null);
  }

  // ================= Daily Stats =================
  public getDayStats(dateKey: string): DayStatsRecord | null {
    const row = this.db.query('SELECT data_json FROM daily_stats WHERE date_key = ?').get(dateKey) as any;
    if (!row) return null;
    try {
      return JSON.parse(row.data_json);
    } catch {
      return null;
    }
  }

  public getAllDaysStats(): Record<string, DayStatsRecord> {
    const rows = this.db.query('SELECT date_key, data_json FROM daily_stats ORDER BY date_key ASC').all() as any[];
    const result: Record<string, DayStatsRecord> = {};
    for (const r of rows) {
      try {
        result[r.date_key] = JSON.parse(r.data_json);
      } catch {}
    }
    return result;
  }

  public saveDayStats(dateKey: string, jalaliDate: string, record: DayStatsRecord): void {
    this.db
      .prepare('INSERT OR REPLACE INTO daily_stats (date_key, jalali_date, data_json, updated_at) VALUES (?, ?, ?, ?)')
      .run(dateKey, jalaliDate, JSON.stringify(record), new Date().toISOString());
  }

  // ================= Post History =================
  public addPostHistory(item: PostHistoryItem): void {
    this.db
      .prepare(`
        INSERT INTO posts_history (post_id, channel_id, channel_name, media_type, content_preview, timestamp, results_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        item.post_id,
        (item.results?.bale?.channel || item.results?.rubika?.channel || item.channel_name || '').replace(/^@/, ''),
        item.channel_name,
        item.media_type,
        item.content_preview,
        item.timestamp,
        JSON.stringify(item.results)
      );
  }

  public getRecentHistory(limit = 100): PostHistoryItem[] {
    const rows = this.db.query('SELECT * FROM posts_history ORDER BY id DESC LIMIT ?').all(limit) as any[];
    return rows.map(r => ({
      post_id: r.post_id,
      source: r.channel_name,
      channel_name: r.channel_name,
      media_type: r.media_type,
      content_preview: r.content_preview,
      timestamp: r.timestamp,
      results: JSON.parse(r.results_json || '{}')
    }));
  }

  // ================= Scheduled Posts =================
  public getScheduledPosts(): ScheduledPost[] {
    const rows = this.db.query('SELECT raw_data_json FROM scheduled_posts ORDER BY scheduled_time ASC').all() as any[];
    return rows.map(r => JSON.parse(r.raw_data_json));
  }

  public saveScheduledPost(post: ScheduledPost): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO scheduled_posts (
          id, target_channel_id, media_type, scheduled_time, scheduled_time_str, status, creator_username, raw_data_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        post.id,
        post.targetChannelId,
        post.mediaType,
        post.scheduledTime,
        post.scheduledTimeStr,
        post.status,
        post.creatorUsername || null,
        JSON.stringify(post),
        post.createdAt || Date.now()
      );
  }

  public deleteScheduledPost(id: string): void {
    this.db.prepare('DELETE FROM scheduled_posts WHERE id = ?').run(id);
  }

  // ================= Pending Approvals =================
  public savePendingApproval(approval: PendingApprovalPost): void {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO pending_approvals (id, channel_id, post_id, data_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(approval.id, approval.channelId, approval.postId, JSON.stringify(approval), approval.createdAt || Date.now());
  }

  public getPendingApproval(id: string): PendingApprovalPost | null {
    const row = this.db.query('SELECT data_json FROM pending_approvals WHERE id = ?').get(id) as any;
    if (!row) return null;
    try {
      return JSON.parse(row.data_json);
    } catch {
      return null;
    }
  }

  public getAllPendingApprovals(): PendingApprovalPost[] {
    const rows = this.db.query('SELECT data_json FROM pending_approvals ORDER BY created_at DESC').all() as any[];
    return rows.map(r => JSON.parse(r.data_json));
  }

  public deletePendingApproval(id: string): void {
    this.db.prepare('DELETE FROM pending_approvals WHERE id = ?').run(id);
  }

  public updatePendingApprovalStatus(id: string, status: 'approved' | 'rejected'): void {
    this.deletePendingApproval(id);
  }

  // ================= Smart Retry Queue =================
  public enqueueRetry(params: {
    channelId: string;
    platform: 'bale' | 'rubika' | 'eitaa';
    mediaType: string;
    rawText?: string;
    caption?: string;
    filePath?: string;
    fileName?: string;
    maxAttempts?: number;
    delaySeconds?: number;
    lastError?: string;
  }): number {
    const delay = params.delaySeconds || 30;
    const nextRetry = new Date(Date.now() + delay * 1000).toISOString();
    const now = new Date().toISOString();

    const info = this.db
      .prepare(`
        INSERT INTO retry_queue (
          channel_id, platform, media_type, raw_text, caption, file_path, file_name,
          attempts, max_attempts, next_retry_at, last_error, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', ?)
      `)
      .run(
        params.channelId,
        params.platform,
        params.mediaType,
        params.rawText || null,
        params.caption || null,
        params.filePath || null,
        params.fileName || null,
        params.maxAttempts || 3,
        nextRetry,
        params.lastError || '',
        now
      );

    return Number(info.lastInsertRowid);
  }

  public getPendingRetries(): RetryJob[] {
    const now = new Date().toISOString();
    const rows = this.db
      .query(`SELECT * FROM retry_queue WHERE status = 'pending' AND next_retry_at <= ? ORDER BY id ASC LIMIT 10`)
      .all(now) as any[];

    return rows.map(r => ({
      id: r.id,
      channel_id: r.channel_id,
      platform: r.platform,
      media_type: r.media_type,
      raw_text: r.raw_text,
      caption: r.caption,
      file_path: r.file_path,
      file_name: r.file_name,
      attempts: r.attempts,
      max_attempts: r.max_attempts,
      next_retry_at: r.next_retry_at,
      last_error: r.last_error,
      status: r.status,
      created_at: r.created_at
    }));
  }

  public updateRetryJob(id: number, attempts: number, nextRetryAt: string, error: string, status = 'pending'): void {
    this.db
      .prepare('UPDATE retry_queue SET attempts = ?, next_retry_at = ?, last_error = ?, status = ? WHERE id = ?')
      .run(attempts, nextRetryAt, error, status, id);
  }

  public completeRetryJob(id: number): void {
    this.db.prepare("UPDATE retry_queue SET status = 'completed' WHERE id = ?").run(id);
  }

  public failRetryJob(id: number, error: string): void {
    this.db.prepare("UPDATE retry_queue SET status = 'failed', last_error = ? WHERE id = ?").run(error, id);
  }

  public getRetryQueueStats(): { pending: number; failed: number; completed: number } {
    const rows = this.db
      .query("SELECT status, count(*) as count FROM retry_queue GROUP BY status")
      .all() as any[];

    const stats = { pending: 0, failed: 0, completed: 0 };
    for (const r of rows) {
      if (r.status === 'pending') stats.pending = r.count;
      else if (r.status === 'failed') stats.failed = r.count;
      else if (r.status === 'completed') stats.completed = r.count;
    }
    return stats;
  }

  public getAllRetryJobs(limit = 50): RetryJob[] {
    const rows = this.db
      .query(`SELECT * FROM retry_queue ORDER BY id DESC LIMIT ?`)
      .all(limit) as any[];
    return rows.map(r => ({
      id: r.id,
      channel_id: r.channel_id,
      platform: r.platform,
      media_type: r.media_type,
      raw_text: r.raw_text,
      caption: r.caption,
      file_path: r.file_path,
      file_name: r.file_name,
      attempts: r.attempts,
      max_attempts: r.max_attempts,
      next_retry_at: r.next_retry_at,
      last_error: r.last_error,
      status: r.status,
      created_at: r.created_at
    }));
  }
}

export const botDb = BotDatabase.getInstance();
