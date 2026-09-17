import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Bot, InputFile, InlineKeyboard } from "grammy";
import { b, fmt, u, i } from "@grammyjs/parse-mode";
import { ProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from "undici";

import { createImage } from "./generator.js";
import { readBarcode } from "./barcode.js";
import messages from "./messages.json" with { type: "json" };

const BOT_TOKEN = process.env.TG_TOKEN || process.env.TOKEN;
if (!BOT_TOKEN) {
  throw new Error("Missing TG_TOKEN or TOKEN in environment variables");
}

const TSD_ADMIN_ID = String(process.env.TSD_ADMIN_ID || "").trim();
const DEFAULT_DATA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "storage.json");
const DATA_FILE = path.resolve(String(process.env.LOKALKA_DATA_FILE || DEFAULT_DATA_FILE).trim());

const TSD_PROXY = String(process.env.TSD_PROXY || "").trim();
let telegramFetch = null;
if (TSD_PROXY) {
  const proxyAgent = new ProxyAgent(TSD_PROXY.replace(/^socks5h:\/\//i, "socks5://"));
  setGlobalDispatcher(proxyAgent);
  telegramFetch = (url, options = {}) => {
    const { agent, compress, signal, ...fetchOptions } = options || {};
    let nativeSignal = signal;
    if (signal && !(signal instanceof AbortSignal)) {
      const controller = new AbortController();
      nativeSignal = controller.signal;
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
      }
    }
    return undiciFetch(url, { ...fetchOptions, signal: nativeSignal, dispatcher: proxyAgent });
  };
  console.log(`Proxy enabled via TSD_PROXY`);
}

function withTimeout(promise, ms, stage) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms during ${stage}`));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const formatDate = () => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  return `${dd}.${mm}.${yy}`;
};

const logUserAction = (ctx, action, data = {}) => {
  const user = ctx.from;
  const username = user?.username || [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "-";
  const userId = user?.id ?? "-";
  const timestamp = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
  const payload = typeof data === "string" ? data : JSON.stringify(data);

  console.log(`[${timestamp}][${username}][${userId}] ${action}, ${payload}`);
};

const parseCaptionPrice = (caption) => {
  const match = caption?.match(/(\d+,\d{2})/);
  return match ? match[1] : null;
};

const extractProductNameFromHtml = (html) => {
  if (!html) return "";

  const rowMarker = "<tr bgcolor=#e0e8f2 valign=top>";
  const cellMarker = '<td><font style="font-size:14px;" color=#383838>';

  const rowStart = html.indexOf(rowMarker);
  if (rowStart === -1) return "";

  const cellStart = html.indexOf(cellMarker, rowStart + rowMarker.length);
  if (cellStart === -1) return "";

  const contentStart = cellStart + cellMarker.length;
  const contentEnd = html.indexOf("</td>", contentStart);
  if (contentEnd === -1) return "";

  const rawName = html.slice(contentStart, contentEnd).trim();
  const firstVariant = rawName.split("<br>")[0]?.trim() || "";

  return firstVariant
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
};

const fetchProductName = async (code128) => {
  return ""; // Disabled fetching product name due to site restrictions
};

const buildPayload = async (result, caption) => {
  if (result.format === "11") {
    const parts = result.data.split(";");
    const code = parts[1];
    const price = parts[2];
    if (!code || !price) return null;

    const name = await fetchProductName(code);

    return {
      code128: code,
      qr: result.data.slice(0, -8) + formatDate(),
      data: { code, price },
      name: name || null,
    };
  }

  if (result.format === "7") {
    const price = parseCaptionPrice(caption);
    if (!price) return null;

    // const name = await fetchProductName(result.data);

    return {
      code128: result.data,
      qr: `CEN;${result.data};${price.replace(",", ".")};1;13;${formatDate()}`,
      data: { code: result.data, price },
      // name: name || null,
      name: null, // Disabled fetching product name due to site restrictions
    };
  }

  return null;
};

const bot = new Bot(BOT_TOKEN, telegramFetch ? { client: { fetch: telegramFetch } } : undefined);

const isAdminUser = (ctx) => Boolean(TSD_ADMIN_ID && String(ctx.from?.id || "") === TSD_ADMIN_ID);

const formatStatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
};

const isDateInRange = (value, startIso, endIso) => {
  const ts = Date.parse(String(value || ""));
  const startTs = Date.parse(String(startIso || ""));
  const endTs = Date.parse(String(endIso || ""));
  if (Number.isNaN(ts) || Number.isNaN(startTs) || Number.isNaN(endTs)) return false;
  return ts >= startTs && ts <= endTs;
};

const loadStorage = async () => JSON.parse(await readFile(DATA_FILE, "utf8"));

const buildReferralStatsText = async () => {
  const storage = await loadStorage();
  const users = Array.isArray(storage.users) ? storage.users : [];
  const recounts = Array.isArray(storage.recounts) ? storage.recounts : [];
  const codes = Array.isArray(storage.referrals?.codes) ? storage.referrals.codes : [];
  const activations = Array.isArray(storage.referrals?.activations) ? storage.referrals.activations : [];
  const usersById = new Map(users.map((user) => [String(user.id), user]));
  const activationGroups = new Map();

  for (const activation of activations) {
    const ownerUserId = String(activation.ownerUserId || "");
    if (!activationGroups.has(ownerUserId)) activationGroups.set(ownerUserId, []);
    activationGroups.get(ownerUserId).push(activation);
  }

  const owners = codes
    .map((code) => {
      const owner = usersById.get(String(code.ownerUserId)) || null;
      const ownerActivations = activationGroups.get(String(code.ownerUserId)) || [];
      const completedRecounts = ownerActivations.reduce((total, activation) => {
        return total + recounts.filter((recount) => (
          String(recount.userId) === String(activation.activatedUserId)
          && recount.status === "completed"
          && isDateInRange(recount.completedAt, activation.activatedAt, activation.trialUntil)
        )).length;
      }, 0);
      const lastActivation = ownerActivations
        .slice()
        .sort((left, right) => String(right.activatedAt || "").localeCompare(String(left.activatedAt || "")))[0] || null;

      return {
        code,
        owner,
        activations: ownerActivations,
        completedRecounts,
        lastActivation
      };
    })
    .sort((left, right) => right.activations.length - left.activations.length || String(left.owner?.login || "").localeCompare(String(right.owner?.login || "")));

  const referredUserIds = new Set(activations.map((activation) => String(activation.activatedUserId || "")).filter(Boolean));
  const lines = [
    "Статистика реферальных ссылок",
    `Пользователей всего: ${users.length}`,
    `С реферальной активацией: ${referredUserIds.size}`,
    `Активаций всего: ${activations.length}`,
    `Владельцев кодов: ${codes.length}`,
    ""
  ];

  if (!owners.length) {
    lines.push("Реферальных кодов пока нет.");
    return lines.join("\n");
  }

  owners.forEach((item, index) => {
    const ownerLogin = item.owner?.login || item.code.ownerUserId || "-";
    const status = item.code.revokedAt ? "отозван" : "активен";
    const lastUser = usersById.get(String(item.lastActivation?.activatedUserId || ""));
    lines.push(
      `${index + 1}. ${ownerLogin} — ${item.code.code} (${status})`,
      `   Зарегистрировалось: ${item.activations.length}`,
      `   Завершенных просчетов на пробном доступе: ${item.completedRecounts}`,
      `   Последняя активация: ${item.lastActivation ? `${lastUser?.login || item.lastActivation.activatedUserId} — ${formatStatDate(item.lastActivation.activatedAt)}` : "-"}`
    );
  });

  return lines.join("\n");
};

const replyLongText = async (ctx, text) => {
  const chunks = [];
  let chunk = "";
  for (const line of text.split("\n")) {
    if (`${chunk}\n${line}`.length > 3500) {
      chunks.push(chunk);
      chunk = line;
    } else {
      chunk = chunk ? `${chunk}\n${line}` : line;
    }
  }
  if (chunk) chunks.push(chunk);
  for (const part of chunks) await ctx.reply(part);
};

bot.catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`Bot update error: ${message}`);
});

// bot.on("message", (ctx) => {
//   if (ctx.message.text) {
//     logUserAction(ctx, "message", { text: ctx.message.text });
//   }
// });

await bot.api.setMyCommands([
  { command: "start", description: "Поехали" },
  { command: "photo", description: "Открыть фотоотчет" },
  { command: "refstats", description: "Статистика реферальных ссылок" },
]);

bot.command("start", (ctx) => {
  const combined = fmt`${b}Привет!${b}\nЧтобы сгенерировать изображение, отправь одно из фото:\n- с QR-кодом ценника\n- со штрихкодом товара, подписав цену в формате 99,99`;
  ctx.reply(combined.text, { entities: combined.entities });
  logUserAction(ctx, "👋 start");
});
bot.command("photo", (ctx) => {
  const combined = fmt`${b}Фотоотчет${b}\nОтправьте номер магазина, чтобы получить ссылку на фотоотчет.`;
  ctx.reply(combined.text, { entities: combined.entities });
  logUserAction(ctx, "📷 photo_report");
});
bot.command(["refstats", "stats"], async (ctx) => {
  if (!isAdminUser(ctx)) {
    logUserAction(ctx, "refstats_denied");
    return ctx.reply("Недостаточно прав.");
  }

  try {
    const text = await buildReferralStatsText();
    logUserAction(ctx, "refstats_view");
    return replyLongText(ctx, text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Referral stats error: ${message}`);
    return ctx.reply("Не удалось собрать статистику реферальных ссылок.");
  }
});

