import "dotenv/config";

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  mocked?: boolean;
  error?: string;
}

export interface VerificationEmailParams {
  to: string;
  name: string;
  token: string;
  baseUrl?: string;
}

// In-memory log for local development and integration tests inspection
export const sentEmailLog: Array<{
  to: string;
  subject: string;
  verificationUrl: string;
  token: string;
  sentAt: Date;
}> = [];

export async function sendVerificationEmail({
  to,
  name,
  token,
  baseUrl = process.env.APP_BASE_URL || "http://localhost:3000",
}: VerificationEmailParams): Promise<SendEmailResult> {
  const verificationUrl = `${baseUrl.replace(/\/+$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || "SAT Tutor Platform <onboarding@resend.dev>";
  const subject = "Verify your email address - SAT Tutor Platform";

  sentEmailLog.push({
    to,
    subject,
    verificationUrl,
    token,
    sentAt: new Date(),
  });

  if (!apiKey || to.endsWith("@example.com") || process.env.NODE_ENV === "test") {
    console.log(`[EMAIL MOCK DEV/TEST MODE] To: ${to}`);
    console.log(`[EMAIL MOCK DEV/TEST MODE] Subject: ${subject}`);
    console.log(`[EMAIL MOCK DEV/TEST MODE] Verification Link: ${verificationUrl}`);
    return { success: true, mocked: true };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: subject,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded: 8px;">
            <h2 style="color: #1e293b;">Welcome to SAT Tutor Platform, ${name}!</h2>
            <p style="color: #475569; line-height: 1.5;">
              Please verify your email address to complete your registration and activate your account.
            </p>
            <div style="margin: 30px 0;">
              <a href="${verificationUrl}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                Verify Email Address
              </a>
            </div>
            <p style="color: #64748b; font-size: 0.875rem;">
              Or copy and paste this link into your browser:<br/>
              <a href="${verificationUrl}" style="color: #2563eb;">${verificationUrl}</a>
            </p>
            <p style="color: #94a3b8; font-size: 0.75rem; margin-top: 30px;">
              If you did not create an account, you can safely ignore this email.
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Resend Error ${response.status}]: ${errText}`);
      return { success: false, error: `Resend API error: ${response.statusText}` };
    }

    const data = (await response.json()) as { id?: string };
    return { success: true, messageId: data.id };
  } catch (error: any) {
    console.error("[Resend Request Exception]:", error);
    return { success: false, error: error.message || "Failed to send verification email" };
  }
}

export async function sendPasswordResetEmail({
  to,
  name,
  token,
  baseUrl = process.env.APP_BASE_URL || "http://localhost:3000",
}: VerificationEmailParams): Promise<SendEmailResult> {
  const resetUrl = `${baseUrl.replace(/\/+$/, "")}/?resetToken=${encodeURIComponent(token)}`;
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.EMAIL_FROM || "SAT Tutor Platform <onboarding@resend.dev>";
  const subject = "Reset your password - SAT Tutor Platform";

  sentEmailLog.push({
    to,
    subject,
    verificationUrl: resetUrl,
    token,
    sentAt: new Date(),
  });

  if (!apiKey || to.endsWith("@example.com") || process.env.NODE_ENV === "test") {
    console.log(`[EMAIL MOCK DEV/TEST MODE] To: ${to}`);
    console.log(`[EMAIL MOCK DEV/TEST MODE] Subject: ${subject}`);
    console.log(`[EMAIL MOCK DEV/TEST MODE] Reset Link: ${resetUrl}`);
    return { success: true, mocked: true };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: subject,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
            <h2 style="color: #1e293b;">Password Reset Request</h2>
            <p style="color: #475569; line-height: 1.5;">
              Hello ${name}, we received a request to reset your password for your SAT Tutor Platform account.
            </p>
            <div style="margin: 30px 0;">
              <a href="${resetUrl}" style="background-color: #dc2626; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                Reset Password
              </a>
            </div>
            <p style="color: #64748b; font-size: 0.875rem;">
              Or copy and paste this link into your browser:<br/>
              <a href="${resetUrl}" style="color: #dc2626;">${resetUrl}</a>
            </p>
            <p style="color: #94a3b8; font-size: 0.75rem; margin-top: 30px;">
              This link is valid for 1 hour. If you did not request a password reset, please ignore this message.
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Resend Error ${response.status}]: ${errText}`);
      return { success: false, error: `Resend API error: ${response.statusText}` };
    }

    const data = (await response.json()) as { id?: string };
    return { success: true, messageId: data.id };
  } catch (error: any) {
    console.error("[Resend Request Exception]:", error);
    return { success: false, error: error.message || "Failed to send password reset email" };
  }
}
