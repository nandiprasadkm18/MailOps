import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { config } from '../config';
import prisma from '../lib/prisma';

export function configurePassport(): void {
  // Serialize user to session
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      // Dev user bypass
      if (id === 'dev-user-id') {
        return done(null, {
          id: 'dev-user-id',
          tenantId: 'default-tenant',
          googleId: 'dev-google-id',
          email: 'dev@reachsched.com',
          name: 'Dev User',
          avatarUrl: null,
        });
      }

      const user = await prisma.user.findUnique({ where: { id } });
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });

  // Only configure Google Strategy if credentials are provided
  if (config.google.clientId && config.google.clientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.google.clientId,
          clientSecret: config.google.clientSecret,
          callbackURL: config.google.callbackUrl,
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const email = profile.emails?.[0]?.value;
            const name = profile.displayName;
            const avatarUrl = profile.photos?.[0]?.value;

            if (!email) {
              return done(new Error('No email found in Google profile'), undefined);
            }

            // Upsert user
            const user = await prisma.user.upsert({
              where: { googleId: profile.id },
              update: {
                email,
                name,
                avatarUrl,
              },
              create: {
                googleId: profile.id,
                email,
                name,
                avatarUrl,
              },
            });

            return done(null, user);
          } catch (error) {
            return done(error as Error, undefined);
          }
        }
      )
    );
    console.log('[Auth] Google OAuth strategy configured');
  } else {
    console.log('[Auth] Google OAuth credentials not provided — use /api/auth/dev-login for development');
  }
}
