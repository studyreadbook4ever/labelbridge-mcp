# PlayMCP Submission Draft

## 서비스명

LabelBridge MCP

## 한 줄 소개

AI가 애매해하는 의미 판단을 사람이 HTML 하나로 채우고, MCP가 1회용 capability로 안전하게 회수해 dictionary 배열로 돌려주는 human-in-the-loop labeling bridge.

## 상세 소개

LabelBridge MCP는 데이터 배열을 입력받아 비전문가도 바로 작성할 수 있는 self-contained HTML 라벨링 설문지를 생성합니다. 사용자는 카카오톡 `나에게 보내기`, 이메일, 드라이브 등 익숙한 파일 이동 경로로 HTML을 옮겨 열고, 각 항목의 빈칸을 채운 뒤 답안 보내기를 누릅니다.

완료된 답안은 먼저 OS 공유창으로 돌려보낼 수 있고, 공유가 어려운 환경에서는 같은 화면에서 답안 내용 복사나 답안 파일 받기로 이어집니다. 그 결과를 다시 MCP에 넣으면 서버는 capability token, batch hash, schema hash, item hash, item id, 필수 라벨, 만료 시간을 검증하고, 최초 1회만 결과를 수락합니다. 성공 시 원본 dictionary 배열에 사람의 semantic label을 붙인 AI-native structured context를 반환합니다.

## 왜 MCP인가

일반 라벨링 도구는 사람이 주체이고 AI가 보조입니다. LabelBridge는 반대로 AI/Agent가 주체가 되어 "지금 이 데이터에서 사람 판단이 필요한 부분"만 설문지로 빌려주고, 사람이 채운 의미 판단을 다시 MCP context로 회수합니다.

즉, 사람은 UI를 따로 배울 필요 없이 HTML 답안지만 채우고 보내며, LLM은 그 결과를 바로 사용할 수 있는 구조화 데이터로 받습니다.

## Semantic 설계 관점

LabelBridge에서 사람은 데이터 관리자가 아니라 의미 판단을 잠깐 맡는 annotator입니다. 원본 배열, item id, schema, item hash는 MCP가 고정하고, 사람은 `무엇인가요?`, `얼마나 확실한가요?`, `덧붙일 말` 같은 semantic slot만 채웁니다.

카카오톡은 서버나 인증 인프라가 아니라 답안지를 옮기는 생활 맥락입니다. 같은 HTML을 메일, 드라이브, USB로 옮겨도 보안 모델은 바뀌지 않으며, 최초 1회의 유효 답안만 MCP가 회수합니다.

그래서 결과물은 사람용 TSV/CSV가 아니라 AI가 바로 추론에 쓸 수 있는 labeled dictionary입니다. 사람이 입력한 값은 원본 dictionary를 덮어쓰지 않고 `labels`와 `_labelbridge` metadata로 붙기 때문에, LLM은 원문과 사람 판단, 검증 정보를 함께 사용할 수 있습니다.

## 대표 사용 시나리오

1. LLM이 분류하기 애매한 문장/사진 설명/메모 목록을 발견합니다.
2. LLM이 `create_labeling_session`으로 라벨링 HTML을 만듭니다.
3. 사용자는 HTML을 카카오톡 `나에게 보내기` 같은 익숙한 경로로 옮깁니다.
4. 사용자는 항목별 빈칸을 채우고 답안 보내기를 누릅니다.
5. LLM이 `ingest_labeling_result`로 JSON을 회수합니다.
6. MCP는 최초 제출만 수락하고 dictionary 배열을 반환합니다.

## 심사 기준 대응

### 창의성

- 카카오톡을 기술 의존성이 아니라 생활 속 파일 전달 맥락으로 사용합니다.
- "사람이 라벨링 시스템에 들어간다"가 아니라 "MCP가 사람의 의미 판단을 잠깐 빌린다"는 모델입니다.
- 원본 데이터는 MCP가 고정하고, 사람은 semantic slot만 채우는 역할 분리가 명확합니다.
- Rust의 borrow처럼 1회용 capability를 발급하고 회수하는 구조를 라벨링 워크플로에 적용했습니다.

### 편의성

