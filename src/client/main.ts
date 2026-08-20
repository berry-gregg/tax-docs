import "./styles/main.css";
import { healthResponseSchema } from "@shared/schemas/health";
import { recordSchema, type RecordItem } from "@shared/schemas/record";

const statusEl = document.querySelector<HTMLElement>("[data-api-status]");
const recordsEl = document.querySelector<HTMLElement>("[data-records]");
const formEl = document.querySelector<HTMLFormElement>("[data-record-form]");
const titleInput = document.querySelector<HTMLInputElement>("[data-record-title]");

async function refreshHealth(): Promise<void> {
  if (!statusEl) {
    return;
  }

  statusEl.dataset.state = "loading";

  try {
    const response = await fetch("/api/health");
    const payload = healthResponseSchema.parse(await response.json());
    statusEl.textContent = `API ${payload.status} · database ${payload.database}`;
    statusEl.dataset.state = "ready";
  } catch {
    statusEl.textContent = "API unavailable";
    statusEl.dataset.state = "error";
  }
}

async function refreshRecords(): Promise<void> {
  if (!recordsEl) {
    return;
  }

  recordsEl.dataset.state = "loading";

  try {
    const response = await fetch("/api/records");
    const payload = await response.json();
    const records = Array.isArray(payload.records)
      ? payload.records.map((record: unknown) => recordSchema.parse(record))
      : [];

    if (records.length === 0) {
      recordsEl.innerHTML = "<p>No records yet. Add one below.</p>";
    } else {
      recordsEl.innerHTML = records
        .map((record: RecordItem) => `<p>${record.title}</p>`)
        .join("");
    }

    recordsEl.dataset.state = "ready";
  } catch {
    recordsEl.textContent = "Could not load records";
    recordsEl.dataset.state = "error";
  }
}

formEl?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const title = titleInput?.value.trim();
  if (!title) {
    return;
  }

  const response = await fetch("/api/records", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (!response.ok) {
    return;
  }

  if (titleInput) {
    titleInput.value = "";
  }

  await refreshRecords();
});

void refreshHealth();
void refreshRecords();
