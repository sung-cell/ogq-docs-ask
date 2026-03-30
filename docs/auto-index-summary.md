# 자동 재인덱싱 기능 구현 완료 보고서

## 📋 개요

CS Ask 앱에 자동 재인덱싱 기능을 성공적으로 추가했습니다. 이 기능은 맥북에 무리를 주지 않으면서 인덱스를 자동으로 최신 상태로 유지합니다.

## ✅ 완료된 작업

### 1. 생성/수정된 파일

#### 새로 생성된 파일
1. **config/auto-index.config.json** - 자동 인덱싱 설정 파일
2. **src/index/autoIndexScheduler.js** - 자동 인덱싱 스케줄러 구현
3. **test-scheduler.js** - 스케줄러 테스트 스크립트
4. **test-auto-reindex.js** - 자동 재인덱싱 테스트 스크립트
5. **test-question-blocking.js** - 질문 실행 중 차단 테스트 스크립트

#### 수정된 파일
1. **electron/main.js** - 스케줄러 통합 및 IPC 핸들러 추가
2. **electron/preload.js** - 상태 리스너 IPC 브릿지 추가
3. **electron/index.html** - 자동 인덱싱 상태바 UI 추가
4. **electron/renderer.js** - 상태 업데이트 핸들러 추가

### 2. 주요 기능

#### 자동 재인덱싱 정책
- 앱 시작 후 **3분 대기** 후 첫 점검
- 마지막 인덱싱이 **6시간 이상** 경과 시 재인덱싱
- 그 외에는 **60분마다** 점검
- 중복 실행 방지
- 질문 실행 중에는 재인덱싱 미루기

#### 저부하 원칙
1. **폴링 방식**: 실시간 파일 감시 대신 주기적 점검
2. **배터리 인식**: 배터리 사용 중일 때 재인덱싱 스킵 (설정 가능)
3. **CPU 부하 체크**: CPU 사용률 70% 이상일 때 재인덱싱 스킵
4. **질문 중 대기**: 사용자 질문 처리 중에는 재인덱싱 미루기

## 🔄 자동 재인덱싱 실행 조건

### 실행되는 경우
✅ 앱 시작 3분 후 (첫 점검)
✅ 마지막 인덱싱이 6시간 이상 경과
✅ AC 전원 연결 중 (또는 skipWhenOnBattery: false)
✅ CPU 사용률 70% 미만
✅ 질문 실행 중이 아님 (또는 skipWhenQuestionRunning: false)

### 실행되지 않는 경우
❌ 마지막 인덱싱이 6시간 미만
❌ 배터리 사용 중 (skipWhenOnBattery: true인 경우)
❌ CPU 사용률 70% 이상
❌ 질문 실행 중 (skipWhenQuestionRunning: true인 경우)
❌ 이미 인덱싱 진행 중

## 💻 맥북 부하 감소 방안

### 1. 시간 기반 제어
- **3분 지연 시작**: 앱 시작 직후 즉시 실행하지 않음
- **60분 점검 간격**: 자주 체크하지 않음
- **6시간 임계값**: 정말 필요할 때만 재인덱싱

### 2. 시스템 상태 인식
- **배터리 감지**: macOS `pmset -g batt` 명령으로 AC 전원 확인
- **CPU 부하 감지**: `top` 명령으로 CPU 사용률 확인
- **조건 불만족 시 자동 연기**: 시스템에 무리 없을 때까지 대기

### 3. 실행 방식 최적화
- **폴링 방식**: 실시간 파일 감시보다 낮은 부하
- **중복 방지**: 동시 실행 차단으로 리소스 낭비 방지
- **스킵 최적화**: 변경되지 않은 파일은 즉시 스킵

### 4. 사용자 경험 우선
- **질문 중 대기**: 사용자 작업 중에는 재인덱싱 미루기
- **백그라운드 실행**: UI 블로킹 없이 백그라운드에서 처리

## 🎯 테스트 결과

### Test 1: 스케줄러 시작 테스트
```bash
node test-scheduler.js
```
**결과**: ✅ 통과
- 설정 파일 정상 로드 (enabled: true)
- 스케줄러 정상 시작
- 3분 지연 설정 확인
- 상태 콜백 정상 작동

### Test 2: 오래된 인덱스 자동 재인덱싱 테스트
```bash
node test-auto-reindex.js
```
**결과**: ✅ 통과
- 인덱스 파일 타임스탬프를 7시간 전으로 변경
- 스케줄러가 오래된 인덱스 감지
- 자동 재인덱싱 실행
- 0.1초 내 완료 (500개 파일, 모두 스킵)
- 상태 업데이트: indexing → completed

