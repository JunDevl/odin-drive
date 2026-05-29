import { Router } from "express";
import { createFile, deleteFiles, getUserFiles } from "../controllers/driveController.ts";


const driveRouter = Router();

driveRouter.route("{*splat}")
  .get(getUserFiles)
  .delete(deleteFiles)
  .post(createFile);


export default driveRouter;