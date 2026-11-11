const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-10-14T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

function makeEnv(opts) {
  opts = opts || {};
  const sheets = {};
  const props = Object.assign({
    TRELLO_KEY: 'k', TRELLO_TOKEN: 't', TELEGRAM_TOKEN: 'bot', WEBHOOK_SECRET: 'sec'
  }, opts.props || {});
  const tgCalls = [];
  const trelloCalls = [];
  const cacheStore = {};
  const boards = opts.boards || { BOARD1: opts.board || { name: 'برد پایلوت', lists: [], members: [], cards: [] } };
  const boardStatus = {};
  const cardStatus = {};
  let failChat = opts.failChat;
  let trelloStatus = 200;

  function makeSheet(name) {
    const data = (sheets[name] = sheets[name] || []);
    return {
      appendRow: (r) => data.push(r.slice()),
      getLastRow: () => data.length,
      getDataRange: () => ({ getValues: () => data.map((r) => r.slice()) }),
      getRange: (row, col, nr, nc) => ({
        setValue: (v) => { data[row - 1][col - 1] = v; },
        setValues: (vals) => { vals[0].forEach((v, i) => { data[row - 1][col - 1 + i] = v; }); }
      })
    };
  }

  const ctx = {
    console, JSON, Math, Date, Object, Array, String, Number, Error, encodeURIComponent, Boolean,
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
      deleteProperty: (k) => { delete props[k]; },
      getProperties: () => Object.assign({}, props)
    }) },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
      getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} })
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = v; } }) },
    Utilities: { getUuid: () => 'x-y-z' },
    Logger: { log: () => {} },
    SpreadsheetApp: { getActive: () => ({
      getSheetByName: (n) => (sheets[n] ? makeSheet(n) : null),
      insertSheet: (n) => makeSheet(n)
    }) },
    ContentService: { createTextOutput: (s) => ({ text: s }) },
    UrlFetchApp: { fetch: (url, o) => {
      if (url.indexOf('api.trello.com') !== -1) {
        trelloCalls.push(url);
        const [pathPart, query] = url.split('api.trello.com/1')[1].split('?');
        const q = new URLSearchParams(query || '');
        const seg = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
        const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
        if (seg[0] === 'cards') {
          if (cardStatus[seg[1]]) return reply(cardStatus[seg[1]], {});
          for (const bid in boards) {
            const bb = boards[bid];
            const c = (bb.cards || []).find((x) => x.id === seg[1]);
            if (c) return reply(200, Object.assign({ desc: '' }, c, { list: { name: ((bb.lists || []).find((l) => l.id === c.idList) || {}).name }, board: { name: bb.name } }));
          }
          return reply(404, {});
        }
        const id = seg[1];
        const b = boards[id];
        if (!b) return reply(404, {});
        const status = boardStatus[id] || trelloStatus;
        if (status !== 200) return reply(status, {});
        if (seg[2] === 'actions') {
          const acts = b.actions || []; // جدیدترین اول، مثلِ Trello
          if (!q.get('since')) return reply(200, acts.slice(0, Number(q.get('limit')) || 50));
          const idx = acts.findIndex((a) => a.id === q.get('since'));
          return reply(200, idx === -1 ? acts : acts.slice(0, idx));
        }
        if (seg[2] === 'members') return reply(200, b.members);
        return reply(200, b);
      }
      const method = url.split('/bot' + props.TELEGRAM_TOKEN + '/')[1];
      const payload = JSON.parse(o.payload);
      tgCalls.push({ method, payload });
      const fail = failChat && String(payload.chat_id) === String(failChat);
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: !fail }) };
    } }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/logic.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/Code.gs'), 'utf8'), ctx);
  ctx.nowMs_ = () => NOW;
  ctx.setup();
  // Config
  const cfg = sheets.Config;
  const setCfg = (k, v) => { cfg.find((r) => r[0] === k)[1] = v; };
  setCfg('board_id', opts.boardIds || 'BOARD1');
  setCfg('admin_chat_id', '999');
  setCfg('dry_run', opts.dryRun === false ? 'FALSE' : 'TRUE');
  return { ctx, sheets, tgCalls, trelloCalls, props, setCfg, setTrelloStatus: (s) => { trelloStatus = s; }, setBoardStatus: (id, s) => { boardStatus[id] = s; }, setFailChat: (c) => { failChat = c; }, setCardStatus: (id, s) => { cardStatus[id] = s; } };
}

