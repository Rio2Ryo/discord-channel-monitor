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

    // State machine logic
    if (ch.status === 'active' && elapsed > thresholdSec) {
      // Transition: active → stalled
      stmts.setStatus.run('stalled', null, ch.channel_id);
      await nudgeChannel(client, ch.channel_id, 'stalled', ch.cooldown_sec || 600);
    } else if (ch.status === 'stalled' && elapsed > thresholdSec) {
      // Still stalled, nudge again if cooldown expired
      await nudgeChannel(client, ch.channel_id, 'stalled', ch.cooldown_sec || 600);
    } else if (ch.status === 'waiting_confirmation') {
      // Waiting: remind if cooldown expired
      await nudgeChannel(client, ch.channel_id, 'waiting_confirmation', ch.cooldown_sec || 600);
    }
  }
}

async function nudgeChannel(client, channelId, status, cooldownSec) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;

    const state = stmts.getState.get(channelId);
    const waitingReason = state?.waiting_reason;

    let message = getTemplate(status);
    if (status === 'waiting_confirmation' && waitingReason) {
      message += `\n📝 理由: ${waitingReason}`;
    }

    if (message) {
      await channel.send(message);
      stmts.setBotMessage.run(cooldownSec, channelId);
      console.log(`[Monitor] Nudged #${channel.name} (${status})`);
    }
  } catch (err) {
    console.error(`[Monitor] Failed to nudge ${channelId}:`, err.message);
  }
}

module.exports = { startMonitor };
