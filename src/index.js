require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, Events, Partials } = require('discord.js');
const { commands } = require('./commands');
const { stmts, db } = require('./db');
const { startMonitor, REACTION_MAP } = require('./monitor');
const { extractTime, getTargetTimestamp, detectStatusIntent, formatDatetime } = require('./nlp');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) { console.error('DISCORD_TOKEN is required'); process.exit(1); }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  // Threads are auto-joined by default in discord.js v14
  partials: [Partials.Message, Partials.Reaction],
});

// Register slash commands
async function registerCommands() {
  const rest = new REST().setToken(TOKEN);
  const body = commands.map(c => c.toJSON());

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body });
    console.log(`[Bot] Registered ${body.length} guild commands`);
  } else {
    await rest.put(Routes.applicationCommands(client.user.id), { body });
    console.log(`[Bot] Registered ${body.length} global commands`);
  }
}

// Handle messages - update last_message_at
client.on(Events.MessageCreate, (message) => {
  // Ignore own messages (Monitor bot) to avoid self-reset
  if (message.author.id === client.user.id) return;

  const ch = stmts.getChannel.get(message.channelId);
  if (!ch) return;

  // Ensure state row exists
  const state = stmts.getState.get(message.channelId);
  if (state) {
    stmts.updateLastMessage.run(message.channelId);
  } else {
    stmts.upsertState.run(message.channelId);
  }

  console.log(`[Event] Message in #${message.channel.name} - set active`);

  // Phase 2: Natural language response to nudge messages
  // Check if this message is a reply to a Monitor nudge
  if (message.reference && message.reference.messageId) {
    try {
      const refMsg = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
      if (refMsg && refMsg.author.id === client.user.id) {
        // This is a reply to our nudge message!
        const content = message.content;
        const channelId = message.channelId;
        const ch = stmts.getChannel.get(channelId);
        if (!ch) return;

        // Extract time (e.g., "10:00投稿待ち" → cooldown until 10:00 + 5min)
        const time = extractTime(content);
        if (time) {
          const target = getTargetTimestamp(time);
          // Add 5 minutes after the specified time for the check
          target.setMinutes(target.getMinutes() + 5);
          const cooldownDatetime = formatDatetime(target);

          // Set to waiting_confirmation with extended cooldown
          stmts.setStatus.run('waiting_confirmation', content, channelId);

          // Update cooldown_until to specified time + 5min
          db.prepare('UPDATE channel_state SET cooldown_until = ? WHERE channel_id = ?')
            .run(cooldownDatetime, channelId);

          const timeStr = `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`;
          await message.reply(`⏰ ${timeStr} まで待機します。${timeStr}の5分後に確認しますね！`);
          console.log(`[NLP] Time detected: ${timeStr} → cooldown until ${cooldownDatetime} (${timeStr}+5min) in ${channelId}`);
          return;
        }

        // Detect status intent
        const intent = detectStatusIntent(content);
        if (intent) {
          const reason = intent === 'waiting_confirmation' ? content : null;
          stmts.setStatus.run(intent, reason, channelId);

          // When setting to active, add cooldown so we don't immediately ask again
          const cooldownSec = ch.cooldown_sec || 600;
          stmts.setBotMessage.run(cooldownSec, channelId);

          const statusLabel = { active: '進行中 🟢', waiting_confirmation: '確認待ち 🟡' };
          await message.reply(`✅ ${statusLabel[intent]} に変更しました`);
          console.log(`[NLP] Status intent: ${intent} (+ ${cooldownSec}s cooldown) in ${channelId}`);
          return;
        }
      }
    } catch (err) {
      console.error('[NLP] Error processing reply:', err.message);
    }
  }
});

