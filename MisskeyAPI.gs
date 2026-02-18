// MisskeyAPI.gs

function callMisskeyApi(endpoint, payload) {
  const config = getConfig();
  const url = `${config.MISSKEY_INSTANCE}/api/${endpoint}`;
  
  payload.i = config.MISSKEY_TOKEN;

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();
    const content = JSON.parse(response.getContentText());

    if (code !== 200) {
      throw new Error(`API Error ${code}: ${JSON.stringify(content)}`);
    }
    return content;
  } catch (e) {
    throw e;
  }
}

function postNote(text, params = {}) {
  const payload = {
    text: text,
    visibility: getConfig().POST_VISIBILITY || 'home',
    ...params
  };
  const res = callMisskeyApi('notes/create', payload);
  incrementCounter('POST');
  return res;
}

function replyNote(replyId, text, params = {}) {
  const payload = {
    replyId: replyId,
    text: text,
    visibility: getConfig().POST_VISIBILITY || 'home',
    ...params
  };
  const res = callMisskeyApi('notes/create', payload);
  incrementCounter('REPLY');
  return res;
}

function getTimeline(type = 'local', limit = 10) {
  const endpoint = type === 'global' ? 'notes/global-timeline' : 
                   type === 'home' ? 'notes/timeline' : 'notes/local-timeline';
  return callMisskeyApi(endpoint, { limit: limit });
}