# Kakao PlayMCP Form Values

아래 값은 PlayMCP 제출 화면에 바로 붙여 넣는 용도입니다. `MCP Endpoint`만 실제 배포 URL로 바꾸면 됩니다.

## Git 소스 빌드

| 항목 | 입력값 |
| --- | --- |
| MCP 서버 이름 | `labelbridge-mcp` |
| 설명 | `AI가 혼자 판단하기 애매한 배열 데이터를 사람용 HTML 답안지로 만들고, 완료 답안을 1회용 capability로 검증해 dictionary 배열로 회수합니다.` |
| Git URL | `https://github.com/studyreadbook4ever/labelbridge-mcp.git` |
| 브랜치 / ref | `main` |
| Dockerfile 경로 | `Dockerfile` |
| PAT | 공개 저장소면 비워두기 |

## 새로운 MCP 서버 등록

| 항목 | 입력값 |
| --- | --- |
| 팀프로필 이름 | `eff0rtchung` |
| 대표 이미지 | `assets/labelbridge-icon-600.png` |
| MCP 이름 | `LabelBridge` |
| MCP 식별자 | `labelBridge` |
| MCP 설명 | `AI가 혼자 판단하기 애매한 의미 라벨링을 사람에게 잠깐 빌려주는 MCP입니다. 배열 데이터를 설치 없는 HTML 답안지로 만들고, 사용자는 빈칸을 채운 뒤 공유창/복사/파일받기로 답안을 돌려보냅니다. MCP는 결과 JSON을 1회용 capability, AES-GCM, 무결성 hash로 검증해 원본 dictionary 배열에 사람이 채운 semantic label을 붙여 반환합니다.` |
| 대화 예시 1 | `이 목록을 사람용 답안지로 만들어줘` |
| 대화 예시 2 | `완료한 답안을 구조화 데이터로 회수해줘` |
| 대화 예시 3 | `애매한 문장 의미 라벨링 부탁해` |
| 인증 방식 | `인증 사용하지 않음` |
| MCP Endpoint | `https://YOUR_DEPLOYED_HOST/mcp` |

## Semantic 포지셔닝 메모

- `LabelBridge`는 "라벨링 툴"보다 "AI가 사람 판단을 잠깐 빌리는 다리"에 가깝게 읽힙니다.
- 사람은 원본 데이터를 수정하지 않고, `무엇인가요?`, `얼마나 확실한가요?`, `덧붙일 말`만 채웁니다.
- 카카오톡은 의존 인프라가 아니라 친숙한 전달 맥락입니다. 보안은 1회용 capability와 MCP 회수 검증이 담당합니다.
- 결과는 사람이 관리할 표가 아니라 LLM이 바로 사용할 labeled dictionary입니다.

## 배포 전 확인해야 할 값

- `Git URL`: `https://github.com/studyreadbook4ever/labelbridge-mcp.git`
- `MCP Endpoint`: PlayMCP에서 빌드/배포가 끝난 뒤 발급되거나 직접 배포한 공개 URL의 `/mcp` 경로를 넣습니다.
- `대표 이미지`: `assets/labelbridge-icon-600.png`는 600x600 PNG라 업로드 조건에 맞습니다.

Git URL은 `git ls-remote --heads https://github.com/studyreadbook4ever/labelbridge-mcp.git main`으로 공개 접근을 확인했습니다.

## Endpoint 입력 전 확인

배포가 끝난 뒤 아래처럼 확인합니다.

```bash
curl https://YOUR_DEPLOYED_HOST/healthz
```

정상 응답:

```json
{"ok":true,"name":"labelbridge-mcp","version":"0.1.0"}
```

PlayMCP의 `정보 불러오기`는 `/mcp` endpoint를 대상으로 실행합니다.
