import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page, type Response } from "playwright";

const TARGET_URL = "https://map.benzin-status.tech/";
const OUTPUT_DIR = path.resolve("outputs/scraper-debug/network");
const center = {
  latitude: Number(process.env.SCRAPER_CITY_CENTER_LAT || 55.7558),
  longitude: Number(process.env.SCRAPER_CITY_CENTER_LNG || 37.6173),
};

type RequestEntry = {
  url: string;
  method: string;
  resourceType: string;
  count: number;
  statuses: number[];
  contentTypes: string[];
  responseFile?: string;
  jsonSummary?: unknown;
};

const requestMap = new Map<string, RequestEntry>();
const websockets: Array<{ url: string; sentFrames: number; receivedFrames: number }> = [];
let jsonFileCounter = 0;

function redactUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|auth|signature|sig/i.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function summarizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sampleKeys: value.slice(0, 3).map((item) => item && typeof item === "object" ? Object.keys(item as object).slice(0, 30) : typeof item),
    };
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return {
      type: "object",
      keys: Object.keys(object).slice(0, 50),
      arrays: Object.fromEntries(Object.entries(object).filter(([, item]) => Array.isArray(item)).map(([key, item]) => [key, (item as unknown[]).length])),
    };
  }
  return { type: typeof value };
}

async function inspectResponse(response: Response) {
  const request = response.request();
  const rawUrl = request.url();
  const key = `${request.method()} ${rawUrl}`;
  const entry = requestMap.get(key);
  if (!entry) return;
  entry.statuses = [...new Set([...entry.statuses, response.status()])];
  const contentType = response.headers()["content-type"]?.split(";")[0] || "";
  if (contentType) entry.contentTypes = [...new Set([...entry.contentTypes, contentType])];

  const isJson = /json|geo\+json/.test(contentType);
  if (!isJson || !["xhr", "fetch"].includes(request.resourceType())) return;
  try {
    const body = await response.body();
    if (body.length > 20 * 1024 * 1024) return;
    const json = JSON.parse(body.toString("utf8")) as unknown;
    entry.jsonSummary = summarizeJson(json);
    jsonFileCounter += 1;
    const fileName = `response-${String(jsonFileCounter).padStart(3, "0")}.json`;
    await writeFile(path.join(OUTPUT_DIR, fileName), JSON.stringify(json, null, 2), "utf8");
    entry.responseFile = fileName;
  } catch {
    // Ответ может быть потоковым либо исчезнуть из браузерного кеша — это не ошибка аудита.
  }
}

