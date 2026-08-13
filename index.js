const ADMIN_IDS = [8937000337];
const CARD_NUMBER = "4874 1000 1021 2549"; // 💳 ВПИШИ СЮДА СВОЮ КАРТУ ДЛЯ ОПЛАТЫ!
const VIP_PRICE = "150 грн"; // 💰 Впиши цену подписки

const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const { OpenAI } = require('openai');

const bot = new Telegraf(process.env.BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const db = new sqlite3.Database('./database.sqlite');
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Love-Bot is running!');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

// Инициализация БД
async function initDb() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT,
      age INTEGER,
      photo TEXT,
      username TEXT,
      step TEXT
    )
  `);

  try { await dbRun(`ALTER TABLE users ADD COLUMN is_vip INTEGER DEFAULT 0`); } catch (e) {}
  try { await dbRun(`ALTER TABLE users ADD COLUMN likes_left INTEGER DEFAULT 5`); } catch (e) {}

  await dbRun(`
    CREATE TABLE IF NOT EXISTS likes (
      from_user_id INTEGER,
      to_user_id INTEGER,
      PRIMARY KEY (from_user_id, to_user_id)
    )
  `);

  console.log('База данных готова! 📦');
}

// Показ Главного Меню
function showMainMenu(ctx) {
  ctx.reply(
    'Главное меню 💘',
    Markup.keyboard([
      ['🔥 Смотреть анкеты', '💌 Кто меня лайкнул'],
      ['👤 Мой профиль', '👑 Купить VIP'],
      ['📝 Заполнить заново']
    ]).resize()
  );
}

// Показ анкеты с кнопкой ИИ-Подката
async function showNextProfile(ctx) {
  const userId = ctx.from.id;

  const candidate = await dbGet(`
    SELECT * FROM users 
    WHERE id != ? AND photo IS NOT NULL AND id NOT IN (
      SELECT to_user_id FROM likes WHERE from_user_id = ?
    )
    ORDER BY RANDOM()
    LIMIT 1
  `, [userId, userId]);

  if (!candidate) {
    return ctx.reply('Новых анкет пока нет! Позови друзей в бота 😉');
  }

  ctx.replyWithPhoto(candidate.photo, {
    caption: `🔥 **${candidate.name}, ${candidate.age}**`,
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('❌ Дизлайк', `dislike_${candidate.id}`),
        Markup.button.callback('❤️ Лайк', `like_${candidate.id}`)
      ],
      [
        Markup.button.callback('✨ Генератор подката (AI)', `ai_pickup_${candidate.id}`)
      ]
    ])
  });
}

// Старт (со сбросом шага)
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const username = ctx.from.username ? `@${ctx.from.username}` : 'без юзернейма';

  await dbRun(
    `INSERT OR IGNORE INTO users (id, username, step, is_vip, likes_left) VALUES (?, ?, ?, 0, 5)`,
    [userId, username, 'WAITING_NAME']
  );

  await dbRun(`UPDATE users SET step = 'WAITING_NAME' WHERE id = ?`, [userId]);

  ctx.reply(`Привет, ${ctx.from.first_name}! 💕 Добро пожаловать в Love-Bot!\n\nДавай создадим твою анкету. Как тебя зовут?`);
});

// ==================== 👑 АДМИН-КОМАНДА ====================
bot.command('admin', async (ctx) => {
  console.log('ID отправителя:', ctx.from.id);
  
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply(`⛔ Доступ запрещен! Твой ID: ${ctx.from.id}`);
  }
  ctx.reply(
    '👑 **Панель Администратора**',
    Markup.inlineKeyboard([
      [Markup.button.callback('📊 Статистика', 'admin_stats')],
      [Markup.button.callback('📢 Сделать рассылку', 'admin_broadcast')]
    ])
  );
});

// Текстовые команды
bot.on('text', async (ctx) => {
  const userId = ctx.from.id;
  const text = ctx.message.text;
  const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [userId]);

  // 📢 ОБРАБОТКА РАССЫЛКИ ОТ АДМИНА
  if (user && user.step === 'WAITING_BROADCAST' && ADMIN_IDS.includes(userId)) {
    await dbRun(`UPDATE users SET step = 'COMPLETED' WHERE id = ?`, [userId]);
    
    const allUsers = await dbAll(`SELECT id FROM users`);
    let successCount = 0;

    ctx.reply(`🚀 Запускаю рассылку для ${allUsers.length} пользователей...`);

    for (let u of allUsers) {
      try {
        await bot.telegram.sendMessage(u.id, text);
        successCount++;
      } catch (err) {
        // Юзер заблокировал бота
      }
    }

    return ctx.reply(`✅ Рассылка завершена! Успешно доставлено: ${successCount}/${allUsers.length}`);
  }

  if (text === '📝 Заполнить заново') {
    await dbRun(`UPDATE users SET step = 'WAITING_NAME' WHERE id = ?`, [userId]);
    return ctx.reply('Начнем сначала! Как тебя зовут?');
  }

  if (user && user.step === 'WAITING_NAME') {
    await dbRun(`UPDATE users SET name = ?, step = 'WAITING_AGE' WHERE id = ?`, [text, userId]);
    return ctx.reply(`Отлично, ${text}! Сколько тебе лет?`);
  }

  if (user && user.step === 'WAITING_AGE') {
    if (isNaN(text)) return ctx.reply('Введи возраст цифрами!');
    await dbRun(`UPDATE users SET age = ?, step = 'WAITING_PHOTO' WHERE id = ?`, [text, userId]);
    return ctx.reply('Супер! Теперь **отправь своё фото** 📸');
  }

  if (text === '👤 Мой профиль') {
    if (user && user.photo) {
      const vipStatus = user.is_vip ? '👑 VIP Статус (Безлимит)' : `Обычный (Осталось лайков: ${user.likes_left ?? 5})`;
      ctx.replyWithPhoto(user.photo, {
        caption: `📋 **Твой профиль:**\n👤 **Имя:** ${user.name}\n🎂 **Возраст:** ${user.age}\n💎 **Статус:** ${vipStatus}`
      });
    } else {
      ctx.reply('Анкета не заполнена. Нажми /start');
    }
  }

  if (text === '👑 Купить VIP') {
    ctx.reply(
      `👑 **VIP Подписка дает:**\n\n` +
      `✨ **Безлимитные лайки**\n` +
      `💌 **Просмотр тех, кто тебя лайкнул**\n` +
      `🔥 **Приоритет вашей анкеты в поиске**\n\n` +
      `💳 **Стоимость:** ${VIP_PRICE}\n\n` +
      `Для покупки нажмите кнопку ниже 👇`,
      Markup.inlineKeyboard([
        [Markup.button.callback('💳 Оплатить картой', 'buy_vip_card')]
      ])
    );
  }

  if (text === '💌 Кто меня лайкнул') {
    if (!user || !user.is_vip) {
      return ctx.reply('🔒 Смотреть, кто тебя лайкнул, могут только **VIP-пользователи**! Нажми «👑 Купить VIP», чтобы открыть доступ.');
    }

    const admirers = await dbAll(`
      SELECT * FROM users WHERE id IN (
        SELECT from_user_id FROM likes WHERE to_user_id = ?
      )
    `, [userId]);

    if (admirers.length === 0) {
      return ctx.reply('Тебя пока никто не лайкнул. Попробуй обновить анкету или подожди чуть-чуть! 😉');
    }

    ctx.reply(`💌 **Тебя лайкнули эти люди (${admirers.length}):**`);
    for (let adm of admirers) {
      await ctx.replyWithPhoto(adm.photo, {
        caption: `🔥 **${adm.name}, ${adm.age}**\n👉 Написать: ${adm.username}`
      });
    }
  }

  if (text === '🔥 Смотреть анкеты') {
    showNextProfile(ctx);
  }
});

// 📸 ОБРАБОТКА ФОТО (Анкета + Чек Оплаты)
bot.on('photo', async (ctx) => {
  const userId = ctx.from.id;
  const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [userId]);

  // Если юзер отправляет фото анкеты
  if (user && user.step === 'WAITING_PHOTO') {
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await dbRun(`UPDATE users SET photo = ?, step = 'COMPLETED' WHERE id = ?`, [photoId, userId]);

    ctx.reply('Ура! Твоя анкета готова 🎉');
    showMainMenu(ctx);
    return;
  }

  // 💳 Если юзер отправляет скриншот чека оплаты VIP
  if (user && user.step === 'WAITING_PAYMENT_CHECK') {
    const photoId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await dbRun(`UPDATE users SET step = 'COMPLETED' WHERE id = ?`, [userId]);

    ctx.reply('✅ **Чек получен!** Администратор проверит перевод и активирует VIP в течение нескольких минут.');

    // Отправляем чек админам
    for (let adminId of ADMIN_IDS) {
      try {
        await bot.telegram.sendPhoto(adminId, photoId, {
          caption: `💰 **НОВЫЙ ЧЕК НА ОПЛАТУ VIP!**\n\n👤 Пользователь: ${user.name} (${user.username})\n🆔 ID: \`${userId}\``,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [
              Markup.button.callback('✅ Выдать VIP', `approve_vip_${userId}`),
              Markup.button.callback('❌ Отклонить', `reject_vip_${userId}`)
            ]
          ])
        });
      } catch (err) {
        console.error('Ошибка отправки админу:', err);
      }
    }
  }
});

