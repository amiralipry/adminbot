// ==========================================
// Dashboard Controller JS (Light/Dark Theme & Full Status Sync)
// ==========================================

// --- Theme Management ---
function initTheme() {
  const saved = localStorage.getItem('adminbot_theme') || 'light';
  applyTheme(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem('adminbot_theme', next);
  if (typeof loadChartData === 'function') {
    loadChartData();
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    if (theme === 'dark') {
      btn.innerHTML = '☀️ تم روشن';
    } else {
      btn.innerHTML = '🌙 تم تیره';
    }
  }
}

// --- Toast Notifications ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- Status Refresh & Real-time Sync ---
async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = await res.json();

    // 1. Telegram
    const tgBadge = document.getElementById('tg-status-badge');
    const tgSub = document.getElementById('tg-status-sub');
    if (tgBadge && tgSub) {
      if (data.telegram && data.telegram.running) {
        tgBadge.className = 'badge badge-success';
        tgBadge.innerHTML = '<span class="badge-dot"></span> متصل';
        tgSub.textContent = `@${data.telegram.info?.username || 'sikaapadminbot'}`;
      } else {
        tgBadge.className = 'badge badge-danger';
        tgBadge.innerHTML = '<span class="badge-dot"></span> قطع اتصال';
        tgSub.textContent = 'غیرفعال';
      }
    }

    // 2. Bale
    const baleBadge = document.getElementById('bale-status-badge');
    const baleSub = document.getElementById('bale-status-sub');
    if (baleBadge && baleSub) {
      if (!data.bale?.enabled) {
        baleBadge.className = 'badge badge-warning';
        baleBadge.innerHTML = '<span class="badge-dot"></span> غیرفعال';
        baleSub.textContent = 'ارسال غیرفعال است';
      } else if (data.bale?.configured) {
        baleBadge.className = 'badge badge-success';
        baleBadge.innerHTML = '<span class="badge-dot"></span> آماده';
        baleSub.textContent = 'توکن متصل است';
      } else {
        baleBadge.className = 'badge badge-danger';
        baleBadge.innerHTML = '<span class="badge-dot"></span> ناقص';
        baleSub.textContent = 'توکن تنظیم نشده';
      }
    }

    // 3. Rubika
    const rubikaBadge = document.getElementById('rubika-status-badge');
    const rubikaSub = document.getElementById('rubika-status-sub');
    if (rubikaBadge && rubikaSub) {
      if (!data.rubika?.enabled) {
        rubikaBadge.className = 'badge badge-warning';
        rubikaBadge.innerHTML = '<span class="badge-dot"></span> غیرفعال';
        rubikaSub.textContent = 'ارسال غیرفعال است';
      } else if (data.rubika?.configured) {
        rubikaBadge.className = 'badge badge-success';
        rubikaBadge.innerHTML = '<span class="badge-dot"></span> آماده';
        rubikaSub.textContent = 'توکن متصل است';
      } else {
        rubikaBadge.className = 'badge badge-danger';
        rubikaBadge.innerHTML = '<span class="badge-dot"></span> ناقص';
        rubikaSub.textContent = 'توکن تنظیم نشده';
      }
    }

    // 4. Eitaa (Safe Null Check!)
    const eitaaBadge = document.getElementById('eitaa-status-badge');
    const eitaaSub = document.getElementById('eitaa-status-sub');
    if (eitaaBadge && eitaaSub) {
      if (!data.eitaa?.enabled) {
        eitaaBadge.className = 'badge badge-warning';
        eitaaBadge.innerHTML = '<span class="badge-dot"></span> غیرفعال';
        eitaaSub.textContent = 'ارسال غیرفعال است';
      } else if (data.eitaa?.configured) {
        eitaaBadge.className = 'badge badge-success';
        eitaaBadge.innerHTML = '<span class="badge-dot"></span> آماده';
        eitaaSub.textContent = 'توکن متصل است';
      } else {
        eitaaBadge.className = 'badge badge-warning';
        eitaaBadge.innerHTML = '<span class="badge-dot"></span> تنظیم نشده';
        eitaaSub.textContent = 'بدون توکن اختصاصی';
      }
    }

    // 5. Global Pause / System Status
    const sysBadge = document.getElementById('sys-status-badge');
    const sysSub = document.getElementById('sys-status-sub');
    const globalBtn = document.getElementById('global-pause-btn');

    if (data.is_paused) {
      if (sysBadge) {
        sysBadge.className = 'badge badge-danger';
        sysBadge.innerHTML = '<span class="badge-dot"></span> متوقف';
      }
      if (sysSub) sysSub.textContent = 'متوقف شده';
      if (globalBtn) globalBtn.innerHTML = '▶️ ادامه کار ربات';
    } else {
      if (sysBadge) {
        sysBadge.className = 'badge badge-success';
        sysBadge.innerHTML = '<span class="badge-dot"></span> فعال';
      }
      if (sysSub) sysSub.textContent = 'در حال بازنشر';
      if (globalBtn) globalBtn.innerHTML = '⏸️ توقف کامل ربات';
    }

    // 6. Channel Cards Dynamic Rendering & Status Sync
    if (Array.isArray(data.channels)) {
      renderChannelsList(data.channels);
      updateDirectPublishSelect(data.channels);
    }

    // 7. Daily Report Status
    if (data.daily_report) {
      const repBadge = document.getElementById('report-active-badge');
      const repGroupName = document.getElementById('report-group-name');
      const repGroupId = document.getElementById('report-group-id');
      if (repBadge) {
        repBadge.className = data.daily_report.enabled ? 'badge badge-success' : 'badge badge-danger';
        repBadge.textContent = data.daily_report.enabled ? 'فعال (۱۹:۰۰)' : 'غیرفعال';
      }
      if (repGroupName) repGroupName.textContent = data.daily_report.group_title || 'سیکاپ سوشال';
      if (repGroupId) {
        repGroupId.textContent = data.daily_report.group_id ? data.daily_report.group_id : 'تنظیم نشده (دستور /setreport)';
      }
    }

    // 8. Feature Toggles Status
    const approvalText = document.getElementById('approval-status-text');
    const btnApproval = document.getElementById('btn-toggle-approval');
    if (approvalText && btnApproval) {
      if (data.approval_mode_enabled) {
        approvalText.textContent = 'تایید دستی: 🟢 فعال';
        btnApproval.className = 'btn btn-success btn-sm';
      } else {
        approvalText.textContent = 'تایید دستی: ⚪ غیرفعال';
        btnApproval.className = 'btn btn-secondary btn-sm';
      }
    }

    const adfilterText = document.getElementById('adfilter-status-text');
    const btnAdfilter = document.getElementById('btn-toggle-adfilter');
    if (adfilterText && btnAdfilter) {
      if (data.ad_filter_enabled) {
        adfilterText.textContent = 'فیلتر تبلیغات: 🟢 فعال';
        btnAdfilter.className = 'btn btn-success btn-sm';
      } else {
        adfilterText.textContent = 'فیلتر تبلیغات: ⚪ غیرفعال';
        btnAdfilter.className = 'btn btn-secondary btn-sm';
      }
    }

  } catch (err) {
    console.error("Status fetch error", err);
  }
}

