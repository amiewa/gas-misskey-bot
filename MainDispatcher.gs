// MainDispatcher.gs

function mainDispatcher() {
  const config = getConfig();
  
  // 【追加】Bot全体停止スイッチの確認
  // スプレッドシートが FALSE の場合はここで処理を強制終了する
  if (String(config.BOT_ACTIVE).toUpperCase() === 'FALSE') {
    console.log('BOT_ACTIVE is FALSE. Bot is sleeping.');
    return; 
  }

  const props = PropertiesService.getScriptProperties();
  const now = new Date();

  // 0時台のメンテナンス (F11)
  if (now.getHours() === 0) {
    const lastMaint = props.getProperty('LAST_MAINTENANCE_DATE');
    const todayStr = getTodayStr();
    if (lastMaint !== todayStr) {
      runDailyMaintenance();
      props.setProperty('LAST_MAINTENANCE_DATE', todayStr);
    }
  }

  // 夜間停止チェック
  if (isNightTime(config)) return;

  try {
    // F02: スケジュール投稿 (毎時チェック)
    processScheduledPost();
    
    // F07: リアクション (毎時実行)
    processReaction();

    // F03: ランダム投稿 (間隔チェック)
    checkAndRun('RANDOM_POST', config.RANDOM_POST_INTERVAL_H, processRandomPost);

    // F04: Gemini投稿 (間隔チェック)
    checkAndRun('GEMINI_POST', config.GEMINI_POST_INTERVAL_H, processGeminiPost);

    // F05: 投票 (間隔チェック)
    checkAndRun('POLL_POST', config.POLL_POST_INTERVAL_H, processPollPost);

  } catch (e) {
    logError('mainDispatcher', e);
  }
}

// 間隔実行ヘルパー
function checkAndRun(keyName, intervalHours, func) {
  if (!intervalHours) return;
  
  const props = PropertiesService.getScriptProperties();
  const lastRunKey = `LAST_RUN_${keyName}`;
  const lastRun = parseInt(props.getProperty(lastRunKey) || '0');
  const now = Date.now();
  
  if (now - lastRun >= intervalHours * 60 * 60 * 1000) {
    func();
    props.setProperty(lastRunKey, now.toString());
  }
}