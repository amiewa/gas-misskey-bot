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
    // 空行はスキップ（時間帯と投稿内容が必須）
    if (!data[i][0] || !data[i][2]) continue;

    // 時間帯指定（例: "7" や "7,8" など。簡易的にカンマ区切り対応）
    const hours = data[i][0].toString().split(',').map(h => parseInt(h.trim()));
    if (hours.includes(currentHour)) {
      // C列(インデックス2)が投稿内容
      candidates.push(data[i][2]);
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
      if (events[i][0] === todayStr && events[i][2]) { // 日付一致かつ投稿内容あり
        eventCandidates.push(events[i][2]);
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

// F07: リアクション (キーワード反応型)
function processReaction() {
  const config = getConfig();
  if (!config.ENABLE_REACTION) return;

  const limitMin = config.REACTION_RECENCY_MIN || 30;
  const thresholdTime = Date.now() - (limitMin * 60 * 1000);

  // 1. 設定シートから「キーワードと絵文字のルール」を読み込む
  const sheet = SS.getSheetByName(SHEET.REACTION);
  const rows = sheet.getDataRange().getValues();
  // 1行目はヘッダーなので削除し、ルールリストを作成
  // 構造: [{ keyword: 'おはよう', reactions: ['🌅', ':ohayou:'] }, ...]
  const reactionRules = rows.slice(1).map(row => {
    const keyword = row[0];
    // B列以降(row[1]~)にある空欄以外のセルを絵文字リストとする
    const emojis = row.slice(1).filter(e => e && e !== '');
    return { keyword: keyword, reactions: emojis };
  }).filter(rule => rule.keyword && rule.reactions.length > 0);

  if (reactionRules.length === 0) return;

  // 2. ホームタイムラインを取得
  const timeline = getTimeline('home', 20);
  
  // 3. リアクション可能な投稿の候補を探す
  const candidates = [];

  for (const note of timeline) {
    const noteTime = new Date(note.createdAt).getTime();
    
    // 基本フィルタ（時間内、Botじゃない、自分じゃない、公開範囲など）
    if (noteTime <= thresholdTime) continue;
    if (note.user.isBot) continue;
    if (note.userId === config.OWN_USER_ID) continue;
    if (note.visibility === 'specified') continue;
    if (!note.text) continue; // テキストがない投稿（画像のみ等）はスキップ

    // キーワードマッチング
    for (const rule of reactionRules) {
      if (note.text.includes(rule.keyword)) {
        // マッチしたら候補に追加して、この投稿へのチェックは終了（多重反応防止）
        candidates.push({
          note: note,
          reactions: rule.reactions
        });
        break; 
      }
    }
  }

  // 候補がなければ終了
  if (candidates.length === 0) return;

  // 4. 候補の中からランダムに1つの投稿を選ぶ
  const targetCandidate = candidates[Math.floor(Math.random() * candidates.length)];
  const targetNote = targetCandidate.note;
  
  // 5. その投稿に対応する絵文字リストからランダムに1つ選ぶ
  const reaction = targetCandidate.reactions[Math.floor(Math.random() * targetCandidate.reactions.length)];

  try {
    callMisskeyApi('notes/reactions/create', { noteId: targetNote.id, reaction: reaction });
    incrementCounter('REACTION');
    console.log(`Reacted to "${targetNote.text.substring(0, 10)}..." with ${reaction}`);
  } catch (e) {
    console.warn(`Reaction failed: ${e.message}`);
  }
}
