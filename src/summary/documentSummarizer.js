/**
 * 문서 자동 요약
 */
import { existsSync, readFileSync } from 'fs';
import { getCachedText } from '../search/cacheManager.js';
import { extractText } from '../search/textExtractor.js';
import { searchDocuments } from '../search/documentSearch.js';
import { basename } from 'path';

const CONTRACTS_META_FILE = 'data/.index/contracts-meta.json';

/**
 * 파일명/표시명 결정 (documentSearch.js와 동일한 로직)
 * @param {string|Object} fileNameOrDoc - fileName 문자열 또는 doc 객체
 * @param {Object} [docContext] - 추가 doc 정보 (옵션)
 */
function resolveDisplayFileName(fileNameOrDoc, docContext = null) {
  // docContext가 명시적으로 전달된 경우 우선 처리
  if (docContext && typeof docContext === 'object') {
    const candidates = [docContext.fileName, docContext.title, docContext.name, docContext.displayName]
      .map(v => typeof v === 'string' ? v.trim() : '')
      .filter(Boolean);

    for (const value of candidates) {
      if (!value.startsWith('gdrive://')) {
        return value;
      }
    }

    const pathValue = typeof docContext.path === 'string' ? docContext.path.trim() : '';
    if (pathValue.startsWith('gdrive://')) {
      return 'Google Drive 문서';
    }

    if (pathValue) {
      return pathValue.split('/').pop();
    }
  }

  // 문자열이 직접 전달된 경우
  if (typeof fileNameOrDoc === 'string') {
    const fileName = fileNameOrDoc;
    // gdrive:// ID는 표시하지 않음
    if (fileName.startsWith('gdrive://')) {
      return 'Google Drive 문서';
    }
    return fileName;
  }

  // 객체가 전달된 경우
  const doc = fileNameOrDoc;
  const candidates = [doc.fileName, doc.title, doc.name, doc.displayName]
    .map(v => typeof v === 'string' ? v.trim() : '')
    .filter(Boolean);

  for (const value of candidates) {
    if (!value.startsWith('gdrive://')) {
      return value;
    }
  }

  const pathValue = typeof doc.path === 'string' ? doc.path.trim() : '';
  if (pathValue.startsWith('gdrive://')) {
    return 'Google Drive 문서';
  }

  if (pathValue) {
    return pathValue.split('/').pop();
  }

  return '문서';
}

/**
 * 계약 메타데이터 로드
 */
