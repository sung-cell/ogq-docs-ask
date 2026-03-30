/**
 * Electron Main Process
 * 단일 창 애플리케이션 진입점
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const { getDocumentsIndexPath, getContractsMetaPath, ensureDirectories } = require('../src/config/runtimePaths.cjs');

let mainWindow;
let autoIndexScheduler = null;

/**
 * 시스템 Node 실행파일 찾기
 * @returns {string|null} Node 실행파일 경로 또는 null
 */
function findSystemNode() {
  try {
    // macOS/Linux에서 which 명령 사용
    const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
    if (nodePath && fs.existsSync(nodePath)) {
      console.log('[main.js] 시스템 Node 발견:', nodePath);
      return nodePath;
    }
  } catch (err) {
    // which 명령 실패 시 일반적인 경로 시도
  }

  // 일반적인 macOS Node 설치 경로들
  const commonPaths = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    path.join(os.homedir(), '.nvm/versions/node/*/bin/node'),
    '/opt/local/bin/node'
  ];

  for (const nodePath of commonPaths) {
    if (fs.existsSync(nodePath)) {
      console.log('[main.js] 시스템 Node 발견:', nodePath);
      return nodePath;
    }
  }

  console.error('[main.js] 시스템 Node를 찾을 수 없습니다');
  return null;
}

/**
 * setup-config.json 로드
 * @returns {object|null} 설정 객체 또는 null
 */
function loadSetupConfig() {
  try {
    const configPath = path.join(app.getPath('userData'), 'setup-config.json');
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(configData);
    }
  } catch (err) {
    console.error('[main.js] setup-config.json 로드 실패:', err);
  }
  return null;
}

