# AI 없는 무료 주소 서버 시안

기준일: 2026-11-20.

시안 주소: **https://munyeon.59-1-64-98.sslip.io**

## 적용 범위

기존 `glsoop-app` SSH 별칭이 연결하는 글숲 홈서버에 별도 문연 서비스를 배포했다. 글숲 앱 파일·DB·Nginx 가상 호스트는 변경하지 않았다. 새 가상 호스트를 추가하고 Nginx 설정 검사 후 reload했다. 기존 글숲 호스트의 HTTP 리다이렉트 응답이 적용 전후 같은 것을 확인했으며, 글숲 전체 기능을 재검증한 것은 아니다.

도메인 구매·유료 서버 신설은 하지 않았다. `sslip.io`의 IP 기반 DNS와 기존 Certbot 계정을 사용해 HTTPS 인증서를 발급했다. 이는 소유한 독립 도메인이 아닌 무료 서비스의 주소다. 홈서버 공인 IP가 바뀌면 주소·인증서·Nginx·앱 Origin 설정을 다시 맞춰야 한다. 무료 DNS 가용성과 홈서버 네트워크에도 의존하므로 학교 LTI 등록 전에 안정적인 주소 운영 방식을 협의해야 한다.

근거: [nip.io / sslip.io 공식 안내](https://sslip.io/).

## 실제 구성

| 항목 | 구성 |
| --- | --- |
| 화면·API | React 빌드 + Node.js 24.22.1 |
| 서비스 | `munyeon-preview.service`, 전용 `munyeon` 사용자 |
| 내부 주소 | `127.0.0.1:4312` |
| 외부 주소 | 기존 Nginx의 별도 80/443 가상 호스트 |
| 릴리즈 | `/srv/munyeon-preview/releases/20261120-v1` |
| 실행 링크 | `/srv/munyeon-preview/current` |
| 독립 런타임 | `/srv/munyeon-preview/runtime/node` |
| 환경 설정 | `/etc/munyeon-preview.env`, 권한 600 |
| DB | `/var/lib/munyeon-preview/data/preview.sqlite` |
| 최초 백업 | `/var/lib/munyeon-preview/backups/initial-20261120.sqlite` |
| AI | `MUNYEON_AI_ENABLED=0`, 제공자 주소·키 미설정 |
| 학교 연결 | 없음. 예시 과제·계정·평가만 사용 |

호스트의 기존 Node.js 22를 교체하지 않았다. 기존 설치된 Node.js 24 실행 파일을 문연 전용 경로에 복사하고 사용한다. systemd에 자동 시작·실패 시 재시작·메모리 제한·쓰기 경로 제한을 설정했다. 공개 가입은 없고, 운영용 임의 비밀번호를 가진 교수자·학생 계정을 발급했다. 계정 정보는 이 저장소에 포함하지 않는다.

AI 코드 자체는 향후 재검토를 위해 남겼다. 현재 화면은 학생 **과제 안내 → 제출**, 교수자 **검토 → 직접 질문 작성/수정 → 확정 → 평가** 흐름이다. 학생의 외부 AI 활용 자기보고 필드는 유지한다. AI 모델을 사용하지 않는 것과 학생이 외부 도구 활용을 설명하는 기능은 구분한다.

## 다음 릴리즈 반영 시 주의

2026-11-21 버전부터 서버에 런타임 패키지(`pdfjs-dist`, `mammoth`)와 `shared/` 폴더가 필요하다. 새 릴리즈 폴더에서 `npm ci --omit=dev`를 실행한 뒤 `current` 링크를 바꾼다. 첫 시작 때 기존 `preview.sqlite`가 과목 구조로 자동 이전되므로(이전 표는 `legacy_`로 보존) 그 전에 백업을 만든다. 운영 모드이므로 모의 모델은 꺼진 상태로 유지된다.

## HTTPS와 갱신

- HTTP는 HTTPS로 리다이렉트하며 ACME 검증 경로는 별도로 유지한다.
- 인증서 만료 예정일은 2027-02-18이다. Certbot 자동 갱신 타이머가 활성 상태임을 확인했다.
- 새 인증서를 Nginx가 읽도록 `deploy/renew-nginx.sh`를 Certbot deploy hook으로 설치하고 직접 실행해 설정 검사·reload를 확인했다.
- 실제 만료 시점의 자동 갱신 성공까지 관찰한 것은 아니다.

## 검증 결과

- 로컬 Node.js 26: 기존 통합 테스트 3개 및 Vite 빌드 성공.
- 배포 서버 Node.js 24.22.1: 동일 통합 테스트 3개 통과.
- 외부 HTTPS `/`, `/healthz`: HTTP 200, HTTP → HTTPS 리다이렉트 확인.
- 교수자·학생 계정 로그인과 Secure/HttpOnly 쿠키 확인.
- 비로그인 제출물 조회 401, 학생의 교수자 제출물 목록 접근 403 확인.
- 학생 AI 대화와 교수자 AI 추천 API 모두 503, 세션의 모델 값 null 확인.
- 예시 제출물의 수동 평가 저장 후 서비스 재시작, 동일 평가 재조회 확인.
- 실제 시안 DB의 SQLite 온라인 백업 파일 생성.
- 배포된 JS가 AI 없는 메뉴 변경을 포함한 빌드와 일치함을 확인.
- 실제 Chrome에서 무료 HTTPS 주소의 로그인 화면 렌더링 확인. 로그인 후 화면 전체의 새 디자인 검토·모바일 QA는 별도 작업이다.

## 유지·중지·되돌리기

```sh
sudo systemctl status munyeon-preview
sudo systemctl restart munyeon-preview
sudo journalctl -u munyeon-preview --since '10 minutes ago'
```

시안 중지는 `sudo systemctl disable --now munyeon-preview`로 한다. 외부 경로도 제거하려면 문연 전용 Nginx 활성화 링크를 비활성화하고 `nginx -t` 후 reload한다. DB·백업은 보존한다. 코드 되돌리기는 새 릴리즈를 별도 경로에 준비해 `current` 링크를 변경한 뒤 서비스를 재시작하는 방식으로 진행한다. DB 스키마를 바꾼 버전으로 이동할 때에는 별도 마이그레이션·복구 검증이 필요하다.

저장소의 `deploy/`는 이번 별도 서비스 구성의 템플릿이다. 기존 Docker Compose/Caddy 배포 파일은 대체 운영 방식으로 남겼으며 이번 홈서버에서는 실행하지 않았다.
