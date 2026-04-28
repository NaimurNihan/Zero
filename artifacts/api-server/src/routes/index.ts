import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ttsRouter from "./tts";
import transcribeRouter from "./transcribe";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ttsRouter);
router.use(transcribeRouter);

export default router;
