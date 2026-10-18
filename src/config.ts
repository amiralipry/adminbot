import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import type { AppSettings, ChannelProfile } from './types';

const BASE_DIR = process.cwd();
const CONFIG_FILE = join(BASE_DIR, 'config.json');

export const DEFAULT_CHANNELS: ChannelProfile[] = [
  {
    id: 'health',
    title: 'سیکاپ هلث',
    telegram_id: '@sikaaphealth',
    bale_id: '@sikaaphealth',
    rubika_id: '@sikaaphealth',
    eitaa_id: '@sikaaphealth',
    is_active: true,
    bale_footer: '',
    rubika_footer: '',
    eitaa_footer: ''
  },
  {
    id: 'food',
    title: 'سیکاپ فود',
    telegram_id: '@sikaapfood',
    bale_id: '@sikaapfood',
    rubika_id: '',
    eitaa_id: '',
    is_active: true,
    bale_footer: '',
    rubika_footer: '',
    eitaa_footer: ''
  },
  {
    id: 'farayad',
    title: 'فرایاد',
    telegram_id: '@Farayad_App',
    bale_id: '@Farayad_App',
    rubika_id: '',
    eitaa_id: '',
    is_active: true,
    bale_footer: '',
    rubika_footer: '',
    eitaa_footer: ''
  },
  {
    id: 'yakashef',
    title: 'یاکاشف الکرب',
    telegram_id: '@yakashef_tv',
    bale_id: '@yakashef_tv',
    rubika_id: '@yakashef_admin',
    eitaa_id: '',
    is_active: true,
    bale_footer: '',
    rubika_footer: '',
    eitaa_footer: ''
  }
];

export const DEFAULT_SETTINGS: AppSettings = {
  telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN || '',
  allowed_admin_usernames: process.env.TELEGRAM_ADMIN_USERNAMES ? process.env.TELEGRAM_ADMIN_USERNAMES.split(',').map(s => s.trim()) : [],
  is_paused: false,
  channels: DEFAULT_CHANNELS,

  enable_bale: true,
  bale_bot_token: process.env.BALE_BOT_TOKEN || '',

  enable_rubika: true,
  rubika_bot_token: process.env.RUBIKA_BOT_TOKEN || '',

  enable_eitaa: true,
  eitaa_api_type: 'eitaayar',
  eitaa_token: process.env.EITAA_TOKEN || '',

  remove_telegram_links: false,
  enable_web_dashboard: true,
  web_host: '127.0.0.1',
  web_port: 5000,
  dashboard_auth_enabled: true,
  dashboard_password: process.env.DASHBOARD_PASSWORD || 'admin',

  daily_report_enabled: true,
  daily_report_time: '19:00',
  report_group_id: process.env.REPORT_GROUP_ID || '',
  report_group_title: 'سیکاپ سوشال',
  last_daily_report_date: '',

  ai_provider: 'auto',
  gemini_api_key: process.env.GEMINI_API_KEY || '',
  gemini_backup_api_key: process.env.GEMINI_BACKUP_API_KEY || '',
  gapgpt_api_key: process.env.GAPGPT_API_KEY || '',
  gemini_enabled: true,
  gemini_system_prompt: 'نام شما «ادمین سیکاپ» است. شما یک هوش مصنوعی دستیار صمیمی و خودمانی در گروه سیکاپ هستید. پاسخ‌ها را بسیار کوتاه، طبیعی و در ۱ الی ۳ خط بدهید. اصلاً وظایف، فلسفه حضور، شعارها یا کانال‌ها را در پیام‌ها تکرار نکنید مگر اینکه دقیقاً سوال شده باشد.',

  approval_mode_enabled: false,
  ad_filter_enabled: true,
  blacklist_keywords: [
    'تبلیغات',
    'اسپانسر',
    'جهت سفارش تبلیغ',
    'تعرفه تبلیغات',
    'ارتباط با ادمین تبلیغات',
    'کانال دوم ما',
    'لینک عضویت گروه'
  ],
  admin_chat_ids: [],
  auto_retry_enabled: true,
  max_retry_attempts: 3
};

