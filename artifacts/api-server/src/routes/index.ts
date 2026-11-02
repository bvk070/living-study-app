import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import storageRouter from "./storage";
import documentsRouter from "./study-guide/documents";
import generationRouter from "./study-guide/generation";
import reviewRouter from "./study-guide/review";
import libraryRouter from "./study-guide/library";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requireAuth);
router.use(storageRouter);
router.use(documentsRouter);
router.use(generationRouter);
router.use(reviewRouter);
router.use(libraryRouter);

export default router;
