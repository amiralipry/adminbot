import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { config } from '../config';
import { dispatcher } from '../services/dispatcher';
import { telegramBot } from '../bot/telegram';
import { baleService } from '../services/bale';
import { rubikaService } from '../services/rubika';
import { eitaaService } from '../services/eitaa';
import { statsService } from '../services/stats';
import { dailyReportScheduler } from '../services/scheduler';
import { botDb } from '../services/db';
import { retryQueue } from '../services/retryQueue';
import { eventBus } from '../services/eventBus';

const BASE_DIR = process.cwd();
const STATIC_DIR = join(BASE_DIR, 'web', 'static');
const TEMPLATES_DIR = join(BASE_DIR, 'web', 'templates');

// In-memory active session tokens for secure dashboard access
const activeSessions = new Set<string>();

function generateSessionToken(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2)}${Math.random().toString(36).substring(2)}`;
}

function isAuthenticated(req: Request): boolean {
  if (!config.settings.dashboard_auth_enabled) return true;

  // 1. Check Cookie
  const cookie = req.headers.get('cookie') || '';
  const match = cookie.match(/admin_session=([^;]+)/);
  if (match && match[1] && activeSessions.has(match[1])) {
    return true;
  }

  // 2. Check Authorization Header / X-Admin-Token
  const auth = req.headers.get('authorization') || req.headers.get('x-admin-token') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token && (activeSessions.has(token) || token === config.settings.dashboard_password)) {
    return true;
  }

  return false;
}

export function startWebServer(): void {
  const host = config.settings.web_host || '127.0.0.1';
  const port = config.settings.web_port || 5000;

  Bun.serve({
    port,
    hostname: host,
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // 1. Static Files (Publicly accessible)
      if (path.startsWith('/static/')) {
        const rel = path.replace('/static/', '');
        const filePath = join(STATIC_DIR, rel);
        if (existsSync(filePath)) {
          const file = Bun.file(filePath);
          return new Response(file);
        }
        return new Response('Not Found', { status: 404 });
      }

      // 2. Authentication API (Public)
      if (path === '/api/login' && req.method === 'POST') {
        try {
          let password = '';
          const contentType = req.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const body = (await req.json()) as any;
            password = body?.password || '';
          } else {
            const formData = await req.formData();
            password = (formData.get('password') as string) || '';
          }

          const targetPassword = config.settings.dashboard_password || process.env.DASHBOARD_PASSWORD || 'admin';
          if (password === targetPassword) {
            const token = generateSessionToken();
            activeSessions.add(token);

            return new Response(JSON.stringify({ success: true, message: 'ورود با موفقیت انجام شد.', token }), {
              headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': `admin_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
              }
            });
          }

          return Response.json({ success: false, error: 'رمز عبور وارد شده نادرست است.' }, { status: 401 });
        } catch (err: any) {
          return Response.json({ success: false, error: err.message }, { status: 400 });
        }
      }

      if (path === '/api/logout' && req.method === 'POST') {
        const cookie = req.headers.get('cookie') || '';
        const match = cookie.match(/admin_session=([^;]+)/);
        if (match && match[1]) {
          activeSessions.delete(match[1]);
        }
        return new Response(JSON.stringify({ success: true, message: 'با موفقیت خارج شدید.' }), {
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
          }
        });
      }

      if (path === '/api/auth-check' && req.method === 'GET') {
        return Response.json({
          authenticated: isAuthenticated(req),
          auth_enabled: Boolean(config.settings.dashboard_auth_enabled)
        });
      }

      // 3. GET / (Dashboard HTML)
      if (path === '/' && req.method === 'GET') {
        const htmlPath = join(TEMPLATES_DIR, 'dashboard.html');
        if (existsSync(htmlPath)) {
          let html = readFileSync(htmlPath, 'utf-8');
          const isPaused = config.settings.is_paused;
          const isAuthed = isAuthenticated(req);
          const authRequired = Boolean(config.settings.dashboard_auth_enabled);

          html = html
            .replace(/\{\{\s*PAUSE_BTN_TEXT\s*\}\}/g, isPaused ? '▶️ ادامه کار ربات' : '⏸️ توقف کامل ربات')
            .replace(/\{\{\s*SYS_STATUS_SUB\s*\}\}/g, isPaused ? 'متوقف شده' : 'در حال بازنشر')
            .replace(/\{\{\s*SYS_STATUS_BADGE_CLASS\s*\}\}/g, isPaused ? 'badge-danger' : 'badge-success')
            .replace(/\{\{\s*SYS_STATUS_BADGE_TEXT\s*\}\}/g, isPaused ? 'متوقف' : 'فعال')
            .replace(/\{\{\s*WEB_PORT\s*\}\}/g, String(port))
            .replace(/\{\{\s*AUTH_REQUIRED\s*\}\}/g, String(authRequired))
            .replace(/\{\{\s*IS_AUTHENTICATED\s*\}\}/g, String(isAuthed));

          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        }
        return new Response('Template not found', { status: 500 });
      }

      // 4. Protect all remaining API routes
      if (path.startsWith('/api/') && !isAuthenticated(req)) {
        return Response.json({ success: false, error: 'احراز هویت الزامی است. لطفاً وارد شوید.' }, { status: 401 });
      }

      // 5. Server-Sent Events (SSE) Real-time Stream
      if (path === '/api/events' && req.method === 'GET') {
        let intervalId: any;
        let listener: (event: any) => void;

        const stream = new ReadableStream({
          start(controller) {
            // Initial connect notification
            const initPayload = JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() });
            controller.enqueue(new TextEncoder().encode(`event: connected\ndata: ${initPayload}\n\n`));

            listener = (botEvent: any) => {
              try {
                const payload = `event: message\ndata: ${JSON.stringify(botEvent)}\n\n`;
                controller.enqueue(new TextEncoder().encode(payload));
              } catch (err) {
                console.error('[SSE] Broadcast error:', err);
              }
            };

            eventBus.on('event', listener);

            // Heartbeat every 15s to keep connection alive
            intervalId = setInterval(() => {
              try {
                controller.enqueue(new TextEncoder().encode(': ping\n\n'));
              } catch {
                clearInterval(intervalId);
              }
            }, 15000);
          },
          cancel() {
            if (intervalId) clearInterval(intervalId);
            if (listener) eventBus.off('event', listener);
          }
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
          }
        });
      }

      // 6. API Status
      if (path === '/api/status' && req.method === 'GET') {
        const retryStats = botDb.getRetryQueueStats();
        return Response.json({
          is_paused: config.settings.is_paused,
          approval_mode_enabled: config.settings.approval_mode_enabled,
          ad_filter_enabled: config.settings.ad_filter_enabled,
          blacklist_keywords: config.settings.blacklist_keywords || [],
          auto_retry_enabled: config.settings.auto_retry_enabled,
          max_retry_attempts: config.settings.max_retry_attempts,
          retry_stats: retryStats,
          pending_approvals_count: telegramBot.pendingApprovals ? telegramBot.pendingApprovals.size : 0,
          channels: config.settings.channels,
          telegram: {
            running: telegramBot.isRunning,
            configured: Boolean(config.settings.telegram_bot_token),
            info: {
              configured: true,
              connected: telegramBot.isRunning,
              username: telegramBot.bot?.botInfo?.username || 'bot'
            }
          },
          bale: {
            enabled: baleService.isEnabled(),
            configured: baleService.isConfigured()
          },
          rubika: {
            enabled: rubikaService.isEnabled(),
            configured: rubikaService.isConfigured()
          },
          eitaa: {
            enabled: eitaaService.isEnabled(),
            configured: eitaaService.isConfigured(),
            api_type: config.settings.eitaa_api_type
          },
          daily_report: {
            enabled: config.settings.daily_report_enabled,
            time: config.settings.daily_report_time || '19:00',
            group_title: config.settings.report_group_title || 'سیکاپ سوشال',
            group_id: config.settings.report_group_id || '',
            last_date: config.settings.last_daily_report_date || null
          }
        });
      }

      // 7. API Smart Retry Queue
      if (path === '/api/retry-queue' && req.method === 'GET') {
        const stats = botDb.getRetryQueueStats();
        const jobs = botDb.getAllRetryJobs(50);
        return Response.json({ stats, jobs });
      }

      const retryManualMatch = path.match(/^\/api\/retry-queue\/(\d+)\/retry$/);
      if (retryManualMatch && req.method === 'POST') {
        const jobId = parseInt(retryManualMatch[1] || '0', 10);
        const ok = await retryQueue.retryManually(jobId);
        return Response.json({ success: ok });
      }

      const retryCancelMatch = path.match(/^\/api\/retry-queue\/(\d+)$/);
      if (retryCancelMatch && req.method === 'DELETE') {
        const jobId = parseInt(retryCancelMatch[1] || '0', 10);
        botDb.failRetryJob(jobId, 'لغو شده توسط ادمین در پنل وب');
        return Response.json({ success: true });
      }

      // 8. API Toggle Pause
      if (path === '/api/toggle-pause' && req.method === 'POST') {
        const isPaused = config.toggleGlobalPause();
        return Response.json({ success: true, is_paused: isPaused });
      }

      // 8.1 API Toggle Feature (Approval Mode / Ad Filter)
      if (path === '/api/toggle-feature' && req.method === 'POST') {
        try {
          let feature = '';
          const contentType = req.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const body = (await req.json()) as any;
            feature = body?.feature;
          } else if (contentType.includes('form')) {
            const formData = await req.formData();
            feature = (formData.get('feature') as string) || '';
          } else {
            const text = await req.text();
            try {
              const parsed = JSON.parse(text);
              feature = parsed?.feature;
            } catch {
              feature = text.trim();
            }
          }

          if (feature === 'approval') {
            const val = config.toggleApprovalMode();
            return Response.json({ success: true, feature: 'approval', enabled: val });
          }
          if (feature === 'adfilter') {
            const val = config.toggleAdFilter();
            return Response.json({ success: true, feature: 'adfilter', enabled: val });
          }
          return Response.json({ success: false, error: 'ویژگی نامعتبر است' }, { status: 400 });
        } catch (err: any) {
          return Response.json({ success: false, error: err.message }, { status: 400 });
        }
      }

      // 9. API Toggle Channel
      const chMatch = path.match(/^\/api\/channels\/([^/]+)\/toggle$/);
      if (chMatch && req.method === 'POST') {
        const chId = String(chMatch[1]);
        const res = config.toggleChannelPause(chId);
        if (res === null) {
          return Response.json({ success: false, error: 'کانال یافت نشد' }, { status: 404 });
        }
        return Response.json({ success: true, channel_id: chId, is_active: res });
      }

      // 9.1 API Add Channel
      if ((path === '/api/channels/add' || path === '/api/channels') && req.method === 'POST') {
        try {
          let data: any = {};
          const contentType = req.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            data = await req.json();
          } else {
            const formData = await req.formData();
            data = {
              title: formData.get('title'),
              telegram_id: formData.get('telegram_id'),
              bale_id: formData.get('bale_id'),
              rubika_id: formData.get('rubika_id'),
              eitaa_id: formData.get('eitaa_id')
            };
          }

          if (!data.title || !String(data.title).trim() || !data.telegram_id || !String(data.telegram_id).trim()) {
            return Response.json({ success: false, error: 'نام کانال و آیدی مبدأ تلگرام الزامی هستند.' }, { status: 400 });
          }

          const added = config.addChannel({
            title: String(data.title).trim(),
            telegram_id: String(data.telegram_id).trim(),
            bale_id: data.bale_id ? String(data.bale_id).trim() : '',
            rubika_id: data.rubika_id ? String(data.rubika_id).trim() : '',
            eitaa_id: data.eitaa_id ? String(data.eitaa_id).trim() : '',
            is_active: true
          });

          return Response.json({
            success: true,
            message: `کانال «${added.title}» با موفقیت افزوده شد.`,
            channel: added,
            channels: config.settings.channels
          });
        } catch (err: any) {
          return Response.json({ success: false, error: err.message }, { status: 500 });
        }
      }

      // 9.2 API Delete Channel
      const delMatch = path.match(/^\/api\/channels\/([^/]+)\/delete$/);
      if ((delMatch && req.method === 'POST') || (path.startsWith('/api/channels/') && req.method === 'DELETE')) {
        const chId = delMatch ? String(delMatch[1]) : path.replace('/api/channels/', '');
        const removed = config.removeChannel(chId);
        if (removed) {
          return Response.json({ success: true, message: 'کانال با موفقیت حذف شد.', channels: config.settings.channels });
        } else {
          return Response.json({ success: false, error: 'کانال یافت نشد.' }, { status: 404 });
        }
      }

      // 10. API Test Connection
      const connMatch = path.match(/^\/api\/test-connection\/([^/]+)$/);
      if (connMatch && req.method === 'POST') {
        const plat = connMatch[1];
        if (plat === 'bale') return Response.json(await baleService.testConnection());
        if (plat === 'rubika') return Response.json(await rubikaService.testConnection());
        if (plat === 'eitaa') return Response.json(await eitaaService.testConnection());
        if (plat === 'all') return Response.json(await dispatcher.testAllConnections());
        if (plat === 'telegram') return Response.json({ success: true, connected: telegramBot.isRunning, username: telegramBot.bot?.botInfo?.username || 'bot' });
        return Response.json({ success: false, error: 'پلتفرم نامعتبر است' }, { status: 400 });
      }

      // 11. API Test Broadcast
      if (path === '/api/test-broadcast' && req.method === 'POST') {
        try {
          const formData = await req.formData();
          const channelId = (formData.get('channel_id') as string) || 'health';
          const text = (formData.get('text') as string) || '';
          const file = formData.get('file') as File | null;

          const channel = config.settings.channels.find(c => c.id === channelId);
          if (!channel) {
            return Response.json({ success: false, error: 'کانال یافت نشد' }, { status: 400 });
          }

          if (file && file.size > 0) {
            const buffer = await file.arrayBuffer();
            const ext = file.name.split('.').pop()?.toLowerCase();
            let mediaType = 'document';
            if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) mediaType = 'photo';
            else if (['mp4', 'mov', 'mkv'].includes(ext || '')) mediaType = 'video';
            else if (['mp3', 'wav', 'm4a'].includes(ext || '')) mediaType = 'audio';

            const results = await dispatcher.broadcastForChannel({
              channel,
              mediaType,
              fileData: buffer,
              fileName: file.name,
              caption: text,
              source: 'Web Test'
            });
            return Response.json({ success: true, results });
          } else {
            if (!text.trim()) {
              return Response.json({ success: false, error: 'متن پیام نمی‌تواند خالی باشد.' }, { status: 400 });
            }
            const results = await dispatcher.broadcastForChannel({
              channel,
              mediaType: 'text',
              rawText: text,
              source: 'Web Test'
            });
            return Response.json({ success: true, results });
          }
        } catch (err: any) {
          return Response.json({ success: false, error: err.message }, { status: 500 });
        }
      }

      // 12. API Direct Publish to Channels from Web Panel
      if (path === '/api/direct-publish' && req.method === 'POST') {
        try {
          const formData = await req.formData();
          const channelId = (formData.get('channel_id') as string) || 'all';
          const text = (formData.get('text') as string) || '';
          const file = formData.get('file') as File | null;

          const targetChannels = channelId === 'all'
            ? config.settings.channels.filter(c => c.is_active)
            : config.settings.channels.filter(c => c.id === channelId);

          if (targetChannels.length === 0) {
            return Response.json({ success: false, error: 'هیچ کانال فعالی برای ارسال انتخاب نشده است.' }, { status: 400 });
          }

          let fileBuffer: ArrayBuffer | undefined;
          let fileName = 'file';
          let mediaType = 'text';

          if (file && file.size > 0) {
            fileBuffer = await file.arrayBuffer();
            fileName = file.name;
            const ext = file.name.split('.').pop()?.toLowerCase();
            if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) mediaType = 'photo';
            else if (['mp4', 'mov', 'mkv'].includes(ext || '')) mediaType = 'video';
            else if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext || '')) mediaType = 'audio';
            else mediaType = 'document';
          } else if (!text.trim()) {
            return Response.json({ success: false, error: 'متن یا فایل ارسالی نمی‌تواند خالی باشد.' }, { status: 400 });
          }

          const dispatchResults: Record<string, any> = {};

          for (const ch of targetChannels) {
            statsService.recordChannelPost({
              channel: ch,
              mediaType,
              postId: `web_direct_${Date.now()}`
            });

            const res = await dispatcher.broadcastForChannel({
              channel: ch,
              mediaType,
              fileData: fileBuffer,
              fileName,
              rawText: text,
              caption: text,
              source: 'پنل وب (ارسال مستقیم)'
            });

            dispatchResults[ch.title] = res;
          }

          return Response.json({
            success: true,
            message: `محتوا با موفقیت به ${targetChannels.length} کانال ارسال شد.`,
            channels: targetChannels.map(c => c.title),
            results: dispatchResults
          });
        } catch (err: any) {
          return Response.json({ success: false, error: err.message }, { status: 500 });
        }
      }

      // 13. API Logs
      if (path === '/api/logs' && req.method === 'GET') {
        return Response.json({ history: dispatcher.getRecentHistory(50) });
      }

      // 14. API Weekly Chart Data
      if (path === '/api/chart-data' && req.method === 'GET') {
        const analytics = statsService.getWeeklyAnalytics();
        return Response.json(analytics);
      }

      // 15. API Restart Bot
      if (path === '/api/restart-bot' && req.method === 'POST') {
        (async () => {
          await telegramBot.stop();
          await new Promise(r => setTimeout(r, 1000));
          telegramBot.start().catch(console.error);
        })();
        return Response.json({ success: true, message: 'ربات مجدداً راه‌اندازی شد.' });
      }

      // 16. API Send Daily Report Now
      if (path === '/api/send-report' && req.method === 'POST') {
        const res = await dailyReportScheduler.sendDailyReport();
        return Response.json(res);
      }

      // 17. API Daily Report Preview
      if (path === '/api/report-preview' && req.method === 'GET') {
        const html = await statsService.generateReportHtml();
        const stats = statsService.getDayStats();
        return Response.json({ html, stats });
      }

      // 18. API Update Report Settings
      if (path === '/api/report-settings' && req.method === 'POST') {
        try {
          const body = (await req.json()) as any;
          config.updateSettings({
            daily_report_enabled: body?.daily_report_enabled !== undefined ? Boolean(body.daily_report_enabled) : config.settings.daily_report_enabled,
            daily_report_time: body?.daily_report_time || config.settings.daily_report_time,
            report_group_id: body?.report_group_id !== undefined ? String(body.report_group_id) : config.settings.report_group_id,
            report_group_title: body?.report_group_title !== undefined ? String(body.report_group_title) : config.settings.report_group_title
          });
          return Response.json({ success: true, settings: config.settings });
        } catch (err: any) {
          return Response.json({ success: false, error: err.message }, { status: 400 });
        }
      }

      return new Response('Not Found', { status: 404 });
    }
  });

  console.log(`🌐 [Web] Dashboard running at: http://${host}:${port}`);
}