export class ConfigManager {
  private static instance: ConfigManager;
  public settings: AppSettings;

  private constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.load();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  public load(): void {
    if (existsSync(CONFIG_FILE)) {
      try {
        const raw = readFileSync(CONFIG_FILE, 'utf-8');
        const data = JSON.parse(raw);
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...data,
          channels: data.channels && data.channels.length > 0 ? data.channels : DEFAULT_CHANNELS
        };
        return;
      } catch (err) {
        console.error('[Config] Error reading config.json:', err);
      }
    }
    this.save();
  }

  public save(): void {
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Config] Error saving config.json:', err);
    }
  }

  public updateSettings(partial: Partial<AppSettings>, allowTokenEdit = false): void {
    // If token editing is prohibited, strip token keys to keep them locked
    if (!allowTokenEdit) {
      delete partial.telegram_bot_token;
      delete partial.bale_bot_token;
      delete partial.rubika_bot_token;
    }

    this.settings = {
      ...this.settings,
      ...partial
    };
    this.save();
  }

  public toggleGlobalPause(): boolean {
    this.settings.is_paused = !this.settings.is_paused;
    this.save();
    return this.settings.is_paused;
  }

  public toggleChannelPause(channelId: string): boolean | null {
    const ch = this.settings.channels.find(c => c.id === channelId);
    if (!ch) return null;
    ch.is_active = !ch.is_active;
    this.save();
    return ch.is_active;
  }

  public getChannelByTelegram(tgHandleOrUsername: string): ChannelProfile | undefined {
    const clean = tgHandleOrUsername.toLowerCase().replace(/^@/, '');
    return this.settings.channels.find(c => c.telegram_id.toLowerCase().replace(/^@/, '') === clean);
  }

  public addAdminChatId(chatId: number): void {
    if (!this.settings.admin_chat_ids) {
      this.settings.admin_chat_ids = [];
    }
    if (!this.settings.admin_chat_ids.includes(chatId)) {
      this.settings.admin_chat_ids.push(chatId);
      this.save();
    }
  }

  public toggleApprovalMode(): boolean {
    this.settings.approval_mode_enabled = !this.settings.approval_mode_enabled;
    this.save();
    return this.settings.approval_mode_enabled;
  }

  public addChannel(channel: Partial<ChannelProfile> & { title: string; telegram_id: string }): ChannelProfile {
    const cleanHandle = (val?: string): string => {
      if (!val) return '';
      const trimmed = val.trim();
      if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'none' || trimmed === 'ندارد') {
        return '';
      }
      return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
    };

    const id = channel.id && channel.id.trim()
      ? channel.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_')
      : 'ch_' + Date.now().toString(36);

    const fullChannel: ChannelProfile = {
      id,
      title: channel.title.trim(),
      telegram_id: cleanHandle(channel.telegram_id),
      bale_id: cleanHandle(channel.bale_id),
      rubika_id: cleanHandle(channel.rubika_id),
      eitaa_id: cleanHandle(channel.eitaa_id),
      is_active: channel.is_active !== undefined ? Boolean(channel.is_active) : true,
      bale_footer: channel.bale_footer || '',
      rubika_footer: channel.rubika_footer || '',
      eitaa_footer: channel.eitaa_footer || ''
    };

    // Remove if already exists with same id or same telegram_id
    this.settings.channels = this.settings.channels.filter(c => c.id !== fullChannel.id);
    this.settings.channels.push(fullChannel);
    this.save();
    return fullChannel;
  }

  public removeChannel(channelId: string): boolean {
    const initLen = this.settings.channels.length;
    this.settings.channels = this.settings.channels.filter(c => c.id !== channelId);
    if (this.settings.channels.length !== initLen) {
      this.save();
      return true;
    }
    return false;
  }

  public toggleAdFilter(): boolean {
    this.settings.ad_filter_enabled = !this.settings.ad_filter_enabled;
    this.save();
    return this.settings.ad_filter_enabled;
  }
}

export const config = ConfigManager.getInstance();
