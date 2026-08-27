import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { createServer } from "node:http";

const port = Number(process.env.PORT || 5000);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const publicFiles = new Map([
  ["/", resolve("app/index.html")],
  ["/app/styles.css", resolve("app/styles.css")],
  ["/app/app.js", resolve("app/app.js")],
  ["/data/contacts_data.json", resolve("data/contacts_data.json")],
  ["/data/pipeline_data.json", resolve("data/pipeline_data.json")],
]);

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
    const filePath = publicFiles.get(pathname);
    if (!filePath) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Next Touch is listening on port ${port}`);
});