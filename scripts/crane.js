#!/usr/bin/env node
/**
 * crane.js — "Guindaste 8-bit" contribution skyline
 *
 * Gera um SVG animado onde um guindaste pixel-art constrói um skyline:
 * cada semana do último ano vira um "prédio" cuja altura é proporcional
 * às contribuições daquela semana. Tema Dracula (dark) + variante light.
 *
 * Uso:
 *   node scripts/crane.js --user RafaelDVL --out dist/
 *   node scripts/crane.js --user RafaelDVL --out dist/ --data test/contrib.json  (modo offline/teste)
 *
 * Sem dependências externas (Node >= 18, usa fetch nativo).
 */

const fs = require("fs");
const path = require("path");

// ---------- CLI ----------
const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : def;
}
const USER = arg("user", "RafaelDVL");
const OUT = arg("out", "dist");
const DATA_FILE = arg("data", null);

// ---------- Coleta de dados ----------
// O calendário de contribuições é público: github.com/users/<user>/contributions
// devolve um fragmento HTML com <td data-date data-level> + tooltips com a contagem.
async function fetchContributions(user) {
  const url = `https://github.com/users/${user}/contributions`;
  const res = await fetch(url, {
    headers: { "x-requested-with": "XMLHttpRequest", "user-agent": "profile-crane" },
  });
  if (!res.ok) throw new Error(`Falha ao buscar contribuições: HTTP ${res.status}`);
  const html = await res.text();
  return parseContributions(html);
}

