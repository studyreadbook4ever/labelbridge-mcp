# PlayMCP Submit Now

급할 때는 이 순서대로만 진행합니다. 핵심은 Git URL과 MCP Endpoint를 섞지 않는 것입니다.

## 1. Git 소스 빌드 먼저 등록

| 항목 | 입력값 |
| --- | --- |
| MCP 서버 이름 | `labelbridge-mcp` |
| 설명 | `배열 데이터를 추천답변 없는 빈칸 HTML 폼으로 만들고, 사용자가 직접 채운 답안을 1회용 capability로 검증해 dictionary 배열로 회수합니다.` |
| Git URL | `https://github.com/studyreadbook4ever/labelbridge-mcp.git` |
| 브랜치 / ref | `main` |
| Dockerfile 경로 | `Dockerfile` |
| PAT | 비워두기 |

등록 후 목록에서 빌드/배포 상태가 완료될 때까지 기다립니다.

## 2. 배포 완료 후 Endpoint 확인

배포가 끝나면 공개 URL이 생깁니다. MCP Endpoint 칸에는 반드시 그 공개 URL 뒤에 `/mcp`를 붙입니다.

```text
https://배포된-호스트/mcp
```

아래 값들은 넣으면 안 됩니다.

```text
https://github.com/studyreadbook4ever/labelbridge-mcp.git
http://localhost:3000/mcp
https://배포된-호스트
```

`정보 불러오기`가 실패하면 먼저 `/healthz`가 열리는지 확인합니다.

```text
https://배포된-호스트/healthz
```

정상 응답은 아래 형태입니다.

```json
{"ok":true,"name":"labelbridge-mcp","version":"0.1.0"}
```

## 3. 새로운 MCP 서버 등록 값

| 항목 | 입력값 |
| --- | --- |
| 대표 이미지 | `playmcp-representative-image.png` |
| MCP 이름 | `LabelBridge` |
| MCP 식별자 | `labelBridge` |
| MCP 설명 | `추천답변 없이 사람이 직접 채우는 blank-only human labeling MCP입니다. 배열 데이터를 빈칸 HTML 폼으로 만들고, 사용자가 모든 의미 값을 직접 입력하면 MCP가 1회용 capability와 무결성 hash로 검증해 array[dictionary]로 회수합니다. 게임 영웅별 특전 선택, 학생 진로 입력처럼 AI가 임의로 정하면 안 되는 판단을 안전하게 사람에게 맡깁니다.` |
| 대화 예시 1 | `오버워치 영웅별 특전 선택 폼 만들어줘` |
| 대화 예시 2 | `3학년 3반 학생 진로 입력 폼 만들어줘` |
| 대화 예시 3 | `완료 답안을 dictionary 배열로 회수해줘` |
| 인증 방식 | `인증 사용하지 않음` |
| MCP Endpoint | `https://배포된-호스트/mcp` |

대표 이미지 파일은 저장소 루트의 `playmcp-representative-image.png`를 파일 업로드 칸에서 직접 선택합니다.

## 4. 막힐 때 빠른 판별

- 이미지가 안 올라가면 `playmcp-representative-image.png`를 선택합니다. 600x600 PNG입니다.
- Git 빌드가 안 되면 Git URL, branch, Dockerfile 경로만 다시 확인합니다. PAT는 공개 저장소라 비워둡니다.
- Endpoint 정보 불러오기가 안 되면 GitHub URL을 넣은 것이 아닌지 확인합니다. Endpoint는 배포 후 생기는 공개 URL입니다.
- `/healthz`는 되는데 `/mcp`가 안 되면 endpoint 끝이 정확히 `/mcp`인지 확인합니다.
- 배포 URL이 `http://`만 보이면 공개 PlayMCP Endpoint에는 `https://` URL이 필요합니다.
- 브라우저나 콘솔에서 먼저 점검하더라도 `/mcp`는 GET SSE probe와 OPTIONS preflight까지 대응합니다.
