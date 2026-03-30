/**
 * 스케줄러 테스트 스크립트
 */

import { getScheduler } from './src/index/autoIndexScheduler.js';

console.log('=== 자동 인덱싱 스케줄러 테스트 ===\n');

const scheduler = getScheduler();

// 상태 콜백 등록
scheduler.setStatusCallback((status) => {
  console.log('[Status Update]', JSON.stringify(status, null, 2));
});

// 설정 확인
console.log('설정:', scheduler.config);
console.log('');

// 스케줄러 시작 (로그 확인용)
scheduler.start();

console.log('\n스케줄러가 시작되었습니다. 3분 후 첫 점검이 시작됩니다.');
console.log('Ctrl+C로 종료하세요.\n');

// 프로세스 유지
process.on('SIGINT', () => {
  console.log('\n스케줄러 중지 중...');
  scheduler.stop();
  process.exit(0);
});
