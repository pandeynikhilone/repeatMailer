import 'dotenv/config';
import express from 'express';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'schedules.json');
const DEFAULT_SENDER = 'pandeynikhilone@gmail.com';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3030);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

let schedules = [];
let writeChain = Promise.resolve();
const inFlight = new Set();
let transporter = null;

function getTransporter() {
  const user = (process.env.GMAIL_USER || DEFAULT_SENDER).trim().toLowerCase();
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  if (!pass || pass.includes('replace-with')) {
    throw new Error('Gmail is not configured yet. Add your Gmail App Password to the .env file.');
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });
  }
  return { transporter, user };
}

function maskEmail(value) {
  const [name, domain] = String(value || '').split('@');
  if (!name || !domain) return '';
  return `${name.slice(0, 2)}•••@${domain}`;
}

function safeSchedule(item) {
  const { recipient, sender, subject, body, intervalMinutes, startAt, nextRunAt,
    createdAt, lastAttemptAt, lastSentAt, lastError, lastStatus, status, id } = item;
  return { id, recipient, sender, subject, body, intervalMinutes, startAt, nextRunAt,
    createdAt, lastAttemptAt, lastSentAt, lastError, lastStatus, status };
}

async function persist() {
  const snapshot = JSON.stringify(schedules, null, 2);
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temp = `${DATA_FILE}.tmp`;
    await fs.writeFile(temp, snapshot, 'utf8');
    await fs.rename(temp, DATA_FILE);
  });
  return writeChain;
}

async function load() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    schedules = Array.isArray(parsed) ? parsed : [];
    // Migrate schedules created by the earlier daily/weekly/monthly version.
    const legacyMinutes = { daily: 1440, weekly: 10080, monthly: 43200 };
    for (const item of schedules) {
      if (!Number.isInteger(item.intervalMinutes)) {
        item.intervalMinutes = legacyMinutes[item.frequency] || 1440;
      }
      delete item.frequency;
    }
    await persist();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    schedules = [];
    await persist();
  }
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function addInterval(date, intervalMinutes) {
  return new Date(new Date(date).getTime() + intervalMinutes * 60_000);
}

function configStatus() {
  const configuredUser = (process.env.GMAIL_USER || DEFAULT_SENDER).trim().toLowerCase();
  const appPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const configured = Boolean(appPassword && !appPassword.includes('replace-with'));
  return {
    defaultSender: DEFAULT_SENDER,
    authenticatedSender: configuredUser,
    senderMatchesDefault: configuredUser === DEFAULT_SENDER,
    configured,
    host: HOST,
    maxActiveSchedules: 20,
    minIntervalMinutes: 1,
    maxIntervalMinutes: 525600
  };
}

// Local-only guard: the server binds to 127.0.0.1 by default and rejects cross-origin API calls.
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  const host = req.get('host') || '';
  if (HOST === '127.0.0.1' && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    return res.status(403).json({ error: 'This app is configured for local access only.' });
  }
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== String(PORT)) {
        return res.status(403).json({ error: 'Cross-origin requests are not allowed.' });
      }
    } catch {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
  }
  next();
});

app.get('/api/status', (_req, res) => res.json(configStatus()));

app.get('/api/schedules', (_req, res) => {
  const sorted = [...schedules].sort((a, b) => new Date(a.nextRunAt) - new Date(b.nextRunAt));
  res.json(sorted.map(safeSchedule));
});

