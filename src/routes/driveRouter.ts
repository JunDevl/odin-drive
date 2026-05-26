import { Router } from "express";
import multer from "multer";
import { getUserFiles } from "../controllers/driveController.ts";
// const upload = multer({ dest: 'uploads/' })

const driveRouter = Router();

driveRouter.route("/")
  .get(getUserFiles)
  .post(() => {})
  .delete(() => {})

export default driveRouter;