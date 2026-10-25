// Curtain site generator: fetches the live API at build time and writes
// fully pre-rendered, multi-page static HTML into ./docs (GitHub Pages).
// Requires Node 18+ (built-in fetch). No dependencies.
//
//   node build.mjs
//   SITE_URL=https://user.github.io/repo node build.mjs   (enables canonical/sitemap)
//   API_BASE=http://localhost:8080 node build.mjs         (point at another server)

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const API = (process.env.API_BASE || 'https://port-0-powerful-spring-boot-5o1j2llh1wq9rp.sel4.cloudtype.app').replace(/\/$/, '');
const SITE = (process.env.SITE_URL || '').replace(/\/$/, '');
const OUT = process.env.OUT_DIR || 'docs';
const NAME = process.env.SITE_NAME || '커튼 모아보기';
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const MAX_COMPANIES = Number(process.env.MAX_COMPANIES || 0); // 0 = all

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(p, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(API + p, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${p}: ${e.message}`);
      await sleep(2000 * (i + 1)); // also covers cold starts
    }
  }
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n || 0).toLocaleString('ko-KR');
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST

function slugOf(name, used) {
  let s = String(name).trim().replace(/[\\/?#%&:*"'<>|.\s]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
  let out = s, n = 2;
  while (used.has(out.toLowerCase())) out = s + '-' + n++;
  used.add(out.toLowerCase());
  return out;
}
const href = (...segs) => segs.map(encodeURIComponent).join('/') + '/';
const pid = p => createHash('sha1').update(p.d + '|' + p.nn + '|' + p.t).digest('hex').slice(0, 8);
const byDateDesc = (a, b) => (b.d || '').localeCompare(a.d || '');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// ---------- styles ----------
const CSS = `
:root{color-scheme:light dark;--bg:#f7f6f9;--fg:#1d1a22;--mut:#6a6573;--card:#fff;--line:#e4e0ea;--ac:#7a2f68;--ac-soft:#f1e3ee;--bar:#b9689f}
@media (prefers-color-scheme:dark){:root{--bg:#141118;--fg:#ece8f0;--mut:#a39cae;--card:#1c1822;--line:#2e2836;--ac:#e0a3d4;--ac-soft:#2b1f29;--bar:#a4508f}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 "Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif}
a{color:var(--ac);text-decoration:none}a:hover{text-decoration:underline}
a:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--ac);outline-offset:2px;border-radius:4px}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid var(--line);background:var(--card)}
header.top .wrap{display:flex;gap:20px;align-items:baseline;flex-wrap:wrap;padding-top:14px;padding-bottom:14px}
.brand{font-weight:800;font-size:18px;color:var(--fg);margin-right:auto}
nav a{color:var(--mut);font-size:15px}nav a[aria-current=page]{color:var(--ac);font-weight:700}
main{padding:28px 0 56px}
h1{font-size:28px;line-height:1.3;margin:0 0 8px}
h2{font-size:18px;margin:36px 0 12px}
.lead{color:var(--mut);margin:0 0 20px}
.stats{display:flex;gap:28px;flex-wrap:wrap;margin:18px 0 6px}
.stats b{display:block;font-size:30px;line-height:1.2}.stats span{color:var(--mut);font-size:14px}
.bars{list-style:none;margin:0;padding:0}
.bars a{display:grid;grid-template-columns:minmax(72px,160px) 1fr 56px;gap:12px;align-items:center;padding:6px 0;color:var(--fg)}
.bars .bar{height:12px;border-radius:0 6px 6px 0;background:var(--bar);width:var(--w);min-width:3px}
.bars .c{text-align:right;color:var(--mut);font-variant-numeric:tabular-nums;font-size:14px}
.bars .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:0;padding:0}
.chip{display:inline-block;padding:3px 12px;border-radius:999px;background:var(--ac-soft);color:var(--ac);font-size:14px}
.chip small{color:var(--mut);margin-left:4px}
.post{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:0 0 10px}
.post summary{cursor:pointer;padding:14px 16px;list-style:none}
.post summary::-webkit-details-marker{display:none}
.post .t{display:block;font-weight:700;line-height:1.5}
.post .meta{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:6px;font-size:13px;color:var(--mut)}
.post[open] summary{border-bottom:1px solid var(--line)}
.post .body{padding:14px 16px;white-space:pre-wrap;overflow-wrap:anywhere}
.post .body a{word-break:break-all}
#q{width:100%;padding:10px 14px;margin:0 0 16px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);font:inherit}
.more{margin-top:14px}
.note{color:var(--mut);font-size:14px}
.crumbs{font-size:14px;color:var(--mut);margin-bottom:10px}
footer{border-top:1px solid var(--line);color:var(--mut);font-size:13px;padding:20px 0 40px}
@media (max-width:520px){.bars a{grid-template-columns:96px 1fr 48px;gap:8px}h1{font-size:24px}}
`;

// ---------- templates ----------
function page({ depth, route, title, desc, body, nav = '', noindex = false, search = false }) {
  const root = depth ? '../'.repeat(depth) : './';
  const full = title === NAME ? NAME : `${title} - ${NAME}`;
  const canon = SITE ? `<link rel="canonical" href="${esc(SITE + '/' + route)}">` : '';
  const links = [['', '홈', 'home'], ['feed/', '최신 글', 'feed'], ['companies/', '회사', 'companies'], ['topics/', '주제', 'topics']]
    .map(([h, l, k]) => `<a href="${root}${h}"${nav === k ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  const script = search ? `<script>
var q=document.getElementById('q');if(q){q.hidden=false;var ps=[].slice.call(document.querySelectorAll('.post'));
q.addEventListener('input',function(){var v=q.value.trim().toLowerCase();ps.forEach(function(p){p.hidden=v&&p.textContent.toLowerCase().indexOf(v)<0})})}
</script>` : '';
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(full)}</title>
<meta name="description" content="${esc(clip(desc, 150))}">
${noindex ? '<meta name="robots" content="noindex,follow">\n' : ''}${canon}
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(clip(desc, 150))}">
<link rel="stylesheet" href="${root}style.css">
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="${root}">${esc(NAME)}</a><nav>${links}</nav></div></header>
<main><div class="wrap">
${body}
</div></main>
<footer><div class="wrap">데이터 갱신: ${today} (KST)</div></footer>
${script}
</body>
</html>
`;
}

function postHtml(p, ctx, depth) {
  const root = depth ? '../'.repeat(depth) : './';
  const c = ctx.comps.get(p.cp), t = ctx.topics.get(p.cn);
  const cLink = c ? `<a href="${root}company/${href(c.slug)}">${esc(p.cp)}</a>` : esc(p.cp);
  const tLink = t ? `<a href="${root}topic/${href(t.slug)}">${esc(p.cn)}</a>` : esc(p.cn);
  return `<article class="post" id="p-${pid(p)}"><details><summary><span class="t">${esc(p.t)}</span>