const board = () => ({
  name: 'برد پایلوت',
  lists: [{ id: 'L1', name: 'در حال انجام' }],
  members: [
    { id: 'm1', fullName: 'علی رضایی', username: 'ali' },
    { id: 'm2', fullName: 'سارا احمدی', username: 'sara' }
  ],
  cards: [
    { id: 'c1', name: 'گزارش فروش', due: iso(NOW + 40 * HOUR), dueComplete: false, closed: false, idList: 'L1', idMembers: ['m1'], shortUrl: 'https://trello.com/c/1' },
    { id: 'c2', name: 'طراحی بنر', due: iso(NOW + 5 * HOUR), dueComplete: false, closed: false, idList: 'L1', idMembers: ['m2'], shortUrl: 'https://trello.com/c/2' }
  ]
});

function addPerson(env, memberId, name, chatId, status) {
  env.sheets.People.push([memberId, '', name, chatId, status, '', '']);
}

test('ارسالِ واقعی: به عضوِ لینک‌شده پیام می‌ره، کلیدها ثبت می‌شن، اجرایِ دوم چیزی نمی‌فرسته', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runReminders();

  const toAli = env.tgCalls.filter((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === '111');
  assert.equal(toAli.length, 1);
  assert.ok(toAli[0].payload.text.includes('گزارش فروش'));
  assert.equal(toAli[0].payload.parse_mode, 'HTML');
  assert.equal(env.sheets.Sent.length - 1, 1); // یک کلید (کارتِ c1، مرحله‌یِ ۴۸)

  // عضوِ لینک‌نشده (سارا) فقط یک بار به ادمین هشدار می‌ده
  const adminWarn = env.tgCalls.filter((c) => String(c.payload.chat_id) === '999');
  assert.equal(adminWarn.length, 1);
  assert.ok(adminWarn[0].payload.text.includes('سارا احمدی'));

  env.tgCalls.length = 0;
  env.ctx.runReminders();
  assert.equal(env.tgCalls.length, 0);
});

test('dry-run: فقط ادمین پیام می‌گیره و هیچ کلیدی ثبت نمی‌شه', () => {
  const env = makeEnv({ board: board(), dryRun: true });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runReminders();
  assert.ok(env.tgCalls.length >= 2);
  env.tgCalls.forEach((c) => assert.equal(String(c.payload.chat_id), '999'));
  assert.ok(env.tgCalls.some((c) => c.payload.text.includes('[آزمایشی]')));
  assert.equal(env.sheets.Sent.length, 1); // فقط هدر
});

test('خطایِ ارسال: کلید ثبت نمی‌شه تا اجرایِ بعدی دوباره تلاش کنه', () => {
  const env = makeEnv({ board: board(), dryRun: false, failChat: '111' });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runReminders();
  assert.equal(env.sheets.Sent.length, 1);
  assert.ok(env.sheets.Log.some((r) => r[1] === 'ERROR'));
});

test('عضوِ pending یا rejected پیام نمی‌گیره', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  addPerson(env, 'm1', 'علی', '111', 'pending');
  env.ctx.runReminders();
  assert.equal(env.tgCalls.filter((c) => String(c.payload.chat_id) === '111').length, 0);
});

test('خطایِ Trello: لاگ می‌شه و به ادمین خبر می‌ره (یک بار در ساعت)', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  env.setTrelloStatus(401);
  env.ctx.runReminders();
  env.ctx.runReminders();
  const adminErr = env.tgCalls.filter((c) => String(c.payload.chat_id) === '999' && c.payload.text.includes('خطا'));
  assert.equal(adminErr.length, 1);
  assert.ok(env.sheets.Log.filter((r) => r[1] === 'ERROR').length >= 2);
});

