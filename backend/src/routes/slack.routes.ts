import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { config } from '../config';

const router = Router();

/**
 * GET /api/slack/connect
 * Redirects to Slack OAuth v2 authorize flow.
 */
router.get('/connect', (req: Request, res: Response) => {
  const tenantId = (req as any).user?.tenantId || 'default-tenant';

  const params = new URLSearchParams({
    client_id: config.slack.clientId,
    scope: 'incoming-webhook',
    redirect_uri: config.slack.redirectUri,
    state: tenantId, // Pass tenant ID in state for callback
  });

  const authorizeUrl = `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  return res.redirect(authorizeUrl);
});

/**
 * GET /api/slack/callback
 * Slack OAuth callback — exchanges code for access token + webhook URL.
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state: tenantId } = req.query;

    if (!code) {
      return res.redirect(`${config.frontendUrl}?slack=error&message=no_code`);
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.slack.clientId,
        client_secret: config.slack.clientSecret,
        code: code as string,
        redirect_uri: config.slack.redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json() as any;

    if (!tokenData.ok) {
      console.error('[Slack] OAuth error:', tokenData.error);
      return res.redirect(`${config.frontendUrl}?slack=error&message=${tokenData.error}`);
    }

    // Store webhook URL and access token
    const webhookUrl = tokenData.incoming_webhook?.url;
    const accessToken = tokenData.access_token;
    const teamName = tokenData.team?.name;
    const channelName = tokenData.incoming_webhook?.channel;

    if (!webhookUrl) {
      return res.redirect(`${config.frontendUrl}?slack=error&message=no_webhook`);
    }

    // Upsert SlackIntegration
    await prisma.slackIntegration.upsert({
      where: { tenantId: (tenantId as string) || 'default-tenant' },
      update: {
        webhookUrl,
        accessToken,
        teamName,
        channelName,
        connectedAt: new Date(),
      },
      create: {
        tenantId: (tenantId as string) || 'default-tenant',
        webhookUrl,
        accessToken,
        teamName,
        channelName,
      },
    });

    console.log(`[Slack] Connected for tenant ${tenantId}: ${teamName} / #${channelName}`);
    return res.redirect(`${config.frontendUrl}?slack=connected`);
  } catch (error) {
    console.error('[Slack] Callback error:', error);
    return res.redirect(`${config.frontendUrl}?slack=error&message=server_error`);
  }
});

/**
 * GET /api/slack/status
 * Returns Slack connection status for the tenant.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';

    const integration = await prisma.slackIntegration.findUnique({
      where: { tenantId },
    });

    if (integration) {
      return res.json({
        connected: true,
        teamName: integration.teamName,
        channelName: integration.channelName,
        connectedAt: integration.connectedAt,
      });
    }

    return res.json({ connected: false });
  } catch (error) {
    console.error('[Slack] Status error:', error);
    return res.status(500).json({ error: 'Failed to check Slack status' });
  }
});

/**
 * DELETE /api/slack/disconnect
 * Disconnects Slack integration.
 */
router.delete('/disconnect', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';

    await prisma.slackIntegration.delete({
      where: { tenantId },
    }).catch(() => null); // Ignore if not found

    return res.json({ message: 'Slack disconnected' });
  } catch (error) {
    console.error('[Slack] Disconnect error:', error);
    return res.status(500).json({ error: 'Failed to disconnect Slack' });
  }
});

/**
 * POST /api/slack/test
 * Test the Slack webhook with a test message.
 */
router.post('/test', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || 'default-tenant';

    const integration = await prisma.slackIntegration.findUnique({
      where: { tenantId },
    });

    if (!integration) {
      return res.status(404).json({ error: 'Slack not connected' });
    }

    const response = await fetch(integration.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: ':white_check_mark: ReachSched test notification — Slack integration is working!',
      }),
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Slack webhook test failed', status: response.status });
    }

    return res.json({ message: 'Test message sent to Slack' });
  } catch (error) {
    console.error('[Slack] Test error:', error);
    return res.status(500).json({ error: 'Failed to send test message' });
  }
});

export default router;
