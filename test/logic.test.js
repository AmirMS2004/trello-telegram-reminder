const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/logic.js');

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-10-14T10:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const card = (over) => Object.assign({
  id: 'c1', name: 'تسک نمونه', url: 'https://trello.com/c/abc', due: iso(NOW + 40 * HOUR),
  dueComplete: false, closed: false, listName: 'در حال انجام', boardName: 'برد', idMembers: ['m1']
}, over);
const opts = (over) => Object.assign({ stageHours: [48, 24, 12], unitMs: HOUR, ignoreLists: [], sent: {} }, over);

/* ---------- اعلانِ اساین و منشن ---------- */

const evCard = (over) => Object.assign({
  id: 'c1', name: 'تسک نمونه', url: 'https://trello.com/c/abc', due: iso(NOW + 40 * HOUR), closed: false,
  idMembers: ['m1'], desc: '', listName: 'در حال انجام', boardName: 'برد'
}, over);
const users = { ali: 'm1', sara: 'm2', nima: 'm3' };
const act = (type, data, by, date) => ({
  type, date: date || iso(NOW), idMemberCreator: by || 'm9', memberCreator: { fullName: 'مدیر پروژه' },
  data: Object.assign({ card: { id: 'c1' } }, data)
});
const ev = (actions, cards, over) => H.collectEvents(actions, Object.assign({
  cards: cards || { c1: evCard() }, membersByUsername: users, notifyAssign: true, notifyMention: true
}, over));

test('extractMentions: یوزرنیم‌ها، بدونِ تکرار، بدونِ ایمیل و @card/@board', () => {
  assert.deepEqual(H.extractMentions('سلام @Ali و @sara، @ali دوباره. ایمیل: x@nima.com @card @board'), ['ali', 'sara']);
  assert.deepEqual(H.extractMentions('@nima_2 اول خط'), ['nima_2']);
  assert.deepEqual(H.extractMentions(''), []);
});

test('newMentions: فقط منشن‌هایِ تازه در توضیحات', () => {
  assert.deepEqual(H.newMentions('@ali و @sara', 'قبلاً @ali'), ['sara']);
});

test('mentionExcerpt: خطِ حاویِ منشن، کوتاه‌شده', () => {
  assert.equal(H.mentionExcerpt('خط اول\n  لطفاً @sara   بررسی کن\nخط سوم', 'sara'), 'لطفاً @sara بررسی کن');
  assert.equal(H.mentionExcerpt('@ali ' + 'x'.repeat(300), 'ali').length, 200);
});

test('اساین: عضوِ اضافه‌شده اعلان می‌گیره، نه کسی که خودش رو اضافه کرده', () => {
  const r = ev([act('addMemberToCard', { idMember: 'm1' }, 'm2')]);
  assert.deepEqual(Object.keys(r), ['m1']);
  assert.equal(r.m1[0].reasons[0].type, 'assign');
  assert.deepEqual(ev([act('addMemberToCard', { idMember: 'm1' }, 'm1')]), {});
});

test('اساین: اگه عضو تا لحظه‌یِ چک از کارت حذف شده باشه، یا کارت آرشیو/حذف شده باشه، اعلان نمی‌ره', () => {
  assert.deepEqual(ev([act('addMemberToCard', { idMember: 'm2' })]), {});
  assert.deepEqual(ev([act('addMemberToCard', { idMember: 'm1' })], { c1: evCard({ closed: true }) }), {});
  assert.deepEqual(ev([act('addMemberToCard', { idMember: 'm1' })], { c1: null }), {});
});

test('ساختِ کارت با عضو و منشن در توضیحات: هر عضو یک بلوک با همه‌یِ دلیل‌ها، سازنده هیچی', () => {
  const c = evCard({ idMembers: ['m1', 'm2'], desc: 'هماهنگ با @nima و @sara' });
  const r = ev([
    act('createCard', {}, 'm1'),
    act('addMemberToCard', { idMember: 'm2' }, 'm1', iso(NOW + 1000)) // تکراری با createCard
  ], { c1: c });
  assert.deepEqual(Object.keys(r).sort(), ['m2', 'm3']);
  assert.equal(r.m2.length, 1);
  assert.deepEqual(r.m2[0].reasons.map((x) => x.type), ['assign', 'mention']);
  assert.equal(r.m3[0].reasons[0].source, 'desc');
});