function normalizeConfiguredRoots(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(v => String(v || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split('\n').map(v => v.trim()).filter(Boolean);
  }
  return [];
}

function getConfiguredIndexRoots(settings = {}) {
  return normalizeConfiguredRoots(
    settings.indexRoots ||
    settings.documentsRoots ||
    settings.documentRoots ||
    settings.scanRoots ||
    settings.watchFolders ||
    settings.folders ||
    settings.documentsRoot
  );
}

/**
 * 설정에서 환경 변수 빌드
 * @returns {object} 환경 변수 객체
 */
function buildEnvFromSetupConfig() {
  const env = {
    ...process.env,
    CS_ASK_PACKAGED: app.isPackaged ? 'true' : 'false'
  };

  const config = loadSetupConfig();
  if (!config) return env;

  // 문서 루트 경로 (다중 폴더 지원)
  const configuredRoots = getConfiguredIndexRoots(config);
  if (configuredRoots.length > 0) {
    env.OGQ_DOCS_ASK_DOCUMENTS_ROOTS = JSON.stringify(configuredRoots);
  }

  // Downloads 감시 여부
  if (typeof config.watchDownloads === 'boolean') {
    env.OGQ_DOCS_ASK_WATCH_DOWNLOADS = config.watchDownloads ? 'true' : 'false';
  }

  // Google Drive 감시 여부
  if (typeof config.watchGoogleDrive === 'boolean') {
    env.OGQ_DOCS_ASK_WATCH_GOOGLE_DRIVE = config.watchGoogleDrive ? 'true' : 'false';
  }

  return env;
}

/**
 * 앱 시작 시 손상된 인덱스 자동 복구
 */
async function maybeRepairBrokenIndexOnStartup() {
  try {
    const setupConfig = loadSetupConfig();
    if (!setupConfig) {
      console.log('[main.js] startup repair: setup-config 없음 - 건너뜀');
      return;
    }

    const roots = getConfiguredIndexRoots(setupConfig);

    if (roots.length === 0) {
      console.log('[main.js] startup repair: 문서 루트 없음 - 건너뜀');
      return;
    }

    // /Documents 포함 여부 확인
    const hasDocumentsPath = roots.some(root => root && root.includes('/Documents'));
    if (!hasDocumentsPath) {
      console.log('[main.js] startup repair: /Documents 경로 없음 - 건너뜀');
      return;
    }

    // 현재 인덱스 파일 확인
    const indexPath = getDocumentsIndexPath();
    if (!fs.existsSync(indexPath)) {
      console.log('[main.js] startup repair: 인덱스 파일 없음 - 자동 생성됨');
      return;
    }

    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const totalDocuments = indexData.documents?.length || 0;

    // tiny index 감지 (20개 이하)
    if (totalDocuments <= 20) {
      console.log(`[main.js] startup repair triggered - tiny index detected (${totalDocuments}) with roots: ${roots.join(', ')}`);

      // 환경변수 설정
      const env = buildEnvFromSetupConfig();

      // Node 경로 찾기
      const nodeExecutable = findSystemNode();
      if (!nodeExecutable) {
        console.error('[main.js] startup repair: Node 실행 파일 없음 - 건너뜀');
        return;
      }

      // 인덱스 경로 결정
      let indexScriptPath;
      if (app.isPackaged) {
        indexScriptPath = path.join(process.resourcesPath, 'cli', 'index.js');
      } else {
        indexScriptPath = path.join(__dirname, '..', 'index.js');
      }

      // packaged 모드일 때 NODE_PATH 설정
      if (app.isPackaged) {
        const cliNodeModules = path.join(process.resourcesPath, 'cli', 'node_modules');
        env.NODE_PATH = cliNodeModules;
        console.log('[main.js] startup repair: NODE_PATH 설정:', cliNodeModules);
      }

      console.log('[main.js] startup repair: reindex 실행 중...');

      // reindex 실행 (동기식으로 대기)
      const escapedNodePath = JSON.stringify(nodeExecutable);
      const escapedIndexScriptPath = JSON.stringify(indexScriptPath);
      const escapedRoots = roots.map(root => JSON.stringify(root)).join(' ');
      const repairCommand = `${escapedNodePath} ${escapedIndexScriptPath} reindex ${escapedRoots}`;

      execSync(repairCommand, {
        env: env,
        stdio: 'inherit',
        cwd: app.isPackaged ? app.getPath('userData') : path.join(__dirname, '..')
      });

      console.log('[main.js] startup repair: 복구 완료');
    } else {
      console.log(`[main.js] startup repair: 인덱스 정상 (${totalDocuments}개) - 건너뜀`);
    }
  } catch (err) {
    console.error('[main.js] startup repair 실패:', err.message);
  }
}

// 창 상태 저장 경로
const WINDOW_STATE_PATH = path.join(app.getPath('userData'), 'window-state.json');

/**
 * 창 상태 로드
 */
function loadWindowState() {
  try {
    if (fs.existsSync(WINDOW_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf-8'));
    }
  } catch (err) {
    console.error('[main.js] 창 상태 로드 실패:', err);
  }
  return {
    width: 1100,
    height: 800,
    x: undefined,
    y: undefined
  };
}

/**
 * 창 상태 저장
 */
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    const state = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y
    };

    fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[main.js] 창 상태 저장 실패:', err);
  }
}

/**
 * 메인 창 생성
 */
function createWindow() {
  // 저장된 창 상태 로드
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    titleBarStyle: 'default',
    title: 'OGQ Docs Ask'
  });

  // 창 이동/리사이즈 시 상태 저장
  mainWindow.on('resize', saveWindowState);
  mainWindow.on('move', saveWindowState);

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 개발 중 DevTools 열기
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    saveWindowState();
    mainWindow = null;
  });
}

/**
 * 질문 실행 핸들러
 */
