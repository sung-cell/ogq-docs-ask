/**
 * Electron Renderer Process
 * UI 로직 및 이벤트 처리
 */

// DOM 요소
const questionInput = document.getElementById('questionInput');
const askButton = document.getElementById('askButton');
const buttonText = document.getElementById('buttonText');
const buttonSpinner = document.getElementById('buttonSpinner');
const resultContent = document.getElementById('resultContent');
const exampleButtons = document.querySelectorAll('.example-btn');
const exampleQuestions = document.getElementById('exampleQuestions');
const clearInputButton = document.getElementById('clearInputButton');
const resetButton = document.getElementById('resetButton');

/**
 * 민감 설정/예시 JSON이 실수로 DOM에 텍스트 노드로 렌더링된 경우 제거
 * - config/credentials/token 내용은 UI에 절대 노출되면 안 됨
 * - 앱 본문 상단에 JSON 문자열이 보이는 문제 방지
 */
function cleanupLeakedConfigTextNodes() {
  if (!document.body) return;

  const sensitivePatterns = [
    'spreadsheetId',
    'sheetName',
    'meetingMinutesSheetName',
    'credentialsPath',
    'tokenPath',
    'client_secret',
    'client_id',
    'token_uri',
    'auth_uri',
    'auth_provider_x509_cert_url',
    'googleapis.com/oauth',
    'spreadsheet-config.json.example',
    'YOUR_CLIENT_ID',
    'YOUR_CLIENT_SECRET',
    'YOUR_SPREADSHEET_ID_HERE',
    'FULL_DOCUMENT_FALLBACK',
    'textractOptions',
    'testSearchOptions',
    'oauth2.googleapis.com',
    'googleapis.com',
    '예시 파일'
  ];

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodesToRemove = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const trimmed = (node.nodeValue || '').trim();
    if (!trimmed) continue;

    const leaked =
      trimmed.startsWith('{') ||
      trimmed.startsWith('}') ||
      trimmed.startsWith('"') ||
      trimmed.includes('\\"') ||
      sensitivePatterns.some(pattern => trimmed.includes(pattern));

    if (leaked) nodesToRemove.push(node);
  }

  nodesToRemove.forEach(node => node.parentNode?.removeChild(node));
}

function runLeakCleanupRepeatedly() {
  cleanupLeakedConfigTextNodes();
  setTimeout(cleanupLeakedConfigTextNodes, 50);
  setTimeout(cleanupLeakedConfigTextNodes, 250);
  setTimeout(cleanupLeakedConfigTextNodes, 1000);
}

runLeakCleanupRepeatedly();

