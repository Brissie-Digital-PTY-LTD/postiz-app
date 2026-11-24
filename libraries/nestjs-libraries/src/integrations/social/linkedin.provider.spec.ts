import { Integration } from '@prisma/client';
import { LinkedinProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.provider';
import { LinkedinPageProvider } from '@gitroom/nestjs-libraries/integrations/social/linkedin.page.provider';

jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: () => Promise.resolve(),
}));

const COMMENT_URL = 'https://example.com/?utm_source=a&utm_medium=b';

// Little format publishes reserved characters as a leading backslash and
// strips that backslash when it renders. A URL in commentary is intact when
// that round trip returns the original string.
const littleToPlain = (text: string) => text.replace(/\\(.)/g, '$1');

type Captured = { url: string; body?: string };

class RecordingLinkedin extends LinkedinProvider {
  calls: Captured[] = [];

  override async fetch(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    this.calls.push({
      url,
      body: typeof options.body === 'string' ? options.body : undefined,
    });
    return fakeLinkedInResponse(url);
  }
}

class RecordingLinkedinPage extends LinkedinPageProvider {
  calls: Captured[] = [];

  override async fetch(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    this.calls.push({
      url,
      body: typeof options.body === 'string' ? options.body : undefined,
    });
    return fakeLinkedInResponse(url);
  }
}

const fakeLinkedInResponse = (url: string) => {
  const isComment = url.includes('/comments');
  const payload = isComment
    ? { object: 'urn:li:comment:(urn:li:activity:1,1)' }
    : url.includes('/socialActions/')
    ? { likesSummary: { totalLikes: 9 } }
    : {};

  return {
    status: isComment || url.includes('/rest/posts') ? 201 : 200,
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-restli-id' ? 'urn:li:share:1' : null,
    },
  } as Response;
};

const integration = {
  token: 'token',
  internalId: 'org-1',
} as Integration;

const commentPost = {
  id: 'comment-1',
  message: COMMENT_URL,
  media: [],
  settings: { post_as_images_carousel: false },
};

const commentBody = (calls: Captured[]) => {
  const call = calls.find((entry) => entry.url.includes('/comments'));
  expect(call?.body).toEqual(expect.any(String));
  return JSON.parse(call!.body!);
};

describe('LinkedIn little text', () => {
  it('sends a comment URL out unescaped', async () => {
    const provider = new RecordingLinkedin();

    await provider.comment(
      'person-1',
      'urn:li:share:1',
      undefined,
      'token',
      [commentPost],
      integration,
      'personal'
    );

    const body = commentBody(provider.calls);
    expect(body.message.text).toBe(COMMENT_URL);
    expect(body.message.text).not.toContain('\\');
    expect(body.actor).toBe('urn:li:person:person-1');
  });

  it('sends a LinkedIn Page comment and auto-plug comment unescaped', async () => {
    const provider = new RecordingLinkedinPage();

    await provider.comment(
      'org-1',
      'urn:li:share:1',
      undefined,
      'token',
      [commentPost],
      integration
    );

    const comment = commentBody(provider.calls);
    expect(comment.message.text).toBe(COMMENT_URL);
    expect(comment.message.text).not.toContain('\\');
    expect(comment.actor).toBe('urn:li:organization:org-1');

    provider.calls.length = 0;
    await provider.autoPlugPost(integration, 'urn:li:share:1', {
      likesAmount: '1',
      post: COMMENT_URL,
    });

    const plug = commentBody(provider.calls);
    expect(plug.message.text).toBe(COMMENT_URL);
    expect(plug.message.text).not.toContain('\\');
  });

  it('still escapes reserved characters in post commentary', async () => {
    const provider = new RecordingLinkedin();
    const mention = '@[Acme](urn:li:organization:42)';
    const message = `Note_this (ok) #tag ${COMMENT_URL} ${mention}`;

    await provider.finalizePost(
      'token',
      {
        attempting: true,
        confirmed: true,
        authorId: 'person-1',
        postType: 'personal',
        message,
        isPdf: false,
        mediaIds: [],
        poll: [],
        graceChecks: 0,
      },
      integration
    );

    const post = provider.calls.find((entry) =>
      entry.url.includes('/rest/posts')
    );
    const commentary = JSON.parse(post!.body!).commentary as string;

    expect(commentary).toContain('Note\\_this');
    expect(commentary).toContain('\\(ok\\)');
    expect(commentary).toContain('\\#tag');
    expect(commentary).toContain(mention);
    expect(littleToPlain(commentary)).toBe(message);
  });
});