function parseContributions(html) {
  // células: <td ... class="ContributionCalendar-day" ... data-date="YYYY-MM-DD" data-level="N" id="..."
  const days = [];
  const cellRe =
    /<td[^>]*ContributionCalendar-day[^>]*>/g;
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? m[1] : null;
  };
  // tooltips: <tool-tip for="ID">N contributions on ...</tool-tip>
  const tips = {};
  const tipRe = /<tool-tip[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/tool-tip>/g;
  let tm;
  while ((tm = tipRe.exec(html))) tips[tm[1]] = tm[2].replace(/<[^>]+>/g, "").trim();

  let m;
  while ((m = cellRe.exec(html))) {
    const tag = m[0];
    const date = attr(tag, "data-date");
    if (!date) continue;
    const level = +(attr(tag, "data-level") || 0);
    const id = attr(tag, "id");
    let count = 0;
    const tip = id ? tips[id] : null;
    if (tip) {
      const cm = tip.match(/^(\d+)/);
      if (cm) count = +cm[1];
    }
    days.push({ date, count, level });
  }
  if (!days.length) throw new Error("Não consegui parsear o calendário (markup mudou?)");
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

// ---------- Agregação semanal ----------
function toWeeks(days) {
  // semanas começam no domingo, como no gráfico do GitHub
  const weeks = [];
  let cur = null;
  for (const d of days) {
    const dow = new Date(d.date + "T00:00:00Z").getUTCDay();
    if (dow === 0 || !cur) {
      cur = { start: d.date, total: 0, maxLevel: 0, days: [] };
      weeks.push(cur);
    }
    cur.total += d.count;
    cur.maxLevel = Math.max(cur.maxLevel, d.level);
    cur.days.push(d);
  }
  return weeks;
}

// ---------- Tema ----------
const THEMES = {
  dark: {
    bg: "#282a36",
    panel: "#21222c",
    text: "#f8f8f2",
    subtext: "#6272a4",
    ground: "#44475a",
    groundTop: "#6272a4",
    crane: "#ffb86c",
    craneDark: "#b06a2c",
    cable: "#f8f8f2",
    blocks: ["#3b2d5e", "#5a4594", "#8667c9", "#bd93f9"], // roxos Dracula (nível 1..4)
    accent: "#ff79c6",
    star: "#f1fa8c",
    windows: "#f1fa8c",
    sky: null, // sem céu extra, usa bg
    moon: "#f8f8f2",
  },
  light: {
    bg: "#ffffff",
    panel: "#f6f8fa",
    text: "#24292f",
    subtext: "#57606a",
    ground: "#d0d7de",
    groundTop: "#afb8c1",
    crane: "#fb8500",
    craneDark: "#9a5300",
    cable: "#57606a",
    blocks: ["#9be9a8", "#40c463", "#30a14e", "#216e39"], // verdes GitHub
    accent: "#cf222e",
    star: "#bf8700",
    windows: "#fff8c5",
    sky: null,
    moon: "#f2cc60",
  },
};

// ---------- Geometria / layout ----------
const W = 880;
const H = 240;
const PAD_L = 24;
const PAD_R = 24;
const GROUND_Y = H - 34; // topo do chão
const BEAM_Y = 34; // viga do pórtico
const BLOCK_H = 7; // altura de cada bloco (px)
const MAX_BLOCKS = 16; // altura máxima de um prédio em blocos

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pct(t, T) {
  return ((t / T) * 100).toFixed(3);
}

// ---------- Render ----------
function render(weeks, themeName, user) {
  const T0 = THEMES[themeName];
  const nWeeks = weeks.length;
  const colW = (W - PAD_L - PAD_R) / nWeeks;
  const blockW = Math.max(4, Math.floor(colW) - 3);

  const totalContrib = weeks.reduce((s, w) => s + w.total, 0);
  const maxWeek = Math.max(1, ...weeks.map((w) => w.total));
  // escala: quantas contribuições por bloco, para a maior semana caber em MAX_BLOCKS
  const unit = Math.max(1, Math.ceil(maxWeek / MAX_BLOCKS));

  // monta a lista de blocos na ordem de construção (esq→dir, baixo→cima)
  const blocks = [];
  weeks.forEach((w, wi) => {
    const n = w.total > 0 ? Math.max(1, Math.round(w.total / unit)) : 0;
    const x = PAD_L + wi * colW + (colW - blockW) / 2;
    for (let b = 0; b < n; b++) {
      const y = GROUND_Y - (b + 1) * BLOCK_H;
      // cor: interpola pelo "andar" relativo + nível da semana
      const li = Math.min(3, Math.max(0, w.maxLevel - 1));
      const colorIdx = Math.min(3, Math.round((b / Math.max(1, n - 1)) * li));
      blocks.push({ wi, x: Math.round(x), y: Math.round(y), b, n, colorIdx, weekStart: w.start });
    }
  });

  const nBlocks = blocks.length;
  if (nBlocks === 0) {
    // ano vazio: ainda gera cena com guindaste parado
    blocks.push({ wi: Math.floor(nWeeks / 2), x: W / 2, y: GROUND_Y - BLOCK_H, b: 0, n: 1, colorIdx: 0, ghost: true });
  }

  // ---------- Cronograma ----------
  const PLACE = Math.min(0.5, Math.max(0.16, 26 / nBlocks)); // s por bloco, loop ~até 30s
  const BUILD = nBlocks * PLACE;
  const HOLD = 5; // segundos admirando a obra pronta
  const T = BUILD + HOLD; // duração total do loop

  // keyframes do trolley (carrinho do guindaste): x segue a coluna sendo construída
  const trolleyStops = [];
  {
    let lastWi = -1;
    blocks.forEach((blk, k) => {
      if (blk.wi !== lastWi) {
        trolleyStops.push({ t: k * PLACE, x: blk.x + blockW / 2 });
        lastWi = blk.wi;
      }
    });
  }
  const trolleyKF = [];
  trolleyStops.forEach((s, i) => {
    const xr = (s.x - W / 2).toFixed(1);
    trolleyKF.push(`${pct(s.t, T)}% { transform: translateX(${xr}px); }`);
    const next = trolleyStops[i + 1];
    const end = next ? next.t - 0.12 : BUILD;
    if (end > s.t) trolleyKF.push(`${pct(end, T)}% { transform: translateX(${xr}px); }`);
  });
  trolleyKF.push(`100% { transform: translateX(${(trolleyStops.at(-1).x - W / 2).toFixed(1)}px); }`);

  // keyframes do gancho (desce até o topo da pilha a cada bloco)
  const hookKF = [`0% { transform: translateY(0); }`];
  blocks.forEach((blk, k) => {
    const t0 = k * PLACE;
    const drop = blk.y - BEAM_Y - 26; // quanto o gancho desce
    const dStart = pct(t0 + PLACE * 0.15, T);
    const dDown = pct(t0 + PLACE * 0.55, T);
    const dUp = pct(Math.min(t0 + PLACE * 0.95, BUILD), T);
    hookKF.push(`${dStart}% { transform: translateY(0); }`);
    hookKF.push(`${dDown}% { transform: translateY(${Math.max(0, drop).toFixed(0)}px); }`);
    hookKF.push(`${dUp}% { transform: translateY(0); }`);
  });
  hookKF.push(`100% { transform: translateY(0); }`);

  // blocos: invisíveis até o momento de "cair" no lugar
  const blockRects = blocks
    .map((blk, k) => {
      if (blk.ghost) return "";
      const t0 = k * PLACE;
      const appear = pct(t0 + PLACE * 0.5, T);
      const settle = pct(Math.min(t0 + PLACE * 0.8, BUILD), T);
      const color = T0.blocks[blk.colorIdx];
      return (
        `<rect class="blk" x="${blk.x}" y="${blk.y + 1}" width="${blockW}" height="${BLOCK_H - 1}" fill="${color}" ` +
        `style="animation-delay:0s" data-k="${k}"/>` +
        `<style>.blk[data-k="${k}"]{opacity:0;animation:b${k} ${T}s steps(1,end) infinite}` +
        `@keyframes b${k}{0%{opacity:0}${appear}%{opacity:1}100%{opacity:1}}</style>`
      );
    })
    .join("\n");

  // janelas acesas nos prédios mais altos (aparecem na fase HOLD)
  const windows = [];
  weeks.forEach((w, wi) => {
    const n = w.total > 0 ? Math.max(1, Math.round(w.total / unit)) : 0;
    if (n >= 3) {
      const x = PAD_L + wi * colW + (colW - blockW) / 2;
      for (let b = 1; b < n; b += 2) {
        const y = GROUND_Y - b * BLOCK_H - BLOCK_H + 2;
        windows.push(
          `<rect class="win" x="${(x + blockW / 2 - 1).toFixed(0)}" y="${y.toFixed(0)}" width="2" height="3" fill="${T0.windows}"/>`
        );
      }
    }
  });
  const winOn = pct(BUILD + 0.6, T);

  // estrelas (só no dark)
  let stars = "";
  if (themeName === "dark") {
    const rng = mulberry32(42);
    const s = [];
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rng() * W);
      const y = Math.floor(rng() * (GROUND_Y - 80)) + 6;
      const d = (rng() * 3).toFixed(2);
      s.push(`<rect x="${x}" y="${y}" width="2" height="2" fill="${T0.star}" class="st" style="animation-delay:${d}s"/>`);
    }
    stars = s.join("");
  }

  // lua / sol pixel-art
  const orb =
    themeName === "dark"
      ? `<g transform="translate(${W - 90},26)">
          <rect x="2" y="0" width="12" height="2" fill="${T0.moon}"/><rect x="0" y="2" width="16" height="12" fill="${T0.moon}"/>
          <rect x="2" y="14" width="12" height="2" fill="${T0.moon}"/>
          <rect x="4" y="4" width="3" height="3" fill="${T0.bg}" opacity=".35"/><rect x="9" y="8" width="2" height="2" fill="${T0.bg}" opacity=".35"/>
        </g>`
      : `<g transform="translate(${W - 92},24)">
          <rect x="4" y="0" width="10" height="2" fill="${T0.moon}"/><rect x="2" y="2" width="14" height="10" fill="${T0.moon}"/>
          <rect x="4" y="12" width="10" height="2" fill="${T0.moon}"/>
          <rect x="-4" y="6" width="4" height="2" fill="${T0.moon}"/><rect x="18" y="6" width="4" height="2" fill="${T0.moon}"/>
          <rect x="8" y="-5" width="2" height="4" fill="${T0.moon}"/><rect x="8" y="15" width="2" height="4" fill="${T0.moon}"/>
        </g>`;

  // guindaste pórtico (gantry) pixel-art
  const legW = 6;
  const crane = `
  <g shape-rendering="crispEdges">
    <!-- pernas -->
    <rect x="${PAD_L - 10}" y="${BEAM_Y}" width="${legW}" height="${GROUND_Y - BEAM_Y}" fill="${T0.crane}"/>
    <rect x="${W - PAD_R + 4}" y="${BEAM_Y}" width="${legW}" height="${GROUND_Y - BEAM_Y}" fill="${T0.crane}"/>
    <rect x="${PAD_L - 12}" y="${GROUND_Y - 4}" width="${legW + 4}" height="4" fill="${T0.craneDark}"/>
    <rect x="${W - PAD_R + 2}" y="${GROUND_Y - 4}" width="${legW + 4}" height="4" fill="${T0.craneDark}"/>
    <!-- viga -->
    <rect x="${PAD_L - 12}" y="${BEAM_Y - 8}" width="${W - PAD_L - PAD_R + 24}" height="8" fill="${T0.crane}"/>
    <rect x="${PAD_L - 12}" y="${BEAM_Y - 2}" width="${W - PAD_L - PAD_R + 24}" height="2" fill="${T0.craneDark}"/>
    <!-- luz de topo -->
    <rect x="${W / 2 - 1}" y="${BEAM_Y - 12}" width="3" height="4" fill="${T0.accent}" class="blink"/>
  </g>
  <!-- trolley + gancho -->
  <g class="trolley">
    <g transform="translate(${W / 2},0)">
      <rect x="-8" y="${BEAM_Y - 2}" width="16" height="7" fill="${T0.craneDark}" shape-rendering="crispEdges"/>
      <g clip-path="url(#belowBeam)">
        <g class="hook">
          <rect x="-0.5" y="${BEAM_Y - 220}" width="1.5" height="241" fill="${T0.cable}" shape-rendering="crispEdges"/>
        </g>
      </g>
      <g class="hook">
        <rect x="-4" y="${BEAM_Y + 21}" width="9" height="3" fill="${T0.crane}" shape-rendering="crispEdges"/>
        <rect x="${-blockW / 2}" y="${BEAM_Y + 24}" width="${blockW}" height="${BLOCK_H - 1}" fill="${T0.blocks[3]}" class="carried" shape-rendering="crispEdges"/>
      </g>
    </g>
  </g>`;

  const title = `@${esc(user)} — construindo ${totalContrib} contribuições`;
  const sub = `${weeks[0].start} → ${weeks.at(-1).days.at(-1).date} · 1 bloco ≈ ${unit} contribuiç${unit > 1 ? "ões" : "ão"}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${title}">
  <style>
    .trolley { animation: trolley ${T}s linear infinite; }
    @keyframes trolley { ${trolleyKF.join(" ")} }
    .hook { animation: hook ${T}s linear infinite; }
    @keyframes hook { ${hookKF.join(" ")} }
    .carried { animation: carried ${T}s steps(1,end) infinite; }
    @keyframes carried { 0% {opacity:1} ${pct(BUILD, T)}% {opacity:1} ${pct(BUILD + 0.01, T)}% {opacity:0} 100% {opacity:0} }
    .win { opacity:0; animation: winon ${T}s steps(1,end) infinite; }
    @keyframes winon { 0%{opacity:0} ${winOn}%{opacity:1} 100%{opacity:1} }
    .st { animation: tw 3.2s steps(2,end) infinite; }
    @keyframes tw { 0%,100% {opacity:.9} 50% {opacity:.15} }
    .blink { animation: bl 1.4s steps(2,end) infinite; }
    @keyframes bl { 0%,100% {opacity:1} 50% {opacity:.1} }
    text { font-family: "Courier New", ui-monospace, monospace; }
  </style>
  <defs><clipPath id="belowBeam"><rect x="-400" y="${BEAM_Y + 4}" width="800" height="${H}"/></clipPath></defs>
  <rect width="${W}" height="${H}" fill="${T0.bg}" rx="8"/>
  ${stars}
  ${orb}
  <!-- chão -->
  <rect x="0" y="${GROUND_Y}" width="${W}" height="${H - GROUND_Y}" fill="${T0.ground}"/>
  <rect x="0" y="${GROUND_Y}" width="${W}" height="3" fill="${T0.groundTop}"/>
  <g shape-rendering="crispEdges">${blockRects}</g>
  <g>${windows.join("")}</g>
  ${crane}
  <text x="${PAD_L - 10}" y="${H - 10}" font-size="12" fill="${T0.text}" font-weight="bold">${title}</text>
  <text x="${W - PAD_R + 10}" y="${H - 10}" font-size="10" fill="${T0.text}" opacity="0.65" text-anchor="end">${esc(sub)}</text>
</svg>`;
}

// PRNG determinístico p/ estrelas (SVG estável entre execuções)
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- main ----------
(async () => {
  let days;
  if (DATA_FILE) {
    days = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } else {
    days = await fetchContributions(USER);
  }
  const weeks = toWeeks(days);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "crane-dark.svg"), render(weeks, "dark", USER));
  fs.writeFileSync(path.join(OUT, "crane-light.svg"), render(weeks, "light", USER));
  const total = days.reduce((s, d) => s + d.count, 0);
  console.log(`OK: ${weeks.length} semanas, ${total} contribuições → ${OUT}/crane-{dark,light}.svg`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