test('onboarding: /start ← انتخابِ عضو ← تأییدِ ادمین ← approved', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  const post = (update, secret) => env.ctx.doPost({ parameter: { s: secret === undefined ? 'sec' : secret }, postData: { contents: JSON.stringify(update) } });

  assert.equal(post({ message: { text: '/start', chat: { id: 555 } } }, 'wrong').text, 'forbidden');
  assert.equal(env.tgCalls.length, 0);

  post({ message: { text: '/start', chat: { id: 555 } } });
  const kb = env.tgCalls[0].payload.reply_markup.inline_keyboard;
  assert.equal(kb.length, 2);
  assert.equal(kb[0][0].callback_data, 'lk:m1');

  env.tgCalls.length = 0;
  post({ callback_query: { id: 'q1', data: 'lk:m1', from: { id: 555, first_name: 'علی', username: 'ali_tg' } } });
  const adminMsg = env.tgCalls.find((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === '999');
  assert.ok(adminMsg.payload.text.includes('علی رضایی'));
  assert.equal(adminMsg.payload.reply_markup.inline_keyboard[0][0].callback_data, 'ap:555:m1');
  assert.equal(env.sheets.People[1][4], 'pending');

  // غیرادمین نمی‌تونه تأیید کنه
  post({ callback_query: { id: 'q2', data: 'ap:555:m1', from: { id: 777 } } });
  assert.equal(env.sheets.People[1][4], 'pending');

  // ادمین تأیید می‌کنه
  post({ callback_query: { id: 'q3', data: 'ap:555:m1', from: { id: 999 } } });
  assert.equal(env.sheets.People[1][4], 'approved');

  // حالا /start دوباره: «قبلاً وصل شدید»، و عضوِ m1 از لیستِ بقیه حذف می‌شه
  env.tgCalls.length = 0;
  post({ message: { text: '/start', chat: { id: 555 } } });
  assert.ok(env.tgCalls[0].payload.text.includes('قبلاً'));
  env.tgCalls.length = 0;
  post({ message: { text: '/start', chat: { id: 556 } } });
  const kb2 = env.tgCalls[0].payload.reply_markup.inline_keyboard;
  assert.equal(kb2.length, 1);
  assert.equal(kb2[0][0].callback_data, 'lk:m2');
});

test('آپدیتِ تکراریِ تلگرام (retry با همان update_id) فقط یک بار پردازش می‌شه', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  const post = (update) => env.ctx.doPost({ parameter: { s: 'sec' }, postData: { contents: JSON.stringify(update) } });
  const start = { update_id: 4242, message: { text: '/start', chat: { id: 555 } } };
  post(start);
  post(start);
  post(start);
  assert.equal(env.tgCalls.filter((c) => c.method === 'sendMessage').length, 1);
  post({ update_id: 4243, message: { text: '/start', chat: { id: 555 } } });
  assert.equal(env.tgCalls.filter((c) => c.method === 'sendMessage').length, 2);
});

const secondBoard = () => ({
  name: 'برد دوم',
  lists: [{ id: 'L9', name: 'بک‌لاگ' }],
  members: [
    { id: 'm1', fullName: 'علی رضایی', username: 'ali' },
    { id: 'm3', fullName: 'نیما کرمی', username: 'nima' }
  ],
  cards: [
    { id: 'c9', name: 'تحلیلِ رقبا', due: iso(NOW + 30 * HOUR), dueComplete: false, closed: false, idList: 'L9', idMembers: ['m1', 'm3'], shortUrl: 'https://trello.com/c/9' }
  ]
});

