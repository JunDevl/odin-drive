import { Router } from "express";
import { createFile, deleteFiles, downloadUserFile, getUserFiles, renameFile, updateFiles } from "../controllers/driveController.ts";


const driveRouter = Router();

driveRouter.use((req, res, next) => {
  if (!req.isAuthenticated()) return res.redirect("/log-in");
  return next();
});

driveRouter.route("/{*splat}")
  .get(getUserFiles, downloadUserFile)
  .delete(deleteFiles)
  .post(createFile)
  .patch(renameFile)
  .put(updateFiles);


export default driveRouter;