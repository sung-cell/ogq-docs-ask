/**
 * 자연어 질문 처리 (ask 명령)
 */
import dayjs from 'dayjs';
import { existsSync, readFileSync } from 'fs';
import { searchDocuments } from '../search/documentSearch.js';
import { executeNaturalQuery } from './naturalQuery.js';
import { query } from './filter.js';
import { renderTable } from '../formatter/markdownTable.js';
import { handleDocumentQuestion, handleDocumentQuestionForData } from './documentQuestionHandler.js';
import { summarizeByKeyword, summarizeFile } from '../summary/documentSummarizer.js';
import { getContractsMetaPath } from '../config/runtimePaths.cjs';

const QUESTION_TYPES = {
  CONTRACT_METADATA: 'contract_metadata',
  DOCUMENT_SEARCH: 'document_search',
  DOCUMENT_QUESTION: 'document_question',
  DOCUMENT_SUMMARY: 'document_summary',
  SCHEDULE_QUERY: 'schedule_query',
  EXPIRY_CHECK: 'expiry_check',
  AMOUNT_ANALYSIS: 'amount_analysis',
  UNKNOWN: 'unknown'
};

const PATTERNS = {
  contract_metadata: ['시작일', '종료일', '종료', '끝나', '단가', '수익배분', '배분', '정산비율', '계약금액', '계약 금액', '계약기간', '언제'],
  document_search: ['어디', '찾아'],
  document_summary: ['요약해줘', '요약', '정리', '간추려', '핵심만', '정리해줘', '무슨 내용이야', '무슨내용', '내용이야'],
  document_question: ['내용', '뭐야', '무슨', '조항', '정산', '운영비'],
  schedule_query: ['청구', '이번달', '다음달', '일정'],
  expiry_check: ['끝', '기한'],
  amount_analysis: ['총액', '합계', '결제']
};

/**
 * 질문 유형 분류
 * @param {string} question - 사용자 질문
 * @returns {string} - QUESTION_TYPES 중 하나
 */
function classifyQuestion(question) {
  const lowerQ = question.toLowerCase();

  // 계약 메타데이터 질문형 - 최우선
  // "SKT 계약 언제 끝나?", "비즈챗 단가 얼마야?", "채팅+ 수익배분 몇 %야?"
  const hasMetadataKeyword = PATTERNS.contract_metadata.some(keyword => lowerQ.includes(keyword));
  const hasCompanyOrService = lowerQ.includes('kt') || lowerQ.includes('skt') || lowerQ.includes('lg') ||
                               lowerQ.includes('네이버') || lowerQ.includes('아프리카') || lowerQ.includes('ogq') ||
                               lowerQ.includes('카카오') || lowerQ.includes('삼성') ||
                               lowerQ.includes('채팅') || lowerQ.includes('마켓') || lowerQ.includes('비즈챗') ||
                               lowerQ.includes('메시지') || lowerQ.includes('플러스');
  if (hasMetadataKeyword && hasCompanyOrService) {
    return QUESTION_TYPES.CONTRACT_METADATA;
  }

  // 금액 분석형 (기간 기반 합산) - 우선순위 2
  const hasPeriod = lowerQ.includes('이번달') || lowerQ.includes('다음달') || lowerQ.includes('올해');
  const hasAmountKeyword = PATTERNS.amount_analysis.some(keyword => lowerQ.includes(keyword));
  if (hasPeriod && hasAmountKeyword) {
    return QUESTION_TYPES.AMOUNT_ANALYSIS;
  }

  // 숫자 단독 또는 숫자 중심 질의 - 문서 검색으로 처리
  // 예: "119", "202503", "0321", "계약번호 119"
  const trimmedQ = question.trim();
  const hasOnlyNumbersAndSpaces = /^[\d\s]+$/.test(trimmedQ);
  const startsWithNumber = /^\d/.test(trimmedQ);
  const hasSignificantNumbers = /\d{2,}/.test(trimmedQ); // 2자리 이상 숫자 포함

  if (hasOnlyNumbersAndSpaces || (startsWithNumber && hasSignificantNumbers && trimmedQ.length <= 20)) {
    return QUESTION_TYPES.DOCUMENT_SEARCH;
  }

  // 문서 찾기형 - 우선순위 3 (찾아/어디 키워드가 있으면 문서 찾기)
  if (PATTERNS.document_search.some(keyword => lowerQ.includes(keyword))) {
    return QUESTION_TYPES.DOCUMENT_SEARCH;
  }

    // 문서 요약형 - 계약 키워드 fallback보다 우선
  const hasSummaryKeyword = PATTERNS.document_summary.some(keyword => lowerQ.includes(keyword));
  if (hasSummaryKeyword) {
    return QUESTION_TYPES.DOCUMENT_SUMMARY;
  }

  // 회사명 + 계약 키워드 조합 검사 (예: "KT 계약", "SKT 협약서")
  // - "KT 계약" -> DOCUMENT_SEARCH
  // - "KT 계약서 찾아줘" -> 위에서 이미 DOCUMENT_SEARCH로 분류됨
  // - "KT 계약서 요약해줘" -> 위에서 이미 DOCUMENT_SUMMARY로 분류됨
  // - "KT 계약 종료일 알려줘" -> 맨 위에서 이미 CONTRACT_METADATA로 분류됨
  const contractKeywords = ['계약', '계약서', '협약', '협약서'];
  const hasContractKeyword = contractKeywords.some(keyword => lowerQ.includes(keyword));
  if (hasContractKeyword && hasCompanyOrService) {
    return QUESTION_TYPES.DOCUMENT_SEARCH;
  }

  // 문서 내용 질문형 - 우선순위 5
  if (PATTERNS.document_question.some(keyword => lowerQ.includes(keyword))) {
    return QUESTION_TYPES.DOCUMENT_QUESTION;
  }

  // 종료/만료형
  if (PATTERNS.expiry_check.some(keyword => lowerQ.includes(keyword))) {
    return QUESTION_TYPES.EXPIRY_CHECK;
  }

  // 일정 조회형
  if (PATTERNS.schedule_query.some(keyword => lowerQ.includes(keyword))) {
    return QUESTION_TYPES.SCHEDULE_QUERY;
  }

  // UNKNOWN으로 떨어질 때 디버그 로그 (터미널만, UI에는 표시 안 됨)
  console.log('[DEBUG] 질문 분류 실패 - UNKNOWN');
  console.log(`  질문: "${question}"`);
  console.log(`  회사/서비스 감지: ${hasCompanyOrService ? 'O' : 'X'}`);
  console.log(`  메타데이터 키워드: ${hasMetadataKeyword ? 'O' : 'X'}`);
  console.log(`  검색 키워드: ${PATTERNS.document_search.some(k => lowerQ.includes(k)) ? 'O' : 'X'}`);
    console.log(`  요약 키워드: ${hasSummaryKeyword ? 'O' : 'X'}`);
  console.log(`  질문 키워드: ${PATTERNS.document_question.some(k => lowerQ.includes(k)) ? 'O' : 'X'}`);

  return QUESTION_TYPES.UNKNOWN;
}

