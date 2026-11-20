# 문연

교수자가 과제 지침을 설정하고, 학생이 지침을 확인해 과제를 제출하는 웹 앱입니다. 교수자는 제출물과 학생이 공유한 사례를 바탕으로 질문을 준비하고 구술평가 결과를 저장할 수 있습니다.

## 프로젝트 현황

2026-11-20부터 시안의 AI 모델 연결은 기본 비활성화입니다. 학생은 **내 과제 → 작업실에서 작성 → AI 활용 확인 → 제출 확인**, 교수자는 **학생 제출 현황 → 제출물 검토 → 구술 질문 → 구술평가** 흐름으로 사용합니다. 모델 호출 코드는 향후 재검토를 위해 보존하지만 이번 서버에서는 실행하지 않습니다.

현재는 **단일 과제의 학습·제출·구술평가 흐름을 구현한 동적 웹 앱 MVP**입니다. React 화면, Node.js API, SQLite 영속 저장이 연결되어 있습니다. AI 제공자 연결 코드는 있지만, 실제 모델 품질과 외부 운영 배포는 별도로 검증해야 합니다. 화면은 [과제 작업실 시안](docs/prototypes/munyeon-workspace.html)을 기준으로 재구성했습니다.

- [Canvas 학생 API QA와 교수자 테스트](docs/CANVAS_QA.md): 실제 조회 검증과 문연의 과목 분리 제한
- [Canvas 연동 가능성](docs/CANVAS_INTEGRATION.md): 학생·교수자 진입점, 조회 범위와 학교 승인 조건
- [무료 주소 서버 시안](docs/PREVIEW_DEPLOYMENT.md): 기존 홈서버에 별도 서비스로 운영하는 구성
- [목표·범위·진행 현황](docs/PROJECT_STATUS.md): 구현한 기능, 검증 범위, 남은 작업과 단계별 완료 조건
- [동적 서버 운영 전환 안내](docs/DYNAMIC_SERVER.md): 현재 서버 구조, 배포 순서와 확장 시 필요한 변경

화면 캡처, 로컬 데이터베이스, 실제 환경 설정과 의존성 폴더는 저장소에 포함하지 않습니다.

## 실행

Node.js 24 이상이 필요합니다. 이 폴더에서 아래 명령을 실행합니다.

```sh
npm ci
npm run build
npm start
```

