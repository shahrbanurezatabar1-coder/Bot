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

// ── All premium emoji IDs from source file (keyboards.ts) ────────────────────
const E = {
  getConfig:    "5251203410396458957", // 📦
  myConfigs:    "5391032818111363540", // 📋
  myAccount:    "5438496463044752972", // 👤
  subReferrals: "5197350061012436657", // 👥
  back:         "5422439311196834318", // ❌
  gift:         "5470177992950946662", // 🎁
  star:         "5188217332748527444", // ⭐
  coin:         "4958689671950369798", // 🪙
  check:        "5377730836244211104", // ✅
  arrow:        "5307905813451397794", // 👇
  joy:          "5447410659077661506", // 🎉
};
// tge wraps any emoji as a Telegram premium custom emoji
function tge(id, fb) { return '<tg-emoji emoji-id="' + id + '">' + fb + '</tg-emoji>'; }
// shortcuts
const ePkg  = () => tge(E.getConfig,    "📦");
const eConf = () => tge(E.myConfigs,    "📋");
const eAcc  = () => tge(E.myAccount,    "👤");
const eRef  = () => tge(E.subReferrals, "👥");
const eBack = () => tge(E.back,         "❌");
const eGift = () => tge(E.gift,         "🎁");
const eStar = () => tge(E.star,         "⭐");
const eCoin = () => tge(E.coin,         "🪙");
const eOk   = () => tge(E.check,        "✅");
const eArr  = () => tge(E.arrow,        "👇");
const eJoy  = () => tge(E.joy,          "🎉");

