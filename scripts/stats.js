#!/usr/bin/env node
/**
 * stats.js — Cards de estatísticas gerados no próprio repo (sem servidor de terceiros).
 *
 * Substitui o github-readme-stats (cuja instância pública foi pausada) por dois
 * cards SVG no tema Dracula: estatísticas gerais + linguagens mais usadas.
 *
 * Uso (no GitHub Actions, GITHUB_TOKEN já disponível):
 *   GITHUB_TOKEN=xxx node scripts/stats.js --user RafaelDVL --out dist/
 * Teste local sem token:
 *   node scripts/stats.js --user RafaelDVL --out dist/ --mock
 *
 * Sem dependências externas (Node >= 18).
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : def;
}
const USER = arg("user", "RafaelDVL");
const OUT = arg("out", "dist");
const MOCK = args.includes("--mock");

const QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    login
    followers { totalCount }
    pullRequests { totalCount }
    issues { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      totalPullRequestReviewContributions
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: {field: STARGAZERS, direction: DESC}) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchStats(login) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error("Defina GITHUB_TOKEN (ou use --mock para testar).");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats",
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error("GraphQL: " + JSON.stringify(json.errors));
  const u = json.data.user;

  const stars = u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0);
  const langBytes = {};
  const langColor = {};
  for (const r of u.repositories.nodes) {
    for (const e of r.languages.edges) {
      langBytes[e.node.name] = (langBytes[e.node.name] || 0) + e.size;
      langColor[e.node.name] = e.node.color || "#8b949e";
    }
  }
  const cc = u.contributionsCollection;
  return {
    name: u.name || u.login,
    login: u.login,
    stars,
    commitsYear: cc.totalCommitContributions + cc.restrictedContributionsCount,
    totalContrib: cc.contributionCalendar.totalContributions,
    prs: u.pullRequests.totalCount,
    issues: u.issues.totalCount,
    reviews: cc.totalPullRequestReviewContributions,
    followers: u.followers.totalCount,
    repos: u.repositories.totalCount,
    langs: Object.entries(langBytes)
      .map(([name, size]) => ({ name, size, color: langColor[name] }))
      .sort((a, b) => b.size - a.size),
  };
}

function mockStats() {
  return {
    name: "Rafael Dias Rodrigues",
    login: "RafaelDVL",
    stars: 3,
    commitsYear: 245,
    totalContrib: 269,
    prs: 12,
    issues: 4,
    reviews: 2,
    followers: 6,
    repos: 18,
    langs: [
      { name: "Java", size: 420000, color: "#b07219" },
      { name: "TypeScript", size: 310000, color: "#3178c6" },
      { name: "HTML", size: 150000, color: "#e34c26" },
      { name: "SCSS", size: 90000, color: "#c6538c" },
      { name: "C#", size: 60000, color: "#178600" },
      { name: "CSS", size: 40000, color: "#563d7c" },
      { name: "Python", size: 20000, color: "#3572A5" },
    ],
  };
}

// ---------- Tema Dracula ----------
const T = {
  bg: "#282a36",
  border: "#44475a",
  title: "#ff79c6",
  text: "#f8f8f2",
  sub: "#6272a4",
  icon: "#bd93f9",
  bar: "#44475a",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ícone pixel-art 8x8 (matriz de strings; '#' = pintado)
function pixelIcon(rows, color, scale = 1.6) {
  let out = `<g shape-rendering="crispEdges">`;
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === "#")
        out += `<rect x="${(x * scale).toFixed(1)}" y="${(y * scale).toFixed(1)}" width="${scale}" height="${scale}" fill="${color}"/>`;
    });
  });
  return out + `</g>`;
}

const ICONS = {
  star: ["...#....", "...#....", "..###...", "########", ".######.", "..####..", ".##..##.", "#......#"],
  commit: ["........", "..####..", ".#....#.", "#..##..#", "#..##..#", ".#....#.", "..####..", "........"],
  pr: ["##......", "##..##..", ".#..##..", ".#...#..", ".#...#..", ".#..##..", "....##..", "........"],
  issue: ["..####..", ".#....#.", "#..##..#", "#..##..#", "#......#", "#..##..#", ".#....#.", "..####.."],
  contrib: ["##.##.##", "##.##.##", "........", "##.##.##", "##.##.##", "........", "##.##.##", "##.##.##"],
  follow: ["..##....", ".####...", "..##....", ".####..#", "#####.##", "#####..#", ".###....", "........"],
};

function statsCard(s) {
  const W = 420, H = 170;
  const rows = [
    ["star", "Estrelas ganhas", s.stars],
    ["commit", `Commits (últ. ano)`, s.commitsYear],
    ["pr", "Pull Requests", s.prs],
    ["issue", "Issues", s.issues],
    ["contrib", "Contribuições (ano)", s.totalContrib],
    ["follow", "Seguidores", s.followers],
  ];
  const rowH = 20, startY = 48;
  const items = rows
    .map(([icon, label, val], i) => {
      const y = startY + i * rowH;
      return `
      <g transform="translate(26,${y - 11})" class="r" style="animation-delay:${(i * 0.12).toFixed(2)}s">
        <g transform="translate(0,0)">${pixelIcon(ICONS[icon], T.icon)}</g>
        <text x="24" y="11" font-size="12" fill="${T.text}">${esc(label)}:</text>
        <text x="${W - 56}" y="11" font-size="12" font-weight="bold" fill="${T.title}" text-anchor="end">${val}</text>
      </g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Estatísticas de ${esc(s.login)}">
  <style>
    text { font-family: "Courier New", ui-monospace, monospace; }
    .r { opacity: 0; animation: fade .5s ease-out forwards; }
    @keyframes fade { to { opacity: 1; } }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${T.bg}" stroke="${T.border}"/>
  <text x="26" y="30" font-size="14" font-weight="bold" fill="${T.title}">▚ Estatísticas de ${esc(s.name)}</text>
  ${items}
</svg>`;
}

function langsCard(s) {
  const W = 320, H = 170;
  const top = s.langs.slice(0, 7);
  const total = top.reduce((x, l) => x + l.size, 0) || 1;
  // barra empilhada
  const barY = 44, barH = 10, barW = W - 52;
  let x = 26, segs = "";
  top.forEach((l) => {
    const w = (l.size / total) * barW;
    segs += `<rect x="${x.toFixed(1)}" y="${barY}" width="${Math.max(1, w).toFixed(1)}" height="${barH}" fill="${l.color}"/>`;
    x += w;
  });
  // legenda em 2 colunas
  const legend = top
    .map((l, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const lx = 26 + col * ((W - 52) / 2), ly = barY + 34 + row * 22;
      const pctv = ((l.size / total) * 100).toFixed(1);
      return `<g class="r" style="animation-delay:${(i * 0.1).toFixed(2)}s">
        <rect x="${lx}" y="${ly - 9}" width="10" height="10" fill="${l.color}" shape-rendering="crispEdges"/>
        <text x="${lx + 16}" y="${ly}" font-size="11" fill="${T.text}">${esc(l.name)} <tspan fill="${T.sub}">${pctv}%</tspan></text>
      </g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Linguagens mais usadas">
  <style>
    text { font-family: "Courier New", ui-monospace, monospace; }
    .r { opacity: 0; animation: fade .5s ease-out forwards; }
    @keyframes fade { to { opacity: 1; } }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${T.bg}" stroke="${T.border}"/>
  <text x="26" y="30" font-size="14" font-weight="bold" fill="${T.title}">▚ Linguagens mais usadas</text>
  <rect x="26" y="${barY}" width="${barW}" height="${barH}" fill="${T.bar}"/>
  ${segs}
  ${legend}
</svg>`;
}

(async () => {
  const s = MOCK ? mockStats() : await fetchStats(USER);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "stats.svg"), statsCard(s));
  fs.writeFileSync(path.join(OUT, "langs.svg"), langsCard(s));
  console.log(`OK: stats.svg + langs.svg → ${OUT}/ (${MOCK ? "mock" : "dados reais"})`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
