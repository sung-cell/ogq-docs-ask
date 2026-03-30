/**
 * 계약 메타데이터 자동 추출
 * 파일명 + 본문 텍스트에서 핵심 계약 정보를 규칙 기반으로 추출
 */

const KEYWORDS = {
  companies: ['KT', 'SKT', 'LG', '네이버', '아프리카TV', 'OGQ', '카카오', '삼성'],
  services: ['채팅+', '마켓', '비즈챗', '메시지앱', 'OGQ마켓', '플러스'],
  docTypes: ['계약서', '협약서', '견적서', '정산서', '제안서', '소개서', '운영비용', '청구서'],
  finalStates: ['최종', '최종본', '최종날인', '날인본', '서명본', '체결본', 'signed', 'executed'],
  draftStates: ['v1', 'v2', 'v3', 'v0', '검토', 'draft', '초안', 'review']
};

/**
 * 파일명에서 기본 정보 추출
 */
function extractFromFilename(fileName, folderPath) {
  const normalizedFileName = fileName.normalize('NFC');
  const text = `${normalizedFileName} ${folderPath}`.toLowerCase();

  const result = {
    company: null,
    counterparty: null,
    service: null,
    docType: null,
    signedStatus: 'unknown'
  };

  // 회사명 추출
  for (const company of KEYWORDS.companies) {
    if (text.includes(company.toLowerCase())) {
      if (!result.company) {
        result.company = company;
      } else if (!result.counterparty && company !== result.company) {
        result.counterparty = company;
      }
    }
  }

  // 서비스명 추출
  for (const service of KEYWORDS.services) {
    if (text.includes(service.toLowerCase())) {
      result.service = service;
      break;
    }
  }

  // 문서유형 추출
  for (const docType of KEYWORDS.docTypes) {
    if (text.includes(docType.toLowerCase())) {
      result.docType = docType;
      break;
    }
  }

  // 서명 상태 추출
  for (const state of KEYWORDS.finalStates) {
    if (text.includes(state.toLowerCase())) {
      result.signedStatus = 'final';
      break;
    }
  }

  if (result.signedStatus === 'unknown') {
    for (const state of KEYWORDS.draftStates) {
      if (text.includes(state.toLowerCase())) {
        result.signedStatus = 'draft';
        break;
      }
    }
  }

  return result;
}

/**
 * 날짜 패턴 추출
 */
function extractDates(text) {
  const dates = [];

  // YYYY.MM.DD
  const pattern1 = /(\d{4})\.(\d{1,2})\.(\d{1,2})/g;
  // YYYY-MM-DD
  const pattern2 = /(\d{4})-(\d{1,2})-(\d{1,2})/g;
  // YYYY년 MM월 DD일
  const pattern3 = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g;

  const patterns = [pattern1, pattern2, pattern3];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const year = match[1];
      const month = match[2].padStart(2, '0');
      const day = match[3].padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      // 전후 50자 컨텍스트
      const start = Math.max(0, match.index - 50);
      const end = Math.min(text.length, match.index + match[0].length + 50);
      const context = text.substring(start, end).replace(/\s+/g, ' ').trim();

      dates.push({
        date: dateStr,
        context,
        index: match.index
      });
    }
  }

  return dates;
}

/**
 * 계약 기간 추출
 */