ipcMain.handle('ask-question', async (event, question) => {
  // 빈 질문은 무시
  if (!question || question.trim() === '') {
    return {
      success: false,
      error: '질문을 입력해주세요.',
      html: null
    };
  }

  // 질문 실행 중임을 스케줄러에 알림
  if (autoIndexScheduler) {
    autoIndexScheduler.setQuestionRunning(true);
  }

  return new Promise((resolve, reject) => {
    // 패키징된 앱과 개발 모드 모두 지원
    let workingDir, indexPath;

    console.log('[main.js] ========== ask-question 디버그 ==========');
    console.log('[main.js] app.isPackaged:', app.isPackaged);
    console.log('[main.js] app.getAppPath():', app.getAppPath());
    console.log('[main.js] __dirname:', __dirname);
    console.log('[main.js] process.resourcesPath:', process.resourcesPath);

    if (app.isPackaged) {
      // 패키징된 앱: extraResources의 CLI 사용
      workingDir = app.getPath('userData');
      indexPath = path.join(process.resourcesPath, 'cli', 'index.js');

      console.log('[main.js] [PACKAGED MODE]');
      console.log('[main.js] workingDir:', workingDir);
      console.log('[main.js] indexPath:', indexPath);
      console.log('[main.js] indexPath exists:', fs.existsSync(indexPath));

      // cli/src 디렉토리 확인
      const cliSrcPath = path.join(process.resourcesPath, 'cli', 'src');
      console.log('[main.js] cliSrcPath:', cliSrcPath);
      console.log('[main.js] cliSrcPath exists:', fs.existsSync(cliSrcPath));

      // process.resourcesPath 내용 확인
      try {
        const resourcesContent = fs.readdirSync(process.resourcesPath);
        console.log('[main.js] process.resourcesPath contents:', resourcesContent);

        const cliPath = path.join(process.resourcesPath, 'cli');
        if (fs.existsSync(cliPath)) {
          const cliContent = fs.readdirSync(cliPath);
          console.log('[main.js] cli/ contents:', cliContent);
        }
      } catch (err) {
        console.error('[main.js] resourcesPath 읽기 실패:', err);
      }
    } else {
      // 개발 모드
      const projectRoot = path.join(__dirname, '..');
      workingDir = projectRoot;
      indexPath = path.join(projectRoot, 'index.js');

      console.log('[main.js] [DEV MODE]');
      console.log('[main.js] workingDir:', workingDir);
      console.log('[main.js] indexPath:', indexPath);
      console.log('[main.js] indexPath exists:', fs.existsSync(indexPath));
    }

    const outputPath = path.join(os.tmpdir(), `cs-ask-${Date.now()}.html`);

    // 시스템 Node 실행파일 찾기
    const nodeExecutable = findSystemNode();
    if (!nodeExecutable) {
      const errorMsg = 'Node.js 실행 파일을 찾을 수 없습니다.\n\nNode.js가 설치되어 있는지 확인해주세요.\n터미널에서 "which node" 명령으로 경로를 확인할 수 있습니다.';
      console.error('[main.js]', errorMsg);
      reject(new Error(errorMsg));
      return;
    }

    // 환경 변수 설정 (설정 파일에서 로드)
    const env = buildEnvFromSetupConfig();

    // packaged 모드일 때 NODE_PATH 설정 (cli/node_modules 참조)
    if (app.isPackaged) {
      const cliNodeModules = path.join(process.resourcesPath, 'cli', 'node_modules');
      env.NODE_PATH = cliNodeModules;
      console.log('[main.js] NODE_PATH 설정:', cliNodeModules);
      console.log('[main.js] NODE_PATH exists:', fs.existsSync(cliNodeModules));
    }

    console.log('[main.js] Node 실행 파일:', nodeExecutable);
    console.log('[main.js] 실행 명령:', [indexPath, 'ask-html', question, '--output', outputPath].join(' '));
    console.log('[main.js] cwd:', workingDir);
    console.log('[main.js] env.NODE_PATH:', env.NODE_PATH);
    console.log('[main.js] 전체 명령:', `${nodeExecutable} ${indexPath} ask-html "${question}" --output ${outputPath}`);

    // index.js가 ES module이므로 실행 가능한지 확인
    console.log('[main.js] ========== 실행 전 최종 검증 ==========');
    console.log('[main.js] indexPath:', indexPath);
    console.log('[main.js] indexPath exists:', fs.existsSync(indexPath));
    console.log('[main.js] nodeExecutable exists:', fs.existsSync(nodeExecutable));
    console.log('[main.js] workingDir exists:', fs.existsSync(workingDir));

    const nodeProcess = spawn(nodeExecutable, [
      indexPath,
      'ask-html',
      question,
      '--output',
      outputPath
    ], {
      cwd: workingDir,
      shell: false,
      env: env
    });

    let stdout = '';
    let stderr = '';

    nodeProcess.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      console.log('[main.js] [stdout]', chunk);
    });

    nodeProcess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      console.error('[main.js] [stderr]', chunk);
    });

    nodeProcess.on('close', (code) => {
      console.log('[main.js] ========== 프로세스 종료 ==========');
      console.log('[main.js] exit code:', code);
      console.log('[main.js] stdout length:', stdout.length);
      console.log('[main.js] stderr length:', stderr.length);

      // 질문 실행 완료를 스케줄러에 알림
      if (autoIndexScheduler) {
        autoIndexScheduler.setQuestionRunning(false);
      }

      // HTML 파일이 생성되었으면 성공으로 처리 (code !== 0이어도)
      // events_master.xlsx 없어도 계약/문서 질문은 정상 처리되어야 함
      try {
        if (fs.existsSync(outputPath)) {
          const htmlContent = fs.readFileSync(outputPath, 'utf-8');

          // 임시 파일 정리
          try {
            fs.unlinkSync(outputPath);
          } catch (e) {
            // 정리 실패는 무시
          }

          resolve({
            success: true,
            html: htmlContent,
            output: stdout
          });
        } else {
          // HTML 파일이 없고 프로세스가 실패했을 때만 에러
          console.error('[main.js] ========== 실행 실패 상세 ==========');
          console.error('[main.js] HTML 파일이 생성되지 않음:', outputPath);
          console.error('[main.js] app.isPackaged:', app.isPackaged);
          console.error('[main.js] nodeExecutable:', nodeExecutable);
          console.error('[main.js] indexPath:', indexPath);
          console.error('[main.js] indexPath exists:', fs.existsSync(indexPath));
          console.error('[main.js] cwd:', workingDir);
          console.error('[main.js] NODE_PATH:', env.NODE_PATH);
          console.error('[main.js] 종료 코드:', code);
          console.error('[main.js] stderr 전체:\n', stderr);
          console.error('[main.js] stdout 전체:\n', stdout);

          let errorMsg;
          const indexExists = fs.existsSync(indexPath);

          if (!indexExists) {
            // 파일이 진짜 없음
            errorMsg = `질문 처리 파일을 찾을 수 없습니다.\n\n경로: ${indexPath}\n\n앱을 다시 설치해주세요.`;
          } else if (stderr.includes('MODULE_NOT_FOUND') || stderr.includes('Cannot find module')) {
            // 파일은 있지만 의존성 모듈 없음
            const moduleMatch = stderr.match(/Cannot find module '([^']+)'/);
            const missingModule = moduleMatch ? moduleMatch[1] : '알 수 없음';
            errorMsg = `필요한 모듈을 찾을 수 없습니다.\n\n누락된 모듈: ${missingModule}\n파일 경로: ${indexPath}\nNODE_PATH: ${env.NODE_PATH || '설정 안 됨'}\n\n앱을 다시 설치해주세요.\n\n상세 오류:\n${stderr.substring(0, 500)}`;
          } else if (stderr.includes('SyntaxError') || stderr.includes('import')) {
            // ES module 또는 문법 오류
            errorMsg = `질문 처리 파일 실행 중 문법 오류가 발생했습니다.\n\n파일: ${indexPath}\n종료 코드: ${code}\n\nES Module 지원 확인이 필요합니다.\n\n상세 오류:\n${stderr.substring(0, 500)}`;
          } else if (code !== 0) {
            // 일반 실행 오류
            errorMsg = `질문 처리 실행 실패 (종료 코드: ${code})\n\n파일: ${indexPath}\ncwd: ${workingDir}\nNODE_PATH: ${env.NODE_PATH || '설정 안 됨'}\n\n상세 오류:\n${stderr.substring(0, 500)}`;
          } else {
            // 종료 코드는 0인데 결과 파일 없음
            errorMsg = `결과 파일이 생성되지 않았습니다.\n\n예상 경로: ${outputPath}\n질문 처리 파일: ${indexPath}\n\n상세:\n${stderr.substring(0, 500)}`;
          }

          reject(new Error(errorMsg));
        }
      } catch (err) {
        console.error('[main.js] HTML 파일 읽기 실패:', err);
        reject(err);
      }
    });

    nodeProcess.on('error', (err) => {
      // 질문 실행 실패를 스케줄러에 알림
      if (autoIndexScheduler) {
        autoIndexScheduler.setQuestionRunning(false);
      }

      console.error('[main.js] ========== spawn 오류 ==========');
      console.error('[main.js] 오류 타입:', err.name);
      console.error('[main.js] 오류 메시지:', err.message);
      console.error('[main.js] 오류 코드:', err.code);
      console.error('[main.js] 전체 오류:', err);
      console.error('[main.js] nodeExecutable:', nodeExecutable);
      console.error('[main.js] indexPath:', indexPath);
      console.error('[main.js] cwd:', workingDir);

      let errorMsg;
      if (err.code === 'ENOENT') {
        if (!fs.existsSync(nodeExecutable)) {
          errorMsg = `Node.js 실행 파일을 찾을 수 없습니다.\n\n경로: ${nodeExecutable}\n\nNode.js를 설치하거나 경로를 확인해주세요.`;
        } else if (!fs.existsSync(indexPath)) {
          errorMsg = `질문 처리 파일을 찾을 수 없습니다.\n\n경로: ${indexPath}\n\n앱을 다시 설치해주세요.`;
        } else {
          errorMsg = `프로세스 실행 실패 (ENOENT)\n\nNode: ${nodeExecutable}\n스크립트: ${indexPath}\n\n파일은 존재하지만 실행할 수 없습니다.`;
        }
      } else {
        errorMsg = `프로세스 시작 실패\n\n오류: ${err.message}\n코드: ${err.code || '없음'}\nNode: ${nodeExecutable}\n스크립트: ${indexPath}`;
      }

      reject(new Error(errorMsg));
    });
  });
});

