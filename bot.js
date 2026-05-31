import { Telegraf } from "telegraf";
import pkg from "pg";
import http from "http";

const { Pool } = pkg;
const ADMIN = "Mojeao";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DB_URL = process.env.DATABASE_URL;
const PORT = parseInt(process.env.PORT || "3000", 10);
const WEBHOOK_HOST = process.env.WEBHOOK_DOMAIN || "telegram-bot-production-a76c.up.railway.app";
const WEBHOOK_PATH = "/tg";
const WEBHOOK_URL = "https://" + WEBHOOK_HOST + WEBHOOK_PATH;

if (!TOKEN) throw new Error("No TELEGRAM_BOT_TOKEN");
if (!DB_URL) throw new Error("No DATABASE_URL");

// ── HTTP server starts FIRST so Railway health check passes ──────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") { res.writeHead(200); res.end("ok"); return; }
  if (req.method === "POST" && req.url === WEBHOOK_PATH) {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try { bot.handleUpdate(JSON.parse(body)).catch(console.error); } catch {}
      res.writeHead(200); res.end("ok");
    });
    return;
  }
  res.writeHead(404); res.end("not found");
});
server.listen(PORT, () => console.log("HTTP server on port " + PORT));

// ── DB ───────────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: DB_URL,
  ssl: false,
});

async function q(sql, p = []) {
  const c = await pool.connect();
  try { return await c.query(sql, p); } finally { c.release(); }
}

