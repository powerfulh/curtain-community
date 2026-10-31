// Curtain site generator (Node 18+, no dependencies).
// Companies are identified by name (IDs are ignored); categories by cid.
//
// 1) POST /api/curtain/build/refresh        -> server loads the latest 10,000 posts
// 2) GET  /api/curtain/build/{key}?offset=  -> read them all (newest first)
// 3) GET  /api/curtain/chart                -> overall totals (optional)
// Then writes fully pre-rendered, multi-page static HTML into ./docs (plus everything in ./public).
//
//   BUILD_KEY=xxxx node build.mjs
//
// Env: BUILD_KEY (required), SITE_URL, API_BASE, SITE_NAME, OUT_DIR,
//      PER_PAGE=50, MAX_POSTS=10000, PAGE_SIZE=1000 (server-side LIMIT), CONCURRENCY=3,
//      MIN_COMPANY_POSTS=3, SKIP_REFRESH=1, POST_PAGES=1

import { mkdir, writeFile, rm, cp, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const API = (process.env.API_BASE || 'https://port-0-powerful-spring-boot-5o1j2llh1wq9rp.sel4.cloudtype.app').replace(/\/$/, '');
const KEY = process.env.BUILD_KEY;
const SITE = (process.env.SITE_URL || 'https://powerfulh.github.io/curtain-community').replace(/\/$/, '');
const BASE_PATH = new URL(SITE).pathname.replace(/\/$/, '');
const OUT = process.env.OUT_DIR || 'docs';
const NAME = process.env.SITE_NAME || '커튼 모아보기';
const PER_PAGE = Number(process.env.PER_PAGE || 50);
const MAX_POSTS = Number(process.env.MAX_POSTS || 10000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const MIN_COMPANY_POSTS = Number(process.env.MIN_COMPANY_POSTS || 3); // fewer -> noindex, no sitemap
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 1000); // server uses a fixed LIMIT 1000; offset is the SQL OFFSET
const SKIP_REFRESH = process.env.SKIP_REFRESH === '1';
const POST_PAGES = process.env.POST_PAGES === '1'; // standalone /post/{n}/ pages (only if post IDs are stable across builds)

if (!KEY) { console.error('BUILD_KEY environment variable is required'); process.exit(1); }

// ---------- helpers ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
// `label` is what gets logged on failure, so the key never ends up in logs.
async function call(p, { method = 'GET', label = p, tries = 4, timeout = 120000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const init = { method, signal: AbortSignal.timeout(timeout) };
      if (method === 'POST') { init.headers = { 'content-type': 'application/json' }; init.body = '{}'; }
      const r = await fetch(API + p, init);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text();
      try { return JSON.parse(t); } catch { return t; }
    } catch (e) {
      if (i === tries - 1) throw new Error(`${label}: ${e.message}`);
      await sleep(2000 * (i + 1)); // also covers cold starts
    }
  }
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n || 0).toLocaleString('ko-KR');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
// Companies are identified by NAME (company IDs are not stable). The slug is the name itself when it is
// URL/file safe, otherwise a sanitized prefix plus a short hash of the name, so it never depends on build order.
const normName = s => String(s ?? '').normalize('NFC').trim();
const slugOf = name => {
  const clean = name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '');
  if (clean === name && name.length <= 60) return name;
  return `${(clean || 'x').slice(0, 40)}-${createHash('sha1').update(name).digest('hex').slice(0, 6)}`;
};
const encPath = r => r.split('/').map(encodeURIComponent).join('/'); // route -> URL path
const cUrl = (root, slug) => `${root}company/${encodeURIComponent(slug)}/`;
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // KST