app.post('/api/schedules', async (req, res) => {
  const { recipient, sender, subject, body, intervalMinutes, startAt } = req.body || {};
  const cleanRecipient = String(recipient || '').trim().toLowerCase();
  const cleanSender = String(sender || '').trim().toLowerCase();
  const cleanSubject = String(subject || '').trim();
  const cleanBody = String(body || '').trim();
  const interval = Number(intervalMinutes);

  if (!isValidEmail(cleanRecipient)) return res.status(400).json({ error: 'Enter a valid recipient email address.' });
  if (!isValidEmail(cleanSender)) return res.status(400).json({ error: 'Enter a valid sender email address.' });
  if (!cleanSubject || cleanSubject.length > 180) return res.status(400).json({ error: 'Subject is required and must be 180 characters or fewer.' });
  if (!cleanBody || cleanBody.length > 12000) return res.status(400).json({ error: 'Message is required and must be 12,000 characters or fewer.' });
  if (!Number.isInteger(interval) || interval < 1 || interval > 525600) {
    return res.status(400).json({ error: 'Repeat interval must be a whole number from 1 to 525,600 minutes.' });
  }

  const { authenticatedSender } = configStatus();
  if (cleanSender !== authenticatedSender) {
    return res.status(400).json({ error: `The sender must match the connected Gmail account (${authenticatedSender}). Gmail does not allow this app to send as an unrelated address.` });
  }

  const startDate = new Date(startAt);
  if (!startAt || Number.isNaN(startDate.getTime())) return res.status(400).json({ error: 'Choose a valid first-send date and time.' });
  if (startDate.getTime() < Date.now() + 60_000) return res.status(400).json({ error: 'Choose a first-send time at least one minute in the future.' });

  const activeCount = schedules.filter(s => s.status === 'active' || s.status === 'paused').length;
  if (activeCount >= 20) return res.status(429).json({ error: 'You have reached the limit of 20 active or paused schedules.' });

  const item = {
    id: crypto.randomUUID(),
    recipient: cleanRecipient,
    sender: cleanSender,
    subject: cleanSubject,
    body: cleanBody,
    intervalMinutes: interval,
    startAt: startDate.toISOString(),
    nextRunAt: startDate.toISOString(),
    createdAt: new Date().toISOString(),
    lastAttemptAt: null,
    lastSentAt: null,
    lastError: null,
    lastStatus: 'not_sent',
    status: 'active'
  };
  schedules.push(item);
  try {
    await persist();
    res.status(201).json(safeSchedule(item));
  } catch {
    schedules = schedules.filter(s => s.id !== item.id);
    res.status(500).json({ error: 'Could not save this schedule.' });
  }
});

app.post('/api/schedules/:id/:action', async (req, res) => {
  const { id, action } = req.params;
  const item = schedules.find(s => s.id === id);
  if (!item) return res.status(404).json({ error: 'Schedule not found.' });
  if (!['pause', 'resume', 'cancel'].includes(action)) return res.status(400).json({ error: 'Unsupported action.' });
  if (action === 'pause' && item.status === 'active') item.status = 'paused';
  if (action === 'resume' && item.status === 'paused') item.status = 'active';
  if (action === 'cancel') item.status = 'cancelled';
  try {
    await persist();
    res.json(safeSchedule(item));
  } catch {
    res.status(500).json({ error: 'Could not update this schedule.' });
  }
});

async function sendDue(item) {
  // Advance and persist before sending. This avoids duplicate sends after an unexpected restart.
  const attemptedAt = new Date();
  item.lastAttemptAt = attemptedAt.toISOString();
  item.nextRunAt = addInterval(attemptedAt, item.intervalMinutes).toISOString();
  item.lastError = null;
  item.lastStatus = 'sending';
  await persist();

  try {
    const { transporter: mailer, user } = getTransporter();
    await mailer.sendMail({
      from: `Scheduled Mail <${user}>`,
      to: item.recipient,
      subject: item.subject,
      text: item.body
    });
    item.lastSentAt = new Date().toISOString();
    item.lastStatus = 'sent';
    item.lastError = null;
  } catch (error) {
    item.lastStatus = 'failed';
    item.lastError = String(error?.message || 'Unknown sending error').slice(0, 500);
  }
  await persist();
}

async function schedulerTick() {
  const now = Date.now();
  const due = schedules.filter(s => s.status === 'active' && new Date(s.nextRunAt).getTime() <= now && !inFlight.has(s.id));
  for (const item of due) {
    inFlight.add(item.id);
    try {
      await sendDue(item);
    } catch (error) {
      item.lastStatus = 'failed';
      item.lastError = String(error?.message || 'Could not persist schedule state').slice(0, 500);
      // Move the next attempt forward by the selected cadence so it cannot retry continuously.
      item.nextRunAt = addInterval(new Date(), item.intervalMinutes).toISOString();
      try { await persist(); } catch { /* keep running; data will be retried on next successful write */ }
    } finally {
      inFlight.delete(item.id);
    }
  }
}

await load();
setInterval(() => { schedulerTick().catch(() => {}); }, 5_000);
schedulerTick().catch(() => {});

app.listen(PORT, HOST, () => {
  console.log(`Repeat Mailer is running at http://${HOST}:${PORT}`);
  console.log('Keep this process running while you want scheduled emails to be sent.');
});
