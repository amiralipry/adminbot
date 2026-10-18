import { config } from './config';
import { telegramBot } from './bot/telegram';
import { startWebServer } from './web/server';
import { dailyReportScheduler } from './services/scheduler';
import { postScheduler } from './services/postScheduler';

console.log('\n======================================================================');
console.log('🚀 ربات بازنشر محتوای چندکاناله (تلگرام ➔ بله و روبیکا)');
console.log('⚙️ محیط اجرا: Bun + Node.js (TypeScript)');
console.log('======================================================================\n');

// 1. Start Web Management Panel on port 5000
if (config.settings.enable_web_dashboard) {
  startWebServer();
}

// 2. Start Telegram Channel Listener & Admin Controller
if (config.settings.telegram_bot_token) {
  console.log('[Telegram] Initializing grammY listener & admin controller...');
  telegramBot.start().catch((err) => {
    console.error('[Telegram] Error running bot:', err);
  });
} else {
  console.warn('⚠️ [Telegram] Telegram bot token not configured.');
}

// 3. Start Daily Report Scheduler (Runs at 19:00 Tehran time for Sikaap Social)
dailyReportScheduler.start();

// 4. Start Post Scheduler (Checks every 15s for timed posts)
postScheduler.start();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down services...');
  dailyReportScheduler.stop();
  postScheduler.stop();
  await telegramBot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Terminating services...');
  dailyReportScheduler.stop();
  postScheduler.stop();
  await telegramBot.stop();
  process.exit(0);
});

