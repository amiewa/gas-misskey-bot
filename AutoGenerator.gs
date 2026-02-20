/**
 * AutoGenerator.gs
 * キャラクタープロンプトを元にGeminiで台詞を自動生成する機能
 */

function showGenerateDialog() {
  const ui = SpreadsheetApp.getUi();
  
  // 1. 生成対象の選択
  const targetRes = ui.prompt(
    '台詞の自動生成',
    'どのシートの台詞を生成しますか？ 半角数字で入力してください。\n\n1: すべて一括生成\n2: スケジュール投稿\n3: ランダム投稿\n4: 投票質問文\n5: フォールバック定型文\n6: イベント投稿',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (targetRes.getSelectedButton() !== ui.Button.OK) return;
  const target = targetRes.getResponseText().trim();
  if (!['1', '2', '3', '4', '5', '6'].includes(target)) {
    ui.alert('エラー', '1〜6の数字を入力してください。', ui.ButtonSet.OK);
    return;
  }
  
  // 2. クリア or 追加の選択
  const modeRes = ui.prompt(
    '生成モード',
    '現在の台詞をクリアしてから生成しますか？ 現在のリストに追加しますか？\n半角英字で入力してください。\n\nC: クリアして生成\nA: 現在のリストに追加',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (modeRes.getSelectedButton() !== ui.Button.OK) return;
  const mode = modeRes.getResponseText().trim().toUpperCase() === 'C' ? 'CLEAR' : 'APPEND';
  
  // 3. キャラクタープロンプトの取得
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const charSheet = ss.getSheetByName('キャラクタープロンプト');
  let charPrompt = '';
  if (charSheet) {
    charPrompt = charSheet.getRange(2, 1).getValue();
  }
  if (!charPrompt) {
    ui.alert('エラー', '「キャラクタープロンプト」シートのA2セルにプロンプトが設定されていません。', ui.ButtonSet.OK);
    return;
  }

  ui.alert('確認', '生成を開始します。APIの制限に配慮するため、一括生成の場合は完了まで数分かかる場合があります。\n「完了」のメッセージが出るまで画面を閉じずにお待ちください。', ui.ButtonSet.OK);

  // 4. 生成処理の実行
  try {
    if (target === '1' || target === '2') generateSchedule(ss, charPrompt, mode);
    if (target === '1' || target === '3') generateRandom(ss, charPrompt, mode);
    if (target === '1' || target === '4') generatePoll(ss, charPrompt, mode);
    if (target === '1' || target === '5') generateFallback(ss, charPrompt, mode);
    if (target === '1' || target === '6') generateEvent(ss, charPrompt, mode);
    
    ui.alert('完了', '台詞の生成とシートへの書き込みが完了しました！', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', '生成中にエラーが発生しました。\nGeminiの制限に引っかかった可能性があります。時間をおいて再度お試しください。\n\n詳細: ' + e.message, ui.ButtonSet.OK);
  }
}

/**
 * GeminiからJSON形式で結果を受け取る共通関数（エラー対策の強化版）
 */
function fetchGeneratedJson(promptText) {
  // 1. AIへの指示に「改行禁止」「記号禁止」のルールを強制的に追加する
  const strictPrompt = promptText + '\n\n【絶対厳守】出力するJSONのデータ内（セリフの中など）には、絶対に「改行（エンター）」や「ダブルクォーテーション(")」を含めないでください。セリフは必ず1行のテキストとして出力してください。';
  
  // API通信
  let resText = callGemini(strictPrompt);
  
  // 2. 余計な文字（Markdown表記など）を消す
  let cleaned = resText.replace(/```json/gi, '').replace(/```/g, '').trim();
  
  // 3. AIがうっかり出力してしまった「生の改行文字」をプログラム側で強制的にすべて消去する
  cleaned = cleaned.replace(/\r?\n/g, '');
  
  // 4. 解析（パース）
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // どんな文字列が返ってきて失敗したのかログに残す
    console.error('【AI返答エラー】', cleaned);
    throw new Error('AIが想定外の文章を生成しました。もう一度だけ実行してみてください。\n詳細: ' + e.message);
  }
}

// ---------------------------------------------------
// 個別生成ロジック
// ---------------------------------------------------

function generateSchedule(ss, charPrompt, mode) {
  const sheet = ss.getSheetByName('スケジュール投稿');
  if (mode === 'CLEAR' && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).clearContent();
  }
  
  const prompt = `以下のシステムプロンプトのキャラクターになりきって、スケジュール投稿用のセリフを生成してください。
【システムプロンプト】
${charPrompt}

【条件】
- 7, 12, 17, 19, 22時の各時間帯につき、2つずつセリフを生成してください（合計10個）。
- 天候の話題（「良い天気だね」など）は避けてください。
- 以下の厳密なJSON配列形式で出力してください。
[
  {"time": "7", "memo": "朝の挨拶1", "text": "セリフ内容"},
  {"time": "7", "memo": "朝の挨拶2", "text": "セリフ内容"},
  ...
]`;

  const data = fetchGeneratedJson(prompt);
  const rows = data.map(d => [d.time, d.memo, d.text]);
  if (rows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  Utilities.sleep(3000); // レートリミット対策(3秒待機)
}

function generateRandom(ss, charPrompt, mode) {
  const sheet = ss.getSheetByName('ランダム投稿');
  if (mode === 'CLEAR' && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).clearContent();
  }
  
  const prompt = `以下のシステムプロンプトのキャラクターになりきって、ランダム投稿用のセリフを生成してください。
【システムプロンプト】
${charPrompt}

【条件】
- 意味はあまりなく、でもちょっと遊び心があり、何度見ても飽きない、特に印象に残らない、でもちょっと冗談っぽいセリフを「30個」生成してください。
- 以下の厳密なJSON配列形式で出力してください。
["セリフ1", "セリフ2", ...]`;

  const data = fetchGeneratedJson(prompt);
  const rows = data.map(d => [d]);
  if (rows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 1).setValues(rows);
  Utilities.sleep(3000);
}

function generatePoll(ss, charPrompt, mode) {
  const sheet = ss.getSheetByName('投票質問文');
  if (mode === 'CLEAR' && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).clearContent();
  }
  
  const prompt = `以下のシステムプロンプトのキャラクターになりきって、投票機能用の質問文を生成してください。
【システムプロンプト】
${charPrompt}

【条件】
- 「宝物にしたいもの」「恋の告白に使いたいもの」「歴史の本に載せたいもの」など、「〜〜したいもの」をお題にした4択アンケートの質問文（質問文のみ）を「10個」生成してください。
- 質問文は35文字以内にしてください。短くても構いません。
- 以下の厳密なJSON配列形式で出力してください。
["質問文1", "質問文2", ...]`;

  const data = fetchGeneratedJson(prompt);
  const rows = data.map(d => [d]);
  if (rows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 1).setValues(rows);
  Utilities.sleep(3000);
}

