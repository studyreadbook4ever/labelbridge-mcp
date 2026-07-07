# LabelBridge MCP

[![CI](https://github.com/studyreadbook4ever/labelbridge-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/studyreadbook4ever/labelbridge-mcp/actions/workflows/ci.yml)

AI가 처리하기 애매한 의미 판단을, 비전문가가 HTML 하나로 빠르게 채워 넣게 만들고, 그 결과를 다시 MCP가 AI-native structured context로 회수하는 human-in-the-loop labeling bridge입니다.

## 핵심 아이디어

LabelBridge는 LLM이 바로 판단하기 애매한 semantic labeling 작업을 사람에게 잠깐 빌려줍니다. MCP는 데이터 배열을 받아 self-contained HTML 설문지를 만들고, 사용자는 그 HTML에서 빈칸을 채운 뒤 답안을 돌려보냅니다. MCP는 이 결과를 다시 받아 원본 dictionary 배열에 라벨을 붙여 반환합니다.

카카오톡, 이메일, 드라이브, USB 같은 경로는 설문지를 옮기는 사용 맥락일 뿐입니다. 보안과 1회성은 플랫폼이 아니라 LabelBridge MCP의 one-time capability가 담당합니다.

완료 순간에는 파일을 직접 찾아 헤매지 않도록 먼저 OS 공유창을 열어 답안을 보낼 수 있게 했습니다. 공유창이 지원되지 않는 환경에서는 같은 화면에서 답안 내용 복사와 답안 파일 받기로 바로 이어집니다.

## 제공 도구

- `create_labeling_session`
  - 배열 형태의 데이터를 받아 라벨링 HTML URL과 다운로드 URL을 만듭니다.
  - 세션마다 256-bit capability와 AES-GCM 결과 암호화 키를 발급합니다.

- `ingest_labeling_result`
  - 사용자가 HTML에서 내려받은 JSON 전체를 입력받습니다.
  - 결과를 복호화하고 원본 batch hash, schema hash, item hash, item id, 필수 라벨, 만료 시간을 검증합니다.
  - 최초 1회만 SQLite transaction으로 세션을 `consumed` 처리하고 dictionary 배열을 반환합니다.

- `inspect_labeling_session`
  - capability나 라벨 원문을 노출하지 않고 세션 상태를 확인합니다.

## 빠른 실행

```bash
npm install
npm run build
PORT=3000 HOST=0.0.0.0 npm start
```

MCP endpoint는 다음입니다.

```text
http://localhost:3000/mcp
```

배포 환경에서는 기본적으로 `Host`/`X-Forwarded-*` 헤더에서 공개 URL을 추론합니다. 프록시가 해당 헤더를 전달하지 않는 환경에서만 `PUBLIC_BASE_URL=https://YOUR_DEPLOYED_HOST`를 명시하세요.

## 스모크 테스트

서버를 켠 뒤 다른 터미널에서 실행합니다.

```bash
SMOKE_MCP_URL=http://127.0.0.1:3000/mcp npm run smoke
```

테스트 전체:

```bash
npm run typecheck
npm test
npm run build
```

실제 MCP 왕복 테스트:

```bash
npm run build
PORT=3000 HOST=127.0.0.1 npm start
SMOKE_MCP_URL=http://127.0.0.1:3000/mcp npm run full-loop
```

데모 설문 URL만 만들기:

```bash
MCP_URL=http://127.0.0.1:3000/mcp npm run demo-form
```

GitHub Actions CI는 `npm ci`, typecheck, test, build, audit, Docker build, 컨테이너 `/healthz`, 컨테이너 MCP full-loop, PlayMCP tool metadata audit까지 확인합니다.

배포된 endpoint가 나오면 다음으로 공개 URL 계약을 한 번에 확인할 수 있습니다.

```bash
MCP_ENDPOINT=https://YOUR_DEPLOYED_HOST/mcp npm run check:endpoint
```

## Docker

PlayMCP의 Git 소스 빌드 화면에서 이 저장소의 `Dockerfile`을 사용하면 됩니다.

```bash
docker build -t labelbridge-mcp .
docker run --rm -p 3000:3000 \
  -e LABELBRIDGE_SECRET=replace-with-a-long-random-secret \
  labelbridge-mcp
```

대표 이미지는 [assets/labelbridge-icon-600.png](assets/labelbridge-icon-600.png)를 사용하세요.

## 사용 예시

`create_labeling_session` 입력 예시:

```json
{
  "task_title": "전자제품 사진 라벨링",
  "task_description": "각 항목을 보고 의미 라벨을 짧게 채워 주세요.",
  "items": [
    {
      "id": "photo_001",
      "source": "카카오톡 나에게 보내기로 옮긴 에어컨 사진",
      "hint": "전자제품"
    },
    {
      "id": "memo_002",
      "source": "회의 녹취 요약 문장",
      "hint": "문서"
    }
  ],
  "expires_in_minutes": 1440
}
```

`ingest_labeling_result`는 HTML에서 공유, 복사, 또는 다운로드한 JSON 전체를 `result_json`에 넣습니다. 성공하면 이런 구조를 반환합니다.

```json
{
  "accepted": true,
  "labeled_data": [
    {
      "id": "photo_001",
      "source": "카카오톡 나에게 보내기로 옮긴 에어컨 사진",
      "hint": "전자제품",
      "labels": {
        "label": "air_conditioner",
        "confidence": "high"
      },
      "_labelbridge": {
        "session_id": "...",
        "batch_hash": "...",
        "schema_hash": "...",
        "item_hash": "...",
        "consumed_at": "...",
        "item_index": 0
      }
    }
  ]
}
```

## 보안 모델

LabelBridge의 1회성은 HTML 파일 자체가 아니라 MCP 회수 단계에서 보장됩니다.

- 세션마다 256-bit bearer capability를 생성합니다.
- 서버는 capability 원문을 저장하지 않고 `HMAC-SHA256(capability)` digest만 저장합니다.
- 결과 파일은 브라우저에서 AES-256-GCM으로 암호화됩니다.
- 복호화된 payload는 schema hash, item count, issued/expires timestamp, per-item source hash와 맞아야 합니다.
- 첫 번째 유효 제출만 SQLite `BEGIN IMMEDIATE` transaction 안에서 `issued -> consumed`로 바뀝니다.
- 같은 결과 파일 재제출, batch hash 불일치, schema/item hash 불일치, 알 수 없는 item id, extra label field, 필수 라벨 누락, 만료 세션은 거부됩니다.
- HTML은 외부 네트워크 연결을 하지 않으며 CSP로 외부 리소스를 막습니다.

자세한 threat model은 [docs/SECURITY.md](docs/SECURITY.md)를 보세요.

## PlayMCP 제출 포인트

- 창의성: 일상적인 파일 전달 습관을 MCP 기반 human-in-the-loop 라벨링 루프로 바꿉니다.
- 편의성: 비전문가가 설치 없이 HTML 하나로 라벨링할 수 있습니다.
- 회수 UX: 완료 직후 답안 보내기로 공유창을 열고, 안 되면 복사/파일받기로 끝냅니다.
- 안정성: capability digest, AES-GCM, batch/schema/item hash, strict payload 검증, 원자적 consume을 기본 설계에 포함했습니다.

제출용 문구와 데모 시나리오는 [docs/PLAYMCP_SUBMISSION.md](docs/PLAYMCP_SUBMISSION.md)에, 실제 입력 필드는 [docs/KAKAO_FORM_VALUES.md](docs/KAKAO_FORM_VALUES.md)에 정리되어 있습니다.
