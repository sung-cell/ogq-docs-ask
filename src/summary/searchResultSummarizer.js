/**
 * 문서 검색 결과 요약 생성
 * OpenAI API를 사용하여 상위 검색 결과 문서 내용을 기반으로 3~5줄 요약 생성
 */

import OpenAI from 'openai';
import { readFileSync } from 'fs';

/**
 * OpenAI 클라이언트 생성
 */
function createOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  try {
    return new OpenAI({ apiKey });
  } catch (err) {
    console.warn('[searchResultSummarizer] OpenAI 클라이언트 생성 실패:', err.message);
    return null;
  }
}

/**
 * 문서 내용 추출 (최대 3,000자)
 */
function extractDocumentContent(document, maxChars = 3000) {
  try {
    // text 필드 우선 사용
    if (document.text && typeof document.text === 'string') {
      return document.text.substring(0, maxChars);
    }

    // snippet 필드 사용
    if (document.snippet && typeof document.snippet === 'string') {
      return document.snippet.substring(0, maxChars);
    }

    // chunk 필드 사용
    if (document.chunk && typeof document.chunk === 'string') {
      return document.chunk.substring(0, maxChars);
    }

    // filePath로 직접 읽기 시도
    if (document.filePath && !document.filePath.startsWith('gdrive://')) {
      try {
        const content = readFileSync(document.filePath, 'utf-8');
        return content.substring(0, maxChars);
      } catch (readErr) {
        // 파일 읽기 실패는 무시
      }
    }

    return '';
  } catch (err) {
    console.warn('[searchResultSummarizer] 문서 내용 추출 실패:', err.message);
    return '';
  }
}

/**
 * 검색 결과 요약 생성
 * @param {string} query - 사용자 검색어
 * @param {Array} documents - 검색된 문서 목록 (상위 3개만 사용)
 * @returns {Promise<string|null>} - 요약 텍스트 또는 null
 */
export async function summarizeSearchResults(query, documents) {
  // OpenAI API Key 확인
  const client = createOpenAIClient();
  if (!client) {
    return null;
  }

  // 상위 3개 문서만 사용
  const topDocuments = documents.slice(0, 3);

  if (topDocuments.length === 0) {
    return null;
  }

  // 문서 내용 추출
  const documentContents = [];
  for (const doc of topDocuments) {
    const content = extractDocumentContent(doc);
    if (content) {
      documentContents.push({
        fileName: doc.fileName || '알 수 없음',
        content: content
      });
    }
  }

  if (documentContents.length === 0) {
    return null;
  }

  // 프롬프트 생성
  const documentTexts = documentContents.map((doc, idx) =>
    `[문서 ${idx + 1}: ${doc.fileName}]\n${doc.content}`
  ).join('\n\n---\n\n');

  const systemPrompt = `당신은 문서 검색 결과를 요약하는 전문가입니다.

규칙:
- 검색 질문과 관련된 핵심 내용을 3~5줄로 요약
- 문서에 명시된 내용만 사용
- 추측하지 않음
- 확인되지 않은 내용은 "확인 필요"로 표시
- AI 티나는 표현 금지 ("~로 확인됨", "~언급됨" 등 사용하지 않음)
- 간결하고 명확하게 작성
- 각 줄은 "- "로 시작하는 불릿 포인트 형식`;

  const userPrompt = `검색 질문: "${query}"

다음 문서들을 바탕으로 검색 질문에 대한 답변을 3~5줄로 요약해주세요:

${documentTexts}

요약:`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    const summary = response.choices[0]?.message?.content?.trim();

    if (!summary) {
      return null;
    }

    return summary;
  } catch (err) {
    console.warn('[searchResultSummarizer] 요약 생성 실패:', err.message);
    return null;
  }
}
