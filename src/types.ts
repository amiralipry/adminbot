export interface ChannelProfile {
  id: string; // 'health' | 'food' | 'farayad'
  title: string; // 'سیکاپ هلث' | 'سیکاپ فود' | 'فرایاد'
  telegram_id: string; // '@sikaaphealth' | '@sikaapfood' | '@Farayad_App'
  telegram_chat_id?: string; // numeric Telegram chat ID e.g. '-1001637399228'
  bale_id: string;
  rubika_id: string;
  eitaa_id?: string;
  is_active: boolean;
  bale_footer?: string;
  rubika_footer?: string;
  eitaa_footer?: string;
}

export interface AppSettings {
  telegram_bot_token: string;
  allowed_admin_usernames: string[];
  is_paused: boolean;
  channels: ChannelProfile[];

  enable_bale: boolean;
  bale_bot_token: string;

  enable_rubika: boolean;
  rubika_bot_token: string;

  enable_eitaa: boolean;
  eitaa_api_type: 'eitaayar' | 'direct';
  eitaa_token: string;

  remove_telegram_links: boolean;
  enable_web_dashboard: boolean;
  web_host: string;
  web_port: number;

  // Daily Report Settings
  daily_report_enabled: boolean;
  daily_report_time: string; // e.g. "19:00"
  report_group_id: string; // Telegram group chat ID for "سیکاپ سوشال"
  report_group_title: string;
  last_daily_report_date?: string; // e.g. "2026-10-02"

  // AI Settings
  ai_provider: 'auto' | 'gemini' | 'gemini_backup' | 'gapgpt' | 'gapgpt_gemma' | 'gpt_6_luna'; // ارائه‌دهنده فعال هوش مصنوعی
  gemini_api_key: string;
  gemini_backup_api_key?: string;
  gapgpt_api_key?: string; // کلید گپ جی پی تی
  gemini_enabled: boolean;
  gemini_system_prompt: string;

  // New Advanced Features
  approval_mode_enabled: boolean; // حالت تایید دستی قبل از بازنشر
  ad_filter_enabled: boolean; // فیلتر تبلیغات و کلمات ناخواسته
  blacklist_keywords: string[]; // لیست کلمات و عبارات تبلیغاتی
  admin_chat_ids: number[]; // شناسه‌های عددی چت ادمین‌ها جهت دریافت هشدارهای فوری
  auto_retry_enabled: boolean; // تلاش مجدد هوشمند تا ۳ بار
  max_retry_attempts: number; // حداکثر دفعات تلاش مجدد (پیش‌فرض ۳)
  restricted_admin_username?: string;
  dashboard_auth_enabled?: boolean;
  dashboard_password?: string;
}

export interface PlatformResult {
  success: boolean;
  platform?: string;
  channel?: string;
  message_id?: string | number;
  error?: string;
  skipped?: boolean;
  attempts?: number;
}

export interface MediaGroupItem {
  messageId: number;
  mediaType: string;
  fileId: string;
  fileName?: string;
  filePath?: string;
  caption?: string;
}

export interface PendingApprovalPost {
  id: string;
  channelId: string;
  channelTitle: string;
  channel?: ChannelProfile;
  mediaType: string;
  text?: string;
  caption?: string;
  perPlatformCaptions?: {
    bale?: string;
    rubika?: string;
    eitaa?: string;
  };
  fileId?: string;
  filePath?: string;
  fileName?: string;
  source: string;
  postId: string;
  createdAt: number;
  isAlbum?: boolean;
  albumItems?: MediaGroupItem[];
  aiEnhancedText?: string;
  date?: number;
}

export interface RetryJob {
  id: number;
  channel_id: string;
  platform: 'bale' | 'rubika' | 'eitaa';
  media_type: string;
  raw_text?: string;
  caption?: string;
  file_path?: string;
  file_name?: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  last_error: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
}

export interface ScheduledPost {
  id: string;
  targetChannelId: string;
  mediaType: string;
  fileData?: string; // base64 representation if stored, or fileId if downloaded on demand
  fileId?: string;
  fileName?: string;
  caption?: string;
  rawText?: string;
  source: string;
  scheduledTime: number; // Unix timestamp in ms
  scheduledTimeStr: string; // Persian or ISO date string
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  creatorUsername?: string;
  error?: string;
}

export interface PostHistoryItem {
  post_id: string;
  source: string;
  channel_name: string;
  media_type: string;
  content_preview: string;
  timestamp: string;
  results: {
    bale?: PlatformResult;
    rubika?: PlatformResult;
    eitaa?: PlatformResult;
  };
}

export interface ChannelDayStats {
  channel_id: string;
  channel_title: string;
  telegram_id: string;
  total_posts: number;
  platforms: {
    bale: { success: number; failed: number; skipped: number; last_error?: string };
    rubika: { success: number; failed: number; skipped: number; last_error?: string };
    eitaa: { success: number; failed: number; skipped: number; last_error?: string };
  };
  media_types: Record<string, number>;
  consecutive_empty_days?: number;
}

export interface ChannelStreak {
  channel_id: string;
  last_active_date?: string; // YYYY-MM-DD
  consecutive_inactive_days?: number;
  last_post_date?: string;
  current_empty_streak?: number;
}

export interface DayStatsRecord {
  date: string; // YYYY-MM-DD
  jalali_date: string;
  total_posts: number;
  channels: Record<string, ChannelDayStats>;
}

export interface WeeklyAnalyticsData {
  labels: string[]; // e.g. ["شنبه ۱۴ مهر", "یکشنبه ۱۵ مهر", ...]
  dates: string[]; // YYYY-MM-DD
  channels: {
    id: string;
    title: string;
    data: number[]; // total posts per day
  }[];
  platforms: {
    bale: number[];
    rubika: number[];
    eitaa: number[];
  };
  mediaTypes: {
    photo: number;
    video: number;
    text: number;
    other: number;
  };
  summary: {
    totalWeekPosts: number;
    successRate: number;
  };
}

