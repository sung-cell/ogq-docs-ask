#!/usr/bin/env node
/**
 * contract-scheduler CLI 진입점
 *
 * 사용법:
 *   node index.js list
 *   node index.js remind
 *   node index.js query [--client <이름>] [--type <구분>]
 *                       [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
 *                       [--remind] [--certainty <확실|불확실>]
 *
 * npm scripts:
 *   npm run list
 *   npm run remind
 *   npm run query -- --client ABC --type 청구
 */
import { readEventsXlsx }             from './src/parser/excelParser.js';
import { normalizeAll }               from './src/scheduler/normalizer.js';
import { applyReminders, sortEvents } from './src/scheduler/reminder.js';
import { renderTable }                from './src/formatter/markdownTable.js';
import { query }                      from './src/query/filter.js';
import { executeNaturalQuery }        from './src/query/naturalQuery.js';
import { scanAllFiles, extractCandidates } from './src/inbox/scanner.js';
import { addCandidates, getCandidates, approveCandidates } from './src/inbox/candidateManager.js';
import { searchDocuments } from './src/search/documentSearch.js';
import { handleAsk, handleAskForHtml } from './src/query/askHandler.js';
import { renderAskResultHtml } from './src/formatter/htmlRenderer.js';
import { buildIndex } from './src/index/indexBuilder.js';
import { startWatching } from './src/index/indexWatcher.js';
import { summarizeByKeyword, summarizeFile } from './src/summary/documentSummarizer.js';
import { getAuthUrl, saveTokenFromCode } from './src/integrations/googleDriveNative.js';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ── 공통 데이터 준비 (async) ──────────────────────────────

async function prepare() {
  const raw = await readEventsXlsx();
  if (raw.length === 0) {
    console.warn('[prepare] events_master.xlsx 파일이 없거나 비어있습니다. 일정 관련 기능이 제한됩니다.');
    return [];
  }
  const events   = normalizeAll(raw);
  const reminded = applyReminders(events);
  return sortEvents(reminded);
}

// ── CLI 명령 ─────────────────────────────────────────────

async function cmdList() {
  const events = await prepare();
  console.log(renderTable(events));
}

async function cmdRemind() {
  const events = await prepare();
  const active = events.filter(e => e.remind !== '-');
  if (active.length === 0) {
    console.log('현재 리마인드 항목 없음.');
    return;
  }
  console.log(renderTable(active));
}

/**
 * CLI 인자 파싱: --key value 또는 --flag 형태 지원
 * @param {string[]} args
 * @returns {import('./src/query/filter.js').QueryConditions}
 */
function parseQueryArgs(args) {
  const conditions = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--client':    conditions.client     = args[++i]; break;
      case '--type':      conditions.type       = args[++i]; break;
      case '--from':      conditions.from       = args[++i]; break;
      case '--to':        conditions.to         = args[++i]; break;
      case '--certainty': conditions.certainty  = args[++i]; break;
      case '--remind':    conditions.remindOnly = true;      break;
    }
  }
  return conditions;
}