// ---------- data ----------
async function fetchPosts() {
  const seen = new Set(), posts = [];
  // The server's default offset is not 0, so every call (including the first) passes offset explicitly.
  const page = off => call(`/api/curtain/build/${encodeURIComponent(KEY)}?offset=${off}`, { label: `build?offset=${off}` });
  const offsets = Array.from({ length: Math.ceil(MAX_POSTS / PAGE_SIZE) }, (_, i) => i * PAGE_SIZE);
  for (let i = 0; i < offsets.length; i += CONCURRENCY) {
    const batch = offsets.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map(page));
    let done = false;
    res.forEach((items, k) => {
      if (!Array.isArray(items)) throw new Error(`offset=${batch[k]}: unexpected response`);
      for (const p of items) if (!seen.has(p.n)) { seen.add(p.n); posts.push(p); }
      if (items.length < PAGE_SIZE) done = true; // last page
    });
    if (done) break;
  }
  if (!posts.length) throw new Error('build API returned no posts (check BUILD_KEY / refresh)');
  return posts.slice(0, MAX_POSTS);
}

// ---------- styles ----------
const CSS = `
:root{color-scheme:light dark;--bg:#f7f6f9;--fg:#1d1a22;--mut:#6a6573;--card:#fff;--line:#e4e0ea;--ac:#7a2f68;--ac-soft:#f1e3ee;--bar:#b9689f}
@media (prefers-color-scheme:dark){:root{--bg:#141118;--fg:#ece8f0;--mut:#a39cae;--card:#1c1822;--line:#2e2836;--ac:#e0a3d4;--ac-soft:#2b1f29;--bar:#a4508f}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.7 "Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif}
a{color:var(--ac);text-decoration:none}a:hover{text-decoration:underline}
a:focus-visible,summary:focus-visible{outline:2px solid var(--ac);outline-offset:2px;border-radius:4px}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header.top{border-bottom:1px solid var(--line);background:var(--card)}
header.top .wrap{display:flex;gap:20px;align-items:baseline;flex-wrap:wrap;padding-top:14px;padding-bottom:14px}
.brand{font-weight:800;font-size:18px;color:var(--fg);margin-right:auto}
nav.main a{color:var(--mut);font-size:15px;margin-left:16px}nav.main a[aria-current=page]{color:var(--ac);font-weight:700}
main{padding:28px 0 56px}
h1{font-size:28px;line-height:1.3;margin:0 0 8px}
h2{font-size:18px;margin:36px 0 12px}
.lead{color:var(--mut);margin:0 0 20px}
.stats{display:flex;gap:28px;flex-wrap:wrap;margin:18px 0 6px}
.stats b{display:block;font-size:28px;line-height:1.2}.stats span{color:var(--mut);font-size:14px}
.bars{list-style:none;margin:0;padding:0}
.bars a{display:grid;grid-template-columns:minmax(72px,170px) 1fr 56px;gap:12px;align-items:center;padding:6px 0;color:var(--fg)}
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
.perma{margin:0;padding:0 16px 14px;font-size:13px}
.pager{display:flex;gap:16px;justify-content:center;align-items:center;margin:22px 0 0;font-size:15px}
.pager span{color:var(--mut)}
.more{margin-top:14px}.note{color:var(--mut);font-size:14px}
.crumbs{font-size:14px;color:var(--mut);margin-bottom:10px}
footer{border-top:1px solid var(--line);color:var(--mut);font-size:13px;padding:20px 0 40px}
@media (max-width:520px){.bars a{grid-template-columns:96px 1fr 48px;gap:8px}h1{font-size:24px}}
`;