<span class="meta"><span>${cLink}</span><span>${tLink}</span><span>${esc(p.nn)}</span><time datetime="${esc(p.d)}">${esc(p.d)}</time></span></summary>
<div class="body">${esc(p.b)}</div></details></article>`;
}

const searchBox = '<input id="q" type="search" placeholder="제목·본문·닉네임 검색" aria-label="글 검색" hidden>';

// ---------- build ----------
async function main() {
  console.log('API:', API);
  const [chart, latest] = await Promise.all([get('/api/curtain/chart'), get('/api/curtain')]);
  const comp = (chart.comp || []).filter(c => c.cpn);
  const topic = (chart.topic || []).filter(t => t.cnn);
  const total = chart.total || {};
  if (!comp.length || !latest.length) throw new Error('API returned empty data; refusing to overwrite site');

  const comps = new Map(), topics = new Map();
  const usedC = new Set(), usedT = new Set(); // company/topic slugs live in separate folders
  for (const c of comp) comps.set(c.cpn, { name: c.cpn, count: c.cpc, last: c.cpd, slug: slugOf(c.cpn, usedC) });
  for (const t of topic) topics.set(t.cnn, { name: t.cnn, count: t.cnc, last: t.cnd, slug: slugOf(t.cnn, usedT) });
  const ctx = { comps, topics };

  // posts per company (the only way to get more than the latest 100)
  const seen = new Map();
  const add = p => { const k = pid(p); if (!seen.has(k)) seen.set(k, p); };
  latest.forEach(add);
  let list = [...comps.values()];
  if (MAX_COMPANIES) list = list.slice(0, MAX_COMPANIES);
  const compPosts = new Map();
  await pool(list, CONCURRENCY, async c => {
    try {
      const ps = (await get('/api/curtain/' + encodeURIComponent(c.name))).sort(byDateDesc);
      compPosts.set(c.name, ps); ps.forEach(add);
    } catch (e) { console.warn('skip company:', c.name, e.message); }
  });

  await rm(OUT, { recursive: true, force: true });
  const urls = []; // [route, lastmod]
  const write = async (route, html, lastmod, indexable = true) => {
    const file = path.join(OUT, decodeURIComponent(route), route.endsWith('.html') ? '' : 'index.html');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
    if (indexable) urls.push([route, lastmod]);
  };

  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'style.css'), CSS.trim() + '\n');
  await writeFile(path.join(OUT, '.nojekyll'), '');

  // home
  const topC = [...comps.values()].slice(0, 15), max = Math.max(...topC.map(c => c.count), 1);
  const bars = topC.map(c => `<li><a href="company/${href(c.slug)}"><span class="n">${esc(c.name)}</span><span class="bar" style="--w:${Math.max(1, Math.round(c.count / max * 100))}%"></span><span class="c">${num(c.count)}</span></a></li>`).join('\n');
  const chips = topic.map(t => `<li><a class="chip" href="topic/${href(topics.get(t.cnn).slug)}">${esc(t.cnn)}<small>${num(t.cnc)}</small></a></li>`).join('');
  const recent = latest.slice(0, 10).map(p => postHtml(p, ctx, 0)).join('\n');
  await write('', page({
    depth: 0, route: '', title: NAME, nav: 'home',
    desc: `블라인드 회사별·주제별 글 모아보기. 전체 ${num(total.tc)}개 글, 최근 글 ${total.tmd || ''}.`,
    body: `<h1>${esc(NAME)}</h1>
