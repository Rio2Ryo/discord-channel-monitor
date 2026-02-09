const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'monitor.db'));
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS watched_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    threshold_sec INTEGER NOT NULL DEFAULT 180,
    cooldown_sec INTEGER NOT NULL DEFAULT 600,
    mention_ids TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS channel_state (
    channel_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    last_message_at TEXT,
    last_bot_message_at TEXT,
    cooldown_until TEXT,
    waiting_reason TEXT,
    status_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (channel_id) REFERENCES watched_channels(channel_id)
  );
`);

// Migration: add mention_ids column if missing
try {
  db.exec(`ALTER TABLE watched_channels ADD COLUMN mention_ids TEXT NOT NULL DEFAULT ''`);
} catch (e) {
  // Column already exists
}

// Prepared statements
const stmts = {
  addChannel: db.prepare(`
    INSERT OR REPLACE INTO watched_channels (channel_id, guild_id, threshold_sec, mention_ids)
    VALUES (?, ?, ?, ?)
  `),
  removeChannel: db.prepare(`
    DELETE FROM watched_channels WHERE channel_id = ?
  `),
  getChannel: db.prepare(`
    SELECT * FROM watched_channels WHERE channel_id = ?
  `),
  listChannels: db.prepare(`
    SELECT w.*, s.status, s.last_message_at, s.last_bot_message_at, s.cooldown_until, s.waiting_reason
    FROM watched_channels w
    LEFT JOIN channel_state s ON w.channel_id = s.channel_id
    WHERE w.enabled = 1
  `),
  upsertState: db.prepare(`
    INSERT INTO channel_state (channel_id, status, last_message_at, status_updated_at)
    VALUES (?, 'active', datetime('now'), datetime('now'))
    ON CONFLICT(channel_id) DO UPDATE SET
      last_message_at = datetime('now'),
      status = CASE WHEN status = 'waiting_confirmation' THEN status ELSE 'active' END,
      status_updated_at = datetime('now')
  `),
  updateLastMessage: db.prepare(`
    UPDATE channel_state SET last_message_at = datetime('now'), status = 'active', status_updated_at = datetime('now')
    WHERE channel_id = ?
  `),
  setStatus: db.prepare(`
    UPDATE channel_state SET status = ?, waiting_reason = ?, status_updated_at = datetime('now')
    WHERE channel_id = ?
  `),
  setBotMessage: db.prepare(`
    UPDATE channel_state SET last_bot_message_at = datetime('now'), cooldown_until = datetime('now', '+' || ? || ' seconds')
    WHERE channel_id = ?
  `),
  getState: db.prepare(`
    SELECT * FROM channel_state WHERE channel_id = ?
  `),
  getStalledChannels: db.prepare(`
    SELECT w.*, s.*
    FROM watched_channels w
    JOIN channel_state s ON w.channel_id = s.channel_id
    WHERE w.enabled = 1
      AND s.status != 'active'
      OR (w.enabled = 1 AND s.last_message_at < datetime('now', '-' || w.threshold_sec || ' seconds'))
  `),
};

module.exports = { db, stmts };