브라우저에서 [http://127.0.0.1:4311](http://127.0.0.1:4311)을 엽니다. 서버는 이 컴퓨터의 루프백 주소에서 실행되며, 첫 시작 시 `data/munyeon.sqlite`에 데이터베이스를 생성합니다. 앱을 재시작해도 제출물과 평가 기록은 유지됩니다.

| 역할 | 아이디 | 비밀번호 |
| --- | --- | --- |
| 교수자 | teacher | munyeon-teacher |
| 학생 | student | munyeon-student |
| 학생 2 | student2 | munyeon-student2 |

이 계정은 로컬 체험용입니다. 학생마다 한 과제에 한 번 제출할 수 있습니다. 두 번째 학생 계정으로 별도 제출 흐름을 확인할 수 있습니다.

개발 중에는 별도 터미널에서 `npm run api`와 `npm run dev`를 실행합니다. Vite 개발 서버는 API를 4311 포트로 전달합니다.

## AI 모델 연결

현재 단계에서는 AI 모델을 연결하지 않습니다. 이후 명시적으로 다시 활성화할 때만 `.env.example`을 `.env`로 복사하고 `MUNYEON_AI_ENABLED=1`, `MUNYEON_AI_URL`, `MUNYEON_AI_MODEL`을 설정합니다. 원격 제공자가 키를 요구하면 `MUNYEON_AI_KEY`를 추가하고 서버를 재시작합니다.

- URL에는 `/chat/completions` 앞의 기본 주소를 입력합니다. 로컬 Ollama 예시는 `http://127.0.0.1:11434/v1`입니다. [Ollama API 문서](https://docs.ollama.com/api/openai-compatibility)
- 추천 질문은 Chat Completions의 JSON 응답 형식을 지원하는 모델을 사용합니다. [OpenAI API 문서](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- 학생이 작업실의 과제 AI에 질문을 보내면 과제 안내, AI 활용 기준, 최근 대화, 새 질문이 설정된 모델 서버에 전달됩니다. 교수자가 AI 질문 후보를 요청하면 제출물, 평가 기준, 학생이 연결한 대화가 전달됩니다.
- 모델을 설정하지 않으면 작업실의 AI 대화 칸에는 활용 기준만 표시됩니다. 과제 설정, 학생 제출, 직접 작성한 구술 질문, 구술평가는 그대로 실행할 수 있습니다.

## 확인 순서

1. 교수자로 로그인해 **과제 설정**에서 과제 정보·마감·구술평가 기준을 입력하고, 다음 단계에서 허용·제한하는 AI 도움을 저장합니다.
2. 학생으로 로그인해 **내 과제**에서 작업실을 엽니다. 제목과 본문은 입력하는 동안 서버에 자동 저장됩니다. 모델을 연결했다면 과제 AI와 대화하고 답변 한 건을 활용 사례로 표시할 수 있습니다.
3. **제출 준비**에서 AI 활용 방식(문연 대화 사례 연결, 직접 입력, 사용하지 않음)을 고르고, 교수자에게 전달될 내용을 확인한 뒤 제출합니다.
4. 교수자의 **학생 제출 현황**에서 학생을 열고, 제출물 문단을 선택해 학생의 AI 활용 근거를 확인합니다.
5. **구술 질문**에서 근거 문단과 질문을 저장하고, **구술평가**에서 두 항목의 점수와 메모를 기록합니다.

교수자는 학생이 사용한 도움 유형, 학생이 활용 사례로 연결한 대화, 학생의 AI 활용 보고만 확인합니다. LMS 로그인·명단·성적 연동은 학교의 외부 도구 등록과 연동 방식 확인이 필요한 다음 단계입니다.

## 코드 구조

| 경로 | 내용 |
| --- | --- |
| `src/main.jsx`, `src/shell.jsx` | 세션 확인, 로그인, 공통 상단 영역 |
| `src/student.jsx` | 학생 화면: 내 과제, 작업실, AI 활용 확인, 제출 확인·완료 |
| `src/teacher.jsx` | 교수자 화면: 제출 현황, 검토 작업실, 구술 질문·평가, 과제 설정 |
| `src/ui.jsx`, `src/lib.js`, `src/style.css` | 공통 UI 부품, 해시 경로·날짜 도구, 시안 기준 스타일 |
| `server/index.js` | 로컬 HTTP 서버와 정적 파일 제공 |
| `server/app.js` | 역할별 접근 제어와 과제·대화·제출·평가 API |
| `server/store.js` | SQLite 저장과 로그인 세션 |
| `server/model.js` | 서버의 모델 연결, 추천 질문 검증 |

`npm test`는 임시 SQLite와 모의 모델 응답을 사용해 접근 권한, 초안 저장, AI 활용 보고, 선택적 공유, 질문 저장, 채점, 재시작 보존, 이전 설정의 변환을 확인합니다.

## 소규모 운영 배포

문연의 현재 구조는 단일 인스턴스에서 한 과제에 참여하는 수업용입니다. 공개 가입은 없으며 운영자가 교수자와 학생 계정을 발급합니다. SQLite는 앱의 영속 볼륨에 저장합니다. 운영 시에는 한 데이터베이스를 하나의 앱 컨테이너에서 사용합니다.

### 첫 배포

1. Docker Engine과 Compose가 설치된 서버에 프로젝트를 복사합니다. 서비스 도메인의 DNS를 서버로 연결하고, 80·443 포트를 Caddy에 연결합니다. [Caddy HTTPS 문서](https://caddyserver.com/docs/automatic-https)
2. `.env.example`을 `.env`로 복사해 `MUNYEON_DOMAIN`을 지정합니다. 앱은 Caddy 뒤에서 실행되며 앱 포트를 호스트에 공개하지 않습니다. 이미 서버에서 80·443 포트를 사용하는 경우에는 기존 HTTPS 프록시에 문연 도메인을 추가해야 합니다.
3. 운영 계정을 생성한 다음 서비스를 시작합니다. 비밀번호는 16자 이상으로 정하고, 아래 Bash 예시에서는 입력값을 화면에 표시하거나 명령 인자로 넘기지 않습니다.

```bash
chmod 600 .env
docker compose build app

read -r -s -p '교수자 초기 비밀번호: ' munyeon_password; printf '\n'
printf '%s\n' "$munyeon_password" |
  docker compose run --rm -T app node server/admin.js create-user instructor teacher '담당 교수자'
unset munyeon_password

read -r -s -p '학생 초기 비밀번호: ' munyeon_password; printf '\n'
printf '%s\n' "$munyeon_password" |
  docker compose run --rm -T app node server/admin.js create-user learner01 student '학생 이름'
unset munyeon_password

docker compose up -d --wait
docker compose ps
```

학생마다 별도 아이디를 발급합니다. 초기 비밀번호를 바꾸려면 같은 표준입력 방식으로 `node server/admin.js reset-password <아이디>`를 실행합니다. 비밀번호 교체 시 해당 사용자의 기존 세션이 종료됩니다. 개발용 DB를 재사용하려면 기존 체험 계정의 알려진 비밀번호를 모두 교체해야 운영 모드에서 시작할 수 있습니다.

배포 후 `https://설정한-도메인/healthz`와 로그인 화면을 확인합니다. 학생 계정으로 예시 과제를 제출한 뒤 교수자 계정으로 검토하고 구술평가를 저장합니다. 새 호스트에서 운영을 시작하기 전에 실제 모델을 연결하고 질문 응답과 구술 문항 추천도 확인합니다.

### 운영 모델

`.env`의 `MUNYEON_AI_URL`은 **앱 컨테이너에서 접근할 수 있는 주소**로 지정합니다. 컨테이너의 `127.0.0.1`은 앱 컨테이너 자체입니다. 모델 이름과 제공자 키를 설정한 후 `docker compose up -d --wait`로 변경을 적용합니다.

계정별 모델 호출 한도는 한 시간에 20회, 전체 기본값은 24시간에 120회입니다. 전체 한도는 `MUNYEON_AI_DAILY_LIMIT`에서 바꿀 수 있습니다. 요청당 응답 한도는 1,600토큰입니다. 모델 게이트웨이가 다른 필드명을 요구하면 `MUNYEON_AI_OUTPUT_LIMIT_FIELD`에 `max_tokens` 또는 `max_completion_tokens`를 지정합니다. 학생 데이터에 접근할 운영자와 데이터 보존 범위, 모델 제공자에게 전송되는 항목은 수업 운영 전에 안내합니다.

### 백업과 복구

SQLite 온라인 백업을 사용합니다. 백업 파일에는 계정 해시와 과제 데이터가 들어 있으므로 운영자만 접근할 수 있는 위치에 보관합니다. [Node.js SQLite 백업 문서](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)

```bash
snapshot="munyeon-$(date +%Y%m%d-%H%M%S).sqlite"
docker compose exec -T app node server/admin.js backup "/tmp/$snapshot"
docker compose cp "app:/tmp/$snapshot" "./$snapshot"
chmod 600 "$snapshot"
docker compose exec -T app rm "/tmp/$snapshot"
```

복구는 **새 DB 파일**에 진행합니다. 이전 파일은 되돌릴 때 사용할 수 있습니다. `snapshot`은 위에서 내려받은 파일 경로로 지정합니다.

```bash
restored="restored-$(date +%Y%m%d-%H%M%S).sqlite"
MUNYEON_DB_FILENAME="$restored" docker compose run --rm -T app node server/admin.js restore < "$snapshot"
```

복구가 완료되면 `.env`에 `MUNYEON_DB_FILENAME`을 위 `restored` 파일명으로 지정하고 `docker compose up -d --wait`를 실행합니다. 복구된 계정으로 다시 로그인해 제출물과 평가 기록을 확인합니다. 백업 시점의 세션은 복원 시 만료됩니다.
