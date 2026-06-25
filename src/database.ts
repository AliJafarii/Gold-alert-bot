// @ts-nocheck
const Database = require('better-sqlite3');
const crypto = require('crypto');
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

function platformFromStoredChatId(chatId) {
  const id = String(chatId);
  return id.includes(':') ? id.split(':', 1)[0] : 'telegram';
}

function publicChatIdFromStored(storedChatId) {
  const id = String(storedChatId);
  return id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
}

function columnExists(table, column) {
  return getDb().prepare('pragma table_info(' + table + ')').all()
    .some((item) => item.name === column);
}

function addColumnIfMissing(table, column, definition) {
  if (!columnExists(table, column)) {
    getDb().exec('alter table ' + table + ' add column ' + column + ' ' + definition);
  }
}

function normalizePhone(raw) {
  let digits = String(raw || '')
    .replace(/[۰-۹]/g, (char) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(char)))
    .replace(/[٠-٩]/g, (char) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(char)))
    .replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0098')) digits = digits.slice(2);
  if (digits.startsWith('98') && digits.length === 12) return '+' + digits;
  if (digits.startsWith('0') && digits.length === 11) return '+98' + digits.slice(1);
  if (digits.startsWith('9') && digits.length === 10) return '+98' + digits;
  return null;
}

function createProfile(displayName = null) {
  const now = nowIso();
  const result = getDb().prepare(`
    insert into profiles (display_name, plan, created_at, updated_at)
    values (?, 'free', ?, ?)
  `).run(displayName, now, now);
  const profileId = Number(result.lastInsertRowid);
  ensureProfileNotificationSettings(profileId);
  ensureSubscription(profileId);
  return profileId;
}

function ensureProfileNotificationSettings(profileId, intervalMinutes = config.defaultNotificationIntervalMinutes) {
  const now = nowIso();
  getDb().prepare(`
    insert into profile_notification_settings
      (profile_id, interval_minutes, enabled, created_at, updated_at)
    values (?, ?, 1, ?, ?)
    on conflict(profile_id) do nothing
  `).run(profileId, intervalMinutes, now, now);
}

