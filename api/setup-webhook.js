
const APP_URL =
  process.env.APP_URL ||
  "https://pvt-ltd-ruddy.vercel.app";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET;

const SETUP_KEY =
  process.env.SETUP_KEY;

function sendJSON(res, status, data) {
  res.status(status);
  res.setHeader(
    "Content-Type",
    "application/json"
  );
  res.end(JSON.stringify(data));
}

async function telegramAPI(method, payload) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      result.description ||
      `Telegram ${method} failed`
    );
  }

  return result.result;
}

export default async function handler(req, res) {
  if (
    req.method !== "GET" &&
    req.method !== "POST"
  ) {
    return sendJSON(res, 405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    if (
      !TELEGRAM_BOT_TOKEN ||
      !TELEGRAM_WEBHOOK_SECRET ||
      !SETUP_KEY
    ) {
      return sendJSON(res, 500, {
        ok: false,
        error: "Missing environment variables"
      });
    }

    const providedKey =
      req.headers["x-setup-key"] ||
      req.query?.key ||
      req.body?.key;

    if (providedKey !== SETUP_KEY) {
      return sendJSON(res, 403, {
        ok: false,
        error: "Unauthorized"
      });
    }

    const webhookURL =
      APP_URL.replace(/\/$/, "") +
      "/api/telegram-webhook";

    const setupResult = await telegramAPI(
      "setWebhook",
      {
        url: webhookURL,
        secret_token:
          TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: [
          "chat_join_request",
          "chat_member"
        ],
        drop_pending_updates: false
      }
    );

    const webhookInfo = await telegramAPI(
      "getWebhookInfo",
      {}
    );

    return sendJSON(res, 200, {
      ok: true,
      message:
        "Telegram webhook configured successfully",
      webhook_url: webhookURL,
      setup_result: setupResult,
      webhook_info: {
        url: webhookInfo.url,
        pending_update_count:
          webhookInfo.pending_update_count,
        last_error_message:
          webhookInfo.last_error_message || null,
        allowed_updates:
          webhookInfo.allowed_updates || []
      }
    });

  } catch (error) {
    console.error(
      "Webhook setup error:",
      error
    );

    return sendJSON(res, 500, {
      ok: false,
      error: error.message
    });
  }
}
