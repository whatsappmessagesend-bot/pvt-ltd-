
(function () {
  "use strict";

  const BACKEND_URL = "/api/prepare";

  function safeSessionGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSessionSet(key, value) {
    try {
      sessionStorage.setItem(key, value);
    } catch (e) {
      // Ignore storage errors
    }
  }

  function getCookie(name) {
    try {
      const match = document.cookie.match(
        new RegExp(
          "(?:^|; )" +
            name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") +
            "=([^;]*)"
        )
      );

      return match ? decodeURIComponent(match[1]) : null;
    } catch (e) {
      return null;
    }
  }

  function getParam(name) {
    try {
      const params = new URLSearchParams(
        window.location.search
      );

      return params.get(name) || null;
    } catch (e) {
      return null;
    }
  }

  function createTrackingId() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID === "function"
    ) {
      return window.crypto.randomUUID();
    }

    return (
      "trk_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).substring(2, 15)
    );
  }

  function getAttribution() {
    const existing = safeSessionGet(
      "landing_attribution"
    );

    let data = {};

    if (existing) {
      try {
        data = JSON.parse(existing) || {};
      } catch (e) {
        data = {};
      }
    }

    /*
      -----------------------------------------
      1. UNIQUE TRACKING ID
      -----------------------------------------
    */

    if (!data.tracking_id) {
      data.tracking_id = createTrackingId();
    }

    /*
      -----------------------------------------
      2. PAGE / REFERRER
      -----------------------------------------
    */

    data.landing_page = window.location.href;

    data.referrer =
      document.referrer ||
      data.referrer ||
      null;

    /*
      -----------------------------------------
      3. FBCLID
      -----------------------------------------
    */

    const urlFbclid = getParam("fbclid");

    if (urlFbclid) {
      data.fbclid = urlFbclid;
    } else if (!data.fbclid) {
      data.fbclid = null;
    }

    /*
      -----------------------------------------
      4. FBC
      Priority:
      URL fbc
      -> _fbc cookie
      -> previously saved fbc
      -> derive from fbclid
      -----------------------------------------
    */

    const urlFbc = getParam("fbc");
    const cookieFbc = getCookie("_fbc");

    if (urlFbc) {
      data.fbc = urlFbc;
    } else if (cookieFbc) {
      data.fbc = cookieFbc;
    } else if (!data.fbc && data.fbclid) {
      data.fbc =
        "fb.1." +
        Date.now() +
        "." +
        data.fbclid;
    } else if (!data.fbc) {
      data.fbc = null;
    }

    /*
      -----------------------------------------
      5. FBP
      Priority:
      URL fbp
      -> _fbp cookie
      -> previously saved fbp
      -----------------------------------------
    */

    const urlFbp = getParam("fbp");
    const cookieFbp = getCookie("_fbp");

    if (urlFbp) {
      data.fbp = urlFbp;
    } else if (cookieFbp) {
      data.fbp = cookieFbp;
    } else if (!data.fbp) {
      data.fbp = null;
    }

    /*
      -----------------------------------------
      6. UTM PARAMETERS
      -----------------------------------------
    */

    data.utm_source =
      getParam("utm_source") ||
      data.utm_source ||
      null;

    data.utm_medium =
      getParam("utm_medium") ||
      data.utm_medium ||
      null;

    data.utm_campaign =
      getParam("utm_campaign") ||
      data.utm_campaign ||
      null;

    data.utm_content =
      getParam("utm_content") ||
      data.utm_content ||
      null;

    data.utm_term =
      getParam("utm_term") ||
      data.utm_term ||
      null;

    /*
      -----------------------------------------
      7. META CAMPAIGN IDENTIFIERS
      -----------------------------------------
    */

    data.campaign_id =
      getParam("campaign_id") ||
      data.campaign_id ||
      null;

    data.adset_id =
      getParam("adset_id") ||
      data.adset_id ||
      null;

    data.ad_id =
      getParam("ad_id") ||
      data.ad_id ||
      null;

    /*
      -----------------------------------------
      8. TIMESTAMP
      -----------------------------------------
    */

    data.updated_at =
      new Date().toISOString();

    /*
      -----------------------------------------
      SAVE ATTRIBUTION
      -----------------------------------------
    */

    safeSessionSet(
      "landing_attribution",
      JSON.stringify(data)
    );

    return data;
  }

  async function prepareTelegramLink() {
    const attribution =
      getAttribution();

    try {
      const response = await fetch(
        BACKEND_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(
            attribution
          )
        }
      );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.ok
      ) {
        throw new Error(
          result.error ||
            "Unable to prepare Telegram link"
        );
      }

      if (!result.telegram_invite) {
        throw new Error(
          "Telegram invite link was not returned"
        );
      }

      /*
        Save the unique Telegram invite
      */

      attribution.telegram_invite =
        result.telegram_invite;

      attribution.prepared_at =
        new Date().toISOString();

      safeSessionSet(
        "landing_attribution",
        JSON.stringify(attribution)
      );

      /*
        Replace ALL Telegram links
        with the unique tracking invite.
      */

      const telegramLinks =
        document.querySelectorAll(
          'a[href*="t.me/"]'
        );

      telegramLinks.forEach(
        function (link) {
          link.href =
            result.telegram_invite;

          link.dataset.telegramTrackingReady =
            "true";
        }
      );

      console.log(
        "Telegram tracking ready:",
        {
          tracking_id:
            attribution.tracking_id,
          fbclid:
            attribution.fbclid,
          fbc:
            attribution.fbc,
          fbp:
            attribution.fbp,
          telegram_invite:
            result.telegram_invite
        }
      );

      return result.telegram_invite;

    } catch (error) {

      console.error(
        "Telegram tracking preparation failed:",
        error
      );

      return null;
    }
  }

  function attachClickProtection() {

    const telegramLinks =
      document.querySelectorAll(
        'a[href*="t.me/"]'
      );

    telegramLinks.forEach(
      function (link) {

        if (
          link.dataset
            .trackingHandlerAttached
        ) {
          return;
        }

        link.dataset
          .trackingHandlerAttached =
          "true";

        link.addEventListener(
          "click",
          async function (event) {

            const current =
              safeSessionGet(
                "landing_attribution"
              );

            let attribution = {};

            if (current) {
              try {
                attribution =
                  JSON.parse(
                    current
                  ) || {};
              } catch (e) {
                attribution = {};
              }
            }

            /*
              If unique Telegram invite
              is already ready, allow
              normal navigation.
            */

            if (
              attribution.telegram_invite &&
              link.href ===
                attribution.telegram_invite
            ) {

              attribution.telegram_click_at =
                new Date().toISOString();

              safeSessionSet(
                "landing_attribution",
                JSON.stringify(
                  attribution
                )
              );

              return;
            }

            /*
              Backend link is not ready yet.
              Stop navigation temporarily.
            */

            event.preventDefault();

            const originalHref =
              link.href;

            const invite =
              await prepareTelegramLink();

            if (invite) {

              attribution =
                getAttribution();

              attribution.telegram_click_at =
                new Date().toISOString();

              safeSessionSet(
                "landing_attribution",
                JSON.stringify(
                  attribution
                )
              );

              window.location.href =
                invite;

            } else {

              /*
                Backend failed.
                Use original Telegram
                destination as fallback.
              */

              window.location.href =
                originalHref;
            }
          },
          true
        );
      }
    );
  }

  function start() {

    /*
      Capture Meta attribution
      immediately on landing.
    */

    getAttribution();

    /*
      Prepare unique Telegram
      invite immediately.
    */

    prepareTelegramLink();

    /*
      Attach Telegram CTA handler.
    */

    attachClickProtection();

    /*
      Catch buttons/links that may
      appear shortly after page load.
    */

    setTimeout(
      function () {
        attachClickProtection();
      },
      1000
    );

    setTimeout(
      function () {
        attachClickProtection();
      },
      2500
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {

    document.addEventListener(
      "DOMContentLoaded",
      start
    );

  } else {

    start();
  }

})();