bot.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo?.at(-1);
  if (!photo) return;

  logUserAction(ctx, "📩 photo_received", {
    caption: ctx.message.caption || null,
  });

  const file = await ctx.api.getFile(photo.file_id);
  if (!file.file_path) {
    logUserAction(ctx, "❌ photo_file_error", { reason: "getFile failed" });
    await ctx.react("👎");
    return ctx.reply(messages.errors.photo_file_error);
  }

  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  const response = await (telegramFetch || fetch)(url);
  if (!response.ok) {
    logUserAction(ctx, "❌ photo_file_error", { reason: `download failed: ${response.status}` });
    await ctx.react("👎");
    return ctx.reply(messages.errors.photo_file_error);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());

  const barcodeResult = await readBarcode(imageBuffer);
  if (!barcodeResult) {
    logUserAction(ctx, "📵 barcode_not_found");
    await ctx.react("👎");
    return ctx.reply(messages.errors.barcode_not_found);
  }

  logUserAction(ctx, "🫆  barcode_detected", {
    format: barcodeResult.format === "7"
        ? "code128"
        : "QR",
    data: barcodeResult.data,
  });

  const payload = await buildPayload(barcodeResult, ctx.message.caption);
  if (!payload) {
    logUserAction(ctx, "⚠️  payload_error", {
      reason: barcodeResult.format === "7"
        ? "missing price in caption"
        : "invalid QR payload",
    });
    await ctx.react("👎");
    const errorMessage = barcodeResult.format === "7"
      ? messages.errors.payload_error_barcode
      : messages.errors.payload_error_qr;
    return ctx.reply(errorMessage);
  }

  // logUserAction(ctx, "payload_ready", payload);
  const image = await createImage(payload);

  await ctx.react("👍");
  logUserAction(ctx, "📨 photo_sent", { file_name: "code.png" });
  return ctx.replyWithPhoto(new InputFile(image, "code.png"));
});