/**
 * 질문에서 sourceType 추출
 * @param {string} question
 * @returns {string|null} - 'gdrive-desktop', 'local', 또는 null
 */
function extractSourceType(question) {
  const lowerQ = question.toLowerCase();

  // Google Drive 관련 키워드
  const driveKeywords = ['google drive', 'googledrive', '구글 드라이브', '구글드라이브', '드라이브에서', '드라이브의'];
  if (driveKeywords.some(keyword => lowerQ.includes(keyword))) {
    return 'gdrive-desktop';
  }

  // 로컬 관련 키워드
  const localKeywords = ['로컬', '로컬에서', '내 컴퓨터', '내컴퓨터'];
  if (localKeywords.some(keyword => lowerQ.includes(keyword))) {
    return 'local';
  }

  return null;
}

/**
 * 질문에서 키워드 추출 (문서 검색용)
 * @param {string} question
 * @returns {string}
 */
function extractSearchKeyword(question) {
  // 불용어 목록 (문서 유형 키워드는 제외)
  const stopwords = [
    '어디', '있어', '있나', '있는지', '있는',
    '문서', '파일', '폴더',
    '찾아', '찾아줘', '줘', '주세요',
    '들어가', '들어가있는', '들어가는',
    '관련', '관련된',
    '알려줘', '알려주세요',
    '보여줘', '보여주세요',
    '에서', '의',
    // Source Type 키워드도 제거
    'google drive', 'googledrive', '구글 드라이브', '구글드라이브', '드라이브에서', '드라이브의', '드라이브',
    '로컬', '로컬에서', '내 컴퓨터', '내컴퓨터'
  ];

  let keyword = question;

  // 특수문자 제거
  keyword = keyword.replace(/[?？!！.。]/g, ' ');

  // stopwords 제거
  stopwords.forEach(word => {
    keyword = keyword.replace(new RegExp(word, 'gi'), ' ');
  });

  // 공백 기준으로 분리 후 2글자 이상만 추출
  const words = keyword.split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2);

  // 핵심 키워드 조합
  return words.join(' ').trim();
}

/**
 * 요약 질문용 키워드 추출 (문서 유형 키워드 유지)
 */
function extractSummaryKeyword(question) {
  // 요약 관련 불용어만 제거
  const summaryStopwords = [
    '요약해줘', '요약해', '요약', '정리해줘', '정리해', '정리', '간추려', '간추려줘',
    '핵심만', '알려줘', '알려주세요', '줘', '주세요',
    '무슨', '내용이야', '내용', '뭐야'
  ];

  let keyword = question;

  // 특수문자 제거
  keyword = keyword.replace(/[?？!！.。]/g, ' ');

  // 요약 관련 불용어만 제거 (문서 유형은 유지)
  summaryStopwords.forEach(word => {
    keyword = keyword.replace(new RegExp(word, 'gi'), ' ');
  });

  // 공백 정리
  keyword = keyword.split(/\s+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2)
    .join(' ')
    .trim();

  return keyword;
}

/**
 * 계약 메타데이터 로드
 */
function loadContractsMeta() {
  try {
    const contractsMetaPath = getContractsMetaPath();
    console.log('[askHandler] contracts-meta 경로:', contractsMetaPath);

    if (existsSync(contractsMetaPath)) {
      const content = readFileSync(contractsMetaPath, 'utf-8');
      const data = JSON.parse(content);
      console.log('[askHandler] contracts-meta 로드 성공:', data.contracts ? data.contracts.length : 0, '개 계약');
      return data;
    } else {
      console.warn('[askHandler] contracts-meta 파일 없음:', contractsMetaPath);
    }
  } catch (err) {
    console.warn('[askHandler] 계약 메타데이터 로드 실패:', err.message);
  }
  return null;
}

/**
 * 계약 메타데이터 질문형 처리
 */
