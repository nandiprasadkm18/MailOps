import nodemailer from 'nodemailer';
import { config } from '../config';

let transporter: nodemailer.Transporter;

export async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  // If Ethereal credentials provided, use them
  if (config.ethereal.user && config.ethereal.pass) {
    transporter = nodemailer.createTransport({
      host: config.ethereal.host,
      port: config.ethereal.port,
      secure: false,
      auth: {
        user: config.ethereal.user,
        pass: config.ethereal.pass,
      },
    });
    console.log('[Mailer] Using provided Ethereal credentials');
  } else {
    // Auto-generate Ethereal test account
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
    console.log('[Mailer] Auto-generated Ethereal account:', testAccount.user);
    console.log('[Mailer] View sent emails at: https://ethereal.email/login');
  }

  return transporter;
}

export async function verifyTransporter(): Promise<void> {
  const transport = await getTransporter();
  try {
    await transport.verify();
    console.log('Ethereal SMTP transporter verified');
  } catch (error) {
    console.error('Ethereal SMTP verification failed:', error);
  }
}

export interface SendEmailParams {
  from: string;
  to: string;
  subject: string;
  body: string;
}

export async function sendEmail(params: SendEmailParams): Promise<{ messageId: string; previewUrl: string | false }> {
  const transport = await getTransporter();

  const info = await transport.sendMail({
    from: params.from,
    to: params.to,
    subject: params.subject,
    html: params.body,
    text: params.body.replace(/<[^>]*>/g, ''), // Strip HTML for plain text
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);
  console.log(`[Worker] SMTP accepted message`);
  if (previewUrl) {
    console.log(`[Ethereal] Preview:\n${previewUrl}`);
  }

  return {
    messageId: info.messageId,
    previewUrl,
  };
}
