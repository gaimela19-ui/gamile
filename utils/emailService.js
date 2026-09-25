import nodemailer from 'nodemailer';
import { formatPrice } from './currency.js';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

export async function sendGiftCardEmail({ to, giftCard, sender }) {
  const formattedAmount = formatPrice(giftCard.initialBalance, giftCard.currency);
  const expiryDate = giftCard.expiryDate.toLocaleDateString();

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #4F46E5; text-align: center;">You've Received a Gift Card!</h1>
      
      <div style="background-color: #F3F4F6; padding: 20px; border-radius: 10px; margin: 20px 0;">
        <p style="font-size: 18px; text-align: center;">
          <strong>${sender}</strong> has sent you a gift card worth <strong>${formattedAmount}</strong>
        </p>
        
        ${giftCard.recipient.message ? `
          <p style="font-style: italic; text-align: center; color: #6B7280;">
            "${giftCard.recipient.message}"
          </p>
        ` : ''}
      </div>

      <div style="background-color: #EEF2FF; padding: 20px; border-radius: 10px; text-align: center;">
        <h2 style="color: #4F46E5; margin-bottom: 10px;">Gift Card Details</h2>
        <p style="font-size: 24px; font-family: monospace; margin: 20px 0;">
          ${giftCard.code}
        </p>
        <p style="color: #6B7280;">
          Valid until: ${expiryDate}
        </p>
      </div>

      <div style="margin-top: 20px; text-align: center;">
        <p>
          To redeem your gift card, simply enter the code during checkout at our store.
        </p>
        <a 
          href="${process.env.WEBSITE_URL}"
          style="display: inline-block; background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin-top: 10px;"
        >
          Shop Now
        </a>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"Eva Curves" <${process.env.SMTP_FROM}>`,
    to,
    subject: `You've Received a ${formattedAmount} Gift Card!`,
    html
  });
}