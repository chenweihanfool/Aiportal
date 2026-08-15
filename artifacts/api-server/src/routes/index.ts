import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sitesRouter from "./sites";
import dashboardRouter from "./dashboard";
import mindIndexRouter from "./mindIndex";
import hermesStatusRouter from "./hermesStatus";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sitesRouter);
router.use(dashboardRouter);
router.use(mindIndexRouter);
router.use(hermesStatusRouter);

export default router;