<p class="lead">회사별·주제별로 글을 모아봅니다.</p>
<div class="stats"><div><b>${num(total.tc)}</b><span>전체 글</span></div><div><b>${num(comps.size)}</b><span>회사</span></div><div><b>${esc(total.tmd || '-')}</b><span>마지막 글</span></div></div>
<h2>글이 많은 회사</h2>
<ul class="bars">${bars}</ul>
<p class="more"><a href="companies/">회사 전체 보기</a></p>
<h2>주제</h2>
<ul class="chips">${chips}</ul>
<h2>최신 글</h2>
${recent}
<p class="more"><a href="feed/">최신 글 더 보기</a></p>`
  }), total.tmd);

  // feed
  await write('feed/', page({
    depth: 1, route: 'feed/', title: '최신 글', nav: 'feed', search: true,
    desc: `가장 최근에 올라온 글 ${latest.length}개.`,
    body: `<h1>최신 글</h1><p class="lead">가장 최근 글 ${latest.length}개입니다. 제목을 누르면 본문이 펼쳐집니다.</p>
${searchBox}
${latest.map(p => postHtml(p, ctx, 1)).join('\n')}`
  }), total.tmd);

  // companies index
  await write('companies/', page({
    depth: 1, route: 'companies/', title: '회사', nav: 'companies',
    desc: `글이 올라온 ${num(comps.size)}개 회사 목록.`,
    body: `<h1>회사</h1><p class="lead">글 수가 많은 순서입니다.</p>