async function cmdUpdate() {
  console.log('contracts_inbox 및 contracts_raw 폴더 스캔 중...\n');

  const { files, truncated, stats } = scanAllFiles();

  if (files.length === 0) {
    console.log('지원 파일이 없습니다.');
    console.log('파일을 data/contracts_inbox/ 또는 data/contracts_raw/ 폴더에 넣어주세요.');
    console.log('지원 형식: .xlsx, .xls, .csv, .pdf, .docx, .pptx');
    return;
  }

  console.log(`발견된 파일: ${files.length}개`);
  console.log(`  - 파싱 대상: ${stats.parseable}개 (.xlsx/.xls/.csv)`);
  console.log(`  - 발견만: ${stats.discoverable}개 (.pdf/.docx/.pptx)`);

  if (truncated) {
    console.log(`\n⚠️  경고: 파일 수가 상한(200개)을 초과하여 일부만 처리합니다.`);

    // 폴더별 TOP5 출력
    const dirEntries = Object.entries(stats.byDir)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    console.log('\n폴더별 파일 수 TOP5:');
    dirEntries.forEach(([dir, count]) => {
      const shortDir = dir.replace(/^.*\/contract-scheduler\//, '');
      console.log(`  ${count}개 - ${shortDir}`);
    });
  }
  console.log('');

  // 파싱 가능 파일만 처리
  const parseableFiles = files.filter(f =>
    f.ext === '.xlsx' || f.ext === '.xls' || f.ext === '.csv'
  );

  let allCandidates = [];
  let processedCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (const file of parseableFiles) {
    const fileName = file.path.split('/').pop();
    console.log(`처리 중: ${fileName}`);

    try {
      const candidates = await extractCandidates(file.path);
      if (candidates.length > 0) {
        console.log(`  → ${candidates.length}개 행 추출`);
        allCandidates = allCandidates.concat(candidates);
        processedCount++;
      } else {
        console.log(`  → 추출 가능 행 없음`);
        skippedCount++;
      }
    } catch (err) {
      console.log(`  ✗ 오류: ${err.message}`);
      errorCount++;
    }
  }

  console.log(`\n처리 완료: ${processedCount}개 파일, ${errorCount}개 오류, ${skippedCount}개 건너뜀`);
  console.log(`총 ${allCandidates.length}개 후보 발견\n`);

  if (allCandidates.length === 0) {
    console.log('추출된 후보가 없습니다.');
    return;
  }

  console.log('InboxCandidates 시트에 추가 중...\n');

  const result = await addCandidates(allCandidates);

  console.log('최종 결과\n');
  console.log(`추가됨: ${result.added}개`);
  console.log(`중복 제외: ${result.skipped}개`);
  console.log(`전체: ${result.total}개`);
}

async function cmdCandidates() {
  const candidates = await getCandidates();

  if (candidates.length === 0) {
    console.log('InboxCandidates에 후보가 없습니다.');
    return;
  }

  console.log('InboxCandidates 목록\n');

  // 간단한 테이블 형식으로 출력
  const headers = ['No', 'type', 'title', 'client', 'start_date', 'amount'];
  const rows = candidates.map((c, idx) => {
    const d = c.data;
    return [
      idx + 1,
      d.type || '-',
      d.title || '-',
      d.client || '-',
      d.start_date instanceof Date ? d.start_date.toISOString().split('T')[0] : '-',
      d.amount ? d.amount.toLocaleString('ko-KR') : '-'
    ];
  });

  // 헤더 출력
  console.log('| ' + headers.join(' | ') + ' |');
  console.log('| ' + headers.map(() => '---').join(' | ') + ' |');

  // 데이터 출력
  for (const row of rows) {
    console.log('| ' + row.join(' | ') + ' |');
  }

  console.log(`\n총 ${candidates.length}개 후보`);
}

async function cmdApprove(args) {
  // 인자 파싱
  let rowNumbers = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--row') {
      const num = parseInt(args[++i], 10);
      if (!isNaN(num)) rowNumbers.push(num);
    } else if (args[i] === '--rows') {
      const nums = args[++i].split(',').map(s => parseInt(s.trim(), 10));
      rowNumbers = rowNumbers.concat(nums.filter(n => !isNaN(n)));
    }
  }

  if (rowNumbers.length === 0) {
    console.log('승인할 후보 번호를 지정하세요. 예:');
    console.log('  node index.js approve --row 1');
    console.log('  node index.js approve --rows 2,3,5');
    return;
  }

  console.log(`승인 처리 중: ${rowNumbers.join(', ')}\n`);

  const result = await approveCandidates(rowNumbers);

  console.log('처리 완료\n');
  console.log(`승인됨: ${result.approved}개`);
  console.log(`실패: ${result.failed}개`);
}

