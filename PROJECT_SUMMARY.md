# 월 지출관리 프로젝트 세션 요약

> 마지막 업데이트: 2026-06-05 (v1.5.0)

---

## 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **경로** | `D:\Claude_Code\monthly_expenses` |
| **목적** | 매월 고정/변동 수입·지출 관리, 통장별 잔액 실시간 추적 |
| **스택** | React 19 + Vite 8 + Recharts + xlsx + Electron 32 |
| **현재 버전** | **V1.5.0** (`package.json` version: `1.5.0`) |
| **배포 파일** | `releases/v15/월지출관리_v1.5.exe` (포터블) |

---

## 프로젝트 파일 구조

```
monthly_expenses/
├── src/
│   ├── App.jsx                     ← 전체 앱 (1,354줄, 단일 파일)
│   ├── main.jsx                    ← React 진입점
│   ├── index.css                   ← 최소 리셋 CSS
│   ├── App.css                     ← Vite scaffold 잔여 파일 (미사용)
│   └── assets/                     ← Vite scaffold 잔여 폴더 (미사용)
├── electron/
│   ├── main.cjs                    ← Electron 메인 프로세스 (CommonJS)
│   └── preload.cjs                 ← Electron preload (CommonJS)
├── public/
│   ├── favicon.svg                 ← 앱 아이콘
│   └── icons.svg                   ← 아이콘 모음
├── build-electron.mjs              ← 스마트 빌드 스크립트
├── vite.config.js                  ← base: './' 설정 포함
├── eslint.config.js                ← ESLint 설정
├── package.json                    ← version: 1.5.0
├── README.md                       ← 사용법 및 Excel 형식 가이드
├── PROJECT_SUMMARY.md              ← 이 파일
├── 코딩작업.txt                     ← 개발 메모 및 버전별 작업 내역
├── 월지출앱_배포개발가이드.md         ← Vercel/PWA/모바일 배포 가이드 (미적용)
├── dev.log                         ← 개발 서버 로그
└── releases/
    └── v15/                        ← V1.5.0 배포본 ✅ (현재)
        ├── 월지출관리_v1.5.exe
        └── win-unpacked/
```

---

## Electron 구성

### electron/main.cjs

```javascript
const { app, BrowserWindow, dialog, Menu, ipcMain } = require('electron');
const { exec } = require('child_process');

// exe 옆의 data/ 폴더에 저장 (포터블 앱에 적합)
if (!isDev) {
  app.setPath('userData', path.join(path.dirname(app.getPath('exe')), 'data'));
}

// 엑셀 저장: will-download 이벤트로 Save 다이얼로그 표시
// 계산기 열기: ipcMain.on('open-calculator', () => exec('calc.exe'))
// 외부 URL 탐색 차단: will-navigate 이벤트
```

### electron/preload.cjs

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  openCalculator: () => ipcRenderer.send('open-calculator'),
});
```

> `window.electronAPI?.openCalculator?.()` — 웹 환경에서는 안전하게 no-op

---

## 핵심 소스 — App.jsx 구성

### 자산(ASSETS) 상수

```javascript
const ASSETS = [
  "KB국민은행", "신한은행",   // 잔액 추적 대상 (isKb / isSh 판별: 이름에 "국민"/"신한" 포함 여부)
  "KB국민카드", "하나카드", "삼성카드", "카카오뱅크", "삼성 앱카드", "기타"
];
```

> 잔액 투영(`buildBalances`)은 `KB국민은행`, `신한은행` 항목만 집계. 카드 항목은 지출로만 처리됨.

---

### 디자인 토큰

```javascript
const G = {
  bg, bg2, bgc, bgh,          // 배경 계층 (어두운 순)
  bd, bdl,                     // 보더 (일반/연한)
  t1, t2, tm,                  // 텍스트 (밝은→어두운)
  blue, blueDim,               // 강조색
  green, greenDim,             // 수입/긍정
  red, redDim,                 // 지출/경고
  amber, amberDim,             // 수동 항목
  purple, purpleDim,
  teal, tealDim,
};

const css = { app, sidebar, logo, secLbl, main, topbar, sumRow, scard,
              content, tabBar, tblWrap, fiWrap, overlay, modal, statsOv, statsIn };
