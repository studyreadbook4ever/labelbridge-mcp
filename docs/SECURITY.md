# Security Model

LabelBridge는 "파일이 복사되지 않는다"를 보장하지 않습니다. self-contained HTML은 복사될 수 있습니다. 대신 MCP가 결과를 회수할 때 최초 1회의 유효 제출만 받아들이는 capability consume 모델을 사용합니다.

## 보장하는 것

- 유효한 결과 파일은 한 번만 수락됩니다.
- capability token은 256-bit 랜덤 값입니다.
- 서버 DB에는 capability 원문이 아니라 HMAC-SHA256 digest만 저장됩니다.
- 사용자가 내려받는 결과 파일의 라벨 payload는 AES-256-GCM으로 암호화됩니다.
- 결과 payload는 원본 `batch_hash`와 `item_id` 목록에 대해 검증됩니다.
- 결과 payload는 라벨 스키마 hash, 항목 개수, 발급/만료 시각, 항목별 source hash와도 맞아야 합니다.
- 필수 라벨이 비어 있거나, 알 수 없는 항목 ID가 있거나, 중복 항목이 있으면 거부됩니다.
- 결과에 허용되지 않은 라벨 필드가 끼어 있으면 거부됩니다.
- 만료된 세션과 이미 consumed 된 세션은 거부됩니다.
- consume은 SQLite `BEGIN IMMEDIATE` transaction 안에서 처리됩니다.

## 보장하지 않는 것

- HTML 파일 안에 표시되는 원본 데이터의 비밀성은 보장하지 않습니다. 사용자가 라벨링하려면 원본을 볼 수 있어야 합니다.
- capability가 포함된 결과 파일을 누군가 먼저 훔쳐 제출하면, 그 제출이 최초 제출로 소비될 수 있습니다.
- 사용자의 기기, 브라우저, 메신저, 클라우드 드라이브 자체가 악성인 경우는 방어하지 않습니다.
- HTML 파일을 열었던 브라우저가 메모리나 다운로드 파일을 얼마나 오래 보관하는지는 통제하지 않습니다.

## 주요 방어선

1. One-time capability
   - `create_labeling_session`은 세션마다 32바이트 랜덤 token을 만듭니다.
   - 서버는 `HMAC-SHA256(token, serverSecret)`만 저장합니다.
   - `ingest_labeling_result`는 결과 파일의 token으로 digest를 재계산합니다.

2. Atomic consume
   - 제출이 유효하면 transaction 안에서 `status = issued`인 행만 `consumed`로 바꿉니다.
   - 같은 세션을 동시에 두 번 제출해도 DB update row count가 1인 요청만 성공합니다.

3. Result encryption
   - HTML은 브라우저 Web Crypto API로 결과 payload를 AES-GCM 암호화합니다.
   - 서버는 세션별 result key로만 복호화합니다.
   - 다운로드된 결과 파일을 단순 열람해도 라벨 본문은 보이지 않습니다.

4. Data integrity
   - 원본 데이터, 라벨 스키마, task description으로 `batch_hash`를 만듭니다.
   - 라벨 스키마는 별도 `schema_hash`로 검증합니다.
   - 각 항목은 `item_hash = sha256({ id, index, source })`로 검증합니다.
   - ingest 시 batch hash, schema hash, session id, item id, item hash, label schema를 모두 검증합니다.
   - 서버는 결과 파일의 원본 데이터를 신뢰하지 않고 DB에 저장된 원본과 합칩니다.

5. HTML safety
- 외부 script, image, connect, form action을 CSP로 차단합니다.
- 동적 데이터는 JSON script embedding 시 `<`, `>`, `&`를 escape합니다.
- 화면 렌더링은 `textContent`를 사용해 HTML injection을 피합니다.
- 폼은 원본을 "판단 대상 / 맥락 / 세부정보"로 나눠 보여줘 실수로 엉뚱한 값을 라벨링할 가능성을 낮춥니다.

## 운영 권장

- 배포 시 프록시가 `Host`/`X-Forwarded-*` 헤더를 전달하지 않는다면 `PUBLIC_BASE_URL`을 실제 HTTPS URL로 설정하세요.
- 운영 서버에는 긴 `LABELBRIDGE_SECRET`을 환경 변수로 지정하세요.
- `DATA_DIR`은 외부에서 다운로드할 수 없는 경로로 두세요.
- 프록시 뒤에서 운영하면 `ALLOWED_HOSTS=example.com`처럼 Host allowlist를 설정하세요.
- 민감한 개인정보가 포함된 원본 데이터는 최소 필드만 전달하세요.
