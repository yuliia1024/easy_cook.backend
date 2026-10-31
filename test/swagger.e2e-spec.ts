import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { createTestApp, TestApp } from './test-app';

/** The contract the web app reads from `/docs`. */
describe('Swagger (e2e)', () => {
  let ctx: TestApp;
  let document: OpenAPIObject;

  beforeAll(async () => {
    ctx = await createTestApp();
    document = SwaggerModule.createDocument(ctx.app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('describes confirming a menu version: the ids from the chat, the menu, rule and lookup errors', () => {
    const confirm = document.paths['/api/menus/{id}/versions/{versionId}/confirm'].post;

    expect(confirm?.summary).toBe('Confirm a version of the menu');
    expect(confirm?.description).toContain('`menuVersionId` of the saved assistant message');
    expect(confirm?.description).toContain('replaces the confirmed one');
    expect(Object.keys(confirm?.responses ?? {}).sort()).toEqual(['200', '400', '404']);
    expect(confirm?.responses['200']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/MenuResponseDto' } } },
    });
    expect(confirm?.responses['400']).toMatchObject({
      description: expect.stringContaining('breaks a hard rule'),
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ErrorResponseDto' } },
      },
    });
  });
});