/**
 * 인덱스 상태 확인 핸들러
 */
ipcMain.handle('check-index-status', async () => {
  try {
    const documentsPath = getDocumentsIndexPath();
    const contractsMetaPath = getContractsMetaPath();

    const hasDocuments = fs.existsSync(documentsPath);
    const hasContractsMeta = fs.existsSync(contractsMetaPath);

    let documentCount = 0;
    let lastIndexed = null;

    if (hasDocuments) {
      try {
        const indexData = JSON.parse(fs.readFileSync(documentsPath, 'utf-8'));
        // totalDocuments 필드 우선 사용, 없으면 documents 배열 길이
        documentCount = indexData.totalDocuments || (indexData.documents ? indexData.documents.length : 0);
        lastIndexed = indexData.indexedAt || indexData.timestamp || null;
      } catch (err) {
        console.error('[main.js] ❌ 인덱스 파일 읽기 실패:', err);
      }
    }

    const result = {
      hasIndex: hasDocuments && hasContractsMeta,
      documentCount,
      lastIndexed
    };

    return result;
  } catch (err) {
    console.error('[main.js] 인덱스 상태 확인 실패:', err);
    return {
      hasIndex: false,
      documentCount: 0,
      lastIndexed: null
    };
  }
});

/**
 * reindex 실행 핸들러
 */
