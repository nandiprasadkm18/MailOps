import { Router, Request, Response } from 'express';
import passport from 'passport';
import { config } from '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

/**
 * GET /api/auth/google
 * Initiates Google OAuth flow.
 */
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
  })
);

/**
 * GET /api/auth/google/callback
 * Google OAuth callback.
 */
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${config.frontendUrl}/login?error=auth_failed`,
  }),
  (req: Request, res: Response) => {
    // Successful authentication
    res.redirect(config.frontendUrl);
  }
);

/**
 * GET /api/auth/me
 * Returns current user info.
 */
router.get('/me', (req: Request, res: Response) => {
  if (req.isAuthenticated && req.isAuthenticated() && req.user) {
    return res.json({ user: req.user });
  }
  return res.status(401).json({ user: null, error: 'Not authenticated' });
});

/**
 * POST /api/auth/logout
 * Logs out the current user.
 */
router.post('/logout', (req: Request, res: Response) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Session destruction failed' });
      }
      res.clearCookie('connect.sid');
      return res.json({ message: 'Logged out' });
    });
  });
});

/**
 * POST /api/auth/login
 * Local login using email and optional password.
 */
router.post('/login', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: email.split('@')[0],
          googleId: `local-${email}`,
          tenantId: `tenant-${email}`
        }
      });
    }

    (req as any).login(user, (err: any) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed' });
      }
      return res.json({ user });
    });
  } catch (err) {
    console.error('Local login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
