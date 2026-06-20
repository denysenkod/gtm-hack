import "dotenv/config";
import cors from "cors";
import express from "express";
import searchRouter from "./routes/search.js";
import { logError, logInfo } from "./utils/logger.js";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN ?? "http://127.0.0.1:5173"
  })
);
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "tender-discovery"
  });
});

app.use("/api/search", searchRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  logError("Unhandled server error", {
    error: error instanceof Error ? error.message : String(error)
  });
  response.status(500).json({
    error: "Unexpected server error while searching for tenders."
  });
});

app.listen(port, () => {
  logInfo("Tender discovery API listening", {
    url: `http://127.0.0.1:${port}`,
    logPath: process.env.SERVER_LOG_PATH ?? ".data/server.log",
    embeddingDevice: process.env.EMBEDDING_DEVICE ?? "platform-gpu-default"
  });
});
