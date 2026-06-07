import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from "recharts";
import * as XLSX from "xlsx";
import { db, isFirebaseReady } from './firebase';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const WD     = ["일","월","화","수","목","금","토"];
const MO     = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];
const ASSETS = ["KB국민은행","신한은행","KB국민카드","하나카드","삼성카드","카카오뱅크","삼성 앱카드","기타"];
const COLORS = ["#4a9eff","#f87171","#34d399","#fbbf24","#a78bfa","#fb923c","#38bdf8","#f472b6","#a3e635","#e879f9"];
const YEARS  = Array.from({ length: 2040 - 2020 + 1 }, (_, i) => 2020 + i);

// localStorage keys
const LS_BASE     = "mexp_v1_fixed_base";   // 고정항목 기본 저장 (수동)
const LS_DATA     = "mexp_v1_data";          // 월별 지출 데이터 (자동)
const LS_META     = "mexp_v1_meta";          // UI 상태 (년/월 선택)
const LS_SYNC_KEY = "mexp_sync_key";         // Firebase 동기화 키

// ─────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────
const pad         = (n) => String(n).padStart(2, "0");
const uid         = () => Math.random().toString(36).slice(2, 10);
const fmt         = (n) => (n || 0).toLocaleString("ko-KR");
const fmtW        = (n) => fmt(n) + "원";
const fmtM        = (n) => Math.round((n || 0) / 10000).toLocaleString("ko-KR") + "만";
const mKey        = (y, m) => `${y}-${pad(m)}`;
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
const isKb        = (a) => !!(a && a.includes("국민"));
const isSh        = (a) => !!(a && a.includes("신한"));
const loadLS      = (key, fb) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch { return fb; } };

// LS_BASE 버전 배열 파싱 (구버전 flat 배열 → 자동 마이그레이션)
const parseFixedVersions = (raw) => {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return [];
  // 구버전: 항목 배열 직접 저장 (effectiveFrom 없음) → "2020-01"로 래핑
  if (raw[0].effectiveFrom === undefined) return [{ effectiveFrom: "2020-01", items: raw }];
  return raw;
};

// 해당 월(y-m)에 적용될 고정항목 반환 (effectiveFrom <= YYYY-MM 중 최신 버전)
const fixedForMonth = (versions, y, m) => {
  if (!versions || versions.length === 0) return [];
  const key = mKey(y, m);
  const hit = versions
    .filter(v => v.effectiveFrom <= key)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return hit[0]?.items || [];
};

const defaultFixed = () => [
  { id: uid(), day:  5, name: "국민카드 결제",  asset: "KB국민은행", amount: 100, type: "expense" },
  { id: uid(), day: 10, name: "현대카드 결제",  asset: "KB국민은행", amount: 100, type: "expense" },
  { id: uid(), day: 13, name: "삼성화재",       asset: "KB국민은행", amount: 0,   type: "expense" },
  { id: uid(), day: 15, name: "현대캐피탈",     asset: "KB국민은행", amount: 0,   type: "expense" },
  { id: uid(), day: 20, name: "코웨이 렌탈",    asset: "KB국민은행", amount: 0,   type: "expense" },
  { id: uid(), day: 23, name: "삼성화재이자",   asset: "KB국민은행", amount: 0,   type: "expense" },
  { id: uid(), day: 25, name: "웰컴저축은행",   asset: "KB국민은행", amount: 0,   type: "expense" },
  { id: uid(), day: 27, name: "하나카드 결제",  asset: "KB국민은행", amount: 100, type: "expense" },
];

// ─────────────────────────────────────────────
//  DESIGN TOKENS
// ─────────────────────────────────────────────
const G = {
  bg: "#0f1117", bg2: "#1a1d27", bgc: "#1e2130", bgh: "#252840",
  bd: "rgba(255,255,255,0.08)", bdl: "rgba(255,255,255,0.04)",
  t1: "#e8eaf0", t2: "#8b90a7", tm: "#5a6075",
  blue: "#4a9eff",   blueDim:  "rgba(74,158,255,0.15)",
  green: "#34d399",  greenDim: "rgba(52,211,153,0.15)",
  red: "#f87171",    redDim:   "rgba(248,113,113,0.15)",
  amber: "#fbbf24",  amberDim: "rgba(251,191,36,0.15)",
  purple: "#a78bfa", purpleDim:"rgba(167,139,250,0.15)",
  teal: "#2dd4bf",   tealDim:  "rgba(45,212,191,0.15)",
};

const css = {
  app:     { display:"flex", height:"100vh", overflow:"hidden", fontFamily:"'Noto Sans KR',sans-serif", background:G.bg, color:G.t1, fontSize:14 },
  sidebar: { width:220, flexShrink:0, background:G.bg2, borderRight:`1px solid ${G.bd}`, display:"flex", flexDirection:"column", padding:"16px 10px", gap:2, overflowY:"auto" },
  logo:    { fontSize:15, fontWeight:700, padding:"6px 10px 14px", borderBottom:`1px solid ${G.bd}`, marginBottom:8, letterSpacing:"-0.3px" },
  secLbl:  { fontSize:10, fontWeight:600, color:G.tm, textTransform:"uppercase", letterSpacing:"1px", padding:"8px 10px 4px" },
  main:    { flex:1, overflow:"hidden", display:"flex", flexDirection:"column" },
  topbar:  { padding:"18px 24px 0", display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexShrink:0 },
  sumRow:  { padding:"14px 24px", display:"flex", gap:10, flexShrink:0 },
  scard:   { flex:1, background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:14, padding:"14px 16px", minWidth:0 },
  content: { padding:"0 24px 24px", flex:1, overflow:"hidden", minHeight:0, display:"flex", flexDirection:"column" },
  tabBar:  { display:"flex", gap:4, marginBottom:14, flexShrink:0 },
  tblWrap: { background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:14, overflow:"clip", marginBottom:16 },
  fiWrap:  { background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:14, overflow:"clip", marginBottom:16 },
  overlay: { position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:1000, backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center" },
  modal:   { background:G.bgc, border:"1px solid rgba(255,255,255,0.12)", borderRadius:18, padding:22, width:400, maxWidth:"92vw", boxShadow:"0 4px 24px rgba(0,0,0,0.4)" },
  statsOv: { position:"fixed", inset:0, background:"rgba(0,0,0,0.88)", zIndex:2000, backdropFilter:"blur(8px)", overflowY:"auto" },
  statsIn: { maxWidth:960, margin:"36px auto", padding:"0 20px 40px" },
};

// ─────────────────────────────────────────────
//  HOOKS
// ─────────────────────────────────────────────
function useMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  return isMobile;
}

// ─────────────────────────────────────────────
//  SHARED COMPONENTS
// ─────────────────────────────────────────────
const Btn = ({ children, variant = "default", onClick, style = {}, ...p }) => {
  const base = { display:"inline-flex", alignItems:"center", gap:5, padding:"7px 12px", borderRadius:10, fontSize:12, fontWeight:500, cursor:"pointer", transition:"all 0.15s", border:`1px solid ${G.bd}`, background:G.bgc, color:G.t2, fontFamily:"inherit", ...style };
  const variants = {
    primary: { background:G.blue,     color:"#fff", borderColor:"transparent" },
    green:   { background:G.greenDim, color:G.green, borderColor:"rgba(52,211,153,0.2)" },
    amber:   { background:G.amberDim, color:G.amber, borderColor:"rgba(251,191,36,0.2)" },
    purple:  { background:G.purpleDim,color:G.purple,borderColor:"rgba(167,139,250,0.2)" },
    teal:    { background:G.tealDim,  color:G.teal,  borderColor:"rgba(45,212,191,0.2)" },
    red:     { background:G.redDim,   color:G.red,   borderColor:"rgba(248,113,113,0.2)" },
    default: {},
  };
  return <button style={{ ...base, ...(variants[variant] || {}) }} onClick={onClick} {...p}>{children}</button>;
};

const XBtn = ({ onClick }) => (
  <button onClick={onClick} style={{ width:26, height:26, borderRadius:"50%", background:"rgba(255,255,255,0.06)", border:"none", color:G.t2, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontFamily:"inherit" }}>✕</button>
);

const BankBadge = ({ type }) => (
  <span style={{ width:16, height:16, borderRadius:3, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:8, fontWeight:800, flexShrink:0, background: type==="kb"?"#ffcc00":"#0066cc", color: type==="kb"?"#333":"#fff" }}>
    {type==="kb"?"KB":"신"}
  </span>
);

const Toast = ({ msg, type }) => msg ? (
  <div style={{ position:"fixed", bottom:20, right:20, background:G.bgc, border:`1px solid ${G.bd}`, borderLeft:`3px solid ${type==="ok"?G.green:G.red}`, borderRadius:10, padding:"10px 16px", fontSize:12, color:G.t1, zIndex:9999, boxShadow:"0 4px 24px rgba(0,0,0,0.4)" }}>
    {msg}
  </div>
) : null;

const CntBadge = ({ n }) => (
  <span style={{ fontSize:10, fontWeight:600, padding:"1px 6px", borderRadius:10, background:G.blueDim, color:G.blue }}>{n}</span>
);

const PulseDot = () => (
  <span style={{ display:"inline-block", width:5, height:5, borderRadius:"50%", background:G.blue, marginRight:4, verticalAlign:"middle" }} />
);

const WeekDay = ({ dow }) => {
  const col = dow===0?G.red : dow===6?G.blue : G.tm;
  const bg  = dow===0?"rgba(248,113,113,0.15)" : dow===6?"rgba(74,158,255,0.15)" : "transparent";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:18, height:18, borderRadius:"50%", fontSize:9, fontWeight:700, marginRight:3, background:bg, color:col }}>{WD[dow]}</span>
  );
};

const NumCell = ({ val, prefix, color, zero, compact }) => (
  <td style={{ padding: compact?"6px 8px":"8px 12px", borderBottom:`1px solid ${G.bdl}`, textAlign:"right", color: val>0?color:G.tm, fontWeight: val>0?500:400 }}>
    {val>0 ? `${prefix}${fmt(val)}` : (zero?"-":"")}
  </td>
);

// 금액 입력 시 천단위 쉼표 자동 표시 컴포넌트
// - onChange(number): 키 입력마다 숫자 반환 (BankModal, AddModal)
// - onBlur(number):   포커스 해제 시 숫자 반환 (FixedTab)
const CommaInput = ({ value, onChange, onBlur: onBlurProp, style, placeholder = "0", ...rest }) => {
  const fmtC = (v) => {
    if (v === "" || v == null) return "";
    const n = String(v).replace(/[^0-9]/g, "");
    if (!n) return "";
    const num = Number(n);
    return num === 0 ? "" : num.toLocaleString("ko-KR");
  };
  const [disp, setDisp] = useState(() => fmtC(value));
  // 외부 value 변경 시 동기화 (리셋·부모 상태 반영)
  useEffect(() => { setDisp(fmtC(value)); }, [value]);

  const handleChange = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setDisp(raw ? Number(raw).toLocaleString("ko-KR") : "");
    onChange?.(Number(raw) || 0);
  };
  const handleBlur = () => {
    onBlurProp?.(Number(disp.replace(/[^0-9]/g, "")) || 0);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={disp}
      onChange={handleChange}
      onBlur={onBlurProp ? handleBlur : undefined}
      style={style}
      placeholder={placeholder}
      {...rest}
    />
  );
};

const BalCell = ({ val, bold, compact }) => (
  <td style={{ padding: compact?"6px 8px":"8px 12px", borderBottom:`1px solid ${G.bdl}`, textAlign:"right", color: val===null?G.tm:val<0?G.red:G.blue, fontWeight: bold?700:600 }}>
    {val===null ? "-" : compact ? fmtM(val) : fmtW(val)}
  </td>
);

