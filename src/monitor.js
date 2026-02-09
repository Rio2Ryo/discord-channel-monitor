const { stmts } = require('./db');
const { getTemplate } = require('./templates');

const POLL_INTERVAL_MS = 30_000; // 30 seconds

async function startMonitor(client) {
  console.log('[Monitor] Starting channel monitor (interval: 30s)');

  setInterval(async () => {
    try {
      await checkChannels(client);
    } catch (err) {
      console.error('[Monitor] Error during check:', err);
    }
  }, POLL_INTERVAL_MS);
}

async function checkChannels(client) {
  const channels = stmts.listChannels.all();
  const now = Date.now();

  for (const ch of channels) {
    if (!ch.last_message_at) continue;

    const lastMsg = new Date(ch.last_message_at + 'Z').getTime();
    const elapsed = (now - lastMsg) / 1000;
    const thresholdSec = ch.threshold_sec || 180;

    // Check cooldown
    if (ch.cooldown_until) {
      const cooldownEnd = new Date(ch.cooldown_until + 'Z').getTime();
      if (now < cooldownEnd) continue;
    }

    // Build mentions string from stored IDs
    const mentionIds = (ch.mention_ids || '').split(',').filter(Boolean);
    const mentions = mentionIds.map(id => `<@${id.trim()}>`).join(' ');

    // State machine logic
    if (ch.status === 'active' && elapsed > thresholdSec) {
      // Transition: active → stalled
      stmts.setStatus.run('stalled', null, ch.channel_id);
      await nudgeChannel(client, ch.channel_id, 'stalled', ch.cooldown_sec || 600, mentions, null);
    } else if (ch.status === 'stalled' && elapsed > thresholdSec) {
      // Still stalled, nudge again if cooldown expired
      await nudgeChannel(client, ch.channel_id, 'stalled', ch.cooldown_sec || 600, mentions, null);
    } else if (ch.status === 'waiting_confirmation') {
      // Waiting: remind if cooldown expired
      const state = stmts.getState.get(ch.channel_id);
      await nudgeChannel(client, ch.channel_id, 'waiting_confirmation', ch.cooldown_sec || 600, mentions, state?.waiting_reason);
    }
  }
}

async function nudgeChannel(client, channelId, status, cooldownSec, mentions, reason) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = getTemplate(status, mentions, reason);

    if (message) {
      await channel.send(message);
      stmts.setBotMessage.run(cooldownSec, channelId);
      console.log(`[Monitor] Nudged #${channel.name} (${status}) with mentions: ${mentions || 'none'}`);
    }
  } catch (err) {
    console.error(`[Monitor] Failed to nudge ${channelId}:`, err.message);
  }
}

module.exports = { startMonitor };
