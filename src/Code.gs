/* بات یادآوریِ موعدِ تسک‌هایِ Trello در تلگرام — Google Apps Script (container-bound به یک Google Sheet)
   کلیدها فقط توی Script Properties: TRELLO_KEY، TRELLO_TOKEN، TELEGRAM_TOKEN، WEBHOOK_SECRET */

var SHEETS = {
  Config: ['key', 'value', 'توضیح'],
  People: ['trello_member_id', 'trello_username', 'name', 'telegram_chat_id', 'status', 'telegram_username', 'requested_at'],
  Sent: ['key', 'sent_at'],
  Log: ['time', 'level', 'message']
};

var DEFAULT_CONFIG = [
  ['board_id', '', 'شناسه‌یِ یک یا چند برد، با کاما (از آدرسِ برد: trello.com/b/XXXXXXXX/...). مثال: AbCd1234,EfGh5678'],
  ['stages', '48,24,12', 'ساعت‌هایِ مانده به موعد که یادآوری می‌شه'],
  ['stage_unit', 'hours', 'hours یا minutes (minutes فقط برایِ تست)'],
  ['admin_chat_id', '', 'Telegram IDِ ادمین (عدد)'],
  ['dry_run', 'TRUE', 'TRUE: پیام‌ها فقط برایِ ادمین می‌رن و ثبت نمی‌شن؛ FALSE: ارسالِ واقعی'],
  ['ignore_lists', '', 'نامِ لیست‌هایی که کارت‌هایشان نادیده گرفته شه، با کاما (مثلاً: انجام‌شده,Done)'],
  ['tz_offset_min', '210', 'اختلاف با UTC به دقیقه (تهران: 210)'],
  ['webapp_url', '', 'آدرسِ Web App بعد از Deploy (…/exec)'],
  ['notify_assign', 'TRUE', 'TRUE: وقتی تسکی به کسی سپرده می‌شه بهش پیام بره'],
  ['notify_mention', 'TRUE', 'TRUE: وقتی کسی در کامنت یا توضیحاتِ کارت منشن می‌شه بهش پیام بره'],
  ['event_poll_minutes', '10', 'هر چند دقیقه اساین/منشن‌هایِ جدید چک بشن (1، 5، 10، 15 یا 30). بعد از تغییر installTriggers رو دوباره اجرا کن']
];

/* ---------- ابزارهایِ کوچک ---------- */