function migrateProfiles() {
  const rows = getDb().prepare('select * from users').all();
  for (const row of rows) {
    let profileId = row.profile_id;
    if (!profileId) {
      profileId = createProfile(row.first_name);
      getDb().prepare('update users set profile_id = ? where chat_id = ?').run(profileId, row.chat_id);
    }
    const platform = row.platform || platformFromStoredChatId(row.chat_id);
    const platformChatId = row.platform_chat_id || publicChatIdFromStored(row.chat_id);
    getDb().prepare(`
      update users
      set platform = ?, platform_chat_id = ?
      where chat_id = ?
    `).run(platform, platformChatId, row.chat_id);
  }

  const legacySettings = getDb().prepare('select * from notification_settings').all();
  for (const setting of legacySettings) {
    const user = getDb().prepare('select * from users where chat_id = ?').get(setting.chat_id);
    if (!user || !user.profile_id) continue;
    getDb().prepare(`
      insert into profile_notification_settings
        (profile_id, interval_minutes, enabled, created_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(profile_id) do update set
        interval_minutes = excluded.interval_minutes,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
    `).run(
      user.profile_id,
      setting.interval_minutes,
      setting.enabled,
      setting.created_at || nowIso(),
      setting.updated_at || nowIso()
    );
  }
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

    create table if not exists profiles (
      id integer primary key autoincrement,
      display_name text,
      plan text not null default 'free',
      created_at text not null,
      updated_at text not null
    );

    create table if not exists profile_notification_settings (
      profile_id integer primary key,
      interval_minutes integer not null,
      enabled integer not null default 1,
      created_at text not null,
      updated_at text not null,
      foreign key (profile_id) references profiles(id) on delete cascade
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

    create table if not exists payment_history (
      id integer primary key autoincrement,
      profile_id integer not null,
      amount integer,
      currency text,
      status text not null default 'pending',
      provider text,
      reference text,
      created_at text not null,
      foreign key (profile_id) references profiles(id) on delete cascade
    );

    create table if not exists account_link_codes (
      code text primary key,
      profile_id integer not null,
      expires_at text not null,
      used_at text,
      created_at text not null,
      foreign key (profile_id) references profiles(id) on delete cascade
    );

    create index if not exists idx_notification_enabled
      on notification_settings(enabled, last_sent_at);

  `);
  addColumnIfMissing('users', 'profile_id', 'integer');
  addColumnIfMissing('users', 'platform', 'text');
  addColumnIfMissing('users', 'platform_chat_id', 'text');
  addColumnIfMissing('profiles', 'phone', 'text');
  addColumnIfMissing('profiles', 'phone_verified_at', 'text');
  db.exec(`
    create index if not exists idx_users_profile_id
      on users(profile_id);

    create index if not exists idx_users_platform
      on users(platform, platform_chat_id);

    create index if not exists idx_profiles_phone
      on profiles(phone);

    create table if not exists market_history (
      id integer primary key autoincrement,
      timestamp text not null,
      gold18_price real,
      coin_price real,
      dollar_toman real,
      ounce_usd real,
      silver_price real,
      silver_ounce_usd real,
      theoretical_silver_rial real,
      silver_bubble_value real,
      silver_bubble_percent real,
      theoretical_gold18_rial real,
      gold_bubble_value real,
      gold_bubble_percent real,
      intrinsic_value real,
      bubble_value real,
      bubble_percent real,
      decision text,
      sources_json text
    );

    create index if not exists idx_market_history_timestamp
      on market_history(timestamp);

    create table if not exists source_audit_batches (
      id integer primary key autoincrement,
      source_name text not null,
      created_at text not null,
      read_mode text,
      sample_count integer,
      average_dollar_toman real
    );

    create table if not exists source_audit_messages (
      id integer primary key autoincrement,
      batch_id integer not null,
      status text not null,
      reason text,
      price real,
      telegram_message_id text,
      message_datetime text,
      text text,
      foreign key (batch_id) references source_audit_batches(id) on delete cascade
    );

    create index if not exists idx_source_audit_batches_source_created
      on source_audit_batches(source_name, created_at);

    create index if not exists idx_source_audit_messages_batch
      on source_audit_messages(batch_id);

    create table if not exists subscriptions (
      id integer primary key autoincrement,
      profile_id integer not null unique,
      plan text not null default 'pro',
      status text not null default 'trial',
      started_at text,
      expires_at text,
      trial_started_at text,
      trial_ends_at text,
      payment_reference text,
      auto_renew_enabled integer not null default 0,
      created_at text not null,
      updated_at text not null,
      foreign key (profile_id) references profiles(id) on delete cascade
    );

    create table if not exists price_alerts (
      id integer primary key autoincrement,
      profile_id integer not null,
      asset text not null,
      condition text not null,
      target_price real not null,
      is_active integer not null default 1,
      repeat_type text not null default 'once',
      last_triggered_at text,
      created_at text not null,
      updated_at text not null,
      foreign key (profile_id) references profiles(id) on delete cascade
    );

    create index if not exists idx_price_alerts_active
      on price_alerts(is_active, asset);

    create table if not exists scheduled_reports (
      id integer primary key autoincrement,
      profile_id integer not null,
      assets_json text not null,
      schedule_time text not null,
      days_of_week_json text not null,
      messenger_channel text not null default 'telegram',
      is_active integer not null default 1,
      last_sent_at text,
      created_at text not null,
      updated_at text not null,
      foreign key (profile_id) references profiles(id) on delete cascade
    );

    create index if not exists idx_scheduled_reports_active
      on scheduled_reports(is_active, schedule_time);

    create table if not exists outbound_message_log (
      id integer primary key autoincrement,
      profile_id integer,
      platform text,
      chat_id text,
      message_type text,
      status text not null,
      error_message text,
      created_at text not null
    );

    create table if not exists alert_trigger_log (
      id integer primary key autoincrement,
      alert_id integer,
      profile_id integer not null,
      asset text not null,
      price real,
      message text,
      created_at text not null
    );

    create table if not exists channel_publish_state (
      id integer primary key check (id = 1),
      last_published_at text,
      updated_at text not null
    );
  `);
  addColumnIfMissing('payment_history', 'method', 'text');
  addColumnIfMissing('payment_history', 'receipt_text', 'text');
  addColumnIfMissing('payment_history', 'verified_at', 'text');
  migrateProfiles();
  return db;
}

function saveSourceAudit(sourceName, audit) {
  if (!sourceName || !audit) return null;
  const database = getDb();
  const now = nowIso();
  const accepted = Array.isArray(audit.accepted) ? audit.accepted : [];
  const rejected = Array.isArray(audit.rejected) ? audit.rejected : [];
  const tx = database.transaction(() => {
    const batch = database.prepare(`
      insert into source_audit_batches
        (source_name, created_at, read_mode, sample_count, average_dollar_toman)
      values (?, ?, ?, ?, ?)
    `).run(
      sourceName,
      now,
      audit.readMode || null,
      accepted.length,
      audit.averageDollarToman || null
    );
    const batchId = Number(batch.lastInsertRowid);
    const insertMessage = database.prepare(`
      insert into source_audit_messages
        (batch_id, status, reason, price, telegram_message_id, message_datetime, text)
      values (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of accepted) {
      insertMessage.run(
        batchId,
        'accepted',
        null,
        item.value || item.price || null,
        item.messageId ? String(item.messageId) : null,
        item.datetime || null,
        item.text || null
      );
    }
    for (const item of rejected) {
      insertMessage.run(
        batchId,
        'rejected',
        item.reason || null,
        null,
        item.messageId ? String(item.messageId) : null,
        item.datetime || null,
        item.text || null
      );
    }
    const oldBatches = database.prepare(`
      select id from source_audit_batches
      where source_name = ?
      order by created_at desc, id desc
      limit -1 offset 20
    `).all(sourceName).map((row) => row.id);
    if (oldBatches.length) {
      const placeholders = oldBatches.map(() => '?').join(',');
      database.prepare('delete from source_audit_messages where batch_id in (' + placeholders + ')').run(...oldBatches);
      database.prepare('delete from source_audit_batches where id in (' + placeholders + ')').run(...oldBatches);
    }
    return batchId;
  });
  return tx();
}

