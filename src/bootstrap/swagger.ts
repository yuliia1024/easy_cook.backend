import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder().setTitle('Easy Cook API').setVersion('0.0.1').build();

  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
}
