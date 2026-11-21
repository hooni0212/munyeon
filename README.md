# 문연

교수자가 과목·분반별로 과제와 AI 활용 기준을 정하고, 학생이 과제 AI와 대화하며 작성한 문서에 AI 활용 기록을 붙여 제출하는 웹 앱입니다. 교수자는 문장 단위로 표시된 활용 기록과 원본 대화를 근거로 구술 질문을 준비하고 평가를 기록합니다.

## 프로젝트 현황

2026-11-21에 [MVP 명세](docs/MVP_BACKEND_SPEC.md)와 [화면 지도](docs/SCREEN_MAP.md)를 기준으로 여러 과목·분반·과제 구조로 재구성했습니다. 학생은 **작업실(과제 목록·과제 AI·문서) → 제출 준비 → 제출 확인 → 제출 이력**, 교수자는 **내 과목 → 분반 → 과제 제출 현황 → 검토 작업실(근거·기준 확인·구술 질문)** 흐름으로 사용합니다.

로컬 체험에서는 실제 모델 대신 **모의 모델**이 응답합니다. 모의 답변은 흐름 확인용이며 실제 모델 품질과 무관합니다. 운영 모드(`NODE_ENV=production`)에서는 AI가 기본으로 꺼져 있고, 꺼져 있어도 문서 작성·활용 기록·제출·직접 질문 작성·평가는 동작합니다. React 화면, Node.js API, SQLite 영속 저장이 연결되어 있으며 실제 모델 품질과 실수업 운영은 별도로 검증해야 합니다.

- [Canvas 학생 API QA와 교수자 테스트](docs/CANVAS_QA.md): 실제 조회 검증과 문연의 과목 분리 제한
- [Canvas 연동 가능성](docs/CANVAS_INTEGRATION.md): 학생·교수자 진입점, 조회 범위와 학교 승인 조건
- [무료 주소 서버 시안](docs/PREVIEW_DEPLOYMENT.md): 기존 홈서버에 별도 서비스로 운영하는 구성
- [QA 체크리스트](docs/QA_CHECKLIST.md): 직접 점검할 항목과 버그 제보 형식
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

| 역할 | 아이디 | 비밀번호 | 예시 데이터 |
| --- | --- | --- | --- |
| 교수자 | teacher | munyeon-teacher | 창의융합적디자인(01·02분반), 디자인 문제 해결 보고서 |
| 교수자 2 | teacher2 | munyeon-teacher2 | 디자인 리서치 방법 |
| 학생 | student | munyeon-student | 김하윤 · 두 과목 수강, 제출·기준 확인 항목 있음 |
| 학생 2 | student2 | munyeon-student2 | 박서준 · 외부 AI 기록으로 제출 |
| 학생 3 | student3 | munyeon-student3 | 이유진 · 02분반, 미제출 |

이 계정과 예시 데이터는 로컬 체험용이며 새 DB를 만들 때 한 번 생성됩니다. 마감 전에는 같은 과제를 여러 번 다시 제출할 수 있고, 교수자는 회차별로 열람합니다.

개발 중에는 별도 터미널에서 `npm run api`와 `npm run dev`를 실행합니다. Vite 개발 서버는 API를 4311 포트로 전달합니다.

## AI 모델 연결

로컬 체험은 모의 모델을 기본으로 사용합니다(`MUNYEON_AI_MOCK=0`이면 끔). 실제 모델은 명시적으로 다시 활성화할 때만 `.env.example`을 `.env`로 복사하고 `MUNYEON_AI_ENABLED=1`, `MUNYEON_AI_URL`, `MUNYEON_AI_MODEL`을 설정합니다. 원격 제공자가 키를 요구하면 `MUNYEON_AI_KEY`를 추가하고 서버를 재시작합니다.