test('منشن در کامنت: منشن‌شده‌ها اعلان می‌گیرن، نویسنده‌یِ کامنت و غیرعضوها نه', () => {
  const r = ev([act('commentCard', { text: '@ali @sara @unknown لطفاً ببینید' }, 'm1')]);
  assert.deepEqual(Object.keys(r), ['m2']);
  assert.equal(r.m2[0].reasons[0].source, 'comment');
  assert.ok(r.m2[0].reasons[0].excerpt.includes('لطفاً ببینید'));
});

test('ویرایشِ توضیحات: فقط منشن‌هایِ جدید', () => {
  const r = ev([act('updateCard', { card: { id: 'c1', desc: '@ali و @sara' }, old: { desc: '@ali' } })]);
  assert.deepEqual(Object.keys(r), ['m2']);
  // ویرایشی که به توضیحات ربطی نداره نادیده گرفته می‌شه
  assert.deepEqual(ev([act('updateCard', { card: { id: 'c1' }, old: { name: 'x' } })]), {});
});

test('notify_assign / notify_mention خاموش', () => {
  const acts = [act('addMemberToCard', { idMember: 'm1' }), act('commentCard', { text: '@sara' })];
  assert.deepEqual(Object.keys(ev(acts, null, { notifyAssign: false })), ['m2']);
  assert.deepEqual(Object.keys(ev(acts, null, { notifyMention: false })), ['m1']);
});

test('buildEventMessages: لینک، موعد، دلیل‌ها و HTML escape', () => {
  const entries = [{
    card: { id: 'c1', title: 'A<b>', url: 'https://trello.com/c/x', due: iso(NOW), boardName: 'برد', listName: 'لیست' },
    reasons: [{ type: 'assign', byName: 'سارا' }, { type: 'mention', source: 'comment', byName: 'نیما', excerpt: 'ببین <این>' }]
  }, {
    card: { id: 'c2', title: 'بدونِ موعد', url: 'u', due: null, boardName: 'برد', listName: '' },
    reasons: [{ type: 'mention', source: 'desc', byName: '' }]
  }];
  const m = H.buildEventMessages('علی', entries, { offsetMin: 210 })[0];
  assert.ok(m.includes('A&lt;b&gt;'));
  assert.ok(m.includes('به شما سپرده شد (توسطِ سارا)'));
  assert.ok(m.includes('نیما شما را در کامنت منشن کرد'));
  assert.ok(m.includes('«ببین &lt;این&gt;»'));
  assert.ok(m.includes('کسی شما را در توضیحاتِ کارت منشن کرد'));
  assert.equal((m.match(/موعد:/g) || []).length, 1);
});

test('تبدیلِ جلالی: تاریخ‌هایِ شناخته‌شده', () => {
  assert.deepEqual(H.gregorianToJalali(2024, 3, 20), [1403, 1, 1]);
  assert.deepEqual(H.gregorianToJalali(2025, 3, 21), [1404, 1, 1]);
  assert.deepEqual(H.gregorianToJalali(2026, 10, 14), [1405, 7, 22]);
});

test('formatJalali با منطقه‌یِ تهران (+3:30)', () => {
  // 2026-10-14 20:45 UTC = 1405/07/23 00:15 تهران
  assert.equal(H.formatJalali(Date.parse('2026-10-14T20:45:00Z'), 210), '۱۴۰۵/۰۷/۲۳ - ۰۰:۱۵');
});

test('timeLeftText', () => {
  assert.equal(H.timeLeftText(11.5 * HOUR), '۱۱ ساعت و ۳۰ دقیقه');
  assert.equal(H.timeLeftText(2 * HOUR), '۲ ساعت');
  assert.equal(H.timeLeftText(25 * 60000), '۲۵ دقیقه');
});

test('crossedStages: فقط وقتی موعد نرسیده و آستانه رد شده', () => {
  assert.deepEqual(H.crossedStages(NOW + 60 * HOUR, NOW, [48, 24, 12], HOUR), []);
  assert.deepEqual(H.crossedStages(NOW + 40 * HOUR, NOW, [48, 24, 12], HOUR), [48]);
  assert.deepEqual(H.crossedStages(NOW + 20 * HOUR, NOW, [48, 24, 12], HOUR), [48, 24]);
  assert.deepEqual(H.crossedStages(NOW + 5 * HOUR, NOW, [48, 24, 12], HOUR), [48, 24, 12]);
  assert.deepEqual(H.crossedStages(NOW - HOUR, NOW, [48, 24, 12], HOUR), []);
});

test('اولین مشاهده با چند مرحله‌یِ رد‌شده: فقط فوری‌ترین فرستاده می‌شه، همه علامت می‌خورن', () => {
  const r = H.decideReminders([card({ due: iso(NOW + 20 * HOUR) })], NOW, opts());
  assert.equal(r.m1.items.length, 1);
  assert.equal(r.m1.items[0].stage, 24);
  assert.equal(r.m1.keys.length, 2);
});

