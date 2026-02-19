// GeminiAPI.gs

function callGemini(promptText, history = []) {
  const config = getConfig();
  
  // 日次制限チェック
  const props = PropertiesService.getScriptProperties();
  const todayKey = `COUNT_GEMINI_${getTodayStr()}`;
  const currentUsage = parseInt(props.getProperty(todayKey) || '0');
  
  if (currentUsage >= config.GEMINI_DAILY_LIMIT) {
    throw new Error('Gemini Daily Limit Exceeded');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_MODEL}:generateContent?key=${config.GEMINI_API_KEY}`;
  
  const contents = [];
  // 会話履歴があれば追加
  if (history.length > 0) {
    contents.push(...history);
  }
  
  contents.push({
    role: "user",
    parts: [{ text: promptText }]
  });

  const payload = {
    contents: contents,
    generationConfig: {
      maxOutputTokens: 200,
      temperature: 0.7
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    
    if (result.error) {
      throw new Error(result.error.message);
    }
    
    incrementCounter('GEMINI');
    return result.candidates[0].content.parts[0].text.trim();
  } catch (e) {
    throw e;
  }
}