// --- Toggle Global Pause ---
async function toggleGlobalPause(btnElement) {
  const btn = btnElement || document.getElementById('global-pause-btn');
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/toggle-pause', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.is_paused ? 'ربات با موفقیت متوقف شد (Pause)' : 'ربات مجدداً فعال شد (Resume)', 'info');
      refreshStatus();
    }
  } catch (err) {
    showToast('خطا در تغییر وضعیت: ' + err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- Toggle Channel Pause/Resume ---
async function toggleChannel(channelId, btnElement) {
  if (btnElement) btnElement.disabled = true;

  try {
    const res = await fetch(`/api/channels/${channelId}/toggle`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.is_active ? `کانال ${channelId} فعال شد` : `کانال ${channelId} موقتاً متوقف شد`, 'info');
      refreshStatus();
    } else {
      showToast(data.error || 'خطا در تغییر وضعیت کانال', 'error');
    }
  } catch (err) {
    showToast('خطا: ' + err.message, 'error');
  } finally {
    if (btnElement) btnElement.disabled = false;
  }
}

// --- Render Channels List Dynamically ---
let lastChannelsJson = '';

function renderChannelsList(channels) {
  const container = document.getElementById('channels-list-container');
  if (!container) return;

  const currentJson = JSON.stringify(channels.map(c => ({ id: c.id, active: c.is_active, title: c.title, tg: c.telegram_id, b: c.bale_id, r: c.rubika_id, e: c.eitaa_id })));
  if (currentJson === lastChannelsJson) {
    return; // No re-render needed if data hasn't changed
  }
  lastChannelsJson = currentJson;

  let html = '';
  channels.forEach((ch, idx) => {
    let icon = '📢';
    let colorVar = 'var(--primary)';
    if (ch.id === 'health') { icon = '🏥'; colorVar = 'var(--accent-cyan)'; }
    else if (ch.id === 'food') { icon = '🍔'; colorVar = 'var(--warning)'; }
    else if (ch.id === 'farayad') { icon = '📚'; colorVar = 'var(--accent-purple)'; }
    else if (ch.id === 'yakashef') { icon = '🌙'; colorVar = 'var(--success)'; }

    const statusBadgeClass = ch.is_active ? 'badge-success' : 'badge-danger';
    const statusBadgeText = ch.is_active ? 'فعال' : 'متوقف';
    const toggleBtnClass = ch.is_active ? 'btn-secondary' : 'btn-success';
    const toggleBtnText = ch.is_active ? 'توقف بازنشر' : 'فعال‌سازی مجدد';

    html += `
      <div class="channel-box" id="channel-card-${ch.id}">
        <div class="channel-box-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">${icon}</span>
            <b style="font-size: 14.5px; color: ${colorVar};">کانال ${idx + 1}: ${ch.title}</b>
            <span class="badge ${statusBadgeClass}" id="ch-badge-${ch.id}">${statusBadgeText}</span>
          </div>
          <div style="display: flex; gap: 6px;">
            <button type="button" class="btn ${toggleBtnClass} btn-sm" id="ch-btn-${ch.id}" onclick="toggleChannel('${ch.id}', this)">
              ${toggleBtnText}
            </button>
            <button type="button" class="btn btn-secondary btn-sm" style="color: var(--danger); border-color: rgba(220, 38, 38, 0.3);" onclick="deleteChannel('${ch.id}', '${ch.title}', this)" title="حذف این کانال">
              🗑️ حذف
            </button>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">مبدأ تلگرام:</label>
            <input type="text" class="form-input" value="${ch.telegram_id || ''}" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">مقصد بله:</label>
            <input type="text" class="form-input" value="${ch.bale_id || '(غیرفعال)'}" readonly>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">مقصد روبیکا:</label>
            <input type="text" class="form-input" value="${ch.rubika_id || '(غیرفعال)'}" readonly>
          </div>
          <div class="form-group">
            <label class="form-label">مقصد ایتا:</label>
            <input type="text" class="form-input" value="${ch.eitaa_id || '(غیرفعال)'}" readonly>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

// --- Update Direct Publish Options with New Channels ---
function updateDirectPublishSelect(channels) {
  const sel = document.getElementById('direct-publish-select');
  if (!sel) return;
  const currentVal = sel.value;
  const titles = channels.filter(c => c.is_active).map(c => c.title).join('، ');
  let html = `<option value="all">🌐 تمام کانال‌های فعال (${titles})</option>`;
  channels.forEach(ch => {
    let icon = '📢';
    if (ch.id === 'health') icon = '🏥';
    else if (ch.id === 'food') icon = '🍔';
    else if (ch.id === 'farayad') icon = '📚';
    else if (ch.id === 'yakashef') icon = '🌙';
    html += `<option value="${ch.id}">${icon} ${ch.title} (${ch.telegram_id})</option>`;
  });
  sel.innerHTML = html;
  if (currentVal) sel.value = currentVal;
}

// --- Toggle Add Channel Form Panel ---
function toggleAddChannelCard() {
  const panel = document.getElementById('add-channel-panel');
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    const input = panel.querySelector('input[name="title"]');
    if (input) input.focus();
  }
}

// --- Submit Add Channel Form ---
async function handleAddChannelSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ در حال ذخیره...';
  }

  const formData = new FormData(form);

  try {
    const res = await fetch('/api/channels/add', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'کانال جدید با موفقیت اضافه و فعال شد!', 'success');
      form.reset();
      toggleAddChannelCard();
      lastChannelsJson = ''; // Force re-render
      refreshStatus();
    } else {
      showToast(data.error || 'خطا در ثبت کانال', 'error');
    }
  } catch (err) {
    showToast(`خطای شبکه: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

// --- Delete Channel ---
async function deleteChannel(channelId, channelTitle, btnElement) {
  if (!confirm(`آیا از حذف کانال «${channelTitle}» مطمئن هستید؟ بازنشر پست‌های آن متوقف خواهد شد.`)) {
    return;
  }
  if (btnElement) btnElement.disabled = true;

  try {
    const res = await fetch(`/api/channels/${channelId}/delete`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'کانال با موفقیت حذف شد.', 'info');
      lastChannelsJson = ''; // Force re-render
      refreshStatus();
    } else {
      showToast(data.error || 'خطا در حذف کانال', 'error');
    }
  } catch (err) {
    showToast(`خطا: ${err.message}`, 'error');
  } finally {
    if (btnElement) btnElement.disabled = false;
  }
}

// --- Toggle Feature (Approval Mode / Ad Filter) ---
async function toggleFeature(feature, btnElement) {
  if (btnElement) btnElement.disabled = true;

  try {
    const res = await fetch('/api/toggle-feature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feature })
    });
    const data = await res.json();
    if (data.success) {
      if (feature === 'approval') {
        showToast(data.enabled ? '🟢 تایید دستی پست‌ها فعال شد' : '⚪ تایید دستی غیرفعال شد (ارسال خودکار)', 'info');
      } else if (feature === 'adfilter') {
        showToast(data.enabled ? '🟢 فیلتر تبلیغات و لینک‌ها فعال شد' : '⚪ فیلتر تبلیغات غیرفعال شد', 'info');
      }
      refreshStatus();
    } else {
      showToast(data.error || 'خطا در تغییر ویژگی', 'error');
    }
  } catch (err) {
    showToast('خطا: ' + err.message, 'error');
  } finally {
    if (btnElement) btnElement.disabled = false;
  }
}

// --- Test Platform Connection ---
async function testConnection(platform, btnElement) {
  const btn = btnElement || (typeof event !== 'undefined' ? event.target : null);
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.innerHTML = '⏳...';
    btn.disabled = true;
  }

  try {
    const res = await fetch(`/api/test-connection/${platform}`, { method: 'POST' });
    const data = await res.json();

    if (data.success || data.connected) {
      showToast(data.message || `ارتباط با ${platform} موفق بود!`, 'success');
    } else {
      showToast(data.error || `خطا در تست اتصال ${platform}`, 'error');
    }
    refreshStatus();
  } catch (err) {
    showToast(`خطای شبکه: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
}

// --- Restart Bot ---
async function restartBot(btnElement) {
  const btn = btnElement || (typeof event !== 'undefined' ? event.target : null);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ در حال راه‌اندازی...';
  }

  try {
    const res = await fetch('/api/restart-bot', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || 'ربات مجدداً فعال شد', 'success');
    setTimeout(refreshStatus, 2000);
  } catch (err) {
    showToast(`خطا در ریستارت: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔄 راه‌اندازی مجدد بات';
    }
  }
}

// --- Send Daily Report Now ---
async function sendDailyReportNow(btnElement) {
  const btn = btnElement || document.getElementById('send-report-btn');
  const original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ در حال ارسال...';
  }

  try {
    const res = await fetch('/api/send-report', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message || 'گزارش روزانه با موفقیت در گروه ارسال شد!', 'success');
    } else {
      showToast(data.error || 'خطا در ارسال گزارش روزانه', 'error');
    }
  } catch (err) {
    showToast(`خطای ارتباط با سرور: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

// --- Preview Daily Report ---
async function previewDailyReport() {
  const box = document.getElementById('report-preview-box');
  if (!box) return;

  if (box.style.display === 'block') {
    box.style.display = 'none';
    return;
  }

  box.style.display = 'block';
  box.innerHTML = '⏳ در حال دریافت پیش‌نمایش...';

  try {
    const res = await fetch('/api/report-preview');
    const data = await res.json();
    if (data.html) {
      const cleanText = data.html
        .replace(/<b>/g, '')
        .replace(/<\/b>/g, '')
        .replace(/<code>/g, '')
        .replace(/<\/code>/g, '')
        .replace(/<i>/g, '')
        .replace(/<\/i>/g, '');
      box.textContent = cleanText;
    } else {
      box.textContent = 'آمار پستی برای امروز ثبت نشده است.';
    }
  } catch (err) {
    box.textContent = `خطا در دریافت پیش‌نمایش: ${err.message}`;
  }
}

// --- Live Activity Log Feed ---
async function refreshLogs() {
  const container = document.getElementById('log-feed-list');
  if (!container) return;

  try {
    const res = await fetch('/api/logs');
    if (!res.ok) return;
    const data = await res.json();

    if (!data.history || data.history.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim); font-size:13px;">هنوز پیامی بازنشر نشده است.</div>';
      return;
    }

    let html = '';
    data.history.forEach(item => {
      const baleRes = item.results?.bale || {};
      const eitaaRes = item.results?.eitaa || {};
      const rubikaRes = item.results?.rubika || {};

      const formatChip = (name, obj) => {
        if (obj.skipped) return `<span class="platform-chip skipped">${name}: رد شد</span>`;
        if (obj.success) return `<span class="platform-chip success">${name}: ✅</span>`;
        return `<span class="platform-chip error" title="${obj.error || ''}">${name}: ❌</span>`;
      };

      html += `
        <div class="log-item">
          <div class="log-item-header">
            <span class="log-source">منبع: ${item.source || 'تلگرام'} (${item.media_type})</span>
            <span class="log-time">${item.timestamp}</span>
          </div>
          <div class="log-content">${item.content_preview || '(بدون متن)'}</div>
          <div class="log-results">
            ${formatChip('بله', baleRes)}
            ${formatChip('روبیکا', rubikaRes)}
            ${formatChip('ایتا', eitaaRes)}
          </div>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    console.error("Logs fetch error", err);
  }
}