test('dedupe: مرحله‌یِ ارسال‌شده دوباره نمی‌ره، مرحله‌یِ بعدی می‌ره', () => {
  const c = card({ due: iso(NOW + 40 * HOUR) });
  const first = H.decideReminders([c], NOW, opts());
  assert.equal(first.m1.items[0].stage, 48);
  const sent = {};
  first.m1.keys.forEach((k) => (sent[k] = true));

  assert.deepEqual(H.decideReminders([c], NOW + 1 * HOUR, opts({ sent })), {});

  const later = H.decideReminders([c], NOW + 17 * HOUR, opts({ sent })); // 23 ساعت مانده
  assert.equal(later.m1.items[0].stage, 24);
  assert.equal(later.m1.keys.length, 1);
});

test('تغییرِ موعد، چرخه رو از اول شروع می‌کنه', () => {
  const c1 = card({ due: iso(NOW + 40 * HOUR) });
  const sent = {};
  H.decideReminders([c1], NOW, opts()).m1.keys.forEach((k) => (sent[k] = true));
  const c2 = card({ due: iso(NOW + 41 * HOUR) });
  assert.equal(H.decideReminders([c2], NOW, opts({ sent })).m1.items[0].stage, 48);
});

test('کارتِ تمام‌شده، آرشیو، بدونِ موعد و لیستِ نادیده‌گرفته‌شده پیام نمی‌گیره', () => {
  const cards = [
    card({ id: 'a', dueComplete: true }),
    card({ id: 'b', closed: true }),
    card({ id: 'c', due: null }),
    card({ id: 'd', listName: 'انجام‌شده' })
  ];
  assert.deepEqual(H.decideReminders(cards, NOW, opts({ ignoreLists: ['انجام‌شده'] })), {});
});

test('کارتِ چندعضوی: هر عضو سهمِ خودش رو داره', () => {
  const r = H.decideReminders([card({ idMembers: ['m1', 'm2'] })], NOW, opts());
  assert.equal(Object.keys(r).length, 2);
  assert.equal(r.m1.items.length, 1);
  assert.equal(r.m2.items.length, 1);
});

test('مرتب‌سازی بر اساسِ موعد و گروه‌بندیِ چند کارت برایِ یک نفر', () => {
  const r = H.decideReminders([
    card({ id: 'x', name: 'دیرتر', due: iso(NOW + 40 * HOUR) }),
    card({ id: 'y', name: 'زودتر', due: iso(NOW + 5 * HOUR) })
  ], NOW, opts());
  assert.deepEqual(r.m1.items.map((i) => i.title), ['زودتر', 'دیرتر']);
});

test('واحدِ دقیقه برایِ تست', () => {
  const c = card({ due: iso(NOW + 30 * 60000) });
  const r = H.decideReminders([c], NOW, opts({ stageHours: [48, 24, 12], unitMs: 60000 }));
  assert.equal(r.m1.items[0].stage, 48);
});

test('buildMessages: HTML escape، لینک و تاریخِ جلالی', () => {
  const items = H.decideReminders([card({ name: 'گزارش <b>مهم</b> & نهایی' })], NOW, opts()).m1.items;
  const msgs = H.buildMessages('علی <x>', items, { offsetMin: 210 });
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].includes('گزارش &lt;b&gt;مهم&lt;/b&gt; &amp; نهایی'));
  assert.ok(msgs[0].includes('علی &lt;x&gt;'));
  assert.ok(msgs[0].includes('href="https://trello.com/c/abc"'));
  assert.ok(/موعد: ۱۴۰۵\//.test(msgs[0]));
  assert.ok(msgs[0].includes('مانده: ۴۰ ساعت'));
});

test('buildMessages: پیامِ طولانی تقسیم می‌شه و هر پیام زیرِ سقف می‌مونه', () => {
  const items = [];
  for (let i = 0; i < 40; i++) {
    items.push({ title: 'تسک شماره ' + i + ' ' + 'x'.repeat(60), url: 'https://t/' + i, boardName: 'برد', listName: 'لیست', dueMs: NOW + 40 * HOUR, msLeft: 40 * HOUR });
  }
  const msgs = H.buildMessages('علی', items, { maxLen: 1500 });
  assert.ok(msgs.length > 1);
  msgs.forEach((m) => assert.ok(m.length <= 1500 + 400));
  const count = msgs.join('').match(/<a href/g).length;
  assert.equal(count, 40);
});
