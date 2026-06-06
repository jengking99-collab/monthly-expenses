# 월 지출관리 프로젝트 세션 요약

> 마지막 업데이트: 2026-06-06 (V2.3_Web)

---

## 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **경로** | `D:\Claude_Code\monthly_expenses` |
| **목적** | 매월 고정/변동 수입·지출 관리, 통장별 잔액 실시간 추적 |
| **스택** | React 19 + Vite 7 + Recharts + xlsx + Electron 32 |
| **현재 버전** | **V2.3_Web** (`package.json` version: `2.3.0`) |
| **웹 배포** | https://monthly-expenses-navy.vercel.app/ |
| **GitHub** | jengking99-collab/monthly-expenses |
| **Electron 배포** | `releases/v15/월지출관리_v1.5.exe` (포터블, 마지막 빌드) |

---

## 운영 인프라

| 서비스 | 역할 | 플랜 | 상태 |
|--------|------|------|------|
| **Vercel** | 웹 앱 호스팅/CDN | Hobby (무료) | 24/7 ON |
| **Firebase Firestore** | 기기 간 동기화 DB | Spark (무료) | 24/7 ON |
| **GitHub** | 코드 저장소 | Free | 24/7 ON |
| 로컬 Vite dev | 개발 서버 | - | 수동 시작 |

---

## 프로젝트 파일 구조

```
monthly_expenses/
├── src/
│   ├── App.jsx                     ← 전체 앱 (단일 파일, 동기화 로직 포함)
│   ├── firebase.js                 ← Firebase 초기화 (VITE_FIREBASE_* env vars)
│   ├── main.jsx                    ← React 진입점 + SW 등록
│   ├── index.css                   ← 최소 리셋 CSS
│   └── assets/                     ← Vite scaffold 잔여 (미사용)
├── electron/
│   ├── main.cjs                    ← Electron 메인 프로세스
│   └── preload.cjs                 ← Electron preload
├── public/
│   ├── favicon.svg                 ← 앱 아이콘
│   ├── manifest.json               ← PWA 매니페스트
│   └── sw.js                       ← 서비스 워커 (cache-first/network-first)
├── .env.local                      ← Firebase 설정 (gitignore, 로컬 전용)
├── build-electron.mjs              ← Electron 빌드 스크립트
├── vite.config.js                  ← Vite 7, base: './'(Electron) vs '/'(Web)
├── eslint.config.js
├── package.json                    ← version: 2.3.0
├── PROJECT_SUMMARY.md              ← 이 파일
├── 월지출앱_배포개발가이드.md         ← Vercel/PWA/모바일 배포 가이드
├── dev.log                         ← 개발 서버 로그 (자동생성, gitignore)
└── releases/
    └── v15/                        ← V1.5.0 Electron 배포본 (마지막 빌드)
        └── 월지출관리_v1.5.exe
```

---

## 웹 기능 (V1.5.0 ~ V2.3_Web)

### PWA (Progressive Web App)
- `public/manifest.json`: 앱 이름, 아이콘, 테마색, standalone 모드
- `public/sw.js`: 서비스 워커 (캐시명 `mexp-v1.5`)
  - Navigation 요청: network-first → fallback to cached index.html
  - Static assets: cache-first
  - `skipWaiting()` + `clients.claim()` 즉시 활성화

### 반응형 레이아웃 (모바일)
- `useMobile()` 훅: 768px 브레이크포인트, resize 이벤트 감지
- 모바일 사이드바: `position:fixed`, `translateX(-100%/0)` 슬라이드 드로어 + backdrop
- 상단 햄버거(☰) 버튼 + 우상단 모바일 액션 버튼(🏦 잔액설정, + 추가)
- 요약 카드 2×2 그리드 (`flex wrap`, `calc(50% - 5px)`)

### 월 지출관리 테이블 (DailyTab)
- **단일 스크롤 컨테이너**: 루트 div를 `overflow:auto` + `flex:1` + `minHeight:0`으로 설정 → 가로/세로 모두 처리
- **헤더 고정** (`position:sticky top:0`): 단일 컨테이너 내에서 `<thead>` sticky 동작
- **날짜 열 고정** (`position:sticky left:0`): 전체 모드에서 날짜 열 고정, `zIndex` 계층 조정
- **전체/요약 토글**: `compactDaily` 상태로 전체(10컬럼) ↔ 요약(날짜·지출내역·일지출·추가 4컬럼) 전환
- **최소 너비**: 전체 모드 `minWidth:1026`, 요약 모드 `minWidth:0` → 화면 축소 시 가로 스크롤 활성화

