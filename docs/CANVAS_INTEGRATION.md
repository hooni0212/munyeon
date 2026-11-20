# Canvas 연동 가능성 검토

기준일: 2026-11-20. Canvas 공식 문서 기준 기술 검토이며, 성균관대학교 관리자 승인·개발자 키 발급·교수자 계정 권한은 확인되지 않았다. 이번 시안은 학교에 연결하지 않았고 실제 학생 자료를 가져오지 않았다. AI 모델은 이번 구현 범위에서 제외한다.

## 결론

학생·교수자 양쪽에 연결할 수 있다. 문연 목적에는 **교수자가 Canvas 과제와 문연을 연결하고, 학생이 해당 과제에서 진입하며, 교수자가 문연에서 제출물을 검토하는 방식**이 적합하다. 다만 진입점·로그인·데이터 조회·성적 전송은 서로 다른 권한과 구현이 필요하다.

## 어디에 넣을 수 있나

| 위치 | 학생 | 교수자 | 문연에 적용할 방식 |
| --- | --- | --- | --- |
| 강좌 좌측 메뉴 `course_navigation` | 과제 안내와 본인 작업으로 진입 | 과제 설정·제출물 검토로 진입 | 같은 링크에서 검증된 LTI 역할·강좌에 따라 화면 분기 |
| 과제의 외부 도구 | 해당 과제를 열어 문연 실행 | 과제 작성 시 외부 도구를 연결 | 과제별 진입점으로 우선 고려 |
| 과제 선택 `assignment_selection` + Deep Linking | 연결된 과제를 실행 | 문연의 과제/활동을 선택 | 강좌·과제 모델 확장 후 구현 |
| 모듈 링크 `link_selection` | 주차별 활동에서 실행 | 모듈에 문연 활동 추가 | 성적 반영 여부를 별도 설계 |
| 교수자용 강좌 메뉴 | 노출하지 않도록 구성 가능 | 관리·검토 전용 진입 | 메뉴 가시성과 서버의 실제 권한 검사는 별도 구현 |

Canvas의 LTI 배치 기능을 사용하는 방법이다. 단순 REST API 호출만으로 Canvas 메뉴가 생기거나 자동 로그인이 구현되지는 않는다. 학생이 개인 설정만으로 학교 전체·교수자 화면에 도구를 설치할 수 있다고 가정해서는 안 된다.

