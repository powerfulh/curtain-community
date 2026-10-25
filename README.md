# 커튼 모아보기

`/api/curtain`, `/api/curtain/chart`, `/api/curtain/{company}` 를 **빌드 시점에 호출**해
`docs/` 에 완성된 정적 HTML을 생성합니다. GitHub Pages(`main` 브랜치 `/docs`)로 그대로 서빙하세요.

- 모든 이동은 일반 링크(페이지 전환)이고, 글 제목·본문이 HTML에 이미 들어 있어 크롤러가 바로 읽습니다.
- 다크/라이트는 `prefers-color-scheme` 으로 기기 설정을 따라갑니다. JS 토글은 없습니다.
- 유일한 JS는 피드·회사·주제 페이지의 검색창(없어도 페이지는 완전히 동작)입니다.

## 사용법
```bash
node build.mjs                                   # Node 18+ , 의존성 없음
SITE_URL=https://USER.github.io/REPO node build.mjs   # canonical, sitemap.xml 포함
npx serve docs                                   # 로컬 미리보기
```
환경변수: `API_BASE`, `SITE_URL`, `SITE_NAME`, `OUT_DIR`, `CONCURRENCY`(기본 4), `MAX_COMPANIES`(테스트용)

## 배포
1. 저장소 루트에 이 폴더의 파일을 올리고 한 번 `node build.mjs` 후 `docs/` 를 커밋
2. Settings → Pages → Branch `main`, 폴더 `/docs`
3. `.github/workflows/build.yml` 이 매일 데이터를 갱신해 `docs/` 를 커밋합니다 (수동 실행도 가능)
4. Search Console 에 `https://USER.github.io/REPO/sitemap.xml` 제출

## 생성되는 페이지
`/` 대시보드 · `/feed/` 최신 100개 · `/companies/` · `/company/{회사}/` · `/topics/` · `/topic/{주제}/` · `404.html` · `sitemap.xml` · `robots.txt`

## 알아둘 점
- 회사별 글은 API가 주는 최근 100개까지가 한계입니다. 주제 페이지는 수집된 글(최신 100 + 회사별 목록)에서 만듭니다.
- 글이 없는 회사·주제 페이지는 `noindex` 이며 sitemap에서 빠집니다.
- 수집 실패한 회사는 건너뛰고, 핵심 API가 비어 있으면 빌드를 실패시켜 기존 사이트를 보존합니다.