### 고정항목 관리 (FixedTab)
- **CSS grid → `<table>` 전환**: 열 공유 축이 없는 grid row 방식에서 native `<table>`로 전환
- **헤더 고정** (`position:sticky top:0`): `<thead>` sticky 동작
- **날짜(일) 열 고정** (`position:sticky left:0`): 첫 번째 열 고정, 행 배경색과 z-index 조정
- **최소 너비**: `minWidth:538` → 화면 축소 시 가로 스크롤 활성화

### JSON 백업/복원
- `📤 전체 내보내기(JSON)`: 전체 localStorage → `.json` 파일 다운로드
- `📥 전체 가져오기(JSON)`: `.json` 파일 → 전체 데이터 복원 (confirm 확인 후)

### Firebase 기기 간 동기화
- `src/firebase.js`: `VITE_FIREBASE_*` env vars 기반 초기화 (설정 없으면 graceful skip)
- 동기화 키: 사용자 정의 비밀 키 → `localStorage("mexp_sync_key")` 영구 저장
- **데이터 방향**:

| 방향 | 방식 |
|------|------|
| 이 기기 → Firestore | 자동 (데이터 변경 후 5초 debounce) |
| Firestore → 이 기기 | 앱 로드 시 자동 (silent) + 수동 버튼 |

- Firestore 구조: `sync/{syncKey}` → `{ fixed_base, data, updatedAt }`

---

## localStorage 키

| 키 | 저장 방식 | 내용 |
|----|-----------|------|
| `mexp_v1_fixed_base` | 수동 (💾 기본 저장) | 고정항목 버전 이력 `[{ effectiveFrom, items }]` |
| `mexp_v1_data` | 자동 (변경 즉시) | 월별 지출 전체 데이터 |
| `mexp_v1_meta` | 자동 | 마지막 선택 연도/월 |
| `mexp_sync_key` | 연결 시 1회 저장 | Firebase 동기화 키 (앱 재시작 후에도 유지) |

---

## 컴포넌트 목록

### 공유 컴포넌트

| 컴포넌트 | 역할 |
|----------|------|
| `Btn` | 버튼 (variant: default/primary/green/amber/purple/teal/red) |
| `XBtn` | 닫기(✕) 버튼 |
| `BankBadge` | KB/신한 배지 |
| `Toast` | 하단 우측 알림 (2.8초 자동 소멸) |
| `CntBadge` | 항목 수 배지 |
| `PulseDot` | 오늘 날짜 파란 점 |
| `WeekDay` | 요일 표시 (일=빨강, 토=파랑) |
| `NumCell` / `BalCell` | 테이블 셀 |
| `CommaInput` | 숫자 입력 + 자동 쉼표 |

### 페이지 컴포넌트

| 컴포넌트 | 역할 |
|----------|------|
| `App` | 상태 총괄, CRUD, Firebase 동기화 로직 |
| `Sidebar` | 년도/월 선택 + 액션 버튼 (동기화 상태 뱃지 포함) |
| `SyncModal` | 동기화 키 입력, 상태 표시, pull 버튼 |
| `SummaryCard` | KB잔액/신한잔액/총지출/총수입 |
| `DailyTab` | 날짜별 잔액 추적 |
| `FixedTab` | 고정항목 편집 |
| `AddModal` | 항목 추가 (수입/지출/이체) |
| `EditRowModal` | 수동 항목 수정 |
| `BankModal` | 잔액 기준일 설정 |
| `StatsOverlay` | 년/월 통계 (PieChart + LineChart) |

---

## Electron 구성 (데스크탑 앱)

```javascript
// electron/main.cjs
// exe 옆의 data/ 폴더에 userData 고정 (포터블 앱)
app.setPath('userData', path.join(path.dirname(app.getPath('exe')), 'data'));

// electron/preload.cjs
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  openCalculator: () => ipcRenderer.send('open-calculator'),
});
// → window.electronAPI?.openCalculator?.() : 웹에서는 안전하게 no-op
```