ipcMain.handle('run-reindex', async () => {
  return new Promise((resolve, reject) => {
    // 패키징된 앱과 개발 모드 모두 지원
    let workingDir, indexPath;

    if (app.isPackaged) {
      // 패키징된 앱: extraResources의 CLI 사용
      workingDir = app.getPath('userData');
      indexPath = path.join(process.resourcesPath, 'cli', 'index.js');
    } else {
      // 개발 모드
      const projectRoot = path.join(__dirname, '..');
      workingDir = projectRoot;
      indexPath = path.join(projectRoot, 'index.js');
    }

    console.log('[main.js] ========== reindex 실행 시작 ==========');
    console.log('[main.js] isPackaged:', app.isPackaged);
    console.log('[main.js] 작업 디렉토리 (cwd):', workingDir);
    console.log('[main.js] CLI 경로:', indexPath);
    console.log('[main.js] CLI 파일 존재:', fs.existsSync(indexPath));
    console.log('[main.js] cwd 존재:', fs.existsSync(workingDir));
    console.log('[main.js] cwd 디렉토리:', fs.existsSync(workingDir) && fs.statSync(workingDir).isDirectory());

    // 시스템 Node 실행파일 찾기
    const nodeExecutable = findSystemNode();
    if (!nodeExecutable) {
      const errorMsg = 'Node.js 실행 파일을 찾을 수 없습니다.\n\nNode.js가 설치되어 있는지 확인해주세요.\n터미널에서 "which node" 명령으로 경로를 확인할 수 있습니다.';
      console.error('[main.js]', errorMsg);
      reject(new Error(errorMsg));
      return;
    }

    // 환경 변수 설정 (설정 파일에서 로드)
    const env = buildEnvFromSetupConfig();

    // packaged 모드일 때 NODE_PATH 설정 (cli/node_modules 참조)
    if (app.isPackaged) {
      const cliNodeModules = path.join(process.resourcesPath, 'cli', 'node_modules');
      env.NODE_PATH = cliNodeModules;
      console.log('[main.js] NODE_PATH 설정:', cliNodeModules);
      console.log('[main.js] NODE_PATH exists:', fs.existsSync(cliNodeModules));
    }

    console.log('[main.js] Node 실행 파일:', nodeExecutable);
    console.log('[main.js] 실행 명령:', [indexPath, 'reindex'].join(' '));

    const nodeProcess = spawn(nodeExecutable, [indexPath, 'reindex'], {
      cwd: workingDir,
      shell: false,
      env: env
    });

    let stdout = '';
    let stderr = '';

    nodeProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('[main.js] reindex output:', data.toString());
    });

    nodeProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      stderr += msg;
      console.error('[main.js] reindex stderr:', msg);
    });

    nodeProcess.on('close', (code) => {
      console.log('[main.js] ========== reindex 종료 ==========');
      console.log('[main.js] 종료 코드:', code);
      console.log('[main.js] stdout 길이:', stdout.length);
      console.log('[main.js] stderr 길이:', stderr.length);
      if (stderr) {
        console.error('[main.js] stderr 내용:', stderr);
      }

      if (code !== 0) {
        let errorMsg;
        if (stderr.includes('MODULE_NOT_FOUND')) {
          errorMsg = '인덱싱 파일을 찾을 수 없습니다. 앱을 다시 설치해주세요.';
        } else if (stderr.includes('ENOENT')) {
          errorMsg = '필요한 파일이 없습니다. 계약 문서 폴더를 확인해주세요.';
        } else if (stderr.trim()) {
          // stderr가 있으면 실제 오류 메시지를 포함
          const errorLines = stderr.trim().split('\n');
          const errorLine = errorLines.find(line => line.includes('오류:') || line.includes('Error:')) || errorLines[errorLines.length - 1];
          errorMsg = `인덱싱 실패: ${errorLine.replace(/^오류:\s*/, '')}`;
        } else {
          errorMsg = `인덱싱 실패 (종료 코드: ${code})`;
        }
        console.error('[main.js] 에러:', errorMsg);
        reject(new Error(errorMsg));
        return;
      }

      // 인덱싱 완료 후 상태 확인
      console.log('[main.js] reindex 성공, 인덱스 상태 재확인 중...');

      try {
        const documentsPath = getDocumentsIndexPath();
        const contractsMetaPath = getContractsMetaPath();

        const hasDocuments = fs.existsSync(documentsPath);
        const hasContractsMeta = fs.existsSync(contractsMetaPath);

        let documentCount = 0;
        let lastIndexed = null;

        if (hasDocuments) {
          const indexData = JSON.parse(fs.readFileSync(documentsPath, 'utf-8'));
          // totalDocuments 필드 우선 사용, 없으면 documents 배열 길이
          documentCount = indexData.totalDocuments || (indexData.documents ? indexData.documents.length : 0);
          lastIndexed = indexData.indexedAt || indexData.timestamp || null;
        }

        console.log('[main.js] reindex 완료 후 - documents:', hasDocuments, ', count:', documentCount);
        console.log('[main.js] reindex 완료 후 - contracts-meta:', hasContractsMeta);

        resolve({
          success: true,
          output: stdout,
          indexStatus: {
            hasIndex: hasDocuments && hasContractsMeta,
            documentCount,
            lastIndexed
          }
        });
      } catch (err) {
        console.error('[main.js] reindex 완료 후 상태 확인 실패:', err);
        resolve({
          success: true,
          output: stdout
        });
      }
    });

    nodeProcess.on('error', (err) => {
      console.error('[main.js] ========== reindex 프로세스 오류 ==========');
      console.error('[main.js] 오류 타입:', err.name);
      console.error('[main.js] 오류 메시지:', err.message);
      console.error('[main.js] 오류 코드:', err.code);
      console.error('[main.js] 전체 오류:', err);

      let userMsg;
      if (err.code === 'ENOENT') {
        userMsg = 'Node.js를 찾을 수 없습니다. 앱을 다시 설치해주세요.';
      } else if (err.code === 'ENOTDIR') {
        userMsg = '앱 파일 구조에 문제가 있습니다. 앱을 다시 설치해주세요.';
      } else {
        userMsg = '인덱싱을 시작할 수 없습니다. 앱을 다시 시작해주세요.';
      }

      reject(new Error(userMsg));
    });
  });
});

