import { describe, expect, test } from 'bun:test';
import { createConfig } from './config';
import { isLiteFrontendHost } from './static';

describe('isLiteFrontendHost', () => {
  const config = createConfig({
    liteHost: 'litechat.moveto.kr',
    liteHostAliases: ['lc.moveto.kr'],
  });

  test('기본 Lite 도메인을 인식한다', () => {
    expect(isLiteFrontendHost('litechat.moveto.kr', config)).toBe(true);
  });

  test('lc.moveto.kr 별칭과 포트가 붙은 호스트를 인식한다', () => {
    expect(isLiteFrontendHost('lc.moveto.kr', config)).toBe(true);
    expect(isLiteFrontendHost('LC.MOVETO.KR:3000', config)).toBe(true);
  });

  test('Full Chat과 Dashboard 도메인은 Lite로 분기하지 않는다', () => {
    expect(isLiteFrontendHost('chat.moveto.kr', config)).toBe(false);
    expect(isLiteFrontendHost('dash.moveto.kr', config)).toBe(false);
  });
});
