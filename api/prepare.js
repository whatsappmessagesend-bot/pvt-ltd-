
function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function clean(value, max = 2000) {
  return typeof value === "string"
    ? value.slice(0, max)
    : null;
}

const TELEGRAM_CHANNEL_ID =
  process.env.TELEGRAM_CHANNEL_ID || "-1003944904464";

async function supabaseRequest(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase environment variables are missing"
    );
  }

  const response = await fetch(
    `${url.replace(/\/$/, "")}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Supabase error ${response.status}: ${text}`
    );
  }

  return data;
}

async function telegramRequest(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is missing in Vercel"
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

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok || !data?.ok) {
    throw new Error(
      `Telegram ${method} failed: ${
        data?.description || text || response.status
      }`
    );
  }

  return data.result;
}

async function createTrackingInviteLink(trackingId) {
  const safeId = String(trackingId)
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 24);

  const inviteName = `nbp_${safeId}`;

  const expireDate =
    Math.floor(Date.now() / 1000) +
    7 * 24 * 60 * 60;

  const invite = await telegramRequest(
    "createChatInviteLink",
    {
      chat_id: TELEGRAM_CHANNEL_ID,
      name: inviteName,
      expire_date: expireDate,
      creates_join_request: true
    }
  );

  if (!invite?.invite_link) {
    throw new Error(
      "Telegram did not return an invite link"
    );
  }

  return invite;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return json(res, 405, {
      ok: false,
      error: "POST only"
    });
  }

  try {
    const body = req.body || {};

    const trackingId = clean(
      body.tracking_id,
      100
    );

    if (!trackingId) {
      return json(res, 400, {
        ok: false,
        error: "tracking_id is required"
      });
    }

    const existingInvite = await supabaseRequest(
      `telegram_invites?select=tracking_id,invite_link,is_revoked&tracking_id=eq.${encodeURIComponent(
        trackingId
      )}&is_revoked=eq.false&limit=1`
    );

    if (
      existingInvite &&
      existingInvite.length > 0 &&
      existingInvite[0].invite_link
    ) {
      return json(res, 200, {
        ok: true,
        tracking_id: trackingId,
        telegram_invite:
          existingInvite[0].invite_link,
        reused: true
      });
    }

    const landingRow = {
      tracking_id: trackingId,

      landing_page: clean(
        body.landing_page,
        2000
      ),

      referrer: clean(
        body.referrer,
        2000
      ),

      fbclid: clean(body.fbclid, 500),
      fbc: clean(body.fbc, 500),
      fbp: clean(body.fbp, 500),

      utm_source: clean(
        body.utm_source,
        300
      ),

      utm_medium: clean(
        body.utm_medium,
        300
      ),

      utm_campaign: clean(
        body.utm_campaign,
        1000
      ),

      utm_content: clean(
        body.utm_content,
        1000
      ),

      utm_term: clean(
        body.utm_term,
        1000
      ),

      campaign_id: clean(
        body.campaign_id,
        300
      ),

      adset_id: clean(
        body.adset_id,
        300
      ),

      ad_id: clean(
        body.ad_id,
        300
      )
    };

    await supabaseRequest(
      "landing_visits?on_conflict=tracking_id",
      {
        method: "POST",
        headers: {
          Prefer:
            "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(landingRow)
      }
    );

    const invite = await createTrackingInviteLink(
      trackingId
    );

    await supabaseRequest(
      "telegram_invites",
      {
        method: "POST",
        headers: {
          Prefer: "return=minimal"
        },
        body: JSON.stringify({
          tracking_id: trackingId,
          invite_link: invite.invite_link,
          invite_name: invite.name || null,
          telegram_channel_id:
            TELEGRAM_CHANNEL_ID,
          is_revoked: false
        })
      }
    );

    return json(res, 200, {
      ok: true,
      tracking_id: trackingId,
      telegram_invite: invite.invite_link,
      creates_join_request:
        invite.creates_join_request === true,
      reused: false
    });

  } catch (error) {
    console.error("Prepare error:", error);

    return json(res, 500, {
      ok: false,
      error: "prepare_failed",
      detail: error.message
    });
  }
}