async function handleContractMetadata(question) {
  const lowerQ = question.toLowerCase();

  // 메타데이터 로드
  const contractsMeta = loadContractsMeta();
  if (!contractsMeta || contractsMeta.contracts.length === 0) {
    console.log('계약 메타데이터를 찾을 수 없습니다. `node index.js reindex`를 먼저 실행하세요.');
    return;
  }

  // 회사/서비스 추출
  const companies = ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'];
  const services = ['채팅+', '마켓', '비즈챗', '메시지앱', 'OGQ마켓', '플러스'];

  let targetCompany = null;
  let targetService = null;

  for (const company of companies) {
    if (lowerQ.includes(company.toLowerCase())) {
      targetCompany = company;
      break;
    }
  }

  for (const service of services) {
    if (lowerQ.includes(service.toLowerCase())) {
      targetService = service;
      break;
    }
  }

  // 메타데이터 필터링
  let filtered = contractsMeta.contracts;

  if (targetCompany) {
    filtered = filtered.filter(c => c.company === targetCompany || c.counterparty === targetCompany);
  }

  if (targetService) {
    filtered = filtered.filter(c => c.service === targetService);
  }

  if (filtered.length === 0) {
    console.log(`"${targetCompany || targetService}" 관련 계약 메타데이터를 찾을 수 없습니다.`);
    return;
  }

  // 질문 유형 판별 및 응답 (자연어 답변형)
  const contract = filtered[0]; // 가장 첫 번째 결과 사용

  // 1. 모든 메타데이터 수집
  const metadataItems = [];

  // 당사자 정보
  const partyItems = [];
  if (contract.company) {
    partyItems.push({ label: '회사', value: contract.company, confidence: null });
  }
  if (contract.counterparty) {
    partyItems.push({ label: '상대방', value: contract.counterparty, confidence: null });
  }
  if (contract.service) {
    partyItems.push({ label: '서비스', value: contract.service, confidence: null });
  }

  // 기간 정보
  const periodItems = [];
  if (contract.startDate) {
    periodItems.push({
      label: '계약 시작일',
      value: contract.startDate,
      evidence: contract.evidence.startDate,
      confidence: contract.confidence.startDate
    });
  }
  if (contract.endDate) {
    periodItems.push({
      label: '계약 종료일',
      value: contract.endDate,
      evidence: contract.evidence.endDate,
      confidence: contract.confidence.endDate
    });
  }

  // 금액/정산 정보
  const amountItems = [];
  if (contract.amount) {
    amountItems.push({
      label: '계약 금액',
      value: `${contract.amount.toLocaleString('ko-KR')}원`,
      evidence: contract.evidence.amount,
      confidence: contract.confidence.amount
    });
  }
  if (contract.unitPrice) {
    amountItems.push({
      label: '단가',
      value: `${contract.unitPrice.toLocaleString('ko-KR')}원`,
      evidence: contract.evidence.unitPrice,
      confidence: contract.confidence.unitPrice
    });
  }
  if (contract.revenueShare) {
    amountItems.push({
      label: '수익배분',
      value: contract.revenueShare,
      evidence: contract.evidence.revenueShare,
      confidence: contract.confidence.revenueShare
    });
  }

  // 기타 정보
  const overviewItems = [];
  if (contract.docType) {
    overviewItems.push({ label: '문서유형', value: contract.docType, confidence: null });
  }

  // 2. 질문 유형 분석하여 우선순위 결정
  let priorityOrder = [];

  if (lowerQ.match(/종료|끝나|만료|기간|시작일|언제/)) {
    // 기간 질문 -> 기간 우선
    priorityOrder = [periodItems, amountItems, partyItems, overviewItems];
  } else if (lowerQ.match(/수익|정산|금액|배분|비율|수수료|단가/)) {
    // 금액/정산 질문 -> 금액 우선
    priorityOrder = [amountItems, periodItems, partyItems, overviewItems];
  } else if (lowerQ.match(/당사자|누구|회사|파트너|상대방/)) {
    // 당사자 질문 -> 당사자 우선
    priorityOrder = [partyItems, overviewItems, periodItems, amountItems];
  } else {
    // 일반 질문 -> 개요, 당사자, 기간, 금액 순
    priorityOrder = [overviewItems, partyItems, periodItems, amountItems];
  }

  // 3. 우선순위대로 메타데이터 수집
  for (const category of priorityOrder) {
    for (const item of category) {
      metadataItems.push(item);
    }
  }

  // 4. 자연어 인트로 생성
  console.log('='.repeat(80));
  console.log(`📝 답변\n`);

  let intro = '';
  if (contract.service && contract.company) {
    intro = `${contract.company} ${contract.service}`;
  } else if (contract.service && contract.counterparty) {
    intro = `${contract.counterparty} ${contract.service}`;
  } else if (contract.company) {
    intro = contract.company;
  } else if (contract.counterparty) {
    intro = contract.counterparty;
  }

  if (intro) {
    console.log(`${intro} 계약 정보가 확인됩니다:\n`);
  } else {
    console.log(`계약 정보가 확인됩니다:\n`);
  }

  // 5. 메타데이터 항목 출력 (우선순위대로)
  metadataItems.forEach(item => {
    if (item.value) {
      console.log(`• ${item.label}: ${item.value}`);

      // 신뢰도가 낮거나 근거가 있는 경우 추가 정보 표시
      if (item.confidence && item.confidence === 'low') {
        console.log(`  ⚠️  신뢰도 낮음 - 확인 필요`);
      }
    }
  });

  // 6. 참고 정보 (파일 경로)
  console.log(`\n📚 출처: ${contract.sourceFile.split('/').pop()}`);

  console.log('='.repeat(80));

  if (filtered.length > 1) {
    console.log(`\n💡 ${filtered.length}개의 관련 계약이 있습니다. 첫 번째 결과를 표시했습니다.`);
  }
}

/**
 * 문서 요약형 처리
 */
async function handleDocumentSummary(question) {
  const keyword = extractSummaryKeyword(question);

  if (!keyword) {
    console.log('검색할 키워드를 찾을 수 없습니다.');
    console.log('예: "KT 계약서 요약해줘"');
    return;
  }

  console.log(`📊 "${keyword}" 문서 요약 중...\n`);

  // 여러 문서 검색 (상위 3개)
  const searchResult = await searchDocuments(keyword, { silent: false });
  const results = searchResult.results || [];

  if (results.length === 0) {
    console.log('관련 문서를 찾지 못했습니다.');
    return;
  }

  // 상위 2~3개 문서 요약
  const topResults = results.slice(0, 3);
  const documentSummaries = [];

  for (const result of topResults) {
    const summary = await summarizeFile(result.filePath, result);
    if (summary && !summary.error) {
      documentSummaries.push({
        fileName: summary.fileName,
        filePath: summary.filePath,
        docType: summary.docType,
        summary: summary.summary,
        fields: summary.fields,
        contractSummary: summary.contractSummary
      });
    }
  }

  if (documentSummaries.length === 0) {
    console.log('문서 요약에 실패했습니다.');
    return;
  }

  // 답변 요약 생성 (여러 문서의 핵심 정보 통합)
  const combinedAnswer = generateCombinedAnswer(keyword, documentSummaries);

  // 출력: [답변]
  console.log('='.repeat(80));
  console.log(`📝 답변\n`);
  combinedAnswer.forEach(line => {
    console.log(line);
  });
  console.log('');

  // 출력: [참고 문서]
  console.log('📚 참고 문서 (' + documentSummaries.length + '개)\n');
  documentSummaries.forEach((doc, idx) => {
    console.log(`  ${idx + 1}. ${doc.fileName}`);
  });
  console.log('');

  // 출력: [상세 요약]
  console.log('='.repeat(80));
  console.log('📄 상세 문서 요약\n');

  documentSummaries.forEach((doc, idx) => {
    const isGDriveNative = doc.filePath && doc.filePath.startsWith('gdrive://');
    const displayPath = isGDriveNative ? 'Google Drive' : doc.filePath;

    console.log(`[${idx + 1}] ${doc.fileName}`);
    console.log(`    문서유형: ${doc.docType}`);
    console.log(`    위치: ${displayPath}`);
    console.log('    요약:');
    doc.summary.slice(0, 3).forEach((line, i) => {
      console.log(`      ${i + 1}. ${line}`);
    });
    console.log('');
  });

  console.log('='.repeat(80));
  console.log(`\n💡 검색 결과 ${results.length}개 중 상위 ${documentSummaries.length}개 문서를 분석했습니다.`);
}

