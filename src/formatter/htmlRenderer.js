/**
 * HTML 렌더링 로직
 * ask 결과를 예쁜 HTML 파일로 출력
 */

import path from 'path';

/**
 * 금액을 한국 원화 형식으로 포맷
 * @param {number} amount
 * @returns {string}
 */
function formatAmount(amount) {
  if (!amount) return '-';
  return amount.toLocaleString('ko-KR') + '원';
}

/**
 * 날짜를 포맷
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return '-';
  if (date instanceof Date) {
    return date.toISOString().split('T')[0];
  }
  return date;
}

/**
 * 파일 경로를 file:// 링크로 변환
 * @param {string} filePath
 * @returns {string}
 */
function createFileLink(filePath) {
  const absolutePath = path.resolve(filePath);
  return `file://${absolutePath}`;
}

/**
 * 폴더 경로를 file:// 링크로 변환
 * @param {string} filePath
 * @returns {string}
 */
function createFolderLink(filePath) {
  const absolutePath = path.resolve(filePath);
  const folderPath = path.dirname(absolutePath);
  return `file://${folderPath}`;
}

/**
 * HTML escape
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Markdown 강조 (**text**)를 HTML <strong>으로 변환
 * @param {string} text
 * @returns {string}
 */
function markdownToHtml(text) {
  if (!text) return '';
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong class="highlight">$1</strong>');
}

/**
 * 문서 검색 결과를 HTML 카드로 렌더링
 * @param {Array} documents
 * @param {number} totalCount - 전체 문서 수 (제한 전)
 * @returns {string}
 */