// --- Chart.js Instances & Theming ---
let channelsChartInstance = null;
let mediaChartInstance = null;

async function loadChartData() {
  try {
    const res = await fetch('/api/chart-data');
    if (!res.ok) return;
    const data = await res.json();

    // Summary badge
    const badge = document.getElementById('week-summary-badge');
    if (badge && data.summary) {
      badge.textContent = `مجموع هفته: ${data.summary.totalWeekPosts} پست | نرخ موفقیت: ${data.summary.successRate}٪`;
    }

    if (typeof Chart === 'undefined') {
      console.warn('Chart.js not loaded yet');
      return;
    }

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#cbd5e1' : '#334155';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';

    // 1. Channels Weekly Bar Chart
    const ctxChannels = document.getElementById('channelsWeeklyChart');
    if (ctxChannels) {
      const palette = ['#0284c7', '#d97706', '#7c3aed', '#059669', '#e11d48'];
      const datasets = (data.channels || []).map((ch, idx) => ({
        label: ch.title,
        data: ch.data,
        backgroundColor: palette[idx % palette.length],
        borderColor: palette[idx % palette.length],
        borderRadius: 6,
        borderWidth: 1,
        maxBarThickness: 26
      }));

      if (channelsChartInstance) {
        channelsChartInstance.data.labels = data.labels || [];
        channelsChartInstance.data.datasets = datasets;
        channelsChartInstance.options.plugins.legend.labels.color = textColor;
        channelsChartInstance.options.scales.x.ticks.color = textColor;
        channelsChartInstance.options.scales.y.ticks.color = textColor;
        channelsChartInstance.options.scales.x.grid.color = gridColor;
        channelsChartInstance.options.scales.y.grid.color = gridColor;
        channelsChartInstance.update();
      } else {
        channelsChartInstance = new Chart(ctxChannels, {
          type: 'bar',
          data: {
            labels: data.labels || [],
            datasets: datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                labels: {
                  color: textColor,
                  font: { family: 'Vazirmatn', size: 12 }
                }
              },
              tooltip: {
                titleFont: { family: 'Vazirmatn' },
                bodyFont: { family: 'Vazirmatn' }
              }
            },
            scales: {
              x: {
                grid: { color: gridColor },
                ticks: { color: textColor, font: { family: 'Vazirmatn', size: 11 } }
              },
              y: {
                beginAtZero: true,
                grid: { color: gridColor },
                ticks: {
                  precision: 0,
                  color: textColor,
                  font: { family: 'Vazirmatn', size: 11 }
                }
              }
            }
          }
        });
      }
    }

    // 2. Media Types Doughnut Chart
    const ctxMedia = document.getElementById('mediaTypesChart');
    if (ctxMedia) {
      const mediaTypes = data.mediaTypes || { photo: 0, video: 0, text: 0, other: 0 };
      const mediaData = [mediaTypes.photo || 0, mediaTypes.video || 0, mediaTypes.text || 0, mediaTypes.other || 0];

      if (mediaChartInstance) {
        mediaChartInstance.data.datasets[0].data = mediaData;
        mediaChartInstance.options.plugins.legend.labels.color = textColor;
        mediaChartInstance.update();
      } else {
        mediaChartInstance = new Chart(ctxMedia, {
          type: 'doughnut',
          data: {
            labels: ['تصویر 📷', 'ویدیو 🎬', 'متن 📝', 'سایر 📁'],
            datasets: [{
              data: mediaData,
              backgroundColor: ['#0284c7', '#7c3aed', '#059669', '#f59e0b'],
              borderColor: isDark ? '#121826' : '#ffffff',
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: textColor,
                  font: { family: 'Vazirmatn', size: 11.5 },
                  boxWidth: 12
                }
              }
            }
          }
        });
      }
    }

  } catch (err) {
    console.error('Error loading chart data:', err);
  }
}

// --- Direct Publish Handler ---
async function sendDirectPublish(e) {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button[type="submit"]');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ در حال انتشار محتوا...';
  }

  const formData = new FormData(form);

  try {
    const res = await fetch('/api/direct-publish', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.success) {
      showToast(data.message || 'محتوا با موفقیت منتشر شد!', 'success');
      form.reset();
      refreshLogs();
      loadChartData();
    } else {
      showToast(data.error || 'خطا در انتشار محتوا', 'error');
    }
  } catch (err) {
    showToast(`خطا: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

// --- Initial Setup on DOM Ready ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  refreshStatus();
  refreshLogs();
  loadChartData();

  // Polling intervals
  setInterval(refreshStatus, 4000);
  setInterval(refreshLogs, 5000);
  setInterval(loadChartData, 30000);

  const directPublishForm = document.getElementById('direct-publish-form');
  if (directPublishForm) {
    directPublishForm.addEventListener('submit', sendDirectPublish);
  }

  const addChannelForm = document.getElementById('add-channel-form');
  if (addChannelForm) {
    addChannelForm.addEventListener('submit', handleAddChannelSubmit);
  }
});
