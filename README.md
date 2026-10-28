# Trello → Telegram Reminder Bot

**[English](#english) · [فارسی](#فارسی)**

## English

A serverless Telegram bot that keeps a team on top of its Trello boards, where the team already talks: Telegram.

- **Due-date reminders** to each card's members at 48, 24 and 12 hours before the deadline (configurable).
- **Assignment notifications** when someone is added to a card (including cards created with members).
- **Mention notifications** for direct `@username` mentions in comments and card descriptions.
- **One summary message per person per run**, with card link, board/list, Jalali (Persian) due date and time left.

**How it works**

```
Trello REST API (read-only) ──► Google Apps Script (time triggers) ──► Telegram Bot API
                                        │
                                Google Sheet: Config · People · Sent · Log
```

- Runs entirely on **Google Apps Script**, bound to a **Google Sheet** that serves as config panel and storage. No server, no hosting cost.
- **Read-only Trello token**: the bot never changes boards.
- **Admin-approved onboarding**: members send `/start`, pick their Trello identity, and the admin approves before anything is delivered.
- **Dry-run mode** sends every message to the admin only, for safe rollout.
- **Exactly-once delivery** per card, due date, stage and member; failed sends are retried on the next run.
- **Multi-board**: one summary per person across all boards; one failing board doesn't stop the others.
- Secrets live only in Apps Script **Script Properties**, never in the sheet or the code.

**Project layout**

- `src/logic.js`: pure logic (stages, dedupe, mentions, Jalali dates, message text). Runs in both Apps Script and Node.
- `src/Code.gs`: triggers, Trello, Telegram, Sheet and the Telegram webhook.
- `test/`: Node tests with a mocked Apps Script environment, including time simulations (`npm test`).

**Setup**

The step-by-step setup guide below is in Persian. In short:
1. Create a Google Sheet and open Extensions → Apps Script.
2. Paste `src/Code.gs` and `src/logic.js` (as `logic`), then run `setup`.
3. Add `TRELLO_KEY`, `TRELLO_TOKEN` and `TELEGRAM_TOKEN` to Script Properties.
4. Fill `board_id` and `admin_chat_id` in the `Config` sheet.
5. Deploy as a web app, then run `setWebhook` and `installTriggers`.

**License**: [MIT](LICENSE)

---

## فارسی

به هر عضوِ مسئولِ کارت، در ۴۸ / ۲۴ / ۱۲ ساعتِ مانده به موعد، پیامِ تلگرام می‌فرسته. همچنین وقتی تسکی به کسی سپرده می‌شه یا کسی در کامنت/توضیحاتِ کارت منشن می‌شه، (حداکثر ~۱۰ دقیقه بعد) بهش خبر می‌ده. روی Google Apps Script اجرا می‌شه (بدونِ سرور).

## فایل‌ها
- `src/logic.js`: منطقِ خالص (مرحله‌ها، dedupe، تاریخِ جلالی، متنِ پیام). توی Apps Script به اسمِ `logic` (فایلِ `logic.gs`) قرار می‌گیره.
- `src/Code.gs`: trigger، Trello، Telegram، Sheet، webhook.
- `test/`: تست‌هایِ Node (`npm test`).

## نصب (یک‌بار، حدودِ ۲۰ دقیقه)

### ۱. چیزهایی که لازم داری
- **Trello API key:** [trello.com/power-ups/admin](https://trello.com/power-ups/admin) ← یه Power-Up بساز ← بخشِ API key ← Generate. کلید رو کپی کن.
- **Trello token (فقط خواندن):** این آدرس رو توی مرورگر باز کن (به‌جایِ `YOUR_KEY` کلید رو بذار) و Allow بزن:
  `https://trello.com/1/authorize?expiration=never&scope=read&response_type=token&name=TrelloReminder&key=YOUR_KEY`
- **Board ID:** از آدرسِ برد: `trello.com/b/`**`XXXXXXXX`**`/نام-برد` ← همون `XXXXXXXX`.
- **توکنِ بات تلگرام:** از [@BotFather](https://t.me/BotFather) ← `/newbot`.
- **Telegram IDِ ادمین:** از [@userinfobot](https://t.me/userinfobot) (عددِ `Id`). بعد خودِ ادمین باید یه بار به باتِ جدید `/start` بده، وگرنه بات نمی‌تونه به او پیام بده.

### ۲. Sheet و اسکریپت
1. یه Google Sheet جدید بساز (با حسابِ گوگلِ تیم یا سازمان).
2. **Extensions ← Apps Script.**
3. توی ادیتور، فایلِ پیش‌فرضِ `Code.gs` رو با محتوایِ `src/Code.gs` جایگزین کن.
4. با **+ ← Script** یه فایلِ جدید به اسمِ `logic` بساز و محتوایِ `src/logic.js` رو توش بچسبون (اسمش توی ادیتور می‌شه `logic.gs`).
5. تابعِ **`setup`** رو اجرا کن (بالایِ صفحه انتخاب ← Run) و دسترسی‌ها رو تأیید کن. شیت‌هایِ `Config`، `People`، `Sent` و `Log` ساخته می‌شن.

### ۳. کلیدها (فقط اینجا، نه توی شیت یا چت)
**Project Settings (چرخ‌دنده) ← Script Properties ← Add script property:**
| نام | مقدار |
|---|---|
| `TRELLO_KEY` | کلیدِ Trello |
| `TRELLO_TOKEN` | توکنِ Trello |
| `TELEGRAM_TOKEN` | توکنِ BotFather |

(`WEBHOOK_SECRET` رو `setup` خودش می‌سازه.)

### ۴. Config
توی شیتِ `Config` مقدارِ این‌ها رو پر کن: `board_id`، `admin_chat_id`. بقیه پیش‌فرض خوبه. `dry_run` فعلاً **TRUE** بمونه.

### ۵. بررسی
تابع‌هایِ زیر رو یکی‌یکی اجرا کن و جوابش رو توی **Execution log** ببین:
1. `checkConfig`: باید بگه همه‌چیز پر شده.
2. `testTrello`: نامِ برد، تعدادِ کارت و اعضا.
3. `testTelegram`: یه پیام «تست موفق بود» به ادمین.

### ۶. Webhook (برایِ اتصالِ اعضا)
1. **Deploy ← New deployment ← Web app.** Execute as: **Me**. Who has access: **Anyone**. Deploy و آدرسِ `…/exec` رو کپی کن.
2. توی `Config` مقدارِ `webapp_url` رو با اون آدرس پر کن.
3. تابعِ **`setWebhook`** رو اجرا کن. باید `"ok":true` ببینی.
4. هر وقت `Code.gs` رو عوض کردی، باید **Deploy ← Manage deployments ← Edit ← New version** بزنی، وگرنه نسخه‌یِ قدیمی روی webhook می‌مونه.

## تست در حالتِ آزمایشی (dry-run)
1. هر عضو به بات `/start` می‌ده ← خودش رو از لیست انتخاب می‌کنه ← ادمین دکمه‌یِ ✅ تأیید رو می‌زنه. توی شیتِ `People` وضعیت می‌شه `approved`.
2. برایِ تست سریع: توی `Config`، `stage_unit` رو `minutes` و `stages` رو مثلاً `30,15,5` بذار. یه کارتِ آزمایشی با موعدِ ۱۰ دقیقه‌یِ دیگه بساز.
3. تابعِ **`runReminders`** رو دستی اجرا کن. پیام فقط برایِ **ادمین** میاد با برچسبِ «[آزمایشی]». (در dry-run چیزی توی `Sent` ثبت نمی‌شه، پس می‌شه دوباره اجرا کرد.)
4. وقتی راضی بودی: `stage_unit` ← `hours`، `stages` ← `48,24,12`.

## انتشارِ واقعی
1. `dry_run` ← **FALSE**.
2. تابعِ **`installTriggers`** رو اجرا کن (یادآوری هر ۳۰ دقیقه، اعلانِ اساین/منشن هر `event_poll_minutes` دقیقه).
3. اعضایِ لینک‌نشده‌ای که کارتِ نزدیکِ موعد دارن، یک بار به ادمین هشدار می‌دن.

## اعلانِ اساین و منشن
- **اساین:** وقتی عضوی به کارت اضافه می‌شه (یا کارت از اول با اون عضو ساخته/کپی می‌شه) بهش پیام می‌ره. کسی که خودش رو اضافه کرده پیام نمی‌گیره. اگه تا لحظه‌یِ چک دوباره از کارت حذف شده باشه هم پیام نمی‌ره.
- **منشن:** `@username` در کامنت، یا در توضیحاتِ کارت (فقط منشن‌هایی که تازه اضافه شدن). فقط منشنِ مستقیمِ افراد؛ `@card` و `@board` حساب نمی‌شن. کسی که خودش رو منشن کنه پیام نمی‌گیره.
- هر نفر در هر اجرا یک پیامِ خلاصه می‌گیره؛ اگه یک کارت هم اساین و هم منشن داشته باشه، یک بلوک با هر دو دلیل.
- با `notify_assign` و `notify_mention` در `Config` جدا روشن/خاموش می‌شن.
- اولین اجرا فقط نقطه‌یِ شروع رو ثبت می‌کنه (تاریخچه‌یِ قبلی ارسال نمی‌شه). در `dry_run` هم نقطه‌یِ شروع جلو می‌ره، پس برایِ تست باید اتفاقِ جدید (اساین/کامنتِ تازه) بسازی و `runEvents` رو دستی اجرا کنی.
- ارسالِ ناموفق تا ۳ اجرا دوباره تلاش می‌شه، بعد توی `Log` ثبت و کنار گذاشته می‌شه.
- اگه کارتی خونده نشه چون توکن بهش دسترسی نداره (۴۰۱/۴۰۳، مثلاً به بردِ دیگه‌ای منتقل شده)، فقط اعلان‌هایِ همون کارت رد و `WARN` ثبت می‌شه. خطاهایِ موقتِ Trello (۴۲۹ و ۵xx) اجرا رو متوقف می‌کنن تا اجرایِ بعدی دوباره تلاش کنه.
- ویرایشِ کامنت برایِ اضافه‌کردنِ منشن حساب نمی‌شه.

**به‌روزرسانیِ نصبِ قبلی:** هر دو فایل (`Code.gs` و `logic`) رو جایگزین کن ← `setup` رو یک بار اجرا کن (کلیدهایِ جدیدِ `Config` اضافه می‌شن، مقدارهایِ قبلی دست نمی‌خورن) ← Deploy ← New version ← `installTriggers`.

**بار روی سیستم:** هر اجرایِ بی‌اتفاق برایِ هر برد فقط **یک** درخواست به Trello می‌زنه (actionهایِ بعد از آخرین چک) و فقط شیتِ `Config` رو می‌خونه؛ چند ثانیه طول می‌کشه. فقط وقتی اتفاقی افتاده، کارت‌هایِ مربوط و اعضایِ برد خونده می‌شن. پیش‌فرض هر ۱۰ دقیقه (روزانه ۱۴۴ اجرا). سقفِ زمانِ اجرایِ triggerها در Google Workspace روزانه ۶ ساعت و در حسابِ شخصیِ Gmail روزانه ۹۰ دقیقه‌ست. برایِ تغییر، `event_poll_minutes` رو ۵، ۱۵ یا ۳۰ کن و `installTriggers` رو دوباره اجرا کن.

## افزودنِ بردهایِ دیگر
- توی `Config`، `board_id` رو با کاما پر کن: `AbCd1234,EfGh5678`.
- حسابِ Trello که توکن رو ساخته باید به همه‌یِ این بردها دسترسی داشته باشه (عضو برد یا Workspace). وگرنه همون برد خطایِ ۴۰۱/۴۰۴ می‌ده و بقیه ادامه می‌دن (به ادمین گزارش می‌شه).
- اعضا فقط یک بار به بات وصل می‌شن (شناسه‌یِ عضو بینِ بردها یکیه). عضوِ جدیدِ یه برد باید `/start` بزنه.
- یه نفر که توی چند برد کارتِ نزدیکِ موعد داره، توی هر اجرا فقط **یک پیامِ خلاصه** با همه‌یِ کارت‌ها می‌گیره.
- بعد از تغییرِ کد، **New version** (Deploy) یادت نره.
- سقفِ عملی: چند ده برد در هر اجرا (محدودیتِ ۶ دقیقه‌ای Apps Script). برایِ تعدادِ خیلی زیاد باید طراحی عوض بشه.

## رفتار
- هر مرحله برایِ هر `کارت + موعد + مرحله + عضو` فقط یک بار می‌ره. تغییرِ موعد چرخه رو از اول شروع می‌کنه.
- کارتی که تازه دیده می‌شه و چند مرحله‌ش رد شده، فقط **فوری‌ترین** مرحله رو می‌گیره.
- کارتِ `dueComplete`، آرشیوشده، یا توی لیست‌هایِ `ignore_lists` نادیده گرفته می‌شه.
- هر نفر در هر اجرا یک پیامِ خلاصه می‌گیره.
- اگه ارسالی شکست بخوره، ثبت نمی‌شه و ۳۰ دقیقه بعد دوباره تلاش می‌شه. خطاها توی شیتِ `Log` و (حداکثر ساعتی یک بار) به ادمین گزارش می‌شن.
- **مصرفِ درخواست‌ها:** تعدادِ درخواست‌هایِ بیرونی (Trello و Telegram) شمرده می‌شه. جمعِ هر روز (به وقتِ تهران، به تفکیکِ `runEvents`، `runReminders` و `doPost`) اولین اجرایِ روزِ بعد به‌صورتِ `INFO` توی `Log` ثبت می‌شه. اجرایی که بیشتر از ۱۰۰ درخواست بزنه همون موقع `WARN` با جزئیات می‌گیره. سقفِ روزانه‌یِ UrlFetch برایِ کلِ حسابِ گوگل مشترکه (Gmail: ۲۰٬۰۰۰، Workspace: ۱۰۰٬۰۰۰).

## محدودیت‌ها
- پیام حداکثر ~۳۰ دقیقه دیرتر از آستانه می‌رسه. اعلانِ اساین/منشن حداکثر `event_poll_minutes` دقیقه دیرتر.
- webhookِ تلگرام روی Apps Script ممکنه گاهی کند باشه. اگه `/start` جواب نداد، `Log` رو ببین. نسخه‌یِ polling فعلاً ساخته نشده.
- شیتِ `Sent` با گذشتِ زمان بزرگ می‌شه. ردیف‌هایِ قدیمی‌تر از ~۳ ماه رو می‌شه پاک کرد.
- توکنِ Trello فقط خواندن داره. اگه بعداً دکمه‌یِ «انجام شد» بخواهیم، باید دسترسیِ نوشتن بدیم.
- تاریخ‌ها با منطقه‌یِ ثابتِ تهران (+۳:۳۰) نشون داده می‌شن (ایران ساعتِ تابستانی نداره).

## تست‌هایِ محلی
```
npm test
```
