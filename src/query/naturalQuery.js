/**
 * 자연어 쿼리 파서 (최소 구현)
 *
 * 지원 기능:
 *   - 거래처 키워드 필터
 *   - 날짜: "이번달", "다음달", "YYYY-MM", "YYYY-MM-DD~YYYY-MM-DD"
 *   - 구분: "계약", "청구", "업무"
 */
import dayjs from 'dayjs';
import { query } from './filter.js';

/**
 * 자연어 문장에서 조건을 추출한다.
 * @param {string} text - 자연어 문장
 * @param {import('../scheduler/normalizer.js').ScheduleEvent[]} allEvents - 전체 이벤트 (거래처 목록 추출용)
 * @returns {{ conditions: import('./filter.js').QueryConditions, summary: string }}
 */
export function parseNaturalQuery(text, allEvents) {
  const conditions = {};
  const summary = [];

  // 1. 구분 필터 (계약 | 청구 | 업무)
  if (text.includes('계약')) {
    conditions.type = '계약';
    summary.push('구분: 계약');
  } else if (text.includes('청구')) {
    conditions.type = '청구';
    summary.push('구분: 청구');
  } else if (text.includes('업무')) {
    conditions.type = '업무';
    summary.push('구분: 업무');
  }

  // 2. 날짜 필터
  const dateInfo = parseDateExpression(text);
  if (dateInfo) {
    conditions.from = dateInfo.from;
    conditions.to = dateInfo.to;
    summary.push(dateInfo.label);
  }

  // 3. 거래처 필터 (기존 거래처 목록에서 매칭)
  const clients = [...new Set(allEvents.map(e => e.client).filter(c => c))];
  for (const client of clients) {
    if (text.includes(client)) {
      conditions.client = client;
      summary.push(`거래처: ${client}`);
      break;
    }
  }

  return {
    conditions,
    summary: summary.length > 0 ? summary.join(', ') : '조건 없음'
  };
}

/**
 * 날짜 표현 파싱
 * @param {string} text
 * @returns {{ from: string, to: string, label: string } | null}
 */
function parseDateExpression(text) {
  const today = dayjs();

  // "이번달"
  if (text.includes('이번달') || text.includes('이번 달')) {
    const from = today.startOf('month').format('YYYY-MM-DD');
    const to = today.endOf('month').format('YYYY-MM-DD');
    return { from, to, label: `기간: 이번달 (${from} ~ ${to})` };
  }

  // "다음달"
  if (text.includes('다음달') || text.includes('다음 달')) {
    const nextMonth = today.add(1, 'month');
    const from = nextMonth.startOf('month').format('YYYY-MM-DD');
    const to = nextMonth.endOf('month').format('YYYY-MM-DD');
    return { from, to, label: `기간: 다음달 (${from} ~ ${to})` };
  }

  // "YYYY-MM-DD~YYYY-MM-DD"
  const rangeMatch = text.match(/(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})/);
  if (rangeMatch) {
    return {
      from: rangeMatch[1],
      to: rangeMatch[2],
      label: `기간: ${rangeMatch[1]} ~ ${rangeMatch[2]}`
    };
  }

  // "YYYY-MM"
  const monthMatch = text.match(/(\d{4}-\d{2})/);
  if (monthMatch) {
    const month = dayjs(monthMatch[1]);
    const from = month.startOf('month').format('YYYY-MM-DD');
    const to = month.endOf('month').format('YYYY-MM-DD');
    return { from, to, label: `기간: ${monthMatch[1]} (${from} ~ ${to})` };
  }

  return null;
}

/**
 * 자연어 쿼리 실행 및 결과 요약
 * @param {string} text - 자연어 문장
 * @param {import('../scheduler/normalizer.js').ScheduleEvent[]} allEvents - 전체 이벤트
 * @returns {{ results: import('../scheduler/normalizer.js').ScheduleEvent[], summary: string[], queryInfo: string }}
 */
export function executeNaturalQuery(text, allEvents) {
  const { conditions, summary: conditionSummary } = parseNaturalQuery(text, allEvents);

  // 조건 없으면 안내
  if (Object.keys(conditions).length === 0) {
    return {
      results: [],
      summary: [
        '조건을 인식할 수 없습니다.',
        '예시: "PG사 다음달 청구", "TEST 2026-03", "계약 이번달"'
      ],
      queryInfo: conditionSummary
    };
  }

  // 쿼리 실행
  const results = query(allEvents, conditions);

  // 요약 생성
  const summaryLines = [];
  summaryLines.push(`검색 조건: ${conditionSummary}`);
  summaryLines.push(`총 ${results.length}건 발견`);

  if (results.length > 0) {
    const totalAmount = results
      .filter(e => e.amount)
      .reduce((sum, e) => sum + e.amount, 0);
    if (totalAmount > 0) {
      summaryLines.push(`총 금액: ${totalAmount.toLocaleString('ko-KR')}원`);
    } else {
      summaryLines.push('해당 기간 일정을 확인하세요.');
    }
  } else {
    summaryLines.push('조건을 변경하여 다시 검색해보세요.');
  }

  return {
    results,
    summary: summaryLines,
    queryInfo: conditionSummary
  };
}