async function initDB(retries = 0) {
  try {
    await q(`CREATE TABLE IF NOT EXISTS bot_users (
      id SERIAL PRIMARY KEY, telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT, first_name TEXT NOT NULL, last_name TEXT,
      coins INTEGER NOT NULL DEFAULT 0, referrer_telegram_id BIGINT,
      is_banned BOOLEAN NOT NULL DEFAULT false,
      joined_at TIMESTAMP NOT NULL DEFAULT NOW())
    `);
    await q(`CREATE TABLE IF NOT EXISTS config_pool (
      id SERIAL PRIMARY KEY, config_link TEXT NOT NULL,
      package_size_mb INTEGER NOT NULL, cost_coins INTEGER NOT NULL,
      is_used BOOLEAN NOT NULL DEFAULT false, added_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW())
    `);
    await q(`CREATE TABLE IF NOT EXISTS user_configs (
      id SERIAL PRIMARY KEY, telegram_id BIGINT NOT NULL,
      config_link TEXT NOT NULL, package_size_mb INTEGER NOT NULL,
      coins_spent INTEGER NOT NULL, received_at TIMESTAMP NOT NULL DEFAULT NOW())
    `);
    await q(`CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    console.log("DB ready");
  } catch (e) {
    if (retries < 30) {
      console.log("DB not ready, retry " + (retries+1) + "/30 in 3s... " + e.message);
      await sleep(3000);
      return initDB(retries + 1);
    }
    throw e;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Settings ─────────────────────────────────────────────────────────────────
async function getSetting(key, def) {
  const r = await q("SELECT value FROM bot_settings WHERE key=$1", [key]);
  return r.rows[0]?.value ?? def;
}
async function setSetting(key, val) {
  await q("INSERT INTO bot_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2", [key, val]);
}
async function getSettings() {
  const r = await q("SELECT key,value FROM bot_settings");
  const m = {};
  for (const row of r.rows) m[row.key] = row.value;
  const b = s => m["btn_" + s + "_label"];
  return {
    welcomeText:      m.welcome_text      || "⭐ سلام {name} عزیز!\n\nبه پلتفرم اینترنت آزاد خوش آمدی.\n\nبا دعوت دوستانت 🎁 کانفیگ رایگان دریافت کن!\n\nاز منوی زیر شروع کن 👇",
    welcomeTextRef:   m.welcome_text_ref  || "🎉 سلام {name} عزیز!\n\nاز طریق لینک دعوت وارد شدی.\n🪙 یک سکه به حساب دوستت اضافه شد!\n\nاز منوی زیر اقدام کن 👇",
    coinPerReferral:  parseInt(m.coin_per_referral || "1", 10),
    maintenance:      m.maintenance_mode === "true",
    channels:         m.mandatory_channels ? JSON.parse(m.mandatory_channels) : [],
    btnGetConfig:     b("getconfig")  || "📦 دریافت کانفیگ",
    btnMyConfigs:     b("myconfigs")  || "📋 کانفیگ‌های من",
    btnAccount:       b("account")    || "👤 حساب کاربری",
    btnReferrals:     b("referrals")  || "👥 زیرمجموعه‌ها",
    pkg1000Label:     m.pkg1000_label || "بسته 1000MB — 5 سکه",
    pkg2000Label:     m.pkg2000_label || "بسته 2000MB — 10 سکه",
    pkg5000Label:     m.pkg5000_label || "بسته 5000MB — 20 سکه",
    pkg1000Cost:      parseInt(m.pkg1000_cost || "5",  10),
    pkg2000Cost:      parseInt(m.pkg2000_cost || "10", 10),
    pkg5000Cost:      parseInt(m.pkg5000_cost || "20", 10),
    pkg1000On:        m.pkg1000_available !== "false",
    pkg2000On:        m.pkg2000_available !== "false",
    pkg5000On:        m.pkg5000_available !== "false",
  };
}

// ── DB helpers ───────────────────────────────────────────────────────────────
async function getUser(tid) {
  const r = await q("SELECT * FROM bot_users WHERE telegram_id=$1", [tid]);
  return r.rows[0] || null;
}
async function upsertUser(tid, firstName, username, lastName, refId) {
  const ex = await getUser(tid);
  if (ex) return ex;
  const r = await q(
    "INSERT INTO bot_users(telegram_id,first_name,username,last_name,coins,is_banned,referrer_telegram_id) VALUES($1,$2,$3,$4,0,false,$5) RETURNING *",
    [tid, firstName, username || null, lastName || null, refId || null]
  );
  if (refId && refId !== tid) {
    const s = await getSettings();
    await q("UPDATE bot_users SET coins=coins+$1 WHERE telegram_id=$2", [s.coinPerReferral, refId]);
  }
  return r.rows[0];
}
async function countAvail(mb) {
  const r = await q("SELECT COUNT(*) c FROM config_pool WHERE is_used=false AND package_size_mb=$1", [mb]);
  return parseInt(r.rows[0].c, 10);
}
async function getAvailConfig(mb, cost) {
  const r = await q("SELECT * FROM config_pool WHERE is_used=false AND package_size_mb=$1 AND cost_coins=$2 LIMIT 1", [mb, cost]);
  return r.rows[0] || null;
}
async function giveConfig(tid, cid, link, mb, cost) {
  await q("UPDATE config_pool SET is_used=true WHERE id=$1", [cid]);
  await q("UPDATE bot_users SET coins=coins-$1 WHERE telegram_id=$2", [cost, tid]);
  await q("INSERT INTO user_configs(telegram_id,config_link,package_size_mb,coins_spent) VALUES($1,$2,$3,$4)", [tid, link, mb, cost]);
}
async function giveConfigManual(tid, cid, link, mb, cost) {
  await q("UPDATE config_pool SET is_used=true WHERE id=$1", [cid]);
  await q("INSERT INTO user_configs(telegram_id,config_link,package_size_mb,coins_spent) VALUES($1,$2,$3,$4)", [tid, link, mb, cost]);
}
async function addConfig(link, mb, cost, by) {
  await q("INSERT INTO config_pool(config_link,package_size_mb,cost_coins,is_used,added_by) VALUES($1,$2,$3,false,$4)", [link, mb, cost, by]);
}
async function getStats() {
  const [u,c,p] = await Promise.all([
    q("SELECT COUNT(*) c FROM bot_users"),
    q("SELECT COUNT(*) c FROM user_configs"),
    q("SELECT COUNT(*) c FROM config_pool WHERE is_used=false"),
  ]);
  return { users: +u.rows[0].c, configs: +c.rows[0].c, pool: +p.rows[0].c };
}
async function getUserConfigs(tid) {
  return (await q("SELECT * FROM user_configs WHERE telegram_id=$1 ORDER BY id DESC", [tid])).rows;
}
async function getRefs(tid) {
  return +(await q("SELECT COUNT(*) c FROM bot_users WHERE referrer_telegram_id=$1", [tid])).rows[0].c;
}

// ── Keyboards ────────────────────────────────────────────────────────────────
function mainMenu(s) {
  return { keyboard: [[{text:s.btnGetConfig}],[{text:s.btnMyConfigs},{text:s.btnAccount}],[{text:s.btnReferrals}]], resize_keyboard:true, persistent:true };
}
function pkgKb(avail, s) {
  const row = (on, cnt, label, cb) => [{ text:(on&&cnt>0?"🟢 ":"🔴 ")+label, callback_data:cb }];
  return { inline_keyboard:[
    row(s.pkg1000On, avail.p1000, s.pkg1000Label, "pkg_1000"),
    row(s.pkg2000On, avail.p2000, s.pkg2000Label, "pkg_2000"),
    row(s.pkg5000On, avail.p5000, s.pkg5000Label, "pkg_5000"),
  ]};
}

// ── Admin menu ───────────────────────────────────────────────────────────────
const AMENU = { keyboard:[
  [{text:"1️⃣ وضعیت ربات"},{text:"2️⃣ آمار کامل"}],
  [{text:"3️⃣ جستجوی کاربر"},{text:"4️⃣ همه کاربران"}],
  [{text:"5️⃣ بن کردن"},{text:"6️⃣ رفع بن"}],
  [{text:"7️⃣ تنظیم سکه"},{text:"8️⃣ سرویس دستی"}],
  [{text:"9️⃣ شارژ پکیج"},{text:"🔟 وضعیت پکیج"}],
  [{text:"📣 پیام همگانی"},{text:"💬 پیام به کاربر"}],
  [{text:"⚙️ تنظیمات"},{text:"🔧 حالت تعمیر"}],
  [{text:"🔙 بازگشت به منو"}],
], resize_keyboard:true };
const ABTNS = new Set(AMENU.keyboard.flat().map(b=>b.text));
const CANCEL = "❌ لغو";
const cKb = { keyboard:[[{text:CANCEL}]], resize_keyboard:true };
const states = new Map();
function ss(id,step,data={}) { states.set(id,{step,data}); }
function cs(id) { states.delete(id); }
const pendRefs = new Map();

// ── Bot ──────────────────────────────────────────────────────────────────────
const bot = new Telegraf(TOKEN);

async function isMember(uid) {
  const s = await getSettings();
  if (!s.channels.length) return true;
  for (const ch of s.channels) {
    try {
      const m = await bot.telegram.getChatMember(ch.id, uid);
      if (!["member","administrator","creator"].includes(m.status)) return false;
    } catch { return false; }
  }
  return true;
}

async function joinMsg(ctx) {
  const s = await getSettings();
  const list = s.channels.map(c => "📣 <b><a href=\"" + c.link + "\">@" + c.name + "</a></b>").join("\n");
  await ctx.replyWithHTML(
    "⭐ برای استفاده از ربات باید در کانال‌های زیر عضو باشید:\n\n" + list + "\n\nپس از عضویت ✅ تایید عضویت را بزنید.",
    { reply_markup: { inline_keyboard: [
        ...s.channels.map(c => [{text:"📣 "+c.name, url:c.link}]),
        [{text:"✅ تایید عضویت", callback_data:"verify_join"}],
      ]}}
  );
}

async function welcome(ctx, isNew) {
  const s = await getSettings();
  const tid = ctx.from.id;
  let refId;
  if (isNew) { const p=pendRefs.get(tid); if(p&&p.exp>Date.now()){refId=p.ref;pendRefs.delete(tid);} }
  await upsertUser(tid, ctx.from.first_name, ctx.from.username, ctx.from.last_name, isNew?refId:undefined);
  if (isNew && refId) {
    try { await bot.telegram.sendMessage(refId, "🎉 " + ctx.from.first_name + " از لینک دعوت وارد شد.\n🪙 " + s.coinPerReferral + " سکه اضافه شد!", {parse_mode:"HTML"}); } catch {}
  }
  const txt = ((isNew&&refId)?s.welcomeTextRef:s.welcomeText).replace("{name}",ctx.from.first_name);
  await ctx.replyWithHTML(txt, {reply_markup:mainMenu(s)});
}

async function adminBtn(ctx, text, uid) {
  const s = await getSettings();
  switch(text) {
    case "1️⃣ وضعیت ربات": {
      const st=await getStats(); const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
      await ctx.replyWithHTML("📊 <b>وضعیت ربات</b>\n\n"+(s.maintenance?"🔴 تعمیر":"🟢 فعال")+"\n\n👥 کاربران: <b>"+st.users+"</b>\n📦 داده شده: <b>"+st.configs+"</b>\n\n"+(s.pkg1000On?"🟢":"🔴")+" 1000MB: <b>"+a1+"</b>\n"+(s.pkg2000On?"🟢":"🔴")+" 2000MB: <b>"+a2+"</b>\n"+(s.pkg5000On?"🟢":"🔴")+" 5000MB: <b>"+a5+"</b>", {reply_markup:AMENU}); break;
    }
    case "2️⃣ آمار کامل": {
      const st=await getStats(); const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
      await ctx.replyWithHTML("📈 <b>آمار کامل</b>\n\n👥 "+st.users+" کاربر\n📦 "+st.configs+" کانفیگ داده شده\n\n1000MB: <b>"+a1+"</b>\n2000MB: <b>"+a2+"</b>\n5000MB: <b>"+a5+"</b>\n\n🔑 سکه دعوت: <b>"+s.coinPerReferral+"</b>", {reply_markup:AMENU}); break;
    }
    case "3️⃣ جستجوی کاربر": ss(uid,"search"); await ctx.replyWithHTML("🔍 آیدی یا @یوزرنیم:", {reply_markup:cKb}); break;
    case "4️⃣ همه کاربران": {
      const r=await q("SELECT * FROM bot_users ORDER BY id DESC LIMIT 30");
      const lines=r.rows.map((u,i)=>((i+1)+". <code>"+u.telegram_id+"</code> <b>"+u.first_name+"</b> 🪙"+u.coins+(u.is_banned?" 🚫":""))).join("\n");
      await ctx.replyWithHTML("👥 <b>کاربران</b>\n\n"+(lines||"خالی"), {reply_markup:AMENU}); break;
    }
    case "5️⃣ بن کردن": ss(uid,"ban"); await ctx.replyWithHTML("🆔 آیدی کاربر:", {reply_markup:cKb}); break;
    case "6️⃣ رفع بن": ss(uid,"unban"); await ctx.replyWithHTML("🆔 آیدی کاربر:", {reply_markup:cKb}); break;
    case "7️⃣ تنظیم سکه": ss(uid,"coin_id"); await ctx.replyWithHTML("🆔 آیدی کاربر:", {reply_markup:cKb}); break;
    case "8️⃣ سرویس دستی": ss(uid,"svc_id"); await ctx.replyWithHTML("🆔 آیدی کاربر:", {reply_markup:cKb}); break;
    case "9️⃣ شارژ پکیج": {
      const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
      ss(uid,"charge_pkg"); await ctx.replyWithHTML("📦 <b>شارژ پکیج</b>\n\n<b>1</b> — 1000MB (موجود: "+a1+")\n<b>2</b> — 2000MB (موجود: "+a2+")\n<b>3</b> — 5000MB (موجود: "+a5+")\n\nعدد 1، 2 یا 3:", {reply_markup:cKb}); break;
    }
    case "🔟 وضعیت پکیج": {
      const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
      ss(uid,"toggle_pkg"); await ctx.replyWithHTML("📦 <b>وضعیت پکیج‌ها</b>\n\n"+(s.pkg1000On?"🟢":"🔴")+" <b>1</b> — 1000MB ("+a1+" موجود)\n"+(s.pkg2000On?"🟢":"🔴")+" <b>2</b> — 2000MB ("+a2+" موجود)\n"+(s.pkg5000On?"🟢":"🔴")+" <b>3</b> — 5000MB ("+a5+" موجود)\n\nعدد پکیج برای تغییر وضعیت:", {reply_markup:cKb}); break;
    }
    case "📣 پیام همگانی": ss(uid,"broadcast"); await ctx.replyWithHTML("📣 متن پیام:", {reply_markup:cKb}); break;
    case "💬 پیام به کاربر": ss(uid,"msg_id"); await ctx.replyWithHTML("🆔 آیدی کاربر:", {reply_markup:cKb}); break;
    case "⚙️ تنظیمات": ss(uid,"welcome"); await ctx.replyWithHTML("متن پیام خوش‌آمد (از {name} برای نام استفاده کن):", {reply_markup:cKb}); break;
    case "🔧 حالت تعمیر": {
      const nv=!s.maintenance; await setSetting("maintenance_mode",String(nv));
      await ctx.replyWithHTML("🔧 حالت تعمیر: "+(nv?"🔴 فعال شد":"🟢 غیرفعال شد"), {reply_markup:AMENU}); break;
    }
    case "🔙 بازگشت به منو": cs(uid); await ctx.replyWithHTML("منوی اصلی", {reply_markup:mainMenu(s)}); break;
  }
}

async function adminStep(ctx, text, st, uid) {
  const s = await getSettings();
  switch(st.step) {
    case "search": {
      cs(uid);
      const id2=parseInt(text,10);
      const r=isNaN(id2)
        ? await q("SELECT * FROM bot_users WHERE username=$1 LIMIT 1",[text.replace("@","")])
        : await q("SELECT * FROM bot_users WHERE telegram_id=$1 LIMIT 1",[id2]);
      if(!r.rows.length){await ctx.replyWithHTML("یافت نشد.",{reply_markup:AMENU});return;}
      const u=r.rows[0];
      await ctx.replyWithHTML("👤 <b>"+u.first_name+"</b>\n🆔 <code>"+u.telegram_id+"</code>\n📱 "+(u.username?"@"+u.username:"—")+"\n🪙 "+u.coins+"\n"+(u.is_banned?"🚫 مسدود":"✅ فعال"), {reply_markup:AMENU}); break;
    }
    case "ban": {
      const id3=parseInt(text,10); if(isNaN(id3)){await ctx.reply("آیدی نامعتبر");return;}
      await q("UPDATE bot_users SET is_banned=true WHERE telegram_id=$1",[id3]); cs(uid);
      await ctx.replyWithHTML("✅ <code>"+id3+"</code> مسدود شد.",{reply_markup:AMENU}); break;
    }
    case "unban": {
      const id4=parseInt(text,10); if(isNaN(id4)){await ctx.reply("آیدی نامعتبر");return;}
      await q("UPDATE bot_users SET is_banned=false WHERE telegram_id=$1",[id4]); cs(uid);
      await ctx.replyWithHTML("✅ مسدودی <code>"+id4+"</code> رفع شد.",{reply_markup:AMENU}); break;
    }
    case "coin_id": {
      const id5=parseInt(text,10); if(isNaN(id5)){await ctx.reply("آیدی نامعتبر");return;}
      ss(uid,"coin_amount",{id:id5}); await ctx.replyWithHTML("مقدار سکه برای <code>"+id5+"</code>:",{reply_markup:cKb}); break;
    }
    case "coin_amount": {
      const amt=parseInt(text,10); if(isNaN(amt)){await ctx.reply("عدد نامعتبر");return;}
      await q("UPDATE bot_users SET coins=$1 WHERE telegram_id=$2",[amt,st.data.id]); cs(uid);
      await ctx.replyWithHTML("✅ سکه → <b>"+amt+"</b>",{reply_markup:AMENU}); break;
    }
    case "svc_id": {
      const id6=parseInt(text,10); if(isNaN(id6)){await ctx.reply("آیدی نامعتبر");return;}
      ss(uid,"svc_size",{id:id6}); await ctx.replyWithHTML("حجم:\n<b>1</b>—1000MB\n<b>2</b>—2000MB\n<b>3</b>—5000MB",{reply_markup:cKb}); break;
    }
    case "svc_size": {
      const mp={1:{mb:1000,cost:s.pkg1000Cost},2:{mb:2000,cost:s.pkg2000Cost},3:{mb:5000,cost:s.pkg5000Cost}};
      const ch=mp[parseInt(text.trim())]; if(!ch){await ctx.reply("1، 2 یا 3");return;}
      const av=await getAvailConfig(ch.mb,ch.cost); cs(uid);
      if(!av){await ctx.replyWithHTML("موجودی "+ch.mb+"MB تمام شده.",{reply_markup:AMENU});return;}
      await giveConfigManual(st.data.id,av.id,av.config_link,ch.mb,ch.cost);
      try{await bot.telegram.sendMessage(st.data.id,"🎁 کانفیگ دستی ادمین\n📦 "+ch.mb+"MB\n\n<code>"+av.config_link+"</code>",{parse_mode:"HTML"});}catch{}
      await ctx.replyWithHTML("✅ کانفیگ "+ch.mb+"MB به <code>"+st.data.id+"</code> داده شد.",{reply_markup:AMENU}); break;
    }
    case "charge_pkg": {
      const mp2={1:1000,2:2000,3:5000}; const mb2=mp2[parseInt(text.trim())]; if(!mb2){await ctx.reply("1، 2 یا 3");return;}
      ss(uid,"charge_links",{mb:mb2}); await ctx.replyWithHTML("📦 شارژ "+mb2+"MB\n\nکانفیگ‌ها (هر خط یک لینک):",{reply_markup:cKb}); break;
    }
    case "charge_links": {
      const mb3=st.data.mb; const costMap={1000:s.pkg1000Cost,2000:s.pkg2000Cost,5000:s.pkg5000Cost};
      const links=text.split("\n").map(l=>l.trim()).filter(l=>l.length>5); cs(uid);
      if(!links.length){await ctx.replyWithHTML("هیچ لینکی یافت نشد.",{reply_markup:AMENU});return;}
      for(const lk of links) await addConfig(lk,mb3,costMap[mb3]||5,"admin-bot");
      await ctx.replyWithHTML("✅ <b>"+links.length+"</b> کانفیگ به پکیج "+mb3+"MB اضافه شد.",{reply_markup:AMENU}); break;
    }
    case "toggle_pkg": {
      const n=text.trim(); if(!["1","2","3"].includes(n)){await ctx.reply("1، 2 یا 3");return;}
      const km={1:"pkg1000_available",2:"pkg2000_available",3:"pkg5000_available"};
      const sm={1:1000,2:2000,3:5000};
      const cur={1:s.pkg1000On,2:s.pkg2000On,3:s.pkg5000On}[parseInt(n)];
      await setSetting(km[n],String(!cur)); cs(uid);
      await ctx.replyWithHTML("✅ پکیج "+sm[n]+"MB: "+(!cur?"🟢 فعال (موجود)":"🔴 غیرفعال (ناموجود)"),{reply_markup:AMENU}); break;
    }
    case "welcome": { await setSetting("welcome_text",text); cs(uid); await ctx.replyWithHTML("✅ متن ذخیره شد.",{reply_markup:AMENU}); break; }
    case "broadcast": {
      const users=await q("SELECT telegram_id FROM bot_users LIMIT 100000"); cs(uid);
      await ctx.replyWithHTML("📣 در حال ارسال به <b>"+users.rows.length+"</b> کاربر...",{reply_markup:AMENU});
      let sent=0; for(const u of users.rows){try{await bot.telegram.sendMessage(u.telegram_id,text,{parse_mode:"HTML"});sent++;}catch{}await sleep(50);}
      try{await bot.telegram.sendMessage(uid,"✅ ارسال شد. موفق: "+sent);}catch{} break;
    }
    case "msg_id": {
      const id7=parseInt(text,10); if(isNaN(id7)){await ctx.reply("آیدی نامعتبر");return;}
      ss(uid,"msg_text",{id:id7}); await ctx.replyWithHTML("متن پیام برای <code>"+id7+"</code>:",{reply_markup:cKb}); break;
    }
    case "msg_text": {
      try{await bot.telegram.sendMessage(st.data.id,text,{parse_mode:"HTML"});cs(uid);await ctx.replyWithHTML("✅ ارسال شد.",{reply_markup:AMENU});}
      catch{cs(uid);await ctx.replyWithHTML("ارسال ناموفق.",{reply_markup:AMENU});} break;
    }
    default: cs(uid);
  }
}

// ── Bot handlers ─────────────────────────────────────────────────────────────
bot.start(async ctx => {
  if(ctx.chat?.type!=="private") return;
  const s=await getSettings();
  if(s.maintenance&&ctx.from.username!==ADMIN){await ctx.reply("🔧 ربات در حال تعمیر است.");return;}
  const sp=ctx.startPayload; let refId;
  if(sp?.startsWith("ref_")){const n=parseInt(sp.slice(4),10);if(!isNaN(n)&&n!==ctx.from.id)refId=n;}
  const ex=await getUser(ctx.from.id);
  if(!ex&&refId) pendRefs.set(ctx.from.id,{ref:refId,exp:Date.now()+3600000});
  if(!(await isMember(ctx.from.id))){await joinMsg(ctx);return;}
  await welcome(ctx,!ex);
});

bot.action("verify_join",async ctx=>{
  if(!(await isMember(ctx.from.id))){await ctx.answerCbQuery("هنوز عضو نشدی!",{show_alert:true});return;}
  await ctx.answerCbQuery("عضویت تأیید شد!");
  await ctx.deleteMessage().catch(()=>{});
  const ex=await getUser(ctx.from.id);
  await welcome(ctx,!ex);
});

bot.command("admin",async ctx=>{
  if(ctx.from.username!==ADMIN){await ctx.reply("دسترسی ندارید.");return;}
  const st=await getStats();
  await ctx.replyWithHTML("🔴 <b>پنل مدیریت</b>\n\n👥 "+st.users+" | 📦 "+st.configs+" | 📥 "+st.pool,{reply_markup:AMENU});
});

bot.on("text",async ctx=>{
  if(ctx.chat?.type!=="private") return;
  const text=ctx.message.text; const uid=ctx.from.id;
  const isAdmin=ctx.from.username===ADMIN;
  if(isAdmin){
    if(text===CANCEL){cs(uid);await ctx.replyWithHTML("لغو شد.",{reply_markup:AMENU});return;}
    if(text==="🔙 بازگشت به منو"){cs(uid);const s=await getSettings();await ctx.replyWithHTML("منوی اصلی",{reply_markup:mainMenu(s)});return;}
    if(ABTNS.has(text)){await adminBtn(ctx,text,uid);return;}
    const st=states.get(uid); if(st){await adminStep(ctx,text,st,uid);return;}
  }
  const s=await getSettings();
  if(s.maintenance&&!isAdmin){await ctx.reply("🔧 ربات در حال تعمیر است.");return;}
  if(!(await isMember(uid))){await joinMsg(ctx);return;}
  const user=await getUser(uid);
  if(!user){await ctx.reply("برای شروع /start را بزنید.");return;}
  if(user.is_banned){await ctx.reply("حساب شما مسدود شده است.");return;}
  if(text===s.btnGetConfig){
    const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
    await ctx.replyWithHTML("📦 <b>دریافت کانفیگ</b>\n\n🪙 موجودی: <b>"+user.coins+" سکه</b>\n\n🟢 موجود  🔴 ناموجود",{reply_markup:pkgKb({p1000:a1,p2000:a2,p5000:a5},s)}); return;
  }
  if(text===s.btnMyConfigs){
    const cfgs=await getUserConfigs(uid);
    if(!cfgs.length){await ctx.replyWithHTML("📋 هنوز کانفیگی دریافت نکرده‌اید.",{reply_markup:mainMenu(s)});return;}
    const lt=cfgs[0]; const d2=new Date(lt.received_at);
    const dd=(d2.getFullYear())+"-"+String(d2.getMonth()+1).padStart(2,"0")+"-"+String(d2.getDate()).padStart(2,"0");
    await ctx.replyWithHTML("📋 <b>آخرین کانفیگ</b>\n\n📦 "+lt.package_size_mb+"MB\n🗓 "+dd+"\n\n🌐 لینک:\n<code>"+lt.config_link+"</code>\n\n👇 مجموع: <b>"+cfgs.length+"</b>",{reply_markup:mainMenu(s)}); return;
  }
  if(text===s.btnAccount){
    const [rc,cfgs]=await Promise.all([getRefs(uid),getUserConfigs(uid)]);
    await ctx.replyWithHTML("👤 <b>حساب کاربری</b>\n━━━━━━━━━━━━━━━\n🪪 "+user.first_name+"\n🆔 "+user.telegram_id+"\n━━━━━━━━━━━━━━━\n🪙 سکه: <b>"+user.coins+"</b>\n👥 دعوت‌شدگان: <b>"+rc+"</b>\n📦 کانفیگ‌ها: <b>"+cfgs.length+"</b>\n━━━━━━━━━━━━━━━",{reply_markup:mainMenu(s)}); return;
  }
  if(text===s.btnReferrals){
    const info=await bot.telegram.getMe();
    const rl="https://t.me/"+info.username+"?start=ref_"+uid;
    const rc=await getRefs(uid);
    await ctx.replyWithHTML("👥 <b>دعوت و کسب سکه</b>\n\n🎁 به ازای هر دوست: <b>"+s.coinPerReferral+" سکه</b>\n🪙 دعوت‌های شما: <b>"+rc+" نفر</b>\n━━━━━━━━━━━━━━━\n👇 لینک دعوت:\n<code>"+rl+"</code>\n━━━━━━━━━━━━━━━",{reply_markup:mainMenu(s)}); return;
  }
  await ctx.replyWithHTML("از منوی زیر انتخاب کنید:",{reply_markup:mainMenu(s)});
});

for(const [cb,mb,ck,ak] of [["pkg_1000",1000,"pkg1000Cost","pkg1000On"],["pkg_2000",2000,"pkg2000Cost","pkg2000On"],["pkg_5000",5000,"pkg5000Cost","pkg5000On"]]) {
  bot.action(cb,async ctx=>{
    const s=await getSettings(); const cost=s[ck];
    const user=await getUser(ctx.from.id);
    if(!user){await ctx.answerCbQuery("ابتدا /start بزنید.",{show_alert:true});return;}
    if(user.is_banned){await ctx.answerCbQuery("حساب مسدود شده.",{show_alert:true});return;}
    if(!s[ak]){await ctx.answerCbQuery("پکیج "+mb+"MB موجود نیست.",{show_alert:true});return;}
    if(user.coins<cost){await ctx.answerCbQuery("موجودی ناکافی! دارید: "+user.coins+" — نیاز: "+cost+" سکه",{show_alert:true});return;}
    const av=await getAvailConfig(mb,cost);
    if(!av){await ctx.answerCbQuery("موجودی "+mb+"MB تمام شده.",{show_alert:true});return;}
    await giveConfig(ctx.from.id,av.id,av.config_link,mb,cost);
    await ctx.answerCbQuery("کانفیگ دریافت شد!");
    const uu=await getUser(ctx.from.id); const [a1,a2,a5]=await Promise.all([countAvail(1000),countAvail(2000),countAvail(5000)]);
    await ctx.replyWithHTML("✅ <b>دریافت موفق!</b>\n\n📦 "+mb+"MB\n🪙 کسر: "+cost+" | باقی: <b>"+(uu?.coins||0)+"</b>\n\n🌐 کانفیگ:\n<code>"+av.config_link+"</code>",{reply_markup:pkgKb({p1000:a1,p2000:a2,p5000:a5},s)});
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await initDB();
  await bot.telegram.setWebhook(WEBHOOK_URL);
  console.log("✅ mojevpnRobot started! Webhook:", WEBHOOK_URL);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });

process.once("SIGINT", () => server.close());
process.once("SIGTERM", () => server.close());