function h(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── HTTP server (starts first — Railway health check) ────────────────────────
const bot = new Telegraf(TOKEN);
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") { res.writeHead(200); res.end("ok"); return; }
  if (req.method === "POST" && req.url === WPATH) {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try { bot.handleUpdate(JSON.parse(body)).catch(e => console.error("upd err:", e.message)); } catch {}
      res.writeHead(200); res.end("ok");
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(PORT, () => console.log("HTTP server on port " + PORT));

// ── PostgreSQL ────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: DB_URL, ssl: false });
async function q(sql, p = []) { const c = await pool.connect(); try { return await c.query(sql, p); } finally { c.release(); } }
async function initDB(n = 0) {
  try {
    await q("CREATE TABLE IF NOT EXISTS bot_users (id SERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE NOT NULL, username TEXT, first_name TEXT NOT NULL, last_name TEXT, coins INTEGER NOT NULL DEFAULT 0, referrer_telegram_id BIGINT, is_banned BOOLEAN NOT NULL DEFAULT false, joined_at TIMESTAMP NOT NULL DEFAULT NOW())");
    await q("CREATE TABLE IF NOT EXISTS config_pool (id SERIAL PRIMARY KEY, config_link TEXT NOT NULL, package_size_mb INTEGER NOT NULL, cost_coins INTEGER NOT NULL, is_used BOOLEAN NOT NULL DEFAULT false, added_by TEXT, created_at TIMESTAMP NOT NULL DEFAULT NOW())");
    await q("CREATE TABLE IF NOT EXISTS user_configs (id SERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL, config_link TEXT NOT NULL, package_size_mb INTEGER NOT NULL, coins_spent INTEGER NOT NULL, received_at TIMESTAMP NOT NULL DEFAULT NOW())");
    await q("CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    console.log("DB ready");
  } catch(e) {
    if (n < 30) { console.log("DB retry " + (n+1) + ": " + e.message); await sleep(3000); return initDB(n+1); }
    throw e;
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────
const DEFAULTS = {
  welcomeText: eStar()+" سلام {name} عزیز!\n\nبه پیشرفته\u200cترین پلتفرم اینترنت بدون محدودیت خوش آمدی.\n\nبا دعوت دوستانت "+eGift()+" کانفیگ رایگان دریافت کن!\n\nاز منوی زیر شروع کن:\n"+eArr(),
  welcomeTextRef: eJoy()+" سلام {name} عزیز!\n\nاز طریق لینک دعوت وارد شدی.\n"+eCoin()+" یک سکه به حساب دوستت اضافه شد!\n\nاز منوی زیر اقدام کن:\n"+eArr(),
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
  const m = {};
  for (const r of (await q("SELECT key,value FROM bot_settings")).rows) m[r.key] = r.value;
  cached = {
    welcomeText:    m.welcome_text      || DEFAULTS.welcomeText,
    welcomeTextRef: m.welcome_text_ref  || DEFAULTS.welcomeTextRef,
    coinPerReferral: parseInt(m.coin_per_referral||"1",10),
    maintenanceMode: m.maintenance_mode==="true",
    mandatoryChannels: m.mandatory_channels ? JSON.parse(m.mandatory_channels) : DEFAULTS.mandatoryChannels,
    buttons: {
      getConfig: {label:m.btn_getconfig_label||DEFAULTS.buttons.getConfig.label, style:m.btn_getconfig_style||DEFAULTS.buttons.getConfig.style},
      myConfigs: {label:m.btn_myconfigs_label||DEFAULTS.buttons.myConfigs.label, style:m.btn_myconfigs_style||DEFAULTS.buttons.myConfigs.style},
      account:   {label:m.btn_account_label  ||DEFAULTS.buttons.account.label,   style:m.btn_account_style  ||DEFAULTS.buttons.account.style},
      referrals: {label:m.btn_referrals_label||DEFAULTS.buttons.referrals.label, style:m.btn_referrals_style||DEFAULTS.buttons.referrals.style},
    },
    pkg1000Label: m.pkg1000_label||DEFAULTS.pkg1000Label,
    pkg2000Label: m.pkg2000_label||DEFAULTS.pkg2000Label,
    pkg5000Label: m.pkg5000_label||DEFAULTS.pkg5000Label,
    pkg1000Cost: parseInt(m.pkg1000_cost||"5",10),
    pkg2000Cost: parseInt(m.pkg2000_cost||"10",10),
    pkg5000Cost: parseInt(m.pkg5000_cost||"20",10),
  };
  return cached;
}
const gs = () => cached || DEFAULTS;
async function us(key, val) { await q("INSERT INTO bot_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2",[key,val]); cached=null; }
async function rf() { cached=null; await loadSettings(); }

// ── DB ───────────────────────────────────────────────────────────────────────
const dbu = tid => q("SELECT * FROM bot_users WHERE telegram_id=$1 LIMIT 1",[tid]).then(r=>r.rows[0]||null);
async function newUser(tid, fn, un, ln, rid) {
  const r = await q("INSERT INTO bot_users(telegram_id,first_name,username,last_name,coins,is_banned,referrer_telegram_id) VALUES($1,$2,$3,$4,0,false,$5) RETURNING *",[tid,fn,un||null,ln||null,rid||null]);
  if (rid && rid!==tid) { const s=gs(); await q("UPDATE bot_users SET coins=coins+$1 WHERE telegram_id=$2",[s.coinPerReferral,rid]); }
  return r.rows[0];
}
async function getOrCreate(tid, fn, un, ln, rid) { const e=await dbu(tid); return e||await newUser(tid,fn,un,ln,rid); }
const refs   = tid => q("SELECT COUNT(*) c FROM bot_users WHERE referrer_telegram_id=$1",[tid]).then(r=>+r.rows[0].c);
const uConfs = tid => q("SELECT * FROM user_configs WHERE telegram_id=$1 ORDER BY id DESC",[tid]).then(r=>r.rows);
const uCnt   = tid => q("SELECT COUNT(*) c FROM user_configs WHERE telegram_id=$1",[tid]).then(r=>+r.rows[0].c);
const avail  = mb  => q("SELECT COUNT(*) c FROM config_pool WHERE is_used=false AND package_size_mb=$1",[mb]).then(r=>+r.rows[0].c);
const getAv  = (mb,cost) => q("SELECT * FROM config_pool WHERE is_used=false AND package_size_mb=$1 AND cost_coins=$2 LIMIT 1",[mb,cost]).then(r=>r.rows[0]||null);
async function giveC(tid,cid,lnk,mb,cost) {
  await q("UPDATE config_pool SET is_used=true WHERE id=$1",[cid]);
  await q("UPDATE bot_users SET coins=coins-$1 WHERE telegram_id=$2",[cost,tid]);
  await q("INSERT INTO user_configs(telegram_id,config_link,package_size_mb,coins_spent) VALUES($1,$2,$3,$4)",[tid,lnk,mb,cost]);
}
async function giveCM(tid,cid,lnk,mb,cost) {
  await q("UPDATE config_pool SET is_used=true WHERE id=$1",[cid]);
  await q("INSERT INTO user_configs(telegram_id,config_link,package_size_mb,coins_spent) VALUES($1,$2,$3,$4)",[tid,lnk,mb,cost]);
}
const addPool  = (lnk,mb,cost,by)  => q("INSERT INTO config_pool(config_link,package_size_mb,cost_coins,is_used,added_by) VALUES($1,$2,$3,false,$4)",[lnk,mb,cost,by]);
async function stats() { const [u,c,p]=await Promise.all([q("SELECT COUNT(*) c FROM bot_users"),q("SELECT COUNT(*) c FROM user_configs"),q("SELECT COUNT(*) c FROM config_pool WHERE is_used=false")]); return {u:+u.rows[0].c,c:+c.rows[0].c,p:+p.rows[0].c}; }
const recU = n => q("SELECT * FROM bot_users ORDER BY joined_at DESC LIMIT $1",[n]).then(r=>r.rows);
const topR = n => q("SELECT referrer_telegram_id t,COUNT(*) cnt FROM bot_users WHERE referrer_telegram_id IS NOT NULL GROUP BY referrer_telegram_id ORDER BY cnt DESC LIMIT $1",[n]).then(r=>r.rows);
const richU= n => q("SELECT * FROM bot_users ORDER BY coins DESC LIMIT $1",[n]).then(r=>r.rows);
const svcU = n => q("SELECT telegram_id t,COUNT(*) cnt FROM user_configs GROUP BY telegram_id ORDER BY cnt DESC LIMIT $1",[n]).then(r=>r.rows);
const allU = n => q("SELECT * FROM bot_users ORDER BY id ASC LIMIT $1",[n]).then(r=>r.rows);
async function srch(txt) { const id=parseInt(txt,10); if(!isNaN(id)) return q("SELECT * FROM bot_users WHERE telegram_id=$1 LIMIT 1",[id]).then(r=>r.rows); return q("SELECT * FROM bot_users WHERE username=$1 LIMIT 1",[txt.replace("@","")]).then(r=>r.rows); }
const ban   = tid => q("UPDATE bot_users SET is_banned=true  WHERE telegram_id=$1",[tid]);
const unban = tid => q("UPDATE bot_users SET is_banned=false WHERE telegram_id=$1",[tid]);
async function del(tid) { await q("DELETE FROM user_configs WHERE telegram_id=$1",[tid]); await q("DELETE FROM bot_users WHERE telegram_id=$1",[tid]); }
const setC  = (tid,n) => q("UPDATE bot_users SET coins=$1      WHERE telegram_id=$2",[n,tid]);
const addC  = (tid,n) => q("UPDATE bot_users SET coins=coins+$1 WHERE telegram_id=$2",[n,tid]);
const rstC  = tid     => q("UPDATE bot_users SET coins=0        WHERE telegram_id=$1",[tid]);

// ── Keyboards ─────────────────────────────────────────────────────────────────
function mainKb(s) {
  const b = (label, eid, style) => ({text:label, icon_custom_emoji_id:eid, style});
  return { keyboard:[
    [b(s.buttons.getConfig.label, E.getConfig, s.buttons.getConfig.style)],
    [b(s.buttons.myConfigs.label, E.myConfigs, s.buttons.myConfigs.style), b(s.buttons.account.label, E.myAccount, s.buttons.account.style)],
    [b(s.buttons.referrals.label, E.subReferrals, s.buttons.referrals.style)],
  ], resize_keyboard:true, persistent:true };
}
function cfgKb(av, s) {
  const row = (lbl, cb, ok) => [{text: lbl+(ok?" "+eOk():" "+eBack()), callback_data:cb, style:ok?"success":"danger"}];
  return { inline_keyboard: [
    row(s.pkg1000Label, "pkg_1000", av.p1000>0),
    row(s.pkg2000Label, "pkg_2000", av.p2000>0),
    row(s.pkg5000Label, "pkg_5000", av.p5000>0),
  ]};
}

// ── Admin panel ───────────────────────────────────────────────────────────────
const AM = { keyboard:[
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
], resize_keyboard:true };
const ABTNS = new Set(AM.keyboard.flat().map(b=>b.text));
const CKB = {keyboard:[[{text:"❌ لغو"}]],resize_keyboard:true};
const ST = new Map();
function ss(id,step,data={}) { ST.set(id,{step,data}); }
function cs(id) { ST.delete(id); }
function ask(ctx,t) { return ctx.replyWithHTML(t,{reply_markup:CKB}); }
const pendRefs = new Map();

// ── Admin button handler ──────────────────────────────────────────────────────
async function ab(ctx, txt, uid) {
  const s=gs();
  switch(txt) {
    case "📊 وضعیت ربات": {
      const st=await stats(); const [a1,a2,a5]=await Promise.all([avail(1000),avail(2000),avail(5000)]);
      await ctx.replyWithHTML(eAcc()+" <b>وضعیت ربات</b>\n\n"+(s.maintenanceMode?eBack()+" حالت تعمیر":eOk()+" ربات فعال")+"\n\n"+eRef()+" کاربران: <b>"+st.u+"</b>\n"+ePkg()+" کانفیگ: <b>"+st.c+"</b>\n\n"+ePkg()+" استخر:\n"+eOk()+" 1000MB: <b>"+a1+"</b>\n"+eOk()+" 2000MB: <b>"+a2+"</b>\n"+eOk()+" 5000MB: <b>"+a5+"</b>",{reply_markup:AM}); break;
    }
    case "🎰 آمار کامل": {
      const st=await stats(); const [a1,a2,a5]=await Promise.all([avail(1000),avail(2000),avail(5000)]);
      await ctx.replyWithHTML(eAcc()+" <b>آمار کامل</b>\n\n"+eRef()+" کل کاربران: <b>"+st.u+"</b>\n"+ePkg()+" کانفیگ داده شده: <b>"+st.c+"</b>\n\n"+ePkg()+" استخر:\n"+eOk()+" 1000MB: <b>"+a1+"</b>\n"+eOk()+" 2000MB: <b>"+a2+"</b>\n"+eOk()+" 5000MB: <b>"+a5+"</b>\n\n"+eCoin()+" سکه دعوت: <b>"+s.coinPerReferral+"</b>",{reply_markup:AM}); break;
    }
    case "🔎 آخرین کاربران": {
      const us=await recU(10);
      const lines=us.map((u,i)=>((i+1)+". <b>"+h(u.first_name)+"</b>"+(u.username?" (@"+u.username+")":"")+" — "+eCoin()+u.coins+" — <code>"+u.telegram_id+"</code>")).join("\n");
      await ctx.replyWithHTML(eRef()+" <b>آخرین 10 کاربر</b>\n\n"+(lines||"—"),{reply_markup:AM}); break;
    }
    case "🥇 برترین دعوت‌ها": {
      const top=await topR(10);
      const lines=top.map((r,i)=>((i+1)+". <code>"+r.t+"</code> — <b>"+r.cnt+"</b> دعوت")).join("\n");
      await ctx.replyWithHTML(eRef()+" <b>برترین دعوت\u200cکنندگان</b>\n\n"+(lines||"—"),{reply_markup:AM}); break;
    }
    case "📢 بیشترین سرویس": {
      const top=await svcU(10);
      const lines=top.map((r,i)=>((i+1)+". <code>"+r.t+"</code> — <b>"+r.cnt+"</b> کانفیگ")).join("\n");
      await ctx.replyWithHTML(ePkg()+" <b>بیشترین سرویس</b>\n\n"+(lines||"—"),{reply_markup:AM}); break;
    }
    case "💎 ثروتمندترین‌ها": {
      const top=await richU(10);
      const lines=top.map((u,i)=>((i+1)+". <b>"+h(u.first_name)+"</b> — "+eCoin()+" <b>"+u.coins+"</b> — <code>"+u.telegram_id+"</code>")).join("\n");
      await ctx.replyWithHTML(eStar()+" <b>بیشترین سکه</b>\n\n"+(lines||"—"),{reply_markup:AM}); break;
    }
    case "📦 پیام به کاربر":  ss(uid,"msg_uid");   await ask(ctx,ePkg()+" آیدی تلگرام کاربر:"); break;
    case "📣 پیام همگانی":    ss(uid,"broadcast");  await ask(ctx,eArr()+" متن پیام (HTML پشتیبانی می\u200cشود):"); break;
    case "🔍 جستجوی کاربر":  ss(uid,"search");     await ask(ctx,eAcc()+" آیدی یا @یوزرنیم:"); break;
    case "🎉 اطلاعات کاربر": ss(uid,"info");       await ask(ctx,eAcc()+" آیدی یا @یوزرنیم:"); break;
    case "⚠️ مسدود کردن":    ss(uid,"ban");        await ask(ctx,eBack()+" آیدی کاربر:"); break;
    case "🚫 رفع مسدودی":    ss(uid,"unban");      await ask(ctx,eOk()+" آیدی کاربر:"); break;
    case "🎮 تنظیم سکه":     ss(uid,"cset_id");    await ask(ctx,eCoin()+" آیدی کاربر (سکه روی مقدار مشخص):"); break;
    case "🔗 افزودن سکه":    ss(uid,"cadd_id");    await ask(ctx,eCoin()+" آیدی کاربر (منفی برای کم کردن):"); break;
    case "📆 سرویس دستی":    ss(uid,"svc_uid");    await ask(ctx,ePkg()+" آیدی کاربر برای کانفیگ دستی:"); break;
    case "🎰 ری‌ست سکه": ss(uid,"crst");      await ask(ctx,eCoin()+" آیدی کاربر (سکه صفر می\u200cشود):"); break;
    case "🗑 حذف کاربر":     ss(uid,"del");        await ask(ctx,eBack()+" آیدی کاربر برای <b>حذف کامل</b>:\n(قابل بازگشت نیست!)"); break;
    case "🔴 متن خوش‌آمد": ss(uid,"welc_txt"); await ask(ctx,eArr()+" متن جدید خوش\u200cآمد (از {name} برای نام):\n\nفعلی:\n<code>"+h(s.welcomeText)+"</code>"); break;
    case "🔔 کانال‌های اجباری": {
      const chs=s.mandatoryChannels;
      const list=chs.map((c,i)=>((i+1)+". <code>"+h(c.id)+"</code> — <a href=\""+c.link+"\">"+h(c.name)+"</a>")).join("\n");
      ss(uid,"ch_act");
      // Simplified: just send @channelid to auto-lock
      await ctx.replyWithHTML(
        eRef()+" <b>کانال\u200cهای اجباری</b>\n\n"+(list||"هیچ کانالی تنظیم نشده")+"\n\n━━━━━━━━━━━━━━━━━━━━\n"+
        eOk()+" برای <b>افزودن</b> فقط آیدی کانال بفرست:\n<code>@yourchannel</code>\n\n"+
        eBack()+" برای <b>حذف</b>: <code>remove @yourchannel</code>\n\n"+
        eArr()+" ربات باید ادمین کانال باشد.",
        {reply_markup:CKB}
      ); break;
    }
    case "👝 تنظیمات سکه‌ها": {
      ss(uid,"cpref");
      await ask(ctx,eCoin()+" <b>تنظیمات سکه</b>\n\nسکه دعوت: <b>"+s.coinPerReferral+"</b>\n1000MB: <b>"+s.pkg1000Cost+"</b>\n2000MB: <b>"+s.pkg2000Cost+"</b>\n5000MB: <b>"+s.pkg5000Cost+"</b>\n\nعدد جدید سکه دعوت:"); break;
    }
    case "🖊 مدیریت دکمه‌ها": {
      const list=["1. دریافت کانفیگ → <b>"+h(s.buttons.getConfig.label)+"</b> ["+s.buttons.getConfig.style+"]","2. کانفیگ\u200cهای من → <b>"+h(s.buttons.myConfigs.label)+"</b> ["+s.buttons.myConfigs.style+"]","3. حساب کاربری → <b>"+h(s.buttons.account.label)+"</b> ["+s.buttons.account.style+"]","4. زیرمجموعه\u200cها → <b>"+h(s.buttons.referrals.label)+"</b> ["+s.buttons.referrals.style+"]","5. پکیج 1000MB → <b>"+h(s.pkg1000Label)+"</b>","6. پکیج 2000MB → <b>"+h(s.pkg2000Label)+"</b>","7. پکیج 5000MB → <b>"+h(s.pkg5000Label)+"</b>"].join("\n");
      ss(uid,"btn_sel"); await ctx.replyWithHTML(eArr()+" <b>مدیریت دکمه\u200cها</b>\n\n"+list+"\n\nشماره دکمه (1-7):",{reply_markup:CKB}); break;
    }
    case "✉️ ویرایش پیام‌ها": {
      ss(uid,"welc_ref"); await ask(ctx,eArr()+" <b>متن خوش\u200cآمد معرفی\u200cشده</b>\nاز {name} استفاده کن.\n\nفعلی:\n<code>"+h(s.welcomeTextRef)+"</code>"); break;
    }
    case "🟢 گزارش کامل": {
      const st=await stats(); const [a1,a2,a5]=await Promise.all([avail(1000),avail(2000),avail(5000)]); const last=await recU(5);
      const ll=last.map(u=>eAcc()+" "+h(u.first_name)+" — "+eCoin()+u.coins).join("\n");
      await ctx.replyWithHTML(eOk()+" <b>گزارش کامل</b>\n\n"+eRef()+" کاربران: <b>"+st.u+"</b>\n"+ePkg()+" کانفیگ: <b>"+st.c+"</b>\n\n"+ePkg()+" استخر: 1000→"+a1+" | 2000→"+a2+" | 5000→"+a5+"\n\n"+eRef()+" آخرین کاربران:\n"+ll,{reply_markup:AM}); break;
    }
    case "📒 مدیریت کانفیگ": {
      ss(uid,"ch_act");
      await ctx.replyWithHTML(ePkg()+" <b>افزودن کانفیگ به استخر</b>\n\nفرمت:\n<code>add vless://... 1000 5</code>\n\nیعنی: add [لینک] [حجم_MB] [هزینه_سکه]",{reply_markup:CKB}); break;
    }
    case "📊 آمار ماهانه": {
      const st=await stats(); const now=new Date();
      await ctx.replyWithHTML(eAcc()+" <b>آمار ماهانه</b>\n<i>"+now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"</i>\n\n"+eRef()+" کل کاربران: <b>"+st.u+"</b>\n"+ePkg()+" کل کانفیگ: <b>"+st.c+"</b>",{reply_markup:AM}); break;
    }
    case "👥 همه کاربران": {
      const us=await allU(50);
      const lines=us.slice(0,30).map((u,i)=>((i+1)+". <code>"+u.telegram_id+"</code> <b>"+h(u.first_name)+"</b> "+eCoin()+u.coins+(u.is_banned?" "+eBack():""))).join("\n");
      await ctx.replyWithHTML(eRef()+" <b>کاربران ("+us.length+" نفر)</b>\n\n"+lines,{reply_markup:AM}); break;
    }
    case "🔧 حالت تعمیر": {
      const nv=!s.maintenanceMode; await us("maintenance_mode",String(nv)); await rf();
      await ctx.replyWithHTML(ePkg()+" <b>حالت تعمیر</b>\n\nوضعیت: "+(nv?eBack()+" فعال شد":eOk()+" غیرفعال شد"),{reply_markup:AM}); break;
    }
    case "🔙 بازگشت به منوی اصلی": cs(uid); break;
  }
}

// ── Admin step handler ────────────────────────────────────────────────────────
async function as(ctx, txt, st, uid) {
  const tg = ctx.telegram;
  switch(st.step) {
    case "search": { const r=await srch(txt); cs(uid); if(!r.length){await ctx.replyWithHTML(eBack()+" کاربری یافت نشد.",{reply_markup:AM});return;} const u=r[0]; await ctx.replyWithHTML(eAcc()+" <b>"+h(u.first_name)+(u.last_name?" "+h(u.last_name):"")+"</b>\n"+eAcc()+" آیدی: <code>"+u.telegram_id+"</code>\n"+eRef()+" یوزر: "+(u.username?"@"+u.username:"—")+"\n"+eCoin()+" سکه: <b>"+u.coins+"</b>\n"+(u.is_banned?eBack()+" مسدود":eOk()+" فعال"),{reply_markup:AM}); break; }
    case "info": { const r=await srch(txt); cs(uid); if(!r.length){await ctx.replyWithHTML(eBack()+" کاربری یافت نشد.",{reply_markup:AM});return;} const u=r[0]; const d=new Date(u.joined_at); await ctx.replyWithHTML(eJoy()+" <b>اطلاعات کاربر</b>\n\n"+eAcc()+" "+h(u.first_name)+(u.last_name?" "+h(u.last_name):"")+"\n"+eAcc()+" آیدی: <code>"+u.telegram_id+"</code>\n"+eRef()+" یوزر: "+(u.username?"@"+u.username:"—")+"\n"+eCoin()+" سکه: <b>"+u.coins+"</b>\n"+(u.is_banned?eBack()+" مسدود":eOk()+" فعال"),{reply_markup:AM}); break; }
    case "ban":   { const id=parseInt(txt,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} await ban(id);   cs(uid); await ctx.replyWithHTML(eOk()+" کاربر <code>"+id+"</code> مسدود شد.",{reply_markup:AM}); break; }
    case "unban": { const id=parseInt(txt,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} await unban(id); cs(uid); await ctx.replyWithHTML(eOk()+" مسدودی <code>"+id+"</code> رفع شد.",{reply_markup:AM}); break; }
    case "del":   { const id=parseInt(txt,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} await del(id);   cs(uid); await ctx.replyWithHTML(eOk()+" کاربر <code>"+id+"</code> حذف شد.",{reply_markup:AM}); break; }
    case "cset_id": { const id=parseInt(txt,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} ss(uid,"cset_amt",{id}); await ask(ctx,eCoin()+" مقدار سکه جدید برای <code>"+id+"</code>:"); break; }
    case "cset_amt": { const n=parseInt(txt,10); if(isNaN(n)){await ctx.reply("عدد نامعتبر");return;} await setC(st.data.id,n); cs(uid); await ctx.replyWithHTML(eOk()+" سکه <code>"+st.data.id+"</code> → <b>"+n+"</b>",{reply_markup:AM}); break; }
    case "cadd_id": { const id=parseInt(txt,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} ss(uid,"cadd_amt",{id}); await ask(ctx,eCoin()+" مقدار (منفی برای کم کردن) برای <code>"+id+"</code>:"); break; }
    case "cadd_amt": { const n=parseInt(txt,10); if(isNaN(n)){await ctx.reply("عدد نامعتبر");return;} await addC(st.data.id,n); cs(uid); await ctx.replyWithHTML(eOk()+" "+(n>=0?"+":"")+n+" "+eCoin()+" برای <code>"+st.data.id+"</code>",{reply_markup:AM}); break; }
    case "crst": { const id=parseInt(txt,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} await rstC(id); cs(uid); await ctx.replyWithHTML(eOk()+" سکه <code>"+id+"</code> صفر شد.",{reply_markup:AM}); break; }
    case "msg_uid": { const id=parseInt(txt,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} ss(uid,"msg_txt",{id}); await ask(ctx,eArr()+" متن پیام برای <code>"+id+"</code>:"); break; }
    case "msg_txt": { try{await tg.sendMessage(st.data.id,txt,{parse_mode:"HTML"});cs(uid);await ctx.replyWithHTML(eOk()+" پیام ارسال شد.",{reply_markup:AM});}catch{cs(uid);await ctx.replyWithHTML(eBack()+" ارسال ناموفق (بلاک شده؟)",{reply_markup:AM});} break; }
    case "broadcast": {
      const us=await allU(100000); cs(uid);
      await ctx.replyWithHTML(eRef()+" ارسال به <b>"+us.length+"</b> کاربر...",{reply_markup:AM});
      let sent=0,failed=0;
      for(const u of us){try{await tg.sendMessage(u.telegram_id,txt,{parse_mode:"HTML"});sent++;}catch{failed++;}await sleep(50);}
      try{await tg.sendMessage(uid,eOk()+" موفق: "+sent+" | "+eBack()+" ناموفق: "+failed,{parse_mode:"HTML"});}catch{} break;
    }
    case "svc_uid": { const id=parseInt(txt,10); if(isNaN(id)){await ctx.reply("آیدی نامعتبر");return;} ss(uid,"svc_sz",{id}); await ask(ctx,ePkg()+" حجم:\n<b>1</b> — 1000MB\n<b>2</b> — 2000MB\n<b>3</b> — 5000MB"); break; }
    case "svc_sz": {
      const s2=gs(); const sm={1:{mb:1000,cost:s2.pkg1000Cost},2:{mb:2000,cost:s2.pkg2000Cost},3:{mb:5000,cost:s2.pkg5000Cost}};
      const ch=sm[parseInt(txt.trim())]; if(!ch){await ctx.reply("1، 2 یا 3");return;}
      const av=await getAv(ch.mb,ch.cost); cs(uid);
      if(!av){await ctx.replyWithHTML(eBack()+" کانفیگ "+ch.mb+"MB موجود نیست.",{reply_markup:AM});return;}
      await giveCM(st.data.id,av.id,av.config_link,ch.mb,ch.cost);
      try{await tg.sendMessage(st.data.id,eGift()+" کانفیگ دستی از ادمین!\n\n"+ePkg()+" "+ch.mb+"MB\n\n"+eConf()+" لینک:\n<code>"+av.config_link+"</code>",{parse_mode:"HTML"});}catch{}
      await ctx.replyWithHTML(eOk()+" کانفیگ "+ch.mb+"MB به <code>"+st.data.id+"</code> داده شد.",{reply_markup:AM}); break;
    }
    case "welc_txt": { await us("welcome_text",txt); await rf(); cs(uid); await ctx.replyWithHTML(eOk()+" متن خوش\u200cآمد ذخیره شد.",{reply_markup:AM}); break; }
    case "welc_ref": { await us("welcome_text_ref",txt); await rf(); cs(uid); await ctx.replyWithHTML(eOk()+" متن ذخیره شد.",{reply_markup:AM}); break; }

    // ── Channel management (simplified) ─────────────────────────────────────
    case "ch_act": {
      const s2=gs(); const channels=[...s2.mandatoryChannels]; const lower=txt.trim().toLowerCase();
      // Check if it is a VPN config add
      if (lower.startsWith("add ") && (txt.includes("vless://") || txt.includes("vmess://") || txt.includes("ss://"))) {
        const parts=txt.trim().split(/\s+/); const lnk=parts[1], mb=parseInt(parts[2]||"1000",10), cost=parseInt(parts[3]||"5",10);
        await addPool(lnk,mb,cost,"admin-bot"); cs(uid);
        await ctx.replyWithHTML(eOk()+" کانفیگ "+mb+"MB اضافه شد.",{reply_markup:AM}); return;
      }
      // Full manual format: add @id https://link name
      if (lower.startsWith("add ")) {
        const parts=txt.trim().split(/\s+/);
        if(parts.length>=4){ const cid=parts[1],lnk=parts[2],name=parts.slice(3).join(" "); channels.push({id:cid,link:lnk,name}); await us("mandatory_channels",JSON.stringify(channels)); await rf(); cs(uid); await ctx.replyWithHTML(eOk()+" کانال <b>"+h(cid)+"</b> اضافه شد.",{reply_markup:AM}); return; }
        await ctx.reply("فرمت: add @id https://t.me/id نام"); return;
      }
      // SIMPLIFIED: just @channelid → auto-fetch title & link
      if (txt.trim().startsWith("@") && !txt.includes(" ")) {
        const cid = txt.trim();
        try {
          const chat = await bot.telegram.getChat(cid);
          const name = chat.title || cid.slice(1);
          const lnk  = chat.username ? "https://t.me/"+chat.username : (chat.invite_link || "#");
          channels.push({id:cid, link:lnk, name});
          await us("mandatory_channels", JSON.stringify(channels)); await rf(); cs(uid);
          await ctx.replyWithHTML(eOk()+" "+eRef()+" کانال <b>"+h(name)+"</b> اضافه و قفل شد!\n"+eArr()+" کاربران باید عضو شوند تا سکه بگیرند.",{reply_markup:AM});
        } catch(e) {
          await ctx.replyWithHTML(eBack()+" کانال یافت نشد. ربات باید ادمین کانال باشد.\nخطا: "+e.message);
        }
        return;
      }
      // Remove
      if (lower.startsWith("remove ")) {
        const cid=txt.trim().split(/\s+/)[1];
        const f=channels.filter(c=>c.id!==cid); await us("mandatory_channels",JSON.stringify(f)); await rf(); cs(uid);
        await ctx.replyWithHTML(eOk()+" کانال <b>"+h(cid)+"</b> حذف شد.",{reply_markup:AM}); return;
      }
      await ctx.replyWithHTML(eBack()+" فرمت نادرست. @channelid برای افزودن، remove @id برای حذف.",{reply_markup:CKB}); break;
    }

    case "cpref": {
      const n=parseInt(txt,10); if(isNaN(n)||n<0){await ctx.reply("عدد نامعتبر");return;}
      await us("coin_per_referral",String(n)); await rf(); cs(uid);
      await ctx.replyWithHTML(eOk()+" سکه دعوت → "+eCoin()+" <b>"+n+"</b>",{reply_markup:AM}); break;
    }
    case "btn_sel": {
      const n=parseInt(txt,10); if(n<1||n>7||isNaN(n)){await ctx.reply("شماره 1 تا 7");return;}
      ss(uid,"btn_lbl",{btn:n}); const s2=gs();
      const cur={1:s2.buttons.getConfig.label,2:s2.buttons.myConfigs.label,3:s2.buttons.account.label,4:s2.buttons.referrals.label,5:s2.pkg1000Label,6:s2.pkg2000Label,7:s2.pkg5000Label};
      await ask(ctx,eArr()+" متن جدید دکمه "+n+":\n(فعلی: <b>"+h(cur[n]||"")+"</b>)"); break;
    }
    case "btn_lbl": {
      const n=st.data.btn; ss(uid,"btn_sty",{btn:n,label:txt});
      if(n<=4){await ask(ctx,"استایل:\n<b>success</b>=سبز | <b>primary</b>=آبی | <b>danger</b>=قرمز");}
      else{await saveBL(n,txt,"primary");await rf();cs(uid);await ctx.replyWithHTML(eOk()+" دکمه ذخیره شد.",{reply_markup:AM});}
      break;
    }
    case "btn_sty": {
      const sty=["success","primary","danger"].includes(txt)?txt:"primary";
      await saveBL(st.data.btn,st.data.label,sty); await rf(); cs(uid);
      await ctx.replyWithHTML(eOk()+" دکمه ذخیره شد.",{reply_markup:AM}); break;
    }
    default: cs(uid);
  }
}
async function saveBL(n,lbl,sty) {
  const km={1:["btn_getconfig_label","btn_getconfig_style"],2:["btn_myconfigs_label","btn_myconfigs_style"],3:["btn_account_label","btn_account_style"],4:["btn_referrals_label","btn_referrals_style"],5:["pkg1000_label",""],6:["pkg2000_label",""],7:["pkg5000_label",""]};
  const k=km[n]; if(!k) return; await us(k[0],lbl); if(k[1]) await us(k[1],sty);
}

// ── Membership check ─────────────────────────────────────────────────────────
async function chkMem(uid) {
  const s=gs(); if(!s.mandatoryChannels.length) return true;
  for(const ch of s.mandatoryChannels){
    try{const m=await bot.telegram.getChatMember(ch.id,uid);if(!["member","administrator","creator"].includes(m.status))return false;}
    catch{return false;}
  }
  return true;
}
async function joinMsg(ctx) {
  const s=gs();
  const list=s.mandatoryChannels.map(c=>eRef()+" کانال: <b><a href=\""+c.link+"\">@"+h(c.name)+"</a></b>").join("\n");
  await ctx.replyWithHTML(
    eStar()+" <b>برای استفاده از ربات باید در کانال\u200cهای زیر عضو باشید:</b>\n\n"+list+"\n\nپس از عضویت دکمه "+eOk()+" <b>تایید عضویت</b> را بزنید.",
    {reply_markup:{inline_keyboard:[
      ...s.mandatoryChannels.map(c=>[{text:"عضویت در "+c.name,url:c.link}]),
      [{text:"✅ تایید عضویت",callback_data:"verify_join"}],
    ]}}
  );
}
async function welcome(ctx, isNew) {
  const s=gs(); const tid=ctx.from.id; let rid;
  if(isNew){const p=pendRefs.get(tid);if(p&&p.exp>Date.now()){rid=p.ref;pendRefs.delete(tid);}}
  await getOrCreate(tid,ctx.from.first_name,ctx.from.username,ctx.from.last_name,isNew?rid:undefined);
  if(isNew&&rid){try{await bot.telegram.sendMessage(rid,eJoy()+" <b>مژده!</b>\nکاربر <b>"+h(ctx.from.first_name)+"</b> از لینک دعوت وارد شد.\n"+eCoin()+" <b>"+s.coinPerReferral+" سکه</b> به حسابتان اضافه شد!",{parse_mode:"HTML"});}catch{}}
  const txt=((isNew&&rid)?s.welcomeTextRef:s.welcomeText).replace("{name}",h(ctx.from.first_name));
  await ctx.replyWithHTML(txt,{reply_markup:mainKb(s)});
}

// ── Bot handlers ─────────────────────────────────────────────────────────────
bot.start(async ctx=>{
  if(ctx.chat?.type!=="private"){const bi=await ctx.telegram.getMe();await ctx.reply("لطفاً در پیام خصوصی با ربات صحبت کنید.",{reply_markup:{inline_keyboard:[[{text:"شروع "+eArr(),url:"https://t.me/"+bi.username}]]}});return;}
  const s=gs();
  if(s.maintenanceMode&&ctx.from.username!==ADMIN){await ctx.replyWithHTML(eBack()+" ربات در حال تعمیر است.");return;}
  const sp=ctx.startPayload; let rid;
  if(sp?.startsWith("ref_")){const n=parseInt(sp.slice(4),10);if(!isNaN(n)&&n!==ctx.from.id)rid=n;}
  const ex=await dbu(ctx.from.id);
  if(!ex&&rid) pendRefs.set(ctx.from.id,{ref:rid,exp:Date.now()+3600000});
  if(!(await chkMem(ctx.from.id))){await joinMsg(ctx);return;}
  await welcome(ctx,!ex);
});

bot.action("verify_join",async ctx=>{
  if(!(await chkMem(ctx.from.id))){await ctx.answerCbQuery("هنوز عضو نشدی! اول عضو شو سپس دکمه را بزن.",{show_alert:true});return;}
  await ctx.answerCbQuery("عضویت تأیید شد!");
  await ctx.deleteMessage().catch(()=>{});
  const ex=await dbu(ctx.from.id); await welcome(ctx,!ex);
});

bot.command("admin",async ctx=>{
  if(ctx.from.username!==ADMIN){await ctx.reply("دسترسی غیرمجاز.");return;}
  const st=await stats();
  await ctx.replyWithHTML(eBack()+" <b>پنل مدیریت</b>\n\n"+eRef()+" کاربران: <b>"+st.u+"</b>\n"+ePkg()+" کانفیگ: <b>"+st.c+"</b>\n"+eArr()+" موجود: <b>"+st.p+"</b>",{reply_markup:AM});
});

bot.on("text",async ctx=>{
  if(ctx.chat?.type!=="private") return;
  const txt=ctx.message.text; const uid=ctx.from.id; const isAdm=ctx.from.username===ADMIN;
  if(isAdm){
    if(txt==="❌ لغو"){cs(uid);await ctx.replyWithHTML(eBack()+" لغو شد.",{reply_markup:AM});return;}
    if(txt==="🔙 بازگشت به منوی اصلی"){cs(uid);await ctx.replyWithHTML("منوی اصلی",{reply_markup:mainKb(gs())});return;}
    if(ABTNS.has(txt)){await ab(ctx,txt,uid);return;}
    const st=ST.get(uid);if(st){await as(ctx,txt,st,uid);return;}
  }
  const s=gs();
  if(s.maintenanceMode&&!isAdm){await ctx.replyWithHTML(eBack()+" ربات در حال تعمیر است.");return;}
  if(!(await chkMem(uid))){await joinMsg(ctx);return;}
  const user=await dbu(uid);
  if(!user){await ctx.replyWithHTML(eArr()+" برای شروع /start را بزنید.");return;}
  if(user.is_banned){await ctx.replyWithHTML(eBack()+" حساب شما مسدود شده است.");return;}

  if(txt===s.buttons.getConfig.label){
    const [a1,a2,a5]=await Promise.all([avail(1000),avail(2000),avail(5000)]);
    await ctx.replyWithHTML(ePkg()+" <b>دریافت کانفیگ</b>\n\nسکه فعلی: "+eCoin()+" <b>"+user.coins+" سکه</b>\n\n"+eOk()+" سبز=موجود  "+eBack()+" قرمز=ناموجود\n\nپکیج را انتخاب کنید:",{reply_markup:cfgKb({p1000:a1,p2000:a2,p5000:a5},s)}); return;
  }
  if(txt===s.buttons.myConfigs.label){
    const cfgs=await uConfs(uid);
    if(!cfgs.length){await ctx.replyWithHTML(eConf()+" هنوز کانفیگی دریافت نکرده\u200cاید.\n\nاز «"+h(s.buttons.getConfig.label)+"» اقدام کنید.",{reply_markup:mainKb(s)});return;}
    const lt=cfgs[0]; const d=new Date(lt.received_at);
    const dd=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    const tt=String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");
    await ctx.replyWithHTML(eConf()+" <b>آخرین کانفیگ</b>\n\n"+ePkg()+" حجم: <b>"+lt.package_size_mb+"MB</b>\n"+eArr()+" تاریخ: <b>"+dd+" — "+tt+"</b>\n\n"+eConf()+" لینک:\n<code>"+h(lt.config_link)+"</code>\n\n━━━━━━━━━━━━━━━━━━━━\n"+eArr()+" مجموع: <b>"+cfgs.length+"</b> عدد",{reply_markup:{inline_keyboard:[[{text:"بازگشت به منو",callback_data:"back_menu"}]]}}); return;
  }
  if(txt===s.buttons.account.label){
    const [rc,cc]=await Promise.all([refs(uid),uCnt(uid)]);
    await ctx.replyWithHTML(eAcc()+" <b>حساب کاربری</b>\n\n━━━━━━━━━━━━━━━━━━━━\n"+eAcc()+" نام: <b>"+h(user.first_name)+"</b>\n"+eAcc()+" آیدی: <b>"+user.telegram_id+"</b>\n━━━━━━━━━━━━━━━━━━━━\n"+eCoin()+" موجودی: <b>"+user.coins+" سکه</b>\n"+eRef()+" دعوت\u200cشدگان: <b>"+rc+" نفر</b>\n"+ePkg()+" کانفیگ: <b>"+cc+" عدد</b>\n━━━━━━━━━━━━━━━━━━━━\n\n"+eGift()+" با دعوت دوستان سکه بیشتری کسب کنید!",{reply_markup:mainKb(s)}); return;
  }
  if(txt===s.buttons.referrals.label){
    const [bi,rc]=await Promise.all([ctx.telegram.getMe(),refs(uid)]);
    const rl="https://t.me/"+bi.username+"?start=ref_"+uid;
    await ctx.replyWithHTML(eRef()+" <b>سیستم دعوت</b>\n\n"+eGift()+" به ازای هر دوست: <b>"+s.coinPerReferral+" سکه</b>\n\n"+eCoin()+" دعوت\u200cهای شما: <b>"+rc+" نفر</b>\n\n━━━━━━━━━━━━━━━━━━━━\n"+eArr()+" لینک اختصاصی:\n<code>"+h(rl)+"</code>\n━━━━━━━━━━━━━━━━━━━━",{reply_markup:mainKb(s)}); return;
  }
  await ctx.replyWithHTML(eArr()+" از منوی زیر انتخاب کنید:",{reply_markup:mainKb(s)});
});

for(const [cb,mb] of [["pkg_1000",1000],["pkg_2000",2000],["pkg_5000",5000]]){
  bot.action(cb,async ctx=>{
    const s=gs(); const cost=mb===1000?s.pkg1000Cost:mb===2000?s.pkg2000Cost:s.pkg5000Cost;
    const user=await dbu(ctx.from.id);
    if(!user){await ctx.answerCbQuery("ابتدا /start بزنید.",{show_alert:true});return;}
    if(user.is_banned){await ctx.answerCbQuery("حساب مسدود شده.",{show_alert:true});return;}
    if(user.coins<cost){await ctx.answerCbQuery("موجودی ناکافی! "+user.coins+" سکه دارید، "+cost+" نیاز است.",{show_alert:true});return;}
    const av=await getAv(mb,cost);
    if(!av){await ctx.answerCbQuery("موجودی "+mb+"MB تمام شده.",{show_alert:true});return;}
    await giveC(ctx.from.id,av.id,av.config_link,mb,cost);
    await ctx.answerCbQuery("کانفیگ دریافت شد!");
    const [uu,[a1,a2,a5]]=await Promise.all([dbu(ctx.from.id),Promise.all([avail(1000),avail(2000),avail(5000)])]);
    await ctx.replyWithHTML(eOk()+" <b>دریافت موفق!</b>\n\n"+ePkg()+" حجم: <b>"+mb+"MB</b>\n"+eCoin()+" کسر: <b>"+cost+"</b> | باقی: <b>"+(uu?.coins||0)+"</b>\n\n"+eConf()+" کانفیگ:\n<code>"+h(av.config_link)+"</code>\n\nدر «"+h(s.buttons.myConfigs.label)+"» ذخیره شد.",{reply_markup:cfgKb({p1000:a1,p2000:a2,p5000:a5},s)});
  });
}

bot.action("back_menu",async ctx=>{await ctx.answerCbQuery();await ctx.replyWithHTML(eArr()+" منوی اصلی",{reply_markup:mainKb(gs())});});

async function main(){
  await initDB(); await loadSettings();
  await bot.telegram.setWebhook(WEBHOOK_URL);
  console.log("✅ mojevpnRobot running — webhook: "+WEBHOOK_URL);
}
main().catch(e=>{console.error("Fatal:",e.message);process.exit(1);});
process.once("SIGINT",()=>server.close());
process.once("SIGTERM",()=>server.close());