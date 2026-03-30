/**
 * 일정 객체 표준화 함수
 *
 * Excel 원시 행(raw row) → 표준 ScheduleEvent 객체로 변환
 * - 영문 컬럼명 → 내부 키 매핑 (COLUMN_MAP)
 * - 날짜 파싱 (Date 또는 문자열 모두 처리)
 * - 금액 숫자화 (쉼표, 원화 기호 제거)
 * - certain(bool) → certainty('확실'/'불확실') 변환
 * - 확실여부 미기재 시 자동 판정
 */
import dayjs from 'dayjs';
import { COLUMN_MAP, REQUIRED_FIELDS_FOR_CERTAIN } from '../config.js';

/**
 * @typedef {Object} ScheduleEvent
 * @property {string}      type         - 구분 (계약 | 청구 | 업무)
 * @property {string}      title        - 제목
 * @property {Date|null}   date         - 대표 날짜 (start_date)
 * @property {string}      client       - 거래처
 * @property {Date|null}   endDate      - 종료일 (end_date)
 * @property {string}      billingCycle - 청구주기
 * @property {Date|null}   billingDate  - 청구일 (invoice_date)
 * @property {Date|null}   dueDate      - 납부기한 (due_date)
 * @property {number|null} amount       - 금액
 * @property {string}      currency     - 통화
 * @property {number|null} feeRate      - 수수료율
 * @property {string}      notes        - 비고 / 산정근거
 * @property {string}      certainty    - 확실여부 ('확실' | '불확실')
 * @property {string}      source       - 데이터 출처
 * @property {string|null} remind       - 리마인드 (scheduler 에서 주입)
 */

// ── 변환 헬퍼 ────────────────────────────────────────────

function parseDate(val) {
  if (val === null || val === undefined || val === '') return null;
  const d = dayjs(val);
  return d.isValid() ? d.toDate() : null;
}

function parseAmount(val) {
  if (val === null || val === undefined || val === '') return null;
  const cleaned = String(val).replace(/[,₩\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseFeeRate(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function toStr(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

/**
 * certain 컬럼 값(bool/string) → '확실' | '불확실' | null(자동판정)
 */
function parseCertainty(val) {
  if (val === true  || val === 1)  return '확실';
  if (val === false || val === 0)  return '불확실';
  if (typeof val === 'string') {
    const v = val.trim().toLowerCase();
    if (v === 'true'  || v === '확실')  return '확실';
    if (v === 'false' || v === '불확실') return '불확실';
  }
  return null; // 미기재 → 자동판정으로 넘김
}

// ── 확실여부 자동 판정 ────────────────────────────────────

function inferCertainty(event) {
  const required = REQUIRED_FIELDS_FOR_CERTAIN[event.type] ?? ['date'];
  for (const field of required) {
    const v = event[field];
    if (v === null || v === undefined || v === '') return '불확실';
  }
  return '확실';
}

// ── 표준화 ────────────────────────────────────────────────

/**
 * 단일 원시 행을 ScheduleEvent 로 변환한다.
 * @param {Record<string, unknown>} raw
 * @returns {ScheduleEvent}
 */
export function normalizeRow(raw) {
  // Excel 컬럼명 → 내부 키
  const mapped = {};
  for (const [excelCol, internalKey] of Object.entries(COLUMN_MAP)) {
    mapped[internalKey] = raw[excelCol] ?? null;
  }

  const event = {
    type:         toStr(mapped.type),
    title:        toStr(mapped.title),
    date:         parseDate(mapped.date),
    client:       toStr(mapped.client),
    endDate:      parseDate(mapped.endDate),
    billingCycle: toStr(mapped.billingCycle),
    billingDate:  parseDate(mapped.billingDate),
    dueDate:      parseDate(mapped.dueDate),
    amount:       parseAmount(mapped.amount),
    currency:     toStr(mapped.currency),
    feeRate:      parseFeeRate(mapped.feeRate),
    notes:        toStr(mapped.notes),
    certainty:    parseCertainty(mapped.certainty), // null 이면 아래서 자동판정
    source:       toStr(mapped.source),
    remind:       null,                             // scheduler 에서 주입
  };

  // 확실여부 미기재(null) 시 자동 판정
  if (!event.certainty) {
    event.certainty = inferCertainty(event);
  }

  return event;
}

/**
 * 전체 원시 행 배열을 표준화한다.
 * @param {Record<string, unknown>[]} rows
 * @returns {ScheduleEvent[]}
 */
export function normalizeAll(rows) {
  return rows.map(normalizeRow);
}
