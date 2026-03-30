/**
 * 자동 재인덱싱 테스트 - 오래된 인덱스 시뮬레이션
 */

import { getScheduler } from './src/index/autoIndexScheduler.js';
import { utimesSync, statSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDocumentsIndexPath } = require('./src/config/runtimePaths.cjs');

console.log('=== 자동 재인덱싱 테스트 (오래된 인덱스) ===\n');

const INDEX_FILE = getDocumentsIndexPath();

// 현재 인덱스 파일 시간 확인
const currentStats = statSync(INDEX_FILE);
console.log('현재 인덱스 파일 수정 시간:', currentStats.mtime.toISOString());
console.log('');

// 인덱스 파일 시간을 7시간 전으로 변경 (기준은 6시간)
const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
console.log('인덱스 파일 시간을 7시간 전으로 변경:', sevenHoursAgo.toISOString());
utimesSync(INDEX_FILE, sevenHoursAgo, sevenHoursAgo);
console.log('✓ 변경 완료\n');

// 스케줄러 생성
const scheduler = getScheduler();

// 상태 콜백 등록
scheduler.setStatusCallback((status) => {
  console.log('[Status Update]');
  console.log('  상태:', status.status);
  if (status.reason) console.log('  이유:', status.reason);
  if (status.duration) console.log('  소요 시간:', status.duration);
  if (status.error) console.log('  에러:', status.error);
  console.log('');

  // 완료 시 종료
  if (status.status === 'completed') {
    console.log('✅ 자동 재인덱싱 완료! 테스트 종료.');
    process.exit(0);
  }
  if (status.status === 'error') {
    console.log('❌ 자동 재인덱싱 실패! 테스트 종료.');
    process.exit(1);
  }
});

// 설정 확인
console.log('설정:', scheduler.config);
console.log('');

// 인덱스가 오래되었는지 확인
console.log('인덱스 오래됨 여부:', scheduler.isIndexOld());
console.log('');

// 즉시 점검 실행 (스케줄러 시작 대신)
console.log('즉시 재인덱싱 점검 실행...\n');
scheduler.checkAndReindex();

console.log('재인덱싱 진행 중... (시간이 걸릴 수 있습니다)\n');

// 타임아웃 설정 (5분)
setTimeout(() => {
  console.log('⏱️ 타임아웃: 5분 경과');
  process.exit(1);
}, 5 * 60 * 1000);