function Tags({ items, typeOverride, onDel, onEdit }) {
  if (!items.length) return null;
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:3, minWidth:80 }}>
      {items.map(it => {
        const isInc = typeOverride==="inc";
        const isCarry = it.isCarryover;
        const isEditable = !it.isFixed && !isCarry;
        const bg  = isCarry ? G.blueDim : it.isFixed ? (isInc?G.greenDim:G.redDim) : G.amberDim;
        const col = isCarry ? G.blue    : it.isFixed ? (isInc?G.green:G.red)        : G.amber;
        return (
          <span key={it.id}
            onClick={() => isEditable && onEdit && onEdit(it)}
            style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"2px 7px", borderRadius:12, fontSize:10, fontWeight:500, whiteSpace:"nowrap", background:bg, color:col, cursor: isEditable && onEdit ? "pointer" : "default" }}>
            {it.name}{it.amount>0?" "+fmt(it.amount):""}
            {isEditable && (
              <button onClick={(e)=>{e.stopPropagation();onDel(it.rKey,it.id);}}
                style={{ width:11, height:11, borderRadius:"50%", border:"none", background:"none", color:"inherit", cursor:"pointer", opacity:0.6, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:9, padding:0, fontFamily:"inherit" }}>✕</button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function TransferTags({ items, onDel, onEdit }) {
  if (!items.length) return null;
  const assetLabel = (a) => a?.includes("국민") ? "KB" : a?.includes("신한") ? "신한" : a || "?";
  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:3, minWidth:80 }}>
      {items.map(it => (
        <span key={it.id}
          onClick={() => onEdit && onEdit(it)}
          style={{ display:"inline-flex", alignItems:"center", gap:3, padding:"2px 7px", borderRadius:12, fontSize:10, fontWeight:500, whiteSpace:"nowrap", background:G.tealDim, color:G.teal, cursor: onEdit ? "pointer" : "default" }}>
          {it.name && <span>{it.name}</span>}
          <span style={{ opacity:0.8 }}>{assetLabel(it.fromAsset)}→{assetLabel(it.toAsset)}</span>
          {it.amount > 0 && <span>{fmt(it.amount)}</span>}
          <button onClick={e=>{e.stopPropagation();onDel(it.rKey,it.id);}}
            style={{ width:11, height:11, borderRadius:"50%", border:"none", background:"none", color:"inherit", cursor:"pointer", opacity:0.6, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:9, padding:0, fontFamily:"inherit" }}>✕</button>
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
//  MAIN APP
// ─────────────────────────────────────────────
export default function App() {
  const today = new Date();

  // ── Load persisted state ──
  const [year,  setYear]  = useState(() => loadLS(LS_META, {}).year  || today.getFullYear());
  const [month, setMonth] = useState(() => loadLS(LS_META, {}).month || today.getMonth() + 1);
  // fixedVersions: 저장된 버전 이력 [{effectiveFrom, items}]
  // 최초 미저장 시 defaultFixed()를 "2020-01" 버전으로 메모리 초기화 (localStorage 미기록)
  const [fixedVersions, setFixedVersions] = useState(() => {
    const raw = loadLS(LS_BASE, null);
    const versions = parseFixedVersions(raw);
    return versions.length > 0 ? versions : [];
  });
  // fixed: FixedTab 편집 버퍼 (최신 버전 기반)
  const [fixed, setFixed] = useState(() => {
    const raw = loadLS(LS_BASE, null);
    const versions = parseFixedVersions(raw);
    if (versions.length === 0) return [];
    const latest = [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    return latest.items.map(fi => ({ ...fi }));
  });
  const [data,  setData]  = useState(() => loadLS(LS_DATA, {}));
  // data shape: { "YYYY-MM": { rows: [...], bank: { kb, sh, date } } }

  // ── UI state ──
  const [tab,      setTab]      = useState("daily");
  const [toast,    setToast]    = useState(null);
  const [modal,    setModal]    = useState(null);
  const [statTab,  setStatTab]  = useState("month");
  const [statYear, setStatYear] = useState(today.getFullYear());
  const [compactDaily, setCompactDaily] = useState(() => window.innerWidth < 768);
  const fileRef    = useRef();
  const jsonRef    = useRef();
  const contentRef = useRef(null);
  const isMobile = useMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── compactDaily: 모바일=요약(true), 데스크탑=전체(false) ──
  useEffect(() => { setCompactDaily(isMobile); }, [isMobile]);

  // ── Firebase sync state ──
  const syncTimerRef = useRef(null);
  const [syncKey,    setSyncKey]    = useState(() => localStorage.getItem(LS_SYNC_KEY) || "");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [lastSyncAt, setLastSyncAt] = useState(null);

  // ── Auto-persist ──
  useEffect(() => { localStorage.setItem(LS_META, JSON.stringify({ year, month })); }, [year, month]);
  useEffect(() => { localStorage.setItem(LS_DATA, JSON.stringify(data)); }, [data]);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  // ── Manual save: fixed items as default (이번 달~만 반영) ──
  const saveFixedBase = () => {
    const effKey = mKey(year, month);
    const newVer = { effectiveFrom: effKey, items: fixed.map(fi => ({ ...fi })) };
    // 동월 기존 버전 교체 후 저장
    const updated = [...fixedVersions.filter(v => v.effectiveFrom !== effKey), newVer];
    setFixedVersions(updated);
    localStorage.setItem(LS_BASE, JSON.stringify(updated));
    showToast(`기본 고정항목 저장 완료 ✓ (${year}년 ${month}월~)`);
  };

  // ── Reset fixed items ──
  const resetFixed = () => {
    if (!window.confirm("고정항목을 모두 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.")) return;
    setFixed([]);
    setFixedVersions([]);
    localStorage.removeItem(LS_BASE);
    showToast("고정항목 초기화 완료");
  };

  // ── Derived: current month ──
  const key        = mKey(year, month);
  const monthEntry = data[key] || {};
  const monthRows  = monthEntry.rows || [];
  const bank       = monthEntry.bank || { kb: 0, sh: 0, date: null };
  const dim        = daysInMonth(year, month);

  // ── 이월: 이전달 최종 잔액 계산 ──
  const carryover = useMemo(() => {
    let pY = year, pM = month - 1;
    if (pM === 0) { pY--; pM = 12; }

    const pEntry = data[mKey(pY, pM)] || {};
    const pBank  = pEntry.bank || {};
    const pRows  = pEntry.rows || [];
    const pDim   = daysInMonth(pY, pM);

    let refDay = 0, refKb = 0, refSh = 0;
    if (pBank.date) {
      const bd = new Date(pBank.date);
      if (bd.getFullYear() === pY && bd.getMonth() + 1 === pM) {
        refDay = bd.getDate(); refKb = pBank.kb; refSh = pBank.sh;
      }
    }
    if (refDay === 0) return { kb: 0, sh: 0, hasData: false };

    // Build daily net for previous month — 이전달에 해당하는 고정항목 버전 사용
    const netKb = new Array(pDim + 2).fill(0);
    const netSh = new Array(pDim + 2).fill(0);
    fixedForMonth(fixedVersions, pY, pM).forEach(fi => {
      if (fi.day < 1 || fi.day > pDim || !(fi.amount > 0)) return;
      const s = fi.type === "income" ? 1 : -1;
      if (isKb(fi.asset)) netKb[fi.day] += s * fi.amount;
      else if (isSh(fi.asset)) netSh[fi.day] += s * fi.amount;
    });
    pRows.forEach(r => {
      if (r.isSub || r.day < 1 || r.day > pDim) return;
      if (r.isTransfer) {
        if (isKb(r.fromAsset)) netKb[r.day] -= (r.amount || 0);
        else if (isSh(r.fromAsset)) netSh[r.day] -= (r.amount || 0);
        if (isKb(r.toAsset)) netKb[r.day] += (r.amount || 0);
        else if (isSh(r.toAsset)) netSh[r.day] += (r.amount || 0);
      } else {
        if (isKb(r.asset)) netKb[r.day] += (r.income || 0) - (r.expense || 0);
        else if (isSh(r.asset)) netSh[r.day] += (r.income || 0) - (r.expense || 0);
      }
    });

    // 기준일 당일 거래부터 포함 (start-of-day 기준이므로)
    let kb = refKb, sh = refSh;
    for (let d = refDay; d <= pDim; d++) { kb += netKb[d]; sh += netSh[d]; }
    return { kb, sh, hasData: true };
  }, [data, fixedVersions, year, month]);

  // ── Month totals ──
  const getMonthTotals = useCallback((y, m) => {
    const r = data[mKey(y, m)]?.rows || [];
    let inc = r.filter(x => !x.isSub).reduce((s, x) => s + (x.income  || 0), 0);
    let exp = r.filter(x => !x.isSub).reduce((s, x) => s + (x.expense || 0), 0);
    const d = daysInMonth(y, m);
    fixedForMonth(fixedVersions, y, m).forEach(fi => {
      if (fi.day >= 1 && fi.day <= d && fi.amount > 0) {
        if (fi.type === "income") inc += fi.amount; else exp += fi.amount;
      }
    });
    return { inc, exp };
  }, [data, fixedVersions]);

  const { inc: totInc, exp: totExp } = getMonthTotals(year, month);

  // ── Day map ──
  const buildDayMap = () => {
    const map = {};
    for (let d = 1; d <= dim; d++) map[d] = { inc: [], exp: [], trs: [] };

    // refDay: 잔액 기준일 (buildBalances와 동일 로직)
    let refDay = 0;
    if (bank.date) {
      const bd = new Date(bank.date);
      if (bd.getFullYear() === year && bd.getMonth() + 1 === month) refDay = bd.getDate();
    }

    // 이월: refDay=0(기준일 미설정)일 때만 day 1 수입으로 표시
    // refDay>0이면 bank.kb가 앵커이므로 이월 표시 불필요 (잔액 계산에도 미반영)
    if (carryover.hasData && refDay === 0) {
      if (carryover.kb > 0) map[1].inc.push({ name: "이월(KB)", asset: "KB국민은행", amount: carryover.kb, isFixed: true, isCarryover: true, id: "co_kb" });
      if (carryover.sh > 0) map[1].inc.push({ name: "이월(신한)", asset: "신한은행", amount: carryover.sh, isFixed: true, isCarryover: true, id: "co_sh" });
    }

    fixedForMonth(fixedVersions, year, month).forEach(fi => {
      if (fi.day < 1 || fi.day > dim || !(fi.amount > 0)) return;
      const obj = { name: fi.name, asset: fi.asset, amount: fi.amount, isFixed: true, id: fi.id };
      if (fi.type === "income") map[fi.day].inc.push(obj);
      else map[fi.day].exp.push(obj);
    });

    monthRows.forEach(r => {
      if (r.isSub || r.day < 1 || r.day > dim) return;
      if (r.isTransfer) {
        map[r.day].trs.push({ name: r.name, fromAsset: r.fromAsset, toAsset: r.toAsset, amount: r.amount, isFixed: false, id: r.id, rKey: key });
      } else {
        if ((r.income  || 0) > 0) map[r.day].inc.push({ name: r.name, asset: r.asset, amount: r.income,  isFixed: false, id: r.id, rKey: key });
        if ((r.expense || 0) > 0) map[r.day].exp.push({ name: r.name, asset: r.asset, amount: r.expense, isFixed: false, id: r.id, rKey: key });
      }
    });
    return map;
  };

  // ── Balance projection ──
  const buildBalances = (map) => {
    const netKb = {}, netSh = {};
    for (let d = 1; d <= dim; d++) {
      let kb = 0, sh = 0;
      map[d].inc.forEach(it => { if (isKb(it.asset)) kb += it.amount; else if (isSh(it.asset)) sh += it.amount; });
      map[d].exp.forEach(it => { if (isKb(it.asset)) kb -= it.amount; else if (isSh(it.asset)) sh -= it.amount; });
      map[d].trs.forEach(it => {
        if (isKb(it.fromAsset)) kb -= it.amount; else if (isSh(it.fromAsset)) sh -= it.amount;
        if (isKb(it.toAsset))   kb += it.amount; else if (isSh(it.toAsset))   sh += it.amount;
      });
      netKb[d] = kb; netSh[d] = sh;
    }

    const balKb = {}, balSh = {};

    // Check bank manual reference
    let refDay = 0;
    if (bank.date) {
      const bd = new Date(bank.date);
      if (bd.getFullYear() === year && bd.getMonth() + 1 === month) refDay = bd.getDate();
    }

    if (refDay > 0) {
      // bank.kb = 기준일 당일 거래 전 잔액(시작 잔액) → 당일 거래 적용 후 마감 잔액 계산
      balKb[refDay] = bank.kb + netKb[refDay]; balSh[refDay] = bank.sh + netSh[refDay];
      let fk = balKb[refDay], fs = balSh[refDay];
      for (let d = refDay + 1; d <= dim; d++) { fk += netKb[d]; fs += netSh[d]; balKb[d] = fk; balSh[d] = fs; }
      // 역방향: bank.kb = (refDay-1) 마감 잔액 → 역순 누적
      let bk = bank.kb, bs = bank.sh;
      for (let d = refDay - 1; d >= 1; d--) { balKb[d] = bk; balSh[d] = bs; bk -= netKb[d]; bs -= netSh[d]; }
    } else if (carryover.hasData) {
      // Use carryover as day-0 starting balance (이월 items included in netKb[1])
      let kb = 0, sh = 0;
      for (let d = 1; d <= dim; d++) { kb += netKb[d]; sh += netSh[d]; balKb[d] = kb; balSh[d] = sh; }
    } else {
      // 앵커 없음: 0원 기준으로 누적 (수동 입력이 잔액에 반영되도록)
      let kb = 0, sh = 0;
      for (let d = 1; d <= dim; d++) { kb += netKb[d]; sh += netSh[d]; balKb[d] = kb; balSh[d] = sh; }
    }

    return { balKb, balSh };
  };

  // ── CRUD ──
  const addRow = (row) => {
    const k = mKey(row._year, row._month);
    setData(prev => {
      const entry = prev[k] || { rows: [], bank: {} };
      const arr = [...entry.rows];
      let idx = arr.findIndex(r => r.day > row.day && !r.isSub);
      if (idx === -1) idx = arr.length;
      const newRow = row.type === "transfer"
        ? { id: uid(), day: row.day, name: row.name, fromAsset: row.fromAsset, toAsset: row.toAsset, amount: row.amount, expense: 0, income: 0, memo: row.memo||"", isSub: false, isManual: true, isTransfer: true }
        : { id: uid(), day: row.day, asset: row.asset, name: row.name, expense: row.type==="expense"?row.amount:0, income: row.type==="income"?row.amount:0, memo: row.memo||"", isSub: false, isManual: true };
      arr.splice(idx, 0, newRow);
      return { ...prev, [k]: { ...entry, rows: arr } };
    });
    showToast("항목 추가됨");
  };

  const delRow = (k, id) => {
    setData(prev => {
      const entry = prev[k] || { rows: [] };
      return { ...prev, [k]: { ...entry, rows: entry.rows.filter(r => r.id !== id) } };
    });
    showToast("항목 삭제됨");
  };

  const updateRow = (k, id, updated) => {
    setData(prev => {
      const entry = prev[k] || { rows: [] };
      return { ...prev, [k]: { ...entry, rows: entry.rows.map(r => r.id === id ? { ...r, ...updated } : r) } };
    });
    showToast("항목 수정됨");
  };

  const updateFixed = (id, field, val) =>
    setFixed(prev => prev.map(fi => fi.id === id ? { ...fi, [field]: (field==="amount"||field==="day")?Number(val):val } : fi));
  const delFixed = (id) => { setFixed(prev => prev.filter(f => f.id !== id)); showToast("고정항목 삭제됨"); };
  const addFixed = () => setFixed(prev => [...prev, { id: uid(), day: 1, name: "새 항목", asset: "KB국민은행", amount: 0, type: "expense" }]);

  // ── Excel import → 고정항목 적용 ──
  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "binary", cellDates: true });
        const ws = wb.Sheets["고정항목"];
        if (!ws) { showToast("'고정항목' 시트를 찾을 수 없습니다", "err"); return; }
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        const arr = [];
        for (let i = 1; i < raw.length; i++) {
          const r = raw[i]; if (!r || !r[1]) continue;
          arr.push({ id: uid(), day: Number(r[0])||1, name: String(r[1]), asset: String(r[2]||"KB국민은행"), amount: Number(r[3])||0, type: String(r[4])==="수입"?"income":"expense" });
        }
        if (arr.length) { setFixed(arr); showToast(`고정항목 ${arr.length}개 가져오기 완료 (저장 버튼으로 기본 적용)`); }
        else showToast("고정항목 데이터 없음", "err");
      } catch (err) { showToast("파일 오류: " + err.message, "err"); }
    };
    reader.readAsBinaryString(file);
    e.target.value = "";
  };

  // ── 전체 데이터 JSON 내보내기 ──
  const exportAllData = () => {
    const backup = {
      version: "2.0.0",
      exportedAt: new Date().toISOString(),
      [LS_BASE]: loadLS(LS_BASE, null),
      [LS_DATA]: loadLS(LS_DATA, {}),
      [LS_META]: loadLS(LS_META, {}),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `월지출관리_백업_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("전체 데이터 내보내기 완료 ✓");
  };

  // ── 전체 데이터 JSON 가져오기 ──
  const handleImportAll = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    if (!window.confirm(`"${file.name}" 파일로 전체 데이터를 복원하시겠습니까?\n현재 데이터가 덮어씌워집니다.`)) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const backup = JSON.parse(ev.target.result);
        if (!backup[LS_DATA] && !backup[LS_BASE]) throw new Error("올바른 백업 파일이 아닙니다");
        if (backup[LS_DATA]) {
          localStorage.setItem(LS_DATA, JSON.stringify(backup[LS_DATA]));
          setData(backup[LS_DATA]);
        }
        if (backup[LS_BASE]) {
          localStorage.setItem(LS_BASE, JSON.stringify(backup[LS_BASE]));
          const versions = parseFixedVersions(backup[LS_BASE]);
          setFixedVersions(versions);
          const latest = versions.length > 0
            ? [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
            : null;
          setFixed(latest ? latest.items.map(fi => ({ ...fi })) : []);
        }
        if (backup[LS_META]) {
          if (backup[LS_META].year)  setYear(backup[LS_META].year);
          if (backup[LS_META].month) setMonth(backup[LS_META].month);
        }
        showToast("전체 데이터 가져오기 완료 ✓");
      } catch (err) {
        showToast("가져오기 실패: " + err.message, "error");
      }
    };
    reader.readAsText(file);
  };

  // ── Firebase sync ──
  const pushSync = useCallback(async () => {
    if (!syncKey || !isFirebaseReady || !db) return;
    setSyncStatus("syncing");
    try {
      await setDoc(doc(db, "sync", syncKey), {
        fixed_base: JSON.stringify(loadLS(LS_BASE, null)),
        data:       JSON.stringify(loadLS(LS_DATA, {})),
        updatedAt:  serverTimestamp(),
      });
      setSyncStatus("synced");
      setLastSyncAt(new Date());
    } catch(e) {
      setSyncStatus("error");
    }
  }, [syncKey]);

  const pullSync = useCallback(async (silent = false) => {
    if (!syncKey || !isFirebaseReady || !db) return false;
    setSyncStatus("syncing");
    try {
      const snap = await getDoc(doc(db, "sync", syncKey));
      if (!snap.exists()) {
        setSyncStatus("idle");
        if (!silent) showToast("클라우드에 저장된 데이터가 없습니다. 이 기기가 첫 번째입니다.");
        return false;
      }
      const remote = snap.data();
      if (remote.data) {
        const parsed = JSON.parse(remote.data);
        localStorage.setItem(LS_DATA, JSON.stringify(parsed));
        setData(parsed);
      }
      if (remote.fixed_base && remote.fixed_base !== "null") {
        const parsed = JSON.parse(remote.fixed_base);
        localStorage.setItem(LS_BASE, JSON.stringify(parsed));
        const versions = parseFixedVersions(parsed);
        setFixedVersions(versions);
        const latest = versions.length > 0
          ? [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
          : null;
        setFixed(latest ? latest.items.map(fi => ({ ...fi })) : []);
      }
      setSyncStatus("synced");
      setLastSyncAt(new Date());
      if (!silent) showToast("클라우드에서 데이터를 가져왔습니다 ✓");
      return true;
    } catch(e) {
      setSyncStatus("error");
      if (!silent) showToast("동기화 실패: " + e.message, "error");
      return false;
    }
  }, [syncKey]);

  const connectSync = (key) => {
    const k = key.trim();
    if (!k) return;
    localStorage.setItem(LS_SYNC_KEY, k);
    setSyncKey(k);
    setSyncStatus("idle");
    showToast("동기화 키가 설정되었습니다. 데이터가 자동으로 업로드됩니다.");
  };

  const disconnectSync = () => {
    localStorage.removeItem(LS_SYNC_KEY);
    setSyncKey("");
    setSyncStatus("idle");
    setLastSyncAt(null);
    showToast("동기화 연결이 해제되었습니다.");
  };

  // ── Auto-pull on mount (syncKey 설정된 경우 앱 로드 시 자동 가져오기) ──
  useEffect(() => {
    if (syncKey && isFirebaseReady) pullSync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Auto-push on data change (debounce 5s) ──
  useEffect(() => {
    if (!syncKey || !isFirebaseReady) return;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(pushSync, 5000);
    return () => clearTimeout(syncTimerRef.current);
  }, [data, fixedVersions, syncKey, pushSync]);

  // ── Excel export: 고정항목 ──
  const exportFixedExcel = () => {
    const wb = XLSX.utils.book_new();
    const aoa = [["일","항목명","자산","금액(원)","구분"]];
    [...fixed].sort((a,b)=>a.day-b.day).forEach(fi => aoa.push([fi.day, fi.name, fi.asset, fi.amount, fi.type==="income"?"수입":"지출"]));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{wch:6},{wch:22},{wch:16},{wch:12},{wch:8}];
    XLSX.utils.book_append_sheet(wb, ws, "고정항목");
    XLSX.writeFile(wb, `고정항목_${year}년.xlsx`);
    showToast("고정항목 엑셀 저장 완료");
  };

  // ── Excel export: 일별 지출내역 ──
  const exportDailyExcel = () => {
    const map = buildDayMap();
    const { balKb, balSh } = buildBalances(map);
    const wb = XLSX.utils.book_new();
    const aoa = [["날짜","요일","항목명","구분","자산","금액(원)","국민잔액","신한잔액","합계잔액"]];
    for (let d = 1; d <= dim; d++) {
      const dow = WD[new Date(year, month - 1, d).getDay()];
      const dateStr = `${month}/${d}`;
      const kbB = balKb[d] ?? "";
      const shB = balSh[d] ?? "";
      const totB = kbB !== "" && shB !== "" ? kbB + shB : "";
      const rows = [
        ...map[d].inc.map(it => [dateStr, dow, it.name, "수입", it.asset, it.amount, kbB, shB, totB]),
        ...map[d].exp.map(it => [dateStr, dow, it.name, "지출", it.asset, it.amount, kbB, shB, totB]),
      ];
      if (rows.length) rows.forEach(r => aoa.push(r));
      else aoa.push([dateStr, dow, "", "", "", "", kbB, shB, totB]);
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{wch:8},{wch:5},{wch:20},{wch:6},{wch:16},{wch:12},{wch:12},{wch:12},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, `${month}월 지출내역`);
    const expD = new Date();
    const expDateStr = `${expD.getFullYear()}${pad(expD.getMonth()+1)}${pad(expD.getDate())}`;
    XLSX.writeFile(wb, `${year}년_${pad(month)}월_지출내역_${expDateStr}.xlsx`);
    showToast(`${year}년 ${month}월 엑셀 저장 완료`);
  };

  // ── Render ──
  const dayMap = buildDayMap();
  const { balKb, balSh } = buildBalances(dayMap);

  // 오늘 실시간 잔액
  const isCurMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const todayD     = today.getDate();
  const liveKb = isCurMonth && balKb[todayD] != null ? balKb[todayD] : (bank.date ? bank.kb : (carryover.hasData ? carryover.kb : 0));
  const liveSh = isCurMonth && balSh[todayD] != null ? balSh[todayD] : (bank.date ? bank.sh : (carryover.hasData ? carryover.sh : 0));
  const bankSub = bank.date ? `기준: ${bank.date}` : (carryover.hasData ? "이월 기준" : "기준일 미설정");

  const bankRefDay = bank.date ? (() => { const bd = new Date(bank.date); return bd.getFullYear()===year&&bd.getMonth()+1===month?bd.getDate():0; })() : 0;

  const closeSidebar = () => setSidebarOpen(false);
  const scardMobile = isMobile ? { flex: "1 1 calc(50% - 5px)", minWidth: 0, padding: "8px 10px" } : {};

  return (
    <div style={css.app}>
      {/* 모바일 사이드바 backdrop */}
      {isMobile && sidebarOpen && (
        <div onClick={closeSidebar}
          style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:199, backdropFilter:"blur(2px)" }} />
      )}

      <Sidebar
        year={year} month={month} today={today}
        isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}
        onSelectYear={y => { setYear(y); closeSidebar(); }}
        onSelectMonth={m => { setMonth(m); closeSidebar(); }}
        onFixedTab={() => { setTab("fixed"); closeSidebar(); }}
        onExportFixed={exportFixedExcel}
        onImport={() => fileRef.current.click()}
        onStats={() => { setModal("stats"); setStatTab("month"); closeSidebar(); }}
        onExportAll={exportAllData}
        onImportAll={() => jsonRef.current.click()}
        onCalc={() => { setModal("calc"); closeSidebar(); }}
        syncKey={syncKey} syncStatus={syncStatus}
        onSync={() => { setModal("sync"); closeSidebar(); }}
      />

      <main style={css.main}>
        {/* Topbar */}
        <div style={{ ...css.topbar, flexWrap:"wrap", gap:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, flex:1, minWidth:0 }}>
            {isMobile && (
              <button onClick={() => setSidebarOpen(true)}
                style={{ flexShrink:0, background:"none", border:`1px solid ${G.bd}`, borderRadius:8, color:G.t1, fontSize:18, padding:"4px 10px", cursor:"pointer", fontFamily:"inherit", lineHeight:1 }}>
                ☰
              </button>
            )}
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize: isMobile ? 14 : 20, fontWeight:700, letterSpacing:"-0.5px", whiteSpace: isMobile ? "nowrap" : undefined }}>{year}년 {month}월 지출관리</div>
              {!isMobile && (
                <div style={{ fontSize:12, color:G.tm, marginTop:2 }}>
                  오늘: {today.getFullYear()}.{pad(today.getMonth()+1)}.{pad(today.getDate())} ({WD[today.getDay()]})
                </div>
              )}
            </div>
          </div>
          <div style={{ display:"flex", gap:6, flexShrink:0 }}>
            <Btn onClick={() => setModal("bank")} style={isMobile ? { fontSize:11, padding:"5px 9px" } : {}}>
              🏦 {isMobile ? "잔액" : "잔액 설정"}
            </Btn>
            <Btn variant="primary" onClick={() => setModal("add")} style={isMobile ? { fontSize:11, padding:"5px 9px" } : {}}>
              ＋ {isMobile ? "추가" : "항목 추가"}
            </Btn>
          </div>
        </div>

        {/* Summary Cards */}
        <div style={{ ...css.sumRow, flexWrap:"wrap", padding: isMobile ? "8px 12px" : "14px 24px" }}>
          <SummaryCard label="국민은행 잔액" badge={<BankBadge type="kb"/>} amount={fmtW(liveKb)} color={G.blue}  sub={bankSub} live={isCurMonth} cardStyle={scardMobile} compact={isMobile} />
          <SummaryCard label="신한은행 잔액" badge={<BankBadge type="sh"/>} amount={fmtW(liveSh)} color={G.blue}  sub={bankSub} live={isCurMonth} cardStyle={scardMobile} compact={isMobile} />
          <SummaryCard label="이번 달 총 지출" amount={fmtW(totExp)} color={G.red}   sub="고정+수동 합산" cardStyle={scardMobile} compact={isMobile} />
          <SummaryCard label="이번 달 총 수입" amount={fmtW(totInc)} color={G.green} sub="고정+수동 합산" cardStyle={scardMobile} compact={isMobile} />
        </div>

        {/* Content */}
        <div ref={contentRef} style={css.content}>

          {/* ── 고정 헤더 영역 (TabBar + 탭별 제목/버튼) ── */}
          <div style={{ flexShrink:0, background:G.bg }}>

            {/* TabBar */}
            <div style={{ display:"flex", gap:4, marginBottom:12, paddingTop:14 }}>
              {[["daily","📅 일별 예상 잔액"],["fixed","⚙️ 고정 항목"]].map(([t, label]) => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ padding:"5px 12px", borderRadius:10, fontSize:12, fontWeight:500, cursor:"pointer", border:`1px solid ${G.bd}`, background: tab===t?G.blueDim:"none", color: tab===t?G.blue:G.t2, borderColor: tab===t?"rgba(74,158,255,0.2)":G.bd, fontFamily:"inherit" }}>
                  {label}
                </button>
              ))}
            </div>

            {/* 일별 예상 잔액 탭 헤더 */}
            {tab==="daily" && (
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                <div style={{ fontSize:13, fontWeight:600, color:G.t1, display:"flex", alignItems:"center", gap:6 }}>
                  날짜별 잔액 추적 <CntBadge n={dim+"일"} />
                </div>
                <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
                  {carryover.hasData && !isMobile && (
                    <div style={{ display:"flex", gap:12, alignItems:"center", fontSize:11, background:"rgba(74,158,255,0.08)", border:"1px solid rgba(74,158,255,0.2)", borderRadius:8, padding:"5px 12px" }}>
                      <span style={{ color:G.tm }}>📥 이월</span>
                      <span style={{ color:G.blue, fontWeight:600 }}>KB {fmtW(carryover.kb)}</span>
                      <span style={{ color:G.blue, fontWeight:600 }}>신한 {fmtW(carryover.sh)}</span>
                    </div>
                  )}
                  {isMobile && (
                    <div style={{ display:"flex", border:`1px solid ${G.bd}`, borderRadius:8, overflow:"hidden", flexShrink:0 }}>
                      <button onClick={() => setCompactDaily(false)} style={{ padding:"4px 10px", fontSize:11, background: !compactDaily?G.blueDim:"none", color: !compactDaily?G.blue:G.t2, border:"none", borderRight:`1px solid ${G.bd}`, cursor:"pointer", fontFamily:"inherit" }}>전체</button>
                      <button onClick={() => setCompactDaily(true)}  style={{ padding:"4px 10px", fontSize:11, background:  compactDaily?G.blueDim:"none", color:  compactDaily?G.blue:G.t2, border:"none", cursor:"pointer", fontFamily:"inherit" }}>요약</button>
                    </div>
                  )}
                  {!isMobile && <Btn variant="green" onClick={exportDailyExcel}>⬇️ 엑셀 저장</Btn>}
                  {!isMobile && <Btn variant="teal"  onClick={() => showToast(`${year}년 ${month}월 데이터 저장됨 ✓`)}>💾 저장</Btn>}
                </div>
              </div>
            )}

            {/* 고정 항목 탭 헤더 */}
            {tab==="fixed" && (
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:G.t1 }}>고정 수입/지출 항목</div>
                  <div style={{ fontSize:11, color:G.tm, marginTop:3 }}>
                    수정 후 <span style={{ color:G.teal, fontWeight:600 }}>💾 기본 저장</span>을 눌러야 <span style={{ color:G.amber, fontWeight:600 }}>{year}년 {month}월~</span> 에 반영됩니다 (이전 달 미반영)
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
                  <Btn variant="amber" onClick={() => fileRef.current.click()}>⬆️ 가져오기</Btn>
                  <Btn variant="green" onClick={exportFixedExcel}>⬇️ 내보내기</Btn>
                  <Btn variant="primary" onClick={addFixed}>＋ 추가</Btn>
                  <Btn variant="teal"   onClick={saveFixedBase}>💾 기본 저장</Btn>
                  <Btn variant="red"    onClick={resetFixed}>🗑 초기화</Btn>
                </div>
              </div>
            )}

          </div>
          {/* ── 스크롤 영역 (테이블만) ── */}
          {tab==="daily"  && <DailyTab year={year} month={month} today={today} dim={dim} dayMap={dayMap} balKb={balKb} balSh={balSh} carryover={carryover} refDay={bankRefDay} onAddDay={d => setModal({ type:"add", day:d })} onDelManual={delRow} onEditManual={it => { const row = (data[it.rKey]?.rows||[]).find(r=>r.id===it.id); if(row) setModal({ type:"edit", row, rKey:it.rKey }); }} compact={compactDaily} />}
          {tab==="fixed"  && <FixedTab fixed={fixed} onUpdate={updateFixed} onDel={delFixed} onAdd={addFixed} />}
        </div>
      </main>

      {/* Modals */}
      {(modal==="add" || modal?.type==="add") && (
        <AddModal year={year} month={month} initDay={modal?.day || today.getDate()} onSave={row => { addRow(row); setModal(null); }} onClose={() => setModal(null)} />
      )}
      {modal?.type==="edit" && (
        <EditRowModal row={modal.row} rKey={modal.rKey} dim={dim} onSave={(k,id,updated) => { updateRow(k,id,updated); setModal(null); }} onClose={() => setModal(null)} />
      )}
      {modal==="bank" && (
        <BankModal bank={bank} year={year} month={month} dim={dim}
          onSave={(kb, sh, day) => {
            const date = `${year}-${pad(month)}-${pad(day)}`;
            setData(prev => ({ ...prev, [key]: { ...(prev[key]||{rows:[]}), bank: { kb, sh, date } } }));
            setModal(null); showToast(`잔액 저장됨 (${month}월 ${day}일 기준)`);
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal==="stats" && (
        <StatsOverlay year={year} month={month} statYear={statYear} setStatYear={setStatYear} data={data} fixedVersions={fixedVersions} statTab={statTab} onTabChange={setStatTab} onClose={() => setModal(null)} getMonthTotals={getMonthTotals} />
      )}
      {modal==="calc" && (
        <CalcModal onClose={() => setModal(null)} />
      )}
      {modal==="sync" && (
        <SyncModal
          syncKey={syncKey} syncStatus={syncStatus} lastSyncAt={lastSyncAt}
          onConnect={connectSync}
          onDisconnect={disconnectSync}
          onPull={pullSync}
          onClose={() => setModal(null)}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={handleImport} />
      <input ref={jsonRef} type="file" accept=".json"      style={{ display:"none" }} onChange={handleImportAll} />
    </div>
  );
}

// ─────────────────────────────────────────────
//  CALC MODAL
// ─────────────────────────────────────────────
function CalcModal({ onClose }) {
  const [display, setDisplay] = useState("0");
  const [prevNum, setPrevNum] = useState(null);
  const [pendingOp, setPendingOp] = useState(null);
  const [exprLine, setExprLine] = useState("");
  const [justEvaled, setJustEvaled] = useState(false);

  const getNum = () => parseFloat(display) || 0;

  const fmtDisp = (s) => {
    const n = parseFloat(s);
    if (!isFinite(n)) return "오류";
    if (s.endsWith(".")) return Math.trunc(n).toLocaleString("ko-KR") + ".";
    if (s.includes(".")) {
      const [i, d] = s.split(".");
      return parseInt(i).toLocaleString("ko-KR") + "." + d;
    }
    return n.toLocaleString("ko-KR");
  };

  const pressDigit = (d) => {
    if (justEvaled) { setDisplay(d); setJustEvaled(false); return; }
    setDisplay(prev => {
      const clean = prev.replace(/,/g, "");
      if (clean === "0" && d !== ".") return d;
      if (clean.replace(/[^0-9]/g,"").length >= 12) return prev;
      return clean + d;
    });
  };

  const pressDot = () => {
    if (justEvaled) { setDisplay("0."); setJustEvaled(false); return; }
    if (!display.includes(".")) setDisplay(p => p + ".");
  };

  const applyOp = (a, op, b) => {
    const r = op==="+"?a+b : op==="-"?a-b : op==="×"?a*b : op==="÷"&&b!==0?a/b : 0;
    return Math.round(r * 1e10) / 1e10;
  };

  const pressOp = (op) => {
    const cur = getNum();
    if (pendingOp !== null && !justEvaled) {
      const result = applyOp(prevNum, pendingOp, cur);
      setDisplay(String(result));
      setPrevNum(result);
      setExprLine(`${fmtDisp(String(result))} ${op}`);
    } else {
      setPrevNum(cur);
      setExprLine(`${fmtDisp(display)} ${op}`);
    }
    setPendingOp(op);
    setJustEvaled(true);
  };

  const pressEquals = () => {
    if (pendingOp === null || prevNum === null) return;
    const cur = getNum();
    const result = applyOp(prevNum, pendingOp, cur);
    setExprLine(`${fmtDisp(String(prevNum))} ${pendingOp} ${fmtDisp(display)} =`);
    setDisplay(String(result));
    setPrevNum(null); setPendingOp(null); setJustEvaled(true);
  };

  const pressClear = () => {
    setDisplay("0"); setPrevNum(null); setPendingOp(null); setExprLine(""); setJustEvaled(false);
  };

  const pressSign  = () => setDisplay(p => String(parseFloat(p) * -1));
  const pressPct   = () => setDisplay(p => String(Math.round(parseFloat(p) / 100 * 1e10) / 1e10));

  const bN  = { height:54, borderRadius:12, fontSize:18, fontWeight:500, cursor:"pointer", border:"none", fontFamily:"inherit", background:G.bg2,      color:G.t1   };
  const bOp = { ...bN, background:G.blueDim, color:G.blue };
  const bFn = { ...bN, background:G.bgh,     color:G.t2   };
  const bEq = { ...bN, background:G.blue,    color:"#fff"  };

  return (
    <div style={css.overlay} onClick={onClose}>
      <div style={{ ...css.modal, width:300, padding:18 }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <span style={{ fontSize:14, fontWeight:700 }}>🧮 계산기</span>
          <XBtn onClick={onClose} />
        </div>
        <div style={{ background:G.bg2, borderRadius:10, padding:"8px 12px", marginBottom:12, textAlign:"right" }}>
          <div style={{ fontSize:10, color:G.tm, minHeight:15, marginBottom:3 }}>{exprLine}</div>
          <div style={{ fontSize:28, fontWeight:700, color:G.t1, letterSpacing:"-0.5px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{fmtDisp(display)}</div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:6 }}>
          <button style={bFn} onClick={pressClear}>AC</button>
          <button style={bFn} onClick={pressSign}>±</button>
          <button style={bFn} onClick={pressPct}>%</button>
          <button style={bOp} onClick={()=>pressOp("÷")}>÷</button>
          <button style={bN}  onClick={()=>pressDigit("7")}>7</button>
          <button style={bN}  onClick={()=>pressDigit("8")}>8</button>
          <button style={bN}  onClick={()=>pressDigit("9")}>9</button>
          <button style={bOp} onClick={()=>pressOp("×")}>×</button>
          <button style={bN}  onClick={()=>pressDigit("4")}>4</button>
          <button style={bN}  onClick={()=>pressDigit("5")}>5</button>
          <button style={bN}  onClick={()=>pressDigit("6")}>6</button>
          <button style={bOp} onClick={()=>pressOp("-")}>−</button>
          <button style={bN}  onClick={()=>pressDigit("1")}>1</button>
          <button style={bN}  onClick={()=>pressDigit("2")}>2</button>
          <button style={bN}  onClick={()=>pressDigit("3")}>3</button>
          <button style={bOp} onClick={()=>pressOp("+")}>+</button>
          <button style={{ ...bN, gridColumn:"span 2" }} onClick={()=>pressDigit("0")}>0</button>
          <button style={bN}  onClick={pressDot}>.</button>
          <button style={bEq} onClick={pressEquals}>=</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  SYNC MODAL
// ─────────────────────────────────────────────
function SyncModal({ syncKey, syncStatus, lastSyncAt, onConnect, onDisconnect, onPull, onClose }) {
  const [inputKey, setInputKey] = useState(syncKey);
  const [showKey,  setShowKey]  = useState(false);

  const statusInfo = {
    idle:    { icon:"⚪", text:"연결 안 됨",   col: G.tm    },
    syncing: { icon:"🔄", text:"동기화 중...", col: G.blue  },
    synced:  { icon:"🟢", text:"동기화 완료", col: G.green },
    error:   { icon:"🔴", text:"동기화 실패", col: G.red   },
  }[syncStatus] || { icon:"⚪", text:"연결 안 됨", col: G.tm };

  const inSt  = { width:"100%", padding:"8px 11px", background:G.bg2, border:`1px solid ${G.bd}`, borderRadius:10, color:G.t1, fontSize:12, fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
  const lblSt = { fontSize:11, fontWeight:500, color:G.t2, marginBottom:5, display:"block" };

  return (
    <div style={css.overlay} onClick={onClose}>
      <div style={css.modal} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:18, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          🔄 기기 간 동기화 <XBtn onClick={onClose} />
        </div>

        {!isFirebaseReady && (
          <div style={{ padding:"10px 12px", borderRadius:10, background:G.amberDim, border:`1px solid rgba(251,191,36,0.3)`, fontSize:12, color:G.amber, marginBottom:14 }}>
            ⚠️ Firebase 미설정 — <code>.env.local</code> 파일에 Firebase 설정을 입력한 후 재시작하세요.
          </div>
        )}

        <div style={{ marginBottom:14 }}>
          <label style={lblSt}>동기화 키 (기기 간 공유할 비밀 키)</label>
          <div style={{ display:"flex", gap:6 }}>
            <input
              type={showKey ? "text" : "password"}
              style={inSt}
              placeholder="영문/숫자로 된 나만의 비밀 키 입력"
              value={inputKey}
              onChange={e => setInputKey(e.target.value)}
            />
            <button onClick={() => setShowKey(p => !p)}
              style={{ flexShrink:0, padding:"8px 10px", borderRadius:10, border:`1px solid ${G.bd}`, background:"none", color:G.t2, cursor:"pointer", fontSize:11, fontFamily:"inherit", whiteSpace:"nowrap" }}>
              {showKey ? "숨김" : "표시"}
            </button>
          </div>
          <div style={{ fontSize:10, color:G.tm, marginTop:5 }}>
            같은 키를 입력한 기기끼리 데이터를 공유합니다. 타인에게 공유하지 마세요.
          </div>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:18, padding:"10px 12px", borderRadius:10, background:G.bg2 }}>
          <span style={{ fontSize:16 }}>{statusInfo.icon}</span>
          <div>
            <div style={{ fontSize:12, fontWeight:600, color:statusInfo.col }}>{statusInfo.text}</div>
            {lastSyncAt && <div style={{ fontSize:10, color:G.tm }}>마지막: {lastSyncAt.toLocaleTimeString("ko-KR")}</div>}
            {syncKey && <div style={{ fontSize:10, color:G.tm, marginTop:2 }}>키: {syncKey.slice(0,3)}{"*".repeat(Math.max(0, syncKey.length-3))}</div>}
          </div>
        </div>

        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <Btn style={{ flex:1, justifyContent:"center" }} onClick={onClose}>닫기</Btn>
          {syncKey && (
            <>
              <Btn variant="teal" style={{ justifyContent:"center" }} onClick={onPull}>⬇ 클라우드→이 기기</Btn>
              <Btn variant="red"  style={{ justifyContent:"center" }} onClick={onDisconnect}>연결 해제</Btn>
            </>
          )}
          <Btn variant="primary" style={{ flex:1, justifyContent:"center" }} disabled={!isFirebaseReady || !inputKey.trim()}
            onClick={() => onConnect(inputKey)}>
            {syncKey ? "키 변경" : "연결"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  SIDEBAR
// ─────────────────────────────────────────────
function Sidebar({ year, month, today, onSelectYear, onSelectMonth, onFixedTab, onExportFixed, onImport, onStats, onExportAll, onImportAll, onCalc, isMobile, sidebarOpen, onClose, syncKey, syncStatus, onSync }) {
  const isCurrentYear = today.getFullYear() === year;
  const sidebarStyle = isMobile
    ? { ...css.sidebar, position:"fixed", top:0, left:0, height:"100vh", zIndex:200,
        transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
        transition:"transform 0.25s ease",
        boxShadow: sidebarOpen ? "4px 0 24px rgba(0,0,0,0.5)" : "none" }
    : css.sidebar;
  return (
    <aside style={sidebarStyle}>
      <div style={{ ...css.logo, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span>💰 <span style={{ color:G.blue }}>월 지출관리</span>
          <small style={{ display:"block", fontSize:10, fontWeight:400, color:G.tm, marginTop:2 }}>V2.7_Web</small>
        </span>
        {isMobile && (
          <button onClick={onClose}
            style={{ background:"none", border:"none", color:G.t2, fontSize:16, cursor:"pointer", padding:"2px 4px", fontFamily:"inherit" }}>✕</button>
        )}
      </div>

      {/* 년도 선택 */}
      <div style={css.secLbl}>년도 선택</div>
      <div style={{ padding:"2px 10px 10px" }}>
        <select value={year} onChange={e => onSelectYear(Number(e.target.value))}
          style={{ width:"100%", background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:8, color:G.t1, fontSize:13, fontWeight:600, padding:"7px 10px", fontFamily:"inherit", cursor:"pointer", appearance:"none", outline:"none" }}>
          {YEARS.map(y => (
            <option key={y} value={y} style={{ background:G.bg2 }}>{y}년{y===today.getFullYear()?" ✦":""}</option>
          ))}
        </select>
      </div>

      {/* 월 선택 */}
      <div style={css.secLbl}>월 선택</div>
      {MO.map((label, i) => {
        const m = i + 1;
        const isOn  = m === month;
        const isNow = isCurrentYear && m === today.getMonth() + 1;
        return (
          <button key={m} onClick={() => onSelectMonth(m)}
            style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:10, cursor:"pointer", color: isOn?G.blue:G.t2, fontSize:12, border:"none", background: isOn?G.blueDim:"none", fontWeight: isOn?600:400, fontFamily:"inherit", width:"100%", textAlign:"left" }}>
            <span style={{ width:20, height:20, borderRadius:5, background: isOn?G.blue:"rgba(255,255,255,0.06)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, flexShrink:0, color: isOn?"#fff":G.tm }}>{m}</span>
            {label}
            {isNow && <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:G.blue, color:"#fff", fontWeight:700, marginLeft:"auto" }}>오늘</span>}
          </button>
        );
      })}

      {/* 액션 버튼 */}
      <div style={{ marginTop:"auto", borderTop:`1px solid ${G.bd}`, paddingTop:10, display:"flex", flexDirection:"column", gap:2 }}>
        {[
          { icon:"🔒", label:"고정 항목 관리",    fn: onFixedTab,    col: G.t2     },
          { icon:"⬇️", label:"고정항목 내보내기", fn: onExportFixed, col: G.green  },
          { icon:"⬆️", label:"고정항목 가져오기", fn: onImport,      col: G.amber  },
          { icon:"📊", label:"통계 보기",         fn: onStats,       col: G.purple },
          { icon:"🧮", label:"계산기",             fn: onCalc, col: G.teal },
          { icon:"📤", label:"전체 내보내기(JSON)", fn: onExportAll,  col: G.blue   },
          { icon:"📥", label:"전체 가져오기(JSON)", fn: onImportAll,  col: G.amber  },
        ].map(({ icon, label, fn, col }) => (
          <button key={label} onClick={fn}
            style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:10, cursor:"pointer", color:col, fontSize:12, border:"none", background:"none", fontFamily:"inherit", width:"100%", textAlign:"left" }}>
            {icon} {label}
          </button>
        ))}
        <button onClick={onSync}
          style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:10, cursor:"pointer", fontSize:12, border:"none", fontFamily:"inherit", width:"100%", textAlign:"left",
            background: syncKey ? G.tealDim : "none",
            color: syncKey ? G.teal : G.t2 }}>
          🔄 기기 동기화
          {syncKey && (
            <span style={{ marginLeft:"auto", fontSize:9, padding:"1px 5px", borderRadius:3,
              background: syncStatus==="synced" ? G.greenDim : syncStatus==="syncing" ? G.blueDim : syncStatus==="error" ? G.redDim : "rgba(255,255,255,0.06)",
              color: syncStatus==="synced" ? G.green : syncStatus==="syncing" ? G.blue : syncStatus==="error" ? G.red : G.tm }}>
              {syncStatus==="synced" ? "동기화됨" : syncStatus==="syncing" ? "..." : syncStatus==="error" ? "오류" : "연결됨"}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────
//  SUMMARY CARD
// ─────────────────────────────────────────────
function SummaryCard({ label, badge, amount, color, sub, live, cardStyle, compact }) {
  return (
    <div style={{ ...css.scard, ...cardStyle }}>
      <div style={{ fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.8px", color:G.tm, marginBottom: compact ? 3 : 8, display:"flex", alignItems:"center", gap:5 }}>
        {badge} {label}
        {live && <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:G.greenDim, color:G.green, marginLeft:2 }}>실시간</span>}
      </div>
      <div style={{ fontSize: compact ? 14 : 20, fontWeight:700, letterSpacing:"-0.5px", marginBottom: compact ? 2 : 4, color }}>{amount}</div>
      <div style={{ fontSize: compact ? 9 : 11, color:G.tm }}>{sub}</div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  DAILY TAB
// ─────────────────────────────────────────────
function DailyTab({ year, month, today, dim, dayMap, balKb, balSh, carryover, refDay, onAddDay, onDelManual, onEditManual, compact }) {
  const isToday = (d) => year===today.getFullYear() && month===today.getMonth()+1 && d===today.getDate();
  const isPast  = (d) => new Date(year, month-1, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayRef = useRef();
  const scrollRef = useRef();
  useEffect(() => {
    if (!todayRef.current || !scrollRef.current) return;
    const row = todayRef.current;
    const container = scrollRef.current;
    const rowRect = row.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();
    const newTop = container.scrollTop + rowRect.top - contRect.top - container.clientHeight / 2 + rowRect.height / 2;
    container.scrollTop = Math.max(0, newTop);
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const thBase = { position:"sticky", top:0, background:G.bgc, padding: compact?"6px 8px":"9px 12px", fontSize:10, fontWeight:600, color:G.tm, textTransform:"uppercase", letterSpacing:"0.5px", borderBottom:`1px solid ${G.bd}`, whiteSpace:"nowrap" };

  return (
    <div ref={scrollRef} style={{ flex:1, minHeight:0, overflow:"auto", background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:14, marginBottom:16 }}>
      <table style={{ borderCollapse:"collapse", fontSize: compact?11:12, width:"100%", minWidth: compact?0:1026 }}>
        <colgroup>
          {compact ? (
            <><col style={{ width:50 }} /><col /><col style={{ width:65 }} /><col style={{ width:60 }} /></>
          ) : (
            <><col style={{ width:90 }} /><col style={{ width:150 }} /><col style={{ width:120 }} /><col style={{ width:150 }} />
            <col style={{ width:82 }} /><col style={{ width:82 }} />
            <col style={{ width:102 }} /><col style={{ width:102 }} /><col style={{ width:102 }} />
            <col style={{ width:46 }} /></>
          )}
        </colgroup>
        <thead>
          <tr>
            {(compact
              ? ["날짜","지출 내역","일 지출","잔액"]
              : ["날짜","수입 내역","이체 내역","지출 내역","일 수입","일 지출","국민 잔액","신한 잔액","합계","추가"]
            ).map((h, i) => (
              <th key={h} style={{
                ...thBase,
                textAlign: compact?(i>=2?"right":"left"):(i>=4&&i<=8?"right":"left"),
                ...(!compact && i===0 ? { left:0, zIndex:4 } : { zIndex:3 }),
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: dim }, (_, i) => i + 1).map(d => {
            const dt  = new Date(year, month - 1, d);
            const dow = dt.getDay();
            const isTd  = isToday(d);
            const isPst = isPast(d);
            const dayInc = dayMap[d].inc.reduce((s, it) => s + it.amount, 0);
            const dayExp = dayMap[d].exp.reduce((s, it) => s + it.amount, 0);
            const kbB  = balKb[d] ?? null;
            const shB  = balSh[d] ?? null;
            const totB = kbB !== null && shB !== null ? kbB + shB : null;

            return (
              <tr key={d} ref={isTd ? todayRef : null}
                style={{ background: isTd?"rgba(74,158,255,0.07)":"", ...(isPst?{opacity:0.55}:{}) }}>
                <td style={{
                  padding: compact?"6px 8px":"8px 12px", borderBottom:`1px solid ${G.bdl}`, whiteSpace:"nowrap", fontWeight:600,
                  ...(!compact ? { position:"sticky", left:0, zIndex:1, background: isTd?"rgba(74,158,255,0.07)":G.bgc } : {}),
                }}>
                  {isTd && <PulseDot />}
                  <WeekDay dow={dow} />
                  <span style={{ color: isTd?G.blue:undefined }}>{d}</span>
                  {d === 1 && carryover.hasData && <span style={{ fontSize:8, padding:"1px 4px", borderRadius:3, background:G.blueDim, color:G.blue, marginLeft:3 }}>이월</span>}
                </td>
                {!compact && <td style={{ padding:"8px 12px", borderBottom:`1px solid ${G.bdl}` }}>
                  <Tags items={dayMap[d].inc} typeOverride="inc" onDel={onDelManual} onEdit={onEditManual} />
                </td>}
                {!compact && <td style={{ padding:"8px 12px", borderBottom:`1px solid ${G.bdl}` }}>
                  <TransferTags items={dayMap[d].trs} onDel={onDelManual} onEdit={onEditManual} />
                </td>}
                <td style={{ padding: compact?"6px 8px":"8px 12px", borderBottom:`1px solid ${G.bdl}` }}>
                  <Tags items={dayMap[d].exp} typeOverride="exp" onDel={onDelManual} onEdit={onEditManual} />
                </td>
                {!compact && <NumCell val={dayInc} prefix="+" color={G.green} zero />}
                <NumCell val={dayExp} prefix="-" color={G.red} zero compact={compact} />
                {!compact && <BalCell val={kbB} />}
                {!compact && <BalCell val={shB} />}
                {!compact && <BalCell val={totB} bold />}
                {compact && <BalCell val={totB} bold compact />}
                {!compact && <td style={{ padding:"8px 12px", borderBottom:`1px solid ${G.bdl}` }}>
                  <button onClick={() => onAddDay(d)}
                    style={{ display:"inline-flex", alignItems:"center", gap:2, padding:"2px 7px", borderRadius:12, fontSize:10, cursor:"pointer", border:`1px dashed rgba(255,255,255,0.12)`, background:"none", color:G.tm, fontFamily:"inherit" }}>
                    ＋
                  </button>
                </td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────
//  LEDGER TAB (월별 지출 내역)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  FIXED TAB
// ─────────────────────────────────────────────
function FixedTab({ fixed, onUpdate, onDel, onAdd }) {
  const sorted = [...fixed].sort((a, b) => a.day - b.day);
  const inSt  = { width:"100%", background:"none", border:"none", color:G.t1, fontSize:12, fontFamily:"inherit", outline:"none" };
  const selSt = { ...inSt, cursor:"pointer", appearance:"none" };
  const thSt  = { position:"sticky", top:0, background:G.bgc, padding:"9px 12px", fontSize:10, fontWeight:600, color:G.tm, textTransform:"uppercase", letterSpacing:"0.5px", borderBottom:`1px solid ${G.bd}`, whiteSpace:"nowrap" };
  const tdSt  = { padding:"8px 10px", fontSize:12, borderBottom:`1px solid ${G.bdl}` };

  return (
    <div style={{ flex:1, minHeight:0, overflow:"auto", background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:14, marginBottom:16 }}>
      <table style={{ borderCollapse:"collapse", fontSize:12, width:"100%", minWidth:538 }}>
        <colgroup>
          <col style={{ width:46 }} /><col /><col style={{ width:110 }} /><col style={{ width:110 }} /><col style={{ width:72 }} /><col style={{ width:50 }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...thSt, position:"sticky", left:0, zIndex:4 }}>일</th>
            <th style={{ ...thSt, zIndex:3 }}>항목명</th>
            <th style={{ ...thSt, zIndex:3 }}>자산</th>
            <th style={{ ...thSt, zIndex:3, textAlign:"right" }}>금액(원)</th>
            <th style={{ ...thSt, zIndex:3 }}>구분</th>
            <th style={{ ...thSt, zIndex:3 }}>삭제</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(fi => {
            const isInc    = fi.type === "income";
            const rowCol   = isInc ? G.red : G.t1;
            const rowBg    = isInc ? G.redDim : G.bgc;
            const rowInSt  = { ...inSt,  color:rowCol };
            const rowSelSt = { ...selSt, color:rowCol };
            return (
              <tr key={fi.id} style={{ background: isInc ? G.redDim : "transparent" }}>
                <td style={{ ...tdSt, position:"sticky", left:0, zIndex:1, background:rowBg }}>
                  <input style={{...rowInSt,width:36,textAlign:"center"}} type="number" min={1} max={31} defaultValue={fi.day} onBlur={e=>onUpdate(fi.id,"day",e.target.value)} />
                </td>
                <td style={tdSt}><input style={rowInSt} type="text" defaultValue={fi.name} onBlur={e=>onUpdate(fi.id,"name",e.target.value)} /></td>
                <td style={tdSt}>
                  <select style={rowSelSt} defaultValue={fi.asset} onChange={e=>onUpdate(fi.id,"asset",e.target.value)}>
                    {ASSETS.map(a => <option key={a} style={{ background:G.bg2 }}>{a}</option>)}
                  </select>
                </td>
                <td style={{ ...tdSt, textAlign:"right" }}><CommaInput style={{...rowInSt,textAlign:"right"}} value={fi.amount} onBlur={v=>onUpdate(fi.id,"amount",v)} /></td>
                <td style={tdSt}>
                  <select style={rowSelSt} defaultValue={fi.type} onChange={e=>onUpdate(fi.id,"type",e.target.value)}>
                    <option value="income"  style={{ background:G.bg2 }}>수입</option>
                    <option value="expense" style={{ background:G.bg2 }}>지출</option>
                  </select>
                </td>
                <td style={tdSt}>
                  <button onClick={() => onDel(fi.id)} style={{ padding:"3px 6px", borderRadius:6, background:"none", border:"none", color:G.tm, cursor:"pointer", fontSize:11, fontFamily:"inherit" }}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button onClick={onAdd} style={{ display:"flex", alignItems:"center", gap:5, padding:"9px 12px", background:"none", border:"none", color:G.tm, fontSize:12, cursor:"pointer", fontFamily:"inherit", width:"100%" }}>
        ＋ 새 고정 항목 추가
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
//  ADD MODAL
// ─────────────────────────────────────────────
function AddModal({ year, month, initDay, onSave, onClose }) {
  const [form, setForm] = useState({
    date: `${year}-${pad(month)}-${pad(initDay)}`,
    name: "", amount: "", type: "expense", asset: "KB국민은행",
    fromAsset: "KB국민은행", toAsset: "신한은행", memo: ""
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = () => {
    if (!form.date || !form.name.trim()) return;
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return;
    const [y, m, d] = form.date.split("-").map(Number);
    if (form.type === "transfer") {
      if (form.fromAsset === form.toAsset) return;
      onSave({ _year: y, _month: m, day: d, name: form.name.trim(), amount: amt, type: "transfer", fromAsset: form.fromAsset, toAsset: form.toAsset, memo: form.memo });
    } else {
      onSave({ _year: y, _month: m, day: d, name: form.name.trim(), amount: amt, type: form.type, asset: form.asset, memo: form.memo });
    }
  };

  const fgSt  = { marginBottom:12 };
  const lblSt = { fontSize:11, fontWeight:500, color:G.t2, marginBottom:5, display:"block" };
  const inSt  = { width:"100%", padding:"8px 11px", background:G.bg2, border:`1px solid ${G.bd}`, borderRadius:10, color:G.t1, fontSize:12, fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
  const selSt = { ...inSt, appearance:"none" };

  return (
    <div style={css.overlay} onClick={onClose}>
      <div style={css.modal} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:18, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          항목 추가 <XBtn onClick={onClose} />
        </div>
        <div style={fgSt}><label style={lblSt}>날짜</label><input type="date" style={inSt} value={form.date} onChange={e=>set("date",e.target.value)} /></div>
        <div style={fgSt}><label style={lblSt}>내용(항목명)</label><input type="text" style={inSt} placeholder="예: 외식비, 이체..." value={form.name} onChange={e=>set("name",e.target.value)} /></div>
        <div style={fgSt}><label style={lblSt}>금액(원)</label><CommaInput style={inSt} value={form.amount} onChange={v=>set("amount",v)} /></div>
        <div style={fgSt}>
          <label style={lblSt}>구분</label>
          <div style={{ display:"flex", gap:6 }}>
            {[["income","▲ 수입",G.green,G.greenDim],["expense","▼ 지출",G.red,G.redDim],["transfer","⇄ 이체",G.teal,G.tealDim]].map(([val,label,col,bg]) => (
              <label key={val} onClick={() => set("type", val)}
                style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:5, padding:7, borderRadius:10, border:`1px solid ${form.type===val?"rgba(255,255,255,0.2)":G.bd}`, cursor:"pointer", fontSize:12, fontWeight:500, background: form.type===val?bg:"none", color: form.type===val?col:G.t2 }}>
                <input type="radio" name="mType" value={val} checked={form.type===val} onChange={()=>set("type",val)} style={{ display:"none" }} />
                {label}
              </label>
            ))}
          </div>
        </div>
        {form.type === "transfer" ? (
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", alignItems:"center", gap:6, marginBottom:12 }}>
            <div>
              <label style={lblSt}>출금 자산</label>
              <select style={selSt} value={form.fromAsset} onChange={e=>set("fromAsset",e.target.value)}>
                {ASSETS.map(a => <option key={a} style={{ background:G.bg2 }}>{a}</option>)}
              </select>
            </div>
            <span style={{ color:G.teal, fontSize:16, marginTop:18 }}>→</span>
            <div>
              <label style={lblSt}>입금 자산</label>
              <select style={selSt} value={form.toAsset} onChange={e=>set("toAsset",e.target.value)}>
                {ASSETS.map(a => <option key={a} style={{ background:G.bg2 }}>{a}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div style={fgSt}>
            <label style={lblSt}>자산(은행/카드)</label>
            <select style={selSt} value={form.asset} onChange={e=>set("asset",e.target.value)}>
              {ASSETS.map(a => <option key={a} style={{ background:G.bg2 }}>{a}</option>)}
            </select>
          </div>
        )}
        <div style={fgSt}><label style={lblSt}>기타(메모)</label><input type="text" style={inSt} placeholder="선택" value={form.memo} onChange={e=>set("memo",e.target.value)} /></div>
        <div style={{ display:"flex", gap:6, marginTop:18 }}>
          <Btn style={{ flex:1, justifyContent:"center" }} onClick={onClose}>취소</Btn>
          <Btn variant="primary" style={{ flex:1, justifyContent:"center" }} onClick={save}>저장</Btn>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  BANK MODAL
// ─────────────────────────────────────────────
function BankModal({ bank, year, month, dim, onSave, onClose }) {
  const today = new Date();
  const initDay = (() => {
    if (bank.date) {
      const bd = new Date(bank.date);
      if (bd.getFullYear() === year && bd.getMonth() + 1 === month) return bd.getDate();
    }
    if (year === today.getFullYear() && month === today.getMonth() + 1) return today.getDate();
    return 1;
  })();
  const [kb,  setKb]  = useState(bank.kb || 0);
  const [sh,  setSh]  = useState(bank.sh || 0);
  const [day, setDay] = useState(initDay);
  const inSt = { width:"100%", padding:"8px 11px", background:G.bg2, border:`1px solid ${G.bd}`, borderRadius:10, color:G.t1, fontSize:12, fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
  const clampDay = (v) => Math.min(Math.max(Number(v) || 1, 1), dim);
  return (
    <div style={css.overlay} onClick={onClose}>
      <div style={css.modal} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:18, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          🏦 잔액 기준일 설정 <XBtn onClick={onClose} />
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:11, fontWeight:500, color:G.t2, marginBottom:5, display:"block" }}>
            기준 날짜 <span style={{ color:G.blue }}>({year}년 {month}월</span> <span style={{ color:G.t2 }}>1~{dim}일)</span>
          </label>
          <input type="number" min={1} max={dim} style={inSt} value={day}
            onChange={e => setDay(Number(e.target.value))}
            onBlur={e => setDay(clampDay(e.target.value))} />
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:11, fontWeight:500, color:G.t2, marginBottom:5, display:"flex", alignItems:"center", gap:5 }}>
            <BankBadge type="kb" /> 국민은행 잔액(원)
          </label>
          <CommaInput style={inSt} value={kb} onChange={setKb} />
        </div>
        <div style={{ marginBottom:12 }}>
          <label style={{ fontSize:11, fontWeight:500, color:G.t2, marginBottom:5, display:"flex", alignItems:"center", gap:5 }}>
            <BankBadge type="sh" /> 신한은행 잔액(원)
          </label>
          <CommaInput style={inSt} value={sh} onChange={setSh} />
        </div>
        <p style={{ fontSize:11, color:G.tm, margin:"0 0 4px" }}>* 지정한 날짜를 기준으로 전후 날짜 예상 잔액이 자동 계산됩니다</p>
        <p style={{ fontSize:11, color:G.tm, margin:"0 0 16px" }}>* 다음 달에는 이 잔액이 이월 금액으로 자동 반영됩니다</p>
        <div style={{ display:"flex", gap:6, marginTop:18 }}>
          <Btn style={{ flex:1, justifyContent:"center" }} onClick={onClose}>취소</Btn>
          <Btn variant="primary" style={{ flex:1, justifyContent:"center" }} onClick={() => onSave(kb||0, sh||0, clampDay(day))}>저장</Btn>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  EDIT ROW MODAL
// ─────────────────────────────────────────────
function EditRowModal({ row, rKey, dim, onSave, onClose }) {
  const isTr     = !!row.isTransfer;
  const isIncome = !isTr && (row.income || 0) > 0;
  const [form, setForm] = useState(isTr ? {
    day: String(row.day), name: row.name || "",
    amount: String(row.amount || 0),
    fromAsset: row.fromAsset || "KB국민은행", toAsset: row.toAsset || "신한은행", memo: row.memo || "",
  } : {
    day: String(row.day), name: row.name || "",
    amount: String(isIncome ? (row.income || 0) : (row.expense || 0)),
    type: isIncome ? "income" : "expense", asset: row.asset || "KB국민은행", memo: row.memo || "",
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = () => {
    if (!form.name.trim()) return;
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return;
    const d = Math.min(Math.max(Number(form.day) || 1, 1), dim);
    if (isTr) {
      if (form.fromAsset === form.toAsset) return;
      onSave(rKey, row.id, { day: d, name: form.name.trim(), fromAsset: form.fromAsset, toAsset: form.toAsset, amount: amt, memo: form.memo });
    } else {
      onSave(rKey, row.id, { day: d, name: form.name.trim(), asset: form.asset, expense: form.type==="expense"?amt:0, income: form.type==="income"?amt:0, memo: form.memo });
    }
  };

  const fgSt  = { marginBottom:12 };
  const lblSt = { fontSize:11, fontWeight:500, color:G.t2, marginBottom:5, display:"block" };
  const inSt  = { width:"100%", padding:"8px 11px", background:G.bg2, border:`1px solid ${G.bd}`, borderRadius:10, color:G.t1, fontSize:12, fontFamily:"inherit", outline:"none", boxSizing:"border-box" };
  const selSt = { ...inSt, appearance:"none" };

  return (
    <div style={css.overlay} onClick={onClose}>
      <div style={css.modal} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:18, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          {isTr ? "이체 수정" : "항목 수정"} <XBtn onClick={onClose} />
        </div>
        <div style={fgSt}>
          <label style={lblSt}>일(1~{dim})</label>
          <input type="number" min={1} max={dim} style={inSt} value={form.day} onChange={e=>set("day",e.target.value)} />
        </div>
        <div style={fgSt}><label style={lblSt}>내용(항목명)</label><input type="text" style={inSt} value={form.name} onChange={e=>set("name",e.target.value)} /></div>
        <div style={fgSt}><label style={lblSt}>금액(원)</label><CommaInput style={inSt} value={form.amount} onChange={v=>set("amount",v)} /></div>
        {isTr ? (
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", alignItems:"center", gap:6, marginBottom:12 }}>
            <div>
              <label style={lblSt}>출금 자산</label>
              <select style={selSt} value={form.fromAsset} onChange={e=>set("fromAsset",e.target.value)}>
                {ASSETS.map(a => <option key={a} style={{ background:G.bg2 }}>{a}</option>)}
              </select>
            </div>
            <span style={{ color:G.teal, fontSize:16, marginTop:18 }}>→</span>
            <div>
              <label style={lblSt}>입금 자산</label>
              <select style={selSt} value={form.toAsset} onChange={e=>set("toAsset",e.target.value)}>
                {ASSETS.map(a => <option key={a} style={{ background:G.bg2 }}>{a}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <>
            <div style={fgSt}>
              <label style={lblSt}>구분</label>
              <div style={{ display:"flex", gap:6 }}>
                {[["income","▲ 수입",G.green,G.greenDim],["expense","▼ 지출",G.red,G.redDim]].map(([val,label,col,bg]) => (
                  <label key={val} onClick={() => set("type", val)}
                    style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:5, padding:7, borderRadius:10, border:`1px solid ${form.type===val?"rgba(255,255,255,0.2)":G.bd}`, cursor:"pointer", fontSize:12, fontWeight:500, background: form.type===val?bg:"none", color: form.type===val?col:G.t2 }}>
                    <input type="radio" name="eType" value={val} checked={form.type===val} onChange={()=>set("type",val)} style={{ display:"none" }} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <div style={fgSt}>
              <label style={lblSt}>자산(은행/카드)</label>
              <select style={selSt} value={form.asset} onChange={e=>set("asset",e.target.value)}>
                {ASSETS.map(a => <option key={a} style={{ background:G.bg2 }}>{a}</option>)}
              </select>
            </div>
          </>
        )}
        <div style={fgSt}><label style={lblSt}>기타(메모)</label><input type="text" style={inSt} placeholder="선택" value={form.memo} onChange={e=>set("memo",e.target.value)} /></div>
        <div style={{ display:"flex", gap:6, marginTop:18 }}>
          <Btn style={{ flex:1, justifyContent:"center" }} onClick={onClose}>취소</Btn>
          <Btn variant="primary" style={{ flex:1, justifyContent:"center" }} onClick={save}>수정 저장</Btn>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
//  STATS OVERLAY
// ─────────────────────────────────────────────
function StatsOverlay({ year, month, statYear, setStatYear, data, fixedVersions, statTab, onTabChange, onClose, getMonthTotals }) {
  const [statMonth, setStatMonth] = useState(month);

  const collectMonth = useCallback((y, m) => {
    const r = data[mKey(y, m)]?.rows || [];
    let inc = 0, exp = 0;
    const nameMap = {}, assetMap = {}, incAssetMap = {};
    r.forEach(x => {
      if (x.isSub) return;
      inc += (x.income || 0); exp += (x.expense || 0);
      if ((x.expense || 0) > 0) {
        nameMap[x.name] = (nameMap[x.name] || 0) + x.expense;
        assetMap[x.asset || "기타"] = (assetMap[x.asset || "기타"] || 0) + x.expense;
      }
      if ((x.income || 0) > 0) {
        incAssetMap[x.asset || "기타"] = (incAssetMap[x.asset || "기타"] || 0) + x.income;
      }
    });
    const d = daysInMonth(y, m);
    fixedForMonth(fixedVersions, y, m).forEach(fi => {
      if (fi.day < 1 || fi.day > d || !(fi.amount > 0)) return;
      if (fi.type === "income") { inc += fi.amount; incAssetMap[fi.asset||"기타"]=(incAssetMap[fi.asset||"기타"]||0)+fi.amount; }
      else { exp += fi.amount; nameMap[fi.name] = (nameMap[fi.name]||0)+fi.amount; assetMap[fi.asset||"기타"]=(assetMap[fi.asset||"기타"]||0)+fi.amount; }
    });
    return { inc, exp, nameMap, assetMap, incAssetMap };
  }, [data, fixedVersions]);

  const collectDay = useCallback((y, m, d) => {
    const rows = data[mKey(y, m)]?.rows || [];
    let inc = 0, exp = 0;
    rows.forEach(r => {
      if (r.isSub || r.day !== d) return;
      inc += (r.income || 0); exp += (r.expense || 0);
    });
    fixedForMonth(fixedVersions, y, m).forEach(fi => {
      if (fi.day !== d || !(fi.amount > 0)) return;
      if (fi.type === "income") inc += fi.amount; else exp += fi.amount;
    });
    return { inc, exp };
  }, [data, fixedVersions]);

  const stats = useMemo(() => {
    let totInc = 0, totExp = 0;
    const nameMap = {}, assetMap = {}, incAssetMap = {};
    if (statTab === "year") {
      for (let m = 1; m <= 12; m++) {
        const md = collectMonth(statYear, m);
        totInc += md.inc; totExp += md.exp;
        Object.entries(md.nameMap).forEach(([k,v]) => nameMap[k]=(nameMap[k]||0)+v);
        Object.entries(md.assetMap).forEach(([k,v]) => assetMap[k]=(assetMap[k]||0)+v);
        Object.entries(md.incAssetMap).forEach(([k,v]) => incAssetMap[k]=(incAssetMap[k]||0)+v);
      }
    } else {
      const md = collectMonth(statYear, statMonth);
      totInc = md.inc; totExp = md.exp;
      Object.assign(nameMap, md.nameMap); Object.assign(assetMap, md.assetMap); Object.assign(incAssetMap, md.incAssetMap);
    }
    return { totInc, totExp, nameMap, assetMap, incAssetMap };
  }, [statTab, statYear, statMonth, collectMonth]);

  // 년 통계: 월별 수입/지출 추이
  const yearLineData = useMemo(() =>
    MO.map((label, i) => {
      const { inc, exp } = collectMonth(statYear, i + 1);
      return { name: label, 지출: exp, 수입: inc };
    }), [statYear, collectMonth]);

  // 월 통계: 일별 수입/지출 추이
  const monthLineData = useMemo(() => {
    if (statTab !== "month") return [];
    const dim = daysInMonth(statYear, statMonth);
    return Array.from({ length: dim }, (_, i) => {
      const d = i + 1;
      const { inc, exp } = collectDay(statYear, statMonth, d);
      return { name: String(d), 지출: exp, 수입: inc };
    });
  }, [statTab, statYear, statMonth, collectDay]);

  const lineData = statTab === "year" ? yearLineData : monthLineData;

  const { totInc, totExp, nameMap, assetMap, incAssetMap } = stats;
  const net = totInc - totExp;
  const nameEntries     = Object.entries(nameMap).sort((a,b) => b[1]-a[1]).slice(0, 10);
  const assetEntries    = Object.entries(assetMap).sort((a,b) => b[1]-a[1]).slice(0, 8);
  const incAssetEntries = Object.entries(incAssetMap).sort((a,b) => b[1]-a[1]).slice(0, 8);
  const maxV = nameEntries[0]?.[1] || 1;

  const pieData    = assetEntries.map(([name, val]) => ({ name, value: val }));
  const incPieData = incAssetEntries.map(([name, val]) => ({ name, value: val }));
  const cardSt   = { background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:14, padding:"14px 16px" };
  const tabSt    = (on) => ({ padding:"5px 12px", borderRadius:6, fontSize:12, fontWeight:500, cursor:"pointer", border:"none", background: on?G.blue:"none", color: on?"#fff":G.t2, fontFamily:"inherit" });
  const selSt    = { background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:8, color:G.t1, fontSize:13, padding:"6px 10px", fontFamily:"inherit", cursor:"pointer", outline:"none" };
  const trendTitle = statTab === "year"
    ? `${statYear}년 월별 수입/지출 추이`
    : `${statYear}년 ${statMonth}월 일별 수입/지출 추이`;

  return (
    <div style={css.statsOv}>
      <div style={css.statsIn}>
        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
          <div style={{ fontSize:20, fontWeight:700, letterSpacing:"-0.5px" }}>📊 지출 통계</div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {/* 년/월 탭 */}
            <div style={{ display:"flex", gap:3, background:G.bg2, border:`1px solid ${G.bd}`, borderRadius:10, padding:3 }}>
              <button style={tabSt(statTab==="year")}  onClick={() => onTabChange("year")}>년 통계</button>
              <button style={tabSt(statTab==="month")} onClick={() => onTabChange("month")}>월 통계</button>
            </div>
            {/* 연도 선택 */}
            <select value={statYear} onChange={e => setStatYear(Number(e.target.value))} style={selSt}>
              {YEARS.map(y => <option key={y} value={y} style={{ background:G.bg2 }}>{y}년</option>)}
            </select>
            {/* 월 선택 (월 통계 모드에서만) */}
            {statTab === "month" && (
              <select value={statMonth} onChange={e => setStatMonth(Number(e.target.value))} style={selSt}>
                {MO.map((label, i) => <option key={i+1} value={i+1} style={{ background:G.bg2 }}>{label}</option>)}
              </select>
            )}
            <Btn onClick={onClose}>✕ 닫기</Btn>
          </div>
        </div>

        {/* 요약 카드 */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10, marginBottom:18 }}>
          {[["총 수입", fmtW(totInc), G.green], ["총 지출", fmtW(totExp), G.red], ["순 잔액", fmtW(net), net>=0?G.green:G.red], ["항목 수", Object.keys(nameMap).length+"종", G.blue]].map(([lbl, val, col]) => (
            <div key={lbl} style={cardSt}>
              <div style={{ fontSize:10, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.7px", color:G.tm, marginBottom:7 }}>{lbl}</div>
              <div style={{ fontSize:18, fontWeight:700, letterSpacing:"-0.5px", color:col }}>{val}</div>
            </div>
          ))}
        </div>

        {/* 파이 차트 2개 (지출 / 수입) */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
          <div style={cardSt}>
            <div style={{ fontSize:12, fontWeight:600, color:G.t1, marginBottom:14 }}>자산별 지출 비율</div>
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {pieData.map((_, i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={v => fmt(v)+"원"} contentStyle={{ background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:8, fontSize:11, color:G.t1 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 10px", marginTop:8 }}>
                  {assetEntries.map(([name], i) => (
                    <span key={name} style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, color:G.t2 }}>
                      <span style={{ width:8, height:8, borderRadius:2, background:COLORS[i%COLORS.length], flexShrink:0 }} />{name}
                    </span>
                  ))}
                </div>
              </>
            ) : <div style={{ fontSize:12, color:G.tm, padding:"40px 0", textAlign:"center" }}>데이터 없음</div>}
          </div>
          <div style={cardSt}>
            <div style={{ fontSize:12, fontWeight:600, color:G.t1, marginBottom:14 }}>자산별 수입 비율</div>
            {incPieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={incPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
                      {incPieData.map((_, i) => <Cell key={i} fill={COLORS[i%COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={v => fmt(v)+"원"} contentStyle={{ background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:8, fontSize:11, color:G.t1 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 10px", marginTop:8 }}>
                  {incAssetEntries.map(([name], i) => (
                    <span key={name} style={{ display:"flex", alignItems:"center", gap:4, fontSize:10, color:G.t2 }}>
                      <span style={{ width:8, height:8, borderRadius:2, background:COLORS[i%COLORS.length], flexShrink:0 }} />{name}
                    </span>
                  ))}
                </div>
              </>
            ) : <div style={{ fontSize:12, color:G.tm, padding:"40px 0", textAlign:"center" }}>데이터 없음</div>}
          </div>
        </div>

        {/* 트렌드 차트 (전체 너비) */}
        <div style={{ ...cardSt, marginBottom:14 }}>
          <div style={{ fontSize:12, fontWeight:600, color:G.t1, marginBottom:14 }}>{trendTitle}</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={lineData} margin={{ top:5, right:10, left:0, bottom:5 }}>
              <XAxis dataKey="name" tick={{ fill:G.tm, fontSize:10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:G.tm, fontSize:10 }} axisLine={false} tickLine={false} tickFormatter={v=>(v/10000).toFixed(0)+"만"} width={40} />
              <Tooltip formatter={v=>fmt(v)+"원"} contentStyle={{ background:G.bgc, border:`1px solid ${G.bd}`, borderRadius:8, fontSize:11, color:G.t1 }} />
              <Line type="monotone" dataKey="지출" stroke={G.red}   strokeWidth={2} dot={{ fill:G.red,   r:3 }} activeDot={{ r:5 }} />
              <Line type="monotone" dataKey="수입" stroke={G.green} strokeWidth={2} dot={{ fill:G.green, r:3 }} activeDot={{ r:5 }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display:"flex", gap:16, marginTop:8, fontSize:11 }}>
            <span style={{ display:"flex", alignItems:"center", gap:5, color:G.t2 }}><span style={{ width:10, height:3, borderRadius:2, background:G.red,   display:"inline-block" }}/>지출</span>
            <span style={{ display:"flex", alignItems:"center", gap:5, color:G.t2 }}><span style={{ width:10, height:3, borderRadius:2, background:G.green, display:"inline-block" }}/>수입</span>
          </div>
        </div>

        {/* 항목별 상세 */}
        <div style={cardSt}>
          <div style={{ fontSize:12, fontWeight:600, color:G.t1, marginBottom:14 }}>항목별 지출 상세</div>
          {nameEntries.length === 0 && <div style={{ fontSize:12, color:G.tm, padding:"8px 0" }}>지출 데이터가 없습니다</div>}
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {nameEntries.map(([name, val], i) => {
              const pct = totExp > 0 ? Math.round(val / totExp * 100) : 0;
              return (
                <div key={name} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12 }}>
                  <span style={{ width:7, height:7, borderRadius:"50%", background:COLORS[i%COLORS.length], flexShrink:0 }} />
                  <span style={{ color:G.t2, flex:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{name}</span>
                  <div style={{ flex:2, height:3, background:"rgba(255,255,255,0.06)", borderRadius:2 }}>
                    <div style={{ width:`${Math.round(val/maxV*100)}%`, height:"100%", borderRadius:2, background:COLORS[i%COLORS.length] }} />
                  </div>
                  <span style={{ fontWeight:500, color:G.t1, whiteSpace:"nowrap" }}>{fmt(val)}원</span>
                  <span style={{ color:G.tm, fontSize:10, width:28, textAlign:"right" }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