// Handle reactions on bot nudge messages → auto status update
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  try {
    // Fetch partial if needed
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();

    // Only react to reactions on THIS bot's messages
    if (reaction.message.author.id !== client.user.id) return;
    // Ignore bot reactions
    if (user.bot) return;

    const emoji = reaction.emoji.name;
    const newStatus = REACTION_MAP[emoji];
    if (!newStatus) return;

    const channelId = reaction.message.channelId;
    const ch = stmts.getChannel.get(channelId);
    if (!ch) return;

    stmts.setStatus.run(newStatus, null, channelId);

    // Always set cooldown when status is changed via reaction (prevent immediate re-nudge)
    const cooldownSec = ch.cooldown_sec || 600;
    stmts.setBotMessage.run(cooldownSec, channelId);

    const statusLabel = { active: '進行中 🟢', stalled: '停止中 🔴', waiting_confirmation: '確認待ち 🟡' };
    await reaction.message.reply(`✅ ${statusLabel[newStatus]} に変更しました（${user.displayName} が ${emoji} で更新）`);
    console.log(`[Reaction] ${emoji} by ${user.tag} → ${newStatus} (+ ${cooldownSec}s cooldown) in ${channelId}`);
  } catch (err) {
    console.error('[Reaction] Error handling reaction:', err.message);
  }
});

// Auto-watch new threads under watched parent channels
client.on(Events.ThreadCreate, async (thread) => {
  try {
    if (thread.joinable) await thread.join();

    const parentCh = stmts.getChannel.get(thread.parentId);
    if (!parentCh || !parentCh.enabled) return;

    // Auto-register with parent's settings
    stmts.addChannel.run(thread.id, thread.guildId, parentCh.threshold_sec, parentCh.mention_ids || '');
    stmts.upsertState.run(thread.id);

    console.log(`[Thread] Auto-watching new thread #${thread.name} (parent: ${thread.parentId})`);
  } catch (err) {
    console.error('[Thread] Error auto-watching:', err.message);
  }
});

