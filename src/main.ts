import "dotenv/config";

import path from "path";
import express from "express";
import session from "express-session";
import passport from "passport";
import LocalStrategy from "passport-local";
import argon2 from "argon2";
import authRouter from "./routes/authRouter.ts";
import driveRouter from "./routes/driveRouter.ts";
import prisma from "../lib/prisma.ts";
import { PrismaSessionStore } from "@quixo3/prisma-session-store";

const __dirname = path.resolve();

const PORT = 3000;

const app = express();
app.use(express.static(__dirname + '/public'));
app.set("views", path.join(__dirname, "src/views"));
app.set("view engine", "ejs");

app.use(session({ 
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000 // ms
  },
  secret: process.env["SESSION_SECRET"]!,
  resave: true, 
  saveUninitialized: true,
  store: new PrismaSessionStore(
    prisma,
    {
      checkPeriod: 2 * 60 * 1000,  //ms
      dbRecordIdIsSessionId: true,
      // dbRecordIdFunction: undefined,
    }
  )
}));
app.use(passport.session());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

passport.use(new LocalStrategy.Strategy(
  {
    usernameField: "email",
    passwordField: "password"
  },
  async (email, password, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) return done(null, false, { message: "Incorrect email" });

    const validated = await argon2.verify(user.password, password);
    
    if (!validated) return done(null, false, { message: "Incorrect password" });

    return done(null, user);
  } catch(err) {
    return done(err);
  }
}))

passport.serializeUser((user, done) => {
  done(null, (user as any).id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id }
    });

    app.locals.user = user;
    done(null, user);
  } catch(err) {
    done(err);
  }
});

app.use("/", authRouter);
app.use("/drive", driveRouter);

app.listen(PORT, (error) => {
  if (error) throw error;
  console.log(`App listening on port ${PORT}!\n`);
});
