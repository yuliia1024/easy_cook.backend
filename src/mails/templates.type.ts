/**
 * Every Handlebars template in `hbs-templates/` and the data it renders with. Adding a template:
 * create `<name>.hbs` and add `<name>` here, `NodemailerService.sendTemplatedEmail` is then typed.
 */
export interface HbsTemplateData {
  /** A one-time confirmation code. */
  'otp-code': {
    title: string;
    message: string;
    code: string;
    ttlInMinutes: number;
  };
  /** A plain security notification without an action. */
  notification: {
    title: string;
    message: string;
  };
}

export type HbsMailTemplate = keyof HbsTemplateData;