/**
 * 여러 문서의 요약을 통합하여 질문에 대한 답변 생성 (자연스러운 문구, 파일명 노출 금지)
 */
function generateCombinedAnswer(keyword, documentSummaries) {
  const answer = [];

  // 1. 문서 내용 수집 (카테고리별 분류)
  const companies = new Set();
  const docTypes = new Set();
  const services = new Set();

  const partyInfo = [];      // 당사자 정보
  const periodInfo = [];     // 기간 정보
  const amountInfo = [];     // 금액/정산 정보
  const overviewInfo = [];   // 계약 개요
  const conditionInfo = [];  // 기타 조건

  documentSummaries.forEach(doc => {
    // 회사명
    if (doc.fields?.회사명 && doc.fields.회사명 !== '확인되지 않음') {
      doc.fields.회사명.split(',').forEach(c => companies.add(c.trim()));
    }

    // 서비스
    if (doc.fields?.서비스 && doc.fields.서비스 !== '확인되지 않음') {
      doc.fields.서비스.split(',').forEach(s => services.add(s.trim()));
    }

    // 문서유형
    if (doc.docType && doc.docType !== '알 수 없음') {
      docTypes.add(doc.docType);
    }

    // 계약서/협약서: contractSummary 활용
    if (doc.contractSummary) {
      const cs = doc.contractSummary;

      // 계약 개요
      if (cs.overview && cs.overview.length > 0) {
        cs.overview.forEach(line => {
          const cleaned = line.replace(/계약 당사자:|계약 목적:/g, '').trim();
          if (cleaned.length > 10 && !cleaned.includes('파일') && !cleaned.includes(doc.fileName)) {
            // 당사자 정보 분류
            if (line.includes('당사자') || cleaned.match(/과|와|간|사이/)) {
              partyInfo.push(cleaned.substring(0, 80));
            } else {
              overviewInfo.push(cleaned.substring(0, 80));
            }
          }
        });
      }

      // 주요 조건
      if (cs.mainConditions) {
        Object.entries(cs.mainConditions).forEach(([key, value]) => {
          const valueStr = String(value || '').trim();
          if (valueStr && valueStr !== '확인되지 않음' && valueStr !== '명확히 확인되지 않음') {
            const item = `${key}: ${valueStr}`;

            // 카테고리별 분류
            if (key.match(/기간|시작|종료|만료|유효/)) {
              periodInfo.push(item);
            } else if (key.match(/금액|정산|수익|배분|비율|수수료|단가/)) {
              amountInfo.push(item);
            } else {
              conditionInfo.push(item);
            }
          }
        });
      }

      // 주요 조항 (리스크 제외)
      if (cs.keyTerms) {
        cs.keyTerms.forEach(term => {
          if (!term.isRisk && term.value && term.value !== '명확히 확인되지 않음') {
            const item = `${term.label}: ${term.value}`;

            if (term.label.match(/기간|시작|종료/)) {
              periodInfo.push(item);
            } else if (term.label.match(/금액|정산|수익|배분/)) {
              amountInfo.push(item);
            } else {
              conditionInfo.push(item);
            }
          }
        });
      }
    } else {
      // 일반 문서: summary 활용
      if (doc.summary && doc.summary.length > 0) {
        doc.summary.forEach(line => {
          const cleaned = line.replace(/문서입니다|파일입니다|문서 -|상세 내용은/g, '').trim();
          if (cleaned.length > 10 && !cleaned.includes(doc.fileName) && !cleaned.includes('참조하시기')) {
            overviewInfo.push(cleaned.substring(0, 80));
          }
        });
      }
    }
  });

  // 2. 질문 유형 분석 (강조 순서 결정)
  const lowerKeyword = keyword.toLowerCase();
  let priorityOrder = [];

  if (lowerKeyword.match(/종료|기간|언제|만료|유효/)) {
    // 기간 질문
    priorityOrder = [periodInfo, amountInfo, partyInfo, overviewInfo, conditionInfo];
  } else if (lowerKeyword.match(/수익|정산|금액|배분|비율|수수료/)) {
    // 금액/정산 질문
    priorityOrder = [amountInfo, periodInfo, partyInfo, overviewInfo, conditionInfo];
  } else if (lowerKeyword.match(/당사자|누구|회사|파트너/)) {
    // 당사자 질문
    priorityOrder = [partyInfo, overviewInfo, periodInfo, amountInfo, conditionInfo];
  } else {
    // 일반 요약 (균형있게)
    priorityOrder = [overviewInfo, periodInfo, amountInfo, partyInfo, conditionInfo];
  }

  // 3. 우선순위대로 수집 (중복 제거, 최대 5개)
  const allPoints = [];
  for (const category of priorityOrder) {
    for (const item of category) {
      if (!allPoints.includes(item)) {
        allPoints.push(item);
        if (allPoints.length >= 5) break;
      }
    }
    if (allPoints.length >= 5) break;
  }

  // 4. 답변 생성
  if (allPoints.length === 0) {
    // fallback: 내용 추출 실패
    answer.push('관련 문서를 찾았습니다. 아래 참고 문서를 확인해주세요.');
    return answer;
  }

  const companyStr = companies.size > 0 ? Array.from(companies).join(', ') : '';
  const serviceStr = services.size > 0 ? Array.from(services).join(', ') : '';

  // 자연스러운 첫 문장 생성
  let intro = '';
  if (companyStr && serviceStr) {
    intro = `${companyStr} ${serviceStr}`;
  } else if (companyStr) {
    intro = companyStr;
  } else if (serviceStr) {
    intro = serviceStr;
  }

  if (intro) {
    answer.push(`${intro} 관련 문서에서 다음 내용이 확인됩니다:`);
  } else {
    answer.push('관련 문서에서 다음 내용이 확인됩니다:');
  }
  answer.push('');

  // 핵심 내용 (우선순위대로)
  allPoints.forEach(point => {
    answer.push(`• ${point}`);
  });

  return answer;
}

/**
 * 문서 찾기형 처리
 */
