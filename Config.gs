// Config.gs

const SS = SpreadsheetApp.getActiveSpreadsheet();

const SHEET = {
  CONFIG: '設定',
  PROMPT: 'キャラクタープロンプト',
  SCHEDULE: 'スケジュール投稿',
  RANDOM: 'ランダム投稿',
  POLL: '投票質問文',
  FALLBACK: 'フォールバック定型文',
  EVENT: 'イベント',
  REACTION: 'リアクション',
  USER: 'ユーザー管理',
  DASHBOARD: 'ダッシュボード',
  ERROR: 'エラーログ'
};

function getConfig() {
  const cache = CacheService.getScriptCache();
  const cachedConfig = cache.get('bot_config');
  
  if (cachedConfig) {
    return JSON.parse(cachedConfig);
  }

  // 1. デフォルト設定
  const config = {
    MISSKEY_INSTANCE: 'https://misskey.io',
    GEMINI_MODEL: 'gemini-2.0-flash-lite',
    NIGHT_START: 23,
    NIGHT_END: 5,
    GEMINI_DAILY_LIMIT: 50
  };

  // 2. スプレッドシートから一般設定を読み込む
  const sheet = SS.getSheetByName(SHEET.CONFIG);
  if (sheet) {
    const data = sheet.getDataRange().getValues(); // A列:Key, B列:Value
    for (let i = 1; i < data.length; i++) { // ヘッダー飛ばし
      const key = data[i][0];
      const val = data[i][1];
      if (key && val !== '') {
        config[key] = val;
      }
    }
  }

  // 3. スクリプトプロパティから機密情報を読み込む (強制上書き)
  const props = PropertiesService.getScriptProperties();
  config.MISSKEY_TOKEN = props.getProperty('MISSKEY_TOKEN');
  config.GEMINI_API_KEY = props.getProperty('GEMINI_API_KEY');

  // エラーチェック: キーが設定されていない場合
  if (!config.MISSKEY_TOKEN || !config.GEMINI_API_KEY) {
    console.warn('MISSKEY_TOKEN or GEMINI_API_KEY is missing in Script Properties.');
  }

  cache.put('bot_config', JSON.stringify(config), 300);
  return config;
}

function getSystemPrompt() {
  const sheet = SS.getSheetByName(SHEET.PROMPT);
  return sheet ? sheet.getRange('A1').getValue() : '';
}