// Welcome 메시지 HTML (동적 생성)
function getWelcomeHTML(indexStatus) {
  if (!indexStatus || !indexStatus.hasIndex) {
    // 패키징 모드에서는 인덱스 생성 버튼 숨김 (외부에서 생성한 인덱스 사용)
    const showCreateButton = !window.csAsk.isPackaged;

    const createButtonHTML = showCreateButton ? `
      <button id="createIndexButton" class="index-create-button">
        📚 인덱스 생성하기
      </button>
      <div id="indexingMessage" class="indexing-message" style="display: none;"></div>
    ` : `
      <p style="margin-top: 20px; padding: 12px; background: #fff3cd; border-radius: 8px; color: #856404;">
        💡 <strong>인덱스 파일이 필요합니다</strong><br>
        터미널에서 <code>node index.js reindex</code>를 실행하여<br>
        인덱스를 생성한 후 앱을 다시 시작해주세요.
      </p>
    `;

    return `
      <div class="no-index-message">
        <h3>⚠️ 문서 인덱스가 없습니다</h3>
        <p>질문을 시작하기 전에 먼저 문서 인덱스를 생성해야 합니다.<br>
        ${showCreateButton ? '인덱스 생성은 수 분 정도 소요될 수 있습니다.' : ''}</p>
        ${createButtonHTML}
      </div>
    `;
  }

  const lastIndexed = indexStatus.lastIndexed ? new Date(indexStatus.lastIndexed).toLocaleString('ko-KR') : '알 수 없음';

  return `
    <div class="welcome-message">
      <h2>👋 환영합니다!</h2>
      <p>위에서 질문을 선택하거나 직접 입력하여 시작하세요.</p>
      <div class="index-info" style="margin: 20px 0; padding: 12px; background: #e3f2fd; border-radius: 8px; font-size: 13px; color: #1565c0;">
        <div><strong>인덱스 문서 수:</strong> ${indexStatus.documentCount}개</div>
        <div><strong>마지막 인덱싱:</strong> ${lastIndexed}</div>
      </div>
      <div class="features">
        <div class="feature-item">
          <div class="feature-icon">🔍</div>
          <div class="feature-text">문서 검색</div>
        </div>
        <div class="feature-item">
          <div class="feature-icon">📅</div>
          <div class="feature-text">일정 조회</div>
        </div>
        <div class="feature-item">
          <div class="feature-icon">💰</div>
          <div class="feature-text">금액 분석</div>
        </div>
        <div class="feature-item">
          <div class="feature-icon">📄</div>
          <div class="feature-text">내용 질문</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 질문 실행
 */
async function executeQuestion(question) {
  if (!question || question.trim() === '') {
    return;
  }
  // 로딩 상태
  setLoading(true);

  // 예시 질문 숨기기
  exampleQuestions.style.display = 'none';

  try {
    // preload에서 노출한 API 사용
    const result = await window.csAsk.ask(question);

    if (result.success && result.html) {
      // HTML 결과를 같은 창에 렌더링
      renderResult(result.html);
    } else {
      // 에러 표시
      console.error('[renderer.js] 에러 표시:', result.error);
      showError(result.error || '알 수 없는 오류가 발생했습니다.');
    }
  } catch (error) {
    console.error('[renderer.js] 예외 발생:', error);
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

/**
 * 결과 HTML 렌더링
 */
function renderResult(html) {
  // HTML에서 body 내용만 추출
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  // HTML에서 style 태그 추출
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const styles = styleMatch ? styleMatch[1] : '';

  // 결과 영역에 렌더링
  resultContent.innerHTML = `
    <style>${styles}</style>
    ${bodyContent}
  `;

  runLeakCleanupRepeatedly();

  // file:// 링크 처리
  setupFileLinks();
}

/**
 * file:// 및 외부 링크를 시스템 기본 브라우저/앱으로 열기
 */
function setupFileLinks() {
  // file:// 링크 처리
  const fileLinks = resultContent.querySelectorAll('a[href^="file://"]');
  fileLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = link.getAttribute('href');
      if (window.shell && window.shell.openExternal) {
        window.shell.openExternal(url);
      }
    });
  });

  // https:// 링크 처리 (Google Drive 등)
  const httpsLinks = resultContent.querySelectorAll('a[href^="https://"], a[href^="http://"]');
  httpsLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = link.getAttribute('href');
      if (window.shell && window.shell.openExternal) {
        console.log('[renderer.js] Opening external URL:', url);
        window.shell.openExternal(url);
      } else {
        console.error('[renderer.js] shell.openExternal not available');
      }
    });
  });

  // target="_blank" 링크도 외부 브라우저로 열기
  const targetBlankLinks = resultContent.querySelectorAll('a[target="_blank"]');
  targetBlankLinks.forEach(link => {
    const url = link.getAttribute('href');
    // 이미 위에서 처리된 링크는 스킵
    if (url && !url.startsWith('file://') && !url.startsWith('http://') && !url.startsWith('https://')) {
      return;
    }
    // 이벤트 리스너가 중복 등록되지 않도록 체크
    if (!link.hasAttribute('data-external-listener')) {
      link.setAttribute('data-external-listener', 'true');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        if (window.shell && window.shell.openExternal) {
          console.log('[renderer.js] Opening external URL (target=_blank):', url);
          window.shell.openExternal(url);
        }
      });
    }
  });
}

/**
 * 에러 표시
 */
function showError(message) {
  resultContent.innerHTML = `
    <div class="error-message">
      <h3>⚠️ 오류 발생</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * 로딩 상태 설정
 */
function setLoading(isLoading) {
  if (isLoading) {
    askButton.disabled = true;
    resetButton.disabled = true;
    buttonText.textContent = '질문 중...';
    buttonText.style.display = 'inline';
    buttonSpinner.style.display = 'inline';
    questionInput.disabled = true;
  } else {
    askButton.disabled = false;
    resetButton.disabled = false;
    buttonText.textContent = '질문하기';
    buttonText.style.display = 'inline';
    buttonSpinner.style.display = 'none';
    questionInput.disabled = false;
  }
}

/**
 * 인덱스 상태 확인 및 업데이트
 */
async function updateIndexStatus() {
  try {
    const status = await window.csAsk.checkIndexStatus();

    // 헤더의 인덱스 상태 업데이트
    const indexStatusEl = document.getElementById('indexStatus');
    if (indexStatusEl) {
      if (status.hasIndex) {
        indexStatusEl.innerHTML = `
          <span class="status-icon">✅</span>
          <span class="status-ready">문서 ${status.documentCount}개 인덱싱됨</span>
        `;
      } else {
        indexStatusEl.innerHTML = `
          <span class="status-icon">⚠️</span>
          <span>인덱스 없음</span>
        `;
      }
    } else {
      console.warn('[renderer.js] indexStatus 엘리먼트를 찾을 수 없습니다');
    }

    return status;
  } catch (error) {
    console.error('[renderer.js] 인덱스 상태 확인 실패:', error);
    return { hasIndex: false, documentCount: 0, lastIndexed: null };
  }
}

/**
 * 인덱스 생성 버튼 이벤트 리스너 설정
 */
function setupIndexCreateButton() {
  const createIndexButton = document.getElementById('createIndexButton');
  const indexingMessage = document.getElementById('indexingMessage');

  if (!createIndexButton) return;

  createIndexButton.addEventListener('click', async () => {
    console.log('[renderer.js] 인덱스 생성 시작');

    // 버튼 비활성화
    createIndexButton.disabled = true;
    createIndexButton.textContent = '⏳ 인덱싱 중...';

    // 진행 메시지 표시
    indexingMessage.style.display = 'block';
    indexingMessage.className = 'indexing-message';
    indexingMessage.textContent = '문서를 인덱싱하고 있습니다. 잠시만 기다려주세요...';

    try {
      const result = await window.csAsk.runReindex();

      if (result.success) {
        // indexStatus가 있으면 즉시 사용, 없으면 다시 확인
        let indexStatus = result.indexStatus;
        if (!indexStatus) {
          indexStatus = await updateIndexStatus();
        }

        if (indexStatus.hasIndex) {
          indexingMessage.className = 'indexing-message success';
          indexingMessage.textContent = `✅ 인덱싱 완료! (${indexStatus.documentCount}개 문서)`;

          // 1초 후 질문 UI로 전환
          setTimeout(() => {
            resultContent.innerHTML = getWelcomeHTML(indexStatus);
            runLeakCleanupRepeatedly();
            setupIndexCreateButton();
            exampleQuestions.style.display = 'block';
          }, 1000);
        } else {
          indexingMessage.className = 'indexing-message success';
          indexingMessage.textContent = '✅ 인덱싱이 완료되었습니다!';

          // 2초 후 화면 초기화
          setTimeout(async () => {
            await resetAll();
          }, 2000);
        }
      } else {
        throw new Error(result.error || '인덱싱 실패');
      }
    } catch (error) {
      console.error('[renderer.js] 인덱싱 오류:', error);
      indexingMessage.className = 'indexing-message error';
      indexingMessage.textContent = `❌ 오류: ${error.message}`;

      // 버튼 재활성화
      createIndexButton.disabled = false;
      createIndexButton.textContent = '📚 인덱스 생성하기';
    }
  });
}

/**
 * 전체 초기화
 */
async function resetAll() {
  // 입력창 초기화
  questionInput.value = '';

  // 인덱스 상태 확인
  const indexStatus = await updateIndexStatus();

  // 결과 영역 초기 상태로 복원
  resultContent.innerHTML = getWelcomeHTML(indexStatus);
  runLeakCleanupRepeatedly();

  // 인덱스 생성 버튼 이벤트 리스너 추가
  setupIndexCreateButton();

  // 예시 질문 다시 표시
  exampleQuestions.style.display = 'block';

  // X 버튼 숨기기
  updateClearButtonVisibility();

  // 스크롤 맨 위로
  const resultArea = document.querySelector('.result-area');
  if (resultArea) {
    resultArea.scrollTop = 0;
  }

  // 입력창에 포커스
  questionInput.focus();
}

/**
 * 입력창만 지우기
 */
function clearInput() {
  questionInput.value = '';
  updateClearButtonVisibility();
  questionInput.focus();
}

/**
 * X 버튼 표시/숨기기
 */
function updateClearButtonVisibility() {
  if (questionInput.value.trim().length > 0) {
    clearInputButton.style.display = 'block';
  } else {
    clearInputButton.style.display = 'none';
  }
}

/**
 * HTML 이스케이프
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 이벤트 리스너
askButton.addEventListener('click', () => {
  const question = questionInput.value.trim();
  executeQuestion(question);
});

questionInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const question = questionInput.value.trim();
    executeQuestion(question);
  }
});

// 입력창 내용 변경 시 X 버튼 표시/숨기기
questionInput.addEventListener('input', updateClearButtonVisibility);

// X 버튼 (입력창 지우기)
clearInputButton.addEventListener('click', clearInput);

// 초기화 버튼
resetButton.addEventListener('click', resetAll);

// 예시 질문 버튼
exampleButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const question = btn.getAttribute('data-question');
    questionInput.value = question;
    updateClearButtonVisibility();
    executeQuestion(question);
  });
});

// 초기 포커스 및 X 버튼 상태 설정
questionInput.focus();
updateClearButtonVisibility();

/**
 * 초기 설정 UI 관련 함수들
 */

// 초기 설정 UI 표시/숨기기
function showInitialSetup(show) {
  const initialSetup = document.getElementById('initialSetup');
  if (initialSetup) {
    initialSetup.style.display = show ? 'block' : 'none';
  }
}

// 초기 설정 UI 폴더 목록 변수
let initialFolders = [];

// 초기 설정 폴더 목록 렌더링
function renderInitialFoldersList() {
  const initialFoldersList = document.getElementById('initialFoldersList');

  if (!initialFoldersList) return;

  if (initialFolders.length === 0) {
    initialFoldersList.innerHTML = '<p style="color: #999; font-size: 13px; text-align: center; padding: 20px;">폴더를 추가하세요.</p>';
    updateSetupButtons();
    return;
  }

  initialFoldersList.innerHTML = initialFolders.map((folder, index) => `
    <div class="folder-item">
      <span class="folder-path" title="${escapeHtml(folder)}">${escapeHtml(folder)}</span>
      <button class="remove-folder-button" data-index="${index}">삭제</button>
    </div>
  `).join('');

  // 삭제 버튼 이벤트 리스너
  initialFoldersList.querySelectorAll('.remove-folder-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.getAttribute('data-index'));
      initialFolders.splice(index, 1);
      renderInitialFoldersList();
    });
  });

  updateSetupButtons();
}

