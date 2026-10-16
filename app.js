/* ==========================================================================
   InkTube — front-end
   Reads/writes the InkTubeLaunchpad contract on Ink (ethers v6) and fills
   the home page with Ink's trending tokens while launches are few.
   ========================================================================== */
(() => {
  "use strict";

  const CFG = window.INKTUBE_CONFIG || {};
  const isAddrStr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || ""));
  // Local testing only: ?rpc=http://127.0.0.1:PORT points the app at a local fork, and there
  // ?v2=0x…&v2block=N can stand in for LAUNCHPAD_V2 / DEPLOY_BLOCK_V2 (never on a public RPC).
  const QS = new URLSearchParams(location.search);
  const LOCAL_RPC = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(QS.get("rpc") || "") ? QS.get("rpc") : null;
  if (LOCAL_RPC && isAddrStr(QS.get("v2"))) {
    CFG.LAUNCHPAD_V2 = QS.get("v2");
    CFG.DEPLOY_BLOCK_V2 = Number(QS.get("v2block")) || 0;
  }
  // Every launchpad the front reads; trades / comments / fee collection go to the token's own one.
  const PADS = [
    { address: CFG.LAUNCHPAD_ADDRESS, block: Number(CFG.DEPLOY_BLOCK || 0), v: 1 },
    { address: CFG.LAUNCHPAD_V2, block: Number(CFG.DEPLOY_BLOCK_V2 || CFG.DEPLOY_BLOCK || 0), v: 2 },
  ].filter((p) => isAddrStr(p.address));
  const LIVE = PADS.length > 0;
  const V2 = PADS.find((p) => p.v === 2) || null; // new launches use v2 when it is configured
  const SUPPLY = 1e9; // tokens (18 decimals on-chain)
  const FEE = 0.01; // 1% LP fee

  // ------------------------------------------------------------------------
  // Utils
  // ------------------------------------------------------------------------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem("inktube:" + k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("inktube:" + k, JSON.stringify(v));
      } catch {}
    },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
  const lc = (a) => String(a || "").toLowerCase();

  function fmtUsd(n) {
    if (!isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (a >= 1e3) return "$" + (n / 1e3).toFixed(a >= 1e5 ? 0 : 1) + "K";
    return "$" + n.toFixed(a < 10 ? 2 : 0);
  }
  function fmtNum(n) {
    if (!isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (a >= 1e4) return (n / 1e3).toFixed(1) + "K";
    if (a >= 100) return Math.round(n).toString();
    if (a >= 1) return n.toFixed(2);
    return n.toPrecision(3);
  }
  function fmtCount(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e4) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }
  function fmtEth(n) {
    if (!isFinite(n)) return "—";
    if (n === 0) return "0";
    if (n >= 100) return n.toFixed(1);
    if (n >= 1) return n.toFixed(3);
    if (n >= 0.001) return n.toFixed(4);
    return n.toPrecision(2);
  }
  function fmtTiny(x) {
    if (!isFinite(x) || x <= 0) return "—";
    if (x >= 1) return "$" + x.toFixed(2);
    if (x >= 0.001) return "$" + x.toFixed(5);
    const [m, e] = x.toExponential(3).split("e");
    const zeros = -parseInt(e, 10) - 1;
    const sub = String(zeros).split("").map((d) => "₀₁₂₃₄₅₆₇₈₉"[d]).join("");
    return "$0.0" + sub + m.replace(".", "").replace("-", "");
  }
  function fmtPct(p) {
    if (!isFinite(p)) return "—";
    return (p >= 0 ? "+" : "") + (Math.abs(p) >= 1000 ? Math.round(p).toLocaleString("en-US") : p.toFixed(1)) + "%";
  }
  function ago(ms) {
    const s = Math.max(1, (Date.now() - ms) / 1000);
    const u = [
      [31536000, "year", "years"],
      [2592000, "month", "months"],
      [604800, "week", "weeks"],
      [86400, "day", "days"],
      [3600, "hour", "hours"],
      [60, "minute", "minutes"],
      [1, "second", "seconds"],
    ];
    for (const [d, a, b] of u) if (s >= d) {
      const n = Math.floor(s / d);
      return `${n} ${n > 1 ? b : a} ago`;
    }
    return "just now";
  }
  function dur(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  }

  function hues(seed) {
    const h = hash(lc(seed));
    const a = h % 360;
    return [a, (a + 50 + ((h >> 9) % 90)) % 360];
  }
  function avatar(addr, cls = "") {
    const [a, b] = hues(addr);
    return `<span class="avatar ${cls}" style="background:linear-gradient(135deg,hsl(${a},70%,55%),hsl(${b},70%,38%))">${esc(
      (addr || "?").slice(2, 3)
    )}</span>`;
  }
  function genArt(seed, glyph) {
    const [a, b] = hues(seed);
    const isEmoji = /\p{Extended_Pictographic}/u.test(glyph);
    const g = esc(glyph);
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'><defs>` +
      `<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${a},80%,62%)'/><stop offset='1' stop-color='hsl(${b},75%,30%)'/></linearGradient>` +
      `<radialGradient id='r' cx='.3' cy='.2' r='.9'><stop offset='0' stop-color='white' stop-opacity='.4'/><stop offset='1' stop-color='white' stop-opacity='0'/></radialGradient></defs>` +
      `<rect width='256' height='256' fill='url(#g)'/><rect width='256' height='256' fill='url(#r)'/>` +
      `<circle cx='210' cy='40' r='80' fill='white' fill-opacity='.08'/><circle cx='30' cy='230' r='60' fill='black' fill-opacity='.12'/>` +
      (isEmoji
        ? `<text x='128' y='140' font-size='128' text-anchor='middle' dominant-baseline='middle'>${g}</text>`
        : `<text x='128' y='142' font-size='110' font-family='Roboto,Arial' font-weight='700' fill='white' text-anchor='middle' dominant-baseline='middle'>${g}</text>`) +
      `</svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  function safeImg(url, tok) {
    const u = String(url || "").trim();
    if (/^https:\/\/[^\s"'<>]+$/i.test(u)) return u;
    if (/^ipfs:\/\/[a-z0-9/._-]+$/i.test(u)) return (CFG.IPFS_GATEWAY || "https://ipfs.io/ipfs/") + u.slice(7);
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(u)) return u;
    return genArt(tok?.address || "x", (tok?.symbol || "?").slice(0, 1).toUpperCase());
  }

  // ------------------------------------------------------------------------
  // Icons (Material-style paths)
  // ------------------------------------------------------------------------
  const P = {
    menu: "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
    search: "M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
    mic: "M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z",
    home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
    fire: "M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z",
    subs: "M20 8H4V6h16v2zm-2-6H6v2h12V2zm4 10v8c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-8c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2zm-6 4-6-3.27v6.53L16 16z",
    bell: "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z",
    add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
    up: "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z",
    down: "M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z",
    share: "M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5c0-1.66-1.34-3-3-3s-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81A2.99 2.99 0 0 0 3 12a2.99 2.99 0 0 0 5.04 2.19l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08z",
    more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
    lock: "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z",
    lib: "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8 12.5v-9l6 4.5-6 4.5z",
    history: "M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
    bolt: "M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z",
    close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    upload: "M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z",
    wallet: "M21 18v1c0 1.1-.9 2-2 2H5a2 2 0 0 1-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z",
    check: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
    tick: "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
    moon: "M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z",
    fs: "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
    play: "M8 5v14l11-7z",
    pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
    vol: "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
    mute: "M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z",
    tune: "M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z",
    copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z",
    sort: "M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z",
    trend: "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z",
    person: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
    comment: "M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z",
    coin: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H14.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.67 1.91s4.18 1.39 4.18 3.91c-.01 1.83-1.38 2.83-3.12 3.16z",
    back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
    sun: "M6.76 4.84l-1.8-1.79-1.41 1.41 1.79 1.79 1.42-1.41zM4 10.5H1v2h3v-2zm9-9.95h-2V3.5h2V.55zm7.45 3.91-1.41-1.41-1.79 1.79 1.41 1.41 1.79-1.79zm-3.21 13.7 1.79 1.8 1.41-1.41-1.8-1.79-1.4 1.4zM20 10.5v2h3v-2h-3zm-8-5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm-1 16.95h2V19.5h-2v2.95zm-7.45-3.91 1.41 1.41 1.79-1.8-1.41-1.41-1.79 1.8z",
    logout: "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
    shorts: "M10 14.65v-5.3L15 12l-5 2.65zm7.77-4.33-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.24-2.53-5.07-1.56L6 6.94c-1.29.68-2.07 2.04-2 3.49.07 1.42.93 2.67 2.22 3.25.03.01 1.2.5 1.2.5L6 14.93c-1.83.97-2.53 3.24-1.56 5.07.97 1.83 3.24 2.53 5.07 1.56l8.5-4.5c1.29-.68 2.06-2.04 1.99-3.49-.07-1.42-.94-2.68-2.23-3.25z",
    chev: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
    expand: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z",
    less: "M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z",
    channel: "M3 5v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H5a2 2 0 0 0-2 2zm12 4c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3zm-9 8c0-2 4-3.1 6-3.1s6 1.1 6 3.1v1H6v-1z",
    newi: "M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.69 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12zm-10 5h-2v-2h2v2zm0-4h-2V7h2v6z",
    live: "M7.76 16.24A5.98 5.98 0 0 1 6 12c0-1.66.67-3.16 1.76-4.24l1.42 1.42A3.99 3.99 0 0 0 8 12c0 1.1.45 2.1 1.17 2.83l-1.41 1.41zm8.48 0A5.98 5.98 0 0 0 18 12c0-1.66-.67-3.16-1.76-4.24l-1.42 1.42A3.99 3.99 0 0 1 16 12c0 1.1-.45 2.1-1.17 2.83l1.41 1.41zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 2c0 2.21-.9 4.21-2.35 5.65l1.42 1.42A9.97 9.97 0 0 0 22 12c0-2.76-1.12-5.26-2.93-7.07l-1.42 1.42A7.94 7.94 0 0 1 20 12zM6.35 6.35 4.93 4.93A9.97 9.97 0 0 0 2 12c0 2.76 1.12 5.26 2.93 7.07l1.42-1.42A7.94 7.94 0 0 1 4 12c0-2.21.9-4.21 2.35-5.65z",
    playo: "M10 8.64 15.27 12 10 15.36V8.64M8 5v14l11-7L8 5z",
    xlogo: "M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.8-6.3L6.4 22H3.3l7.3-8.3L1 2h6.3l4.4 5.8L18.9 2zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20z",
    telegram: "M21.9 4.6 18.7 19.7c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13.4l-4.8-1.5c-1-.3-1.1-1 .2-1.5L20.6 3c.9-.3 1.6.2 1.3 1.6z",
    discord: "M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.6 19.6 0 0 0-4.9 1.4C.6 9.1-.3 13.6.1 18a19.8 19.8 0 0 0 6 3l1.3-2.1c-.7-.3-1.4-.6-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1L17.9 21a19.7 19.7 0 0 0 6-3c.5-5.1-.8-9.6-3.6-13.6zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z",
    globe: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.4 1.1-2.8 1.9-4zM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.3 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.3-3.6C8.8 5.6 8.4 6.7 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.4-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6c.6-1.1 1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4z",
    pin: "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z",
    image: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
    ext: "M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  };
  const I = new Proxy({}, { get: (_, k) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[k]}"/></svg>` });

  // ------------------------------------------------------------------------
  // Token metadata stored on-chain (the deployed contract only has free-form
  // `image` and `description` strings, so we use small JSON envelopes):
  //   description = {"v":1,"d":text,"c":category,"l":{"x","tg","dc","w"}}   (<= 1000 bytes)
  //   image       = logo URL/data URI, or {"v":1,"logo":…,"banner":…} when a 16:9 thumbnail is set
  // Plain strings (older launches, other tools) still display as before.
  // ------------------------------------------------------------------------
  const CATS = {
    meme: "Memes", ai: "AI", gaming: "Gaming", music: "Music", art: "Art",
    animals: "Animals", sports: "Sports", community: "Community", tech: "Tech",
  };
  const LINK_KINDS = [
    ["w", "Website", "globe", "https://yourtoken.xyz"],
    ["x", "X (Twitter)", "xlogo", "https://x.com/yourtoken"],
    ["tg", "Telegram", "telegram", "https://t.me/yourtoken"],
    ["dc", "Discord", "discord", "https://discord.gg/yourtoken"],
  ];
  const utf8Len = (s) => new TextEncoder().encode(s).length;
  function cleanLink(kind, v) {
    let u = String(v || "").trim();
    if (!u) return "";
    if (kind === "x" && /^@?[A-Za-z0-9_]{1,15}$/.test(u)) u = "https://x.com/" + u.replace(/^@/, "");
    if (kind === "tg" && /^@?[A-Za-z0-9_]{4,32}$/.test(u)) u = "https://t.me/" + u.replace(/^@/, "");
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    u = u.replace(/^http:\/\//i, "https://");
    return /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[^\s"'<>]*)?$/i.test(u) ? u : "";
  }
  function encodeDescription({ text, category, links }) {
    const l = {};
    for (const [k] of LINK_KINDS) if (links && links[k]) l[k] = links[k];
    if (!category && !Object.keys(l).length) return text || "";
    const o = { v: 1, d: text || "" };
    if (category) o.c = category;
    if (Object.keys(l).length) o.l = l;
    return JSON.stringify(o);
  }
  function encodeImage({ logo, banner }) {
    return banner ? JSON.stringify({ v: 1, logo: logo || "", banner }) : logo || "";
  }
  function parseDescription(desc) {
    const out = { text: String(desc || ""), category: "", links: {} };
    if (out.text.startsWith('{"v":1')) {
      try {
        const j = JSON.parse(out.text);
        out.text = String(j.d || "");
        out.category = CATS[j.c] ? j.c : "";
        for (const [k] of LINK_KINDS) {
          const u = j.l && cleanLink(k, j.l[k]);
          if (u) out.links[k] = u;
        }
      } catch {}
    }
    return out;
  }
  function parseImage(img) {
    const s = String(img || "");
    if (s.startsWith('{"v":1')) {
      try {
        const j = JSON.parse(s);
        return { logo: String(j.logo || ""), banner: String(j.banner || "") };
      } catch {}
    }
    return { logo: s, banner: "" };
  }
  const isSafeImg = (u) => /^https:\/\/[^\s"'<>]+$/i.test(u) || /^ipfs:\/\/[a-z0-9/._-]+$/i.test(u) || /^data:image\/(png|jpe?g|gif|webp)[;,]/i.test(u);
  function applyMeta(tok, rawImage, rawDesc) {
    const img = parseImage(rawImage), meta = parseDescription(rawDesc);
    tok.image = safeImg(img.logo, tok);
    tok.banner = img.banner && isSafeImg(img.banner) ? safeImg(img.banner, tok) : "";
    tok.thumb = tok.banner || tok.image;
    tok.description = meta.text;
    tok.category = meta.category;
    tok.links = meta.links;
  }

  // Resize + crop to cover, re-encoding until it fits the byte budget.
  function resizeImage(file, w, h, maxBytes) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onerror = () => reject(new Error("Could not read the file"));
      rd.onload = () => {
        const im = new Image();
        im.onerror = () => reject(new Error("Unsupported image"));
        im.onload = () => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const r = Math.max(w / im.width, h / im.height);
          const sw = w / r, sh = h / r;
          c.getContext("2d").drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 0, 0, w, h);
          let q = 0.82, data = "";
          for (; q >= 0.3; q -= 0.08) {
            data = c.toDataURL("image/webp", q);
            if (!data.startsWith("data:image/webp")) data = c.toDataURL("image/jpeg", q);
            if (data.length <= maxBytes) break;
          }
          resolve(data);
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }

  // ------------------------------------------------------------------------
  // Event bus + global state
  // ------------------------------------------------------------------------
  const bus = {
    ev: {},
    on(n, f) {
      (this.ev[n] ||= []).push(f);
    },
    emit(n, d) {
      (this.ev[n] || []).forEach((f) => {
        try {
          f(d);
        } catch (e) {
          console.error(e);
        }
      });
    },
  };

  const S = {
    tokens: [],
    byAddr: new Map(),
    ethUsd: 2500,
    account: null,
    watch: store.get("watch", []),
    liked: store.get("liked", {}),
    history: store.get("history", []),
    subsExpanded: false,
    theme: store.get("theme", "dark"),
    notifs: [],
    unread: 0,
    route: { name: "home" },
  };

  // ------------------------------------------------------------------------
  // Market math — identical to the on-chain one-sided v4 position.
  // Units: whole tokens & whole ETH. sqrt = sqrt(tokens per ETH). L = liquidity.
  // Position range = [MIN_TICK, startTick] => L ≈ SUPPLY / sqrt0.
  // ------------------------------------------------------------------------
  // LP fee as a fraction. v2 pools have a dynamic fee (anti-snipe): tok.fees comes from
  // currentFees(token), in pips (10_000 = 1%). v1 pools are always 1%.
  function feeOf(tok, isBuy) {
    const st = tok.opts ? v2State(tok) : null;
    if (st) return (isBuy ? st.buyFee : st.sellFee) / 1e6;
    return tok.fees ? (isBuy ? tok.fees.buy : tok.fees.sell) / 1e6 : FEE;
  }
  function quoteBuy(tok, eth) {
    if (!(eth > 0) || !(tok.L > 0)) return { out: 0, sqrt: tok.sqrt };
    const eff = eth * (1 - feeOf(tok, true));
    const sq = 1 / (1 / tok.sqrt + eff / tok.L);
    return { out: tok.L * (tok.sqrt - sq), sqrt: sq };
  }
  function quoteSell(tok, amt) {
    if (!(amt > 0) || !(tok.L > 0)) return { out: 0, sqrt: tok.sqrt, used: 0 };
    const eff = amt * (1 - feeOf(tok, false));
    let sq = tok.sqrt + eff / tok.L;
    if (sq > tok.sqrt0) sq = tok.sqrt0; // no liquidity above the start price
    return { out: tok.L * (1 / tok.sqrt - 1 / sq), sqrt: sq };
  }
  const mcapFromSqrt = (sq) => SUPPLY / (sq * sq);
  const usd = (eth) => eth * S.ethUsd;

  // v2 launch options, enforced by InkTubeHook (same values as InkTubeLaunchpadV2._guard).
  const ANTI_SNIPE = [
    { name: "Off", desc: "Normal 1% fee from the first second." },
    { name: "Standard", desc: "Buy fee starts at 50% and falls to 1% over 2 min. Max 1% of supply per swap for 2 min.", startFee: 500000, dur: 120e3, maxBuy: SUPPLY / 100 },
    { name: "Strong", desc: "Buy fee starts at 80% and falls to 1% over 5 min. Max 0.5% of supply per swap for 5 min.", startFee: 800000, dur: 300e3, maxBuy: SUPPLY / 200 },
    { name: "Custom", desc: "Your own settings, in seconds." },
  ];
  const secs = (ms) => { const s = Math.round(ms / 1000); return s < 120 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`; };
  // Human summary of a pool's on-chain rules (LaunchRules event).
  function rulesText(g, sym = "") {
    if (!g || !g.dur) return "Off";
    return `${pct(g.startFee)} → ${pct(g.buyFee)} buy fee over ${secs(g.dur)}${g.maxBuy && g.buyWin ? ` · max ${fmtNum(g.maxBuy)}${sym ? " " + sym : ""} per buy for ${secs(g.buyWin)}` : ""}`;
  }
  // Premiere / anti-snipe state of a v2 token right now (null for v1 tokens).
  function v2State(tok, now = Date.now()) {
    const o = tok && tok.opts;
    if (!o) return null;
    const preset = ANTI_SNIPE[o.antiSnipe] || ANTI_SNIPE[0];
    // Exact rules from the LaunchRules event; presets are only a fallback for older v2 pools.
    const g = o.guard || { dur: preset.dur || 0, startFee: preset.startFee || 10000, buyWin: preset.dur || 0, maxBuy: preset.maxBuy || 0, wlWin: 0, wlCount: 0, buyFee: 10000, sellFee: 10000 };
    const a = { name: preset.name, dur: g.dur, startFee: g.startFee };
    const premiere = now < o.tradingStart;
    const snipeEnd = g.dur ? o.tradingStart + g.dur : 0;
    const snipe = !premiere && now < snipeEnd;
    const wlEnd = g.wlWin ? o.tradingStart + g.wlWin : 0;
    const whitelist = !premiere && now < wlEnd;
    const buyWinEnd = o.tradingStart + (g.buyWin || 0);
    // Between two currentFees() reads, interpolate the decaying fee like the hook does.
    const estFee = snipe ? g.buyFee + ((g.startFee - g.buyFee) * (snipeEnd - now)) / g.dur : premiere && g.dur ? g.startFee : g.buyFee;
    const fresh = tok.fees && now - tok.feesAt < 5000;
    return {
      premiere, opensIn: o.tradingStart - now, snipe, snipeEnd, preset: a, guard: g, whitelist, wlEnd,
      maxBuy: g.maxBuy && (premiere || now < buyWinEnd) ? g.maxBuy : 0,
      buyFee: fresh ? tok.fees.buy : Math.round(estFee), sellFee: fresh ? tok.fees.sell : g.sellFee,
    };
  }
  const pct = (pips) => (pips / 1e4).toFixed(pips % 10000 ? 1 : 0) + "%";
  function countdown(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    const p2 = (n) => String(n).padStart(2, "0");
    return d ? `${d}d ${p2(h)}h ${p2(m)}m` : h ? `${h}:${p2(m)}:${p2(x)}` : `${m}:${p2(x)}`;
  }
  const fmtDate = (ms) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtDays = (sec) => (sec >= 86400 ? `${+(sec / 86400).toFixed(2)} day${sec === 86400 ? "" : "s"}` : sec >= 3600 ? `${+(sec / 3600).toFixed(2)} h` : `${Math.round(sec / 60)} min`);

  function stats(tok) {
    if (tok.ext) return extStats(tok);
    const now = Date.now();
    const tr = tok.trades;
    let vol24 = 0, n24 = 0, ath = tok.startMcapEth, before24 = tok.startMcapEth, buys = 0;
    const traders = new Set();
    for (const t of tr) {
      if (t.mcapEth > ath) ath = t.mcapEth;
      if (t.t >= now - 864e5) {
        vol24 += t.eth;
        n24++;
      } else before24 = t.mcapEth;
      if (t.isBuy) buys++;
      traders.add(t.trader);
    }
    const last = tr.length ? tr[tr.length - 1].t : 0;
    return {
      trades: tr.length,
      buys,
      vol24,
      n24,
      ath,
      change24: (tok.mcapEth / before24 - 1) * 100,
      changeAll: (tok.mcapEth / tok.startMcapEth - 1) * 100,
      last,
      live: last > now - 5 * 60e3,
      isNew: tok.createdAt > now - 3 * 3600e3,
      traders: traders.size,
      sold: clamp(1 - Math.sqrt(tok.startMcapEth / tok.mcapEth), 0, 1),
    };
  }

  // ------------------------------------------------------------------------
  // Contrat pas encore configuré : le site affiche les tendances d'Ink mais
  // refuse toute action, au lieu d'inventer des données.
  // ------------------------------------------------------------------------
  function OfflineBackend() {
    const no = async () => {
      throw new Error("InkTube is not live yet (contract not configured)");
    };
    return {
      mode: "offline",
      async init() {},
      v2: false,
      connect: no, buy: no, sell: no, launch: no, comment: no, collectFees: no, estimateLaunch: no, claimVested: no,
      async refresh() {},
      async launchConfig() { return null; },
      async v2Info() { return null; },
      async feeRecipient() { return null; },
      async balances() { return { eth: 0, tok: 0 }; },
      async loadComments() { return []; },
      txUrl: () => null,
    };
  }

  // ------------------------------------------------------------------------
  // LIVE backend (Ink mainnet)
  // ------------------------------------------------------------------------
  const PAD_ABI = [
    "function tokenCount() view returns (uint256)",
    "function launches(address) view returns (address creator,int24 tickLower,int24 tickUpper,uint128 liquidity,uint64 createdAt,uint256 startMcapEth)",
    "function marketState(address) view returns (uint160 sqrtPriceX96,int24 tick,uint128 activeLiquidity,uint256 mcapEth)",
    "function ethUsdPrice() view returns (uint256)",
    "function launchFee() view returns (uint256)",
    "function launch(string name,string symbol,string image,string description,uint256 minDevBuyTokens) payable returns (address)",
    "function buy(address token,uint256 minTokensOut) payable returns (uint256)",
    "function sell(address token,uint256 amountIn,uint256 minEthOut) returns (uint256)",
    "function comment(address token,string text)",
    "function transferCreator(address token,address newCreator)",
    "function collectFees(address token) returns (uint256,uint256,uint256,uint256)",
    "event TokenLaunched(address indexed token,address indexed creator,bytes32 indexed poolId,string name,string symbol,string image,string description,int24 startTick,uint256 startMcapEth,uint256 devBuyTokens)",
    "event Trade(address indexed token,address indexed trader,bool isBuy,uint256 ethAmount,uint256 tokenAmount,uint160 sqrtPriceX96)",
    "event Comment(address indexed token,address indexed author,string text)",
    "event FeesCollected(address indexed token,uint256 creatorEth,uint256 creatorTokens,uint256 protocolEth,uint256 protocolTokens)",
    // InkTubeLaunchpadV2 only
    "function launchWithOptions((string name,string symbol,string image,string description,uint8 mcapTier,uint64 tradingStart,uint8 antiSnipe,uint32 vestingCliff,uint32 vestingDuration,address[] feeRecipients,uint16[] feeBps,uint256 minDevBuyTokens,uint32 snipeDuration,uint24 snipeStartFee,uint32 maxBuyWindow,uint16 maxBuyBps,uint32 whitelistWindow,address[] whitelist,uint16 buyTaxBps,uint16 sellTaxBps) p) payable returns (address)",
    "function hook() view returns (address)",
    "function poolId(address token) view returns (bytes32)",
    "event LaunchRules(address indexed token,uint32 snipeDuration,uint24 snipeStartFee,uint32 maxBuyWindow,uint96 maxBuyPerSwap,uint32 whitelistWindow,uint256 whitelistCount,uint24 buyFee,uint24 sellFee)",
    "function mcapTiers() view returns (uint256[])",
    "function currentFees(address token) view returns (uint24 buyFee,uint24 sellFee)",
    "function feeSplit(address token) view returns (address[] recipients,uint16[] bps)",
    "function vestings(address token) view returns (address beneficiary,uint64 start,uint32 cliff,uint32 duration,uint128 total,uint128 claimed)",
    "function claimableAmount(address token) view returns (uint256)",
    "function claimVested(address token) returns (uint256)",
    "event LaunchOptions(address indexed token,uint32 startMcapUsd,uint64 tradingStart,uint8 antiSnipe,uint64 vestingStart,uint32 vestingCliff,uint32 vestingDuration)",
    "event FeeSplitUpdated(address indexed token,address[] recipients,uint16[] bps)",
    "event VestingClaimed(address indexed token,address indexed beneficiary,uint256 amount)",
  ];
  const ERC20_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ];

  function LiveBackend() {
    const E = window.ethers;
    const rpc = new E.JsonRpcProvider(LOCAL_RPC || CFG.RPC_URL, CFG.CHAIN_ID, { staticNetwork: true });
    const iface = new E.Interface(PAD_ABI);
    // Accept addresses pasted in any case (ethers rejects a wrong mixed-case checksum).
    PADS.forEach((p) => (p.address = E.getAddress(lc(p.address))));
    // One entry per launchpad, keyed by lowercase address. Each token remembers its own (tok.pad).
    const pads = new Map(PADS.map((p) => [lc(p.address), { ...p, c: new E.Contract(p.address, PAD_ABI, rpc) }]));
    const main = pads.get(lc(PADS[0].address));
    const padV2 = V2 ? pads.get(lc(V2.address)) : null;
    const padOf = (tok) => pads.get(tok.pad) || main;
    const padAddrs = PADS.map((p) => p.address);
    const toF = (x) => Number(E.formatEther(x));
    const sqrtF = (x) => Number(x) / 2 ** 96;
    let lastBlock = Math.min(...PADS.map((p) => p.block)) - 1;
    let headBlock = 0, headTs = Date.now();
    const comments = new Map();
    let signer = null;
    const sPad = (tok) => padOf(tok).c.connect(signer);

    // Ink ~1s blocks: approximate timestamps from the head block (avoids N getBlock calls).
    const tsOf = (bn) => headTs - (headBlock - bn) * 1000;
    const EVENTS = ["TokenLaunched", "Trade", "Comment", "LaunchOptions", "LaunchRules", "FeeSplitUpdated", "VestingClaimed"];

    // History comes from the Ink explorer (Blockscout) API: no block-range limit, 1000 logs per call.
    // Public RPCs cap eth_getLogs at 1,000 (rpc-gel) or 10,000 (rpc-qnd) blocks, which would mean
    // hundreds of requests per page load after a few days. The RPC still covers the newest blocks
    // (the explorer can lag a little) and live polling. Duplicates are dropped in ingest().
    const EXPLORER_API = (CFG.EXPLORER_API || CFG.EXPLORER + "/api").replace(/\/$/, "");
    const POOL_MANAGER = "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32";
    const SWAP_TOPIC = E.id("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
    const swapIface = new E.Interface(["event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)"]);
    async function explorerLogs(address, fromBlock, toBlock) {
      const out = [];
      let from = fromBlock, guard = 0;
      while (from <= toBlock && guard++ < 200) {
        const url = `${EXPLORER_API}?module=logs&action=getLogs&address=${address}&fromBlock=${from}&toBlock=${toBlock}&page=1&offset=1000`;
        const r = await fetch(url, { headers: { Accept: "application/json" } });
        if (!r.ok) throw new Error("explorer HTTP " + r.status);
        const j = await r.json();
        const rows = Array.isArray(j.result) ? j.result : [];
        if (j.status !== "1" && !/no logs/i.test(j.message || "")) throw new Error("explorer: " + (j.message || "error"));
        for (const x of rows) {
          out.push({
            address: x.address,
            topics: (x.topics || []).filter(Boolean),
            data: x.data,
            blockNumber: parseInt(x.blockNumber, 16),
            transactionHash: x.transactionHash,
            index: parseInt(x.logIndex, 16),
          });
        }
        if (rows.length < 1000) break;
        const last = parseInt(rows[rows.length - 1].blockNumber, 16);
        from = last > from ? last : from + 1; // re-reading the last block is fine: ingest() dedupes
      }
      return out;
    }

    async function rpcLogs(fromBlock, toBlock) {
      const out = [];
      const topics = [EVENTS.map((n) => iface.getEvent(n).topicHash)];
      const step = Number(CFG.LOG_CHUNK || 50000);
      const ranges = [];
      for (let a = fromBlock; a <= toBlock; a += step) ranges.push([a, Math.min(toBlock, a + step - 1)]);
      for (let i = 0; i < ranges.length; i += 4) {
        const res = await Promise.all(
          ranges.slice(i, i + 4).map(([a, b]) => rpc.getLogs({ address: padAddrs.length > 1 ? padAddrs : padAddrs[0], fromBlock: a, toBlock: b, topics }))
        );
        res.forEach((r) => out.push(...r));
      }
      return out;
    }

    async function logs(fromBlock, toBlock) {
      let out = [];
      const RECENT = 2000;
      if (toBlock - fromBlock > RECENT) {
        try {
          for (const a of padAddrs) out.push(...(await explorerLogs(a, fromBlock, toBlock - RECENT)));
          out.push(...(await rpcLogs(toBlock - RECENT + 1, toBlock)));
        } catch (e) {
          console.warn("explorer logs failed, falling back to RPC:", e.message);
          out = await rpcLogs(fromBlock, toBlock);
        }
      } else {
        out = await rpcLogs(fromBlock, toBlock);
      }
      return out.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    }

    async function refreshMarket(tok) {
      const p = padOf(tok);
      const [m, f] = await Promise.all([p.c.marketState(tok.address), p.v === 2 ? p.c.currentFees(tok.address).catch(() => null) : null]);
      tok.sqrt = sqrtF(m.sqrtPriceX96);
      tok.L = Number(m.activeLiquidity) / 1e18 || tok.L;
      tok.mcapEth = toF(m.mcapEth);
      if (f) {
        tok.fees = { buy: Number(f.buyFee), sell: Number(f.sellFee) };
        tok.feesAt = Date.now();
      }
    }

    const seenLogs = new Set();
    const rulesBy = new Map(); // token -> LaunchRules, which arrives before TokenLaunched
    function ingest(list, emit) {
      const touched = new Set();
      for (const lg of list) {
        // The same block can be read twice (right after a launch, then by the poller).
        const id = lg.transactionHash + ":" + lg.index;
        if (seenLogs.has(id)) continue;
        seenLogs.add(id);
        const pad = lc(lg.address);
        if (!pads.has(pad)) continue;
        let ev;
        try {
          ev = iface.parseLog(lg);
        } catch {
          continue;
        }
        if (!ev) continue;
        const a = ev.args;
        // Only the launchpad that created a token may update it.
        const own = () => {
          const t = S.byAddr.get(lc(a.token));
          return t && t.pad === pad ? t : null;
        };
        if (ev.name === "TokenLaunched") {
          if (S.byAddr.has(lc(a.token))) continue;
          // Exact starting price = the pool's initial tick (the USD target rounded to the tick spacing).
          const sqrt0 = Math.pow(1.0001, Number(a.startTick) / 2);
          const startMcapEth = SUPPLY / (sqrt0 * sqrt0);
          const tok = {
            address: a.token, name: a.name, symbol: a.symbol, devBuyTokens: toF(a.devBuyTokens), block: lg.blockNumber,
            creator: a.creator, createdAt: tsOf(lg.blockNumber), startMcapEth, mcapEth: startMcapEth,
            sqrt0, sqrt: sqrt0, L: SUPPLY / sqrt0, trades: [], comments: null,
            pad, v: pads.get(pad).v, rules: rulesBy.get(lc(a.token)) || null,
          };
          applyMeta(tok, a.image, a.description);
          addToken(tok, emit);
        } else if (ev.name === "LaunchOptions") {
          const tok = own();
          if (!tok) continue;
          tok.opts = {
            startMcapUsd: Number(a.startMcapUsd), tradingStart: Number(a.tradingStart) * 1000, antiSnipe: Number(a.antiSnipe),
            vestingStart: Number(a.vestingStart) * 1000, vestingCliff: Number(a.vestingCliff), vestingDuration: Number(a.vestingDuration),
            guard: tok.rules || null,
          };
          if (emit) bus.emit("v2", tok);
        } else if (ev.name === "LaunchRules") {
          // Emitted BEFORE TokenLaunched in the launch transaction: keep it until the token is known.
          const rules = {
            dur: Number(a.snipeDuration) * 1000, startFee: Number(a.snipeStartFee), buyWin: Number(a.maxBuyWindow) * 1000,
            maxBuy: toF(a.maxBuyPerSwap), wlWin: Number(a.whitelistWindow) * 1000, wlCount: Number(a.whitelistCount),
            buyFee: Number(a.buyFee), sellFee: Number(a.sellFee),
          };
          rulesBy.set(lc(a.token), rules);
          const tok = own();
          if (!tok) continue;
          tok.rules = rules;
          if (tok.opts) tok.opts.guard = rules;
          if (emit) bus.emit("v2", tok);
        } else if (ev.name === "FeeSplitUpdated") {
          const tok = own();
          if (!tok) continue;
          tok.split = a.recipients.map((r, i) => ({ addr: r, bps: Number(a.bps[i]) }));
          if (emit) bus.emit("v2", tok);
        } else if (ev.name === "VestingClaimed") {
          const tok = own();
          if (tok && emit) {
            tok.vest = null; // re-read on the token page
            bus.emit("v2", tok);
          }
        } else if (ev.name === "Trade") {
          const tok = own();
          if (!tok) continue;
          const sq = sqrtF(a.sqrtPriceX96);
          const tr = {
            t: tsOf(lg.blockNumber), isBuy: a.isBuy, eth: toF(a.ethAmount), tokens: toF(a.tokenAmount),
            mcapEth: mcapFromSqrt(sq), trader: a.trader, hash: lg.transactionHash,
          };
          const dup = tok.trades.find((x) => x.hash === tr.hash);
          if (dup) {
            Object.assign(dup, tr, { external: false });
            continue;
          }
          tok.trades.push(tr);
          tok.sqrt = sq;
          tok.mcapEth = tr.mcapEth;
          touched.add(tok);
          if (emit) bus.emit("trade", { tok, tr, mine: lc(a.trader) === lc(S.account) });
        } else if (ev.name === "Comment") {
          const k = lc(a.token);
          const c = { author: a.author, text: a.text, t: tsOf(lg.blockNumber) };
          if (!comments.has(k)) comments.set(k, []);
          comments.get(k).unshift(c);
          if (emit) bus.emit("comment", { token: k, c });
        }
      }
      return touched;
    }

    async function poll() {
      try {
        const b = await rpc.getBlock("latest");
        headBlock = b.number;
        headTs = b.timestamp * 1000;
        if (headBlock > lastBlock) {
          const list = await logs(lastBlock + 1, headBlock);
          lastBlock = headBlock;
          const touched = ingest(list, true);
          await Promise.all([...touched].map(refreshMarket));
        }
      } catch (e) {
        console.warn("poll", e);
      }
      setTimeout(poll, CFG.POLL_MS || 6000);
    }

    async function ensureSigner() {
      if (signer) return;
      if (!window.ethereum) throw new Error("No wallet detected (install Rabby, MetaMask or Kraken Wallet)");
      const bp = new E.BrowserProvider(window.ethereum);
      await bp.send("eth_requestAccounts", []);
      const hexId = "0x" + Number(CFG.CHAIN_ID).toString(16);
      const net = await bp.getNetwork();
      if (Number(net.chainId) !== Number(CFG.CHAIN_ID)) {
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
        } catch (e) {
          if (e && e.code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{ chainId: hexId, chainName: CFG.CHAIN_NAME, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [CFG.RPC_URL], blockExplorerUrls: [CFG.EXPLORER] }],
            });
          } else throw e;
        }
      }
      const bp2 = new E.BrowserProvider(window.ethereum);
      signer = await bp2.getSigner();
      window.ethereum.on?.("accountsChanged", () => location.reload());
      window.ethereum.on?.("chainChanged", () => location.reload());
    }
    // Ink fees are tiny: set them explicitly, otherwise ethers defaults to a 1 gwei tip (~1000x too much).
    async function fees() {
      const [block, tip] = await Promise.all([rpc.getBlock("latest"), rpc.send("eth_maxPriorityFeePerGas", []).catch(() => "0xf4240")]);
      const maxPriorityFeePerGas = BigInt(tip);
      return { maxPriorityFeePerGas, maxFeePerGas: (block.baseFeePerGas || 0n) * 2n + maxPriorityFeePerGas };
    }
    const toWei = (x) => E.parseEther(Number(x).toFixed(18).replace(/\.?0+$/, "") || "0");
    // Sends contract.method(...args) with explicit Ink fees and a 25% gas margin: estimates are exact,
    // and a v2 swap can cost a little more when mined than when estimated (time-dependent hook fee).
    async function send(c, method, args, extra = {}) {
      const ov = { ...(await fees()), ...extra };
      const gas = await c[method].estimateGas(...args, ov);
      return c[method](...args, { ...ov, gasLimit: gas + gas / 4n + 20000n });
    }
    // Hook rules are checked here too, so the wallet never opens for a swap that can only revert.
    const wlCache = new Map();
    async function isListed(tok, who) {
      const p = padOf(tok);
      if (p.v !== 2 || !who) return false;
      const k = lc(tok.address) + ":" + lc(who);
      if (!wlCache.has(k)) {
        if (!p.hookC) p.hookC = new E.Contract(await p.c.hook(), ["function whitelisted(bytes32,address) view returns (bool)"], rpc);
        wlCache.set(k, await p.hookC.whitelisted(await p.c.poolId(tok.address), who));
      }
      return wlCache.get(k);
    }
    async function guardTrade(tok, isBuy, tokensOut) {
      const st = v2State(tok);
      if (!st) return;
      if (isBuy && st.whitelist && !(await isListed(tok, S.account))) {
        throw new Error(`Whitelist only: public buying opens in ${countdown(st.wlEnd - Date.now())}`);
      }
      if (st.premiere) throw new Error(`Premiere: trading opens in ${countdown(st.opensIn)}`);
      if (isBuy && st.maxBuy && tokensOut > st.maxBuy) throw new Error(`Anti-snipe: max ${fmtNum(st.maxBuy)} ${tok.symbol} per buy for now`);
    }
    // launchWithOptions(LaunchParams) arguments for a v2 launch.
    const v2Params = (form, minOut) => ({
      name: form.name, symbol: form.symbol, image: form.image || "", description: form.description || "",
      mcapTier: form.mcapTier || 0, tradingStart: BigInt(form.tradingStart || 0), antiSnipe: form.antiSnipe || 0,
      vestingCliff: form.vestingCliff || 0, vestingDuration: form.vestingDuration || 0,
      feeRecipients: form.feeRecipients || [], feeBps: form.feeBps || [], minDevBuyTokens: minOut,
      snipeDuration: form.snipeDuration || 0, snipeStartFee: form.snipeStartFee || 0, maxBuyWindow: form.maxBuyWindow || 0,
      maxBuyBps: form.maxBuyBps || 0, whitelistWindow: form.whitelistWindow || 0, whitelist: form.whitelist || [],
      buyTaxBps: form.buyTaxBps || 0, sellTaxBps: form.sellTaxBps || 0,
    });
    let cfgCache = null;

    return {
      mode: "live",
      v2: !!padV2,
      async init() {
        const [b, px] = await Promise.all([rpc.getBlock("latest"), (padV2 || main).c.ethUsdPrice().catch(() => 2500n * 10n ** 8n)]);
        headBlock = b.number;
        headTs = b.timestamp * 1000;
        S.ethUsd = Number(px) / 1e8;
        const list = await logs(Math.max(0, lastBlock + 1), headBlock);
        lastBlock = headBlock;
        ingest(list, false);
        await Promise.all(S.tokens.map(refreshMarket));
        setTimeout(poll, CFG.POLL_MS || 6000);
      },
      async connect() {
        await ensureSigner();
        return await signer.getAddress();
      },
      refresh: refreshMarket,
      isListed,
      // v2 launch settings: market cap tiers (USD) and launch fee.
      async launchConfig() {
        if (!padV2) return null;
        if (!cfgCache) {
          cfgCache = Promise.all([padV2.c.mcapTiers(), padV2.c.launchFee()])
            .then(([tiers, fee]) => ({ tiers: tiers.map(Number), fee: toF(fee) }))
            .catch((e) => { cfgCache = null; throw e; });
        }
        return cfgCache;
      },
      // Fee split + creator buy vesting of a v2 token.
      async v2Info(tok) {
        const p = padOf(tok);
        if (p.v !== 2) return null;
        const [split, v, claimable] = await Promise.all([p.c.feeSplit(tok.address), p.c.vestings(tok.address), p.c.claimableAmount(tok.address)]);
        tok.split = split.recipients.map((r, i) => ({ addr: r, bps: Number(split.bps[i]) }));
        tok.vest = v.total > 0n
          ? { beneficiary: v.beneficiary, start: Number(v.start) * 1000, cliff: Number(v.cliff), duration: Number(v.duration), total: toF(v.total), claimed: toF(v.claimed), claimable: toF(claimable), at: Date.now() }
          : { total: 0 };
        return tok;
      },
      async claimVested(tok) {
        await ensureSigner();
        const tx = await send(sPad(tok), "claimVested", [tok.address]);
        toast("Claim sent…", tx.hash);
        await tx.wait();
        tok.vest = null;
        return { hash: tx.hash };
      },
      async balances(token) {
        if (!S.account) return { eth: 0, tok: 0 };
        const [e, t] = await Promise.all([
          rpc.getBalance(S.account),
          token ? new E.Contract(token, ERC20_ABI, rpc).balanceOf(S.account) : 0n,
        ]);
        return { eth: toF(e), tok: toF(t) };
      },
      // Every swap of the token's Uniswap v4 pool, whatever the router (Uniswap app, aggregators, …),
      // read from the PoolManager's Swap events through the explorer API. Deduped with InkTube's own Trade events.
      async poolSwaps(tok) {
        const p = padOf(tok);
        if (!tok.poolId) tok.poolId = await p.c.poolId(tok.address);
        const from = tok.block || p.block;
        const url = `${EXPLORER_API}?module=logs&action=getLogs&address=${POOL_MANAGER}&fromBlock=${from}&toBlock=latest&topic0=${SWAP_TOPIC}&topic1=${tok.poolId}&topic0_1_opr=and&page=1&offset=1000`;
        const j = await fetch(url, { headers: { Accept: "application/json" } }).then((r) => r.json());
        const known = new Set(tok.trades.map((x) => x.hash));
        let added = 0;
        for (const x of Array.isArray(j.result) ? j.result : []) {
          if (known.has(x.transactionHash)) continue;
          const ev = swapIface.parseLog({ topics: x.topics.filter(Boolean), data: x.data });
          if (!ev) continue;
          const a0 = ev.args.amount0, a1 = ev.args.amount1; // swapper's deltas: negative = paid in
          const isBuy = a0 < 0n;
          tok.trades.push({
            t: parseInt(x.timeStamp, 16) * 1000, isBuy, eth: toF(isBuy ? -a0 : a0), tokens: toF(isBuy ? a1 : -a1),
            mcapEth: mcapFromSqrt(sqrtF(ev.args.sqrtPriceX96)), trader: ev.args.sender, hash: x.transactionHash, external: true,
          });
          known.add(x.transactionHash);
          added++;
        }
        if (added) {
          tok.trades.sort((a, b) => a.t - b.t);
          await refreshMarket(tok);
        }
        return added;
      },
      async loadComments(tok) {
        const k = lc(tok.address);
        if (!comments.has(k)) comments.set(k, []);
        return comments.get(k);
      },
      async comment(tok, text) {
        await ensureSigner();
        const tx = await send(sPad(tok), "comment", [tok.address, text]);
        toast("Comment sent…", tx.hash);
        await tx.wait();
        return null; // arrives through the poller
      },
      async buy(tok, eth, minOut) {
        await ensureSigner();
        await refreshMarket(tok);
        await guardTrade(tok, true, quoteBuy(tok, eth).out);
        const tx = await send(sPad(tok), "buy", [tok.address, toWei(minOut)], { value: toWei(eth) });
        toast("Transaction sent…", tx.hash);
        await tx.wait();
        return { hash: tx.hash };
      },
      async sell(tok, amt, minOut) {
        await ensureSigner();
        await guardTrade(tok, false);
        const me = await signer.getAddress();
        const spender = padOf(tok).address;
        const erc = new E.Contract(tok.address, ERC20_ABI, signer);
        let wei = toWei(amt);
        const balWei = await erc.balanceOf(me);
        if (wei > balWei) wei = balWei;
        const allowance = await erc.allowance(me, spender);
        if (allowance < wei) {
          const ap = await send(erc, "approve", [spender, wei]);
          toast("Approval sent…", ap.hash);
          await ap.wait();
        }
        const tx = await send(sPad(tok), "sell", [tok.address, wei, toWei(minOut)]);
        toast("Transaction sent…", tx.hash);
        await tx.wait();
        return { hash: tx.hash };
      },
      async launch(form, onStep) {
        await ensureSigner();
        onStep("sign");
        const p = padV2 || main;
        const c = p.c.connect(signer);
        const fee = await p.c.launchFee();
        const devWei = toWei(form.devBuy || 0);
        const minOut = form.minDevBuy > 0 ? toWei(form.minDevBuy) : 0n;
        const tx = padV2
          ? await send(c, "launchWithOptions", [v2Params(form, minOut)], { value: fee + devWei })
          : await send(c, "launch", [form.name, form.symbol, form.image || "", form.description || "", minOut], { value: fee + devWei });
        onStep("mined");
        toast("Launch sent…", tx.hash);
        const rc = await tx.wait();
        let addr = null;
        for (const lg of rc.logs) {
          try {
            const ev = iface.parseLog(lg);
            if (ev && ev.name === "TokenLaunched") addr = ev.args.token;
          } catch {}
        }
        // Pull the launch log right away instead of waiting for the poller.
        ingest(await logs(rc.blockNumber, rc.blockNumber), true);
        const tok = S.byAddr.get(lc(addr));
        if (tok) await refreshMarket(tok);
        // v1 only: the fee recipient is a second transaction (v2 sets the fee split in the launch).
        if (addr && form.feeTo && !padV2) {
          onStep("fees");
          try {
            const t2 = await send(c, "transferCreator", [addr, form.feeTo]);
            toast("Fee recipient update sent…", t2.hash);
            await t2.wait();
            if (tok) tok.feeTo = form.feeTo;
          } catch (e) {
            toast("Token is live, but the fee recipient was not changed: " + errMsg(e));
          }
        }
        if (addr && form.pinned) {
          onStep("comment");
          try {
            const t3 = await send(c, "comment", [addr, form.pinned]);
            toast("Pinned comment sent…", t3.hash);
            await t3.wait();
          } catch (e) {
            toast("Token is live, but the pinned comment was not posted: " + errMsg(e));
          }
        }
        onStep("done");
        return tok;
      },
      async estimateLaunch(form) {
        if (!S.account) throw new Error("Connect your wallet");
        const p = padV2 || main;
        const fee = await p.c.launchFee();
        const value = fee + toWei(form.devBuy || 0);
        const [gas, fz, bal] = await Promise.all([
          padV2
            ? p.c.launchWithOptions.estimateGas(v2Params(form, 0n), { from: S.account, value })
            : p.c.launch.estimateGas(form.name, form.symbol, form.image || "", form.description || "", 0n, { from: S.account, value }),
          fees(),
          rpc.getBalance(S.account),
        ]);
        if (gas > 20000000n) return { ok: false, error: "Too much on-chain data: use smaller images or image URLs" };
        const gasWei = gas * fz.maxFeePerGas;
        const total = value + gasWei;
        if (bal < total + 400000n * fz.maxFeePerGas) {
          return { ok: false, error: `Not enough ETH on Ink: about ${fmtEth(toF(total))} ETH needed, ${fmtEth(toF(bal))} ETH in your wallet` };
        }
        return { ok: true, gas, gasEth: toF(gasWei), total: toF(total) };
      },
      async feeRecipient(tok) {
        // v2: creator fees follow the fee split (see v2Info), `creator` is only the token admin.
        if (padOf(tok).v === 2) return null;
        const l = await padOf(tok).c.launches(tok.address);
        return l.creator;
      },
      async collectFees(tok) {
        await ensureSigner();
        const tx = await send(sPad(tok), "collectFees", [tok.address]);
        toast("Fee collection sent…", tx.hash);
        await tx.wait();
        return padOf(tok).v === 2 ? "fees sent to the fee recipients" : "fees sent to the creator";
      },
      txUrl: (h) => (h ? `${CFG.EXPLORER}/tx/${h}` : null),
    };
  }

  const API = LIVE ? LiveBackend() : OfflineBackend();

  // ------------------------------------------------------------------------
  // Remplissage temporaire : tendances Ink (GeckoTerminal) en attendant les
  // lancements InkTube. Chaque token InkTube lancé prend la place d'un externe.
  // ------------------------------------------------------------------------
  const BF = Object.assign({ ENABLED: true, TARGET: 12, NETWORK: "ink", MAX_FDV_USD: 150e6, EXCLUDE: [] }, CFG.BACKFILL || {});
  const BF_EXCLUDE = new Set([
    "WETH", "ETH", "KBTC", "WBTC", "CBBTC", "LBTC", "USDG", "USDC", "USDC.E", "USDT", "USD₮0", "USDT0", "OUSDT", "DAI", "USDE",
    "SUSDE", "GHO", "FRXUSD", "WSPYX", "XVELO", "VELO", "WSTETH", "WEETH", "EZETH", "RETH", "CBETH", "XAUT", "PAXG",
    ...(BF.EXCLUDE || []).map((x) => String(x).toUpperCase()),
  ]);
  const DEX_NAMES = {
    "uniswap-v4-ink": "Uniswap v4", "uniswap-v3-ink": "Uniswap v3", inkyswap: "InkySwap",
    "velodrome-finance-slipstream-ink": "Velodrome", "velodrome-finance-v2-ink": "Velodrome", "reservoir-v3-ink": "Reservoir",
  };
  const dexName = (id) =>
    DEX_NAMES[id] || String(id || "DEX").replace(/-ink$/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const Ext = {
    list: [],
    by: new Map(),
    cache: new Map(),
    queue: Promise.resolve(),
    lastCall: 0,
    blockedUntil: 0,
    // Serial queue: the public API allows ~30 calls/min, we stay well below.
    get(path, ttl = 60e3) {
      const hit = this.cache.get(path);
      if (hit && Date.now() - hit.t < ttl) return Promise.resolve(hit.d);
      const run = async () => {
        const wait = Math.max(this.lastCall + 3000, this.blockedUntil) - Date.now();
        if (wait > 0) await sleep(wait);
        this.lastCall = Date.now();
        let r;
        try {
          r = await fetch("https://api.geckoterminal.com/api/v2" + path, { headers: { Accept: "application/json" } });
        } catch (e) {
          // Rate-limited responses come back without CORS headers: back off as for a 429.
          this.blockedUntil = Date.now() + 30e3;
          throw new Error("network / rate limit");
        }
        if (r.status === 429) {
          this.blockedUntil = Date.now() + 30e3;
          throw new Error("rate limit");
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        const d = await r.json();
        this.cache.set(path, { t: Date.now(), d });
        return d;
      };
      const p = this.queue.then(run, run);
      this.queue = p.catch(() => {});
      return p;
    },
  };
  const getTok = (a) => S.byAddr.get(lc(a)) || Ext.by.get(lc(a));
  const extVisible = () =>
    BF.ENABLED ? Ext.list.filter((t) => !S.byAddr.has(lc(t.address))).slice(0, Math.max(0, BF.TARGET - S.tokens.length)) : [];

  function extStats(t) {
    const p = t.pc;
    return {
      trades: t.tx24, buys: 0, vol24: t.vol24Usd / S.ethUsd, n24: t.tx24, ath: t.mcapEth, change24: p.h24, changeAll: p.h24,
      last: t.lastTradeAt || 0, live: t.tx15 > 0 || (t.lastTradeAt || 0) > Date.now() - 5 * 60e3, isNew: false,
      traders: t.traders24, sold: 0,
    };
  }

  async function refreshExt() {
    if (!BF.ENABLED) return false;
    const pages = [];
    for (const n of [1, 2]) {
      try {
        pages.push(await Ext.get(`/networks/${BF.NETWORK}/trending_pools?include=base_token,quote_token&page=${n}`, 110e3));
      } catch (e) {
        console.warn("backfill:", e.message);
        break;
      }
    }
    if (!pages.length) return false;
    ingestExt(pages);
    Ext.stale = 0;
    // Keep pages we could not refresh this time (partial rate limit) from the previous cache.
    const old = store.get("ext-cache", null);
    store.set("ext-cache", { t: Date.now(), pages: [...pages, ...((old && old.pages) || []).slice(pages.length)] });
    return true;
  }

  // Before the API answers (or when it rate-limits): last good result from this browser,
  // else the snapshot shipped with the app.
  async function loadExtFallback() {
    if (!BF.ENABLED || Ext.list.length) return;
    S.ethUsd = S.ethUsd || 2500;
    // Snapshot shipped with the app first, then this browser's newer cache on top of it.
    try {
      const r = await fetch("ext-snapshot.json", { cache: "no-cache" });
      if (r.ok) {
        const j = await r.json();
        ingestExt(j.pages || []);
        Ext.stale = j.t || 1;
      }
    } catch {}
    const cached = store.get("ext-cache", null);
    if (cached && cached.pages && Date.now() - cached.t < 24 * 3600e3) {
      ingestExt(cached.pages);
      Ext.stale = cached.t;
    }
  }

  function ingestExt(pages) {
    const seen = new Set(), out = [], moved = [];
    for (const d of pages) {
      const inc = new Map((d.included || []).map((i) => [i.id, i.attributes]));
      for (const p of d.data || []) {
        const a = p.attributes, rel = p.relationships || {};
        const bt = inc.get(rel.base_token?.data?.id), qt = inc.get(rel.quote_token?.data?.id);
        if (!bt) continue;
        if (!LIVE && qt && /^W?ETH$/i.test(qt.symbol) && +a.quote_token_price_usd > 0) S.ethUsd = +a.quote_token_price_usd;
        const sym = String(bt.symbol || "").toUpperCase();
        const fdv = parseFloat(a.fdv_usd || a.market_cap_usd || 0), price = parseFloat(a.base_token_price_usd);
        // Skip majors, stables and tokenized stocks (wTSLAx, wNVDAx…): the backfill is for Ink-native coins.
        if (BF_EXCLUDE.has(sym) || /USD/.test(sym) || /^W[A-Z]{3,6}X$/.test(sym) || !(fdv > 0) || !(price > 0) || fdv > BF.MAX_FDV_USD) continue;
        const key = lc(bt.address);
        if (seen.has(key) || S.byAddr.has(key)) continue;
        seen.add(key);
        const pc = a.price_change_percentage || {}, tx = a.transactions || {};
        const t = Ext.by.get(key) || { ext: true, address: bt.address, trades: [], comments: [] };
        const prev = t.mcapEth;
        Object.assign(t, {
          name: bt.name || sym,
          symbol: bt.symbol || "?",
          pool: a.address,
          dex: dexName(rel.dex?.data?.id),
          image: bt.image_url ? safeImg(bt.image_url, { address: bt.address, symbol: sym }) : genArt(bt.address, sym.slice(0, 1)),
          createdAt: Date.parse(a.pool_created_at) || Date.now(),
          priceUsd: price,
          supply: fdv / price,
          mcapEth: fdv / S.ethUsd,
          reserveUsd: parseFloat(a.reserve_in_usd) || 0,
          pc: { m5: +pc.m5 || 0, m15: +pc.m15 || 0, m30: +pc.m30 || 0, h1: +pc.h1 || 0, h6: +pc.h6 || 0, h24: +pc.h24 || 0 },
          tx24: (tx.h24?.buys || 0) + (tx.h24?.sells || 0),
          traders24: (tx.h24?.buyers || 0) + (tx.h24?.sellers || 0),
          tx15: (tx.m15?.buys || 0) + (tx.m15?.sells || 0),
          vol24Usd: parseFloat(a.volume_usd?.h24) || 0,
        });
        if (prev && Math.abs(t.mcapEth / prev - 1) > 1e-6) moved.push([t, t.mcapEth > prev]);
        out.push(t);
      }
    }
    if (!out.length) return;
    // Tokens we knew but that are missing from this (possibly partial) answer keep their last data.
    for (const t of Ext.list) if (!seen.has(lc(t.address)) && !S.byAddr.has(lc(t.address))) out.push(t);
    Ext.list = out;
    Ext.by = new Map(out.map((t) => [lc(t.address), t]));
    for (const [t, up] of moved) paintToken(t, up);
    bus.emit("ext");
  }

  async function pollExtTrades(tok) {
    const d = await Ext.get(`/networks/${BF.NETWORK}/pools/${tok.pool}/trades`, 15e3);
    const base = lc(tok.address);
    const list = (d.data || [])
      .map((x) => x.attributes)
      .filter((a) => a && a.block_timestamp)
      .map((a) => {
        const isBuy = lc(a.to_token_address) === base;
        const price = parseFloat(isBuy ? a.price_to_in_usd : a.price_from_in_usd);
        return {
          t: Date.parse(a.block_timestamp),
          isBuy,
          eth: (parseFloat(a.volume_in_usd) || 0) / S.ethUsd,
          tokens: parseFloat(isBuy ? a.to_token_amount : a.from_token_amount) || 0,
          mcapEth: (price * tok.supply) / S.ethUsd,
          trader: a.tx_from_address,
          hash: a.tx_hash,
        };
      })
      .filter((t) => isFinite(t.mcapEth) && t.mcapEth > 0);
    const known = new Set(tok.trades.map((t) => t.hash));
    const fresh = list.filter((t) => !known.has(t.hash)).sort((a, b) => a.t - b.t);
    const first = !tok._polled;
    tok._polled = true;
    tok.trades = [...tok.trades, ...fresh].sort((a, b) => a.t - b.t).slice(-60);
    const last = tok.trades[tok.trades.length - 1];
    if (last) {
      tok.mcapEth = last.mcapEth;
      tok.lastTradeAt = last.t;
    }
    if (!first) fresh.forEach((tr) => bus.emit("trade", { tok, tr }));
    else paintToken(tok, true);
  }

  function startExtPollers() {
    if (!BF.ENABLED) return;
    let i = 0;
    const loop = async () => {
      try {
        let tok = null;
        if (S.route.name === "watch" && W.tok && W.tok.ext) tok = W.tok;
        else {
          const vis = extVisible().slice(0, 6);
          if (vis.length) tok = vis[i++ % vis.length];
        }
        if (tok) await pollExtTrades(tok);
      } catch (e) {
        console.warn("backfill trades:", e.message);
      }
      setTimeout(loop, 20000);
    };
    setTimeout(loop, 8000);
    // Refresh every 2 min; retry sooner while the API is refusing us.
    const refresh = async () => {
      const ok = await refreshExt().catch(() => false);
      if (ok && S.route.name === "home" && $("#ext-updated")) $("#ext-updated").textContent = "";
      setTimeout(refresh, ok ? 120e3 : 25e3);
    };
    setTimeout(refresh, Ext.stale ? 20e3 : 120e3);
  }

  function addToken(tok, emit) {
    if (S.byAddr.has(lc(tok.address))) return;
    S.tokens.push(tok);
    S.byAddr.set(lc(tok.address), tok);
    if (emit) bus.emit("launch", tok);
  }

  // ------------------------------------------------------------------------
  // Charts
  // ------------------------------------------------------------------------
  const TF = [
    ["1m", 60e3], ["5m", 300e3], ["15m", 900e3], ["1h", 3600e3], ["4h", 14400e3], ["All", 0],
  ];

  function buildCandles(tok, bucket, maxN = 140) {
    const trades = tok.trades;
    const now = Date.now();
    if (!bucket) bucket = Math.max(10e3, Math.ceil((now - tok.createdAt) / 100 / 10e3) * 10e3);
    const endB = Math.floor(now / bucket) * bucket;
    const startB = Math.max(Math.floor(tok.createdAt / bucket) * bucket, endB - (maxN - 1) * bucket);
    let prev = tok.startMcapEth, i = 0;
    while (i < trades.length && trades[i].t < startB) prev = trades[i++].mcapEth;
    const out = [];
    for (let b = startB; b <= endB; b += bucket) {
      const c = { t: b, o: prev, h: prev, l: prev, c: prev, v: 0 };
      while (i < trades.length && trades[i].t < b + bucket) {
        const m = trades[i].mcapEth;
        c.h = Math.max(c.h, m); c.l = Math.min(c.l, m); c.c = m; c.v += trades[i].eth; prev = m; i++;
      }
      out.push(c);
    }
    return out.map((c) => ({ ...c, o: usd(c.o), h: usd(c.h), l: usd(c.l), c: usd(c.c) }));
  }

  function fmtAxis(v, span) {
    if (!(span > 0)) return fmtUsd(v);
    const unit = v >= 1e6 ? 1e6 : v >= 1e3 ? 1e3 : 1, suf = unit === 1e6 ? "M" : unit === 1e3 ? "K" : "";
    const step = span / 4 / unit;
    const dec = step >= 10 ? 0 : step >= 1 ? 1 : step >= 0.1 ? 2 : 3;
    return "$" + (v / unit).toFixed(dec) + suf;
  }

  class Chart {
    constructor(canvas, tip) {
      this.c = canvas;
      this.tip = tip;
      this.ctx = canvas.getContext("2d");
      this.data = [];
      this.type = "candles";
      this.vol = true;
      this.anim = 1;
      this.hx = null;
      this.ro = new ResizeObserver(() => this.draw());
      this.ro.observe(canvas);
      canvas.addEventListener("mousemove", (e) => {
        const r = canvas.getBoundingClientRect();
        this.hx = e.clientX - r.left;
        this.hy = e.clientY - r.top;
        this.draw();
      });
      canvas.addEventListener("mouseleave", () => {
        this.hx = null;
        this.tip.style.display = "none";
        this.draw();
      });
    }
    set(data, animate, emptyText = "") {
      this.data = data;
      this.emptyText = emptyText;
      if (animate) {
        this.anim = 0;
        const t0 = performance.now();
        const step = (t) => {
          this.anim = Math.min(1, (t - t0) / 800);
          this.draw();
          if (this.anim < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      } else this.draw();
    }
    destroy() {
      this.ro.disconnect();
    }
    draw() {
      const c = this.c, ctx = this.ctx, d = this.data;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth, H = c.clientHeight;
      if (!W || !H) return;
      if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
      if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createRadialGradient(W * 0.75, H * 0.1, 10, W * 0.75, H * 0.1, W);
      bg.addColorStop(0, "rgba(113,50,245,.16)");
      bg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      const note = () => {
        if (!this.emptyText) return;
        ctx.save();
        ctx.font = "500 14px Roboto, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,255,255,.6)";
        ctx.fillText(this.emptyText, W / 2, H / 2 - 10);
        ctx.restore();
      };
      if (!d.length) return note();

      const compact = H < 320;
      const padL = 12, padR = compact ? 58 : 70, padT = compact ? 64 : 78, padB = compact ? 34 : 64;
      const cw = W - padL - padR, ch = H - padT - padB;
      let lo = Infinity, hi = -Infinity, vmax = 0;
      for (const k of d) { lo = Math.min(lo, k.l); hi = Math.max(hi, k.h); vmax = Math.max(vmax, k.v); }
      if (hi - lo < hi * 0.02) { hi *= 1.1; lo *= 0.9; }
      const pad = (hi - lo) * 0.08; hi += pad; lo = Math.max(0, lo - pad);
      const y = (v) => padT + ch - ((v - lo) / (hi - lo)) * ch;
      const bw = cw / d.length;
      const x = (i) => padL + i * bw + bw / 2;

      // grid + axis
      ctx.font = "11px Roboto, Arial";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      for (let g = 0; g <= 4; g++) {
        const v = lo + ((hi - lo) * g) / 4, yy = y(v);
        ctx.strokeStyle = "rgba(255,255,255,.06)";
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.5)";
        ctx.fillText(fmtAxis(v, hi - lo), W - padR + 8, yy);
      }
      // time axis
      if (d.length > 1) {
        const span = d[d.length - 1].t - d[0].t;
        const fmtT = (ms) => {
          const dt = new Date(ms);
          return span > 2 * 864e5 ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        };
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,.4)";
        const n = Math.min(5, d.length);
        for (let i = 0; i < n; i++) {
          const idx = Math.round(((d.length - 1) * (i + 0.5)) / n);
          ctx.fillText(fmtT(d[idx].t), x(idx), padT + ch + 14);
        }
        ctx.textAlign = "left";
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, padL + cw * this.anim, H);
      ctx.clip();

      // volume
      if (this.vol && vmax > 0) {
        for (let i = 0; i < d.length; i++) {
          const k = d[i], vh = (k.v / vmax) * ch * 0.22;
          ctx.fillStyle = k.c >= k.o ? "rgba(46,204,113,.22)" : "rgba(255,78,78,.22)";
          ctx.fillRect(x(i) - bw * 0.35, padT + ch - vh, bw * 0.7, vh);
        }
      }

      if (this.type === "candles") {
        for (let i = 0; i < d.length; i++) {
          const k = d[i], up = k.c >= k.o;
          ctx.strokeStyle = ctx.fillStyle = up ? "#2ecc71" : "#ff4e4e";
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x(i), y(k.h)); ctx.lineTo(x(i), y(k.l)); ctx.stroke();
          const top = y(Math.max(k.o, k.c)), bot = y(Math.min(k.o, k.c));
          ctx.fillRect(x(i) - Math.max(1, bw * 0.32), top, Math.max(2, bw * 0.64), Math.max(1, bot - top));
        }
      } else {
        const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
        grad.addColorStop(0, "rgba(139,92,246,.45)");
        grad.addColorStop(1, "rgba(139,92,246,0)");
        ctx.beginPath();
        d.forEach((k, i) => (i ? ctx.lineTo(x(i), y(k.c)) : ctx.moveTo(x(i), y(k.c))));
        ctx.lineTo(x(d.length - 1), padT + ch); ctx.lineTo(x(0), padT + ch); ctx.closePath();
        ctx.fillStyle = grad; ctx.fill();
        ctx.beginPath();
        d.forEach((k, i) => (i ? ctx.lineTo(x(i), y(k.c)) : ctx.moveTo(x(i), y(k.c))));
        ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 2; ctx.stroke();
      }
      ctx.restore();

      note();
      // last price line
      const last = d[d.length - 1].c, ly = y(last);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(167,139,250,.8)";
      ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(W - padR, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#7132f5";
      const lbl = fmtUsd(last);
      const tw = ctx.measureText(lbl).width + 12;
      ctx.beginPath(); ctx.roundRect(W - padR + 2, ly - 10, tw, 20, 4); ctx.fill();
      ctx.fillStyle = "white";
      ctx.fillText(lbl, W - padR + 8, ly);
      if (this.type === "line") {
        const t = performance.now() / 600;
        ctx.fillStyle = "rgba(167,139,250," + (0.35 + 0.25 * Math.sin(t)) + ")";
        ctx.beginPath(); ctx.arc(x(d.length - 1), ly, 7, 0, 7); ctx.fill();
        ctx.fillStyle = "#c4b5fd";
        ctx.beginPath(); ctx.arc(x(d.length - 1), ly, 3.5, 0, 7); ctx.fill();
      }

      // crosshair
      if (this.hx != null && this.hx > padL && this.hx < W - padR) {
        const i = clamp(Math.floor((this.hx - padL) / bw), 0, d.length - 1), k = d[i];
        ctx.strokeStyle = "rgba(255,255,255,.35)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x(i), padT); ctx.lineTo(x(i), padT + ch); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(padL, this.hy); ctx.lineTo(W - padR, this.hy); ctx.stroke();
        ctx.setLineDash([]);
        const dt = new Date(k.t);
        this.tip.innerHTML = `${dt.toLocaleDateString("en-US", { day: "2-digit", month: "short" })} ${dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}<br>O ${fmtUsd(k.o)} · H ${fmtUsd(k.h)} · L ${fmtUsd(k.l)} · C <b>${fmtUsd(k.c)}</b><br>Vol ${fmtEth(k.v)} ETH`;
        this.tip.style.display = "block";
        this.tip.style.left = clamp(x(i), 120, W - 140) + "px";
        this.tip.style.top = Math.max(84, y(k.h)) + "px";
      }
    }
  }

  function spark(canvas, values, animate = true) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H || values.length < 2) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lo = Math.min(...values), hi = Math.max(...values) || 1;
    const up = values[values.length - 1] >= values[0];
    const col = up ? "46,204,113" : "255,78,78";
    const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 10 - ((v - lo) / (hi - lo || 1)) * (H * 0.55)]);
    let p = animate ? 0 : 1;
    const t0 = performance.now();
    const frame = (t) => {
      if (animate) p = Math.min(1, (t - t0) / 700);
      ctx.clearRect(0, 0, W, H);
      const n = Math.max(2, Math.ceil(pts.length * p));
      const g = ctx.createLinearGradient(0, H * 0.3, 0, H);
      g.addColorStop(0, `rgba(${col},.45)`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.beginPath();
      pts.slice(0, n).forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.lineTo(pts[n - 1][0], H); ctx.lineTo(0, H); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath();
      pts.slice(0, n).forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
      ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 2.5; ctx.lineJoin = "round"; ctx.stroke();
      ctx.fillStyle = "white";
      ctx.beginPath(); ctx.arc(pts[n - 1][0], pts[n - 1][1], 3.5, 0, 7); ctx.fill();
      if (p < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  function sparkValues(tok, n = 40) {
    if (tok.ext) {
      const P = tok.mcapEth, p = tok.pc;
      return [p.h24, p.h6, p.h1, p.m30, p.m15, p.m5].map((x) => P / (1 + x / 100)).concat([P]);
    }
    const tr = tok.trades;
    const vals = [tok.startMcapEth, ...tr.map((t) => t.mcapEth)];
    if (vals.length <= n) return vals.length > 1 ? vals : [vals[0], vals[0]];
    const out = [];
    for (let i = 0; i < n; i++) out.push(vals[Math.floor((i / (n - 1)) * (vals.length - 1))]);
    return out;
  }

  // ------------------------------------------------------------------------
  // UI helpers
  // ------------------------------------------------------------------------
  function toast(msg, hash) {
    const el = document.createElement("div");
    el.className = "toast";
    const url = API.txUrl(hash);
    el.innerHTML = `<span>${esc(msg)}</span>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">View</a>` : ""}`;
    $("#toasts").appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 300);
    }, 4200);
  }
  // Custom errors of the launchpads and of the v2 hook (the PoolManager wraps hook reverts in WrappedError).
  const ERR_TEXT = {
    Slippage: "Price moved: you would get less than your minimum. Try again or raise the slippage",
    InvalidParams: "Invalid parameters", InvalidFeeSplit: "Invalid fee split", InsufficientFee: "Launch fee not covered",
    UnknownToken: "Unknown token", NotCreator: "Only the token creator can do this",
    TradingNotStarted: "Premiere: trading has not opened yet", MaxBuyExceeded: "Anti-snipe: this buy is above the max per swap for now",
    WhitelistOnly: "Whitelist only: your wallet is not on this token's whitelist yet",
    InvalidGuard: "These anti-snipe, whitelist or tax settings are outside the allowed limits", AlreadyRegistered: "Pool rules are already set",
  };
  const ERR_IFACE = window.ethers
    ? new window.ethers.Interface([
        ...Object.keys(ERR_TEXT).filter((k) => !["TradingNotStarted", "MaxBuyExceeded", "WhitelistOnly"].includes(k)).map((k) => `error ${k}()`),
        "error TradingNotStarted(uint64 tradingStart)", "error MaxBuyExceeded(uint256 maxBuyPerSwap)", "error WhitelistOnly(uint256 publicFrom)",
        "error WrappedError(address target,bytes4 selector,bytes reason,bytes details)",
      ])
    : null;
  function revertText(e) {
    const data = [e?.data, e?.info?.error?.data, e?.error?.data, e?.info?.error?.data?.data].find((d) => typeof d === "string" && /^0x[0-9a-f]{8}/i.test(d));
    if (!data || !ERR_IFACE) return null;
    try {
      let err = ERR_IFACE.parseError(data);
      if (err && err.name === "WrappedError") err = ERR_IFACE.parseError(err.args.reason);
      return err ? ERR_TEXT[err.name] || err.name : null;
    } catch {
      return null;
    }
  }
  function errMsg(e) {
    const rv = revertText(e);
    if (rv) return rv;
    const m = e?.shortMessage || e?.info?.error?.message || e?.reason || e?.message || String(e);
    if (/user rejected|denied/i.test(m)) return "Transaction cancelled";
    return m.length > 140 ? m.slice(0, 140) + "…" : m;
  }
  const progress = {
    start() {
      const p = $("#progress");
      p.className = "";
      p.style.transition = "none";
      p.style.width = "0";
      void p.offsetWidth;
      p.style.transition = "";
      p.style.width = "";
      p.className = "run";
    },
    done() {
      const p = $("#progress");
      p.className = "done";
    },
  };
  function confetti() {
    const c = document.createElement("canvas");
    c.className = "confetti";
    document.body.appendChild(c);
    const ctx = c.getContext("2d");
    c.width = innerWidth; c.height = innerHeight;
    const cols = ["#7132f5", "#8b5cf6", "#c084fc", "#f0abfc", "#ffffff", "#2ecc71"];
    const parts = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2, y: innerHeight * 0.45, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 4,
      s: 4 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[Math.floor(Math.random() * cols.length)],
    }));
    const t0 = performance.now();
    const f = (t) => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const p of parts) {
        p.vy += 0.42; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      }
      if (t - t0 < 2600) requestAnimationFrame(f);
      else c.remove();
    };
    requestAnimationFrame(f);
  }
  const isWatched = (a) => S.watch.includes(lc(a));
  function toggleWatch(a) {
    a = lc(a);
    S.watch = isWatched(a) ? S.watch.filter((x) => x !== a) : [...S.watch, a];
    store.set("watch", S.watch);
    renderSidebar();
    return isWatched(a);
  }
  const tokenTitle = (t) => `${esc(t.name)} ($${esc(t.symbol)})`;

  // ------------------------------------------------------------------------
  // Shell
  // ------------------------------------------------------------------------
  function renderShell() {
    document.documentElement.dataset.theme = S.theme;
    $("#app").innerHTML = `
      <header class="topbar">
        <div class="left">
          <button class="icon-btn" data-act="menu" aria-label="Menu">${I.menu}</button>
          <a class="logo" href="#/" aria-label="InkTube, home"><span class="logo-mark"><svg viewBox="0 0 24 24"><path d="${P.play}"/></svg></span>InkTube<sup>INK</sup></a>
        </div>
        <div class="search" id="search">
          <form id="search-form" role="search">
            <div class="field"><svg class="i lead" viewBox="0 0 24 24"><path d="${P.search}"/></svg>
              <input id="q" placeholder="Search" autocomplete="off" aria-label="Search" /></div>
            <button class="go" aria-label="Search">${I.search}</button>
          </form>
          <button class="icon-btn" data-act="voice" title="Voice search">${I.mic}</button>
        </div>
        <div class="right">
          <button class="icon-btn mobile-only" data-act="search-open" aria-label="Search">${I.search}</button>
          <button class="btn" data-act="upload">${I.add}<span class="create-label">Create</span></button>
          <div style="position:relative">
            <button class="icon-btn" data-act="notifs" aria-label="Notifications">${I.bell}<span class="dot" id="notif-dot" hidden></span></button>
            <div id="notif-menu"></div>
          </div>
          <div id="acct" style="position:relative"></div>
        </div>
      </header>
      <nav class="sidebar" id="sidebar"></nav>
      <div class="scrim" data-act="menu"></div>
      <main id="main"></main>
      <nav class="bottom-nav">
        <a href="#/" data-nav="home">${I.home}Home</a>
        <a href="#/shorts" data-nav="shorts">${I.bolt}Shorts</a>
        <button data-act="upload"><span class="plus">${I.add}</span></button>
        <a href="#/subs" data-nav="subs">${I.subs}Subscriptions</a>
        <a href="#/you" data-nav="you">${I.person}You</a>
      </nav>`;
    renderSidebar();
    renderAccount();
  }

  function renderSidebar() {
    const sb = $("#sidebar");
    if (!sb) return;
    const n = S.route.name;
    const item = (href, icon, label, key, extra = "") =>
      `<a class="nav-item ${n === key ? "active" : ""}" href="${href}" ${extra}>${I[icon]}<span>${label}</span></a>`;
    const subs = S.watch.map(getTok).filter(Boolean);
    const shown = S.subsExpanded ? subs : subs.slice(0, 7);
    const chanHref = S.account ? `#/channel/${S.account}` : "#/you";
    sb.innerHTML = `
      <div class="sec main">
        ${item("#/", "home", "Home", "home")}
        ${item("#/shorts", "shorts", "Shorts", "shorts")}
        <div class="mini-only">
          ${item("#/subs", "subs", "Subscriptions", "subs")}
          ${item("#/you", "lib", "You", "you")}
        </div>
      </div>
      <div class="sec">
        <a class="sec-h" href="#/subs">Subscriptions ${I.chev}</a>
        ${subs.length
          ? shown.map((t) => `<a class="nav-item chan-item" href="#/watch/${t.address}"><img src="${esc(t.image)}" alt=""><span>${esc(t.name)}</span>${stats(t).live ? '<i class="live-dot"></i>' : ""}</a>`).join("") +
            (subs.length > 7 ? `<button class="nav-item" data-act="subs-more">${S.subsExpanded ? I.less : I.expand}<span>${S.subsExpanded ? "Show fewer" : "Show more"}</span></button>` : "")
          : `<div class="side-hint">Subscribe to tokens to see them here.</div>`}
      </div>
      <div class="sec">
        <a class="sec-h" href="#/you">You ${I.chev}</a>
        ${item(chanHref, "channel", "Your channel", "channel")}
        ${item("#/history", "history", "History", "history")}
        ${item("#/liked", "up", "Liked tokens", "liked")}
        ${item("#/you", "lib", "Your launches", "you")}
      </div>
      <div class="sec">
        <h4>Explore</h4>
        ${item("#/trending", "fire", "Trending", "trending")}
        ${item("#/new", "newi", "New", "new")}
        ${item("#/live", "live", "Live", "live")}
        ${item("#/top", "trend", "Top market cap", "top")}
      </div>
      <div class="foot">
        <div style="margin-bottom:8px"><span class="lock-badge">${I.lock} LP locked forever</span></div>
        <b>Uniswap v4</b> · one-sided LP · no bonding curve · no price ceiling · starts at a <b>$3,000</b> market cap.<br>
        Network: <b>Ink</b> (${CFG.CHAIN_ID})<br>
        <span style="opacity:.7">© 2026 InkTube</span>
      </div>`;
  }

  function rememberView(addr) {
    const k = lc(addr);
    S.history = [k, ...S.history.filter((x) => x !== k)].slice(0, 100);
    store.set("history", S.history);
  }

  function renderAccount() {
    const el = $("#acct");
    if (!el) return;
    if (!S.account) {
      el.innerHTML = `<button class="btn outline" data-act="connect">${I.wallet}<span class="conn-label">Connect</span></button>`;
      return;
    }
    el.innerHTML = `<button class="icon-btn" data-act="acct-menu" aria-label="Account">${avatar(S.account)}</button><div id="acct-menu"></div>`;
  }

  async function openAcctMenu() {
    const m = $("#acct-menu");
    if (m.innerHTML) return (m.innerHTML = "");
    const b = await API.balances();
    m.innerHTML = `<div class="menu">
      <div class="who">${avatar(S.account, "lg")}<div><div style="font-weight:500">${short(S.account)}</div><div class="muted mono" style="font-size:12px">${fmtEth(b.eth)} ETH</div></div></div>
      <div class="sep"></div>
      <a class="mi" href="#/channel/${S.account}">${I.person}Your channel</a>
      <a class="mi" href="#/you">${I.lib}Your tokens</a>
      <button class="mi" data-act="theme">${S.theme === "dark" ? I.sun : I.moon}Theme: ${S.theme === "dark" ? "dark" : "light"}</button>
      <a class="mi" href="${esc(CFG.EXPLORER)}/address/${S.account}" target="_blank" rel="noopener">${I.ext}View on explorer</a>
      <div class="sep"></div>
      <button class="mi" data-act="disconnect">${I.logout}Disconnect</button>
    </div>`;
  }

  function renderNotifs() {
    const m = $("#notif-menu");
    if (m.innerHTML) return (m.innerHTML = "");
    S.unread = 0;
    updateNotifDot();
    m.innerHTML = `<div class="menu" style="width:min(420px,calc(100vw - 24px));right:-60px;max-height:70vh;overflow:auto">
      <div style="padding:8px 16px 12px;font-size:16px;font-weight:500;border-bottom:1px solid var(--border)">Notifications</div>
      ${S.notifs.length
        ? S.notifs.slice(0, 30).map((n) => `<a class="mi" style="height:auto;padding:10px 16px;align-items:flex-start" href="#/watch/${n.tok.address}">
            ${avatar(n.tok.creator)}<div style="flex:1;min-width:0"><div>${n.html}</div><div class="muted" style="font-size:12px">${ago(n.t)}</div></div>
            <img src="${esc(n.tok.thumb || n.tok.image)}" alt="" style="width:86px;aspect-ratio:16/9;object-fit:cover;border-radius:6px"></a>`).join("")
        : `<div class="empty" style="padding:40px">${I.bell}<div>New launches and trades from your subscriptions will show up here.</div></div>`}
    </div>`;
  }
  function updateNotifDot() {
    const d = $("#notif-dot");
    if (!d) return;
    d.hidden = !S.unread;
    d.textContent = S.unread > 9 ? "9+" : S.unread;
  }

  // ------------------------------------------------------------------------
  // Cards (YouTube layout: full-bleed thumbnail, duration-style badge, avatar + 3 lines)
  // ------------------------------------------------------------------------
  function card(t, i = 0, rank) {
    const st = stats(t);
    const k = lc(t.address);
    const ext = !!t.ext;
    const avatarHtml = ext
      ? `<img class="avatar ch" src="${esc(t.image)}" alt="">`
      : `<span data-go="#/channel/${t.creator}">${avatar(t.creator, "ch")}</span>`;
    const channel = ext
      ? `<span class="chan">${esc(t.dex)}</span><span class="tag-ext">On Ink</span>`
      : `<a class="chan" data-go="#/channel/${t.creator}">${short(t.creator)} ${I.check}</a>`;
    const line = ext
      ? `${I.playo}<span data-n="${k}">${fmtCount(st.trades)}</span> trades/24h <span class="dot-sep">·</span> <span class="${st.change24 >= 0 ? "up" : "down"}">${fmtPct(st.change24)}</span>`
      : `${I.playo}<span data-n="${k}">${fmtCount(st.trades)}</span> trade${st.trades === 1 ? "" : "s"} <span class="dot-sep">·</span> ${ago(t.createdAt)}`;
    return `<div class="card" data-go="#/watch/${t.address}" data-card="${k}" ${ext ? 'data-ext="1"' : ""} style="animation-delay:${Math.min(i, 18) * 35}ms">
      <div class="thumb">
        <img class="cover" src="${esc(t.thumb || t.image)}" alt="" loading="lazy">
        <div class="preview"><canvas></canvas><div class="hint">${I.play} ${ext ? `${fmtPct(st.change24)} in 24h` : `${fmtPct(st.changeAll)} since launch`}</div></div>
        ${rank ? `<span class="rank">#${rank}</span>` : ""}
        <div class="br">${!ext && v2State(t)?.premiere ? `<span class="badge prem" title="Trading opens ${esc(fmtDate(t.opts.tradingStart))}">${I.live}PREMIERE</span>` : st.live ? `<span class="badge live">${I.live}LIVE</span>` : ""}<span class="badge" data-mc="${k}">${fmtUsd(usd(t.mcapEth))}</span></div>
        ${ext ? "" : `<div class="bar"><i data-bar="${k}" style="width:${(st.sold * 100).toFixed(1)}%"></i></div>`}
      </div>
      <div class="meta">
        ${avatarHtml}
        <div class="mt">
          <h3 class="title">${tokenTitle(t)}</h3>
          <div class="sub">
            <div class="chan-line">${channel}</div>
            <div class="stats-line">${line}</div>
            ${st.isNew && !ext ? '<span class="tag-new">New</span>' : ""}
          </div>
        </div>
        <button class="icon-btn more" data-act="watch-toggle" data-addr="${t.address}" title="${isWatched(t.address) ? "Unsubscribe" : "Subscribe"}">${I.more}</button>
      </div>
    </div>`;
  }
  function ctaCard() {
    return `<div class="card cta" data-act="upload">
      <div class="thumb cta-thumb"><div class="cta-in">${I.add}<b>Launch your token</b><span>It will take the spot of an external token</span></div></div>
      <div class="meta"><span class="avatar ch" style="background:var(--chip);color:var(--ink-3)">${I.add}</span>
        <div class="mt"><h3 class="title">Your video here</h3><div class="sub"><div>Starts at $3,000 · LP locked forever</div><div>80% of LP fees go to you</div></div></div></div>
    </div>`;
  }
  function shortsShelf(list) {
    if (list.length < 3) return "";
    return `<section class="shelf">
      <div class="section-title">${I.shorts} Shorts</div>
      <div class="shorts-row">${list.slice(0, 6).map((t, i) => `<a class="short-card" href="#/shorts" style="animation-delay:${i * 40}ms">
        <div class="st"><img src="${esc(t.image)}" alt="" loading="lazy"><span class="sm">${fmtUsd(usd(t.mcapEth))}</span></div>
        <div class="sn">${esc(t.name)} ($${esc(t.symbol)})</div>
        <div class="sv">${t.ext ? `${fmtCount(stats(t).trades)} trades/24h` : `${fmtCount(stats(t).trades)} trades`}</div>
      </a>`).join("")}</div>
    </section>`;
  }
  function skeletonGrid(n = 12) {
    return `<div class="grid">${Array.from({ length: n }, () => `<div class="card"><div class="thumb skel"></div><div class="meta"><div class="skel" style="width:40px;height:40px;border-radius:50%"></div><div style="flex:1"><div class="skel" style="height:18px;margin-bottom:8px"></div><div class="skel" style="height:14px;width:60%"></div></div></div></div>`).join("")}</div>`;
  }

  // ------------------------------------------------------------------------
  // Pages
  // ------------------------------------------------------------------------
  let currentChart = null;
  let pageCleanup = [];
  const onCleanup = (f) => pageCleanup.push(f);

  const CHIPS = [
    ["all", "All"], ["new", "New"], ["live", "Live"], ["trending", "Trending"], ["near10", "Almost $10K"],
    ["top", "Top market cap"], ["subs", "Subscriptions"], ["fresh", "Still at $3K"],
  ];
  function filterTokens(f) {
    if (String(f).startsWith("cat:")) {
      const c = f.slice(4);
      return S.tokens.filter((t) => t.category === c).sort((a, b) => b.mcapEth - a.mcapEth);
    }
    const withExt = ["trending", "top", "live"].includes(f);
    const list = f === "subs" ? [...S.tokens, ...Ext.list] : [...S.tokens, ...(withExt ? extVisible() : [])];
    const st = new Map(list.map((t) => [t, stats(t)]));
    switch (f) {
      case "new": return list.sort((a, b) => b.createdAt - a.createdAt);
      case "live": return list.filter((t) => st.get(t).live).sort((a, b) => st.get(b).last - st.get(a).last);
      case "trending": return list.sort((a, b) => st.get(b).vol24 - st.get(a).vol24);
      case "near10": return list.filter((t) => usd(t.mcapEth) >= 5000 && usd(t.mcapEth) < 10000).sort((a, b) => b.mcapEth - a.mcapEth);
      case "top": return list.sort((a, b) => b.mcapEth - a.mcapEth);
      case "subs": return list.filter((t) => isWatched(t.address));
      case "cat": return list;
      case "fresh": return list.filter((t) => usd(t.mcapEth) < 3600).sort((a, b) => b.createdAt - a.createdAt);
      default: {
        // "home feed": mix of activity and freshness
        const score = (t) => {
          const s = st.get(t);
          return Math.log10(1 + s.vol24 * 100) + (s.live ? 1.5 : 0) + (s.isNew ? 1.2 : 0) + Math.log10(t.mcapEth * S.ethUsd) * 0.4;
        };
        return list.sort((a, b) => score(b) - score(a));
      }
    }
  }

  function statusBanner() {
    if (LIVE) return "";
    return `<div class="demo-banner">${I.lock}<div><b>Launching soon</b> — InkTube opens on Ink very soon. Meanwhile, here are the tokens pumping on Ink.</div></div>`;
  }

  // Category chips appear as soon as one InkTube token uses the category (like YouTube's topic chips).
  function chipList() {
    const used = new Set(S.tokens.map((t) => t.category).filter(Boolean));
    const cats = Object.keys(CATS).filter((k) => used.has(k)).map((k) => ["cat:" + k, CATS[k]]);
    return [...CHIPS.slice(0, 4), ...cats, ...CHIPS.slice(4)];
  }
  function chipsBar(filter) {
    return `<div class="chips-wrap">
      <div class="chips" id="chips">${chipList().map(([k, l]) => `<button class="chip ${k === filter ? "active" : ""}" data-chip="${k}">${l}</button>`).join("")}</div>
      <button class="chips-next icon-btn" data-act="chips-next" aria-label="More filters">${I.chev}</button>
    </div>`;
  }

  function pageHome(filter = "all") {
    S.homeFilter = filter;
    const chips = chipsBar(filter);
    if (filter !== "all") {
      const list = filterTokens(filter);
      $("#main").innerHTML = `<div class="page">${chips}${statusBanner()}
        ${list.length ? `<div class="grid">${list.map((t, i) => card(t, i)).join("")}</div>` : emptyState(filter)}</div>`;
      return;
    }
    const own = filterTokens("all"), ext = extVisible();
    if (!own.length && !ext.length) {
      $("#main").innerHTML = `<div class="page">${chips}${statusBanner()}${emptyState("all")}</div>`;
      return;
    }
    const shortsList = [...[...S.tokens].sort((a, b) => b.createdAt - a.createdAt), ...ext];
    $("#main").innerHTML = `<div class="page">
      ${chips}${statusBanner()}
      ${ext.length ? `<div class="section-title">${I.lib} Launched on InkTube <span class="count" id="own-count">${own.length}</span></div>` : ""}
      <div class="grid" id="own-grid">${own.map((t, i) => card(t, i)).join("")}${own.length < BF.TARGET ? ctaCard() : ""}</div>
      ${shortsShelf(shortsList)}
      ${ext.length ? `<div class="section-title" id="ext-title">${I.fire} Pumping on Ink
          <span class="sub-t">Until your launches arrive · every token launched on InkTube takes the spot of one of these · <b id="ext-left">${ext.length}</b> left<span id="ext-updated">${Ext.stale > 1 ? ` · data from ${ago(Ext.stale)}` : ""}</span></span></div>
        <div class="grid" id="ext-grid">${ext.map((t, i) => card(t, i + own.length)).join("")}</div>` : ""}
    </div>`;
  }

  // Un lancement InkTube arrive : il entre en tête et pousse dehors le dernier token externe.
  function homeInsertLaunch(tok) {
    const grid = $("#own-grid");
    if (S.route.name !== "home" || S.homeFilter !== "all" || !grid) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = card(tok, 0);
    const el = tmp.firstElementChild;
    el.classList.add("arrive");
    grid.prepend(el);
    if ($("#own-count")) $("#own-count").textContent = S.tokens.length;
    const keep = extVisible().length;
    $$("#ext-grid .card:not(.leaving)").slice(keep).forEach((c) => {
      c.classList.add("leaving");
      setTimeout(() => c.remove(), 650);
    });
    if ($("#ext-left")) $("#ext-left").textContent = keep;
    if (!keep) {
      setTimeout(() => {
        $("#ext-title")?.remove();
        $("#ext-grid")?.remove();
        $(".card.cta")?.remove();
      }, 700);
    }
  }
  function emptyState(filter) {
    const msg = {
      subs: ["No subscriptions", "Hit “Subscribe” on a token to find it here."],
      live: ["Nothing live", "No trades in the last 5 minutes."],
      near10: ["Nobody between $5K and $10K", "Check back in a few minutes."],
      history: ["Nothing watched yet", "Tokens you open will show up here."],
      liked: ["No liked tokens", "Hit “Like” on a token to save it here."],
    }[filter] || ["No tokens yet", "Be the first to launch a token on InkTube."];
    return `<div class="empty">${I.lib}<h3>${msg[0]}</h3><div>${msg[1]}</div><button class="btn ink" data-act="upload">${I.add}Create a token</button></div>`;
  }

  function pageList(title, icon, list, ranked, emptyKey) {
    $("#main").innerHTML = `<div class="page">
      <div class="section-title">${I[icon]} ${title}</div>
      ${list.length ? `<div class="grid">${list.map((t, i) => card(t, i, ranked ? i + 1 : 0)).join("")}</div>` : emptyState(emptyKey)}
    </div>`;
  }

  function pageSearch(q) {
    const s = q.toLowerCase();
    const list = [...S.tokens, ...Ext.list].filter((t) => t.name.toLowerCase().includes(s) || t.symbol.toLowerCase().includes(s) || lc(t.address).includes(s) || lc(t.creator || "").includes(s) || (t.category && CATS[t.category].toLowerCase().includes(s)));
    pageList(`Results for “${esc(q)}”`, "search", list);
  }

  async function pageYou() {
    if (!S.account) {
      $("#main").innerHTML = `<div class="page"><div class="empty">${I.person}<h3>Get the most out of InkTube</h3><div>Connect your wallet to launch tokens, trade and comment.</div><button class="btn outline" data-act="connect">${I.wallet}Connect wallet</button></div></div>`;
      return;
    }
    const mine = S.tokens.filter((t) => lc(t.creator) === lc(S.account));
    $("#main").innerHTML = `<div class="page"><div class="section-title">${I.lib} Your launches</div>
      ${mine.length ? `<div class="grid">${mine.map((t, i) => card(t, i)).join("")}</div>` : `<div class="muted" style="margin-bottom:24px">You haven't launched anything yet.</div>`}
      <div class="section-title">${I.coin} Your holdings</div><div id="holdings">${skeletonGrid(4)}</div></div>`;
    const bals = await Promise.all(S.tokens.map(async (t) => [t, (await API.balances(t.address)).tok]));
    const held = bals.filter(([, b]) => b > 0).sort((a, b) => b[1] * b[0].mcapEth - a[1] * a[0].mcapEth);
    const el = $("#holdings");
    if (!el) return;
    el.innerHTML = held.length
      ? `<div class="grid">${held.map(([t, b], i) => card(t, i).replace('trades •', `trades • you hold ${fmtNum(b)} (${fmtUsd(usd(b * (t.mcapEth / SUPPLY)))}) •`)).join("")}</div>`
      : `<div class="muted">No holdings yet.</div>`;
  }

  function pageChannel(addr) {
    const mine = S.tokens.filter((t) => lc(t.creator) === lc(addr)).sort((a, b) => b.createdAt - a.createdAt);
    const [a, b] = hues(addr);
    $("#main").innerHTML = `<div class="page">
      <div class="banner" style="background:linear-gradient(120deg,hsl(${a},70%,45%),hsl(${b},70%,25%) 60%,#0f0f0f)"></div>
      <div class="channel-head">${avatar(addr, "xl")}
        <div><h1>${short(addr)}</h1><div class="muted">@${esc(lc(addr).slice(2, 10))} · ${mine.length} token${mine.length > 1 ? "s" : ""} launched</div>
        <div class="muted mono" style="font-size:12px;margin-top:6px">${esc(addr)}</div></div>
      </div>
      <div class="channel-tabs"><button class="on">Tokens</button></div>
      ${mine.length ? `<div class="grid">${mine.map((t, i) => card(t, i)).join("")}</div>` : `<div class="empty">${I.lib}<h3>This channel hasn't launched anything yet</h3></div>`}
    </div>`;
  }

  // ---------------- Shorts ----------------
  function pageShorts() {
    const list = [...[...S.tokens].sort((a, b) => b.createdAt - a.createdAt), ...extVisible()];
    $("#main").innerHTML = `<div class="shorts" id="shorts">${list.map((t) => {
      const st = stats(t);
      return `<section class="short" data-short="${lc(t.address)}">
        <div class="frame">
          <img class="bg" src="${esc(t.image)}" alt="" style="width:calc(100% + 80px);height:calc(100% + 80px);object-fit:cover">
          <img class="art" src="${esc(t.image)}" alt="">
          <canvas></canvas>
          <div class="info">
            <div style="display:flex;align-items:center;gap:8px" ${t.ext ? "" : `data-go="#/channel/${t.creator}"`}>${t.ext ? `<span class="pill-ext">ON INK</span><span style="font-weight:500">${esc(t.dex)}</span>` : `${avatar(t.creator, "sm")}<span style="font-weight:500">${short(t.creator)}</span>`}
              <button class="btn" style="height:28px;background:white;color:black;padding:0 12px;font-size:12px" data-act="watch-toggle" data-addr="${t.address}">${isWatched(t.address) ? "Subscribed" : "Subscribe"}</button></div>
            <div class="t">${tokenTitle(t)} · ${ago(t.createdAt)}</div>
            <div class="mc" data-mc="${lc(t.address)}">${fmtUsd(usd(t.mcapEth))}</div>
            <div style="font-size:13px;opacity:.85">${t.ext ? `${fmtPct(st.change24)} in 24h · ${fmtCount(st.trades)} trades/24h · trending on Ink` : `${fmtPct(st.changeAll)} since $3K · ${fmtCount(st.trades)} trades · <span class="lock-badge" style="background:rgba(255,255,255,.15);color:white">${I.lock} LP lock</span>`}</div>
          </div>
        </div>
        <div class="rail">
          ${t.ext ? `<div class="rb"><button class="icon-btn" data-go="#/watch/${t.address}" title="View">${I.ext}</button>Trade</div>` : `<div class="rb buy"><button class="icon-btn" data-act="quick-buy" data-addr="${t.address}" title="Buy 0.01 ETH">${I.bolt}</button>0.01 Ξ</div>`}
          <div class="rb"><button class="icon-btn" data-act="like" data-addr="${t.address}">${I.up}</button>${S.liked[lc(t.address)] === 1 ? "Liked" : "Like"}</div>
          <div class="rb"><button class="icon-btn" data-go="#/watch/${t.address}">${I.comment}</button>${(t.comments || []).length || ""}</div>
          <div class="rb"><button class="icon-btn" data-act="share" data-addr="${t.address}">${I.share}</button>Share</div>
          <div class="rb"><button class="icon-btn" data-go="#/watch/${t.address}"><img src="${esc(t.image)}" alt="" style="width:32px;height:32px;border-radius:8px;object-fit:cover"></button></div>
        </div>
      </section>`;
    }).join("") || `<div class="empty">${I.bolt}<h3>No shorts</h3></div>`}</div>`;
    const io = new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) {
        const tok = getTok(e.target.dataset.short);
        if (tok) spark($("canvas", e.target), sparkValues(tok, 60));
      }
    }, { threshold: 0.6 });
    $$(".short").forEach((s) => io.observe(s));
    onCleanup(() => io.disconnect());
  }

  // ---------------- Watch ----------------
  const W = { tok: null, side: "buy", tf: 5, paused: false };

  function pageWatch(addr) {
    const t = getTok(addr);
    if (t && t.ext) return pageWatchExt(t);
    if (!t) {
      $("#main").innerHTML = `<div class="page"><div class="empty">${I.lib}<h3>Token not found</h3><div class="mono">${esc(addr)}</div><a class="btn" href="#/">Back to home</a></div></div>`;
      return;
    }
    W.tok = t;
    rememberView(t.address);
    W.paused = false;
    const st = stats(t);
    const isCreator = S.account && lc(S.account) === lc(t.creator);
    const v2 = t.v === 2;
    // v2: anyone may trigger collectFees; show it to the creator and to the fee split recipients.
    const canCollect = isCreator || (S.account && (t.split || []).some((r) => lc(r.addr) === lc(S.account)));
    const creatorCount = S.tokens.filter((x) => lc(x.creator) === lc(t.creator)).length;
    const upNext = [...filterTokens("all"), ...extVisible()].filter((x) => x !== t).slice(0, 14);
    const liked = S.liked[lc(t.address)] || 0;

    $("#main").innerHTML = `<div class="watch">
      <div class="info-col">
        <div class="player" id="player">
          <canvas id="chart"></canvas>
          <div class="overlay-top">
            <img src="${esc(t.image)}" alt="" style="width:40px;height:40px;border-radius:10px;object-fit:cover">
            <div><div class="p" id="w-mc">${fmtUsd(usd(t.mcapEth))}</div>
            <div class="chg" id="w-chg"></div></div>
          </div>
          <div class="tooltip" id="tip"></div>
          <div class="big-play" id="bigplay">${I.pause}</div>
          ${v2 ? `<div class="premiere-ov" id="premiere-ov" hidden></div>` : ""}
          <div class="controls">
            <div class="scrub"><i style="width:100%"></i></div>
            <div class="row">
              <button class="icon-btn" data-act="pp" id="pp" title="Pause / live follow (k)">${I.pause}</button>
              <button class="icon-btn" data-act="vol" id="volbtn" title="Volume">${I.vol}</button>
              <span class="time" id="w-time"></span>
              <span class="sp"></span>
              ${TF.map(([l], i) => `<button class="tf ${i === W.tf ? "active" : ""}" data-tf="${i}">${l}</button>`).join("")}
              <button class="icon-btn" data-act="ctype" title="Candles / line">${I.tune}</button>
              <button class="icon-btn" data-act="fs" title="Fullscreen (f)">${I.fs}</button>
            </div>
          </div>
        </div>

        <h1>${tokenTitle(t)}</h1>
        <div class="owner-row">
          <div class="owner">
            <span data-go="#/channel/${t.creator}" style="cursor:pointer">${avatar(t.creator, "lg")}</span>
            <div style="min-width:0"><div class="name" data-go="#/channel/${t.creator}" style="cursor:pointer">${short(t.creator)} ${I.check}</div>
            <div class="subs">${creatorCount} token${creatorCount > 1 ? "s" : ""} launched</div></div>
            <button class="btn sub-btn ${isWatched(t.address) ? "on" : ""}" data-act="subscribe" data-addr="${t.address}">${isWatched(t.address) ? `${I.bell}Subscribed` : "Subscribe"}</button>
          </div>
          <div class="actions">
            <div class="seg">
              <button data-act="like" data-addr="${t.address}" class="${liked === 1 ? "on" : ""}">${I.up}<span>Like</span></button>
              <button data-act="dislike" data-addr="${t.address}" class="${liked === -1 ? "on" : ""}" aria-label="Dislike">${I.down}</button>
            </div>
            <button class="btn" data-act="share" data-addr="${t.address}">${I.share}Share</button>
            ${canCollect ? `<button class="btn ink" data-act="collect">${I.coin}Collect fees</button>` : ""}
          </div>
        </div>
        ${v2 ? `<div class="v2-box" id="v2-box" hidden></div>` : ""}

        ${isCreator ? listingPanel(t) : ""}
        <div class="desc" id="desc">
          <div class="head"><span id="d-trades">${fmtCount(st.trades)} trade${st.trades === 1 ? "" : "s"}</span><span>Launched ${ago(t.createdAt)}</span><span style="color:var(--ink-3)">#${esc(t.symbol)}${t.category ? ` #${CATS[t.category]}` : ""} #Ink</span></div>
          <div class="text">${esc(t.description || "No description.")}</div>
          ${t.links && Object.keys(t.links).length ? `<div class="links">${LINK_KINDS.filter(([k]) => t.links[k]).map(([k, l, ic]) => `<a class="link-chip" href="${esc(t.links[k])}" target="_blank" rel="noopener nofollow">${I[ic]}<span>${l}</span></a>`).join("")}</div>` : ""}
          <div class="facts" id="facts"></div>
          <span class="toggle" id="d-toggle">More</span>
        </div>

        <div class="comments" id="comments">
          <div class="hdr"><span id="c-count">Comments</span><span class="sort">${I.sort} Newest first</span></div>
          <div class="add-comment" id="add-comment">
            ${S.account ? avatar(S.account, "lg") : `<span class="avatar lg" style="background:var(--chip);color:var(--text-2)">${I.person}</span>`}
            <div class="box">
              <input id="c-input" maxlength="280" placeholder="Add an on-chain comment…" />
              <div class="btns"><span class="counter" id="c-cnt">0/280</span><button class="btn" data-act="c-cancel" style="background:transparent">Cancel</button><button class="btn outline" data-act="c-send" style="color:var(--bg);background:var(--ink-2);border:0">Comment</button></div>
            </div>
          </div>
          <div id="c-list"><div class="skel" style="height:60px"></div></div>
        </div>
      </div>

      <aside class="side-col">
        <div class="trade" id="trade">
          <div class="tabs ${W.side}" id="tabs"><span class="ind"></span>
            <button data-side="buy" class="${W.side === "buy" ? "on" : ""}">Buy</button>
            <button data-side="sell" class="${W.side === "sell" ? "on" : ""}">Sell</button>
          </div>
          ${v2 ? `<div class="v2-banner" id="v2-banner" hidden></div>` : ""}
          <div class="amount"><input id="amt" inputmode="decimal" placeholder="0.0" autocomplete="off" aria-label="Amount"><span class="unit" id="unit"></span></div>
          <div class="presets" id="presets"></div>
          <div class="quote" id="quote"></div>
          <button class="btn go ${W.side}" id="go" data-act="trade"></button>
          <div class="bal" id="bal"><span></span><span></span></div>
          <div class="lockline">${I.lock}<span>100% of supply in a one-sided Uniswap v4 LP · LP locked forever by the contract · 1% LP fee${v2 && t.opts && t.opts.antiSnipe ? ", higher on buys during the anti-snipe window" : ""} (80% to ${v2 && t.split && t.split.length > 1 ? "the creator's fee recipients" : "creator"})</span></div>
        </div>

        <div class="trades-feed"><h3><span class="pill-live">LIVE</span> Latest trades</h3><div id="feed"></div></div>

        <div class="upnext">
          <h3>Up next <span class="muted" style="font-size:12px;font-weight:400">Autoplay</span></h3>
          ${upNext.map(miniRow).join("")}
        </div>
      </aside>
    </div>`;

    if (matchMedia("(max-width: 1100px)").matches) {
      const tr = $("#trade");
      tr.style.marginTop = "16px";
      $(".owner-row").after(tr);
    }
    currentChart = new Chart($("#chart"), $("#tip"));
    onCleanup(() => {
      currentChart?.destroy();
      currentChart = null;
    });
    refreshWatch(true);
    renderFeed();
    renderTrade();
    loadComments(t);
    if (API.poolSwaps) {
      const pull = () => API.poolSwaps(t).then((n) => { if (n && W.tok === t) { refreshWatch(false); renderFeed(true); } }).catch((e) => console.warn("pool swaps:", e.message));
      pull();
      const sw = setInterval(pull, 20000);
      onCleanup(() => clearInterval(sw));
    }
    if (!t.feeTo && API.feeRecipient) API.feeRecipient(t).then((r) => { if (r) { t.feeTo = r; if (W.tok === t) refreshWatch(false); } }).catch(() => {});
    if (v2) loadV2(t);
    let phase = v2Phase(t), lastFeeRead = 0;
    const tick = () => {
      const el = $("#w-time");
      const st = v2State(t);
      if (el) el.innerHTML = st && st.premiere
        ? `<span style="color:#ffb000">●</span> PREMIERE · opens in ${countdown(st.opensIn)}`
        : `<span style="color:#ff4e4e">●</span> LIVE · ${dur(Date.now() - t.createdAt)} since launch`;
      if (!st) return;
      // Anti-snipe window: re-read currentFees() every 3 s so quotes follow the decaying fee.
      if (st.snipe && Date.now() - lastFeeRead > 3000) {
        lastFeeRead = Date.now();
        API.refresh(t).then(() => W.tok === t && updateQuote()).catch(() => {});
      }
      const ph = v2Phase(t);
      if (ph !== phase) {
        phase = ph;
        API.refresh(t).catch(() => {}).then(() => { if (W.tok === t) { renderTrade(); refreshWatch(false); } });
      }
      renderV2();
    };
    tick();
    const timer = setInterval(tick, 1000);
    onCleanup(() => clearInterval(timer));
  }

  // ---------------- Listing kit: logo, header and links for DexScreener / GeckoTerminal ----------------
  // Trading terminals (Axiom, Photon, …) don't read InkTube's on-chain metadata: they show the logo and
  // socials indexed by DexScreener / GeckoTerminal. This panel gives the creator everything to submit.
  function listingPanel(t) {
    const dex = `https://marketplace.dexscreener.com/product/token-info/order?chainId=ink&tokenAddress=${t.address}`;
    const gt = `https://www.geckoterminal.com/ink/tokens/${t.address}`;
    return `<div class="list-kit" id="list-kit">
      <div class="lk-h">${I.ext}<div><b>Show your logo and links on Axiom, DexScreener and other terminals</b>
        <span>Trading terminals take token logos and socials from DexScreener and GeckoTerminal, not from the blockchain. Submit them once for this token.</span></div></div>
      <div class="lk-row">
        <button class="btn" data-act="lk-logo">${I.image}Logo 512×512</button>
        <button class="btn" data-act="lk-header">${I.image}Header 1500×500</button>
        <button class="btn" data-act="lk-copy">${I.copy}Copy token info</button>
      </div>
      <div class="lk-row">
        <a class="btn ink" href="${esc(dex)}" target="_blank" rel="noopener">${I.ext}Submit on DexScreener</a>
        <a class="btn" href="${esc(gt)}" target="_blank" rel="noopener">${I.ext}GeckoTerminal (free, “Update info”)</a>
      </div>
      <div class="muted lk-note">DexScreener's Enhanced Token Info is paid and shows up within minutes. GeckoTerminal's form is free but reviewed by hand. Both ask for a square logo, a 3:1 header and your links.</div>
    </div>`;
  }
  function loadImg(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("Image could not be loaded"));
      im.src = src;
    });
  }
  function drawCover(ctx, im, x, y, w, h) {
    const r = Math.max(w / im.width, h / im.height), sw = w / r, sh = h / r;
    ctx.drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, x, y, w, h);
  }
  function saveCanvas(c, name) {
    return new Promise((res, rej) => {
      try {
        c.toBlob((b) => {
          if (!b) return rej(new Error("Export failed"));
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          a.download = name;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          res();
        }, "image/png");
      } catch (e) {
        rej(e);
      }
    });
  }
  async function downloadLogo(t) {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    drawCover(c.getContext("2d"), await loadImg(t.image), 0, 0, 512, 512);
    await saveCanvas(c, `${t.symbol}-logo-512.png`);
  }
  async function downloadHeader(t) {
    const c = document.createElement("canvas");
    c.width = 1500;
    c.height = 500;
    const ctx = c.getContext("2d");
    if (t.banner) {
      drawCover(ctx, await loadImg(t.banner), 0, 0, 1500, 500);
    } else {
      const g = ctx.createLinearGradient(0, 0, 1500, 500);
      g.addColorStop(0, "#2a1260");
      g.addColorStop(1, "#0b0712");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1500, 500);
      const logo = await loadImg(t.image);
      ctx.save();
      ctx.beginPath();
      ctx.arc(250, 250, 150, 0, Math.PI * 2);
      ctx.clip();
      drawCover(ctx, logo, 100, 100, 300, 300);
      ctx.restore();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 92px Roboto, Arial, sans-serif";
      ctx.fillText(t.name.slice(0, 22), 470, 245);
      ctx.fillStyle = "#c4b5fd";
      ctx.font = "500 54px Roboto, Arial, sans-serif";
      ctx.fillText("$" + t.symbol, 470, 320);
      ctx.fillStyle = "#a1a1aa";
      ctx.font = "400 30px Roboto, Arial, sans-serif";
      ctx.fillText("Launched on InkTube · inktubepad.fun", 470, 385);
    }
    await saveCanvas(c, `${t.symbol}-header-1500x500.png`);
  }
  function tokenInfoText(t) {
    const L = t.links || {};
    return [
      `Name: ${t.name}`, `Symbol: ${t.symbol}`, "Chain: Ink (57073)", `Contract: ${t.address}`,
      t.description ? `Description: ${t.description}` : "",
      L.w ? `Website: ${L.w}` : "", L.x ? `X / Twitter: ${L.x}` : "", L.tg ? `Telegram: ${L.tg}` : "", L.dc ? `Discord: ${L.dc}` : "",
      `InkTube page: https://inktubepad.fun/#/watch/${t.address}`,
    ].filter(Boolean).join("\n");
  }

  // ---------------- v2 token page: Premiere, anti-snipe, vesting ----------------
  const v2Phase = (t) => { const st = v2State(t); return !st ? "" : st.premiere ? "premiere" : st.snipe ? "snipe" : "open"; };
  async function loadV2(t) {
    try {
      await API.v2Info(t);
    } catch (e) {
      console.warn("v2Info", e);
    }
    if (W.tok === t) {
      renderV2(true);
      refreshWatch(false);
    }
  }
  // Linear unlock with cliff, same as InkTubeLaunchpadV2.vestedAmount().
  function vestNow(v, now = Date.now()) {
    if (!v || !v.total) return null;
    const cliffEnd = v.start + v.cliff * 1000, end = v.start + v.duration * 1000;
    const vested = now < cliffEnd ? 0 : now >= end ? v.total : (v.total * (now - v.start)) / (v.duration * 1000);
    return { cliffEnd, end, vested, claimable: Math.max(0, vested - v.claimed), started: now >= v.start };
  }
  let v2BoxKey = "";
  function renderV2(force) {
    const t = W.tok;
    if (!t || t.v !== 2) return;
    const st = v2State(t);
    const ov = $("#premiere-ov");
    if (ov) {
      ov.hidden = !(st && st.premiere);
      if (st && st.premiere) ov.innerHTML = `<div class="k">${I.live}Premiere</div><div class="cd">${countdown(st.opensIn)}</div><div class="s">Trading opens ${esc(fmtDate(t.opts.tradingStart))}${st.preset.dur ? ` · anti-snipe ${esc(st.preset.name)}` : ""}</div>`;
    }
    const bn = $("#v2-banner");
    if (bn) {
      const html = st && st.premiere
        ? `<b>${I.live}Premiere</b><span>Trading opens in <b>${countdown(st.opensIn)}</b>. Buys and sells are blocked on-chain until then.</span>`
        : st && st.whitelist
          ? `<b>${I.person}Whitelist only</b><span>Only listed wallets can buy for <b>${countdown(st.wlEnd - Date.now())}</b>. Selling is open to everyone.</span>`
        : st && st.snipe
          ? `<b>${I.lock}Anti-snipe: ${pct(st.buyFee)} buy fee</b><span>Falls to 1% in <b>${countdown(st.snipeEnd - Date.now())}</b>${st.maxBuy ? ` · max ${fmtNum(st.maxBuy)} ${esc(t.symbol)} per buy` : ""}. Sells pay 1%.</span>`
          : "";
      bn.hidden = !html;
      bn.className = "v2-banner " + (st && st.premiere ? "prem" : "snipe");
      if (html) bn.innerHTML = html;
    }
    const go = $("#go");
    if (go && S.account && st && st.premiere) {
      go.disabled = true;
      go.textContent = `Opens in ${countdown(st.opensIn)}`;
    }
    const box = $("#v2-box");
    if (!box) return;
    const v = t.vest, vn = vestNow(v);
    if (!vn) {
      box.hidden = true;
      return;
    }
    const mine = S.account && lc(S.account) === lc(v.beneficiary);
    const can = mine && vn.claimable > 0;
    // Rebuild only when the layout changes, so the Claim button stays clickable; numbers update in place.
    const key = [mine, can, vn.started, Date.now() >= vn.cliffEnd, v.claimed, v.at].join("|");
    if (force || key !== v2BoxKey || box.hidden) {
      v2BoxKey = key;
      box.hidden = false;
      box.innerHTML = `<div class="vb-h">${I.lock}<div><b>Creator buy vesting until ${esc(fmtDate(vn.end))}</b>
          <span>${fmtNum(v.total)} ${esc(t.symbol)} held by the launchpad · ${!vn.started ? `starts when trading opens (${esc(fmtDate(v.start))})` : Date.now() < vn.cliffEnd ? `cliff until ${esc(fmtDate(vn.cliffEnd))}` : "unlocking linearly"} · ${fmtDays(v.duration)} total${v.cliff ? `, ${fmtDays(v.cliff)} cliff` : ""}</span></div></div>
        <div class="vb-bar"><i id="vb-bar"></i></div>
        <div class="vb-row"><span>Unlocked <b id="vb-vested"></b></span><span>Claimed <b>${fmtNum(v.claimed)}</b></span><span>Claimable <b id="vb-claimable"></b></span>
          ${mine ? `<button class="btn ink" data-act="claim" ${can ? "" : "disabled"}>${I.coin}Claim</button>` : `<span class="muted">Beneficiary <span class="mono">${short(v.beneficiary)}</span></span>`}</div>`;
    }
    $("#vb-bar").style.width = ((vn.vested / v.total) * 100).toFixed(2) + "%";
    $("#vb-vested").textContent = `${((vn.vested / v.total) * 100).toFixed(1)}%`;
    $("#vb-claimable").textContent = `${fmtNum(vn.claimable)} ${t.symbol}`;
  }

  function refreshWatch(animate) {
    const t = W.tok;
    if (!t || !currentChart) return;
    if (t.ext) return refreshExtWatch(animate);
    const st = stats(t);
    if (!W.paused) {
      const cs = buildCandles(t, TF[W.tf][1]);
      // The pool price is the truth (trades through other routers move it too).
      if (cs.length) {
        const last = cs[cs.length - 1], v = usd(t.mcapEth);
        last.c = v;
        last.h = Math.max(last.h, v);
        last.l = Math.min(last.l, v);
      }
      currentChart.set(cs, animate, t.trades.length ? "" : "No trades yet · the first buy starts the chart");
    }
    $("#w-mc").textContent = fmtUsd(usd(t.mcapEth));
    $("#w-chg").innerHTML = `<span class="${st.changeAll >= 0 ? "up" : "down"}">${fmtPct(st.changeAll)}</span> since launch · price ${fmtTiny(usd(t.mcapEth) / SUPPLY)}`;
    $("#d-trades").textContent = `${fmtCount(st.trades)} trade${st.trades === 1 ? "" : "s"}`;
    $("#facts").innerHTML = [
      ["Market cap", fmtUsd(usd(t.mcapEth))],
      ["Price", fmtTiny(usd(t.mcapEth) / SUPPLY)],
      ["24h change", `<span class="${st.change24 >= 0 ? "up" : "down"}">${fmtPct(st.change24)}</span>`],
      ["24h volume", `${fmtEth(st.vol24)} ETH (${fmtUsd(usd(st.vol24))})`],
      ["All-time high", fmtUsd(usd(st.ath))],
      ["Starting market cap", fmtUsd(usd(t.startMcapEth))],
      ["Supply bought", `${(st.sold * 100).toFixed(2)}%`],
      ["Unique traders", fmtCount(st.traders)],
      ["Total supply", "1,000,000,000"],
      ["Liquidity", `<span class="lock-badge">${I.lock} locked forever</span>`],
      ["Curve", "None (v4 pool from block 0)"],
      ["Ceiling", "None (range up to the max price)"],
      ["Contract", `<span class="mono">${short(t.address)}</span><button data-act="copy" data-copy="${t.address}" title="Copy">${I.copy}</button><a href="${esc(CFG.EXPLORER)}/token/${t.address}" target="_blank" rel="noopener" title="Explorer">${I.ext}</a>`],
      ["Creator", `<span class="mono">${short(t.creator)}</span><button data-act="copy" data-copy="${t.creator}" title="Copy">${I.copy}</button>`],
      ["Creator buy at launch", t.devBuyTokens > 0 ? `<span class="${t.devBuyTokens / SUPPLY > 0.05 ? "down" : ""}">${((t.devBuyTokens / SUPPLY) * 100).toFixed(2)}% of supply</span>${t.vest && t.vest.total ? " · vesting" : ""}` : "None"],
      ...(t.feeTo && lc(t.feeTo) !== lc(t.creator) ? [["Creator fees go to", `<span class="mono">${short(t.feeTo)}</span><button data-act="copy" data-copy="${t.feeTo}" title="Copy">${I.copy}</button>`]] : []),
      ...v2Facts(t),
    ].map(([k, v]) => `<div class="fact"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");
  }

  function v2Facts(t) {
    if (t.v !== 2) return [];
    const o = t.opts, st = v2State(t), out = [["Launchpad", "InkTube v2"]];
    if (o) {
      out.push(["Market cap tier", fmtUsd(o.startMcapUsd)]);
      const sched = o.tradingStart - t.createdAt > 60e3;
      if (sched || st.premiere) out.push([st.premiere ? "Premiere" : "Trading opened", fmtDate(o.tradingStart)]);
      const g = st.guard;
      out.push(["Taxes", `<span class="${g.buyFee > 50000 || g.sellFee > 50000 ? "down" : ""}">Buy ${pct(g.buyFee)} · sell ${pct(g.sellFee)}</span> · fixed`]);
      out.push(["Anti-snipe", o.antiSnipe ? `${ANTI_SNIPE[o.antiSnipe].name} · ${esc(rulesText(g, t.symbol))}${st.snipe ? ` · <span class="down">active now</span>` : st.premiere ? "" : " · ended"}` : "Off"]);
      if (g.wlWin) out.push(["Whitelist", `${g.wlCount} wallet${g.wlCount > 1 ? "s" : ""} · first ${secs(g.wlWin)}${st.whitelist ? ` · <span class="down">active now</span>` : st.premiere ? "" : " · ended"}`]);
      if (t.vest && t.vest.total) {
        const vn = vestNow(t.vest);
        out.push(["Creator buy vesting", `until ${fmtDate(vn.end)}${t.vest.cliff ? ` (cliff ${fmtDays(t.vest.cliff)})` : ""}`]);
      }
    }
    if (t.split && t.split.length) {
      out.push([t.split.length > 1 ? "Creator fees split" : "Creator fees go to", t.split.map((r) => `<span class="split-r"><span class="mono">${short(r.addr)}</span> ${+(r.bps / 100).toFixed(2)}%<button data-act="copy" data-copy="${r.addr}" title="Copy">${I.copy}</button></span>`).join("")]);
    }
    return out;
  }

  // ---------------- Watch (token externe, tendance Ink) ----------------
  const EXT_TF = [["minute", 1], ["minute", 5], ["minute", 15], ["hour", 1], ["hour", 4], ["day", 1]];
  async function loadExtCandles(t, tf) {
    const [res, agg] = EXT_TF[tf];
    const d = await Ext.get(`/networks/${BF.NETWORK}/pools/${t.pool}/ohlcv/${res}?aggregate=${agg}&limit=140&currency=usd&token=base`, 120e3);
    const m = new Map();
    for (const r of d?.data?.attributes?.ohlcv_list || []) m.set(r[0], r);
    const k = t.supply;
    return [...m.values()].sort((a, b) => a[0] - b[0]).map((r) => ({ t: r[0] * 1000, o: r[1] * k, h: r[2] * k, l: r[3] * k, c: r[4] * k, v: r[5] }));
  }

  function miniRow(x, i) {
    return `<div class="mini" data-go="#/watch/${x.address}" style="animation-delay:${i * 30}ms">
      <div class="thumb"><img class="cover" src="${esc(x.thumb || x.image)}" alt="" loading="lazy"><div class="br"><span class="badge" data-mc="${lc(x.address)}">${fmtUsd(usd(x.mcapEth))}</span></div></div>
      <div style="min-width:0"><div class="t">${tokenTitle(x)}</div><div class="s">${x.ext ? `${esc(x.dex)} <span class="tag-ext">On Ink</span>` : `${short(x.creator)} ${I.check}`}</div><div class="s">${x.ext ? `${fmtCount(x.tx24)} trades/24h` : `${fmtCount(x.trades.length)} trades · ${ago(x.createdAt)}`}</div></div>
    </div>`;
  }

  function pageWatchExt(t) {
    W.tok = t;
    rememberView(t.address);
    W.paused = false;
    W.extCandles = null;
    const st = stats(t);
    const liked = S.liked[lc(t.address)] || 0;
    const upNext = [...filterTokens("all"), ...extVisible()].filter((x) => x !== t).slice(0, 14);
    const gt = `https://www.geckoterminal.com/${BF.NETWORK}/pools/${t.pool}`;
    $("#main").innerHTML = `<div class="watch">
      <div class="info-col">
        <div class="player" id="player">
          <canvas id="chart"></canvas>
          <div class="overlay-top">
            <img src="${esc(t.image)}" alt="" style="width:40px;height:40px;border-radius:10px;object-fit:cover">
            <div><div class="p" id="w-mc">${fmtUsd(usd(t.mcapEth))}</div><div class="chg" id="w-chg"></div></div>
          </div>
          <div class="tooltip" id="tip"></div>
          <div class="big-play" id="bigplay">${I.pause}</div>
          <div class="controls">
            <div class="scrub"><i style="width:100%"></i></div>
            <div class="row">
              <button class="icon-btn" data-act="pp" id="pp" title="Pause / live follow (k)">${I.pause}</button>
              <button class="icon-btn" data-act="vol" id="volbtn" title="Volume">${I.vol}</button>
              <span class="time"><span style="color:#ff4e4e">●</span> LIVE · ${esc(t.dex)}</span>
              <span class="sp"></span>
              ${TF.map(([l], i) => `<button class="tf ${i === W.tf ? "active" : ""}" data-tf="${i}">${l === "All" ? "1D" : l}</button>`).join("")}
              <button class="icon-btn" data-act="ctype" title="Candles / line">${I.tune}</button>
              <button class="icon-btn" data-act="fs" title="Fullscreen (f)">${I.fs}</button>
            </div>
          </div>
        </div>

        <h1>${tokenTitle(t)}</h1>
        <div class="owner-row">
          <div class="owner">
            <img class="avatar lg" src="${esc(t.image)}" alt="" style="object-fit:cover">
            <div style="min-width:0"><div class="name">${esc(t.dex)} <span class="pill-ext">ON INK</span></div>
            <div class="subs">Trending on Ink · not launched on InkTube</div></div>
            <button class="btn sub-btn ${isWatched(t.address) ? "on" : ""}" data-act="subscribe" data-addr="${t.address}">${isWatched(t.address) ? `${I.bell}Subscribed` : "Subscribe"}</button>
          </div>
          <div class="actions">
            <div class="seg">
              <button data-act="like" data-addr="${t.address}" class="${liked === 1 ? "on" : ""}">${I.up}<span>Like</span></button>
              <button data-act="dislike" data-addr="${t.address}" class="${liked === -1 ? "on" : ""}" aria-label="Dislike">${I.down}</button>
            </div>
            <button class="btn" data-act="share" data-addr="${t.address}">${I.share}Share</button>
          </div>
        </div>

        <div class="desc" id="desc">
          <div class="head"><span id="d-trades">${fmtCount(st.trades)} trades / 24h</span><span>Pool created ${ago(t.createdAt)}</span><span style="color:var(--ink-3)">#${esc(t.symbol)} #Ink</span></div>
          <div class="text">This token was not launched on InkTube: it's one of Ink's trending tokens, shown temporarily until launches pick up (GeckoTerminal data). It will give up its spot as new InkTube tokens arrive. InkTube does not check its contract or liquidity.</div>
          <div class="facts" id="facts"></div>
          <span class="toggle" id="d-toggle">More</span>
        </div>

        <div class="ext-cta">
          <div><b>Your token could take its spot.</b><br><span class="muted">Starts at $3,000, 100% of supply in a Uniswap v4 LP locked forever, no bonding curve, 80% of fees for you.</span></div>
          <button class="btn ink" data-act="upload">${I.add}Launch on InkTube</button>
        </div>
      </div>

      <aside class="side-col">
        <div class="trade" id="trade">
          <div style="font-size:16px;font-weight:700;margin-bottom:6px">Trade $${esc(t.symbol)}</div>
          <div class="muted" style="font-size:13px;margin-bottom:12px">This token trades on ${esc(t.dex)}, not through InkTube.</div>
          <div class="quote" id="ext-quote"></div>
          <a class="btn go buy" href="${esc(gt)}" target="_blank" rel="noopener">${I.ext}View pool &amp; trade</a>
          <div class="lockline">${I.lock}<span>LP not locked by InkTube. Do your own research.</span></div>
        </div>
        <div class="trades-feed"><h3><span class="pill-live">LIVE</span> Latest trades</h3><div id="feed"></div></div>
        <div class="upnext">
          <h3>Up next <span class="muted" style="font-size:12px;font-weight:400">Autoplay</span></h3>
          ${upNext.map(miniRow).join("")}
        </div>
      </aside>
    </div>`;
    if (matchMedia("(max-width: 1100px)").matches) {
      const tr = $("#trade");
      tr.style.marginTop = "16px";
      $(".owner-row").after(tr);
    }
    currentChart = new Chart($("#chart"), $("#tip"));
    onCleanup(() => {
      currentChart?.destroy();
      currentChart = null;
    });
    refreshExtWatch(true);
    renderFeed();
    if (!t._polled) pollExtTrades(t).then(() => W.tok === t && (renderFeed(), refreshExtWatch(false))).catch(() => {});
  }

  async function refreshExtWatch(animate) {
    const t = W.tok;
    if (!t || !currentChart) return;
    if (!W.extCandles) {
      W.extCandles = [];
      try {
        W.extCandles = await loadExtCandles(t, W.tf);
      } catch (e) {
        console.warn("ohlcv:", e.message);
      }
      if (W.tok !== t || !currentChart) return;
      animate = true;
    }
    const cs = W.extCandles;
    if (!cs.length && !W.extRetry) {
      W.extRetry = setTimeout(() => {
        W.extRetry = null;
        if (W.tok === t && currentChart) {
          W.extCandles = null;
          refreshExtWatch(true);
        }
      }, 20000);
    }
    if (cs.length) {
      const last = cs[cs.length - 1], v = usd(t.mcapEth);
      last.c = v;
      last.h = Math.max(last.h, v);
      last.l = Math.min(last.l, v);
    }
    if (!W.paused) currentChart.set(cs, animate, cs.length ? "" : "Price history unavailable right now · retrying…");
    const st = stats(t);
    const price = fmtTiny(usd(t.mcapEth) / t.supply);
    $("#w-mc").textContent = fmtUsd(usd(t.mcapEth));
    $("#w-chg").innerHTML = `<span class="${st.change24 >= 0 ? "up" : "down"}">${fmtPct(st.change24)}</span> in 24h · price ${price}`;
    $("#facts").innerHTML = [
      ["Market cap (FDV)", fmtUsd(usd(t.mcapEth))],
      ["Price", price],
      ["1h change", `<span class="${t.pc.h1 >= 0 ? "up" : "down"}">${fmtPct(t.pc.h1)}</span>`],
      ["24h change", `<span class="${t.pc.h24 >= 0 ? "up" : "down"}">${fmtPct(t.pc.h24)}</span>`],
      ["24h volume", fmtUsd(t.vol24Usd)],
      ["24h trades", fmtCount(t.tx24)],
      ["24h traders", fmtCount(t.traders24)],
      ["Pool liquidity", fmtUsd(t.reserveUsd)],
      ["DEX", esc(t.dex)],
      ["Contract", `<span class="mono">${short(t.address)}</span><button data-act="copy" data-copy="${t.address}" title="Copy">${I.copy}</button>`],
      ["Pool", `<span class="mono">${short(t.pool)}</span><button data-act="copy" data-copy="${t.pool}" title="Copy">${I.copy}</button>`],
      ["Source", "GeckoTerminal"],
    ].map(([k, v]) => `<div class="fact"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("");
    const q = $("#ext-quote");
    if (q) q.innerHTML = `<div class="r"><span>Price</span><span>${price}</span></div>
      <div class="r"><span>Market cap</span><span>${fmtUsd(usd(t.mcapEth))}</span></div>
      <div class="r"><span>Liquidity</span><span>${fmtUsd(t.reserveUsd)}</span></div>`;
  }

  function renderFeed(fresh) {
    const t = W.tok, el = $("#feed");
    if (!t || !el) return;
    if (t.ext && !t.trades.length) {
      el.innerHTML = `<div class="muted" style="font-size:13px;padding:8px 0">${t._polled ? "No recent trades." : "Loading latest trades…"}</div>`;
      return;
    }
    const last = t.trades.slice(-12).reverse();
    el.innerHTML = last.length
      ? last.map((tr, i) => `<div class="tr ${fresh && i === 0 ? "fresh" : ""}">
          <span class="tag ${tr.isBuy ? "up" : "down"}">${tr.isBuy ? "BUY" : "SELL"}</span>
          <span><span class="mono">${short(tr.trader)}</span> · ${t.ext ? fmtUsd(usd(tr.eth)) : fmtEth(tr.eth) + " Ξ"}</span>
          <span class="muted">${fmtUsd(usd(tr.mcapEth))}</span></div>`).join("")
      : `<div class="muted" style="font-size:13px;padding:8px 0">No trades yet — be the first buyer at $3K.</div>`;
  }

  let balCache = { eth: 0, tok: 0 };
  async function renderTrade() {
    const t = W.tok;
    if (!t || !$("#trade")) return;
    const buy = W.side === "buy";
    $("#tabs").className = "tabs " + W.side;
    $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.side === W.side));
    $("#unit").innerHTML = buy ? `Ξ ETH` : `<img src="${esc(t.image)}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover">${esc(t.symbol)}`;
    $("#presets").innerHTML = buy
      ? ["0.005", "0.01", "0.05", "0.1", "0.5"].map((v) => `<button data-preset="${v}">${v} Ξ</button>`).join("")
      : [25, 50, 75, 100].map((p) => `<button data-pct="${p}">${p === 100 ? "Max" : p + "%"}</button>`).join("");
    const go = $("#go");
    go.className = "btn go " + W.side;
    go.textContent = S.account ? (buy ? `Buy $${t.symbol}` : `Sell $${t.symbol}`) : "Connect wallet";
    go.disabled = false;
    renderV2();
    updateQuote();
    if (S.account) {
      balCache = await API.balances(t.address);
      const bal = $("#bal");
      if (bal) bal.innerHTML = `<span>Balance: ${fmtEth(balCache.eth)} ETH</span><span>${fmtNum(balCache.tok)} ${esc(t.symbol)}</span>`;
    } else $("#bal").innerHTML = `<span>Ink network · chainId ${CFG.CHAIN_ID}</span><span></span>`;
  }

  function updateQuote() {
    const t = W.tok, q = $("#quote");
    if (!t || !q) return;
    const v = parseFloat(($("#amt").value || "").replace(",", "."));
    const slip = (CFG.DEFAULT_SLIPPAGE_BPS || 500) / 100;
    const priceNow = usd(t.mcapEth) / SUPPLY;
    const st = v2State(t);
    const feeRow = t.v === 2 ? `<div class="r"><span>LP fee</span><span class="${st && st.snipe && W.side === "buy" ? "down" : ""}">${pct(Math.round(feeOf(t, W.side === "buy") * 1e6))}</span></div>` : "";
    if (!(v > 0)) {
      q.innerHTML = `<div class="r"><span>Current price</span><span>${fmtTiny(priceNow)}</span></div>
        <div class="r"><span>Market cap</span><span>${fmtUsd(usd(t.mcapEth))}</span></div>
        ${feeRow}
        <div class="r"><span>Max slippage</span><span>${slip}%</span></div>`;
      return;
    }
    if (W.side === "buy") {
      const r = quoteBuy(t, v), mc = mcapFromSqrt(r.sqrt), avg = usd(v) / r.out;
      const over = st && st.maxBuy && r.out > st.maxBuy;
      q.innerHTML = `${over ? `<div class="wz-warn">⚠ Anti-snipe: max ${fmtNum(st.maxBuy)} ${esc(t.symbol)} per buy for now. Lower the amount.</div>` : ""}
        <div class="r"><span>You receive ≈</span><span><b>${fmtNum(r.out)} ${esc(t.symbol)}</b></span></div>
        ${feeRow}
        <div class="r"><span>Average price</span><span>${fmtTiny(avg)}</span></div>
        <div class="r"><span>Price impact</span><span class="${avg / priceNow - 1 > 0.1 ? "down" : ""}">${fmtPct((avg / priceNow - 1) * 100)}</span></div>
        <div class="r"><span>Market cap after</span><span>${fmtUsd(usd(mc))}</span></div>
        <div class="r"><span>Minimum received (${slip}%)</span><span>${fmtNum(r.out * (1 - slip / 100))}</span></div>`;
    } else {
      const r = quoteSell(t, v), mc = mcapFromSqrt(r.sqrt);
      q.innerHTML = `<div class="r"><span>You receive ≈</span><span><b>${fmtEth(r.out)} ETH</b> (${fmtUsd(usd(r.out))})</span></div>
        ${feeRow}
        <div class="r"><span>Market cap after</span><span>${fmtUsd(usd(mc))}</span></div>
        <div class="r"><span>Minimum received (${slip}%)</span><span>${fmtEth(r.out * (1 - slip / 100))} ETH</span></div>`;
    }
  }

  async function doTrade() {
    const t = W.tok;
    if (!S.account) return connect();
    const v = parseFloat(($("#amt").value || "").replace(",", "."));
    if (!(v > 0)) {
      $("#amt").focus();
      return toast("Enter an amount");
    }
    const slip = 1 - (CFG.DEFAULT_SLIPPAGE_BPS || 500) / 10000;
    const go = $("#go");
    go.disabled = true;
    const label = go.textContent;
    go.textContent = "Confirming…";
    try {
      // Fresh price and (v2) fee before computing the minimum received.
      await API.refresh(t).catch(() => {});
      if (W.side === "buy") {
        const r = quoteBuy(t, v);
        await API.buy(t, v, r.out * slip);
        toast(`Bought ${fmtNum(r.out)} ${t.symbol} ✓`);
      } else {
        const r = quoteSell(t, v);
        await API.sell(t, v, r.out * slip);
        toast(`Sold for ${fmtEth(r.out)} ETH ✓`);
      }
      $("#amt").value = "";
      renderTrade();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      if (go.isConnected) {
        go.disabled = false;
        if (go.textContent === "Confirming…") go.textContent = label;
      }
    }
  }

  async function loadComments(t) {
    const list = await API.loadComments(t);
    if (W.tok !== t) return;
    t.comments = list;
    renderComments();
  }
  function renderComments() {
    const t = W.tok, el = $("#c-list");
    if (!t || !el) return;
    const all = t.comments || [];
    const pinned = [...all].reverse().find((c) => lc(c.author) === lc(t.creator));
    const list = pinned ? [pinned, ...all.filter((c) => c !== pinned)] : all;
    $("#c-count").textContent = `${list.length} comment${list.length > 1 ? "s" : ""}`;
    el.innerHTML = list.length
      ? list.map((c) => `<div class="comment">${avatar(c.author, "lg")}<div style="min-width:0">${c === pinned ? `<div class="pinned">${I.pin}Pinned by creator</div>` : ""}
          <div class="who">${lc(c.author) === lc(t.creator) ? `<span class="tag">${short(c.author)} ${I.check.replace('class="i"', 'class="i" style="width:12px;height:12px"')}</span>` : `@${short(c.author)}`}<span>${ago(c.t)}</span></div>
          <div class="body">${esc(c.text)}</div>
          <div class="tools"><button class="icon-btn">${I.up}</button><button class="icon-btn">${I.down}</button><button class="btn" style="height:32px;background:transparent;font-size:12px">Reply</button></div>
        </div></div>`).join("")
      : `<div class="muted">No comments yet. Start the conversation!</div>`;
  }
  async function sendComment() {
    const inp = $("#c-input");
    const text = inp.value.trim();
    if (!text) return;
    if (!S.account) return connect();
    try {
      inp.disabled = true;
      const c = await API.comment(W.tok, text);
      inp.value = "";
      $("#add-comment").classList.remove("focus");
      if (c) renderComments();
      toast("Comment posted");
    } catch (e) {
      toast(errMsg(e));
    } finally {
      inp.disabled = false;
    }
  }

  // ---------------- Create wizard (YouTube Studio style) ----------------
  const WZ_STEPS = ["Details", "Links", "Launch options", "Review"];
  const IMG_BUDGET = 14000; // bytes of on-chain image data (logo + thumbnail), keeps the launch well under Ink's gas limit
  const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a || "").trim());
  // The creator buy pays the 1% base fee (exempt from anti-snipe), at the chosen starting market cap.
  function launchQuote(devBuy, mcapUsd = 3000) {
    const sqrt0 = Math.sqrt(SUPPLY / (mcapUsd / S.ethUsd));
    return quoteBuy({ L: SUPPLY / sqrt0, sqrt: sqrt0 }, devBuy);
  }
  const DEFAULT_TIERS = [3000, 5000, 10000, 25000];
  // datetime-local value for a timestamp (local time).
  const dtLocal = (ms) => { const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };

  function openUpload() {
    if (!S.account) {
      toast("Connect your wallet to create a token");
      return connect().then(() => S.account && openUpload());
    }
    const f = {
      name: "", symbol: "", text: "", category: "", logo: "", banner: "", logoUrl: "", bannerUrl: "",
      links: {}, devBuy: 0, protect: true, feeMode: "me", feeTo: "", pinned: "",
      // v2 launch options
      mcapTier: 0, premiere: false, premiereAt: "", antiSnipe: 0, vest: false, cliffDays: "0", vestDays: "30",
      snipeSec: "60", snipeFeePct: "30", buyWinSec: "60", maxBuyPct: "0.5",
      wl: false, wlSec: "60", wlText: "", buyTax: "1", sellTax: "1",
      split: [{ addr: S.account, pct: "100" }],
    };
    const wz = (openUpload.wz = { step: 0, maxStep: 0, f, est: null, estKey: "", cfg: null });
    if (API.v2) API.launchConfig().then((c) => { wz.cfg = c; if (openUpload.wz === wz && wz.step >= 2) wzRender(); }).catch((e) => console.warn("launchConfig", e));
    $("#modal-root").innerHTML = `<div class="modal-wrap" data-act="modal-bg"><div class="modal wz" role="dialog" aria-modal="true" aria-labelledby="up-title">
      <div class="mh"><span id="up-title">Create a token</span><button class="icon-btn" data-act="modal-close" aria-label="Close">${I.close}</button></div>
      <div class="wz-steps" id="wz-steps"></div>
      <div class="mb" id="up-body"><div id="wz-pane"></div><div id="wz-side"></div></div>
      <div class="mf"><span class="muted" id="wz-note" style="font-size:12px"></span>
        <div style="display:flex;gap:8px"><button class="btn" id="wz-back" data-act="wz-back">Back</button><button class="btn ink" id="wz-next" data-act="wz-next">Next</button></div></div>
    </div></div>`;
    document.body.style.overflow = "hidden";
    wzRender();
  }

  function wzDerived() {
    const f = openUpload.wz.f;
    const links = {};
    for (const [k] of LINK_KINDS) {
      const u = cleanLink(k, f.links[k]);
      if (u) links[k] = u;
    }
    const url = (u) => (u && isSafeImg(u.trim()) ? u.trim() : "");
    const logo = f.logo || url(f.logoUrl);
    const banner = f.banner || url(f.bannerUrl);
    const description = encodeDescription({ text: f.text.trim(), category: f.category, links });
    const image = encodeImage({ logo, banner });
    const tiers = (openUpload.wz.cfg && openUpload.wz.cfg.tiers) || DEFAULT_TIERS;
    const tierUsd = API.v2 ? tiers[f.mcapTier] ?? tiers[0] : 3000;
    const q = f.devBuy > 0 ? launchQuote(f.devBuy, tierUsd) : { out: 0, sqrt: 0 };
    const feeTo = f.feeMode === "other" ? f.feeTo.trim() : "";
    const sym = f.symbol.toUpperCase();
    return {
      links, logo, banner, description, image,
      descBytes: utf8Len(description), imgBytes: utf8Len(image),
      devTokens: q.out, devPct: (q.out / SUPPLY) * 100, mcapAfter: q.sqrt ? usd(mcapFromSqrt(q.sqrt)) : tierUsd,
      feeTo, feeToValid: !feeTo || isAddr(feeTo),
      tiers, tierUsd, ...(API.v2 ? wzV2(f) : {}),
      dupTicker: sym && [...S.tokens, ...Ext.list].some((t) => String(t.symbol).toUpperCase() === sym),
      badLinks: LINK_KINDS.filter(([k]) => f.links[k] && !links[k]).map(([, l]) => l),
    };
  }

  function wzValid(step) {
    const f = openUpload.wz.f, d = wzDerived();
    if (step === 0) return f.name.trim() && f.name.length <= 64 && f.symbol && f.symbol.length <= 16 && d.descBytes <= 1000 && d.imgBytes <= IMG_BUDGET;
    if (step === 1) return !d.badLinks.length;
    if (step === 2 && API.v2) return f.devBuy >= 0 && !d.premErr && !d.vestErr && !d.splitErr && !d.snipeErr && !d.wlErr && !d.taxErr && f.pinned.length <= 280;
    if (step === 2) return f.devBuy >= 0 && d.feeToValid && f.pinned.length <= 280;
    return [0, 1, 2].every(wzValid) && openUpload.wz.est && openUpload.wz.est.ok;
  }

  // v2 options -> launchWithOptions(LaunchParams) values + validation messages.
  function wzV2(f) {
    const now = Date.now();
    const premAt = f.premiere ? new Date(f.premiereAt).getTime() : 0;
    const premErr = !f.premiere ? "" : !premAt ? "Pick a date and time"
      : premAt < now + 120e3 ? "Pick a time at least 2 minutes from now"
      : premAt > now + 7 * 864e5 - 300e3 ? "A Premiere can be at most 7 days ahead" : "";
    const num = (x) => parseFloat(String(x ?? "").replace(",", "."));
    const vestOn = f.devBuy > 0 && f.vest;
    const vd = vestOn ? Math.round(num(f.vestDays) * 86400) : 0, vc = vestOn ? Math.round((num(f.cliffDays) || 0) * 86400) : 0;
    const vestErr = !vestOn ? "" : !(vd > 0) ? "Set a vesting duration" : vd > 365 * 86400 ? "Vesting is limited to 365 days" : vc < 0 ? "Invalid cliff" : vc > vd ? "The cliff can't be longer than the vesting" : "";
    const rows = f.split.map((r) => ({ addr: String(r.addr || "").trim(), bps: Math.round(num(r.pct) * 100) }));
    const sum = rows.reduce((a, r) => a + (r.bps > 0 ? r.bps : 0), 0);
    const seen = new Set();
    let splitErr = "";
    for (const r of rows) {
      if (!isAddr(r.addr)) { splitErr = "Each recipient needs a valid 0x address"; break; }
      if (seen.has(lc(r.addr))) { splitErr = "The same address is listed twice"; break; }
      seen.add(lc(r.addr));
      if (!(r.bps > 0)) { splitErr = "Each recipient needs a share above 0%"; break; }
    }
    if (!splitErr && sum !== 10000) splitErr = `Shares must add up to 100% (now ${+(sum / 100).toFixed(2)}%)`;
    // Custom anti-snipe, in seconds (the hook caps: 600 s, 80%).
    const custom = f.antiSnipe === 3;
    const snSec = Math.round(num(f.snipeSec)), snFee = Math.round(num(f.snipeFeePct) * 1e4);
    const bwSec = Math.round(num(f.buyWinSec)), mbBps = Math.round(num(f.maxBuyPct) * 100);
    // Taxes: 1% to 10% each, fixed forever.
    const buyBps = Math.round(num(f.buyTax) * 100), sellBps = Math.round(num(f.sellTax) * 100);
    const taxErr = !(buyBps >= 100 && buyBps <= 1000) ? "Buy tax: 1% to 10%" : !(sellBps >= 100 && sellBps <= 1000) ? "Sell tax: 1% to 10%" : "";
    const snipeErr = !custom ? ""
      : !(snSec >= 0 && snSec <= 600) ? "Fee duration: 0 to 600 seconds"
      : snSec > 0 && !(snFee >= Math.max(10000, buyBps * 100) && snFee <= 800000) ? `Starting buy fee: ${Math.max(1, buyBps / 100)}% (your buy tax) to 80%`
      : !(bwSec >= 0 && bwSec <= 600) ? "Max-buy window: 0 to 600 seconds"
      : !(mbBps >= 0 && mbBps <= 10000) ? "Max buy: 0% to 100% of supply"
      : snSec === 0 && !(bwSec > 0 && mbBps > 0) ? "Set a fee duration or a max buy (or pick Off)" : "";
    // Whitelist: wallets that can buy during the first seconds (the hook caps: 1800 s, 500 wallets).
    const wlAddrs = f.wl ? [...new Set(String(f.wlText).split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).map(lc))] : [];
    const wlBad = wlAddrs.filter((x) => !isAddr(x));
    const wlSec = Math.round(num(f.wlSec));
    const wlErr = !f.wl ? "" : !wlAddrs.length ? "Add at least one wallet address" : wlBad.length ? `Invalid address: ${wlBad[0].slice(0, 16)}…`
      : wlAddrs.length > 500 ? "500 wallets max" : !(wlSec >= 1 && wlSec <= 1800) ? "Whitelist period: 1 to 1800 seconds" : "";
    const rulesPreview = custom
      ? { dur: snSec * 1000, startFee: snSec ? snFee : 0, buyWin: bwSec * 1000, maxBuy: mbBps ? (SUPPLY * mbBps) / 1e4 : 0, buyFee: buyBps * 100 }
      : { ...(ANTI_SNIPE[f.antiSnipe] || {}), buyWin: (ANTI_SNIPE[f.antiSnipe] || {}).dur || 0, buyFee: buyBps * 100 };
    const extra = {
      custom, snSec, snFee, bwSec, mbBps, snipeErr, rulesPreview,
      wlOn: f.wl, wlAddrs, wlSec, wlErr, buyBps, sellBps, taxErr,
    };
    // Just me at 100% = the contract default (empty arrays).
    const meOnly = rows.length === 1 && lc(rows[0].addr) === lc(S.account);
    return {
      premAt, premErr, tradingStart: f.premiere && !premErr ? Math.floor(premAt / 1000) : 0,
      vestOn, vestCliff: vc, vestDur: vd, vestErr,
      splitRows: rows, splitSum: sum, splitErr,
      feeRecipients: splitErr || meOnly ? [] : rows.map((r) => r.addr), feeBps: splitErr || meOnly ? [] : rows.map((r) => r.bps),
      ...extra,
    };
  }

  function wzOptionsV2(f, d) {
    const tierChip = (u, i) => `<button class="chip ${f.mcapTier === i ? "active" : ""}" data-act="wz-tier" data-i="${i}">$${u.toLocaleString("en-US")}</button>`;
    const now = Date.now();
    return `
        <div class="wz-h">Launch options</div>
        <div class="opt">
          <div class="opt-h">${I.trend}<div><b>Starting market cap</b><span>The pool opens at this market cap. A higher start means fewer tokens per ETH for the first buyers. Fixed after launch.</span></div></div>
          <div class="cat-pick" id="f-tiers">${d.tiers.map(tierChip).join("")}</div>
        </div>
        <div class="opt">
          <div class="opt-h">${I.coin}<div><b>Creator buy</b><span>Buy your own token in the launch transaction, before anyone else, at the 1% base fee.</span></div></div>
          <div class="amount"><input id="f-dev" inputmode="decimal" placeholder="0" value="${f.devBuy || ""}"><span class="unit">Ξ ETH</span></div>
          <div class="presets">${["0", "0.005", "0.01", "0.05", "0.1", "0.25"].map((v) => `<button data-act="wz-dev" data-v="${v}">${v === "0" ? "None" : v + " Ξ"}</button>`).join("")}</div>
          ${f.devBuy > 0 ? `<div class="quote"><div class="r"><span>You get ≈</span><span><b>${fmtNum(d.devTokens)} ${esc(f.symbol || "tokens")}</b> (${d.devPct.toFixed(2)}% of supply)</span></div>
            <div class="r"><span>Market cap after your buy</span><span>${fmtUsd(d.mcapAfter)}</span></div></div>` : ""}
          ${d.devPct > 5 ? `<div class="wz-warn">⚠ Your page will show that the creator bought ${d.devPct.toFixed(1)}% of the supply at launch. Large creator buys scare buyers.</div>` : ""}
          <label class="tog"><input type="checkbox" id="f-protect" ${f.protect ? "checked" : ""}><span></span>Slippage protection: cancel if I would get less than 97% of this quote</label>
          ${f.devBuy > 0 ? `<label class="tog"><input type="checkbox" id="f-vest" ${f.vest ? "checked" : ""}><span></span>Vest my creator buy (locked in the contract, unlocks over time)</label>
            ${f.vest ? `<div class="two-in">
                <div class="field-box"><label>Cliff (days)</label><input id="f-cliff" inputmode="decimal" value="${esc(f.cliffDays)}"></div>
                <div class="field-box"><label>Vesting duration (days, max 365)</label><input id="f-vdays" inputmode="decimal" value="${esc(f.vestDays)}"></div>
              </div>
              <div class="presets">${[7, 30, 90, 180, 365].map((v) => `<button data-act="wz-vdays" data-v="${v}">${v} days</button>`).join("")}</div>
              ${d.vestErr ? `<div class="wz-warn">⚠ ${esc(d.vestErr)}</div>` : `<div class="muted opt-note">Nothing unlocks before the cliff, then tokens unlock linearly until ${d.vestDur ? fmtDays(d.vestDur) : "the end"} after trading opens. You claim them from your token page.</div>`}` : ""}` : ""}
        </div>
        <div class="opt">
          <div class="opt-h">${I.live}<div><b>Premiere</b><span>Your page goes live now with a countdown. Nobody can trade before the time you pick (your creator buy is the exception). Up to 7 days ahead.</span></div></div>
          <label class="radio"><input type="radio" name="premmode" value="now" ${!f.premiere ? "checked" : ""}> Open trading right away</label>
          <label class="radio"><input type="radio" name="premmode" value="later" ${f.premiere ? "checked" : ""}> Schedule a Premiere</label>
          ${f.premiere ? `<input class="url-in" type="datetime-local" id="f-prem" value="${esc(f.premiereAt)}" min="${dtLocal(now + 180e3)}" max="${dtLocal(now + 7 * 864e5 - 600e3)}">
            <div class="presets">${[["In 10 min", 10 * 60e3], ["In 1 hour", 3600e3], ["In 24 hours", 864e5], ["In 3 days", 3 * 864e5]].map(([l, ms]) => `<button data-act="wz-prem" data-ms="${ms}">${l}</button>`).join("")}</div>
            ${d.premErr ? `<div class="wz-warn">⚠ ${esc(d.premErr)}</div>` : `<div class="muted opt-note">Trading opens ${esc(fmtDate(d.premAt))} (your local time).</div>`}` : ""}
        </div>
        <div class="opt">
          <div class="opt-h">${I.lock}<div><b>Anti-snipe</b><span>Makes bots pay for buying in the first minutes. Enforced by the pool's hook for every router.</span></div></div>
          <div class="seg-pick">${ANTI_SNIPE.map((a, i) => `<button class="chip ${f.antiSnipe === i ? "active" : ""}" data-act="wz-snipe" data-i="${i}">${a.name}</button>`).join("")}</div>
          ${d.custom ? `<div class="two-in">
            <div class="field-box"><label>Fee duration (seconds, max 600)</label><input id="f-sn" inputmode="numeric" value="${esc(f.snipeSec)}"></div>
            <div class="field-box"><label>Starting buy fee (%, max 80)</label><input id="f-sf" inputmode="decimal" value="${esc(f.snipeFeePct)}"></div>
          </div>
          <div class="two-in">
            <div class="field-box"><label>Max-buy window (seconds, max 600)</label><input id="f-bw" inputmode="numeric" value="${esc(f.buyWinSec)}"></div>
            <div class="field-box"><label>Max buy per swap (% of supply, 0 = none)</label><input id="f-mb" inputmode="decimal" value="${esc(f.maxBuyPct)}"></div>
          </div>
          <div class="presets">${[15, 30, 60, 120, 300, 600].map((v) => `<button data-act="wz-snsec" data-v="${v}">${v < 60 ? v + " s" : v / 60 + " min"}</button>`).join("")}</div>
          ${d.snipeErr ? `<div class="wz-warn">⚠ ${esc(d.snipeErr)}</div>` : `<div class="muted opt-note">${esc(rulesText(d.rulesPreview, f.symbol))}. Honest early buyers pay this fee too; it goes to the locked LP.</div>`}`
          : `<div class="muted opt-note">${esc(ANTI_SNIPE[f.antiSnipe].desc)}${f.antiSnipe ? " Honest early buyers pay this fee too; it goes to the locked LP (80% to your fee recipients)." : ""}</div>`}
        </div>
        <div class="opt">
          <div class="opt-h">${I.person}<div><b>Whitelist</b><span>Right after trading opens, only the wallets you list can buy, for the number of seconds you choose. They skip the anti-snipe fee. Selling stays open to everyone.</span></div></div>
          <label class="tog"><input type="checkbox" id="f-wl" ${f.wl ? "checked" : ""}><span></span>Enable a whitelist</label>
          ${f.wl ? `<div class="field-box"><label>Whitelist-only period (seconds, max 1800)</label><input id="f-wls" inputmode="numeric" value="${esc(f.wlSec)}"></div>
            <div class="presets">${[30, 60, 120, 300, 900, 1800].map((v) => `<button data-act="wz-wlsec" data-v="${v}">${v < 60 ? v + " s" : v / 60 + " min"}</button>`).join("")}</div>
            <div class="field-box"><label>Wallets, one per line (max 500) · ${d.wlAddrs.length - (d.wlErr && /Invalid/.test(d.wlErr) ? 1 : 0)} listed</label><textarea id="f-wlt" class="mono" placeholder="0x…&#10;0x…" style="min-height:96px">${esc(f.wlText)}</textarea></div>
            ${d.wlErr ? `<div class="wz-warn">⚠ ${esc(d.wlErr)}</div>` : `<div class="muted opt-note">Checked on the wallet that signs the buy, through any app or router. Smart-contract wallets (Safe, smart accounts) can't use it.</div>`}` : ""}
        </div>
        <div class="opt">
          <div class="opt-h">${I.coin}<div><b>Taxes</b><span>Fixed buy and sell fees, 1% to 10%, set forever at launch (nobody can change them later). They go to the locked LP fees: 80% to your fee recipients, 20% to InkTube.</span></div></div>
          <div class="two-in">
            <div class="field-box"><label>Buy tax (%)</label><input id="f-bt" inputmode="decimal" value="${esc(f.buyTax)}"></div>
            <div class="field-box"><label>Sell tax (%)</label><input id="f-st" inputmode="decimal" value="${esc(f.sellTax)}"></div>
          </div>
          <div class="presets">${[[1, 1], [2, 2], [3, 3], [5, 5], [3, 5], [10, 10]].map(([b, s_]) => `<button data-act="wz-tax" data-b="${b}" data-s="${s_}">${b}% / ${s_}%</button>`).join("")}</div>
          ${d.taxErr ? `<div class="wz-warn">⚠ ${esc(d.taxErr)}</div>` : d.buyBps > 500 || d.sellBps > 500 ? `<div class="wz-warn">⚠ Taxes above 5% are shown on your page and scare many buyers and bots-checkers.</div>` : `<div class="muted opt-note">${d.buyBps === 100 && d.sellBps === 100 ? "1% / 1% is the default, like every v1 token." : `Buyers pay ${d.buyBps / 100}%, sellers ${d.sellBps / 100}%, shown on your token page.`}</div>`}
        </div>
        <div class="opt">
          <div class="opt-h">${I.wallet}<div><b>Creator fees</b><span>80% of the LP fees go to these addresses, forever. You can change the split later from the contract.</span></div></div>
          <div class="split-rows">${f.split.map((r, i) => `<div class="split-row">
              <input class="url-in mono" id="f-sa-${i}" data-split-addr="${i}" placeholder="0x…" value="${esc(r.addr)}">
              <div class="pct-in"><input id="f-sp-${i}" data-split-pct="${i}" inputmode="decimal" value="${esc(r.pct)}"><span>%</span></div>
              ${f.split.length > 1 ? `<button class="icon-btn" data-act="wz-split-del" data-i="${i}" aria-label="Remove">${I.close}</button>` : ""}
            </div>`).join("")}</div>
          <div class="split-foot">
            ${f.split.length < 5 ? `<button class="btn" data-act="wz-split-add">+ Add recipient</button>` : `<span class="muted">5 recipients max</span>`}
            ${f.split.length > 1 ? `<button class="btn" data-act="wz-split-even">Split evenly</button>` : ""}
            <span class="sum ${d.splitSum === 10000 ? "" : "down"}">Total ${+(d.splitSum / 100).toFixed(2)}%</span>
          </div>
          ${d.splitErr ? `<div class="wz-warn">⚠ ${esc(d.splitErr)}</div>` : ""}
        </div>
        <div class="opt">
          <div class="opt-h">${I.pin}<div><b>Pinned comment</b><span>Posted on-chain right after the launch and pinned at the top of your comments.</span></div></div>
          <div class="field-box" style="margin:0"><label>Optional · ${280 - f.pinned.length} characters left</label><textarea id="f-pinned" maxlength="280" placeholder="gm Ink! Roadmap, community links, …" style="min-height:64px">${esc(f.pinned)}</textarea></div>
        </div>
        <div class="opt fixed">
          <div class="opt-h">${I.lock}<div><b>Fixed by the protocol</b><span>Same for every InkTube token, enforced by the contract.</span></div></div>
          <div class="fixed-grid"><span>1B supply, 100% in LP</span><span>LP locked forever</span><span>1% base LP fee</span><span>No bonding curve</span><span>No price ceiling</span><span>On-chain comments</span></div>
        </div>`;
  }

  function wzCard(d) {
    const f = openUpload.wz.f;
    const thumb = d.banner || d.logo || genArt(f.name + f.symbol || "inktube", (f.symbol || "?").slice(0, 1));
    const img = (u) => (u.startsWith("ipfs://") ? (CFG.IPFS_GATEWAY || "https://ipfs.io/ipfs/") + u.slice(7) : u);
    return `<div class="card wz-card">
      <div class="thumb"><img class="cover" src="${esc(img(thumb))}" alt=""><div class="br"><span class="badge">${fmtUsd(d.mcapAfter)}</span></div>
        <div class="bar"><i style="width:${Math.min(100, d.devPct).toFixed(1)}%"></i></div></div>
      <div class="meta">${avatar(S.account, "ch")}<div class="mt">
        <h3 class="title">${f.name ? esc(f.name) : "Your token"} ($${esc(f.symbol || "TICKER")})</h3>
        <div class="sub"><div class="chan-line"><span class="chan">${short(S.account)} ${I.check}</span></div>
        <div class="stats-line">${I.playo}0 trades <span class="dot-sep">·</span> just now</div>
        ${f.category ? `<span class="tag-new">${CATS[f.category]}</span>` : ""}</div></div></div>
    </div>`;
  }

  function wzRender() {
    const wz = openUpload.wz, f = wz.f, d = wzDerived();
    // Re-rendering the step must not jump: keep the scroll position unless the step changed.
    const modal = $(".modal.wz");
    const keepScroll = modal && wz.renderedStep === wz.step ? modal.scrollTop : 0;
    $("#wz-steps").innerHTML = WZ_STEPS.map((s, i) => `<button class="wz-step ${i === wz.step ? "on" : ""} ${i < wz.step || i <= wz.maxStep ? "seen" : ""}" data-act="wz-goto" data-step="${i}" ${i > wz.maxStep ? "disabled" : ""}>
        <span class="dotc">${i < wz.step ? `<svg viewBox="0 0 24 24"><path d="${P.tick}"/></svg>` : ""}</span><span>${s}</span></button>`).join('<span class="wz-line"></span>');

    const pane = $("#wz-pane");
    if (wz.step === 0) {
      pane.innerHTML = `
        <div class="wz-h">Details</div>
        <div class="field-box"><label>Name (required)</label><input id="f-name" maxlength="64" placeholder="e.g. Inky the Squid" value="${esc(f.name)}"><span class="cnt">${f.name.length}/64</span></div>
        <div class="field-box"><label>Ticker (required)</label><input id="f-sym" maxlength="16" placeholder="e.g. INKY" style="text-transform:uppercase" value="${esc(f.symbol)}"><span class="cnt">${f.symbol.length}/16</span></div>
        ${d.dupTicker ? `<div class="wz-warn">⚠ $${esc(f.symbol)} already exists on Ink. You can still use it, but a unique ticker is easier to find.</div>` : ""}
        <div class="field-box"><label>Description (optional)</label><textarea id="f-text" placeholder="Tell viewers about your token">${esc(f.text)}</textarea>
          <span class="cnt ${d.descBytes > 1000 ? "down" : ""}">${Math.max(0, 1000 - d.descBytes)} bytes left</span></div>
        <div class="wz-label">Category <span class="muted">optional</span></div>
        <div class="cat-pick">${Object.entries(CATS).map(([k, l]) => `<button class="chip ${f.category === k ? "active" : ""}" data-act="wz-cat" data-cat="${k}">${l}</button>`).join("")}</div>
        <div class="wz-label">Images <span class="muted">stored on-chain · ${(d.imgBytes / 1024).toFixed(1)} / ${(IMG_BUDGET / 1024).toFixed(0)} KB</span></div>
        <div class="img-pick">
          <div><div class="drop sq" data-act="wz-pick" data-kind="logo">${d.logo ? `<img src="${esc(d.logo.startsWith("ipfs://") ? CFG.IPFS_GATEWAY + d.logo.slice(7) : d.logo)}" alt="">` : `${I.image}<span>Logo (optional)<br><small>square · avatar</small></span>`}</div>
            <input class="url-in" id="f-logo-url" placeholder="…or logo URL (https / ipfs)" value="${esc(f.logoUrl)}"></div>
          <div><div class="drop wide" data-act="wz-pick" data-kind="banner">${d.banner ? `<img src="${esc(d.banner.startsWith("ipfs://") ? CFG.IPFS_GATEWAY + d.banner.slice(7) : d.banner)}" alt="">` : `${I.image}<span>Thumbnail 16:9<br><small>optional · shown on cards</small></span>`}</div>
            <input class="url-in" id="f-banner-url" placeholder="…or thumbnail URL (https / ipfs)" value="${esc(f.bannerUrl)}"></div>
        </div>
        ${d.imgBytes > IMG_BUDGET ? `<div class="wz-warn">⚠ Images are too heavy for on-chain storage. Use smaller images or URLs.</div>` : ""}
        <input type="file" id="f-file" accept="image/*" hidden>`;
    } else if (wz.step === 1) {
      pane.innerHTML = `
        <div class="wz-h">Links</div>
        <p class="muted" style="margin:-6px 0 16px">Shown under your token's description, like the links of a YouTube video. All optional.</p>
        ${LINK_KINDS.map(([k, l, ic, ph]) => `<div class="field-box link-box ${f.links[k] && !d.links[k] ? "err" : ""}"><label>${l} (optional)</label>
          <div class="lb">${I[ic]}<input data-link="${k}" placeholder="${ph}" value="${esc(f.links[k] || "")}"></div></div>`).join("")}
        ${d.badLinks.length ? `<div class="wz-warn">⚠ Invalid link: ${d.badLinks.join(", ")}. Use a full https:// address.</div>` : ""}`;
    } else if (wz.step === 2 && API.v2) {
      pane.innerHTML = wzOptionsV2(f, d);
    } else if (wz.step === 2) {
      pane.innerHTML = `
        <div class="wz-h">Launch options</div>
        <div class="opt">
          <div class="opt-h">${I.coin}<div><b>Creator buy</b><span>Buy your own token in the launch transaction, before anyone else.</span></div></div>
          <div class="amount"><input id="f-dev" inputmode="decimal" placeholder="0" value="${f.devBuy || ""}"><span class="unit">Ξ ETH</span></div>
          <div class="presets">${["0", "0.005", "0.01", "0.05", "0.1", "0.25"].map((v) => `<button data-act="wz-dev" data-v="${v}">${v === "0" ? "None" : v + " Ξ"}</button>`).join("")}</div>
          ${f.devBuy > 0 ? `<div class="quote"><div class="r"><span>You get ≈</span><span><b>${fmtNum(d.devTokens)} ${esc(f.symbol || "tokens")}</b> (${d.devPct.toFixed(2)}% of supply)</span></div>
            <div class="r"><span>Market cap after your buy</span><span>${fmtUsd(d.mcapAfter)}</span></div></div>` : ""}
          ${d.devPct > 5 ? `<div class="wz-warn">⚠ Your page will show that the creator bought ${d.devPct.toFixed(1)}% of the supply at launch. Large creator buys scare buyers.</div>` : ""}
          <label class="tog"><input type="checkbox" id="f-protect" ${f.protect ? "checked" : ""}><span></span>Slippage protection: cancel if I would get less than 97% of this quote</label>
        </div>
        <div class="opt">
          <div class="opt-h">${I.wallet}<div><b>Creator fees</b><span>80% of the 1% LP fee goes to this address, forever. Collect it anytime from the token page.</span></div></div>
          <label class="radio"><input type="radio" name="feemode" value="me" ${f.feeMode === "me" ? "checked" : ""}> My wallet <span class="mono muted">${short(S.account)}</span></label>
          <label class="radio"><input type="radio" name="feemode" value="other" ${f.feeMode === "other" ? "checked" : ""}> Another address (team multisig, charity, …)</label>
          ${f.feeMode === "other" ? `<input class="url-in mono" id="f-feeto" placeholder="0x…" value="${esc(f.feeTo)}">
            ${f.feeTo && !d.feeToValid ? `<div class="wz-warn">⚠ Not a valid address.</div>` : `<div class="muted" style="font-size:12px;margin-top:6px">Set right after the launch: one more signature.</div>`}` : ""}
        </div>
        <div class="opt">
          <div class="opt-h">${I.pin}<div><b>Pinned comment</b><span>Posted on-chain right after the launch and pinned at the top of your comments.</span></div></div>
          <div class="field-box" style="margin:0"><label>Optional · ${280 - f.pinned.length} characters left</label><textarea id="f-pinned" maxlength="280" placeholder="gm Ink! Roadmap, community links, …" style="min-height:64px">${esc(f.pinned)}</textarea></div>
        </div>
        <div class="opt fixed">
          <div class="opt-h">${I.lock}<div><b>Fixed by the protocol</b><span>Same for every InkTube token, enforced by the contract.</span></div></div>
          <div class="fixed-grid"><span>$3,000 starting market cap</span><span>1B supply, 100% in LP</span><span>LP locked forever</span><span>1% LP fee</span><span>No bonding curve</span><span>No price ceiling</span></div>
        </div>`;
    } else {
      const txs = 1 + (!API.v2 && d.feeTo && d.feeTo.toLowerCase() !== S.account.toLowerCase() ? 1 : 0) + (f.pinned.trim() ? 1 : 0);
      const est = wz.est;
      const check = (good, label, detail, warn) => `<div class="chk ${good ? "ok" : warn ? "warn" : "ko"}"><span class="ic">${good ? "✓" : warn ? "!" : "✗"}</span><div><b>${label}</b><span>${detail}</span></div></div>`;
      pane.innerHTML = `
        <div class="wz-h">Review</div>
        <div class="checks">
          ${check(true, "Details", `${esc(f.name)} ($${esc(f.symbol)})${f.category ? ` · ${CATS[f.category]}` : ""} · ${Object.keys(d.links).length} link${Object.keys(d.links).length === 1 ? "" : "s"}`)}
          ${check(!d.dupTicker, "Ticker", d.dupTicker ? `$${esc(f.symbol)} is already used on Ink` : "Unique on Ink", true)}
          ${API.v2 ? check(true, "Starting market cap", fmtUsd(d.tierUsd)) : ""}
          ${check(true, "Creator buy", f.devBuy > 0 ? `${f.devBuy} ETH → ${d.devPct.toFixed(2)}% of supply${f.protect ? " · protected" : ""}${d.vestOn ? ` · vesting ${fmtDays(d.vestDur)}${d.vestCliff ? `, cliff ${fmtDays(d.vestCliff)}` : ""}` : ""}` : "None")}
          ${API.v2 ? check(!d.premErr, "Trading", d.tradingStart ? `Premiere: opens ${esc(fmtDate(d.premAt))}` : d.premErr ? esc(d.premErr) : "Opens right away") : ""}
          ${API.v2 ? check(true, "Anti-snipe", `${ANTI_SNIPE[f.antiSnipe].name}${f.antiSnipe ? ` · ${esc(d.custom ? rulesText(d.rulesPreview, f.symbol) : ANTI_SNIPE[f.antiSnipe].desc)}` : ""}`) : ""}
          ${API.v2 ? check(true, "Whitelist", d.wlOn ? `${d.wlAddrs.length} wallet${d.wlAddrs.length > 1 ? "s" : ""} only, for ${secs(d.wlSec * 1000)} after trading opens` : "None") : ""}
          ${API.v2 ? check(d.buyBps <= 500 && d.sellBps <= 500, "Taxes", `Buy ${d.buyBps / 100}% · sell ${d.sellBps / 100}% · fixed forever`, true) : ""}
          ${API.v2
            ? check(true, d.splitRows.length > 1 ? "Creator fees split" : "Creator fees go to", d.splitRows.map((r) => `<span class="mono">${esc(short(r.addr))}</span> ${+(r.bps / 100).toFixed(2)}%`).join(" · "))
            : check(true, "Creator fees go to", d.feeTo ? `<span class="mono">${esc(short(d.feeTo))}</span>` : `Your wallet <span class="mono">${short(S.account)}</span>`)}
          ${check(true, "Pinned comment", f.pinned.trim() ? `“${esc(f.pinned.trim().slice(0, 60))}${f.pinned.trim().length > 60 ? "…" : ""}”` : "None")}
          ${check(true, "On-chain data", `${((d.descBytes + d.imgBytes) / 1024).toFixed(1)} KB (description ${d.descBytes} B, images ${(d.imgBytes / 1024).toFixed(1)} KB)`)}
          ${est ? check(est.ok, "Cost", est.ok ? `${txs} signature${txs > 1 ? "s" : ""} · ≈ ${fmtEth(est.total)} ETH total (${f.devBuy > 0 ? `${f.devBuy} ETH creator buy + ` : ""}${fmtEth(est.gasEth)} ETH gas + L1 fee)` : esc(est.error))
                : `<div class="chk wait"><span class="ic">…</span><div><b>Cost</b><span>Estimating gas…</span></div></div>`}
        </div>
        <div class="muted" style="font-size:12px;margin-top:14px">Publishing is final: the token, its pool and its locked LP can't be changed or removed.</div>`;
      wzEstimate();
    }

    $("#wz-side").innerHTML = `${wzCard(d)}
      <div class="rules">
        <div>${I.tick}Uniswap v4 ETH/token pool, 1% fee</div>
        <div>${I.tick}One-sided LP: 100% tokens, 0 ETH</div>
        <div>${I.tick}LP locked forever (no withdraw function)</div>
        <div>${I.tick}No bonding curve, no migration</div>
        <div>${I.tick}No price ceiling</div>
        <div>${I.tick}80% of LP fees for you</div>
      </div>`;
    $("#wz-back").style.visibility = wz.step ? "visible" : "hidden";
    $("#wz-next").textContent = wz.step === 3 ? "Publish" : "Next";
    $("#wz-next").disabled = !wzValid(wz.step);
    $("#wz-note").textContent = wz.step === 3 ? "Signed in your wallet on Ink" : `Step ${wz.step + 1} of 4`;
    wzBind();
    if (modal) modal.scrollTop = keepScroll;
    wz.renderedStep = wz.step;
  }

  // Re-render the side preview + buttons without touching the inputs being typed in.
  function wzSoft() {
    const wz = openUpload.wz, d = wzDerived();
    const side = $("#wz-side .wz-card");
    if (side) side.outerHTML = wzCard(d);
    $("#wz-next").disabled = !wzValid(wz.step);
  }

  function wzBind() {
    const wz = openUpload.wz, f = wz.f;
    const on = (sel, fn, ev = "input") => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
    const rerenderSoon = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { const a = document.activeElement, id = a && a.id, pos = a && a.selectionStart; wzRender(); const el = id && $("#" + id); if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(pos, pos); } catch {} } }, 350); }; })();
    on("#f-name", (e) => { f.name = e.target.value; e.target.nextElementSibling.textContent = `${f.name.length}/64`; wzSoft(); });
    on("#f-sym", (e) => { f.symbol = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); e.target.nextElementSibling.textContent = `${f.symbol.length}/16`; wzSoft(); rerenderSoon(); });
    on("#f-text", (e) => { f.text = e.target.value; const d = wzDerived(); const c = e.target.nextElementSibling; c.textContent = `${Math.max(0, 1000 - d.descBytes)} bytes left`; c.classList.toggle("down", d.descBytes > 1000); wzSoft(); });
    on("#f-logo-url", (e) => { f.logoUrl = e.target.value; f.logo = ""; rerenderSoon(); });
    on("#f-banner-url", (e) => { f.bannerUrl = e.target.value; f.banner = ""; rerenderSoon(); });
    $$("[data-link]").forEach((el) => el.addEventListener("input", (e) => { f.links[el.dataset.link] = e.target.value; wzSoft(); rerenderSoon(); }));
    on("#f-dev", (e) => { f.devBuy = Math.max(0, parseFloat((e.target.value || "0").replace(",", ".")) || 0); rerenderSoon(); wzSoft(); });
    on("#f-protect", (e) => { f.protect = e.target.checked; }, "change");
    $$('input[name="feemode"]').forEach((el) => el.addEventListener("change", () => { f.feeMode = el.value; wzRender(); }));
    on("#f-feeto", (e) => { f.feeTo = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-vest", (e) => { f.vest = e.target.checked; wzRender(); }, "change");
    on("#f-sn", (e) => { f.snipeSec = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-sf", (e) => { f.snipeFeePct = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-bw", (e) => { f.buyWinSec = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-mb", (e) => { f.maxBuyPct = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-wl", (e) => { f.wl = e.target.checked; wzRender(); }, "change");
    on("#f-wls", (e) => { f.wlSec = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-wlt", (e) => { f.wlText = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-bt", (e) => { f.buyTax = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-st", (e) => { f.sellTax = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-cliff", (e) => { f.cliffDays = e.target.value; rerenderSoon(); wzSoft(); });
    on("#f-vdays", (e) => { f.vestDays = e.target.value; rerenderSoon(); wzSoft(); });
    $$('input[name="premmode"]').forEach((el) => el.addEventListener("change", () => {
      f.premiere = el.value === "later";
      if (f.premiere && !f.premiereAt) f.premiereAt = dtLocal(Date.now() + 3600e3);
      wzRender();
    }));
    on("#f-prem", (e) => { f.premiereAt = e.target.value; rerenderSoon(); wzSoft(); });
    $$("[data-split-addr]").forEach((el) => el.addEventListener("input", (e) => { f.split[+el.dataset.splitAddr].addr = e.target.value; rerenderSoon(); wzSoft(); }));
    $$("[data-split-pct]").forEach((el) => el.addEventListener("input", (e) => { f.split[+el.dataset.splitPct].pct = e.target.value; rerenderSoon(); wzSoft(); }));
    on("#f-pinned", (e) => { f.pinned = e.target.value; const l = e.target.previousElementSibling; l.textContent = `Optional · ${280 - f.pinned.length} characters left`; wzSoft(); });
    const file = $("#f-file");
    if (file) file.addEventListener("change", async () => {
      const fl = file.files[0], kind = file.dataset.kind;
      if (!fl) return;
      try {
        if (kind === "logo") { f.logo = await resizeImage(fl, 160, 160, 5200); f.logoUrl = ""; }
        else { f.banner = await resizeImage(fl, 400, 225, 8600); f.bannerUrl = ""; }
      } catch (e) { toast(errMsg(e)); }
      wzRender();
    });
    $$(".drop[data-kind]").forEach((dz) => {
      dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
      dz.addEventListener("dragleave", () => dz.classList.remove("over"));
      dz.addEventListener("drop", async (e) => {
        e.preventDefault();
        dz.classList.remove("over");
        const fl = e.dataTransfer.files[0];
        if (!fl) return;
        if (dz.dataset.kind === "logo") { f.logo = await resizeImage(fl, 160, 160, 5200); f.logoUrl = ""; }
        else { f.banner = await resizeImage(fl, 400, 225, 8600); f.bannerUrl = ""; }
        wzRender();
      });
    });
    const first = $("#wz-pane input:not([type=hidden]):not([type=file]), #wz-pane textarea");
    // Auto-focus only when arriving on a step, never after clicking an option (it would scroll to the top).
    if (first && wz.step < 3 && wz.focusedStep !== wz.step && !document.activeElement?.closest?.("#wz-pane")) first.focus({ preventScroll: true });
    wz.focusedStep = wz.step;
  }

  async function wzEstimate() {
    const wz = openUpload.wz, f = wz.f, d = wzDerived();
    const v2 = API.v2 ? wzV2Form(f, d) : {};
    const key = JSON.stringify([f.name, f.symbol, d.description, d.image, f.devBuy, S.account, v2]);
    if (wz.estKey === key && wz.est) return;
    wz.estKey = key;
    wz.est = null;
    try {
      const r = await API.estimateLaunch({ name: f.name.trim(), symbol: f.symbol, image: d.image, description: d.description, devBuy: f.devBuy, ...v2 });
      if (wz.estKey !== key) return;
      wz.est = r.ok ? r : { ok: false, error: r.error };
    } catch (e) {
      if (wz.estKey !== key) return;
      wz.est = { ok: false, error: /insufficient funds/i.test(errMsg(e)) ? "Not enough ETH on Ink for this launch" : "Estimation failed: " + errMsg(e) };
    }
    if (openUpload.wz === wz && wz.step === 3) wzRender();
  }

  // LaunchParams fields of a v2 launch (see InkTubeLaunchpadV2.LaunchParams).
  const wzV2Form = (f, d) => ({
    mcapTier: f.mcapTier, tradingStart: d.tradingStart, antiSnipe: f.antiSnipe,
    vestingCliff: d.vestOn ? d.vestCliff : 0, vestingDuration: d.vestOn ? d.vestDur : 0,
    feeRecipients: d.feeRecipients, feeBps: d.feeBps,
    snipeDuration: d.custom ? d.snSec : 0, snipeStartFee: d.custom && d.snSec ? d.snFee : 0,
    maxBuyWindow: d.custom ? d.bwSec : 0, maxBuyBps: d.custom ? d.mbBps : 0,
    whitelistWindow: d.wlOn ? d.wlSec : 0, whitelist: d.wlOn ? d.wlAddrs : [],
    buyTaxBps: d.buyBps === 100 ? 0 : d.buyBps, sellTaxBps: d.sellBps === 100 ? 0 : d.sellBps,
  });

  function closeModal() {
    $("#modal-root").innerHTML = "";
    document.body.style.overflow = "";
  }

  async function doLaunch() {
    const wz = openUpload.wz;
    if (!wz || !wzValid(3)) return;
    const f = wz.f, d = wzDerived();
    const feeTo = !API.v2 && d.feeTo && d.feeTo.toLowerCase() !== S.account.toLowerCase() ? d.feeTo : "";
    const pinned = f.pinned.trim();
    const steps = [
      ["sign", "Sign the launch in your wallet"],
      ["mined", "Deploying token, Uniswap v4 pool and locked LP"],
      ...(feeTo ? [["fees", "Setting the creator fee recipient (sign again)"]] : []),
      ...(pinned ? [["comment", "Posting your pinned comment (sign again)"]] : []),
      ["done", "Live on InkTube 🎉"],
    ];
    $("#up-title").textContent = "Publishing…";
    $("#wz-steps").innerHTML = "";
    $("#up-body").style.display = "block";
    $("#up-body").innerHTML = `<div style="max-width:520px;margin:0 auto">
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:12px">
        <img src="${esc(d.logo ? (d.logo.startsWith("ipfs://") ? CFG.IPFS_GATEWAY + d.logo.slice(7) : d.logo) : genArt(f.name + f.symbol, f.symbol.slice(0, 1)))}" alt="" style="width:72px;height:72px;border-radius:14px;object-fit:cover">
        <div><div style="font-size:18px;font-weight:500">${esc(f.name)} ($${esc(f.symbol)})</div><div class="muted">Starting market cap: ${fmtUsd(d.tierUsd)}${API.v2 && d.tradingStart ? ` · Premiere ${esc(fmtDate(d.premAt))}` : ""}</div></div>
      </div>
      <div class="big-progress"><i id="up-prog"></i></div>
      <div class="steps">${steps.map(([k, s], i) => `<div class="step" data-step="${i}"><span class="b"></span><span>${s}</span></div>`).join("")}</div>
    </div>`;
    $(".mf").innerHTML = `<span class="muted" style="font-size:12px">Don't close this window</span><span></span>`;
    const setStep = (key) => {
      const k = key === "end" ? steps.length : steps.findIndex(([s]) => s === key);
      $$(".step").forEach((el) => {
        const i = +el.dataset.step;
        el.className = "step " + (i < k ? "done" : i === k ? "active" : "");
        el.querySelector(".b").innerHTML = i < k ? `<svg viewBox="0 0 24 24"><path d="${P.tick}"/></svg>` : "";
      });
      const p = $("#up-prog");
      if (p) p.style.width = (Math.max(0, k) / steps.length) * 100 + "%";
    };
    try {
      const tok = await API.launch({
        name: f.name.trim(), symbol: f.symbol, image: d.image, description: d.description,
        devBuy: f.devBuy, minDevBuy: f.devBuy > 0 && f.protect ? d.devTokens * 0.97 : 0,
        feeTo, pinned,
        ...(API.v2 ? wzV2Form(f, d) : {}),
      }, setStep);
      setStep("end");
      await sleep(600);
      closeModal();
      confetti();
      toast(`${f.name} is live! 🎉`);
      if (tok) location.hash = `#/watch/${tok.address}`;
    } catch (e) {
      toast(errMsg(e));
      closeModal();
    }
  }

  // ------------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------------
  async function connect() {
    try {
      progress.start();
      S.account = await API.connect();
      store.set("connected", true);
      renderAccount();
      toast(`Connected: ${short(S.account)}`);
      rerender();
    } catch (e) {
      toast(errMsg(e));
    } finally {
      progress.done();
    }
  }

  function share(addr) {
    const url = location.href.split("#")[0] + "#/watch/" + addr;
    if (navigator.share) navigator.share({ url, title: "InkTube" }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => toast("Link copied to clipboard"), () => toast(url));
  }

  function setLike(addr, v) {
    const k = lc(addr);
    S.liked[k] = S.liked[k] === v ? 0 : v;
    store.set("liked", S.liked);
  }

  document.addEventListener("click", async (e) => {
    const a = e.target.closest("[data-act]");
    const go = e.target.closest("[data-go]");
    if (a && (!go || go.contains(a))) {
      const act = a.dataset.act;
      const addr = a.dataset.addr;
      if (act !== "acct-menu" && act !== "notifs") {
        if ($("#acct-menu")) $("#acct-menu").innerHTML = "";
        if ($("#notif-menu")) $("#notif-menu").innerHTML = "";
      }
      switch (act) {
        case "menu":
          if (innerWidth <= 1000) document.body.classList.toggle("drawer");
          else document.body.classList.toggle("side-mini");
          return;
        case "connect": return connect();
        case "disconnect":
          S.account = null;
          store.set("connected", false);
          renderAccount();
          rerender();
          return;
        case "acct-menu": $("#notif-menu").innerHTML = ""; return openAcctMenu();
        case "notifs": if ($("#acct-menu")) $("#acct-menu").innerHTML = ""; return renderNotifs();
        case "theme":
          S.theme = S.theme === "dark" ? "light" : "dark";
          store.set("theme", S.theme);
          document.documentElement.dataset.theme = S.theme;
          return;
        case "upload": return openUpload();
        case "modal-close": return closeModal();
        case "modal-bg": if (e.target === a && !$(".modal.wz")) closeModal(); return;
        case "wz-next": {
          const wz = openUpload.wz;
          if (!wz || !wzValid(wz.step)) return;
          if (wz.step === 3) return doLaunch();
          wz.step++;
          wz.maxStep = Math.max(wz.maxStep, wz.step);
          return wzRender();
        }
        case "wz-back": if (openUpload.wz && openUpload.wz.step > 0) { openUpload.wz.step--; wzRender(); } return;
        case "wz-goto": { const n = +a.dataset.step; if (openUpload.wz && n <= openUpload.wz.maxStep) { openUpload.wz.step = n; wzRender(); } return; }
        case "wz-cat": { const f = openUpload.wz.f; f.category = f.category === a.dataset.cat ? "" : a.dataset.cat; return wzRender(); }
        case "wz-dev": openUpload.wz.f.devBuy = +a.dataset.v; return wzRender();
        case "wz-tier": openUpload.wz.f.mcapTier = +a.dataset.i; return wzRender();
        case "wz-snipe": openUpload.wz.f.antiSnipe = +a.dataset.i; return wzRender();
        case "wz-snsec": Object.assign(openUpload.wz.f, { snipeSec: a.dataset.v, buyWinSec: a.dataset.v }); return wzRender();
        case "wz-wlsec": openUpload.wz.f.wlSec = a.dataset.v; return wzRender();
        case "lk-logo":
        case "lk-header": {
          const t = W.tok;
          try {
            await (act === "lk-logo" ? downloadLogo(t) : downloadHeader(t));
          } catch (err) {
            toast("This image is hosted on another site and can't be converted here: open it and save it instead");
            window.open(act === "lk-logo" ? t.image : t.banner || t.image, "_blank", "noopener");
          }
          return;
        }
        case "lk-copy":
          navigator.clipboard?.writeText(tokenInfoText(W.tok)).then(() => toast("Token info copied"), () => toast("Copy failed"));
          return;
        case "wz-tax": Object.assign(openUpload.wz.f, { buyTax: a.dataset.b, sellTax: a.dataset.s }); return wzRender();
        case "wz-vdays": openUpload.wz.f.vestDays = a.dataset.v; return wzRender();
        case "wz-prem": openUpload.wz.f.premiereAt = dtLocal(Date.now() + +a.dataset.ms); return wzRender();
        case "wz-split-add": { const f = openUpload.wz.f; if (f.split.length < 5) f.split.push({ addr: "", pct: "" }); return wzRender(); }
        case "wz-split-del": openUpload.wz.f.split.splice(+a.dataset.i, 1); return wzRender();
        case "wz-split-even": {
          const f = openUpload.wz.f, n = f.split.length, base = Math.floor(10000 / n);
          f.split.forEach((r, i) => (r.pct = String((i === 0 ? 10000 - base * (n - 1) : base) / 100)));
          return wzRender();
        }
        case "wz-pick": { const fi = $("#f-file"); fi.dataset.kind = a.dataset.kind; fi.value = ""; fi.click(); return; }
        case "voice": return toast("Say “to the moon” 🎙️ (coming soon)");
        case "chips-next": $("#chips")?.scrollBy({ left: 320, behavior: "smooth" }); return;
        case "subs-more": S.subsExpanded = !S.subsExpanded; renderSidebar(); return;
        case "search-open": $("#search").classList.add("open"); $("#q").focus(); return;
        case "watch-toggle": {
          e.stopPropagation();
          const on = toggleWatch(addr);
          toast(on ? "Added to your subscriptions" : "Removed from your subscriptions");
          if (a.closest(".short")) a.textContent = on ? "Subscribed" : "Subscribe";
          return;
        }
        case "subscribe": {
          const on = toggleWatch(addr);
          a.classList.toggle("on", on);
          a.innerHTML = on ? `${I.bell}Subscribed` : "Subscribe";
          if (on) {
            const b = document.createElement("span");
            b.className = "burst";
            a.appendChild(b);
            setTimeout(() => b.remove(), 600);
          }
          return;
        }
        case "like":
        case "dislike": {
          setLike(addr, act === "like" ? 1 : -1);
          const v = S.liked[lc(addr)];
          const seg = a.closest(".seg");
          if (seg) {
            seg.children[0].classList.toggle("on", v === 1);
            seg.children[1].classList.toggle("on", v === -1);
          } else a.parentElement.lastChild.textContent = v === 1 ? "Liked" : "Like";
          return;
        }
        case "share": return share(addr);
        case "copy":
          navigator.clipboard?.writeText(a.dataset.copy).then(() => toast("Address copied"));
          return;
        case "quick-buy": {
          const t = getTok(addr);
          if (!S.account) return connect();
          try {
            await API.refresh(t).catch(() => {});
            const q = quoteBuy(t, 0.01);
            await API.buy(t, 0.01, q.out * 0.95);
            toast(`Bought ${fmtNum(q.out)} ${t.symbol} ⚡`);
          } catch (err) {
            toast(errMsg(err));
          }
          return;
        }
        case "pp": {
          W.paused = !W.paused;
          a.innerHTML = W.paused ? I.play : I.pause;
          $("#player").classList.toggle("paused", W.paused);
          const bp = $("#bigplay");
          bp.innerHTML = W.paused ? I.pause : I.play;
          bp.classList.add("show");
          setTimeout(() => bp.classList.remove("show"), 450);
          if (!W.paused) refreshWatch(false);
          return;
        }
        case "vol":
          currentChart.vol = !currentChart.vol;
          a.innerHTML = currentChart.vol ? I.vol : I.mute;
          currentChart.draw();
          return;
        case "ctype":
          currentChart.type = currentChart.type === "candles" ? "line" : "candles";
          currentChart.set(currentChart.data, true);
          return;
        case "fs": {
          const p = $("#player");
          if (document.fullscreenElement) document.exitFullscreen();
          else p.requestFullscreen?.();
          return;
        }
        case "trade": return doTrade();
        case "collect":
          try {
            const r = await API.collectFees(W.tok);
            toast(`Fees collected: ${r}`);
          } catch (err) {
            toast(errMsg(err));
          }
          return;
        case "c-cancel":
          $("#c-input").value = "";
          $("#add-comment").classList.remove("focus");
          return;
        case "c-send": return sendComment();
        case "claim": {
          const t = W.tok;
          a.disabled = true;
          try {
            await API.claimVested(t);
            toast("Vested tokens claimed ✓");
            await loadV2(t);
            renderTrade();
          } catch (err) {
            toast(errMsg(err));
            a.disabled = false;
          }
          return;
        }
      }
      return;
    }
    if (go) {
      e.preventDefault();
      location.hash = go.dataset.go;
      return;
    }
    const chip = e.target.closest("[data-chip]");
    if (chip) return pageHome(chip.dataset.chip);
    const tf = e.target.closest("[data-tf]");
    if (tf) {
      W.tf = +tf.dataset.tf;
      W.extCandles = null;
      $$(".tf").forEach((b) => b.classList.toggle("active", b === tf));
      if (W.paused) { W.paused = false; $("#pp").innerHTML = I.pause; $("#player").classList.remove("paused"); }
      return refreshWatch(true);
    }
    const side = e.target.closest("[data-side]");
    if (side) {
      W.side = side.dataset.side;
      $("#amt").value = "";
      return renderTrade();
    }
    const pr = e.target.closest("[data-preset]");
    if (pr) {
      $("#amt").value = pr.dataset.preset;
      return updateQuote();
    }
    const pct = e.target.closest("[data-pct]");
    if (pct) {
      const v = (balCache.tok * +pct.dataset.pct) / 100;
      $("#amt").value = v > 0 ? String(+v.toPrecision(8)) : "";
      if (!(v > 0)) toast(S.account ? "You don't hold this token" : "Connect your wallet");
      return updateQuote();
    }
    const desc = e.target.closest("#desc");
    if (desc && !e.target.closest("button,a")) {
      if (!desc.classList.contains("open")) {
        desc.classList.add("open");
        $("#d-toggle").textContent = "Less";
      } else if (e.target.id === "d-toggle") {
        desc.classList.remove("open");
        $("#d-toggle").textContent = "More";
      }
      return;
    }
    if (!e.target.closest(".menu")) {
      if ($("#acct-menu")) $("#acct-menu").innerHTML = "";
      if ($("#notif-menu")) $("#notif-menu").innerHTML = "";
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "amt") updateQuote();
    if (e.target.id === "c-input") $("#c-cnt").textContent = `${e.target.value.length}/280`;
  });
  document.addEventListener("focusin", (e) => {
    if (e.target.id === "c-input") $("#add-comment").classList.add("focus");
  });
  document.addEventListener("focusout", (e) => {
    if (e.target.id === "q" && innerWidth <= 700) setTimeout(() => $("#search")?.classList.remove("open"), 150);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "c-input") return sendComment();
    if (e.key === "Escape" && !$(".modal.wz")) return closeModal();
    if (/input|textarea/i.test(e.target.tagName)) return;
    if (e.key === "/") { e.preventDefault(); $("#q")?.focus(); }
    if (S.route.name === "watch") {
      if (e.key === "k" || e.key === " ") { e.preventDefault(); $("#pp")?.click(); }
      if (e.key === "f") $("[data-act=fs]")?.click();
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "search-form") return;
    e.preventDefault();
    const q = $("#q").value.trim();
    if (q) location.hash = "#/search/" + encodeURIComponent(q);
  });
  // Hover preview on cards (YouTube "autoplay on hover")
  document.addEventListener("mouseenter", (e) => {
    const c = e.target;
    if (!(c instanceof Element) || !c.matches(".card[data-card]")) return;
    const tok = getTok(c.dataset.card);
    const cv = $(".preview canvas", c);
    if (tok && cv) setTimeout(() => c.matches(":hover") && spark(cv, sparkValues(tok)), 120);
  }, true);

  // ------------------------------------------------------------------------
  // Live updates
  // ------------------------------------------------------------------------
  function paintToken(tok, up) {
    const k = lc(tok.address);
    $$(`[data-mc="${k}"]`).forEach((el) => {
      el.textContent = fmtUsd(usd(tok.mcapEth));
      if (el.classList.contains("badge")) {
        el.classList.remove("flash-up", "flash-down");
        void el.offsetWidth;
        el.classList.add(up ? "flash-up" : "flash-down");
        setTimeout(() => el.classList.remove("flash-up", "flash-down"), 700);
      }
    });
  }
  bus.on("trade", ({ tok, tr, mine }) => {
    const k = lc(tok.address);
    paintToken(tok, tr.isBuy);
    const st = stats(tok);
    $$(`[data-bar="${k}"]`).forEach((el) => (el.style.width = (st.sold * 100).toFixed(1) + "%"));
    $$(`[data-n="${k}"]`).forEach((el) => (el.textContent = fmtCount(st.trades)));
    if (S.route.name === "watch" && W.tok === tok) {
      refreshWatch(false);
      renderFeed(true);
      updateQuote();
      if (mine) renderTrade();
    }
    if (S.route.name === "home" && $("#hs-v")) {
      const all = S.tokens.map(stats);
      $("#hs-v").textContent = fmtUsd(usd(all.reduce((a, s) => a + s.vol24, 0)));
      $("#hs-m").textContent = fmtUsd(S.tokens.reduce((a, t) => a + usd(t.mcapEth), 0));
    }
    if (isWatched(tok.address) && !mine) {
      S.notifs.unshift({ tok, t: Date.now(), html: `<b>${esc(tok.symbol)}</b> · ${tr.isBuy ? "buy" : "sell"} of ${fmtEth(tr.eth)} ETH → ${fmtUsd(usd(tok.mcapEth))}` });
      S.unread++;
      updateNotifDot();
    }
  });
  bus.on("ext", () => {
    // Data arriving after the home page rendered without it.
    if (S.route.name === "home" && S.homeFilter === "all" && !$("#ext-grid") && extVisible().length) pageHome("all");
  });
  bus.on("launch", (tok) => {
    homeInsertLaunch(tok);
    S.notifs.unshift({ tok, t: Date.now(), html: `New launch: <b>${tokenTitle(tok)}</b> at ${fmtUsd(usd(tok.startMcapEth))}` });
    S.unread++;
    updateNotifDot();
    if ($("#hs-n")) $("#hs-n").textContent = S.tokens.length;
    if (lc(tok.creator) !== lc(S.account)) toast(`🚀 New: ${tok.name} ($${tok.symbol})`);
  });
  // v2 events (LaunchOptions / FeeSplitUpdated / VestingClaimed) of the token on screen.
  bus.on("v2", (tok) => {
    if (S.route.name === "watch" && W.tok === tok) loadV2(tok);
  });
  bus.on("comment", ({ token }) => {
    if (S.route.name === "watch" && W.tok && lc(W.tok.address) === token) {
      W.tok.comments = null;
      loadComments(W.tok);
    }
  });

  // ------------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------------
  function parseRoute() {
    const parts = (location.hash.slice(1) || "/").split("/").filter(Boolean);
    const [name = "home", arg] = parts;
    return { name, arg: arg ? decodeURIComponent(arg) : undefined };
  }
  function rerender() {
    render(false);
  }
  function render(scroll = true) {
    pageCleanup.forEach((f) => f());
    pageCleanup = [];
    S.route = parseRoute();
    document.body.classList.remove("drawer");
    closeModal();
    const { name, arg } = S.route;
    progress.start();
    switch (name) {
      case "watch": pageWatch(arg); break;
      case "shorts": pageShorts(); break;
      case "trending": pageList("Trending", "fire", filterTokens("trending"), true); break;
      case "subs": pageList("Subscriptions", "subs", filterTokens("subs"), false, "subs"); break;
      case "new": pageList("New", "history", filterTokens("new")); break;
      case "top": pageList("Top market cap", "trend", filterTokens("top"), true); break;
      case "live": pageList("Live", "coin", filterTokens("live")); break;
      case "channel": pageChannel(arg); break;
      case "search": pageSearch(arg || ""); break;
      case "you": pageYou(); break;
      case "history": pageList("History", "history", S.history.map(getTok).filter(Boolean), false, "history"); break;
      case "liked": pageList("Liked tokens", "up", Object.keys(S.liked).filter((k) => S.liked[k] === 1).map(getTok).filter(Boolean), false, "liked"); break;
      default: S.route.name = "home"; pageHome("all");
    }
    renderSidebar();
    $$(".bottom-nav a").forEach((a) => a.classList.toggle("on", a.dataset.nav === S.route.name));
    const tok = name === "watch" && getTok(arg || "");
    document.title = tok ? `${tok.name} ($${tok.symbol}) - InkTube` : "InkTube";
    if (scroll) window.scrollTo(0, 0);
    setTimeout(() => progress.done(), 180);
  }
  window.addEventListener("hashchange", () => render(true));

  // ------------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------------
  (async function boot() {
    renderShell();
    $("#main").innerHTML = `<div class="page"><div class="chips">${CHIPS.map(([, l]) => `<span class="chip skel" style="color:transparent">${l}</span>`).join("")}</div>${skeletonGrid()}</div>`;
    progress.start();
    try {
      await loadExtFallback();
      await Promise.all([API.init(), Promise.race([refreshExt().catch(() => false), sleep(4500)])]);
      startExtPollers();
    } catch (e) {
      console.error(e);
      toast("Erreur de chargement on-chain : " + errMsg(e));
    }
    if (LIVE && store.get("connected", false) && window.ethereum) {
      try {
        const accs = await window.ethereum.request({ method: "eth_accounts" });
        if (accs && accs[0]) S.account = await API.connect();
      } catch {}
    }
    renderAccount();
    render(false);
  })();
})();
