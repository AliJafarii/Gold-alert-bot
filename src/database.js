const Database = require('better-sqlite3');
const { mkdirSync } = require('fs');
const { dirname } = require('path');
const { config } = require('./config');

let db;

function nowIso() {
  return new Date().toISOString();
}

function platformChatId(platform, chatId) {
  const id = String(chatId);
  if (!platform || platform === 'telegram') return id;
  return platform + ':' + id;
}

function publicChatId(platform, storedChatId) {
  const id = String(storedChatId);
  const prefix = platform + ':';
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function isChatIdForPlatform(storedChatId, platform) {
  const id = String(storedChatId);
  if (!platform || platform === 'telegram') return !id.includes(':');
  return id.startsWith(platform + ':');
}

function getDb() {
  if (db) return db;
  mkdirSync(dirname(config.databaseFile), { recursive: true });
  db = new Database(config.databaseFile);
  db.pragma('journal_mode = WAL');
  db.exec(`
    create table if not exists users (
      chat_id text primary key,
      first_name text,
      username text,
      is_admin integer not null default 0,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists notification_settings (
      chat_id text primary key,
      interval_minutes integer not null,
      enabled integer not null default 1,
      last_sent_at text,
      created_at text not null,
      updated_at text not null,
      foreign key (chat_id) references users(chat_id) on delete cascade
    );

    create index if not exists idx_notification_enabled
      on notification_settings(enabled, last_sent_at);
  `);
  return db;
}

function upsertUser(chat, isAdmin = false, platform = 'telegram') {
  const id = platformChatId(platform, chat && chat.id ? chat.id : chat);
  const now = nowIso();
  const firstName = chat && chat.first_name ? chat.first_name : null;
  const username = chat && chat.username ? chat.username : null;
  getDb().prepare(`
    insert into users (chat_id, first_name, username, is_admin, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?)
    on conflict(chat_id) do update set
      first_name = excluded.first_name,
      username = excluded.username,
      is_admin = excluded.is_admin,
      updated_at = excluded.updated_at
  `).run(id, firstName, username, isAdmin ? 1 : 0, now, now);
  return getDb().prepare('select * from users where chat_id = ?').get(id);
}

function getNotificationSettings(chatId, platform = 'telegram') {
  return getDb()
    .prepare('select * from notification_settings where chat_id = ?')
    .get(platformChatId(platform, chatId));
}

function upsertNotificationSettings(chatId, intervalMinutes = config.defaultNotificationIntervalMinutes, platform = 'telegram') {
  const id = platformChatId(platform, chatId);
  const existing = getNotificationSettings(chatId, platform);
  const now = nowIso();
  if (existing) return existing;
  upsertUser(chatId, false, platform);
  getDb().prepare(`
    insert into notification_settings
      (chat_id, interval_minutes, enabled, last_sent_at, created_at, updated_at)
    values (?, ?, 1, null, ?, ?)
  `).run(id, intervalMinutes, now, now);
  return getNotificationSettings(chatId, platform);
}

function setNotificationInterval(chatId, intervalMinutes, platform = 'telegram') {
  const id = platformChatId(platform, chatId);
  const now = nowIso();
  upsertNotificationSettings(chatId, intervalMinutes, platform);
  getDb().prepare(`
    update notification_settings
    set interval_minutes = ?, enabled = 1, updated_at = ?
    where chat_id = ?
  `).run(intervalMinutes, now, id);
  return getNotificationSettings(chatId, platform);
}

function setNotificationEnabled(chatId, enabled, platform = 'telegram') {
  const id = platformChatId(platform, chatId);
  const now = nowIso();
  upsertNotificationSettings(chatId, config.defaultNotificationIntervalMinutes, platform);
  getDb().prepare(`
    update notification_settings
    set enabled = ?, updated_at = ?
    where chat_id = ?
  `).run(enabled ? 1 : 0, now, id);
  return getNotificationSettings(chatId, platform);
}

function markNotificationSent(chatId, sentAt = nowIso(), platform = 'telegram') {
  getDb().prepare(`
    update notification_settings
    set last_sent_at = ?, updated_at = ?
    where chat_id = ?
  `).run(sentAt, sentAt, platformChatId(platform, chatId));
}

function listDueNotificationSettings(referenceDate = new Date(), platform = 'telegram') {
  const rows = getDb()
    .prepare('select * from notification_settings where enabled = 1')
    .all()
    .filter((row) => isChatIdForPlatform(row.chat_id, platform));
  const now = referenceDate.getTime();
  return rows.filter((row) => {
    if (!row.last_sent_at) return true;
    const lastSentAt = Date.parse(row.last_sent_at);
    if (!Number.isFinite(lastSentAt)) return true;
    return now - lastSentAt >= row.interval_minutes * 60 * 1000;
  });
}

module.exports = {
  getDb,
  platformChatId,
  publicChatId,
  upsertUser,
  getNotificationSettings,
  upsertNotificationSettings,
  setNotificationInterval,
  setNotificationEnabled,
  markNotificationSent,
  listDueNotificationSettings
};