bot.hears(/^[0-9]+$/, async (ctx) => {
  const shop_id = ctx.message.text
  const url = `https://aezee2quee.rw.org/?shop_id=${shop_id}`;
  const keyboard = new InlineKeyboard().url("Перейти на градусник", url);

  const combined = fmt`${b}Фотоотчет для магазина ${shop_id}${b}\n- Подключитесь к Wi-Fi сети магазина\n- Отключите VPN и прокси\n- Нажмите кнопку ниже`;
  ctx.reply(combined.text, { entities: combined.entities, reply_markup: keyboard });
  ctx.react("👍");
  logUserAction(ctx, "🔗 photo_report_link", { shop_id });
});

try {
  console.log("Bot startup: getMe...");
  const me = await withTimeout(bot.api.getMe(), 15000, "getMe");
  console.log(`Authorized as @${me.username || me.id}`);

  // Ensure long polling works even if webhook had been configured earlier.
  console.log("Bot startup: deleteWebhook...");
  await withTimeout(
    bot.api.deleteWebhook({ drop_pending_updates: false }),
    15000,
    "deleteWebhook"
  );
  console.log("Webhook cleared, starting long polling");

  await bot.start({
    onStart: (botInfo) => {
      console.log(`Long polling started for @${botInfo.username || botInfo.id}`);
    }
  });
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`Bot startup failed: ${message}`);
  process.exit(1);
}