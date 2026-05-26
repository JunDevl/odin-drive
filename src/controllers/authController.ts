import "dotenv/config"

import type { RequestHandler } from "express";
import argon2 from "argon2";
// import { insertUser, upgradeUserToMember } from "../model/db.ts";
import { handleError } from "../utils.ts";
import { PromiseError } from "../utils.ts";
import { body, validationResult, type ValidationChain } from "express-validator";
import passport from "passport";
import prisma from "../../lib/prisma.ts";

const createUserValidator: ValidationChain[] = [
  body("fullName")
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
    .notEmpty()
]

export const createUser: (RequestHandler | ValidationChain[])[] = [
  createUserValidator,
  async (req, res, next) => {
    const validationErrors = validationResult(req);

    if (!validationErrors.isEmpty()) return res.status(400).send(validationErrors.array());

    const user = req.body;

    const hashedPassword = await argon2.hash(user.password, {
      memoryCost: 65536,
      parallelism: 4,
      timeCost: 5
    })

    user.password = hashedPassword;

    const createdUser = await handleError(prisma.user.create({
      data: user
    }));

    if (createdUser instanceof PromiseError) return res.status(400).send(createdUser.error);
    
    return next();
  },
  passport.authenticate("local", {
    successRedirect: "/drive",
    failureRedirect: "/log-in",
    failureMessage: "Failed to log-in."
  })
]