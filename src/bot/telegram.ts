import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config } from '../config';
import { dispatcher } from '../services/dispatcher';
import { statsService } from '../services/stats';
import { dailyReportScheduler } from '../services/scheduler';
import { geminiService } from '../services/gemini';
import { postScheduler } from '../services/postScheduler';
import type { ChannelProfile } from '../types';

export class TelegramBotManager {
  private static instance: TelegramBotManager;
  public bot: Bot | null = null;
  public isRunning = false;

  private albumBuffer: Map<string, { messages: any[]; timer: any }> = new Map();
  private pendingUploads: Map<string, { mediaType: string; fileId: string; fileName: string; caption?: string; date: number }> = new Map();
  private pendingSchedule: Map<string, { targetId: string; uploadKey: string; timestamp: number }> = new Map();
  public pendingApprovals: Map<string, {
    id: string;
    channel: ChannelProfile;
    mediaType: string;
    fileId?: string;
    text?: string;
    caption?: string;
    source: string;
    postId: string;
    date: number;
  }> = new Map();
  private pendingChannelWizard: Map<number, {
    step: 'title' | 'telegram_id' | 'bale_id' | 'rubika_id';
    data: Partial<ChannelProfile>;
    timestamp: number;
  }> = new Map();

  private constructor() {}

  public static getInstance(): TelegramBotManager {
    if (!TelegramBotManager.instance) {
      TelegramBotManager.instance = new TelegramBotManager();
    }
    return TelegramBotManager.instance;
  }

  private isAuthorizedAdmin(username?: string): boolean {
    if (!username) return false;
    const clean = username.toLowerCase().replace(/^@/, '');
    const allowed = config.settings.allowed_admin_usernames.map(u => u.toLowerCase().replace(/^@/, ''));
    return allowed.includes(clean);
  }

  private get restrictedUsername(): string {
    return (process.env.RESTRICTED_ADMIN_USERNAME || config.settings.restricted_admin_username || '').toLowerCase().replace(/^@/, '');
  }

  public isRestrictedAdmin(username?: string): boolean {
    if (!username) return false;
    const clean = username.toLowerCase().replace(/^@/, '');
    const restricted = this.restrictedUsername;
    return Boolean(restricted && clean === restricted);
  }

  public isChannelAllowedForUser(username: string | undefined, channelId: string): boolean {
    if (!username) return false;
    if (this.isRestrictedAdmin(username)) {
      return channelId === 'yakashef';
    }
    return this.isAuthorizedAdmin(username);
  }

  public isFullAdmin(username?: string): boolean {
    if (!username) return false;
    if (this.isRestrictedAdmin(username)) return false;
    return this.isAuthorizedAdmin(username);
  }

  private getMainMenuKeyboard(): InlineKeyboard {
    const pauseText = config.settings.is_paused ? '▶️ فعال‌سازی و ادامه (Resume)' : '⏸️ توقف کامل سیستم (Pause)';
    const kb = new InlineKeyboard()
      .text(pauseText, 'cb:toggle_global')
      .text('📊 تست وضعیت پیام‌رسان‌ها', 'cb:test_conns')
      .row();

    for (let i = 0; i < config.settings.channels.length; i++) {
      const ch = config.settings.channels[i];
      if (!ch) continue;
      let icon = '📢';
      if (ch.id === 'health') icon = '🏥';
      else if (ch.id === 'food') icon = '🍔';
      else if (ch.id === 'farayad') icon = '📚';
      else if (ch.id === 'yakashef') icon = '🌙';

      kb.text(`${icon} ${ch.title}`, `cb:ch:${ch.id}`);
      if (i % 2 === 1) kb.row();
    }
    if (config.settings.channels.length % 2 !== 0) kb.row();

    kb.text('➕ افزودن کانال جدید', 'cb:add_channel_wizard')
      .row();

    const approvalText = config.settings.approval_mode_enabled ? '📋 تایید دستی: 🟢 فعال' : '📋 تایید دستی: 🔴 غیرفعال';
    const adFilterText = config.settings.ad_filter_enabled ? '🛡️ فیلتر تبلیغ: 🟢 فعال' : '🛡️ فیلتر تبلیغ: 🔴 غیرفعال';

    kb.text('📈 گزارش روزانه ۱۹:۰۰', 'cb:daily_report')
      .text('⏰ پست‌های زمان‌بندی‌شده', 'cb:list_scheduled')
      .row()
      .text('🤖 تنظیم موتور هوش مصنوعی', 'cb:ai_menu')
      .row()
      .text(approvalText, 'cb:toggle_approval')
      .text(adFilterText, 'cb:toggle_adfilter')
      .row()
      .text('📜 مشاهده آخرین لاگ‌ها', 'cb:logs')
      .text('🔄 تازه‌سازی وضعیت', 'cb:main_menu');

    return kb;
  }

  private getAiSettingsKeyboard(): InlineKeyboard {
    const current = config.settings.ai_provider || 'auto';
    const autoIcon = current === 'auto' ? '🔘 ' : '';
    const geminiIcon = current === 'gemini' ? '🔘 ' : '';
    const geminiBackupIcon = current === 'gemini_backup' ? '🔘 ' : '';
    const gapgptIcon = current === 'gapgpt' ? '🔘 ' : '';
    const gemmaIcon = current === 'gapgpt_gemma' ? '🔘 ' : '';
    const lunaIcon = current === 'gpt_6_luna' ? '🔘 ' : '';

    return new InlineKeyboard()
      .text(`${autoIcon}🔄 خودکار هوشمند (پیش‌فرض)`, 'cb:set_ai:auto')
      .row()
      .text(`${geminiIcon}💎 گوگل جمینای اصلی`, 'cb:set_ai:gemini')
      .text(`${geminiBackupIcon}🛡️ جمینای پشتیبان`, 'cb:set_ai:gemini_backup')
      .row()
      .text(`${gapgptIcon}⚡ گپ جی‌پی‌تی (GPT-4o)`, 'cb:set_ai:gapgpt')
      .text(`${gemmaIcon}🧠 گپ جما (Gemma 26B)`, 'cb:set_ai:gapgpt_gemma')
      .row()
      .text(`${lunaIcon}🔮 اوپن‌ای‌آی لونا (GPT-6 Luna)`, 'cb:set_ai:gpt_6_luna')
      .row()
      .text('🔙 بازگشت به منوی اصلی', 'cb:main_menu');
  }

  private renderAiSettingsHtml(): string {
    const active = geminiService.getProviderDisplayName();
    return (
      `🤖 <b>تنظیمات موتور هوش مصنوعی ربات</b>\n\n` +
      `📌 <b>ارائه‌دهنده فعال فعلی:</b> <b>${active}</b>\n\n` +
      `🔹 <b>گزینه‌های موجود:</b>\n` +
      `▫️ <b>خودکار هوشمند:</b> استفاده از جمینای اصلی و سوییچ خودکار به جمینای پشتیبان و گپ جی‌پی‌تی در صورت بروز محدودیت\n` +
      `▫️ <b>گوگل جمینای اصلی:</b> فعالیت فقط با کلید اول گوگل\n` +
      `▫️ <b>جمینای پشتیبان:</b> فعالیت فقط با کلید دوم گوگل\n` +
      `▫️ <b>گپ جی‌پی‌تی (GPT-4o):</b> فعالیت با API گپ جی‌پی‌تی مدل ChatGPT 4o\n` +
      `▫️ <b>گپ جما (Gemma 26B A4B):</b> فعالیت با مدل قدرتمند gapgpt-gemma-26b-a4b\n` +
      `▫️ <b>اوپن‌ای‌آی لونا (GPT-6 Luna):</b> فعالیت با مدل پیشرفته gpt-6-luna\n\n` +
      `👇 لطفاً موتور مورد نظر خود را انتخاب کنید:`
    );
  }

  private getDailyReportKeyboard(): InlineKeyboard {
    const toggleText = config.settings.daily_report_enabled ? '🔴 غیرفعال‌سازی ارسال خودکار' : '🟢 فعال‌سازی ارسال خودکار';
    return new InlineKeyboard()
      .text('🚀 ارسال فوری گزارش به گروه', 'cb:send_report_now')
      .row()
      .text('👁️ پیش‌نمایش گزارش روزانه', 'cb:preview_report')
      .text(toggleText, 'cb:toggle_daily_report')
      .row()
      .text('🔙 بازگشت به منوی اصلی', 'cb:main_menu');
  }

  private renderDailyReportHtml(): string {
    const status = config.settings.daily_report_enabled ? '🟢 فعال (هر روز رأس ساعت ۱۹:۰۰)' : '🔴 غیرفعال';
    const groupTitle = config.settings.report_group_title || 'سیکاپ سوشال';
    const groupId = config.settings.report_group_id ? `<code>${config.settings.report_group_id}</code>` : '⚠️ <i>تنظیم‌نشده (لطفاً دستور /setreport را در گروه بفرستید)</i>';
    const lastDate = config.settings.last_daily_report_date || 'هنوز ارسال نشده';

    return (
      `📊 <b>تنظیمات و مدیریت گزارش روزانه ۱۹:۰۰</b>\n\n` +
      `⚙️ <b>وضعیت گزارش‌دهی:</b> ${status}\n` +
      `⏰ <b>ساعت ارسال:</b> <code>${config.settings.daily_report_time || '19:00'}</code> (به وقت تهران)\n` +
      `👥 <b>گروه مقصد:</b> <b>${groupTitle}</b> (${groupId})\n` +
      `📅 <b>آخرین گزارش ارسالی:</b> <code>${lastDate}</code>\n\n` +
      `💡 <b>دستورات ارسال دستی گزارش در هر لحظه:</b>\n` +
      `▫️ <code>/sendreport</code> یا ارسال متن <b>«ارسال گزارش»</b>: ارسال مستقیم گزارش به گروه\n` +
      `▫️ <code>/report</code> یا ارسال متن <b>«گزارش بده»</b>: مشاهده آنی گزارش همین‌جا\n` +
      `▫️ <code>/setreport</code>: ثبت گروه فعلی به عنوان مقصد گزارش`
    );
  }

  private getChannelKeyboard(ch: ChannelProfile): InlineKeyboard {
    const statusText = ch.is_active ? '🔴 غیرفعال‌سازی این کانال' : '🟢 فعال‌سازی این کانال';
    return new InlineKeyboard()
      .text(statusText, `cb:toggle_ch:${ch.id}`)
      .text('🚀 ارسال پست تست', `cb:test_post:${ch.id}`)
      .row()
      .text('🗑️ حذف این کانال', `cb:del_ch_ask:${ch.id}`)
      .text('🔙 بازگشت به منوی اصلی', 'cb:main_menu');
  }

  private renderMainMenuHtml(userName: string): string {
    const status = config.settings.is_paused
      ? '🔴 <b>متوقف شده (Paused)</b>'
      : '🟢 <b>در حال کار و بازنشر فعال</b>';

    const approvalStatus = config.settings.approval_mode_enabled
      ? '🟢 <b>فعال (پست‌ها پیش از ارسال به پیام‌رسان‌ها منتظر تایید ادمین می‌مانند)</b>'
      : '🔴 <b>غیرفعال (ارسال آنی و خودکار)</b>';

    const adStatus = config.settings.ad_filter_enabled
      ? '🟢 <b>فعال (حذف خودکار تبلیغات و لینک‌های غیرمرتبط)</b>'
      : '🔴 <b>غیرفعال</b>';

    let channelsList = '';
    for (const ch of config.settings.channels) {
      const icon = ch.is_active ? '🟢' : '🔴';
      channelsList += `▫️ ${icon} <b>${ch.title}</b> (<code>${ch.telegram_id}</code>)\n`;
    }

    const aiProviderName = geminiService.getProviderDisplayName();

    return (
      `سلام <b>${userName}</b> عزیز 🌺\n` +
      `به پنل مدیریت ربات بازنشر چندکاناله (تلگرام ➔ بله و روبیکا) خوش آمدید.\n\n` +
      `⚙️ <b>وضعیت کلی سیستم:</b> ${status}\n` +
      `🤖 <b>هوش مصنوعی فعال:</b> <b>${aiProviderName}</b>\n` +
      `📋 <b>حالت تایید دستی:</b> ${approvalStatus}\n` +
      `🛡️ <b>فیلتر تبلیغات ناخواسته:</b> ${adStatus}\n` +
      `🔄 <b>سیستم صف و تلاش مجدد:</b> 🟢 فعال (تا ۳ بار تلاش هوشمند)\n\n` +
      `📢 <b>کانال‌های تحت مدیریت:</b>\n` +
      `${channelsList}\n` +
      `👇 از دکمه‌های شیشه‌ای زیر برای کنترل و بررسی استفاده کنید:`
    );
  }