function nowMs_() { return Date.now(); }

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function sheet_(name) {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function rows_(name) {
  var v = sheet_(name).getDataRange().getValues();
  return v.slice(1);
}

function log_(level, message) {
  try { sheet_('Log').appendRow([new Date(), level, String(message).slice(0, 500)]); } catch (e) { /* ignore */ }
}

function cfg_() {
  var c = {};
  DEFAULT_CONFIG.forEach(function (r) { c[r[0]] = String(r[1]); });
  rows_('Config').forEach(function (r) { if (r[0]) c[String(r[0])] = String(r[1]); });
  return {
    boardIds: c.board_id.split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(Boolean),
    stages: c.stages.split(',').map(function (s) { return Number(s.trim()); }).filter(function (n) { return n > 0; }),
    unitMs: c.stage_unit.trim().toLowerCase() === 'minutes' ? 60000 : Logic.HOUR,
    adminChatId: c.admin_chat_id.trim(),
    dryRun: c.dry_run.trim().toUpperCase() !== 'FALSE',
    ignoreLists: c.ignore_lists.split(',').map(function (s) { return s.trim(); }).filter(Boolean),
    tzOffsetMin: Number(c.tz_offset_min) || 210,
    webappUrl: c.webapp_url.trim(),
    notifyAssign: c.notify_assign.trim().toUpperCase() !== 'FALSE',
    notifyMention: c.notify_mention.trim().toUpperCase() !== 'FALSE',
    eventPollMin: [1, 5, 10, 15, 30].indexOf(Number(c.event_poll_minutes)) !== -1 ? Number(c.event_poll_minutes) : 10
  };
}

/* ---------- Trello و Telegram ---------- */

/** GET روی API ِ Trello (path با / شروع می‌شه). اگه allow404 باشه، ۴۰۴ به‌جایِ خطا null برمی‌گردونه. */
function trelloGet_(path, allow404) {
  var res = UrlFetchApp.fetch('https://api.trello.com/1' + path, {
    muteHttpExceptions: true,
    headers: { Authorization: 'OAuth oauth_consumer_key="' + prop_('TRELLO_KEY') + '", oauth_token="' + prop_('TRELLO_TOKEN') + '"' }
  });
  var code = res.getResponseCode();
  if (code === 404 && allow404) return null;
  if (code !== 200) throw new Error('Trello HTTP ' + code);
  return JSON.parse(res.getContentText());
}

function trelloBoard_(boardId) {
  var b = trelloGet_('/boards/' + encodeURIComponent(boardId) +
    '?fields=name&cards=open&card_fields=name,due,dueComplete,closed,idList,idMembers,shortUrl' +
    '&lists=open&list_fields=name&members=all&member_fields=fullName,username');
  var lists = {};
  (b.lists || []).forEach(function (l) { lists[l.id] = l.name; });
  var cards = (b.cards || []).map(function (c) {
    return {
      id: c.id, name: c.name, url: c.shortUrl, due: c.due, dueComplete: c.dueComplete, closed: c.closed,
      idMembers: c.idMembers || [], listName: lists[c.idList] || '', boardName: b.name
    };
  });
  return { name: b.name, cards: cards, members: b.members || [] };
}

/** همه‌ی بردها رو می‌خونه؛ خطایِ یک برد بقیه رو متوقف نمی‌کنه. اعضا بر اساسِ شناسه یکتا می‌شن. */
function fetchBoards_(boardIds) {
  var out = { cards: [], members: [], errors: [] };
  var seen = {};
  boardIds.forEach(function (id) {
    try {
      var b = trelloBoard_(id);
      out.cards = out.cards.concat(b.cards);
      b.members.forEach(function (m) { if (!seen[m.id]) { seen[m.id] = true; out.members.push(m); } });
    } catch (err) {
      out.errors.push({ id: id, message: err && err.message ? err.message : String(err) });
    }
  });
  return out;
}

function notifyErrorThrottled_(text) {
  var last = Number(prop_('LAST_ERR_NOTIFY') || 0);
  if (nowMs_() - last > 3600000) {
    PropertiesService.getScriptProperties().setProperty('LAST_ERR_NOTIFY', String(nowMs_()));
    try { notifyAdmin_('❌ ' + Logic.escapeHtml(text)); } catch (e) { /* ignore */ }
  }
}

function tg_(method, payload) {
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + prop_('TELEGRAM_TOKEN') + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });
  var out;
  try { out = JSON.parse(res.getContentText()); } catch (e) { out = { ok: false, description: 'bad json' }; }
  return out;
}

function send_(chatId, text, extra) {
  var p = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (extra) Object.keys(extra).forEach(function (k) { p[k] = extra[k]; });
  return tg_('sendMessage', p);
}

function notifyAdmin_(text) {
  var admin = cfg_().adminChatId;
  if (admin) send_(admin, text);
}

/* ---------- People ---------- */

function peopleRows_() {
  return rows_('People').map(function (r, i) {
    return { row: i + 2, memberId: String(r[0]), username: r[1], name: r[2], chatId: String(r[3]), status: String(r[4]) };
  });
}

function approvedByMember_() {
  var m = {};
  peopleRows_().forEach(function (p) { if (p.status === 'approved') m[p.memberId] = p; });
  return m;
}

/* ---------- اجرایِ اصلیِ یادآوری (trigger هر ۳۰ دقیقه) ---------- */