---

## 데이터 모델

```javascript
// mexp_v1_data
{
  "2026-06": {
    rows: [
      { id, day, asset, name, expense, income, memo, isSub, isManual },
      { id, day, name, fromAsset, toAsset, amount, isTransfer:true }  // 이체
    ],
    bank: { kb, sh, date }  // date: "YYYY-MM-DD"
  }
}

// mexp_v1_fixed_base
[{ effectiveFrom: "YYYY-MM", items: [{ id, day, name, asset, amount, type }] }]

// Firestore sync/{key}
{ fixed_base: JSON, data: JSON, updatedAt: Timestamp }
```

---

## 빌드 명령어

```bash
npm run dev              # 개발 서버 (웹)
npm run build            # 웹 프로덕션 빌드 (Vercel 자동 배포)
npm run electron:build   # Electron exe 빌드
git push origin master   # → Vercel 자동 재배포 트리거
```

### Electron vs Web 빌드 분기

```javascript
// vite.config.js
base: process.env.VITE_ELECTRON === '1' ? './' : '/'

// build-electron.mjs
process.env.VITE_ELECTRON = '1';  // 최상단에서 설정
```

---

## 주요 의존성

```json
"dependencies": {
  "firebase": "^12.14.0",
  "react": "^19.2.6",
  "react-dom": "^19.2.6",
  "recharts": "^3.8.1",
  "xlsx": "^0.18.5"
},
"devDependencies": {
  "@vitejs/plugin-react": "^5.0.0",
  "electron": "^32.3.3",
  "electron-builder": "^25.1.8",
  "vite": "^7.0.0"
}
```

> **Vite 7 사용 이유**: Vite 8의 Rolldown 번들러가 Firebase subpath exports(`firebase/firestore`)를 처리하지 못하는 이슈로 Vite 7(Rollup)로 고정

---

## 버전 이력

| 버전 | 주요 변경 |
|------|-----------|
| V0.2 | 초기 구현, XLSX import/export, 고정항목, 통계 |
| V1.0 | 이월 자동 계산, 자동저장, 실시간 잔액 |
| V1.2 | LedgerTab 제거, 고정항목 버전 이력, CommaInput |
| V1.3 | 수동 항목 수정, 일별 엑셀, BankModal 날짜 지정 |
| V1.4 | userData 경로 고정, 통계 개편 (년/월 분리) |
| V1.5.0 | 이체 기능, 웹 배포 준비 (`releases/v15/`) |
| V1.5.0_Web | GitHub + Vercel 배포, PWA, 반응형, JSON 백업 |
| V1.6.0 | Firebase Firestore 동기화 구현 |
| **V2.0_Web** | **앱 로드 시 자동 pull, Vite 7 고정, 버전 표기 통일** |
| **V2.1_Web** | **모바일 UI 개선: 컴팩트 요약카드, 상단 액션 버튼, 슬라이드 드로어 사이드바** |
| **V2.2_Web** | **가로 스크롤(minWidth 기법), 전체/요약 토글, FixedTab 항목명 표시 수정** |
| **V2.3_Web** | **헤더·날짜열 고정(sticky), 단일 scroll 컨테이너, FixedTab CSS grid → table 전환** |

---

## 알려진 이슈 / 주의사항

| 항목 | 내용 |
|------|------|
| 이월 조건 | 이전달에 `🏦 잔액 설정` 필요. 미설정 시 이월 = 0 |
| 고정항목 변경 | `💾 기본 저장` 필수. 누르지 않으면 다음 실행 시 이전 데이터로 복원 |
| Electron 동기화 | Firebase 동기화는 웹 전용 (Electron은 JSON 백업 사용) |
| 동기화 키 | 기기당 1회 입력. localStorage에 영구 저장. 연결 해제 시 삭제 |
| Firestore 규칙 | `allow read, write: if true` — 보안은 syncKey 비공개에 의존 |
| Firebase 무료 한도 | 읽기 50K/일, 쓰기 20K/일 — 개인 사용 초과 없음 |
