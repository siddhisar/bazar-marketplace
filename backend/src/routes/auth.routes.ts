/** Authentication routes, mounted at /api/auth. */
import { Router } from "express";
import {
  getAuthProviders,
  getGoogleCallback,
  getGoogleStart,
  getMe,
  postLogin,
  postLogout,
  postRegister,
} from "../controllers/auth.controller";

const router = Router();

router.post("/register", postRegister);
router.post("/login", postLogin);
router.post("/logout", postLogout);
router.get("/me", getMe);
router.get("/providers", getAuthProviders);

// Browser redirects, not fetch calls: Google sends the user back to the callback.
router.get("/google", getGoogleStart);
router.get("/google/callback", getGoogleCallback);

export default router;
