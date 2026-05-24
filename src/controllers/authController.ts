import "dotenv/config"

import type { RequestHandler } from "express";
import argon2 from "argon2";
// import { insertUser, upgradeUserToMember } from "../model/db.ts";
import { handleError } from "../utils.ts";
import { PromiseError } from "../utils.ts";
import { body, validationResult, type ValidationChain } from "express-validator";
import passport from "passport";

const createUserValidator: ValidationChain[] = [
  body("full_name")
    .trim()
    .notEmpty(),
  body("username")
    .trim()
    .notEmpty(),
  body("email")
    .trim()
    .isEmail()
    .notEmpty(),
  body("password")
    .trim()
    .notEmpty(),
  body("club_key")
    .optional()
]

export const createUser: (RequestHandler | ValidationChain[])[] = [
  createUserValidator,
  async (req, res, next) => {
    const validationErrors = validationResult(req);

    if (!validationErrors.isEmpty()) return res.status(400).send(validationErrors.array());

    const {club_key, ...user} = req.body;

    const hashedPassword = await argon2.hash(user.password, {
      memoryCost: 65536,
      parallelism: 4,
      timeCost: 5
    })

    user.password = hashedPassword;
    user.status = club_key === process.env["SECRET_CLUBHOUSE_KEY"] ? "member" : "visitor";

    const createdUser = await handleError(insertUser(user));

    if (createdUser instanceof PromiseError) return res.status(400).send(createdUser.error);
    
    return next();
  },
  passport.authenticate("local", {
    successRedirect: "/posts",
    failureRedirect: "/log-in",
    failureMessage: "Failed to log-in."
  })
]

export const upgradeUserStatus: RequestHandler = async (req, res) => {
  if ((req.user! as any).status !== "visitor") return res.send("User is a member already.");

  const {club_key} = req.body;

  if (club_key !== process.env["SECRET_CLUBHOUSE_KEY"]) return res.status(400).send("Wrong key.");

  const upgraded = await handleError(upgradeUserToMember((req.user! as any).id));

  if (upgraded instanceof PromiseError) return res.status(400).send(upgraded.error);

  return res.send(`Deleted user ${(req.user! as any).id}`);
}