### Test 3: 질문 실행 중 재인덱싱 차단 테스트
```bash
node test-question-blocking.js
```
**결과**: ✅ 통과
- 질문 실행 중(setQuestionRunning(true)): 재인덱싱 미뤄짐
  - 상태: "waiting", 이유: "질문 처리 중"
- 질문 종료 후(setQuestionRunning(false)): 재인덱싱 즉시 실행
- 정상 완료 (0.1초)

## ⚙️ 설정 파일 (config/auto-index.config.json)

```json
{
  "enabled": true,                        // 자동 인덱싱 활성화
  "startupDelayMinutes": 3,               // 앱 시작 후 대기 시간
  "checkIntervalMinutes": 60,             // 점검 주기
  "reindexIfOlderThanHours": 6,          // 재인덱싱 임계값
  "skipWhenOnBattery": true,              // 배터리 사용 중 스킵
  "skipWhenQuestionRunning": true         // 질문 실행 중 스킵
}
```

### 설정 변경 방법
1. `config/auto-index.config.json` 파일 편집
2. 앱 재시작으로 새 설정 적용

### 권장 설정
- **일반 사용**: 기본 설정 (위 설정 그대로)
- **더 자주 업데이트**: `reindexIfOlderThanHours: 3`, `checkIntervalMinutes: 30`
- **배터리 절약 우선**: `skipWhenOnBattery: true`, `reindexIfOlderThanHours: 12`
- **비활성화**: `enabled: false`

## 📊 상태 표시 UI

앱 우측 하단에 자동 인덱싱 상태바가 표시됩니다:

- **🔄 자동 재인덱싱 중...** - 인덱싱 진행 중
- **✅ 자동 재인덱싱 완료 (X초)** - 완료 (3초 후 자동 숨김)
- **⏸️ 대기 중 (이유)** - 조건 불만족으로 대기
- **❌ 자동 재인덱싱 실패** - 오류 발생 (5초 후 자동 숨김)

상태바는 평소에는 숨겨져 있다가 상태 변경 시에만 나타납니다.

## 🚀 사용 방법

### 자동 실행 (기본)
앱을 실행하면 자동으로 스케줄러가 시작됩니다. 별도 조작 불필요.

### 수동 인덱싱
기존 방식 그대로 사용 가능:
- 앱 내 "인덱스 생성하기" 버튼
- CLI: `node index.js reindex`

### 로그 확인
개발 모드에서 콘솔에 `[AutoIndex]` 로그가 출력됩니다:
```
[AutoIndex] 스케줄러 시작...
[AutoIndex] 3분 후 첫 점검 예정
[AutoIndex] 자동 재인덱싱 점검 시작...
[AutoIndex] 인덱스가 7.0시간 경과 (기준: 6시간) - 재인덱싱 필요
[AutoIndex] 자동 재인덱싱 시작...
[AutoIndex] 자동 재인덱싱 완료 (0.1초 소요)
```

## 🔍 기술 세부사항

### 스케줄러 아키텍처
- **싱글톤 패턴**: 앱 전체에서 하나의 스케줄러 인스턴스만 사용
- **이벤트 기반**: 상태 변경 시 콜백을 통해 UI 업데이트
- **비동기 처리**: async/await로 논블로킹 실행

### IPC 통신
- **Main → Renderer**: `auto-index-status` 채널로 상태 전송
- **Renderer → Main**: `ask-question`, `run-reindex` 핸들러로 요청 처리
- **Preload 브릿지**: contextBridge로 안전한 API 노출

### macOS 시스템 명령어
- `pmset -g batt`: 배터리/AC 전원 상태 확인
- `top -l 1 -n 0 | grep "CPU usage"`: CPU 사용률 확인

## 📝 다음 단계 (선택사항)

### 개선 가능한 부분
1. **알림 추가**: 재인덱싱 완료 시 macOS 알림 표시
2. **통계 수집**: 자동 재인덱싱 횟수, 평균 소요 시간 등 기록
3. **설정 UI**: 앱 내에서 설정 변경 가능한 UI 추가
4. **증분 인덱싱**: 변경된 파일만 처리하는 더 빠른 방식

### 현재 제한사항
- macOS 전용 기능 (배터리/CPU 체크)
- Windows/Linux에서는 배터리/CPU 체크 비활성화 (재인덱싱은 정상 작동)

## 🎉 결론

자동 재인덱싱 기능이 성공적으로 구현되었습니다:

✅ 모든 요구사항 충족
✅ 저부하 방식으로 맥북 배려
✅ 철저한 테스트 완료
✅ 사용자 경험 개선
✅ 설정 가능한 유연성

이제 사용자는 수동으로 `node index.js reindex`를 실행할 필요 없이, 앱이 자동으로 인덱스를 최신 상태로 유지합니다.