function extractContractPeriod(text, allDates) {
  let startDate = null;
  let endDate = null;
  let startEvidence = null;
  let endEvidence = null;
  let startConfidence = '확인되지 않음';
  let endConfidence = '확인되지 않음';

  // 시작일 키워드
  const startKeywords = ['계약기간', '유효기간', '계약일', '시작일', '부터', '개시일', '효력 발생'];
  // 종료일 키워드
  const endKeywords = ['종료일', '만료일', '까지', '종료', '만료', '해지일'];

  for (const dateInfo of allDates) {
    const contextLower = dateInfo.context.toLowerCase();

    // 시작일 후보
    for (const keyword of startKeywords) {
      if (contextLower.includes(keyword)) {
        if (!startDate || dateInfo.index < allDates.find(d => d.date === startDate)?.index) {
          startDate = dateInfo.date;
          startEvidence = dateInfo.context;
          startConfidence = '확실';
        }
      }
    }

    // 종료일 후보
    for (const keyword of endKeywords) {
      if (contextLower.includes(keyword)) {
        if (!endDate) {
          endDate = dateInfo.date;
          endEvidence = dateInfo.context;
          endConfidence = '확실';
        }
      }
    }
  }

  // 기간 형식 패턴: "YYYY.MM.DD ~ YYYY.MM.DD"
  if (allDates.length >= 2 && !startDate && !endDate) {
    const sorted = [...allDates].sort((a, b) => a.index - b.index);
    startDate = sorted[0].date;
    endDate = sorted[sorted.length - 1].date;
    startEvidence = sorted[0].context;
    endEvidence = sorted[sorted.length - 1].context;
    startConfidence = '확실하지 않음';
    endConfidence = '확실하지 않음';
  }

  return {
    startDate,
    endDate,
    startEvidence,
    endEvidence,
    startConfidence,
    endConfidence
  };
}

/**
 * 금액 추출
 */
function extractAmount(text) {
  // 금액 패턴: 숫자 + 원/KRW
  const patterns = [
    /금액[:\s]*([0-9,]+)\s*원/gi,
    /총액[:\s]*([0-9,]+)\s*원/gi,
    /공급가액[:\s]*([0-9,]+)\s*원/gi,
    /계약금액[:\s]*([0-9,]+)\s*원/gi,
    /([0-9,]+)\s*원/g
  ];

  const amounts = [];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const amountStr = match[1].replace(/,/g, '');
      const amount = parseInt(amountStr, 10);

      if (amount && amount > 1000) { // 최소 1000원 이상만
        const start = Math.max(0, match.index - 30);
        const end = Math.min(text.length, match.index + match[0].length + 30);
        const context = text.substring(start, end).replace(/\s+/g, ' ').trim();

        amounts.push({
          amount,
          context,
          index: match.index
        });
      }
    }
  }

  if (amounts.length === 0) {
    return { amount: null, evidence: null, confidence: '확인되지 않음' };
  }

  // 가장 먼저 나온 금액 또는 가장 큰 금액
  const sorted = [...amounts].sort((a, b) => b.amount - a.amount);
  return {
    amount: sorted[0].amount,
    evidence: sorted[0].context,
    confidence: amounts.length > 3 ? '확실하지 않음' : '확실'
  };
}

/**
 * 단가 추출
 */
function extractUnitPrice(text) {
  // 단가 패턴: 숫자 + 원/건, 건당
  const patterns = [
    /단가[:\s]*([0-9,]+)\s*원/gi,
    /([0-9,]+)\s*원\s*\/\s*건/gi,
    /건당\s*([0-9,]+)\s*원/gi,
    /1건당\s*([0-9,]+)\s*원/gi
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const priceStr = match[1].replace(/,/g, '');
      const price = parseInt(priceStr, 10);

      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      const context = text.substring(start, end).replace(/\s+/g, ' ').trim();

      return {
        unitPrice: price,
        evidence: context,
        confidence: '확실'
      };
    }
  }

  return { unitPrice: null, evidence: null, confidence: '확인되지 않음' };
}

/**
 * 수익배분 추출
 */
function extractRevenueShare(text) {
  // 수익배분 패턴: 숫자 + %
  const patterns = [
    /수익배분[:\s]*([0-9.]+)\s*%/gi,
    /정산비율[:\s]*([0-9.]+)\s*%/gi,
    /배분[:\s]*([0-9.]+)\s*%/gi,
    /([0-9.]+)\s*%\s*배분/gi
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const percentage = match[1];

      const start = Math.max(0, match.index - 30);
      const end = Math.min(text.length, match.index + match[0].length + 30);
      const context = text.substring(start, end).replace(/\s+/g, ' ').trim();

      return {
        revenueShare: `${percentage}%`,
        evidence: context,
        confidence: '확실'
      };
    }
  }

  return { revenueShare: null, evidence: null, confidence: '확인되지 않음' };
}

