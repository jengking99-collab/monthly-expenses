/**
 * Electron 빌드 스크립트
 *
 * - 버전 폴더: package.json version 기준 (0.2.0 → releases/v02)
 * - 빌드 실패 시 suffix 자동 증가 (v02 → v02b → v02c → ...)
 * - 성공한 경로를 package.json에 저장
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

// Electron 빌드임을 vite.config.js에 알림 (base: './' 적용)
process.env.VITE_ELECTRON = '1';

const PKG_PATH  = './package.json';
const SUFFIXES  = ['', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];

const loadPkg = () => JSON.parse(readFileSync(PKG_PATH, 'utf8'));
const savePkg = (pkg) => writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
const isWin   = process.platform === 'win32';
// Windows: cmd.exe /c npx 방식으로 .cmd 스크립트 안정 실행
const run = (args) =>
  isWin
    ? spawnSync('cmd.exe', ['/c', 'npx', ...args], { stdio: 'inherit' })
    : spawnSync('npx', args, { stdio: 'inherit' });

/** "0.2.0" → "v02" / "0.10.0" → "v010" / "1.0.0" → "v10" */
function versionToFolder(version) {
  const [major = '0', minor = '0'] = version.split('.');
  return `v${major}${minor}`;
}

// ── 1. Vite 렌더러 빌드 ──────────────────────────────
console.log('\n📦 Vite 렌더러 빌드...\n');
const vite = run(['vite', 'build']);
if (vite.status !== 0) {
  console.error('\n❌ Vite 빌드 실패');
  process.exit(1);
}

// ── 2. Electron 패키징 (실패 시 suffix 자동 증가) ───────
const pkg         = loadPkg();
const baseFolder  = versionToFolder(pkg.version);   // e.g. "v02"
const savedOutput = pkg.build.directories.output;   // 기존 저장값 백업

console.log(`\n🗂  버전 폴더 기준: releases/${baseFolder}`);

let built = false;

for (const suffix of SUFFIXES) {
  const outputDir = `releases/${baseFolder}${suffix}`;
  console.log(`\n🔨 패키징 시도: ${outputDir}`);

  pkg.build.directories.output = outputDir;
  savePkg(pkg);

  const result = run(['electron-builder', '--win']);

  if (result.status === 0) {
    console.log(`\n✅ 빌드 완료 → ${outputDir}/`);
    built = true;
    break;
  }

  console.log(`  ⚠️  실패 → 다음 suffix 시도`);
}

// 모두 실패 시 원래 경로 복원
if (!built) {
  pkg.build.directories.output = savedOutput;
  savePkg(pkg);
  console.error('\n❌ 모든 경로에서 빌드 실패');
  process.exit(1);
}