// 설정 저장 버튼 활성화/비활성화 업데이트
function updateSetupButtons() {
  const saveSetupButton = document.getElementById('saveSetupButton');
  const saveAndIndexButton = document.getElementById('saveAndIndexButton');

  const hasPath = initialFolders.length > 0;

  if (saveSetupButton) saveSetupButton.disabled = !hasPath;
  if (saveAndIndexButton) saveAndIndexButton.disabled = !hasPath;
}

// 설정 저장
async function handleSaveSetup() {
  const watchDownloadsCheckbox = document.getElementById('watchDownloadsCheckbox');
  const watchGoogleDriveCheckbox = document.getElementById('watchGoogleDriveCheckbox');
  const setupMessage = document.getElementById('setupMessage');

  const config = {
    documentsRoots: [...initialFolders],
    watchDownloads: watchDownloadsCheckbox.checked,
    watchGoogleDrive: watchGoogleDriveCheckbox.checked
  };

  setupMessage.style.display = 'block';
  setupMessage.className = 'setup-message info';
  setupMessage.textContent = '⏳ 설정 저장 중...';

  try {
    const result = await window.csAsk.saveSetupConfig(config);

    if (result.success) {
      setupMessage.className = 'setup-message success';
      setupMessage.textContent = '✅ 설정이 저장되었습니다!';

      setTimeout(() => {
        setupMessage.style.display = 'none';
      }, 3000);
    } else {
      throw new Error(result.error || '설정 저장 실패');
    }
  } catch (error) {
    setupMessage.className = 'setup-message error';
    setupMessage.textContent = `❌ 오류: ${error.message}`;
  }
}

// 설정 저장 후 인덱스 생성
async function handleSaveAndIndex() {
  const watchDownloadsCheckbox = document.getElementById('watchDownloadsCheckbox');
  const watchGoogleDriveCheckbox = document.getElementById('watchGoogleDriveCheckbox');
  const setupMessage = document.getElementById('setupMessage');
  const saveSetupButton = document.getElementById('saveSetupButton');
  const saveAndIndexButton = document.getElementById('saveAndIndexButton');

  const config = {
    documentsRoots: [...initialFolders],
    watchDownloads: watchDownloadsCheckbox.checked,
    watchGoogleDrive: watchGoogleDriveCheckbox.checked
  };

  // 버튼 비활성화
  saveSetupButton.disabled = true;
  saveAndIndexButton.disabled = true;

  setupMessage.style.display = 'block';
  setupMessage.className = 'setup-message info';
  setupMessage.textContent = '⏳ 설정 저장 중...';

  try {
    // 1. 설정 저장
    const saveResult = await window.csAsk.saveSetupConfig(config);
    if (!saveResult.success) {
      throw new Error(saveResult.error || '설정 저장 실패');
    }

    // 2. 인덱스 생성
    setupMessage.textContent = '⏳ 인덱스 생성 중... (수 분 소요될 수 있습니다)';

    const indexResult = await window.csAsk.runReindex();

    if (indexResult.success) {
      setupMessage.className = 'setup-message success';
      const count = indexResult.indexStatus ? indexResult.indexStatus.documentCount : 0;
      setupMessage.textContent = `✅ 인덱싱 완료! (${count}개 문서)`;

      // 1초 후 초기 설정 숨기고 메인 화면으로 전환
      setTimeout(async () => {
        showInitialSetup(false);
        const indexStatus = await updateIndexStatus();
        resultContent.innerHTML = getWelcomeHTML(indexStatus);
        runLeakCleanupRepeatedly();
        setupIndexCreateButton();
        exampleQuestions.style.display = 'block';
      }, 1000);
    } else {
      throw new Error(indexResult.error || '인덱싱 실패');
    }
  } catch (error) {
    setupMessage.className = 'setup-message error';
    setupMessage.textContent = `❌ 오류: ${error.message}`;

    // 버튼 재활성화
    saveSetupButton.disabled = false;
    saveAndIndexButton.disabled = false;
  }
}

