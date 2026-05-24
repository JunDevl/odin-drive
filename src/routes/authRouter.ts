import { Router } from "express";
import { createUser, upgradeUserStatus } from "../controllers/authController.ts";
import passport from "passport";

const authRouter = Router();

authRouter.get("/", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/posts");

  res.redirect("/log-in");
});

authRouter
  .route("/log-in")
  .get((_, res) => res.render("login-form"))
  .post(passport.authenticate("local", {
    successRedirect: "/posts",
    failureRedirect: "/log-in",
    failureMessage: "Failed to log-in."
  }));

authRouter.get("/log-out", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/log-in");
  });
});

authRouter
  .route("/sign-up")
  .get((_, res) => res.render("signup-form"));
  
authRouter.route("/users")
  .post(createUser as any)
  .put(upgradeUserStatus);

export default authRouter;