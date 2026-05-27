const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const pickFile = document.getElementById("pickFile");
const urlForm = document.getElementById("urlForm");
const urlInput = document.getElementById("urlInput");
const statusBox = document.getElementById("status");
const resultBox = document.getElementById("result");
const resultTitle = document.getElementById("resultTitle");
const markdownPane = document.getElementById("markdownPane");
const htmlPane = document.getElementById("htmlPane");
const paths = document.getElementById("paths");
const copyMarkdown = document.getElementById("copyMarkdown");
const downloadMarkdown = document.getElementById("downloadMarkdown");
const downloadHtml = document.getElementById("downloadHtml");
let latest = null;

pickFile.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) convertFile(file);
});

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  });
}

dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (file) convertFile(file);
});

urlForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (url) convertUrl(url);
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.tab;
    markdownPane.hidden = mode !== "markdown";
    htmlPane.hidden = mode !== "html";
  });
});

copyMarkdown.addEventListener("click", async () => {
  if (!latest) return;
  await navigator.clipboard.writeText(latest.markdown);
  setStatus("Markdown copied.");
});

downloadMarkdown.addEventListener("click", () => {
  if (latest) download(`${latest.title}.md`, latest.markdown, "text/markdown");
});

downloadHtml.addEventListener("click", () => {
  if (latest) download(`${latest.title}.html`, latest.html, "text/html");
});

async function convertFile(file) {
  const form = new FormData();
  form.append("file", file);
  setStatus(`Converting ${file.name}...`);
  const response = await fetch("/api/convert/file", { method: "POST", body: form });
  await handleResponse(response);
}

async function convertUrl(url) {
  setStatus(`Converting ${url}...`);
  const response = await fetch("/api/convert/url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url })
  });
  await handleResponse(response);
}

async function handleResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    setStatus(body.error || "Conversion failed.");
    return;
  }
  latest = body;
  resultTitle.textContent = body.title;
  markdownPane.textContent = body.markdown;
  htmlPane.srcdoc = body.html;
  paths.textContent = `Saved: ${body.markdownPath || ""} ${body.htmlPath || ""}`;
  resultBox.hidden = false;
  setStatus("Conversion complete.");
}

function setStatus(message) {
  statusBox.hidden = false;
  statusBox.textContent = message;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
