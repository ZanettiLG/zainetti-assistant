import { extname } from "path";
import { createReadStream } from "fs";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

function serveStaticFile(res, filePath) {
  const ext = extname(filePath);
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const stream = createReadStream(filePath);

  stream
    .on("open", () => {
      res.writeHead(200, { "Content-Type": contentType });
    })
    .on("error", () => {
      res.writeHead(404);
      res.end("Not Found");
    })
    .pipe(res);
}

export {
  mimeTypes,
  serveStaticFile,
};
