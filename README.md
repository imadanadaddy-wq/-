# KNUH 야식·조식 신청 대시보드

칠곡경북대학교병원 야식/조식 신청 시스템.

## 역할

- **신청자**: 야식·조식 메뉴를 등록 (여러 날짜 한번에 신청 가능)
- **액팅**: 야식 또는 조식 선택 → 날짜별 신청 목록 확인 → 카드 탭 → **사번 바코드 + 메뉴** 표시 → 폰 그대로 들고 가서 수령
- **관리자**: 신청자에게 노출되는 메뉴 항목을 추가·숨김·삭제 (사번 `22807` 김덕근만)

## 의존성

- **Node.js 22.13 이상** (Node 내장 `node:sqlite` 모듈 사용 — 네이티브 컴파일 불필요)
- **express** (유일한 npm 의존성)

## 기능

### 신청자
- 야식/조식 탭 → **앞으로 7일** 중 원하는 날짜를 다중 선택 (오늘/내일/3일 빠른 버튼)
- 관리자가 등록한 메뉴 칩에서 탭하여 선택 or 직접 입력 (자유 텍스트)
- 한 번에 여러 날짜 일괄 신청 (해당 일자에 기존 신청 있으면 자동 수정)
- 내 신청 목록에서 날짜별로 확인 및 취소

### 액팅
- **야식/조식 먼저 선택** (통합 뷰 없음)
- 날짜 칩으로 원하는 날(보통 오늘) 선택, 그 조건의 대기 신청만 표시
- 카드 탭 → 직원 이름 + 사번 + 메뉴 + **Code128 바코드** 표시 → 수령 완료 처리
- 15초마다 자동 갱신

### 관리자 (사번 22807만)
- 야식·조식 메뉴 탭 → 항목 목록
- 메뉴 추가 / 숨기기(임시 비활성화) / 삭제
- 신청자 화면에 즉시 반영 (다음 갱신 사이클)
- 기본 시드: `컵라면, 김밥, 햄버거, 죽, 샌드위치, 라면` / `빵+우유, 죽, 주먹밥, 시리얼, 샌드위치, 토스트`

## 로컬 실행

```bash
npm install
npm start
# http://localhost:3000
```

데이터는 기본적으로 `./data/knuh.db`. `DATABASE_PATH` 환경변수로 변경 가능.

## Railway 배포

### 1) GitHub 푸시
```bash
git init
git add .
git commit -m "init KNUH meal dashboard"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

### 2) Railway 프로젝트
- https://railway.app → **New Project** → **Deploy from GitHub repo**

### 3) **중요**: Volume 마운트 (데이터 영구 보관)
1. 서비스 → **Settings** → **Volumes** → **+ New Volume**, Mount path `/data`
2. **Variables** → `DATABASE_PATH` = `/data/knuh.db`

이걸 안 하면 재배포 시 SQLite 파일이 사라집니다.

### 4) 도메인
- **Settings** → **Networking** → **Generate Domain**

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | Railway가 자동 주입 |
| `DATABASE_PATH` | `./data/knuh.db` | SQLite 파일 경로 |

## 관리자 추가/변경

`server.js` 상단:
```js
const ADMIN_EMPLOYEE_IDS = new Set(['22807']);
```
사번을 추가하거나 변경 후 푸시하면 됩니다.

## 데이터 모델

- `users` (id, employee_id, name, created_at)
- `meal_orders` (id, user_id, meal_type, menu, **service_date**, status, created_at, picked_up_at, picked_up_by)
  - **고유 인덱스**: `(user_id, service_date, meal_type) WHERE status='pending'` → 같은 날·같은 식사 종류에 pending 1건만
- `menu_items` (id, meal_type, name, sort_order, active, created_at)

기존 DB에서 업그레이드 시 `service_date` 컬럼은 자동 추가됩니다 (`created_at`의 날짜로 백필).

## API 요약

| Method | Path | 설명 |
|---|---|---|
| `POST` | `/api/register` | 등록/갱신 |
| `GET` | `/api/me` | 본인 정보 (`is_admin` 포함) |
| `GET` | `/api/menu-items?meal_type=&include_inactive=` | 메뉴 목록 |
| `POST` | `/api/menu-items` | 메뉴 추가 (관리자) |
| `PATCH` | `/api/menu-items/:id` | 메뉴 수정/숨김 (관리자) |
| `DELETE` | `/api/menu-items/:id` | 메뉴 삭제 (관리자) |
| `POST` | `/api/orders` | 단일 날짜 신청/수정 |
| `POST` | `/api/orders/batch` | 여러 날짜 일괄 신청 |
| `GET` | `/api/orders/my?from=` | 내 신청 (기본: 오늘 이후) |
| `DELETE` | `/api/orders/:id` | 신청 취소 |
| `GET` | `/api/orders/active?meal_type=&date=` | 액팅용 대기 목록 |
| `GET` | `/api/orders/active/summary?days=` | 날짜별 카운트 요약 |
| `POST` | `/api/orders/:id/pickup` | 수령 완료 |
| `POST` | `/api/admin/cleanup` | 7일 전 수령 기록 정리 (관리자) |

인증: `X-Employee-Id` 헤더 (간단 시스템용).

## 바코드

- 클라이언트 사이드 [JsBarcode](https://github.com/lindell/JsBarcode) → **Code128** (사번 그대로)
- 다른 형식 필요 시 `public/app.js`의 `JsBarcode` 호출 `format` 옵션만 변경

## 변경 이력

- **v1.1**: 날짜 기능, 관리자 메뉴 관리, 액팅 화면 야식·조식 분리
- **v1.0**: 초기 버전 (Express + node:sqlite)
