/**
 * 리마인드 날짜 계산기
 *
 * 규칙:
 *   - 오늘     → "오늘"
 *   - 청구     → 청구일(또는 날짜) D-21 이내 → "청구 D-{n}"
 *   - 계약     → 계약종료일 D-120 이내       → "종료 D-{n}"
 *   - 해당 없음 → "-"
 */
import dayjs from 'dayjs';
import { BILLING_REMIND_DAYS, CONTRACT_END_REMIND_DAYS } from '../config.js';

// ── 내부 헬퍼 ────────────────────────────────────────────

function diffDays(targetDate, today) {
  return dayjs(targetDate).startOf('day').diff(today.startOf('day'), 'day');
}

// ── 리마인드 계산 ─────────────────────────────────────────

/**
 * 단일 이벤트에 대한 리마인드 문자열을 반환한다.
 * @param {import('./normalizer.js').ScheduleEvent} event
 * @param {Date} [now]  - 테스트용 주입 가능 (기본: 오늘)
 * @returns {string}
 */
export function calculateRemind(event, now = new Date()) {
  const today  = dayjs(now).startOf('day');
  const parts  = [];

  // ① 오늘 판정
  if (event.date) {
    const delta = diffDays(event.date, today);
    if (delta === 0) parts.push('오늘');
  }

  // ② 청구 리마인드
  if (event.type === '청구') {
    const ref   = event.billingDate ?? event.date;
    if (ref) {
      const delta = diffDays(ref, today);
      if (delta >= 0 && delta <= BILLING_REMIND_DAYS) {
        parts.push(`청구 D-${delta}`);
      }
    }
  }

  // ③ 계약 종료 리마인드
  if (event.type === '계약' && event.endDate) {
    const delta = diffDays(event.endDate, today);
    if (delta >= 0 && delta <= CONTRACT_END_REMIND_DAYS) {
      parts.push(`종료 D-${delta}`);
    }
  }

  return parts.length > 0 ? parts.join(', ') : '-';
}

/**
 * 이벤트 배열 전체에 remind 필드를 채워 반환한다.
 * @param {import('./normalizer.js').ScheduleEvent[]} events
 * @param {Date} [now]
 * @returns {import('./normalizer.js').ScheduleEvent[]}
 */
export function applyReminders(events, now = new Date()) {
  return events.map(e => ({ ...e, remind: calculateRemind(e, now) }));
}

// ── 정렬 ─────────────────────────────────────────────────

/**
 * 날짜 오름차순 정렬. 날짜 없는 항목은 하단.
 * @param {import('./normalizer.js').ScheduleEvent[]} events
 * @returns {import('./normalizer.js').ScheduleEvent[]}
 */
export function sortEvents(events) {
  const dated   = events.filter(e => e.date).sort((a, b) => a.date - b.date);
  const undated = events.filter(e => !e.date);
  return [...dated, ...undated];
}
