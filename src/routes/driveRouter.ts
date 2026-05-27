import { Router } from "express";
import { createFile, deleteFiles, getUserFiles } from "../controllers/driveController.ts";


const driveRouter = Router();

driveRouter.route("/{*splat}")
  .get(getUserFiles)
  .post(createFile)
  .delete(deleteFiles);

export default driveRouter;