// 초기 설정 UI 이벤트 리스너 설정
function setupInitialSetupListeners() {
  const initialAddFolderButton = document.getElementById('initialAddFolderButton');
  const saveSetupButton = document.getElementById('saveSetupButton');
  const saveAndIndexButton = document.getElementById('saveAndIndexButton');

  // 폴더 추가 버튼
  if (initialAddFolderButton) {
    initialAddFolderButton.addEventListener('click', async () => {
      const path = await window.csAsk.chooseDocumentsRoot();

      if (path) {
        // 중복 확인
        if (!initialFolders.includes(path)) {
          initialFolders.push(path);
          renderInitialFoldersList();
        }
      }
    });
  }

  if (saveSetupButton) {
    saveSetupButton.addEventListener('click', handleSaveSetup);
  }

  if (saveAndIndexButton) {
    saveAndIndexButton.addEventListener('click', handleSaveAndIndex);
  }

  // 초기 렌더링
  renderInitialFoldersList();
}

// 저장된 설정 불러오기
async function loadSavedSetup() {
  const config = await window.csAsk.getSetupConfig();

  if (config) {
    const documentsRootInput = document.getElementById('documentsRootInput');
    const watchDownloadsCheckbox = document.getElementById('watchDownloadsCheckbox');
    const watchGoogleDriveCheckbox = document.getElementById('watchGoogleDriveCheckbox');

    if (documentsRootInput && config.documentsRoot) {
      documentsRootInput.value = config.documentsRoot;
    }

    if (watchDownloadsCheckbox && typeof config.watchDownloads === 'boolean') {
      watchDownloadsCheckbox.checked = config.watchDownloads;
    }

    if (watchGoogleDriveCheckbox && typeof config.watchGoogleDrive === 'boolean') {
      watchGoogleDriveCheckbox.checked = config.watchGoogleDrive;
    }

    updateSetupButtons();
  }
}

// 초기 인덱스 상태 확인 및 welcome 메시지 업데이트
(async function initializeApp() {
  const indexStatus = await updateIndexStatus();

  if (indexStatus.hasIndex) {
    // 인덱스가 있으면 초기 설정 숨기고 메인 화면 표시
    showInitialSetup(false);
    resultContent.innerHTML = getWelcomeHTML(indexStatus);
    runLeakCleanupRepeatedly();
    setupIndexCreateButton();
  } else {
    // 인덱스가 없으면 초기 설정 표시
    showInitialSetup(true);
    setupInitialSetupListeners();
    await loadSavedSetup();
    resultContent.innerHTML = getWelcomeHTML(indexStatus);
    runLeakCleanupRepeatedly();
    setupIndexCreateButton();
  }
})();

// 자동 인덱싱 상태 리스너
const autoIndexStatusBar = document.getElementById('auto-index-status-bar');
const autoIndexStatusText = document.getElementById('auto-index-status-text');

if (window.csAsk && window.csAsk.onAutoIndexStatus) {
  window.csAsk.onAutoIndexStatus((status) => {
    console.log('[Renderer] 자동 인덱싱 상태:', status);

    if (status.status === 'indexing') {
      autoIndexStatusBar.style.display = 'block';
      autoIndexStatusText.textContent = '🔄 자동 재인덱싱 중...';
    } else if (status.status === 'completed') {
      autoIndexStatusBar.style.display = 'block';
      autoIndexStatusText.textContent = `✅ 자동 재인덱싱 완료 (${status.duration})`;
      // 인덱스 상태 갱신
      updateIndexStatus();
      // 3초 후 상태바 숨김
      setTimeout(() => {
        autoIndexStatusBar.style.display = 'none';
      }, 3000);
    } else if (status.status === 'waiting') {
      autoIndexStatusBar.style.display = 'block';
      autoIndexStatusText.textContent = `⏸️ 대기 중 (${status.reason || '조건 확인'})`;
    } else if (status.status === 'error') {
      autoIndexStatusBar.style.display = 'block';
      autoIndexStatusText.textContent = `❌ 자동 재인덱싱 실패`;
      setTimeout(() => {
        autoIndexStatusBar.style.display = 'none';
      }, 5000);
    } else {
      // idle 상태
      autoIndexStatusBar.style.display = 'none';
    }
  });
}

/**
 * 설정 화면 관련 함수들
 */

// 설정 모달 열기/닫기
const settingsModal = document.getElementById('settingsModal');
const settingsButton = document.getElementById('settingsButton');
const closeSettingsButton = document.getElementById('closeSettingsButton');

function openSettings() {
  if (!settingsModal) {
    console.error('[renderer.js] settingsModal 엘리먼트를 찾을 수 없습니다');
    return;
  }

  runLeakCleanupRepeatedly();
  settingsModal.style.display = 'flex';

  loadSettingsData().catch(error => {
    console.error('[renderer.js] 설정 데이터 로드 실패:', error);
    const settingsMessage = document.getElementById('settingsMessage');
    if (settingsMessage) {
      settingsMessage.style.display = 'block';
      settingsMessage.className = 'settings-message error';
      settingsMessage.textContent = `❌ 설정 로드 실패: ${error.message}`;
    }
  });
}

function closeSettings() {
  if (settingsModal) {
    settingsModal.style.display = 'none';
  }
}

// 설정 버튼 클릭
if (settingsButton) {
  settingsButton.addEventListener('click', openSettings);
}

// 닫기 버튼 클릭
if (closeSettingsButton) {
  closeSettingsButton.addEventListener('click', closeSettings);
}

// 오버레이 클릭 시 닫기
if (settingsModal) {
  settingsModal.addEventListener('click', (e) => {
    if (e.target.classList.contains('settings-modal-overlay')) {
      closeSettings();
    }
  });
}

// 설정 데이터 저장용 변수
let currentFolders = [];