/**
 * 정산/청구 기준 추출
 */
function extractBillingBasis(text) {
  const patterns = [
    /청구[:\s]*(.{5,30})/gi,
    /정산[:\s]*(.{5,30})/gi,
    /월별\s*정산/gi,
    /분기별\s*정산/gi,
    /익월\s*청구/gi
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const basis = match[0];

      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + match[0].length + 20);
      const context = text.substring(start, end).replace(/\s+/g, ' ').trim();

      return {
        billingBasis: basis.trim(),
        evidence: context,
        confidence: '확실'
      };
    }
  }

  return { billingBasis: null, evidence: null, confidence: '확인되지 않음' };
}

/**
 * 본문에서 계약 메타데이터 추출
 */
function extractFromText(text) {
  if (!text || text.length < 50) {
    return {
      startDate: null,
      endDate: null,
      amount: null,
      unitPrice: null,
      revenueShare: null,
      billingBasis: null,
      feeInfo: null,
      evidence: {},
      confidence: {}
    };
  }

  // 날짜 추출
  const allDates = extractDates(text);
  const periodInfo = extractContractPeriod(text, allDates);

  // 금액 추출
  const amountInfo = extractAmount(text);

  // 단가 추출
  const unitPriceInfo = extractUnitPrice(text);

  // 수익배분 추출
  const revenueShareInfo = extractRevenueShare(text);

  // 청구/정산 기준 추출
  const billingInfo = extractBillingBasis(text);

  return {
    startDate: periodInfo.startDate,
    endDate: periodInfo.endDate,
    amount: amountInfo.amount,
    unitPrice: unitPriceInfo.unitPrice,
    revenueShare: revenueShareInfo.revenueShare,
    billingBasis: billingInfo.billingBasis,
    feeInfo: null, // 추후 확장 가능
    evidence: {
      startDate: periodInfo.startEvidence,
      endDate: periodInfo.endEvidence,
      amount: amountInfo.evidence,
      unitPrice: unitPriceInfo.evidence,
      revenueShare: revenueShareInfo.evidence,
      billingBasis: billingInfo.evidence
    },
    confidence: {
      startDate: periodInfo.startConfidence,
      endDate: periodInfo.endConfidence,
      amount: amountInfo.confidence,
      unitPrice: unitPriceInfo.confidence,
      revenueShare: revenueShareInfo.confidence,
      billingBasis: billingInfo.confidence
    }
  };
}

/**
 * 전체 계약 메타데이터 추출
 * @param {string} filePath - 파일 경로
 * @param {string} fileName - 파일명
 * @param {string} folderPath - 폴더 경로
 * @param {string} text - 추출된 텍스트 (optional)
 * @returns {Object} - 계약 메타데이터
 */
export function extractContractMetadata(filePath, fileName, folderPath, text = null) {
  // 파일명 기반 추출
  const filenameData = extractFromFilename(fileName, folderPath);

  // 본문 기반 추출
  const textData = text ? extractFromText(text) : {
    startDate: null,
    endDate: null,
    amount: null,
    unitPrice: null,
    revenueShare: null,
    billingBasis: null,
    feeInfo: null,
    evidence: {},
    confidence: {}
  };

  return {
    sourceFile: filePath,
    company: filenameData.company,
    counterparty: filenameData.counterparty,
    service: filenameData.service,
    docType: filenameData.docType,
    signedStatus: filenameData.signedStatus,
    startDate: textData.startDate,
    endDate: textData.endDate,
    amount: textData.amount,
    unitPrice: textData.unitPrice,
    revenueShare: textData.revenueShare,
    billingBasis: textData.billingBasis,
    feeInfo: textData.feeInfo,
    evidence: textData.evidence,
    confidence: textData.confidence,
    extractedAt: new Date().toISOString()
  };
}