/**
 * 초기 설정 가져오기
 */
ipcMain.handle('get-setup-config', async () => {
  try {
    const configPath = path.join(app.getPath('userData'), 'setup-config.json');

    if (!fs.existsSync(configPath)) {
      return null;
    }

    const configData = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(configData);
  } catch (err) {
    console.error('[main.js] 설정 파일 읽기 실패:', err);
    return null;
  }
});

/**
 * 문서 루트 폴더 선택
 */
ipcMain.handle('choose-documents-root', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: '문서 폴더 선택',
      message: '인덱싱할 문서가 있는 폴더를 선택하세요',
      properties: ['openDirectory'],
      buttonLabel: '선택'
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  } catch (err) {
    console.error('[main.js] 폴더 선택 실패:', err);
    return null;
  }
});

/**
 * 초기 설정 저장
 */
ipcMain.handle('save-setup-config', async (event, config) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'setup-config.json');

    // initializedAt 추가
    const configWithTimestamp = {
      ...config,
      initializedAt: new Date().toISOString()
    };

    fs.writeFileSync(configPath, JSON.stringify(configWithTimestamp, null, 2), 'utf-8');

    return { success: true };
  } catch (err) {
    console.error('[main.js] 설정 저장 실패:', err);
    return { success: false, error: err.message };
  }
});

