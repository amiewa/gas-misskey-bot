/**
 * Setup.gs
 * メニューバーに設定用コマンドを追加します
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Bot設定')
    .addItem('1. 初期セットアップ (シート作成)', 'setupSpreadsheet')
    .addItem('2. APIキー・トークン設定', 'setSecretProperties') // 追加
    .addToUi();
}

/**
 * 2. APIキーとトークンを入力ダイアログから設定する関数
 * これによりスプレッドシートに書かずにプロパティへ保存できます
 */
function setSecretProperties() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  // Misskey Token入力
  const tokenResponse = ui.prompt(
    'Misskey API Token 設定',
    'MisskeyのAPIトークン(i)を入力してください:',
    ui.ButtonSet.OK_CANCEL
  );

  if (tokenResponse.getSelectedButton() == ui.Button.OK) {
    const token = tokenResponse.getResponseText().trim();
    if (token) {
      props.setProperty('MISSKEY_TOKEN', token);
    }
  } else {
    return; // キャンセルされたら終了
  }

  // Gemini API Key入力
  const geminiResponse = ui.prompt(
    'Gemini API Key 設定',
    'Google AI StudioのAPIキーを入力してください:',
    ui.ButtonSet.OK_CANCEL
  );

  if (geminiResponse.getSelectedButton() == ui.Button.OK) {
    const key = geminiResponse.getResponseText().trim();
    if (key) {
      props.setProperty('GEMINI_API_KEY', key);
      ui.alert('完了', 'トークンとAPIキーをスクリプトプロパティに保存しました。', ui.ButtonSet.OK);
    }
  }
}

/**
 * 1. スプレッドシート作成 (トークン欄を除外)
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  
  const sheets = {
    '設定': {
      header: ['Key', 'Value', '説明'],
      data: [
        // トークン類はここから削除しました
        ['MISSKEY_INSTANCE', 'https://misskey.example.net', 'MisskeyインスタンスのURL'],
        ['GEMINI_MODEL', 'gemini-2.5-flash-lite', '使用するGeminiモデル名'],
        ['TIMELINE_TYPE', 'local', '参照するTL (local, home, global)'],
        // 初期テストが終わるまでpublic投稿にしないことを推奨
        ['POST_VISIBILITY', 'home', '投稿の公開範囲 (public, home, followers)'],
        ['NIGHT_START', '23', '夜間停止開始時間 (時)'],
        ['NIGHT_END', '6', '夜間停止終了時間 (時)'],
        ['GEMINI_DAILY_LIMIT', '50', '1日のGemini使用上限回数'],
        ['ENABLE_SCHEDULE_POST', 'TRUE', 'スケジュール投稿を有効にする'],
        ['ENABLE_RANDOM_POST', 'TRUE', 'ランダム投稿を有効にする'],
        ['ENABLE_GEMINI_POST', 'TRUE', 'Gemini自動投稿を有効にする'],
        ['ENABLE_POLL_POST', 'TRUE', '投票投稿を有効にする'],
        ['ENABLE_REACTION', 'TRUE', '自動リアクションを有効にする'],
        ['ENABLE_MENTION_REPLY', 'TRUE', 'メンション返信を有効にする'],
        ['ENABLE_FOLLOWBACK', 'TRUE', '自動フォローバックを有効にする'],
        ['RANDOM_POST_INTERVAL_H', '4', 'ランダム投稿の間隔(時間)'],
        ['GEMINI_POST_INTERVAL_H', '6', 'Gemini投稿の間隔(時間)'],
        ['POLL_POST_INTERVAL_H', '12', '投票投稿の間隔(時間)'],
        ['REACTION_RECENCY_MIN', '30', 'リアクション対象の投稿鮮度(分)'],
        ['EVENT_MIX_RATE', '30', 'イベント投稿の混入確率(%)'],
        ['MENTION_DAILY_LIMIT', '10', '1ユーザーあたりの1日の返信上限'],
        ['AFFINITY_RANK2', '5', '好感度ランク2に必要な会話数'],
        ['AFFINITY_RANK3', '20', '好感度ランク3に必要な会話数'],
        ['ERROR_NOTIFY_EMAIL', '', 'エラー通知先メールアドレス'],
        ['OWN_USER_ID', '', 'Bot自身のユーザーID (反応除外用)']
      ]
    },
    // ... 他のシート定義は前回と同じ ...
    'キャラクタープロンプト': { header: ['System Prompt', '説明'], data: [['あなたは元気で明るいAIアシスタントです。', 'Geminiへの指示']] },
    'スケジュール投稿': { header: ['時間帯', '投稿内容1', '投稿内容2'], data: [['7', 'おはよう！', '朝だ！']] },
    'ランダム投稿': { header: ['投稿内容'], data: [['お腹すいた']] },
    '投票質問文': { header: ['質問文'], data: [['好きな色は？']] },
    'フォールバック定型文': { header: ['定型返信'], data: [['なるほど！']] },
    'イベント': { header: ['日付', 'イベント名', '投稿内容'], data: [['01/01', '元旦', 'あけおめ！']] },
    'リアクション': { header: ['キーワード', 'リアクション候補1', 'リアクション候補2'], data: [['おはよう', '🌅', '🐔'], ['おやすみ', '💤', '🌙'], ['Misskey', '💙', '🚀'], ['いいね', '👍', '❤']] },
    'ユーザー管理': { header: ['UserId', '最終会話日時', '総会話数'], data: [] },
    'ダッシュボード': { header: ['日付', '投稿数', '返信数', 'Gemini数', 'エラー数'], data: [] },
    'エラーログ': { header: ['日時', '関数名', 'エラー内容'], data: [] }
  };

  for (const [sheetName, content] of Object.entries(sheets)) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    } else {
      if (sheet.getLastRow() > 0) continue; 
    }
    
    if (content.header.length > 0) {
      sheet.getRange(1, 1, 1, content.header.length).setValues([content.header]);
      sheet.getRange(1, 1, 1, content.header.length).setFontWeight('bold').setBackground('#EFEFEF');
    }
    if (content.data && content.data.length > 0) {
      const maxCols = content.header.length;
      const formattedData = content.data.map(row => {
        while (row.length < maxCols) row.push('');
        return row.slice(0, maxCols);
      });
      sheet.getRange(2, 1, formattedData.length, maxCols).setValues(formattedData);
    }
    sheet.autoResizeColumns(1, content.header.length);
  }

  const defaultSheet = ss.getSheetByName('シート1');
  if (defaultSheet && defaultSheet.getLastRow() === 0) ss.deleteSheet(defaultSheet);

  ui.alert('完了', 'シートを作成しました。\n続けてメニューの「2. APIキー・トークン設定」を実行してください。', ui.ButtonSet.OK);
}