async function handleDocumentSearch(question) {
  const keyword = extractSearchKeyword(question);
  const sourceType = extractSourceType(question);

  if (!keyword) {
    console.log('검색할 키워드를 찾을 수 없습니다.');
    console.log('예: "SKT 계약서 어디 있어?"');
    return;
  }

  let searchLabel = `"${keyword}"`;
  if (sourceType === 'gdrive-desktop') {
    searchLabel += ' (Google Drive)';
  } else if (sourceType === 'local') {
    searchLabel += ' (로컬)';
  }

  console.log(`📄 ${searchLabel} 관련 문서 검색 중...\n`);

  const options = {
    originalQuestion: question
  };

  if (sourceType) {
    options.sourceType = sourceType;
  }

  const { results, truncated, searchMode, categories } = await searchDocuments(keyword, options);

  // 자연어 답변 블록 생성
  console.log('='.repeat(80));
  console.log('📝 답변\n');

  if (results.length === 0) {
    console.log(`${keyword} 관련 문서를 찾을 수 없습니다.`);
    console.log('다른 키워드로 다시 검색해 보시기 바랍니다.\n');
    console.log('='.repeat(80));
    return;
  }

  // 검색 범위 분석 (카테고리 추출)
  let intro = '';
  if (categories && (categories.companies.length > 0 || categories.docTypes.length > 0)) {
    // 중복 제거: "계약"과 "계약서"가 같이 있으면 더 긴 표현만 사용
    const deduplicatedDocTypes = categories.docTypes.filter((docType, idx, arr) => {
      const baseForm = docType.replace(/서$/, '');
      const hasLongerForm = arr.some(d => d !== docType && d === baseForm + '서');
      return !hasLongerForm || docType.endsWith('서');
    });

    const scopeItems = [...categories.companies, ...deduplicatedDocTypes];
    intro = scopeItems.join(' ');
  }

  // 자연어 인트로 생성
  if (intro) {
    console.log(`${intro} 관련 문서 ${results.length}개를 찾았습니다.`);
  } else {
    console.log(`${keyword} 관련 문서 ${results.length}개를 찾았습니다.`);
  }

  // 소스 타입별 개수 표시
  const gdriveCount = results.filter(r => r.sourceType === 'gdrive-native').length;
  const localCount = results.length - gdriveCount;

  if (gdriveCount > 0 && localCount > 0) {
    console.log(`(Google Drive ${gdriveCount}개, 로컬 ${localCount}개)`);
  } else if (gdriveCount > 0) {
    console.log(`(Google Drive ${gdriveCount}개)`);
  } else if (localCount > 0) {
    console.log(`(로컬 ${localCount}개)`);
  }

  console.log('\n아래 참고 문서를 확인해 주세요.\n');

  if (truncated) {
    console.log('⚠️  검색 범위가 넓습니다. 키워드를 더 구체적으로 입력하시면 정확한 결과를 얻을 수 있습니다.\n');
  }

  console.log('='.repeat(80));
  console.log('📚 참고 문서\n');

  // 상위 5개만 출력
  const topResults = results.slice(0, 5);
  for (let i = 0; i < topResults.length; i++) {
    const result = topResults[i];
    const isGDriveNative = result.sourceType === 'gdrive-native';
    const folderPath = result.filePath.split('/').slice(0, -1).join('/');
    const displayLocation = isGDriveNative ? 'Google Drive' : folderPath;

    console.log(`${i + 1}. ${result.fileName}`);
    console.log(`   위치: ${displayLocation}`);

    if (isGDriveNative) {
      const driveLink = result.webViewLink || result.filePath;
      console.log(`   Drive에서 열기: ${driveLink}`);
    } else {
      console.log(`   파일 열기: file://${result.filePath}`);
      console.log(`   폴더 열기: file://${folderPath}`);
    }

    // 매칭 정보 (간결하게)
    if (result.matchInfo && result.matchInfo.length > 0) {
      const displayMatchInfo = result.matchInfo.slice(0, 3);
      const hiddenCount = result.matchInfo.length - displayMatchInfo.length;
      const matchInfoStr = displayMatchInfo.join(', ') + (hiddenCount > 0 ? ` 외 ${hiddenCount}개` : '');
      console.log(`   매칭: ${matchInfoStr}`);
    }

    // 특이사항 (스캔 PDF, OCR 등)
    if (result.isScanned || (!result.extractedTextAvailable && result.filePath.toLowerCase().endsWith('.pdf'))) {
      console.log(`   ⚠️  ${result.snippets[0]}`);
      if (result.ocrUsed) {
        if (result.ocrSucceeded) {
          console.log(`   ✅ OCR 성공 - 텍스트 추출됨`);
        } else {
          console.log(`   ❌ OCR 실패`);
        }
      }
    } else {
      if (result.snippets.length > 0 && result.snippets[0] !== '(파일명/폴더명 매칭)') {
        console.log(`   관련 내용: ${result.snippets[0].substring(0, 100)}${result.snippets[0].length > 100 ? '...' : ''}`);
      }
    }

    console.log('');
  }

  console.log('='.repeat(80));

  // 하단 안내 (자연어)
  if (results.length > 5) {
    console.log(`\n💡 상위 5개 문서를 표시했습니다. 총 ${results.length}개 문서가 검색되었습니다.`);
  }
}

/**
 * 일정 조회형 처리
 */
function handleScheduleQuery(question, events) {
  console.log(`📅 일정 조회: "${question}"\n`);

  // naturalQuery 사용
  const { results, summary } = executeNaturalQuery(question, events);

  if (results.length === 0) {
    console.log('조건에 맞는 일정이 없습니다.\n');
    summary.forEach(line => console.log(line));
    return;
  }

  console.log(renderTable(results));
  console.log('');
  summary.forEach(line => console.log(line));
  console.log(`\n💡 ${results.length}건의 일정이 있습니다.`);
}

/**
 * 종료/만료형 처리
 */
function handleExpiryCheck(question, events) {
  console.log(`⏰ 종료/만료 확인: "${question}"\n`);

  // 질문에서 거래처 추출
  const clients = [...new Set(events.map(e => e.client))];
  let targetClient = null;

  for (const client of clients) {
    if (question.includes(client)) {
      targetClient = client;
      break;
    }
  }

  // 계약 종료 일정 필터
  let filtered = events.filter(e => e.type === '계약' && e.endDate);

  if (targetClient) {
    filtered = filtered.filter(e => e.client === targetClient);
  }

  if (filtered.length === 0) {
    console.log('해당하는 계약 종료 일정이 없습니다.');
    return;
  }

  // 종료일 기준 정렬 (가까운 순)
  filtered.sort((a, b) => {
    const dateA = new Date(a.endDate);
    const dateB = new Date(b.endDate);
    return dateA - dateB;
  });

  console.log(renderTable(filtered));
  console.log(`\n💡 ${filtered.length}건의 계약 종료 일정이 있습니다.`);
}