  public async sendFailureAlert(info: {
    channel: ChannelProfile;
    platform: string;
    error: string;
    mediaType: string;
    source: string;
    attempts: number;
  }): Promise<void> {
    if (!this.bot) return;

    const platformFa = info.platform === 'bale' ? '🍃 بله' : (info.platform === 'rubika' ? '🟣 روبیکا' : '🟠 ایتا');
    const mediaFa = info.mediaType === 'video' ? 'ویدیو' : (info.mediaType === 'photo' ? 'تصویر' : (info.mediaType === 'text' ? 'متن' : 'فایل'));

    let timeStr = 'لحظاتی پیش';
    try {
      timeStr = new Intl.DateTimeFormat('fa-IR', {
        timeZone: 'Asia/Tehran',
        hour: '2-digit',
        minute: '2-digit'
      }).format(new Date());
    } catch {}

    const alertText = (
      `🚨 <b>هشدار خطای بازنشر به ${platformFa}!</b>\n\n` +
      `📢 <b>کانال:</b> <b>${info.channel.title}</b> (<code>${info.channel.telegram_id}</code>)\n` +
      `📦 <b>نوع محتوا:</b> ${mediaFa}\n` +
      `🔄 <b>وضعیت ارسال:</b> ${info.attempts} بار تلاش خودکار ناموفق بود.\n` +
      `⏰ <b>زمان وقوع:</b> ساعت ${timeStr}\n\n` +
      `❌ <b>علت خطا:</b>\n` +
      `<code>${info.error.slice(0, 300)}</code>\n\n` +
      `💡 <i>پیشنهاد: لطفاً اتصال سرور، انقضای توکن یا محدودیت حجم فایل را بررسی نمایید.</i>`
    );

    const targetChatIds = new Set<string | number>();
    if (config.settings.admin_chat_ids) {
      for (const id of config.settings.admin_chat_ids) targetChatIds.add(id);
    }
    if (config.settings.report_group_id) {
      targetChatIds.add(config.settings.report_group_id);
    }

    for (const chatId of targetChatIds) {
      try {
        await this.bot.api.sendMessage(chatId, alertText, { parse_mode: 'HTML' });
      } catch (err) {
        console.error(`[Telegram] Failed to send failure alert to ${chatId}:`, err);
      }
    }
  }

  private async requestApprovalForPost(msg: any, channel: ChannelProfile, mediaType: string, fileId?: string): Promise<void> {
    if (!this.bot) return;

    const approvalId = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const source = msg.chat?.username ? `@${msg.chat.username}` : channel.title;
    const postId = String(msg.message_id);

    this.pendingApprovals.set(approvalId, {
      id: approvalId,
      channel,
      mediaType,
      fileId,
      text: msg.text,
      caption: msg.caption,
      source,
      postId,
      date: Date.now()
    });

    const mediaFa = mediaType === 'video' ? 'ویدیو' : (mediaType === 'photo' ? 'تصویر' : (mediaType === 'text' ? 'متن' : 'فایل'));
    const contentPreview = (msg.text || msg.caption || '(بدون کپشن/متن)').slice(0, 300);

    const kb = new InlineKeyboard()
      .text('✅ تایید و ارسال به پیام‌رسان‌ها', `cb:appr_ok:${approvalId}`)
      .text('❌ لغو ارسال', `cb:appr_no:${approvalId}`);

    const promptText = (
      `📋 <b>پست جدید در انتظار تایید ادمین برای بازنشر!</b>\n\n` +
      `📢 <b>کانال مبدأ:</b> <b>${channel.title}</b> (<code>${channel.telegram_id}</code>)\n` +
      `📦 <b>نوع محتوا:</b> ${mediaFa}\n\n` +
      `📝 <b>پیش‌نمایش محتوا:</b>\n` +
      `<i>${contentPreview}</i>\n\n` +
      `👇 لطفاً بررسی کرده و در صورت تایید دکمه ارسال را بزنید:`
    );

    const targetChatIds = new Set<string | number>();
    if (config.settings.admin_chat_ids) {
      for (const id of config.settings.admin_chat_ids) targetChatIds.add(id);
    }
    if (config.settings.report_group_id) {
      targetChatIds.add(config.settings.report_group_id);
    }

    if (targetChatIds.size === 0) {
      console.warn('[Telegram] No admin chat IDs recorded yet for approval mode.');
    }

    for (const chatId of targetChatIds) {
      try {
        await this.bot.api.sendMessage(chatId, promptText, {
          parse_mode: 'HTML',
          reply_markup: kb
        });
      } catch (err) {
        console.error(`[Telegram] Failed to send approval request to ${chatId}:`, err);
      }
    }
  }

  private async downloadTelegramFile(fileId: string): Promise<{ data: ArrayBuffer; fileName: string }> {
    if (!this.bot) throw new Error('Bot not initialized');
    const file = await this.bot.api.getFile(fileId);
    if (!file.file_path) throw new Error('File path not found');

    const token = config.settings.telegram_bot_token.trim();
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    const res = await fetch(downloadUrl);
    const data = await res.arrayBuffer();
    const fileName = file.file_path.split('/').pop() || 'file';

    return { data, fileName };
  }

  private async processChannelMessage(msg: any, channel: ChannelProfile): Promise<void> {
    const postId = String(msg.message_id);
    const source = msg.chat?.username ? `@${msg.chat.username}` : channel.title;

    let mediaType = 'text';
    let fileId: string | undefined;

    if (msg.photo) {
      mediaType = 'photo';
      fileId = msg.photo[msg.photo.length - 1].file_id;
    } else if (msg.video) {
      mediaType = 'video';
      fileId = msg.video.file_id;
    } else if (msg.document) {
      mediaType = 'document';
      fileId = msg.document.file_id;
    } else if (msg.voice) {
      mediaType = 'voice';
      fileId = msg.voice.file_id;
    } else if (msg.audio) {
      mediaType = 'audio';
      fileId = msg.audio.file_id;
    } else if (msg.animation) {
      mediaType = 'animation';
      fileId = msg.animation.file_id;
    }

    // Immediately record that this channel published a post today on Telegram
    // (Regardless of whether cross-posting succeeds or fails)
    statsService.recordChannelPost({
      channel,
      mediaType,
      postId
    });

    // Check if Approval Mode is enabled
    if (config.settings.approval_mode_enabled) {
      console.log(`[Telegram] Approval mode is ON. Queueing post from "${channel.title}" for admin approval.`);
      await this.requestApprovalForPost(msg, channel, mediaType, fileId);
      return;
    }

    // 1. Plain text
    if (!fileId && msg.text) {
      await dispatcher.broadcastForChannel({
        channel,
        mediaType: 'text',
        rawText: msg.text,
        source,
        postId
      });
      return;
    }

    // 2. Media
    if (fileId) {
      try {
        const { data, fileName } = await this.downloadTelegramFile(fileId);
        await dispatcher.broadcastForChannel({
          channel,
          mediaType,
          fileData: data,
          fileName,
          caption: msg.caption || '',
          source,
          postId
        });
      } catch (err) {
        console.error('[Telegram] Error downloading or dispatching media:', err);
        statsService.recordPlatformResults({
          channel,
          mediaType,
          results: {
            bale: { success: false, error: 'خطا در دریافت مدیا' },
            rubika: { success: false, error: 'خطا در دریافت مدیا' }
          }
        });
      }
    }
  }

  public async start(): Promise<void> {
    const token = config.settings.telegram_bot_token.trim();
    if (!token) {
      console.warn('[Telegram] Bot token is missing.');
      return;
    }

    this.bot = new Bot(token);

    // Connect failure alert listener to dispatcher
    dispatcher.onPlatformFailure = (info) => {
      this.sendFailureAlert(info).catch((err) => {
        console.error('[Telegram] Error sending failure alert:', err);
      });
    };

    // Auto-record admin chat IDs whenever an authorized admin interacts
    this.bot.use(async (ctx, next) => {
      if (ctx.from && this.isAuthorizedAdmin(ctx.from.username)) {
        config.addAdminChatId(ctx.from.id);
      }
      return next();
    });

    // ================= Channel Post Listener =================
    this.bot.on('channel_post', async (ctx) => {
      const chatHandle = ctx.channelPost.chat.username ? `@${ctx.channelPost.chat.username}` : String(ctx.channelPost.chat.id);
      const matched = config.getChannelByTelegram(chatHandle);

      if (!matched) {
        console.log(`[Telegram] Post from unmonitored channel: ${chatHandle}`);
        return;
      }

      console.log(`[Telegram] Received post for channel "${matched.title}" (${matched.telegram_id})`);

      // Album grouping
      if (ctx.channelPost.media_group_id) {
        const mgId = ctx.channelPost.media_group_id;
        const existing = this.albumBuffer.get(mgId);

        if (!existing) {
          const timer = setTimeout(async () => {
            const entry = this.albumBuffer.get(mgId);
            this.albumBuffer.delete(mgId);
            if (entry) {
              for (const m of entry.messages) {
                await this.processChannelMessage(m, matched);
              }
            }
          }, 1500);

          this.albumBuffer.set(mgId, { messages: [ctx.channelPost], timer });
        } else {
          existing.messages.push(ctx.channelPost);
        }
        return;
      }

      // Single message
      await this.processChannelMessage(ctx.channelPost, matched);
    });

    // ================= Auto-Detect Sikaap Social Group & Commands =================
    this.bot.use(async (ctx, next) => {
      if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
        const title = (ctx.chat.title || '').trim();
        if (title.includes('سوشال') || title.includes('سیکاپ') || title.toLowerCase().includes('social')) {
          if (config.settings.report_group_id !== String(ctx.chat.id)) {
            config.updateSettings({
              report_group_id: String(ctx.chat.id),
              report_group_title: title
            });
            console.log(`[Telegram] Auto-detected and bound report group: "${title}" (${ctx.chat.id})`);
          }
        }
      }
      await next();
    });

