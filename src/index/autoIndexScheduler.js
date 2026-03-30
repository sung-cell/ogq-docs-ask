/**
 * 자동 재인덱싱 스케줄러
 * 저부하 방식으로 주기적으로 인덱스 업데이트
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { buildIndex } from './indexBuilder.js';
import { createRequire } from 'module';

const execAsync = promisify(exec);
const require = createRequire(import.meta.url);
const { getDocumentsIndexPath, getSetupConfigPath } = require('../config/runtimePaths.cjs');

const CONFIG_PATH = join(process.cwd(), 'config', 'auto-index.config.json');
const INDEX_FILE = getDocumentsIndexPath();

/**
 * setup-config.json 로드
 * @returns {object|null} 설정 객체 또는 null
 */
function loadSavedSetupConfig() {
  try {
    const setupConfigPath = getSetupConfigPath();
    if (existsSync(setupConfigPath)) {
      const data = readFileSync(setupConfigPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[AutoIndex] setup-config.json 로드 실패:', err.message);
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
 * 자동 인덱싱 스케줄러 클래스
 */
export class AutoIndexScheduler {
  constructor() {
    this.config = this.loadConfig();
    this.isIndexing = false;
    this.isQuestionRunning = false;
    this.timer = null;
    this.statusCallback = null;
    this.lastIndexTime = null;
    this.documentCount = 0;
    this.configuredRoots = [];
  }

  /**
   * 설정 파일 로드
   */
  loadConfig() {
    try {
      if (existsSync(CONFIG_PATH)) {
        const data = readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('[AutoIndex] 설정 파일 로드 실패:', err.message);
    }

    // 기본 설정
    return {
      enabled: true,
      startupDelayMinutes: 3,
      checkIntervalMinutes: 60,
      reindexIfOlderThanHours: 6,
      skipWhenOnBattery: true,
      skipWhenQuestionRunning: true
    };
  }

  /**
   * 스케줄러 시작
   */
  start(options = {}) {
    if (!this.config.enabled) {
      console.log('[AutoIndex] 자동 인덱싱이 비활성화되어 있습니다.');
      return;
    }

    this.configuredRoots = normalizeConfiguredRoots(options.roots);

    console.log('[AutoIndex] 스케줄러 시작...');
    console.log(`[AutoIndex] ${this.config.startupDelayMinutes}분 후 첫 점검 예정`);

    // 초기 지연 후 첫 점검
    setTimeout(() => {
      this.checkAndReindex();

      // 주기적 점검 시작
      this.timer = setInterval(() => {
        this.checkAndReindex();
      }, this.config.checkIntervalMinutes * 60 * 1000);

    }, this.config.startupDelayMinutes * 60 * 1000);

    // 마지막 인덱싱 시간 로드
    this.updateLastIndexTime();
  }

  /**
   * 스케줄러 중지
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[AutoIndex] 스케줄러 중지됨');
    }
  }

  /**
   * 상태 콜백 등록
   */
  setStatusCallback(callback) {
    this.statusCallback = callback;
  }

  /**
   * 질문 실행 상태 업데이트
   */
  setQuestionRunning(isRunning) {
    this.isQuestionRunning = isRunning;
  }

  /**
   * 상태 전송
   */
  sendStatus(status) {
    if (this.statusCallback) {
      this.statusCallback({
        lastIndexTime: this.lastIndexTime,
        documentCount: this.documentCount,
        isIndexing: this.isIndexing,
        ...status
      });
    }
  }

  /**
   * 마지막 인덱싱 시간 업데이트
   */
  updateLastIndexTime() {
    try {
      if (existsSync(INDEX_FILE)) {
        const stats = statSync(INDEX_FILE);
        this.lastIndexTime = stats.mtime.toISOString();

        // 문서 수 로드
        const indexData = JSON.parse(readFileSync(INDEX_FILE, 'utf-8'));
        this.documentCount = indexData.documents?.length || 0;

        this.sendStatus({ status: 'idle' });
      }
    } catch (err) {
      console.error('[AutoIndex] 인덱스 파일 확인 실패:', err.message);
    }
  }

  /**
   * 인덱스가 오래되었는지 확인
   */
  isIndexOld() {
    if (!existsSync(INDEX_FILE)) {
      console.log('[AutoIndex] 인덱스 파일이 없음 - 재인덱싱 필요');
      return true;
    }

    try {
      const stats = statSync(INDEX_FILE);
      const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
      const threshold = this.config.reindexIfOlderThanHours;

      if (ageHours >= threshold) {
        console.log(`[AutoIndex] 인덱스가 ${ageHours.toFixed(1)}시간 경과 (기준: ${threshold}시간) - 재인덱싱 필요`);
        return true;
      }

      console.log(`[AutoIndex] 인덱스가 ${ageHours.toFixed(1)}시간 경과 - 재인덱싱 불필요`);
      return false;
    } catch (err) {
      console.error('[AutoIndex] 인덱스 파일 확인 실패:', err.message);
      return false;
    }
  }

  /**
   * 배터리로 실행 중인지 확인 (macOS 전용)
   */
  async isOnBattery() {
    if (!this.config.skipWhenOnBattery) {
      return false;
    }

    try {
      const { stdout } = await execAsync('pmset -g batt');
      const isOnBatt = !stdout.includes("AC Power");

      if (isOnBatt) {
        console.log('[AutoIndex] 배터리로 실행 중 - 재인덱싱 미루기');
      }

      return isOnBatt;
    } catch (err) {
      // macOS가 아니거나 명령어 실패 시 false 반환
      return false;
    }
  }

  /**
   * CPU 부하 확인
   */
  async isHighCPULoad() {
    try {
      const { stdout } = await execAsync('top -l 1 -n 0 | grep "CPU usage"');
      const match = stdout.match(/(\d+\.\d+)% user/);

      if (match) {
        const cpuUsage = parseFloat(match[1]);
        if (cpuUsage > 70) {
          console.log(`[AutoIndex] CPU 부하 높음 (${cpuUsage}%) - 재인덱싱 미루기`);
          return true;
        }
      }

      return false;
    } catch (err) {
      // 확인 실패 시 false 반환
      return false;
    }
  }

  /**
   * 재인덱싱 가능 여부 확인 및 실행
   */
  async checkAndReindex() {
    console.log('[AutoIndex] 자동 재인덱싱 점검 시작...');

    // 이미 인덱싱 중이면 스킵
    if (this.isIndexing) {
      console.log('[AutoIndex] 이미 인덱싱 중 - 스킵');
      return;
    }

    // 질문 실행 중이면 스킵
    if (this.config.skipWhenQuestionRunning && this.isQuestionRunning) {
      console.log('[AutoIndex] 질문 실행 중 - 재인덱싱 미루기');
      this.sendStatus({ status: 'waiting', reason: '질문 처리 중' });
      return;
    }

    // 인덱스가 최신이면 스킵
    if (!this.isIndexOld()) {
      this.sendStatus({ status: 'idle' });
      return;
    }

    // 배터리 확인
    if (await this.isOnBattery()) {
      this.sendStatus({ status: 'waiting', reason: '배터리 사용 중' });
      return;
    }

    // CPU 부하 확인
    if (await this.isHighCPULoad()) {
      this.sendStatus({ status: 'waiting', reason: 'CPU 부하 높음' });
      return;
    }

    // 재인덱싱 실행
    await this.runReindex();
  }

  /**
   * 재인덱싱 실행
   */
  async runReindex() {
    console.log('[AutoIndex] 자동 재인덱싱 시작...');
    this.isIndexing = true;
    this.sendStatus({ status: 'indexing' });

    try {
      // 전달된 roots 우선, 없으면 setup-config / 환경변수 순으로 사용
      const setupConfig = loadSavedSetupConfig() || {};
      const optionRoots = normalizeConfiguredRoots(this.configuredRoots);
      const setupRoots = getConfiguredIndexRoots(setupConfig);

      let envRoots = [];
      if (process.env.OGQ_DOCS_ASK_DOCUMENTS_ROOTS) {
        try {
          envRoots = normalizeConfiguredRoots(JSON.parse(process.env.OGQ_DOCS_ASK_DOCUMENTS_ROOTS));
        } catch {
          envRoots = normalizeConfiguredRoots(process.env.OGQ_DOCS_ASK_DOCUMENTS_ROOTS);
        }
      }

      const documentsRoots = optionRoots.length > 0
        ? optionRoots
        : (setupRoots.length > 0 ? setupRoots : envRoots);

      if (documentsRoots.length === 0) {
        console.log('[AutoIndex] 설정된 인덱싱 경로가 없어 자동 재인덱싱을 건너뜀');
        this.isIndexing = false;
        this.sendStatus({ status: 'error', error: '유효한 문서 루트가 없습니다' });
        return;
      }

      process.env.OGQ_DOCS_ASK_DOCUMENTS_ROOTS = JSON.stringify(documentsRoots);
      console.log('[AutoIndex] 재인덱싱 경로:', documentsRoots.join(', '));

      if (setupConfig) {
        if (typeof setupConfig.watchDownloads === 'boolean') {
          process.env.OGQ_DOCS_ASK_WATCH_DOWNLOADS = setupConfig.watchDownloads ? 'true' : 'false';
        }
        if (typeof setupConfig.watchGoogleDrive === 'boolean') {
          process.env.OGQ_DOCS_ASK_WATCH_GOOGLE_DRIVE = setupConfig.watchGoogleDrive ? 'true' : 'false';
        }
      }

      const startTime = Date.now();

      await buildIndex({ silent: true });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[AutoIndex] 자동 재인덱싱 완료 (${duration}초 소요)`);

      // 마지막 인덱싱 시간 업데이트
      this.updateLastIndexTime();

      this.sendStatus({
        status: 'completed',
        duration: `${duration}초`
      });

    } catch (err) {
      console.error('[AutoIndex] 자동 재인덱싱 실패:', err);
      this.sendStatus({
        status: 'error',
        error: err.message
      });
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * 수동 재인덱싱
   */
  async manualReindex() {
    if (this.isIndexing) {
      console.log('[AutoIndex] 이미 인덱싱 중');
      return false;
    }

    await this.runReindex();
    return true;
  }
}

// 싱글톤 인스턴스
let schedulerInstance = null;

export function getScheduler() {
  if (!schedulerInstance) {
    schedulerInstance = new AutoIndexScheduler();
  }
  return schedulerInstance;
}