function runReminders() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var cfg = cfg_();
    if (!cfg.boardIds.length) throw new Error('board_id در Config خالیه');
    var board = fetchBoards_(cfg.boardIds);
    board.errors.forEach(function (e) { log_('ERROR', 'برد ' + e.id + ': ' + e.message); });
    if (board.errors.length === cfg.boardIds.length) throw new Error('هیچ بردی خونده نشد (' + board.errors[0].message + ')');
    if (board.errors.length) {
      notifyErrorThrottled_('خطا در خواندنِ ' + board.errors.length + ' برد از ' + cfg.boardIds.length + ': ' +
        board.errors.map(function (e) { return e.id + ' (' + e.message + ')'; }).join('، '));
    }

    var sent = {};
    rows_('Sent').forEach(function (r) { sent[String(r[0])] = true; });

    var byMember = Logic.decideReminders(board.cards, nowMs_(), {
      stageHours: cfg.stages, unitMs: cfg.unitMs, ignoreLists: cfg.ignoreLists, sent: sent
    });

    var memberNames = {};
    board.members.forEach(function (m) { memberNames[m.id] = m.fullName || m.username; });
    var linked = approvedByMember_();

    Object.keys(byMember).forEach(function (memberId) {
      var g = byMember[memberId];
      var person = linked[memberId];
      var displayName = (person && person.name) || memberNames[memberId] || memberId;
      var msgs = Logic.buildMessages(displayName, g.items, { offsetMin: cfg.tzOffsetMin });

      if (cfg.dryRun) {
        var tag = '🧪 <b>[آزمایشی]</b> این پیام برایِ <b>' + Logic.escapeHtml(displayName) + '</b> ' +
          (person ? 'ارسال می‌شد.' : '(هنوز لینک نشده) ارسال نمی‌شد.') + '\n\n';
        msgs.forEach(function (m, i) { notifyAdmin_(i === 0 ? tag + m : m); });
        return;
      }

      if (!person) {
        var flag = 'UNLINKED_' + memberId;
        if (!prop_(flag)) {
          PropertiesService.getScriptProperties().setProperty(flag, '1');
          notifyAdmin_('⚠️ <b>' + Logic.escapeHtml(displayName) + '</b> کارتِ نزدیکِ موعد داره ولی هنوز به بات وصل نشده. ازش بخواه به بات /start بده.');
        }
        return;
      }

      var ok = msgs.every(function (m) { return send_(person.chatId, m).ok; });
      if (ok) {
        var ts = new Date();
        g.keys.forEach(function (k) { sheet_('Sent').appendRow([k, ts]); });
      } else {
        log_('ERROR', 'ارسال به ' + displayName + ' ناموفق بود؛ در اجرایِ بعدی دوباره تلاش می‌شه.');
      }
    });
  } catch (err) {
    log_('ERROR', err && err.message ? err.message : err);
    notifyErrorThrottled_('خطا در بات یادآوری: ' + (err && err.message ? err.message : err));
  } finally {
    lock.releaseLock();
  }
}

/* ---------- اعلانِ اساین و منشن (trigger هر event_poll_minutes دقیقه) ---------- */

var EVENT_ACTION_TYPES = 'addMemberToCard,createCard,copyCard,convertToCardFromCheckItem,commentCard,updateCard:desc';
var EVENT_PAGE = 1000;
var EVENT_MAX_ATTEMPTS = 3;

/** actionهایِ مرتبطِ برد بعد از since (شناسه‌یِ action)؛ جدیدترین اول. */
function trelloActions_(boardId, since) {
  var all = [];
  var before = '';
  for (var page = 0; page < 5; page++) {
    var batch = trelloGet_('/boards/' + encodeURIComponent(boardId) + '/actions?filter=' + EVENT_ACTION_TYPES +
      '&limit=' + EVENT_PAGE + '&since=' + encodeURIComponent(since) + (before ? '&before=' + encodeURIComponent(before) : '') +
      '&fields=type,date,data,idMemberCreator&memberCreator=true&memberCreator_fields=fullName,username');
    all = all.concat(batch);
    if (batch.length < EVENT_PAGE) break;
    before = batch[batch.length - 1].id;
  }
  return all;
}