    this.bot.on('my_chat_member', async (ctx) => {
      if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
        const title = (ctx.chat.title || '').trim();
        if (title.includes('سوشال') || title.includes('سیکاپ') || title.toLowerCase().includes('social')) {
          config.updateSettings({
            report_group_id: String(ctx.chat.id),
            report_group_title: title
          });
          console.log(`[Telegram] Bot status updated in "${title}". Set as daily report destination.`);
        }
      }
    });

    this.bot.command(['setreport', 'set_report'], async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.reply('⛔ شما دسترسی ادمین ندارید.');
      }
      if (ctx.chat.type === 'private') {
        return ctx.reply('⚠️ لطفاً این دستور را در داخل گروه «سیکاپ سوشال» ارسال کنید تا آیدی گروه به عنوان مقصد گزارش تنظیم شود.');
      }
      const title = ctx.chat.title || 'سیکاپ سوشال';
      config.updateSettings({
        report_group_id: String(ctx.chat.id),
        report_group_title: title
      });
      await ctx.reply(
        `✅ <b>گروه با موفقیت به عنوان مقصد گزارش روزانه تنظیم شد!</b>\n\n` +
        `گزارش عملکرد کانال‌ها هر روز رأس ساعت ۱۹:۰۰ در گروه <b>${title}</b> منتشر خواهد شد.\n` +
        `🔹 شناسه گروه: <code>${ctx.chat.id}</code>`,
        { parse_mode: 'HTML' }
      );
    });

    // ================= Manual Report Commands =================
    // 1. Send report directly to group
    const handleSendReportToGroup = async (ctx: any) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.reply('⛔ شما دسترسی ادمین ندارید.');
      }

      // If called inside a group and group id not set yet, bind it
      if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        if (!config.settings.report_group_id) {
          config.updateSettings({
            report_group_id: String(ctx.chat.id),
            report_group_title: ctx.chat.title || 'سیکاپ سوشال'
          });
        }
      }

      const destId = (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')
        ? String(ctx.chat.id)
        : config.settings.report_group_id;

      if (!destId) {
        return ctx.reply(
          '⚠️ <b>آیدی گروه سیکاپ سوشال تنظیم نشده است!</b>\n\n' +
          'لطفاً یا ربات را به گروه اضافه کرده و دستور <code>/setreport</code> را در آن بفرستید، یا این دستور را مستقیماً داخل گروه اجرا کنید.',
          { parse_mode: 'HTML' }
        );
      }

      await ctx.reply('⏳ در حال آماده‌سازی و ارسال گزارش به گروه...');
      const res = await dailyReportScheduler.sendDailyReport(destId);

      if (res.success) {
        const title = config.settings.report_group_title || 'سیکاپ سوشال';
        await ctx.reply(
          `✅ <b>گزارش روزانه با موفقیت به گروه ${title} ارسال شد!</b>`,
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply(`❌ خطا در ارسال گزارش:\n${res.error}`, { parse_mode: 'HTML' });
      }
    };

    // 2. View/preview report right here
    const handlePreviewReportHere = async (ctx: any) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.reply('⛔ شما دسترسی ادمین ندارید.');
      }
      const reportHtml = await statsService.generateReportHtml();
      const kb = new InlineKeyboard().text('🚀 ارسال همین گزارش به گروه سیکاپ سوشال', 'cb:send_report_now');
      await ctx.reply(reportHtml, {
        parse_mode: 'HTML',
        reply_markup: kb
      });
    };

    // Slash Commands
    this.bot.command(['sendreport', 'send_report'], handleSendReportToGroup);
    this.bot.command(['report', 'dailyreport'], handlePreviewReportHere);

    // Natural Persian triggers (text messages without slash)
    this.bot.hears([
      /^(\/)?گزارش(\s*بده)?$/i,
      /^گزارش$/i,
      /^گزارش بده$/i,
      /^گزارش امروز$/i,
      /^وضعیت گزارش$/i
    ], handlePreviewReportHere);

    this.bot.hears([
      /^(\/)?(ارسال_گزارش|ارسال گزارش)(\s*به\s*گروه)?$/i,
      /^گزارش رو بفرست$/i,
      /^گزارش بفرست$/i,
      /^ارسال گزارش$/i
    ], handleSendReportToGroup);

    this.bot.command(['report_status'], async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) return;
      await ctx.reply(this.renderDailyReportHtml(), {
        parse_mode: 'HTML',
        reply_markup: this.getDailyReportKeyboard()
      });
    });

    // ================= Admin PV Commands =================
    this.bot.command(['start', 'admin', 'menu', 'status'], async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        await ctx.reply(
          '⛔ <b>دسترسی غیرمجاز!</b>\n\n' +
          'این ربات خصوصی بوده و فقط برای ادمین‌های مجاز فعال است.',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const userName = ctx.from?.first_name || 'ادمین';
      const cleanUser = (ctx.from?.username || '').toLowerCase().replace(/^@/, '');

      if (this.isRestrictedAdmin(cleanUser)) {
        const yakashefKb = new InlineKeyboard()
          .text('🌙 ارسال محتوا به یاکاشف الکرب', 'cb:ali_yakashef_guide')
          .row()
          .text('⏰ پست‌های زمان‌بندی‌شده من', 'cb:list_scheduled');

        await ctx.reply(
          `سلام <b>${userName}</b> عزیز خوش آمدید! 🌸\n\n` +
          `شما دسترسی محتواگذاری برای کانال <b>یاکاشف الکرب</b> را دارید.\n\n` +
          `🔹 کافیست هر ویدیو، عکس، وویس یا فایلی که می‌خواهید را مستقیماً در این چت ارسال نمایید تا به سادگی به صورت فوری یا با <b>زمان‌بندی (تایم‌بندی)</b> در کانال و پیام‌رسان‌های متصل بازنشر شود.`,
          {
            parse_mode: 'HTML',
            reply_markup: yakashefKb
          }
        );
        return;
      }

      await ctx.reply(this.renderMainMenuHtml(userName), {
        parse_mode: 'HTML',
        reply_markup: this.getMainMenuKeyboard()
      });
    });

    // ================= Scheduled Posts Command (/scheduled, /schedule) =================
    this.bot.command(['scheduled', 'schedule', 'queue'], async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.reply('⛔ شما دسترسی ادمین ندارید.');
      }
      await this.showScheduledPostsList(ctx);
    });

    // ================= Channel Management Command (/addchannel, /add_channel) =================
    this.bot.command(['addchannel', 'add_channel', 'newchannel'], async (ctx) => {
      if (!this.isFullAdmin(ctx.from?.username)) {
        return ctx.reply('⛔ شما دسترسی مدیریت کانال‌ها را ندارید.');
      }

      const match = (ctx.match || '').trim();
      if (!match) {
        // Start interactive wizard
        if (ctx.from) {
          this.pendingChannelWizard.set(ctx.from.id, {
            step: 'title',
            data: {},
            timestamp: Date.now()
          });
        }
        const cancelKb = new InlineKeyboard().text('❌ انصراف', 'cb:cancel_wizard');
        return ctx.reply(
          `➕ <b>افزودن کانال جدید برای بازنشر (مرحله ۱ از ۴)</b>\n\n` +
          `لطفاً <b>نام یا عنوان کانال</b> را ارسال کنید (مثال: <code>سیکاپ استایل</code>):\n\n` +
          `💡 <i>همچنین می‌توانید به صورت یکجا با فرمت زیر اضافه کنید:</i>\n` +
          `<code>/addchannel نام_کانال مبدأ_تلگرام مقصد_بله مقصد_روبیکا</code>\n` +
          `مثال:\n` +
          `<code>/addchannel سیکاپ پلاس @sikaapplus @sikaapplus @sikaapplus</code>`,
          { parse_mode: 'HTML', reply_markup: cancelKb }
        );
      }

      // Fast one-line command parsing
      const tokens = match.split(/\s+/);
      const tgIdx = tokens.findIndex(t => t.startsWith('@') || t.startsWith('-100'));

      if (tgIdx === -1 || tgIdx === 0) {
        return ctx.reply(
          `⚠️ <b>فرمت دستور نامعتبر است!</b>\n\n` +
          `فرمت صحیح:\n` +
          `<code>/addchannel نام_کانال مبدأ_تلگرام مقصد_بله مقصد_روبیکا [مقصد_ایتا]</code>\n\n` +
          `مثال:\n` +
          `<code>/addchannel سیکاپ فناوری @sikaaptech @sikaaptech @sikaaptech</code>`,
          { parse_mode: 'HTML' }
        );
      }

      const title = tokens.slice(0, tgIdx).join(' ').trim();
      const tgId = tokens[tgIdx].trim();
      const baleId = tokens[tgIdx + 1] ? tokens[tgIdx + 1].trim() : '';
      const rubikaId = tokens[tgIdx + 2] ? tokens[tgIdx + 2].trim() : '';
      const eitaaId = tokens[tgIdx + 3] ? tokens[tgIdx + 3].trim() : '';

      const newCh = config.addChannel({
        title,
        telegram_id: tgId,
        bale_id: baleId,
        rubika_id: rubikaId,
        eitaa_id: eitaaId,
        is_active: true
      });

      const kb = new InlineKeyboard()
        .text('🚀 ارسال پست تست به این کانال', `cb:test_post:${newCh.id}`)
        .row()
        .text('🔙 بازگشت به منوی اصلی', 'cb:main_menu');

      await ctx.reply(
        `🎉 <b>کانال جدید با موفقیت اضافه و فعال شد!</b>\n\n` +
        `▫️ <b>نام کانال:</b> <b>${newCh.title}</b>\n` +
        `▫️ <b>مبدأ تلگرام:</b> <code>${newCh.telegram_id}</code>\n` +
        `▫️ <b>مقصد بله:</b> <code>${newCh.bale_id || '(ندارد)'}</code>\n` +
        `▫️ <b>مقصد روبیکا:</b> <code>${newCh.rubika_id || '(ندارد)'}</code>\n` +
        (newCh.eitaa_id ? `▫️ <b>مقصد ایتا:</b> <code>${newCh.eitaa_id}</code>\n` : '') +
        `▫️ <b>وضعیت:</b> 🟢 فعال و در حال رصد آنی`,
        { parse_mode: 'HTML', reply_markup: kb }
      );
    });

    // ================= Image Generation Command (/image, /img, /photo) =================
    this.bot.command(['image', 'img', 'photo', 'art', 'draw'], async (ctx) => {
      const match = (ctx.match || '').trim();
      const replyOptions: any = {
        reply_to_message_id: ctx.message.message_id
      };
      if ((ctx.message as any).message_thread_id) {
        replyOptions.message_thread_id = (ctx.message as any).message_thread_id;
      }

      if (!match) {
        return ctx.reply(
          '🎨 <b>ساخت تصویر با هوش مصنوعی</b>\n\n' +
          'لطفاً بعد از دستور، توضیحات عکسی که می‌خواهید را بنویسید:\n' +
          'مثال:\n' +
          '<code>/image یک گربه فضانورد در فضا با لباس فضایی به سبک واقع‌گرایانه</code>',
          { parse_mode: 'HTML', ...replyOptions }
        );
      }

      try {
        await ctx.replyWithChatAction('upload_photo');
      } catch {}

      const waitMsg = await ctx.reply('🎨 در حال طراحی و ساخت تصویر با هوش مصنوعی، لطفاً چند لحظه صبر کنید...', replyOptions);

      try {
        const result = await geminiService.generateImage(match);
        const inputFile = new InputFile(result.buffer, 'generated.jpg');

        await ctx.replyWithPhoto(inputFile, {
          caption: `✨ <b>تصویر ساخته شده:</b>\n<i>${match}</i>`,
          parse_mode: 'HTML',
          ...replyOptions
        });

        // Delete the temporary wait message
        try {
          await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
        } catch {}
      } catch (err: any) {
        console.error('[Telegram] Image generation error:', err);
        try {
          await ctx.api.editMessageText(
            ctx.chat.id,
            waitMsg.message_id,
            `❌ متاسفانه در ساخت تصویر مشکلی پیش آمد: ${err?.message || 'خطای سرور'}`
          );
        } catch {
          await ctx.reply(`❌ خطا در ساخت تصویر: ${err?.message || 'خطای سرور'}`, replyOptions);
        }
      }
    });

    // ================= Gemini AI Group Assistant & Channel Wizard =================
    this.bot.on('message:text', async (ctx, next) => {
      const text = ctx.message.text || '';

      // Check custom schedule input in private chat
      if (ctx.chat.type === 'private' && ctx.from && this.isAuthorizedAdmin(ctx.from.username)) {
        const schedEntry = this.pendingSchedule.get(String(ctx.from.id));
        if (schedEntry) {
          if (text.startsWith('/cancel') || text === 'انصراف' || text === 'لغو') {
            this.pendingSchedule.delete(String(ctx.from.id));
            await ctx.reply('❌ تنظیم زمان‌بندی لغو شد.', {
              reply_markup: new InlineKeyboard().text('🔙 بازگشت به منوی اصلی', 'cb:main_menu')
            });
            return;
          }

          const pending = this.pendingUploads.get(schedEntry.uploadKey);
          if (!pending) {
            this.pendingSchedule.delete(String(ctx.from.id));
            await ctx.reply('⚠️ اطلاعات فایل منقضی شده است. لطفاً فایل را دوباره بفرستید.');
            return;
          }

          let scheduledTime: number | null = null;
          const trimmed = text.trim();
          const now = Date.now();

          // Pattern 1: relative minutes (e.g. "45m" or "45 دقیقه" or "45دقیقه")
          const minMatch = trimmed.match(/^(\d+)\s*(m|دقیقه|min)?$/i);
          if (minMatch && (trimmed.includes('m') || trimmed.includes('دقیقه') || trimmed.includes('min'))) {
            const minutes = parseInt(minMatch[1], 10);
            if (minutes > 0) {
              scheduledTime = now + minutes * 60 * 1000;
            }
          }

          // Pattern 2: HH:MM (e.g. "21:30" or "8:00")
          const timeMatch = trimmed.match(/^(\d{1,2})[:：](\d{1,2})$/);
          if (timeMatch) {
            const hour = parseInt(timeMatch[1], 10);
            const minute = parseInt(timeMatch[2], 10);
            if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) {
              const { dateKey } = statsService.getTehranInfo(new Date());
              let candidate = new Date(`${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:30`).getTime();
              // If time is in the past for today, schedule for tomorrow
              if (candidate <= now) {
                const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
                const tInfo = statsService.getTehranInfo(tomorrow);
                candidate = new Date(`${tInfo.dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+03:30`).getTime();
              }
              scheduledTime = candidate;
            }
          }

          // Pattern 3: Full Date & Time (e.g. "2026-10-15 14:30")
          if (!scheduledTime) {
            try {
              const parsed = new Date(trimmed.replace(' ', 'T') + '+03:30').getTime();
              if (!isNaN(parsed) && parsed > now) {
                scheduledTime = parsed;
              }
            } catch {}
          }

          if (!scheduledTime) {
            await ctx.reply(
              `⚠️ <b>فرمت زمان وارد شده نامعتبر است!</b>\n\n` +
              `لطفاً به یکی از فرمت‌های زیر بفرستید:\n` +
              `▫️ فقط ساعت: <code>21:30</code> یا <code>14:00</code>\n` +
              `▫️ بر حسب دقیقه: <code>45 دقیقه</code> یا <code>20m</code>\n` +
              `▫️ تاریخ و ساعت: <code>2026-10-15 15:00</code>\n\n` +
              `یا برای لغو بنویسید <b>انصراف</b>.`,
              { parse_mode: 'HTML' }
            );
            return;
          }

          const scheduledItem = postScheduler.addScheduledPost({
            targetChannelId: schedEntry.targetId,
            mediaType: pending.mediaType,
            fileId: pending.fileId,
            fileName: pending.fileName,
            caption: pending.caption,
            source: `@${ctx.from?.username || ctx.from?.first_name || 'Admin'}`,
            scheduledTime,
            creatorUsername: ctx.from?.username
          });

          this.pendingSchedule.delete(String(ctx.from.id));
          this.pendingUploads.delete(schedEntry.uploadKey);

          const targetTitle = schedEntry.targetId === 'all'
            ? 'تمام کانال‌ها'
            : (config.settings.channels.find(c => c.id === schedEntry.targetId)?.title || schedEntry.targetId);

          const successKb = new InlineKeyboard()
            .text('📋 مشاهده لیست پست‌های زمان‌بندی‌شده', 'cb:list_scheduled')
            .row()
            .text('🔙 بازگشت به منوی اصلی', 'cb:main_menu');

          await ctx.reply(
            `✅ <b>پست با موفقیت در زمان دلخواه شما زمان‌بندی شد!</b>\n\n` +
            `📢 <b>کانال مقصد:</b> <b>${targetTitle}</b>\n` +
            `⏰ <b>زمان انتشار:</b> <code>${scheduledItem.scheduledTimeStr}</code>\n` +
            `🆔 <b>کد رهگیری:</b> <code>${scheduledItem.id}</code>\n\n` +
            `💡 ربات در زمان تنظیم‌شده به صورت خودکار محتوا را منتشر خواهد کرد.`,
            {
              parse_mode: 'HTML',
              reply_markup: successKb
            }
          );
          return;
        }
      }

      // Check channel addition wizard in private chat
      if (ctx.chat.type === 'private' && ctx.from && this.isAuthorizedAdmin(ctx.from.username)) {
        const wizard = this.pendingChannelWizard.get(ctx.from.id);
        if (wizard) {
          if (text.startsWith('/cancel') || text === 'انصراف' || text === 'لغو') {
            this.pendingChannelWizard.delete(ctx.from.id);
            await ctx.reply('❌ عملیات افزودن کانال لغو شد.', {
              reply_markup: new InlineKeyboard().text('🔙 بازگشت به منوی اصلی', 'cb:main_menu')
            });
            return;
          }

          // Step 1: Channel Title
          if (wizard.step === 'title') {
            const title = text.trim();
            if (!title) {
              await ctx.reply('⚠️ لطفاً یک نام معتبر برای کانال وارد کنید:');
              return;
            }
            wizard.data.title = title;
            wizard.step = 'telegram_id';
            const cancelKb = new InlineKeyboard().text('❌ انصراف', 'cb:cancel_wizard');
            await ctx.reply(
              `✅ نام کانال: <b>${title}</b>\n\n` +
              `📍 <b>مرحله ۲ از ۴: آیدی مبدأ تلگرام</b>\n\n` +
              `لطفاً آیدی کانال تلگرام مبدأ را بفرستید:\n` +
              `مثال: <code>@sikaaphealth</code> یا <code>-1001234567890</code>`,
              { parse_mode: 'HTML', reply_markup: cancelKb }
            );
            return;
          }

          // Step 2: Source Telegram Handle
          if (wizard.step === 'telegram_id') {
            let tgId = text.trim();
            if (!tgId.startsWith('@') && !tgId.startsWith('-')) {
              tgId = `@${tgId}`;
            }
            wizard.data.telegram_id = tgId;
            wizard.step = 'bale_id';
            const cancelKb = new InlineKeyboard().text('❌ انصراف', 'cb:cancel_wizard');
            await ctx.reply(
              `✅ مبدأ تلگرام: <code>${tgId}</code>\n\n` +
              `📍 <b>مرحله ۳ از ۴: آیدی مقصد در پیام‌رسان بله (Bale)</b>\n\n` +
              `لطفاً آیدی کانال مقصد در بله را بفرستید (مثال: <code>@sikaaphealth</code>):\n` +
              `<i>اگر این کانال به بله فوروارد نمی‌شود، عدد <code>-</code> یا کلمه <b>ندارد</b> را بفرستید.</i>`,
              { parse_mode: 'HTML', reply_markup: cancelKb }
            );
            return;
          }

          // Step 3: Destination Bale Handle
          if (wizard.step === 'bale_id') {
            const inputVal = text.trim();
            wizard.data.bale_id = (inputVal === '-' || inputVal.toLowerCase() === 'none' || inputVal === 'ندارد') ? '' : inputVal;
            wizard.step = 'rubika_id';
            const cancelKb = new InlineKeyboard().text('❌ انصراف', 'cb:cancel_wizard');
            await ctx.reply(
              `✅ مقصد بله: <code>${wizard.data.bale_id || '(ندارد)'}</code>\n\n` +
              `📍 <b>مرحله ۴ از ۴: آیدی مقصد در روبیکا (Rubika)</b>\n\n` +
              `لطفاً آیدی کانال مقصد در روبیکا را بفرستید (مثال: <code>@sikaaphealth</code>):\n` +
              `<i>اگر این کانال به روبیکا فوروارد نمی‌شود، عدد <code>-</code> یا کلمه <b>ندارد</b> را بفرستید.</i>`,
              { parse_mode: 'HTML', reply_markup: cancelKb }
            );
            return;
          }

          // Step 4: Destination Rubika Handle
          if (wizard.step === 'rubika_id') {
            const inputVal = text.trim();
            wizard.data.rubika_id = (inputVal === '-' || inputVal.toLowerCase() === 'none' || inputVal === 'ندارد') ? '' : inputVal;

            // Complete and save!
            const added = config.addChannel({
              title: wizard.data.title || 'کانال جدید',
              telegram_id: wizard.data.telegram_id || '',
              bale_id: wizard.data.bale_id || '',
              rubika_id: wizard.data.rubika_id || '',
              is_active: true
            });

            this.pendingChannelWizard.delete(ctx.from.id);

            const successKb = new InlineKeyboard()
              .text('🚀 ارسال پست تست به این کانال', `cb:test_post:${added.id}`)
              .row()
              .text('🔙 بازگشت به منوی اصلی', 'cb:main_menu');

            await ctx.reply(
              `🎉 <b>کانال جدید با موفقیت اضافه و فعال شد!</b>\n\n` +
              `▫️ <b>نام کانال:</b> <b>${added.title}</b>\n` +
              `▫️ <b>مبدأ تلگرام:</b> <code>${added.telegram_id}</code>\n` +
              `▫️ <b>مقصد بله:</b> <code>${added.bale_id || '(ندارد)'}</code>\n` +
              `▫️ <b>مقصد روبیکا:</b> <code>${added.rubika_id || '(ندارد)'}</code>\n` +
              `▫️ <b>وضعیت بازنشر:</b> 🟢 فعال و در حال رصد آنی\n\n` +
              `از این پس تمام پست‌ها و مدیاهای ارسالی در کانال مبدأ تلگرام، به طور خودکار به مقاصد بالا بازنشر خواهند شد.`,
              { parse_mode: 'HTML', reply_markup: successKb }
            );
            return;
          }
        }
      }

      // Skip slash commands (handled by bot.command)
      if (text.startsWith('/')) {
        return next();
      }

      const botUsername = (ctx.me?.username || 'bot').toLowerCase().replace(/^@/, '');
      const botId = ctx.me?.id || 0;
      const textLower = text.toLowerCase();

      // Check if bot was explicitly tagged or mentioned
      const hasUsernameInText = textLower.includes(`@${botUsername}`) || textLower.includes(botUsername);
      const hasBotNameInText =
        Boolean(textLower.match(/(?:ادمین|بات|ربات)[\s_]*(?:سیکاپ|سبکاپ|sikaap)/i)) ||
        Boolean(textLower.match(/(?:سیکاپ|سبکاپ|sikaap)[\s_]*(?:ادمین|بات|ربات|admin|bot)/i)) ||
        textLower.includes('ادمین سیکاپ') ||
        textLower.includes('سیکاپ ادمین') ||
        textLower.includes('ادمین بات');

      const hasMentionEntity = Boolean(ctx.message.entities?.some(e => {
        if (e.type === 'mention') {
          const mentionText = text.substring(e.offset, e.offset + e.length).toLowerCase().replace(/^@/, '');
          return mentionText === botUsername;
        }
        if (e.type === 'text_mention') {
          return (e as any).user?.id === botId || (e as any).user?.username?.toLowerCase()?.replace(/^@/, '') === botUsername;
        }
        return false;
      }));

      // Check if message is a reply to a message sent by this bot
      const replyFromId = ctx.message.reply_to_message?.from?.id;
      const replyFromUsername = ctx.message.reply_to_message?.from?.username?.toLowerCase()?.replace(/^@/, '');
      const isReplyToBot = replyFromId === botId || replyFromUsername === botUsername;

      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      const isMentioned = hasUsernameInText || hasBotNameInText || hasMentionEntity;

      const senderName = ctx.from?.first_name
        ? `${ctx.from.first_name}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''}`
        : (ctx.from?.username ? `@${ctx.from.username}` : 'همکار گرامی');

      console.log(`[Telegram Group Msg] Chat: "${ctx.chat?.title || ctx.chat?.id}" | From: "${senderName}" | Mentioned: ${isMentioned} | Reply: ${isReplyToBot} | Text: "${text.slice(0, 60)}"`);

      // In groups: ONLY respond when explicitly tagged/mentioned or replied directly to this bot's own message.
      // In private: respond to authorized admins who talk to the bot.
      const shouldRespond = isGroup ? (isMentioned || isReplyToBot) : this.isAuthorizedAdmin(ctx.from?.username);

      if (!shouldRespond) {
        return next();
      }

      const replyOptions: any = {
        reply_to_message_id: ctx.message.message_id
      };
      if ((ctx.message as any).message_thread_id) {
        replyOptions.message_thread_id = (ctx.message as any).message_thread_id;
      }

      if (!geminiService.isEnabled()) {
        if (isMentioned || isReplyToBot) {
          try {
            await ctx.reply('⚠️ هوش مصنوعی «ادمین سیکاپ» هنوز فعال نشده یا کلید API تنظیم نشده است.', replyOptions);
          } catch {
            await ctx.reply('⚠️ هوش مصنوعی «ادمین سیکاپ» هنوز فعال نشده یا کلید API تنظیم نشده است.');
          }
        }
        return;
      }

      // Clean the @mention from the question so Gemini receives the clean query
      const cleanedPrompt = text
        .replace(new RegExp(`@?${botUsername}\\b`, 'gi'), '')
        .replace(/(?:ادمین|بات|ربات)[\s_]*(?:سیکاپ|سبکاپ|sikaap)/gi, '')
        .replace(/(?:سیکاپ|سبکاپ|sikaap)[\s_]*(?:ادمین|بات|ربات|admin|bot)/gi, '')
        .replace(/ادمین\s+بات/gi, '')
        .trim();

      // If user just tagged the bot without any message
      if (!cleanedPrompt) {
        const welcomeText = 'جانم؟ در خدمتم! 😄 بگو چطور می‌تونم کمکت کنم؟';
        try {
          await ctx.reply(welcomeText, { parse_mode: 'HTML', ...replyOptions });
        } catch {
          await ctx.reply(welcomeText, { parse_mode: 'HTML' });
        }
        return;
      }

      // Check if user is asking in natural language to generate/draw an image
      const isImageRequest =
        Boolean(cleanedPrompt.match(/(?:عکس|تصویر|نقاشی)\s*(?:از|یه|یک)?\s*(.+?)\s*(?:بساز|بکش|طراحی کن|تولید کن)/i)) ||
        Boolean(cleanedPrompt.match(/(?:برام|واسم)\s*(?:عکس|تصویر|نقاشی)\s*(.+?)\s*(?:بساز|بکش|طراحی کن)/i));

      if (isImageRequest) {
        const promptMatch = cleanedPrompt
          .replace(/^(?:لطفاً|لطفا|میشه|میتونی)?\s*/i, '')
          .replace(/(?:عکس|تصویر|نقاشی)\s*(?:از|یه|یک)?\s*/i, '')
          .replace(/\s*(?:بساز|بکش|طراحی کن|تولید کن).*$/i, '')
          .trim();

        const imagePrompt = promptMatch || cleanedPrompt;

        try {
          await ctx.replyWithChatAction('upload_photo');
        } catch {}

        const waitMsg = await ctx.reply('🎨 در حال ساخت تصویر، چند لحظه صبر کنید...', replyOptions);

        try {
          const result = await geminiService.generateImage(imagePrompt);
          const inputFile = new InputFile(result.buffer, 'generated.jpg');

          await ctx.replyWithPhoto(inputFile, {
            caption: `✨ <b>تصویر ساخته شده:</b>\n<i>${imagePrompt}</i>`,
            parse_mode: 'HTML',
            ...replyOptions
          });

          try {
            await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
          } catch {}
          return;
        } catch (err: any) {
          console.error('[Telegram] Image generation error from chat:', err);
          try {
            await ctx.api.editMessageText(
              ctx.chat.id,
              waitMsg.message_id,
              `❌ متاسفانه در ساخت تصویر مشکلی پیش آمد: ${err?.message || 'خطا در ارتباط با هوش مصنوعی'}`
            );
          } catch {}
          return;
        }
      }

      // Send typing status in Telegram while Gemini thinks
      try {
        await ctx.replyWithChatAction('typing');
      } catch {}

      const replyToText = ctx.message.reply_to_message && 'text' in ctx.message.reply_to_message
        ? (ctx.message.reply_to_message as any).text
        : undefined;

      // Include channel stats summary if user is asking about posts, channels, or stats
      let channelSummary: string | undefined;
      if (text.includes('کانال') || text.includes('پست') || text.includes('گزارش') || text.includes('امروز') || text.includes('آمار')) {
        try {
          const stats = statsService.getDayStats();
          channelSummary = `تعداد کل پست‌های امروز: ${stats.total_posts}\nجزئیات کانال‌ها:\n` +
            Object.values(stats.channels).map((c: any) => `- ${c.channel_title}: ${c.total_posts} پست (روزهای متوالی بدون پست: ${c.consecutive_empty_days})`).join('\n');
        } catch {}
      }

      try {
        const aiReply = await geminiService.generateReply(cleanedPrompt, {
          chatId: ctx.chat.id,
          senderName,
          replyToText,
          channelSummary
        });

        // Split into chunks if exceeds Telegram 4000 characters limit
        if (aiReply.length > 4000) {
          for (let i = 0; i < aiReply.length; i += 4000) {
            const chunk = aiReply.substring(i, i + 4000);
            try {
              await ctx.reply(chunk, i === 0 ? replyOptions : undefined);
            } catch {
              await ctx.reply(chunk);
            }
          }
        } else {
          try {
            await ctx.reply(aiReply, replyOptions);
          } catch {
            await ctx.reply(aiReply);
          }
        }
      } catch (err: any) {
        console.error('[Telegram] Error generating or sending Gemini reply:', err);
        try {
          await ctx.reply('⚠️ متاسفانه در دریافت پاسخ از هوش مصنوعی خطایی رخ داد. لطفاً دوباره امتحان کنید.', replyOptions);
        } catch {
          await ctx.reply('⚠️ متاسفانه در دریافت پاسخ از هوش مصنوعی خطایی رخ داد. لطفاً دوباره امتحان کنید.');
        }
      }
    });

    // ================= Voice & Audio Transcription (Whisper AI) =================
    this.bot.on(['message:voice', 'message:audio'], async (ctx, next) => {
      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
      const fileId = ctx.message.voice?.file_id || ctx.message.audio?.file_id;

      // In groups: if user replies to the bot with a voice or asks bot
      const replyFromId = ctx.message.reply_to_message?.from?.id;
      const botId = ctx.me?.id || 0;
      const isReplyToBot = replyFromId === botId;

      if (isGroup && !isReplyToBot) {
        return next();
      }

      // If in group or in private: offer voice-to-text
      if (fileId && (isReplyToBot || (!isGroup && !this.isAuthorizedAdmin(ctx.from?.username)))) {
        try {
          await ctx.replyWithChatAction('typing');
          const dl = await this.downloadTelegramFile(fileId);
          const text = await geminiService.transcribeAudio(Buffer.from(dl.data), dl.fileName || 'voice.ogg');

          const replyOptions: any = { reply_to_message_id: ctx.message.message_id };
          if ((ctx.message as any).message_thread_id) {
            replyOptions.message_thread_id = (ctx.message as any).message_thread_id;
          }

          await ctx.reply(`🎙️ <b>متن پیام صوتی:</b>\n\n"${text}"`, {
            parse_mode: 'HTML',
            ...replyOptions
          });
          return;
        } catch (err: any) {
          console.error('[Whisper Error]:', err);
        }
      }

      return next();
    });

    // ================= Admin PV Media Uploader (Video/Photo to Yakashef & Channels) =================
    this.bot.on(['message:video', 'message:photo', 'message:document', 'message:animation', 'message:voice', 'message:audio'], async (ctx, next) => {
      // Only process for authorized admins in private chat
      if (ctx.chat.type !== 'private') {
        return next();
      }

      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        await ctx.reply('⛔ شما دسترسی ادمین ندارید.');
        return;
      }

      const msg = ctx.message as any;
      let mediaType = 'video';
      let fileId = '';
      let defaultFileName = 'video.mp4';

      if (msg.video) {
        mediaType = 'video';
        fileId = msg.video.file_id;
        defaultFileName = msg.video.file_name || 'video.mp4';
      } else if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
        mediaType = 'photo';
        fileId = msg.photo[msg.photo.length - 1].file_id;
        defaultFileName = 'photo.jpg';
      } else if (msg.document) {
        mediaType = 'document';
        fileId = msg.document.file_id;
        defaultFileName = msg.document.file_name || 'file';
      } else if (msg.animation) {
        mediaType = 'animation';
        fileId = msg.animation.file_id;
        defaultFileName = msg.animation.file_name || 'animation.mp4';
      } else if (msg.audio) {
        mediaType = 'audio';
        fileId = msg.audio.file_id;
        defaultFileName = msg.audio.file_name || 'audio.mp3';
      } else if (msg.voice) {
        mediaType = 'voice';
        fileId = msg.voice.file_id;
        defaultFileName = 'voice.ogg';
      }

      if (!fileId) {
        return next();
      }

      const uploadKey = `${ctx.from.id}_${Date.now()}`;
      this.pendingUploads.set(uploadKey, {
        mediaType,
        fileId,
        fileName: defaultFileName,
        caption: msg.caption || '',
        date: Date.now()
      });

      // Cleanup pending uploads older than 1 hour
      const oneHourAgo = Date.now() - 3600000;
      for (const [k, v] of this.pendingUploads.entries()) {
        if (v.date < oneHourAgo) this.pendingUploads.delete(k);
      }

      const mediaFa = mediaType === 'video' ? 'ویدیو' : (mediaType === 'photo' ? 'تصویر' : (mediaType === 'voice' || mediaType === 'audio' ? 'صوت' : 'فایل'));

      const usernameClean = (ctx.from.username || '').toLowerCase().replace(/^@/, '');
      const isRestricted = this.isRestrictedAdmin(usernameClean);

      const kb = new InlineKeyboard();
      for (let i = 0; i < config.settings.channels.length; i++) {
        const ch = config.settings.channels[i];
        if (!ch) continue;
        if (isRestricted && ch.id !== 'yakashef') continue; // restricted admin is restricted to yakashef

        let icon = '📢';
        if (ch.id === 'health') icon = '🏥';
        else if (ch.id === 'food') icon = '🍔';
        else if (ch.id === 'farayad') icon = '📚';
        else if (ch.id === 'yakashef') icon = '🌙';

        kb.text(`${icon} ${ch.title}`, `cb:up:${ch.id}:${uploadKey}`);
        if (i % 2 === 1) kb.row();
      }
      if (config.settings.channels.length % 2 !== 0 && !isAli) kb.row();

      if (!isAli) {
        kb.text('🌐 تمام کانال‌ها', `cb:up:all:${uploadKey}`).row();
      }
      kb.text('❌ انصراف', `cb:up:cancel:${uploadKey}`);

      await ctx.reply(
        `📥 <b>${mediaFa} جدید دریافت شد!</b>\n\n` +
        (msg.caption ? `📝 <b>کپشن:</b>\n<i>${msg.caption.slice(0, 180)}</i>\n\n` : '') +
        `👇 این محتوا به کدام کانال(ها) آپلود و بازنشر شود؟`,
        {
          parse_mode: 'HTML',
          reply_to_message_id: msg.message_id,
          reply_markup: kb
        }
      );
    });

    // Step 2 of Upload: Select Immediate or Scheduled
    this.bot.callbackQuery(/^cb:up:(.+):(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }

      const targetId = String(ctx.match[1] || '');
      const uploadKey = String(ctx.match[2] || '');

      if (targetId === 'cancel') {
        this.pendingUploads.delete(uploadKey);
        await ctx.answerCallbackQuery({ text: 'عملیات ارسال لغو شد.' });
        try {
          await ctx.editMessageText('❌ ارسال محتوا لغو شد.');
        } catch {}
        return;
      }

      if (!this.isChannelAllowedForUser(ctx.from?.username, targetId)) {
        return ctx.answerCallbackQuery({ text: '⛔ شما فقط دسترسی ارسال برای کانال یاکاشف الکرب را دارید.', show_alert: true });
      }

      const pending = this.pendingUploads.get(uploadKey);
      if (!pending) {
        return ctx.answerCallbackQuery({
          text: '⚠️ مهلت ارسال این محتوا منقضی شده است. لطفاً فایل را دوباره بفرستید.',
          show_alert: true
        });
      }

      await ctx.answerCallbackQuery();

      const targetTitle = targetId === 'all'
        ? 'تمام کانال‌ها'
        : (config.settings.channels.find(c => c.id === targetId)?.title || targetId);

      const actionKb = new InlineKeyboard()
        .text('⚡ ارسال فوری (هم‌اکنون)', `cb:send_now:${targetId}:${uploadKey}`)
        .row()
        .text('⏰ زمان‌بندی ارسال (تایم‌بندی)', `cb:sched_menu:${targetId}:${uploadKey}`)
        .row()
        .text('🔙 انصراف', `cb:up:cancel:${uploadKey}`);

      try {
        await ctx.editMessageText(
          `🎯 <b>کانال مقصد:</b> <b>${targetTitle}</b>\n\n` +
          `نحوه ارسال این محتوا را انتخاب کنید:\n` +
          `▫️ <b>ارسال فوری:</b> همین لحظه دانلود و به کانال‌های مقصد ارسال می‌گردد.\n` +
          `▫️ <b>زمان‌بندی ارسال:</b> در تاریخ یا ساعت دلخواه شما به طور خودکار منتشر می‌شود.`,
          {
            parse_mode: 'HTML',
            reply_markup: actionKb
          }
        );
      } catch {}
    });

    // Immediate Broadcast Execution
    this.bot.callbackQuery(/^cb:send_now:(.+):(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }

      const targetId = String(ctx.match[1] || '');
      const uploadKey = String(ctx.match[2] || '');

      if (!this.isChannelAllowedForUser(ctx.from?.username, targetId)) {
        return ctx.answerCallbackQuery({ text: '⛔ دسترسی غیرمجاز برای این کانال.', show_alert: true });
      }

      const pending = this.pendingUploads.get(uploadKey);
      if (!pending) {
        return ctx.answerCallbackQuery({
          text: '⚠️ مهلت ارسال این محتوا منقضی شده است. لطفاً فایل را دوباره بفرستید.',
          show_alert: true
        });
      }

      await ctx.answerCallbackQuery({ text: '⏳ در حال دانلود از تلگرام و آپلود به کانال‌ها...' });

      try {
        await ctx.editMessageText(
          '⏳ <b>در حال دانلود از سرور تلگرام و آپلود به کانال‌های مقصد...</b>\n\n' +
          'لطفاً چند لحظه شکیبا باشید (مدت زمان بسته به حجم فایل متغیر است)...',
          { parse_mode: 'HTML' }
        );
      } catch {}

      try {
        const { data, fileName } = await this.downloadTelegramFile(pending.fileId);
        const resolvedFileName = pending.fileName || fileName;

        const targetChannels = targetId === 'all'
          ? config.settings.channels.filter(c => c.is_active)
          : config.settings.channels.filter(c => c.id === targetId);

        if (targetChannels.length === 0) {
          try {
            await ctx.editMessageText('❌ کانال مقصد یافت نشد یا غیرفعال است.');
          } catch {}
          return;
        }

        const reportLines: string[] = [];

        for (const ch of targetChannels) {
          // Immediately record channel post in daily statistics
          statsService.recordChannelPost({
            channel: ch,
            mediaType: pending.mediaType,
            postId: `pv_${Date.now()}`
          });

          const results = await dispatcher.broadcastForChannel({
            channel: ch,
            mediaType: pending.mediaType,
            fileData: data,
            fileName: resolvedFileName,
            caption: pending.caption || '',
            source: `@${ctx.from?.username || ctx.from?.first_name || 'Admin'}`
          });

          const bRes = ch.bale_id ? (results.bale?.success ? '✅ بله' : `❌ بله (${results.bale?.error || 'خطا'})`) : '';
          const rRes = ch.rubika_id ? (results.rubika?.success ? '✅ روبیکا' : `❌ روبیکا (${results.rubika?.error || 'خطا'})`) : '';
          const eRes = ch.eitaa_id && config.settings.enable_eitaa && config.settings.eitaa_token
            ? (results.eitaa?.success ? '✅ ایتا' : `❌ ایتا`)
            : '';

          const parts = [bRes, rRes, eRes].filter(Boolean).join(' | ');
          reportLines.push(`▫️ <b>${ch.title}:</b> ${parts}`);
        }

        this.pendingUploads.delete(uploadKey);

        const summaryText =
          `✅ <b>محتوا با موفقیت آپلود و منتشر شد!</b>\n\n` +
          reportLines.join('\n') + `\n\n` +
          `📊 این محتوا در آمار کانال ثبت شده و در گزارش ساعت ۱۹:۰۰ لحاظ می‌شود.`;

        try {
          await ctx.editMessageText(summaryText, { parse_mode: 'HTML' });
        } catch {
          await ctx.reply(summaryText, { parse_mode: 'HTML' });
        }
      } catch (err: any) {
        console.error('[Telegram PV Upload] Error:', err);
        try {
          await ctx.editMessageText(`❌ خطا در آپلود محتوا:\n${err.message || String(err)}`);
        } catch {}
      }
    });

    // Scheduled Post Options Menu
    this.bot.callbackQuery(/^cb:sched_menu:(.+):(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }

      const targetId = String(ctx.match[1] || '');
      const uploadKey = String(ctx.match[2] || '');

      const targetTitle = targetId === 'all'
        ? 'تمام کانال‌ها'
        : (config.settings.channels.find(c => c.id === targetId)?.title || targetId);

      const kb = new InlineKeyboard()
        .text('⏳ ۱۵ دقیقه بعد', `cb:sched_set:${targetId}:${uploadKey}:15m`)
        .text('⏳ ۳۰ دقیقه بعد', `cb:sched_set:${targetId}:${uploadKey}:30m`)
        .row()
        .text('⏳ ۱ ساعت بعد', `cb:sched_set:${targetId}:${uploadKey}:1h`)
        .text('⏳ ۲ ساعت بعد', `cb:sched_set:${targetId}:${uploadKey}:2h`)
        .row()
        .text('🌅 فردا ساعت ۱۰:۰۰ صبح', `cb:sched_set:${targetId}:${uploadKey}:tomorrow_10`)
        .row()
        .text('🌆 فردا ساعت ۱۸:۰۰ عصر', `cb:sched_set:${targetId}:${uploadKey}:tomorrow_18`)
        .row()
        .text('✍️ تنظیم دستی زمان (پیام متنی)', `cb:sched_custom:${targetId}:${uploadKey}`)
        .row()
        .text('🔙 بازگشت', `cb:up:${targetId}:${uploadKey}`);

      await ctx.answerCallbackQuery();
      try {
        await ctx.editMessageText(
          `⏰ <b>تنظیم زمان‌بندی ارسال محتوا</b>\n\n` +
          `📢 <b>کانال مقصد:</b> <b>${targetTitle}</b>\n\n` +
          `یکی از زمان‌های پیشنهادی زیر را انتخاب کنید یا گزینه <b>«تنظیم دستی زمان»</b> را بزنید:`,
          {
            parse_mode: 'HTML',
            reply_markup: kb
          }
        );
      } catch {}
    });

    // Preset Schedule Execution
    this.bot.callbackQuery(/^cb:sched_set:(.+):(.+):(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }

      const targetId = String(ctx.match[1] || '');
      const uploadKey = String(ctx.match[2] || '');
      const preset = String(ctx.match[3] || '');

      if (!this.isChannelAllowedForUser(ctx.from?.username, targetId)) {
        return ctx.answerCallbackQuery({ text: '⛔ دسترسی غیرمجاز برای این کانال.', show_alert: true });
      }

      const pending = this.pendingUploads.get(uploadKey);
      if (!pending) {
        return ctx.answerCallbackQuery({
          text: '⚠️ اطلاعات این محتوا منقضی شده است.',
          show_alert: true
        });
      }

      let scheduledTimestamp = Date.now();
      const now = Date.now();

      if (preset === '15m') {
        scheduledTimestamp = now + 15 * 60 * 1000;
      } else if (preset === '30m') {
        scheduledTimestamp = now + 30 * 60 * 1000;
      } else if (preset === '1h') {
        scheduledTimestamp = now + 60 * 60 * 1000;
      } else if (preset === '2h') {
        scheduledTimestamp = now + 2 * 60 * 60 * 1000;
      } else if (preset === 'tomorrow_10' || preset === 'tomorrow_18') {
        const targetHour = preset === 'tomorrow_10' ? 10 : 18;
        // Calculate tomorrow in Tehran time
        const tomorrow = new Date(now + 24 * 60 * 60 * 1000);
        const { dateKey } = statsService.getTehranInfo(tomorrow);
        const targetUtc = new Date(`${dateKey}T${String(targetHour).padStart(2, '0')}:00:00+03:30`).getTime();
        scheduledTimestamp = isNaN(targetUtc) ? (now + 24 * 60 * 60 * 1000) : targetUtc;
      }

      const scheduledItem = postScheduler.addScheduledPost({
        targetChannelId: targetId,
        mediaType: pending.mediaType,
        fileId: pending.fileId,
        fileName: pending.fileName,
        caption: pending.caption,
        source: `@${ctx.from?.username || ctx.from?.first_name || 'Admin'}`,
        scheduledTime: scheduledTimestamp,
        creatorUsername: ctx.from?.username
      });

      this.pendingUploads.delete(uploadKey);
      await ctx.answerCallbackQuery({ text: '✅ پست با موفقیت زمان‌بندی شد!' });

      const targetTitle = targetId === 'all'
        ? 'تمام کانال‌ها'
        : (config.settings.channels.find(c => c.id === targetId)?.title || targetId);

      const successKb = new InlineKeyboard()
        .text('📋 مشاهده لیست پست‌های زمان‌بندی‌شده', 'cb:list_scheduled')
        .row()
        .text('🔙 بازگشت به منوی اصلی', 'cb:main_menu');

      try {
        await ctx.editMessageText(
          `✅ <b>پست با موفقیت در صف ارسال زمان‌بندی شد!</b>\n\n` +
          `📢 <b>کانال مقصد:</b> <b>${targetTitle}</b>\n` +
          `⏰ <b>زمان انتشار:</b> <code>${scheduledItem.scheduledTimeStr}</code>\n` +
          `🆔 <b>کد رهگیری:</b> <code>${scheduledItem.id}</code>\n\n` +
          `💡 ربات در موعد مقرر به صورت خودکار محتوا را منتشر کرده و در آمار ثبت خواهد کرد.`,
          {
            parse_mode: 'HTML',
            reply_markup: successKb
          }
        );
      } catch {}
    });

    // Custom Time Prompt
    this.bot.callbackQuery(/^cb:sched_custom:(.+):(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }

      const targetId = String(ctx.match[1] || '');
      const uploadKey = String(ctx.match[2] || '');

      if (!ctx.from) return;

      this.pendingSchedule.set(String(ctx.from.id), {
        targetId,
        uploadKey,
        timestamp: Date.now()
      });

      await ctx.answerCallbackQuery();

      const cancelKb = new InlineKeyboard().text('❌ انصراف', `cb:sched_menu:${targetId}:${uploadKey}`);

      try {
        await ctx.editMessageText(
          `✍️ <b>تنظیم دستی زمان ارسال</b>\n\n` +
          `لطفاً ساعت مورد نظر را ارسال کنید.\n\n` +
          `🔹 <b>نمونه‌های قابل قبول:</b>\n` +
          `▫️ فقط ساعت برای امروز (یا فردا اگر گذشته باشد): <code>21:30</code> یا <code>8:00</code>\n` +
          `▫️ تعداد دقیقه بعد: <code>45m</code> یا <code>45 دقیقه</code>\n` +
          `▫️ تاریخ و ساعت کامل میلادی: <code>2026-10-15 14:00</code>\n\n` +
          `ارسال متن <b>انصراف</b> برای لغو.`,
          {
            parse_mode: 'HTML',
            reply_markup: cancelKb
          }
        );
      } catch {}
    });

    // ================= Callbacks =================
    this.bot.callbackQuery('cb:main_menu', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const userName = ctx.from?.first_name || 'ادمین';
      try {
        await ctx.editMessageText(this.renderMainMenuHtml(userName), {
          parse_mode: 'HTML',
          reply_markup: this.getMainMenuKeyboard()
        });
      } catch {}
      await ctx.answerCallbackQuery();
    });

    // AI Provider Menu Callbacks
    this.bot.callbackQuery('cb:ai_menu', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      try {
        await ctx.editMessageText(this.renderAiSettingsHtml(), {
          parse_mode: 'HTML',
          reply_markup: this.getAiSettingsKeyboard()
        });
      } catch {}
      await ctx.answerCallbackQuery();
    });

    this.bot.callbackQuery(/^cb:set_ai:(auto|gemini|gemini_backup|gapgpt|gapgpt_gemma|gpt_6_luna)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }

      const selected = ctx.match[1] as 'auto' | 'gemini' | 'gemini_backup' | 'gapgpt' | 'gapgpt_gemma' | 'gpt_6_luna';
      config.updateSettings({ ai_provider: selected });

      const name = geminiService.getProviderDisplayName();
      await ctx.answerCallbackQuery({
        text: `✅ موتور فعال تغییر کرد به: ${name}`,
        show_alert: true
      });

      try {
        await ctx.editMessageText(this.renderAiSettingsHtml(), {
          parse_mode: 'HTML',
          reply_markup: this.getAiSettingsKeyboard()
        });
      } catch {}
    });

    this.bot.callbackQuery('cb:toggle_global', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const isPaused = config.toggleGlobalPause();
      const stateText = isPaused ? '🔴 سیستم متوقف شد (Pause)' : '🟢 سیستم فعال شد (Resume)';
      await ctx.answerCallbackQuery({ text: stateText, show_alert: true });

      const userName = ctx.from?.first_name || 'ادمین';
      try {
        await ctx.editMessageText(this.renderMainMenuHtml(userName), {
          parse_mode: 'HTML',
          reply_markup: this.getMainMenuKeyboard()
        });
      } catch {}
    });

    this.bot.callbackQuery('cb:toggle_approval', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const enabled = config.toggleApprovalMode();
      const txt = enabled ? '🟢 حالت تایید دستی فعال شد (پست‌ها پیش از ارسال به پیام‌رسان‌ها منتظر تایید می‌مانند)' : '🔴 حالت تایید دستی غیرفعال شد (ارسال آنی)';
      await ctx.answerCallbackQuery({ text: txt, show_alert: true });
      const userName = ctx.from?.first_name || 'ادمین';
      try {
        await ctx.editMessageText(this.renderMainMenuHtml(userName), {
          parse_mode: 'HTML',
          reply_markup: this.getMainMenuKeyboard()
        });
      } catch {}
    });

    this.bot.callbackQuery('cb:toggle_adfilter', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const enabled = config.toggleAdFilter();
      const txt = enabled ? '🟢 فیلتر تبلیغات و کلمات ناخواسته فعال شد' : '🔴 فیلتر تبلیغات غیرفعال شد';
      await ctx.answerCallbackQuery({ text: txt, show_alert: true });
      const userName = ctx.from?.first_name || 'ادمین';
      try {
        await ctx.editMessageText(this.renderMainMenuHtml(userName), {
          parse_mode: 'HTML',
          reply_markup: this.getMainMenuKeyboard()
        });
      } catch {}
    });

    this.bot.callbackQuery(/^cb:appr_ok:(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const approvalId = String(ctx.match[1]);
      const pending = this.pendingApprovals.get(approvalId);

      if (!pending) {
        return ctx.answerCallbackQuery({
          text: '⚠️ این پست قبلاً تعیین تکلیف شده یا منقضی گردیده است.',
          show_alert: true
        });
      }

      await ctx.answerCallbackQuery({ text: '⏳ تایید شد. در حال ارسال به پیام‌رسان‌ها...' });
      this.pendingApprovals.delete(approvalId);

      try {
        let fileData: ArrayBuffer | undefined;
        let fileName = 'file';

        if (pending.fileId) {
          const dl = await this.downloadTelegramFile(pending.fileId);
          fileData = dl.data;
          fileName = dl.fileName;
        }

        const results = await dispatcher.broadcastForChannel({
          channel: pending.channel,
          mediaType: pending.mediaType,
          fileData,
          fileName,
          rawText: pending.text,
          caption: pending.caption,
          source: pending.source,
          postId: pending.postId
        });

        const bIcon = results.bale?.success ? '✅ بله' : (results.bale?.skipped ? '⚪ رد شد' : '❌ بله');
        const rIcon = results.rubika?.success ? '✅ روبیکا' : (results.rubika?.skipped ? '⚪ رد شد' : '❌ روبیکا');
        const adminName = `@${ctx.from?.username || ctx.from?.first_name || 'Admin'}`;

        const confirmationMsg = (
          `✅ <b>پست با موفقیت تایید و به مقاصد ارسال شد!</b>\n\n` +
          `📢 <b>کانال:</b> ${pending.channel.title}\n` +
          `👤 <b>تاییدکننده:</b> ${adminName}\n` +
          `📊 <b>نتیجه:</b> ${bIcon} | ${rIcon}`
        );

        try {
          await ctx.editMessageText(confirmationMsg, { parse_mode: 'HTML' });
        } catch {}
      } catch (err: any) {
        console.error('[Telegram] Error dispatching approved post:', err);
        try {
          await ctx.editMessageText(`❌ خطا در بازنشر پست تایید شده:\n${err.message || String(err)}`);
        } catch {}
      }
    });

    this.bot.callbackQuery(/^cb:appr_no:(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const approvalId = String(ctx.match[1]);
      const pending = this.pendingApprovals.get(approvalId);
      this.pendingApprovals.delete(approvalId);

      await ctx.answerCallbackQuery({ text: '❌ ارسال این پست لغو گردید.' });
      const adminName = `@${ctx.from?.username || ctx.from?.first_name || 'Admin'}`;

      try {
        const title = pending?.channel?.title || 'کانال';
        await ctx.editMessageText(
          `❌ <b>ارسال پست ${title} توسط ${adminName} لغو شد.</b>\n` +
          `این پست به هیچ‌کدام از پیام‌رسان‌ها فوروارد نخواهد شد.`,
          { parse_mode: 'HTML' }
        );
      } catch {}
    });

    this.bot.callbackQuery('cb:test_conns', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      await ctx.answerCallbackQuery({ text: '⏳ در حال بررسی اتصال پیام‌رسان‌ها...' });

      const res = await dispatcher.testAllConnections();
      const baleText = res?.bale?.success ? '🟢 متصل' : `🔴 خطا (${res?.bale?.error || 'قطع'})`;
      const rubikaText = res?.rubika?.success ? '🟢 متصل' : `🔴 خطا (${res?.rubika?.error || 'قطع'})`;
      const eitaaText = res?.eitaa?.success ? '🟢 متصل' : '⚪ تنظیم‌نشده';

      const msg = (
        `📊 <b>نتیجه بررسی وضعیت اتصال پیام‌رسان‌ها:</b>\n\n` +
        `🔹 <b>بله (Bale):</b> ${baleText}\n` +
        `🔹 <b>روبیکا (Rubika):</b> ${rubikaText}\n` +
        `🔹 <b>ایتا (Eitaa):</b> ${eitaaText}\n`
      );

      const kb = new InlineKeyboard().text('🔙 بازگشت به منوی اصلی', 'cb:main_menu');
      try {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
      } catch {}
    });

    this.bot.callbackQuery('cb:add_channel_wizard', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      if (ctx.from) {
        this.pendingChannelWizard.set(ctx.from.id, {
          step: 'title',
          data: {},
          timestamp: Date.now()
        });
      }
      await ctx.answerCallbackQuery();
      const cancelKb = new InlineKeyboard().text('❌ انصراف', 'cb:cancel_wizard');
      await ctx.reply(
        `➕ <b>افزودن کانال جدید برای بازنشر (مرحله ۱ از ۴)</b>\n\n` +
        `لطفاً <b>نام یا عنوان کانال</b> را ارسال کنید (مثال: <code>سیکاپ سلامت</code>):\n\n` +
        `<i>(برای انصراف دکمه زیر را بزنید یا کلمه انصراف را ارسال کنید)</i>`,
        { parse_mode: 'HTML', reply_markup: cancelKb }
      );
    });

    this.bot.callbackQuery('cb:cancel_wizard', async (ctx) => {
      if (ctx.from) {
        this.pendingChannelWizard.delete(ctx.from.id);
      }
      await ctx.answerCallbackQuery({ text: 'عملیات لغو شد.' });
      try {
        await ctx.editMessageText('❌ افزودن کانال جدید لغو شد.');
      } catch {}
    });

    this.bot.callbackQuery(/^cb:ch:(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const chId = ctx.match[1];
      const matched = config.settings.channels.find(c => c.id === chId);
      if (!matched) return ctx.answerCallbackQuery({ text: 'کانال یافت نشد' });

      const statusIcon = matched.is_active ? '🟢 فعال' : '🔴 غیرفعال';
      const platDetails: string[] = [];
      if (matched.telegram_id) platDetails.push(`✈️ <b>مبدأ تلگرام:</b> <code>${matched.telegram_id}</code>`);
      if (matched.bale_id) platDetails.push(`🍃 <b>مقصد بله:</b> <code>${matched.bale_id}</code>`);
      if (matched.rubika_id) platDetails.push(`🟣 <b>مقصد روبیکا:</b> <code>${matched.rubika_id}</code>`);
      if (matched.eitaa_id) platDetails.push(`🟠 <b>مقصد ایتا:</b> <code>${matched.eitaa_id}</code>`);

      const msg = (
        `📋 <b>اطلاعات و تنظیمات کانال: ${matched.title}</b>\n\n` +
        `🔹 <b>وضعیت بازنشر:</b> ${statusIcon}\n\n` +
        platDetails.join('\n') + `\n\n` +
        `👇 جهت تغییر وضعیت یا ارسال تست کلیک کنید:`
      );

      try {
        await ctx.editMessageText(msg, {
          parse_mode: 'HTML',
          reply_markup: this.getChannelKeyboard(matched)
        });
      } catch {}
      await ctx.answerCallbackQuery();
    });

    this.bot.callbackQuery(/^cb:toggle_ch:(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const chId = String(ctx.match[1]);
      const newState = config.toggleChannelPause(chId);
      const stateStr = newState ? '🟢 فعال' : '🔴 غیرفعال';
      await ctx.answerCallbackQuery({ text: `وضعیت کانال به ${stateStr} تغییر یافت.`, show_alert: true });

      const matched = config.settings.channels.find(c => c.id === chId);
      if (matched) {
        const statusIcon = matched.is_active ? '🟢 فعال' : '🔴 غیرفعال';
        const platDetails: string[] = [];
        if (matched.telegram_id) platDetails.push(`✈️ <b>مبدأ تلگرام:</b> <code>${matched.telegram_id}</code>`);
        if (matched.bale_id) platDetails.push(`🍃 <b>مقصد بله:</b> <code>${matched.bale_id}</code>`);
        if (matched.rubika_id) platDetails.push(`🟣 <b>مقصد روبیکا:</b> <code>${matched.rubika_id}</code>`);
        if (matched.eitaa_id) platDetails.push(`🟠 <b>مقصد ایتا:</b> <code>${matched.eitaa_id}</code>`);

        const msg = (
          `📋 <b>اطلاعات و تنظیمات کانال: ${matched.title}</b>\n\n` +
          `🔹 <b>وضعیت بازنشر:</b> ${statusIcon}\n\n` +
          platDetails.join('\n') + `\n\n` +
          `👇 جهت تغییر وضعیت یا ارسال تست کلیک کنید:`
        );
        try {
          await ctx.editMessageText(msg, {
            parse_mode: 'HTML',
            reply_markup: this.getChannelKeyboard(matched)
          });
        } catch {}
      }
    });

    this.bot.callbackQuery(/^cb:del_ch_ask:(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const chId = String(ctx.match[1]);
      const matched = config.settings.channels.find(c => c.id === chId);
      if (!matched) return ctx.answerCallbackQuery({ text: 'کانال یافت نشد' });

      await ctx.answerCallbackQuery();
      const confirmKb = new InlineKeyboard()
        .text('🗑️ بله، کانال حذف شود', `cb:del_ch_confirm:${chId}`)
        .row()
        .text('❌ انصراف و بازگشت', `cb:ch:${chId}`);

      try {
        await ctx.editMessageText(
          `⚠️ <b>هشدار حذف کانال!</b>\n\n` +
          `آیا مطمئن هستید که می‌خواهید کانال <b>${matched.title}</b> (<code>${matched.telegram_id}</code>) را از لیست حذف کنید؟\n\n` +
          `<i>با حذف این کانال، بازنشر پست‌های آن به پیام‌رسان‌ها متوقف خواهد شد.</i>`,
          { parse_mode: 'HTML', reply_markup: confirmKb }
        );
      } catch {}
    });

    this.bot.callbackQuery(/^cb:del_ch_confirm:(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const chId = String(ctx.match[1]);
      const removed = config.removeChannel(chId);

      if (removed) {
        await ctx.answerCallbackQuery({ text: 'کانال با موفقیت حذف شد.', show_alert: true });
        const userName = ctx.from?.first_name || 'ادمین';
        try {
          await ctx.editMessageText(this.renderMainMenuHtml(userName), {
            parse_mode: 'HTML',
            reply_markup: this.getMainMenuKeyboard()
          });
        } catch {}
      } else {
        await ctx.answerCallbackQuery({ text: 'خطا در حذف یا کانال وجود ندارد.', show_alert: true });
      }
    });

    this.bot.callbackQuery(/^cb:test_post:(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const chId = ctx.match[1];
      const matched = config.settings.channels.find(c => c.id === chId);
      if (!matched) return ctx.answerCallbackQuery({ text: 'کانال یافت نشد' });

      await ctx.answerCallbackQuery({ text: `⏳ در حال ارسال پست تست به ${matched.title}...` });

      const testText = `این یک پیام آزمایشی برای کانال ${matched.title} از ربات بازنشر است.`;
      const res = await dispatcher.broadcastForChannel({
        channel: matched,
        mediaType: 'text',
        rawText: testText,
        source: `Admin Test (@${ctx.from?.username})`
      });

      const bIcon = res.bale?.success ? '✅' : '❌';
      const rIcon = res.rubika?.success ? '✅' : '❌';
      const eIcon = res.eitaa?.success ? '✅' : '⚪';

      await ctx.reply(
        `📢 نتیجه ارسال تست به <b>${matched.title}</b>:\n\n` +
        `▫️ بله: ${bIcon}\n` +
        `▫️ روبیکا: ${rIcon}\n` +
        `▫️ ایتا: ${eIcon}`,
        { parse_mode: 'HTML' }
      );
    });

    this.bot.callbackQuery('cb:logs', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }

      const history = dispatcher.getRecentHistory(5);
      let text = '📜 <b>آخرین پیام‌های بازنشر شده:</b>\n\n';

      if (history.length === 0) {
        text += 'هنوز پیامی بازنشر نشده است.\n';
      } else {
        for (const item of history) {
          const b = item.results.bale?.success ? '✅' : '❌';
          const r = item.results.rubika?.success ? '✅' : '❌';
          text += `⏰ ${item.timestamp}\n📢 <b>${item.channel_name}</b>\n💬 ${item.content_preview}\nنتیجه: بله: ${b} | روبیکا: ${r}\n────────────────\n`;
        }
      }

      const kb = new InlineKeyboard().text('🔙 بازگشت به منوی اصلی', 'cb:main_menu');
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
      } catch {}
      await ctx.answerCallbackQuery();
    });

    this.bot.callbackQuery('cb:daily_report', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      try {
        await ctx.editMessageText(this.renderDailyReportHtml(), {
          parse_mode: 'HTML',
          reply_markup: this.getDailyReportKeyboard()
        });
      } catch {}
      await ctx.answerCallbackQuery();
    });

    this.bot.callbackQuery('cb:send_report_now', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      await ctx.answerCallbackQuery({ text: '⏳ در حال ارسال گزارش به گروه...' });
      const res = await dailyReportScheduler.sendDailyReport();
      if (res.success) {
        await ctx.reply(`✅ گزارش روزانه با موفقیت به گروه <b>${config.settings.report_group_title || 'سیکاپ سوشال'}</b> ارسال شد.`, { parse_mode: 'HTML' });
      } else {
        await ctx.reply(`❌ خطا در ارسال گزارش:\n${res.error}`, { parse_mode: 'HTML' });
      }
    });

    this.bot.callbackQuery('cb:preview_report', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const preview = await statsService.generateReportHtml();
      const kb = new InlineKeyboard().text('🔙 بازگشت به تنظیمات گزارش', 'cb:daily_report');
      try {
        await ctx.editMessageText(preview, {
          parse_mode: 'HTML',
          reply_markup: kb
        });
      } catch {}
      await ctx.answerCallbackQuery();
    });

    this.bot.callbackQuery('cb:toggle_daily_report', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const current = config.settings.daily_report_enabled;
      config.updateSettings({ daily_report_enabled: !current });
      const text = !current ? '🟢 ارسال خودکار گزارش روزانه فعال شد.' : '🔴 ارسال خودکار گزارش غیرفعال شد.';
      await ctx.answerCallbackQuery({ text, show_alert: true });
      try {
        await ctx.editMessageText(this.renderDailyReportHtml(), {
          parse_mode: 'HTML',
          reply_markup: this.getDailyReportKeyboard()
        });
      } catch {}
    });

    // ================= Scheduled Posts UI Callbacks =================
    this.bot.callbackQuery('cb:ali_yakashef_guide', async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `📌 <b>راهنمای محتواگذاری کانال یاکاشف الکرب:</b>\n\n` +
        `۱. کافیست فایل، عکس، ویدیو، وویس یا متن خود را در همین گفتگو برای ربات بفرستید.\n` +
        `۲. ربات پیام شما را دریافت کرده و دکمه کانال 🌙 <b>یاکاشف الکرب</b> را به شما نشان می‌دهد.\n` +
        `۳. با کلیک بر روی آن، می‌توانید بین <b>ارسال فوری</b> یا <b>زمان‌بندی (تایم‌بندی)</b> انتخاب نمایید.\n` +
        `۴. پس از ارسال، محتوا به صورت همزمان به پیام‌رسان‌های بله، روبیکا و تلگرام مربوط به یاکاشف الکرب بازنشر خواهد شد.`,
        { parse_mode: 'HTML' }
      );
    });

    this.bot.callbackQuery('cb:list_scheduled', async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      await ctx.answerCallbackQuery();
      await this.showScheduledPostsList(ctx, true);
    });

    this.bot.callbackQuery(/^cb:cancel_sched:(.+)$/, async (ctx) => {
      if (!this.isAuthorizedAdmin(ctx.from?.username)) {
        return ctx.answerCallbackQuery({ text: 'دسترسی غیرمجاز' });
      }
      const id = String(ctx.match[1] || '');
      const success = postScheduler.cancelScheduledPost(id);
      if (success) {
        await ctx.answerCallbackQuery({ text: '❌ پست زمان‌بندی‌شده لغو شد.', show_alert: true });
      } else {
        await ctx.answerCallbackQuery({ text: '⚠️ این پست قبلاً اجرا یا لغو شده است.', show_alert: true });
      }
      await this.showScheduledPostsList(ctx, true);
    });

    this.bot.catch((err) => {
      console.error('[Telegram] Error in update handling:', err.message || err);
    });

    console.log('[Telegram] Starting grammY bot polling...');
    this.isRunning = true;

    try {
      await this.bot.api.deleteWebhook({ drop_pending_updates: false });
      await this.bot.start({
        allowed_updates: ['message', 'channel_post', 'callback_query', 'my_chat_member'],
        onStart: (info) => {
          console.log(`[Telegram] Bot started: @${info.username} (id: ${info.id})`);
        }
      });
    } catch (err) {
      console.error('[Telegram] Polling error:', err);
    } finally {
      this.isRunning = false;
    }
  }

  public async showScheduledPostsList(ctx: any, isEdit: boolean = false): Promise<void> {
    const usernameClean = (ctx.from?.username || '').toLowerCase().replace(/^@/, '');
    const isRestricted = this.isRestrictedAdmin(usernameClean);

    let pendingList = postScheduler.getPendingPosts();
    if (isRestricted) {
      pendingList = pendingList.filter(p => p.targetChannelId === 'yakashef' || (p.creatorUsername && this.isRestrictedAdmin(p.creatorUsername)));
    }

    if (pendingList.length === 0) {
      const emptyMsg =
        `⏰ <b>لیست پست‌های زمان‌بندی‌شده</b>\n\n` +
        `هیچ پستی در صف زمان‌بندی وجود ندارد.\n\n` +
        `💡 برای زمان‌بندی، کافیست یک ویدیو، تصویر یا فایل در پی‌وی ربات بفرستید و گزینه «زمان‌بندی ارسال» را انتخاب کنید.`;

      const kb = new InlineKeyboard().text('🔙 بازگشت به منوی اصلی', isRestricted ? 'cb:ali_yakashef_guide' : 'cb:main_menu');
      if (isEdit) {
        try {
          await ctx.editMessageText(emptyMsg, { parse_mode: 'HTML', reply_markup: kb });
          return;
        } catch {}
      }
      await ctx.reply(emptyMsg, { parse_mode: 'HTML', reply_markup: kb });
      return;
    }

    let msg = `⏰ <b>لیست پست‌های در صف زمان‌بندی (${pendingList.length} مورد):</b>\n\n`;
    const kb = new InlineKeyboard();

    for (let i = 0; i < pendingList.length; i++) {
      const p = pendingList[i];
      if (!p) continue;
      const chTitle = p.targetChannelId === 'all'
        ? 'تمام کانال‌ها'
        : (config.settings.channels.find(c => c.id === p.targetChannelId)?.title || p.targetChannelId);

      const mediaFa = p.mediaType === 'video' ? 'ویدیو' : (p.mediaType === 'photo' ? 'تصویر' : (p.mediaType === 'voice' ? 'صوت' : 'فایل'));

      msg +=
        `▫️ <b>مورد #${i + 1}:</b> ${mediaFa} برای <b>${chTitle}</b>\n` +
        `   ⏰ <b>زمان ارسال:</b> <code>${p.scheduledTimeStr}</code>\n` +
        (p.caption ? `   📝 <i>${p.caption.slice(0, 50)}...</i>\n` : '') +
        `   🆔 <code>${p.id}</code>\n\n`;

      kb.text(`❌ لغو مورد #${i + 1}`, `cb:cancel_sched:${p.id}`);
      if (i % 2 === 1) kb.row();
    }
    if (pendingList.length % 2 !== 0) kb.row();

    kb.text('🔄 بروزرسانی لیست', 'cb:list_scheduled')
      .row()
      .text('🔙 بازگشت به منوی اصلی', isAli ? 'cb:ali_yakashef_guide' : 'cb:main_menu');

    if (isEdit) {
      try {
        await ctx.editMessageText(msg, { parse_mode: 'HTML', reply_markup: kb });
        return;
      } catch {}
    }
    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: kb });
  }

  public async stop(): Promise<void> {
    if (this.bot && this.isRunning) {
      await this.bot.stop();
      this.isRunning = false;
    }
  }
}

export const telegramBot = TelegramBotManager.getInstance();
