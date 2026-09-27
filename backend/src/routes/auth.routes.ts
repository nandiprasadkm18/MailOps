import { Router, Request, Response } from 'express';
import passport from 'passport';
import { config } from '../config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

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
 * POST /api/auth/register
 * Register a new user with email and password.
 */
router.post('/register', async (req: Request, res: Response) => {
  const { email, password, name } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name are required.' });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existingUser) {
      return res.status(400).json({ error: 'Account already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
      },
    });

    // Exclude passwordHash from user object before logging in/returning
    const safeUser = { ...user, passwordHash: null };

    (req as any).login(safeUser, (err: any) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed after registration' });
      }
      return res.json({ user: safeUser });
    });
  } catch (err) {
    console.error('Local register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 * Local login using email and password.
 */
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const safeUser = { ...user, passwordHash: null };

    (req as any).login(safeUser, (err: any) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed' });
      }
      return res.json({ user: safeUser });
    });
  } catch (err) {
    console.error('Local login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
