// Message templates by status
// {mentions} placeholder will be replaced with actual user/role mentions
const TEMPLATES = {
  stalled: [
    '{mentions} 💬 会話が止まっています。次のアクションを決めてください。\n👉 続行 / 確認待ちにする / 今日は終了 — リアクションか一言で教えて！',
    '{mentions} ⏰ 3分以上発言がありません。状況を教えてください！\n👍 = 進行中 / ⏸️ = 一時停止 / ✅ = 完了',
    '{mentions} 🔄 止まっていませんか？次のステップを一言だけお願いします！',
  ],
  waiting_confirmation: [
    '{mentions} ⏳ 確認待ちです。対応をお願いします🙏\n📝 理由: {reason}',
    '{mentions} 📋 確認待ちのままです。返答を一言だけお願いします！',
  ],
};

function getTemplate(status, mentions, reason) {
  const list = TEMPLATES[status];
  if (!list) return null;
  let msg = list[Math.floor(Math.random() * list.length)];
  msg = msg.replace(/\{mentions\}/g, mentions || '');
  msg = msg.replace(/\{reason\}/g, reason || '（未記載）');
  return msg.trim();
}

module.exports = { getTemplate, TEMPLATES };
