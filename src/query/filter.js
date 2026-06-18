/**
 * 거래처/기간 필터 질의 함수
 *
 * 각 함수는 독립적으로 사용하거나 query() 로 복합 조건을 구성한다.
 *
 * 사용 예:
 *   filterByClient(events, 'ABC')
 *   filterByPeriod(events, '2026-01-01', '2026-06-30')
 *   query(events, { client: 'ABC', type: '청구', remindOnly: true })
 */
import dayjs from 'dayjs';

// ── 단일 필터 ────────────────────────────────────────────

/**
 * 거래처명 필터 (부분 일치, 대소문자 무관)
 * @param {import('../scheduler/normalizer.js').ScheduleEvent[]} events
 * @param {string} clientName
 * @returns {import('../scheduler/normalizer.js').ScheduleEvent[]}
 */
export function filterByClient(events, clientName) {
  const q = clientName.trim().toLowerCase();
  return events.filter(e => e.client.toLowerCase().includes(q));
}

/**
 * 기간 필터 (start ~ end, 양쪽 포함)
 * 날짜 없는 항목은 제외된다.
 * @param {import('../scheduler/normalizer.js').ScheduleEvent[]} events
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 * @returns {import('../scheduler/normalizer.js').ScheduleEvent[]}
 */
export function filterByPeriod(events, startDate, endDate) {
  const start = dayjs(startDate).startOf('day');
  const end   = dayjs(endDate).startOf('day');
  return events.filter(e => {
    if (!e.date) return false;
    const d = dayjs(e.date).startOf('day');
    return !d.isBefore(start) && !d.isAfter(end);
  });
}

/**
 * 구분 필터 (계약 | 청구 | 업무)
 * @param {import('../scheduler/normalizer.js').ScheduleEvent[]} events
 * @param {string} type
 * @returns {import('../scheduler/normalizer.js').ScheduleEvent[]}
 */
export function filterByType(events, type) {
  return events.filter(e => e.type === type);
}

/**
 * 확실여부 필터
 * @param {import('../scheduler/normalizer.js').ScheduleEvent[]} events
 * @param {'확실'|'불확실'} certainty
 * @returns {import('../scheduler/normalizer.js').ScheduleEvent[]}
 */
export function filterByCertainty(events, certainty) {
  return events.filter(e => e.certainty === certainty);
}

/**
 * 리마인드 활성 항목만 반환
 * @param {import('../scheduler/normalizer.js').ScheduleEvent[]} events
 * @returns {import('../scheduler/normalizer.js').ScheduleEvent[]}
 */
export function filterByRemind(events) {
  return events.filter(e => e.remind && e.remind !== '-');
}

// ── 복합 쿼리 ────────────────────────────────────────────

/**
 * @typedef {Object} QueryConditions
 * @property {string}  [client]     - 거래처 부분 일치
 * @property {string}  [type]       - 구분 (계약|청구|업무)
 * @property {string}  [certainty]  - 확실여부 (확실|불확실)
 * @property {string}  [from]       - 기간 시작 (YYYY-MM-DD)
 * @property {string}  [to]         - 기간 끝   (YYYY-MM-DD)
 * @property {boolean} [remindOnly] - true 이면 리마인드 활성 항목만
 */

/**
 * 복합 조건으로 이벤트를 필터링한다.
 * 조건이 없는 항목은 적용하지 않는다.
 *
 * @param {import('../scheduler/normalizer.js').ScheduleEvent[]} events
 * @param {QueryConditions} conditions
 * @returns {import('../scheduler/normalizer.js').ScheduleEvent[]}
 */
export function query(events, conditions = {}) {
  let result = [...events];

  if (conditions.client)
    result = filterByClient(result, conditions.client);

  if (conditions.type)
    result = filterByType(result, conditions.type);

  if (conditions.certainty)
    result = filterByCertainty(result, conditions.certainty);

  if (conditions.from || conditions.to)
    result = filterByPeriod(
      result,
      conditions.from ?? '1900-01-01',
      conditions.to   ?? '2999-12-31',
    );

  if (conditions.remindOnly)
    result = filterByRemind(result);

  return result;
}