async function dismissOverlays(page: Page) {
  for (let pass = 0; pass < 6; pass += 1) {
    let clicked = false;
    for (const label of ["Позже", "Понятно", "Не сейчас", "Закрыть"]) {
      const buttons = page.getByRole("button", { name: label, exact: true });
      for (let index = 0; index < await buttons.count(); index += 1) {
        if (await buttons.nth(index).isVisible()) {
          await buttons.nth(index).click({ timeout: 5_000 });
          await page.waitForTimeout(300);
          clicked = true;
          break;
        }
      }
      if (clicked) break;
    }
    if (!clicked) break;
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.SCRAPER_HEADLESS !== "false" });
  try {
    const context = await browser.newContext({
      locale: "ru-RU",
      viewport: { width: 1440, height: 900 },
      geolocation: center,
      permissions: ["geolocation"],
    });
    const page = await context.newPage();

    page.on("request", (request) => {
      const key = `${request.method()} ${request.url()}`;
      const existing = requestMap.get(key);
      if (existing) existing.count += 1;
      else requestMap.set(key, {
        url: redactUrl(request.url()), method: request.method(), resourceType: request.resourceType(),
        count: 1, statuses: [], contentTypes: [],
      });
    });
    page.on("response", (response) => { void inspectResponse(response); });
    page.on("websocket", (socket) => {
      const item = { url: redactUrl(socket.url()), sentFrames: 0, receivedFrames: 0 };
      websockets.push(item);
      socket.on("framesent", () => { item.sentFrames += 1; });
      socket.on("framereceived", () => { item.receivedFrames += 1; });
    });

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.locator("canvas.maplibregl-canvas").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1_500);
    await dismissOverlays(page);
    const locate = page.getByRole("button", { name: "Где я", exact: true });
    if (await locate.count()) {
      try {
        await locate.click({ timeout: 6_000 });
      } catch {
        await dismissOverlays(page);
        await locate.click({ timeout: 6_000 });
      }
    }
    await page.waitForTimeout(4_000);

    // Открываем несколько публичных карточек: детальные endpoint'ы часто вызываются только по клику.
    for (let index = 0; index < 3; index += 1) {
      const rows = page.locator("button.grid.w-full.cursor-pointer");
      if (index >= await rows.count()) break;
      await rows.nth(index).click({ timeout: 8_000 });
      await page.waitForTimeout(1_200);
      const close = page.locator(".rounded-card").filter({ has: page.getByRole("button", { name: "Закрыть", exact: true }) }).filter({ hasText: "Наличие" }).getByRole("button", { name: "Закрыть", exact: true });
      if (await close.count()) await close.first().click();
      if (await locate.count()) await locate.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
    }

    // Небольшие пользовательские панорамирование и zoom для выявления tile/vector запросов.
    const canvas = page.locator("canvas.maplibregl-canvas");
    const box = await canvas.boundingBox();
    if (box) {
      const x = box.x + box.width * 0.72;
      const y = box.y + box.height * 0.5;
      await page.mouse.move(x, y);
      await page.mouse.wheel(0, -450);
      await page.waitForTimeout(1_200);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 260, y, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(2_000);
    }

    // Проверяем только через уже открытую публичную страницу: прямой запрос вне браузера может быть запрещён сайтом.
    const wideApiTests = [] as Array<{ url: string; status: number; count: number | null; responseFile?: string }>;
    for (const url of [
      "/api/stations?bbox=55.40,36.80,56.10,38.40&limit=5000&queues=1&center=37.6173,55.7558",
      "/api/stations?bbox=55.40,36.80,56.10,38.40&limit=5000&fuel=ai95&queues=1&center=37.6173,55.7558",
    ]) {
      const result = await page.evaluate(async (requestUrl) => {
        const response = await fetch(requestUrl, { credentials: "same-origin" });
        const json = response.ok ? await response.json() : null;
        return { status: response.status, json };
      }, url);
      const count = Array.isArray(result.json?.stations) ? result.json.stations.length : null;
      const test = { url, status: result.status, count } as { url: string; status: number; count: number | null; responseFile?: string };
      if (result.json) {
        const fileName = `wide-api-${wideApiTests.length + 1}.json`;
        await writeFile(path.join(OUTPUT_DIR, fileName), JSON.stringify(result.json, null, 2), "utf8");
        test.responseFile = fileName;
      }
      wideApiTests.push(test);
    }
    await page.waitForTimeout(800);

    const entries = [...requestMap.values()];
    const audit = {
      generatedAt: new Date().toISOString(),
      page: TARGET_URL,
      totalUniqueRequests: entries.length,
      totalRequests: entries.reduce((sum, entry) => sum + entry.count, 0),
      byResourceType: Object.fromEntries([...new Set(entries.map((entry) => entry.resourceType))].map((type) => [type, entries.filter((entry) => entry.resourceType === type).reduce((sum, entry) => sum + entry.count, 0)])),
      websockets,
      wideApiTests,
      apiCandidates: entries.filter((entry) => ["xhr", "fetch"].includes(entry.resourceType) || entry.responseFile),
      vectorOrGeoCandidates: entries.filter((entry) => entry.contentTypes.some((type) => /protobuf|geo\+json|mapbox-vector-tile/.test(type)) || /\.(pbf|mvt)(\?|$)/.test(entry.url)),
      requests: entries,
    };
    await writeFile(path.join(OUTPUT_DIR, "network-audit.json"), JSON.stringify(audit, null, 2), "utf8");
    console.log(JSON.stringify({
      totalUniqueRequests: audit.totalUniqueRequests,
      totalRequests: audit.totalRequests,
      byResourceType: audit.byResourceType,
      websockets: audit.websockets,
      wideApiTests: audit.wideApiTests,
      apiCandidates: audit.apiCandidates.map((entry) => ({ method: entry.method, url: entry.url, status: entry.statuses, contentTypes: entry.contentTypes, jsonSummary: entry.jsonSummary, responseFile: entry.responseFile })),
      vectorOrGeoCandidates: audit.vectorOrGeoCandidates.map((entry) => entry.url),
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
