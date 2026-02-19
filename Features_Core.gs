// Features_Core.gs

// F02: スケジュール投稿 & F09: イベント投稿
function processScheduledPost() {
  const config = getConfig();
  if (!config.ENABLE_SCHEDULE_POST) return;

  const now = new Date();
  const currentHour = now.getHours();
  
  const sheet = SS.getSheetByName(SHEET.SCHEDULE);
  const data = sheet.getDataRange().getValues();
  
  // 現在の時間帯にマッチする投稿候補を探す
  let candidates = [];
  // 1行目はヘッダ想定
  for (let i = 1; i < data.length; i++) {
    // 時間帯指定（例: "7" や "7,8" など。簡易的にカンマ区切り対応）
    const hours = data[i][0].toString().split(',').map(h => parseInt(h.trim()));
    if (hours.includes(currentHour)) {
      // B列以降が候補
      for (let j = 1; j < data[i].length; j++) {
        if (data[i][j]) candidates.push(data[i][j]);
      }
    }
  }

  if (candidates.length === 0) return;

  // F09 イベント投稿の割り込み判定
  if (config.ENABLE_EVENT_POST) {
    const todayStr = Utilities.formatDate(now, 'JST', 'MM/dd');
    const eventSheet = SS.getSheetByName(SHEET.EVENT);
    const events = eventSheet.getDataRange().getValues();
    let eventCandidates = [];
    
    for (let i = 1; i < events.length; i++) {
      if (events[i][0] === todayStr) { // 日付一致
         for (let j = 2; j < events[i].length; j++) {
            if (events[i][j]) eventCandidates.push(events[i][j]);
         }
      }
    }
    
    // イベントがあり、かつ確率(EVENT_MIX_RATE)に当選すればイベント用候補を使用
    if (eventCandidates.length > 0 && Math.random() * 100 < config.EVENT_MIX_RATE) {
      candidates = eventCandidates;
    }
  }

  // 重複回避ロジック（直近の投稿履歴と比較）
  const props = PropertiesService.getScriptProperties();
  const lastPost = props.getProperty('LAST_SCHEDULED_POST_CONTENT');
  
  let text = candidates[Math.floor(Math.random() * candidates.length)];
  
  // 候補が複数ある場合のみ重複再抽選
  if (candidates.length > 1 && text === lastPost) {
    text = candidates.filter(t => t !== lastPost)[Math.floor(Math.random() * (candidates.length - 1))];
  }

  postNote(text);
  props.setProperty('LAST_SCHEDULED_POST_CONTENT', text);
}

// F03: ランダム投稿
function processRandomPost() {
  const config = getConfig();
  if (!config.ENABLE_RANDOM_POST) return;
  
  const sheet = SS.getSheetByName(SHEET.RANDOM);
  const rows = sheet.getDataRange().getValues();
  // ヘッダ除く
  const candidates = rows.slice(1).map(r => r[0]).filter(Boolean);
  
  if (candidates.length === 0) return;
  
  const text = candidates[Math.floor(Math.random() * candidates.length)];
  postNote(text);
}

// F04: TLワード + Gemini投稿
function processGeminiPost() {
  const config = getConfig();
  if (!config.ENABLE_GEMINI_POST) return;

  try {
    // 1. TL取得
    const timeline = getTimeline(config.TIMELINE_TYPE || 'local', 10);
    const texts = timeline
      .filter(n => !n.user.isBot && n.text) // Bot除外
      .map(n => n.text)
      .join("\n");

    if (!texts) return;

    // 2. キーワード抽出
    const extractPrompt = `以下のテキスト群から、現在話題になっている特徴的な名詞やテーマを3つ抽出してください。単語のみをカンマ区切りで返してください。\n\n${texts}`;
    const keywords = callGemini(extractPrompt);

    // 3. 文章生成
    const systemPrompt = getSystemPrompt();
    const genPrompt = `${systemPrompt}\n\n以下のキーワードを使って、Misskeyに投稿する140文字程度の雑談を作ってください。キーワード: ${keywords}`;
    const postText = callGemini(genPrompt);

    // 4. 投稿
    postNote(postText);
    
  } catch (e) {
    logError('processGeminiPost', e);
  }
}

// F05: 投票投稿 (Gemini未使用)
function processPollPost() {
  const config = getConfig();
  if (!config.ENABLE_POLL_POST) return;

  // TL取得と簡易ワード抽出
  const timeline = getTimeline(config.TIMELINE_TYPE || 'local', 20);
  const textBlob = timeline.map(n => n.text).join(" ");
  
  // 簡易的な抽出ロジック: 3文字以上のカタカナまたは漢字の連続を抽出
  const matches = textBlob.match(/[ァ-ヶー]{3,}|[一-龠]{2,}/g) || [];
  
  // ユニーク化してランダムに4つ選ぶ
  const uniqueWords = [...new Set(matches)];
  if (uniqueWords.length < 4) return; // 候補不足

  const choices = [];
  while(choices.length < 4) {
    const idx = Math.floor(Math.random() * uniqueWords.length);
    choices.push(uniqueWords[idx]);
    uniqueWords.splice(idx, 1);
  }

  // 質問文の選択
  const sheet = SS.getSheetByName(SHEET.POLL);
  const questions = sheet.getDataRange().getValues().slice(1).map(r => r[0]).filter(Boolean);
  const question = questions[Math.floor(Math.random() * questions.length)];

  const poll = {
    choices: choices,
    multiple: true,
    expiresAt: Date.now() + (config.POLL_DURATION_MS || 10800000)
  };

  postNote(question, { poll: poll });
}

// F07: リアクション
function processReaction() {
  const config = getConfig();
  if (!config.ENABLE_REACTION) return;

  const limitMin = config.REACTION_RECENCY_MIN || 30;
  const thresholdTime = Date.now() - (limitMin * 60 * 1000);

  // 【修正】リアクション対象を「ホームタイムライン(フォロー中)」に限定
  // 'local' にすると全ユーザーが対象になってしまうため 'home' を指定
  const timeline = getTimeline('home', 20);
  
  // 条件フィルタリング
  const candidates = timeline.filter(n => {
    const noteTime = new Date(n.createdAt).getTime();
    return noteTime > thresholdTime &&      // 直近の投稿か
           !n.user.isBot &&                 // Botではないか
           n.userId !== config.OWN_USER_ID && // 自分ではないか
           n.visibility !== 'specified';    // ダイレクト投稿ではないか
  });

  if (candidates.length === 0) return;

  // ランダムに1つ選ぶ
  const target = candidates[Math.floor(Math.random() * candidates.length)];
  
  // 絵文字選択
  const sheet = SS.getSheetByName(SHEET.REACTION);
  const rows = sheet.getDataRange().getValues();
  // ヘッダーを除き、空行を除外して絵文字リストを作成
  const emojis = rows.slice(1).map(r => r[0]).filter(e => e && e !== '');
  
  if (emojis.length === 0) return;

  const reaction = emojis[Math.floor(Math.random() * emojis.length)];

  try {
    callMisskeyApi('notes/reactions/create', { noteId: target.id, reaction: reaction });
    incrementCounter('REACTION');
  } catch (e) {
    // 既にリアクション済みなどのエラーは無視、またはログ出力
    console.warn(`Reaction failed: ${e.message}`);
  }
}
