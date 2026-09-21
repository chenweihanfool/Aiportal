import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sitesRouter from "./sites";
import dashboardRouter from "./dashboard";
import mindIndexRouter from "./mindIndex";
import socialIndexRouter from "./socialIndex";
import hermesStatusRouter from "./hermesStatus";
import exportRouter from "./export";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sitesRouter);
router.use(dashboardRouter);
router.use(mindIndexRouter);
router.use(socialIndexRouter);
router.use(hermesStatusRouter);
router.use(exportRouter);

export default router;