```

---

### localStorage 키

| 키 | 저장 방식 | 내용 |
|----|-----------|------|
| `mexp_v1_fixed_base` | **수동** (💾 기본 저장 버튼) | 고정항목 버전 이력 `[{ effectiveFrom:"YYYY-MM", items:[...] }]` (v1.2.1~). 구버전은 자동 마이그레이션 |
| `mexp_v1_data` | **자동** (변경 즉시) | 월별 지출 전체 데이터 |
| `mexp_v1_meta` | **자동** | 마지막 선택 연도/월 |

> **데이터 저장 경로** (Electron): exe 옆 `data\Local Storage\leveldb\`  
> v1.4.0~: `app.setPath('userData', ...)` 고정 적용 — 버전이 바뀌어도 같은 폴더 사용 (포터블 앱에 적합)

### 컴포넌트 목록

#### 공유 컴포넌트 (Shared)

| 컴포넌트 | 역할 |
|----------|------|
| `Btn` | 버튼 (variant: default / primary / green / amber / purple / teal / red) |
| `XBtn` | 닫기(✕) 버튼 |
| `BankBadge` | KB/신한 배지 (type: "kb" \| "sh") |
| `Toast` | 하단 우측 알림 메시지 (ok=초록 테두리, error=빨강 테두리, 2.8초 후 자동 소멸) |
| `CntBadge` | 항목 수 배지 |
| `PulseDot` | 오늘 날짜 행의 파란 점 |
| `WeekDay` | 요일 표시 (일=빨강, 토=파랑) |
| `NumCell` | 수입/지출 숫자 테이블 셀 |
| `CommaInput` | 숫자 입력 + 자동 쉼표 표시 컴포넌트 (v1.2.2~) |
| `BalCell` | 잔액 테이블 셀 |

#### 페이지 컴포넌트

| 컴포넌트 | 역할 |
|----------|------|
| `App` | 상태 총괄, CRUD (`addRow` / `updateRow` / `delRow`), Excel I/O (`exportFixedExcel` / `exportDailyExcel`) |
| `Tags` | DailyTab 항목 뱃지. 고정수입=초록, 고정지출=빨강, 수동=노랑(클릭 시 수정모달), 이월=파랑. 수동 항목에만 ✕ 삭제 버튼 |
| `TransferTags` | 이체 항목 뱃지. teal 색상, `이름 KB→신한 금액` 형식. 클릭=수정, ✕=삭제 (v1.5.0~) |
| `Sidebar` | 년도(2020~2040) + 월 선택, 액션 버튼 (고정항목관리 / 내보내기 / 가져오기 / 통계 / 🧮계산기) |
| `SummaryCard` | KB잔액 / 신한잔액 / 총지출 / 총수입 |
| `DailyTab` | 날짜별 잔액 추적. props: `onAddDay` / `onDelManual` / `onEditManual` |
| `FixedTab` | 고정항목 편집 + 💾 기본저장 / 🗑 초기화 버튼 |
| `AddModal` | 항목 추가 폼. 구분: 수입/지출/이체. 이체 선택 시 출금→입금 자산 선택 UI (v1.5.0~) |
| `EditRowModal` | 수동 항목 수정 폼. 이체 행 감지 시 출금/입금 자산 편집 모드로 전환 (v1.5.0~) |
| `BankModal` | 잔액 기준일 설정. 날짜(1~말일) 직접 지정, 기본값=오늘 or 기존 저장일 (v1.3.1~) |
| `StatsOverlay` | 년 통계(월별 수입/지출 추이) / 월 통계(일별 추이, 년+월 독립 선택) 분리. PieChart + LineChart. 내부 상태: `statMonth` |

---

## 데이터 모델

```javascript
// mexp_v1_fixed_base — 고정항목 (💾기본저장 버튼 클릭 시 저장)
// 저장 안 했으면 빈 배열 [] 로 시작 (defaultFixed 없음, v1.3.0~)
[
  { id, day, name, asset, amount, type: "income" | "expense" }
]

// mexp_v1_data — 월별 지출 (변경 즉시 자동저장)
{
  "2026-06": {
    rows: [
      { id, day, asset, name, expense, income, memo, isSub, isManual }
      // isManual: true → 수동 추가 항목 (Tags에서 클릭=수정, ✕=삭제)
      // isSub: true    → 서브행 (합산/잔액 계산에서 제외)
    ],
    bank: { kb, sh, date }   // date: "YYYY-MM-DD", 사용자가 직접 날짜 지정 (v1.3.1~)
  }
}

