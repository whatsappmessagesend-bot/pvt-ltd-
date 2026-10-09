
const CHANNEL_ID = String(
  process.env.TELEGRAM_CHANNEL_ID || "-1003944904464"
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

const PIXEL_ID =
  process.env.META_PIXEL_ID || "1487700176521544";

const META_TOKEN = process.env.META_ACCESS_TOKEN;

// Meta standard event
const META_EVENT =
  process.env.META_EVENT_NAME || "Subscribe";

const GRAPH_VERSION =
  process.env.META_GRAPH_VERSION || "v24.0";

const APP_URL =
  process.env.APP_URL ||
  "https://pvt-ltd-ruddy.vercel.app";

function reply(res, status, data) {
  return res.status(status).json(data);
}

async function database(path, method = "GET", body, prefer) {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "Supabase environment variables missing"
    );
  }

  const response = await fetch(
    `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`,
    {
      method,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {})
      },
      ...(body !== undefined
        ? { body: JSON.stringify(body) }
        : {})
    }
  );

  const text = await response.text();
  let result;

  try {
    result = text ? JSON.parse(text) : null;
  } catch {
    result = text;
  }

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${text}`
    );
  }

  return result;
}

async function telegram(method, payload) {
  if (!BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN missing");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(
      `Telegram ${method}: ${
        data.description || "Failed"
      }`
    );
  }

  return data.result;
}

async function findInvite(link) {
  if (!link) return null;

  const rows = await database(
    `telegram_invites?invite_link=eq.${encodeURIComponent(
      link
    )}&is_revoked=eq.false&select=*&limit=1`
  );

  return rows?.[0] || null;
}

async function findJoin(
  userId,
  channelId,
  pendingOnly = false
) {
  const filter = pendingOnly
    ? "&meta_event_sent=eq.false"
    : "";

  const rows = await database(
    `telegram_joins?telegram_user_id=eq.${encodeURIComponent(
      String(userId)
    )}&telegram_channel_id=eq.${encodeURIComponent(
      String(channelId)
    )}${filter}&select=*&order=created_at.desc&limit=1`
  );

  return rows?.[0] || null;
}

async function landingVisit(trackingId) {
  if (!trackingId) return null;

  const rows = await database(
    `landing_visits?tracking_id=eq.${encodeURIComponent(
      trackingId
    )}&select=*&limit=1`
  );

  return rows?.[0] || null;
}

function isMember(status) {
  return [
    "member",
    "administrator",
    "creator"
  ].includes(status);
}

async function handleJoinRequest(request) {
  const channelId = String(request.chat?.id || "");
  const user = request.from;
  const inviteLink = request.invite_link?.invite_link;

  if (channelId !== CHANNEL_ID) {
    return {
      tracked: false,
      reason: "different_channel"
    };
  }

  const invite = await findInvite(inviteLink);

  if (!invite) {
    console.warn("Untracked Telegram invite");

    return {
      tracked: false,
      reason: "untracked_invite"
    };
  }

  let join = await findJoin(user.id, channelId);

  if (!join) {
    const rows = await database(
      "telegram_joins",
      "POST",
      {
        tracking_id: invite.tracking_id,
        invite_link: inviteLink,
        telegram_channel_id: channelId,
        telegram_user_id: String(user.id),
        telegram_username:
          user.username || null,
        telegram_first_name:
          user.first_name || null,
        telegram_last_name:
          user.last_name || null,
        meta_event_sent: false
      },
      "return=representation"
    );

    join = rows?.[0];
  }

  if (!join) {
    throw new Error(
      "Unable to save Telegram join"
    );
  }

  let approved = false;

  try {
    const member = await telegram(
      "getChatMember",
      {
        chat_id: channelId,
        user_id: user.id
      }
    );

    if (isMember(member.status)) {
      approved = true;
    }
  } catch (error) {
    console.warn(
      "Member check:",
      error.message
    );
  }

  if (!approved) {
    try {
      await telegram(
        "approveChatJoinRequest",
        {
          chat_id: channelId,
          user_id: user.id
        }
      );

      approved = true;
    } catch (error) {
      if (
        error.message.includes(
          "USER_ALREADY_PARTICIPANT"
        )
      ) {
        approved = true;
      } else {
        console.error(
          "Auto approval failed:",
          error.message
        );
      }
    }
  }

  return {
    tracked: true,
    approved,
    tracking_id: invite.tracking_id
  };
}

async function logMeta(
  join,
  visit,
  eventId,
  status,
  result
) {
  await database(
    "meta_events?on_conflict=event_id",
    "POST",
    {
      tracking_id: join.tracking_id,
      telegram_join_id: join.id,
      event_name: META_EVENT,
      event_id: eventId,
      event_time:
        new Date().toISOString(),
      fbclid: visit?.fbclid || null,
      fbc: visit?.fbc || null,
      fbp: visit?.fbp || null,
      event_source_url:
        visit?.landing_page || APP_URL,
      status,
      response_body:
        JSON.stringify(result)
    },
    "resolution=merge-duplicates,return=minimal"
  );
}

async function sendMeta(
  join,
  visit,
  eventId
) {
  if (!META_TOKEN) {
    throw new Error(
      "META_ACCESS_TOKEN missing"
    );
  }

  const userData = {};

  if (visit?.fbc) {
    userData.fbc = visit.fbc;
  }

  if (visit?.fbp) {
    userData.fbp = visit.fbp;
  }

  if (!Object.keys(userData).length) {
    throw new Error(
      "No FBC or FBP available for Meta matching"
    );
  }

  const event = {
    event_name: META_EVENT,
    event_time:
      Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url:
      visit?.landing_page || APP_URL,
    user_data: userData,
    custom_data: {
      source: "telegram"
    }
  };

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        data: [event],
        access_token: META_TOKEN
      })
    }
  );

  const result = await response.json();

  if (!response.ok || result.error) {
    throw new Error(
      JSON.stringify(result)
    );
  }

  return result;
}

async function handleMemberUpdate(update) {
  const channelId = String(
    update.chat?.id || ""
  );

  if (channelId !== CHANNEL_ID) {
    return {
      processed: false,
      reason: "different_channel"
    };
  }

  const oldStatus =
    update.old_chat_member?.status;

  const newStatus =
    update.new_chat_member?.status;

  if (
    isMember(oldStatus) ||
    !isMember(newStatus)
  ) {
    return {
      processed: false,
      reason: "not_new_join"
    };
  }

  const user =
    update.new_chat_member?.user;

  if (!user?.id) {
    return {
      processed: false,
      reason: "missing_user"
    };
  }

  const join = await findJoin(
    user.id,
    channelId,
    true
  );

  if (!join) {
    return {
      processed: false,
      reason: "no_tracked_join"
    };
  }

  const visit = await landingVisit(
    join.tracking_id
  );

  const eventId =
    join.meta_event_id ||
    `telegram_join_${join.id}`;

  try {
    const result = await sendMeta(
      join,
      visit,
      eventId
    );

    try {
      await logMeta(
        join,
        visit,
        eventId,
        "sent",
        result
      );
    } catch (error) {
      console.error(
        "Meta log failed:",
        error.message
      );
    }

    await database(
      `telegram_joins?id=eq.${encodeURIComponent(
        join.id
      )}`,
      "PATCH",
      {
        meta_event_sent: true,
        meta_event_id: eventId,
        joined_at:
          new Date().toISOString()
      },
      "return=minimal"
    );

    return {
      processed: true,
      tracking_id:
        join.tracking_id,
      event_name: META_EVENT,
      event_id: eventId
    };

  } catch (error) {
    console.error(
      "Meta event failed:",
      error.message
    );

    try {
      await logMeta(
        join,
        visit,
        eventId,
        "failed",
        {
          error: error.message
        }
      );
    } catch (logError) {
      console.error(
        "Meta error log failed:",
        logError.message
      );
    }

    return {
      processed: false,
      reason: "meta_event_failed",
      tracking_id:
        join.tracking_id
    };
  }
}

export default async function handler(
  req,
  res
) {
  if (req.method !== "POST") {
    return reply(res, 405, {
      ok: false,
      error: "POST only"
    });
  }

  if (!WEBHOOK_SECRET) {
    return reply(res, 500, {
      ok: false,
      error:
        "TELEGRAM_WEBHOOK_SECRET missing"
    });
  }

  const receivedSecret =
    req.headers[
      "x-telegram-bot-api-secret-token"
    ];

  if (
    receivedSecret !== WEBHOOK_SECRET
  ) {
    return reply(res, 401, {
      ok: false,
      error: "Unauthorized"
    });
  }

  try {
    const update = req.body || {};

    if (
      update.chat_join_request
    ) {
      const result =
        await handleJoinRequest(
          update.chat_join_request
        );

      return reply(res, 200, {
        ok: true,
        type: "chat_join_request",
        ...result
      });
    }

    if (update.chat_member) {
      const result =
        await handleMemberUpdate(
          update.chat_member
        );

      return reply(res, 200, {
        ok: true,
        type: "chat_member",
        ...result
      });
    }

    return reply(res, 200, {
      ok: true,
      ignored: true
    });

  } catch (error) {
    console.error(
      "Webhook error:",
      error
    );

    return reply(res, 500, {
      ok: false,
      error: "webhook_failed",
      detail: error.message
    });
  }
    }
