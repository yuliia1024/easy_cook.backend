import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import * as Handlebars from 'handlebars';
import * as nodemailer from 'nodemailer';
import { join } from 'path';
import { MailConfigService } from '../../configs/mail-config/mail-config.service';
import { HbsMailTemplate, HbsTemplateData } from '../../mails/templates.type';

@Injectable()
export class NodemailerService {
  private readonly transporter: nodemailer.Transporter;
  private readonly templateDir = join(__dirname, '../../mails/hbs-templates');
  private readonly compiled = new Map<HbsMailTemplate, Handlebars.TemplateDelegate>();

  constructor(private readonly mailConfigService: MailConfigService) {
    this.transporter = nodemailer.createTransport(this.mailConfigService.smtp());
  }

  public async sendTemplatedEmail<Template extends HbsMailTemplate>(
    to: string,
    subject: string,
    template: Template,
    data: HbsTemplateData[Template],
  ): Promise<void> {
    const html = this.getTemplate(template)(data);

    await this.transporter.sendMail({
      from: this.mailConfigService.fromAddress,
      to,
      subject,
      html,
    });
  }

  private getTemplate(template: HbsMailTemplate): Handlebars.TemplateDelegate {
    let compiled = this.compiled.get(template);

    if (!compiled) {
      const source = readFileSync(join(this.templateDir, `${template}.hbs`), 'utf8');
      compiled = Handlebars.compile(source);
      this.compiled.set(template, compiled);
    }

    return compiled;
  }
}