function getLatestSourceAudit(sourceName) {
  const database = getDb();
  const batch = database.prepare(`
    select * from source_audit_batches
    where source_name = ?
    order by created_at desc, id desc
    limit 1
  `).get(sourceName);
  if (!batch) return null;
  const rows = database.prepare(`
    select * from source_audit_messages
    where batch_id = ?
    order by id asc
  `).all(batch.id);
  return {
    ...batch,
    accepted: rows.filter((row) => row.status === 'accepted'),
    rejected: rows.filter((row) => row.status === 'rejected')
  };
}

function upsertUser(chat, isAdmin = false, platform = 'telegram') {
  const id = platformChatId(platform, chat && chat.id ? chat.id : chat);
  const now = nowIso();
  const firstName = chat && chat.first_name ? chat.first_name : null;
  const username = chat && chat.username ? chat.username : null;
  const existing = getDb().prepare('select * from users where chat_id = ?').get(id);
  const profileId = existing && existing.profile_id
    ? existing.profile_id
    : createProfile(firstName);
  getDb().prepare(`
    insert into users
      (chat_id, first_name, username, is_admin, created_at, updated_at, profile_id, platform, platform_chat_id)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(chat_id) do update set
      first_name = coalesce(excluded.first_name, users.first_name),
      username = coalesce(excluded.username, users.username),
      is_admin = case when users.is_admin = 1 then 1 else excluded.is_admin end,
      profile_id = coalesce(users.profile_id, excluded.profile_id),
      platform = excluded.platform,
      platform_chat_id = excluded.platform_chat_id,
      updated_at = excluded.updated_at
  `).run(id, firstName, username, isAdmin ? 1 : 0, now, now, profileId, platform, String(chat && chat.id ? chat.id : chat));
  ensureProfileNotificationSettings(profileId);
  ensureSubscription(profileId);
  return getDb().prepare('select * from users where chat_id = ?').get(id);
}