async function cmdSearch(args) {
  const keyword = args.join(' ').trim();

  if (!keyword) {
    console.log('검색 키워드를 입력하세요. 예:');
    console.log('  node index.js search "비즈챗"');
    console.log('  node index.js search "120원"');
    console.log('  node index.js search "단가"');
    return;
  }

  const searchResult = await searchDocuments(keyword);
  const results = searchResult.results || [];

  if (results.length === 0) {
    console.log(`"${keyword}" 검색 결과 없음.`);
    return;
  }

  console.log(`검색 결과: ${results.length}개 파일\n`);
  console.log('='.repeat(80));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    console.log(`\n[${i + 1}] ${result.fileName}`);
    console.log(`    ${result.filePath}`);

    if (result.isScanned) {
      console.log(`    ${result.snippets[0]}`);
    } else {
      console.log(`    매칭: ${result.score}회\n`);
      result.snippets.forEach((snippet, idx) => {
        console.log(`    ${idx + 1}. ${snippet}`);
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log(`총 ${results.length}개 파일에서 "${keyword}" 발견`);
}

async function cmdAsk(args) {
  const question = args.join(' ').trim();

  if (!question) {
    console.log('질문을 입력하세요. 예:');
    console.log('  node index.js ask "SKT 계약서 어디 있어?"');
    console.log('  node index.js ask "다음달 청구 일정 뭐야?"');
    console.log('  node index.js ask "KT 계약 종료 언제야?"');
    return;
  }

  // 일정 데이터가 필요한 경우를 위해 prepare
  const events = await prepare();

  await handleAsk(question, events);
}

async function cmdAskHtml(args) {
  // --output 옵션 파싱
  let outputPath = null;
  let questionParts = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output') {
      outputPath = args[++i];
    } else {
      questionParts.push(args[i]);
    }
  }

  const question = questionParts.join(' ').trim();

  if (!question) {
    console.log('질문을 입력하세요. 예:');
    console.log('  node index.js ask-html "KT 계약 종료 언제야?"');
    console.log('  node index.js ask-html "이번달 청구 총액 얼마야?" --output /tmp/cs-ask-result.html');
    return;
  }

  // 기본 출력 경로 설정
  if (!outputPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    outputPath = `/tmp/cs-ask-${timestamp}.html`;
  }

  console.log(`질문: "${question}"\n`);

  let result = null;

  try {
    // 일정 데이터 준비 (graceful fallback)
    const events = await prepare();

    if (events.length === 0) {
      console.warn('⚠️ events_master.xlsx 파일이 없습니다.');
      console.warn('일정/청구 관련 질문은 답변이 제한됩니다.\n');
    }

    // 구조화된 데이터 가져오기
    console.log('결과 분석 중...\n');
    result = await handleAskForHtml(question, events);

  } catch (err) {
    console.error('질문 처리 중 오류 발생:', err.message);
    console.error(err.stack);

    // 오류 발생 시에도 결과 객체 생성
    result = {
      question: question,
      questionType: 'unknown',
      timestamp: new Date().toISOString(),
      data: null,
      error: `처리 중 오류가 발생했습니다: ${err.message}`
    };
  }

  // HTML 렌더링 (항상 실행)
  let html;
  try {
    html = renderAskResultHtml(result);
  } catch (err) {
    console.error('HTML 렌더링 실패:', err.message);

    // 렌더링 실패 시 최소한의 오류 HTML 생성
    const errorMsg = result?.error || err.message;
    html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>오류 - CS Ask</title>
  <style>
    body { font-family: sans-serif; padding: 40px; background: #f5f5f5; }
    .error-container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #d32f2f; }
    pre { background: #f5f5f5; padding: 15px; border-radius: 4px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="error-container">
    <h1>⚠️ 오류 발생</h1>
    <p><strong>질문:</strong> ${question}</p>
    <p><strong>오류:</strong> ${errorMsg}</p>
    <pre>${err.stack || ''}</pre>
  </div>
</body>
</html>`;
  }

  // 파일 쓰기 (항상 실행)
  try {
    const absolutePath = path.resolve(outputPath);
    fs.writeFileSync(absolutePath, html, 'utf-8');

    console.log(`✓ HTML 파일 생성 완료\n`);
    console.log(`파일 경로: ${absolutePath}`);
    console.log(`브라우저에서 열기: file://${absolutePath}\n`);
  } catch (err) {
    console.error('파일 쓰기 실패:', err.message);
    throw err;
  }

  // 결과 요약 출력
  if (result && result.error) {
    console.log(`오류: ${result.error}`);
  } else if (result && result.data) {
    const { type, count, totalAmount, keyword, results } = result.data;

    switch (type) {
      case 'document_search':
        console.log(`📄 문서 검색 결과: ${results.length}개 파일 (키워드: "${keyword}")`);
        break;
      case 'schedule_query':
        console.log(`📅 일정 조회 결과: ${count}건`);
        break;
      case 'expiry_check':
        console.log(`⏰ 종료 확인 결과: ${count}건`);
        break;
      case 'amount_analysis':
        console.log(`💰 금액 분석 결과: ${totalAmount.toLocaleString('ko-KR')}원 (${count}건)`);
        break;
    }
  }
}

async function cmdReindex(args) {
  const force = args.includes('--force');
  try {
    await buildIndex({ force });
  } catch (err) {
    console.error('오류:', err.message);
    if (err.stack) {
      console.error('상세:', err.stack);
    }
    throw err;
  }
}

async function cmdAuthGoogle(args) {
  console.log('🔐 Google Drive OAuth 인증\n');

  try {
    // OAuth URL 생성
    const { authUrl } = getAuthUrl();

    console.log('브라우저에서 아래 URL을 열어 인증하세요:\n');
    console.log(authUrl);
    console.log('');
    console.log('인증 후 받은 코드를 입력하세요:');

    // 사용자 입력 받기
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const code = await new Promise((resolve) => {
      rl.question('인증 코드: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (!code) {
      console.log('❌ 인증 코드가 입력되지 않았습니다.');
      return;
    }

    // Token 저장
    await saveTokenFromCode(code);

    console.log('\n✅ Google Drive 인증이 완료되었습니다!');
    console.log('\n이제 "node index.js reindex" 명령으로 Google Drive native 문서를 인덱싱할 수 있습니다.\n');

  } catch (err) {
    console.error('\n❌ 인증 실패:', err.message);
    console.error('\n다음 사항을 확인하세요:');
    console.error('  1. ~/.contract-scheduler/google-drive-oauth.json 파일이 존재하는지');
    console.error('  2. 인증 코드가 올바른지');
    console.error('  3. Google Cloud Console에서 OAuth 클라이언트가 활성화되어 있는지\n');
  }
}

async function cmdSummarize(args) {
  const keyword = args.join(' ').trim();

  if (!keyword) {
    console.log('검색 키워드를 입력하세요. 예:');
    console.log('  node index.js summarize "KT 계약서"');
    console.log('  node index.js summarize "비즈챗 견적서"');
    return;
  }

  const result = await summarizeByKeyword(keyword);

  if (result.error) {
    console.log(`오류: ${result.error}`);
    return;
  }

  const doc = result.document;

  console.log('='.repeat(80));
  console.log(`📄 문서 요약\n`);
  console.log(`파일명: ${doc.fileName}`);
  console.log(`문서유형: ${doc.docType}`);
  console.log(`경로: ${doc.filePath}\n`);

  console.log('요약:');
  doc.summary.forEach((line, idx) => {
    console.log(`  ${idx + 1}. ${line}`);
  });
  console.log('');

  console.log('추출 정보:');
  Object.entries(doc.fields).forEach(([key, value]) => {
    console.log(`  - ${key}: ${value}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log(`검색 결과 ${result.searchResultCount}개 중 가장 관련성 높은 문서를 요약했습니다.`);
}

async function cmdSummarizeFile(args) {
  const filePath = args.join(' ').trim();

  if (!filePath) {
    console.log('파일 경로를 입력하세요. 예:');
    console.log('  node index.js summarize-file "/path/to/document.pdf"');
    return;
  }

  // 파일 존재 확인
  if (!fs.existsSync(filePath)) {
    console.log(`오류: 파일을 찾을 수 없습니다 - ${filePath}`);
    return;
  }

  console.log(`파일 요약 생성 중: ${filePath}\n`);

  const doc = await summarizeFile(filePath);

  if (doc.error) {
    console.log(`오류: ${doc.error}`);
    return;
  }

  console.log('='.repeat(80));
  console.log(`📄 문서 요약\n`);
  console.log(`파일명: ${doc.fileName}`);
  console.log(`문서유형: ${doc.docType}`);
  console.log(`경로: ${doc.filePath}\n`);

  console.log('요약:');
  doc.summary.forEach((line, idx) => {
    console.log(`  ${idx + 1}. ${line}`);
  });
  console.log('');

  console.log('추출 정보:');
  Object.entries(doc.fields).forEach(([key, value]) => {
    console.log(`  - ${key}: ${value}`);
  });

  console.log('\n' + '='.repeat(80));
}

async function cmdWatchIndex() {
  const { DOCUMENTS_ROOTS } = await import('./src/config.js');
  const { getDriveDesktopRoots } = await import('./src/config/driveConfig.js');
  const os = await import('os');
  const path = await import('path');

  // 환경 변수로 감시 옵션 제어 (기본값: true)
  const watchDownloads = process.env.OGQ_DOCS_ASK_WATCH_DOWNLOADS !== 'false';
  const watchGoogleDrive = process.env.OGQ_DOCS_ASK_WATCH_GOOGLE_DRIVE !== 'false';

  const watchPaths = [];

  // 각 문서 루트 폴더 전체 감시
  DOCUMENTS_ROOTS.forEach(root => {
    watchPaths.push(root);
  });

  // Downloads 폴더 (옵션)
  if (watchDownloads) {
    watchPaths.push(path.join(os.homedir(), 'Downloads'));
  }

  // Google Drive Desktop 경로 (옵션)
  if (watchGoogleDrive) {
    const driveRoots = getDriveDesktopRoots();
    driveRoots.forEach(root => {
      watchPaths.push(root);
    });
  }

  console.log('📂 감시 중인 폴더:');
  watchPaths.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p}`);
  });
  console.log('');

  startWatching(watchPaths);
}

async function cmdQuery(args) {
  const events = await prepare();

  // 자연어 쿼리 vs 옵션 쿼리 분기
  const firstArg = args[0] ?? '';
  const isNaturalQuery = firstArg && !firstArg.startsWith('--');

  if (isNaturalQuery) {
    // 자연어 쿼리 모드
    const text = args.join(' ');
    const { results, summary } = executeNaturalQuery(text, events);

    if (results.length === 0) {
      console.log('조건에 맞는 항목 없음.\n');
      summary.forEach(line => console.log(line));
      return;
    }

    console.log(renderTable(results));
    console.log('');
    summary.forEach(line => console.log(line));
    return;
  }

  // 기존 옵션 쿼리 모드
  const conditions = parseQueryArgs(args);

  if (Object.keys(conditions).length === 0) {
    console.log('조건을 지정하세요. 예:');
    console.log('  node index.js query "PG사 다음달 청구"');
    console.log('  node index.js query "TEST 2026-03"');
    console.log('  node index.js query --client ABC');
    console.log('  node index.js query --type 청구 --remind');
    console.log('  node index.js query --from 2026-01-01 --to 2026-06-30');
    return;
  }

  const results = query(events, conditions);

  if (results.length === 0) {
    console.log('조건에 맞는 항목 없음.');
    return;
  }

  console.log(renderTable(results));
  console.log(`\n_${results.length}건_`);
}

// ── 진입점 ────────────────────────────────────────────────

const [, , cmd, ...rest] = process.argv;

const COMMANDS = {
  list:            cmdList,
  remind:          cmdRemind,
  query:           cmdQuery,
  update:          cmdUpdate,
  candidates:      cmdCandidates,
  approve:         cmdApprove,
  search:          cmdSearch,
  ask:             cmdAsk,
  'ask-html':      cmdAskHtml,
  reindex:         cmdReindex,
  'auth-google':   cmdAuthGoogle,
  'watch-index':   cmdWatchIndex,
  summarize:       cmdSummarize,
  'summarize-file': cmdSummarizeFile,
};

const handler = COMMANDS[cmd];
if (!handler) {
  console.log('사용법: node index.js [명령] [옵션]');
  console.log('');
  console.log('명령:');
  console.log('  list                    전체 일정표 출력');
  console.log('  remind                  리마인드 활성 항목 출력');
  console.log('  query <문장>            자연어 검색');
  console.log('  query [옵션]            필터 조건으로 조회');
  console.log('  update                  inbox 폴더 스캔 및 후보 추출');
  console.log('  candidates              후보 목록 출력');
  console.log('  approve [옵션]          후보를 Events로 승인');
  console.log('  search <키워드>         문서 내용 검색');
  console.log('  ask <질문>              자연어 질문 처리');
  console.log('  ask-html <질문>         자연어 질문 처리 (HTML 출력)');
  console.log('  reindex                 전체 문서 인덱스 재생성');
  console.log('  auth-google             Google Drive OAuth 인증');
  console.log('  watch-index             파일 변경 감시 및 자동 인덱싱');
  console.log('  summarize <키워드>      키워드로 검색 후 상위 문서 요약');
  console.log('  summarize-file <경로>   특정 파일 요약');
  console.log('');
  console.log('query 자연어 예시:');
  console.log('  node index.js query "PG사 다음달 청구"');
  console.log('  node index.js query "TEST 2026-03"');
  console.log('');
  console.log('query 옵션:');
  console.log('  --client  <이름>     거래처 부분 일치');
  console.log('  --type    <구분>     계약|청구|업무');
  console.log('  --from    <날짜>     기간 시작 (YYYY-MM-DD)');
  console.log('  --to      <날짜>     기간 끝   (YYYY-MM-DD)');
  console.log('  --certainty <값>     확실|불확실');
  console.log('  --remind             리마인드 활성 항목만');
  console.log('');
  console.log('approve 옵션:');
  console.log('  --row  <번호>        단일 후보 승인 (예: --row 1)');
  console.log('  --rows <번호들>      복수 후보 승인 (예: --rows 2,3,5)');
  console.log('');
  console.log('ask 예시:');
  console.log('  node index.js ask "SKT 계약서 어디 있어?"');
  console.log('  node index.js ask "다음달 청구 일정 뭐야?"');
  console.log('  node index.js ask "KT 계약 종료 언제야?"');
  console.log('');
  console.log('ask-html 예시:');
  console.log('  node index.js ask-html "KT 계약 종료 언제야?"');
  console.log('  node index.js ask-html "이번달 청구 총액 얼마야?" --output /tmp/result.html');
  process.exit(cmd ? 1 : 0);
}

handler(rest).catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});
