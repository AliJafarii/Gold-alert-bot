// @ts-nocheck
const { mkdir, readFile, rename, writeFile } = require('fs/promises');
const { dirname } = require('path');
const { config } = require('./config');

let stateWriteQueue = Promise.resolve();

async function readState() {
  try {
    return JSON.parse(await readFile(config.adminAlertStateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { activeKeys: {} };
    if (error instanceof SyntaxError) {
      const brokenFile = config.adminAlertStateFile + '.broken-' + Date.now();
      await rename(config.adminAlertStateFile, brokenFile).catch(() => {});
      return { activeKeys: {}, recoveredFrom: brokenFile };
    }
    throw error;
  }
}

async function writeState(state) {
  stateWriteQueue = stateWriteQueue.catch(() => {}).then(async () => {
    await mkdir(dirname(config.adminAlertStateFile), { recursive: true });
    const tempFile = config.adminAlertStateFile + '.tmp-' + process.pid + '-' + Date.now();
    await writeFile(tempFile, JSON.stringify(state, null, 2));
    await rename(tempFile, config.adminAlertStateFile);
  });
  return stateWriteQueue;
}

function buildErrorAlerts(errors = []) {
  return errors.map((item) => ({
    key: 'error:' + item.source + ':' + item.error,
    source: item.source,
    reason: 'error',
    message: 'منبع ' + item.source + ' خطا داد: ' + item.error
  }));
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatAdminAlert(alerts) {
  return [
    '<b>🛡 هشدار ادمین نبض بازار</b>',
    '',
    ...alerts.map((alert) => '⚠️ ' + escapeHtml(alert.message)),
    '',
    'این منابع در میانگین فعلی اثر داده نشده‌اند یا نیاز به بررسی دارند.'
  ].join('\n');
}

function isCriticalAdminAlert(alert) {
  const severity = String(alert && alert.severity || '').toLowerCase();
  const reason = String(alert && alert.reason || '').toLowerCase();
  const key = String(alert && alert.key || '').toLowerCase();
  const message = String(alert && alert.message || '').toLowerCase();

  if (['critical', 'security', 'server_down', 'outage'].includes(severity)) return true;
  if (['security', 'server_down', 'server-down', 'outage'].includes(reason)) return true;
  return /security|server[_ -]?down|outage|breach|unauthorized|compromised/.test(key + ' ' + message);
}

async function getNewAdminAlerts(snapshot) {
  const alerts = [
    ...buildErrorAlerts(snapshot.sourceErrors || []),
    ...(snapshot.sourceAlerts || [])
  ].filter(isCriticalAdminAlert);
  if (!alerts.length) {
    const cleanState = { activeKeys: {}, updatedAt: new Date().toISOString() };
    await writeState(cleanState);
    return [];
  }

  const state = await readState();
  const activeKeys = {};
  const newAlerts = [];
  for (const alert of alerts) {
    activeKeys[alert.key] = {
      source: alert.source,
      reason: alert.reason,
      message: alert.message,
      lastSeenAt: new Date().toISOString()
    };
    if (!state.activeKeys || !state.activeKeys[alert.key]) {
      newAlerts.push(alert);
    }
  }

  await writeState({ activeKeys, updatedAt: new Date().toISOString() });
  return newAlerts;
}

module.exports = { formatAdminAlert, getNewAdminAlerts };