// 설정 데이터 로드
async function loadSettingsData() {
  runLeakCleanupRepeatedly();
  // 인덱스 정보 업데이트
  const indexStatus = await window.csAsk.checkIndexStatus();
  const settingsDocCount = document.getElementById('settingsDocCount');
  const settingsLastIndexed = document.getElementById('settingsLastIndexed');

  if (settingsDocCount) {
    settingsDocCount.textContent = indexStatus.documentCount || 0;
  }

  if (settingsLastIndexed) {
    if (indexStatus.lastIndexed) {
      settingsLastIndexed.textContent = new Date(indexStatus.lastIndexed).toLocaleString('ko-KR');
    } else {
      settingsLastIndexed.textContent = '-';
    }
  }

  // 설정 로드
  const config = await window.csAsk.getSetupConfig();

  if (config) {
    // 기존 documentsRoot 호환성 처리
    if (config.documentsRoot && !config.documentsRoots) {
      currentFolders = [config.documentsRoot];
    } else if (config.documentsRoots && Array.isArray(config.documentsRoots)) {
      currentFolders = [...config.documentsRoots];
    } else {
      currentFolders = [];
    }

    // 감시 옵션
    const watchDownloadsCheckbox = document.getElementById('settingsWatchDownloads');
    const watchGoogleDriveCheckbox = document.getElementById('settingsWatchGoogleDrive');

    if (watchDownloadsCheckbox) {
      watchDownloadsCheckbox.checked = config.watchDownloads !== false;
    }

    if (watchGoogleDriveCheckbox) {
      watchGoogleDriveCheckbox.checked = config.watchGoogleDrive !== false;
    }
  } else {
    currentFolders = [];
  }

  renderFoldersList();
}

// 폴더 목록 렌더링
function renderFoldersList() {
  const documentFoldersList = document.getElementById('documentFoldersList');

  if (!documentFoldersList) return;

  if (currentFolders.length === 0) {
    documentFoldersList.innerHTML = '<p style="color: #999; font-size: 13px; text-align: center; padding: 20px;">등록된 폴더가 없습니다.</p>';
    return;
  }

  documentFoldersList.innerHTML = currentFolders.map((folder, index) => `
    <div class="folder-item">
      <span class="folder-path" title="${escapeHtml(folder)}">${escapeHtml(folder)}</span>
      <button class="remove-folder-button" data-index="${index}">삭제</button>
    </div>
  `).join('');

  // 삭제 버튼 이벤트 리스너
  documentFoldersList.querySelectorAll('.remove-folder-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = parseInt(btn.getAttribute('data-index'));
      currentFolders.splice(index, 1);
      renderFoldersList();
    });
  });
}

// 폴더 추가
const addFolderButton = document.getElementById('addFolderButton');
if (addFolderButton) {
  addFolderButton.addEventListener('click', async () => {
    const path = await window.csAsk.chooseDocumentsRoot();

    if (path) {
      // 중복 확인
      if (!currentFolders.includes(path)) {
        currentFolders.push(path);
        renderFoldersList();
      }
    }
  });
}

// 인덱스 재생성
const reindexButton = document.getElementById('reindexButton');
if (reindexButton) {
  reindexButton.addEventListener('click', async () => {
    const settingsMessage = document.getElementById('settingsMessage');

    if (!settingsMessage) return;

    reindexButton.disabled = true;
    settingsMessage.style.display = 'block';
    settingsMessage.className = 'settings-message info';
    settingsMessage.textContent = '⏳ 인덱스 재생성 중... (수 분 소요될 수 있습니다)';

    try {
      const result = await window.csAsk.runReindex();

      if (result.success) {
        settingsMessage.className = 'settings-message success';
        const count = result.indexStatus ? result.indexStatus.documentCount : 0;
        settingsMessage.textContent = `✅ 인덱싱 완료! (${count}개 문서)`;

        // 인덱스 정보 업데이트
        await loadSettingsData();

        setTimeout(() => {
          settingsMessage.style.display = 'none';
        }, 3000);
      } else {
        throw new Error(result.error || '인덱싱 실패');
      }
    } catch (error) {
      settingsMessage.className = 'settings-message error';
      settingsMessage.textContent = `❌ 오류: ${error.message}`;
    } finally {
      reindexButton.disabled = false;
    }
  });
}

// 설정 저장
const saveSettingsButton = document.getElementById('saveSettingsButton');
if (saveSettingsButton) {
  saveSettingsButton.addEventListener('click', async () => {
    const watchDownloadsCheckbox = document.getElementById('settingsWatchDownloads');
    const watchGoogleDriveCheckbox = document.getElementById('settingsWatchGoogleDrive');
    const settingsMessage = document.getElementById('settingsMessage');

    if (!settingsMessage) return;

    const config = {
      documentsRoots: [...currentFolders],
      watchDownloads: watchDownloadsCheckbox ? watchDownloadsCheckbox.checked : true,
      watchGoogleDrive: watchGoogleDriveCheckbox ? watchGoogleDriveCheckbox.checked : true
    };

    settingsMessage.style.display = 'block';
    settingsMessage.className = 'settings-message info';
    settingsMessage.textContent = '⏳ 저장 중...';

    try {
      const result = await window.csAsk.saveSetupConfig(config);

      if (result.success) {
        settingsMessage.className = 'settings-message success';
        settingsMessage.textContent = '✅ 설정이 저장되었습니다!';

        setTimeout(() => {
          settingsMessage.style.display = 'none';
        }, 3000);
      } else {
        throw new Error(result.error || '설정 저장 실패');
      }
    } catch (error) {
      settingsMessage.className = 'settings-message error';
      settingsMessage.textContent = `❌ 오류: ${error.message}`;
    }
  });
}

// 저장 후 인덱스 재생성
const saveAndReindexButton = document.getElementById('saveAndReindexButton');
if (saveAndReindexButton) {
  saveAndReindexButton.addEventListener('click', async () => {
    const watchDownloadsCheckbox = document.getElementById('settingsWatchDownloads');
    const watchGoogleDriveCheckbox = document.getElementById('settingsWatchGoogleDrive');
    const settingsMessage = document.getElementById('settingsMessage');

    if (!settingsMessage) return;

    const config = {
      documentsRoots: [...currentFolders],
      watchDownloads: watchDownloadsCheckbox ? watchDownloadsCheckbox.checked : true,
      watchGoogleDrive: watchGoogleDriveCheckbox ? watchGoogleDriveCheckbox.checked : true
    };

    saveAndReindexButton.disabled = true;
    settingsMessage.style.display = 'block';
    settingsMessage.className = 'settings-message info';
    settingsMessage.textContent = '⏳ 설정 저장 중...';

    try {
      // 1. 설정 저장
      const saveResult = await window.csAsk.saveSetupConfig(config);
      if (!saveResult.success) {
        throw new Error(saveResult.error || '설정 저장 실패');
      }

      // 2. 인덱스 재생성
      settingsMessage.textContent = '⏳ 인덱스 재생성 중... (수 분 소요될 수 있습니다)';

      const indexResult = await window.csAsk.runReindex();

      if (indexResult.success) {
        settingsMessage.className = 'settings-message success';
        const count = indexResult.indexStatus ? indexResult.indexStatus.documentCount : 0;
        settingsMessage.textContent = `✅ 저장 및 인덱싱 완료! (${count}개 문서)`;

        // 인덱스 정보 업데이트
        await loadSettingsData();
        await updateIndexStatus();

        setTimeout(() => {
          settingsMessage.style.display = 'none';
        }, 3000);
      } else {
        throw new Error(indexResult.error || '인덱싱 실패');
      }
    } catch (error) {
      settingsMessage.className = 'settings-message error';
      settingsMessage.textContent = `❌ 오류: ${error.message}`;
    } finally {
      saveAndReindexButton.disabled = false;
    }
  });
}

