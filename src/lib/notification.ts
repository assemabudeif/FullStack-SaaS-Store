import { createTransport, Transporter } from 'nodemailer';
import * as Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { FastifyInstance } from 'fastify';
import { storeTransaction } from '../lib/context.js';

interface EmailTemplateData {
  [key: string]: any;
}

interface NotificationService {
  sendEmail: (to: string, subject: string, templateName: string, data: EmailTemplateData) => Promise<void>;
  sendOrderConfirmation: (customerEmail: string, customerName: string, orderId: string, orderDetails: any) => Promise<void>;
  sendOrderShipped: (customerEmail: string, customerName: string, orderId: string, trackingInfo: any) => Promise<void>;
  sendOrderDelivered: (customerEmail: string, customerName: string, orderId: string) => Promise<void>;
}

export class EmailNotificationService implements NotificationService {
  private transporter: Transporter;
  private templatesDir: string;

  constructor(fastify: FastifyInstance) {
    // Configure email transport (in production, use proper SMTP service)
    // For development, we'll use a mock transport or log to console
    this.transporter = createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: Number(process.env.SMTP_PORT) || 1025,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      }
    });

    // Set templates directory
    this.templatesDir = join(process.cwd(), 'src', 'lib', 'email-templates');
    
    // Create templates directory if it doesn't exist
    const { mkdirSync } = require('fs');
    if (!require('fs').existsSync(this.templatesDir)) {
      mkdirSync(this.templatesDir, { recursive: true });
    }
  }

  private async getTemplate(templateName: string): Promise<(data: EmailTemplateData) => string> {
    try {
      const templatePath = join(this.templatesDir, `${templateName}.hbs`);
      const templateSource = readFileSync(templatePath, 'utf-8');
      return Handlebars.compile(templateSource);
    } catch (error) {
      // If template doesn't exist, create a simple fallback
      return (data: EmailTemplateData) => {
        return `<h1>{{{subject}}}</h1><p>Hello {{{name}}},</p><p>This is a notification about your order.</p>`;
      };
    }
  }

  async sendEmail(to: string, subject: string, templateName: string, data: EmailTemplateData): Promise<void> {
    try {
      const template = await this.getTemplate(templateName);
      const html = template({ ...data, subject });

      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || 'noreply@store.example.com',
        to,
        subject,
        html
      });

      // In development, log to console instead of actually sending
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[EMAIL] To: ${to}, Subject: ${subject}`);
        console.log(`[EMAIL CONTENT]:\n${html}`);
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      throw error;
    }
  }

  async sendOrderConfirmation(customerEmail: string, customerName: string, orderId: string, orderDetails: any): Promise<void> {
    await this.sendEmail(
      customerEmail,
      `تأكيد الطلب #${orderId}`,
      'order-confirmation',
      {
        name: customerName,
        orderId,
        orderDate: new Date().toLocaleDateString(),
        ...orderDetails
      }
    );
  }

  async sendOrderShipped(customerEmail: string, customerName: string, orderId: string, trackingInfo: any): Promise<void> {
    await this.sendEmail(
      customerEmail,
      `تم شحن طلبك #${orderId}`,
      'order-shipped',
      {
        name: customerName,
        orderId,
        trackingNumber: trackingInfo.trackingNumber,
        carrier: trackingInfo.carrier,
        estimatedDelivery: trackingInfo.estimatedDelivery
      }
    );
  }

  async sendOrderDelivered(customerEmail: string, customerName: string, orderId: string): Promise<void> {
    await this.sendEmail(
      customerEmail,
      `تم توصيل طلبك #${orderId}`,
      'order-delivered',
      {
        name: customerName,
        orderId,
        deliveryDate: new Date().toLocaleDateString()
      }
    );
  }
}

// Initialize notification service as a Fastify decorator
export async function registerNotificationService(fastify: FastifyInstance) {
  const notificationService = new EmailNotificationService(fastify);
  fastify.decorate('notificationService', notificationService);
  
  // Add cleanup on close
  fastify.addHook('onClose', (instance, done) => {
    if (instance.notificationService && instance.notificationService.transporter) {
      instance.notificationService.transporter.close();
    }
    done();
  });
}
