# Canvas 연동 QA와 교수자 테스트 계획

2026-11-20. 개인 Canvas 자료와 인증 정보는 `.local-review/`에만 저장한다. 학교 자료를 공개 시안 서버나 GitHub에 올리지 않는다.

## 재현 도구

- `scripts/canvas_student_qa.py`: 기존 개인 토큰을 환경 변수 또는 `--env-file`에서 읽어 HTTPS GET만 수행한다. 선택 학기의 과목·과제 소속·본인 제출 ID·관리 권한·두 과목 간 잘못된 조합의 차단을 확인한다. 같은 출처의 제한된 경로만 허용하고 리다이렉트·잘못된 페이지네이션을 차단한다.
- `scripts/test_canvas_student_qa.py`: 외부 URL과 학생 타인 데이터 경로 차단, 리다이렉트 차단, 페이지네이션 공격·순환에 대한 로컬 테스트.
- `scripts/qa_course_isolation.mjs`: 실제 수업 자료와 연결하지 않은 임시 DB에서 교수자 2명·학생 1명을 만들고 수동 평가 및 현재 다과목 구조의 한계를 진단한다. 계정·DB는 끝나면 제거한다.

```sh
python3 scripts/canvas_student_qa.py --env-file /path/to/existing-private.env --term '2026년 2학기'
python3 -m unittest discover -s scripts -p 'test_canvas_*.py' -v
node scripts/qa_course_isolation.mjs
npm test
```

## QA 결론

개인 학생 계정의 과목별 조회 가능성을 실제 API로 확인했다. 요청한 관리 권한은 없었다. 이것은 공개 앱의 Canvas OAuth/LTI 연동 완료나 학교 제출·성적 변경 테스트를 의미하지 않는다. 보고서는 원문·점수·토큰을 보관하지 않고 ID 검증 결과와 과제 개수만 기록한다.

문연은 아직 과제 설정 한 건과 학생당 제출물 한 건을 공유하는 구조다. 예시 과목 B 설정으로 A 설정이 바뀌고, 다른 교수자가 같은 제출물에 접근하며, A 제출 후 B 제출도 중복 제출로 막히는 것을 재현했다. 현재는 여러 과목이나 서로 다른 교수자를 한 인스턴스에서 분리 운영할 수 없다.

필요한 변경은 강좌·과제·수강 등록·담당 교수자 테이블, 외부 Canvas ID와 로컬 ID의 분리, `(assignment_id, student_id)` 제출 고유 조건, 모든 API의 강좌별 접근 제어다. UI의 과목 선택은 이 저장·권한 모델 뒤에 구현한다.

## 교수자 테스트 계층

| 환경 | 확인할 것 | 한계 |
| --- | --- | --- |
| 문연 예시 교수자 | 지침·제출물 검토·문항·수동 평가·로컬 권한 | Canvas 교수자 권한이나 OAuth 검증이 아님 |
| 별도 Canvas Lite 테스트 강좌 | 교수자 강좌 A/B, 학생 2명, 예시 과제·제출·채점 | API·Developer Key·LTI 기능 제공 범위는 계정에서 확인 필요 |
| 학교 승인 테스트 강좌 | SKKU 실제 역할, OAuth/LTI, 수강 명단, 권한·게시 상태 | 학교의 테스트 교수자·강좌 및 승인된 키가 필요 |

교수자 A는 A 강좌만, 교수자 B는 B 강좌만 관리하게 하고, 미수강 학생·다른 강좌의 제출물 접근이 차단되는지 검증한다. 학생은 본인 공개 결과만 확인해야 한다. 학교 과제 제출·성적 전송은 별도 승인과 시험 범위에서만 수행한다.

학교 학생 계정으로 교수자 계정을 임의 발급하거나 권한을 올릴 수는 없다. Canvas Lite 신규 계정은 [공식 가입 페이지](https://www.instructure.com/try-canvas)에서 만들 수 있지만 개인정보 입력·약관 동의·본인 인증이 필요하므로 이번 읽기 전용 QA에서는 생성하지 않았다. [학교 강좌 생성 권한 안내](https://community.instructure.com/en/kb/articles/660756-how-do-i-create-a-new-course-from-the-dashboard-as-an-instructor)

다중 사용자 서비스는 [Canvas OAuth 정책](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth)에 따라 사용자별 OAuth 인증을 구현해야 한다. 이번 개인 토큰 QA 방식을 여러 사용자의 토큰 입력 서비스로 확장하지 않는다.
