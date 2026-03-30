/**
 * Electron Preload Script
 * Renderer와 Main 프로세스 간 안전한 브릿지 제공
 */

const { contextBridge, ipcRenderer, app } = require('electron');

// 패키징 모드 확인
let isPackaged = false;
try {
  const { app: electronApp } = require('@electron/remote');
  isPackaged = electronApp ? electronApp.isPackaged : false;
} catch (e) {
  // remote 없으면 process.env로 판단
  isPackaged = !process.env.NODE_ENV || process.env.NODE_ENV === 'production';
}

/**
 * Renderer에서 사용할 수 있는 안전한 API 노출
 */
contextBridge.exposeInMainWorld('csAsk', {
  /**
   * 패키징 모드 여부
   */
  isPackaged: isPackaged,
  /**
   * 질문 실행
   * @param {string} question - 사용자 질문
   * @returns {Promise<{success: boolean, html: string, output: string}>}
   */
  ask: async (question) => {
    try {
      const result = await ipcRenderer.invoke('ask-question', question);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        html: null
      };
    }
  },

  /**
   * 인덱스 상태 확인
   * @returns {Promise<{hasIndex: boolean, documentCount: number, lastIndexed: string|null}>}
   */
  checkIndexStatus: async () => {
    try {
      return await ipcRenderer.invoke('check-index-status');
    } catch (error) {
      return {
        hasIndex: false,
        documentCount: 0,
        lastIndexed: null
      };
    }
  },

  /**
   * reindex 실행
   * @returns {Promise<{success: boolean, output: string}>}
   */
  runReindex: async () => {
    try {
      return await ipcRenderer.invoke('run-reindex');
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  },

  /**
   * 자동 인덱싱 상태 리스너 등록
   * @param {Function} callback - 상태 업데이트 콜백
   */
  onAutoIndexStatus: (callback) => {
    ipcRenderer.on('auto-index-status', (event, status) => {
      callback(status);
    });
  },

  /**
   * 초기 설정 가져오기
   * @returns {Promise<{documentsRoot: string, watchDownloads: boolean, watchGoogleDrive: boolean}|null>}
   */
  getSetupConfig: async () => {
    try {
      return await ipcRenderer.invoke('get-setup-config');
    } catch (error) {
      return null;
    }
  },

  /**
   * 문서 루트 폴더 선택
   * @returns {Promise<string|null>}
   */
  chooseDocumentsRoot: async () => {
    try {
      return await ipcRenderer.invoke('choose-documents-root');
    } catch (error) {
      return null;
    }
  },

  /**
   * 초기 설정 저장
   * @param {object} config - 설정 객체
   * @returns {Promise<{success: boolean}>}
   */
  saveSetupConfig: async (config) => {
    try {
      return await ipcRenderer.invoke('save-setup-config', config);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
});

// 외부 링크 처리를 위한 shell API 노출 (IPC를 통해 main 프로세스에서 처리)
contextBridge.exposeInMainWorld('shell', {
  openExternal: async (url) => {
    try {
      return await ipcRenderer.invoke('open-external-url', url);
    } catch (error) {
      console.error('[preload.js] openExternal 실패:', error);
      return { success: false, error: error.message };
    }
  }
});