test('چند برد: یک نفر در دو برد، فقط یک پیامِ خلاصه با کارت‌هایِ هر دو برد می‌گیره', () => {
  const env = makeEnv({ boards: { BOARD1: board(), BOARD2: secondBoard() }, boardIds: 'BOARD1, BOARD2', dryRun: false });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runReminders();
  const toAli = env.tgCalls.filter((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === '111');
  assert.equal(toAli.length, 1);
  assert.ok(toAli[0].payload.text.includes('گزارش فروش'));
  assert.ok(toAli[0].payload.text.includes('تحلیلِ رقبا'));
  assert.ok(toAli[0].payload.text.includes('برد پایلوت'));
  assert.ok(toAli[0].payload.text.includes('برد دوم'));
  assert.ok(toAli[0].payload.text.includes('۲ تسک'));
  // اعضایِ لینک‌نشده (سارا و نیما) هر کدوم یک هشدار به ادمین
  const warns = env.tgCalls.filter((c) => String(c.payload.chat_id) === '999').map((c) => c.payload.text).join('\n');
  assert.ok(warns.includes('سارا احمدی'));
  assert.ok(warns.includes('نیما کرمی'));
});

test('چند برد: خطایِ یک برد بقیه رو متوقف نمی‌کنه، لاگ و گزارش به ادمین می‌ره', () => {
  const env = makeEnv({ boards: { BOARD1: board(), BOARD2: secondBoard() }, boardIds: 'BOARD1,BOARD2', dryRun: false });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.setBoardStatus('BOARD2', 401);
  env.ctx.runReminders();
  const toAli = env.tgCalls.filter((c) => String(c.payload.chat_id) === '111');
  assert.equal(toAli.length, 1);
  assert.ok(toAli[0].payload.text.includes('گزارش فروش'));
  assert.ok(!toAli[0].payload.text.includes('تحلیلِ رقبا'));
  assert.ok(env.sheets.Log.some((r) => r[1] === 'ERROR' && String(r[2]).includes('BOARD2')));
  assert.ok(env.tgCalls.some((c) => String(c.payload.chat_id) === '999' && c.payload.text.includes('BOARD2')));
});

test('چند برد: اگه همه‌ی بردها خطا بدن، خطای کلی ثبت می‌شه', () => {
  const env = makeEnv({ boards: { BOARD1: board() }, boardIds: 'BOARD1,NOPE', dryRun: false });
  env.setBoardStatus('BOARD1', 500);
  env.ctx.runReminders();
  assert.ok(env.sheets.Log.some((r) => r[1] === 'ERROR' && String(r[2]).includes('هیچ بردی')));
});

test('چند برد: لیستِ اعضایِ onboarding از همه‌ی بردها بدونِ تکرار ساخته می‌شه', () => {
  const env = makeEnv({ boards: { BOARD1: board(), BOARD2: secondBoard() }, boardIds: 'BOARD1,BOARD2', dryRun: false });
  const post = (update) => env.ctx.doPost({ parameter: { s: 'sec' }, postData: { contents: JSON.stringify(update) } });
  post({ update_id: 1, message: { text: '/start', chat: { id: 555 } } });
  const kb = env.tgCalls[0].payload.reply_markup.inline_keyboard;
  assert.deepEqual(kb.map((r) => r[0].callback_data).sort(), ['lk:m1', 'lk:m2', 'lk:m3']);
});

test('رد شدن: وضعیت rejected می‌شه و پیام نمی‌گیره', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  const post = (update) => env.ctx.doPost({ parameter: { s: 'sec' }, postData: { contents: JSON.stringify(update) } });
  post({ callback_query: { id: 'q1', data: 'lk:m1', from: { id: 555 } } });
  post({ callback_query: { id: 'q2', data: 'rj:555:m1', from: { id: 999 } } });
  assert.equal(env.sheets.People[1][4], 'rejected');
  env.tgCalls.length = 0;
  env.ctx.runReminders();
  assert.equal(env.tgCalls.filter((c) => String(c.payload.chat_id) === '555').length, 0);
});

/* ---------- اعلانِ اساین و منشن ---------- */

function eventsEnv(opts) {
  const b = board();
  b.actions = [{ id: 'a0', type: 'updateCard', date: iso(NOW - HOUR), idMemberCreator: 'm1', data: { card: { id: 'c1' } } }];
  const env = makeEnv(Object.assign({ board: b, dryRun: false }, opts));
  let n = 1;
  env.act = (type, data, by) => {
    b.actions.unshift({ id: 'a' + n++, type, date: iso(NOW + n * 1000), idMemberCreator: by,
      memberCreator: { fullName: b.members.find((m) => m.id === by).fullName }, data: Object.assign({ card: { id: 'c1' } }, data) });
  };
  env.to = (chat) => env.tgCalls.filter((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === chat);
  return env;
}

test('اعلان: اجرایِ اول فقط نقطه‌یِ شروع رو ثبت می‌کنه؛ تاریخچه‌یِ قدیمی ارسال نمی‌شه', () => {
  const env = eventsEnv();
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runEvents();
  assert.equal(env.tgCalls.length, 0);
  assert.equal(env.props.EVENT_CURSOR_BOARD1, 'a0');
});

test('اعلان: اساین ← یک پیام، اجرایِ بعد تکرار نمی‌شه، و اجرایِ بی‌اتفاق فقط یک درخواست به Trello', () => {
  const env = eventsEnv();
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runEvents();
  env.act('addMemberToCard', { idMember: 'm1' }, 'm2');
  env.ctx.runEvents();
  const msgs = env.to('111');
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].payload.text.includes('گزارش فروش'));
  assert.ok(msgs[0].payload.text.includes('سپرده شد (توسطِ سارا احمدی)'));

  env.tgCalls.length = 0;
  env.trelloCalls.length = 0;
  env.ctx.runEvents();
  assert.equal(env.tgCalls.length, 0);
  assert.equal(env.trelloCalls.length, 1);
});