/**
 * 금액 분석형 처리
 */
function handleAmountAnalysis(question, events) {
  console.log(`💰 금액 분석: "${question}"\n`);

  const today = dayjs();
  let periodStart, periodEnd;
  let periodLabel = '';
  let targetType = null;

  // 기간 파싱
  if (question.includes('이번달')) {
    periodStart = today.startOf('month');
    periodEnd = today.endOf('month');
    periodLabel = `이번달 (${periodStart.format('YYYY-MM-DD')} ~ ${periodEnd.format('YYYY-MM-DD')})`;
  } else if (question.includes('다음달')) {
    periodStart = today.add(1, 'month').startOf('month');
    periodEnd = today.add(1, 'month').endOf('month');
    periodLabel = `다음달 (${periodStart.format('YYYY-MM-DD')} ~ ${periodEnd.format('YYYY-MM-DD')})`;
  } else if (question.includes('올해')) {
    periodStart = today.startOf('year');
    periodEnd = today.endOf('year');
    periodLabel = `올해 (${periodStart.format('YYYY')})`;
  } else {
    console.log('기간을 인식할 수 없습니다. (이번달/다음달/올해)');
    return;
  }

  // 청구/계약 타입 판별
  if (question.includes('청구') || question.includes('결제')) {
    targetType = '청구';
  } else if (question.includes('계약')) {
    targetType = '계약';
  } else {
    console.log('타입을 인식할 수 없습니다. (청구/계약)');
    return;
  }

  // 필터링
  let filtered = [];

  if (targetType === '청구') {
    // 청구: invoice_date 또는 due_date가 기간 내
    filtered = events.filter(e => {
      if (e.type !== '청구') return false;
      if (!e.amount || e.amount <= 0) return false;

      const invoiceDate = e.invoiceDate ? dayjs(e.invoiceDate) : null;
      const dueDate = e.dueDate ? dayjs(e.dueDate) : null;
      const startDate = e.startDate ? dayjs(e.startDate) : null;

      // invoice_date, due_date, start_date 중 하나라도 기간 내에 있으면 포함
      if (invoiceDate && invoiceDate >= periodStart && invoiceDate <= periodEnd) return true;
      if (dueDate && dueDate >= periodStart && dueDate <= periodEnd) return true;
      if (startDate && startDate >= periodStart && startDate <= periodEnd) return true;

      return false;
    });
  } else if (targetType === '계약') {
    // 계약: start_date가 기간 내
    filtered = events.filter(e => {
      if (e.type !== '계약') return false;
      if (!e.amount || e.amount <= 0) return false;
      if (!e.startDate) return false;

      const startDate = dayjs(e.startDate);
      return startDate >= periodStart && startDate <= periodEnd;
    });
  }

  if (filtered.length === 0) {
    console.log(`${periodLabel} ${targetType} 항목이 없습니다.`);
    return;
  }

  // 금액 합산
  const totalAmount = filtered.reduce((sum, e) => sum + (e.amount || 0), 0);

  // 결과 출력
  console.log(`조건: ${targetType} / ${periodLabel}`);
  console.log(`\n💵 합계 금액: ${totalAmount.toLocaleString('ko-KR')}원`);
  console.log(`📊 해당 건수: ${filtered.length}건\n`);

  // 관련 항목 표
  console.log('관련 항목:\n');
  console.log(renderTable(filtered));
}


/**
 * ask 명령 핸들러
 * @param {string} question - 사용자 질문
 * @param {Array} events - 일정 데이터 (schedule_query, expiry_check용)
 */
export async function handleAsk(question, events = []) {
  const questionType = classifyQuestion(question);

  console.log(`질문: "${question}"\n`);

  switch (questionType) {
    case QUESTION_TYPES.CONTRACT_METADATA:
      await handleContractMetadata(question);
      break;

    case QUESTION_TYPES.DOCUMENT_SEARCH:
      await handleDocumentSearch(question);
      break;

    case QUESTION_TYPES.DOCUMENT_SUMMARY:
      await handleDocumentSummary(question);
      break;

    case QUESTION_TYPES.DOCUMENT_QUESTION:
      await handleDocumentQuestion(question);
      break;

    case QUESTION_TYPES.SCHEDULE_QUERY:
      if (events.length === 0) {
        console.log('일정 데이터를 불러올 수 없습니다.');
        return;
      }
      handleScheduleQuery(question, events);
      break;

    case QUESTION_TYPES.EXPIRY_CHECK:
      if (events.length === 0) {
        console.log('일정 데이터를 불러올 수 없습니다.');
        return;
      }
      handleExpiryCheck(question, events);
      break;

    case QUESTION_TYPES.AMOUNT_ANALYSIS:
      if (events.length === 0) {
        console.log('일정 데이터를 불러올 수 없습니다.');
        return;
      }
      handleAmountAnalysis(question, events);
      break;

    default:
      console.log('질문을 이해하지 못했습니다.');
      console.log('\n사용 가능한 질문 유형:');
      console.log('  - 계약 메타데이터: "SKT 계약 언제 끝나?", "비즈챗 단가 얼마야?", "채팅+ 수익배분 몇 %야?"');
      console.log('  - 문서 찾기: "SKT 계약서 어디 있어?"');
      console.log('  - 문서 요약: "KT 계약서 요약해줘"');
      console.log('  - 문서 내용 질문: "비즈챗 운영비 얼마야?"');
      console.log('  - 일정 조회: "다음달 청구 일정 뭐야?"');
      console.log('  - 종료 확인: "KT 계약 종료 언제야?"');
      console.log('  - 금액 분석: "이번달 청구 총액 얼마야?"');
      break;
  }
}

/**
 * HTML 출력용 구조화 데이터 반환
 * @param {string} question - 사용자 질문
 * @param {Array} events - 일정 데이터
 * @returns {Promise<Object>} - 구조화된 결과 데이터
 */