<ul class="bars">${[...comps.values()].map(c => `<li><a href="../company/${href(c.slug)}"><span class="n">${esc(c.name)}</span><span class="bar" style="--w:${Math.max(1, Math.round(c.count / max * 100))}%"></span><span class="c">${num(c.count)}</span></a></li>`).join('\n')}</ul>`
  }), total.tmd);

  // company pages
  for (const c of list) {
    const ps = compPosts.get(c.name); if (!ps) continue;
    await write(`company/${href(c.slug)}`, page({
      depth: 2, route: `company/${href(c.slug)}`, title: `${c.name} 글 모음`, search: true, noindex: !ps.length,
      desc: `${c.name} 글 ${num(c.count)}개. 최근 글: ${ps[0] ? clip(ps[0].t, 60) : ''}`,
      body: `<div class="crumbs"><a href="../../companies/">회사</a></div>
<h1>${esc(c.name)}</h1>
<p class="lead">전체 ${num(c.count)}개 글 · 마지막 글 ${esc(c.last || '-')}${ps.length ? ` · 아래는 최근 ${ps.length}개` : ''}</p>
${ps.length ? searchBox : '<p class="note">표시할 글이 없습니다.</p>'}
${ps.map(p => postHtml(p, ctx, 2)).join('\n')}`
    }), c.last, ps.length > 0);
  }

  // topics index + pages (built from every post collected above)
  const all = [...seen.values()].sort(byDateDesc);
  await write('topics/', page({
    depth: 1, route: 'topics/', title: '주제', nav: 'topics',
    desc: `글 주제(카테고리) ${topic.length}개.`,
    body: `<h1>주제</h1><p class="lead">글이 올라온 카테고리입니다.</p>
<ul class="chips">${topic.map(t => `<li><a class="chip" href="../topic/${href(topics.get(t.cnn).slug)}">${esc(t.cnn)}<small>${num(t.cnc)}</small></a></li>`).join('')}</ul>`
  }), total.tmd);
  for (const t of topics.values()) {
    const ps = all.filter(p => p.cn === t.name).slice(0, 200);
    await write(`topic/${href(t.slug)}`, page({
      depth: 2, route: `topic/${href(t.slug)}`, title: `${t.name} 글 모음`, search: true, noindex: !ps.length,
      desc: `${t.name} 주제의 글 ${num(t.count)}개. 최근 글: ${ps[0] ? clip(ps[0].t, 60) : ''}`,
      body: `<div class="crumbs"><a href="../../topics/">주제</a></div>
<h1>${esc(t.name)}</h1>
<p class="lead">전체 ${num(t.count)}개 글 · 마지막 글 ${esc(t.last || '-')}</p>
${ps.length ? `<p class="note">수집된 최근 글 중 ${ps.length}개를 보여줍니다.</p>${searchBox}` : '<p class="note">수집된 글이 없습니다.</p>'}
${ps.map(p => postHtml(p, ctx, 2)).join('\n')}`
    }), t.last, ps.length > 0);
  }

  // 404, sitemap, robots
  await write('404.html', page({ depth: 0, route: '404.html', title: '페이지를 찾을 수 없습니다', noindex: true, desc: '요청한 페이지가 없습니다.', body: '<h1>페이지를 찾을 수 없습니다</h1><p class="lead">주소를 확인하거나 <a href="./">홈</a>에서 다시 찾아보세요.</p>' }), '', false);
  if (SITE) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map(([r, m]) => `<url><loc>${esc(SITE + '/' + r)}</loc>${m ? `<lastmod>${esc(m)}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
    await writeFile(path.join(OUT, 'sitemap.xml'), xml);
    await writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  } else {
    console.warn('SITE_URL not set: canonical links and sitemap.xml were skipped');
    await writeFile(path.join(OUT, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  }
  console.log(`done: ${urls.length} indexable pages, ${seen.size} posts, ${comps.size} companies`);
}

main().catch(e => { console.error(e); process.exit(1); });
