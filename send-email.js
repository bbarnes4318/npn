const nodemailer = require('nodemailer');

let transporter;

// Create a transporter using a test account from ethereal.email
async function setupTransporter() {
  try {
    // Generate test SMTP service account from ethereal.email
    let testAccount = await nodemailer.createTestAccount();

    // Create a reusable transporter object using the default SMTP transport
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: testAccount.user, // generated ethereal user
        pass: testAccount.pass, // generated ethereal password
      },
    });

    console.log('Nodemailer transporter is ready for testing.');
  } catch (error) {
    console.error('Failed to create Nodemailer test transporter:', error);
  }
}

/**
 * Sends a welcome email to a new user.
 * @param {string} to - The recipient's email address.
 * @param {string} name - The recipient's name.
 */
async function sendWelcomeEmail(to, name) {
  if (!transporter) {
    throw new Error('Transporter not set up. Call setupTransporter first.');
  }

  const mailOptions = {
    from: '"perEnroll" <no-reply@perenroll.com>',
    to: to,
    subject: 'Welcome to perEnroll!',
    text: `Hello ${name},\n\nWelcome to perEnroll! We are excited to have you on board.\n\nBest regards,\nThe perEnroll Team`,
    html: `<p>Hello ${name},</p><p>Welcome to perEnroll! We are excited to have you on board.</p><p>Best regards,<br>The perEnroll Team</p>`
  };

  try {
    let info = await transporter.sendMail(mailOptions);
    console.log('Message sent: %s', info.messageId);
    // Log the preview URL
    console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

// Initialize the transporter when the module is loaded
setupTransporter();

module.exports = {
  sendWelcomeEmail
};
