// Webhook.gs

function doPost(e) {
  // Webhookは並列起動する可能性があるためロックを取得
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return ContentService.createTextOutput('Busy');
  }

  try {
    // 【追加】Bot全体停止スイッチの確認
    const config = getConfig();
    if (String(config.BOT_ACTIVE).toUpperCase() === 'FALSE') {
      // 停止中もMisskey側にエラー判定されないよう「OK」だけは返す
      return ContentService.createTextOutput('OK');
    }

    const data = JSON.parse(e.postData.contents);
    const type = data.type;
    const body = data.body;

    // 基本的なバリデーション (bot自身のイベントは無視など)
    if (body.userId === config.OWN_USER_ID) {
      return ContentService.createTextOutput('OK');
    }

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
  callMisskeyApi('following/create', { userId: body.user.id }); // ←ここを修正
  incrementCounter('FOLLOWBACK');
}

// F06: メンション返信 & F08: 好感度
function handleMention(body) {
  const config = getConfig();
  if (!config.ENABLE_MENTION_REPLY) return;

  const noteId = body.note.id;
  console.log(`[handleMention] Start processing noteId: ${noteId}`);

  // 0a. 重複処理の防止 第1防衛: PropertiesService
  const scriptProps = PropertiesService.getScriptProperties();
  const propKey = `PROCESSED_MENTION_${noteId}`;
  
  if (scriptProps.getProperty(propKey)) {
    console.log(`[handleMention] PropertiesService hit: ${noteId}. Skip.`);
    return; 
  }
  scriptProps.setProperty(propKey, 'true');
  console.log(`[handleMention] PropertiesService set: ${noteId}`);

  const userId = body.note.userId;
  const text = body.note.text;

  // 1. 相互フォロー確認
  const relation = callMisskeyApi('users/relation', { userId: userId });
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
  const currentTodayReplies = parseInt(scriptProps.getProperty(todayReplyCountKey) || '0');

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
    const fbSheet = SS.getSheetByName(SHEET.FALLBACK);
    const rows = fbSheet.getDataRange().getValues();
    const fbs = rows.slice(1).map(r => r[0]).filter(Boolean);
    if (fbs.length > 0) {
      replyText = fbs[Math.floor(Math.random() * fbs.length)];
    } else {
      replyText = "ごめんね、エラーが起きちゃったみたい...💦";
    }
  }

  // 0b. 重複処理の防止 第2防衛: Misskey APIで既にBotが返信済みか確認（フェイルセーフ）
  try {
    const replies = callMisskeyApi('notes/replies', { noteId: noteId, limit: 100 });
    const alreadyReplied = replies.some(r => r.userId === config.OWN_USER_ID);
    if (alreadyReplied) {
      console.log(`[handleMention] Misskey API check: already replied to ${noteId}. Skip.`);
      return;
    }
  } catch (checkErr) {
    console.warn(`[handleMention] Reply check failed (proceeding): ${checkErr.message}`);
  }

  // 5. 返信実行
  console.log(`[handleMention] Replying to ${noteId}`);
  replyNote(noteId, replyText);

  // 6. データ更新
  scriptProps.setProperty(todayReplyCountKey, (currentTodayReplies + 1).toString());
  
  if (userRowIndex > 0) {
    userSheet.getRange(userRowIndex, 2).setValue(new Date()); 
    userSheet.getRange(userRowIndex, 3).setValue(interactionCount + 1);
  } else {
    userSheet.appendRow([userId, new Date(), 1]);
  }
}