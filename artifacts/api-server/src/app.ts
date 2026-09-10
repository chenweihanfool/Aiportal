import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// 2026-09-11: default 100kb body limit started rejecting collect.ps1's
// full-payload /admin/hermes-graph POST once Events/ passed ~100 files
// (413 Payload Too Large, graph frozen at 105 events). 2mb headroom.
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// Every /api response here is computed live on every request (or explicitly
// rejects with 403/400) — none of it should ever be cached by a browser or
// an intermediate reverse proxy. Express sets an ETag by default even
// without this, which combined with no explicit Cache-Control is exactly
// the combination that lets a cache in front of this server serve a stale
// response instead of hitting it. Disabling etag generation here too so
// there's no conditional-GET path left that could short-circuit a fetch.
app.set("etag", false);
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use("/api", router);

export default app;