근거: [Navigation](https://developerdocs.instructure.com/services/canvas/external-tools/lti/placements/file.navigation_tools), [Assignment Selection](https://developerdocs.instructure.com/services/canvas/external-tools/lti/placements/file.assignment_selection_placement), [Grading](https://developerdocs.instructure.com/services/canvas/external-tools/lti/file.assignment_tools), [Placements](https://developerdocs.instructure.com/services/canvas/external-tools/lti/placements/file.placements_overview).

## 어디까지 가져올 수 있나

권한은 요청한 API scope와 해당 사용자에게 학교가 부여한 권한의 교집합이다. 교수자라 해도 다른 강좌·학교 전체 자료를 자동으로 읽을 수 없다. 공개/잠금/성적 게시 상태와 개인정보 전송 설정도 적용된다.

| 자료 | 학생 계정의 일반적인 범위 | 해당 강좌 교수자의 일반적인 범위 | 연동 방법·제약 |
| --- | --- | --- | --- |
| 사용자 식별·역할·강좌 맥락 | 본인과 진입한 강좌 | 본인과 담당 강좌 | 검증된 LTI 1.3 launch. 이름·이메일 등은 설정에 따라 생략 가능 |
| 강좌·과제 제목, 설명, 기한, 배점, rubric | 본인에게 공개된 과제 | 담당 강좌에서 권한 있는 과제 | Courses/Assignments REST API. LTI launch만으로 과제 본문 전체를 자동 수신하는 것은 아님 |
| 제출물·제출 시각·시도·상태 | 본인 제출물 중심 | 권한 있는 담당 강좌 학생들의 제출물 | Submissions REST API. 파일형 제출물은 첨부파일 접근·다운로드와 본문 추출 별도 필요 |
| 점수·피드백·rubric 평가 | 본인에게 공개된 결과 | 성적 열람 권한이 있는 결과 | 숨김/미게시 성적과 역할 권한 구분 |
| 수강생 명단·역할 | 강좌 설정에 따라 제한, 전체 명단을 기본 수집하지 않음 | 권한 있는 강좌 명단 | 승인된 NRPS scope 또는 REST 강좌 사용자 API |
| 강의 파일·페이지·모듈·공지 | 공개·잠금 조건을 충족한 자료 | 해당 자료 관리/조회 권한 범위 | 자료 유형별 REST API. URL 확인과 원문 다운로드·분석을 구분 |
| 다른 강좌·다른 학생의 비공개 성적 | 가져올 수 없음 | 해당 담당 권한 없으면 가져올 수 없음 | 학교 관리자 권한으로 우회하지 않음 |
| LearningX 영상 진도·출석 | Canvas 일반 API만으로 보장되지 않음 | 교수자도 별도 연동 확인 필요 | 외부 도구 자료이므로 LearningX 측 방식·학교 허용 범위 확인 |
| 외부 ChatGPT 대화·AI 사용 기록 | Canvas API가 제공하지 않음 | Canvas API가 제공하지 않음 | 학생의 선택적 자기보고 등 별도 경로 필요 |

근거: [Courses](https://developerdocs.instructure.com/services/canvas/resources/courses), [Assignments](https://developerdocs.instructure.com/services/canvas/resources/assignments), [Submissions](https://developerdocs.instructure.com/services/canvas/resources/submissions), [Files](https://developerdocs.instructure.com/services/canvas/resources/files), [Names and Role](https://developerdocs.instructure.com/services/canvas/resources/names_and_role).

## 인증 방식의 차이

- **LTI 1.3:** Canvas에서 검증된 신원·역할·강좌·활동 맥락으로 문연을 실행한다. OIDC 시작, state·nonce, 서명·issuer·audience·deployment 검증, JWKS와 문연 계정 매핑이 필요하다. NRPS는 허용된 강좌 명단, AGS는 허용된 활동의 점수 전송에 사용할 수 있다. LTI 서비스 토큰은 Canvas REST 전체 권한이 아니다.
- **REST + OAuth 2.0:** 사용자 동의와 학교가 발급한 API Developer Key 및 scope를 통해 허용된 Canvas 자료를 조회한다. 토큰은 서버에 암호화해 보관하고 갱신·연결 해제·사용자별 분리를 구현해야 한다. 다중 사용자 서비스에서 학생·교수자에게 개인 토큰을 만들어 붙여 넣으라고 요청하는 방식은 Canvas 공식 정책에 맞지 않는다.
- **일반 외부 링크:** 학교가 과제 설명 등에 링크를 허용하면 문연을 새 탭으로 열 수 있다. 자동 로그인이나 자료 조회 권한을 주지는 않는다.

근거: [OAuth2 Overview](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth), [Names and Role](https://developerdocs.instructure.com/services/canvas/resources/names_and_role), [LTI Grading](https://developerdocs.instructure.com/services/canvas/external-tools/lti/file.assignment_tools).

## 권장 구현 순서

1. 현재 서버 시안에서 과제 설정·제출·수동 질문·구술평가를 검토한다. 실제 학교 자료는 사용하지 않는다.
2. 교수자 협력 강좌와 학교 담당자를 통해 외부 도구 등록 가능 여부, LTI 1.3 지원 버전, Developer Key 발급, 개인정보 범위를 확인한다.
3. 현재 단일 과제·공유 교수자 권한 구조를 강좌·과제·수강 등록별 구조로 확장한다. Canvas 사용자/강좌/과제 ID를 로컬 ID와 별도 매핑한다.
4. LTI 새 탭 실행과 역할 검증을 먼저 구현한다. 현재 iframe 차단과 SameSite=Strict 쿠키를 무작정 해제하지 않는다. iframe이 필요하면 허용된 Canvas 출처와 브라우저 쿠키 제약에 맞게 다시 설계한다.
5. 읽기 전용 OAuth scope로 과제와 제출물만 조회한다. 요청량 제한, 페이지네이션, 파일 권한, 실패·재연동·토큰 만료를 처리한다. 외부 HTML은 안전하게 표시한다.
6. 이후 별도 승인된 범위에서 AGS/REST 성적 전송을 검토한다. 이번 검토는 학교 제출·성적 변경을 승인하거나 실행한 것이 아니다.

## 학교에 확인할 사항

- SKKU iCampus에서 LTI 1.3 도구 등록을 누가 승인하며 강좌 단위 설치가 가능한가?
- 개발·검증용 강좌와 교수자 테스트 계정을 제공할 수 있는가?
- API Developer Key와 필요한 읽기 전용 scope 발급이 가능한가?
- 학생 식별·제출물·명단·성적을 외부 서버에서 처리할 수 있는 범위와 보존 기간은 무엇인가?
- 무료 시안 주소를 redirect/launch URL로 등록해도 되는가? 주소 변경 시 재등록 절차는 무엇인가?
- LearningX 자료가 필요하다면 별도 API·운영사 승인 절차가 있는가?