// ---------- templates ----------
let ICONS = []; // [file, rel, type] for icon files found in ./public
function page({ depth = 0, route, title, desc, body, nav = '', noindex = false, root }) {
  root = root ?? (depth ? '../'.repeat(depth) : './');
  const full = title === NAME ? NAME : `${title} - ${NAME}`;
  const links = [['', '홈', 'home'], ['feed/', '최신 글', 'feed'], ['companies/', '회사', 'companies'], ['topics/', '주제', 'topics']]
    .map(([h, l, k]) => `<a href="${root}${h}"${nav === k ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(full)}</title>
<meta name="description" content="${esc(clip(desc, 150))}">
${noindex ? '<meta name="robots" content="noindex,follow">\n' : `<link rel="canonical" href="${esc(SITE + '/' + encPath(route))}">\n`}<meta property="og:type" content="website">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(clip(desc, 150))}">
<link rel="stylesheet" href="${root}style.css">
${ICONS.map(([f, rel, type]) => `<link rel="${rel}"${type ? ` type="${type}"` : ''} href="${root}${f}">`).join('\n')}
</head>
<body>
<header class="top"><div class="wrap"><a class="brand" href="${root}">${esc(NAME)}</a><nav class="main">${links}</nav></div></header>
<main><div class="wrap">
${body}
</div></main>
<footer><div class="wrap">데이터 갱신: ${today} (KST)</div></footer>
</body>
</html>
`;
}

function pager(root, base, p, pages) {
  if (pages < 2) return '';
  const u = n => `${root}${base ? encPath(base) + '/' : ''}${n === 1 ? '' : n + '/'}`;
  const a = (n, label, rel) => `<a href="${u(n)}"${rel ? ` rel="${rel}"` : ''}>${label}</a>`;
  return `<nav class="pager" aria-label="페이지 이동">${p > 1 ? a(1, '« 처음') + a(p - 1, '‹ 이전', 'prev') : ''}<span>${p} / ${pages}</span>${p < pages ? a(p + 1, '다음 ›', 'next') + a(pages, '끝 »') : ''}</nav>`;
}

const postHtml = (p, root) => {
  const c = p.cs ? `<a href="${cUrl(root, p.cs)}">${esc(p.cp)}</a>` : esc(p.cp);
  const t = p.cid != null ? `<a href="${root}topic/${p.cid}/">${esc(p.cn)}</a>` : esc(p.cn);
  const link = POST_PAGES ? `<p class="perma"><a href="${root}post/${p.n}/">이 글만 보기</a></p>` : '';
  return `<article class="post" id="p-${p.n}"><details><summary><span class="t">${esc(p.t)}</span>
<span class="meta"><span>${c}</span><span>${t}</span><span>${esc(p.nn)}</span><time datetime="${esc(p.d)}">${esc(p.d)}</time></span></summary>
<div class="body">${esc(p.b)}</div>${link}</details></article>`;
};
const barRow = (href, label, count, max) =>
  `<li><a href="${href}"><span class="n">${esc(label)}</span><span class="bar" style="--w:${Math.max(1, Math.round(count / max * 100))}%"></span><span class="c">${num(count)}</span></a></li>`;

// ---------- build ----------
async function main() {
  console.log('API:', API);
  let latest = null;
  if (!SKIP_REFRESH) {
    latest = Number(await call('/api/curtain/build/refresh', { method: 'POST', tries: 2, timeout: 300000 }));
    console.log('refreshed, latest post number:', latest);
  }
  const posts = await fetchPosts();
  const chart = await call('/api/curtain/chart').catch(e => { console.warn('chart unavailable:', e.message); return {}; });
  console.log('posts fetched:', posts.length);
  if (posts.length < MAX_POSTS) console.warn(`expected ${MAX_POSTS} posts, got ${posts.length}`);
  if (latest != null && posts[0].n !== latest) console.warn(`newest post ${posts[0].n} differs from refresh result ${latest}`);

  // group (posts are newest first, so the first name seen is the current one)
  const companies = new Map(), topics = new Map();
  for (const p of posts) {
    p.cp = normName(p.cp);
    if (p.cp) {
      let c = companies.get(p.cp);
      if (!c) companies.set(p.cp, c = { slug: slugOf(p.cp), name: p.cp, posts: [] });
      p.cs = c.slug;
      c.posts.push(p);
    }
    if (p.cid != null) {
      let t = topics.get(p.cid);
      if (!t) topics.set(p.cid, t = { id: p.cid, name: p.cn, posts: [] });
      t.posts.push(p);
    }
  }
  const compList = [...companies.values()].sort((a, b) => b.posts.length - a.posts.length);
  const topicList = [...topics.values()].sort((a, b) => b.posts.length - a.posts.length);
  const compTotal = new Map((chart.comp || []).map(c => [normName(c.cpn), c.cpc]));  // overall counts, matched by name (best effort)
  const topicTotal = new Map((chart.topic || []).map(t => [t.cnn, t.cnc]));
  const total = chart.total || {};
  const maxC = Math.max(1, ...compList.map(c => c.posts.length));
  const newest = posts[0].d;

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  // files in ./public are copied to the site root as-is (e.g. the Search Console verification file)
  await cp('public', OUT, { recursive: true }).catch(e => { if (e.code !== 'ENOENT') throw e; });
  for (const [f, rel, type] of [['favicon.ico', 'icon', null], ['favicon.svg', 'icon', 'image/svg+xml'], ['favicon.png', 'icon', 'image/png'], ['apple-touch-icon.png', 'apple-touch-icon', null]])
    if (await stat(path.join(OUT, f)).then(() => true, () => false)) ICONS.push([f, rel, type]);
  await writeFile(path.join(OUT, 'style.css'), CSS.trim() + '\n');
  await writeFile(path.join(OUT, '.nojekyll'), '');

  const urls = [];
  const write = async (route, html, lastmod, indexable = true) => {
    const file = path.join(OUT, route.endsWith('.html') ? route : path.join(route, 'index.html'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html);
    if (indexable) urls.push([route, lastmod]);
  };
  // paginated listing: base 'feed' -> feed/, feed/2/, feed/3/ ...
  async function paged(base, items, build) {
    const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    for (let p = 1; p <= pages; p++) {
      const route = `${base}/${p === 1 ? '' : p + '/'}`;
      const depth = route.split('/').filter(Boolean).length;
      const root = '../'.repeat(depth);
      const r = build({ slice: items.slice((p - 1) * PER_PAGE, p * PER_PAGE), p, pages, root, sfx: p > 1 ? ` (${p}페이지)` : '', pg: pager(root, base, p, pages) });
      await write(route, page({ depth, route, ...r }), r.lastmod, !r.noindex);
    }
  }

  // home
  await write('', page({
    route: '', title: NAME, nav: 'home',
    desc: `최신 글 ${num(posts.length)}개를 회사별·주제별로 모아봅니다. 전체 ${num(total.tc)}개 글, 마지막 글 ${total.tmd || newest}.`,
    body: `<h1>${esc(NAME)}</h1>
<p class="lead">최신 글 ${num(posts.length)}개를 회사별·주제별로 모아봅니다.</p>
<div class="stats"><div><b>${num(total.tc || posts.length)}</b><span>전체 글</span></div><div><b>${num(companies.size)}</b><span>회사 (최신 글 기준)</span></div><div><b>${esc(total.tmd || newest)}</b><span>마지막 글</span></div></div>
<h2>글이 많은 회사 <span class="note">최신 ${num(posts.length)}개 기준</span></h2>
<ul class="bars">${compList.slice(0, 15).map(c => barRow(cUrl('./', c.slug), c.name, c.posts.length, maxC)).join('\n')}</ul>
<p class="more"><a href="companies/">회사 전체 보기</a></p>
<h2>주제</h2>
<ul class="chips">${topicList.map(t => `<li><a class="chip" href="topic/${t.id}/">${esc(t.name)}<small>${num(t.posts.length)}</small></a></li>`).join('')}</ul>
<h2>최신 글</h2>
${posts.slice(0, 10).map(p => postHtml(p, './')).join('\n')}
<p class="more"><a href="feed/">최신 글 더 보기</a></p>`
  }), newest);

  await paged('feed', posts, ({ slice, root, sfx, pg }) => ({
    title: '최신 글' + sfx, nav: 'feed', lastmod: slice[0]?.d,
    desc: `가장 최근에 올라온 글 ${num(posts.length)}개${sfx}.`,
    body: `<h1>최신 글${esc(sfx)}</h1><p class="lead">제목을 누르면 본문이 펼쳐집니다.</p>
${slice.map(p => postHtml(p, root)).join('\n')}${pg}`
  }));

  await paged('companies', compList, ({ slice, root, sfx, pg }) => ({
    title: '회사 목록' + sfx, nav: 'companies', lastmod: newest,
    desc: `최신 글에 등장한 ${num(companies.size)}개 회사, 글 수 순${sfx}.`,
    body: `<h1>회사 목록${esc(sfx)}</h1><p class="lead">최신 ${num(posts.length)}개 글 기준, 글이 많은 순서입니다.</p>
<ul class="bars">${slice.map(c => barRow(cUrl(root, c.slug), c.name, c.posts.length, maxC)).join('\n')}</ul>${pg}`
  }));

  for (const c of compList) {
    const thin = c.posts.length < MIN_COMPANY_POSTS, all = compTotal.get(c.name);
    await paged(`company/${c.slug}`, c.posts, ({ slice, root, sfx, pg }) => ({
      title: `${c.name} 글 모음` + sfx, noindex: thin, lastmod: c.posts[0].d,
      desc: `${c.name}의 최신 글 ${num(c.posts.length)}개. 최근 글: ${clip(c.posts[0].t, 60)}`,
      body: `<div class="crumbs"><a href="${root}companies/">회사</a></div>
<h1>${esc(c.name)}${esc(sfx)}</h1>
<p class="lead">최신 글 ${num(c.posts.length)}개${all ? ` · 전체 ${num(all)}개` : ''} · 마지막 글 ${esc(c.posts[0].d)}</p>
${slice.map(p => postHtml(p, root)).join('\n')}${pg}`
    }));
  }

  await write('topics/', page({
    depth: 1, route: 'topics/', title: '주제', nav: 'topics',
    desc: `글 주제 ${topicList.length}개와 글 수.`,
    body: `<h1>주제</h1><p class="lead">최신 ${num(posts.length)}개 글 기준입니다.</p>
<ul class="chips">${topicList.map(t => `<li><a class="chip" href="../topic/${t.id}/">${esc(t.name)}<small>${num(t.posts.length)}</small></a></li>`).join('')}</ul>`
  }), newest);
  for (const t of topicList) {
    const all = topicTotal.get(t.name);
    await paged(`topic/${t.id}`, t.posts, ({ slice, root, sfx, pg }) => ({
      title: `${t.name} 글 모음` + sfx, lastmod: t.posts[0].d,
      desc: `${t.name} 주제의 최신 글 ${num(t.posts.length)}개. 최근 글: ${clip(t.posts[0].t, 60)}`,
      body: `<div class="crumbs"><a href="${root}topics/">주제</a></div>
<h1>${esc(t.name)}${esc(sfx)}</h1>
<p class="lead">최신 글 ${num(t.posts.length)}개${all ? ` · 전체 ${num(all)}개` : ''} · 마지막 글 ${esc(t.posts[0].d)}</p>
${slice.map(p => postHtml(p, root)).join('\n')}${pg}`
    }));
  }

  if (POST_PAGES) {
    for (const p of posts) {
      await write(`post/${p.n}/`, page({
        depth: 2, route: `post/${p.n}/`, title: p.t, desc: p.b || p.t,
        body: `<div class="crumbs"><a href="../../feed/">최신 글</a></div><h1>${esc(p.t)}</h1>
<p class="note">${p.cs ? `<a href="${cUrl('../../', p.cs)}">${esc(p.cp)}</a>` : esc(p.cp)} · ${p.cid != null ? `<a href="../../topic/${p.cid}/">${esc(p.cn)}</a>` : esc(p.cn)} · ${esc(p.nn)} · <time datetime="${esc(p.d)}">${esc(p.d)}</time></p>
<div class="post"><div class="body">${esc(p.b)}</div></div>`
      }), p.d);
    }
  }

  // 404 uses absolute paths because GitHub Pages serves it at any depth
  await write('404.html', page({
    route: '404.html', title: '페이지를 찾을 수 없습니다', noindex: true, root: BASE_PATH + '/', desc: '요청한 페이지가 없습니다.',
    body: `<h1>페이지를 찾을 수 없습니다</h1><p class="lead">글이 오래되어 목록에서 빠졌을 수 있어요. <a href="${BASE_PATH}/">홈</a>에서 다시 찾아보세요.</p>`
  }), '', false);

  if (urls.length > 50000) console.warn('sitemap exceeds 50,000 URLs; truncating');
  await writeFile(path.join(OUT, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.slice(0, 50000).map(([r, m]) => `<url><loc>${esc(SITE + '/' + encPath(r))}</loc>${m ? `<lastmod>${esc(m)}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n');
  await writeFile(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`done: ${urls.length} indexable URLs, ${companies.size} companies, ${topics.size} topics`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
