import { Router, type IRouter } from "express";
import healthRouter from "./health";
import sitesRouter from "./sites";

const router: IRouter = Router();

router.use(healthRouter);
router.use(sitesRouter);

export default router;
