// ==UserScript==
// @name         GG.BET odds -> ingest
// @namespace    jcgurango
// @version      1.0.0
// @description  Periodically scrapes selected market odds from a match page and POSTs them as JSON
// @match        https://gg289.bet/*
// @match        https://gg.bet/*
// @grant        GM_xmlhttpRequest
// @connect      9-3.jcgurango.com
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const ENDPOINT = 'https://9-3.jcgurango.com/ingest';
  const INTERVAL_MS = 10_000;
  const SEND_ONLY_ON_CHANGE = false; // true = skip the POST when odds are identical to the last send

  const WANTED = [
    /^Winner$/i,
    /^Map \d - Winner \(incl\. overtime\)$/i,
    /^Map \d - Pistol round winner$/i,
    /^Correct map score$/i,
  ];

  const text = (el) => (el ? el.textContent.trim() : null);

  // The site is a single-page app, so the script loads site-wide and checks the URL on every tick.
  const isMatchPage = () => /\/esports\/match\//.test(location.pathname);

  function scrapeMarkets() {
    const markets = {};

    document.body.querySelectorAll('[data-test="market-name"]').forEach((nameEl) => {
      const marketName = text(nameEl);
      if (!WANTED.some((re) => re.test(marketName))) return;

      // Walk up to the market card that holds both the header and the odds
      let card = nameEl.parentElement;
      while (card && !card.querySelector('[data-test="market-group"]')) {
        card = card.parentElement;
      }
      if (!card) return;

      const odds = {};
      card.querySelectorAll('[data-test^="odd-button"][data-label]').forEach((btn) => {
        const title =
          btn.getAttribute('title') ||
          text(btn.querySelector('[data-test="odd-button__title"]'));
        const value = parseFloat(text(btn.querySelector('[data-test="odd-button__result"]')));
        if (title) odds[title] = Number.isNaN(value) ? null : value;
      });

      markets[marketName] = odds;
    });

    return markets;
  }

  function buildPayload(markets) {
    const teams = [...document.querySelectorAll('[data-test="competitor-title"]')].map(text);
    return {
      scrapedAt: new Date().toISOString(),
      url: location.href,
      matchId: decodeURIComponent(location.pathname.split('/esports/match/')[1] || '') || null,
      tournament: text(document.querySelector('[data-test="match-helper-top-bar__tournament-name"]')),
      teams,
      markets,
    };
  }

  function send(payload) {
    console.log("[odds-ingest]", "payload", JSON.stringify(payload));
    GM_xmlhttpRequest({
      method: 'POST',
      url: ENDPOINT,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      timeout: 8000,
      onload: (res) => {
        if (res.status < 200 || res.status >= 300) {
          console.warn('[odds-ingest] server replied', res.status, res.responseText);
        }
      },
      onerror: (err) => console.warn('[odds-ingest] request failed', err),
      ontimeout: () => console.warn('[odds-ingest] request timed out'),
    });
  }

  let lastSent = null;

  function tick() {
    if (!isMatchPage()) return;

    const markets = scrapeMarkets();
    if (Object.keys(markets).length === 0) return; // markets not rendered yet

    if (SEND_ONLY_ON_CHANGE) {
      const snapshot = location.pathname + JSON.stringify(markets);
      if (snapshot === lastSent) return;
      lastSent = snapshot;
    }

    send(buildPayload(markets));
  }

  tick();
  setInterval(tick, INTERVAL_MS);
})();
