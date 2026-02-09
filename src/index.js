require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, Events } = require('discord.js');
const { commands } = require('./commands');
const { stmts, db } = require('./db');
const { startMonitor } = require('./monitor');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) { console.error('DISCORD_TOKEN is required'); process.exit(1); }

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
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
  if (message.author.bot) return;

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
});

// Handle slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === 'watch') {
    const channel = interaction.options.getChannel('channel');
    const threshold = interaction.options.getInteger('threshold') || 180;
    const guildId = interaction.guildId;

    stmts.addChannel.run(channel.id, guildId, threshold);

    // Initialize state
    const existing = stmts.getState.get(channel.id);
    if (!existing) {
      stmts.upsertState.run(channel.id);
    }

    await interaction.reply(`✅ <#${channel.id}> を監視対象に追加しました（閾値: ${threshold}秒）`);
    console.log(`[Cmd] /watch #${channel.name} (${threshold}s)`);
  }

  else if (commandName === 'unwatch') {
    const channel = interaction.options.getChannel('channel');
    stmts.removeChannel.run(channel.id);
    await interaction.reply(`🗑️ <#${channel.id}> の監視を解除しました`);
    console.log(`[Cmd] /unwatch #${channel.name}`);
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

    const statusLabel = { active: '進行中 🟢', stalled: '停止中 🔴', waiting_confirmation: '確認待ち 🟡' };
    let reply = `✅ ステータスを **${statusLabel[status]}** に変更しました`;
    if (reason) reply += `\n📝 理由: ${reason}`;

    await interaction.reply(reply);
    console.log(`[Cmd] /setstatus ${status} in #${interaction.channel.name}`);
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
  try {
    await startMonitor(client);
  } catch (err) {
    console.error('[Bot] Failed to start monitor:', err);
    process.exit(1);
  }
});

client.login(TOKEN);
