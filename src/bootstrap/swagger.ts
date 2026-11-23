import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SESSION_COOKIE_NAME } from '../common/constants';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Easy Cook API')
    .setVersion('0.0.1')
    .addCookieAuth(SESSION_COOKIE_NAME)
    .build();

  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
}