test('اعلان: منشن در کامنت و توضیحات، با یک پیامِ خلاصه برایِ هر نفر', () => {
  const env = eventsEnv();
  addPerson(env, 'm2', 'سارا', '222', 'approved');
  env.ctx.runEvents();
  env.act('commentCard', { text: '@sara لطفاً عددها رو چک کن' }, 'm1');
  env.act('updateCard', { card: { id: 'c1', desc: 'مسئولِ بازبینی: @sara' }, old: { desc: '' } }, 'm1');
  env.ctx.runEvents();
  const msgs = env.to('222');
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].payload.text.includes('در کامنت منشن کرد'));
  assert.ok(msgs[0].payload.text.includes('در توضیحاتِ کارت منشن کرد'));
  assert.ok(msgs[0].payload.text.includes('عددها رو چک کن'));
});

test('اعلان: dry-run فقط برایِ ادمین، و نقطه‌یِ شروع جلو می‌ره', () => {
  const env = eventsEnv({ dryRun: true });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runEvents();
  env.act('addMemberToCard', { idMember: 'm1' }, 'm2');
  env.ctx.runEvents();
  assert.equal(env.to('111').length, 0);
  const admin = env.to('999');
  assert.equal(admin.length, 1);
  assert.ok(admin[0].payload.text.includes('[آزمایشی]'));
  env.ctx.runEvents();
  assert.equal(env.to('999').length, 1);
});

test('اعلان: ارسالِ ناموفق در اجرایِ بعد دوباره می‌ره و بعد از ۳ تلاش کنار گذاشته می‌شه', () => {
  const env = eventsEnv({ failChat: '111' });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runEvents();
  env.act('addMemberToCard', { idMember: 'm1' }, 'm2');
  env.ctx.runEvents();
  env.setFailChat(null);
  env.ctx.runEvents();
  assert.equal(env.to('111').length, 2); // یک شکست + یک موفق
  assert.equal(env.props.EVENT_RETRY, undefined);

  env.setFailChat('111');
  env.act('addMemberToCard', { idMember: 'm1' }, 'm2');
  for (let i = 0; i < 5; i++) env.ctx.runEvents();
  assert.equal(env.to('111').length, 5); // ۳ تلاشِ جدید، نه بیشتر
  assert.equal(env.props.EVENT_RETRY, undefined);
  assert.ok(env.sheets.Log.some((r) => String(r[2]).includes('کنار گذاشته شد')));
});

test('اعلان: عضوِ لینک‌نشده یا اعلانِ خاموش، پیامی نمی‌گیره', () => {
  const env = eventsEnv();
  env.ctx.runEvents();
  env.act('addMemberToCard', { idMember: 'm1' }, 'm2');
  env.ctx.runEvents();
  assert.equal(env.tgCalls.length, 0);

  const env2 = eventsEnv();
  addPerson(env2, 'm1', 'علی', '111', 'approved');
  env2.setCfg('notify_assign', 'FALSE');
  env2.ctx.runEvents();
  env2.act('addMemberToCard', { idMember: 'm1' }, 'm2');
  env2.ctx.runEvents();
  assert.equal(env2.tgCalls.length, 0);
});

test('کارتِ بدونِ دسترسی (۴۰۱): فقط همون کارت رد می‌شه و نقطه‌یِ شروع جلو می‌ره', () => {
  const env = eventsEnv();
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runEvents();
  env.act('addMemberToCard', { idMember: 'm1' }, 'm2');
  env.act('addMemberToCard', { card: { id: 'gone' }, idMember: 'm1' }, 'm2');
  env.setCardStatus('gone', 401);
  env.ctx.runEvents();
  assert.equal(env.to('111').length, 1);
  assert.equal(env.props.EVENT_CURSOR_BOARD1, 'a2');
  assert.ok(env.sheets.Log.some((r) => r[1] === 'WARN' && String(r[2]).includes('gone')));
});

