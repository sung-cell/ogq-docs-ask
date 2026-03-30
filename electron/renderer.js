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
    setupIndexCreateButton();
  } else {
    // 인덱스가 없으면 초기 설정 표시
    showInitialSetup(true);
    setupInitialSetupListeners();
    await loadSavedSetup();
    resultContent.innerHTML = getWelcomeHTML(indexStatus);
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
  settingsModal.style.display = 'flex';
  loadSettingsData();
}

function closeSettings() {
  settingsModal.style.display = 'none';
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
