// Message templates by status
const TEMPLATES = {
  stalled: [
    '💬 会話が止まっているようです。アオ🌊、アカ❤️、シロ🤍、次のアクションは何ですか？',
    '⏰ 3分以上発言がありません。アオ🌊、状況はどうですか？',
    '🔄 会話が停滞しています。TRIOの皆さん、次のステップを確認しましょう！',
  ],
  waiting_confirmation: [
    '⏳ 確認待ちの状態です。Yakonさんへの確認が必要ですか？対応をお願いします🙏',
    '📋 確認待ちです。関係者の皆さん、返答をお待ちしています。',
  ],
};

function getTemplate(status) {
  const list = TEMPLATES[status];
  if (!list) return null;
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { getTemplate, TEMPLATES };
