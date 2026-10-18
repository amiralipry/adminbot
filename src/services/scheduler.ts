import { config } from '../config';
import { statsService } from './stats';
import { telegramBot } from '../bot/telegram';

export class DailyReportScheduler {
  private static instance: DailyReportScheduler;
  private intervalTimer: any = null;
  private isProcessing = false;

  private constructor() {}

  public static getInstance(): DailyReportScheduler {
    if (!DailyReportScheduler.instance) {
      DailyReportScheduler.instance = new DailyReportScheduler();
    }
    return DailyReportScheduler.instance;
  }

  public start(): void {
    if (this.intervalTimer) return;

    console.log(`[Scheduler] Daily report scheduler activated. Target time: ${config.settings.daily_report_time || '19:00'} (Tehran Time)`);

    // Check every 25 seconds
    this.intervalTimer = setInterval(() => {
      this.checkSchedule().catch((err) => {
        console.error('[Scheduler] Error in checkSchedule:', err);
      });
    }, 25000);

    // Initial check
    this.checkSchedule().catch(() => {});
  }

  public stop(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      console.log('[Scheduler] Daily report scheduler stopped.');
    }
  }

  private async checkSchedule(): Promise<void> {
    if (!config.settings.daily_report_enabled) return;
    if (this.isProcessing) return;

    const { dateKey, timeStr } = statsService.getTehranInfo();
    const targetTime = (config.settings.daily_report_time || '19:00').trim();

    // Check if time matches (e.g. "19:00")
    if (timeStr === targetTime) {
      // Check if already sent today
      if (config.settings.last_daily_report_date === dateKey) {
        return;
      }

      this.isProcessing = true;
      try {
        console.log(`[Scheduler] ⏰ 19:00 trigger reached! Sending daily report for date ${dateKey}...`);
        
        // Mark as sent before triggering to prevent duplicate calls in same minute
        config.updateSettings({ last_daily_report_date: dateKey });

        const result = await this.sendDailyReport();
        if (!result.success) {
          console.warn(`[Scheduler] Daily report could not be sent: ${result.error}`);
        } else {
          console.log('[Scheduler] ✅ Daily report successfully delivered to group!');
        }
      } catch (err) {
        console.error('[Scheduler] Error sending scheduled report:', err);
      } finally {
        this.isProcessing = false;
      }
    }
  }

  public async sendDailyReport(customChatId?: string): Promise<{ success: boolean; error?: string; message?: string }> {
    const chatId = customChatId || config.settings.report_group_id;

    if (!chatId) {
      const err = 'آیدی گروه سیکاپ سوشال تنظیم نشده است. لطفاً دستور /setreport را در گروه بفرستید یا آیدی را در تنظیمات وارد کنید.';
      console.warn(`[Scheduler] ${err}`);
      return { success: false, error: err };
    }

    if (!telegramBot.bot) {
      return { success: false, error: 'ربات تلگرام در حال اجرا نیست یا توکن نامعتبر است.' };
    }

    const reportHtml = await statsService.generateReportHtml();

    try {
      await telegramBot.bot.api.sendMessage(chatId, reportHtml, {
        parse_mode: 'HTML'
      });
      return { success: true, message: 'گزارش روزانه با موفقیت به گروه ارسال شد.' };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[Scheduler] Failed to send report to chat ${chatId}:`, errMsg);
      return { success: false, error: `خطا در ارسال تلگرام: ${errMsg}` };
    }
  }
}

export const dailyReportScheduler = DailyReportScheduler.getInstance();