// 💳 ИНСТРУКЦИЯ ПО ОПЛАТЕ
bot.action('buy_vip_card', async (ctx) => {
  const userId = ctx.from.id;
  await dbRun(`UPDATE users SET step = 'WAITING_PAYMENT_CHECK' WHERE id = ?`, [userId]);

  await ctx.answerCbQuery();
  ctx.reply(
    `💳 **Инструкция по оплате:**\n\n` +
    `1️⃣ Переведите **${VIP_PRICE}** на карту:\n\`${CARD_NUMBER}\` *(нажмите для копирования)*\n\n` +
    `2️⃣ Сделайте **скриншот чека** или квитанции.\n\n` +
    `3️⃣ **Отправьте скриншот прямо в этот чат** ответным сообщением! 📸`,
    { parse_mode: 'Markdown' }
  );
});

// ✅ ПОДТВЕРЖДЕНИЕ VIP АДМИНОМ
bot.action(/^approve_vip_(\d+)$/, async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;

  const targetUserId = parseInt(ctx.match[1]);
  await dbRun(`UPDATE users SET is_vip = 1 WHERE id = ?`, [targetUserId]);

  await ctx.answerCbQuery('VIP активирован!');
  await ctx.editMessageCaption(ctx.callbackQuery.message.caption + '\n\n✅ **ОДОБРЕНО (VIP ВЫДАН)**');

  // Уведомляем пользователя
  try {
    await bot.telegram.sendMessage(targetUserId, '🎉 **Ура! Ваш чек проверен, VIP-статус успешно активирован!** Приятных знакомств! 💘');
  } catch (e) {}
});