/** وضعیتِ فعلیِ کارت (برایِ اعضا، توضیحات و متنِ پیام)؛ کارتِ حذف‌شده null. */
function trelloCard_(cardId) {
  var c = trelloGet_('/cards/' + encodeURIComponent(cardId) +
    '?fields=name,shortUrl,due,closed,idMembers,desc&list=true&list_fields=name&board=true&board_fields=name', true);
  if (!c) return null;
  return {
    id: c.id, name: c.name, url: c.shortUrl, due: c.due, closed: c.closed, idMembers: c.idMembers || [], desc: c.desc || '',
    listName: (c.list && c.list.name) || '', boardName: (c.board && c.board.name) || ''
  };
}

/** اعضایِ یک برد (با Cache ده‌دقیقه‌ای). */
function boardMemberList_(boardId) {
  var cache = CacheService.getScriptCache();
  var key = 'members_' + boardId;
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var members = trelloGet_('/boards/' + encodeURIComponent(boardId) + '/members?fields=fullName,username');
  cache.put(key, JSON.stringify(members), 600);
  return members;
}

function runEvents() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var cfg = cfg_();
    if (!cfg.notifyAssign && !cfg.notifyMention) return;
    if (!cfg.boardIds.length) throw new Error('board_id در Config خالیه');
    var props = PropertiesService.getScriptProperties();

    // ۱. actionهایِ جدیدِ هر برد. اولین اجرا فقط نقطه‌یِ شروع رو ثبت می‌کنه تا تاریخچه‌یِ قدیمی ارسال نشه.
    var actions = [];
    var boardsWithActions = [];
    var newCursors = {};
    var errors = [];
    cfg.boardIds.forEach(function (id) {
      try {
        var key = 'EVENT_CURSOR_' + id;
        var since = props.getProperty(key);
        if (!since) {
          var last = trelloGet_('/boards/' + encodeURIComponent(id) + '/actions?limit=1&fields=id');
          if (last.length) props.setProperty(key, last[0].id);
          return;
        }
        var acts = trelloActions_(id, since);
        if (acts.length) {
          newCursors[key] = acts[0].id;
          actions = actions.concat(acts);
          boardsWithActions.push(id);
        }
      } catch (err) {
        errors.push({ id: id, message: err && err.message ? err.message : String(err) });
      }
    });
    errors.forEach(function (e) { log_('ERROR', 'اعلان‌ها، برد ' + e.id + ': ' + e.message); });
    if (errors.length) {
      notifyErrorThrottled_('خطا در خواندنِ اعلان‌هایِ ' + errors.length + ' برد: ' +
        errors.map(function (e) { return e.id + ' (' + e.message + ')'; }).join('، '));
    }

    var retry = {};
    try { retry = JSON.parse(props.getProperty('EVENT_RETRY') || '{}'); } catch (e) { retry = {}; }
    if (!actions.length && !Object.keys(retry).length) return;

    // ۲. کارت‌ها و اعضایِ مربوط، بعد تبدیل به اعلان
    var byMember = {};
    var memberNames = {};
    if (actions.length) {
      var cards = {};
      actions.forEach(function (a) {
        var id = a.data && a.data.card && a.data.card.id;
        if (id && !(id in cards)) cards[id] = trelloCard_(id);
      });
      var byUsername = {};
      boardsWithActions.forEach(function (id) {
        boardMemberList_(id).forEach(function (m) {
          byUsername[String(m.username).toLowerCase()] = m.id;
          memberNames[m.id] = m.fullName || m.username;
        });
      });
      byMember = Logic.collectEvents(actions, {
        cards: cards, membersByUsername: byUsername, notifyAssign: cfg.notifyAssign, notifyMention: cfg.notifyMention
      });
    }

    // ۳. ارسال (هر نفر یک پیامِ خلاصه)؛ ارسالِ ناموفق تا EVENT_MAX_ATTEMPTS بار در اجراهایِ بعد تکرار می‌شه
    var linked = approvedByMember_();
    var nextRetry = {};
    var memberIds = Object.keys(retry).concat(Object.keys(byMember).filter(function (id) { return !retry[id]; }));
    memberIds.forEach(function (memberId) {
      var entries = (retry[memberId] ? retry[memberId].entries : []).concat(byMember[memberId] || []);
      var attempts = retry[memberId] ? retry[memberId].attempts : 0;
      var person = linked[memberId];
      var displayName = (person && person.name) || memberNames[memberId] || memberId;
      var msgs = Logic.buildEventMessages(displayName, entries, { offsetMin: cfg.tzOffsetMin });

      if (cfg.dryRun) {
        var tag = '🧪 <b>[آزمایشی]</b> این اعلان برایِ <b>' + Logic.escapeHtml(displayName) + '</b> ' +
          (person ? 'ارسال می‌شد.' : '(هنوز لینک نشده) ارسال نمی‌شد.') + '\n\n';
        msgs.forEach(function (m, i) { notifyAdmin_(i === 0 ? tag + m : m); });
        return;
      }
      if (!person) return;

      var ok = msgs.every(function (m) { return send_(person.chatId, m).ok; });
      if (ok) return;
      if (attempts + 1 < EVENT_MAX_ATTEMPTS) {
        nextRetry[memberId] = { entries: entries, attempts: attempts + 1 };
        log_('ERROR', 'ارسالِ اعلان به ' + displayName + ' ناموفق بود؛ در اجرایِ بعدی دوباره تلاش می‌شه.');
      } else {
        log_('ERROR', 'ارسالِ اعلان به ' + displayName + ' بعد از ' + EVENT_MAX_ATTEMPTS + ' تلاش کنار گذاشته شد.');
      }
    });

    Object.keys(newCursors).forEach(function (k) { props.setProperty(k, newCursors[k]); });
    if (Object.keys(nextRetry).length) props.setProperty('EVENT_RETRY', JSON.stringify(nextRetry));
    else props.deleteProperty('EVENT_RETRY');
  } catch (err) {
    log_('ERROR', 'اعلان‌ها: ' + (err && err.message ? err.message : err));
    notifyErrorThrottled_('خطا در اعلانِ اساین/منشن: ' + (err && err.message ? err.message : err));
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Webhookِ تلگرام: اتصالِ اعضا به بات ---------- */

function doPost(e) {
  try {
    if (!e || !e.parameter || !prop_('WEBHOOK_SECRET') || e.parameter.s !== prop_('WEBHOOK_SECRET')) {
      return ContentService.createTextOutput('forbidden');
    }
    var update = JSON.parse(e.postData.contents);
    // تلگرام اگه جوابِ ۲۰۰ مستقیم نگیره (Apps Script ریدایرکت می‌ده) همون آپدیت رو دوباره می‌فرسته؛ تکراری‌ها رو نادیده می‌گیریم.
    if (update.update_id != null && seenUpdate_(update.update_id)) return ContentService.createTextOutput('ok');
    handleUpdate_(update);
  } catch (err) {
    log_('ERROR', 'doPost: ' + (err && err.message ? err.message : err));
  }
  return ContentService.createTextOutput('ok');
}

/** آخرین ۳۰۰ شناسه‌یِ آپدیت رو دائمی (Script Properties) نگه می‌داره؛ Cache حداکثر ۶ ساعت می‌مونه و برایِ این کار کافی نیست. */
function seenUpdate_(id) {
  var lock = LockService.getDocumentLock();
  var locked = false;
  try { locked = lock.tryLock(10000); } catch (e) { /* ادامه بدون قفل */ }
  try {
    var props = PropertiesService.getScriptProperties();
    var list = [];
    try { list = JSON.parse(props.getProperty('SEEN_UPDATES') || '[]'); } catch (e) { list = []; }
    if (list.indexOf(id) !== -1) return true;
    list.push(id);
    if (list.length > 300) list = list.slice(-300);
    props.setProperty('SEEN_UPDATES', JSON.stringify(list));
    return false;
  } finally {
    if (locked) lock.releaseLock();
  }
}

function boardMembers_() {
  var ids = cfg_().boardIds;
  var cache = CacheService.getScriptCache();
  var cacheKey = 'board_members_' + ids.join('_');
  var hit = cache.get(cacheKey);
  if (hit) return JSON.parse(hit);
  var res = fetchBoards_(ids);
  if (res.errors.length === ids.length) throw new Error('هیچ بردی خونده نشد');
  var members = res.members.map(function (m) {
    return { id: m.id, name: m.fullName || m.username, username: m.username };
  });
  cache.put(cacheKey, JSON.stringify(members), 600);
  return members;
}

function handleUpdate_(u) {
  var cfg = cfg_();
  if (u.message && u.message.text && /^\/start/.test(u.message.text)) {
    var chatId = String(u.message.chat.id);
    var mine = peopleRows_().filter(function (p) { return p.chatId === chatId; });
    if (mine.some(function (p) { return p.status === 'approved'; })) {
      send_(chatId, 'شما قبلاً به بات وصل شدید و یادآوری‌ها برایتان ارسال می‌شود. ✅');
      return;
    }
    var taken = approvedByMember_();
    var buttons = boardMembers_().filter(function (m) { return !taken[m.id]; })
      .map(function (m) { return [{ text: m.name, callback_data: 'lk:' + m.id }]; });
    send_(chatId, 'سلام! 👋\nبرایِ دریافتِ یادآوریِ موعدِ تسک‌ها، لطفاً بگویید در Trello کدام یک از این افراد هستید:',
      { reply_markup: { inline_keyboard: buttons } });
    return;
  }

  if (!u.callback_query) return;
  var cb = u.callback_query;
  var data = String(cb.data || '');
  var fromId = String(cb.from.id);

  if (data.indexOf('lk:') === 0) {
    var memberId = data.slice(3);
    var member = boardMembers_().filter(function (m) { return m.id === memberId; })[0];
    if (!member) { tg_('answerCallbackQuery', { callback_query_id: cb.id, text: 'عضو پیدا نشد.' }); return; }
    var existing = peopleRows_().filter(function (p) { return p.chatId === fromId; })[0];
    var rowValues = [member.id, member.username, member.name, fromId, 'pending', cb.from.username || '', new Date()];
    if (existing) sheet_('People').getRange(existing.row, 1, 1, rowValues.length).setValues([rowValues]);
    else sheet_('People').appendRow(rowValues);
    tg_('answerCallbackQuery', { callback_query_id: cb.id, text: 'درخواست ارسال شد.' });
    send_(fromId, 'درخواستِ شما برایِ تأییدِ ادمین ارسال شد. پس از تأیید خبر می‌دهیم. ⏳');
    if (cfg.adminChatId) {
      send_(cfg.adminChatId,
        '🔗 درخواستِ اتصال:\nتلگرام: ' + Logic.escapeHtml((cb.from.first_name || '') + ' ' + (cb.from.last_name || '')) +
        (cb.from.username ? ' (@' + Logic.escapeHtml(cb.from.username) + ')' : '') +
        '\nمی‌خواهد به‌عنوانِ <b>' + Logic.escapeHtml(member.name) + '</b> وصل شود. تأیید می‌کنید؟',
        { reply_markup: { inline_keyboard: [[
          { text: '✅ تأیید', callback_data: 'ap:' + fromId + ':' + member.id },
          { text: '❌ رد', callback_data: 'rj:' + fromId + ':' + member.id }
        ]] } });
    }
    return;
  }

  if (data.indexOf('ap:') === 0 || data.indexOf('rj:') === 0) {
    if (!cfg.adminChatId || fromId !== cfg.adminChatId) {
      tg_('answerCallbackQuery', { callback_query_id: cb.id, text: 'فقط ادمین می‌تواند.' });
      return;
    }
    var parts = data.split(':');
    var targetChat = parts[1];
    var targetMember = parts[2];
    var approve = parts[0] === 'ap';
    var p = peopleRows_().filter(function (r) { return r.chatId === targetChat && r.memberId === targetMember; })[0];
    if (!p) { tg_('answerCallbackQuery', { callback_query_id: cb.id, text: 'درخواست پیدا نشد.' }); return; }
    sheet_('People').getRange(p.row, 5).setValue(approve ? 'approved' : 'rejected');
    tg_('answerCallbackQuery', { callback_query_id: cb.id, text: approve ? 'تأیید شد.' : 'رد شد.' });
    send_(targetChat, approve ? 'اتصالِ شما تأیید شد. ✅ از این پس یادآوریِ موعدِ تسک‌ها اینجا می‌آید.' : 'درخواستِ اتصالِ شما رد شد. با ادمین هماهنگ کنید.');
    return;
  }
}

/* ---------- راه‌اندازی (یک‌بار، دستی از ادیتور اجرا می‌شه) ---------- */

function setup() {
  Object.keys(SHEETS).forEach(function (name) {
    var sh = sheet_(name);
    if (sh.getLastRow() === 0) sh.appendRow(SHEETS[name]);
  });
  // کلیدهایِ جدیدِ Config به نصب‌هایِ قبلی هم اضافه می‌شن؛ مقدارهایِ موجود دست نمی‌خورن.
  var cfgSheet = sheet_('Config');
  var have = {};
  rows_('Config').forEach(function (r) { have[String(r[0])] = true; });
  DEFAULT_CONFIG.forEach(function (r) { if (!have[r[0]]) cfgSheet.appendRow(r); });
  if (!prop_('WEBHOOK_SECRET')) PropertiesService.getScriptProperties().setProperty('WEBHOOK_SECRET', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('شیت‌ها آماده شد. حالا Script Properties (TRELLO_KEY, TRELLO_TOKEN, TELEGRAM_TOKEN) و Config رو پر کن.');
}

function checkConfig() {
  var missing = [];
  ['TRELLO_KEY', 'TRELLO_TOKEN', 'TELEGRAM_TOKEN', 'WEBHOOK_SECRET'].forEach(function (k) { if (!prop_(k)) missing.push('Script Property: ' + k); });
  var c = cfg_();
  if (!c.boardIds.length) missing.push('Config: board_id');
  if (!c.adminChatId) missing.push('Config: admin_chat_id');
  Logger.log(missing.length ? 'ناقص: ' + missing.join(' | ') : 'همه‌چیز پر شده. dry_run=' + c.dryRun);
}

function testTrello() {
  cfg_().boardIds.forEach(function (id) {
    try {
      var b = trelloBoard_(id);
      var withDue = b.cards.filter(function (c) { return c.due && !c.dueComplete; }).length;
      Logger.log('برد: ' + b.name + ' (' + id + ') | کارت‌ها: ' + b.cards.length + ' | با موعدِ باز: ' + withDue + ' | اعضا: ' + b.members.length);
    } catch (err) {
      Logger.log('برد ' + id + ' ناموفق: ' + (err && err.message ? err.message : err) + ' — شناسه یا دسترسیِ حسابِ توکن رو چک کن.');
    }
  });
}

function testTelegram() {
  var r = send_(cfg_().adminChatId, '✅ تستِ اتصالِ بات یادآوری موفق بود.');
  Logger.log(JSON.stringify(r));
}

function setWebhook() {
  var url = cfg_().webappUrl;
  if (!url) throw new Error('webapp_url در Config خالیه (آدرسِ Deploy)');
  Logger.log(JSON.stringify(tg_('setWebhook', {
    url: url + (url.indexOf('?') === -1 ? '?' : '&') + 's=' + prop_('WEBHOOK_SECRET'),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  })));
}

function webhookInfo() {
  Logger.log(JSON.stringify(tg_('getWebhookInfo', {})));
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'runReminders' || fn === 'runEvents') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runReminders').timeBased().everyMinutes(30).create();
  var cfg = cfg_();
  if (cfg.notifyAssign || cfg.notifyMention) {
    ScriptApp.newTrigger('runEvents').timeBased().everyMinutes(cfg.eventPollMin).create();
    Logger.log('trigger یادآوری هر ۳۰ دقیقه و اعلانِ اساین/منشن هر ' + cfg.eventPollMin + ' دقیقه نصب شد.');
  } else {
    Logger.log('trigger یادآوری هر ۳۰ دقیقه نصب شد (اعلانِ اساین/منشن خاموشه).');
  }
}
