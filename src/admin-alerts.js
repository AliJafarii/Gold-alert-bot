const { mkdir, readFile, writeFile } = require('fs/promises');
const { dirname } = require('path');
const { config } = require('./config');

async function readState() {
  try {
    return JSON.parse(await readFile(config.adminAlertStateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { activeKeys: {} };
    throw error;
  }
}

async function writeState(state) {
  await mkdir(dirname(config.adminAlertStateFile), { recursive: true });
  await writeFile(config.adminAlertStateFile, JSON.stringify(state, null, 2));
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
    'آقا سید،',
    '<b>🛡 هشدار ادمین بات طلا</b>',
    '',
    ...alerts.map((alert) => '⚠️ ' + escapeHtml(alert.message)),
    '',
    'این منابع در میانگین فعلی اثر داده نشده‌اند یا نیاز به بررسی دارند.'
  ].join('\n');
}

async function getNewAdminAlerts(snapshot) {
  const alerts = [
    ...buildErrorAlerts(snapshot.sourceErrors || []),
    ...(snapshot.sourceAlerts || [])
  ];
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
