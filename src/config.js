/**
 * contract-scheduler 전역 설정 (Node.js)
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 환경 변수 지원 (다중 폴더) ─────────────────────────────
// OGQ_DOCS_ASK_DOCUMENTS_ROOTS 환경 변수가 있으면 사용, 없으면 기본 Documents 폴더 사용
let DOCUMENTS_ROOTS = [resolve(process.env.HOME || '', 'Documents')];

if (process.env.OGQ_DOCS_ASK_DOCUMENTS_ROOTS) {
  try {
    const parsed = JSON.parse(process.env.OGQ_DOCS_ASK_DOCUMENTS_ROOTS);
    if (Array.isArray(parsed) && parsed.length > 0) {
      DOCUMENTS_ROOTS = parsed;
    }
  } catch (err) {
    console.error('[config.js] 환경 변수 파싱 실패, 기본 Documents 폴더 사용:', err);
  }
}

// 첫 번째 폴더를 기본 DOCUMENTS_ROOT로 사용 (기존 호환성)
const DOCUMENTS_ROOT = DOCUMENTS_ROOTS[0];

// 다중 폴더 배열 export
export { DOCUMENTS_ROOTS };

// ── 리마인드 기준 (일 단위) ───────────────────────────────
export const BILLING_REMIND_DAYS      = 21;   // 청구 3주 전
export const CONTRACT_END_REMIND_DAYS = 120;  // 계약 종료 4개월 전

// ── 데이터 경로 ──────────────────────────────────────────
export const EVENTS_MASTER_PATH  = resolve(DOCUMENTS_ROOT, 'data', 'events_master.xlsx');
export const CONTRACTS_INBOX_DIR = resolve(DOCUMENTS_ROOT, 'data', 'contracts_inbox');
export const CONTRACTS_RAW_DIR   = resolve(DOCUMENTS_ROOT, 'data', 'contracts_raw');

// ── Excel 컬럼 → 내부 키 매핑 ────────────────────────────
// Excel 헤더: type,title,client,start_date,end_date,
//             billing_cycle,invoice_date,due_date,
//             amount,currency,fee_rate,notes,certain,source
export const COLUMN_MAP = {
  type:          'type',
  title:         'title',
  client:        'client',
  start_date:    'date',           // 대표 날짜
  end_date:      'endDate',
  billing_cycle: 'billingCycle',
  invoice_date:  'billingDate',    // 청구일
  due_date:      'dueDate',        // 납부기한
  amount:        'amount',
  currency:      'currency',
  fee_rate:      'feeRate',
  notes:         'notes',
  certain:       'certainty',      // bool → '확실'/'불확실'
  source:        'source',
};

// ── 출력 컬럼 정의 ────────────────────────────────────────
export const OUTPUT_COLUMNS = [
  { key: 'type',         label: '구분'     },
  { key: 'date',         label: '날짜'     },
  { key: 'client',       label: '거래처'   },
  { key: 'billingCycle', label: '청구주기' },
  { key: 'dueDate',      label: '청구기준' },  // 납부기한
  { key: 'amount',       label: '금액'     },
  { key: 'notes',        label: '산정근거' },  // notes → 산정근거/비고
  { key: 'certainty',    label: '확실여부' },
  { key: 'remind',       label: '리마인드' },
];

// ── 구분별 확실 판정 필수 필드 (내부 키 기준) ─────────────
export const REQUIRED_FIELDS_FOR_CERTAIN = {
  '계약': ['client', 'date', 'endDate'],
  '청구': ['client', 'date', 'amount', 'notes'],
  '업무': ['client', 'date'],
};