/**
 * ========================================
 * Google Drive 연결 UI/UX
 * ========================================
 */

// Drive 연결 상태 전역 변수
let driveConnectionStatus = {
  connected: false,
  checked: false
};

/**
 * Drive 연결 상태 확인
 */
async function checkDriveConnection() {
  try {
    const status = await window.csAsk.checkDriveConnectionStatus();
    driveConnectionStatus = {
      ...status,
      checked: true
    };
    return status;
  } catch (error) {
    console.error('[renderer.js] Drive 연결 상태 확인 실패:', error);
    driveConnectionStatus = {
      connected: false,
      checked: true,
      error: error.message
    };
    return driveConnectionStatus;
  }
}

/**
 * 온보딩 배너 표시/숨기기
 */
async function updateDriveOnboardingBanner() {
  const banner = document.getElementById('driveOnboardingBanner');
  if (!banner) return;

  // localStorage에서 "나중에" 상태 확인
  const dismissed = localStorage.getItem('driveOnboardingDismissed');
  if (dismissed === 'true') {
    banner.style.display = 'none';
    return;
  }

  // Drive 연결 상태 확인
  const status = await checkDriveConnection();

  if (!status.connected && status.checked) {
    // 미연결 상태면 배너 표시
    banner.style.display = 'block';
  } else {
    // 연결됨 또는 확인 실패 시 배너 숨김
    banner.style.display = 'none';
  }
}

/**
 * 설정 모달에서 Drive 연결 상태 업데이트
 */
async function updateDriveConnectionInSettings() {
  const statusElement = document.getElementById('driveConnectionStatus');
  const notConnectedSection = document.getElementById('driveNotConnectedSection');
  const connectedSection = document.getElementById('driveConnectedSection');

  if (!statusElement) return;

  // Drive 연결 상태 확인
  const status = await checkDriveConnection();

  if (status.connected) {
    statusElement.textContent = '✅ 연결됨';
    statusElement.className = 'status-value connected';
    if (notConnectedSection) notConnectedSection.style.display = 'none';
    if (connectedSection) connectedSection.style.display = 'block';
  } else {
    statusElement.textContent = '❌ 미연결';
    statusElement.className = 'status-value not-connected';
    if (notConnectedSection) notConnectedSection.style.display = 'block';
    if (connectedSection) connectedSection.style.display = 'none';
  }
}

/**
 * Drive 연결 모달 열기
 */
function openDriveAuthModal() {
  const modal = document.getElementById('driveAuthModal');
  if (modal) {
    modal.style.display = 'block';

    // 입력 필드 초기화
    const authCodeInput = document.getElementById('authCodeInput');
    if (authCodeInput) authCodeInput.value = '';

    // 메시지 숨기기
    const message = document.getElementById('driveAuthMessage');
    if (message) message.style.display = 'none';
  }
}

/**
 * Drive 연결 모달 닫기
 */
