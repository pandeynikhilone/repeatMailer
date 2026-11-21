const $ = (id) => document.getElementById(id);
const form = $('schedule-form');
const createButton = $('create-button');
const notice = $('notice');
let appStatus = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function localInputValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function showNotice(message, type = 'success') {
  notice.textContent = message;
  notice.className = `notice ${type}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  window.setTimeout(() => notice.classList.add('hidden'), 7000);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeStyle: 'short'
  }).format(date);
}

function intervalLabel(value) {
  const minutes = Number(value);
  return `Every ${minutes.toLocaleString()} minute${minutes === 1 ? '' : 's'}`;
}

function renderSchedule(item) {
  const statusLabel = item.status === 'active' ? 'Active' : item.status === 'paused' ? 'Paused' : 'Cancelled';
  let statusClass = item.status;
  if (item.lastStatus === 'failed' && item.status === 'active') statusClass = 'failed';
  const nextText = item.status === 'cancelled' ? 'No further sends' : item.status === 'paused' ? 'Paused' : formatDate(item.nextRunAt);
  const lastText = item.lastSentAt ? formatDate(item.lastSentAt) : (item.lastStatus === 'failed' ? 'Failed attempt' : 'Not sent yet');
  const bodyPreview = item.body.length > 280 ? `${item.body.slice(0, 280)}…` : item.body;
  const actionButtons = item.status === 'active'
    ? `<button class="small-button" data-action="pause" data-id="${escapeHtml(item.id)}">Pause</button><button class="small-button danger" data-action="cancel" data-id="${escapeHtml(item.id)}">Cancel</button>`
    : item.status === 'paused'
      ? `<button class="small-button" data-action="resume" data-id="${escapeHtml(item.id)}">Resume</button><button class="small-button danger" data-action="cancel" data-id="${escapeHtml(item.id)}">Cancel</button>`
      : '';
  return `
    <article class="schedule-card">
      <div class="schedule-top">
        <div class="schedule-title"><h3>${escapeHtml(item.subject)}</h3><p>To: ${escapeHtml(item.recipient)} · From: ${escapeHtml(item.sender)}</p></div>
        <span class="status status-${statusClass}">${statusClass === 'failed' ? 'Last send failed' : statusLabel}</span>
      </div>
      <div class="schedule-meta">
        <span class="meta-item">Repeats <b>${escapeHtml(intervalLabel(item.intervalMinutes))}</b></span>
        <span class="meta-item">Next send <b>${escapeHtml(nextText)}</b></span>
        <span class="meta-item">Last sent <b>${escapeHtml(lastText)}</b></span>
      </div>
      <div class="schedule-message">${escapeHtml(bodyPreview)}</div>
      ${item.lastError ? `<p class="error-text">Last error: ${escapeHtml(item.lastError)}</p>` : ''}
      ${actionButtons ? `<div class="schedule-actions">${actionButtons}</div>` : ''}
    </article>`;
}

async function loadStatus() {
  const response = await fetch('/api/status');
  if (!response.ok) throw new Error('Could not read app status.');
  appStatus = await response.json();
  $('sender').value = appStatus.authenticatedSender || appStatus.defaultSender;
  createButton.disabled = !appStatus.configured;
  if (!appStatus.configured) {
    showNotice('Gmail is not connected yet. Add your Gmail App Password to the .env file, restart the app, then create your first schedule.', 'error');
  } else if (!appStatus.senderMatchesDefault) {
    showNotice(`Connected sender: ${appStatus.authenticatedSender}. The sender field has been set to match it.`, 'success');
  }
}

async function loadSchedules() {
  const response = await fetch('/api/schedules');
  if (!response.ok) throw new Error('Could not load schedules.');
  const items = await response.json();
  $('schedule-count').textContent = items.filter(item => item.status !== 'cancelled').length;
  if (!items.length) {
    $('schedules').innerHTML = '<div class="empty-state"><strong>No schedules yet</strong>Your recurring emails will appear here after you create one.</div>';
    return;
  }
  $('schedules').innerHTML = items.map(renderSchedule).join('');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!appStatus?.configured) {
    showNotice('Connect Gmail in the .env file before creating schedules.', 'error');
    return;
  }
  const payload = {
    recipient: $('recipient').value,
    sender: $('sender').value,
    subject: $('subject').value,
    body: $('body').value,
    intervalMinutes: Number($('interval-minutes').value),
    startAt: new Date($('start-at').value).toISOString()
  };
  createButton.disabled = true;
  createButton.textContent = 'Saving schedule…';
  try {
    const response = await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not create schedule.');
    form.reset();
    $('sender').value = appStatus.authenticatedSender;
    $('interval-minutes').value = '1';
    setDefaultStartTime();
    $('body-count').textContent = '0 / 12,000';
    showNotice('Schedule created. It will repeat until you pause or cancel it.');
    await loadSchedules();
  } catch (error) {
    showNotice(error.message, 'error');
  } finally {
    createButton.textContent = 'Create schedule →';
    createButton.disabled = !appStatus?.configured;
  }
});

$('schedules').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'cancel' && !window.confirm('Cancel this recurring email? No future sends will be made.')) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/schedules/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not update schedule.');
    showNotice(action === 'cancel' ? 'Schedule cancelled. No future sends will be made.' : `Schedule ${action === 'pause' ? 'paused' : 'resumed'}.`);
    await loadSchedules();
  } catch (error) {
    showNotice(error.message, 'error');
    button.disabled = false;
  }
});

$('refresh-button').addEventListener('click', () => loadSchedules().catch(error => showNotice(error.message, 'error')));
$('body').addEventListener('input', () => {
  $('body-count').textContent = `${$('body').value.length.toLocaleString()} / 12,000`;
});

function setDefaultStartTime() {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(9, 0, 0, 0);
  $('start-at').value = localInputValue(start);
}

setDefaultStartTime();
Promise.all([loadStatus(), loadSchedules()]).catch(error => showNotice(error.message, 'error'));
window.setInterval(() => loadSchedules().catch(() => {}), 30000);
