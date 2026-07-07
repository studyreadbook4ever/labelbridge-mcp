import type { LabelField, LabelingSession, NormalizedItem } from "./types.js";
import { safeJsonForScript } from "./canonical.js";
import { itemSourceHash, labelSchemaHash } from "./integrity.js";

export interface RenderFormParams {
  session: LabelingSession;
  items: NormalizedItem[];
  capabilityToken: string;
}

export function renderLabelingForm(params: RenderFormParams): string {
  const data = {
    type: "labelbridge.form.v1",
    form_version: "0.1.0",
    session: {
      session_id: params.session.sessionId,
      batch_hash: params.session.batchHash,
      task_title: params.session.taskTitle,
      task_description: params.session.taskDescription,
      issued_at: params.session.issuedAt,
      expires_at: params.session.expiresAt,
      schema_hash: labelSchemaHash(params.session.labelFields),
    },
    capability_token: params.capabilityToken,
    result_key: params.session.resultKey,
    label_fields: params.session.labelFields,
    items: params.items.map((item) => ({
      id: item.id,
      index: item.index,
      item_hash: itemSourceHash(item),
      display: item.display,
    })),
  };

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'">
  <meta name="referrer" content="no-referrer">
  <title>LabelBridge</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #14231f;
      --muted: #5d6864;
      --line: #d8ddd6;
      --paper: #ffffff;
      --field: #fbfcff;
      --wash: #eef3f0;
      --green: #007e68;
      --green-dark: #005846;
      --blue: #215f9a;
      --blue-wash: #eaf2fb;
      --amber: #f5c542;
      --red: #b7442e;
      --red-wash: #fff0ec;
      --focus: #1e7fd8;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--wash);
      color: var(--ink);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      line-height: 1.45;
    }
    .shell {
      width: min(1040px, 100%);
      margin: 0 auto;
      padding: 20px;
    }
    header {
      display: grid;
      gap: 10px;
      padding: 18px 0 14px;
    }
    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    .task {
      margin: 0;
      color: var(--muted);
      max-width: 72ch;
    }
    .meter {
      display: grid;
      gap: 8px;
      margin-top: 8px;
    }
    .meter-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-size: 14px;
    }
    progress {
      width: 100%;
      height: 12px;
      border: 0;
      border-radius: 999px;
      overflow: hidden;
      background: #dbe5df;
    }
    progress::-webkit-progress-bar { background: #dbe5df; }
    progress::-webkit-progress-value { background: var(--green); }
    progress::-moz-progress-bar { background: var(--green); }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
    }
    .workbench {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 10px 30px rgba(20, 35, 31, 0.08);
      overflow: hidden;
    }
    .item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid var(--line);
      background: #eaf6f1;
    }
    .item-kicker {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
    }
    .item-id {
      max-width: 48%;
      overflow-wrap: anywhere;
      color: var(--muted);
      font-size: 13px;
      text-align: right;
    }
    .item-state {
      display: inline-grid;
      place-items: center;
      min-height: 30px;
      padding: 4px 10px;
      border: 1px solid #c8d8d1;
      border-radius: 8px;
      background: #fff;
      color: var(--green-dark);
      font-size: 13px;
      font-weight: 900;
      white-space: nowrap;
    }
    .content {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
      gap: 0;
    }
    .source {
      padding: 18px;
      border-right: 1px solid var(--line);
    }
    .source h2,
    .answer h2 {
      margin: 0 0 12px;
      font-size: 16px;
      letter-spacing: 0;
    }
    .semantic-lead {
      display: grid;
      gap: 6px;
      margin-bottom: 14px;
      padding: 16px;
      border: 2px solid #b9d5cb;
      border-radius: 8px;
      background: #f7fbf9;
    }
    .semantic-key {
      color: var(--muted);
      font-size: 12px;
      font-weight: 850;
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }
    .semantic-value {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 22px;
      line-height: 1.35;
      font-weight: 850;
    }
    .context-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }
    .context-chip {
      max-width: 100%;
      padding: 7px 10px;
      border: 1px solid #cad7d0;
      border-radius: 8px;
      background: #f1f6f4;
      color: #26463d;
      font-size: 13px;
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .detail-title {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 850;
    }
    dl {
      display: grid;
      gap: 10px;
      margin: 0;
    }
    .kv {
      display: grid;
      gap: 4px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e4ebe7;
    }
    dt {
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    dd {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-size: 17px;
    }
    .answer {
      padding: 18px;
      background: #f8faf9;
    }
    .answer-prompt {
      margin: -4px 0 14px;
      padding: 10px 12px;
      border: 1px solid #c7d6e5;
      border-radius: 8px;
      background: var(--blue-wash);
      color: #163d62;
      font-weight: 850;
      overflow-wrap: anywhere;
    }
    form {
      display: grid;
      gap: 14px;
    }
    .field {
      display: grid;
      gap: 7px;
      padding: 10px;
      border: 1px solid transparent;
      border-radius: 8px;
    }
    .field.required {
      background: #fff;
      border-color: #e0e7e2;
    }
    .field.invalid {
      background: var(--red-wash);
      border-color: var(--red);
    }
    label,
    legend {
      font-weight: 800;
      font-size: 14px;
    }
    .hint {
      color: var(--muted);
      font-size: 13px;
    }
    input[type="text"],
    input[type="number"],
    textarea,
    select {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid #c7cec6;
      border-radius: 8px;
      background: var(--field);
      color: var(--ink);
      font: inherit;
    }
    textarea {
      min-height: 108px;
      resize: vertical;
    }
    input:focus,
    textarea:focus,
    select:focus,
    button:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--focus) 35%, transparent);
      outline-offset: 2px;
    }
    fieldset {
      margin: 0;
      padding: 0;
      border: 0;
      display: grid;
      gap: 8px;
    }
    .choices {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
      gap: 8px;
    }
    .choice {
      display: grid;
      min-height: 42px;
      align-items: center;
      justify-items: center;
      padding: 8px 10px;
      border: 1px solid #c7cec6;
      border-radius: 8px;
      background: #fff;
      cursor: pointer;
      text-align: center;
      font-weight: 750;
      overflow-wrap: anywhere;
    }
    .choice input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .choice:has(input:checked) {
      background: var(--green);
      border-color: var(--green-dark);
      color: #fff;
    }
    .error {
      display: none;
      color: var(--red);
      font-size: 13px;
      font-weight: 700;
    }
    .field.invalid .error { display: block; }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      padding: 14px 18px;
      border-top: 1px solid var(--line);
      background: #ffffff;
    }
    .finish-row {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
    }
    .status {
      min-height: 22px;
      color: var(--muted);
      font-size: 14px;
      overflow-wrap: anywhere;
    }
    .handoff {
      display: none;
      margin: 14px 18px 18px;
      padding: 16px;
      border: 2px solid #b38a19;
      border-radius: 8px;
      background: #fff8dd;
    }
    .handoff.visible {
      display: grid;
      gap: 10px;
    }
    .handoff-title {
      margin: 0;
      font-size: 18px;
      font-weight: 900;
      color: #241a00;
    }
    .handoff-file {
      display: grid;
      gap: 3px;
      padding: 10px 12px;
      border: 1px solid #d8bc5b;
      border-radius: 8px;
      background: #fffdf2;
      overflow-wrap: anywhere;
    }
    .handoff-file span:first-child {
      color: #6f5b16;
      font-size: 12px;
      font-weight: 900;
    }
    .handoff-file span:last-child {
      font-weight: 850;
    }
    .handoff-note {
      margin: 0;
      color: #5b4a12;
      font-weight: 750;
    }
    .handoff-steps {
      margin: 0;
      padding-left: 20px;
      color: #5b4a12;
      font-weight: 750;
    }
    .handoff-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    button {
      min-height: 44px;
      border: 1px solid #b8c1b8;
      border-radius: 8px;
      background: #fff;
      color: var(--ink);
      font: inherit;
      font-weight: 850;
      cursor: pointer;
    }
    button.primary {
      border-color: var(--green-dark);
      background: var(--green);
      color: #fff;
    }
    button.warning {
      border-color: #b38a19;
      background: var(--amber);
      color: #241a00;
    }
    button.share {
      border-color: var(--green-dark);
      background: var(--green);
      color: #fff;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
    .expiry {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 13px;
    }
    @media (max-width: 760px) {
      .shell { padding: 14px; }
      h1 { font-size: 24px; }
      .content { grid-template-columns: 1fr; }
      .source { border-right: 0; border-bottom: 1px solid var(--line); }
      .item-head { align-items: flex-start; flex-direction: column; }
      .item-id { max-width: 100%; text-align: left; }
      .actions { grid-template-columns: 1fr; }
      .finish-row { grid-template-columns: 1fr; }
      .semantic-value { font-size: 19px; }
      .handoff { margin: 12px 14px 14px; }
      .handoff-actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <h1 id="title">LabelBridge</h1>
      <p id="description" class="task"></p>
      <div class="meter" aria-live="polite">
        <div class="meter-row">
          <span id="counter"></span>
          <span id="completeCount"></span>
        </div>
        <progress id="progress" value="0" max="1"></progress>
      </div>
    </header>
    <main>
      <section class="workbench" aria-labelledby="itemTitle">
        <div class="item-head">
          <p id="itemTitle" class="item-kicker"></p>
          <span id="itemState" class="item-state"></span>
          <span id="itemId" class="item-id"></span>
        </div>
        <div class="content">
          <section class="source" aria-labelledby="sourceTitle">
            <h2 id="sourceTitle">판단 대상</h2>
            <div id="semanticLead" class="semantic-lead"></div>
            <div id="contextList" class="context-list"></div>
            <h3 id="detailTitle" class="detail-title">세부정보</h3>
            <dl id="sourceList"></dl>
          </section>
          <section class="answer" aria-labelledby="answerTitle">
            <h2 id="answerTitle">답하기</h2>
            <p id="answerPrompt" class="answer-prompt"></p>
            <form id="answerForm" novalidate></form>
          </section>
        </div>
        <div class="actions">
          <button id="prevButton" type="button">이전 항목</button>
          <button id="nextButton" class="primary" type="button">저장하고 다음</button>
          <div class="finish-row">
            <div id="status" class="status" role="status"></div>
            <button id="finishButton" class="warning" type="button">답안 보내기</button>
          </div>
        </div>
        <section id="handoff" class="handoff" aria-live="polite">
          <p class="handoff-title">답안이 준비됐습니다</p>
          <div class="handoff-file">
            <span>파일 이름</span>
            <span id="handoffFilename"></span>
          </div>
          <ol class="handoff-steps">
            <li>아래의 답안 보내기를 누릅니다.</li>
            <li>카톡, 대화방, 메일 중 하나를 고릅니다.</li>
            <li>그대로 보내면 끝입니다.</li>
          </ol>
          <p class="handoff-note">공유창이 안 뜨면 복사하거나 파일로 받으면 됩니다.</p>
          <div class="handoff-actions">
            <button id="shareButton" class="share" type="button">답안 보내기</button>
            <button id="copyButton" type="button">답안 내용 복사</button>
            <button id="retryDownloadButton" type="button">답안 파일 받기</button>
          </div>
        </section>
      </section>
      <p id="expiry" class="expiry"></p>
    </main>
  </div>
  <script>
    const DATA = ${safeJsonForScript(data)};

    const state = {
      current: 0,
      exported: false,
      lastEnvelope: null,
      lastFilename: "",
      lastJsonText: "",
      answers: DATA.items.map(() => Object.fromEntries(DATA.label_fields.map((field) => [field.id, emptyAnswerValue(field)]))),
    };

    const el = {
      title: document.getElementById("title"),
      description: document.getElementById("description"),
      counter: document.getElementById("counter"),
      completeCount: document.getElementById("completeCount"),
      progress: document.getElementById("progress"),
      itemTitle: document.getElementById("itemTitle"),
      itemState: document.getElementById("itemState"),
      itemId: document.getElementById("itemId"),
      semanticLead: document.getElementById("semanticLead"),
      contextList: document.getElementById("contextList"),
      detailTitle: document.getElementById("detailTitle"),
      sourceList: document.getElementById("sourceList"),
      answerForm: document.getElementById("answerForm"),
      answerPrompt: document.getElementById("answerPrompt"),
      prevButton: document.getElementById("prevButton"),
      nextButton: document.getElementById("nextButton"),
      finishButton: document.getElementById("finishButton"),
      handoff: document.getElementById("handoff"),
      handoffFilename: document.getElementById("handoffFilename"),
      shareButton: document.getElementById("shareButton"),
      copyButton: document.getElementById("copyButton"),
      retryDownloadButton: document.getElementById("retryDownloadButton"),
      status: document.getElementById("status"),
      expiry: document.getElementById("expiry"),
    };

    el.title.textContent = DATA.session.task_title;
    el.description.textContent = DATA.session.task_description;
    el.expiry.textContent = "만료: " + new Date(DATA.session.expires_at).toLocaleString();
    el.prevButton.addEventListener("click", () => move(-1));
    el.nextButton.addEventListener("click", () => move(1));
    el.finishButton.addEventListener("click", exportResult);
    el.shareButton.addEventListener("click", shareAnswer);
    el.copyButton.addEventListener("click", copyAnswer);
    el.retryDownloadButton.addEventListener("click", () => {
      if (state.lastEnvelope && state.lastFilename) downloadJson(state.lastEnvelope, state.lastFilename);
    });

    render();

    function emptyAnswerValue(field) {
      if (field.type === "multi_select") return [];
      if (field.type === "boolean") return null;
      if (field.type === "number") return null;
      return "";
    }

    function render() {
      const item = DATA.items[state.current];
      const parts = semanticParts(item.display);
      el.itemTitle.textContent = "항목 " + (state.current + 1) + " / " + DATA.items.length;
      el.itemState.textContent = isAnswerComplete(state.answers[state.current]) ? "작성됨" : "작성 전";
      el.itemId.textContent = item.id;
      el.answerPrompt.textContent = "이 항목을 사람 말로 무엇이라 부를까요?";
      el.semanticLead.replaceChildren(semanticKey(parts.primary[0]), semanticValue(parts.primary[1]));
      el.contextList.replaceChildren(...parts.context.map(([key, value]) => contextChip(key, value)));
      el.contextList.hidden = parts.context.length === 0;
      el.detailTitle.hidden = parts.details.length === 0;
      el.sourceList.hidden = parts.details.length === 0;
      el.sourceList.replaceChildren(...parts.details.map(([key, value]) => {
        const row = document.createElement("div");
        row.className = "kv";
        const dt = document.createElement("dt");
        dt.textContent = friendlyKey(key);
        const dd = document.createElement("dd");
        dd.textContent = formatValue(value);
        row.append(dt, dd);
        return row;
      }));

      el.answerForm.replaceChildren(...DATA.label_fields.map((field) => renderField(field, state.answers[state.current])));
      updateControls();
      const focusable = el.answerForm.querySelector("input:not([type=radio]):not([type=checkbox]), textarea, select");
      if (focusable) focusable.focus();
    }

    function semanticParts(display) {
      const entries = Object.entries(display);
      const primaryKeys = ["text", "source", "content", "description", "title", "message", "question", "name", "value"];
      const primary = entries.find(([key]) => primaryKeys.includes(key.toLowerCase())) ?? entries[0] ?? ["value", ""];
      const primaryKey = primary[0];
      const contextPattern = /(hint|category|context|type|tag|topic|intent|memo|note|domain|source)/i;
      const context = [];
      const details = [];
      for (const entry of entries) {
        const [key] = entry;
        if (key === primaryKey) continue;
        if (context.length < 5 && contextPattern.test(key)) {
          context.push(entry);
        } else {
          details.push(entry);
        }
      }
      return { primary, context, details };
    }

    function semanticKey(value) {
      const node = document.createElement("div");
      node.className = "semantic-key";
      node.textContent = friendlyKey(value);
      return node;
    }

    function semanticValue(value) {
      const node = document.createElement("div");
      node.className = "semantic-value";
      node.textContent = formatValue(value);
      return node;
    }

    function contextChip(key, value) {
      const node = document.createElement("div");
      node.className = "context-chip";
      node.textContent = friendlyKey(key) + ": " + compactValue(value);
      return node;
    }

    function friendlyKey(key) {
      const normalized = String(key).toLowerCase();
      const labels = {
        text: "내용",
        source: "내용",
        content: "내용",
        description: "설명",
        title: "제목",
        message: "메시지",
        question: "질문",
        name: "이름",
        value: "값",
        hint: "힌트",
        category: "분류",
        category_hint: "분류 힌트",
        context: "맥락",
        type: "종류",
        tag: "태그",
        tags: "태그",
        topic: "주제",
        intent: "의도",
        memo: "메모",
        note: "메모",
        domain: "분야",
        source_app: "출처",
      };
      return labels[normalized] ?? String(key).replace(/_/g, " ");
    }

    function renderField(field, answer) {
      const wrapper = document.createElement("div");
      wrapper.className = "field";
      if (field.required) wrapper.classList.add("required");
      wrapper.dataset.fieldId = field.id;

      if (field.type === "select" || field.type === "multi_select" || field.type === "boolean") {
        const set = document.createElement("fieldset");
        const legend = document.createElement("legend");
        legend.textContent = field.label + (field.required ? " *" : "");
        set.append(legend);
        if (field.description) set.append(hint(field.description));
        const choices = document.createElement("div");
        choices.className = "choices";
        const options = field.type === "boolean"
          ? [{ value: true, label: "예" }, { value: false, label: "아니오" }]
          : field.options;
        for (const option of options) {
          const choice = document.createElement("label");
          choice.className = "choice";
          const input = document.createElement("input");
          input.type = field.type === "multi_select" ? "checkbox" : "radio";
          input.name = field.id;
          input.checked = field.type === "multi_select"
            ? Array.isArray(answer[field.id]) && answer[field.id].includes(option.value)
            : answer[field.id] === option.value;
          input.addEventListener("change", () => {
            if (field.type === "multi_select") {
              const current = new Set(Array.isArray(answer[field.id]) ? answer[field.id] : []);
              input.checked ? current.add(option.value) : current.delete(option.value);
              answer[field.id] = [...current];
            } else {
              answer[field.id] = option.value;
            }
            updateControls();
          });
          const span = document.createElement("span");
          span.textContent = option.label;
          choice.append(input, span);
          choices.append(choice);
        }
        set.append(choices);
        wrapper.append(set);
      } else {
        const label = document.createElement("label");
        const inputId = "field-" + field.id;
        label.setAttribute("for", inputId);
        label.textContent = field.label + (field.required ? " *" : "");
        wrapper.append(label);
        if (field.description) wrapper.append(hint(field.description));
        const control = field.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
        control.id = inputId;
        if (field.type === "number") control.type = "number";
        if (field.type === "text") control.type = "text";
        if (field.placeholder) control.placeholder = field.placeholder;
        if (field.maxLength) control.maxLength = field.maxLength;
        if (field.min !== undefined) control.min = String(field.min);
        if (field.max !== undefined) control.max = String(field.max);
        control.value = answer[field.id] ?? "";
        control.addEventListener("input", () => {
          answer[field.id] = field.type === "number" ? (control.value === "" ? null : Number(control.value)) : control.value;
          updateControls();
        });
        wrapper.append(control);
      }

      const error = document.createElement("div");
      error.className = "error";
      error.textContent = "필수 입력입니다.";
      wrapper.append(error);
      return wrapper;
    }

    function hint(text) {
      const node = document.createElement("div");
      node.className = "hint";
      node.textContent = text;
      return node;
    }

    function move(delta) {
      if (delta > 0 && !isCurrentValid()) {
        markInvalidFields();
        return;
      }
      state.current = Math.max(0, Math.min(DATA.items.length - 1, state.current + delta));
      render();
    }

    function updateControls() {
      markInvalidFields(false);
      const completed = state.answers.filter(isAnswerComplete).length;
      el.counter.textContent = "현재 " + (state.current + 1) + "번째";
      el.completeCount.textContent = completed + " / " + DATA.items.length + " 완료";
      el.progress.max = DATA.items.length;
      el.progress.value = completed;
      el.prevButton.disabled = state.current === 0 || state.exported;
      el.nextButton.disabled = state.current === DATA.items.length - 1 || state.exported;
      el.finishButton.disabled = completed !== DATA.items.length || state.exported;
      el.status.textContent = state.exported ? "완료 파일이 만들어졌습니다." : "";
    }

    function markInvalidFields(show = true) {
      const answer = state.answers[state.current];
      for (const node of el.answerForm.querySelectorAll(".field")) {
        const field = DATA.label_fields.find((entry) => entry.id === node.dataset.fieldId);
        const invalid = field.required && isBlank(answer[field.id]);
        node.classList.toggle("invalid", show && invalid);
      }
    }

    function isCurrentValid() {
      return isAnswerComplete(state.answers[state.current]);
    }

    function isAnswerComplete(answer) {
      return DATA.label_fields.every((field) => !field.required || !isBlank(answer[field.id]));
    }

    function isBlank(value) {
      if (value === undefined || value === null) return true;
      if (typeof value === "string") return value.trim().length === 0;
      if (Array.isArray(value)) return value.length === 0;
      return false;
    }

    function cleanAnswer(answer) {
      const cleaned = {};
      for (const field of DATA.label_fields) {
        const value = answer[field.id];
        if (!isBlank(value)) {
          cleaned[field.id] = typeof value === "string" ? value.trim() : value;
        }
      }
      return cleaned;
    }

    async function exportResult() {
      if (state.exported) return;
      if (!state.answers.every(isAnswerComplete)) {
        el.status.textContent = "아직 비어 있는 항목이 있습니다.";
        return;
      }
      if (!window.crypto || !window.crypto.subtle) {
        el.status.textContent = "브라우저 보안 기능을 사용할 수 없습니다.";
        return;
      }

      el.finishButton.disabled = true;
      el.status.textContent = "완료 파일을 만드는 중입니다.";

      try {
        const payload = {
          type: "labelbridge.result.payload.v1",
          session_id: DATA.session.session_id,
          batch_hash: DATA.session.batch_hash,
          completed_at: new Date().toISOString(),
          integrity: {
            schema_hash: DATA.session.schema_hash,
            item_count: DATA.items.length,
            issued_at: DATA.session.issued_at,
            expires_at: DATA.session.expires_at,
          },
          labels: DATA.items.map((item, index) => ({
            item_id: item.id,
            item_hash: item.item_hash,
            fields: cleanAnswer(state.answers[index]),
          })),
          client: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
            exported_from: "labelbridge-html",
            form_version: DATA.form_version,
          },
        };
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await crypto.subtle.importKey("raw", fromBase64url(DATA.result_key), { name: "AES-GCM" }, false, ["encrypt"]);
        const ciphertext = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          new TextEncoder().encode(JSON.stringify(payload)),
        );
        const envelope = {
          type: "labelbridge.result.envelope.v1",
          session_id: DATA.session.session_id,
          batch_hash: DATA.session.batch_hash,
          capability_token: DATA.capability_token,
          encryption: {
            alg: "AES-256-GCM",
            iv: toBase64url(iv),
            ciphertext: toBase64url(new Uint8Array(ciphertext)),
          },
          created_at: new Date().toISOString(),
          tool_hint: "이 답안 파일을 처음 받았던 곳으로 보내 주세요.",
        };
        const filename = "labelbridge-answer-" + DATA.session.session_id.slice(0, 8) + ".json";
        state.exported = true;
        state.lastEnvelope = envelope;
        state.lastFilename = filename;
        state.lastJsonText = JSON.stringify(envelope, null, 2);
        lockAnswerControls();
        el.handoffFilename.textContent = filename;
        el.handoff.classList.add("visible");
        el.handoff.scrollIntoView({ block: "nearest" });
        el.status.textContent = "답안이 준비됐습니다.";
        const shared = await shareAnswer(true);
        if (!shared) {
          downloadJson(state.lastJsonText, filename);
          el.status.textContent = "공유창이 안 떠서 답안 파일을 저장했습니다.";
        }
      } catch (error) {
        el.finishButton.disabled = false;
        el.status.textContent = "완료 파일 생성에 실패했습니다.";
      }
    }

    async function shareAnswer(auto = false) {
      if (!state.lastJsonText || !state.lastFilename) return false;
      if (!navigator.share) {
        if (!auto) el.status.textContent = "이 브라우저에서는 공유창을 열 수 없습니다.";
        return false;
      }

      try {
        const file = new File([state.lastJsonText], state.lastFilename, { type: "application/json" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: "LabelBridge 답안",
            text: "작성한 답안 파일입니다.",
            files: [file],
          });
        } else {
          await navigator.share({
            title: "LabelBridge 답안",
            text: state.lastJsonText,
          });
        }
        el.status.textContent = "공유창으로 답안을 보냈습니다.";
        return true;
      } catch (error) {
        if (error && error.name === "AbortError") {
          el.status.textContent = "보내기가 취소됐습니다.";
          return true;
        }
        el.status.textContent = auto ? "공유창이 안 떠서 파일로 저장합니다." : "공유창을 열지 못했습니다.";
        return false;
      }
    }

    async function copyAnswer() {
      if (!state.lastJsonText) return;
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        el.status.textContent = "이 브라우저에서는 복사를 사용할 수 없습니다.";
        return;
      }
      try {
        await navigator.clipboard.writeText(state.lastJsonText);
        el.status.textContent = "답안 내용을 복사했습니다.";
      } catch {
        el.status.textContent = "복사하지 못했습니다. 답안 파일 받기를 눌러 주세요.";
      }
    }

    function lockAnswerControls() {
      for (const control of document.querySelectorAll("input, textarea, select")) {
        control.disabled = true;
      }
      el.prevButton.disabled = true;
      el.nextButton.disabled = true;
      el.finishButton.disabled = true;
    }

    function downloadJson(value, filename) {
      const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
      const blob = new Blob([text], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.append(link);
      link.click();
      URL.revokeObjectURL(link.href);
      link.remove();
    }

    function formatValue(value) {
      if (value === null) return "null";
      if (typeof value === "object") return JSON.stringify(value, null, 2);
      return String(value);
    }

    function compactValue(value) {
      const text = formatValue(value).replace(/\\s+/g, " ").trim();
      return text.length > 80 ? text.slice(0, 77) + "..." : text;
    }

    function fromBase64url(value) {
      const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }

    function toBase64url(bytes) {
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
    }
  </script>
</body>
</html>`;
}
