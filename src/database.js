const Database = require('better-sqlite3');
const { mkdirSync } = require('fs');
const { dirname } = require('path');
const { config } = require('./config');

let db;

function nowIso() {
  return new Date().toISOString();
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

function upsertUser(chat, isAdmin = false) {
  const id = String(chat && chat.id ? chat.id : chat);
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

function getNotificationSettings(chatId) {
  return getDb()
    .prepare('select * from notification_settings where chat_id = ?')
    .get(String(chatId));
}

function upsertNotificationSettings(chatId, intervalMinutes = config.defaultNotificationIntervalMinutes) {
  const id = String(chatId);
  const existing = getNotificationSettings(id);
  const now = nowIso();
  if (existing) return existing;
  upsertUser(id);
  getDb().prepare(`
    insert into notification_settings
      (chat_id, interval_minutes, enabled, last_sent_at, created_at, updated_at)
    values (?, ?, 1, null, ?, ?)
  `).run(id, intervalMinutes, now, now);
  return getNotificationSettings(id);
}

function setNotificationInterval(chatId, intervalMinutes) {
  const id = String(chatId);
  const now = nowIso();
  upsertNotificationSettings(id, intervalMinutes);
  getDb().prepare(`
    update notification_settings
    set interval_minutes = ?, enabled = 1, updated_at = ?
    where chat_id = ?
  `).run(intervalMinutes, now, id);
  return getNotificationSettings(id);
}

function setNotificationEnabled(chatId, enabled) {
  const id = String(chatId);
  const now = nowIso();
  upsertNotificationSettings(id);
  getDb().prepare(`
    update notification_settings
    set enabled = ?, updated_at = ?
    where chat_id = ?
  `).run(enabled ? 1 : 0, now, id);
  return getNotificationSettings(id);
}

function markNotificationSent(chatId, sentAt = nowIso()) {
  getDb().prepare(`
    update notification_settings
    set last_sent_at = ?, updated_at = ?
    where chat_id = ?
  `).run(sentAt, sentAt, String(chatId));
}

function listDueNotificationSettings(referenceDate = new Date()) {
  const rows = getDb()
    .prepare('select * from notification_settings where enabled = 1')
    .all();
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
  upsertUser,
  getNotificationSettings,
  upsertNotificationSettings,
  setNotificationInterval,
  setNotificationEnabled,
  markNotificationSent,
  listDueNotificationSettings
};
