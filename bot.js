// mojevpnRobot — full source port from TypeScript to JavaScript
import { Telegraf } from "telegraf";
import pkg from "pg";
import http from "http";

const { Pool } = pkg;
const ADMIN = "Mojeao";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DB_URL = process.env.DATABASE_URL;
const PORT = parseInt(process.env.PORT || "3000", 10);
const WHOST = process.env.WEBHOOK_DOMAIN || "telegram-bot-production-a76c.up.railway.app";
const WPATH = "/tg";
const WEBHOOK_URL = "https://" + WHOST + WPATH;

if (!TOKEN) throw new Error("No TELEGRAM_BOT_TOKEN");
if (!DB_URL) throw new Error("No DATABASE_URL");

// ── Premium emoji IDs (Feb 9 2026 Telegram Bot API) ──────────────────────────
const E = {
  getConfig:    "5251203410396458957",
  myConfigs:    "5391032818111363540",
  myAccount:    "5438496463044752972",
  subReferrals: "5197350061012436657",
  back:         "5422439311196834318",
  gift:         "5470177992950946662",
  star:         "5188217332748527444",
  coin:         "4958689671950369798",
  check:        "5377730836244211104",
  arrow:        "5307905813451397794",
  joy:          "5447410659077661506",
};
function tge(id, fb) { return '<tg-emoji emoji-id="' + id + '">' + fb + '</tg-emoji>'; }
function h(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── HTTP server (starts FIRST so Railway health check passes) ────────────────
const bot = new Telegraf(TOKEN);
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") { res.writeHead(200); res.end("ok"); return; }
  if (req.method === "POST" && req.url === WPATH) {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try { bot.handleUpdate(JSON.parse(body)).catch(e => console.error("Update err:", e.message)); } catch {}
      res.writeHead(200); res.end("ok");
    });
    return;
  }
  res.writeHead(404); res.end("not found");
});
server.listen(PORT, () => console.log("HTTP server on port " + PORT));

// ── PostgreSQL ────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: DB_URL, ssl: false });
async function q(sql, p = []) {
  const c = await pool.connect();
  try { return await c.query(sql, p); } finally { c.release(); }
}