test('خطایِ موقتِ کارت (۵۰۳): اجرا متوقف می‌شه و اجرایِ بعد دوباره تلاش می‌کنه', () => {
  const env = eventsEnv();
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runEvents();
  env.act('addMemberToCard', { idMember: 'm1' }, 'm2');
  env.setCardStatus('c1', 503);
  env.ctx.runEvents();
  assert.equal(env.to('111').length, 0);
  assert.equal(env.props.EVENT_CURSOR_BOARD1, 'a0');
  env.setCardStatus('c1', 0);
  env.ctx.runEvents();
  assert.equal(env.to('111').length, 1);
});

test('شمارشِ درخواست‌ها: جمعِ روز به تفکیکِ تابع، گزارشِ روزِ قبل در Log، و هشدارِ اجرایِ پرمصرف', () => {
  const env = eventsEnv();
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runEvents(); // ۱ درخواست (نقطه‌یِ شروع)
  env.ctx.runReminders(); // ۱ برد + پیام‌ها
  const day = (ms) => 'USAGE_' + new Date(ms + 210 * 60000).toISOString().slice(0, 10);
  const u = JSON.parse(env.props[day(NOW)]);
  assert.equal(u.runEvents, 1);
  assert.ok(u.runReminders >= 1);
  assert.equal(env.trelloCalls.length + env.tgCalls.length, u.runEvents + u.runReminders);

  // روزِ بعد: جمعِ دیروز یک بار لاگ و پاک می‌شه
  env.ctx.nowMs_ = () => NOW + 24 * HOUR;
  env.ctx.FETCH_WARN_PER_RUN = 1;
  env.ctx.runEvents();
  assert.equal(env.props[day(NOW)], undefined);
  const info = env.sheets.Log.filter((r) => r[1] === 'INFO');
  assert.equal(info.length, 1);
  assert.ok(String(info[0][2]).includes('runEvents: 1'));
  assert.ok(env.sheets.Log.some((r) => r[1] === 'WARN' && String(r[2]).startsWith('runEvents: 1 درخواست')));
});

test('setup روی نصبِ قدیمی:کلیدهایِ جدیدِ Config اضافه می‌شن و مقدارهایِ قبلی می‌مونن', () => {
  const env = makeEnv({ board: board() });
  env.sheets.Config.splice(env.sheets.Config.findIndex((r) => r[0] === 'notify_mention'), 1);
  env.ctx.setup();
  const keys = env.sheets.Config.map((r) => r[0]);
  assert.equal(keys.filter((k) => k === 'notify_mention').length, 1);
  assert.equal(keys.filter((k) => k === 'board_id').length, 1);
  assert.equal(env.sheets.Config.find((r) => r[0] === 'board_id')[1], 'BOARD1');
});

/* ---------- ساعتِ سکوت (NOW = ۱۳:۳۰ به وقتِ تهران) ---------- */

test('ساعتِ سکوت: یادآوری بی‌هیچ درخواستی عقب می‌افته و اولِ ساعتِ باز ارسال می‌شه', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.setCfg('quiet_hours', '13-14');
  env.ctx.runReminders();
  assert.equal(env.tgCalls.length, 0);
  assert.equal(env.trelloCalls.length, 0);
  assert.equal(env.sheets.Sent.length, 1);

  env.ctx.nowMs_ = () => NOW + HOUR; // ۱۴:۳۰
  env.ctx.runReminders();
  const toAli = env.tgCalls.filter((c) => String(c.payload.chat_id) === '111');
  assert.equal(toAli.length, 1);
  assert.ok(toAli[0].payload.text.includes('گزارش فروش'));
});

test('ساعتِ سکوت: اعلانِ اساین نگه داشته می‌شه و اولِ ساعتِ باز می‌ره', () => {
  const env = eventsEnv();
  addPerson(env, 'm1', 'علی', '111', 'approved');
  env.ctx.runEvents(); // نقطه‌یِ شروع
  env.setCfg('quiet_hours', '13-14');
  env.act('addMemberToCard', { idMember: 'm1' }, 'm2');
  env.trelloCalls.length = 0;
  env.ctx.runEvents();
  assert.equal(env.tgCalls.length, 0);
  assert.equal(env.trelloCalls.length, 0);
  assert.equal(env.props.EVENT_CURSOR_BOARD1, 'a0');

  env.ctx.nowMs_ = () => NOW + HOUR;
  env.ctx.runEvents();
  assert.equal(env.to('111').length, 1);
  assert.ok(env.to('111')[0].payload.text.includes('سپرده شد'));
});

