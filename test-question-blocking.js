/**
 * 질문 실행 중 재인덱싱 지연 테스트
 */

import { getScheduler } from './src/index/autoIndexScheduler.js';
import { utimesSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getDocumentsIndexPath } = require('./src/config/runtimePaths.cjs');

console.log('=== 질문 실행 중 재인덱싱 지연 테스트 ===\n');

const INDEX_FILE = getDocumentsIndexPath();

// 인덱스 파일 시간을 7시간 전으로 변경 (재인덱싱 필요 상태로 만들기)
const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
console.log('1. 인덱스 파일 시간을 7시간 전으로 변경:', sevenHoursAgo.toISOString());
utimesSync(INDEX_FILE, sevenHoursAgo, sevenHoursAgo);
console.log('   ✓ 변경 완료\n');

// 스케줄러 생성
const scheduler = getScheduler();

let statusUpdates = [];

// 상태 콜백 등록
scheduler.setStatusCallback((status) => {
  statusUpdates.push(status);
  console.log('[Status Update]');
  console.log('  상태:', status.status);
  if (status.reason) console.log('  이유:', status.reason);
  console.log('');
});

console.log('2. 질문 실행 상태를 TRUE로 설정 (질문 실행 중으로 시뮬레이션)\n');
scheduler.setQuestionRunning(true);

console.log('3. 재인덱싱 점검 실행 (이때 재인덱싱이 미뤄져야 함)...\n');
await scheduler.checkAndReindex();

// 잠시 대기
await new Promise(resolve => setTimeout(resolve, 500));

console.log('4. 결과 확인:\n');

const waitingStatus = statusUpdates.find(s => s.status === 'waiting');
if (waitingStatus) {
  console.log('   ✅ 재인덱싱이 미뤄졌습니다!');
  console.log('   📋 이유:', waitingStatus.reason);
} else {
  console.log('   ❌ 재인덱싱이 실행되었습니다 (예상과 다름)');
  console.log('   📋 상태 업데이트:', statusUpdates);
  process.exit(1);
}

console.log('\n5. 질문 실행 상태를 FALSE로 설정 (질문 종료)\n');
scheduler.setQuestionRunning(false);

console.log('6. 다시 재인덱싱 점검 실행 (이번엔 실행되어야 함)...\n');
await scheduler.checkAndReindex();

// 재인덱싱 완료 대기
await new Promise(resolve => {
  const checkInterval = setInterval(() => {
    const completed = statusUpdates.find(s => s.status === 'completed');
    if (completed) {
      clearInterval(checkInterval);
      resolve();
    }
  }, 100);

  // 타임아웃 (30초)
  setTimeout(() => {
    clearInterval(checkInterval);
    resolve();
  }, 30000);
});

console.log('7. 최종 결과:\n');

const indexingStatus = statusUpdates.find(s => s.status === 'indexing');
const completedStatus = statusUpdates.find(s => s.status === 'completed');

if (indexingStatus && completedStatus) {
  console.log('   ✅ 질문 종료 후 재인덱싱이 성공적으로 실행되었습니다!');
  console.log('   ⏱️  소요 시간:', completedStatus.duration);
  console.log('\n✅ 모든 테스트 통과!\n');
  process.exit(0);
} else {
  console.log('   ❌ 재인덱싱이 실행되지 않았습니다');
  console.log('   📋 상태 업데이트:', statusUpdates.map(s => s.status));
  process.exit(1);
}