function generateFallback(ss, charPrompt, mode) {
  const sheet = ss.getSheetByName('フォールバック定型文');
  if (mode === 'CLEAR' && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).clearContent();
  }
  
  const prompt = `以下のシステムプロンプトのキャラクターになりきって、エラー時や返信不能時に使う定型文を生成してください。
【システムプロンプト】
${charPrompt}

【条件】
- APIの制限に達した時や、返信に失敗した時などに使う定型文を「3つ」生成してください。
- スルーする態度、聞こえないふり、体調が悪い態度などのニュアンスを含めてください。
- 以下の厳密なJSON配列形式で出力してください。
["定型文1", "定型文2", ...]`;

  const data = fetchGeneratedJson(prompt);
  const rows = data.map(d => [d]);
  if (rows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 1).setValues(rows);
  Utilities.sleep(3000);
}

function generateEvent(ss, charPrompt, mode) {
  const sheet = ss.getSheetByName('イベント');
  if (mode === 'CLEAR' && sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).clearContent();
  }
  
  const prompt = `以下のシステムプロンプトのキャラクターになりきって、日本の記念日やイベント日に合わせたセリフを生成してください。
【システムプロンプト】
${charPrompt}

【条件】
- 日付が年によって変動しない記念日を選んでください（春分の日などは除外）。
- 各イベントにつき1つ、1年分（合計15個程度）生成してください。
- 以下のイベントは必ず含めてください：元旦(01/01)、バレンタインデー(02/14)、ホワイトデー(03/14)、クリスマスイブ(12/24)、クリスマス(12/25)、大晦日(12/31)。
- 誰も知らないようなネタっぽい珍しい記念日もいくつか含めてください。
- 以下の厳密なJSON配列形式で出力してください。日付は "MM/DD" 形式にしてください。
[
  {"date": "01/01", "name": "元旦", "text": "セリフ"},
  {"date": "02/14", "name": "バレンタインデー", "text": "セリフ"},
  ...
]`;

  const data = fetchGeneratedJson(prompt);
  const rows = data.map(d => [d.date, d.name, d.text]);
  if (rows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 3).setValues(rows);
  Utilities.sleep(3000);
}