/* ---------- شبیه‌سازیِ زمان: trigger هر ~۳۰ دقیقه، سه پیام برایِ هر کارت ---------- */

function simulate({ jitter, failAtRun, extra }) {
  const T0 = NOW;
  const due = T0 + 60 * HOUR;
  const b = {
    name: 'برد', lists: [{ id: 'L1', name: 'لیست' }],
    members: [{ id: 'm1', fullName: 'علی', username: 'ali' }],
    cards: [{ id: 'c1', name: 'کارتِ شبیه‌سازی', due: iso(due), dueComplete: false, closed: false, idList: 'L1', idMembers: ['m1'], shortUrl: 'https://trello.com/c/1' }]
  };
  const env = makeEnv({ board: b, dryRun: false });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

  const sendsAt = [];
  let t = T0;
  let run = 0;
  while (t < due + 3 * HOUR) {
    env.ctx.nowMs_ = () => t;
    if (failAtRun != null) env.setFailChat(run === failAtRun ? '111' : null);
    const before = env.tgCalls.filter((c) => String(c.payload.chat_id) === '111' && c.method === 'sendMessage').length;
    env.ctx.runReminders();
    const after = env.tgCalls.filter((c) => String(c.payload.chat_id) === '111' && c.method === 'sendMessage').length;
    // در اجرایِ شکست‌خورده، تلاشِ ارسال هم شمرده می‌شه ولی «ok:false» برمی‌گرده؛ فقط ارسال‌هایِ موفق رو می‌شماریم
    if (!(failAtRun != null && run === failAtRun)) {
      for (let i = before; i < after; i++) sendsAt.push(t);
    }
    if (extra) extra(env, t);
    run++;
    t += jitter ? Math.round((20 + rnd() * 20) * 60000) : 30 * 60000; // ۲۰ تا ۴۰ دقیقه
  }
  return { sendsAt, due, env };
}

test('شبیه‌سازی: trigger دقیقاً هر ۳۰ دقیقه ← برایِ یک کارت دقیقاً ۳ پیام (۴۸، ۲۴، ۱۲ ساعت)', () => {
  const { sendsAt, due } = simulate({ jitter: false });
  assert.equal(sendsAt.length, 3);
  const hoursLeft = sendsAt.map((t) => (due - t) / HOUR);
  // هر پیام در اولین اجرایِ بعد از عبور از آستانه: ۴۸ → ۴۷.۵..۴۸ ، ۲۴ → ۲۳.۵..۲۴ ، ۱۲ → ۱۱.۵..۱۲
  assert.ok(hoursLeft[0] <= 48 && hoursLeft[0] > 47.5, String(hoursLeft[0]));
  assert.ok(hoursLeft[1] <= 24 && hoursLeft[1] > 23.5, String(hoursLeft[1]));
  assert.ok(hoursLeft[2] <= 12 && hoursLeft[2] > 11.5, String(hoursLeft[2]));
});

test('شبیه‌سازی: trigger با نوسانِ ۲۰ تا ۴۰ دقیقه ← باز هم دقیقاً ۳ پیام و هر کدوم بدونِ تکرار', () => {
  const { sendsAt, due } = simulate({ jitter: true });
  assert.equal(sendsAt.length, 3);
  const hoursLeft = sendsAt.map((t) => (due - t) / HOUR);
  assert.ok(hoursLeft[0] <= 48 && hoursLeft[0] > 47, String(hoursLeft[0]));
  assert.ok(hoursLeft[1] <= 24 && hoursLeft[1] > 23, String(hoursLeft[1]));
  assert.ok(hoursLeft[2] <= 12 && hoursLeft[2] > 11, String(hoursLeft[2]));
});

test('شبیه‌سازی: یک ارسالِ شکست‌خورده در لحظه‌یِ مرحله‌یِ ۲۴ ← در اجرایِ بعد دوباره می‌ره، و بازم جمعاً ۳ پیامِ موفق', () => {
  // آستانه‌یِ ۲۴ ساعته = ۳۶ ساعت بعد از شروع = اجرایِ شماره‌یِ ۷۲ (هر اجرا ۳۰ دقیقه)؛ همون اجرا رو شکست می‌دیم
  const { sendsAt, due } = simulate({ jitter: false, failAtRun: 72 });
  assert.equal(sendsAt.length, 3);
  const hoursLeft = sendsAt.map((t) => (due - t) / HOUR);
  assert.ok(hoursLeft[1] <= 23.5 && hoursLeft[1] > 23, String(hoursLeft[1])); // یک اجرا دیرتر از آستانه
});