// Handle slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'watch') {
    const channel = interaction.options.getChannel('channel');
    const threshold = interaction.options.getInteger('threshold') || 180;
    const guildId = interaction.guildId;

    const mentions = interaction.options.getString('mentions') || '';

    stmts.addChannel.run(channel.id, guildId, threshold, mentions);

    // Initialize state
    const existing = stmts.getState.get(channel.id);
    if (!existing) {
      stmts.upsertState.run(channel.id);
    }

    const mentionInfo = mentions ? `\n📢 メンション対象: ${mentions.split(',').map(id => `<@${id.trim()}>`).join(' ')}` : '\n⚠️ メンション対象が未設定です。`mentions` オプションでユーザー/ロールIDを指定してください。';
    await interaction.reply(`✅ <#${channel.id}> を監視対象に追加しました（閾値: ${threshold}秒）${mentionInfo}`);
    console.log(`[Cmd] /watch #${channel.name} (${threshold}s, mentions: ${mentions})`);
  }

  else if (commandName === 'unwatch') {
    const channel = interaction.options.getChannel('channel');
    stmts.removeState.run(channel.id);
    stmts.removeChannel.run(channel.id);
    await interaction.reply(`🗑️ <#${channel.id}> の監視を解除しました`);
    console.log(`[Cmd] /unwatch #${channel.name}`);
  }

  else if (commandName === 'watchhere') {
    const channelId = interaction.channelId;
    const threshold = interaction.options.getInteger('threshold') || 180;
    const mentions = interaction.options.getString('mentions') || '';
    const guildId = interaction.guildId;

    stmts.addChannel.run(channelId, guildId, threshold, mentions);

    const existing = stmts.getState.get(channelId);
    if (!existing) {
      stmts.upsertState.run(channelId);
    }

    const mentionInfo = mentions ? `\n📢 メンション対象: ${mentions.split(',').map(id => `<@${id.trim()}>`).join(' ')}` : '';
    await interaction.reply(`✅ このチャンネル/スレッドを監視対象に追加しました（閾値: ${threshold}秒）${mentionInfo}`);
    console.log(`[Cmd] /watchhere ${channelId} (${threshold}s, mentions: ${mentions})`);
  }

  else if (commandName === 'unwatchhere') {
    const channelId = interaction.channelId;
    stmts.removeState.run(channelId);
    stmts.removeChannel.run(channelId);
    await interaction.reply(`🗑️ このチャンネル/スレッドの監視を解除しました`);
    console.log(`[Cmd] /unwatchhere ${channelId}`);
  }

  else if (commandName === 'watchlist') {
    const channels = stmts.listChannels.all();
    if (channels.length === 0) {
      await interaction.reply('📋 監視中のチャンネルはありません');
      return;
    }

    const statusEmoji = { active: '🟢', stalled: '🔴', waiting_confirmation: '🟡' };
    const statusLabel = { active: '進行中', stalled: '停止中', waiting_confirmation: '確認待ち' };

    const lines = channels.map(ch => {
      const emoji = statusEmoji[ch.status] || '⚪';
      const label = statusLabel[ch.status] || ch.status || '不明';
      const lastMsg = ch.last_message_at ? `最終: ${ch.last_message_at}` : '発言なし';
      return `${emoji} <#${ch.channel_id}> — ${label} (${lastMsg}, 閾値: ${ch.threshold_sec}s)`;
    });

    await interaction.reply(`📋 **監視チャンネル一覧**\n${lines.join('\n')}`);
  }

  else if (commandName === 'setstatus') {
    const status = interaction.options.getString('status');
    const reason = interaction.options.getString('reason') || null;
    const channelId = interaction.channelId;

    const ch = stmts.getChannel.get(channelId);
    if (!ch) {
      await interaction.reply('⚠️ このチャンネルは監視対象ではありません。先に `/watch` してください。');
      return;
    }

    stmts.setStatus.run(status, reason, channelId);

    // Set cooldown to prevent immediate re-nudge after status change
    const cooldownSec = ch.cooldown_sec || 600;
    stmts.setBotMessage.run(cooldownSec, channelId);

    const statusLabel = { active: '進行中 🟢', stalled: '停止中 🔴', waiting_confirmation: '確認待ち 🟡' };
    let reply = `✅ ステータスを **${statusLabel[status]}** に変更しました`;
    if (reason) reply += `\n📝 理由: ${reason}`;

    await interaction.reply(reply);
    console.log(`[Cmd] /setstatus ${status} (+ ${cooldownSec}s cooldown) in #${interaction.channel.name}`);
  }
});

// Ready
client.once(Events.ClientReady, async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error('[Bot] Failed to register commands:', err.message);
  }
  // Auto-watch active threads under watched channels on startup
  try {
    const watchedChannels = stmts.listChannels.all();
    for (const wc of watchedChannels) {
      try {
        const ch = await client.channels.fetch(wc.channel_id).catch(() => null);
        if (!ch) continue;

        // If it's a thread, just join it
        if (ch.isThread && ch.isThread() && ch.joinable) {
          await ch.join();
          continue;
        }

        // If it's a text channel with threads, scan and auto-register
        if (ch.threads) {
          const activeThreads = await ch.threads.fetchActive().catch(() => null);
          if (!activeThreads) continue;
          for (const [threadId, thread] of activeThreads.threads) {
            if (!stmts.getChannel.get(threadId)) {
              stmts.addChannel.run(threadId, wc.guild_id, wc.threshold_sec, wc.mention_ids || '');
              stmts.upsertState.run(threadId);
              if (thread.joinable) await thread.join();
              console.log(`[Startup] Auto-watching thread #${thread.name}`);
            }
          }
        }
      } catch (e) {
        // Skip channels we can't access
      }
    }
  } catch (err) {
    console.error('[Bot] Error scanning threads:', err.message);
  }

  try {
    await startMonitor(client);
  } catch (err) {
    console.error('[Bot] Failed to start monitor:', err);
    process.exit(1);
  }
});

client.login(TOKEN);