function closeDriveAuthModal() {
  const modal = document.getElementById('driveAuthModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Drive 인증 메시지 표시
 */
function showDriveAuthMessage(text, type = 'info') {
  const message = document.getElementById('driveAuthMessage');
  if (message) {
    message.textContent = text;
    message.className = `drive-auth-message ${type}`;
    message.style.display = 'block';
  }
}

/**
 * Credentials 파일 선택 (제거됨 - 앱 내부에 포함)
 */
// async function selectCredentialsFile() {
//   // Credentials는 이제 앱 내부에 포함되어 있습니다
// }

/**
 * Google OAuth 페이지 열기
 */
async function openGoogleAuthPage() {
  try {
    showDriveAuthMessage('⏳ OAuth URL 생성 중...', 'info');

    // OAuth URL 가져오기
    const result = await window.csAsk.getDriveAuthUrl();

    if (result.success && result.authUrl) {
      // 외부 브라우저에서 OAuth URL 열기
      await window.shell.openExternal(result.authUrl);
      showDriveAuthMessage('✅ 브라우저에서 Google 로그인을 완료하면 인증 코드가 표시됩니다. 코드를 복사하여 아래(단계 3)에 붙여넣으세요.', 'success');
    } else {
      // Credentials 파일이 없는 경우
      if (result.error && result.error.includes('credentials')) {
        showDriveAuthMessage('❌ Google 설정 파일이 없습니다. 관리자에게 문의하세요.', 'error');
      } else {
        throw new Error(result.error || 'OAuth URL 생성 실패');
      }
    }
  } catch (error) {
    console.error('[renderer.js] OAuth URL 열기 실패:', error);
    showDriveAuthMessage(`❌ 오류: ${error.message}`, 'error');
  }
}

/**
 * 인증 코드 제출
 */
async function submitAuthCode() {
  const authCodeInput = document.getElementById('authCodeInput');
  const submitButton = document.getElementById('submitAuthCodeButton');

  if (!authCodeInput || !submitButton) return;

  const authCode = authCodeInput.value.trim();

  if (!authCode) {
    showDriveAuthMessage('❌ 인증 코드를 입력하세요.', 'error');
    return;
  }

  try {
    submitButton.disabled = true;
    showDriveAuthMessage('⏳ 연결 중...', 'info');

    // Token 저장
    console.log('[renderer.js] Token 저장 요청 중...');
    const result = await window.csAsk.saveDriveToken(authCode);
    console.log('[renderer.js] Token 저장 결과:', result);

    if (result.success) {
      showDriveAuthMessage('✅ Google Drive 연결 완료!', 'success');

      // 연결 상태 업데이트
      console.log('[renderer.js] 연결 상태 갱신 시작...');
      const newStatus = await checkDriveConnection();
      console.log('[renderer.js] 갱신된 연결 상태:', newStatus);

      await updateDriveOnboardingBanner();
      await updateDriveConnectionInSettings();
      console.log('[renderer.js] UI 업데이트 완료');

      // 2초 후 모달 닫기
      setTimeout(() => {
        closeDriveAuthModal();
      }, 2000);
    } else {
      throw new Error(result.error || 'Token 저장 실패');
    }
  } catch (error) {
    console.error('[renderer.js] 인증 코드 제출 실패:', error);
    showDriveAuthMessage(`❌ 오류: ${error.message}`, 'error');
  } finally {
    submitButton.disabled = false;
  }
}

/**
 * 온보딩 배너 이벤트 리스너
 */
const driveOnboardingConnectButton = document.getElementById('driveOnboardingConnectButton');
if (driveOnboardingConnectButton) {
  driveOnboardingConnectButton.addEventListener('click', () => {
    openDriveAuthModal();
    // 배너 숨기기
    const banner = document.getElementById('driveOnboardingBanner');
    if (banner) banner.style.display = 'none';
  });
}

const driveOnboardingLaterButton = document.getElementById('driveOnboardingLaterButton');
if (driveOnboardingLaterButton) {
  driveOnboardingLaterButton.addEventListener('click', () => {
    // localStorage에 저장
    localStorage.setItem('driveOnboardingDismissed', 'true');
    // 배너 숨기기
    const banner = document.getElementById('driveOnboardingBanner');
    if (banner) banner.style.display = 'none';
  });
}

/**
 * 설정 모달 Drive 연결 버튼 이벤트 리스너
 */
const connectDriveButton = document.getElementById('connectDriveButton');
if (connectDriveButton) {
  connectDriveButton.addEventListener('click', () => {
    openDriveAuthModal();
    // 설정 모달 닫기
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.style.display = 'none';
  });
}

const reconnectDriveButton = document.getElementById('reconnectDriveButton');
if (reconnectDriveButton) {
  reconnectDriveButton.addEventListener('click', () => {
    openDriveAuthModal();
    // 설정 모달 닫기
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.style.display = 'none';
  });
}

/**
 * Drive 인증 모달 이벤트 리스너
 */
const closeDriveAuthButton = document.getElementById('closeDriveAuthButton');
if (closeDriveAuthButton) {
  closeDriveAuthButton.addEventListener('click', closeDriveAuthModal);
}

// Credentials 선택 버튼 제거됨 (앱 내부에 포함)

const openGoogleAuthButton = document.getElementById('openGoogleAuthButton');
if (openGoogleAuthButton) {
  openGoogleAuthButton.addEventListener('click', openGoogleAuthPage);
}

const submitAuthCodeButton = document.getElementById('submitAuthCodeButton');
if (submitAuthCodeButton) {
  submitAuthCodeButton.addEventListener('click', submitAuthCode);
}

// Auth code input에서 엔터키 처리
const authCodeInput = document.getElementById('authCodeInput');
if (authCodeInput) {
  authCodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      submitAuthCode();
    }
  });
}

// 모달 오버레이 클릭 시 닫기
const driveAuthModalOverlay = document.querySelector('.drive-auth-modal-overlay');
if (driveAuthModalOverlay) {
  driveAuthModalOverlay.addEventListener('click', closeDriveAuthModal);
}

/**
 * 설정 모달 열 때 Drive 연결 상태 업데이트
 */
const originalSettingsButtonClick = document.getElementById('settingsButton');
if (originalSettingsButtonClick) {
  originalSettingsButtonClick.addEventListener('click', async () => {
    // 기존 설정 로드 후 Drive 연결 상태 업데이트
    setTimeout(async () => {
      await updateDriveConnectionInSettings();
    }, 100);
  });
}

/**
 * 앱 로드 시 Drive 온보딩 배너 확인
 */
document.addEventListener('DOMContentLoaded', async () => {
  runLeakCleanupRepeatedly();

  // 약간의 지연 후 배너 표시 (인덱스 확인 후)
  setTimeout(async () => {
    runLeakCleanupRepeatedly();
    await updateDriveOnboardingBanner();
  }, 1000);
});

/**
 * ========================================
 * 회의 기록 기능
 * ========================================
 */

// 전역 변수
let selectedMeetingFile = null;
let meetingFiles = [];

// DOM 요소
const meetingLogArea = document.getElementById('meetingLogArea');
const loadMeetingFilesButton = document.getElementById('loadMeetingFilesButton');
const meetingFilesList = document.getElementById('meetingFilesList');
const filePreviewSection = document.getElementById('filePreviewSection');
const filePreview = document.getElementById('filePreview');
const recordTypeSection = document.getElementById('recordTypeSection');
const inputFormSection = document.getElementById('inputFormSection');
const workProgressForm = document.getElementById('workProgressForm');
const meetingMinutesForm = document.getElementById('meetingMinutesForm');
const saveMeetingLogButton = document.getElementById('saveMeetingLogButton');
const saveMessage = document.getElementById('saveMessage');

// 스프레드시트 버튼
const openSpreadsheetButton = document.getElementById('openSpreadsheetButton');
const openWorkProgressButton = document.getElementById('openWorkProgressButton');
const openMeetingMinutesButton = document.getElementById('openMeetingMinutesButton');

// 스프레드시트 버튼 클릭 이벤트
if (openSpreadsheetButton) {
  openSpreadsheetButton.addEventListener('click', async () => {
    // 회의 기록 영역 토글
    if (meetingLogArea.style.display === 'none') {
      meetingLogArea.style.display = 'block';
    } else {
      meetingLogArea.style.display = 'none';
    }
  });
}

if (openWorkProgressButton) {
  openWorkProgressButton.addEventListener('click', async () => {
    const url = await window.csAsk.getSpreadsheetUrl('workProgress');
    if (url) {
      await window.shell.openExternal(url);
    } else {
      alert('스프레드시트 URL을 찾을 수 없습니다.');
    }
  });
}

