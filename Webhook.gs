// Webhook.gs

function doPost(e) {
  // Webhookは並列起動する可能性があるためロックを取得
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return ContentService.createTextOutput('Busy');
  }

  try {
    const data = JSON.parse(e.postData.contents);
    const type = data.type;
    const body = data.body;

    // 基本的なバリデーション (bot自身のイベントは無視など)
    // ※Misskeyは自分がアクションしてもhookが飛ぶ場合があるため注意
    if (body.userId === getConfig().OWN_USER_ID) return; // ※OWN_USER_IDの設定が必要

    switch (type) {
      case 'followed':
        handleFollowed(body);
        break;
      case 'mention':
        handleMention(body);
        break;
    }

    return ContentService.createTextOutput('OK');

  } catch (err) {
    logError('doPost', err);
    return ContentService.createTextOutput('Error');
  } finally {
    lock.releaseLock();
  }
}

// F01: フォローバック
function handleFollowed(body) {
  if (!getConfig().ENABLE_FOLLOWBACK) return;
  callMisskeyApi('following/create', { userId: body.userId });
  incrementCounter('FOLLOWBACK');
}

// F06: メンション返信 & F08: 好感度
function handleMention(body) {
  const config = getConfig();
  if (!config.ENABLE_MENTION_REPLY) return;

  const noteId = body.note.id;
  const userId = body.note.userId;
  const text = body.note.text;

  // 1. 相互フォロー確認
  const relation = callMisskeyApi('users/relation', { userId: userId });
  // リストで返ってくる可能性があるので注意
  const rel = Array.isArray(relation) ? relation[0] : relation;
  
  if (!rel.isFollowing || !rel.isFollowed) return;

  // 2. ユーザー管理シート確認 (回数制限 & 好感度)
  const userSheet = SS.getSheetByName(SHEET.USER);
  const users = userSheet.getDataRange().getValues();
  let userRowIndex = -1;
  let interactionCount = 0;
  let lastReplyDate = '';

  for (let i = 1; i < users.length; i++) {
    if (users[i][0] === userId) {
      userRowIndex = i + 1; // 1-based index
      lastReplyDate = users[i][1]; // 日付
      interactionCount = users[i][2]; // 回数
      break;
    }
  }

  // 当日の返信制限チェック
  const today = getTodayStr();
  const todayReplyCountKey = `REPLY_COUNT_${userId}_${today}`;
  const props = PropertiesService.getScriptProperties();
  const currentTodayReplies = parseInt(props.getProperty(todayReplyCountKey) || '0');

  if (currentTodayReplies >= config.MENTION_DAILY_LIMIT) return;

  // 3. プロンプト構築（好感度反映）
  let affinityPrompt = "";
  if (interactionCount >= config.AFFINITY_RANK3) {
    affinityPrompt = "相手とは親しく、信頼している。いつもより少しだけ素直に話す。";
  } else if (interactionCount >= config.AFFINITY_RANK2) {
    affinityPrompt = "相手とは何度か話したことがあり、少しだけ心を開いている。";
  }

  const systemPrompt = getSystemPrompt();
  const fullPrompt = `${systemPrompt}\n${affinityPrompt}\n\nユーザーの発言: ${text}\n返信:`;

  // 4. Gemini生成 (エラー時はフォールバック)
  let replyText = "";
  try {
    replyText = callGemini(fullPrompt);
  } catch (e) {
    // フォールバック定型文からランダム
    const fbSheet = SS.getSheetByName(SHEET.FALLBACK);
    const fbs = fbSheet.getDataRange().getValues().slice(1).map(r => r[0]).filter(Boolean);
    replyText = fbs[Math.floor(Math.random() * fbs.length)];
  }

  // 5. 返信実行
  replyNote(noteId, replyText);

  // 6. データ更新
  props.setProperty(todayReplyCountKey, (currentTodayReplies + 1).toString());
  
  if (userRowIndex > 0) {
    userSheet.getRange(userRowIndex, 2).setValue(new Date()); // 最終返信日時
    userSheet.getRange(userRowIndex, 3).setValue(interactionCount + 1);
  } else {
    userSheet.appendRow([userId, new Date(), 1]);
  }
}