function getNotificationSettings(chatId, platform = 'telegram') {
  const id = platformChatId(platform, chatId);
  const user = getDb().prepare('select * from users where chat_id = ?').get(id);
  if (!user || !user.profile_id) return null;
  ensureProfileNotificationSettings(user.profile_id);
  const profileSettings = getDb()
    .prepare('select * from profile_notification_settings where profile_id = ?')
    .get(user.profile_id);
  const delivery = getDb()
    .prepare('select * from notification_settings where chat_id = ?')
    .get(id);
  return {
    ...profileSettings,
    chat_id: id,
    profile_id: user.profile_id,
    last_sent_at: delivery && delivery.last_sent_at
  };
}

function upsertNotificationSettings(chatId, intervalMinutes = config.defaultNotificationIntervalMinutes, platform = 'telegram') {
  const id = platformChatId(platform, chatId);
  const user = upsertUser(chatId, false, platform);
  ensureProfileNotificationSettings(user.profile_id, intervalMinutes);
  const existingDelivery = getDb().prepare('select * from notification_settings where chat_id = ?').get(id);
  const now = nowIso();
  if (!existingDelivery) {
    getDb().prepare(`
      insert into notification_settings
        (chat_id, interval_minutes, enabled, last_sent_at, created_at, updated_at)
      values (?, ?, 1, null, ?, ?)
    `).run(id, intervalMinutes, now, now);
  }
  return getNotificationSettings(chatId, platform);
}

