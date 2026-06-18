/**
 * Markdown 표 출력기
 *
 * 규칙:
 *   - GitHub-flavored Markdown 표 형식
 *   - 오늘 날짜 행 전체 **굵게** (날짜 셀은 **YYYY-MM-DD**)
 *   - 금액 → 천 단위 쉼표 (1,000,000)
 *   - 빈 값 → "-"
 */
import dayjs from 'dayjs';
import { OUTPUT_COLUMNS } from '../config.js';

const TODAY = dayjs().startOf('day');

// ── 셀 포매터 ────────────────────────────────────────────

function fmtDate(val) {
  if (!val) return '-';
  const d = dayjs(val).startOf('day');
  const s = d.format('YYYY-MM-DD');
  return d.isSame(TODAY, 'day') ? `**${s}**` : s;
}

function fmtAmount(val) {
  if (val === null || val === undefined) return '-';
  return Number(val).toLocaleString('ko-KR');
}

function fmtCell(val) {
  if (val === null || val === undefined || val === '') return '-';
  // Date 객체는 YYYY-MM-DD 로 포맷 (date 컬럼 외 날짜 필드 대응)
  if (val instanceof Date) return dayjs(val).format('YYYY-MM-DD');
  const s = String(val).trim();
  return s === '' ? '-' : s;
}

function renderCell(col, event, isToday) {
  let cell;
  if (col.key === 'date') {
    cell = fmtDate(event[col.key]);
  } else if (col.key === 'amount') {
    cell = fmtAmount(event[col.key]);
  } else {
    cell = fmtCell(event[col.key]);
  }
  // 오늘 행: 날짜 셀은 이미 bold 처리, 나머지 셀도 bold
  return isToday && col.key !== 'date' ? `**${cell}**` : cell;
}

// ── 테이블 렌더링 ─────────────────────────────────────────

/**
 * 이벤트 배열을 Markdown 표 문자열로 변환한다.
 * @param {import('../scheduler/normalizer.js').ScheduleEvent[]} events
 * @returns {string}
 */
export function renderTable(events) {
  if (events.length === 0) return '_표시할 항목이 없습니다._';

  const header    = OUTPUT_COLUMNS.map(c => c.label).join(' | ');
  const separator = OUTPUT_COLUMNS.map(() => '---').join(' | ');
  const lines     = [`| ${header} |`, `| ${separator} |`];

  for (const event of events) {
    const isToday = event.date
      ? dayjs(event.date).startOf('day').isSame(TODAY, 'day')
      : false;

    const cells = OUTPUT_COLUMNS.map(col => renderCell(col, event, isToday));
    lines.push(`| ${cells.join(' | ')} |`);
  }

  return lines.join('\n');
}