function renderDocumentTable(documents, totalCount = null) {
  if (!documents || documents.length === 0) {
    return '<p class="no-results">검색 결과가 없습니다.</p>';
  }

  // 상단 헤더 (20개 이상일 경우)
  const headerHtml = totalCount && totalCount >= 20
    ? `<div class="results-header">총 ${totalCount}개 문서 발견 (상위 20개 표시)</div>`
    : '';

  // 최고 점수 계산 (상위 5개까지만 표시)
  const displayDocs = documents.slice(0, 5);
  const maxScore = Math.max(...displayDocs.map(d => d.score || 0));

  const cards = displayDocs.map((doc, idx) => {
    const fileName = escapeHtml(doc.fileName);
    const isGDriveNative = doc.sourceType === 'gdrive-native';
    const folderPath = isGDriveNative ? 'Google Drive' : escapeHtml(doc.filePath.split('/').slice(0, -1).join('/'));
    const fileLink = isGDriveNative && doc.webViewLink ? doc.webViewLink : createFileLink(doc.filePath);
    const folderLink = createFolderLink(doc.filePath);
    const score = doc.score || 0;

    // 배지 생성
    let badges = '';

    // PDF 상태 배지 (최우선)
    if (doc.ocrUsed && doc.ocrSucceeded) {
      badges += '<span class="badge badge-ocr-success">✅ OCR 적용</span>';
    } else if (doc.ocrUsed && !doc.ocrSucceeded) {
      badges += '<span class="badge badge-ocr-failed">❌ OCR 실패</span>';
    } else if (doc.isScanned) {
      badges += '<span class="badge badge-scanned">⚠️  스캔본 PDF</span>';
    } else if (doc.extractionError) {
      badges += '<span class="badge badge-extraction-error">❌ 추출 오류</span>';
    } else if (doc.extractedTextAvailable === false && doc.fileName && doc.fileName.toLowerCase().endsWith('.pdf')) {
      badges += '<span class="badge badge-no-text">📄 텍스트 없음</span>';
    }

    // 최종 문서 배지
    if (doc.isFinalDocument) {
      badges += '<span class="badge badge-final">📄 최종 계약서</span>';
    }

    // Source 배지
    if (doc.sourceType === 'gdrive-native') {
      badges += '<span class="badge badge-source-gdrive-native">📱 Google 문서</span>';
    } else if (doc.sourceType === 'gdrive-desktop') {
      badges += '<span class="badge badge-source-gdrive">☁️ Google Drive</span>';
    } else if (doc.sourceType === 'local') {
      badges += '<span class="badge badge-source-local">💻 로컬</span>';
    }

    // 정확도 배지 (highAccuracy 플래그 우선 사용)
    if (doc.highAccuracy || (score >= maxScore * 0.8 && score >= 40)) {
      badges += '<span class="badge badge-high">✓ 정확도 높음</span>';
    } else if (score >= 30) {
      badges += '<span class="badge badge-medium">매칭됨</span>';
    }

    // 매칭 정보 (파일명, 폴더명, 문서유형 등) - 최대 4개까지만
    let matchInfoHtml = '';
    if (doc.matchInfo && doc.matchInfo.length > 0) {
      const displayMatchInfo = doc.matchInfo.slice(0, 4);
      const hiddenCount = doc.matchInfo.length - displayMatchInfo.length;
      const matchTagsHtml = displayMatchInfo.map(info => `<span class="match-tag">${escapeHtml(info)}</span>`).join(' ');
      const hiddenBadge = hiddenCount > 0 ? `<span class="match-tag" style="background: #f0f0f0; color: #666;">+${hiddenCount}개</span>` : '';

      matchInfoHtml = `<div class="match-info">
          <span class="match-label">매칭:</span>
          ${matchTagsHtml}
          ${hiddenBadge}
         </div>`;
    }

    // 위치 표시
    const folderHtml = isGDriveNative
      ? `<div class="folder-label">위치</div>
         <div class="folder-path" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${folderPath}</div>`
      : `<div class="folder-label">폴더</div>
         <div class="folder-path" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${folderPath}</div>`;

    // 버튼 (gdrive-native는 Drive에서 열기만)
    const actionsHtml = isGDriveNative
      ? `<a href="${fileLink}" class="btn-primary" target="_blank">Drive에서 열기</a>`
      : `<a href="${fileLink}" class="btn-primary">파일 열기</a>
         <a href="${folderLink}" class="btn-secondary">폴더 열기</a>`;

    return `
      <div class="result-card">
        <div class="card-header">
          <div class="card-number">${idx + 1}</div>
          <div class="card-title" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis;">${fileName}</div>
          ${badges}
        </div>
        <div class="card-body">
          <div class="score-label">점수: <strong>${score}</strong></div>
          ${matchInfoHtml}
          ${folderHtml}
          <div class="card-actions">
            ${actionsHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    ${headerHtml}
    <div class="results-container">
      ${cards}
    </div>
  `;
}

/**
 * 일정/금액 결과를 HTML 테이블로 렌더링
 * @param {Array} events
 * @returns {string}
 */
function renderEventsTable(events) {
  if (!events || events.length === 0) {
    return '<p class="no-results">해당하는 항목이 없습니다.</p>';
  }

  const rows = events.map((e, idx) => {
    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(e.client || '-')}</td>
        <td>${escapeHtml(e.type || '-')}</td>
        <td>${escapeHtml(e.title || '-')}</td>
        <td>${formatDate(e.startDate)}</td>
        <td>${formatDate(e.endDate)}</td>
        <td class="amount-cell">${formatAmount(e.amount)}</td>
        <td>${escapeHtml(e.certainty || '-')}</td>
      </tr>
    `;
  }).join('');

  return `
    <table class="result-table">
      <thead>
        <tr>
          <th>No</th>
          <th>거래처</th>
          <th>구분</th>
          <th>제목</th>
          <th>시작일</th>
          <th>종료일</th>
          <th>금액</th>
          <th>확실성</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

/**
 * 질문 타입에 따른 아이콘 반환
 * @param {string} questionType
 * @returns {string}
 */
function getQuestionTypeIcon(questionType) {
  const icons = {
    contract_metadata: '📋',
    document_search: '📄',
    document_summary: '📝',
    document_question: '💬',
    schedule_query: '📅',
    expiry_check: '⏰',
    amount_analysis: '💰',
    unknown: '❓'
  };
  return icons[questionType] || '❓';
}

/**
 * 질문 타입에 따른 한글 라벨 반환
 * @param {string} questionType
 * @returns {string}
 */
function getQuestionTypeLabel(questionType) {
  const labels = {
    contract_metadata: '계약 메타데이터',
    document_search: '문서 찾기',
    document_summary: '문서 요약',
    document_question: '문서 내용 질문',
    schedule_query: '일정 조회',
    expiry_check: '종료 확인',
    amount_analysis: '금액 분석',
    unknown: '알 수 없음'
  };
  return labels[questionType] || '알 수 없음';
}

/**
 * ask 결과를 HTML로 렌더링
 * @param {Object} result - handleAskForHtml의 반환 결과
 * @returns {string} - HTML 문자열
 */
export function renderAskResultHtml(result) {
  const { question, questionType, timestamp, data, error } = result;

  const icon = getQuestionTypeIcon(questionType);
  const typeLabel = getQuestionTypeLabel(questionType);
  const timestampFormatted = new Date(timestamp).toLocaleString('ko-KR');

  let contentHtml = '';
  let summaryHtml = '';

  if (error) {
    contentHtml = `<div class="error-box">${escapeHtml(error)}</div>`;
  } else if (data) {
    switch (data.type) {
      case 'contract_metadata':
        const contract = data.contract;

        // 값이 있는 필드만 필터링 (최대 5개)
        const allMetadataFields = [
          { label: '회사', value: contract.company, confidence: null },
          { label: '상대방', value: contract.counterparty, confidence: null },
          { label: '서비스', value: contract.service, confidence: null },
          { label: '문서유형', value: contract.docType, confidence: null },
          { label: '서명상태', value: contract.signedStatus === 'final' ? '최종' : contract.signedStatus === 'draft' ? '초안' : null, confidence: null },
          { label: '계약 시작일', value: contract.startDate, confidence: contract.confidence.startDate },
          { label: '계약 종료일', value: contract.endDate, confidence: contract.confidence.endDate },
          { label: '금액', value: contract.amount ? `${contract.amount.toLocaleString('ko-KR')}원` : null, confidence: contract.confidence.amount },
          { label: '단가', value: contract.unitPrice ? `${contract.unitPrice.toLocaleString('ko-KR')}원/건` : null, confidence: contract.confidence.unitPrice },
          { label: '수익배분', value: contract.revenueShare, confidence: contract.confidence.revenueShare },
          { label: '정산기준', value: contract.billingBasis, confidence: contract.confidence.billingBasis }
        ];

        // 엄격한 필터링
        const metadataFields = allMetadataFields.filter(f => {
          const valueStr = String(f.value || '').trim();
          return valueStr &&
                 valueStr !== 'null' &&
                 valueStr !== 'undefined' &&
                 valueStr !== '확인되지 않음' &&
                 valueStr !== '명확히 확인되지 않음' &&
                 valueStr !== '알 수 없음' &&
                 valueStr !== '-';
        }).slice(0, 5); // 최대 5개

        summaryHtml = `
          <div class="summary-card highlight-card">
            <div class="summary-label">${escapeHtml(data.fieldName || '조회 정보')}</div>
            <div class="summary-value large-value">${escapeHtml(data.fieldValue || '-')}</div>
            ${data.confidence && data.confidence !== '확인되지 않음' && data.confidence !== '명확히 확인되지 않음' ? `<div class="confidence-label">확실도: ${escapeHtml(data.confidence)}</div>` : ''}
          </div>
        `;

        const metadataFieldsHtml = metadataFields.map(f => `
          <div class="metadata-row">
            <div class="metadata-label">${escapeHtml(f.label)}</div>
            <div class="metadata-value">${escapeHtml(f.value)}</div>
            ${f.confidence && f.confidence !== '확인되지 않음' && f.confidence !== '명확히 확인되지 않음' ? `<div class="metadata-confidence">(${escapeHtml(f.confidence)})</div>` : ''}
          </div>
        `).join('');

        const isGDriveNative = contract.sourceFile && contract.sourceFile.startsWith('gdrive://');
        const fileLink = isGDriveNative && contract.webViewLink ? contract.webViewLink : createFileLink(contract.sourceFile);
        const folderLink = createFolderLink(contract.sourceFile);

        const actionsHtml = isGDriveNative
          ? `<a href="${fileLink}" class="btn-primary" target="_blank">Drive에서 열기</a>`
          : `<a href="${fileLink}" class="btn-primary">파일 열기</a>
             <a href="${folderLink}" class="btn-secondary">폴더 열기</a>`;

        contentHtml = metadataFields.length > 0 ? `
          <div class="metadata-card">
            <div class="metadata-header">📋 계약 메타데이터 (${metadataFields.length}개)</div>
            <div class="metadata-body">
              ${metadataFieldsHtml}
            </div>
            <div class="metadata-footer">
              <div class="metadata-source">파일: ${escapeHtml(contract.sourceFile.split('/').pop())}</div>
              <div class="card-actions">
                ${actionsHtml}
              </div>
            </div>
          </div>
          ${data.totalMatches > 1 ? `<div class="info-box">💡 ${data.totalMatches}개의 관련 계약이 있습니다. 첫 번째 결과를 표시했습니다.</div>` : ''}
        ` : '<p class="no-results">추출된 정보가 없습니다. 문서를 직접 확인하세요.</p>';
        break;

      case 'document_search':
        const searchModeLabel = data.searchMode === 'file_priority' ? '파일 찾기 우선' : '내용 질문';
        const categoryKeywords = [];
        if (data.categories) {
          if (data.categories.companies && data.categories.companies.length > 0) {
            categoryKeywords.push(...data.categories.companies);
          }
          if (data.categories.docTypes && data.categories.docTypes.length > 0) {
            // 중복 제거: "계약"과 "계약서"가 같이 있으면 더 긴 표현만 사용
            const deduplicatedDocTypes = data.categories.docTypes.filter((docType, idx, arr) => {
              const baseForm = docType.replace(/서$/, '');
              const hasLongerForm = arr.some(d => d !== docType && d === baseForm + '서');
              return !hasLongerForm || docType.endsWith('서');
            });
            categoryKeywords.push(...deduplicatedDocTypes);
          }
        }

        // 결과가 많을 때 상위 3개 강조
        let topCandidatesHtml = '';
        if (data.results.length > 5 && data.topCandidates && data.topCandidates.length > 0) {
          const topFiles = data.topCandidates.map(d => `<strong>${escapeHtml(d.fileName)}</strong>`).join(', ');
          topCandidatesHtml = `<div class="info-box">📌 상위 후보: ${topFiles}</div>`;
        }

        summaryHtml = `
          <div class="summary-card">
            <div class="summary-label">검색 키워드</div>
            <div class="summary-value">${escapeHtml(data.keyword)}</div>
          </div>
          ${categoryKeywords.length > 0 ? `
          <div class="summary-card">
            <div class="summary-label">적용 범위</div>
            <div class="summary-value">${escapeHtml(categoryKeywords.join(', '))}</div>
          </div>
          ` : ''}
          <div class="summary-card">
            <div class="summary-label">발견된 문서</div>
            <div class="summary-value">${data.certainResults ? data.certainResults.length : data.results.length}개</div>
          </div>
        `;

        // 자연어 답변 블록 (naturalAnswer 우선, 없으면 기본 메시지)
        const searchAnswerText = data.naturalAnswer || `${data.results.length}개 문서를 찾았습니다. 아래 참고 문서를 확인해 주세요.`;
        let searchAnswerHtml = `
          <div class="answer-box">
            <div class="answer-header">📝 답변</div>
            <div class="answer-content">
              ${searchAnswerText.split('\n').map(line => {
                if (line.trim() === '') {
                  return '<div class="answer-spacer"></div>';
                } else {
                  return `<div class="answer-line">${escapeHtml(line)}</div>`;
                }
              }).join('')}
            </div>
          </div>
        `;

        // 확실한 결과 먼저 표시
        let certainHtml = '';
        let uncertainHtml = '';

        if (data.certainResults && data.certainResults.length > 0) {
          certainHtml = `
            <div class="section-header">📚 참고 문서 (${data.certainResults.length}개)</div>
            ${renderDocumentTable(data.certainResults.slice(0, 5), data.certainResults.length)}
          `;
        }

        // 불확실한 결과는 최대 2개만 하단에
        if (data.uncertainResults && data.uncertainResults.length > 0) {
          uncertainHtml = `
            <div class="section-header warning-section">⚠️ 관련 가능성이 있는 문서 (참고용, 최대 2개)</div>
            ${renderDocumentTable(data.uncertainResults, null)}
          `;
        }

        // 결과가 없으면 전체 표시
        const finalResultsHtml = data.certainResults && data.certainResults.length > 0
          ? certainHtml + uncertainHtml
          : `<div class="section-header">📚 참고 문서 (${data.results.length}개)</div>` + renderDocumentTable(data.results, data.results.length);

        contentHtml = searchAnswerHtml + topCandidatesHtml + (data.truncated ? '<div class="warning-box">⚠️ 검색 범위가 넓습니다. 키워드를 더 구체적으로 입력하세요.</div>' : '') + finalResultsHtml;
        break;

      case 'schedule_query':
        summaryHtml = `
          <div class="summary-card">
            <div class="summary-label">일정 건수</div>
            <div class="summary-value">${data.count}건</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">조건</div>
            <div class="summary-value">${escapeHtml(data.summary)}</div>
          </div>
        `;
        contentHtml = renderEventsTable(data.results);
        break;

      case 'expiry_check':
        summaryHtml = `
          <div class="summary-card">
            <div class="summary-label">거래처</div>
            <div class="summary-value">${escapeHtml(data.client || '전체')}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">계약 종료 일정</div>
            <div class="summary-value">${data.count}건</div>
          </div>
        `;
        contentHtml = renderEventsTable(data.results);
        break;

      case 'amount_analysis':
        summaryHtml = `
          <div class="summary-card">
            <div class="summary-label">조건</div>
            <div class="summary-value">${escapeHtml(data.targetType)} / ${escapeHtml(data.period)}</div>
          </div>
          <div class="summary-card amount-card">
            <div class="summary-label">합계 금액</div>
            <div class="summary-value amount-value">${formatAmount(data.totalAmount)}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">해당 건수</div>
            <div class="summary-value">${data.count}건</div>
          </div>
        `;
        contentHtml = renderEventsTable(data.results);
        break;

      case 'document_question':
        summaryHtml = `
          <div class="summary-card">
            <div class="summary-label">검색 키워드</div>
            <div class="summary-value">${escapeHtml(data.keywords || '')}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">검색 후보</div>
            <div class="summary-value">${data.candidateCount || 0}개</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">최종 분석</div>
            <div class="summary-value">${data.documents?.length || 0}개</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">확실성</div>
            <div class="summary-value">${data.certainty === 'found' ? '발견됨' : data.certainty === 'uncertain' ? '불확실' : '부족'}</div>
          </div>
        `;

        // 자연어 답변 (naturalAnswer 우선, 없으면 judgment 사용)
        const answerText = data.naturalAnswer || data.judgment || '';
        let docQuestionHtml = `
          <div class="answer-box">
            <div class="answer-header">📝 답변</div>
            <div class="answer-content">
              ${escapeHtml(answerText).split('\n').map(line => {
                if (line.startsWith('•')) {
                  return `<div class="answer-point">${escapeHtml(line)}</div>`;
                } else if (line.trim() === '') {
                  return '<div class="answer-spacer"></div>';
                } else {
                  return `<div class="answer-line">${escapeHtml(line)}</div>`;
                }
              }).join('')}
            </div>
          </div>
        `;

        // scopeNote가 있으면 표시
        if (data.scopeNote) {
          docQuestionHtml += `<div class="scope-note">ℹ️ ${escapeHtml(data.scopeNote)}</div>`;
        }

        // 참고 문서 (있는 경우만 표시)
        if (data.documents && data.documents.length > 0) {
          docQuestionHtml += `
            <div class="reference-docs">
              <div class="reference-header">📚 참고 문서 (${data.documents.length}개)</div>
              <div class="reference-list">
                ${data.documents.map((doc, idx) => {
                  const isGDriveNative = doc.filePath && doc.filePath.startsWith('gdrive://');
                  const fileLink = isGDriveNative && doc.webViewLink ? doc.webViewLink : createFileLink(doc.filePath);
                  const folderLink = createFolderLink(doc.filePath);
                  const fileName = escapeHtml(doc.fileName);

                  const actionsHtml = isGDriveNative
                    ? `<a href="${fileLink}" class="btn-primary" target="_blank">Drive에서 열기</a>`
                    : `<a href="${fileLink}" class="btn-primary">파일 열기</a>
                       <a href="${folderLink}" class="btn-secondary">폴더 열기</a>`;

                  return `
                    <div class="reference-item">
                      <div class="reference-name">${idx + 1}. ${fileName}</div>
                      <div class="reference-actions">${actionsHtml}</div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;

          // 상세 근거 (스니펫이 있는 경우만)
          const docsWithSnippets = data.documents.filter(doc => doc.snippets && doc.snippets.length > 0);
          if (docsWithSnippets.length > 0) {
            const detailCards = docsWithSnippets.map((doc, idx) => {
              const isGDriveNative = doc.filePath && doc.filePath.startsWith('gdrive://');
              const displayPath = isGDriveNative ? 'Google Drive' : escapeHtml(doc.folderPath);
              const fileName = escapeHtml(doc.fileName);
              const snippetsHtml = doc.snippets.map((s, i) =>
                `<div class="snippet-item">• ${escapeHtml(s)}</div>`
              ).join('');

              return `
                <div class="detail-card">
                  <div class="detail-header">[${idx + 1}] ${fileName}</div>
                  <div class="detail-location">위치: ${displayPath}</div>
                  <div class="detail-content">
                    <div class="detail-label">상세 내용:</div>
                    ${snippetsHtml}
                  </div>
                </div>
              `;
            }).join('');

            docQuestionHtml += `
              <div class="detail-section">
                <div class="detail-section-header">📄 상세 근거</div>
                ${detailCards}
              </div>
            `;
          }
        }

        contentHtml = docQuestionHtml;
        break;

      case 'document_summary':
        summaryHtml = `
          <div class="summary-card">
            <div class="summary-label">검색 키워드</div>
            <div class="summary-value">${escapeHtml(data.keyword || '')}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">분석 문서</div>
            <div class="summary-value">${data.documents?.length || 0}개</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">검색 결과</div>
            <div class="summary-value">${data.searchResultCount || 0}개</div>
          </div>
        `;

        // 답변 요약 블록
        let answerHtml = '';
        if (data.combinedAnswer && data.combinedAnswer.length > 0) {
          answerHtml = `
            <div class="answer-box">
              <div class="answer-header">📝 답변</div>
              <div class="answer-content">
                ${data.combinedAnswer.map(line => `<div class="answer-line">${escapeHtml(line)}</div>`).join('')}
              </div>
            </div>
          `;
        }

        // 참고 문서 리스트
        let refDocsHtml = '';
        if (data.documents && data.documents.length > 0) {
          const refList = data.documents.map((doc, idx) =>
            `<li>${escapeHtml(doc.fileName)}</li>`
          ).join('');
          refDocsHtml = `
            <div class="reference-docs-box">
              <div class="reference-docs-header">📚 참고 문서 (${data.documents.length}개)</div>
              <ol class="reference-docs-list">
                ${refList}
              </ol>
            </div>
          `;
        }

        // 개별 문서 상세 요약
        let detailedDocsHtml = '';
        const docs = data.documents || [];

        if (docs && docs.length > 0) {
          detailedDocsHtml = `<div class="detailed-docs-header">📄 상세 문서 요약</div>`;

          docs.forEach((doc, docIdx) => {
          const isGDriveNative = doc.filePath && doc.filePath.startsWith('gdrive://');
          const displayPath = isGDriveNative ? 'Google Drive' : escapeHtml(doc.filePath || '-');
          const fileLink = isGDriveNative && doc.webViewLink ? doc.webViewLink : createFileLink(doc.filePath);
          const folderLink = createFolderLink(doc.filePath);
          const isContract = doc.docType === '계약서' || doc.docType === '협약서';

          const actionsHtml = isGDriveNative
            ? `<a href="${fileLink}" class="btn-primary" target="_blank">Drive에서 열기</a>`
            : `<a href="${fileLink}" class="btn-primary">파일 열기</a>
               <a href="${folderLink}" class="btn-secondary">폴더 열기</a>`;

          let docSummaryHtml = `
            <div class="document-info-box">
              <div class="doc-title">📄 ${escapeHtml(doc.fileName)}</div>
              <div class="doc-meta">
                <div class="doc-meta-item"><strong>문서유형:</strong> ${escapeHtml(doc.docType || '-')}</div>
                <div class="doc-meta-item"><strong>위치:</strong> ${displayPath}</div>
              </div>
              <div class="card-actions">
                ${actionsHtml}
              </div>
            </div>
          `;

          // 계약서/협약서인 경우 구조화된 요약 카드 표시
          if (isContract && doc.contractSummary) {
            const cs = doc.contractSummary;

            // [계약 개요]
            if (cs.overview && cs.overview.length > 0) {
              docSummaryHtml += `
                <div class="contract-summary-card">
                  <div class="contract-section-header">📌 계약 개요</div>
                  <div class="contract-section-body">
                    ${cs.overview.map(line => `<div class="contract-summary-line">${escapeHtml(line)}</div>`).join('')}
                  </div>
                </div>
              `;
            }

            // [주요 조건] - 값이 있는 항목만 최대 5개
            const mainConditionFields = [];
            if (cs.mainConditions) {
              Object.entries(cs.mainConditions).forEach(([key, value]) => {
                // 엄격한 필터링: null, undefined, 빈 문자열, '확인되지 않음', '-' 모두 제외
                const valueStr = String(value || '').trim();
                if (valueStr &&
                    valueStr !== 'null' &&
                    valueStr !== 'undefined' &&
                    valueStr !== '확인되지 않음' &&
                    valueStr !== '명확히 확인되지 않음' &&
                    valueStr !== '-') {
                  mainConditionFields.push({ key, value: valueStr });
                }
              });
            }

            // 최대 5개까지만 표시
            const displayMainConditions = mainConditionFields.slice(0, 5);

            if (displayMainConditions.length > 0) {
              docSummaryHtml += `
                <div class="contract-summary-card">
                  <div class="contract-section-header">📋 주요 조건 (${displayMainConditions.length}개)</div>
                  <div class="contract-section-body">
                    <div class="contract-info-grid">
                      ${displayMainConditions.map(({ key, value }) => `
                        <div class="contract-info-item">
                          <div class="contract-info-label">${escapeHtml(key)}</div>
                          <div class="contract-info-value">${escapeHtml(value)}</div>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                </div>
              `;
            }

            // [주요 조항] - 값이 있는 항목만 최대 5개
            let displayKeyTerms = [];
            if (cs.keyTerms && cs.keyTerms.length > 0) {
              displayKeyTerms = cs.keyTerms.filter(term => {
                const valueStr = String(term.value || '').trim();
                return valueStr &&
                       valueStr !== 'null' &&
                       valueStr !== 'undefined' &&
                       valueStr !== '확인되지 않음' &&
                       valueStr !== '명확히 확인되지 않음' &&
                       valueStr !== '-';
              }).slice(0, 5); // 최대 5개
            }

            if (displayKeyTerms.length > 0) {
              docSummaryHtml += `
                <div class="contract-summary-card">
                  <div class="contract-section-header">📜 주요 조항 (${displayKeyTerms.length}개)</div>
                  <div class="contract-section-body">
                    ${displayKeyTerms.map(term => {
                      const isRisk = term.isRisk === true;
                      const riskClass = isRisk ? 'risk-item' : '';
                      const riskIcon = isRisk ? '⚠️ ' : '';
                      return `
                        <div class="contract-term-item ${riskClass}">
                          <div class="contract-term-label">${riskIcon}${escapeHtml(term.label)}</div>
                          <div class="contract-term-value">${escapeHtml(term.value)}</div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            }

            // 확실하지 않은 항목 - 최대 2개만 하단에 표시
            let displayUncertainFields = [];
            if (cs.uncertainFields && cs.uncertainFields.length > 0) {
              displayUncertainFields = cs.uncertainFields.slice(0, 2);
            }

            if (displayUncertainFields.length > 0) {
              docSummaryHtml += `
                <div class="contract-summary-card uncertain-card">
                  <div class="contract-section-header">⚠️ 확실하지 않은 항목 (참고용, 최대 2개)</div>
                  <div class="contract-section-body">
                    <div class="uncertain-fields">
                      ${displayUncertainFields.map(field => `<span class="uncertain-badge">${escapeHtml(field)}</span>`).join('')}
                    </div>
                    <div class="uncertain-note">문서를 직접 확인하시기 바랍니다.</div>
                  </div>
                </div>
              `;
            }
          } else {
            // 비계약서 문서 - 최대 5개 항목만 표시
            const validSummaryLines = (doc.summary || []).filter(line => {
              const lineStr = String(line || '').trim();
              return lineStr &&
                     lineStr !== 'null' &&
                     lineStr !== 'undefined' &&
                     lineStr !== '확인되지 않음' &&
                     lineStr !== '명확히 확인되지 않음' &&
                     lineStr !== '-';
            }).slice(0, 5);

            if (validSummaryLines.length > 0) {
              docSummaryHtml += `
                <div class="summary-content-box">
                  <div class="summary-content-label">📝 요약 (${validSummaryLines.length}개)</div>
                  <ol class="summary-list">
                    ${validSummaryLines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}
                  </ol>
                </div>
              `;
            }

            // 추출 정보 - 값이 있는 항목만 최대 5개
            const validFields = [];
            if (doc.fields && Object.keys(doc.fields).length > 0) {
              Object.entries(doc.fields).forEach(([key, value]) => {
                const valueStr = String(value || '').trim();
                if (valueStr &&
                    valueStr !== 'null' &&
                    valueStr !== 'undefined' &&
                    valueStr !== '확인되지 않음' &&
                    valueStr !== '명확히 확인되지 않음' &&
                    valueStr !== '-') {
                  validFields.push({ key, value: valueStr });
                }
              });
            }

            const displayFields = validFields.slice(0, 5);

            if (displayFields.length > 0) {
              const fieldsHtml = displayFields.map(({ key, value }) =>
                `<div class="field-item"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</div>`
              ).join('');

              docSummaryHtml += `
                <div class="fields-box">
                  <div class="fields-label">📊 추출 정보 (${displayFields.length}개)</div>
                  ${fieldsHtml}
                </div>
              `;
            }
          }

            detailedDocsHtml += docSummaryHtml;
          });

          contentHtml = answerHtml + refDocsHtml + detailedDocsHtml;
        } else {
          contentHtml = '<p class="no-results">문서를 찾을 수 없습니다.</p>';
        }
        break;

      default:
        contentHtml = '<p class="no-results">결과가 없습니다.</p>';
    }
  }

  return `
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OGQ Docs Ask 결과 - ${escapeHtml(question)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px 20px;
      min-height: 100vh;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      color: #333;
      margin-bottom: 10px;
    }

    .question-box {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }

    .question-type {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 14px;
      margin-bottom: 10px;
    }

    .question-text {
      font-size: 20px;
      color: #333;
      font-weight: 500;
    }

    .meta-info {
      font-size: 13px;
      color: #6c757d;
      margin-top: 10px;
    }

    .summary-section {
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
      margin-bottom: 30px;
    }

    .summary-card {
      background: white;
      border-radius: 12px;
      padding: 20px;
      flex: 1;
      min-width: 200px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .summary-card.amount-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .summary-label {
      font-size: 13px;
      color: #6c757d;
      margin-bottom: 8px;
      font-weight: 500;
    }

    .amount-card .summary-label {
      color: rgba(255, 255, 255, 0.9);
    }

    .summary-value {
      font-size: 24px;
      font-weight: 600;
      color: #333;
    }

    .amount-card .summary-value {
      color: white;
    }

    .amount-value {
      font-size: 32px;
      font-weight: 700;
    }

    .content-section {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .result-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
    }

    .result-table thead {
      background: #f8f9fa;
      position: sticky;
      top: 0;
    }

    .result-table th {
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #495057;
      border-bottom: 2px solid #dee2e6;
    }

    .result-table td {
      padding: 12px;
      border-bottom: 1px solid #dee2e6;
      vertical-align: top;
    }

    .result-table tbody tr:hover {
      background: #f8f9fa;
    }

    /* 결과 헤더 */
    .results-header {
      font-size: 15px;
      font-weight: 600;
      color: #495057;
      margin-bottom: 16px;
      padding-bottom: 10px;
      border-bottom: 2px solid #dee2e6;
    }

    /* 결과 컨테이너 */
    .results-container {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* 결과 카드 */
    .result-card {
      background: #fff;
      border: 1px solid #e9ecef;
      border-radius: 10px;
      padding: 16px;
      transition: box-shadow 0.2s, transform 0.2s;
    }

    .result-card:hover {
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
      transform: translateY(-2px);
    }

    /* 카드 헤더 */
    .card-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }

    .card-number {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: #667eea;
      color: white;
      border-radius: 50%;
      font-size: 14px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .card-title {
      flex: 1;
      font-size: 16px;
      font-weight: 600;
      color: #333;
      line-height: 1.4;
    }

    .badge {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex-shrink: 0;
    }

    .badge-final {
      background: #667eea;
      color: white;
      border: 1px solid #5568d3;
      font-weight: 700;
      margin-right: 4px;
    }

    .badge-source-gdrive-native {
      background: #e8f5e9;
      color: #2e7d32;
      border: 1px solid #81c784;
      font-weight: 600;
      margin-right: 4px;
    }

    .badge-source-gdrive {
      background: #e3f2fd;
      color: #1565c0;
      border: 1px solid #90caf9;
      font-weight: 600;
      margin-right: 4px;
    }

    .badge-source-local {
      background: #f3e5f5;
      color: #6a1b9a;
      border: 1px solid #ce93d8;
      font-weight: 600;
      margin-right: 4px;
    }

    .badge-high {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
      font-weight: 600;
    }

    .badge-medium {
      background: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
    }

    .badge-scanned {
      background: #fff3cd;
      color: #856404;
      border: 1px solid #ffc107;
      font-weight: 600;
      margin-right: 4px;
    }

    .badge-extraction-error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
      font-weight: 600;
      margin-right: 4px;
    }

    .badge-no-text {
      background: #e7e7e7;
      color: #495057;
      border: 1px solid #d3d3d3;
      font-weight: 600;
      margin-right: 4px;
    }

    .badge-ocr-success {
      background: #d1f2eb;
      color: #0f5132;
      border: 1px solid #badbcc;
      font-weight: 700;
      margin-right: 4px;
    }

    .badge-ocr-failed {
      background: #f8d7da;
      color: #842029;
      border: 1px solid #f5c2c7;
      font-weight: 600;
      margin-right: 4px;
    }

    /* 카드 바디 */
    .card-body {
      margin-bottom: 10px;
    }

    .score-label {
      font-size: 13px;
      color: #495057;
      margin-bottom: 8px;
    }

    .match-info {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 12px;
      align-items: center;
    }

    .match-label {
      font-size: 11px;
      color: #868e96;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .match-tag {
      display: inline-block;
      padding: 4px 10px;
      background: #e7f3ff;
      border: 1px solid #c3dafe;
      color: #1e40af;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
    }

    .folder-label {
      font-size: 11px;
      color: #868e96;
      font-weight: 500;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .folder-path {
      font-family: monospace;
      color: #7c3aed;
      font-size: 14px;
      margin: 6px 0 12px 0;
      word-break: break-all;
      line-height: 1.5;
    }

    /* 카드 액션 */
    .card-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .btn-primary {
      display: inline-block;
      padding: 8px 16px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }

    .btn-primary:hover {
      background: #5568d3;
    }

    .btn-secondary {
      display: inline-block;
      padding: 8px 16px;
      background: #e9ecef;
      color: #495057;
      text-decoration: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      transition: background 0.2s;
    }

    .btn-secondary:hover {
      background: #dee2e6;
    }

    /* 카드 푸터 */
    .card-footer {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #f1f3f5;
    }

    .footer-text {
      font-size: 12px;
      color: #868e96;
    }

    /* 레거시 스타일 (이벤트 테이블용) */
    .file-name {
      font-weight: 600;
      color: #333;
      margin-bottom: 8px;
    }

    .file-path-label {
      font-size: 11px;
      color: #868e96;
      font-weight: 500;
      margin-top: 6px;
      margin-bottom: 2px;
    }

    .file-path {
      font-size: 11px;
      color: #6c757d;
      font-family: monospace;
      word-break: break-all;
      margin-bottom: 4px;
      padding-left: 8px;
    }

    .file-links {
      display: flex;
      gap: 8px;
    }

    .file-link {
      display: inline-block;
      padding: 4px 12px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-size: 12px;
      transition: background 0.2s;
    }

    .file-link:hover {
      background: #764ba2;
    }

    .snippet-cell {
      font-size: 13px;
      line-height: 1.6;
      color: #495057;
      max-width: 400px;
    }

    .highlight {
      background: #fff3cd;
      color: #856404;
      padding: 2px 4px;
      border-radius: 3px;
    }

    .amount-cell {
      font-weight: 600;
      color: #667eea;
      text-align: right;
    }

    .no-results {
      padding: 40px;
      text-align: center;
      color: #6c757d;
      font-size: 16px;
    }

    .error-box {
      background: #f8d7da;
      border: 1px solid #f5c6cb;
      color: #721c24;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }

    .warning-box {
      background: #fff3cd;
      border: 1px solid #ffeeba;
      color: #856404;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }

    /* 문서 질문 스타일 */
    .judgment-box {
      background: #e7f3ff;
      border-left: 4px solid #667eea;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 24px;
      font-size: 15px;
      line-height: 1.7;
      color: #333;
    }

    .scope-note {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 20px;
      font-size: 14px;
      color: #856404;
    }

    .doc-evidence-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .doc-evidence-card {
      background: #fff;
      border: 1px solid #e9ecef;
      border-radius: 10px;
      overflow: hidden;
    }

    .doc-evidence-header {
      background: #f8f9fa;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #e9ecef;
    }

    .doc-evidence-number {
      background: #667eea;
      color: white;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 14px;
    }

    .doc-evidence-title {
      font-size: 15px;
      font-weight: 600;
      color: #333;
      flex: 1;
    }

    .doc-evidence-body {
      padding: 16px;
    }

    .snippets-section {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #f1f3f5;
    }

    .snippets-label {
      font-size: 12px;
      color: #868e96;
      font-weight: 500;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .snippet-item {
      background: #f8f9fa;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 8px;
      font-size: 13px;
      line-height: 1.6;
      color: #495057;
      border-left: 3px solid #dee2e6;
    }

    .snippet-item:last-child {
      margin-bottom: 0;
    }

    .footer {
      margin-top: 30px;
      text-align: center;
      color: white;
      font-size: 13px;
      opacity: 0.8;
    }

    /* 계약 메타데이터 카드 스타일 */
    .metadata-card {
      background: white;
      border-radius: 12px;
      padding: 0;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      overflow: hidden;
      margin-bottom: 20px;
    }

    .metadata-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      font-size: 18px;
      font-weight: 600;
    }

    .metadata-body {
      padding: 20px;
    }

    .metadata-row {
      display: flex;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #e9ecef;
    }

    .metadata-row:last-child {
      border-bottom: none;
    }

    .metadata-label {
      flex: 0 0 140px;
      font-size: 14px;
      color: #6c757d;
      font-weight: 500;
    }

    .metadata-value {
      flex: 1;
      font-size: 15px;
      color: #333;
      font-weight: 600;
    }

    .metadata-confidence {
      flex: 0 0 auto;
      font-size: 12px;
      color: #6c757d;
      margin-left: 10px;
    }

    .metadata-footer {
      padding: 20px;
      background: #f8f9fa;
      border-top: 1px solid #e9ecef;
    }

    .metadata-source {
      font-size: 13px;
      color: #6c757d;
      margin-bottom: 15px;
    }

    .highlight-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .highlight-card .summary-label {
      color: rgba(255, 255, 255, 0.9);
    }

    .highlight-card .summary-value {
      color: white;
    }

    .highlight-card .large-value {
      font-size: 32px;
    }

    .highlight-card .confidence-label {
      font-size: 12px;
      color: rgba(255, 255, 255, 0.8);
      margin-top: 8px;
    }

    .info-box {
      background: #e7f3ff;
      border-left: 4px solid #2196f3;
      padding: 15px;
      border-radius: 8px;
      color: #1565c0;
      margin-top: 20px;
    }

    /* 문서 요약 스타일 */
    .document-info-box {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      margin-bottom: 20px;
    }

    .doc-title {
      font-size: 20px;
      font-weight: 600;
      color: #333;
      margin-bottom: 15px;
    }

    .doc-meta {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 15px;
      font-size: 14px;
      color: #666;
    }

    .doc-meta-item {
      line-height: 1.5;
    }

    .summary-content-box {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      margin-bottom: 20px;
    }

    .summary-content-label {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }

    .summary-list {
      padding-left: 20px;
      margin: 0;
    }

    .summary-list li {
      margin-bottom: 10px;
      line-height: 1.6;
      color: #333;
    }

    .fields-box {
      background: white;
      border-radius: 12px;
      padding: 25px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .fields-label {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 15px;
    }

    .field-item {
      padding: 10px 0;
      border-bottom: 1px solid #f0f0f0;
      color: #333;
      line-height: 1.5;
    }

    .field-item:last-child {
      border-bottom: none;
    }

    .field-item strong {
      color: #667eea;
      margin-right: 8px;
    }

    /* 계약서 요약 카드 스타일 */
    .contract-summary-card {
      background: white;
      border-radius: 12px;
      padding: 0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      margin-bottom: 20px;
      overflow: hidden;
      border: 1px solid #e9ecef;
    }

    .contract-summary-card.uncertain-card {
      border: 1px solid #ffc107;
      background: #fffbf0;
    }

    .contract-section-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 20px;
      font-size: 16px;
      font-weight: 600;
    }

    .uncertain-card .contract-section-header {
      background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%);
    }

    .contract-section-body {
      padding: 20px;
    }

    .contract-summary-line {
      padding: 10px 0;
      border-bottom: 1px solid #f0f0f0;
      color: #333;
      line-height: 1.6;
      font-size: 15px;
    }

    .contract-summary-line:last-child {
      border-bottom: none;
    }

    .contract-info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
    }

    .contract-info-item {
      background: #f8f9fa;
      padding: 12px 16px;
      border-radius: 8px;
      border-left: 3px solid #667eea;
    }

    .contract-info-label {
      font-size: 12px;
      color: #6c757d;
      font-weight: 500;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .contract-info-value {
      font-size: 15px;
      font-weight: 600;
      color: #333;
    }

    .contract-term-item {
      padding: 14px 0;
      border-bottom: 1px solid #f0f0f0;
    }

    .contract-term-item:last-child {
      border-bottom: none;
    }

    /* 리스크 항목 강조 스타일 */
    .contract-term-item.risk-item {
      background: linear-gradient(to right, #fff5f5 0%, #ffffff 100%);
      padding: 14px 16px;
      margin: 0 -16px;
      border-left: 4px solid #dc3545;
      border-radius: 4px;
      border-bottom: 1px solid #f0f0f0;
    }

    .contract-term-item.risk-item .contract-term-label {
      color: #dc3545;
      font-weight: 700;
    }

    .contract-term-item.risk-item .contract-term-value {
      color: #721c24;
      font-weight: 500;
    }

    .contract-term-label {
      font-size: 13px;
      color: #667eea;
      font-weight: 600;
      margin-bottom: 6px;
    }

    .contract-term-value {
      font-size: 14px;
      color: #333;
      line-height: 1.6;
    }

    .uncertain-fields {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }

    .uncertain-badge {
      display: inline-block;
      padding: 6px 12px;
      background: #fff3cd;
      border: 1px solid #ffc107;
      color: #856404;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
    }

    .uncertain-note {
      font-size: 13px;
      color: #856404;
      font-style: italic;
    }

    /* 답변 요약 스타일 */
    .answer-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 25px;
      color: white;
      box-shadow: 0 6px 12px rgba(102, 126, 234, 0.3);
    }

    .answer-header {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 18px;
      color: white;
      border-bottom: 2px solid rgba(255, 255, 255, 0.3);
      padding-bottom: 10px;
    }

    .answer-content {
      font-size: 16px;
      line-height: 1.9;
    }

    .answer-line {
      margin-bottom: 10px;
      color: rgba(255, 255, 255, 0.98);
      font-weight: 400;
    }

    .answer-line:first-child {
      font-size: 17px;
      font-weight: 600;
      margin-bottom: 15px;
    }

    /* 참고 문서 스타일 */
    .reference-docs-box {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }

    .reference-docs-header {
      font-size: 16px;
      font-weight: 600;
      color: #333;
      margin-bottom: 12px;
    }

    .reference-docs-list {
      margin: 0;
      padding-left: 24px;
      color: #495057;
    }

    .reference-docs-list li {
      margin-bottom: 6px;
      line-height: 1.6;
    }

    /* 상세 문서 요약 헤더 */
    .detailed-docs-header {
      font-size: 18px;
      font-weight: 700;
      color: #667eea;
      margin: 30px 0 20px 0;
      padding-bottom: 10px;
      border-bottom: 2px solid #e9ecef;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 OGQ Docs Ask 결과</h1>
      <div class="question-box">
        <div class="question-type">${icon} ${typeLabel}</div>
        <div class="question-text">${escapeHtml(question)}</div>
        <div class="meta-info">조회 시각: ${timestampFormatted}</div>
      </div>
    </div>

    ${summaryHtml ? `<div class="summary-section">${summaryHtml}</div>` : ''}

    <div class="content-section">
      ${contentHtml}
    </div>

    <div class="footer">
      Generated by OGQ Docs Ask
    </div>
  </div>
</body>
</html>
  `.trim();
}