// ❌ ОТКЛОНЕНИЕ ЧЕКА АДМИНОМ
bot.action(/^reject_vip_(\d+)$/, async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;

  const targetUserId = parseInt(ctx.match[1]);

  await ctx.answerCbQuery('Отклонено');
  await ctx.editMessageCaption(ctx.callbackQuery.message.caption + '\n\n❌ **ОТКЛОНЕНО**');

  try {
    await bot.telegram.sendMessage(targetUserId, '⚠️ Ваш платеж не найден или чек недействителен. Если произошла ошибка, свяжитесь с поддержкой.');
  } catch (e) {}
});

// ОБРАБОТКА КНОПКИ ИИ-ПОДКАТА
bot.action(/^ai_pickup_(\d+)$/, async (ctx) => {
  const targetUserId = parseInt(ctx.match[1]);
  const targetUser = await dbGet(`SELECT * FROM users WHERE id = ?`, [targetUserId]);

  if (!targetUser) return ctx.answerCbQuery('Анкета не найдена');

  ctx.answerCbQuery('🤖 ИИ придумывает подкат...');
  const waitMsg = await ctx.reply(`🧠 *ChatGPT придумывает идеальный подкат для ${targetUser.name}...*`, { parse_mode: 'Markdown' });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Ты опытный и харизматичный пикап-мастер. Напиши короткий, оригинальный, милый и слегка дерзкий подкат для знакомства в Telegram.'
        },
        {
          role: 'user',
          content: `Придумай подкат для человека по имени ${targetUser.name}, которому ${targetUser.age} лет.`
        }
      ],
      max_tokens: 100
    });

    const pickupLine = response.choices[0].message.content;

    try { await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch(e){}

    ctx.reply(
      `💡 **ИИ-Подкат для ${targetUser.name}:**\n\n«${pickupLine}»\n\nСкопируй и напиши лично: ${targetUser.username}`
    );
  } catch (error) {
    console.error('Ошибка OpenAI:', error);
    try { await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch(e){}
    ctx.reply('⚠️ Ошибка ИИ (проверь API Key или лимиты OpenAI). Но ты всё равно можешь просто написать привет!');
  }
});

