
function json(res, status, body) {
  res
    .status(status)
    .setHeader("Content-Type", "application/json");

  res.end(JSON.stringify(body));
}

async function telegramRequest(
  method,
  body
) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing"
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const text =
    await response.text();

  let data = null;

  try {
    data =
      text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok || !data?.ok) {
    throw new Error(
      `Telegram ${method} failed: ${
        data?.description ||
        text ||
        response.status
      }`
    );
  }

  return data.result;
}

export default async function handler(
  req,
  res
) {
  try {
    const setupKey =
      process.env.SETUP_KEY;

    const providedKey =
      req.query?.key;

    if (
      !setupKey ||
      providedKey !== setupKey
    ) {
      return json(res, 403, {
        ok: false,
        error:
          "Invalid setup key"
      });
    }

    const appUrl =
      process.env.APP_URL;

    if (!appUrl) {
      throw new Error(
        "APP_URL is missing"
      );
    }

    const webhookSecret =
      process.env.TELEGRAM_WEBHOOK_SECRET;

    const webhookUrl =
      `${appUrl.replace(
        /\/$/,
        ""
      )}/api/telegram-webhook`;

    const telegramResponse =
      await telegramRequest(
        "setWebhook",
        {
          url: webhookUrl,

          secret_token:
            webhookSecret,

          allowed_updates: [
            "chat_join_request",
            "chat_member"
          ],

          drop_pending_updates:
            false,

          max_connections: 40
        }
      );

    const webhookInfo =
      await telegramRequest(
        "getWebhookInfo",
        {}
      );

    return json(res, 200, {
      ok: true,

      message:
        "Telegram webhook configured successfully",

      webhook_url:
        webhookUrl,

      allowed_updates: [
        "chat_join_request",
        "chat_member"
      ],

      telegram_response:
        telegramResponse,

      webhook_info:
        webhookInfo
    });

  } catch (error) {
    console.error(
      "Webhook setup error:",
      error
    );

    return json(res, 500, {
      ok: false,
      error:
        "webhook_setup_failed",
      detail:
        error.message
    });
  }
}
