import { EmailPreview } from "../email-preview";

export default function EmailPreviewExample() {
  const sampleSubject = "🎉 Exclusive 20% Off - Premium Headphones Just For You!";
  const sampleBody = `Hi there,

We noticed you've been eyeing our Premium Wireless Headphones, and we wanted to make your decision easier!

For the next 48 hours, enjoy an exclusive 20% discount on these amazing headphones. With 30-hour battery life and premium noise cancellation, they're perfect for your daily commute or travel adventures.

Don't miss out on this limited-time offer!

Click here to claim your discount now →

Best regards,
The Audio Team`;

  const sampleHtml = `<div style="font-family: sans-serif; max-width: 600px;">
  <h2 style="color: #7c3aed;">🎉 Exclusive 20% Off</h2>
  <p>Hi there,</p>
  <p>We noticed you've been eyeing our <strong>Premium Wireless Headphones</strong>, and we wanted to make your decision easier!</p>
  <p>For the next 48 hours, enjoy an exclusive <strong>20% discount</strong> on these amazing headphones.</p>
  <ul>
    <li>30-hour battery life</li>
    <li>Premium noise cancellation</li>
    <li>Perfect for travel</li>
  </ul>
  <a href="#" style="display: inline-block; background: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">Claim Your Discount →</a>
  <p style="color: #666; font-size: 14px;">Best regards,<br>The Audio Team</p>
</div>`;

  return (
    <div className="p-6 h-screen">
      <EmailPreview
        subject={sampleSubject}
        body={sampleBody}
        htmlBody={sampleHtml}
        onRegenerate={() => console.log("Regenerating...")}
        onSave={() => console.log("Saving email...")}
        onRate={(rating) => console.log("Rated as:", rating)}
      />
    </div>
  );
}
