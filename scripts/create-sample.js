/**
 * 샘플 events_master.xlsx 생성 스크립트
 * 실행: node scripts/create-sample.js
 */
import ExcelJS from 'exceljs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT    = resolve(__dirname, '..', 'data', 'events_master.xlsx');

// ── 헤더 & 샘플 데이터 ───────────────────────────────────

const HEADERS = [
  'type', 'title', 'client',
  'start_date', 'end_date',
  'billing_cycle', 'invoice_date', 'due_date',
  'amount', 'currency', 'fee_rate',
  'notes', 'certain', 'source',
];

const DATE_COLS = new Set(['start_date', 'end_date', 'invoice_date', 'due_date']);

const ROWS = [
  {
    type:          '업무',
    title:         '내부 회의',
    client:        'OGQ',
    start_date:    new Date('2026-02-26'),
    end_date:      null,
    billing_cycle: null,
    invoice_date:  null,
    due_date:      null,
    amount:        null,
    currency:      'KRW',
    fee_rate:      null,
    notes:         '회의',
    certain:       true,
    source:        'manual',
  },
  {
    type:          '청구',
    title:         '2월 PG 정산',
    client:        'PG사',
    start_date:    new Date('2026-02-01'),
    end_date:      new Date('2026-02-28'),
    billing_cycle: '월',
    invoice_date:  new Date('2026-03-10'),
    due_date:      new Date('2026-03-20'),
    amount:        1000000,
    currency:      'KRW',
    fee_rate:      0.035,
    notes:         '수수료 차감',
    certain:       true,
    source:        'manual',
  },
];

// ── 생성 ─────────────────────────────────────────────────

mkdirSync(resolve(__dirname, '..', 'data'), { recursive: true });

const workbook = new ExcelJS.Workbook();
workbook.creator  = 'contract-scheduler';
workbook.created  = new Date();

const sheet = workbook.addWorksheet('Events');

// 헤더 행
sheet.addRow(HEADERS);
const headerRow = sheet.getRow(1);
headerRow.font = { bold: true };
headerRow.fill = {
  type: 'pattern', pattern: 'solid',
  fgColor: { argb: 'FFD9E1F2' },
};
headerRow.commit();

// 데이터 행
for (const data of ROWS) {
  const values = HEADERS.map(h => data[h] ?? null);
  const row = sheet.addRow(values);

  // 날짜 셀 포맷 적용
  HEADERS.forEach((h, i) => {
    if (DATE_COLS.has(h) && data[h] instanceof Date) {
      row.getCell(i + 1).numFmt = 'yyyy-mm-dd';
    }
  });

  row.commit();
}

// 컬럼 너비 자동 조정
sheet.columns.forEach((col, i) => {
  col.width = Math.max(HEADERS[i].length + 4, 14);
});

// 헤더 행 고정
sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

await workbook.xlsx.writeFile(OUTPUT);
console.log(`생성 완료: ${OUTPUT}`);