/**
 * 외부 URL 열기 (Google Drive, 웹사이트 등)
 */
ipcMain.handle('open-external-url', async (event, url) => {
  try {
    // URL 유효성 검사
    if (!url || typeof url !== 'string') {
      console.error('[main.js] [openExternal] 잘못된 URL:', url);
      return { success: false, error: 'Invalid URL' };
    }

    const trimmedUrl = url.trim();

    // 허용된 스킴 확인
    const allowedSchemes = ['https://', 'http://', 'file://'];
    const isAllowed = allowedSchemes.some(scheme => trimmedUrl.startsWith(scheme));

    if (!isAllowed) {
      console.error('[main.js] [openExternal] 허용되지 않은 스킴:', trimmedUrl);
      return { success: false, error: 'URL scheme not allowed' };
    }

    // Google Drive native URL (gdrive://) 처리
    if (trimmedUrl.startsWith('gdrive://')) {
      console.warn('[main.js] [openExternal] gdrive:// URL은 지원하지 않습니다. webViewLink를 사용하세요:', trimmedUrl);
      return { success: false, error: 'gdrive:// URLs not supported. Use webViewLink instead.' };
    }

    console.log('[main.js] [openExternal] Opening URL in default browser:', trimmedUrl);

    // macOS 기본 브라우저에서 열기
    await shell.openExternal(trimmedUrl);

    return { success: true };
  } catch (err) {
    console.error('[main.js] [openExternal] 실패:', err);
    return { success: false, error: err.message };
  }
});

// 앱 준비 완료
app.whenReady().then(async () => {
  // 필요한 디렉토리 생성
  ensureDirectories();

  // 손상된 인덱스 자동 복구 (창 생성 전)
  await maybeRepairBrokenIndexOnStartup();

  createWindow();

  // 자동 인덱싱 스케줄러 시작
  try {
    const { getScheduler } = await import('../src/index/autoIndexScheduler.js');
    autoIndexScheduler = getScheduler();

    // 상태 콜백 등록
    autoIndexScheduler.setStatusCallback((status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auto-index-status', status);
      }
    });

    // 스케줄러 시작
    const setupConfig = loadSetupConfig() || {};
    const configuredRoots = getConfiguredIndexRoots(setupConfig);
    autoIndexScheduler.start({ roots: configuredRoots });
    console.log('[main.js] 자동 인덱싱 스케줄러 시작됨');
  } catch (err) {
    console.error('[main.js] 자동 인덱싱 스케줄러 시작 실패:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 모든 창이 닫히면 앱 종료 (macOS 제외)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS에서도 완전 종료
app.on('before-quit', () => {
  mainWindow = null;
});

// 예외 처리 - 앱이 크래시하지 않도록
process.on('uncaughtException', (error) => {
  console.error('[main.js] Uncaught Exception:', error);
  // 앱을 종료하지 않음
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[main.js] Unhandled Rejection at:', promise, 'reason:', reason);
  // 앱을 종료하지 않음
});
