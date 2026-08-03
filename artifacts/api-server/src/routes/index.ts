import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sitesRouter from "./sites";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sitesRouter);
router.use(dashboardRouter);

export default router;
