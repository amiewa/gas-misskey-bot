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
  
  const props = PropertiesService.getScriptProperties();
  
  // 前日のデータを書き出し
  const types = ['POST', 'REPLY', 'REACTION', 'FOLLOWBACK', 'GEMINI', 'ERROR'];
  const row = [yStr];
  
  types.forEach(type => {
    const key = `COUNT_${type}_${yStr}`;
    row.push(props.getProperty(key) || 0);
    props.deleteProperty(key); // プロパティ削除して掃除
  });
  
  sheet.appendRow(row);
  
  // ユーザー管理シートの「本日の返信回数」リセットなどはここで行うと良いが、
  // 今回の設計では日付を見て判定するため不要。
}