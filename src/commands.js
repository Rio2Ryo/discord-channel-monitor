const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('watch')
    .setDescription('チャンネルを監視対象に追加')
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('監視するチャンネル').setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('threshold').setDescription('停止判定の秒数（デフォルト: 180）').setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('mentions').setDescription('声かけ時にメンションするユーザー/ロールID（カンマ区切り）').setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('unwatch')
    .setDescription('チャンネルの監視を解除')
    .addChannelOption(opt =>
      opt.setName('channel').setDescription('解除するチャンネル').setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('監視中チャンネル一覧を表示'),

  new SlashCommandBuilder()
    .setName('setstatus')
    .setDescription('チャンネルのステータスを変更')
    .addStringOption(opt =>
      opt.setName('status')
        .setDescription('ステータス')
        .setRequired(true)
        .addChoices(
          { name: '進行中 (active)', value: 'active' },
          { name: '停止中 (stalled)', value: 'stalled' },
          { name: '確認待ち (waiting)', value: 'waiting_confirmation' },
        )
    )
    .addStringOption(opt =>
      opt.setName('reason').setDescription('理由（確認待ちの場合）').setRequired(false)
    ),
];

module.exports = { commands };
