# KNUH 야식·조식 신청 대시보드

칠곡경북대학교병원 야식/조식 신청 시스템.
- **신청자**: 야식·조식 메뉴를 등록
- **액팅**: 신청 목록을 확인하고, 각 직원의 카드를 누르면 **사번 바코드 + 메뉴**가 표시되어 모바일로 그대로 들고 내려가서 수령 가능

## 기능

- 사번 + 이름으로 1회 등록 → 다음부터 자동 로그인 (localStorage 기반)
- 역할 선택: **신청자 / 액팅** (언제든 전환 가능)
- 신청자: 야식/조식 탭 선택 → 빠른 메뉴 버튼 또는 자유 입력으로 신청 / 수정 / 취소
- 액팅: 신청 목록을 야식·조식으로 필터링, 카드 탭 → **Code128 바코드** + 직원명 + 사번 + 메뉴 표시, 수령 완료 처리
- 15초마다 자동 갱신 (탭 포커스 복귀 시도 갱신)
- 모바일 다크 테마, 한글 폰트 (Pretendard)

## 로컬 실행

```bash
npm install
npm start
# http://localhost:3000
```

데이터는 기본적으로 `./data/knuh.db` (SQLite)에 저장됩니다.
`DATABASE_PATH` 환경변수로 위치 변경 가능.

## Railway 배포

### 1) GitHub 에 푸시

```bash
git init
git add .
git commit -m "init KNUH meal dashboard"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

### 2) Railway 프로젝트 생성

1. https://railway.app → **New Project** → **Deploy from GitHub repo** → 이 레포 선택
2. 자동으로 빌드/배포가 시작됩니다 (Nixpacks가 Node.js 감지)

### 3) **중요**: SQLite 영구 저장을 위한 Volume 설정

SQLite 파일은 컨테이너 재시작 시 사라지므로 **반드시 Volume을 마운트**해야 합니다.

1. Railway 프로젝트의 서비스 → **Settings** 탭 → **Volumes** 섹션
2. **+ New Volume**:
   - Mount path: `/data`
3. **Variables** 탭에서 환경변수 추가:
   - `DATABASE_PATH` = `/data/knuh.db`
4. 서비스가 자동 재배포됨

### 4) 도메인 발급

- **Settings** → **Networking** → **Generate Domain** → `your-app.up.railway.app` 발급
- 모바일에서 해당 URL 접속 후 홈 화면에 추가하면 앱처럼 사용 가능

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | Railway가 자동 주입 |
| `DATABASE_PATH` | `./data/knuh.db` | SQLite 파일 경로. Railway에선 `/data/knuh.db` 권장 |

## 데이터 모델

- `users` (id, employee_id, name, created_at)
- `meal_orders` (id, user_id, meal_type, menu, status, created_at, picked_up_at, picked_up_by)

같은 사용자가 같은 식사 종류에 대해 가질 수 있는 `pending` 주문은 **1건** (재신청 시 자동 업데이트).
수령 완료된 주문은 7일 후 `POST /api/admin/cleanup` 으로 정리 가능 (수동/크론 호출).

## API

| Method | Path | 설명 |
|---|---|---|
| `POST` | `/api/register` | 등록 또는 정보 갱신 (`{employee_id, name}`) |
| `GET` | `/api/me` | 본인 정보 조회 (auto-login용) |
| `POST` | `/api/orders` | 메뉴 신청/수정 (`{meal_type, menu}`) |
| `GET` | `/api/orders/my` | 내 대기 중 신청 목록 |
| `DELETE` | `/api/orders/:id` | 내 신청 취소 |
| `GET` | `/api/orders/active` | 액팅 뷰: 전체 대기 신청 |
| `POST` | `/api/orders/:id/pickup` | 수령 완료 처리 |
| `POST` | `/api/admin/cleanup` | 7일 전 수령 기록 정리 |

인증은 `X-Employee-Id` 헤더 기반 (가벼운 시스템용 — 필요 시 토큰/세션으로 강화 가능).

## 바코드 형식

- 클라이언트 사이드에서 [JsBarcode](https://github.com/lindell/JsBarcode) 로 **Code128** 생성
- 바코드 내용 = 사번 문자열 그대로 (예: `22807`)
- 만약 병원 스캐너가 다른 형식(EAN-13, Code39 등)을 쓰면 `public/app.js` 의 `format` 옵션만 변경
- 사번에 prefix/suffix가 필요한 경우(`22807` → `EMP22807` 같은 형식) `JsBarcode` 호출의 입력값만 조정

## 향후 확장 아이디어

- 메뉴별 통계 / 자주 신청한 메뉴 자동완성
- 푸시 알림 (PWA + Web Push)
- 부서별 그룹화
- 액팅 인수인계 (담당 액팅 표시)
- 비밀번호 또는 SSO 인증
