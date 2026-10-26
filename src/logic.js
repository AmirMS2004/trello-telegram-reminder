/* منطقِ خالصِ یادآوری — هم توی Apps Script (به‌اسمِ logic.gs) اجرا می‌شه و هم توی Node تست می‌شه. */
var Logic = (function () {
  'use strict';

  var HOUR = 3600 * 1000;
  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

  function faDigits(s) {
    return String(s).replace(/\d/g, function (d) { return FA_DIGITS.charAt(d); });
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function gregorianToJalali(gy, gm, gd) {
    var gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    var gy2 = gm > 2 ? gy + 1 : gy;
    var days = 355666 + 365 * gy + ~~((gy2 + 3) / 4) - ~~((gy2 + 99) / 100) + ~~((gy2 + 399) / 400) + gd + gdm[gm - 1];
    var jy = -1595 + 33 * ~~(days / 12053);
    days %= 12053;
    jy += 4 * ~~(days / 1461);
    days %= 1461;
    if (days > 365) {
      jy += ~~((days - 1) / 365);
      days = (days - 1) % 365;
    }
    var jm = days < 186 ? 1 + ~~(days / 31) : 7 + ~~((days - 186) / 30);
    var jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return [jy, jm, jd];
  }

  /** تاریخ و ساعتِ جلالی به وقتِ محلی (offsetMin = اختلاف با UTC، تهران = 210) */
  function formatJalali(ms, offsetMin) {
    var d = new Date(ms + offsetMin * 60000);
    var j = gregorianToJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    return faDigits(j[0] + '/' + pad2(j[1]) + '/' + pad2(j[2]) + ' - ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()));
  }

  function timeLeftText(ms) {
    var totalMin = Math.max(0, Math.floor(ms / 60000));
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h >= 1) return faDigits(h) + ' ساعت' + (m ? ' و ' + faDigits(m) + ' دقیقه' : '');
    return faDigits(m) + ' دقیقه';
  }

  /** مرحله‌هایی (ساعت) که آستانه‌شون رد شده و موعد هنوز نرسیده؛ از بزرگ به کوچک. */
  function crossedStages(dueMs, nowMs, stageHours, unitMs) {
    if (!(dueMs > nowMs)) return [];
    return stageHours
      .filter(function (h) { return nowMs >= dueMs - h * unitMs; })
      .sort(function (a, b) { return b - a; });
  }

  function stageKey(card, stage, memberId) {
    return [card.id, card.due, stage, memberId].join('|');
  }

  /**
   * تصمیم می‌گیره برایِ هر عضو چه کارت‌هایی یادآوری بشن.
   * اگه چند مرحله هم‌زمان رد شده باشن، فقط فوری‌ترین مرحله فرستاده می‌شه و همه‌ی مرحله‌هایِ رد‌شده علامت می‌خورن.
   * خروجی: { memberId: { items: [...], keys: [...] } }
   */
  function decideReminders(cards, nowMs, opts) {
    var stageHours = opts.stageHours;
    var unitMs = opts.unitMs || HOUR;
    var ignore = (opts.ignoreLists || []).map(function (s) { return String(s).trim(); }).filter(Boolean);
    var sent = opts.sent || {};
    var byMember = {};

    cards.forEach(function (card) {
      if (!card.due || card.dueComplete || card.closed) return;
      if (ignore.indexOf(card.listName) !== -1) return;
      var dueMs = Date.parse(card.due);
      if (isNaN(dueMs)) return;
      var crossed = crossedStages(dueMs, nowMs, stageHours, unitMs);
      if (!crossed.length) return;
      var urgent = crossed[crossed.length - 1];

      (card.idMembers || []).forEach(function (memberId) {
        if (sent[stageKey(card, urgent, memberId)]) return;
        var g = byMember[memberId] || (byMember[memberId] = { items: [], keys: [] });
        crossed.forEach(function (h) {
          var k = stageKey(card, h, memberId);
          if (!sent[k]) g.keys.push(k);
        });
        g.items.push({
          cardId: card.id,
          title: card.name,
          url: card.url,
          boardName: card.boardName || '',
          listName: card.listName || '',
          dueMs: dueMs,
          stage: urgent,
          msLeft: dueMs - nowMs
        });
      });
    });

    Object.keys(byMember).forEach(function (id) {
      byMember[id].items.sort(function (a, b) { return a.dueMs - b.dueMs; });
    });
    return byMember;
  }

  /** متنِ پیام(های) تلگرام (HTML) برایِ یک نفر؛ اگه طولانی شد به چند پیام تقسیم می‌شه. */
  function buildMessages(name, items, opts) {
    var offsetMin = opts && opts.offsetMin != null ? opts.offsetMin : 210;
    var maxLen = (opts && opts.maxLen) || 3500;
    var head = '⏰ <b>یادآوریِ موعدِ تسک</b>\nسلام ' + escapeHtml(name || '') + '، ' +
      faDigits(items.length) + ' تسکِ شما به موعد نزدیک است:\n';
    var contHead = '⏰ <b>ادامه‌ی یادآوری‌ها</b>\n';

    var blocks = items.map(function (it, i) {
      return '\n' + faDigits(i + 1) + '. <a href="' + escapeHtml(it.url || '') + '">' + escapeHtml(it.title) + '</a>\n' +
        '🗂 ' + escapeHtml(it.boardName) + (it.listName ? ' / ' + escapeHtml(it.listName) : '') + '\n' +
        '📅 موعد: ' + formatJalali(it.dueMs, offsetMin) + '\n' +
        '⏳ مانده: ' + timeLeftText(it.msLeft) + '\n';
    });
    return chunk(head, contHead, blocks, maxLen);
  }

  /* ---------- اعلانِ اساین و منشن ---------- */

  // یوزرنیمِ Trello: حروفِ لاتین، عدد و _ ؛ قبلش نباید حرف/عدد باشه (تا ایمیل منشن حساب نشه).
  var MENTION_RE = /(^|[^A-Za-z0-9_@.])@([A-Za-z0-9_]{2,})/g;
  var GROUP_MENTIONS = { card: true, board: true };
  var CREATE_TYPES = { createCard: true, copyCard: true, convertToCardFromCheckItem: true };

  /** یوزرنیم‌هایِ منشن‌شده (حروفِ کوچک، بدونِ تکرار)؛ @card و @board حساب نمی‌شن. */
  function extractMentions(text) {
    var out = [];
    String(text || '').replace(MENTION_RE, function (all, pre, u) {
      u = u.toLowerCase();
      if (!GROUP_MENTIONS[u] && out.indexOf(u) === -1) out.push(u);
      return all;
    });
    return out;
  }

  /** منشن‌هایی که در متنِ جدید هستن و در متنِ قبلی نبودن. */
  function newMentions(newText, oldText) {
    var old = extractMentions(oldText);
    return extractMentions(newText).filter(function (u) { return old.indexOf(u) === -1; });
  }

  /** خطی از متن که منشن توش هست (یا کلِ متن)، کوتاه‌شده. */
  function mentionExcerpt(text, username, maxLen) {
    maxLen = maxLen || 200;
    var s = String(text || '');
    var lines = s.split('\n');
    var re = new RegExp('@' + username + '(?![A-Za-z0-9_])', 'i');
    for (var i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) { s = lines[i]; break; }
    }
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
  }

  /**
   * actionهایِ Trello رو به اعلان برایِ هر عضو تبدیل می‌کنه.
   * ctx.cards: { cardId: کارتِ فعلی (یا null اگه پیدا نشد) } با فیلدهایِ id, name, url, due, closed, idMembers, desc, listName, boardName
   * ctx.membersByUsername: { username (حروفِ کوچک): memberId }
   * خروجی: { memberId: [ { card: {...}, reasons: [{ type: 'assign'|'mention', source, byName, excerpt }] } ] }
   */
  function collectEvents(actions, ctx) {
    var cards = ctx.cards || {};
    var byUser = ctx.membersByUsername || {};
    var byMember = {};
    var seen = {};

    function add(memberId, card, by, reason) {
      if (!memberId || memberId === by) return;
      var k = [memberId, card.id, reason.type, reason.source || ''].join('|');
      if (seen[k]) return;
      seen[k] = true;
      var list = byMember[memberId] || (byMember[memberId] = []);
      var entry = list.filter(function (e) { return e.card.id === card.id; })[0];
      if (!entry) {
        entry = {
          card: { id: card.id, title: card.name, url: card.url, due: card.due || null, boardName: card.boardName || '', listName: card.listName || '' },
          reasons: []
        };
        list.push(entry);
      }
      entry.reasons.push(reason);
    }

    function mentions(names, text, card, by, byName, source) {
      names.forEach(function (u) {
        add(byUser[u], card, by, { type: 'mention', source: source, byName: byName, excerpt: mentionExcerpt(text, u) });
      });
    }

    actions.slice().sort(function (a, b) { return Date.parse(a.date) - Date.parse(b.date); }).forEach(function (a) {
      var d = a.data || {};
      var card = d.card && cards[d.card.id];
      if (!card || card.closed) return;
      var by = a.idMemberCreator;
      var byName = (a.memberCreator && (a.memberCreator.fullName || a.memberCreator.username)) || '';
      var members = card.idMembers || [];

      if (a.type === 'addMemberToCard') {
        // فقط اگه هنوز عضوِ کارته (اضافه و بلافاصله حذف نشده باشه)
        if (ctx.notifyAssign && members.indexOf(d.idMember) !== -1) add(d.idMember, card, by, { type: 'assign', byName: byName });
      } else if (CREATE_TYPES[a.type]) {
        if (ctx.notifyAssign) members.forEach(function (m) { add(m, card, by, { type: 'assign', byName: byName }); });
        if (ctx.notifyMention) mentions(extractMentions(card.desc), card.desc, card, by, byName, 'desc');
      } else if (a.type === 'commentCard') {
        if (ctx.notifyMention) mentions(extractMentions(d.text), d.text, card, by, byName, 'comment');
      } else if (a.type === 'updateCard' && d.old && 'desc' in d.old) {
        if (ctx.notifyMention) mentions(newMentions(d.card.desc, d.old.desc), d.card.desc, card, by, byName, 'desc');
      }
    });
    return byMember;
  }

  /** متنِ پیام(های) اعلانِ اساین/منشن برایِ یک نفر. */
  function buildEventMessages(name, entries, opts) {
    var offsetMin = opts && opts.offsetMin != null ? opts.offsetMin : 210;
    var maxLen = (opts && opts.maxLen) || 3500;
    var head = '🔔 <b>اعلانِ تسک</b>\nسلام ' + escapeHtml(name || '') + '،\n';
    var contHead = '🔔 <b>ادامه‌ی اعلان‌ها</b>\n';

    var blocks = entries.map(function (e, i) {
      var c = e.card;
      var dueMs = c.due ? Date.parse(c.due) : NaN;
      var lines = '\n' + faDigits(i + 1) + '. <a href="' + escapeHtml(c.url || '') + '">' + escapeHtml(c.title) + '</a>\n' +
        '🗂 ' + escapeHtml(c.boardName) + (c.listName ? ' / ' + escapeHtml(c.listName) : '') + '\n' +
        (isNaN(dueMs) ? '' : '📅 موعد: ' + formatJalali(dueMs, offsetMin) + '\n');
      e.reasons.forEach(function (r) {
        var by = r.byName ? escapeHtml(r.byName) : 'کسی';
        if (r.type === 'assign') {
          lines += '👤 این تسک به شما سپرده شد' + (r.byName ? ' (توسطِ ' + by + ')' : '') + '\n';
        } else {
          lines += (r.source === 'comment' ? '💬 ' + by + ' شما را در کامنت منشن کرد' : '📝 ' + by + ' شما را در توضیحاتِ کارت منشن کرد') +
            (r.excerpt ? ':\n«' + escapeHtml(r.excerpt) + '»' : '') + '\n';
        }
      });
      return lines;
    });
    return chunk(head, contHead, blocks, maxLen);
  }

  /** بلوک‌ها رو پشتِ سرِ هم می‌چینه و اگه از maxLen رد شد پیامِ بعدی رو با contHead شروع می‌کنه. */
  function chunk(head, contHead, blocks, maxLen) {
    var messages = [];
    var cur = head;
    blocks.forEach(function (b) {
      if (cur.length + b.length > maxLen && cur !== head && cur !== contHead) {
        messages.push(cur);
        cur = contHead;
      }
      cur += b;
    });
    messages.push(cur);
    return messages;
  }

  return {
    HOUR: HOUR,
    faDigits: faDigits,
    escapeHtml: escapeHtml,
    gregorianToJalali: gregorianToJalali,
    formatJalali: formatJalali,
    timeLeftText: timeLeftText,
    crossedStages: crossedStages,
    stageKey: stageKey,
    decideReminders: decideReminders,
    buildMessages: buildMessages,
    extractMentions: extractMentions,
    newMentions: newMentions,
    mentionExcerpt: mentionExcerpt,
    collectEvents: collectEvents,
    buildEventMessages: buildEventMessages
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