test('شبیه‌سازی: اگه کارت بعد از مرحله‌یِ ۲۴ complete بشه، دیگه هیچ پیامی نمی‌ره', () => {
  const due = NOW + 60 * HOUR;
  const b = {
    name: 'برد', lists: [{ id: 'L1', name: 'لیست' }],
    members: [{ id: 'm1', fullName: 'علی', username: 'ali' }],
    cards: [{ id: 'c1', name: 'کارت', due: iso(due), dueComplete: false, closed: false, idList: 'L1', idMembers: ['m1'], shortUrl: 'https://trello.com/c/1' }]
  };
  const env = makeEnv({ board: b, dryRun: false });
  addPerson(env, 'm1', 'علی', '111', 'approved');
  const count = () => env.tgCalls.filter((c) => String(c.payload.chat_id) === '111' && c.method === 'sendMessage').length;
  let t = NOW;
  const runAt = (ms) => { t = ms; env.ctx.nowMs_ = () => t; env.ctx.runReminders(); };
  for (let k = 0; k <= 73; k++) runAt(NOW + k * 30 * 60000); // تا کمی بعد از آستانه‌یِ ۲۴ ساعته
  assert.equal(count(), 2); // مرحله‌هایِ ۴۸ و ۲۴
  b.cards[0].dueComplete = true;
  for (let k = 74; k <= 125; k++) runAt(NOW + k * 30 * 60000); // تا بعد از موعد، از جمله آستانه‌یِ ۱۲ ساعته
  assert.equal(count(), 2);
});

test('dedupe دائمی: حتی بعد از پاک‌شدنِ Cache (۶ ساعت بعد)، همان آپدیت دوباره پردازش نمی‌شه', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  const post = (update) => env.ctx.doPost({ parameter: { s: 'sec' }, postData: { contents: JSON.stringify(update) } });
  const start = { update_id: 9001, message: { text: '/start', chat: { id: 555 } } };
  post(start);
  assert.equal(env.tgCalls.filter((c) => c.method === 'sendMessage').length, 1);
  // شبیه‌سازیِ ۶ ساعت بعد: Cache خالی می‌شه، ولی Script Properties می‌مونه
  for (let k = 0; k < 5; k++) post(start);
  assert.equal(env.tgCalls.filter((c) => c.method === 'sendMessage').length, 1);
  assert.ok(JSON.parse(env.props.SEEN_UPDATES).includes(9001));
});

test('dedupe دائمی: لیستِ شناسه‌ها به ۳۰۰ مورد محدود می‌مونه و آپدیت‌هایِ جدید همیشه پردازش می‌شن', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  const post = (update) => env.ctx.doPost({ parameter: { s: 'sec' }, postData: { contents: JSON.stringify(update) } });
  for (let i = 1; i <= 350; i++) post({ update_id: i, message: { text: 'hi', chat: { id: 555 } } });
  assert.equal(JSON.parse(env.props.SEEN_UPDATES).length, 300);
  const before = env.tgCalls.filter((c) => c.method === 'sendMessage').length;
  post({ update_id: 351, message: { text: '/start', chat: { id: 555 } } });
  assert.equal(env.tgCalls.filter((c) => c.method === 'sendMessage').length, before + 1);
});

test('تکرارِ callback (مثلاً تأیید): دوباره پیامِ «اتصال تأیید شد» نمی‌ره', () => {
  const env = makeEnv({ board: board(), dryRun: false });
  const post = (update) => env.ctx.doPost({ parameter: { s: 'sec' }, postData: { contents: JSON.stringify(update) } });
  post({ update_id: 1, callback_query: { id: 'q1', data: 'lk:m1', from: { id: 555 } } });
  const ap = { update_id: 2, callback_query: { id: 'q2', data: 'ap:555:m1', from: { id: 999 } } };
  post(ap);
  const n = env.tgCalls.filter((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === '555').length;
  post(ap);
  post(ap);
  assert.equal(env.tgCalls.filter((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === '555').length, n);
});