export async function handleAskForHtml(question, events = []) {
  const questionType = classifyQuestion(question);

  const result = {
    question,
    questionType,
    timestamp: new Date().toISOString(),
    data: null,
    error: null
  };

  try {
    switch (questionType) {
      case QUESTION_TYPES.CONTRACT_METADATA: {
        const lowerQ = question.toLowerCase();

        // 메타데이터 로드
        const contractsMeta = loadContractsMeta();
        if (!contractsMeta || contractsMeta.contracts.length === 0) {
          result.error = '계약 메타데이터를 찾을 수 없습니다. reindex를 먼저 실행하세요.';
          return result;
        }

        // 회사/서비스 추출
        const companies = ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'];
        const services = ['채팅+', '마켓', '비즈챗', '메시지앱', 'OGQ마켓', '플러스'];

        let targetCompany = null;
        let targetService = null;

        for (const company of companies) {
          if (lowerQ.includes(company.toLowerCase())) {
            targetCompany = company;
            break;
          }
        }

        for (const service of services) {
          if (lowerQ.includes(service.toLowerCase())) {
            targetService = service;
            break;
          }
        }

        // 메타데이터 필터링
        let filtered = contractsMeta.contracts;

        if (targetCompany) {
          filtered = filtered.filter(c => c.company === targetCompany || c.counterparty === targetCompany);
        }

        if (targetService) {
          filtered = filtered.filter(c => c.service === targetService);
        }

        if (filtered.length === 0) {
          result.error = `"${targetCompany || targetService}" 관련 계약을 찾을 수 없습니다.`;
          return result;
        }

        // 질문 유형 판별 및 데이터 추출
        const contract = filtered[0];
        let fieldName = null;
        let fieldValue = null;
        let evidence = null;
        let confidence = null;

        if (lowerQ.includes('시작일') || lowerQ.includes('계약기간')) {
          fieldName = '계약 시작일';
          fieldValue = contract.startDate;
          evidence = contract.evidence.startDate;
          confidence = contract.confidence.startDate;
        } else if (lowerQ.includes('종료일') || lowerQ.includes('끝나') || lowerQ.includes('만료')) {
          fieldName = '계약 종료일';
          fieldValue = contract.endDate;
          evidence = contract.evidence.endDate;
          confidence = contract.confidence.endDate;
        } else if (lowerQ.includes('단가')) {
          fieldName = '단가';
          fieldValue = contract.unitPrice ? `${contract.unitPrice.toLocaleString('ko-KR')}원` : null;
          evidence = contract.evidence.unitPrice;
          confidence = contract.confidence.unitPrice;
        } else if (lowerQ.includes('수익배분') || lowerQ.includes('배분') || lowerQ.includes('정산비율')) {
          fieldName = '수익배분';
          fieldValue = contract.revenueShare;
          evidence = contract.evidence.revenueShare;
          confidence = contract.confidence.revenueShare;
        } else if (lowerQ.includes('계약금액') || lowerQ.includes('계약 금액') || lowerQ.includes('금액')) {
          fieldName = '계약 금액';
          fieldValue = contract.amount ? `${contract.amount.toLocaleString('ko-KR')}원` : null;
          evidence = contract.evidence.amount;
          confidence = contract.confidence.amount;
        }

        result.data = {
          type: 'contract_metadata',
          contract,
          fieldName,
          fieldValue,
          evidence,
          confidence,
          totalMatches: filtered.length
        };
        break;
      }

      case QUESTION_TYPES.DOCUMENT_SEARCH: {
        const keyword = extractSearchKeyword(question);
        const sourceType = extractSourceType(question);

        if (!keyword) {
          result.error = '검색할 키워드를 찾을 수 없습니다.';
          return result;
        }

        const options = {
          silent: true,
          originalQuestion: question
        };

        if (sourceType) {
          options.sourceType = sourceType;
        }

        const { results: documents, truncated, searchMode, categories } = await searchDocuments(keyword, options);

        // 스캔본 PDF 개수 계산
        const scannedCount = documents.filter(d => d.isScanned).length;
        const textAvailableCount = documents.filter(d => !d.isScanned && d.extractedTextAvailable !== false).length;

        // 자연어 답변 생성
        let naturalAnswer = '';
        if (documents.length === 0) {
          naturalAnswer = `${keyword} 관련 문서를 찾을 수 없습니다.\n다른 키워드로 다시 검색해 보시기 바랍니다.`;
        } else {
          // 검색 범위 분석
          let intro = '';
          if (categories && (categories.companies.length > 0 || categories.docTypes.length > 0)) {
            const deduplicatedDocTypes = categories.docTypes.filter((docType, idx, arr) => {
              const baseForm = docType.replace(/서$/, '');
              const hasLongerForm = arr.some(d => d !== docType && d === baseForm + '서');
              return !hasLongerForm || docType.endsWith('서');
            });
            const scopeItems = [...categories.companies, ...deduplicatedDocTypes];
            intro = scopeItems.join(' ');
          }

          // 소스 타입별 개수
          const gdriveCount = documents.filter(r => r.sourceType === 'gdrive-native').length;
          const localCount = documents.length - gdriveCount;

          const answerLines = [];
          if (intro) {
            answerLines.push(`${intro} 관련 문서 ${documents.length}개를 찾았습니다.`);
          } else {
            answerLines.push(`${keyword} 관련 문서 ${documents.length}개를 찾았습니다.`);
          }

          // 소스 타입 정보
          if (gdriveCount > 0 && localCount > 0) {
            answerLines.push(`(Google Drive ${gdriveCount}개, 로컬 ${localCount}개)`);
          } else if (gdriveCount > 0) {
            answerLines.push(`(Google Drive ${gdriveCount}개)`);
          } else if (localCount > 0) {
            answerLines.push(`(로컬 ${localCount}개)`);
          }

          answerLines.push('');
          answerLines.push('아래 참고 문서를 확인해 주세요.');

          if (truncated) {
            answerLines.push('');
            answerLines.push('⚠️ 검색 범위가 넓습니다. 키워드를 더 구체적으로 입력하시면 정확한 결과를 얻을 수 있습니다.');
          }

          naturalAnswer = answerLines.join('\n');
        }

        result.data = {
          type: 'document_search',
          keyword,
          results: documents,
          truncated,
          searchMode,
          categories,
          sourceType,
          scannedCount,
          textAvailableCount,
          naturalAnswer, // 새로 추가
          summary: `${documents.length}개 문서 발견${truncated ? ' (검색 범위 제한)' : ''}${scannedCount > 0 ? ` (스캔본 ${scannedCount}개)` : ''}`
        };
        break;
      }

      case QUESTION_TYPES.DOCUMENT_SUMMARY: {
        const keyword = extractSummaryKeyword(question);
        if (!keyword) {
          result.error = '검색할 키워드를 찾을 수 없습니다.';
          return result;
        }

        // 여러 문서 검색 (상위 3개)
        const searchResult = await searchDocuments(keyword, { silent: true });
        const results = searchResult.results || [];

        if (results.length === 0) {
          result.error = '관련 문서를 찾지 못했습니다.';
          return result;
        }

        // 상위 2~3개 문서 요약
        const topResults = results.slice(0, 3);
        const documentSummaries = [];

        for (const res of topResults) {
          const summary = await summarizeFile(res.filePath, res);
          if (summary && !summary.error) {
            documentSummaries.push({
              fileName: summary.fileName,
              filePath: summary.filePath,
              docType: summary.docType,
              summary: summary.summary,
              fields: summary.fields,
              contractSummary: summary.contractSummary,
              webViewLink: res.webViewLink
            });
          }
        }

        if (documentSummaries.length === 0) {
          result.error = '문서 요약에 실패했습니다.';
          return result;
        }

        // 답변 요약 생성
        const combinedAnswer = generateCombinedAnswer(keyword, documentSummaries);

        result.data = {
          type: 'document_summary',
          keyword,
          documents: documentSummaries,
          combinedAnswer,
          searchResultCount: results.length
        };
        break;
      }

      case QUESTION_TYPES.DOCUMENT_QUESTION: {
        const docResult = await handleDocumentQuestionForData(question);
        result.data = {
          type: 'document_question',
          ...docResult
        };
        break;
      }

      case QUESTION_TYPES.SCHEDULE_QUERY: {
        if (events.length === 0) {
          result.error = '일정 데이터를 불러올 수 없습니다.';
          return result;
        }

        const { results, summary } = executeNaturalQuery(question, events);
        result.data = {
          type: 'schedule_query',
          results,
          summary: summary.join('\n'),
          count: results.length
        };
        break;
      }

      case QUESTION_TYPES.EXPIRY_CHECK: {
        if (events.length === 0) {
          result.error = '일정 데이터를 불러올 수 없습니다.';
          return result;
        }

        // 질문에서 거래처 추출
        const clients = [...new Set(events.map(e => e.client))];
        let targetClient = null;

        for (const client of clients) {
          if (question.includes(client)) {
            targetClient = client;
            break;
          }
        }

        // 계약 종료 일정 필터
        let filtered = events.filter(e => e.type === '계약' && e.endDate);

        if (targetClient) {
          filtered = filtered.filter(e => e.client === targetClient);
        }

        // 종료일 기준 정렬 (가까운 순)
        filtered.sort((a, b) => {
          const dateA = new Date(a.endDate);
          const dateB = new Date(b.endDate);
          return dateA - dateB;
        });

        result.data = {
          type: 'expiry_check',
          client: targetClient,
          results: filtered,
          count: filtered.length,
          summary: `${filtered.length}건의 계약 종료 일정`
        };
        break;
      }

      case QUESTION_TYPES.AMOUNT_ANALYSIS: {
        if (events.length === 0) {
          result.error = '일정 데이터를 불러올 수 없습니다.';
          return result;
        }

        const today = dayjs();
        let periodStart, periodEnd;
        let periodLabel = '';
        let targetType = null;

        // 기간 파싱
        if (question.includes('이번달')) {
          periodStart = today.startOf('month');
          periodEnd = today.endOf('month');
          periodLabel = `이번달 (${periodStart.format('YYYY-MM-DD')} ~ ${periodEnd.format('YYYY-MM-DD')})`;
        } else if (question.includes('다음달')) {
          periodStart = today.add(1, 'month').startOf('month');
          periodEnd = today.add(1, 'month').endOf('month');
          periodLabel = `다음달 (${periodStart.format('YYYY-MM-DD')} ~ ${periodEnd.format('YYYY-MM-DD')})`;
        } else if (question.includes('올해')) {
          periodStart = today.startOf('year');
          periodEnd = today.endOf('year');
          periodLabel = `올해 (${periodStart.format('YYYY')})`;
        } else {
          result.error = '기간을 인식할 수 없습니다. (이번달/다음달/올해)';
          return result;
        }

        // 청구/계약 타입 판별
        if (question.includes('청구') || question.includes('결제')) {
          targetType = '청구';
        } else if (question.includes('계약')) {
          targetType = '계약';
        } else {
          result.error = '타입을 인식할 수 없습니다. (청구/계약)';
          return result;
        }

        // 필터링
        let filtered = [];

        if (targetType === '청구') {
          // 청구: invoice_date 또는 due_date가 기간 내
          filtered = events.filter(e => {
            if (e.type !== '청구') return false;
            if (!e.amount || e.amount <= 0) return false;

            const invoiceDate = e.invoiceDate ? dayjs(e.invoiceDate) : null;
            const dueDate = e.dueDate ? dayjs(e.dueDate) : null;
            const startDate = e.startDate ? dayjs(e.startDate) : null;

            // invoice_date, due_date, start_date 중 하나라도 기간 내에 있으면 포함
            if (invoiceDate && invoiceDate >= periodStart && invoiceDate <= periodEnd) return true;
            if (dueDate && dueDate >= periodStart && dueDate <= periodEnd) return true;
            if (startDate && startDate >= periodStart && startDate <= periodEnd) return true;

            return false;
          });
        } else if (targetType === '계약') {
          // 계약: start_date가 기간 내
          filtered = events.filter(e => {
            if (e.type !== '계약') return false;
            if (!e.amount || e.amount <= 0) return false;
            if (!e.startDate) return false;

            const startDate = dayjs(e.startDate);
            return startDate >= periodStart && startDate <= periodEnd;
          });
        }

        // 금액 합산
        const totalAmount = filtered.reduce((sum, e) => sum + (e.amount || 0), 0);

        result.data = {
          type: 'amount_analysis',
          targetType,
          period: periodLabel,
          results: filtered,
          totalAmount,
          count: filtered.length,
          summary: `${periodLabel} ${targetType} 합계: ${totalAmount.toLocaleString('ko-KR')}원 (${filtered.length}건)`
        };
        break;
      }

      default:
        result.error = '질문을 이해하지 못했습니다.';
        break;
    }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}