// mexp_v1_meta — 마지막 선택 상태 (자동저장)
{ year: 2026, month: 6 }

// dayMap (런타임) — DailyTab 렌더링용
{
  [day]: {
    inc: [{ name, asset, amount, isFixed, isCarryover, id, rKey }],
    exp: [{ name, asset, amount, isFixed, id, rKey }],
    trs: [{ name, fromAsset, toAsset, amount, isFixed, id, rKey }]  // v1.5.0~
  }
}
// isFixed: true → 고정항목 (수정/삭제 불가)
// isCarryover: true → 이월 항목 (파란색, 수정/삭제 불가)
// rKey: "YYYY-MM" → data[rKey].rows에서 해당 row 참조용

// 이체 행 (mexp_v1_data rows 내 — v1.5.0~)
{ id, day, name, fromAsset, toAsset, amount, expense:0, income:0, memo, isSub:false, isManual:true, isTransfer:true }
```

---

## 주요 로직 포인트

### 프로그램 시작 로직
- 고정항목 저장 데이터 있음 → 로드 적용 / 없음 → 빈 배열 `[]` (v1.3.0~)
- `defaultFixed()` 함수 정의는 코드에 남아 있으나 호출되지 않음 (dead code — 삭제 대상)
- 월 지출 저장 데이터 있음 → 로드 적용 / 없음 → 고정항목만 dayMap에 표시

### 이월 계산 (`carryover` useMemo)
- 이전달 `bank.date` 기준으로 최종 잔액 계산
- `bank.date`가 없으면 이월 = 0
- 이월이 있으면 Day 1 수입 항목에 자동 표시 + 파란 배너 출력

### 잔액 투영 (`buildBalances`)

| 조건 | 동작 |
|------|------|
| `bank.date` 있음 | 해당일 기준 앞뒤 양방향 전파 |
| `bank.date` 없고 이월 있음 | Day 1부터 누적 계산 |
| 둘 다 없음 | 잔액 표시 안 함 (`-`) |

### 실시간 잔액 (SummaryCard)
- 현재 달 조회 시: `balKb[오늘날짜]` 표시 + `실시간` 뱃지
- 다른 달: `bank.kb` 또는 이월값 표시

### 수동 항목 수정 흐름 (v1.3.0~)
1. DailyTab의 수동 태그(노란색) 클릭
2. `onEditManual(it)` → `data[it.rKey].rows`에서 실제 row 조회
3. `EditRowModal` 열림 (기존 값 pre-fill)
4. 수정 후 "수정 저장" → `updateRow(k, id, updated)` → `setData` → 자동저장

### 이체 처리 흐름 (v1.5.0~)
- `buildDayMap`: `isTransfer` 행 → `trs[]` 배열에 `{ name, fromAsset, toAsset, amount, id, rKey }` 추가
- `buildBalances`: `trs` 항목 순회 → fromAsset=KB면 netKb 차감, toAsset=신한이면 netSh 증가 (양방향)
- 이체는 `expense`/`income` = 0 → 총지출·총수입 합산에서 제외, 통계에도 미포함
- 이체 태그(teal) 클릭 → `EditRowModal`이 `row.isTransfer` 감지 → 출금/입금 자산 편집 모드

---

## 빌드 명령어

```bash
# 개발 서버 (웹)
npm run dev

# 웹 빌드만
npm run build

# exe 빌드 (스마트 빌더 — 자동 suffix 처리)
npm run electron:build
```

### 빌드 스크립트 동작 (`build-electron.mjs`)

```
version: "1.5.0"  →  기준 폴더: releases/v15
  ├─ releases/v15  실패(파일 잠김)  →  releases/v15b 자동 시도
  ├─ releases/v15b 실패            →  releases/v15c 자동 시도
  └─ 성공 시 해당 경로를 package.json에 저장
