// Utils.gs

// エラーハンドリングと通知 (F10)
function logError(funcName, error) {
  const config = getConfig();
  const now = new Date();
  
  // エラーログシートへの記録
  const sheet = SS.getSheetByName(SHEET.ERROR);
  sheet.appendRow([now, funcName, error.toString()]);
  console.error(`[${funcName}] ${error}`);

  // 通知抑制チェック
  const props = PropertiesService.getScriptProperties();
  const lastNotify = props.getProperty('LAST_ERROR_NOTIFY');
  const cooldownMs = (config.ERROR_NOTIFY_COOLDOWN_H || 1) * 60 * 60 * 1000;

  if (!lastNotify || (now.getTime() - parseInt(lastNotify) > cooldownMs)) {
    if (config.ERROR_NOTIFY_EMAIL) {
      MailApp.sendEmail({
        to: config.ERROR_NOTIFY_EMAIL,
        subject: `[MisskeyBot] Error in ${funcName}`,
        body: `Time: ${now}\nFunction: ${funcName}\nError: ${error.toString()}\n\nCheck the Error Log sheet for details.`
      });
      props.setProperty('LAST_ERROR_NOTIFY', now.getTime().toString());
    }
  }
}

// ダッシュボード更新用カウンタ (F11関連)
function incrementCounter(type) {
  const props = PropertiesService.getScriptProperties();
  const key = `COUNT_${type}_${getTodayStr()}`;
  const current = parseInt(props.getProperty(key) || '0');
  props.setProperty(key, (current + 1).toString());
}

// 今日の日付文字列 (YYYY-MM-DD)
function getTodayStr() {
  return Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');
}

// 夜間判定
function isNightTime(config) {
  const currentHour = new Date().getHours();
  const start = config.NIGHT_START;
  const end = config.NIGHT_END;
  
  if (start > end) {
    return currentHour >= start || currentHour < end;
  } else {
    return currentHour >= start && currentHour < end;
  }
}

// 日次リセット処理 (0時台に実行)
function runDailyMaintenance() {
  const sheet = SS.getSheetByName(SHEET.DASHBOARD);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = Utilities.formatDate(yesterday, 'JST', 'yyyy-MM-dd');
  const todayStr = getTodayStr(); // 今日の日付
  
  const props = PropertiesService.getScriptProperties();
  
  // 前日のデータを書き出し
  const types = ['POST', 'REPLY', 'REACTION', 'FOLLOWBACK', 'GEMINI', 'ERROR'];
  const row = [yStr];
  
  types.forEach(type => {
    const key = `COUNT_${type}_${yStr}`;
    row.push(props.getProperty(key) || 0);
  });
  
  sheet.appendRow(row);
  
  // ▼▼ ここから追加・修正（一括お掃除機能） ▼▼
  // プロパティを全件チェックし、今日以降のデータや、消してはいけない重要なキー以外を削除する
  const allProps = props.getProperties();
  const keysToKeep = [
    'MISSKEY_TOKEN', 
    'GEMINI_API_KEY', 
    'LAST_MAINTENANCE_DATE', 
    'LAST_SCHEDULED_POST_CONTENT',
    'LAST_ERROR_NOTIFY',
    'LAST_RUN_RANDOM_POST',
    'LAST_RUN_GEMINI_POST',
    'LAST_RUN_POLL_POST'
  ];

  for (const key in allProps) {
    // 重要なキーはスキップ
    if (keysToKeep.includes(key)) continue;
    
    // 今日の日付が含まれているカウンタはスキップ（今日使っているため）
    if (key.includes(todayStr)) continue;
    
    // それ以外（昨日のカウンタや、過去のメンション制限カウンタなど）は削除
    props.deleteProperty(key);
  }
  // ▲▲ ここまで ▲▲
}
