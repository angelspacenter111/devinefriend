/*
 * Email Service (EmailJS Node.js Integration)
 * Sends contact inquiries and customer messages securely using EmailJS API.
 */

const https = require('https');

class EmailService {
  /**
   * Send Contact Us Form Email via EmailJS API
   * @param {Object} data - Contact form submission data
   * @param {string} data.name - Sender name
   * @param {string} data.email - Sender email
   * @param {string} data.phone - Sender phone
   * @param {string} data.subject - Message subject (maps to {{title}} in template)
   * @param {string} data.message - Message body
   */
  static async sendContactEmail({ name, email, phone, subject, message }) {
    const serviceId = process.env.EMAILJS_SERVICE_ID || 'service_q3cu34x';
    const templateId = process.env.EMAILJS_TEMPLATE_ID || 'template_lf1z4ri';
    const publicKey = process.env.EMAILJS_PUBLIC_KEY || 'n82z_b2bOgjjv3qne';
    const privateKey = process.env.EMAILJS_PRIVATE_KEY || 'Ie06ZmmX73zslgIWDhSOp';

    if (!serviceId || !templateId || !publicKey) {
      throw new Error('EmailJS credentials are missing in environment variables.');
    }

    const now = new Date();
    const formattedTime = now.toLocaleString('en-GB', {
      timeZone: 'Asia/Dubai',
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    // Format message to ensure phone number and clear structure appear in {{message}}
    const formattedMessage = `Contact Number: ${phone}\n\nMessage:\n${message}`;

    const payload = JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      accessToken: privateKey,
      template_params: {
        title: subject,
        name: name,
        email: email,
        phone: phone,
        time: formattedTime,
        message: formattedMessage
      }
    });

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.emailjs.com',
        port: 443,
        path: '/api/v1.0/email/send',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Origin': 'https://talkwithashu.com',
          'User-Agent': 'DevineFriend-Server/1.0 (Windows NT 10.0; Win64; x64)'
        }
      };

      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[EmailService] Contact email sent successfully for ${name} (${email})`);
            resolve({
              success: true,
              statusCode: res.statusCode,
              body: responseBody
            });
          } else {
            console.error(`[EmailService Error] EmailJS responded with status ${res.statusCode}: ${responseBody}`);
            reject(new Error(`EmailJS Error: ${responseBody || 'Failed to send email'}`));
          }
        });
      });

      req.on('error', (err) => {
        console.error('[EmailService Request Error]', err);
        reject(err);
      });

      req.setTimeout(12000, () => {
        req.destroy();
        reject(new Error('Email service request timed out after 12 seconds.'));
      });

      req.write(payload);
      req.end();
    });
  }
}

module.exports = EmailService;
