import { config } from './config';
import { telegramBot } from './bot/telegram';
import { startWebServer } from './web/server';
import { dailyReportScheduler } from './services/scheduler';
import { postScheduler } from './services/postScheduler';
import { retryQueue } from './services/retryQueue';

console.log('\n======================================================================');
console.log('🚀 ربات بازنشر محتوای چندکاناله (تلگرام ➔ بله، روبیکا و ایتا)');
console.log('⚙️ محیط اجرا: Bun + TypeScript (SQLite + SSE Real-time + Retry Queue)');
console.log('======================================================================\n');

// Prevent unexpected unhandled network exceptions from crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [Process] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ [Process] Uncaught Exception:', err);
});

process.on('exit', (code) => {
  console.log(`🛑 [Process] Process exited with code: ${code}`);
});

process.on('beforeExit', (code) => {
  console.warn(`⚠️ [Process] Event loop empty (beforeExit) with code: ${code}`);
});

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

// 5. Start Smart Retry Queue (Exponential backoff for transient failures)
retryQueue.start();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down services...');
  retryQueue.stop();
  dailyReportScheduler.stop();
  postScheduler.stop();
  await telegramBot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n👋 Terminating services...');
  retryQueue.stop();
  dailyReportScheduler.stop();
  postScheduler.stop();
  await telegramBot.stop();
  process.exit(0);
});

