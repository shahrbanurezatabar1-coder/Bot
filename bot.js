
  import pkg from "telegraf";
  import pg from "pg";
  import http from "http";

  const { Telegraf } = pkg;
  const { Pool } = pg;

  const ADMIN_USERNAME = "Mojeao";
  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const DB_URL = process.env.DATABASE_URL;
  const PORT = parseInt(process.env.PORT ?? "3000", 10);
  const WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN ?? "telegram-bot-production-a76c.up.railway.app";
  const WEBHOOK_PATH = "/webhook";
  const WEBHOOK_URL = `https://${WEBHOOK_DOMAIN}${WEBHOOK_PATH}`;

  if (!TOKEN) { console.error("No TELEGRAM_BOT_TOKEN"); process.exit(1); }
  if (!DB_URL) { console.error("No DATABASE_URL"); process.exit(1); }

  const pool = new Pool({
    connectionString: DB_URL,
    ssl: DB_URL.includes("sslmode=disable") ? false : { rejectUnauthorized: false }
  });

  async function query(sql, params = []) {
    const client = await pool.connect();
    try { return await client.query(sql, params); }
    finally { client.release(); }
  }

  async function initDB() {
    await query(`CREATE TABLE IF NOT EXISTS bot_users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT,
      coins INTEGER NOT NULL DEFAULT 0,
      referrer_telegram_id BIGINT,
      is_banned BOOLEAN NOT NULL DEFAULT false,
      joined_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS config_pool (
      id SERIAL PRIMARY KEY,
      config_link TEXT NOT NULL,
      package_size_mb INTEGER NOT NULL,
      cost_coins INTEGER NOT NULL,
      is_used BOOLEAN NOT NULL DEFAULT false,
      added_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS user_configs (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL,
      config_link TEXT NOT NULL,
      package_size_mb INTEGER NOT NULL,
      coins_spent INTEGER NOT NULL,
      received_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
    await query(`CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    console.log("DB tables ready");
  }

  async function getSetting(key, def = null) {
    const r = await query("SELECT value FROM bot_settings WHERE key=$1", [key]);
    return r.rows[0]?.value ?? def;
  }
  async function setSetting(key, value) {
    await query("INSERT INTO bot_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2", [key, value]);
  }
  async function getSettings() {
    const r = await query("SELECT key,value FROM bot_settings");
    const m = {};
    for (const row of r.rows) m[row.key] = row.value;
    return {
      welcomeText: m.welcome_text ?? "⭐ سلام {name} عزیز!\n\nبه پلتفرم اینترنت آزاد خوش آمدی.\n\nبا دعوت دوستانت 🎁 کانفیگ رایگان دریافت کن!\n\nاز منوی زیر شروع کن 👇",
      welcomeTextRef: m.welcome_text_ref ?? "🎉 سلام {name} عزیز!\n\nاز طریق لینک دعوت وارد شدی.\n🪙 یک سکه به حساب دوستت افزوده شد!\n\nاز منوی زیر اقدام کن 👇",
      coinPerReferral: parseInt(m.coin_per_referral ?? "1", 10),
      maintenanceMode: m.maintenance_mode === "true",
      mandatoryChannels: m.mandatory_channels ? JSON.parse(m.mandatory_channels) : [],
      btnGetConfig: m.btn_getconfig_label ?? "📦 دریافت کانفیگ",
      btnMyConfigs: m.btn_myconfigs_label ?? "📋 کانفیگ‌های من",
      btnAccount: m.btn_account_label ?? "👤 حساب کاربری",
      btnReferrals: m.btn_referrals_label ?? "👥 زیرمجموعه‌ها",
      pkg1000Label: m.pkg1000_label ?? "بسته 1000MB — 5 سکه",
      pkg2000Label: m.pkg2000_label ?? "بسته 2000MB — 10 سکه",
      pkg5000Label: m.pkg5000_label ?? "بسته 5000MB — 20 سکه",
      pkg1000Cost: parseInt(m.pkg1000_cost ?? "5", 10),
      pkg2000Cost: parseInt(m.pkg2000_cost ?? "10", 10),
      pkg5000Cost: parseInt(m.pkg5000_cost ?? "20", 10),
      pkg1000Available: m.pkg1000_available !== "false",
      pkg2000Available: m.pkg2000_available !== "false",
      pkg5000Available: m.pkg5000_available !== "false",
    };
  }

  async function getUser(telegramId) {
    const r = await query("SELECT * FROM bot_users WHERE telegram_id=$1", [telegramId]);
    return r.rows[0] ?? null;
  }
  async function upsertUser(telegramId, firstName, username, lastName, referrerId) {
    const ex = await getUser(telegramId);
    if (ex) return ex;
    const r = await query(
      "INSERT INTO bot_users(telegram_id,first_name,username,last_name,coins,is_banned,referrer_telegram_id) VALUES($1,$2,$3,$4,0,false,$5) RETURNING *",
      [telegramId, firstName, username ?? null, lastName ?? null, referrerId ?? null]
    );
    if (referrerId && referrerId !== telegramId) {
      const s = await getSettings();
      await query("UPDATE bot_users SET coins=coins+$1 WHERE telegram_id=$2", [s.coinPerReferral, referrerId]);
    }
    return r.rows[0];
  }
  async function getReferralCount(tid) {
    const r = await query("SELECT COUNT(*) as c FROM bot_users WHERE referrer_telegram_id=$1", [tid]);
    return parseInt(r.rows[0].c, 10);
  }
  async function getAvailableConfig(sizeMb, cost) {
    const r = await query("SELECT * FROM config_pool WHERE is_used=false AND package_size_mb=$1 AND cost_coins=$2 LIMIT 1", [sizeMb, cost]);
    return r.rows[0] ?? null;
  }
  async function giveConfig(tid, cid, link, sizeMb, cost) {
    await query("UPDATE config_pool SET is_used=true WHERE id=$1", [cid]);
    await query("UPDATE bot_users SET coins=coins-$1 WHERE telegram_id=$2", [cost, tid]);
    await query("INSERT INTO user_configs(telegram_id,config_link,package_size_mb,coins_spent) VALUES($1,$2,$3,$4)", [tid, link, sizeMb, cost]);
  }
  async function giveConfigManual(tid, cid, link, sizeMb, cost) {
    await query("UPDATE config_pool SET is_used=true WHERE id=$1", [cid]);
    await query("INSERT INTO user_configs(telegram_id,config_link,package_size_mb,coins_spent) VALUES($1,$2,$3,$4)", [tid, link, sizeMb, cost]);
  }
  async function addConfigToPool(link, sizeMb, cost, addedBy) {
    await query("INSERT INTO config_pool(config_link,package_size_mb,cost_coins,is_used,added_by) VALUES($1,$2,$3,false,$4)", [link, sizeMb, cost, addedBy]);
  }
  async function countAvailable(sizeMb) {
    const r = await query("SELECT COUNT(*) as c FROM config_pool WHERE is_used=false AND package_size_mb=$1", [sizeMb]);
    return parseInt(r.rows[0].c, 10);
  }
  async function getTotalStats() {
    const [u,c,p] = await Promise.all([
      query("SELECT COUNT(*) as c FROM bot_users"),
      query("SELECT COUNT(*) as c FROM user_configs"),
      query("SELECT COUNT(*) as c FROM config_pool WHERE is_used=false"),
    ]);
    return { totalUsers: parseInt(u.rows[0].c,10), totalConfigsGiven: parseInt(c.rows[0].c,10), availableInPool: parseInt(p.rows[0].c,10) };
  }
  async function getUserConfigs(tid) {
    const r = await query("SELECT * FROM user_configs WHERE telegram_id=$1 ORDER BY id DESC", [tid]);
    return r.rows;
  }
  async function banUser(tid) { await query("UPDATE bot_users SET is_banned=true WHERE telegram_id=$1",[tid]); }
  async function unbanUser(tid) { await query("UPDATE bot_users SET is_banned=false WHERE telegram_id=$1",[tid]); }
  async function setCoins(tid, amt) { await query("UPDATE bot_users SET coins=$1 WHERE telegram_id=$2",[amt,tid]); }

  function mainMenu(s) {
    return { keyboard:[[{text:s.btnGetConfig}],[{text:s.btnMyConfigs},{text:s.btnAccount}],[{text:s.btnReferrals}]], resize_keyboard:true, persistent:true };
  }
  function pkgMenu(coins, avail, s) {
    return { inline_keyboard:[
      [{text:(s.pkg1000Available&&avail.p1000>0?"🟢 ":"🔴 ")+s.pkg1000Label,callback_data:"pkg_1000"}],
      [{text:(s.pkg2000Available&&avail.p2000>0?"🟢 ":"🔴 ")+s.pkg2000Label,callback_data:"pkg_2000"}],
      [{text:(s.pkg5000Available&&avail.p5000>0?"🟢 ":"🔴 ")+s.pkg5000Label,callback_data:"pkg_5000"}],
    ]};
  }

  const ADMIN_MENU = { keyboard:[
    [{text:"1️⃣ وضعیت ربات"},{text:"2️⃣ آمار کامل"}],
    [{text:"3️⃣ جستجوی کاربر"},{text:"4️⃣ همه کاربران"}],
    [{text:"5️⃣ بن کردن"},{text:"6️⃣ رفع بن"}],
    [{text:"7️⃣ تنظیم سکه"},{text:"8️⃣ سرویس دستی"}],
    [{text:"9️⃣ شارژ پکیج"},{text:"🔟 وضعیت پکیج"}],
    [{text:"📣 پیام همگانی"},{text:"💬 پیام به کاربر"}],
    [{text:"⚙️ تنظیمات"},{text:"🔧 حالت تعمیر"}],
    [{text:"🔙 بازگشت به منوی اصلی"}],
  ], resize_keyboard:true };
  const ADMIN_BTNS = new Set(ADMIN_MENU.keyboard.flat().map(b=>b.text));
  const CANCEL = "❌ لغو";
  const cancelKb = { keyboard:[[{text:CANCEL}]], resize_keyboard:true };
  const states = new Map();
  function setState(id,step,data={}) { states.set(id,{step,data}); }
  function clearState(id) { states.delete(id); }
  const pendingRefs = new Map();

  async function checkMembership(bot, uid) {
    const s = await getSettings();
    if (!s.mandatoryChannels.length) return true;
    for (const ch of s.mandatoryChannels) {
      try {
        const m = await bot.telegram.getChatMember(ch.id, uid);
        if (!["member","administrator","creator"].includes(m.status)) return false;
      } catch { return false; }
    }
    return true;
  }
  async function sendJoinMsg(ctx) {
    const s = await getSettings();
    const chList = s.mandatoryChannels.map(c=>`📣 <b><a href="${c.link}">@${c.name}</a></b>`).join("\n");
    await ctx.replyWithHTML(`⭐ برای استفاده از ربات باید در کانال‌های زیر عضو باشید:\n\n${chList}\n\nپس از عضویت ✅ تایید عضویت را بزنید.`,
      {reply_markup:{inline_keyboard:[
        ...s.mandatoryChannels.map(c=>[{text:`📣 ${c.name}`,url:c.link}]),
        [{text:"✅ تایید عضویت",callback_data:"verify_join"}],
      ]}});
  }
  async function completeWelcome(ctx, bot, isNew) {
    const s = await getSettings();
    const id = ctx.from.id;
    let referrerId;
    if (isNew) { const p=pendingRefs.get(id); if(p&&p.expiry>Date.now()){referrerId=p.referrerId;pendingRefs.delete(id);} }
    await upsertUser(id, ctx.from.first_name, ctx.from.username, ctx.from.last_name, isNew?referrerId:undefined);
    if (isNew && referrerId) {
      try { await bot.telegram.sendMessage(referrerId,`🎉 ${ctx.from.first_name} از لینک دعوت وارد شد.\n🪙 ${s.coinPerReferral} سکه اضافه شد!`,{parse_mode:"HTML"}); } catch {}
    }
    const txt = (isNew&&referrerId?s.welcomeTextRef:s.welcomeText).replace("{name}",ctx.from.first_name);
    await ctx.replyWithHTML(txt, {reply_markup:mainMenu(s)});
  }

  async function handleAdminBtn(ctx, text, adminId) {
    const s = await getSettings();
    switch(text) {
      case "1️⃣ وضعیت ربات": {
        const stats=await getTotalStats(); const [a1,a2,a5]=await Promise.all([countAvailable(1000),countAvailable(2000),countAvailable(5000)]);
        await ctx.replyWithHTML(`<b>📊 وضعیت ربات</b>\n\n${s.maintenanceMode?"🔴 حالت تعمیر":"🟢 ربات فعال"}\n\n👥 کاربران: <b>${stats.totalUsers}</b>\n📦 داده شده: <b>${stats.totalConfigsGiven}</b>\n\n${s.pkg1000Available?"🟢":"🔴"} 1000MB: <b>${a1}</b>\n${s.pkg2000Available?"🟢":"🔴"} 2000MB: <b>${a2}</b>\n${s.pkg5000Available?"🟢":"🔴"} 5000MB: <b>${a5}</b>`,{reply_markup:ADMIN_MENU}); break;
      }
      case "2️⃣ آمار کامل": {
        const stats=await getTotalStats(); const [a1,a2,a5]=await Promise.all([countAvailable(1000),countAvailable(2000),countAvailable(5000)]);
        await ctx.replyWithHTML(`<b>📈 آمار کامل</b>\n\n👥 ${stats.totalUsers} کاربر\n📦 ${stats.totalConfigsGiven} کانفیگ داده شده\n\n🟢 1000MB: <b>${a1}</b>\n🟢 2000MB: <b>${a2}</b>\n🟢 5000MB: <b>${a5}</b>\n\n🔑 سکه دعوت: <b>${s.coinPerReferral}</b>`,{reply_markup:ADMIN_MENU}); break;
      }
      case "3️⃣ جستجوی کاربر": setState(adminId,"search_query"); await ctx.replyWithHTML("🔍 آیدی یا @یوزرنیم:",{reply_markup:cancelKb}); break;
      case "4️⃣ همه کاربران": {
        const r=await query("SELECT * FROM bot_users ORDER BY id DESC LIMIT 30");
        const lines=r.rows.map((u,i)=>`${i+1}. <code>${u.telegram_id}</code> <b>${u.first_name}</b> 🪙${u.coins}${u.is_banned?" 🚫":""}`).join("\n");
        await ctx.replyWithHTML(`<b>👥 کاربران</b>\n\n${lines||"موردی نیست"}`,{reply_markup:ADMIN_MENU}); break;
      }
      case "5️⃣ بن کردن": setState(adminId,"ban_id"); await ctx.replyWithHTML("🆔 آیدی کاربر:",{reply_markup:cancelKb}); break;
      case "6️⃣ رفع بن": setState(adminId,"unban_id"); await ctx.replyWithHTML("🆔 آیدی کاربر:",{reply_markup:cancelKb}); break;
      case "7️⃣ تنظیم سکه": setState(adminId,"coin_set_id"); await ctx.replyWithHTML("🆔 آیدی کاربر:",{reply_markup:cancelKb}); break;
      case "8️⃣ سرویس دستی": setState(adminId,"service_user_id"); await ctx.replyWithHTML("🆔 آیدی کاربر:",{reply_markup:cancelKb}); break;
      case "9️⃣ شارژ پکیج": {
        const [a1,a2,a5]=await Promise.all([countAvailable(1000),countAvailable(2000),countAvailable(5000)]);
        setState(adminId,"pkg_select_charge");
        await ctx.replyWithHTML(`<b>📦 شارژ پکیج</b>\n\n<b>1</b> — 1000MB (موجود: ${a1})\n<b>2</b> — 2000MB (موجود: ${a2})\n<b>3</b> — 5000MB (موجود: ${a5})\n\nعدد 1، 2 یا 3:`,{reply_markup:cancelKb}); break;
      }
      case "🔟 وضعیت پکیج": {
        const [a1,a2,a5]=await Promise.all([countAvailable(1000),countAvailable(2000),countAvailable(5000)]);
        setState(adminId,"pkg_toggle_select");
        await ctx.replyWithHTML(`<b>📦 وضعیت پکیج‌ها</b>\n\n${s.pkg1000Available?"🟢":"🔴"} <b>1</b> — 1000MB (${a1} موجود)\n${s.pkg2000Available?"🟢":"🔴"} <b>2</b> — 2000MB (${a2} موجود)\n${s.pkg5000Available?"🟢":"🔴"} <b>3</b> — 5000MB (${a5} موجود)\n\nعدد پکیج برای تغییر:`,{reply_markup:cancelKb}); break;
      }
      case "📣 پیام همگانی": setState(adminId,"broadcast_text"); await ctx.replyWithHTML("📣 متن پیام:",{reply_markup:cancelKb}); break;
      case "💬 پیام به کاربر": setState(adminId,"msg_user_id"); await ctx.replyWithHTML("🆔 آیدی کاربر:",{reply_markup:cancelKb}); break;
      case "⚙️ تنظیمات": setState(adminId,"welcome_text"); await ctx.replyWithHTML(`متن پیام خوش‌آمد (از {name} برای نام):\n\nفعلی: <code>${s.welcomeText.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</code>`,{reply_markup:cancelKb}); break;
      case "🔧 حالت تعمیر": { const nv=!s.maintenanceMode; await setSetting("maintenance_mode",String(nv)); await ctx.replyWithHTML(`🔧 حالت تعمیر: ${nv?"🔴 فعال":"🟢 غیرفعال"}`,{reply_markup:ADMIN_MENU}); break; }
      case "🔙 بازگشت به منوی اصلی": clearState(adminId); await ctx.replyWithHTML("منوی اصلی",{reply_markup:mainMenu(s)}); break;
    }
  }

  async function handleAdminStep(ctx, text, state, adminId, bot) {
    const s = await getSettings();
    switch(state.step) {
      case "search_query": { clearState(adminId); const id2=parseInt(text,10); const r=!isNaN(id2)?await query("SELECT * FROM bot_users WHERE telegram_id=$1 LIMIT 1",[id2]):await query("SELECT * FROM bot_users WHERE username=$1 LIMIT 1",[text.replace("@","")]); if(!r.rows.length){await ctx.replyWithHTML("یافت نشد.",{reply_markup:ADMIN_MENU});return;} const u=r.rows[0]; await ctx.replyWithHTML(`👤 <b>${u.first_name}</b>\n🆔 <code>${u.telegram_id}</code>\n📱 ${u.username?"@"+u.username:"—"}\n🪙 ${u.coins}\n${u.is_banned?"🚫 مسدود":"✅ فعال"}`,{reply_markup:ADMIN_MENU}); break; }
      case "ban_id": { const id3=parseInt(text,10); if(isNaN(id3)){await ctx.reply("آیدی نامعتبر");return;} await banUser(id3); clearState(adminId); await ctx.replyWithHTML(`✅ <code>${id3}</code> مسدود شد.`,{reply_markup:ADMIN_MENU}); break; }
      case "unban_id": { const id4=parseInt(text,10); if(isNaN(id4)){await ctx.reply("آیدی نامعتبر");return;} await unbanUser(id4); clearState(adminId); await ctx.replyWithHTML(`✅ مسدودی <code>${id4}</code> رفع شد.`,{reply_markup:ADMIN_MENU}); break; }
      case "coin_set_id": { const id5=parseInt(text,10); if(isNaN(id5)){await ctx.reply("آیدی نامعتبر");return;} setState(adminId,"coin_set_amount",{id:id5}); await ctx.replyWithHTML(`مقدار سکه برای <code>${id5}</code>:`,{reply_markup:cancelKb}); break; }
      case "coin_set_amount": { const amt=parseInt(text,10); if(isNaN(amt)){await ctx.reply("عدد نامعتبر");return;} await setCoins(state.data.id,amt); clearState(adminId); await ctx.replyWithHTML(`✅ سکه → <b>${amt}</b>`,{reply_markup:ADMIN_MENU}); break; }
      case "service_user_id": { const id6=parseInt(text,10); if(isNaN(id6)){await ctx.reply("آیدی نامعتبر");return;} setState(adminId,"service_size",{id:id6}); await ctx.replyWithHTML("حجم:\n<b>1</b>—1000MB\n<b>2</b>—2000MB\n<b>3</b>—5000MB",{reply_markup:cancelKb}); break; }
      case "service_size": {
        const m3={1:{size:1000,cost:s.pkg1000Cost},2:{size:2000,cost:s.pkg2000Cost},3:{size:5000,cost:s.pkg5000Cost}};
        const ch=m3[parseInt(text.trim())]; if(!ch){await ctx.reply("1، 2 یا 3");return;}
        const av=await getAvailableConfig(ch.size,ch.cost); clearState(adminId);
        if(!av){await ctx.replyWithHTML(`موجودی ${ch.size}MB تمام شده.`,{reply_markup:ADMIN_MENU});return;}
        await giveConfigManual(state.data.id,av.id,av.config_link,ch.size,ch.cost);
        try{await bot.telegram.sendMessage(state.data.id,`🎁 کانفیگ دستی ادمین\n📦 ${ch.size}MB\n\n<code>${av.config_link}</code>`,{parse_mode:"HTML"});}catch{}
        await ctx.replyWithHTML(`✅ کانفیگ ${ch.size}MB به <code>${state.data.id}</code> داده شد.`,{reply_markup:ADMIN_MENU}); break;
      }
      case "pkg_select_charge": {
        const n2=text.trim(); const sm2={1:1000,2:2000,3:5000}; const sz=sm2[parseInt(n2)]; if(!sz){await ctx.reply("1، 2 یا 3");return;}
        setState(adminId,"pkg_charge_links",{size:sz}); await ctx.replyWithHTML(`<b>📦 شارژ ${sz}MB</b>\n\nکانفیگ‌ها (هر خط یک لینک):`,{reply_markup:cancelKb}); break;
      }
      case "pkg_charge_links": {
        const sz2=state.data.size; const cm={1000:s.pkg1000Cost,2000:s.pkg2000Cost,5000:s.pkg5000Cost}; const cost=cm[sz2]??5;
        const links=text.split("\n").map(l=>l.trim()).filter(l=>l.length>5); clearState(adminId);
        if(!links.length){await ctx.replyWithHTML("هیچ لینکی یافت نشد.",{reply_markup:ADMIN_MENU});return;}
        for(const lk of links) await addConfigToPool(lk,sz2,cost,"admin-bot");
        await ctx.replyWithHTML(`✅ <b>${links.length}</b> کانفیگ به پکیج ${sz2}MB اضافه شد.`,{reply_markup:ADMIN_MENU}); break;
      }
      case "pkg_toggle_select": {
        const n3=text.trim(); if(!["1","2","3"].includes(n3)){await ctx.reply("1، 2 یا 3");return;}
        const km={1:"pkg1000_available",2:"pkg2000_available",3:"pkg5000_available"}; const sm3={1:1000,2:2000,3:5000}; const am2={1:s.pkg1000Available,2:s.pkg2000Available,3:s.pkg5000Available};
        await setSetting(km[n3],String(!am2[parseInt(n3)])); clearState(adminId);
        await ctx.replyWithHTML(`✅ پکیج ${sm3[n3]}MB: ${!am2[parseInt(n3)]?"🟢 فعال":"🔴 غیرفعال"}`,{reply_markup:ADMIN_MENU}); break;
      }
      case "welcome_text": { await setSetting("welcome_text",text); clearState(adminId); await ctx.replyWithHTML("✅ متن ذخیره شد.",{reply_markup:ADMIN_MENU}); break; }
      case "broadcast_text": {
        const users=await query("SELECT telegram_id FROM bot_users LIMIT 100000"); clearState(adminId);
        await ctx.replyWithHTML(`📣 در حال ارسال به <b>${users.rows.length}</b> کاربر...`,{reply_markup:ADMIN_MENU});
        let sent=0,failed=0;
        for(const u of users.rows){try{await bot.telegram.sendMessage(u.telegram_id,text,{parse_mode:"HTML"});sent++;}catch{failed++;}await new Promise(r=>setTimeout(r,50));}
        try{await bot.telegram.sendMessage(adminId,`✅ موفق: ${sent} | ناموفق: ${failed}`);}catch{} break;
      }
      case "msg_user_id": { const id7=parseInt(text,10); if(isNaN(id7)){await ctx.reply("آیدی نامعتبر");return;} setState(adminId,"msg_user_text",{id:id7}); await ctx.replyWithHTML(`متن برای <code>${id7}</code>:`,{reply_markup:cancelKb}); break; }
      case "msg_user_text": { try{await bot.telegram.sendMessage(state.data.id,text,{parse_mode:"HTML"});clearState(adminId);await ctx.replyWithHTML(`✅ پیام ارسال شد.`,{reply_markup:ADMIN_MENU});}catch{clearState(adminId);await ctx.replyWithHTML("ارسال ناموفق.",{reply_markup:ADMIN_MENU});} break; }
      default: clearState(adminId);
    }
  }

  async function main() {
    await initDB();
    const bot = new Telegraf(TOKEN);

    function isAdmin(ctx) { return ctx.from?.username === ADMIN_USERNAME; }

    // Register webhook with Telegram
    await bot.telegram.setWebhook(WEBHOOK_URL);
    console.log(`✅ Webhook set: ${WEBHOOK_URL}`);

    // HTTP server to receive webhook updates
    const server = http.createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200); res.end("ok"); return;
      }
      if (req.method === "POST" && req.url === WEBHOOK_PATH) {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", async () => {
          try {
            const update = JSON.parse(body);
            await bot.handleUpdate(update);
          } catch(e) { console.error("Update error:", e.message); }
          res.writeHead(200); res.end("ok");
        });
        return;
      }
      res.writeHead(404); res.end("not found");
    });

    server.listen(PORT, () => console.log(`✅ mojevpnRobot webhook server on port ${PORT}`));

    bot.start(async (ctx) => {
      if(ctx.chat?.type!=="private") return;
      const s=await getSettings();
      if(s.maintenanceMode&&!isAdmin(ctx)){await ctx.reply("🔧 ربات در حال تعمیر است.");return;}
      const sp=ctx.startPayload; let refId;
      if(sp?.startsWith("ref_")){const id2=parseInt(sp.replace("ref_",""),10);if(!isNaN(id2)&&id2!==ctx.from.id)refId=id2;}
      const ex=await getUser(ctx.from.id);
      if(!ex&&refId) pendingRefs.set(ctx.from.id,{referrerId:refId,expiry:Date.now()+3600000});
      if(!(await checkMembership(bot,ctx.from.id))){await sendJoinMsg(ctx);return;}
      await completeWelcome(ctx,bot,!ex);
    });

    bot.action("verify_join",async(ctx)=>{
      if(!(await checkMembership(bot,ctx.from.id))){await ctx.answerCbQuery("هنوز عضو نشدی!",{show_alert:true});return;}
      await ctx.answerCbQuery("عضویت تأیید شد!"); await ctx.deleteMessage().catch(()=>{});
      const ex=await getUser(ctx.from.id); await completeWelcome(ctx,bot,!ex);
    });

    bot.command("admin",async(ctx)=>{
      if(!isAdmin(ctx)){await ctx.reply("دسترسی ندارید.");return;}
      const stats=await getTotalStats();
      await ctx.replyWithHTML(`<b>🔴 پنل مدیریت</b>\n\n👥 ${stats.totalUsers} | 📦 ${stats.totalConfigsGiven} | 📥 ${stats.availableInPool}`,{reply_markup:ADMIN_MENU});
    });

    bot.on("text",async(ctx)=>{
      if(ctx.chat?.type!=="private") return;
      const text=ctx.message.text; const uid=ctx.from.id; const s=await getSettings();
      if(isAdmin(ctx)){
        if(text===CANCEL){clearState(uid);await ctx.replyWithHTML("لغو شد.",{reply_markup:ADMIN_MENU});return;}
        if(text==="🔙 بازگشت به منوی اصلی"){clearState(uid);await ctx.replyWithHTML("منوی اصلی",{reply_markup:mainMenu(s)});return;}
        if(ADMIN_BTNS.has(text)){await handleAdminBtn(ctx,text,uid);return;}
        const st=states.get(uid); if(st&&st.step!=="idle"){await handleAdminStep(ctx,text,st,uid,bot);return;}
      }
      if(s.maintenanceMode&&!isAdmin(ctx)){await ctx.reply("🔧 ربات در حال تعمیر است.");return;}
      if(!(await checkMembership(bot,uid))){await sendJoinMsg(ctx);return;}
      const user=await getUser(uid);
      if(!user){await ctx.reply("برای شروع /start را بزنید.");return;}
      if(user.is_banned){await ctx.reply("حساب شما مسدود شده است.");return;}
      if(text===s.btnGetConfig){
        const [a1,a2,a5]=await Promise.all([countAvailable(1000),countAvailable(2000),countAvailable(5000)]);
        await ctx.replyWithHTML(`📦 <b>دریافت کانفیگ</b>\n\n🪙 موجودی: <b>${user.coins} سکه</b>\n\n🟢 موجود  🔴 ناموجود`,{reply_markup:pkgMenu(user.coins,{p1000:a1,p2000:a2,p5000:a5},s)}); return;
      }
      if(text===s.btnMyConfigs){
        const configs=await getUserConfigs(uid);
        if(!configs.length){await ctx.replyWithHTML(`📋 هنوز کانفیگی دریافت نکرده‌اید.`,{reply_markup:mainMenu(s)});return;}
        const lt=configs[0]; const d2=new Date(lt.received_at); const dd=`${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,"0")}-${String(d2.getDate()).padStart(2,"0")}`;
        await ctx.replyWithHTML(`📋 <b>آخرین کانفیگ</b>\n\n📦 ${lt.package_size_mb}MB\n🗓 ${dd}\n\n🌐 لینک:\n<code>${lt.config_link}</code>\n\n👇 مجموع: <b>${configs.length}</b>`,{reply_markup:mainMenu(s)}); return;
      }
      if(text===s.btnAccount){
        const [rc,cc]=await Promise.all([getReferralCount(uid),getUserConfigs(uid).then(r=>r.length)]);
        await ctx.replyWithHTML(`👤 <b>حساب کاربری</b>\n━━━━━━━━━━━━━━━\n🪪 ${user.first_name}\n🆔 ${user.telegram_id}\n━━━━━━━━━━━━━━━\n🪙 سکه: <b>${user.coins}</b>\n👥 دعوت‌شدگان: <b>${rc}</b>\n📦 کانفیگ‌ها: <b>${cc}</b>\n━━━━━━━━━━━━━━━`,{reply_markup:mainMenu(s)}); return;
      }
      if(text===s.btnReferrals){
        const info=await bot.telegram.getMe(); const rl=`https://t.me/${info.username}?start=ref_${uid}`; const rc2=await getReferralCount(uid);
        await ctx.replyWithHTML(`👥 <b>دعوت و کسب سکه</b>\n\n🎁 به ازای هر دوست: <b>${s.coinPerReferral} سکه</b>\n🪙 دعوت‌های شما: <b>${rc2} نفر</b>\n━━━━━━━━━━━━━━━\n👇 لینک دعوت:\n<code>${rl}</code>\n━━━━━━━━━━━━━━━`,{reply_markup:mainMenu(s)}); return;
      }
      await ctx.replyWithHTML("از منوی زیر انتخاب کنید:",{reply_markup:mainMenu(s)});
    });

    for(const [cb,sizeMb,ck,ak] of [["pkg_1000",1000,"pkg1000Cost","pkg1000Available"],["pkg_2000",2000,"pkg2000Cost","pkg2000Available"],["pkg_5000",5000,"pkg5000Cost","pkg5000Available"]]) {
      bot.action(cb,async(ctx)=>{
        const s2=await getSettings(); const cost=s2[ck]; const user=await getUser(ctx.from.id);
        if(!user){await ctx.answerCbQuery("ابتدا /start را بزنید.",{show_alert:true});return;}
        if(user.is_banned){await ctx.answerCbQuery("حساب شما مسدود شده.",{show_alert:true});return;}
        if(!s2[ak]){await ctx.answerCbQuery(`پکیج ${sizeMb}MB موجود نیست.`,{show_alert:true});return;}
        if(user.coins<cost){await ctx.answerCbQuery(`موجودی ناکافی! دارید: ${user.coins} — نیاز: ${cost}`,{show_alert:true});return;}
        const av2=await getAvailableConfig(sizeMb,cost);
        if(!av2){await ctx.answerCbQuery(`موجودی ${sizeMb}MB تمام شده.`,{show_alert:true});return;}
        await giveConfig(ctx.from.id,av2.id,av2.config_link,sizeMb,cost);
        await ctx.answerCbQuery("کانفیگ دریافت شد!");
        const uu=await getUser(ctx.from.id); const [a1,a2,a5]=await Promise.all([countAvailable(1000),countAvailable(2000),countAvailable(5000)]);
        await ctx.replyWithHTML(`✅ <b>دریافت موفق!</b>\n\n📦 ${sizeMb}MB\n🪙 کسر: ${cost} | باقی: <b>${uu?.coins??0}</b>\n\n🌐 کانفیگ:\n<code>${av2.config_link}</code>`,{reply_markup:pkgMenu(uu?.coins??0,{p1000:a1,p2000:a2,p5000:a5},s2)});
      });
    }

    process.once("SIGINT",()=>{server.close();});
    process.once("SIGTERM",()=>{server.close();});
  }

  main().catch(e=>{console.error(e);process.exit(1);});
  