- 별도 앱 설치 없이 HTML 하나로 작동합니다.
- 한 번에 한 항목만 보여주고, 원본을 `판단 대상 / 맥락 / 세부정보`로 나눠 오입력을 줄입니다.
- 필수 입력이 비어 있으면 다음 단계로 넘어가지 못합니다.
- 완료 직후 공유창을 열고, 안 되면 복사/파일받기로 같은 화면에서 마무리합니다.
- 결과는 TSV/CSV가 아니라 LLM이 바로 쓰기 쉬운 dictionary 배열로 반환됩니다.

### 안정성/보안

- 256-bit one-time capability
- capability 원문 미저장, HMAC-SHA256 digest 저장
- AES-256-GCM 결과 파일 암호화
- batch hash 검증
- schema hash와 per-item source hash 검증
- strict payload schema 및 extra field 거부
- 원자적 `issued -> consumed` transaction
- replay, expired session, schema mismatch, unknown item id 거부
- self-contained HTML의 외부 네트워크 연결 차단

## PlayMCP 등록 정보

- MCP endpoint: `https://YOUR_DEPLOYED_HOST/mcp`
- Health check: `https://YOUR_DEPLOYED_HOST/healthz`
- Transport: Streamable HTTP
- Runtime: Node.js 24+
- MCP Inspector CLI precheck: `tools/list`, `create_labeling_session`, 정제된 tool error, forwarded HTTPS URL inference 확인
- Environment:
  - `PORT`
  - `HOST`
  - `PUBLIC_BASE_URL` 선택. 프록시가 `Host`/`X-Forwarded-*` 헤더를 전달하지 않을 때만 실제 공개 HTTPS URL로 지정합니다.
  - `DATA_DIR`
  - `LABELBRIDGE_SECRET` 권장

제출 화면에 넣을 값은 [PLAYMCP_FORM_VALUES.md](./PLAYMCP_FORM_VALUES.md)에 정리되어 있습니다.

## 데모 프롬프트

```text
다음 데이터를 비전문가에게 의미 라벨링 맡길 수 있는 설문지로 만들어줘.

[
  {"id":"transfer_001","text":"나에게 보내기로 옮긴 에어컨 사진","hint":"전자제품"},
  {"id":"memo_002","text":"회의 녹취 중 고객 불만 요약","hint":"업무 메모"},
  {"id":"img_003","text":"영수증으로 보이는 흐릿한 사진","hint":"문서 이미지"}
]
```

그 다음 HTML에서 생성된 결과 JSON을 `ingest_labeling_result`에 넣으면, 다음처럼 원본 데이터에 사람이 채운 라벨이 붙어 돌아옵니다.

```json
[
  {
    "id": "transfer_001",
    "text": "나에게 보내기로 옮긴 에어컨 사진",
    "hint": "전자제품",
    "labels": {
      "label": "air_conditioner",
      "confidence": "high"
    }
  }
]
```

## 공모전 제출 체크리스트

- [x] GitHub 저장소 생성 및 `main` branch push
- [x] `git ls-remote --heads https://github.com/studyreadbook4ever/labelbridge-mcp.git main`으로 PlayMCP가 clone할 수 있는지 확인
- [x] GitHub Actions에서 npm 검증, Docker build, 컨테이너 `/healthz`, 컨테이너 MCP full-loop, PlayMCP tool metadata audit 확인
- [x] MCP Inspector CLI로 Streamable HTTP `tools/list`, tool call, error 응답, forwarded HTTPS URL 추론 확인
- [ ] 접근 가능한 HTTPS 환경에 서버 배포
- [ ] 배포 URL이 `/healthz`와 `/mcp`로 접근되는지 `MCP_ENDPOINT=https://YOUR_DEPLOYED_HOST/mcp npm run check:endpoint`로 확인. 응답속도는 `MCP_ENDPOINT=https://YOUR_DEPLOYED_HOST/mcp npm run check:latency`로 확인. 필요할 때만 `PUBLIC_BASE_URL`을 실제 공개 URL로 설정
- [ ] PlayMCP 개발자 콘솔에서 `/mcp` endpoint 등록
- [ ] 임시 등록으로 도구 호출 테스트
- [ ] 최종 제출 전 `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke` 실행
- [ ] 심사 요청 후 공개 상태를 전체 공개로 변경
- [ ] 공모전 페이지에서 Player 예선 참여 제출
