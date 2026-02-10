// Natural language processing for monitor responses

// Extract time from message (e.g., "10:00", "10時", "14:30")
function extractTime(text) {
  // Match patterns like 10:00, 10：00, 10時, 10時30分, 14:30
  const patterns = [
    /(\d{1,2})[：:](\d{2})/,          // 10:00, 14:30
    /(\d{1,2})時(\d{1,2})分/,          // 10時30分
    /(\d{1,2})時/,                     // 10時
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = match[2] ? parseInt(match[2], 10) : 0;
      if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
        return { hours, minutes };
      }
    }
  }
  return null;
}

// Calculate target timestamp from extracted time
function getTargetTimestamp(time) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(time.hours, time.minutes, 0, 0);

  // If the time is in the past, assume tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return target;
}

// Detect status intent from message
function detectStatusIntent(text) {
  const lower = text.toLowerCase();

  // Waiting/confirmation patterns
  if (/確認待ち|確認まち|待ち|待つ|waiting|投稿待ち/.test(lower)) {
    return 'waiting_confirmation';
  }

  // Active/continue patterns
  if (/続行|続ける|進める|やる|active|進行/.test(lower)) {
    return 'active';
  }

  // Stop/end patterns
  if (/終了|終わり|クローズ|close|stop|やめ/.test(lower)) {
    return 'active'; // Reset to active (effectively stops nudging with cooldown)
  }

  return null;
}

// Format datetime for SQLite (UTC, matching datetime('now'))
function formatDatetime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

module.exports = { extractTime, getTargetTimestamp, detectStatusIntent, formatDatetime };