async function initDB(n = 0) {
  try {
    await q(`CREATE TABLE IF NOT EXISTS bot_users (id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL, username TEXT, first_name TEXT NOT NULL,
      last_name TEXT, coins INTEGER NOT NULL DEFAULT 0, referrer_telegram_id BIGINT,
      is_banned BOOLEAN NOT NULL DEFAULT false, joined_at TIMESTAMP NOT NULL DEFAULT NOW())`);
    await q(`CREATE TABLE IF NOT EXISTS config_pool (id SERIAL PRIMARY KEY,
      config_link TEXT NOT NULL, package_size_mb INTEGER NOT NULL, cost_coins INTEGER NOT NULL,
      is_used BOOLEAN NOT NULL DEFAULT false, added_by TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW())`);
    await q(`CREATE TABLE IF NOT EXISTS user_configs (id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL, config_link TEXT NOT NULL, package_size_mb INTEGER NOT NULL,
      coins_spent INTEGER NOT NULL, received_at TIMESTAMP NOT NULL DEFAULT NOW())`);
    await q(`CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    console.log("DB ready");
  } catch(e) {
    if (n < 30) { console.log("DB retry " + (n+1) + "/30: " + e.message); await sleep(3000); return initDB(n+1); }
    throw e;
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  welcomeText: tge(E.star,"⭐") + " سلام {name} عزیز!\n\nبه پیشرفته\u200cترین پلتفرم اینترنت بدون محدودیت خوش آمدی.\n\nبا دعوت دوستانت " + tge(E.gift,"🎁") + " کانفیگ رایگان دریافت کن!\n\nاز منوی زیر شروع کن:\n" + tge(E.arrow,"👇"),
  welcomeTextRef: tge(E.joy,"🎉") + " سلام {name} عزیز!\n\nشما از طریق لینک دعوت وارد شدید.\n" + tge(E.coin,"🪙") + " یک سکه به حساب دوستتان افزوده شد!\n\nاز منوی زیر اقدام کنید:\n" + tge(E.arrow,"👇"),
  coinPerReferral: 1,
  maintenanceMode: false,
  mandatoryChannels: [{id:"@lnterFreedom",link:"https://t.me/lnterFreedom",name:"lnterFreedom"}],
  buttons: {
    getConfig: {label:"دریافت کانفیگ",style:"success"},
    myConfigs: {label:"کانفیگ\u200cهای من",style:"primary"},
    account:   {label:"حساب کاربری من",style:"primary"},
    referrals: {label:"زیرمجموعه\u200cها",style:"primary"},
  },
  pkg1000Label: "دریافت بسته 1000 مگابایت — 5 سکه",
  pkg2000Label: "دریافت بسته 2000 مگابایت — 10 سکه",
  pkg5000Label: "دریافت بسته 5000 مگابایت — 20 سکه",
  pkg1000Cost: 5, pkg2000Cost: 10, pkg5000Cost: 20,
};
let cached = null;
async function loadSettings() {
  const r = await q("SELECT key,value FROM bot_settings");
  const m = {};
  for (const row of r.rows) m[row.key] = row.value;
  cached = {
    welcomeText:      m.welcome_text      || DEFAULTS.welcomeText,
    welcomeTextRef:   m.welcome_text_ref  || DEFAULTS.welcomeTextRef,
    coinPerReferral:  parseInt(m.coin_per_referral || "1", 10),
    maintenanceMode:  m.maintenance_mode === "true",
    mandatoryChannels: m.mandatory_channels ? JSON.parse(m.mandatory_channels) : DEFAULTS.mandatoryChannels,
    buttons: {
      getConfig: {label: m.btn_getconfig_label || DEFAULTS.buttons.getConfig.label, style: m.btn_getconfig_style || DEFAULTS.buttons.getConfig.style},
      myConfigs: {label: m.btn_myconfigs_label || DEFAULTS.buttons.myConfigs.label, style: m.btn_myconfigs_style || DEFAULTS.buttons.myConfigs.style},
      account:   {label: m.btn_account_label   || DEFAULTS.buttons.account.label,   style: m.btn_account_style   || DEFAULTS.buttons.account.style},
      referrals: {label: m.btn_referrals_label || DEFAULTS.buttons.referrals.label, style: m.btn_referrals_style || DEFAULTS.buttons.referrals.style},
    },
    pkg1000Label: m.pkg1000_label || DEFAULTS.pkg1000Label,
    pkg2000Label: m.pkg2000_label || DEFAULTS.pkg2000Label,
    pkg5000Label: m.pkg5000_label || DEFAULTS.pkg5000Label,
    pkg1000Cost: parseInt(m.pkg1000_cost || "5",  10),
    pkg2000Cost: parseInt(m.pkg2000_cost || "10", 10),
    pkg5000Cost: parseInt(m.pkg5000_cost || "20", 10),
  };
  return cached;
}
function getSettings() { return cached || DEFAULTS; }
async function updateSetting(key, val) {
  await q("INSERT INTO bot_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2", [key, val]);
  cached = null;
}
async function refreshSettings() { cached = null; await loadSettings(); }

// ── DB helpers ───────────────────────────────────────────────────────────────
async function getUser(tid) {
  const r = await q("SELECT * FROM bot_users WHERE telegram_id=$1 LIMIT 1", [tid]);
  return r.rows[0] || null;
}
async function getOrCreateUser(tid, firstName, username, lastName, refId) {
  const ex = await getUser(tid);
  if (ex) return ex;
  const r = await q("INSERT INTO bot_users(telegram_id,first_name,username,last_name,coins,is_banned,referrer_telegram_id) VALUES($1,$2,$3,$4,0,false,$5) RETURNING *",
    [tid, firstName, username||null, lastName||null, refId||null]);
  if (refId && refId !== tid) {
    const s = getSettings();
    await q("UPDATE bot_users SET coins=coins+$1 WHERE telegram_id=$2", [s.coinPerReferral, refId]);
  }
  return r.rows[0];
}
async function getReferralCount(tid) { return +((await q("SELECT COUNT(*) c FROM bot_users WHERE referrer_telegram_id=$1",[tid])).rows[0].c); }
async function getUserConfigs(tid) { return (await q("SELECT * FROM user_configs WHERE telegram_id=$1 ORDER BY id DESC",[tid])).rows; }
async function getUserConfigCount(tid) { return +((await q("SELECT COUNT(*) c FROM user_configs WHERE telegram_id=$1",[tid])).rows[0].c); }
async function countAvail(mb) { return +((await q("SELECT COUNT(*) c FROM config_pool WHERE is_used=false AND package_size_mb=$1",[mb])).rows[0].c); }
async function getAvailConfig(mb, cost) { return (await q("SELECT * FROM config_pool WHERE is_used=false AND package_size_mb=$1 AND cost_coins=$2 LIMIT 1",[mb,cost])).rows[0]||null; }
async function giveConfig(tid, cid, link, mb, cost) {
  await q("UPDATE config_pool SET is_used=true WHERE id=$1",[cid]);
  await q("UPDATE bot_users SET coins=coins-$1 WHERE telegram_id=$2",[cost,tid]);
  await q("INSERT INTO user_configs(telegram_id,config_link,package_size_mb,coins_spent) VALUES($1,$2,$3,$4)",[tid,link,mb,cost]);
}
async function giveConfigManual(tid, cid, link, mb, cost) {
  await q("UPDATE config_pool SET is_used=true WHERE id=$1",[cid]);
  await q("INSERT INTO user_configs(telegram_id,config_link,package_size_mb,coins_spent) VALUES($1,$2,$3,$4)",[tid,link,mb,cost]);
}
async function addConfigToPool(link, mb, cost, by) { await q("INSERT INTO config_pool(config_link,package_size_mb,cost_coins,is_used,added_by) VALUES($1,$2,$3,false,$4)",[link,mb,cost,by]); }
async function getTotalStats() {
  const [u,c,p] = await Promise.all([
    q("SELECT COUNT(*) c FROM bot_users"),
    q("SELECT COUNT(*) c FROM user_configs"),
    q("SELECT COUNT(*) c FROM config_pool WHERE is_used=false"),
  ]);
  return {totalUsers:+u.rows[0].c, totalConfigsGiven:+c.rows[0].c, availableInPool:+p.rows[0].c};
}
async function getRecentUsers(n) { return (await q("SELECT * FROM bot_users ORDER BY joined_at DESC LIMIT $1",[n])).rows; }
async function getTopReferrers(n) { return (await q("SELECT referrer_telegram_id telegram_id, COUNT(*) cnt FROM bot_users WHERE referrer_telegram_id IS NOT NULL GROUP BY referrer_telegram_id ORDER BY cnt DESC LIMIT $1",[n])).rows; }
async function getRichestUsers(n) { return (await q("SELECT * FROM bot_users ORDER BY coins DESC LIMIT $1",[n])).rows; }
async function getMostServiceUsers(n) { return (await q("SELECT telegram_id, COUNT(*) cnt FROM user_configs GROUP BY telegram_id ORDER BY cnt DESC LIMIT $1",[n])).rows; }
async function getAllUsers(n) { return (await q("SELECT * FROM bot_users ORDER BY id ASC LIMIT $1",[n])).rows; }
async function searchUser(query) {
  const id = parseInt(query, 10);
  if (!isNaN(id)) return (await q("SELECT * FROM bot_users WHERE telegram_id=$1 LIMIT 1",[id])).rows;
  return (await q("SELECT * FROM bot_users WHERE username=$1 LIMIT 1",[query.replace("@","")])).rows;
}
async function banUser(tid)   { await q("UPDATE bot_users SET is_banned=true  WHERE telegram_id=$1",[tid]); }
async function unbanUser(tid) { await q("UPDATE bot_users SET is_banned=false WHERE telegram_id=$1",[tid]); }
async function deleteUser(tid){ await q("DELETE FROM user_configs WHERE telegram_id=$1",[tid]); await q("DELETE FROM bot_users WHERE telegram_id=$1",[tid]); }
async function setCoins(tid,n)   { await q("UPDATE bot_users SET coins=$1 WHERE telegram_id=$2",[n,tid]); }
async function addCoins(tid,n)   { await q("UPDATE bot_users SET coins=coins+$1 WHERE telegram_id=$2",[n,tid]); }
async function resetCoins(tid)   { await q("UPDATE bot_users SET coins=0    WHERE telegram_id=$1",[tid]); }

// ── Keyboards ─────────────────────────────────────────────────────────────────
function mainMenuKb(s) {
  const btn = (label, emojiId, style) => ({text:label, icon_custom_emoji_id:emojiId, style});
  return {
    keyboard: [
      [btn(s.buttons.getConfig.label,  E.getConfig,    s.buttons.getConfig.style)],
      [btn(s.buttons.myConfigs.label,  E.myConfigs,    s.buttons.myConfigs.style),
       btn(s.buttons.account.label,    E.myAccount,    s.buttons.account.style)],
      [btn(s.buttons.referrals.label,  E.subReferrals, s.buttons.referrals.style)],
    ],
    resize_keyboard: true, persistent: true,
  };
}
function configKb(avail, s) {
  const row = (label, cb, hasStock) => [{ text: label + (hasStock?" ✅":" ❌"), callback_data: cb, style: hasStock?"success":"danger" }];
  return { inline_keyboard: [
    row(s.pkg1000Label, "pkg_1000", avail.p1000 > 0),
    row(s.pkg2000Label, "pkg_2000", avail.p2000 > 0),
    row(s.pkg5000Label, "pkg_5000", avail.p5000 > 0),
  ]};
}

// ── Admin panel ───────────────────────────────────────────────────────────────
const AMENU = { keyboard: [
  [{text:"📊 وضعیت ربات"},   {text:"🎰 آمار کامل"}],
  [{text:"🔎 آخرین کاربران"},{text:"🥇 برترین دعوت\u200cها"}],
  [{text:"📢 بیشترین سرویس"},{text:"💎 ثروتمندترین\u200cها"}],
  [{text:"📦 پیام به کاربر"},{text:"📣 پیام همگانی"}],
  [{text:"🔍 جستجوی کاربر"},{text:"🎉 اطلاعات کاربر"}],
  [{text:"⚠️ مسدود کردن"},  {text:"🚫 رفع مسدودی"}],
  [{text:"🎮 تنظیم سکه"},   {text:"🔗 افزودن سکه"}],
  [{text:"📆 سرویس دستی"},  {text:"🎰 ری\u200cست سکه"}],
  [{text:"🗑 حذف کاربر"},   {text:"🔴 متن خوش\u200cآمد"}],
  [{text:"🔔 کانال\u200cهای اجباری"},{text:"👝 تنظیمات سکه\u200cها"}],
  [{text:"🖊 مدیریت دکمه\u200cها"},{text:"✉️ ویرایش پیام\u200cها"}],
  [{text:"🟢 گزارش کامل"},  {text:"📒 مدیریت کانفیگ"}],
  [{text:"📊 آمار ماهانه"}, {text:"👥 همه کاربران"}],
  [{text:"🔧 حالت تعمیر"}],
  [{text:"🔙 بازگشت به منوی اصلی"}],
], resize_keyboard: true };
const ABTNS = new Set(AMENU.keyboard.flat().map(b=>b.text));
const CKB = { keyboard:[[{text:"❌ لغو"}]], resize_keyboard:true };
const states = new Map();
function ss(id,step,data={}) { states.set(id,{step,data}); }
function cs(id) { states.delete(id); }
function ask(ctx, text) { return ctx.replyWithHTML(text, {reply_markup:CKB}); }

const pendRefs = new Map();

// ── Admin button handler ──────────────────────────────────────────────────────
async function adminBtn(ctx, text, uid) {
  const s = getSettings();
  switch(text) {
    case "📊 وضعیت ربات": {
      const st=await getTotalStats();
      const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
      await ctx.replyWithHTML("<b>📊 وضعیت ربات</b>\n\n"+(s.maintenanceMode?"🔴 تعمیر":"🟢 فعال")+"\n\n👥 کاربران: <b>"+st.totalUsers+"</b>\n📦 کانفیگ داده شده: <b>"+st.totalConfigsGiven+"</b>\n\n<b>موجودی استخر:</b>\n• 1000MB: <b>"+a1+"</b>\n• 2000MB: <b>"+a2+"</b>\n• 5000MB: <b>"+a5+"</b>",{reply_markup:AMENU}); break;
    }
    case "🎰 آمار کامل": {
      const st=await getTotalStats();
      const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
      await ctx.replyWithHTML("<b>🎰 آمار کامل</b>\n\n👥 کل کاربران: <b>"+st.totalUsers+"</b>\n📦 کانفیگ داده شده: <b>"+st.totalConfigsGiven+"</b>\n\n<b>استخر:</b>\n🟢 1000MB: <b>"+a1+"</b>\n🟢 2000MB: <b>"+a2+"</b>\n🟢 5000MB: <b>"+a5+"</b>\n\n🔑 سکه دعوت: <b>"+s.coinPerReferral+"</b>",{reply_markup:AMENU}); break;
    }
    case "🔎 آخرین کاربران": {
      const us=await getRecentUsers(10);
      const lines=us.map((u,i)=>((i+1)+". <b>"+h(u.first_name)+"</b>"+(u.username?" (@"+u.username+")":"")+" — 🪙"+u.coins+" — <code>"+u.telegram_id+"</code>")).join("\n");
      await ctx.replyWithHTML("<b>🔎 آخرین 10 کاربر</b>\n\n"+(lines||"—"),{reply_markup:AMENU}); break;
    }
    case "🥇 برترین دعوت‌ها": {
      const top=await getTopReferrers(10);
      const lines=top.map((r,i)=>((i+1)+". <code>"+r.telegram_id+"</code> — <b>"+r.cnt+"</b> دعوت")).join("\n");
      await ctx.replyWithHTML("<b>🥇 برترین دعوت\u200cکنندگان</b>\n\n"+(lines||"—"),{reply_markup:AMENU}); break;
    }
    case "📢 بیشترین سرویس": {
      const top=await getMostServiceUsers(10);
      const lines=top.map((r,i)=>((i+1)+". <code>"+r.telegram_id+"</code> — <b>"+r.cnt+"</b> کانفیگ")).join("\n");
      await ctx.replyWithHTML("<b>📢 بیشترین سرویس</b>\n\n"+(lines||"—"),{reply_markup:AMENU}); break;
    }
    case "💎 ثروتمندترین‌ها": {
      const top=await getRichestUsers(10);
      const lines=top.map((u,i)=>((i+1)+". <b>"+h(u.first_name)+"</b> — 🪙 <b>"+u.coins+"</b> — <code>"+u.telegram_id+"</code>")).join("\n");
      await ctx.replyWithHTML("<b>💎 بیشترین سکه</b>\n\n"+(lines||"—"),{reply_markup:AMENU}); break;
    }
    case "📦 پیام به کاربر": ss(uid,"msg_user_id"); await ask(ctx,"🆔 آیدی تلگرام کاربر:"); break;
    case "📣 پیام همگانی": ss(uid,"broadcast_text"); await ask(ctx,"📣 متن پیام (HTML پشتیبانی می\u200cشود):"); break;
    case "🔍 جستجوی کاربر": ss(uid,"search_query"); await ask(ctx,"🔍 آیدی یا @یوزرنیم:"); break;
    case "🎉 اطلاعات کاربر": ss(uid,"user_info"); await ask(ctx,"🆔 آیدی یا @یوزرنیم:"); break;
    case "⚠️ مسدود کردن": ss(uid,"ban_id"); await ask(ctx,"🆔 آیدی کاربر:"); break;
    case "🚫 رفع مسدودی": ss(uid,"unban_id"); await ask(ctx,"🆔 آیدی کاربر:"); break;
    case "🎮 تنظیم سکه": ss(uid,"coin_set_id"); await ask(ctx,"🆔 آیدی کاربر (سکه روی مقدار مشخص تنظیم می\u200cشود):"); break;
    case "🔗 افزودن سکه": ss(uid,"coin_add_id"); await ask(ctx,"🆔 آیدی کاربر (عدد منفی برای کم کردن):"); break;
    case "📆 سرویس دستی": ss(uid,"service_id"); await ask(ctx,"🆔 آیدی کاربر برای کانفیگ دستی:"); break;
    case "🎰 ری‌ست سکه": ss(uid,"coin_reset_id"); await ask(ctx,"🆔 آیدی کاربر (سکه صفر می\u200cشود):"); break;
    case "🗑 حذف کاربر": ss(uid,"delete_id"); await ask(ctx,"⚠️ آیدی کاربر برای <b>حذف کامل</b>:\n(این عمل قابل بازگشت نیست!)"); break;
    case "🔴 متن خوش‌آمد": ss(uid,"welcome_text"); await ask(ctx,"✉️ متن جدید خوش\u200cآمد (از {name} برای نام):\n\nمتن فعلی:\n<code>"+h(s.welcomeText)+"</code>"); break;
    case "🔔 کانال‌های اجباری": {
      const chs=s.mandatoryChannels;
      const list=chs.map((c,i)=>((i+1)+". "+h(c.id)+" — <a href=\""+c.link+"\">"+h(c.name)+"</a>")).join("\n");
      ss(uid,"channel_action");
      await ctx.replyWithHTML("<b>🔔 کانال\u200cهای اجباری</b>\n\n"+(list||"هیچ کانالی تنظیم نشده")+"\n\nبرای افزودن:\n<code>add @channelid https://t.me/channelid نام</code>\n\nبرای حذف:\n<code>remove @channelid</code>",{reply_markup:CKB}); break;
    }
    case "👝 تنظیمات سکه‌ها": {
      ss(uid,"coin_per_ref");
      await ask(ctx,"💰 <b>تنظیمات سکه</b>\n\nسکه دعوت فعلی: <b>"+s.coinPerReferral+"</b>\nهزینه 1000MB: <b>"+s.pkg1000Cost+"</b>\nهزینه 2000MB: <b>"+s.pkg2000Cost+"</b>\nهزینه 5000MB: <b>"+s.pkg5000Cost+"</b>\n\nعدد جدید سکه دعوت:");
      break;
    }
    case "🖊 مدیریت دکمه‌ها": {
      const btns=s.buttons;
      const list=[
        "1. دریافت کانفیگ → <b>"+h(btns.getConfig.label)+"</b> ["+btns.getConfig.style+"]",
        "2. کانفیگ\u200cهای من → <b>"+h(btns.myConfigs.label)+"</b> ["+btns.myConfigs.style+"]",
        "3. حساب کاربری → <b>"+h(btns.account.label)+"</b> ["+btns.account.style+"]",
        "4. زیرمجموعه\u200cها → <b>"+h(btns.referrals.label)+"</b> ["+btns.referrals.style+"]",
        "5. پکیج 1000MB → <b>"+h(s.pkg1000Label)+"</b>",
        "6. پکیج 2000MB → <b>"+h(s.pkg2000Label)+"</b>",
        "7. پکیج 5000MB → <b>"+h(s.pkg5000Label)+"</b>",
      ].join("\n");
      ss(uid,"btn_select");
      await ctx.replyWithHTML("<b>🖊 مدیریت دکمه\u200cها</b>\n\n"+list+"\n\nشماره دکمه (1-7):",{reply_markup:CKB}); break;
    }
    case "✉️ ویرایش پیام‌ها": {
      ss(uid,"welcome_text_ref");
      await ask(ctx,"✉️ <b>متن خوش\u200cآمد معرفی\u200cشده</b>\nاز {name} استفاده کنید.\n\nفعلی:\n<code>"+h(s.welcomeTextRef)+"</code>"); break;
    }
    case "🟢 گزارش کامل": {
      const st=await getTotalStats();
      const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
      const last=await getRecentUsers(5);
      const lastList=last.map(u=>"• "+h(u.first_name)+" — 🪙"+u.coins).join("\n");
      await ctx.replyWithHTML("<b>🟢 گزارش کامل</b>\n\n👥 کاربران: <b>"+st.totalUsers+"</b>\n📦 کانفیگ: <b>"+st.totalConfigsGiven+"</b>\n\n<b>استخر:</b> 1000: "+a1+" | 2000: "+a2+" | 5000: "+a5+"\n\n<b>آخرین کاربران:</b>\n"+lastList,{reply_markup:AMENU}); break;
    }
    case "📒 مدیریت کانفیگ": {
      ss(uid,"channel_action");
      await ctx.replyWithHTML("<b>📒 افزودن کانفیگ به استخر</b>\n\nفرمت:\n<code>add vless://... 1000 5</code>\n\nیعنی: add [لینک] [حجم_MB] [هزینه_سکه]",{reply_markup:CKB}); break;
    }
    case "📊 آمار ماهانه": {
      const st=await getTotalStats();
      const now=new Date();
      await ctx.replyWithHTML("<b>📊 آمار ماهانه</b>\n<i>"+now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"</i>\n\n👥 کل کاربران: <b>"+st.totalUsers+"</b>\n📦 کل کانفیگ: <b>"+st.totalConfigsGiven+"</b>",{reply_markup:AMENU}); break;
    }
    case "👥 همه کاربران": {
      const us=await getAllUsers(50);
      const lines=us.slice(0,30).map((u,i)=>((i+1)+". <code>"+u.telegram_id+"</code> <b>"+h(u.first_name)+"</b> 🪙"+u.coins+(u.is_banned?" 🚫":""))).join("\n");
      await ctx.replyWithHTML("<b>👥 کاربران ("+us.length+" نفر)</b>\n\n"+lines,{reply_markup:AMENU}); break;
    }
    case "🔧 حالت تعمیر": {
      const nv=!s.maintenanceMode; await updateSetting("maintenance_mode",String(nv)); await refreshSettings();
      await ctx.replyWithHTML("<b>🔧 حالت تعمیر</b>\n\nوضعیت: "+(nv?"🔴 فعال شد":"🟢 غیرفعال شد"),{reply_markup:AMENU}); break;
    }
    case "🔙 بازگشت به منوی اصلی": cs(uid); break;
  }
}

// ── Admin step handler ────────────────────────────────────────────────────────
async function adminStep(ctx, text, st, uid) {
  const tg = ctx.telegram;
  switch(st.step) {
    case "search_query": {
      const res=await searchUser(text); cs(uid);
      if(!res.length){await ctx.replyWithHTML("کاربری یافت نشد.",{reply_markup:AMENU});return;}
      const u=res[0];
      await ctx.replyWithHTML("🔍 <b>"+h(u.first_name)+(u.last_name?" "+h(u.last_name):"")+"</b>\n🆔 <code>"+u.telegram_id+"</code>\n📱 "+(u.username?"@"+u.username:"—")+"\n🪙 "+u.coins+"\n"+(u.is_banned?"🚫 مسدود":"✅ فعال"),{reply_markup:AMENU}); break;
    }
    case "user_info": {
      const res=await searchUser(text); cs(uid);
      if(!res.length){await ctx.replyWithHTML("کاربری یافت نشد.",{reply_markup:AMENU});return;}
      const u=res[0];
      const d=new Date(u.joined_at);
      await ctx.replyWithHTML("🎉 <b>اطلاعات کاربر</b>\n\n👤 "+h(u.first_name)+(u.last_name?" "+h(u.last_name):"")+"\n🆔 <code>"+u.telegram_id+"</code>\n📱 "+(u.username?"@"+u.username:"—")+"\n🪙 سکه: <b>"+u.coins+"</b>\n"+(u.is_banned?"🚫 مسدود":"✅ فعال")+"\n📅 عضویت: "+d.toLocaleDateString("fa-IR"),{reply_markup:AMENU}); break;
    }
    case "ban_id": { const id=parseInt(text,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} await banUser(id); cs(uid); await ctx.replyWithHTML("✅ کاربر <code>"+id+"</code> مسدود شد.",{reply_markup:AMENU}); break; }
    case "unban_id": { const id=parseInt(text,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} await unbanUser(id); cs(uid); await ctx.replyWithHTML("✅ مسدودی <code>"+id+"</code> رفع شد.",{reply_markup:AMENU}); break; }
    case "delete_id": { const id=parseInt(text,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} await deleteUser(id); cs(uid); await ctx.replyWithHTML("✅ کاربر <code>"+id+"</code> حذف شد.",{reply_markup:AMENU}); break; }
    case "coin_set_id": { const id=parseInt(text,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} ss(uid,"coin_set_amount",{id}); await ask(ctx,"مقدار سکه جدید برای <code>"+id+"</code>:"); break; }
    case "coin_set_amount": { const n=parseInt(text,10); if(isNaN(n)){await ctx.reply("عدد نامعتبر");return;} await setCoins(st.data.id,n); cs(uid); await ctx.replyWithHTML("✅ سکه <code>"+st.data.id+"</code> → <b>"+n+"</b>",{reply_markup:AMENU}); break; }
    case "coin_add_id": { const id=parseInt(text,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} ss(uid,"coin_add_amount",{id}); await ask(ctx,"مقدار سکه برای <code>"+id+"</code> (منفی برای کم):"); break; }
    case "coin_add_amount": { const n=parseInt(text,10); if(isNaN(n)){await ctx.reply("عدد نامعتبر");return;} await addCoins(st.data.id,n); cs(uid); await ctx.replyWithHTML("✅ "+(n>=0?"+":"")+n+" سکه برای <code>"+st.data.id+"</code>",{reply_markup:AMENU}); break; }
    case "coin_reset_id": { const id=parseInt(text,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} await resetCoins(id); cs(uid); await ctx.replyWithHTML("✅ سکه <code>"+id+"</code> صفر شد.",{reply_markup:AMENU}); break; }
    case "msg_user_id": { const id=parseInt(text,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} ss(uid,"msg_user_text",{id}); await ask(ctx,"✏️ متن پیام برای <code>"+id+"</code>:"); break; }
    case "msg_user_text": { try{await tg.sendMessage(st.data.id,text,{parse_mode:"HTML"});cs(uid);await ctx.replyWithHTML("✅ پیام ارسال شد.",{reply_markup:AMENU});}catch{cs(uid);await ctx.replyWithHTML("❌ ارسال ناموفق (بلاک شده؟)",{reply_markup:AMENU});} break; }
    case "broadcast_text": {
      const users=await getAllUsers(100000); cs(uid);
      await ctx.replyWithHTML("📣 ارسال به <b>"+users.length+"</b> کاربر...",{reply_markup:AMENU});
      let sent=0,failed=0;
      for(const u of users){try{await tg.sendMessage(u.telegram_id,text,{parse_mode:"HTML"});sent++;}catch{failed++;}await sleep(50);}
      try{await tg.sendMessage(uid,"✅ موفق: "+sent+" | ناموفق: "+failed);}catch{} break;
    }
    case "service_id": { const id=parseInt(text,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} ss(uid,"service_size",{id}); await ask(ctx,"حجم پکیج:\n<b>1</b> — 1000MB\n<b>2</b> — 2000MB\n<b>3</b> — 5000MB"); break; }
    case "service_size": {
      const sm={1:{mb:1000,cost:getSettings().pkg1000Cost},2:{mb:2000,cost:getSettings().pkg2000Cost},3:{mb:5000,cost:getSettings().pkg5000Cost}};
      const ch=sm[parseInt(text.trim())]; if(!ch){await ctx.reply("1، 2 یا 3");return;}
      const av=await getAvailConfig(ch.mb,ch.cost); cs(uid);
      if(!av){await ctx.replyWithHTML("❌ کانفیگ "+ch.mb+"MB موجود نیست.",{reply_markup:AMENU});return;}
      await giveConfigManual(st.data.id,av.id,av.config_link,ch.mb,ch.cost);
      try{await tg.sendMessage(st.data.id,"🎁 کانفیگ دستی توسط ادمین!\n\n📦 "+ch.mb+"MB\n\n🌐 کانفیگ:\n<code>"+av.config_link+"</code>",{parse_mode:"HTML"});}catch{}
      await ctx.replyWithHTML("✅ کانفیگ "+ch.mb+"MB به <code>"+st.data.id+"</code> داده شد.",{reply_markup:AMENU}); break;
    }
    case "welcome_text": { await updateSetting("welcome_text",text); await refreshSettings(); cs(uid); await ctx.replyWithHTML("✅ متن خوش\u200cآمد ذخیره شد.",{reply_markup:AMENU}); break; }
    case "welcome_text_ref": { await updateSetting("welcome_text_ref",text); await refreshSettings(); cs(uid); await ctx.replyWithHTML("✅ متن ذخیره شد.",{reply_markup:AMENU}); break; }
    case "channel_action": {
      const s2=getSettings(); const channels=[...s2.mandatoryChannels]; const lower=text.trim().toLowerCase();
      if(lower.startsWith("add ")) {
        const parts=text.trim().split(/\s+/);
        if(parts[0].toLowerCase()==="add" && parts[1] && (parts[1].startsWith("vless://") || parts[1].startsWith("vmess://") || parts[1].startsWith("ss://"))) {
          // Config pool add: add <link> <mb> <cost>
          const link2=parts[1], mb2=parseInt(parts[2]||"1000",10), cost2=parseInt(parts[3]||"5",10);
          await addConfigToPool(link2,mb2,cost2,"admin-bot"); cs(uid);
          await ctx.replyWithHTML("✅ کانفیگ "+mb2+"MB اضافه شد.",{reply_markup:AMENU}); return;
        }
        if(parts.length<4){await ctx.reply("فرمت نادرست.\nمثال: add @mychannel https://t.me/mychannel نام");return;}
        const cid=parts[1], link=parts[2], name=parts.slice(3).join(" ");
        channels.push({id:cid,link,name}); await updateSetting("mandatory_channels",JSON.stringify(channels)); await refreshSettings(); cs(uid);
        await ctx.replyWithHTML("✅ کانال <b>"+h(cid)+"</b> اضافه شد.",{reply_markup:AMENU});
      } else if(lower.startsWith("remove ")) {
        const cid=text.trim().split(/\s+/)[1];
        const filtered=channels.filter(c=>c.id!==cid); await updateSetting("mandatory_channels",JSON.stringify(filtered)); await refreshSettings(); cs(uid);
        await ctx.replyWithHTML("✅ کانال <b>"+h(cid)+"</b> حذف شد.",{reply_markup:AMENU});
      } else { await ctx.reply("از add یا remove استفاده کنید."); }
      break;
    }
    case "coin_per_ref": {
      const n=parseInt(text,10); if(isNaN(n)||n<0){await ctx.reply("عدد نامعتبر");return;}
      await updateSetting("coin_per_referral",String(n)); await refreshSettings(); cs(uid);
      await ctx.replyWithHTML("✅ سکه دعوت → <b>"+n+"</b>",{reply_markup:AMENU}); break;
    }
    case "btn_select": {
      const n=parseInt(text,10); if(n<1||n>7||isNaN(n)){await ctx.reply("شماره 1 تا 7");return;}
      ss(uid,"btn_label",{btn:n}); const s2=getSettings();
      const cur={1:s2.buttons.getConfig.label,2:s2.buttons.myConfigs.label,3:s2.buttons.account.label,4:s2.buttons.referrals.label,5:s2.pkg1000Label,6:s2.pkg2000Label,7:s2.pkg5000Label};
      await ask(ctx,"متن جدید دکمه "+n+":\n(فعلی: <b>"+h(cur[n]||"")+"</b>)"); break;
    }
    case "btn_label": {
      const n=st.data.btn; ss(uid,"btn_style",{btn:n,label:text});
      if(n<=4){await ask(ctx,"استایل:\n<b>success</b> = سبز\n<b>primary</b> = آبی\n<b>danger</b> = قرمز");}
      else{await saveBtnLabel(n,text,"primary"); await refreshSettings(); cs(uid); await ctx.replyWithHTML("✅ متن دکمه ذخیره شد.",{reply_markup:AMENU});}
      break;
    }
    case "btn_style": {
      const style=["success","primary","danger"].includes(text)?text:"primary";
      await saveBtnLabel(st.data.btn,st.data.label,style); await refreshSettings(); cs(uid);
      await ctx.replyWithHTML("✅ دکمه ذخیره شد.",{reply_markup:AMENU}); break;
    }
    default: cs(uid);
  }
}

async function saveBtnLabel(n, label, style) {
  const km={1:["btn_getconfig_label","btn_getconfig_style"],2:["btn_myconfigs_label","btn_myconfigs_style"],
    3:["btn_account_label","btn_account_style"],4:["btn_referrals_label","btn_referrals_style"],
    5:["pkg1000_label",""],6:["pkg2000_label",""],7:["pkg5000_label",""]};
  const keys=km[n]; if(!keys) return;
  await updateSetting(keys[0],label);
  if(keys[1]) await updateSetting(keys[1],style);
}

// ── Membership check ─────────────────────────────────────────────────────────
async function isMember(uid) {
  const s = getSettings();
  if (!s.mandatoryChannels.length) return true;
  for (const ch of s.mandatoryChannels) {
    try { const m=await bot.telegram.getChatMember(ch.id,uid); if(!["member","administrator","creator"].includes(m.status)) return false; }
    catch { return false; }
  }
  return true;
}
async function sendJoinMsg(ctx) {
  const s = getSettings();
  const list = s.mandatoryChannels.map(c => tge(E.myConfigs,"📣") + " کانال: <b><a href=\""+c.link+"\">@"+h(c.name)+"</a></b>").join("\n");
  await ctx.replyWithHTML(
    tge(E.star,"⭐") + " <b>برای استفاده از ربات باید در کانال\u200cهای زیر عضو باشید:</b>\n\n" + list + "\n\nپس از عضویت دکمه ✅ <b>تایید عضویت</b> را بزنید.",
    { reply_markup: { inline_keyboard: [
        ...s.mandatoryChannels.map(c => [{text:"عضویت در "+c.name, url:c.link}]),
        [{text:"✅ تایید عضویت", callback_data:"verify_join"}],
      ]}}
  );
}
async function completeWelcome(ctx, isNew) {
  const s = getSettings(); const tid = ctx.from.id;
  let refId;
  if (isNew) { const p=pendRefs.get(tid); if(p&&p.exp>Date.now()){refId=p.ref;pendRefs.delete(tid);} }
  await getOrCreateUser(tid, ctx.from.first_name, ctx.from.username, ctx.from.last_name, isNew?refId:undefined);
  if (isNew && refId) {
    try { await bot.telegram.sendMessage(refId, tge(E.joy,"🎉")+" <b>مژده!</b>\nکاربر <b>"+h(ctx.from.first_name)+"</b> از لینک دعوت وارد شد.\n"+tge(E.coin,"🪙")+" <b>"+s.coinPerReferral+" سکه</b> به حسابتان اضافه شد!",{parse_mode:"HTML"}); } catch {}
  }
  const txt = ((isNew&&refId)?s.welcomeTextRef:s.welcomeText).replace("{name}",h(ctx.from.first_name));
  await ctx.replyWithHTML(txt, {reply_markup: mainMenuKb(s)});
}

// ── Bot handlers ─────────────────────────────────────────────────────────────
bot.start(async ctx => {
  if(ctx.chat?.type!=="private"){
    const bi=await ctx.telegram.getMe();
    await ctx.reply("لطفاً در پیام خصوصی با ربات صحبت کنید.",{reply_markup:{inline_keyboard:[[{text:"شروع در پیوی 💬",url:"https://t.me/"+bi.username}]]}});
    return;
  }
  const s=getSettings();
  if(s.maintenanceMode&&ctx.from.username!==ADMIN){await ctx.reply("🔧 ربات در حال تعمیر است.");return;}
  const sp=ctx.startPayload; let refId;
  if(sp?.startsWith("ref_")){const n=parseInt(sp.slice(4),10);if(!isNaN(n)&&n!==ctx.from.id)refId=n;}
  const ex=await getUser(ctx.from.id);
  if(!ex&&refId) pendRefs.set(ctx.from.id,{ref:refId,exp:Date.now()+3600000});
  if(!(await isMember(ctx.from.id))){await sendJoinMsg(ctx);return;}
  await completeWelcome(ctx,!ex);
});

bot.action("verify_join",async ctx=>{
  if(!(await isMember(ctx.from.id))){await ctx.answerCbQuery("هنوز عضو نشدی! اول عضو شو سپس دکمه را بزن.",{show_alert:true});return;}
  await ctx.answerCbQuery("عضویت تأیید شد!");
  await ctx.deleteMessage().catch(()=>{});
  const ex=await getUser(ctx.from.id);
  await completeWelcome(ctx,!ex);
});

bot.command("admin",async ctx=>{
  if(ctx.from.username!==ADMIN){await ctx.reply("دسترسی غیرمجاز.");return;}
  const st=await getTotalStats();
  await ctx.replyWithHTML("<b>🔴 پنل مدیریت</b>\n\n👥 کاربران: <b>"+st.totalUsers+"</b>\n📦 کانفیگ: <b>"+st.totalConfigsGiven+"</b>\n📥 موجود: <b>"+st.availableInPool+"</b>",{reply_markup:AMENU});
});

bot.on("text",async ctx=>{
  if(ctx.chat?.type!=="private") return;
  const text=ctx.message.text; const uid=ctx.from.id;
  const isAdmin=ctx.from.username===ADMIN;
  if(isAdmin){
    if(text==="❌ لغو"){cs(uid);await ctx.replyWithHTML("لغو شد.",{reply_markup:AMENU});return;}
    if(text==="🔙 بازگشت به منوی اصلی"){cs(uid);const s=getSettings();await ctx.replyWithHTML("منوی اصلی",{reply_markup:mainMenuKb(s)});return;}
    if(ABTNS.has(text)){await adminBtn(ctx,text,uid);return;}
    const st=states.get(uid); if(st){await adminStep(ctx,text,st,uid);return;}
  }
  const s=getSettings();
  if(s.maintenanceMode&&!isAdmin){await ctx.reply("🔧 ربات در حال تعمیر است.");return;}
  if(!(await isMember(uid))){await sendJoinMsg(ctx);return;}
  const user=await getUser(uid);
  if(!user){await ctx.reply("برای شروع /start را بزنید.");return;}
  if(user.is_banned){await ctx.reply("حساب شما مسدود شده است.");return;}

  if(text===s.buttons.getConfig.label){
    const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
    await ctx.replyWithHTML(tge(E.getConfig,"📦")+" <b>دریافت کانفیگ</b>\n\nسکه فعلی: "+tge(E.coin,"🪙")+" <b>"+user.coins+" سکه</b>\n\n"+tge(E.check,"✅")+" سبز = موجود  "+tge(E.back,"❌")+" قرمز = ناموجود\n\nپکیج را انتخاب کنید:",{reply_markup:configKb({p1000:a1,p2000:a2,p5000:a5},s)}); return;
  }
  if(text===s.buttons.myConfigs.label){
    const cfgs=await getUserConfigs(uid);
    if(!cfgs.length){await ctx.replyWithHTML(tge(E.myConfigs,"📋")+" هنوز کانفیگی دریافت نکرده\u200cاید.\n\nاز «"+h(s.buttons.getConfig.label)+"» اقدام کنید.",{reply_markup:mainMenuKb(s)});return;}
    const lt=cfgs[0]; const d2=new Date(lt.received_at);
    const dd=d2.getFullYear()+"-"+String(d2.getMonth()+1).padStart(2,"0")+"-"+String(d2.getDate()).padStart(2,"0");
    const tt=String(d2.getHours()).padStart(2,"0")+":"+String(d2.getMinutes()).padStart(2,"0");
    await ctx.replyWithHTML(tge(E.myConfigs,"📋")+" <b>آخرین کانفیگ</b>\n\n"+tge(E.getConfig,"📦")+" حجم: <b>"+lt.package_size_mb+" مگابایت</b>\n🗓 تاریخ: <b>"+dd+" — "+tt+"</b>\n\n"+tge(E.myConfigs,"🌐")+" لینک:\n<code>"+h(lt.config_link)+"</code>\n\n━━━━━━━━━━━━━━━━━━━━\n"+tge(E.arrow,"👇")+" مجموع: <b>"+cfgs.length+" عدد</b>",{reply_markup:{inline_keyboard:[[{text:"بازگشت به منو",callback_data:"back_menu"}]]}}); return;
  }
  if(text===s.buttons.account.label){
    const [rc,cc]=await Promise.all([getReferralCount(uid),getUserConfigCount(uid)]);
    await ctx.replyWithHTML(tge(E.myAccount,"👤")+" <b>حساب کاربری</b>\n\n━━━━━━━━━━━━━━━━━━━━\n"+tge(E.myAccount,"🪪")+" نام: <b>"+h(user.first_name)+"</b>\n"+tge(E.myAccount,"🆔")+" آیدی: <b>"+user.telegram_id+"</b>\n━━━━━━━━━━━━━━━━━━━━\n"+tge(E.coin,"🪙")+" موجودی: <b>"+user.coins+" سکه</b>\n"+tge(E.subReferrals,"👥")+" دعوت\u200cشدگان: <b>"+rc+" نفر</b>\n"+tge(E.getConfig,"📦")+" کانفیگ: <b>"+cc+" عدد</b>\n━━━━━━━━━━━━━━━━━━━━\n\n"+tge(E.gift,"🎁")+" با دعوت دوستان سکه بیشتری کسب کنید!",{reply_markup:mainMenuKb(s)}); return;
  }
  if(text===s.buttons.referrals.label){
    const [bi,rc]=await Promise.all([ctx.telegram.getMe(),getReferralCount(uid)]);
    const rl="https://t.me/"+bi.username+"?start=ref_"+uid;
    await ctx.replyWithHTML(tge(E.subReferrals,"👥")+" <b>سیستم دعوت و کسب سکه</b>\n\n"+tge(E.gift,"🎁")+" به ازای هر دوست: <b>"+s.coinPerReferral+" سکه</b>\n\n"+tge(E.coin,"🪙")+" دعوت\u200cهای شما: <b>"+rc+" نفر</b>\n\n━━━━━━━━━━━━━━━━━━━━\n"+tge(E.arrow,"👇")+" لینک اختصاصی:\n<code>"+h(rl)+"</code>\n━━━━━━━━━━━━━━━━━━━━",{reply_markup:mainMenuKb(s)}); return;
  }
  await ctx.replyWithHTML("از منوی زیر انتخاب کنید:",{reply_markup:mainMenuKb(s)});
});

for (const [cb,mb] of [["pkg_1000",1000],["pkg_2000",2000],["pkg_5000",5000]]) {
  bot.action(cb, async ctx => {
    const s=getSettings();
    const cost=mb===1000?s.pkg1000Cost:mb===2000?s.pkg2000Cost:s.pkg5000Cost;
    const user=await getUser(ctx.from.id);
    if(!user){await ctx.answerCbQuery("ابتدا /start بزنید.",{show_alert:true});return;}
    if(user.is_banned){await ctx.answerCbQuery("حساب مسدود شده.",{show_alert:true});return;}
    if(user.coins<cost){await ctx.answerCbQuery("موجودی ناکافی! "+user.coins+" سکه دارید ولی "+cost+" نیاز است.",{show_alert:true});return;}
    const av=await getAvailConfig(mb,cost);
    if(!av){await ctx.answerCbQuery("موجودی "+mb+"MB تمام شده.",{show_alert:true});return;}
    await giveConfig(ctx.from.id,av.id,av.config_link,mb,cost);
    await ctx.answerCbQuery("کانفیگ دریافت شد!");
    const [uu,avail]=await Promise.all([getUser(ctx.from.id),Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]).then(([a1,a2,a5])=>({p1000:a1,p2000:a2,p5000:a5}))]);
    await ctx.replyWithHTML(tge(E.check,"✅")+" <b>دریافت موفق!</b>\n\n"+tge(E.getConfig,"📦")+" حجم: <b>"+mb+" مگابایت</b>\n"+tge(E.coin,"🪙")+" کسر: <b>"+cost+"</b> | باقی: <b>"+(uu?.coins||0)+"</b>\n\n"+tge(E.myConfigs,"🌐")+" کانفیگ:\n<code>"+h(av.config_link)+"</code>\n\nدر «"+h(s.buttons.myConfigs.label)+"» ذخیره شد.",{reply_markup:configKb(avail,s)});
  });
}

bot.action("back_menu",async ctx=>{
  await ctx.answerCbQuery();
  const s=getSettings();
  await ctx.replyWithHTML("منوی اصلی",{reply_markup:mainMenuKb(s)});
});

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await initDB();
  await loadSettings();
  await bot.telegram.setWebhook(WEBHOOK_URL);
  console.log("✅ mojevpnRobot webhook:", WEBHOOK_URL);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
process.once("SIGINT", () => server.close());
process.once("SIGTERM", () => server.close());