if (openMeetingMinutesButton) {
  openMeetingMinutesButton.addEventListener('click', async () => {
    const url = await window.csAsk.getSpreadsheetUrl('meetingMinutes');
    if (url) {
      await window.shell.openExternal(url);
    } else {
      alert('스프레드시트 URL을 찾을 수 없습니다.');
    }
  });
}

// 파일 목록 불러오기
if (loadMeetingFilesButton) {
  loadMeetingFilesButton.addEventListener('click', async () => {
    try {
      const files = await window.csAsk.loadMeetingFiles();
      meetingFiles = files;
      renderMeetingFilesList(files);
    } catch (error) {
      console.error('[renderer.js] 파일 불러오기 실패:', error);
      alert(`파일 불러오기 실패: ${error.message}`);
    }
  });
}

// 파일 목록 렌더링
function renderMeetingFilesList(files) {
  if (!files || files.length === 0) {
    meetingFilesList.innerHTML = '<p style="padding: 20px; text-align: center; color: #999;">파일이 없습니다.</p>';
    return;
  }

  meetingFilesList.innerHTML = files.map((file, index) => `
    <div class="meeting-file-item" data-index="${index}">
      <span class="file-name">${escapeHtml(file.name)}</span>
      <span class="file-size">${formatFileSize(file.size)}</span>
    </div>
  `).join('');

  // 파일 선택 이벤트
  meetingFilesList.querySelectorAll('.meeting-file-item').forEach(item => {
    item.addEventListener('click', async () => {
      const index = parseInt(item.getAttribute('data-index'));
      await selectMeetingFile(index);
    });
  });
}

// 파일 크기 포맷
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// 파일 선택
async function selectMeetingFile(index) {
  try {
    const file = meetingFiles[index];
    selectedMeetingFile = file;

    // 선택 상태 UI 업데이트
    meetingFilesList.querySelectorAll('.meeting-file-item').forEach((item, i) => {
      if (i === index) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });

    // 파일 내용 로드
    const content = await window.csAsk.readMeetingFile(file.path);

    // 미리보기 표시
    filePreview.textContent = content.substring(0, 1000) + (content.length > 1000 ? '\n\n... (이하 생략)' : '');
    filePreviewSection.style.display = 'block';

    // 다음 단계 표시
    recordTypeSection.style.display = 'block';
    inputFormSection.style.display = 'block';

    // 현재 선택된 타입에 맞는 폼 표시
    updateFormDisplay();
  } catch (error) {
    console.error('[renderer.js] 파일 읽기 실패:', error);
    alert(`파일 읽기 실패: ${error.message}`);
  }
}

// 타입 선택 변경 이벤트
const recordTypeRadios = document.querySelectorAll('input[name="recordType"]');
recordTypeRadios.forEach(radio => {
  radio.addEventListener('change', updateFormDisplay);
});

// 폼 표시 업데이트
function updateFormDisplay() {
  const selectedType = document.querySelector('input[name="recordType"]:checked').value;

  if (selectedType === 'workProgress') {
    workProgressForm.style.display = 'block';
    meetingMinutesForm.style.display = 'none';
  } else {
    workProgressForm.style.display = 'none';
    meetingMinutesForm.style.display = 'block';
  }
}

// 저장 버튼
if (saveMeetingLogButton) {
  saveMeetingLogButton.addEventListener('click', async () => {
    try {
      if (!selectedMeetingFile) {
        alert('파일을 먼저 선택해주세요.');
        return;
      }

      const selectedType = document.querySelector('input[name="recordType"]:checked').value;
      let data = {};

      if (selectedType === 'workProgress') {
        data = {
          type: 'workProgress',
          filePath: selectedMeetingFile.path,
          dateTime: document.getElementById('wpDateTime').value,
          projectName: document.getElementById('wpProjectName').value,
          progress: document.getElementById('wpProgress').value,
          planned: document.getElementById('wpPlanned').value
        };

        // 필수 필드 검증
        if (!data.dateTime || !data.projectName) {
          alert('회의일시, 프로젝트명은 필수 입력 항목입니다.');
          return;
        }
      } else {
        data = {
          type: 'meetingMinutes',
          filePath: selectedMeetingFile.path,
          dateTime: document.getElementById('mmDateTime').value,
          keyDiscussion: document.getElementById('mmKeyDiscussion').value,
          decisions: document.getElementById('mmDecisions').value,
          todos: document.getElementById('mmTodos').value
        };

        // 필수 필드 검증
        if (!data.dateTime) {
          alert('회의일시는 필수 입력 항목입니다.');
          return;
        }
      }

      // 저장 시작
      saveMeetingLogButton.disabled = true;
      saveMessage.style.display = 'block';
      saveMessage.className = 'save-message info';
      saveMessage.textContent = '⏳ 저장 중... (구글 드라이브 업로드 + 스프레드시트 기록)';

      const result = await window.csAsk.saveMeetingLog(data);

      if (result.success) {
        saveMessage.className = 'save-message success';
        saveMessage.textContent = `✅ 저장 완료!\n드라이브 링크: ${result.driveLink}\n스프레드시트에 기록되었습니다.`;

        // 폼 초기화
        setTimeout(() => {
          resetMeetingForm();
        }, 3000);
      } else {
        throw new Error(result.error || '저장 실패');
      }
    } catch (error) {
      console.error('[renderer.js] 저장 실패:', error);
      saveMessage.className = 'save-message error';
      saveMessage.textContent = `❌ 오류: ${error.message}`;
    } finally {
      saveMeetingLogButton.disabled = false;
    }
  });
}

// 폼 초기화
function resetMeetingForm() {
  // 파일 선택 초기화
  selectedMeetingFile = null;
  meetingFilesList.querySelectorAll('.meeting-file-item').forEach(item => {
    item.classList.remove('selected');
  });

  // 미리보기 숨기기
  filePreviewSection.style.display = 'none';
  recordTypeSection.style.display = 'none';
  inputFormSection.style.display = 'none';

  // 입력 필드 초기화
  document.getElementById('wpDateTime').value = '';
  document.getElementById('wpProjectName').value = '';
  document.getElementById('wpProgress').value = '';
  document.getElementById('wpPlanned').value = '';
  document.getElementById('mmDateTime').value = '';
  document.getElementById('mmKeyDiscussion').value = '';
  document.getElementById('mmDecisions').value = '';
  document.getElementById('mmTodos').value = '';

  // 메시지 숨기기
  saveMessage.style.display = 'none';
}
