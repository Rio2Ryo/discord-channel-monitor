// Message templates by status
const TEMPLATES = {
  stalled: [
    '💬 会話が止まっているようです。次のアクションは何ですか？',
    '⏰ 3分以上発言がありません。進捗はどうですか？',
    '🔄 止まっていますか？次のステップを確認しましょう！',
  ],
  waiting_confirmation: [
    '⏳ 確認待ちの状態です。対応をお願いします🙏',
    '📋 確認待ちです。返答をお待ちしています。',
  ],
};

function getTemplate(status) {
  const list = TEMPLATES[status];
  if (!list) return null;
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { getTemplate, TEMPLATES };
