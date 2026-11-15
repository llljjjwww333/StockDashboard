import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newsSourceLink } from '../src/lib/newsSource.ts';

test('source links keep their complete URL and expose a readable hostname', () => {
  assert.deepEqual(newsSourceLink('https://news.example.com/story?id=1#part'), {
    href: 'https://news.example.com/story?id=1#part', hostname: 'news.example.com',
  });
  assert.equal(newsSourceLink('http://example.com').href, 'http://example.com/');
});

test('missing, malformed, non-web and credential-bearing sources offer no external link', () => {
  for (const value of [undefined, null, 1, '', '/story', 'not a url', 'https://', 'javascript:alert(1)',
    'data:text/html,test', 'file:///tmp/story', 'https://user:password@example.com/story']) {
    assert.equal(newsSourceLink(value), null);
  }
});