function loadContractsMeta() {
  try {
    if (existsSync(CONTRACTS_META_FILE)) {
      const content = readFileSync(CONTRACTS_META_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    // 메타데이터 로드 실패시 무시
  }
  return null;
}

/**
 * 파일경로로 계약 메타데이터 찾기
 */
function findContractMeta(filePath) {
  const contractsMeta = loadContractsMeta();
  if (!contractsMeta) return null;

  return contractsMeta.contracts.find(c => c.sourceFile === filePath);
}

/**
 * 문서 유형 추론
 */
function inferDocType(fileName, text) {
  const lowerFileName = fileName.toLowerCase();
  const lowerText = (text || '').toLowerCase();

  if (lowerFileName.includes('계약서') || lowerText.includes('계약서')) {
    return '계약서';
  }
  if (lowerFileName.includes('협약서') || lowerText.includes('협약서')) {
    return '협약서';
  }
  if (lowerFileName.includes('견적서') || lowerText.includes('견적서')) {
    return '견적서';
  }
  if (lowerFileName.includes('정산서') || lowerText.includes('정산')) {
    return '정산서';
  }
  if (lowerFileName.includes('청구서') || lowerText.includes('청구')) {
    return '청구서';
  }
  if (lowerFileName.includes('제안서')) {
    return '제안서';
  }
  if (lowerFileName.includes('소개서')) {
    return '소개서';
  }

  return '문서';
}

/**
 * 회사명 추출 (정확한 단어 매칭)
 */
function extractCompanies(fileName, text) {
  const companies = ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'];
  const found = [];

  companies.forEach(company => {
    // 파일명에서 정확한 단어 매칭
    const filePattern = new RegExp(`(?:^|[^a-z0-9가-힣])${company}(?:[^a-z0-9가-힣]|$)`, 'i');
    if (filePattern.test(fileName)) {
      if (!found.includes(company)) {
        found.push(company);
      }
      return;
    }

    // 텍스트에서도 매칭 (처음 2000자)
    if (text) {
      const textPattern = new RegExp(`(?:^|[^a-z0-9가-힣])${company}(?:[^a-z0-9가-힣]|$)`, 'i');
      const preview = text.substring(0, 2000);
      if (textPattern.test(preview)) {
        if (!found.includes(company)) {
          found.push(company);
        }
      }
    }
  });

  return found.length > 0 ? found.join(', ') : '확인되지 않음';
}

/**
 * 서비스명 추출
 */
function extractServices(fileName, text) {
  const services = ['채팅+', '마켓', '비즈챗', '메시지앱', 'OGQ마켓', '플러스'];
  const found = [];

  services.forEach(service => {
    if (fileName.includes(service) || (text && text.substring(0, 2000).includes(service))) {
      if (!found.includes(service)) {
        found.push(service);
      }
    }
  });

  return found.length > 0 ? found.join(', ') : '확인되지 않음';
}

/**
 * 금액 추출 (원, 달러, 천, 억 등)
 */
function extractAmounts(text) {
  if (!text) return '확인되지 않음';

  const amounts = [];

  // 숫자 + 원 패턴
  const wonPattern = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*원/g;
  let match;
  while ((match = wonPattern.exec(text)) !== null && amounts.length < 3) {
    amounts.push(match[0]);
  }

  // 억원 패턴
  const billionPattern = /(\d+(?:\.\d+)?)\s*억\s*원/g;
  while ((match = billionPattern.exec(text)) !== null && amounts.length < 3) {
    amounts.push(match[0]);
  }

  // 만원 패턴
  const manwonPattern = /(\d+(?:,\d{3})*)\s*만\s*원/g;
  while ((match = manwonPattern.exec(text)) !== null && amounts.length < 3) {
    amounts.push(match[0]);
  }

  return amounts.length > 0 ? amounts.slice(0, 3).join(', ') : '확인되지 않음';
}

/**
 * 날짜 추출 (계약기간, 종료일 등) - 시작일/종료일 구분
 */
function extractDates(text) {
  if (!text) return '확인되지 않음';

  const dates = {
    start: [],
    end: [],
    general: []
  };

  // YYYY-MM-DD 또는 YYYY.MM.DD 형식
  const datePattern = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/g;
  let match;
  const allMatches = [];
  while ((match = datePattern.exec(text)) !== null) {
    allMatches.push({
      date: match[0],
      index: match.index,
      context: text.substring(Math.max(0, match.index - 20), Math.min(text.length, match.index + 30))
    });
  }

  // "2024년 1월 1일" 형식
  const koreanDatePattern = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g;
  while ((match = koreanDatePattern.exec(text)) !== null) {
    allMatches.push({
      date: match[0],
      index: match.index,
      context: text.substring(Math.max(0, match.index - 20), Math.min(text.length, match.index + 30))
    });
  }

  // 컨텍스트 기반 분류
  allMatches.forEach(item => {
    const ctx = item.context.toLowerCase();
    if (ctx.includes('시작') || ctx.includes('개시') || ctx.includes('from')) {
      dates.start.push(item.date);
    } else if (ctx.includes('종료') || ctx.includes('만료') || ctx.includes('끝') || ctx.includes('to')) {
      dates.end.push(item.date);
    } else {
      dates.general.push(item.date);
    }
  });

  const result = [];
  if (dates.start.length > 0) result.push(`시작: ${dates.start[0]}`);
  if (dates.end.length > 0) result.push(`종료: ${dates.end[0]}`);
  if (result.length === 0 && dates.general.length > 0) {
    result.push(dates.general.slice(0, 2).join(', '));
  }

  return result.length > 0 ? result.join(' / ') : '확인되지 않음';
}

/**
 * 수수료/요율 추출
 */
function extractFees(text) {
  if (!text) return '확인되지 않음';

  const fees = [];

  // %로 끝나는 패턴
  const percentPattern = /(\d+(?:\.\d+)?)\s*%/g;
  let match;
  while ((match = percentPattern.exec(text)) !== null && fees.length < 3) {
    fees.push(match[0]);
  }

  // "수수료" 키워드 주변 텍스트
  const feeIndex = text.indexOf('수수료');
  if (feeIndex !== -1 && fees.length === 0) {
    const snippet = text.substring(Math.max(0, feeIndex - 50), Math.min(text.length, feeIndex + 100));
    const feeMatch = snippet.match(/(\d+(?:\.\d+)?)\s*%/);
    if (feeMatch) {
      fees.push(feeMatch[0]);
    }
  }

  return fees.length > 0 ? fees.slice(0, 3).join(', ') : '확인되지 않음';
}

/**
 * 계약 당사자 추출 (개선)
 */
function extractParties(text, fileName) {
  if (!text) return { party1: null, party2: null, description: null };

  const parties = { party1: null, party2: null, description: null };
  const preview = text.substring(0, 3000);

  // 1. "갑: 회사명, 을: 회사명" 패턴
  const gapEulPattern = /갑[:\s]*([^\n,]{2,30})[,\s]*을[:\s]*([^\n]{2,30})/;
  const gapEulMatch = preview.match(gapEulPattern);
  if (gapEulMatch) {
    parties.party1 = gapEulMatch[1].replace(/[()]/g, '').trim();
    parties.party2 = gapEulMatch[2].replace(/[()]/g, '').trim();
    parties.description = `${parties.party1}(갑)과 ${parties.party2}(을) 간`;
    return parties;
  }

  // 2. "A와 B는 다음과 같이" 패턴
  const betweenPattern = /([가-힣A-Z\s]{2,20}(?:주식회사|주식회사)?)\s*(?:와|과)\s*([가-힣A-Z\s]{2,20}(?:주식회사|주식회사)?)\s*(?:는|간)/;
  const betweenMatch = preview.match(betweenPattern);
  if (betweenMatch) {
    parties.party1 = betweenMatch[1].trim();
    parties.party2 = betweenMatch[2].trim();
    parties.description = `${parties.party1}과 ${parties.party2} 간`;
    return parties;
  }

  // 3. 파일명에서 회사명 추출
  const companies = ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'];
  const foundCompanies = [];
  companies.forEach(company => {
    const pattern = new RegExp(`(?:^|[^a-z0-9가-힣])${company}(?:[^a-z0-9가-힣]|$)`, 'i');
    if (pattern.test(fileName)) {
      foundCompanies.push(company);
    }
  });

  if (foundCompanies.length >= 2) {
    parties.party1 = foundCompanies[0];
    parties.party2 = foundCompanies[1];
    parties.description = `${parties.party1}과 ${parties.party2} 간`;
  } else if (foundCompanies.length === 1) {
    parties.party1 = foundCompanies[0];
    parties.party2 = null;
    parties.description = `${parties.party1} 관련`;
  }

  return parties;
}

/**
 * 계약 목적 추출 (개선)
 */
function extractPurpose(text, fileName) {
  if (!text) return null;

  const preview = text.substring(0, 2000);

  // 1. "본 계약의 목적은" 패턴
  const purposePattern1 = /본\s*(?:계약|협약)의?\s*목적은\s*([^.\n]{10,150})/;
  const match1 = preview.match(purposePattern1);
  if (match1) {
    return match1[1].trim().replace(/이다$/, '').replace(/입니다$/, '');
  }

  // 2. "목적: " 패턴
  const purposePattern2 = /(?:제\s*\d+\s*조\s*)?[\(【]?목적[\)】]?[:\s]*([^.\n]{10,150})/;
  const match2 = preview.match(purposePattern2);
  if (match2) {
    return match2[1].trim().replace(/이다$/, '').replace(/입니다$/, '');
  }

  // 3. "~ 제공을 위하여" 패턴
  const purposePattern3 = /([가-힣\s]{5,50}(?:서비스|콘텐츠))\s*(?:의)?\s*제공/;
  const match3 = preview.match(purposePattern3);
  if (match3) {
    return match3[1].trim() + ' 제공';
  }

  // 4. 파일명에서 서비스 추출
  const services = ['채팅+', '마켓', '비즈챗', '메시지앱', 'OGQ마켓', 'IP 콘텐츠', '디지털 콘텐츠'];
  for (const service of services) {
    if (fileName.includes(service)) {
      return `${service} 서비스 제공`;
    }
  }

  return null;
}

/**
 * 계약 기간 추출
 */
function extractContractPeriod(text) {
  if (!text) return null;

  const preview = text.substring(0, 3000);

  // "YYYY-MM-DD부터 YYYY-MM-DD까지" 패턴
  const periodPattern1 = /(\d{4}[-./년]\d{1,2}[-./월]\d{1,2}일?)(?:부터|~|\s*-\s*)(\d{4}[-./년]\d{1,2}[-./월]\d{1,2}일?)(?:까지)?/;
  const match1 = preview.match(periodPattern1);
  if (match1) {
    return `${match1[1]}부터 ${match1[2]}까지`;
  }

  // "계약 기간: " 패턴
  const periodPattern2 = /계약\s*기간[:\s]*([^\n]{10,100})/;
  const match2 = preview.match(periodPattern2);
  if (match2) {
    return match2[1].trim();
  }

  return null;
}

/**
 * 정산 방식 추출 (간단)
 */
function extractSettlement(text) {
  if (!text) return null;

  // "정산" 키워드 주변 100자
  const settlementIndex = text.indexOf('정산');
  if (settlementIndex !== -1) {
    const snippet = text.substring(Math.max(0, settlementIndex - 50), Math.min(text.length, settlementIndex + 150));

    // 패턴 매칭
    const patterns = [
      /(?:매월|월)\s*(?:말|익월|익익월)?\s*정산/,
      /정산\s*주기[:\s]*([^\n]{5,50})/,
      /(?:\d+)%\s*(?:배분|정산)/,
      /수익\s*배분[:\s]*([^\n]{5,50})/
    ];

    for (const pattern of patterns) {
      const match = snippet.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }
  }

  return null;
}

/**
 * 서비스 범위 추출
 */
function extractServiceScope(text) {
  if (!text) return null;

  // "제공 범위", "서비스 범위" 키워드 주변
  const patterns = [
    /제공\s*범위[:\s]*([^\n]{10,150})/,
    /서비스\s*범위[:\s]*([^\n]{10,150})/,
    /제공\s*내용[:\s]*([^\n]{10,150})/,
    /본\s*계약에\s*따른\s*서비스[:\s]*([^\n]{10,150})/,
    /(?:갑|을)(?:은|는)\s*([가-힣\s]{10,100})\s*(?:제공|공급)(?:하|한)다/,
    /계약\s*목적물[:\s]*([^\n]{10,150})/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const value = match[1].trim();
      // 너무 짧거나 의미없는 내용 제외
      if (value.length > 8 && !value.includes('확인') && !value.includes('다음')) {
        return value.substring(0, 120);
      }
    }
  }

  return null;
}

/**
 * 해지 조건 추출
 */
function extractTermination(text) {
  if (!text) return null;

  // "해지" 키워드 주변
  const terminationIndex = text.indexOf('해지');
  if (terminationIndex !== -1) {
    const snippet = text.substring(terminationIndex, Math.min(text.length, terminationIndex + 300));

    const patterns = [
      /(\d+(?:일|개월|년))\s*(?:전|이전)\s*(?:서면)?\s*통지/,
      /(?:일방|당사자)(?:은|는)?\s*(\d+(?:일|개월))\s*(?:전|이전)?\s*(?:서면)?\s*통지.*?해지/,
      /해지\s*사유[:\s]*([^\n]{10,100})/,
      /계약\s*위반.*?(\d+(?:일|개월))\s*(?:내|이내)/,
      /상호\s*합의.*?해지/,
      /중도\s*해지[:\s]*([^\n]{10,100})/
    ];

    for (const pattern of patterns) {
      const match = snippet.match(pattern);
      if (match) {
        return match[0].trim().substring(0, 120);
      }
    }
  }

  return null;
}

/**
 * 위약금 추출
 */
function extractPenalty(text) {
  if (!text) return null;

  // "위약금", "손해배상" 키워드 검색
  const keywords = ['위약금', '손해배상', '배상금'];

  for (const keyword of keywords) {
    const index = text.indexOf(keyword);
    if (index !== -1) {
      const snippet = text.substring(index, Math.min(text.length, index + 150));

      const patterns = [
        /위약금[:\s]*([^\n]{10,100})/,
        /손해배상[:\s]*([^\n]{10,100})/,
        /계약금액의\s*(\d+%)/,
        /(\d+(?:,\d{3})*(?:만)?원)(?:의)?\s*(?:위약금|손해배상)/
      ];

      for (const pattern of patterns) {
        const match = snippet.match(pattern);
        if (match) {
          return match[0].trim().substring(0, 100);
        }
      }
    }
  }

  return null;
}

/**
 * 권리/의무 추출
 */
function extractRightsObligations(text) {
  if (!text) return null;

  const results = [];

  // "권리", "의무" 키워드 주변
  const keywords = [
    { name: '갑의 의무', pattern: /갑의?\s*의무[:\s]*([^\n]{10,80})/ },
    { name: '을의 의무', pattern: /을의?\s*의무[:\s]*([^\n]{10,80})/ },
    { name: '권리', pattern: /(?:갑|을)의?\s*권리[:\s]*([^\n]{10,80})/ },
    { name: '보증', pattern: /보증[:\s]*([^\n]{10,80})/ },
    { name: '면책', pattern: /면책[:\s]*([^\n]{10,80})/ }
  ];

  for (const { name, pattern } of keywords) {
    const match = text.match(pattern);
    if (match && match[1]) {
      results.push(`${name}: ${match[1].trim()}`);
    }
  }

  return results.length > 0 ? results.join('; ') : null;
}

/**
 * 계약서 핵심 요약 생성 (개선)
 */
function createContractSummary(text, fileName, fields, contractMeta) {
  const summary = {
    overview: [],           // 계약 개요
    mainConditions: {},     // 주요 조건
    keyTerms: [],          // 주요 조항
    uncertainFields: []    // 확실하지 않은 항목
  };

  // === [계약 개요] ===
  const parties = extractParties(text, fileName);
  const purpose = extractPurpose(text, fileName);

  if (parties.description) {
    summary.overview.push(`계약 당사자: ${parties.description} 계약`);
  } else if (parties.party1) {
    summary.overview.push(`계약 당사자: ${parties.party1} 관련 계약`);
  }

  if (purpose) {
    summary.overview.push(`계약 목적: ${purpose}`);
  }

  // === [주요 조건] ===
  summary.mainConditions = {};

  // 계약 기간
  const period = extractContractPeriod(text);
  if (period) {
    summary.mainConditions.계약기간 = period;
  } else if (contractMeta && (contractMeta.startDate || contractMeta.endDate)) {
    const start = contractMeta.startDate || '미정';
    const end = contractMeta.endDate || '미정';
    summary.mainConditions.계약기간 = `${start} ~ ${end}`;
  } else if (fields.날짜 && fields.날짜 !== '확인되지 않음') {
    summary.mainConditions.계약기간 = fields.날짜;
  }

  // 금액
  if (contractMeta && contractMeta.amount) {
    summary.mainConditions.금액 = `${contractMeta.amount.toLocaleString('ko-KR')}원`;
  } else if (contractMeta && contractMeta.unitPrice) {
    summary.mainConditions.금액 = `단가 ${contractMeta.unitPrice.toLocaleString('ko-KR')}원/건`;
  } else if (fields.금액 && fields.금액 !== '확인되지 않음') {
    summary.mainConditions.금액 = fields.금액;
  }

  // 정산 방식
  const settlement = extractSettlement(text);
  if (settlement) {
    summary.mainConditions.정산방식 = settlement;
  } else if (contractMeta && contractMeta.revenueShare) {
    summary.mainConditions.정산방식 = `수익배분 ${contractMeta.revenueShare}`;
  } else if (contractMeta && contractMeta.billingBasis) {
    summary.mainConditions.정산방식 = contractMeta.billingBasis;
  } else if (fields.수수료 && fields.수수료 !== '확인되지 않음') {
    summary.mainConditions.정산방식 = fields.수수료;
  }

  // === [주요 조항] ===
  // 필수 항목을 반드시 표시 (없으면 "명확히 확인되지 않음")

  // 1. 서비스 제공 범위
  const serviceScope = extractServiceScope(text);
  summary.keyTerms.push({
    label: '서비스 제공 범위',
    value: serviceScope || '명확히 확인되지 않음',
    isRisk: false
  });

  // 2. 정산 조건 상세
  const settlementDetail = extractSettlement(text);
  summary.keyTerms.push({
    label: '정산 조건 상세',
    value: settlementDetail || '명확히 확인되지 않음',
    isRisk: false
  });

  // 3. 해지 조건 ⚠️ 리스크 항목
  const termination = extractTermination(text);
  summary.keyTerms.push({
    label: '해지 조건',
    value: termination || '명확히 확인되지 않음',
    isRisk: termination !== null  // 해지 조건이 있으면 리스크로 표시
  });

  // 4. 위약금 ⚠️ 리스크 항목
  const penalty = extractPenalty(text);
  summary.keyTerms.push({
    label: '위약금',
    value: penalty || '명확히 확인되지 않음',
    isRisk: penalty !== null  // 위약금이 있으면 리스크로 표시
  });

  // 5. 권리/의무
  const rightsObligations = extractRightsObligations(text);
  summary.keyTerms.push({
    label: '권리/의무',
    value: rightsObligations || '명확히 확인되지 않음',
    isRisk: false
  });

  // 기타 특이사항 (파일명에서 추출)
  const notes = [];
  if (fileName.includes('초안')) notes.push('초안');
  if (fileName.includes('검토')) notes.push('검토본');
  if (fileName.includes('최종')) notes.push('최종본');
  if (fileName.includes('날인')) notes.push('날인 완료');

  if (notes.length > 0) {
    summary.keyTerms.push({
      label: '기타 특이사항',
      value: notes.join(', '),
      isRisk: false
    });
  }

  // === [확실하지 않은 항목] ===
  if (!summary.overview || summary.overview.length === 0) {
    summary.uncertainFields.push('계약 개요');
  }
  if (Object.keys(summary.mainConditions).length < 2) {
    summary.uncertainFields.push('주요 조건 (일부 누락)');
  }

  return summary;
}

/**
 * 3줄 요약 생성 (비계약서 문서용)
 */
function createThreeLineSummary(text, fileName, doc = null) {
  if (!text) {
    const displayName = resolveDisplayFileName(fileName, doc);
    return [
      `${displayName} 문서입니다.`,
      '해당 문서는 텍스트 추출이 되지 않아 요약이 제한됩니다.',
      '파일을 직접 열어 확인하시거나 OCR 기능을 활성화하면 요약이 가능합니다.'
    ];
  }

  // 텍스트 앞부분 2000자 추출
  const preview = text.substring(0, 2000);

  // 줄바꿈 기준으로 문장 분리
  const lines = preview.split(/[\n\r]+/).filter(line => line.trim().length > 10);

  const summary = [];

  // 1줄: 문서 제목/타입 정보 (단, 제목 그대로 반복하지 않음)
  if (lines.length > 0) {
    const firstLine = lines[0].substring(0, 100);
    // 파일명과 너무 유사하면 스킵
    if (firstLine.toLowerCase() !== fileName.toLowerCase().replace(/\.[^.]+$/, '')) {
      summary.push(firstLine);
    }
  }

  // 2줄: 목적/내용 관련 문장
  const purposeLine = lines.find((line, idx) =>
    idx > 0 && (line.includes('목적') || line.includes('제공') || line.includes('협약') || line.includes('계약'))
  );
  if (purposeLine) {
    summary.push(purposeLine.substring(0, 150));
  } else if (lines.length > 1 && summary.length === 0) {
    summary.push(lines[1].substring(0, 150));
  } else if (lines.length > 1) {
    summary.push(lines[1].substring(0, 150));
  }

  // 3줄: 추가 설명 또는 조건
  if (lines.length > 2 && summary.length < 3) {
    summary.push(lines[2].substring(0, 150));
  }

  // 최소 1줄은 보장
  if (summary.length === 0) {
    const displayName = resolveDisplayFileName(fileName, doc);
    summary.push(`${displayName} 문서 - 상세 내용은 파일을 참조하시기 바랍니다.`);
  }

  return summary.slice(0, 3);
}

/**
 * 파일 경로로 문서 요약
 * @param {string} filePath - 파일 경로
 * @param {Object} [doc] - 문서 객체 (검색 결과에서 전달, 옵션)
 * @returns {Promise<Object>}
 */
export async function summarizeFile(filePath, doc = null) {
  const fileName = doc?.fileName || basename(filePath);

  try {
    const { text, isScanned } = await getCachedText(filePath, extractText);

    if (isScanned) {
      const displayName = resolveDisplayFileName(fileName, doc);
      return {
        error: null,
        fileName,
        filePath,
        docType: inferDocType(fileName, ''),
        summary: [
          `${displayName} 문서입니다.`,
          '해당 문서는 텍스트 추출이 되지 않아 요약이 제한됩니다.',
          '파일을 직접 열어 확인하시거나 OCR 기능을 활성화하면 요약이 가능합니다.'
        ],
        fields: {
          회사명: '확실하지 않음',
          서비스: '확실하지 않음',
          금액: '확실하지 않음',
          날짜: '확실하지 않음',
          수수료: '확실하지 않음'
        },
        isScanned: true
      };
    }

    // 계약 메타데이터 우선 사용
    const contractMeta = findContractMeta(filePath);

    // 필드 추출
    let company, service, amounts, dates, fees;
    let hasMetadata = false;

    if (contractMeta) {
      // 메타데이터가 있으면 우선 사용
      hasMetadata = true;
      company = contractMeta.company || extractCompanies(fileName, text);
      service = contractMeta.service || extractServices(fileName, text);

      // 금액: 메타데이터 우선
      if (contractMeta.amount) {
        amounts = `${contractMeta.amount.toLocaleString('ko-KR')}원 (확실도: ${contractMeta.confidence.amount || '확실하지 않음'})`;
      } else if (contractMeta.unitPrice) {
        amounts = `단가 ${contractMeta.unitPrice.toLocaleString('ko-KR')}원/건 (확실도: ${contractMeta.confidence.unitPrice || '확실하지 않음'})`;
      } else {
        amounts = extractAmounts(text);
      }

      // 날짜: 메타데이터 우선
      const dateInfo = [];
      if (contractMeta.startDate) {
        dateInfo.push(`시작: ${contractMeta.startDate}`);
      }
      if (contractMeta.endDate) {
        dateInfo.push(`종료: ${contractMeta.endDate}`);
      }
      dates = dateInfo.length > 0 ? dateInfo.join(' / ') : extractDates(text);

      // 수수료: 메타데이터의 수익배분 우선
      if (contractMeta.revenueShare) {
        fees = `수익배분 ${contractMeta.revenueShare} (확실도: ${contractMeta.confidence.revenueShare || '확실하지 않음'})`;
      } else {
        fees = extractFees(text);
      }
    } else {
      // 메타데이터 없으면 기존 로직 사용
      company = extractCompanies(fileName, text);
      service = extractServices(fileName, text);
      amounts = extractAmounts(text);
      dates = extractDates(text);
      fees = extractFees(text);
    }

    // 문서 유형 판별
    const docType = inferDocType(fileName, text);

    // 계약서/협약서인 경우 고도화된 요약 생성
    let summary, contractSummary = null;
    const isContract = docType === '계약서' || docType === '협약서';

    if (isContract) {
      const fields = {
        회사명: company,
        서비스: service,
        금액: amounts,
        날짜: dates,
        수수료: fees
      };
      contractSummary = createContractSummary(text, fileName, fields, contractMeta);

      // 기존 summary 필드는 핵심 요약 문장으로 채움
      summary = contractSummary.overview.length > 0
        ? contractSummary.overview
        : createThreeLineSummary(text, fileName, doc);
    } else {
      summary = createThreeLineSummary(text, fileName, doc);
    }

    return {
      error: null,
      fileName,
      filePath,
      docType,
      summary,
      fields: {
        회사명: company,
        서비스: service,
        금액: amounts,
        날짜: dates,
        수수료: fees
      },
      contractMetadata: contractMeta,
      contractSummary,  // 추가: 계약서 구조화 요약
      hasMetadata,
      isScanned: false
    };
  } catch (err) {
    return {
      error: `파일 처리 오류: ${err.message}`,
      fileName,
      filePath,
      docType: '알 수 없음',
      summary: [],
      fields: {},
      isScanned: false
    };
  }
}

/**
 * 키워드에서 주요 엔티티 추출 (에러 메시지용)
 */
function extractKeywordEntities(keyword) {
  const companies = ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'];
  const docTypes = ['계약서', '협약서', '견적서', '정산서', '청구서', '제안서', '소개서'];

  const found = [];

  companies.forEach(company => {
    const pattern = new RegExp(`(?:^|[^a-z0-9가-힣])${company}(?:[^a-z0-9가-힣]|$)`, 'i');
    if (pattern.test(keyword)) {
      found.push(company);
    }
  });

  docTypes.forEach(docType => {
    if (keyword.includes(docType)) {
      found.push(docType);
    }
  });

  return found;
}

/**
 * 키워드로 검색 후 상위 문서 요약
 * @param {string} keyword - 검색 키워드
 * @returns {Promise<Object>}
 */
export async function summarizeByKeyword(keyword) {
  console.log(`"${keyword}" 검색 중...`);

  // 문서 검색
  const searchResult = await searchDocuments(keyword, { silent: false });
  const results = searchResult.results || [];

  if (results.length === 0) {
    // 적용된 키워드 추출
    const appliedKeywords = extractKeywordEntities(keyword);
    const keywordText = appliedKeywords.length > 0
      ? `적용 키워드: ${appliedKeywords.join(', ')}`
      : `검색어: ${keyword}`;

    return {
      error: `관련 문서를 찾지 못했습니다.\n${keywordText}`,
      keyword,
      document: null,
      appliedKeywords
    };
  }

  // 문서 후보 중에서 회사명+문서유형이 파일명에 모두 있는 것 우선
  const entities = extractKeywordEntities(keyword);
  const hasCompany = entities.some(e => ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'].includes(e));
  const hasDocType = entities.some(e => ['계약서', '협약서', '견적서', '정산서', '청구서', '제안서', '소개서'].includes(e));

  let topResult = results[0];

  if (hasCompany && hasDocType && results.length > 1) {
    // 파일명에 둘 다 포함된 문서 우선
    const betterMatch = results.find(result => {
      const fileName = result.fileName.toLowerCase();
      return entities.every(entity => {
        const pattern = new RegExp(`(?:^|[^a-z0-9가-힣])${entity.toLowerCase()}(?:[^a-z0-9가-힣]|$)`, 'i');
        return pattern.test(fileName);
      });
    });

    if (betterMatch) {
      topResult = betterMatch;
      const betterDisplayName = resolveDisplayFileName(topResult.fileName, topResult);
      console.log(`\n💡 파일명 정확도 우선: ${betterDisplayName}`);
    }
  }

  const topDisplayName = resolveDisplayFileName(topResult.fileName, topResult);
  console.log(`\n가장 관련성 높은 문서: ${topDisplayName}`);
  console.log(`요약 생성 중...\n`);

  const summary = await summarizeFile(topResult.filePath, topResult);

  return {
    error: null,
    keyword,
    searchResultCount: results.length,
    document: summary,
    appliedKeywords: entities
  };
}
