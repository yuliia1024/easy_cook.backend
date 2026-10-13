import { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { createMock } from '../test/create-mock';
import { setupSwagger } from './swagger';

describe('setupSwagger', () => {
  it('mounts the docs on /docs', () => {
    const setup = jest.spyOn(SwaggerModule, 'setup').mockImplementation();
    const app = createMock<INestApplication>();

    setupSwagger(app);

    expect(setup).toHaveBeenCalledWith('docs', app, expect.any(Function));
  });
});