function setNotificationInterval(chatId, intervalMinutes, platform = 'telegram') {
  const id = platformChatId(platform, chatId);
  const now = nowIso();
  const user = upsertUser(chatId, false, platform);
  upsertNotificationSettings(chatId, intervalMinutes, platform);
  getDb().prepare(`
    update profile_notification_settings
    set interval_minutes = ?, enabled = 1, updated_at = ?
    where profile_id = ?
  `).run(intervalMinutes, now, user.profile_id);
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
  const user = upsertUser(chatId, false, platform);
  upsertNotificationSettings(chatId, config.defaultNotificationIntervalMinutes, platform);
  getDb().prepare(`
    update profile_notification_settings
    set enabled = ?, updated_at = ?
    where profile_id = ?
  `).run(enabled ? 1 : 0, now, user.profile_id);
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
    .prepare(`
      select
        u.chat_id,
        u.profile_id,
        pns.interval_minutes,
        pns.enabled,
        ns.last_sent_at
      from users u
      join profile_notification_settings pns on pns.profile_id = u.profile_id
      left join notification_settings ns on ns.chat_id = u.chat_id
      where pns.enabled = 1
    `)
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

function getProfile(chatId, platform = 'telegram') {
  const user = upsertUser(chatId, false, platform);
  ensureSubscription(user.profile_id);
  const profile = getDb().prepare('select * from profiles where id = ?').get(user.profile_id);
  const settings = getNotificationSettings(chatId, platform);
  const subscription = getSubscription(user.profile_id);
  const alertCounts = getAlertCounts(user.profile_id);
  const reportCounts = getScheduledReportCounts(user.profile_id);
  const accounts = getDb().prepare(`
    select chat_id, platform, platform_chat_id, first_name, username, created_at, updated_at
    from users
    where profile_id = ?
    order by platform
  `).all(user.profile_id);
  const payments = getDb().prepare(`
    select amount, currency, status, provider, reference, created_at
    from payment_history
    where profile_id = ?
    order by created_at desc
    limit 10
  `).all(user.profile_id);
  return { profile, settings, subscription, alertCounts, reportCounts, accounts, payments };
}

function mergeProfiles(sourceProfileId, targetProfileId) {
  if (!sourceProfileId || !targetProfileId || sourceProfileId === targetProfileId) return targetProfileId;
  const now = nowIso();
  const sourceSettings = getDb()
    .prepare('select * from profile_notification_settings where profile_id = ?')
    .get(sourceProfileId);
  const targetSettings = getDb()
    .prepare('select * from profile_notification_settings where profile_id = ?')
    .get(targetProfileId);
  const tx = getDb().transaction(() => {
    getDb().prepare('update users set profile_id = ?, updated_at = ? where profile_id = ?')
      .run(targetProfileId, now, sourceProfileId);
    getDb().prepare('update payment_history set profile_id = ? where profile_id = ?')
      .run(targetProfileId, sourceProfileId);
    getDb().prepare('update price_alerts set profile_id = ?, updated_at = ? where profile_id = ?')
      .run(targetProfileId, now, sourceProfileId);
    getDb().prepare('update scheduled_reports set profile_id = ?, updated_at = ? where profile_id = ?')
      .run(targetProfileId, now, sourceProfileId);
    getDb().prepare('delete from subscriptions where profile_id = ?').run(sourceProfileId);
    getDb().prepare('update account_link_codes set profile_id = ? where profile_id = ? and used_at is null')
      .run(targetProfileId, sourceProfileId);
    if (sourceSettings && targetSettings && Date.parse(sourceSettings.updated_at) > Date.parse(targetSettings.updated_at)) {
      getDb().prepare(`
        update profile_notification_settings
        set interval_minutes = ?, enabled = ?, updated_at = ?
        where profile_id = ?
      `).run(sourceSettings.interval_minutes, sourceSettings.enabled, now, targetProfileId);
    }
    getDb().prepare('delete from profile_notification_settings where profile_id = ?').run(sourceProfileId);
    getDb().prepare('delete from profiles where id = ?').run(sourceProfileId);
  });
  tx();
  return targetProfileId;
}

function setProfilePhone(chatId, rawPhone, platform = 'telegram') {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { ok: false, reason: 'invalid_phone' };
  const user = upsertUser(chatId, false, platform);
  const now = nowIso();
  const existingProfile = getDb()
    .prepare('select * from profiles where phone = ? and id != ? order by updated_at desc limit 1')
    .get(phone, user.profile_id);
  getDb().prepare(`
    update profiles
    set phone = ?, phone_verified_at = ?, updated_at = ?
    where id = ?
  `).run(phone, now, now, user.profile_id);
  if (!existingProfile) {
    return { ok: true, linked: false, phone, profileId: user.profile_id };
  }
  const targetProfileId = mergeProfiles(user.profile_id, existingProfile.id);
  getDb().prepare(`
    update profiles
    set phone = ?, phone_verified_at = ?, updated_at = ?
    where id = ?
  `).run(phone, now, now, targetProfileId);
  return { ok: true, linked: true, phone, profileId: targetProfileId };
}

function createAccountLinkCode(chatId, platform = 'telegram') {
  const user = upsertUser(chatId, false, platform);
  const code = crypto.randomInt(100000, 1000000).toString();
  const now = nowIso();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  getDb().prepare(`
    insert into account_link_codes (code, profile_id, expires_at, created_at)
    values (?, ?, ?, ?)
  `).run(code, user.profile_id, expiresAt, now);
  return { code, expiresAt };
}

function linkAccountWithCode(chatId, code, platform = 'telegram') {
  const normalizedCode = String(code || '').trim();
  const link = getDb().prepare(`
    select * from account_link_codes
    where code = ? and used_at is null
  `).get(normalizedCode);
  if (!link) return { ok: false, reason: 'not_found' };
  if (Date.parse(link.expires_at) < Date.now()) return { ok: false, reason: 'expired' };

  const user = upsertUser(chatId, false, platform);
  const now = nowIso();
  const tx = getDb().transaction(() => {
    getDb().prepare('update users set profile_id = ?, updated_at = ? where chat_id = ?')
      .run(link.profile_id, now, user.chat_id);
    getDb().prepare('update account_link_codes set used_at = ? where code = ?')
      .run(now, normalizedCode);
  });
  tx();
  return { ok: true, profileId: link.profile_id };
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function ensureSubscription(profileId) {
  if (!profileId) return null;
  const database = getDb();
  const existing = database.prepare('select * from subscriptions where profile_id = ?').get(profileId);
  if (existing) return existing;
  const now = nowIso();
  const trialEndsAt = addDays(new Date(), config.trialDays || 7).toISOString();
  database.prepare(`
    insert into subscriptions
      (profile_id, plan, status, started_at, expires_at, trial_started_at, trial_ends_at, created_at, updated_at)
    values (?, 'pro', 'trial', ?, ?, ?, ?, ?, ?)
  `).run(profileId, now, trialEndsAt, now, trialEndsAt, now, now);
  return database.prepare('select * from subscriptions where profile_id = ?').get(profileId);
}

function refreshSubscriptionStatus(subscription) {
  if (!subscription) return null;
  if (['trial', 'active'].includes(subscription.status)
    && subscription.expires_at
    && Date.parse(subscription.expires_at) <= Date.now()) {
    const now = nowIso();
    getDb().prepare(`
      update subscriptions
      set status = 'expired', updated_at = ?
      where id = ?
    `).run(now, subscription.id);
    return getDb().prepare('select * from subscriptions where id = ?').get(subscription.id);
  }
  return subscription;
}

function getSubscription(profileId) {
  return refreshSubscriptionStatus(ensureSubscription(profileId));
}

function getSubscriptionForChat(chatId, platform = 'telegram') {
  const user = upsertUser(chatId, false, platform);
  return getSubscription(user.profile_id);
}

function subscriptionHasPaidAccess(subscription) {
  const active = refreshSubscriptionStatus(subscription);
  return Boolean(active && ['trial', 'active'].includes(active.status));
}

function planLimits(subscription) {
  const active = refreshSubscriptionStatus(subscription);
  if (!active || active.status === 'expired' || active.status === 'cancelled') {
    return { priceAlerts: 0, scheduledReports: 0, messengers: 1 };
  }
  if (active.status === 'trial' || active.plan === 'pro') {
    return { priceAlerts: 30, scheduledReports: 6, messengers: 2 };
  }
  if (active.plan === 'basic') {
    return { priceAlerts: 5, scheduledReports: 1, messengers: 1 };
  }
  return { priceAlerts: 1, scheduledReports: 0, messengers: 1 };
}

function setSubscription(profileId, plan, status, days, paymentReference = null) {
  ensureSubscription(profileId);
  const now = nowIso();
  const normalizedPlan = ['free', 'basic', 'pro'].includes(plan) ? plan : 'basic';
  const normalizedStatus = ['free', 'trial', 'active', 'expired', 'cancelled'].includes(status) ? status : 'active';
  const expiresAt = Number(days) > 0 ? addDays(new Date(), Number(days)).toISOString() : null;
  getDb().prepare(`
    update subscriptions
    set plan = ?, status = ?, started_at = ?, expires_at = ?, payment_reference = ?, updated_at = ?
    where profile_id = ?
  `).run(normalizedPlan, normalizedStatus, now, expiresAt, paymentReference, now, profileId);
  getDb().prepare(`
    update profiles
    set plan = ?, updated_at = ?
    where id = ?
  `).run(normalizedPlan, now, profileId);
  return getSubscription(profileId);
}

function recordPayment(profileId, amount, method = 'manual', reference = null, status = 'pending', receiptText = null) {
  const now = nowIso();
  const result = getDb().prepare(`
    insert into payment_history
      (profile_id, amount, currency, status, provider, reference, method, receipt_text, created_at)
    values (?, ?, 'IRR', ?, 'manual', ?, ?, ?, ?)
  `).run(profileId, amount || null, status, reference, method, receiptText, now);
  return getDb().prepare('select * from payment_history where id = ?').get(Number(result.lastInsertRowid));
}

function getAlertCounts(profileId) {
  const row = getDb().prepare(`
    select
      count(*) as total,
      sum(case when is_active = 1 then 1 else 0 end) as active
    from price_alerts
    where profile_id = ?
  `).get(profileId) || {};
  return { total: Number(row.total || 0), active: Number(row.active || 0) };
}

function getScheduledReportCounts(profileId) {
  const row = getDb().prepare(`
    select
      count(*) as total,
      sum(case when is_active = 1 then 1 else 0 end) as active
    from scheduled_reports
    where profile_id = ?
  `).get(profileId) || {};
  return { total: Number(row.total || 0), active: Number(row.active || 0) };
}

function createPriceAlert(chatId, platform, alert) {
  const user = upsertUser(chatId, false, platform);
  const subscription = getSubscription(user.profile_id);
  const limits = planLimits(subscription);
  const counts = getAlertCounts(user.profile_id);
  if (counts.active >= limits.priceAlerts) {
    return { ok: false, reason: 'limit', limit: limits.priceAlerts, subscription };
  }
  const now = nowIso();
  const result = getDb().prepare(`
    insert into price_alerts
      (profile_id, asset, condition, target_price, is_active, repeat_type, created_at, updated_at)
    values (?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    user.profile_id,
    alert.asset,
    alert.condition,
    alert.targetPrice,
    alert.repeatType || 'once',
    now,
    now
  );
  return {
    ok: true,
    alert: getDb().prepare('select * from price_alerts where id = ?').get(Number(result.lastInsertRowid)),
    subscription
  };
}

function listPriceAlerts(chatId, platform = 'telegram') {
  const user = upsertUser(chatId, false, platform);
  return getDb().prepare(`
    select * from price_alerts
    where profile_id = ?
    order by is_active desc, id desc
  `).all(user.profile_id);
}

function setPriceAlertActive(chatId, platform, alertId, active) {
  const user = upsertUser(chatId, false, platform);
  const now = nowIso();
  const result = getDb().prepare(`
    update price_alerts
    set is_active = ?, updated_at = ?
    where id = ? and profile_id = ?
  `).run(active ? 1 : 0, now, alertId, user.profile_id);
  return result.changes > 0;
}

function listActivePriceAlerts() {
  return getDb().prepare(`
    select pa.*, s.plan, s.status, s.expires_at
    from price_alerts pa
    join subscriptions s on s.profile_id = pa.profile_id
    where pa.is_active = 1
    order by pa.id asc
  `).all();
}

function markPriceAlertTriggered(alertId, message, price, deactivate = false) {
  const now = nowIso();
  const alert = getDb().prepare('select * from price_alerts where id = ?').get(alertId);
  if (!alert) return null;
  getDb().prepare(`
    update price_alerts
    set last_triggered_at = ?, is_active = case when ? then 0 else is_active end, updated_at = ?
    where id = ?
  `).run(now, deactivate ? 1 : 0, now, alertId);
  getDb().prepare(`
    insert into alert_trigger_log (alert_id, profile_id, asset, price, message, created_at)
    values (?, ?, ?, ?, ?, ?)
  `).run(alert.id, alert.profile_id, alert.asset, price || null, message || null, now);
  return getDb().prepare('select * from price_alerts where id = ?').get(alertId);
}

function createScheduledReport(chatId, platform, report) {
  const user = upsertUser(chatId, false, platform);
  const subscription = getSubscription(user.profile_id);
  const limits = planLimits(subscription);
  const counts = getScheduledReportCounts(user.profile_id);
  if (counts.active >= limits.scheduledReports) {
    return { ok: false, reason: 'limit', limit: limits.scheduledReports, subscription };
  }
  const now = nowIso();
  const result = getDb().prepare(`
    insert into scheduled_reports
      (profile_id, assets_json, schedule_time, days_of_week_json, messenger_channel, is_active, created_at, updated_at)
    values (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    user.profile_id,
    JSON.stringify(report.assets || []),
    report.scheduleTime,
    JSON.stringify(report.daysOfWeek || [0, 1, 2, 3, 4, 5, 6]),
    report.messengerChannel || platform || 'telegram',
    now,
    now
  );
  return {
    ok: true,
    report: getDb().prepare('select * from scheduled_reports where id = ?').get(Number(result.lastInsertRowid)),
    subscription
  };
}

function listScheduledReports(chatId, platform = 'telegram') {
  const user = upsertUser(chatId, false, platform);
  return getDb().prepare(`
    select * from scheduled_reports
    where profile_id = ?
    order by is_active desc, schedule_time asc, id desc
  `).all(user.profile_id);
}

function setScheduledReportActive(chatId, platform, reportId, active) {
  const user = upsertUser(chatId, false, platform);
  const now = nowIso();
  const result = getDb().prepare(`
    update scheduled_reports
    set is_active = ?, updated_at = ?
    where id = ? and profile_id = ?
  `).run(active ? 1 : 0, now, reportId, user.profile_id);
  return result.changes > 0;
}

function listActiveScheduledReports() {
  return getDb().prepare(`
    select sr.*, s.plan, s.status, s.expires_at
    from scheduled_reports sr
    join subscriptions s on s.profile_id = sr.profile_id
    where sr.is_active = 1
    order by sr.schedule_time asc, sr.id asc
  `).all();
}

function markScheduledReportSent(reportId, sentAt = nowIso()) {
  getDb().prepare(`
    update scheduled_reports
    set last_sent_at = ?, updated_at = ?
    where id = ?
  `).run(sentAt, sentAt, reportId);
}

function listProfileRecipients(profileId) {
  return getDb().prepare(`
    select chat_id, platform, platform_chat_id, first_name, username
    from users
    where profile_id = ?
    order by platform asc
  `).all(profileId);
}

function logOutboundMessage(profileId, platform, chatId, messageType, status, errorMessage = null) {
  getDb().prepare(`
    insert into outbound_message_log
      (profile_id, platform, chat_id, message_type, status, error_message, created_at)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(profileId || null, platform || null, chatId || null, messageType || null, status, errorMessage || null, nowIso());
}

function getChannelPublishState() {
  const database = getDb();
  const row = database.prepare('select * from channel_publish_state where id = 1').get();
  if (row) return row;
  const now = nowIso();
  database.prepare('insert into channel_publish_state (id, last_published_at, updated_at) values (1, null, ?)').run(now);
  return database.prepare('select * from channel_publish_state where id = 1').get();
}

function markChannelPublished(sentAt = nowIso()) {
  getDb().prepare(`
    insert into channel_publish_state (id, last_published_at, updated_at)
    values (1, ?, ?)
    on conflict(id) do update set
      last_published_at = excluded.last_published_at,
      updated_at = excluded.updated_at
  `).run(sentAt, sentAt);
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
  listDueNotificationSettings,
  getProfile,
  createAccountLinkCode,
  linkAccountWithCode,
  setProfilePhone,
  saveSourceAudit,
  getLatestSourceAudit,
  ensureSubscription,
  getSubscription,
  getSubscriptionForChat,
  subscriptionHasPaidAccess,
  planLimits,
  setSubscription,
  recordPayment,
  createPriceAlert,
  listPriceAlerts,
  setPriceAlertActive,
  listActivePriceAlerts,
  markPriceAlertTriggered,
  createScheduledReport,
  listScheduledReports,
  setScheduledReportActive,
  listActiveScheduledReports,
  markScheduledReportSent,
  listProfileRecipients,
  logOutboundMessage,
  getChannelPublishState,
  markChannelPublished
};