```

---

## 다음 버전 빌드 절차

`package.json` 2곳 수정 후 `npm run electron:build` 실행:

```json
"version": "1.6.0",
"productName": "월지출관리_v1.6"
```

→ 자동으로 `releases/v16/월지출관리_v1.6.exe` 생성

---

## 버전 이력

| 버전 | 주요 변경 |
|------|-----------|
| V0.2 | 초기 구현, XLSX import/export, 고정항목, 통계 |
| V1.0 | 이월 자동 계산, 자동저장, 고정항목 수동저장, 2020~2040 년도 선택, 실시간 잔액, 월/연간 통계 |
| V1.1 | Tags 컴포넌트 문서화, ASSETS 상수 명세, App.css 데드코드 확인 (문서 보완) |
| V1.2 | 수동 입력 '일별 지출내역(LedgerTab)' 탭 제거, 고정항목 🗑 초기화 버튼 추가 |
| V1.2.1 | 기본 저장 버전 이력 관리 — 저장 시 현재 월~만 반영, 과거 월은 해당 월 저장 버전 사용 |
| V1.2.2 | 금액 입력 자동 쉼표 표시 (`CommaInput` 컴포넌트) — 잔액설정·항목추가·고정항목 금액 적용 |
| V1.2.3 | 일별 예상 잔액 테이블 헤더 고정 (sticky), 고정항목 수입 행 적색 표시 |
| V1.2.4 | 고정항목 헤더도 sticky 적용, 두 탭 내부 세로 스크롤 제거 → css.content 단일 스크롤로 통합 |
| V1.2.5 | TabBar·탭별 제목/버튼 영역 App 레벨 sticky 고정 영역으로 분리, DailyTab·FixedTab은 테이블만 렌더링 |
| V1.2.6 | 컬럼 헤더 행도 sticky 고정 영역에 통합 — DailyTab colgroup 기반 table-layout:fixed 정렬, FixedTab 그리드 헤더 고정 |
| V1.3.0 | 수동 항목 수정 (`EditRowModal`), 일별 엑셀 저장 (`exportDailyExcel`), 💾 저장 버튼, 고정항목 미저장 시 빈 배열로 시작 |
| V1.3.1 | 잔액 기준일 직접 지정 (`BankModal` 날짜 입력), 🧮 계산기 버튼 (Electron IPC → calc.exe) |
| V1.4.0 | userData 경로 고정 (`app.setPath` → exe 옆 `data/`) — 버전 업 시 데이터 인계 문제 해결 |
| V1.4.1 | 통계 화면 개편 — 년 통계(월별 수입/지출 추이) / 월 통계(일별 추이, 년+월 독립 선택) 분리 |
| V1.4.2 | 통계 트렌드 차트 전체 너비로 변경 및 항목 테이블 위로 이동, 파이 차트 좌측 절반 유지 |
| V1.4.3 | 통계 화면에 '자산별 수입 비율' 파이 차트 추가 (지출 파이 옆에 나란히 배치) |
| V1.5.0 | `releases/v15/` ✅ 이체 기능 추가 — 자산→자산 이체, KB/신한 잔액 자동 반영, 이체 내역 컬럼, 수정/삭제 지원 |

---

## 알려진 이슈 / 주의사항

| 항목 | 내용 |
|------|------|
| ~~`releases/v02` 폴더~~ | 구버전 배포본 폴더 (v02~v14) — 로컬에 없음, git 이력에만 존재 |
| ~~`asar: false` 경고~~ | ✅ v1.4.1 빌드 시점 제거 완료 — asar 기본값(true) 복원 |
| 이월 조건 | 이전달에 `🏦 잔액 설정`을 해야 이월 계산됨. 미설정 시 이월 = 0 |
| 고정항목 변경 | `💾 기본 저장` 필수. 누르지 않으면 다음 실행 시 이전 데이터로 복원됨 |
| Excel 가져오기 | 고정항목 탭 전용. `고정항목` 시트가 포함된 `.xlsx`만 인식 |
| `package.json` type | `"type": "module"` → Electron 파일은 반드시 `.cjs` 확장자 사용 |
| userData 경로 | ✅ v1.4.0~ 해결: exe 옆 `data/` 폴더로 고정. 이전 버전 데이터는 `%APPDATA%\월지출관리_v1.x\` → `data/` 로 수동 1회 복사 필요 |

---

## 주요 의존성

```json
"dependencies": {
  "react": "^19.2.6",
  "react-dom": "^19.2.6",
  "recharts": "^3.8.1",
  "xlsx": "^0.18.5"
},
"devDependencies": {
  "electron": "^32.3.3",
  "electron-builder": "^25.1.8",
  "vite": "^8.0.12",
  "concurrently": "^9.2.1",
  "wait-on": "^8.0.5"
}
```