// Лайк
bot.action(/^like_(\d+)$/, async (ctx) => {
  const fromUserId = ctx.from.id;
  const toUserId = parseInt(ctx.match[1]);
  const user = await dbGet(`SELECT * FROM users WHERE id = ?`, [fromUserId]);

  if (!user.is_vip && (user.likes_left ?? 5) <= 0) {
    ctx.answerCbQuery('Лимит лайков исчерпан!');
    return ctx.reply('⚠️ **У тебя закончились лайки на сегодня!**', Markup.inlineKeyboard([
      [Markup.button.callback('💳 Купить VIP', 'buy_vip_card')]
    ]));
  }

  if (!user.is_vip) {
    await dbRun(`UPDATE users SET likes_left = COALESCE(likes_left, 5) - 1 WHERE id = ?`, [fromUserId]);
  }

  ctx.answerCbQuery('❤️ Лайк отправлен!');
  await dbRun(`INSERT OR IGNORE INTO likes (from_user_id, to_user_id) VALUES (?, ?)`, [fromUserId, toUserId]);

  const mutualLike = await dbGet(
    `SELECT * FROM likes WHERE from_user_id = ? AND to_user_id = ?`,
    [toUserId, fromUserId]
  );

  if (mutualLike) {
    const me = await dbGet(`SELECT * FROM users WHERE id = ?`, [fromUserId]);
    const targetUser = await dbGet(`SELECT * FROM users WHERE id = ?`, [toUserId]);

    ctx.reply(`🎉 **У ВАС СОВПАДЕНИЕ (MATCH)!**\n\nНапиши прямо сейчас: ${targetUser.username}`);
    bot.telegram.sendMessage(toUserId, `🎉 **У ВАС СОВПАДЕНИЕ (MATCH)!**\n\nНапиши: ${me.username}`);
  }

  try { await ctx.deleteMessage(); } catch (e) {}
  showNextProfile(ctx);
});

// Дизлайк
bot.action(/^dislike_(\d+)$/, async (ctx) => {
  const fromUserId = ctx.from.id;
  const toUserId = parseInt(ctx.match[1]);

  ctx.answerCbQuery('❌ Пропущено');
  await dbRun(`INSERT OR IGNORE INTO likes (from_user_id, to_user_id) VALUES (?, ?)`, [fromUserId, toUserId]);

  try { await ctx.deleteMessage(); } catch (e) {}
  showNextProfile(ctx);
});

// 📊 ВЫВОД СТАТИСТИКИ
bot.action('admin_stats', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;

  const totalUsers = await dbGet(`SELECT COUNT(*) as count FROM users`);
  const activeProfiles = await dbGet(`SELECT COUNT(*) as count FROM users WHERE photo IS NOT NULL`);
  const totalLikes = await dbGet(`SELECT COUNT(*) as count FROM likes`);
  const vipUsers = await dbGet(`SELECT COUNT(*) as count FROM users WHERE is_vip = 1`);

  const statsMessage = 
    `📊 **Статистика бота:**\n\n` +
    `👤 **Всего юзеров:** ${totalUsers.count}\n` +
    `🖼 **Заполненных анкет:** ${activeProfiles.count}\n` +
    `❤️ **Поставлено лайков:** ${totalLikes.count}\n` +
    `👑 **VIP-пользователей:** ${vipUsers.count}`;

  await ctx.answerCbQuery();
  ctx.reply(statsMessage, { parse_mode: 'Markdown' });
});

// 📢 КНОПКА ЗАПУСКА РАССЫЛКИ
bot.action('admin_broadcast', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;

  await dbRun(`UPDATE users SET step = 'WAITING_BROADCAST' WHERE id = ?`, [ctx.from.id]);
  await ctx.answerCbQuery();
  ctx.reply('✍️ Введи текст рассылки, который улетит всем пользователям бота:');
});

// Запуск
initDb().then(() => {
  bot.launch();
  console.log('Love-Bot полностью готов к запуску! 🚀');
}).catch(err => console.error('Ошибка БД:', err));
