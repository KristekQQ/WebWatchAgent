// @ts-check
import { renderURL, renderHTML } from "../client/codex-webviz-client.js";

const main = async () => {
  const r1 = await renderURL("https://example.com", { screenshot: true, htmlOutput: true });
  console.log("URL render done:", r1);

  const r2 = await renderHTML("<html><body><h1>Ahoj!</h1></body></html>", { screenshot: true, htmlOutput: true });
  console.log("HTML render done:", r2);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

