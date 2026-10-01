import { Router, type IRouter } from "express";
import healthRouter from "./health";
import googleAuthRouter from "./googleAuth";
import { googleSessionBridge, requireLoginGate } from "../lib/loginGate";
import sitesRouter from "./sites";
import dashboardRouter from "./dashboard";
import mindIndexRouter from "./mindIndex";
import socialIndexRouter from "./socialIndex";
import hermesStatusRouter from "./hermesStatus";
import hermesTimelineRouter from "./hermesTimeline";
import hermesDocRouter from "./hermesDoc";
import hermesAttachmentRouter from "./hermesAttachment";
import exportRouter from "./export";

const router: IRouter = Router();

router.use(googleSessionBridge);
router.use(healthRouter);
router.use(googleAuthRouter);
router.use(requireLoginGate);
router.use(sitesRouter);
router.use(dashboardRouter);
router.use(mindIndexRouter);
router.use(socialIndexRouter);
router.use(hermesStatusRouter);
router.use(hermesTimelineRouter);
router.use(hermesDocRouter);
router.use(hermesAttachmentRouter);
router.use(exportRouter);

export default router;
