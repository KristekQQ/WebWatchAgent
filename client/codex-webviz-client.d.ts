export type LifeCycle = "load" | "domcontentloaded" | "networkidle0" | "networkidle2";

export type Viewport = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
};

export type WaitForSelector = { type: "waitForSelector"; selector: string; timeoutMs?: number };
export type Click = { type: "click"; selector: string; timeoutMs?: number };
export type Hover = { type: "hover"; selector: string; timeoutMs?: number };
export type TypeAction = { type: "type"; selector: string; text: string; delay?: number; timeoutMs?: number };
export type ClickAt = { type: "clickAt"; x: number; y: number };
export type WaitTime = { type: "waitForTime"; ms: number };
export type WaitFn = { type: "waitForFunction"; fn: string; timeoutMs?: number };
export type WaitCanvas = { type: "waitForCanvasPaint"; timeoutMs?: number; intervalMs?: number };
export type Press = { type: "press"; key: string; delay?: number };
export type ScreenshotElement = { type: "screenshotElement"; selector: string; file?: string; timeoutMs?: number };
export type MuteHeuristic = { type: "muteHeuristic" };

export type Action =
  | WaitForSelector | Click | Hover | TypeAction | ClickAt | WaitTime | WaitFn | WaitCanvas | Press | ScreenshotElement | MuteHeuristic;

export type ExtractText = { type: "text"; selector: string; all?: boolean; name?: string };
export type ExtractAttr = { type: "attr"; selector: string; name: string; all?: boolean; key?: string };
export type ExtractHtml = { type: "html"; selector: string; all?: boolean; name?: string };
export type ExtractExists = { type: "exists"; selector: string; name?: string };
export type ExtractSpec = ExtractText | ExtractAttr | ExtractHtml | ExtractExists;

export interface BaseOpts {
  id?: string;
  viewport?: Viewport;
  fullPage?: boolean;
  waitUntil?: LifeCycle;
  timeoutMs?: number;
  userAgent?: string;
  extraHeaders?: Record<string, string>;
  screenshot?: boolean;
  htmlOutput?: boolean;
  postWaitMs?: number;
  actions?: Action[];
  sessionId?: string;
  extract?: ExtractSpec[];
  captureConsole?: boolean;
  captureNetwork?: boolean;
  screenshotOnEachAction?: boolean;
  clientTimeoutMs?: number;
  pollIntervalMs?: number;
}

export interface RenderResult {
  id: string;
  paths: {
    meta: string;
    html: string;
    screenshot: string;
  };
  done: any;
}

export function renderURL(url: string, opts?: BaseOpts): Promise<RenderResult>;
export function renderHTML(html: string, opts?: BaseOpts): Promise<RenderResult>;

