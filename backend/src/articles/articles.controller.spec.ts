import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';

/**
 * Express 5 reports a named wildcard (`*path`) as an array of segments. These pin the
 * controller-level collapse, because a raw array silently coerced to
 * "Java,JUC,Article.md" and every nested article answered 404.
 */
describe('ArticlesController wildcard paths', () => {
  const segments = ['Java', 'JUC', 'Article.md'];
  const joined = segments.join('/');
  const article = { path: joined };

  const service = {
    findOne: jest.fn().mockResolvedValue(article),
    toggleDraft: jest.fn().mockResolvedValue(article),
    update: jest.fn().mockResolvedValue(article),
    remove: jest.fn().mockResolvedValue({ backupPath: null }),
  };
  const controller = new ArticlesController(service as unknown as ArticlesService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads a nested article with its slashes intact', async () => {
    await expect(controller.findOne(segments)).resolves.toEqual(article);
    expect(service.findOne).toHaveBeenCalledWith(joined);
  });

  it('updates a nested article', async () => {
    await controller.update(segments, { title: 'x' } as never);
    expect(service.update).toHaveBeenCalledWith(joined, { title: 'x' });
  });

  it('deletes a nested article', async () => {
    await expect(controller.remove(segments)).resolves.toEqual({ backupPath: null });
    expect(service.remove).toHaveBeenCalledWith(joined);
  });

  it('toggles draft on a nested article', async () => {
    await controller.toggleDraft(segments);
    expect(service.toggleDraft).toHaveBeenCalledWith(joined);
  });

  it('leaves a %2F-encoded single segment untouched', async () => {
    await controller.findOne(joined);
    expect(service.findOne).toHaveBeenCalledWith(joined);
  });
});
