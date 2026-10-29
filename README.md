# 커튼 모아보기

서버의 "최신 만 건" 빌드 API로 `docs/` 에 완성된 정적 HTML을 만듭니다. 사이트: https://powerfulh.github.io/curtain-community

## 빌드가 하는 일
1. `POST /api/curtain/build/refresh` 로 서버가 최신 1만 건을 적재하게 하고
2. `GET /api/curtain/build/{key}?offset=` 을 0, 1000, 2000 … 으로 천 건씩 읽고 (최신순 그대로 사용. offset 기본값이 0이 아니라서 첫 호출도 `offset=0` 을 명시합니다)
3. `GET /api/curtain/chart` 로 전체 기준 숫자(전체 글 수, 회사·주제별 전체 건수)를 가져옵니다.
매번 최신 1만 건만으로 사이트를 새로 만들고, 이전 글은 누적하지 않습니다. 요청 수는 약 12회(refresh 1 + 조회 10 + chart 1)입니다.

## 사용법
```bash
BUILD_KEY=키 node build.mjs      # Node 18+, 의존성 없음
npx serve docs                   # 로컬 미리보기
```
환경변수: `BUILD_KEY`(필수), `SITE_URL`, `API_BASE`, `PER_PAGE`(50), `MAX_POSTS`(10000), `CONCURRENCY`(3), `MIN_COMPANY_POSTS`(3), `PAGE_SIZE`(1000), `SKIP_REFRESH=1`, `POST_PAGES=1`

## 배포 (GitHub Actions)
1. Settings → Secrets and variables → Actions 에 `BUILD_KEY` 시크릿 추가
2. Actions 탭에서 `build-site` 를 수동 실행 (이후 매일 06:00 KST 자동)
3. 첫 실행 후 Settings → Pages → Branch `pages`, 폴더 `/docs`
4. Search Console 에 `https://powerfulh.github.io/curtain-community/sitemap.xml` 제출

`docs/` 는 `main` 에 커밋하지 않고(`.gitignore`), 매 빌드마다 `pages` 브랜치를 단일 커밋으로 덮어씁니다. 매일 전체가 바뀌는 사이트라서 이력이 쌓여 저장소가 커지는 것을 막기 위해서입니다.

## 정적 파일 (`public/`)
`public/` 안의 파일은 빌드 때마다 사이트 루트로 그대로 복사됩니다. 빌드가 `docs/` 를 매번 비우기 때문에, 서치콘솔 소유권 확인 파일(`googlee2c95d9060f48724.html`)도 여기에 둡니다. 배포 후 `https://powerfulh.github.io/curtain-community/googlee2c95d9060f48724.html` 로 열리는지 확인하세요.

파비콘: `public/` 에 `favicon.ico`, `favicon.svg`, `favicon.png`, `apple-touch-icon.png` 중 있는 파일을 두면 모든 페이지의 `<head>` 에 자동으로 링크됩니다. `public/` 이나 `build.mjs` 를 `main` 에 푸시하면 워크플로가 자동으로 다시 빌드합니다.

## 페이지
`/` · `/feed/` `/feed/2/` … · `/companies/` · `/company/{회사ID}/` · `/topics/` · `/topic/{카테고리ID}/` · `404.html` · `sitemap.xml` · `robots.txt`
목록은 모두 50개씩 페이지로 나뉘고, JS 없이 일반 링크로만 이동합니다. 글 3개 미만인 회사 페이지는 `noindex` 이며 sitemap 에서 빠집니다.

## 알아둘 점
- 글 ID는 "한 빌드 내에서만 유일"이라고 해서 글 단독 URL은 기본으로 끄고, 글은 목록 안에서 펼쳐 봅니다. 글 ID가 빌드 간에도 유지된다면 `POST_PAGES=1` 로 `/post/{id}/` 를 켤 수 있습니다.
- 서버의 limit(1000)과 `PAGE_SIZE` 가 다르면 건너뛰는 글이 생기니 같게 유지하세요. 수집 글이 기대(1만 개)보다 적으면 빌드 로그에 경고가 나옵니다.
- 인증 키는 로그와 오류 메시지에 출력되지 않습니다. 핵심 API가 실패하거나 비어 있으면 빌드가 실패해 기존 사이트가 유지됩니다.