- URL에는 `/chat/completions` 앞의 기본 주소를 입력합니다. 로컬 Ollama 예시는 `http://127.0.0.1:11434/v1`입니다. [Ollama API 문서](https://docs.ollama.com/api/openai-compatibility)
- 추천 질문은 Chat Completions의 JSON 응답 형식을 지원하는 모델을 사용합니다. [OpenAI API 문서](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- 학생이 과제 AI에 질문을 보내면 공개 당시 고정된 과목 학습 목표·응답 지침·예시 Q&A, 과제 안내, 선택한 단계·도움 유형, 질문과 관련 있는 강의자료 발췌(최대 2개), 같은 과제의 최근 대화 8건, 새 질문이 모델 서버에 전달됩니다. 제한된 조합의 요청은 모델에 보내지 않고 서버가 안내 문구로 답합니다.
- 교수자가 AI 질문 추천을 요청하면 최신 제출본의 문단, 활용 기록(인용·설명·연결 대화 답변 일부), 과제 안내와 평가 기준이 전달됩니다.
- 모델을 설정하지 않으면 작업실의 AI 칸에는 활용 기준만 표시됩니다. 문서 작성, 활용 기록, 제출, 직접 작성한 구술 질문, 구술평가는 그대로 실행할 수 있습니다.

## 확인 순서

1. 교수자(`teacher`)로 로그인해 **내 과목**에서 분반을 고릅니다. **과목 설정**에서 수강 명단·과목 AI 설정·강의자료를, **과제 설정**에서 대상 분반·마감·단계별 허용/제한 기준을 정하고 공개합니다.
2. 학생(`student`)으로 로그인하면 마감이 가장 가까운 과제의 작업실이 열립니다. 왼쪽 과제 목록은 접을 수 있습니다. 본문은 직접 쓰거나 `.txt`·`.pdf`·`.docx`를 올려 변환 결과를 확인한 뒤 반영합니다.
3. 과제 AI에서 지금 단계와 도움 유형을 골라 질문합니다. 답변을 여러 개 ‘선택’하고 **문서에 연결**을 누른 뒤 본문 문장을 드래그(또는 커서를 문단에 두고)하면 활용 기록이 생기고 단계별 색으로 표시됩니다.
4. **제출 준비**에서 기록마다 활용 방식과 설명을 적고, 자동으로 찾은 유사 대화를 연결하거나 이의를 남긴 뒤 제출합니다. 마감 전에는 고쳐서 다시 제출할 수 있습니다.
5. 교수자의 **검토 작업실**에서 ‘원본 보기 / AI 활용 표시’를 바꿔 보고, 강조된 문장을 눌러 원본 대화와 학생 설명을 확인합니다. 같은 화면의 **구술 질문** 탭에서 질문을 추천받거나 직접 쓰고, 구술에 쓸 질문을 고른 뒤 평가를 기록합니다.

교수자에게는 학생이 연결한 대화, 제출 시 자동으로 찾은 유사 대화와 학생 이의, 기준 확인이 필요한 대화만 보입니다. 그 밖의 대화는 서버에 저장되지만 교수자 화면에 표시되지 않습니다. LMS 로그인·명단·성적 연동은 학교의 외부 도구 등록과 연동 방식 확인이 필요한 다음 단계입니다.

## 코드 구조

| 경로 | 내용 |
| --- | --- |
| `src/main.jsx`, `src/shell.jsx` | 세션 확인, 로그인, 공통 상단 영역 |
| `src/student.jsx` | 학생 화면: 과제 목록, 작업실(과제 AI·문서·활용 기록), 제출 준비·확인·이력 |
| `src/teacher.jsx` | 교수자 화면: 과목·분반·과제 목록, 과목·과제 설정, 제출 현황, 검토 작업실 |
| `src/ui.jsx`, `src/lib.js`, `src/api.js`, `src/style.css` | 공통 UI 부품, 해시 경로·날짜 도구, API 클라이언트, 스타일 |
| `shared/text.js` | 서버·화면 공용: 문단 범위, 활용 범위 이동·재배치, 강조 조각, 유사 대화 계산 |
| `server/index.js` | HTTP 서버, 정적 파일, 요청 크기 제한(업로드만 15 MB) |
| `server/app.js` | `/api/v1` 접근 범위 검사와 과목·과제·채팅·초안·제출·검토 API |
| `server/store.js` | SQLite 스키마(버전 2), 이전 DB 이전, 시연 데이터, 로그인 세션 |
| `server/extract.js` | `.txt`·`.pdf`·`.docx` 텍스트 추출 |
| `server/model.js` | 모델 연결·모의 모델, 추천 질문 검증 |

`npm test`는 임시 SQLite와 모의 모델로 명세 시나리오(과제 공개·분반 접근, 제한 요청, 활용 기록 위치 이동, 업로드, 재제출, 과목 격리, 질문·평가 유지, 마감 차단, 이전 DB 이전, 운영 모드 보호·백업 복구)를 확인합니다. 업로드한 원본 파일은 SQLite 안에 저장되므로 아래 백업에 함께 포함됩니다.

## 소규모 운영 배포

문연의 현재 구조는 단일 인스턴스에서 소규모 수업 몇 개를 운영하는 용도입니다. 공개 가입은 없으며 운영자가 교수자와 학생 계정을 발급합니다. SQLite는 앱의 영속 볼륨에 저장합니다. 운영 시에는 한 데이터베이스를 하나의 앱 컨테이너에서 사용합니다.

서버는 PDF·Word 변환을 위해 런타임 패키지(`pdfjs-dist`, `mammoth`)가 필요합니다. Docker 이미지는 `npm ci --omit=dev`로 설치하며, Docker 없이 배포할 때도 릴리즈 폴더에서 같은 명령을 실행합니다. 2026-11-20 이전 형식(단일 과제)의 DB로 시작하면 첫 교수자 계정 소유의 과목·분반·과제로 자동 이전되고, 이전 표는 `legacy_` 이름으로 남습니다. 업그레이드 전에 반드시 백업합니다.

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
